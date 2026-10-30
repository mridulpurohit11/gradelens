import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Banner, Button, Spinner } from '@/components/ui';

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function Login() {
  const { token, me, config, signInWithGoogle, signingIn, cancelSignIn, devLogin } = useAuth();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(params.get('error'));
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/';

  useEffect(() => {
    document.title = 'Sign in · GradeLens';
  }, []);

  if (token && me) return <Navigate to={me.profileComplete ? from : '/setup'} replace />;

  const google = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex min-h-dvh flex-col bg-bg"
      style={{
        backgroundImage:
          'linear-gradient(rgb(var(--line) / 0.35) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--line) / 0.35) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }}
    >
      <main className="safe-top flex flex-1 items-center justify-center px-4 py-10">
        <div className="card w-full max-w-[440px] px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-[14px] bg-primary text-[22px] font-bold tracking-tight text-primary-on">GL</span>
            <h1 className="mt-5 text-h1 text-ink">GradeLens</h1>
            <p className="mt-1 text-body text-muted">AI-assisted assignment evaluation for faculty</p>
          </div>

          <div className="mt-7 space-y-4">
            <Banner tone="info" icon="info">
              Sign in with your institutional Google account. GradeLens reads the Drive folders and sheets where students submit their work.
            </Banner>
            {config && !config.googleConfigured ? (
              <Banner tone="warning" title="Google sign-in is not configured">
                The server administrator needs to add the Google OAuth client ID and secret.
              </Banner>
            ) : null}
            {error ? <Banner tone="danger">{error}</Banner> : null}

            {signingIn ? (
              <div className="rounded-card border border-line p-4 text-center">
                <Spinner className="mx-auto h-6 w-6 text-primary" />
                <p className="mt-3 text-body text-ink">Complete the sign-in in your browser…</p>
                <Button variant="text" className="mt-2" onClick={cancelSignIn}>
                  Cancel
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={google}
                disabled={busy || (config && !config.googleConfigured)}
                className="flex h-12 w-full items-center justify-center gap-3 rounded-ctl border border-line bg-surface text-body font-semibold text-ink transition-colors hover:bg-subtle disabled:opacity-50"
              >
                {busy ? <Spinner className="h-5 w-5" /> : <GoogleG />}
                Continue with Google
              </button>
            )}

            {config?.devLogin ? (
              <Button
                variant="secondary"
                full
                icon="science"
                onClick={async () => {
                  try {
                    await devLogin();
                    nav('/', { replace: true });
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                Continue in demo mode
              </Button>
            ) : null}

            {config?.allowedDomains.length ? (
              <p className="text-center text-caption text-muted">Use your {config.allowedDomains.map((d) => '@' + d).join(' or ')} account.</p>
            ) : null}
            <p className="text-center text-caption text-muted">
              By continuing, you agree to use GradeLens in line with your institution&apos;s academic integrity and data protection policies.
            </p>
          </div>
        </div>
      </main>
      <footer className="safe-bottom border-t border-line bg-surface/80 py-4 text-center text-caption text-muted">For authorised faculty use only.</footer>
    </div>
  );
}
