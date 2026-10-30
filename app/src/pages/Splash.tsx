import { Button, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function Splash({ error }: { error?: unknown }) {
  const { signOut, refreshMe } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-[14px] bg-primary text-[22px] font-bold tracking-tight text-primary-on">GL</span>
      <h1 className="mt-4 text-h1 text-ink">GradeLens</h1>
      {error ? (
        <div className="mt-6 max-w-sm">
          <p className="text-body text-muted">{error instanceof Error ? error.message : 'Unable to connect to the server.'}</p>
          <div className="mt-4 flex justify-center gap-3">
            <Button variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
            <Button icon="refresh" onClick={() => void refreshMe()}>
              Retry
            </Button>
          </div>
        </div>
      ) : (
        <Spinner className="mt-8 h-6 w-6 text-primary" />
      )}
    </div>
  );
}
