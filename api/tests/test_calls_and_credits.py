"""通話入力とクレジット相殺のテスト。"""

from app.billing import Credit, apply_credits
from app.clock import now_local
from tests.conftest import auth

ADMIN = auth("company_admin", "ACME-TOKYO")
MIDORI_ADMIN = auth("company_admin", "MIDORI-MAIN")
MIDORI_OPERATOR = auth("operator", "MIDORI-MAIN")
OPERATOR = auth("operator", "ACME-TOKYO")
OSAKA_ADMIN = auth("company_admin", "ACME-OSAKA")
OSAKA_OPERATOR = auth("operator", "ACME-OSAKA")
VIEWER = auth("viewer", "ACME-TOKYO")
OPS = auth("ops_admin")

CALL = {
    "category_code": "usage",
    "caller_question": "土曜日の午後は診てもらえますか",
    "answer_given": "土曜日は午前のみの診療です。",
    "outcome": "resolved",
    "duration_minutes": 3,
}


def this_period() -> str:
    return now_local().strftime("%Y-%m")


# ---- 通話入力 ----


def test_viewer_cannot_enter_calls(client):
    assert client.post("/api/company/calls/manual", json=CALL, headers=VIEWER).status_code == 403
    assert client.get("/api/company/calls/manual", headers=VIEWER).status_code == 403


def test_manual_call_counts_like_any_other_call(client):
    period = this_period()

    def calls_this_month():
        data = client.get("/api/company/calls/monthly", headers=MIDORI_ADMIN).json()
        return next((d["calls"] for d in data if d["period"] == period), 0)

    before = calls_this_month()
    r = client.post("/api/company/calls/manual", json=CALL, headers=MIDORI_OPERATOR)
    assert r.status_code == 201
    assert r.json()["case_id"] is None
    assert calls_this_month() == before + 1

    listed = client.get("/api/company/calls/manual", headers=MIDORI_OPERATOR).json()
    assert listed[0]["caller_question"] == CALL["caller_question"]
    assert listed[0]["entered_by"] == "dev-operator"
    # 他社の入力は見えない
    assert client.get("/api/company/calls/manual", headers=OPERATOR).json() == []


def test_unresolved_call_creates_case(client):
    body = {**CALL, "outcome": "callback", "note": "院長から折り返し"}
    case_id = client.post("/api/company/calls/manual", json=body, headers=MIDORI_OPERATOR).json()[
        "case_id"
    ]
    assert case_id
    cases = client.get(f"/api/company/cases?period={this_period()}", headers=MIDORI_ADMIN).json()
    case = next(c for c in cases if c["case_id"] == case_id)
    assert case["status"] == "in_progress"
    assert case["latest_handover"] == "院長から折り返し"


def test_not_in_faq_goes_to_review_queue(client):
    body = {**CALL, "caller_question": "往診はしていますか", "not_in_faq": True}
    client.post("/api/company/calls/manual", json=body, headers=MIDORI_OPERATOR)
    queue = client.get("/api/company/unanswered", headers=MIDORI_ADMIN).json()
    assert "往診はしていますか" in {q["question_text"] for q in queue}


def test_call_validation(client):
    bad = [
        {**CALL, "duration_minutes": 0},
        {**CALL, "outcome": "unknown"},
        {**CALL, "caller_question": ""},
        {**CALL, "started_at": "2999-01-01T10:00:00"},
    ]
    for body in bad:
        r = client.post("/api/company/calls/manual", json=body, headers=OPERATOR)
        assert r.status_code == 422


def test_cannot_link_other_companys_faq(client):
    faq_id = client.get("/api/company/faqs", headers=ADMIN).json()[0]["faq_id"]
    r = client.post(
        "/api/company/calls/manual", json={**CALL, "faq_id": faq_id}, headers=MIDORI_OPERATOR
    )
    assert r.status_code == 422


# ---- クレジット ----


def test_apply_credits_rules():
    usage = {"2026-05": 30000, "2026-06": 30000, "2026-07": 30000}
    credits = [Credit(50000, "2026-05-01", None)]
    assert apply_credits(credits, usage, "2026-05").applied == 30000
    assert apply_credits(credits, usage, "2026-06").applied == 20000
    r = apply_credits(credits, usage, "2026-07")
    assert (r.applied, r.balance) == (0, 0)

    # 付与月より前・期限切れの月には使わない。期限の近いものから使う
    credits = [Credit(10000, "2026-06-15", "2026-06-30"), Credit(10000, "2026-06-01", None)]
    assert apply_credits(credits, usage, "2026-05").applied == 0
    june = apply_credits(credits, usage, "2026-06")
    assert (june.applied, june.balance) == (20000, 0)
    credits = [Credit(40000, "2026-06-01", "2026-06-30")]
    july = apply_credits(credits, usage, "2026-07")
    assert (july.applied, july.balance) == (0, 0)  # 余った10,000円は6月末で失効


def test_subscription_plan_has_no_per_call_fee(client):
    """月額定額（既定）の契約では、入力した通話に料金はかからない（利用状況には数える）。"""
    period = this_period()
    client.post("/api/company/calls/manual", json=CALL, headers=MIDORI_OPERATOR)
    company = client.get("/api/company", headers=MIDORI_ADMIN).json()
    assert company["billing_model"] == "subscription"
    bill = client.get(f"/api/company/billing?period={period}", headers=MIDORI_ADMIN).json()
    assert all(b["label"] != "通話処理料" for b in bill["breakdown"])


def test_metered_plan_charges_per_call_and_is_offset_by_credit(client):
    """従量課金オプションの契約では、通話ごとの料金を加算し、クレジットと相殺する。"""
    period = this_period()
    company = client.get("/api/company", headers=OSAKA_ADMIN).json()
    assert company["billing_model"] == "metered"
    fee = company["per_call_fee"]
    client.post("/api/company/calls/manual", json=CALL, headers=OSAKA_OPERATOR)
    client.post("/api/company/calls/manual", json=CALL, headers=OSAKA_OPERATOR)
    bill = client.get(f"/api/company/billing?period={period}", headers=OSAKA_ADMIN).json()
    line = next(b for b in bill["breakdown"] if b["label"] == "通話処理料")
    assert line["amount"] == fee * 2
    assert bill["total"] == bill["subtotal"] - bill["credit_applied"]

    # 運用管理者がクレジットを付与すると、従量分（基本料金以外）が相殺される
    r = client.post(
        "/api/ops/companies/ACME-OSAKA/credits",
        json={"amount": 30000, "reason": "手動テスト期間の追加クレジット"},
        headers=OPS,
    )
    assert r.status_code == 201
    bill = client.get(f"/api/company/billing?period={period}", headers=OSAKA_ADMIN).json()
    assert bill["credit_applied"] == fee * 2
    assert bill["total"] == bill["breakdown"][0]["amount"]  # 基本料金だけが残る


def test_only_ops_can_grant_credit(client):
    body = {"amount": 30000, "reason": "追加"}
    r = client.post("/api/ops/companies/MIDORI-MAIN/credits", json=body, headers=MIDORI_ADMIN)
    assert r.status_code == 403
    r = client.post("/api/ops/companies/MIDORI-MAIN/credits", json=body, headers=OPS)
    assert r.status_code == 201
    companies = client.get("/api/ops/tenants/MIDORI/companies", headers=OPS).json()
    assert companies[0]["credit_balance"] == r.json()["credit_balance"] >= 30000


def test_credit_validation(client):
    for body in (
        {"amount": 0, "reason": "x"},
        {"amount": 100, "reason": ""},
        {"amount": 100, "reason": "x", "expires_at": "2000-01-01"},
    ):
        r = client.post("/api/ops/companies/MIDORI-MAIN/credits", json=body, headers=OPS)
        assert r.status_code == 422
    r = client.post(
        "/api/ops/companies/NOPE/credits", json={"amount": 1, "reason": "x"}, headers=OPS
    )
    assert r.status_code == 404
