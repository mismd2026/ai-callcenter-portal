"""fixtures/demo.json の内容を DB に投入する（テーブルが空のときだけ）。"""

from __future__ import annotations

import json
import random
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import func, insert, select
from sqlalchemy.engine import Engine

from . import db

# fixtures のキー → テーブル（外部キーの順に並べる）
_DIRECT = [
    ("tenants", db.tenants),
    ("companies", db.companies),
    ("roles", db.roles),
    ("users", db.users),
    ("user_roles", db.user_roles),
    ("plan_catalog", db.plan_catalog),
    ("licenses", db.licenses),
    ("inquiry_categories", db.inquiry_categories),
    ("onboarding_steps", db.onboarding_steps),
    ("support_cases", db.support_cases),
    ("case_handovers", db.case_handovers),
    ("system_logs", db.system_logs),
    ("cost_usage_daily", db.cost_usage_daily),
    ("invoices", db.invoices),
]


def _rows(table, items):
    cols = set(table.c.keys())
    return [{k: v for k, v in item.items() if k in cols} for item in items]


def seed_if_empty(engine: Engine, fixture_path: Path, now: datetime | None = None) -> bool:
    db.metadata.create_all(engine)
    with engine.begin() as conn:
        if conn.execute(select(func.count()).select_from(db.tenants)).scalar():
            return False

        data = json.loads(fixture_path.read_text(encoding="utf-8"))
        for key, table in _DIRECT:
            if data.get(key):
                conn.execute(insert(table), _rows(table, data[key]))

        tenant_of = {c["company_code"]: c["tenant_code"] for c in data["companies"]}
        rng = random.Random(42)

        # 月ごとのコール数を通話レコードに展開する
        call_rows = []
        for v in data["call_volume"]:
            for i in range(v["count"]):
                day, hour, minute = rng.randint(1, 28), rng.randint(8, 20), rng.randint(0, 59)
                started = f"{v['month']}-{day:02d}T{hour:02d}:{minute:02d}:00"
                call_rows.append(
                    {
                        "call_id": f"{v['company_code']}-{v['month']}-{v['category_code']}-{i}",
                        "tenant_code": tenant_of[v["company_code"]],
                        "company_code": v["company_code"],
                        "started_at": started,
                        "ended_at": started,
                        "escalated": 0,
                        "primary_category_code": v["category_code"],
                    }
                )
        conn.execute(insert(db.calls), call_rows)

        # 「今」の状況：通話中のコール、本日のエスカレーション・未回答
        now = now or datetime.now()
        stamp = (now - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%S")
        live_calls, esc_rows, unanswered_rows = [], [], []
        for live in data["live"]:
            code = live["company_code"]
            for i in range(live["active_calls"]):
                live_calls.append(
                    {
                        "call_id": f"{code}-live-{i}",
                        "tenant_code": tenant_of[code],
                        "company_code": code,
                        "started_at": stamp,
                        "ended_at": None,
                        "escalated": int(i < live["escalations_today"]),
                        "primary_category_code": "usage",
                    }
                )
            esc_rows += [
                {"call_id": f"{code}-live-{i}", "reason": "有人対応の希望", "timestamp": stamp}
                for i in range(live["escalations_today"])
            ]
            unanswered_rows += [
                {
                    "call_id": f"{code}-live-{i}",
                    "question_text": "FAQにない質問",
                    "timestamp": stamp,
                }
                for i in range(live["unanswered_today"])
            ]
        conn.execute(insert(db.calls), live_calls)
        if esc_rows:
            conn.execute(insert(db.escalations), esc_rows)
        if unanswered_rows:
            conn.execute(insert(db.unanswered_questions), unanswered_rows)
    return True
