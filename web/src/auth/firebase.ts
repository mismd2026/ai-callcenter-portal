// Firebase Authentication。デモ版の容量を増やさないよう、必要になったときだけ読み込む。
import type { Auth, User } from 'firebase/auth';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
}

export interface FirebaseClient {
  onUserChanged(cb: (user: User | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
}

export async function createFirebaseClient(config: FirebaseWebConfig): Promise<FirebaseClient> {
  const { initializeApp } = await import('firebase/app');
  const authModule = await import('firebase/auth');
  const app = initializeApp(config);
  const auth: Auth = authModule.getAuth(app);
  auth.languageCode = 'ja';

  return {
    onUserChanged: (cb) => authModule.onIdTokenChanged(auth, cb),
    signIn: async (email, password) => {
      await authModule.signInWithEmailAndPassword(auth, email, password);
    },
    sendPasswordReset: (email) => authModule.sendPasswordResetEmail(auth, email),
    signOut: () => authModule.signOut(auth),
  };
}
