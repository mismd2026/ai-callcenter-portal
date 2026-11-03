"""CMS（FAQ・CSV取り込み・未回答レビュー・応答設定）のテスト。"""

from tests.conftest import auth

ADMIN = auth("company_admin", "ACME-TOKYO")
OSAKA_ADMIN = auth("company_admin", "ACME-OSAKA")
OPERATOR = auth("operator", "ACME-TOKYO")
VIEWER = auth("viewer", "ACME-TOKYO")
OPS = auth("ops_admin")

NEW_FAQ = {
    "category_code": "billing",
    "questions": ["領収書は発行できますか", "領収書がほしい", "領収書がほしい"],
    "answer_text": "マイページの「請求履歴」から領収書を発行できます。",
}


# ---- 権限 ----


def test_only_company_admin_can_edit_faq(client):
    for who in (OPERATOR, VIEWER, OPS):
        assert client.post("/api/company/faqs", json=NEW_FAQ, headers=who).status_code == 403
        assert client.get("/api/company/faqs", headers=who).status_code == 403
        assert client.get("/api/company/settings", headers=who).status_code == 403
        assert client.get("/api/company/unanswered", headers=who).status_code == 403


def test_viewer_cannot_search_faq_but_operator_can(client):
    assert client.get("/api/company/faqs/search?q=解約", headers=VIEWER).status_code == 403
    assert client.get("/api/company/faqs/search?q=解約", headers=OPERATOR).status_code == 200


def test_operator_cannot_open_dashboard(client):
    assert client.get("/api/company/billing?period=2026-07", headers=OPERATOR).status_code == 403
    # 画面上部の会社名は表示できる
    assert client.get("/api/company", headers=OPERATOR).status_code == 200


def test_other_companys_faq_is_not_found(client):
    faq = client.post("/api/company/faqs", json=NEW_FAQ, headers=ADMIN).json()
    path = f"/api/company/faqs/{faq['faq_id']}"
    assert client.put(path, json=NEW_FAQ, headers=OSAKA_ADMIN).status_code == 404
    assert client.delete(path, headers=OSAKA_ADMIN).status_code == 404
    status_path = f"{path}/status"
    r = client.post(status_path, json={"status": "published"}, headers=OSAKA_ADMIN)
    assert r.status_code == 404
    osaka = client.get("/api/company/faqs", headers=OSAKA_ADMIN).json()
    assert faq["faq_id"] not in {f["faq_id"] for f in osaka}


# ---- FAQ ----


def test_create_update_publish_delete_faq(client):
    created = client.post("/api/company/faqs", json=NEW_FAQ, headers=ADMIN)
    assert created.status_code == 201
    faq = created.json()
    assert faq["status"] == "draft"
    assert faq["questions"] == ["領収書は発行できますか", "領収書がほしい"]  # 重複は除く
    assert faq["updated_by"] == "dev-company_admin"

    # 下書きはオペレーターの検索に出ない
    hits = client.get("/api/company/faqs/search?q=領収書", headers=OPERATOR).json()
    assert faq["faq_id"] not in {h["faq_id"] for h in hits}

    path = f"/api/company/faqs/{faq['faq_id']}"
    published = client.post(f"{path}/status", json={"status": "published"}, headers=ADMIN).json()
    assert published["status"] == "published"
    hits = client.get("/api/company/faqs/search?q=領収書を発行したい", headers=OPERATOR).json()
    assert hits[0]["faq_id"] == faq["faq_id"]

    edited = client.put(
        path,
        json={**NEW_FAQ, "questions": ["領収書の再発行"], "status": "published"},
        headers=ADMIN,
    ).json()
    assert edited["questions"] == ["領収書の再発行"]

    assert client.delete(path, headers=ADMIN).status_code == 204
    assert client.put(path, json=NEW_FAQ, headers=ADMIN).status_code == 404


def test_faq_validation(client):
    bad = [
        {**NEW_FAQ, "category_code": "unknown"},
        {**NEW_FAQ, "questions": []},
        {**NEW_FAQ, "questions": ["   "]},
        {**NEW_FAQ, "answer_text": ""},
        {**NEW_FAQ, "status": "archived"},
    ]
    for body in bad:
        assert client.post("/api/company/faqs", json=body, headers=ADMIN).status_code == 422


def test_search_ranks_closest_question_first(client):
    hits = client.get("/api/company/faqs/search?q=解約の手続き", headers=OPERATOR).json()
    assert hits and hits[0]["category_code"] == "cancellation"
    assert all(h["status"] == "published" for h in hits)


# ---- CSV 取り込み ----

CSV_OK = """category,question,answer
料金・請求,請求書の宛名を変えたい|宛名を変更したい,マイページの「契約者情報」から変更できます。
usage,夜間も使えますか,24時間ご利用いただけます。
"""


def test_csv_dry_run_then_import(client):
    before = len(client.get("/api/company/faqs", headers=ADMIN).json())
    dry = client.post("/api/company/faqs/import", json={"csv": CSV_OK}, headers=ADMIN).json()
    assert dry["valid"] == 2 and dry["errors"] == [] and dry["imported"] == 0
    assert dry["preview"][0]["questions"] == ["請求書の宛名を変えたい", "宛名を変更したい"]
    assert len(client.get("/api/company/faqs", headers=ADMIN).json()) == before

    done = client.post(
        "/api/company/faqs/import", json={"csv": CSV_OK, "dry_run": False}, headers=ADMIN
    ).json()
    assert done["imported"] == 2
    faqs = client.get("/api/company/faqs", headers=ADMIN).json()
    assert len(faqs) == before + 2
    imported = [f for f in faqs if f["source"] == "csv"]
    assert all(f["status"] == "draft" for f in imported)  # 取り込みは下書き


def test_csv_with_errors_imports_nothing(client):
    bad = CSV_OK + "不明な種別,質問,回答\nusage,,回答だけ\n"
    before = len(client.get("/api/company/faqs", headers=ADMIN).json())
    r = client.post(
        "/api/company/faqs/import", json={"csv": bad, "dry_run": False}, headers=ADMIN
    ).json()
    assert [e["row"] for e in r["errors"]] == [4, 5]
    assert r["imported"] == 0
    assert len(client.get("/api/company/faqs", headers=ADMIN).json()) == before


def test_csv_requires_header(client):
    r = client.post("/api/company/faqs/import", json={"csv": "a,b\n1,2\n"}, headers=ADMIN).json()
    assert r["errors"][0]["row"] == 1


def test_csv_import_is_admin_only(client):
    r = client.post("/api/company/faqs/import", json={"csv": CSV_OK}, headers=OPERATOR)
    assert r.status_code == 403


# ---- 未回答レビュー ----


def test_promote_unanswered_to_faq(client):
    items = client.get("/api/company/unanswered", headers=ADMIN).json()
    assert items
    item = items[0]
    body = {
        "category_code": "other",
        "questions": [item["question_text"]],
        "answer_text": "はい、対応しています。",
        "status": "published",
    }
    r = client.post(f"/api/company/unanswered/{item['id']}/promote", json=body, headers=ADMIN)
    assert r.status_code == 201
    faq = r.json()
    assert faq["source"] == "unanswered" and faq["status"] == "published"

    open_ids = {i["id"] for i in client.get("/api/company/unanswered", headers=ADMIN).json()}
    assert item["id"] not in open_ids
    promoted = client.get("/api/company/unanswered?status=promoted", headers=ADMIN).json()
    assert promoted[0]["promoted_faq_id"] == faq["faq_id"]
    # 二重にレビューはできない
    again = client.post(f"/api/company/unanswered/{item['id']}/dismiss", headers=ADMIN)
    assert again.status_code == 409


def test_dismiss_and_cross_company_isolation(client):
    item = client.get("/api/company/unanswered", headers=ADMIN).json()[0]
    other = client.post(f"/api/company/unanswered/{item['id']}/dismiss", headers=OSAKA_ADMIN)
    assert other.status_code == 404
    ok = client.post(f"/api/company/unanswered/{item['id']}/dismiss", headers=ADMIN)
    assert ok.status_code == 200


# ---- 応答設定 ----


def test_settings_roundtrip_and_validation(client):
    current = client.get("/api/company/settings", headers=ADMIN).json()
    assert current["business_days"] == [1, 2, 3, 4, 5]
    assert "解約" in current["escalation_keywords"]

    updated = {
        **{k: current[k] for k in (
            "greeting", "business_hours_start", "business_hours_end", "business_days",
            "after_hours_message", "escalation_keywords", "max_ai_turns",
        )},
        "business_hours_end": "20:00",
        "business_days": [6, 1, 1, 2],
        "escalation_keywords": ["解約", "解約", "上司"],
    }  # fmt: skip
    saved = client.put("/api/company/settings", json=updated, headers=ADMIN).json()
    assert saved["business_hours_end"] == "20:00"
    assert saved["business_days"] == [1, 2, 6]
    assert saved["escalation_keywords"] == ["解約", "上司"]

    for bad in (
        {**updated, "business_hours_end": "08:00"},  # 開始より前
        {**updated, "business_hours_start": "25:00"},
        {**updated, "business_days": []},
        {**updated, "business_days": [8]},
        {**updated, "max_ai_turns": 0},
    ):
        assert client.put("/api/company/settings", json=bad, headers=ADMIN).status_code == 422
