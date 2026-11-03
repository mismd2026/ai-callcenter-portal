"""CMS：FAQ・未回答質問のレビュー・応答設定。編集は契約管理者だけ。"""

import csv
import io
import json
import re
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, insert, update
from sqlalchemy.engine import Connection

from .. import db
from ..auth import Principal
from ..clock import iso, now_local
from ..deps import CallHandler, CompanyAdmin, Conn, Tx, one_or_404, rows
from ..similarity import score

router = APIRouter(prefix="/api/company")

CATEGORY_CODES = {"billing", "usage", "complaint", "cancellation", "other"}
MAX_QUESTIONS = 20


def _load_faqs(
    conn: Connection, company_code: str, faq_ids: list[int] | None = None, status_filter=None
):
    sql = """SELECT f.faq_id, f.category_code, ic.category_name, f.answer_text, f.status, f.source,
                    f.updated_at, f.updated_by
             FROM faq_entries f JOIN inquiry_categories ic ON ic.category_code = f.category_code
             WHERE f.company_code = :code"""
    params: dict = {"code": company_code}
    if status_filter:
        sql += " AND f.status = :status"
        params["status"] = status_filter
    sql += " ORDER BY f.category_code, f.faq_id"
    faqs = rows(conn, sql, **params)
    if faq_ids is not None:
        faqs = [f for f in faqs if f["faq_id"] in faq_ids]
    questions = rows(
        conn,
        """SELECT q.faq_id, q.question_text FROM faq_questions q
           JOIN faq_entries f ON f.faq_id = q.faq_id
           WHERE f.company_code = :code ORDER BY q.question_id""",
        code=company_code,
    )
    by_faq: dict[int, list[str]] = {}
    for q in questions:
        by_faq.setdefault(q["faq_id"], []).append(q["question_text"])
    for f in faqs:
        f["questions"] = by_faq.get(f["faq_id"], [])
    return faqs


def _get_faq(conn: Connection, company_code: str, faq_id: int) -> dict:
    found = _load_faqs(conn, company_code, [faq_id])
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "FAQ が見つかりません")
    return found[0]


class FaqIn(BaseModel):
    category_code: str
    questions: list[Annotated[str, Field(min_length=1, max_length=300)]] = Field(
        min_length=1, max_length=MAX_QUESTIONS
    )
    answer_text: str = Field(min_length=1, max_length=2000)
    status: Literal["draft", "published"] = "draft"

    @field_validator("category_code")
    @classmethod
    def known_category(cls, v: str) -> str:
        if v not in CATEGORY_CODES:
            raise ValueError("不明な問い合わせ種別です")
        return v

    @field_validator("questions")
    @classmethod
    def clean_questions(cls, v: list[str]) -> list[str]:
        cleaned = list(dict.fromkeys(q.strip() for q in v if q.strip()))
        if not cleaned:
            raise ValueError("質問を1つ以上入力してください")
        return cleaned


def _insert_faq(conn: Connection, p: Principal, body: FaqIn, source: str) -> int:
    faq_id = conn.execute(
        insert(db.faq_entries).values(
            company_code=p.company_code,
            category_code=body.category_code,
            answer_text=body.answer_text.strip(),
            status=body.status,
            source=source,
            updated_at=iso(now_local()),
            updated_by=p.uid,
        )
    ).inserted_primary_key[0]
    conn.execute(
        insert(db.faq_questions), [{"faq_id": faq_id, "question_text": q} for q in body.questions]
    )
    return faq_id


# ---- FAQ ----


@router.get("/faqs")
def list_faqs(
    p: CompanyAdmin,
    conn: Conn,
    status_filter: Annotated[Literal["draft", "published"] | None, Query(alias="status")] = None,
):
    return _load_faqs(conn, p.company_code, status_filter=status_filter)


@router.get("/faqs/search")
def search_faqs(p: CallHandler, conn: Conn, q: Annotated[str, Query(min_length=1, max_length=300)]):
    """通話中のオペレーターが回答を探すための検索。公開済みの FAQ だけを対象にする。"""
    results = []
    for f in _load_faqs(conn, p.company_code, status_filter="published"):
        best = max((score(q, text) for text in f["questions"]), default=0.0)
        if best >= 0.15:
            results.append({**f, "score": round(best, 2)})
    return sorted(results, key=lambda r: -r["score"])[:5]


@router.post("/faqs", status_code=status.HTTP_201_CREATED)
def create_faq(body: FaqIn, p: CompanyAdmin, conn: Tx):
    faq_id = _insert_faq(conn, p, body, "manual")
    return _get_faq(conn, p.company_code, faq_id)


@router.put("/faqs/{faq_id}")
def update_faq(faq_id: int, body: FaqIn, p: CompanyAdmin, conn: Tx):
    _get_faq(conn, p.company_code, faq_id)  # 他社の FAQ なら 404
    conn.execute(
        update(db.faq_entries)
        .where(db.faq_entries.c.faq_id == faq_id)
        .values(
            category_code=body.category_code,
            answer_text=body.answer_text.strip(),
            status=body.status,
            updated_at=iso(now_local()),
            updated_by=p.uid,
        )
    )
    conn.execute(delete(db.faq_questions).where(db.faq_questions.c.faq_id == faq_id))
    conn.execute(
        insert(db.faq_questions), [{"faq_id": faq_id, "question_text": q} for q in body.questions]
    )
    return _get_faq(conn, p.company_code, faq_id)


class StatusIn(BaseModel):
    status: Literal["draft", "published"]


@router.post("/faqs/{faq_id}/status")
def set_faq_status(faq_id: int, body: StatusIn, p: CompanyAdmin, conn: Tx):
    _get_faq(conn, p.company_code, faq_id)
    conn.execute(
        update(db.faq_entries)
        .where(db.faq_entries.c.faq_id == faq_id)
        .values(status=body.status, updated_at=iso(now_local()), updated_by=p.uid)
    )
    return _get_faq(conn, p.company_code, faq_id)


@router.delete("/faqs/{faq_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_faq(faq_id: int, p: CompanyAdmin, conn: Tx):
    _get_faq(conn, p.company_code, faq_id)
    conn.execute(
        update(db.manual_call_records)
        .where(db.manual_call_records.c.faq_id == faq_id)
        .values(faq_id=None)
    )
    conn.execute(delete(db.faq_questions).where(db.faq_questions.c.faq_id == faq_id))
    conn.execute(delete(db.faq_entries).where(db.faq_entries.c.faq_id == faq_id))


# ---- CSV 取り込み ----

CATEGORY_ALIASES = {
    "billing": "billing", "料金": "billing", "料金・請求": "billing", "請求": "billing",
    "支払い": "billing", "usage": "usage", "使い方": "usage", "利用方法": "usage",
    "complaint": "complaint", "苦情": "complaint", "cancellation": "cancellation",
    "解約": "cancellation", "契約": "cancellation", "other": "other", "その他": "other",
}  # fmt: skip
MAX_CSV_BYTES = 512 * 1024
MAX_CSV_ROWS = 1000


class CsvImportIn(BaseModel):
    csv: str = Field(max_length=MAX_CSV_BYTES)
    dry_run: bool = True


def parse_faq_csv(text: str) -> tuple[list[FaqIn], list[dict]]:
    """列：category, question, answer。question は「|」区切りで言い換えを複数書ける。"""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    headers = {h.strip().lower() for h in (reader.fieldnames or [])}
    if not {"category", "question", "answer"} <= headers:
        return [], [{"row": 1, "message": "1行目に category, question, answer の列が必要です"}]
    items, errors = [], []
    for i, raw in enumerate(reader, start=2):
        if i - 1 > MAX_CSV_ROWS:
            errors.append({"row": i, "message": f"一度に取り込めるのは {MAX_CSV_ROWS} 件までです"})
            break
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
        category = CATEGORY_ALIASES.get(row.get("category", "").lower())
        if category is None:
            errors.append(
                {"row": i, "message": f"問い合わせ種別「{row.get('category')}」は使えません"}
            )
            continue
        try:
            items.append(
                FaqIn(
                    category_code=category,
                    questions=re.split(r"\s*\|\s*", row.get("question", "")),
                    answer_text=row.get("answer", ""),
                    status="draft",
                )
            )
        except ValueError:
            errors.append({"row": i, "message": "質問または回答が空か、長すぎます"})
    return items, errors


@router.post("/faqs/import")
def import_faqs(body: CsvImportIn, p: CompanyAdmin, conn: Tx):
    """CSV の FAQ を下書きとして取り込む。dry_run=true なら検証結果だけを返す。"""
    items, errors = parse_faq_csv(body.csv)
    if not body.dry_run and not errors:
        for item in items:
            _insert_faq(conn, p, item, "csv")
    return {
        "valid": len(items),
        "errors": errors,
        "imported": 0 if body.dry_run or errors else len(items),
        "preview": [i.model_dump() for i in items[:5]],
    }


# ---- 未回答質問のレビュー ----


@router.get("/unanswered")
def list_unanswered(
    p: CompanyAdmin,
    conn: Conn,
    status_filter: Annotated[
        Literal["open", "promoted", "dismissed"], Query(alias="status")
    ] = "open",
):
    return rows(
        conn,
        """SELECT id, question_text, timestamp, status, reviewed_at, promoted_faq_id
           FROM unanswered_questions WHERE company_code = :code AND status = :status
           ORDER BY timestamp DESC LIMIT 200""",
        code=p.company_code,
        status=status_filter,
    )


def _open_unanswered(conn: Connection, company_code: str, item_id: int) -> dict:
    item = one_or_404(
        conn,
        "SELECT id, status FROM unanswered_questions WHERE id = :id AND company_code = :code",
        "質問が見つかりません",
        id=item_id,
        code=company_code,
    )
    if item["status"] != "open":
        raise HTTPException(status.HTTP_409_CONFLICT, "この質問はすでにレビュー済みです")
    return item


@router.post("/unanswered/{item_id}/promote", status_code=status.HTTP_201_CREATED)
def promote_unanswered(item_id: int, body: FaqIn, p: CompanyAdmin, conn: Tx):
    """未回答の質問から FAQ を作る。"""
    _open_unanswered(conn, p.company_code, item_id)
    faq_id = _insert_faq(conn, p, body, "unanswered")
    conn.execute(
        update(db.unanswered_questions)
        .where(db.unanswered_questions.c.id == item_id)
        .values(status="promoted", reviewed_by=p.uid, reviewed_at=iso(now_local()),
                promoted_faq_id=faq_id)
    )  # fmt: skip
    return _get_faq(conn, p.company_code, faq_id)


@router.post("/unanswered/{item_id}/dismiss")
def dismiss_unanswered(item_id: int, p: CompanyAdmin, conn: Tx):
    _open_unanswered(conn, p.company_code, item_id)
    conn.execute(
        update(db.unanswered_questions)
        .where(db.unanswered_questions.c.id == item_id)
        .values(status="dismissed", reviewed_by=p.uid, reviewed_at=iso(now_local()))
    )
    return {"status": "dismissed"}


# ---- 応答設定 ----

TIME = r"^([01]\d|2[0-3]):[0-5]\d$"


class SettingsIn(BaseModel):
    greeting: str = Field(min_length=1, max_length=300)
    business_hours_start: str = Field(pattern=TIME)
    business_hours_end: str = Field(pattern=TIME)
    business_days: list[Annotated[int, Field(ge=1, le=7)]] = Field(min_length=1, max_length=7)
    after_hours_message: str = Field(min_length=1, max_length=300)
    escalation_keywords: list[Annotated[str, Field(min_length=1, max_length=30)]] = Field(
        max_length=50
    )
    max_ai_turns: int = Field(ge=1, le=10)

    @field_validator("business_hours_end")
    @classmethod
    def end_after_start(cls, v: str, info) -> str:
        start = info.data.get("business_hours_start")
        if start and v <= start:
            raise ValueError("終了時刻は開始時刻より後にしてください")
        return v

    @field_validator("business_days", "escalation_keywords")
    @classmethod
    def unique(cls, v: list) -> list:
        return sorted(set(v)) if v and isinstance(v[0], int) else list(dict.fromkeys(v))


def _settings_out(row: dict) -> dict:
    return {
        **row,
        "business_days": json.loads(row["business_days"]),
        "escalation_keywords": json.loads(row["escalation_keywords"]),
    }


@router.get("/settings")
def get_settings(p: CompanyAdmin, conn: Conn):
    row = one_or_404(
        conn,
        "SELECT * FROM response_settings WHERE company_code = :code",
        "応答設定がまだありません",
        code=p.company_code,
    )
    return _settings_out(row)


@router.put("/settings")
def put_settings(body: SettingsIn, p: CompanyAdmin, conn: Tx):
    values = {
        **body.model_dump(),
        "business_days": json.dumps(body.business_days),
        "escalation_keywords": json.dumps(body.escalation_keywords, ensure_ascii=False),
        "updated_at": iso(now_local()),
        "updated_by": p.uid,
    }
    exists = rows(
        conn, "SELECT 1 AS x FROM response_settings WHERE company_code = :code", code=p.company_code
    )
    if exists:
        conn.execute(
            update(db.response_settings)
            .where(db.response_settings.c.company_code == p.company_code)
            .values(**values)
        )
    else:
        conn.execute(insert(db.response_settings).values(company_code=p.company_code, **values))
    return get_settings(p, conn)
