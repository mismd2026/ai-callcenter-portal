"""デモデータ（fixtures/demo.json）を生成する。

API の初期データ投入と、Web のデモモード（GitHub Pages）の両方がこのファイルを使う。
乱数のシードを固定しているので、何度実行しても同じ内容になる。

    python scripts/generate_fixture.py
"""

from __future__ import annotations

import json
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "fixtures" / "demo.json"
MONTHS = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]

rng = random.Random(20261103)

tenants = [
    {"tenant_code": "ACME", "tenant_name": "株式会社ACME", "created_at": "2025-12-01T00:00:00"},
    {"tenant_code": "MIDORI", "tenant_name": "みどりクリニックグループ", "created_at": "2026-03-15T00:00:00"},
]

companies = [
    {"company_code": "ACME-TOKYO", "tenant_code": "ACME", "company_name": "株式会社ACME 東京本社",
     "country_code": "JP", "created_at": "2026-01-10T00:00:00", "status": "active"},
    {"company_code": "ACME-OSAKA", "tenant_code": "ACME", "company_name": "株式会社ACME 大阪支店",
     "country_code": "JP", "created_at": "2026-04-01T00:00:00", "status": "active"},
    {"company_code": "MIDORI-MAIN", "tenant_code": "MIDORI", "company_name": "みどりクリニック 本院",
     "country_code": "JP", "created_at": "2026-05-01T00:00:00", "status": "active"},
]

plan_catalog = [
    {"plan_tier": "small", "plan_label": "最小プラン", "default_concurrent_limit": 10, "tier_group": "small"},
    {"plan_tier": "mid_take", "plan_label": "中間プラン（竹）", "default_concurrent_limit": 100, "tier_group": "mid"},
]

licenses = [
    {"company_code": "ACME-TOKYO", "plan_tier": "mid_take", "country_code": "JP", "currency": "JPY",
     "price_amount": 1000000, "concurrent_call_limit": 100, "valid_from": "2026-01-10", "status": "active"},
    {"company_code": "ACME-OSAKA", "plan_tier": "small", "country_code": "JP", "currency": "JPY",
     "price_amount": 120000, "concurrent_call_limit": 10, "valid_from": "2026-04-01", "status": "active"},
    {"company_code": "MIDORI-MAIN", "plan_tier": "small", "country_code": "JP", "currency": "JPY",
     "price_amount": 120000, "concurrent_call_limit": 10, "valid_from": "2026-05-01", "status": "active"},
]

roles = [
    {"role_code": "company_admin", "role_name": "契約管理者"},
    {"role_code": "viewer", "role_name": "閲覧者"},
]

users = [
    {"user_code": "u_tanaka", "tenant_code": "ACME", "company_code": "ACME-TOKYO",
     "display_name": "田中 一郎", "email": "tanaka@acme.example"},
    {"user_code": "u_suzuki", "tenant_code": "ACME", "company_code": "ACME-TOKYO",
     "display_name": "鈴木 花子", "email": "suzuki@acme.example"},
    {"user_code": "u_kato", "tenant_code": "ACME", "company_code": "ACME-OSAKA",
     "display_name": "加藤 健", "email": "kato@acme.example"},
    {"user_code": "u_mori", "tenant_code": "MIDORI", "company_code": "MIDORI-MAIN",
     "display_name": "森 さくら", "email": "mori@midori.example"},
]
for u in users:
    u["created_at"] = "2026-04-01T00:00:00"

user_roles = [
    {"user_code": "u_tanaka", "role_code": "company_admin", "company_code": "ACME-TOKYO"},
    {"user_code": "u_suzuki", "role_code": "viewer", "company_code": "ACME-TOKYO"},
    {"user_code": "u_kato", "role_code": "company_admin", "company_code": "ACME-OSAKA"},
    {"user_code": "u_mori", "role_code": "company_admin", "company_code": "MIDORI-MAIN"},
]

inquiry_categories = [
    {"category_code": "billing", "category_name": "料金・請求"},
    {"category_code": "usage", "category_name": "使い方"},
    {"category_code": "complaint", "category_name": "苦情"},
    {"category_code": "cancellation", "category_name": "解約"},
    {"category_code": "other", "category_name": "その他"},
]

STEP_LABELS = ["契約締結", "環境構築", "FAQ登録", "テスト運用", "本稼働開始", "運用最適化"]
onboarding_steps = []
progress = {"ACME-TOKYO": 5, "ACME-OSAKA": 4, "MIDORI-MAIN": 3}  # 何番目まで完了しているか
for c in companies:
    done = progress[c["company_code"]]
    for i, label in enumerate(STEP_LABELS, start=1):
        status = "done" if i <= done else ("current" if i == done + 1 else "upcoming")
        planned = f"2026-{min(4 + i, 12):02d}-01"
        onboarding_steps.append({
            "company_code": c["company_code"], "step_order": i, "step_label": label,
            "planned_date": planned, "actual_date": planned if status == "done" else None,
            "status": status,
        })

# 月ごとのコール数（問い合わせ種別ごと）。API はこれを通話レコードに展開して投入する
BASE_VOLUME = {"ACME-TOKYO": 2400, "ACME-OSAKA": 260, "MIDORI-MAIN": 180}
START_MONTH = {"ACME-TOKYO": "2026-05", "ACME-OSAKA": "2026-05", "MIDORI-MAIN": "2026-06"}
MIX = {"billing": 0.32, "usage": 0.38, "complaint": 0.08, "cancellation": 0.07, "other": 0.15}
call_volume = []
for code, base in BASE_VOLUME.items():
    for idx, month in enumerate(MONTHS):
        if month < START_MONTH[code]:
            continue
        total = int(base * (1 + 0.06 * idx) * rng.uniform(0.9, 1.1))
        for cat, share in MIX.items():
            call_volume.append({"company_code": code, "month": month, "category_code": cat,
                                "count": max(1, int(total * share * rng.uniform(0.8, 1.2)))})

# 「今」の状況（API は投入時点の日時で、通話中・本日のエスカレーション・本日の未回答を作る）
live = [
    {"company_code": "ACME-TOKYO", "active_calls": 74, "escalations_today": 12, "unanswered_today": 5},
    {"company_code": "ACME-OSAKA", "active_calls": 9, "escalations_today": 3, "unanswered_today": 2},
    {"company_code": "MIDORI-MAIN", "active_calls": 4, "escalations_today": 1, "unanswered_today": 0},
]

CASE_SUMMARIES = {
    "billing": ("請求額が先月より高いとの問い合わせ", "通話分数の増加が原因と説明済み。明細を送付"),
    "usage": ("FAQにない予約変更の質問が多い", "FAQ候補として登録し、承認待ち"),
    "complaint": ("待ち時間が長いという苦情", "ピーク時間帯の同時コール上限の見直しを提案"),
    "cancellation": ("一部部署の利用停止の相談", "契約管理者に確認中"),
    "other": ("音声が聞き取りにくいとの報告", "回線事業者に調査を依頼"),
}
support_cases, case_handovers = [], []
n = 1
for c in companies:
    for month in MONTHS:
        if month < START_MONTH[c["company_code"]]:
            continue
        for cat in rng.sample(list(CASE_SUMMARIES), k=2):
            case_id = f"CASE-{month.replace('-', '')}-{n:03d}"
            day = rng.randint(2, 25)
            resolved = month < MONTHS[-1] or rng.random() < 0.4
            summary, note = CASE_SUMMARIES[cat]
            support_cases.append({
                "case_id": case_id, "company_code": c["company_code"], "category_code": cat,
                "summary": summary, "status": "resolved" if resolved else "in_progress",
                "opened_at": f"{month}-{day:02d}T10:00:00",
                "resolved_at": f"{month}-{min(day + 3, 28):02d}T17:00:00" if resolved else None,
            })
            case_handovers.append({
                "case_id": case_id, "handed_over_at": f"{month}-{day:02d}T11:00:00",
                "from_owner": "primary-agent", "to_owner": "operator", "note": note,
            })
            n += 1

LOG_MESSAGES = {
    "operator": ["オペレーターが引き継ぎ通話に応答しました", "FAQ候補を1件承認しました",
                 "エスカレーションされた通話を対応完了にしました"],
    "incident": ["一部の通話で音声合成の遅延が発生しました（復旧済み）",
                 "メンテナンスのため 2:00〜2:30 に新規通話の受付を停止しました"],
    "server": ["call-router-03 の CPU 使用率が 85% を超えました", "API サーバーを再起動しました"],
    "network": ["SIP トランクの遅延が一時的に 200ms を超えました"],
}
system_logs = []
for c in companies:
    for month in MONTHS:
        if month < START_MONTH[c["company_code"]]:
            continue
        for log_type, messages in LOG_MESSAGES.items():
            for _ in range(2 if log_type == "operator" else 1):
                day, hour = rng.randint(1, 27), rng.randint(8, 20)
                system_logs.append({
                    "company_code": c["company_code"], "log_type": log_type,
                    "severity": "warning" if log_type in ("incident", "server") else "info",
                    "occurred_at": f"{month}-{day:02d}T{hour:02d}:{rng.randint(0, 59):02d}:00",
                    "source": "u_operator" if log_type == "operator" else "platform",
                    "message": rng.choice(messages),
                })

COST_TYPES = {"通話回線料": (0.08, "minutes"), "GPU利用料": (0.12, "hours"), "有人対応オプション": (0.05, "calls")}
cost_usage_daily, invoices = [], []
for lic in licenses:
    code = lic["company_code"]
    for month in MONTHS:
        if month < START_MONTH[code]:
            continue
        total = lic["price_amount"]
        for cost_type, (ratio, unit) in COST_TYPES.items():
            amount = round(lic["price_amount"] * ratio * rng.uniform(0.8, 1.3))
            total += amount
            cost_usage_daily.append({"company_code": code, "usage_date": f"{month}-28",
                                     "cost_type": cost_type, "amount": amount, "currency": "JPY",
                                     "unit": unit})
        y, m = map(int, month.split("-"))
        issued = f"{y + (m == 12)}-{m % 12 + 1:02d}-05"
        invoices.append({
            "invoice_id": f"INV-{code}-{month.replace('-', '')}", "company_code": code,
            "billing_period_start": f"{month}-01", "billing_period_end": f"{month}-28",
            "issued_date": issued, "due_date": issued[:8] + "25", "total_amount": total,
            "currency": "JPY", "status": "pending" if month == MONTHS[-1] else "paid",
        })

data = {
    "note": "デモ用の架空データです。scripts/generate_fixture.py で生成しています。",
    "months": MONTHS,
    "tenants": tenants, "companies": companies, "plan_catalog": plan_catalog, "licenses": licenses,
    "roles": roles, "users": users, "user_roles": user_roles,
    "inquiry_categories": inquiry_categories, "onboarding_steps": onboarding_steps,
    "call_volume": call_volume, "live": live,
    "support_cases": support_cases, "case_handovers": case_handovers,
    "system_logs": system_logs, "cost_usage_daily": cost_usage_daily, "invoices": invoices,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"wrote {OUT}")
