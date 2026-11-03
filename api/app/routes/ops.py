"""運用管理者向け（全テナント）。"""

from datetime import date, timedelta

from fastapi import APIRouter, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import insert

from .. import db
from ..clock import now_local
from ..deps import Conn, Ops, Tx, one_or_404, rows
from .dashboard import compute_billing

router = APIRouter(prefix="/api/ops")


@router.get("/tenants")
def ops_tenants(_: Ops, conn: Conn):
    return rows(conn, "SELECT tenant_code, tenant_name FROM tenants ORDER BY tenant_code")


@router.get("/tenants/{tenant_code}/companies")
def ops_companies(tenant_code: str, _: Ops, conn: Conn):
    today = now_local().date()
    start, end = today.isoformat(), (today + timedelta(days=1)).isoformat()
    companies = rows(
        conn,
        """SELECT c.company_code, c.company_name, c.country_code,
                  l.currency, l.price_amount, l.concurrent_call_limit, pc.plan_label,
                  l.billing_model, l.per_call_fee,
                  (SELECT COUNT(*) FROM calls x
                    WHERE x.company_code = c.company_code
                      AND x.ended_at IS NULL) AS active_calls,
                  (SELECT COUNT(*) FROM escalations e
                    JOIN calls x ON x.call_id = e.call_id
                    WHERE x.company_code = c.company_code
                      AND e.timestamp >= :start AND e.timestamp < :end) AS escalations_today,
                  (SELECT COUNT(*) FROM unanswered_questions u
                    WHERE u.company_code = c.company_code
                      AND u.timestamp >= :start AND u.timestamp < :end) AS unanswered_today
           FROM companies c
           LEFT JOIN licenses l ON l.company_code = c.company_code
           LEFT JOIN plan_catalog pc ON pc.plan_tier = l.plan_tier
           WHERE c.tenant_code = :t ORDER BY c.company_code""",
        t=tenant_code,
        start=start,
        end=end,
    )
    period = today.strftime("%Y-%m")
    for c in companies:
        c["credit_balance"] = compute_billing(conn, c["company_code"], period)["credit_balance"]
    return companies


@router.get("/tenants/{tenant_code}/users")
def ops_users(tenant_code: str, _: Ops, conn: Conn):
    return rows(
        conn,
        """SELECT u.user_code, u.display_name, ur.company_code, r.role_name
           FROM users u
           JOIN user_roles ur ON ur.user_code = u.user_code
           JOIN roles r ON r.role_code = ur.role_code
           WHERE u.tenant_code = :t ORDER BY ur.company_code, u.user_code""",
        t=tenant_code,
    )


class CreditIn(BaseModel):
    amount: int = Field(gt=0, le=10_000_000)
    reason: str = Field(min_length=1, max_length=200)
    expires_at: date | None = None

    @field_validator("expires_at")
    @classmethod
    def in_future(cls, v: date | None) -> date | None:
        if v is not None and v < now_local().date():
            raise ValueError("有効期限は今日以降にしてください")
        return v


@router.post("/companies/{company_code}/credits", status_code=status.HTTP_201_CREATED)
def grant_credit(company_code: str, body: CreditIn, p: Ops, conn: Tx):
    one_or_404(
        conn,
        "SELECT company_code FROM companies WHERE company_code = :c",
        "契約が見つかりません",
        c=company_code,
    )
    conn.execute(
        insert(db.credits).values(
            company_code=company_code,
            amount=body.amount,
            reason=body.reason,
            granted_at=now_local().date().isoformat(),
            expires_at=body.expires_at.isoformat() if body.expires_at else None,
            granted_by=p.uid,
        )
    )
    period = now_local().strftime("%Y-%m")
    return {"credit_balance": compute_billing(conn, company_code, period)["credit_balance"]}
