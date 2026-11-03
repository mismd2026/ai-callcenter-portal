import { ApiError, type PortalApi } from './types';

/**
 * 本番用。毎回 ID トークンを付けて API を呼ぶ。
 * 会社コードは送らない（サーバーがトークンのカスタムクレームから決める）。
 */
export function createHttpApi(getToken: () => Promise<string>): PortalApi {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();
    const res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      let message = `エラーが発生しました（${res.status}）`;
      try {
        const body = await res.json();
        if (typeof body.detail === 'string') message = body.detail;
      } catch {
        // 本文が JSON でない場合は既定のメッセージを使う
      }
      throw new ApiError(res.status, message);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  const q = (period: string) => `period=${encodeURIComponent(period)}`;

  return {
    me: () => request('/me'),
    company: () => request('/company'),
    periods: () => request('/company/periods'),
    onboarding: () => request('/company/onboarding'),
    monthlyCalls: () => request('/company/calls/monthly'),
    inquiryBreakdown: (period) => request(`/company/inquiry-breakdown?${q(period)}`),
    cases: (period) => request(`/company/cases?${q(period)}`),
    logs: (type, period) => request(`/company/logs?type=${type}&${q(period)}`),
    billing: (period) => request(`/company/billing?${q(period)}`),
    requestCancellation: async (reason) => {
      await request('/company/cancellation', { method: 'POST', body: JSON.stringify({ reason }) });
    },
    opsTenants: () => request('/ops/tenants'),
    opsCompanies: (t) => request(`/ops/tenants/${encodeURIComponent(t)}/companies`),
    opsUsers: (t) => request(`/ops/tenants/${encodeURIComponent(t)}/users`),
  };
}
