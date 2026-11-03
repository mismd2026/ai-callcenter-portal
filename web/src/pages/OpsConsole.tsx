import { useEffect, useMemo, useState } from 'react';
import type { OpsCompany } from '../api/types';
import { useApi } from '../auth/session';
import { formatMoney } from '../lib/format';
import { useAsync } from '../lib/useAsync';

function usageRatio(c: OpsCompany): number {
  return c.concurrent_call_limit ? c.active_calls / c.concurrent_call_limit : 0;
}

function statusOf(ratio: number) {
  if (ratio >= 0.9) return { color: '#F97066', label: '上限逼迫' };
  if (ratio >= 0.7) return { color: '#F5A623', label: '注意' };
  return { color: '#3DD68C', label: '正常' };
}

function CapacityRing({ ratio, size = 92, stroke = 8 }: { ratio: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#2A3341" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={statusOf(ratio).color}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - Math.min(ratio, 1))}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
    </svg>
  );
}

function CompanyCard({ company, selected, onSelect }: { company: OpsCompany; selected: boolean; onSelect: () => void }) {
  const ratio = usageRatio(company);
  const status = statusOf(ratio);
  return (
    <button
      onClick={onSelect}
      className={`text-left rounded-xl border transition-colors p-5 w-full ${
        selected ? 'border-[#3DD68C]/60 bg-[#1B212B]' : 'border-[#2A3341] bg-[#161B23] hover:border-[#3A4556]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-xs text-[#8B95A5] tracking-wide">{company.company_code}</div>
          <div className="text-[#E8EAED] font-semibold text-base mt-0.5">{company.company_name}</div>
          <div className="text-xs text-[#8B95A5] mt-1">
            {company.plan_label ?? '―'} ・ {company.country_code}
          </div>
        </div>
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-mono tracking-wide whitespace-nowrap"
          style={{ color: status.color, backgroundColor: status.color + '1A' }}
        >
          {status.label}
        </span>
      </div>
      <div className="flex items-center gap-5 mt-4">
        <div className="relative shrink-0">
          <CapacityRing ratio={ratio} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-lg text-[#E8EAED] leading-none">{company.active_calls}</span>
            <span className="font-mono text-[10px] text-[#8B95A5] leading-none mt-1">
              / {company.concurrent_call_limit ?? '―'}
            </span>
          </div>
        </div>
        <dl className="flex-1 space-y-2 text-xs">
          <div className="flex justify-between gap-2">
            <dt className="text-[#8B95A5]">月額</dt>
            <dd className="font-mono text-[#E8EAED]">{formatMoney(company.price_amount, company.currency ?? 'JPY')}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-[#8B95A5]">本日のエスカレーション</dt>
            <dd className="font-mono text-[#F5A623]">{company.escalations_today}件</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-[#8B95A5]">本日の未回答質問</dt>
            <dd className="font-mono text-[#E8EAED]">{company.unanswered_today}件</dd>
          </div>
        </dl>
      </div>
    </button>
  );
}

export default function OpsConsole() {
  const api = useApi();
  const tenants = useAsync(() => api.opsTenants(), [api]);
  const [tenant, setTenant] = useState('');
  const [selected, setSelected] = useState('ALL');

  useEffect(() => {
    if (!tenant && tenants.data?.length) setTenant(tenants.data[0].tenant_code);
  }, [tenants.data, tenant]);

  const ready = tenant ? Promise.resolve(tenant) : new Promise<string>(() => undefined);
  const companies = useAsync(() => ready.then((t) => api.opsCompanies(t)), [api, tenant]);
  const users = useAsync(() => ready.then((t) => api.opsUsers(t)), [api, tenant]);

  const list = companies.data ?? [];
  const shownUsers = useMemo(
    () => (users.data ?? []).filter((u) => selected === 'ALL' || u.company_code === selected),
    [users.data, selected],
  );
  const totalActive = list.reduce((s, c) => s + c.active_calls, 0);
  const totalLimit = list.reduce((s, c) => s + (c.concurrent_call_limit ?? 0), 0);
  const totalMonthly = list.reduce((s, c) => s + (c.price_amount ?? 0), 0);
  const tenantName = tenants.data?.find((t) => t.tenant_code === tenant)?.tenant_name;

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-mono tracking-wide border whitespace-nowrap ${
      active ? 'border-[#3DD68C]/60 text-[#3DD68C] bg-[#3DD68C]/10' : 'border-[#2A3341] text-[#8B95A5] hover:border-[#3A4556]'
    }`;

  return (
    <div className="min-h-full bg-[#12161C] text-[#E8EAED]">
      <header className="border-b border-[#2A3341] px-4 sm:px-8 py-5 flex flex-wrap items-center justify-between gap-4 bg-[#12161C]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#3DD68C]/15 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-[#3DD68C]" />
          </div>
          <div>
            <div className="font-mono text-[11px] text-[#8B95A5] tracking-wider">運用コンソール ・ {tenant || '―'}</div>
            <div className="font-display font-semibold text-lg leading-tight">{tenantName ?? '読み込み中…'}</div>
          </div>
        </div>
        <div className="flex items-center gap-6 text-right">
          <div>
            <div className="text-[11px] text-[#8B95A5]">テナント全体 同時コール</div>
            <div className="font-mono text-lg">
              {totalActive} <span className="text-[#8B95A5]">/ {totalLimit}</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-[#8B95A5]">月額合計</div>
            <div className="font-mono text-lg">{formatMoney(totalMonthly)}</div>
          </div>
        </div>
      </header>

      <div className="px-4 sm:px-8 py-8 max-w-6xl mx-auto space-y-8">
        {(tenants.error || companies.error) && (
          <div className="rounded-xl border border-[#F97066]/30 bg-[#F97066]/10 text-[#F97066] text-sm p-4">
            {(tenants.error ?? companies.error)?.message}
          </div>
        )}

        <div>
          <h2 className="font-display font-semibold text-sm text-[#8B95A5] tracking-wide mb-3">テナント</h2>
          <div className="flex gap-2 overflow-x-auto">
            {(tenants.data ?? []).map((t) => (
              <button
                key={t.tenant_code}
                onClick={() => {
                  setTenant(t.tenant_code);
                  setSelected('ALL');
                }}
                className={chip(tenant === t.tenant_code)}
              >
                {t.tenant_name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto">
          <button onClick={() => setSelected('ALL')} className={chip(selected === 'ALL')}>
            全契約
          </button>
          {list.map((c) => (
            <button key={c.company_code} onClick={() => setSelected(c.company_code)} className={chip(selected === c.company_code)}>
              {c.company_code}
            </button>
          ))}
        </div>

        <div>
          <h2 className="font-display font-semibold text-sm text-[#8B95A5] tracking-wide mb-3">契約ステータス</h2>
          {companies.loading ? (
            <div className="text-sm text-[#8B95A5]">読み込み中…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {list
                .filter((c) => selected === 'ALL' || c.company_code === selected)
                .map((c) => (
                  <CompanyCard
                    key={c.company_code}
                    company={c}
                    selected={selected === c.company_code}
                    onSelect={() => setSelected(c.company_code)}
                  />
                ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="font-display font-semibold text-sm text-[#8B95A5] tracking-wide mb-3">利用者・ロール</h2>
          <div className="rounded-xl border border-[#2A3341] bg-[#161B23] overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="text-left text-[11px] text-[#8B95A5] border-b border-[#2A3341]">
                  <th className="font-normal font-mono px-4 py-3">user_code</th>
                  <th className="font-normal px-4 py-3">氏名</th>
                  <th className="font-normal font-mono px-4 py-3">company_code</th>
                  <th className="font-normal px-4 py-3">ロール</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2A3341]">
                {shownUsers.map((u) => (
                  <tr key={`${u.user_code}-${u.company_code}`}>
                    <td className="font-mono px-4 py-3 text-[#8B95A5]">{u.user_code}</td>
                    <td className="px-4 py-3">{u.display_name}</td>
                    <td className="font-mono px-4 py-3 text-[#8B95A5]">{u.company_code}</td>
                    <td className="px-4 py-3">{u.role_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
