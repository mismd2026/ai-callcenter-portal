"""テーブル定義。

phase2-core の SQLite スキーマのうち、ポータルが使うテーブルを移植したもの。
SQLAlchemy で定義しているので、SQLite（ローカル・テスト）と PostgreSQL（本番）の両方で動く。
日時は元の設計どおり ISO 8601 の文字列で持つ。
"""

from __future__ import annotations

from sqlalchemy import (
    Column,
    Float,
    ForeignKey,
    Integer,
    MetaData,
    Table,
    Text,
    UniqueConstraint,
    create_engine,
)
from sqlalchemy.engine import Engine

metadata = MetaData()

tenants = Table(
    "tenants",
    metadata,
    Column("tenant_code", Text, primary_key=True),
    Column("tenant_name", Text, nullable=False),
    Column("created_at", Text, nullable=False),
    Column("status", Text, server_default="active"),
)

companies = Table(
    "companies",
    metadata,
    Column("company_code", Text, primary_key=True),
    Column("tenant_code", Text, ForeignKey("tenants.tenant_code"), nullable=False),
    Column("company_name", Text, nullable=False),
    Column("country_code", Text, nullable=False),
    Column("created_at", Text, nullable=False),
    Column("status", Text, server_default="active"),
)

users = Table(
    "users",
    metadata,
    Column("user_code", Text, primary_key=True),
    Column("tenant_code", Text, ForeignKey("tenants.tenant_code"), nullable=False),
    Column("company_code", Text, ForeignKey("companies.company_code"), nullable=False),
    Column("display_name", Text, nullable=False),
    Column("email", Text, nullable=False, unique=True),
    Column("created_at", Text, nullable=False),
    Column("status", Text, server_default="active"),
)

roles = Table(
    "roles",
    metadata,
    Column("role_code", Text, primary_key=True),
    Column("role_name", Text, nullable=False),
)

user_roles = Table(
    "user_roles",
    metadata,
    Column("user_code", Text, ForeignKey("users.user_code"), primary_key=True),
    Column("role_code", Text, ForeignKey("roles.role_code"), primary_key=True),
    Column("company_code", Text, ForeignKey("companies.company_code"), primary_key=True),
)

plan_catalog = Table(
    "plan_catalog",
    metadata,
    Column("plan_tier", Text, primary_key=True),
    Column("plan_label", Text, nullable=False),
    Column("default_concurrent_limit", Integer, nullable=False),
    Column("tier_group", Text, nullable=False),
)

licenses = Table(
    "licenses",
    metadata,
    Column("license_id", Integer, primary_key=True, autoincrement=True),
    Column("company_code", Text, ForeignKey("companies.company_code"), nullable=False),
    Column("plan_tier", Text, ForeignKey("plan_catalog.plan_tier"), nullable=False),
    Column("country_code", Text, nullable=False),
    Column("currency", Text, nullable=False),
    Column("price_amount", Float, nullable=False),
    Column("concurrent_call_limit", Integer, nullable=False),
    # subscription: 月額定額（既定） / metered: 従量課金（通話ごとに per_call_fee を加算）
    Column("billing_model", Text, nullable=False, server_default="subscription"),
    Column("per_call_fee", Float),
    Column("valid_from", Text, nullable=False),
    Column("valid_until", Text),
    Column("status", Text, server_default="active"),
    UniqueConstraint("company_code"),
)

onboarding_steps = Table(
    "onboarding_steps",
    metadata,
    Column("step_id", Integer, primary_key=True, autoincrement=True),
    Column("company_code", Text, ForeignKey("companies.company_code"), nullable=False),
    Column("step_order", Integer, nullable=False),
    Column("step_label", Text, nullable=False),
    Column("planned_date", Text),
    Column("actual_date", Text),
    Column("status", Text, server_default="upcoming"),
)

cancellation_requests = Table(
    "cancellation_requests",
    metadata,
    Column("request_id", Integer, primary_key=True, autoincrement=True),
    Column("company_code", Text, ForeignKey("companies.company_code"), nullable=False),
    Column("requested_at", Text, nullable=False),
    Column("requested_by", Text),  # Firebase の uid（監査用）
    Column("reason", Text),
    Column("status", Text, server_default="pending"),
)

inquiry_categories = Table(
    "inquiry_categories",
    metadata,
    Column("category_code", Text, primary_key=True),
    Column("category_name", Text, nullable=False),
)

calls = Table(
    "calls",
    metadata,
    Column("call_id", Text, primary_key=True),
    Column("tenant_code", Text, ForeignKey("tenants.tenant_code"), nullable=False),
    Column("company_code", Text, ForeignKey("companies.company_code"), nullable=False, index=True),
    Column("started_at", Text, nullable=False, index=True),
    Column("ended_at", Text),
    Column("escalated", Integer, server_default="0"),
    Column("primary_category_code", Text, ForeignKey("inquiry_categories.category_code")),
    Column("channel", Text, server_default="ai"),  # ai / manual（人が受けて入力した通話）
)

escalations = Table(
    "escalations",
    metadata,
    Column("escalation_id", Integer, primary_key=True, autoincrement=True),
    Column("call_id", Text, ForeignKey("calls.call_id"), nullable=False),
    Column("reason", Text, nullable=False),
    Column("timestamp", Text, nullable=False),
)

unanswered_questions = Table(
    "unanswered_questions",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("company_code", Text, ForeignKey("companies.company_code"), nullable=False, index=True),
    Column("call_id", Text, ForeignKey("calls.call_id")),
    Column("question_text", Text, nullable=False),
    Column("timestamp", Text, nullable=False),
    Column("status", Text, server_default="open"),  # open / promoted / dismissed
    Column("reviewed_by", Text),
    Column("reviewed_at", Text),
    Column("promoted_faq_id", Integer),
)

cost_usage_daily = Table(
    "cost_usage_daily",
    metadata,
    Column("usage_id", Integer, primary_key=True, autoincrement=True),
    Column("company_code", Text, ForeignKey("companies.company_code"), nullable=False),
    Column("usage_date", Text, nullable=False),
    Column("cost_type", Text, nullable=False),
    Column("unit", Text),
    Column("amount", Float, nullable=False),
    Column("currency", Text, nullable=False),
)

invoices = Table(
    "invoices",
    metadata,
    Column("invoice_id", Text, primary_key=True),
    Column("company_code", Text, ForeignKey("companies.company_code"), nullable=False),
    Column("billing_period_start", Text, nullable=False),
    Column("billing_period_end", Text, nullable=False),
    Column("issued_date", Text, nullable=False),
    Column("due_date", Text, nullable=False),
    Column("total_amount", Float, nullable=False),
    Column("currency", Text, nullable=False),
    Column("status", Text, server_default="pending"),
)

support_cases = Table(
    "support_cases",
    metadata,
    Column("case_id", Text, primary_key=True),
    Column("company_code", Text, ForeignKey("companies.company_code"), nullable=False),
    Column("category_code", Text, ForeignKey("inquiry_categories.category_code")),
    Column("summary", Text, nullable=False),
    Column("status", Text, server_default="open"),
    Column("opened_at", Text, nullable=False),
    Column("resolved_at", Text),
)

case_handovers = Table(
    "case_handovers",
    metadata,
    Column("handover_id", Integer, primary_key=True, autoincrement=True),
    Column("case_id", Text, ForeignKey("support_cases.case_id"), nullable=False),
    Column("handed_over_at", Text, nullable=False),
    Column("from_owner", Text),
    Column("to_owner", Text),
    Column("note", Text),
)

system_logs = Table(
    "system_logs",
    metadata,
    Column("log_id", Integer, primary_key=True, autoincrement=True),
    Column("company_code", Text, ForeignKey("companies.company_code")),
    Column("log_type", Text, nullable=False),  # operator / incident / server / network
    Column("severity", Text, server_default="info"),
    Column("occurred_at", Text, nullable=False),
    Column("source", Text),
    Column("message", Text, nullable=False),
)


# ---- CMS（顧客の契約管理者が編集する） ----

faq_entries = Table(
    "faq_entries",
    metadata,
    Column("faq_id", Integer, primary_key=True, autoincrement=True),
    Column("company_code", Text, ForeignKey("companies.company_code"), nullable=False, index=True),
    Column("category_code", Text, ForeignKey("inquiry_categories.category_code"), nullable=False),
    Column("answer_text", Text, nullable=False),
    Column("status", Text, nullable=False, server_default="draft"),  # draft / published
    Column("source", Text, server_default="manual"),  # manual / csv / unanswered
    Column("updated_at", Text, nullable=False),
    Column("updated_by", Text),
)

# 1つの回答に対して、質問の言い換えを複数持てる（phase2-core の faq_questions と同じ考え方）
faq_questions = Table(
    "faq_questions",
    metadata,
    Column("question_id", Integer, primary_key=True, autoincrement=True),
    Column(
        "faq_id",
        Integer,
        ForeignKey("faq_entries.faq_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    ),
    Column("question_text", Text, nullable=False),
)

response_settings = Table(
    "response_settings",
    metadata,
    Column("company_code", Text, ForeignKey("companies.company_code"), primary_key=True),
    Column("greeting", Text, nullable=False),
    Column("business_hours_start", Text, nullable=False),  # HH:MM
    Column("business_hours_end", Text, nullable=False),
    Column("business_days", Text, nullable=False),  # JSON 配列（1=月 … 7=日）
    Column("after_hours_message", Text, nullable=False),
    Column("escalation_keywords", Text, nullable=False),  # JSON 配列
    Column("max_ai_turns", Integer, nullable=False),
    Column("updated_at", Text),
    Column("updated_by", Text),
)

# 人が電話を受けて入力した通話の内容（calls の channel='manual' と 1対1）
manual_call_records = Table(
    "manual_call_records",
    metadata,
    Column("call_id", Text, ForeignKey("calls.call_id"), primary_key=True),
    Column("company_code", Text, ForeignKey("companies.company_code"), nullable=False, index=True),
    Column("caller_question", Text, nullable=False),
    Column("answer_given", Text, nullable=False),
    Column("faq_id", Integer, ForeignKey("faq_entries.faq_id", ondelete="SET NULL")),
    Column("outcome", Text, nullable=False),  # resolved / escalated / callback
    Column("duration_sec", Integer, nullable=False),
    Column("note", Text),
    Column("entered_by", Text, nullable=False),
    Column("entered_at", Text, nullable=False),
)

# クレジット（従量料金と相殺する）
credits = Table(
    "credits",
    metadata,
    Column("credit_id", Integer, primary_key=True, autoincrement=True),
    Column("company_code", Text, ForeignKey("companies.company_code"), nullable=False, index=True),
    Column("amount", Float, nullable=False),
    Column("reason", Text, nullable=False),
    Column("granted_at", Text, nullable=False),  # YYYY-MM-DD
    Column("expires_at", Text),  # YYYY-MM-DD（なしなら無期限）
    Column("granted_by", Text),
)


def make_engine(url: str) -> Engine:
    kwargs = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)
