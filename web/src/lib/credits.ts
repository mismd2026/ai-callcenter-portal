// クレジットの相殺計算。API（api/app/billing.py）と同じ規則。
//  - 従量料金（基本ライセンス料以外）とだけ相殺する
//  - 古い月から順に、期限の近いクレジットから使う
//  - 付与月より前の月、期限切れ後の月には使わない

export interface CreditGrant {
  amount: number;
  granted_at: string; // YYYY-MM-DD
  expires_at: string | null;
}

function usable(c: CreditGrant, period: string): boolean {
  return c.granted_at.slice(0, 7) <= period && (c.expires_at === null || c.expires_at >= `${period}-01`);
}

export function applyCredits(
  credits: CreditGrant[],
  usageByPeriod: Record<string, number>,
  period: string,
): { applied: number; balance: number } {
  const pool = credits.map((c) => ({ c, left: c.amount }));
  const order = [...pool].sort((a, b) =>
    (a.c.expires_at ?? '9999-12-31').localeCompare(b.c.expires_at ?? '9999-12-31') ||
    a.c.granted_at.localeCompare(b.c.granted_at),
  );
  let appliedTarget = 0;
  const periods = [...new Set([...Object.keys(usageByPeriod), period])].sort();
  for (const p of periods) {
    if (p > period) break;
    let due = usageByPeriod[p] ?? 0;
    let applied = 0;
    for (const item of order) {
      if (due <= 0) break;
      if (item.left <= 0 || !usable(item.c, p)) continue;
      const use = Math.min(item.left, due);
      item.left -= use;
      due -= use;
      applied += use;
    }
    if (p === period) appliedTarget = applied;
  }
  const balance = pool.filter((x) => x.left > 0 && usable(x.c, period)).reduce((s, x) => s + x.left, 0);
  return { applied: Math.round(appliedTarget), balance: Math.round(balance) };
}
