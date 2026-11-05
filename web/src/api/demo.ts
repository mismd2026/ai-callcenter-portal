/**
 * デモ用。fixtures/demo.json を使い、API と同じ集計・認可をブラウザ内で行う。
 * GitHub Pages のように API がない場所でも画面を確認できるようにするためのもの。
 * 入力した内容（FAQ・通話など）はページを開いている間だけ保持し、ユーザーを切り替えても共有する
 * （オペレーターが入力した未回答の質問を、契約管理者がレビューする流れを試せるように）。
 */
import fixture from '../../../fixtures/demo.json';
import { applyCredits, type CreditGrant } from '../lib/credits';
import { score } from '../lib/similarity';
import type { DemoIdentity } from './demoIdentities';
import {
  ApiError,
  type Billing,
  type Company,
  type CsvImportResult,
  type Faq,
  type FaqInput,
  type ManualCall,
  type Me,
  type OnboardingStep,
  type OpsCompany,
  type PortalApi,
  type ResponseSettings,
  type SupportCase,
  type Unanswered,
} from './types';

type Fixture = typeof fixture;

const CATEGORY_CODES = ['billing', 'usage', 'complaint', 'cancellation', 'other'];

const pad = (n: number) => String(n).padStart(2, '0');
function localIso(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`;
}

interface StoredFaq extends Omit<Faq, 'category_name'> {
  company_code: string;
}

/** デモの中で変更される状態 */
export interface DemoStore {
  faqs: StoredFaq[];
  unanswered: (Unanswered & { company_code: string })[];
  settings: Record<string, ResponseSettings>;
  credits: (CreditGrant & { company_code: string })[];
  manualCalls: (ManualCall & { company_code: string })[];
  extraCosts: { company_code: string; usage_date: string; cost_type: string; amount: number }[];
  extraCases: (SupportCase & { company_code: string })[];
  cancelled: Set<string>;
  nextId: number;
}

export function createDemoStore(data: Fixture = fixture): DemoStore {
  const now = localIso();
  return {
    faqs: data.faqs.map((f, i) => ({
      faq_id: i + 1,
      company_code: f.company_code,
      category_code: f.category_code,
      questions: [...f.questions],
      answer_text: f.answer_text,
      status: f.status as Faq['status'],
      source: f.source as Faq['source'],
      updated_at: f.updated_at,
      updated_by: 'seed',
    })),
    unanswered: data.unanswered_questions.map((u, i) => ({
      id: i + 1,
      company_code: u.company_code,
      question_text: u.question_text,
      timestamp: u.timestamp ?? now,
      status: 'open',
      reviewed_at: null,
      promoted_faq_id: null,
    })),
    settings: Object.fromEntries(
      data.response_settings.map(({ company_code, ...s }) => [company_code, { ...s, updated_at: now }]),
    ),
    credits: data.credits.map((c) => ({ ...c })),
    manualCalls: [],
    extraCosts: [],
    extraCases: [],
    cancelled: new Set(),
    nextId: 1000,
  };
}

let sharedStore: DemoStore | null = null;

/** CSV（category, question, answer）を読む。引用符で囲んだカンマ・改行にも対応。 */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => r.some((c) => c.trim()));
}

const CATEGORY_ALIASES: Record<string, string> = {
  billing: 'billing', 料金: 'billing', '料金・請求': 'billing', 請求: 'billing', 支払い: 'billing',
  usage: 'usage', 使い方: 'usage', 利用方法: 'usage', complaint: 'complaint', 苦情: 'complaint',
  cancellation: 'cancellation', 解約: 'cancellation', 契約: 'cancellation', other: 'other', その他: 'other',
}; // prettier-ignore

export function createDemoApi(identity: DemoIdentity, data: Fixture = fixture, store?: DemoStore): PortalApi {
  const s = store ?? (sharedStore ??= createDemoStore(data));
  const role = identity.role;

  // 実際の API と同じく、顧客は自社以外のデータを取得できない
  function companyCode(allowed: string[] = ['company_admin', 'operator', 'viewer']): string {
    if (!identity.company_code || !allowed.includes(role)) throw new ApiError(403, 'この操作の権限がありません');
    return identity.company_code;
  }
  const dashboard = () => companyCode(['company_admin', 'viewer']);
  const admin = () => companyCode(['company_admin']);
  const caller = () => companyCode(['company_admin', 'operator']);
  function requireOps() {
    if (role !== 'ops_admin') throw new ApiError(403, '運用管理者のみ閲覧できます');
  }
  const run = <T>(fn: () => T): Promise<T> => {
    try {
      return Promise.resolve(structuredClone(fn()));
    } catch (e) {
      return Promise.reject(e);
    }
  };

  const categoryName = (code: string | null) =>
    data.inquiry_categories.find((c) => c.category_code === code)?.category_name ?? null;
  const inPeriod = (value: string | null | undefined, period: string) => !!value && value.startsWith(period);

  /** 月×種別のコール数（デモデータ＋入力された通話） */
  function volume(code: string) {
    const rows = data.call_volume
      .filter((v) => v.company_code === code)
      .map((v) => ({ month: v.month, category_code: v.category_code, count: v.count }));
    for (const m of s.manualCalls.filter((c) => c.company_code === code)) {
      rows.push({ month: m.started_at.slice(0, 7), category_code: m.category_code, count: 1 });
    }
    return rows;
  }

  function costs(code: string) {
    return [
      ...data.cost_usage_daily.filter((u) => u.company_code === code),
      ...s.extraCosts.filter((u) => u.company_code === code),
    ];
  }

  function computeBilling(code: string, period: string): Billing {
    const lic = data.licenses.find((l) => l.company_code === code);
    const all = costs(code);
    const usage = all.filter((u) => inPeriod(u.usage_date, period));
    const byType = new Map<string, number>();
    for (const u of usage) byType.set(u.cost_type, (byType.get(u.cost_type) ?? 0) + u.amount);
    const usageByPeriod: Record<string, number> = {};
    for (const u of all) usageByPeriod[u.usage_date.slice(0, 7)] = (usageByPeriod[u.usage_date.slice(0, 7)] ?? 0) + u.amount;
    const credit = applyCredits(
      s.credits.filter((c) => c.company_code === code),
      usageByPeriod,
      period,
    );
    const breakdown = [
      ...(lic && usage.length ? [{ label: '基本ライセンス料', amount: lic.price_amount }] : []),
      ...[...byType.entries()].sort().map(([label, amount]) => ({ label, amount })),
    ];
    const subtotal = breakdown.reduce((sum, b) => sum + b.amount, 0);
    const inv = data.invoices.find((i) => i.company_code === code && inPeriod(i.billing_period_start, period));
    return {
      breakdown,
      subtotal,
      credit_applied: credit.applied,
      credit_balance: credit.balance,
      total: subtotal - credit.applied,
      currency: lic?.currency ?? 'JPY',
      invoice: inv
        ? { invoice_id: inv.invoice_id, issued_date: inv.issued_date, due_date: inv.due_date, currency: inv.currency, status: inv.status }
        : null,
    };
  }

  function toFaq(f: StoredFaq): Faq {
    const { company_code: _omit, ...rest } = f;
    void _omit;
    return { ...rest, category_name: categoryName(f.category_code) ?? f.category_code };
  }

  function validateFaq(input: FaqInput): FaqInput {
    const questions = [...new Set(input.questions.map((q) => q.trim()).filter(Boolean))];
    if (!CATEGORY_CODES.includes(input.category_code)) throw new ApiError(422, '不明な問い合わせ種別です');
    if (!questions.length) throw new ApiError(422, '質問を1つ以上入力してください');
    if (!input.answer_text.trim()) throw new ApiError(422, '回答を入力してください');
    return { ...input, questions, answer_text: input.answer_text.trim() };
  }

  function insertFaq(code: string, input: FaqInput, source: Faq['source']): StoredFaq {
    const v = validateFaq(input);
    const faq: StoredFaq = {
      faq_id: s.nextId++,
      company_code: code,
      ...v,
      source,
      updated_at: localIso(),
      updated_by: 'demo',
    };
    s.faqs.push(faq);
    return faq;
  }

  function ownFaq(id: number): StoredFaq {
    const f = s.faqs.find((x) => x.faq_id === id && x.company_code === admin());
    if (!f) throw new ApiError(404, 'FAQ が見つかりません');
    return f;
  }

  function openUnanswered(id: number) {
    const u = s.unanswered.find((x) => x.id === id && x.company_code === admin());
    if (!u) throw new ApiError(404, '質問が見つかりません');
    if (u.status !== 'open') throw new ApiError(409, 'この質問はすでにレビュー済みです');
    return u;
  }

  return {
    me: () => run<Me>(() => ({ uid: 'demo', email: null, role, company_code: identity.company_code })),

    company: () =>
      run(() => {
        const code = companyCode();
        const c = data.companies.find((x) => x.company_code === code)!;
        const lic = data.licenses.find((l) => l.company_code === code);
        const plan = data.plan_catalog.find((p) => p.plan_tier === lic?.plan_tier);
        return {
          company_code: c.company_code,
          company_name: c.company_name,
          country_code: c.country_code,
          status: c.status,
          created_at: c.created_at,
          plan_tier: lic?.plan_tier ?? null,
          plan_label: plan?.plan_label ?? null,
          concurrent_call_limit: lic?.concurrent_call_limit ?? null,
          billing_model: (lic?.billing_model ?? null) as Company['billing_model'],
          per_call_fee: lic?.per_call_fee ?? null,
        };
      }),

    categories: () => run(() => (companyCode(), data.inquiry_categories)),

    periods: () => run(() => [...new Set(volume(dashboard()).map((v) => v.month))].sort()),

    onboarding: () =>
      run(() =>
        data.onboarding_steps
          .filter((st) => st.company_code === dashboard())
          .map((st, i) => ({ ...st, step_id: i + 1 }) as OnboardingStep)
          .sort((a, b) => a.step_order - b.step_order),
      ),

    monthlyCalls: () =>
      run(() => {
        const totals = new Map<string, number>();
        for (const v of volume(dashboard())) totals.set(v.month, (totals.get(v.month) ?? 0) + v.count);
        return [...totals.entries()].sort().map(([period, calls]) => ({ period, calls }));
      }),

    inquiryBreakdown: (period) =>
      run(() => {
        const totals = new Map<string, number>();
        for (const v of volume(dashboard()).filter((x) => x.month === period)) {
          totals.set(v.category_code, (totals.get(v.category_code) ?? 0) + v.count);
        }
        const total = [...totals.values()].reduce((a, b) => a + b, 0) || 1;
        return [...totals.entries()]
          .map(([code, count]) => ({
            category_code: code,
            name: categoryName(code) ?? code,
            count,
            percent: Math.round((count / total) * 1000) / 10,
          }))
          .sort((a, b) => b.count - a.count);
      }),

    cases: (period) =>
      run(() => {
        const code = dashboard();
        const base = data.support_cases
          .filter((c) => c.company_code === code && inPeriod(c.opened_at, period))
          .map((c) => ({
            ...c,
            category_name: categoryName(c.category_code),
            latest_handover: data.case_handovers.find((h) => h.case_id === c.case_id)?.note ?? null,
          }));
        const extra = s.extraCases.filter((c) => c.company_code === code && inPeriod(c.opened_at, period));
        return [...base, ...extra].sort((a, b) => b.opened_at.localeCompare(a.opened_at));
      }),

    logs: (type, period) =>
      run(() =>
        data.system_logs
          .map((l, i) => ({ ...l, log_id: i + 1 }))
          .filter((l) => l.company_code === dashboard() && l.log_type === type && inPeriod(l.occurred_at, period))
          .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
      ),

    billing: (period) => run(() => computeBilling(dashboard(), period)),

    requestCancellation: (reason) =>
      run(() => {
        const code = admin();
        if (!reason.trim()) throw new ApiError(422, '理由を入力してください');
        if (s.cancelled.has(code)) throw new ApiError(409, 'すでに解約の申し込みを受け付けています');
        s.cancelled.add(code);
      }),

    // ---- CMS ----

    faqs: (status) =>
      run(() => {
        const code = admin();
        return s.faqs
          .filter((f) => f.company_code === code && (!status || f.status === status))
          .sort((a, b) => a.category_code.localeCompare(b.category_code) || a.faq_id - b.faq_id)
          .map(toFaq);
      }),

    createFaq: (input) => run(() => toFaq(insertFaq(admin(), input, 'manual'))),

    updateFaq: (id, input) =>
      run(() => {
        const f = ownFaq(id);
        Object.assign(f, validateFaq(input), { updated_at: localIso(), updated_by: 'demo' });
        return toFaq(f);
      }),

    setFaqStatus: (id, status) =>
      run(() => {
        const f = ownFaq(id);
        Object.assign(f, { status, updated_at: localIso(), updated_by: 'demo' });
        return toFaq(f);
      }),

    deleteFaq: (id) =>
      run(() => {
        const f = ownFaq(id);
        s.faqs = s.faqs.filter((x) => x !== f);
      }),

    importFaqs: (csv, dryRun) =>
      run((): CsvImportResult => {
        const code = admin();
        const rows = parseCsv(csv);
        const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
        const idx = { category: header.indexOf('category'), question: header.indexOf('question'), answer: header.indexOf('answer') };
        if (idx.category < 0 || idx.question < 0 || idx.answer < 0) {
          return { valid: 0, imported: 0, errors: [{ row: 1, message: '1行目に category, question, answer の列が必要です' }], preview: [] };
        }
        const items: FaqInput[] = [];
        const errors: CsvImportResult['errors'] = [];
        rows.slice(1).forEach((r, i) => {
          const rowNo = i + 2;
          const category = CATEGORY_ALIASES[(r[idx.category] ?? '').trim().toLowerCase()];
          if (!category) {
            errors.push({ row: rowNo, message: `問い合わせ種別「${(r[idx.category] ?? '').trim()}」は使えません` });
            return;
          }
          try {
            items.push(
              validateFaq({
                category_code: category,
                questions: (r[idx.question] ?? '').split('|'),
                answer_text: r[idx.answer] ?? '',
                status: 'draft',
              }),
            );
          } catch {
            errors.push({ row: rowNo, message: '質問または回答が空か、長すぎます' });
          }
        });
        const doImport = !dryRun && errors.length === 0;
        if (doImport) items.forEach((it) => insertFaq(code, it, 'csv'));
        return { valid: items.length, imported: doImport ? items.length : 0, errors, preview: items.slice(0, 5) };
      }),

    unanswered: (status) =>
      run(() => {
        const code = admin();
        return s.unanswered
          .filter((u) => u.company_code === code && u.status === status)
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .map(({ company_code: _c, ...u }) => (void _c, u));
      }),

    promoteUnanswered: (id, input) =>
      run(() => {
        const u = openUnanswered(id);
        const faq = insertFaq(u.company_code, input, 'unanswered');
        Object.assign(u, { status: 'promoted', reviewed_at: localIso(), promoted_faq_id: faq.faq_id });
        return toFaq(faq);
      }),

    dismissUnanswered: (id) =>
      run(() => {
        Object.assign(openUnanswered(id), { status: 'dismissed', reviewed_at: localIso() });
      }),

    settings: () =>
      run(() => {
        const st = s.settings[admin()];
        if (!st) throw new ApiError(404, '応答設定がまだありません');
        return st;
      }),

    saveSettings: (input) =>
      run(() => {
        const code = admin();
        if (input.business_hours_end <= input.business_hours_start) {
          throw new ApiError(422, '入力内容を確認してください：終了時刻は開始時刻より後にしてください');
        }
        if (!input.business_days.length) throw new ApiError(422, '入力内容を確認してください：営業日を選んでください');
        if (!input.greeting.trim() || !input.after_hours_message.trim()) {
          throw new ApiError(422, '入力内容を確認してください：案内文を入力してください');
        }
        s.settings[code] = {
          ...input,
          business_days: [...new Set(input.business_days)].sort(),
          escalation_keywords: [...new Set(input.escalation_keywords.map((k) => k.trim()).filter(Boolean))],
          updated_at: localIso(),
          updated_by: 'demo',
        };
        return s.settings[code];
      }),

    // ---- 通話入力 ----

    searchFaqs: (q) =>
      run(() => {
        const code = caller();
        return s.faqs
          .filter((f) => f.company_code === code && f.status === 'published')
          .map((f) => ({ ...toFaq(f), score: Math.round(Math.max(0, ...f.questions.map((x) => score(q, x))) * 100) / 100 }))
          .filter((f) => f.score >= 0.15)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
      }),

    createManualCall: (input) =>
      run(() => {
        const code = caller();
        if (!input.caller_question.trim() || !input.answer_given.trim()) {
          throw new ApiError(422, '入力内容を確認してください：お問い合わせ内容と回答を入力してください');
        }
        if (!(input.duration_minutes >= 1 && input.duration_minutes <= 240)) {
          throw new ApiError(422, '入力内容を確認してください：通話時間は1〜240分です');
        }
        const now = new Date();
        const started = localIso(new Date(now.getTime() - input.duration_minutes * 60000));
        const callId = `${code}-manual-${s.nextId++}`;
        s.manualCalls.unshift({
          call_id: callId,
          company_code: code,
          started_at: started,
          category_code: input.category_code,
          caller_question: input.caller_question.trim(),
          answer_given: input.answer_given.trim(),
          outcome: input.outcome,
          duration_sec: input.duration_minutes * 60,
          faq_id: input.faq_id,
          entered_by: 'demo',
        });
        // 従量課金の契約だけ、通話ごとの料金を加算する（月額定額では料金なし）
        const lic = data.licenses.find((l) => l.company_code === code);
        if (lic?.billing_model === 'metered' && lic.per_call_fee) {
          s.extraCosts.push({ company_code: code, usage_date: started.slice(0, 10), cost_type: '通話処理料', amount: lic.per_call_fee });
        }
        let caseId: string | null = null;
        if (input.outcome !== 'resolved') {
          caseId = `CASE-${started.slice(0, 7).replace('-', '')}-M${s.nextId++}`;
          s.extraCases.push({
            case_id: caseId,
            company_code: code,
            category_code: input.category_code,
            category_name: categoryName(input.category_code),
            summary: input.caller_question.trim().slice(0, 200),
            status: 'in_progress',
            opened_at: started,
            resolved_at: null,
            latest_handover: input.note || input.answer_given.trim().slice(0, 200),
          });
        }
        if (input.not_in_faq) {
          s.unanswered.push({
            id: s.nextId++,
            company_code: code,
            question_text: input.caller_question.trim().slice(0, 300),
            timestamp: started,
            status: 'open',
            reviewed_at: null,
            promoted_faq_id: null,
          });
        }
        return { call_id: callId, case_id: caseId };
      }),

    manualCalls: () =>
      run(() => {
        const code = caller();
        return s.manualCalls.filter((m) => m.company_code === code).map(({ company_code: _c, ...m }) => (void _c, m));
      }),

    // ---- 運用管理者 ----

    opsTenants: () =>
      run(() => {
        requireOps();
        return data.tenants.map(({ tenant_code, tenant_name }) => ({ tenant_code, tenant_name }));
      }),

    opsCompanies: (tenantCode) =>
      run((): OpsCompany[] => {
        requireOps();
        const today = localIso().slice(0, 10);
        const period = today.slice(0, 7);
        return data.companies
          .filter((c) => c.tenant_code === tenantCode)
          .map((c) => {
            const lic = data.licenses.find((l) => l.company_code === c.company_code);
            const plan = data.plan_catalog.find((p) => p.plan_tier === lic?.plan_tier);
            const live = data.live.find((l) => l.company_code === c.company_code);
            return {
              company_code: c.company_code,
              company_name: c.company_name,
              country_code: c.country_code,
              currency: lic?.currency ?? null,
              price_amount: lic?.price_amount ?? null,
              concurrent_call_limit: lic?.concurrent_call_limit ?? null,
              plan_label: plan?.plan_label ?? null,
              active_calls: live?.active_calls ?? 0,
              escalations_today: live?.escalations_today ?? 0,
              unanswered_today: s.unanswered.filter((u) => u.company_code === c.company_code && u.timestamp.startsWith(today)).length,
              credit_balance: computeBilling(c.company_code, period).credit_balance,
              billing_model: (lic?.billing_model ?? null) as OpsCompany['billing_model'],
              per_call_fee: lic?.per_call_fee ?? null,
            };
          });
      }),

    opsUsers: (tenantCode) =>
      run(() => {
        requireOps();
        return data.user_roles
          .map((ur) => ({
            ur,
            u: data.users.find((x) => x.user_code === ur.user_code)!,
            r: data.roles.find((x) => x.role_code === ur.role_code)!,
          }))
          .filter(({ u }) => u.tenant_code === tenantCode)
          .map(({ u, ur, r }) => ({ user_code: u.user_code, display_name: u.display_name, company_code: ur.company_code, role_name: r.role_name }))
          .sort((a, b) => (a.company_code + a.user_code).localeCompare(b.company_code + b.user_code));
      }),

    opsGrantCredit: (companyCode, input) =>
      run(() => {
        requireOps();
        if (!data.companies.some((c) => c.company_code === companyCode)) throw new ApiError(404, '契約が見つかりません');
        if (!(input.amount > 0) || !input.reason.trim()) throw new ApiError(422, '入力内容を確認してください');
        const today = localIso().slice(0, 10);
        if (input.expires_at && input.expires_at < today) throw new ApiError(422, '有効期限は今日以降にしてください');
        s.credits.push({ company_code: companyCode, amount: input.amount, reason: input.reason, granted_at: today, expires_at: input.expires_at } as CreditGrant & { company_code: string });
        return { credit_balance: computeBilling(companyCode, today.slice(0, 7)).credit_balance };
      }),
  };
}
