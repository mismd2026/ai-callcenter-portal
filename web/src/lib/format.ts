export function formatMoney(amount: number | null | undefined, currency = 'JPY'): string {
  if (amount == null) return '―';
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
    amount,
  );
}

/** '2026-07' -> '2026年7月' */
export function formatPeriod(period: string): string {
  const [y, m] = period.split('-');
  return `${y}年${Number(m)}月`;
}

/** '2026-07' -> '7月' */
export function formatMonth(period: string): string {
  return `${Number(period.split('-')[1])}月`;
}

export function groupPeriodsByYear(periods: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const p of [...periods].sort().reverse()) {
    const year = p.slice(0, 4);
    groups.set(year, [...(groups.get(year) ?? []), p]);
  }
  return [...groups.entries()];
}

export const CASE_STATUS_LABEL: Record<string, string> = {
  open: '受付',
  in_progress: '対応中',
  resolved: '解決',
  closed: '完了',
};
