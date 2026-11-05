"""通話入力：人が電話を受けて、その内容を入力する画面の API。

AI に任せきりにしない運用や、本稼働前の手動テストで使う。
入力した通話は AI の通話と区別せずに利用状況に数える。
料金は契約の課金方式による：
  - subscription（月額定額・既定）：通話ごとの料金はかからない
  - metered（従量課金）：契約の per_call_fee を「通話処理料」として加算し、
    クレジットと相殺できる（routes/dashboard.py の請求計算）
"""

import uuid
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import insert

from .. import db
from ..clock import iso, now_local
from ..deps import CallHandler, Conn, Tx, rows

router = APIRouter(prefix="/api/company/calls/manual")


class ManualCallIn(BaseModel):
    category_code: Literal["billing", "usage", "complaint", "cancellation", "other"]
    caller_question: str = Field(min_length=1, max_length=1000)
    answer_given: str = Field(min_length=1, max_length=2000)
    faq_id: int | None = None
    outcome: Literal["resolved", "escalated", "callback"]
    duration_minutes: int = Field(ge=1, le=240)
    note: str | None = Field(default=None, max_length=1000)
    # FAQ に答えがなかった質問として、未回答レビューに回す
    not_in_faq: bool = False
    started_at: datetime | None = None

    @field_validator("started_at")
    @classmethod
    def not_future(cls, v: datetime | None) -> datetime | None:
        if v is not None:
            v = v.replace(tzinfo=None)
            if v > now_local() + timedelta(minutes=5):
                raise ValueError("未来の日時は指定できません")
        return v


@router.post("", status_code=status.HTTP_201_CREATED)
def create_manual_call(body: ManualCallIn, p: CallHandler, conn: Tx):
    code = p.company_code
    company = rows(
        conn,
        """SELECT c.tenant_code, l.billing_model, l.per_call_fee FROM companies c
           LEFT JOIN licenses l ON l.company_code = c.company_code
           WHERE c.company_code = :c""",
        c=code,
    )
    if body.faq_id is not None:
        owned = rows(
            conn,
            "SELECT faq_id FROM faq_entries WHERE faq_id = :f AND company_code = :c",
            f=body.faq_id,
            c=code,
        )
        if not owned:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "FAQ が見つかりません")

    now = now_local()
    started = body.started_at or (now - timedelta(minutes=body.duration_minutes))
    ended = started + timedelta(minutes=body.duration_minutes)
    call_id = f"{code}-manual-{uuid.uuid4().hex[:12]}"

    conn.execute(
        insert(db.calls).values(
            call_id=call_id,
            tenant_code=company[0]["tenant_code"],
            company_code=code,
            started_at=iso(started),
            ended_at=iso(ended),
            escalated=int(body.outcome != "resolved"),
            primary_category_code=body.category_code,
            channel="manual",
        )
    )
    conn.execute(
        insert(db.manual_call_records).values(
            call_id=call_id,
            company_code=code,
            caller_question=body.caller_question.strip(),
            answer_given=body.answer_given.strip(),
            faq_id=body.faq_id,
            outcome=body.outcome,
            duration_sec=body.duration_minutes * 60,
            note=body.note,
            entered_by=p.uid,
            entered_at=iso(now),
        )
    )
    fee = company[0]["per_call_fee"]
    if company[0]["billing_model"] == "metered" and fee:
        conn.execute(
            insert(db.cost_usage_daily).values(
                company_code=code,
                usage_date=started.date().isoformat(),
                cost_type="通話処理料",
                unit="calls",
                amount=fee,
                currency="JPY",
            )
        )

    case_id = None
    if body.outcome != "resolved":
        # 解決しなかった通話は対応履歴（課題）に載せて引き継ぐ
        case_id = f"CASE-{started:%Y%m}-M{uuid.uuid4().hex[:6].upper()}"
        conn.execute(
            insert(db.support_cases).values(
                case_id=case_id,
                company_code=code,
                category_code=body.category_code,
                summary=body.caller_question.strip()[:200],
                status="in_progress",
                opened_at=iso(started),
            )
        )
        conn.execute(
            insert(db.case_handovers).values(
                case_id=case_id,
                handed_over_at=iso(now),
                from_owner=p.uid,
                to_owner="担当部署" if body.outcome == "escalated" else "折り返し担当",
                note=body.note or body.answer_given.strip()[:200],
            )
        )

    if body.not_in_faq:
        conn.execute(
            insert(db.unanswered_questions).values(
                company_code=code,
                call_id=call_id,
                question_text=body.caller_question.strip()[:300],
                timestamp=iso(started),
            )
        )

    return {"call_id": call_id, "case_id": case_id}


@router.get("")
def list_manual_calls(p: CallHandler, conn: Conn):
    """直近に入力された通話（自社分）。"""
    return rows(
        conn,
        """SELECT m.call_id, c.started_at, c.primary_category_code AS category_code,
                  m.caller_question, m.answer_given, m.outcome, m.duration_sec, m.faq_id,
                  m.entered_by
           FROM manual_call_records m JOIN calls c ON c.call_id = m.call_id
           WHERE m.company_code = :code ORDER BY m.entered_at DESC LIMIT 50""",
        code=p.company_code,
    )
