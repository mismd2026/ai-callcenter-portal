import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/demo.json';
import { createDemoApi } from './demo';
import { DEMO_IDENTITIES } from './demoIdentities';
import { ApiError } from './types';

const tokyoAdmin = DEMO_IDENTITIES.find((d) => d.role === 'company_admin' && d.company_code === 'ACME-TOKYO')!;
const viewer = DEMO_IDENTITIES.find((d) => d.role === 'viewer')!;
const ops = DEMO_IDENTITIES.find((d) => d.role === 'ops_admin')!;

describe('デモ API（API と同じ集計・認可になっているか）', () => {
  it('月別コール数がデモデータの合計と一致する', async () => {
    const api = createDemoApi(tokyoAdmin);
    const monthly = await api.monthlyCalls();
    const expected = fixture.call_volume
      .filter((v) => v.company_code === 'ACME-TOKYO' && v.month === '2026-07')
      .reduce((s, v) => s + v.count, 0);
    expect(monthly.find((m) => m.period === '2026-07')?.calls).toBe(expected);
  });

  it('問い合わせ種別の割合の合計がほぼ100%になる', async () => {
    const shares = await createDemoApi(tokyoAdmin).inquiryBreakdown('2026-07');
    const total = shares.reduce((s, x) => s + x.percent, 0);
    expect(Math.abs(total - 100)).toBeLessThan(0.5);
  });

  it('請求の合計は基本料金＋従量分', async () => {
    const billing = await createDemoApi(tokyoAdmin).billing('2026-07');
    expect(billing.breakdown[0]).toEqual({ label: '基本ライセンス料', amount: 1000000 });
    expect(billing.total).toBe(billing.breakdown.reduce((s, b) => s + b.amount, 0));
    expect(billing.invoice?.total_amount).toBe(billing.total);
  });

  it('顧客は運用コンソールを開けない', async () => {
    await expect(createDemoApi(tokyoAdmin).opsTenants()).rejects.toBeInstanceOf(ApiError);
  });

  it('運用管理者は顧客画面のデータを取得できない', async () => {
    await expect(createDemoApi(ops).company()).rejects.toMatchObject({ status: 403 });
  });

  it('閲覧者は解約を申し込めない', async () => {
    await expect(createDemoApi(viewer).requestCancellation('x')).rejects.toMatchObject({ status: 403 });
  });

  it('解約の申し込みは一度だけ', async () => {
    const api = createDemoApi(tokyoAdmin);
    await api.requestCancellation('予算の見直し');
    await expect(api.requestCancellation('再送')).rejects.toMatchObject({ status: 409 });
  });

  it('運用管理者はテナントごとの利用者を見られる', async () => {
    const users = await createDemoApi(ops).opsUsers('ACME');
    expect(users.map((u) => u.user_code).sort()).toEqual(['u_kato', 'u_suzuki', 'u_tanaka']);
  });
});
