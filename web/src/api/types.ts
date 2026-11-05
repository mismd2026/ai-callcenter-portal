// API（api/app/main.py）のレスポンスの型

export type Role = 'company_admin' | 'operator' | 'viewer' | 'ops_admin';

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
  billing_model: BillingModel | null;
  per_call_fee: number | null;
}

/** subscription: 月額定額（既定） / metered: 従量課金（通話ごとに per_call_fee） */
export type BillingModel = 'subscription' | 'metered';

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
  subtotal: number;
  credit_applied: number; // クレジットで相殺した額
  credit_balance: number; // その月の終わり時点の残高
  total: number; // subtotal - credit_applied
  currency: string;
  invoice: {
    invoice_id: string;
    issued_date: string;
    due_date: string;
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
  credit_balance: number;
  billing_model: BillingModel | null;
  per_call_fee: number | null;
}

export interface OpsUser {
  user_code: string;
  display_name: string;
  company_code: string;
  role_name: string;
}

export interface Category {
  category_code: string;
  category_name: string;
}

export type FaqStatus = 'draft' | 'published';

export interface Faq {
  faq_id: number;
  category_code: string;
  category_name: string;
  questions: string[];
  answer_text: string;
  status: FaqStatus;
  source: 'manual' | 'csv' | 'unanswered';
  updated_at: string;
  updated_by: string | null;
  score?: number; // 検索結果のみ
}

export interface FaqInput {
  category_code: string;
  questions: string[];
  answer_text: string;
  status: FaqStatus;
}

export interface CsvImportResult {
  valid: number;
  imported: number;
  errors: { row: number; message: string }[];
  preview: FaqInput[];
}

export type UnansweredStatus = 'open' | 'promoted' | 'dismissed';

export interface Unanswered {
  id: number;
  question_text: string;
  timestamp: string;
  status: UnansweredStatus;
  reviewed_at: string | null;
  promoted_faq_id: number | null;
}

export interface ResponseSettings {
  greeting: string;
  business_hours_start: string;
  business_hours_end: string;
  business_days: number[]; // 1=月 … 7=日
  after_hours_message: string;
  escalation_keywords: string[];
  max_ai_turns: number;
  updated_at?: string | null;
  updated_by?: string | null;
}

export type CallOutcome = 'resolved' | 'escalated' | 'callback';

export interface ManualCallInput {
  category_code: string;
  caller_question: string;
  answer_given: string;
  faq_id: number | null;
  outcome: CallOutcome;
  duration_minutes: number;
  note: string | null;
  not_in_faq: boolean;
}

export interface ManualCall {
  call_id: string;
  started_at: string;
  category_code: string;
  caller_question: string;
  answer_given: string;
  outcome: CallOutcome;
  duration_sec: number;
  faq_id: number | null;
  entered_by: string;
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
  categories(): Promise<Category[]>;
  // CMS（契約管理者）
  faqs(status?: FaqStatus): Promise<Faq[]>;
  createFaq(input: FaqInput): Promise<Faq>;
  updateFaq(id: number, input: FaqInput): Promise<Faq>;
  setFaqStatus(id: number, status: FaqStatus): Promise<Faq>;
  deleteFaq(id: number): Promise<void>;
  importFaqs(csv: string, dryRun: boolean): Promise<CsvImportResult>;
  unanswered(status: UnansweredStatus): Promise<Unanswered[]>;
  promoteUnanswered(id: number, input: FaqInput): Promise<Faq>;
  dismissUnanswered(id: number): Promise<void>;
  settings(): Promise<ResponseSettings>;
  saveSettings(input: ResponseSettings): Promise<ResponseSettings>;
  // 通話入力（契約管理者・オペレーター）
  searchFaqs(q: string): Promise<Faq[]>;
  createManualCall(input: ManualCallInput): Promise<{ call_id: string; case_id: string | null }>;
  manualCalls(): Promise<ManualCall[]>;
  // 運用管理者
  opsTenants(): Promise<Tenant[]>;
  opsCompanies(tenantCode: string): Promise<OpsCompany[]>;
  opsUsers(tenantCode: string): Promise<OpsUser[]>;
  opsGrantCredit(
    companyCode: string,
    input: { amount: number; reason: string; expires_at: string | null },
  ): Promise<{ credit_balance: number }>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
