"""認可のテスト。公開する以上、ここが一番大事。"""

import pytest

from app.auth import build_verifier
from tests.conftest import auth

TOKYO = auth("company_admin", "ACME-TOKYO")
OSAKA = auth("company_admin", "ACME-OSAKA")
VIEWER = auth("viewer", "ACME-TOKYO")
OPS = auth("ops_admin")


def test_no_token_is_rejected(client):
    assert client.get("/api/company").status_code == 401
    assert client.get("/api/ops/tenants").status_code == 401


def test_malformed_token_is_rejected(client):
    r = client.get("/api/company", headers={"Authorization": "Bearer not-a-token"})
    assert r.status_code == 401


def test_user_without_portal_claims_is_forbidden(client):
    # ログインはできても、カスタムクレームが付いていない
    assert client.get("/api/company", headers=auth("viewer")).status_code == 403
    assert client.get("/api/company", headers=auth("unknown", "ACME-TOKYO")).status_code == 403


def test_company_comes_from_token_not_url(client):
    assert client.get("/api/company", headers=TOKYO).json()["company_code"] == "ACME-TOKYO"
    assert client.get("/api/company", headers=OSAKA).json()["company_code"] == "ACME-OSAKA"
    # 他社を指定する方法がそもそも存在しない（クエリで渡しても無視される）
    r = client.get("/api/company?company_code=ACME-OSAKA", headers=TOKYO)
    assert r.json()["company_code"] == "ACME-TOKYO"


def test_customer_data_is_scoped_to_own_company(client):
    tokyo = client.get("/api/company/cases?period=2026-07", headers=TOKYO).json()
    osaka = client.get("/api/company/cases?period=2026-07", headers=OSAKA).json()
    tokyo_ids = {c["case_id"] for c in tokyo}
    osaka_ids = {c["case_id"] for c in osaka}
    assert tokyo_ids and osaka_ids
    assert tokyo_ids.isdisjoint(osaka_ids)


def test_customer_cannot_open_ops_console(client):
    assert client.get("/api/ops/tenants", headers=TOKYO).status_code == 403
    assert client.get("/api/ops/tenants/ACME/companies", headers=VIEWER).status_code == 403


def test_ops_cannot_use_customer_endpoints(client):
    # 運用管理者は特定の会社に属さないので、顧客画面のAPIは使えない
    assert client.get("/api/company", headers=OPS).status_code == 403


def test_viewer_cannot_request_cancellation(client):
    r = client.post("/api/company/cancellation", json={"reason": "test"}, headers=VIEWER)
    assert r.status_code == 403


def test_admin_can_request_cancellation_once(client):
    r = client.post("/api/company/cancellation", json={"reason": "予算の見直し"}, headers=TOKYO)
    assert r.status_code == 202
    again = client.post("/api/company/cancellation", json={"reason": "再送"}, headers=TOKYO)
    assert again.status_code == 409
    # 他社の申し込み状況には影響しない
    assert (
        client.post("/api/company/cancellation", json={"reason": "x"}, headers=OSAKA).status_code
        == 202
    )


def test_internal_log_types_are_hidden_from_customers(client):
    ok = client.get("/api/company/logs?type=incident&period=2026-07", headers=TOKYO)
    assert ok.status_code == 200
    for internal in ("server", "network"):
        r = client.get(f"/api/company/logs?type={internal}&period=2026-07", headers=TOKYO)
        assert r.status_code == 422


def test_invalid_period_is_rejected(client):
    r = client.get("/api/company/cases?period=2026-13", headers=TOKYO)
    assert r.status_code == 422
    r = client.get("/api/company/cases?period=' OR 1=1 --", headers=TOKYO)
    assert r.status_code == 422


def test_insecure_dev_mode_is_refused_on_cloud_run():
    with pytest.raises(RuntimeError):
        build_verifier("insecure-dev", "", on_cloud_run=True)


def test_security_headers(client):
    r = client.get("/api/company", headers=TOKYO)
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"]
    assert r.headers["Cache-Control"] == "no-store"
    assert "access-control-allow-origin" not in r.headers
