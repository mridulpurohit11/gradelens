import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL, api, onAuthError, setToken } from './api';
import { storage } from './storage';
import { isNative } from './platform';
import { applyTheme } from './theme';
import type { AuthConfig, Me } from './types';

type AuthState = {
  ready: boolean;
  token: string | null;
  me: Me | undefined;
  meLoading: boolean;
  meError: unknown;
  reauthNeeded: boolean;
  signingIn: boolean;
  config: AuthConfig | undefined;
  signInWithGoogle: () => Promise<void>;
  cancelSignIn: () => void;
  completeWebLogin: (code: string) => Promise<void>;
  devLogin: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<unknown>;
};

const Ctx = createContext<AuthState | null>(null);
const TOKEN_KEY = 'gl.token';

function randomSession() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [token, setTok] = useState<string | null>(null);
  const [reauthNeeded, setReauth] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    storage.get(TOKEN_KEY).then((t) => {
      setToken(t);
      setTok(t);
      setReady(true);
    });
  }, []);

  const saveToken = useCallback(async (t: string | null) => {
    setToken(t);
    setTok(t);
    if (t) await storage.set(TOKEN_KEY, t);
    else await storage.remove(TOKEN_KEY);
  }, []);

  const signOut = useCallback(async () => {
    await saveToken(null);
    setReauth(false);
    qc.clear();
  }, [qc, saveToken]);

  useEffect(
    () =>
      onAuthError((code) => {
        if (code === 'GOOGLE_REAUTH') setReauth(true);
        else void signOut();
      }),
    [signOut],
  );

  const config = useQuery({ queryKey: ['auth-config'], queryFn: () => api<AuthConfig>('/auth/config'), staleTime: 5 * 60_000 });

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/me'),
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (meQuery.data) applyTheme(meQuery.data.preferences.theme);
  }, [meQuery.data]);

  const signInWithGoogle = useCallback(async () => {
    if (!isNative) {
      const ret = encodeURIComponent(window.location.origin);
      window.location.href = `${API_URL}/api/auth/google/start?platform=web&return=${ret}`;
      return;
    }
    // Native: sign in inside the system browser, then poll the server for the result.
    const session = randomSession();
    cancelRef.current = false;
    setSigningIn(true);
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url: `${API_URL}/api/auth/google/start?platform=native&session=${session}`, presentationStyle: 'popover' });
    const started = Date.now();
    try {
      while (!cancelRef.current && Date.now() - started < 5 * 60_000) {
        await new Promise((r) => setTimeout(r, 1500));
        const r = await api<{ status: string; token?: string; error?: string }>(`/auth/session/${session}`).catch(() => ({ status: 'pending' }) as { status: string; token?: string; error?: string });
        if (r.status === 'done' && r.token) {
          await saveToken(r.token);
          setReauth(false);
          await qc.invalidateQueries();
          Browser.close().catch(() => undefined);
          return;
        }
        if (r.status === 'error' || r.status === 'expired') {
          Browser.close().catch(() => undefined);
          throw new Error(r.error ?? 'Sign-in expired. Please try again.');
        }
      }
    } finally {
      setSigningIn(false);
    }
  }, [qc, saveToken]);

  const completeWebLogin = useCallback(
    async (code: string) => {
      const r = await api<{ token: string }>('/auth/exchange', { method: 'POST', body: { code } });
      await saveToken(r.token);
      setReauth(false);
      await qc.invalidateQueries();
    },
    [qc, saveToken],
  );

  const devLogin = useCallback(async () => {
    const r = await api<{ token: string }>('/auth/dev-login', { method: 'POST', body: {} });
    await saveToken(r.token);
    await qc.invalidateQueries();
  }, [qc, saveToken]);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      token,
      me: meQuery.data,
      meLoading: meQuery.isLoading,
      meError: meQuery.error,
      reauthNeeded,
      signingIn,
      config: config.data,
      signInWithGoogle,
      cancelSignIn: () => {
        cancelRef.current = true;
        setSigningIn(false);
      },
      completeWebLogin,
      devLogin,
      signOut,
      refreshMe: () => meQuery.refetch(),
    }),
    [ready, token, meQuery, reauthNeeded, signingIn, config.data, signInWithGoogle, completeWebLogin, devLogin, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
