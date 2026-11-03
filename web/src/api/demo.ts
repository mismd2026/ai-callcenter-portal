/**
 * デモ用。fixtures/demo.json を使い、API と同じ集計をブラウザ内で行う。
 * GitHub Pages のように API がない場所でも画面を確認できるようにするためのもの。
 */
import fixture from '../../../fixtures/demo.json';
import {
  ApiError,
  type Billing,
  type Me,
  type OnboardingStep,
  type OpsCompany,
  type PortalApi,
} from './types';
import type { DemoIdentity } from './demoIdentities';

type Fixture = typeof fixture;

const inPeriod = (value: string | null | undefined, period: string) =>
  !!value && value.startsWith(period);

export function createDemoApi(identity: DemoIdentity, data: Fixture = fixture): PortalApi {
  const cancelled = new Set<string>();
  const isOps = identity.role === 'ops_admin';

  // 実際の API と同じく、顧客は自社以外のデータを取得できない
  function companyCode(): string {
    if (isOps || !identity.company_code) throw new ApiError(403, '顧客向けの画面です');
    return identity.company_code;
  }
  function requireOps() {
    if (!isOps) throw new ApiError(403, '運用管理者のみ閲覧できます');
  }
  const ok = <T>(value: T) => Promise.resolve(structuredClone(value));
  const run = <T>(fn: () => T): Promise<T> => {
    try {
      return ok(fn());
    } catch (e) {
      return Promise.reject(e);
    }
  };

  const volume = (code: string) => data.call_volume.filter((v) => v.company_code === code);
  const categoryName = (code: string | null) =>
    data.inquiry_categories.find((c) => c.category_code === code)?.category_name ?? null;

  return {
    me: () =>
      ok<Me>({ uid: 'demo', email: null, role: identity.role, company_code: identity.company_code }),

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
        };
      }),

    periods: () => run(() => [...new Set(volume(companyCode()).map((v) => v.month))].sort()),

    onboarding: () =>
      run(() =>
        data.onboarding_steps
          .filter((s) => s.company_code === companyCode())
          .map((s, i) => ({ ...s, step_id: i + 1 }) as OnboardingStep)
          .sort((a, b) => a.step_order - b.step_order),
      ),

    monthlyCalls: () =>
      run(() => {
        const totals = new Map<string, number>();
        for (const v of volume(companyCode())) totals.set(v.month, (totals.get(v.month) ?? 0) + v.count);
        return [...totals.entries()].sort().map(([period, calls]) => ({ period, calls }));
      }),

    inquiryBreakdown: (period) =>
      run(() => {
        const rows = volume(companyCode()).filter((v) => v.month === period);
        const total = rows.reduce((s, r) => s + r.count, 0) || 1;
        return rows
          .map((r) => ({
            category_code: r.category_code,
            name: categoryName(r.category_code) ?? r.category_code,
            count: r.count,
            percent: Math.round((r.count / total) * 1000) / 10,
          }))
          .sort((a, b) => b.count - a.count);
      }),

    cases: (period) =>
      run(() =>
        data.support_cases
          .filter((c) => c.company_code === companyCode() && inPeriod(c.opened_at, period))
          .map((c) => ({
            ...c,
            category_name: categoryName(c.category_code),
            latest_handover: data.case_handovers.find((h) => h.case_id === c.case_id)?.note ?? null,
          }))
          .sort((a, b) => b.opened_at.localeCompare(a.opened_at)),
      ),

    logs: (type, period) =>
      run(() =>
        data.system_logs
          .map((l, i) => ({ ...l, log_id: i + 1 }))
          .filter(
            (l) => l.company_code === companyCode() && l.log_type === type && inPeriod(l.occurred_at, period),
          )
          .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
      ),

    billing: (period) =>
      run((): Billing => {
        const code = companyCode();
        const lic = data.licenses.find((l) => l.company_code === code);
        const usage = data.cost_usage_daily.filter(
          (u) => u.company_code === code && inPeriod(u.usage_date, period),
        );
        const byType = new Map<string, number>();
        for (const u of usage) byType.set(u.cost_type, (byType.get(u.cost_type) ?? 0) + u.amount);
        const breakdown = [
          ...(lic && usage.length ? [{ label: '基本ライセンス料', amount: lic.price_amount }] : []),
          ...[...byType.entries()].sort().map(([label, amount]) => ({ label, amount })),
        ];
        const inv = data.invoices.find(
          (i) => i.company_code === code && inPeriod(i.billing_period_start, period),
        );
        return {
          breakdown,
          total: breakdown.reduce((s, b) => s + b.amount, 0),
          currency: lic?.currency ?? 'JPY',
          invoice: inv
            ? {
                invoice_id: inv.invoice_id,
                issued_date: inv.issued_date,
                due_date: inv.due_date,
                total_amount: inv.total_amount,
                currency: inv.currency,
                status: inv.status,
              }
            : null,
        };
      }),

    requestCancellation: (reason) =>
      run(() => {
        const code = companyCode();
        if (identity.role !== 'company_admin') throw new ApiError(403, '契約管理者のみ操作できます');
        if (!reason.trim()) throw new ApiError(422, '理由を入力してください');
        if (cancelled.has(code)) throw new ApiError(409, 'すでに解約の申し込みを受け付けています');
        cancelled.add(code);
      }),

    opsTenants: () =>
      run(() => {
        requireOps();
        return data.tenants.map(({ tenant_code, tenant_name }) => ({ tenant_code, tenant_name }));
      }),

    opsCompanies: (tenantCode) =>
      run((): OpsCompany[] => {
        requireOps();
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
              unanswered_today: live?.unanswered_today ?? 0,
            };
          });
      }),

    opsUsers: (tenantCode) =>
      run(() => {
        requireOps();
        return data.user_roles
          .map((ur) => {
            const u = data.users.find((x) => x.user_code === ur.user_code)!;
            const r = data.roles.find((x) => x.role_code === ur.role_code)!;
            return { u, ur, r };
          })
          .filter(({ u }) => u.tenant_code === tenantCode)
          .map(({ u, ur, r }) => ({
            user_code: u.user_code,
            display_name: u.display_name,
            company_code: ur.company_code,
            role_name: r.role_name,
          }))
          .sort((a, b) => (a.company_code + a.user_code).localeCompare(b.company_code + b.user_code));
      }),
  };
}
