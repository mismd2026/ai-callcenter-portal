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
    Column("call_id", Text, ForeignKey("calls.call_id"), nullable=False),
    Column("question_text", Text, nullable=False),
    Column("timestamp", Text, nullable=False),
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


def make_engine(url: str) -> Engine:
    kwargs = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)
