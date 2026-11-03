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
        else if (Array.isArray(body.detail) && body.detail[0]?.msg) {
          // 入力チェックのエラー（FastAPI / Pydantic）
          message = '入力内容を確認してください：' + String(body.detail[0].msg).replace(/^Value error, /, '');
        }
      } catch {
        // 本文が JSON でない場合は既定のメッセージを使う
      }
      throw new ApiError(res.status, message);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  const q = (period: string) => `period=${encodeURIComponent(period)}`;
  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

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
    categories: () => request('/company/categories'),
    faqs: (status) => request(`/company/faqs${status ? `?status=${status}` : ''}`),
    createFaq: (input) => request('/company/faqs', json('POST', input)),
    updateFaq: (id, input) => request(`/company/faqs/${id}`, json('PUT', input)),
    setFaqStatus: (id, status) => request(`/company/faqs/${id}/status`, json('POST', { status })),
    deleteFaq: (id) => request(`/company/faqs/${id}`, json('DELETE')),
    importFaqs: (csv, dryRun) => request('/company/faqs/import', json('POST', { csv, dry_run: dryRun })),
    unanswered: (status) => request(`/company/unanswered?status=${status}`),
    promoteUnanswered: (id, input) => request(`/company/unanswered/${id}/promote`, json('POST', input)),
    dismissUnanswered: async (id) => {
      await request(`/company/unanswered/${id}/dismiss`, json('POST'));
    },
    settings: () => request('/company/settings'),
    saveSettings: (input) => request('/company/settings', json('PUT', input)),
    searchFaqs: (text) => request(`/company/faqs/search?q=${encodeURIComponent(text)}`),
    createManualCall: (input) => request('/company/calls/manual', json('POST', input)),
    manualCalls: () => request('/company/calls/manual'),
    opsGrantCredit: (code, input) =>
      request(`/ops/companies/${encodeURIComponent(code)}/credits`, json('POST', input)),
    opsTenants: () => request('/ops/tenants'),
    opsCompanies: (t) => request(`/ops/tenants/${encodeURIComponent(t)}/companies`),
    opsUsers: (t) => request(`/ops/tenants/${encodeURIComponent(t)}/users`),
  };
}
