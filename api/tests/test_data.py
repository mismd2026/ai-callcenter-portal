"""画面に出す数値が正しく集計されるかのテスト。"""

import json

from app.config import REPO_ROOT
from tests.conftest import auth

TOKYO = auth("company_admin", "ACME-TOKYO")
OPS = auth("ops_admin")
FIXTURE = json.loads((REPO_ROOT / "fixtures" / "demo.json").read_text(encoding="utf-8"))


def expected_calls(company: str, month: str) -> int:
    return sum(
        v["count"]
        for v in FIXTURE["call_volume"]
        if v["company_code"] == company and v["month"] == month
    )


def test_monthly_calls_match_fixture(client):
    data = client.get("/api/company/calls/monthly", headers=TOKYO).json()
    by_period = {d["period"]: d["calls"] for d in data}
    assert by_period["2026-07"] == expected_calls("ACME-TOKYO", "2026-07")
    # 通話中（ended_at が空）のコールは月別集計に含めない
    assert set(by_period) == set(FIXTURE["months"])


def test_periods_list(client):
    assert client.get("/api/company/periods", headers=TOKYO).json() == FIXTURE["months"]


def test_inquiry_breakdown_sums_to_100(client):
    data = client.get("/api/company/inquiry-breakdown?period=2026-07", headers=TOKYO).json()
    assert {d["category_code"] for d in data} == {
        "billing",
        "usage",
        "complaint",
        "cancellation",
        "other",
    }
    assert abs(sum(d["percent"] for d in data) - 100) < 0.5
    assert sum(d["count"] for d in data) == expected_calls("ACME-TOKYO", "2026-07")


def test_billing_total_is_license_plus_usage(client):
    data = client.get("/api/company/billing?period=2026-07", headers=TOKYO).json()
    assert data["breakdown"][0] == {"label": "基本ライセンス料", "amount": 1000000}
    assert data["subtotal"] == sum(b["amount"] for b in data["breakdown"])
    assert data["total"] == data["subtotal"] - data["credit_applied"]


def test_billing_for_period_without_data_is_empty(client):
    data = client.get("/api/company/billing?period=2025-01", headers=TOKYO).json()
    assert data["breakdown"] == [] and data["total"] == 0 and data["invoice"] is None


def test_cases_include_latest_handover(client):
    data = client.get("/api/company/cases?period=2026-07", headers=TOKYO).json()
    assert data and all(c["latest_handover"] for c in data)


def test_ops_companies_show_live_status(client):
    data = client.get("/api/ops/tenants/ACME/companies", headers=OPS).json()
    tokyo = next(c for c in data if c["company_code"] == "ACME-TOKYO")
    live = next(x for x in FIXTURE["live"] if x["company_code"] == "ACME-TOKYO")
    assert tokyo["active_calls"] == live["active_calls"]
    assert tokyo["escalations_today"] == live["escalations_today"]
    assert tokyo["unanswered_today"] == live["unanswered_today"]
    assert tokyo["concurrent_call_limit"] == 100


def test_ops_users_by_tenant(client):
    acme = client.get("/api/ops/tenants/ACME/users", headers=OPS).json()
    assert {u["user_code"] for u in acme} == {"u_tanaka", "u_suzuki", "u_kato", "u_yamada"}
    midori = client.get("/api/ops/tenants/MIDORI/users", headers=OPS).json()
    assert {u["user_code"] for u in midori} == {"u_mori", "u_ito"}
