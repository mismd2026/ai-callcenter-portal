// API（api/app/main.py）のレスポンスの型

export type Role = 'company_admin' | 'viewer' | 'ops_admin';

export interface Me {
  uid: string;
  email: string | null;
  role: Role;
  company_code: string | null;
}

export interface Company {
  company_code: string;
  company_name: string;
  country_code: string;
  status: string;
  created_at: string;
  plan_tier: string | null;
  plan_label: string | null;
  concurrent_call_limit: number | null;
}

export interface OnboardingStep {
  step_id: number;
  step_order: number;
  step_label: string;
  planned_date: string | null;
  actual_date: string | null;
  status: 'done' | 'current' | 'upcoming';
}

export interface MonthlyCalls {
  period: string; // YYYY-MM
  calls: number;
}

export interface InquiryShare {
  category_code: string;
  name: string;
  count: number;
  percent: number;
}

export interface SupportCase {
  case_id: string;
  category_code: string | null;
  category_name: string | null;
  summary: string;
  status: string;
  opened_at: string;
  resolved_at: string | null;
  latest_handover: string | null;
}

export type CustomerLogType = 'operator' | 'incident';

export interface LogEntry {
  log_id: number;
  log_type: string;
  severity: string;
  occurred_at: string;
  message: string;
}

export interface Billing {
  breakdown: { label: string; amount: number }[];
  total: number;
  currency: string;
  invoice: {
    invoice_id: string;
    issued_date: string;
    due_date: string;
    total_amount: number;
    currency: string;
    status: string;
  } | null;
}

export interface Tenant {
  tenant_code: string;
  tenant_name: string;
}

export interface OpsCompany {
  company_code: string;
  company_name: string;
  country_code: string;
  currency: string | null;
  price_amount: number | null;
  concurrent_call_limit: number | null;
  plan_label: string | null;
  active_calls: number;
  escalations_today: number;
  unanswered_today: number;
}

export interface OpsUser {
  user_code: string;
  display_name: string;
  company_code: string;
  role_name: string;
}

/** 画面が使う操作の一覧。本番（HTTP）とデモ（モックデータ）で同じ形にしている。 */
export interface PortalApi {
  me(): Promise<Me>;
  company(): Promise<Company>;
  periods(): Promise<string[]>;
  onboarding(): Promise<OnboardingStep[]>;
  monthlyCalls(): Promise<MonthlyCalls[]>;
  inquiryBreakdown(period: string): Promise<InquiryShare[]>;
  cases(period: string): Promise<SupportCase[]>;
  logs(type: CustomerLogType, period: string): Promise<LogEntry[]>;
  billing(period: string): Promise<Billing>;
  requestCancellation(reason: string): Promise<void>;
  opsTenants(): Promise<Tenant[]>;
  opsCompanies(tenantCode: string): Promise<OpsCompany[]>;
  opsUsers(tenantCode: string): Promise<OpsUser[]>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
