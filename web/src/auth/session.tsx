import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DemoIdentity } from '../api/demoIdentities';
import { createHttpApi } from '../api/http';
import { ApiError, type Me, type PortalApi, type Role } from '../api/types';
import { createFirebaseClient, type FirebaseClient } from './firebase';

export const IS_DEMO = import.meta.env.VITE_DEMO === 'true';

/** ログイン画面の出し分け */
export type LoginMode =
  | { kind: 'loading' }
  | { kind: 'demo' }
  | { kind: 'dev' } // ローカル開発（API が AUTH_MODE=insecure-dev のとき）
  | { kind: 'firebase'; client: FirebaseClient }
  | { kind: 'error'; message: string };

interface Session {
  me: Me;
  api: PortalApi;
}

interface SessionContextValue {
  mode: LoginMode;
  session: Session | null;
  problem: string | null;
  signInDemo(identity: DemoIdentity): void;
  signInDev(role: Role, companyCode: string | null): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('SessionProvider がありません');
  return ctx;
}

export function useApi(): PortalApi {
  const { session } = useSession();
  if (!session) throw new Error('ログインしていません');
  return session.api;
}

async function openSession(api: PortalApi): Promise<Session> {
  return { me: await api.me(), api };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LoginMode>(IS_DEMO ? { kind: 'demo' } : { kind: 'loading' });
  const [session, setSession] = useState<Session | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (IS_DEMO) return;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error(`status ${res.status}`);
        const config = await res.json();
        if (config.auth_mode === 'insecure-dev') {
          setMode({ kind: 'dev' });
          return;
        }
        const client = await createFirebaseClient(config.firebase);
        setMode({ kind: 'firebase', client });
        unsubscribe = client.onUserChanged(async (user) => {
          if (!user) {
            setSession(null);
            return;
          }
          try {
            setSession(await openSession(createHttpApi(() => user.getIdToken())));
            setProblem(null);
          } catch (e) {
            // ログインはできたが、ポータルの利用権限（カスタムクレーム）がない
            setSession(null);
            setProblem(e instanceof ApiError ? e.message : 'ログイン情報を確認できませんでした');
          }
        });
      } catch {
        setMode({ kind: 'error', message: 'サーバーに接続できません。時間をおいて再度お試しください。' });
      }
    })();
    return () => unsubscribe?.();
  }, []);

  const signInDemo = useCallback((identity: DemoIdentity) => {
    // デモデータは必要になったときだけ読み込む（本番の画面には含めない）
    void import('../api/demo').then(({ createDemoApi }) =>
      openSession(createDemoApi(identity)).then(setSession),
    );
  }, []);

  const signInDev = useCallback(async (role: Role, companyCode: string | null) => {
    const token = `dev:${role}:${companyCode ?? ''}`;
    try {
      setSession(await openSession(createHttpApi(async () => token)));
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const signOut = useCallback(async () => {
    if (mode.kind === 'firebase') await mode.client.signOut();
    setSession(null);
  }, [mode]);

  const value = useMemo(
    () => ({ mode, session, problem, signInDemo, signInDev, signOut }),
    [mode, session, problem, signInDemo, signInDev, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
