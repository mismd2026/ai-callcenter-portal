"""顧客向けダッシュボード。会社コードは常にトークンから取る（URL では受け取らない）。"""

from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from .. import db
from ..billing import Credit, apply_credits
from ..clock import iso, now_local
from ..deps import CompanyAdmin, Conn, Customer, DashboardUser, Period, Tx, period_bounds, rows

router = APIRouter(prefix="/api/company")


@router.get("")
def company(p: Customer, conn: Conn):
    found = rows(
        conn,
        """SELECT c.company_code, c.company_name, c.country_code, c.status, c.created_at,
                  l.plan_tier, l.concurrent_call_limit, l.billing_model, l.per_call_fee,
                  pc.plan_label
           FROM companies c
           LEFT JOIN licenses l ON l.company_code = c.company_code
           LEFT JOIN plan_catalog pc ON pc.plan_tier = l.plan_tier
           WHERE c.company_code = :code""",
        code=p.company_code,
    )
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "契約が見つかりません")
    return found[0]


@router.get("/categories")
def categories(_: Customer, conn: Conn):
    return rows(
        conn, "SELECT category_code, category_name FROM inquiry_categories ORDER BY category_code"
    )


@router.get("/periods")
def periods(p: DashboardUser, conn: Conn):
    result = rows(
        conn,
        """SELECT DISTINCT substr(started_at, 1, 7) AS period FROM calls
           WHERE company_code = :code AND ended_at IS NOT NULL ORDER BY period""",
        code=p.company_code,
    )
    return [r["period"] for r in result]


@router.get("/onboarding")
def onboarding(p: DashboardUser, conn: Conn):
    return rows(
        conn,
        """SELECT step_id, step_order, step_label, planned_date, actual_date, status
           FROM onboarding_steps WHERE company_code = :code ORDER BY step_order""",
        code=p.company_code,
    )


@router.get("/calls/monthly")
def monthly_calls(p: DashboardUser, conn: Conn):
    # AI が受けた通話も、人が受けて入力した通話も区別せずに数える
    return rows(
        conn,
        """SELECT substr(started_at, 1, 7) AS period, COUNT(*) AS calls FROM calls
           WHERE company_code = :code AND ended_at IS NOT NULL
           GROUP BY substr(started_at, 1, 7) ORDER BY period""",
        code=p.company_code,
    )


@router.get("/inquiry-breakdown")
def inquiry_breakdown(p: DashboardUser, conn: Conn, period: Period):
    start, end = period_bounds(period)
    result = rows(
        conn,
        """SELECT ic.category_code, ic.category_name, COUNT(*) AS cnt
           FROM calls c JOIN inquiry_categories ic ON ic.category_code = c.primary_category_code
           WHERE c.company_code = :code AND c.ended_at IS NOT NULL
             AND c.started_at >= :start AND c.started_at < :end
           GROUP BY ic.category_code, ic.category_name ORDER BY cnt DESC""",
        code=p.company_code,
        start=start,
        end=end,
    )
    total = sum(r["cnt"] for r in result) or 1
    return [
        {
            "category_code": r["category_code"],
            "name": r["category_name"],
            "count": r["cnt"],
            "percent": round(r["cnt"] / total * 100, 1),
        }
        for r in result
    ]


@router.get("/cases")
def cases(p: DashboardUser, conn: Conn, period: Period):
    start, end = period_bounds(period)
    return rows(
        conn,
        """SELECT sc.case_id, sc.category_code, ic.category_name, sc.summary, sc.status,
                  sc.opened_at, sc.resolved_at,
                  (SELECT h.note FROM case_handovers h WHERE h.case_id = sc.case_id
                   ORDER BY h.handed_over_at DESC LIMIT 1) AS latest_handover
           FROM support_cases sc
           LEFT JOIN inquiry_categories ic ON ic.category_code = sc.category_code
           WHERE sc.company_code = :code AND sc.opened_at >= :start AND sc.opened_at < :end
           ORDER BY sc.opened_at DESC""",
        code=p.company_code,
        start=start,
        end=end,
    )


@router.get("/logs")
def logs(
    p: DashboardUser,
    conn: Conn,
    period: Period,
    # 顧客に見せるのはオペレーター対応と障害のお知らせだけ。サーバー・ネットワークの
    # 内部ログは運用側だけが扱う（元の画面では顧客にも表示されていた）
    log_type: Annotated[Literal["operator", "incident"], Query(alias="type")] = "operator",
):
    start, end = period_bounds(period)
    return rows(
        conn,
        """SELECT log_id, log_type, severity, occurred_at, message FROM system_logs
           WHERE company_code = :code AND log_type = :t
             AND occurred_at >= :start AND occurred_at < :end
           ORDER BY occurred_at DESC LIMIT 100""",
        code=p.company_code,
        t=log_type,
        start=start,
        end=end,
    )


def compute_billing(conn, company_code: str, period: str) -> dict:
    start, end = period_bounds(period)
    lic = rows(
        conn,
        "SELECT price_amount, currency FROM licenses WHERE company_code = :code",
        code=company_code,
    )
    usage = rows(
        conn,
        """SELECT cost_type, SUM(amount) AS total FROM cost_usage_daily
           WHERE company_code = :code AND usage_date >= :start AND usage_date < :end
           GROUP BY cost_type ORDER BY cost_type""",
        code=company_code,
        start=start,
        end=end,
    )
    usage_by_period = {
        r["period"]: r["total"]
        for r in rows(
            conn,
            """SELECT substr(usage_date, 1, 7) AS period, SUM(amount) AS total
               FROM cost_usage_daily WHERE company_code = :code
               GROUP BY substr(usage_date, 1, 7)""",
            code=company_code,
        )
    }
    credit_rows = rows(
        conn,
        "SELECT amount, granted_at, expires_at FROM credits WHERE company_code = :code",
        code=company_code,
    )
    credit = apply_credits([Credit(**c) for c in credit_rows], usage_by_period, period)
    invoice = rows(
        conn,
        """SELECT invoice_id, issued_date, due_date, currency, status
           FROM invoices WHERE company_code = :code
             AND billing_period_start >= :start AND billing_period_start < :end""",
        code=company_code,
        start=start,
        end=end,
    )
    breakdown = []
    if lic and usage:
        breakdown.append({"label": "基本ライセンス料", "amount": lic[0]["price_amount"]})
    breakdown += [{"label": u["cost_type"], "amount": u["total"]} for u in usage]
    subtotal = sum(b["amount"] for b in breakdown)
    return {
        "breakdown": breakdown,
        "subtotal": subtotal,
        "credit_applied": credit.applied,
        "credit_balance": credit.balance,
        "total": subtotal - credit.applied,
        "currency": lic[0]["currency"] if lic else "JPY",
        "invoice": invoice[0] if invoice else None,
    }


@router.get("/billing")
def billing(p: DashboardUser, conn: Conn, period: Period):
    return compute_billing(conn, p.company_code, period)


class CancellationIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


@router.post("/cancellation", status_code=status.HTTP_202_ACCEPTED)
def request_cancellation(body: CancellationIn, p: CompanyAdmin, conn: Tx):
    pending = rows(
        conn,
        """SELECT request_id FROM cancellation_requests
           WHERE company_code = :code AND status = 'pending'""",
        code=p.company_code,
    )
    if pending:
        raise HTTPException(status.HTTP_409_CONFLICT, "すでに解約の申し込みを受け付けています")
    conn.execute(
        db.cancellation_requests.insert().values(
            company_code=p.company_code,
            requested_at=iso(now_local()),
            requested_by=p.uid,
            reason=body.reason,
        )
    )
    return {"status": "accepted"}
