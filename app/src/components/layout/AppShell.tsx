import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, apiBlob } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Notification } from '@/lib/types';
import { fmtDateTime } from '@/lib/format';
import { Avatar, Button, ConfirmDialog, Icon, IconButton } from '@/components/ui';

// ---------- Teacher photo ----------

export function useTeacherPhoto() {
  const { me } = useAuth();
  const q = useQuery({
    queryKey: ['me-photo', me?.photoVersion],
    queryFn: async () => URL.createObjectURL((await apiBlob('/me/photo')).blob),
    enabled: Boolean(me?.hasPhoto),
    staleTime: Infinity,
  });
  return me?.hasPhoto ? (q.data ?? null) : (me?.googlePicture ?? null);
}

// ---------- Nav ----------

export const NAV = [
  { to: '/', label: 'Home', icon: 'space_dashboard', end: true },
  { to: '/classes', label: 'Classes', icon: 'class' },
  { to: '/assignments', label: 'Assignments', icon: 'assignment' },
  { to: '/reports', label: 'Reports', icon: 'bar_chart' },
  { to: '/profile', label: 'Profile', icon: 'account_circle' },
];

export function Logo({ compact, sub }: { compact?: boolean; sub?: string }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-ctl bg-primary text-[15px] font-bold tracking-tight text-primary-on">GL</span>
      {!compact ? (
        <span className="leading-tight">
          <span className="block text-h3 font-bold text-primary dark:text-ink">GradeLens</span>
          {sub ? <span className="block text-caption uppercase tracking-[0.08em] text-muted">{sub}</span> : null}
        </span>
      ) : null}
    </Link>
  );
}

function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: Notification[]; unread: number }>('/notifications'),
    refetchInterval: 60_000,
  });
}

function NotificationList({ onNavigate }: { onNavigate?: () => void }) {
  const { data, isLoading } = useNotifications();
  const nav = useNavigate();
  if (isLoading) return <p className="p-4 text-small text-muted">Loading…</p>;
  if (!data?.items.length) return <p className="p-6 text-center text-small text-muted">You have no notifications.</p>;
  return (
    <ul className="divide-y divide-line">
      {data.items.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => {
              onNavigate?.();
              if (n.link) nav(n.link);
            }}
            className="flex w-full gap-3 px-4 py-3 text-left hover:bg-subtle"
          >
            <Icon
              name={n.type === 'FRAUD' ? 'flag' : n.type === 'ACTION_REQUIRED' ? 'error' : 'task_alt'}
              className={clsx('mt-0.5', n.type === 'FRAUD' || n.type === 'ACTION_REQUIRED' ? 'text-danger' : 'text-success')}
            />
            <span className="min-w-0 flex-1">
              <span className={clsx('block text-small text-ink', !n.read && 'font-semibold')}>{n.title}</span>
              <span className="block text-small text-muted">{n.body}</span>
              <span className="mt-0.5 block text-caption text-muted">{fmtDateTime(n.createdAt)}</span>
            </span>
            {!n.read ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" /> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function useMarkRead() {
  const qc = useQueryClient();
  return () =>
    api('/notifications/read', { method: 'POST' })
      .then(() => qc.invalidateQueries({ queryKey: ['notifications'] }))
      .catch(() => undefined);
}

export function NotificationsBell() {
  const { data } = useNotifications();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const markRead = useMarkRead();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <IconButton
        icon="notifications"
        label="Notifications"
        badge={data?.unread}
        onClick={() => {
          if (window.matchMedia('(min-width: 1024px)').matches) {
            setOpen((o) => !o);
            if (!open && data?.unread) void markRead();
          } else nav('/notifications');
        }}
      />
      {open ? (
        <div className="absolute right-0 top-12 z-50 w-96 overflow-hidden rounded-card border border-line bg-surface shadow-pop">
          <div className="border-b border-line px-4 py-3 text-h3">Notifications</div>
          <div className="max-h-[420px] overflow-y-auto">
            <NotificationList onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function NotificationsPage() {
  const markRead = useMarkRead();
  useEffect(() => {
    void markRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Page title="Notifications" back="/">
      <div className="card overflow-hidden">
        <NotificationList />
      </div>
    </Page>
  );
}

// ---------- Search (desktop top bar) ----------

type SearchResult = {
  classes: { id: string; label: string; subjectName: string }[];
  assignments: { id: string; title: string; classLabel: string }[];
  students: { id: string; name: string; rollNo: string; classId: string; classLabel: string }[];
};

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { data } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api<SearchResult>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
  });
  const go = (to: string) => {
    setOpen(false);
    setQ('');
    nav(to);
  };
  const empty = data && !data.classes.length && !data.assignments.length && !data.students.length;
  return (
    <div className="relative w-full max-w-md">
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search students, classes, assignments"
        className="input h-10 pl-10"
        aria-label="Search"
      />
      {open && q.trim().length >= 2 && data ? (
        <div className="absolute left-0 right-0 top-12 z-50 max-h-[420px] overflow-y-auto rounded-card border border-line bg-surface py-2 shadow-pop">
          {empty ? <p className="px-4 py-3 text-small text-muted">No results for “{q}”.</p> : null}
          {data.classes.length ? <p className="eyebrow px-4 pb-1 pt-2">Classes</p> : null}
          {data.classes.map((c) => (
            <button key={c.id} onMouseDown={() => go(`/classes/${c.id}`)} className="block w-full px-4 py-2 text-left hover:bg-subtle">
              <span className="block text-small font-semibold">{c.label}</span>
              <span className="block text-caption text-muted">{c.subjectName}</span>
            </button>
          ))}
          {data.assignments.length ? <p className="eyebrow px-4 pb-1 pt-2">Assignments</p> : null}
          {data.assignments.map((a) => (
            <button key={a.id} onMouseDown={() => go(`/assignments/${a.id}`)} className="block w-full px-4 py-2 text-left hover:bg-subtle">
              <span className="block text-small font-semibold">{a.title}</span>
              <span className="block text-caption text-muted">{a.classLabel}</span>
            </button>
          ))}
          {data.students.length ? <p className="eyebrow px-4 pb-1 pt-2">Students</p> : null}
          {data.students.map((s) => (
            <button key={s.id} onMouseDown={() => go(`/classes/${s.classId}?tab=students`)} className="block w-full px-4 py-2 text-left hover:bg-subtle">
              <span className="block text-small font-semibold">
                {s.name} <span className="font-normal text-muted">· {s.rollNo}</span>
              </span>
              <span className="block text-caption text-muted">{s.classLabel}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Page context ----------

type PageMeta = { title: string; back?: string | number };
const PageCtx = createContext<(m: PageMeta) => void>(() => undefined);

function ReauthBanner() {
  const { reauthNeeded, signInWithGoogle } = useAuth();
  if (!reauthNeeded) return null;
  return (
    <div className="border-b border-warning/40 bg-warning-tint px-4 py-2.5 text-small text-ink lg:px-8">
      <div className="mx-auto flex max-w-content flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Icon name="link_off" className="text-warning" /> Google Drive access has expired. Sign in again to continue evaluating.
        </span>
        <Button size="sm" variant="secondary" onClick={() => void signInWithGoogle()}>
          Sign in again
        </Button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<PageMeta>({ title: '' });
  const { me, signOut } = useAuth();
  const photo = useTeacherPhoto();
  const nav = useNavigate();
  const [confirmOut, setConfirmOut] = useState(false);
  return (
    <PageCtx.Provider value={setMeta}>
      <div className="min-h-dvh lg:pl-[260px]">
        {/* Desktop sidebar */}
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[260px] flex-col border-r border-line bg-surface lg:flex">
          <div className="flex h-16 items-center border-b border-line px-6">
            <Logo />
          </div>
          <nav className="flex-1 space-y-1 p-3" aria-label="Main">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  clsx(
                    'relative flex h-11 items-center gap-3 rounded-ctl px-4 text-body transition-colors',
                    isActive ? 'bg-primary-tint font-semibold text-primary before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-primary' : 'text-muted hover:bg-subtle hover:text-ink',
                  )
                }
              >
                <Icon name={n.icon} size={22} />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="space-y-1 border-t border-line p-3">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                clsx('flex h-11 items-center gap-3 rounded-ctl px-4 text-body', isActive ? 'bg-primary-tint font-semibold text-primary' : 'text-muted hover:bg-subtle hover:text-ink')
              }
            >
              <Icon name="settings" size={22} />
              Settings
            </NavLink>
            <button type="button" onClick={() => setConfirmOut(true)} className="flex h-11 w-full items-center gap-3 rounded-ctl px-4 text-body text-danger hover:bg-danger-tint">
              <Icon name="logout" size={22} />
              Log out
            </button>
          </div>
        </aside>

        {/* Desktop top bar */}
        <header className="sticky top-0 z-20 hidden h-16 items-center gap-6 border-b border-line bg-surface/95 px-8 backdrop-blur lg:flex">
          <div className="flex min-w-0 items-center gap-2">
            {meta.back !== undefined ? (
              <IconButton icon="arrow_back" label="Back" onClick={() => (typeof meta.back === 'number' ? nav(meta.back) : nav(meta.back!))} className="-ml-2" />
            ) : null}
            <h1 className="truncate text-h2 text-ink">{meta.title}</h1>
          </div>
          <div className="flex flex-1 justify-center">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-3">
            <NotificationsBell />
            <span className="h-8 w-px bg-line" />
            <Link to="/profile" className="flex items-center gap-3 rounded-ctl p-1 pr-2 hover:bg-subtle">
              <Avatar name={me?.name} src={photo} size={38} />
              <span className="hidden max-w-[220px] leading-tight xl:block">
                <span className="block truncate text-small font-semibold text-ink">{me?.name}</span>
                <span className="block truncate text-caption text-muted">{me?.department ? `Dept. of ${me.department}` : me?.designation}</span>
              </span>
            </Link>
          </div>
        </header>

        <ReauthBanner />
        {children}
      </div>
      <LogoutDialog open={confirmOut} onClose={() => setConfirmOut(false)} onConfirm={() => void signOut()} />
    </PageCtx.Provider>
  );
}

export function LogoutDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      tone="danger"
      icon="logout"
      title="Log out of GradeLens?"
      body="Any evaluation in progress will continue on the server."
      confirmLabel="Log out"
    />
  );
}

// ---------- Page wrapper ----------

export function Page({
  title,
  back,
  tab,
  actions,
  children,
  className,
  bottomBar,
  mobileTitle,
}: {
  title: string;
  back?: string | number;
  tab?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bottomBar?: ReactNode;
  mobileTitle?: ReactNode;
}) {
  const setMeta = useContext(PageCtx);
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    setMeta({ title, back });
    document.title = `${title} · GradeLens`;
  }, [title, back, setMeta]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  return (
    <>
      {/* Mobile header */}
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-surface lg:hidden">
        <div className="flex h-14 items-center gap-1 px-2">
          {tab ? (
            <div className="flex-1 pl-2">
              <Logo />
            </div>
          ) : (
            <>
              <IconButton icon="arrow_back" label="Back" onClick={() => (typeof back === 'number' ? nav(back) : back ? nav(back) : nav(-1))} />
              <h1 className="min-w-0 flex-1 truncate pl-1 text-h3 text-ink">{mobileTitle ?? title}</h1>
            </>
          )}
          <div className="flex items-center gap-0.5">
            {actions}
            {tab ? <NotificationsBell /> : null}
          </div>
        </div>
      </header>

      <main
        className={clsx(
          'mx-auto w-full px-4 pb-8 pt-4 sm:px-6 lg:px-8 lg:pt-8',
          'max-w-content',
          tab && 'pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-10',
          bottomBar && 'pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-10',
          className,
        )}
      >
        {children}
        {bottomBar ? <div className="mt-6 hidden justify-end gap-3 lg:flex">{bottomBar}</div> : null}
      </main>

      {bottomBar ? (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 backdrop-blur lg:hidden">
          <div className="flex gap-3 pb-3 [&>*]:flex-1">{bottomBar}</div>
        </div>
      ) : null}

      {tab ? <BottomNav /> : null}
    </>
  );
}

export function BottomNav() {
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface lg:hidden" aria-label="Main">
      <div className="mx-auto flex h-16 max-w-xl">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              clsx('flex flex-1 flex-col items-center justify-center gap-0.5 text-caption', isActive ? 'font-semibold text-primary' : 'text-muted')
            }
          >
            {({ isActive }) => (
              <>
                <Icon name={n.icon} size={24} fill={isActive} />
                {n.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
