import { useState } from 'react';
import type { Role } from '../api/types';
import { useApi, useSession } from '../auth/session';
import { useAsync } from '../lib/useAsync';
import CallEntry from './CallEntry';
import CustomerDashboard from './CustomerDashboard';
import FaqManager from './FaqManager';
import ResponseSettingsPage from './ResponseSettings';
import UnansweredReview from './UnansweredReview';

type ModuleKey = 'dashboard' | 'calls' | 'faqs' | 'unanswered' | 'settings';

// ロールごとに使える機能（API 側でも同じ制限をしている）
const MODULES: { key: ModuleKey; label: string; roles: Role[]; cms?: boolean }[] = [
  { key: 'dashboard', label: 'ダッシュボード', roles: ['company_admin', 'viewer'] },
  { key: 'calls', label: '通話入力', roles: ['company_admin', 'operator'] },
  { key: 'faqs', label: 'FAQ管理', roles: ['company_admin'], cms: true },
  { key: 'unanswered', label: '未回答レビュー', roles: ['company_admin'], cms: true },
  { key: 'settings', label: '応答設定', roles: ['company_admin'], cms: true },
];

export default function CustomerShell() {
  const api = useApi();
  const { session } = useSession();
  const role = session!.me.role;
  const available = MODULES.filter((m) => m.roles.includes(role));
  const [active, setActive] = useState<ModuleKey>(available[0].key);
  const company = useAsync(() => api.company(), [api]);

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
              <div className="text-sm font-medium">
                {company.data?.plan_label ?? '―'}
                {company.data?.billing_model === 'metered' && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-[#3B7DD8]/10 text-[#2E66B5]">従量課金</span>
                )}
              </div>
            </div>
            <span className="px-3 py-1.5 rounded-full text-xs font-medium bg-[#0F9B8E]/10 text-[#0F9B8E]">
              {company.data?.status === 'active' ? '本稼働中' : (company.data?.status ?? '―')}
            </span>
          </div>
        </div>
        {available.length > 1 && (
          <nav className="flex gap-1 mt-4 overflow-x-auto" aria-label="機能">
            {available.map((m) => (
              <button
                key={m.key}
                onClick={() => setActive(m.key)}
                className={`px-3.5 py-2 text-sm font-medium rounded-t-lg whitespace-nowrap transition-colors ${
                  active === m.key ? 'bg-[#1A2332] text-white' : 'text-[#667085] hover:text-[#1A2332] hover:bg-[#F2F4F7]'
                }`}
              >
                {m.label}
                {m.cms && <span className="ml-1.5 text-[10px] font-mono opacity-70">CMS</span>}
              </button>
            ))}
          </nav>
        )}
        {available.length === 1 && <div className="h-4" />}
      </header>

      <div className="flex-1 min-h-0">
        {active === 'dashboard' && <CustomerDashboard />}
        {active === 'calls' && <CallEntry />}
        {active === 'faqs' && <FaqManager />}
        {active === 'unanswered' && <UnansweredReview />}
        {active === 'settings' && <ResponseSettingsPage />}
      </div>
    </div>
  );
}
