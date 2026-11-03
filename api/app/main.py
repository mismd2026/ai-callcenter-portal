"""顧客ポータル API。

- 顧客向け（/api/company/...）：ログインしたユーザーの所属会社のデータだけを返す
- 運用管理者向け（/api/ops/...）：ops_admin ロールのユーザーだけが全テナントを閲覧できる
- 画面（React のビルド結果）も同じオリジンから配信するので、CORS は許可しない
"""

import logging
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.engine import Connection

from . import db
from .auth import (
    Principal,
    build_verifier,
    get_principal,
    require_company_admin,
    require_customer,
    require_ops,
)
from .config import Settings
from .seed import seed_if_empty

log = logging.getLogger("portal")

Period = Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="YYYY-MM")]

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self' https://identitytoolkit.googleapis.com "
        "https://securetoken.googleapis.com; "
        "frame-ancestors 'none'"
    ),
}


def period_bounds(period: str) -> tuple[str, str]:
    """'2026-07' -> ('2026-07-01', '2026-08-01')。文字列の大小比較で範囲検索に使う。"""
    y, m = map(int, period.split("-"))
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return f"{y:04d}-{m:02d}-01", nxt.isoformat()


def create_app(settings: Settings | None = None, verifier=None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.seed_demo_data:
            if seed_if_empty(app.state.engine, settings.fixture_path):
                log.info("demo data seeded")
        else:
            db.metadata.create_all(app.state.engine)
        yield

    app = FastAPI(
        title="AI Call Center Portal API", lifespan=lifespan, docs_url=None, redoc_url=None
    )
    app.state.engine = db.make_engine(settings.database_url)
    app.state.verifier = verifier or build_verifier(
        settings.auth_mode, settings.firebase_project_id, settings.running_on_cloud_run
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def get_conn(request: Request):
        with request.app.state.engine.connect() as conn:
            yield conn

    Conn = Annotated[Connection, Depends(get_conn)]
    Customer = Annotated[Principal, Depends(require_customer)]

    def rows(conn: Connection, sql: str, **params) -> list[dict]:
        return [dict(r._mapping) for r in conn.execute(text(sql), params)]

    # ---- 共通 ----

    @app.get("/healthz", include_in_schema=False)
    def healthz():
        return {"status": "ok"}

    @app.get("/api/config")
    def public_config():
        """画面が Firebase に接続するための公開設定（秘密情報ではない）。"""
        return {
            "auth_mode": settings.auth_mode,
            "firebase": {
                "apiKey": settings.firebase_api_key,
                "authDomain": settings.firebase_auth_domain,
                "projectId": settings.firebase_project_id,
            },
        }

    @app.get("/api/me")
    def me(p: Annotated[Principal, Depends(get_principal)]):
        return {"uid": p.uid, "email": p.email, "role": p.role, "company_code": p.company_code}

    # ---- 顧客向け（会社コードは常にトークンから） ----

    @app.get("/api/company")
    def company(p: Customer, conn: Conn):
        found = rows(
            conn,
            """SELECT c.company_code, c.company_name, c.country_code, c.status, c.created_at,
                      l.plan_tier, l.concurrent_call_limit, pc.plan_label
               FROM companies c
               LEFT JOIN licenses l ON l.company_code = c.company_code
               LEFT JOIN plan_catalog pc ON pc.plan_tier = l.plan_tier
               WHERE c.company_code = :code""",
            code=p.company_code,
        )
        if not found:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "契約が見つかりません")
        return found[0]

    @app.get("/api/company/periods")
    def periods(p: Customer, conn: Conn):
        result = rows(
            conn,
            """SELECT DISTINCT substr(started_at, 1, 7) AS period FROM calls
               WHERE company_code = :code AND ended_at IS NOT NULL ORDER BY period""",
            code=p.company_code,
        )
        return [r["period"] for r in result]

    @app.get("/api/company/onboarding")
    def onboarding(p: Customer, conn: Conn):
        return rows(
            conn,
            """SELECT step_id, step_order, step_label, planned_date, actual_date, status
               FROM onboarding_steps WHERE company_code = :code ORDER BY step_order""",
            code=p.company_code,
        )

    @app.get("/api/company/calls/monthly")
    def monthly_calls(p: Customer, conn: Conn):
        return rows(
            conn,
            """SELECT substr(started_at, 1, 7) AS period, COUNT(*) AS calls FROM calls
               WHERE company_code = :code AND ended_at IS NOT NULL
               GROUP BY substr(started_at, 1, 7) ORDER BY period""",
            code=p.company_code,
        )

    @app.get("/api/company/inquiry-breakdown")
    def inquiry_breakdown(p: Customer, conn: Conn, period: Period):
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

    @app.get("/api/company/cases")
    def cases(p: Customer, conn: Conn, period: Period):
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

    @app.get("/api/company/logs")
    def logs(
        p: Customer,
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

    @app.get("/api/company/billing")
    def billing(p: Customer, conn: Conn, period: Period):
        start, end = period_bounds(period)
        lic = rows(
            conn,
            "SELECT price_amount, currency FROM licenses WHERE company_code = :code",
            code=p.company_code,
        )
        usage = rows(
            conn,
            """SELECT cost_type, SUM(amount) AS total FROM cost_usage_daily
               WHERE company_code = :code AND usage_date >= :start AND usage_date < :end
               GROUP BY cost_type ORDER BY cost_type""",
            code=p.company_code,
            start=start,
            end=end,
        )
        invoice = rows(
            conn,
            """SELECT invoice_id, issued_date, due_date, total_amount, currency, status
               FROM invoices WHERE company_code = :code
                 AND billing_period_start >= :start AND billing_period_start < :end""",
            code=p.company_code,
            start=start,
            end=end,
        )
        breakdown = []
        if lic and usage:
            breakdown.append({"label": "基本ライセンス料", "amount": lic[0]["price_amount"]})
        breakdown += [{"label": u["cost_type"], "amount": u["total"]} for u in usage]
        return {
            "breakdown": breakdown,
            "total": sum(b["amount"] for b in breakdown),
            "currency": lic[0]["currency"] if lic else "JPY",
            "invoice": invoice[0] if invoice else None,
        }

    class CancellationIn(BaseModel):
        reason: str = Field(min_length=1, max_length=500)

    @app.post("/api/company/cancellation", status_code=status.HTTP_202_ACCEPTED)
    def request_cancellation(
        body: CancellationIn,
        p: Annotated[Principal, Depends(require_company_admin)],
        request: Request,
    ):
        with request.app.state.engine.begin() as conn:
            pending = rows(
                conn,
                """SELECT request_id FROM cancellation_requests
                   WHERE company_code = :code AND status = 'pending'""",
                code=p.company_code,
            )
            if pending:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "すでに解約の申し込みを受け付けています"
                )
            conn.execute(
                db.cancellation_requests.insert().values(
                    company_code=p.company_code,
                    requested_at=datetime.now(UTC).isoformat(timespec="seconds"),
                    requested_by=p.uid,
                    reason=body.reason,
                )
            )
        log.info("cancellation requested company=%s uid=%s", p.company_code, p.uid)
        return {"status": "accepted"}

    # ---- 運用管理者向け ----

    Ops = Annotated[Principal, Depends(require_ops)]

    @app.get("/api/ops/tenants")
    def ops_tenants(_: Ops, conn: Conn):
        return rows(conn, "SELECT tenant_code, tenant_name FROM tenants ORDER BY tenant_code")

    @app.get("/api/ops/tenants/{tenant_code}/companies")
    def ops_companies(tenant_code: str, _: Ops, conn: Conn):
        today = date.today()
        start, end = today.isoformat(), (today + timedelta(days=1)).isoformat()
        return rows(
            conn,
            """SELECT c.company_code, c.company_name, c.country_code,
                      l.currency, l.price_amount, l.concurrent_call_limit, pc.plan_label,
                      (SELECT COUNT(*) FROM calls x
                        WHERE x.company_code = c.company_code
                          AND x.ended_at IS NULL) AS active_calls,
                      (SELECT COUNT(*) FROM escalations e
                        JOIN calls x ON x.call_id = e.call_id
                        WHERE x.company_code = c.company_code
                          AND e.timestamp >= :start AND e.timestamp < :end) AS escalations_today,
                      (SELECT COUNT(*) FROM unanswered_questions u
                        JOIN calls x ON x.call_id = u.call_id
                        WHERE x.company_code = c.company_code
                          AND u.timestamp >= :start AND u.timestamp < :end) AS unanswered_today
               FROM companies c
               LEFT JOIN licenses l ON l.company_code = c.company_code
               LEFT JOIN plan_catalog pc ON pc.plan_tier = l.plan_tier
               WHERE c.tenant_code = :t ORDER BY c.company_code""",
            t=tenant_code,
            start=start,
            end=end,
        )

    @app.get("/api/ops/tenants/{tenant_code}/users")
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

    # ---- 画面（React のビルド結果）の配信 ----

    if settings.static_dir and settings.static_dir.is_dir():
        static_dir = settings.static_dir
        app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(status.HTTP_404_NOT_FOUND)
            candidate = (static_dir / path).resolve()
            if path and candidate.is_file() and static_dir.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(static_dir / "index.html")

    return app
