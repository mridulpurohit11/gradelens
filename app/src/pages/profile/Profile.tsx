import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { TeacherStats } from '@/lib/types';
import { fmtDate, fmtMonthYear, fmtNum } from '@/lib/format';
import { Page } from '@/components/layout/AppShell';
import { Button, Card, Chip, Icon, IconButton, Skeleton } from '@/components/ui';
import { PhotoPicker } from '@/components/profile';

export default function Profile() {
  const { me } = useAuth();
  const nav = useNavigate();
  const stats = useQuery({ queryKey: ['me-stats'], queryFn: () => api<TeacherStats>('/me/stats') });
  if (!me) return null;
  const s = stats.data;

  return (
    <Page title="Faculty Profile" tab actions={<IconButton icon="settings" label="Settings" onClick={() => nav('/settings')} />}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card className="flex flex-col items-center text-center">
            <div className="[&>div]:flex-col [&>div]:text-center">
              <PhotoPicker me={me} size={104} />
            </div>
            <h1 className="mt-4 text-h2 text-ink">{me.name}</h1>
            {me.designation ? <p className="text-body font-semibold text-primary">{me.designation}</p> : null}
            {me.department ? <p className="text-body text-muted">Department of {me.department}</p> : null}
            {me.university ? (
              <p className="text-small text-muted">
                {me.university}
                {me.campus ? `, ${me.campus}` : ''}
              </p>
            ) : null}
            <div className="mt-5 w-full space-y-3 border-t border-line pt-4 text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-body text-ink">
                  <Icon name="mail" className="text-muted" />
                  <span className="truncate">{me.email}</span>
                </span>
                <Chip tone="success">Google</Chip>
              </div>
              {me.phone ? (
                <span className="flex items-center gap-2 text-body text-ink">
                  <Icon name="call" className="text-muted" />
                  {me.phone}
                </span>
              ) : null}
              {me.employeeId ? (
                <span className="flex items-center gap-2 text-body text-ink">
                  <Icon name="badge" className="text-muted" />
                  {me.employeeId}
                </span>
              ) : null}
            </div>
            {me.subjects.length ? (
              <div className="mt-4 w-full border-t border-line pt-4 text-left">
                <p className="eyebrow mb-2">Subjects</p>
                <div className="flex flex-wrap gap-2">
                  {me.subjects.map((x) => (
                    <span key={x} className="rounded-full border border-primary/20 bg-primary-tint px-3 py-1 text-small font-medium text-primary">
                      {x}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>
          <div className="grid gap-3">
            <Button size="lg" icon="edit" onClick={() => nav('/profile/edit')}>
              Edit Profile
            </Button>
            <Button size="lg" variant="secondary" icon="tune" onClick={() => nav('/settings')}>
              Settings
            </Button>
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-h3 text-ink">Evaluation summary</h2>
              <span className="flex items-center gap-1 text-small text-muted">
                <Icon name="calendar_month" size={18} /> Member since {fmtMonthYear(s?.memberSince ?? me.createdAt)}
              </span>
            </div>
            {stats.isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-28 rounded-card" />
                ))}
              </div>
            ) : s ? (
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <Stat icon="assignment_turned_in" label="Assignments Checked" value={fmtNum(s.assignmentsChecked)} />
                <Stat icon="groups" label="Students Evaluated" value={fmtNum(s.studentsEvaluated)} />
                <Stat icon="class" label="Classes Registered" value={fmtNum(s.classesRegistered)} />
                <Stat icon="flag" label="Fraud Cases Flagged" value={fmtNum(s.fraudFlagged)} danger={s.fraudFlagged > 0} sub={s.fraudConfirmed ? `${s.fraudConfirmed} confirmed` : undefined} />
              </div>
            ) : null}
          </div>

          <Card>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h2 className="text-h3 text-ink">Evaluation history</h2>
                <p className="text-small text-muted">Recently evaluated assignments</p>
              </div>
              <Link to="/assignments" className="text-small font-semibold text-primary hover:underline">
                View all
              </Link>
            </div>
            {!s?.history.length ? (
              <p className="py-6 text-center text-small text-muted">No evaluations yet.</p>
            ) : (
              <ol className="relative mt-2 border-l border-line pl-5">
                {s.history.map((h) => (
                  <li key={h.id} className="relative pb-5 last:pb-0">
                    <span className="absolute -left-[26px] top-1.5 h-3 w-3 rounded-full border-2 border-surface bg-primary" />
                    <Link to={`/assignments/${h.id}/results`} className="block rounded-ctl p-1 hover:bg-subtle">
                      <div className="flex items-start justify-between gap-2">
                        <span className="flex items-center gap-1 text-caption text-muted">
                          <Icon name="event" size={14} /> {fmtDate(h.date)}
                        </span>
                        <Chip tone="primary">
                          {h.course} · {h.semester?.replace('Semester ', 'Sem ')} · {h.section}
                        </Chip>
                      </div>
                      <p className="mt-1 text-body font-semibold text-ink">{h.title}</p>
                      <p className="flex items-center gap-1 text-small text-muted">
                        <Icon name="check_circle" size={16} className="text-success" /> {h.evaluated} students evaluated
                      </p>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}

function Stat({ icon, label, value, sub, danger }: { icon: string; label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-small text-muted">{label}</span>
        <Icon name={icon} size={20} className={danger ? 'text-danger' : 'text-primary'} />
      </div>
      <p className={`mt-2 text-stat ${danger ? 'text-danger' : 'text-ink'}`}>{value}</p>
      {sub ? <p className="text-small text-muted">{sub}</p> : null}
    </div>
  );
}
