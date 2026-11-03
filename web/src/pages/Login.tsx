import { useState, type FormEvent } from 'react';
import { DEMO_IDENTITIES } from '../api/demoIdentities';
import { useSession } from '../auth/session';
import type { FirebaseClient } from '../auth/firebase';

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle: string }) {
  return (
    <div className="min-h-full flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6">
          <div className="font-mono text-[11px] tracking-wider text-[#667085]">AI CALL CENTER</div>
          <h1 className="font-display font-bold text-2xl mt-1">顧客ポータル</h1>
          <p className="text-sm text-[#667085] mt-2">{subtitle}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#E4E7EC] p-6">{children}</div>
      </div>
    </div>
  );
}

function FirebaseLogin({ client }: { client: FirebaseClient }) {
  const { problem } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await client.signIn(email, password);
    } catch {
      // どちらが違うかは伝えない（アカウントの有無を推測されないため）
      setMessage('メールアドレスまたはパスワードが正しくありません');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!email) {
      setMessage('パスワードを再設定するメールアドレスを入力してください');
      return;
    }
    await client.sendPasswordReset(email).catch(() => undefined);
    setMessage('登録されているアドレスであれば、再設定用のメールを送信しました');
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm">
        <span className="text-[#475467]">メールアドレス</span>
        <input
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[#D0D5DD] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0F9B8E]/40"
        />
      </label>
      <label className="block text-sm">
        <span className="text-[#475467]">パスワード</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-[#D0D5DD] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#0F9B8E]/40"
        />
      </label>
      {(message || problem) && (
        <p className="text-sm text-[#B42318]" role="alert">
          {message || problem}
        </p>
      )}
      <button
        disabled={busy}
        className="w-full rounded-lg bg-[#0F9B8E] text-white py-2.5 text-sm font-medium disabled:opacity-60"
      >
        {busy ? 'ログイン中…' : 'ログイン'}
      </button>
      <button type="button" onClick={reset} className="w-full text-xs text-[#667085] hover:text-[#1A2332]">
        パスワードを忘れた場合
      </button>
    </form>
  );
}

function IdentityPicker({ note }: { note: string }) {
  const { mode, signInDemo, signInDev, problem } = useSession();
  return (
    <div className="space-y-3">
      <p className="text-xs text-[#667085]">{note}</p>
      {DEMO_IDENTITIES.map((id) => (
        <button
          key={id.label}
          onClick={() => (mode.kind === 'demo' ? signInDemo(id) : signInDev(id.role, id.company_code))}
          className="w-full text-left rounded-xl border border-[#E4E7EC] px-4 py-3 hover:border-[#0F9B8E]/50 hover:bg-[#0F9B8E]/5 transition-colors"
        >
          <div className="text-sm font-medium">{id.label}</div>
          <div className="text-xs text-[#667085] mt-0.5">{id.description}</div>
        </button>
      ))}
      {problem && <p className="text-sm text-[#B42318]">{problem}</p>}
    </div>
  );
}

export default function Login() {
  const { mode } = useSession();
  switch (mode.kind) {
    case 'loading':
      return <Shell subtitle="読み込み中…">{null}</Shell>;
    case 'error':
      return (
        <Shell subtitle="">
          <p className="text-sm text-[#B42318]">{mode.message}</p>
        </Shell>
      );
    case 'demo':
      return (
        <Shell subtitle="デモ版です。架空のデータで、ログインせずに画面を確認できます。">
          <IdentityPicker note="表示するユーザーを選んでください" />
        </Shell>
      );
    case 'dev':
      return (
        <Shell subtitle="ローカル開発モード（AUTH_MODE=insecure-dev）">
          <IdentityPicker note="API に開発用トークンを送ってログインします。本番では使えません。" />
        </Shell>
      );
    case 'firebase':
      return (
        <Shell subtitle="ご契約時にお知らせしたメールアドレスでログインしてください。">
          <FirebaseLogin client={mode.client} />
        </Shell>
      );
  }
}
