import type { ReactNode } from 'react';
import { Chip } from '@/components/ui';

export function SetupShell({ children, badge }: { children: ReactNode; badge?: ReactNode }) {
  return (
    <div
      className="min-h-dvh bg-bg"
      style={{ backgroundImage: 'radial-gradient(rgb(var(--line)) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
    >
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-content items-center justify-between px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-ctl bg-primary text-[15px] font-bold text-primary-on">GL</span>
            <span className="leading-tight">
              <span className="block text-h3 font-bold text-primary dark:text-ink">GradeLens</span>
              <span className="block text-caption uppercase tracking-[0.08em] text-muted">Faculty onboarding</span>
            </span>
          </div>
          {badge ?? <Chip tone="primary">Faculty</Chip>}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[600px] px-4 pb-32 pt-6 sm:pt-10 lg:pb-16">{children}</main>
    </div>
  );
}
