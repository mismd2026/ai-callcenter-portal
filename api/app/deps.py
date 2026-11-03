"""ルーター共通の依存関係と小さな道具。"""

from collections.abc import Iterator
from datetime import date
from typing import Annotated

from fastapi import Depends, HTTPException, Query, Request, status
from sqlalchemy import text
from sqlalchemy.engine import Connection

from .auth import (
    Principal,
    require_call_handler,
    require_company_admin,
    require_customer,
    require_dashboard,
    require_ops,
)


def get_conn(request: Request) -> Iterator[Connection]:
    with request.app.state.engine.connect() as conn:
        yield conn


def get_tx(request: Request) -> Iterator[Connection]:
    """書き込み用。正常に終われば commit、例外なら rollback する。"""
    with request.app.state.engine.begin() as conn:
        yield conn


Conn = Annotated[Connection, Depends(get_conn)]
Tx = Annotated[Connection, Depends(get_tx)]
Period = Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="YYYY-MM")]

Customer = Annotated[Principal, Depends(require_customer)]
DashboardUser = Annotated[Principal, Depends(require_dashboard)]
CompanyAdmin = Annotated[Principal, Depends(require_company_admin)]
CallHandler = Annotated[Principal, Depends(require_call_handler)]
Ops = Annotated[Principal, Depends(require_ops)]


def rows(conn: Connection, sql: str, **params) -> list[dict]:
    return [dict(r._mapping) for r in conn.execute(text(sql), params)]


def one_or_404(conn: Connection, sql: str, message: str = "見つかりません", **params) -> dict:
    found = rows(conn, sql, **params)
    if not found:
        # 他社のデータも「存在しない」として扱い、存在の有無を推測させない
        raise HTTPException(status.HTTP_404_NOT_FOUND, message)
    return found[0]


def period_bounds(period: str) -> tuple[str, str]:
    """'2026-07' -> ('2026-07-01', '2026-08-01')。文字列の大小比較で範囲検索に使う。"""
    y, m = map(int, period.split("-"))
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    return f"{y:04d}-{m:02d}-01", nxt.isoformat()
