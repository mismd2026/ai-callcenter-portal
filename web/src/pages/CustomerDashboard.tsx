import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CustomerLogType, OnboardingStep } from '../api/types';
import { useApi, useSession } from '../auth/session';
import { CASE_STATUS_LABEL, formatMoney, formatMonth, formatPeriod, groupPeriodsByYear } from '../lib/format';
import { useAsync, type AsyncState } from '../lib/useAsync';

const CATEGORY_COLORS: Record<string, string> = {
  billing: '#0F9B8E',
  usage: '#3B7DD8',
  complaint: '#E5484D',
  cancellation: '#F5A623',
  other: '#98A2B3',
};

// 顧客に見せるログはこの2種類だけ（サーバー・ネットワークの内部ログは運用側のみ）
const LOG_TABS: { key: CustomerLogType; label: string }[] = [
  { key: 'operator', label: 'オペレーター対応' },
  { key: 'incident', label: '障害のお知らせ' },
];

const SECTION_TABS = [
  { key: 'overview', label: '概要・導入プロセス' },
  { key: 'usage', label: '利用状況' },
  { key: 'cases', label: '対応履歴・課題' },
  { key: 'logs', label: 'ログ' },
  { key: 'billing', label: '費用・請求' },
] as const;
type SectionKey = (typeof SECTION_TABS)[number]['key'];

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-[#E4E7EC] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="font-display font-semibold text-[15px]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Loadable<T>({
  state,
  empty,
  isEmpty,
  children,
}: {
  state: AsyncState<T>;
  empty: string;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  if (state.loading) return <div className="text-sm text-[#98A2B3] py-6 text-center">読み込み中…</div>;
  if (state.error)
    return <div className="text-sm text-[#B42318] py-6 text-center">{state.error.message}</div>;
  if (state.data == null || isEmpty?.(state.data))
    return <div className="text-sm text-[#98A2B3] py-6 text-center">{empty}</div>;
  return <>{children(state.data)}</>;
}

function OnboardingStepper({ steps }: { steps: OnboardingStep[] }) {
  return (
    <ol className="flex items-stretch overflow-x-auto pb-2">
      {steps.map((step, i) => {
        const done = step.status === 'done';
        const current = step.status === 'current';
        return (
          <li key={step.step_id} className="flex items-center min-w-[140px] last:min-w-fit">
            <div className="flex flex-col items-start">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono font-medium border-2 ${
                  done
                    ? 'bg-[#0F9B8E] border-[#0F9B8E] text-white'
                    : current
                      ? 'border-[#0F9B8E] text-[#0F9B8E] bg-white'
                      : 'border-[#D0D5DD] text-[#98A2B3] bg-white'
                }`}
              >
                {done ? '✓' : step.step_order}
              </div>
              <div className={`mt-2 text-sm font-medium ${current ? 'text-[#0F9B8E]' : ''}`}>{step.step_label}</div>
              <div className="text-xs text-[#667085] font-mono mt-0.5">
                {step.actual_date || step.planned_date || '―'}
              </div>
              {current && (
                <span className="mt-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#0F9B8E]/10 text-[#0F9B8E]">
                  進行中
                </span>
              )}
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 w-8 mx-1 mt-4 shrink-0 ${done ? 'bg-[#0F9B8E]' : 'bg-[#D0D5DD]'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function PeriodPane({
  periods,
  selected,
  onSelect,
}: {
  periods: string[];
  selected: string;
  onSelect: (p: string) => void;
}) {
  const groups = groupPeriodsByYear(periods);
  return (
    <>
      {/* 狭い画面ではプルダウン */}
      <div className="md:hidden px-4 pt-4">
        <select
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm"
          aria-label="期間"
        >
          {[...periods].reverse().map((p) => (
            <option key={p} value={p}>
              {formatPeriod(p)}
            </option>
          ))}
        </select>
      </div>
      <nav className="hidden md:block w-44 shrink-0 border-r border-[#E4E7EC] bg-white overflow-y-auto">
        <div className="px-4 py-4 text-[11px] font-mono text-[#98A2B3] tracking-wide">期間選択</div>
        {groups.map(([year, months]) => (
          <div key={year} className="mb-2">
            <div className="px-4 py-1.5 text-xs font-semibold">{year}年</div>
            {months.map((p) => (
              <button
                key={p}
                onClick={() => onSelect(p)}
                className={`w-full text-left px-6 py-1.5 text-sm transition-colors ${
                  p === selected
                    ? 'bg-[#0F9B8E]/10 text-[#0F9B8E] font-medium border-r-2 border-[#0F9B8E]'
                    : 'text-[#475467] hover:bg-[#F7F8FA]'
                }`}
              >
                {formatMonth(p)}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}

function CancellationBox() {
  const api = useApi();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (session?.me.role !== 'company_admin') {
    return <p className="text-xs text-[#98A2B3] mt-2">解約のお申し込みは契約管理者の方のみ行えます。</p>;
  }
  if (result?.ok) return <p className="text-sm text-[#0F9B8E] mt-2">{result.text}</p>;

  async function submit() {
    try {
      await api.requestCancellation(reason);
      setResult({ ok: true, text: '解約のお申し込みを受け付けました。担当者よりご連絡いたします。' });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : '送信できませんでした' });
    }
  }

  return open ? (
    <div className="mt-2 space-y-2">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder="解約の理由（必須）"
        className="w-full rounded-lg border border-[#D0D5DD] px-3 py-2 text-sm"
      />
      {result && !result.ok && <p className="text-xs text-[#B42318]">{result.text}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={!reason.trim()}
          className="flex-1 rounded-lg bg-[#E5484D] text-white py-2 text-sm disabled:opacity-50"
        >
          申し込む
        </button>
        <button onClick={() => setOpen(false)} className="flex-1 rounded-lg border border-[#E4E7EC] py-2 text-sm">
          やめる
        </button>
      </div>
    </div>
  ) : (
    <button
      onClick={() => setOpen(true)}
      className="w-full mt-2 text-sm border border-[#E4E7EC] text-[#475467] rounded-lg py-2 hover:border-[#E5484D]/40 hover:text-[#E5484D] transition-colors"
    >
      解約を申し込む
    </button>
  );
}

export default function CustomerDashboard() {
  const api = useApi();
  const [section, setSection] = useState<SectionKey>('overview');
  const [logType, setLogType] = useState<CustomerLogType>('operator');
  const [period, setPeriod] = useState<string>('');

  const company = useAsync(() => api.company(), [api]);
  const periods = useAsync(() => api.periods(), [api]);
  useEffect(() => {
    if (!period && periods.data?.length) setPeriod(periods.data[periods.data.length - 1]);
  }, [periods.data, period]);

  const onboarding = useAsync(() => api.onboarding(), [api]);
  const monthly = useAsync(() => api.monthlyCalls(), [api]);
  const ready = (p: string) => (p ? Promise.resolve(p) : new Promise<string>(() => undefined));
  const inquiry = useAsync(() => ready(period).then((p) => api.inquiryBreakdown(p)), [api, period]);
  const cases = useAsync(() => ready(period).then((p) => api.cases(p)), [api, period]);
  const logs = useAsync(() => ready(period).then((p) => api.logs(logType, p)), [api, period, logType]);
  const billing = useAsync(() => ready(period).then((p) => api.billing(p)), [api, period]);

  const chartData = useMemo(
    () => (monthly.data ?? []).map((m) => ({ month: formatMonth(m.period), period: m.period, calls: m.calls })),
    [monthly.data],
  );
  const currentCalls = chartData.find((m) => m.period === period)?.calls ?? 0;

  return (
    <div className="h-full flex flex-col">
      <header className="bg-white border-b border-[#E4E7EC] px-4 sm:px-8 pt-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] text-[#667085] tracking-wide">{company.data?.company_code}</div>
            <h1 className="font-display font-bold text-lg mt-0.5">
              {company.data?.company_name ?? (company.error ? company.error.message : '読み込み中…')}
            </h1>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-[11px] text-[#667085]">契約開始日</div>
              <div className="font-mono text-sm">{company.data?.created_at?.slice(0, 10) ?? '―'}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-[#667085]">プラン</div>
              <div className="text-sm font-medium">{company.data?.plan_label ?? '―'}</div>
            </div>
            <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-[#0F9B8E]/10 text-[#0F9B8E]">
              {company.data?.status === 'active' ? '本稼働中' : (company.data?.status ?? '―')}
            </span>
          </div>
        </div>
        <div className="flex gap-1 mt-4 overflow-x-auto">
          {SECTION_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSection(tab.key)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                section === tab.key
                  ? 'border-[#0F9B8E] text-[#0F9B8E]'
                  : 'border-transparent text-[#667085] hover:text-[#1A2332]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        <PeriodPane periods={periods.data ?? []} selected={period} onSelect={setPeriod} />

        <main className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
          <div className="max-w-4xl space-y-6">
            {period && <div className="text-xs font-mono text-[#98A2B3]">表示中: {formatPeriod(period)}</div>}

            {section === 'overview' && (
              <Section title="導入プロセス・プロジェクト進行状況">
                <Loadable state={onboarding} empty="導入プロセスの記録がありません" isEmpty={(d) => !d.length}>
                  {(steps) => <OnboardingStepper steps={steps} />}
                </Loadable>
              </Section>
            )}

            {section === 'usage' && (
              <>
                <Section title={`月別総コール数（${period ? formatMonth(period) : ''}: ${currentCalls.toLocaleString()}件）`}>
                  <Loadable state={monthly} empty="通話記録がまだありません" isEmpty={(d) => !d.length}>
                    {() => (
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={chartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E4E7EC" vertical={false} />
                          <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#667085' }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 12, fill: '#667085' }} axisLine={false} tickLine={false} />
                          <Tooltip
                            contentStyle={{ borderRadius: 8, border: '1px solid #E4E7EC', fontSize: 12 }}
                            formatter={(v: number) => [`${v.toLocaleString()}件`, 'コール数']}
                          />
                          <Bar dataKey="calls" radius={[6, 6, 0, 0]}>
                            {chartData.map((d) => (
                              <Cell key={d.period} fill={d.period === period ? '#0F9B8E' : '#9ED9D3'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </Loadable>
                </Section>

                <Section title="問い合わせ内容種別">
                  <Loadable state={inquiry} empty="この期間の問い合わせ種別データがありません" isEmpty={(d) => !d.length}>
                    {(data) => (
                      <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
                        <ResponsiveContainer width={200} height={180}>
                          <PieChart>
                            <Pie data={data} dataKey="count" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                              {data.map((d) => (
                                <Cell key={d.category_code} fill={CATEGORY_COLORS[d.category_code] ?? CATEGORY_COLORS.other} />
                              ))}
                            </Pie>
                            <Tooltip formatter={(v: number, n: string) => [`${v.toLocaleString()}件`, n]} />
                          </PieChart>
                        </ResponsiveContainer>
                        <ul className="space-y-1.5 flex-1 w-full">
                          {data.map((d) => (
                            <li key={d.category_code} className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-2">
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: CATEGORY_COLORS[d.category_code] ?? CATEGORY_COLORS.other }}
                                />
                                <span className="text-[#475467]">{d.name}</span>
                              </span>
                              <span className="font-mono">
                                {d.percent}%<span className="text-[#98A2B3] ml-2">{d.count.toLocaleString()}件</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </Loadable>
                </Section>
              </>
            )}

            {section === 'cases' && (
              <Section title="対応履歴・引き継ぎ・課題管理">
                <Loadable state={cases} empty="この期間の対応履歴はありません" isEmpty={(d) => !d.length}>
                  {(data) => (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[640px]">
                        <thead>
                          <tr className="text-left text-[11px] text-[#667085] border-b border-[#E4E7EC] whitespace-nowrap">
                            <th className="font-normal font-mono py-2 pr-4">ケースID</th>
                            <th className="font-normal py-2 pr-4">種別</th>
                            <th className="font-normal py-2 pr-4">概要</th>
                            <th className="font-normal py-2 pr-4">引き継ぎ内容</th>
                            <th className="font-normal py-2 pr-4">ステータス</th>
                            <th className="font-normal py-2 pr-4">発生日</th>
                            <th className="font-normal py-2">解決日</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F1F3]">
                          {data.map((c) => {
                            const done = c.status === 'resolved' || c.status === 'closed';
                            return (
                              <tr key={c.case_id}>
                                <td className="font-mono py-3 pr-4 text-[#667085] whitespace-nowrap">{c.case_id}</td>
                                <td className="py-3 pr-4 whitespace-nowrap">{c.category_name ?? c.category_code}</td>
                                <td className="py-3 pr-4 max-w-[220px]">{c.summary}</td>
                                <td className="py-3 pr-4 max-w-[220px] text-[#667085]">{c.latest_handover ?? '―'}</td>
                                <td className="py-3 pr-4">
                                  <span
                                    className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                                      done ? 'bg-[#0F9B8E]/10 text-[#0F9B8E]' : 'bg-[#F5A623]/10 text-[#B54708]'
                                    }`}
                                  >
                                    {CASE_STATUS_LABEL[c.status] ?? c.status}
                                  </span>
                                </td>
                                <td className="font-mono py-3 pr-4 text-[#667085] whitespace-nowrap">{c.opened_at.slice(0, 10)}</td>
                                <td className="font-mono py-3 text-[#667085] whitespace-nowrap">{c.resolved_at?.slice(0, 10) ?? '―'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Loadable>
              </Section>
            )}

            {section === 'logs' && (
              <Section
                title="ログ"
                action={
                  <div className="flex gap-1">
                    {LOG_TABS.map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setLogType(tab.key)}
                        className={`text-xs px-2.5 py-1 rounded-md ${
                          logType === tab.key ? 'bg-[#1A2332] text-white' : 'text-[#667085] hover:bg-[#F0F1F3]'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                }
              >
                <Loadable state={logs} empty="この期間のログはありません" isEmpty={(d) => !d.length}>
                  {(data) => (
                    <ul className="space-y-2">
                      {data.map((log) => (
                        <li key={log.log_id} className="flex gap-4 text-sm py-2 border-b border-[#F0F1F3] last:border-0">
                          <span className="font-mono text-[#98A2B3] shrink-0">
                            {log.occurred_at.slice(5, 16).replace('T', ' ')}
                          </span>
                          <span className="text-[#344054]">{log.message}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Loadable>
              </Section>
            )}

            {section === 'billing' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Section title="費用内訳">
                  <Loadable state={billing} empty="この期間の費用データがありません" isEmpty={(d) => !d.breakdown.length}>
                    {(data) => (
                      <div className="space-y-3">
                        {data.breakdown.map((b) => (
                          <div key={b.label} className="flex justify-between text-sm">
                            <span className="text-[#475467]">{b.label}</span>
                            <span className="font-mono">{formatMoney(b.amount, data.currency)}</span>
                          </div>
                        ))}
                        <div className="border-t border-[#E4E7EC] pt-3 flex justify-between font-medium">
                          <span>合計</span>
                          <span className="font-mono text-[#0F9B8E] text-base">{formatMoney(data.total, data.currency)}</span>
                        </div>
                      </div>
                    )}
                  </Loadable>
                </Section>

                <Section title="請求情報">
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#475467]">請求額</span>
                      <span className="font-mono">{formatMoney(billing.data?.invoice?.total_amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#475467]">発行日</span>
                      <span className="font-mono">{billing.data?.invoice?.issued_date ?? '―'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#475467]">お支払期限</span>
                      <span className="font-mono">{billing.data?.invoice?.due_date ?? '―'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#475467]">ステータス</span>
                      <span className="font-mono text-[#667085]">
                        {{ paid: '支払済み', pending: '未払い', overdue: '期限超過' }[billing.data?.invoice?.status ?? ''] ??
                          '―'}
                      </span>
                    </div>
                    <CancellationBox />
                  </div>
                </Section>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
