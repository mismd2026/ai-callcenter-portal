import { IS_DEMO, SessionProvider, useSession } from './auth/session';
import CustomerShell from './pages/CustomerShell';
import Login from './pages/Login';
import OpsConsole from './pages/OpsConsole';

const ROLE_LABEL: Record<string, string> = {
  company_admin: '契約管理者',
  operator: 'オペレーター',
  viewer: '閲覧者',
  ops_admin: '運用管理者',
};

function TopBar() {
  const { session, signOut } = useSession();
  if (!session) return null;
  const { me } = session;
  const dark = me.role === 'ops_admin';
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 sm:px-8 py-2 text-xs ${
        dark ? 'bg-[#0B0E12] text-[#8B95A5]' : 'bg-[#1A2332] text-[#D0D5DD]'
      }`}
    >
      <span className="truncate">
        {IS_DEMO && <span className="mr-2 rounded bg-[#F5A623]/20 text-[#F5A623] px-1.5 py-0.5">デモ</span>}
        {me.email ?? me.company_code ?? ''}
        <span className="ml-1">{ROLE_LABEL[me.role]}</span>
      </span>
      <button onClick={() => void signOut()} className="shrink-0 hover:text-white">
        {IS_DEMO ? 'ユーザーを切り替える' : 'ログアウト'}
      </button>
    </div>
  );
}

function Routes() {
  const { session } = useSession();
  if (!session) return <Login />;
  return (
    <div className="h-full flex flex-col">
      <TopBar />
      <div className="flex-1 min-h-0 overflow-y-auto">
        {session.me.role === 'ops_admin' ? <OpsConsole /> : <CustomerShell />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Routes />
    </SessionProvider>
  );
}
