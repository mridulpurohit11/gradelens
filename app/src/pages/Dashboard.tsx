import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Dashboard as DashboardData } from '@/lib/types';
import { fmtDate, fmtNum, greeting } from '@/lib/format';
import { Page } from '@/components/layout/AppShell';
import { Button, Card, EmptyState, ErrorState, Icon, ProgressBar, Skeleton, StatCard } from '@/components/ui';
import { AssignmentChip } from '@/components/ui/status';
import { AssignmentCard, assignmentAction, progressOf } from '@/components/assignment';

export default function Dashboard() {
  const { me, config } = useAuth();
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api<DashboardData>('/dashboard'),
    refetchInterval: (q) => (q.state.data?.recent.some((r) => r.status === 'EVALUATING' && !r.paused) ? 10_000 : false),
  });
  const s = data?.stats;
  const subtitle = [me?.department ? `Department of ${me.department}` : null, me?.university].filter(Boolean).join(' · ');

  return (
    <Page title="Dashboard" tab>
      {/* Greeting */}
      <section className="mb-5 lg:card lg:mb-6 lg:flex lg:items-center lg:justify-between lg:p-6">
        <div>
          <h1 className="text-h2 text-ink lg:text-[28px] lg:leading-9 lg:text-primary dark:lg:text-ink">
            {greeting()}, {me?.name}
          </h1>
          {subtitle ? <p className="mt-1 text-small text-muted lg:text-body">{subtitle}</p> : null}
        </div>
        <div className="mt-4 hidden gap-3 lg:mt-0 lg:flex">
          <Button variant="secondary" icon="group_add" onClick={() => nav('/classes/new')}>
            Add Class
          </Button>
          <Button icon="add" onClick={() => nav('/assignments/new')}>
            New Assignment
          </Button>
        </div>
      </section>

      {/* Stats */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-card" />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : s ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatCard label="Assignments Checked" value={fmtNum(s.assignmentsChecked)} sub={`${s.activeAssignments} active`} icon="assignment_turned_in" onClick={() => nav('/assignments')} />
          <StatCard label="Students Evaluated" value={fmtNum(s.studentsEvaluated)} sub={`Across ${s.classesEvaluated} ${s.classesEvaluated === 1 ? 'class' : 'classes'}`} icon="groups" />
          <StatCard
            label="Pending Reviews"
            value={fmtNum(s.pendingReviews)}
            sub={s.pendingReviews ? 'Action needed' : 'All clear'}
            tone={s.pendingReviews ? 'warning' : undefined}
            icon="rate_review"
            onClick={() => nav('/assignments?filter=review')}
          />
          <StatCard
            label="Fraud Flags"
            value={fmtNum(s.fraudFlags)}
            sub={s.fraudFlags ? `${s.duplicateFlags} duplicate${s.duplicateFlags === 1 ? '' : 's'}, ${s.handwritingFlags} handwriting` : 'None open'}
            tone={s.fraudFlags ? 'danger' : undefined}
            icon="flag"
            onClick={() => nav('/assignments?filter=review')}
          />
        </div>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Recent assignments */}
        <section>
          {/* Mobile quick actions */}
          <div className="mb-6 lg:hidden">
            <p className="eyebrow mb-3">Quick actions</p>
            <div className="grid grid-cols-2 gap-3">
              <Button icon="add" size="lg" onClick={() => nav('/assignments/new')}>
                New Assignment
              </Button>
              <Button icon="group_add" size="lg" variant="secondary" onClick={() => nav('/classes/new')}>
                Add Class
              </Button>
            </div>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-h3 text-ink">Recent Assignments</h2>
            {data && data.totalAssignments > 0 ? (
              <Link to="/assignments" className="text-small font-semibold text-primary hover:underline">
                View all
              </Link>
            ) : null}
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-36 rounded-card" />
              ))}
            </div>
          ) : data && data.recent.length === 0 ? (
            <EmptyState
              icon="assignment_add"
              title={data.stats.classes ? 'No assignments yet' : 'Start by adding a class'}
              body={data.stats.classes ? 'Create an assignment to generate an answer key and evaluate submissions.' : 'Register a class with its students and the Drive folder where they submit work.'}
              action={
                <Button icon="add" onClick={() => nav(data.stats.classes ? '/assignments/new' : '/classes/new')}>
                  {data.stats.classes ? 'New Assignment' : 'Add Class'}
                </Button>
              }
            />
          ) : data ? (
            <>
              <div className="space-y-3 lg:hidden">
                {data.recent.map((a) => (
                  <AssignmentCard key={a.id} a={a} />
                ))}
              </div>
              <Card padded={false} className="hidden overflow-hidden lg:block">
                <table className="w-full text-left">
                  <thead className="border-b border-line bg-subtle/60">
                    <tr className="text-caption font-semibold uppercase tracking-[0.05em] text-muted">
                      <th className="w-[36%] px-5 py-3">Assignment</th>
                      <th className="px-3 py-3">Due date</th>
                      <th className="w-40 px-3 py-3">Progress</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.recent.map((a) => {
                      const act = assignmentAction(a);
                      const p = progressOf(a);
                      const flagged = a.needsReview + a.suspicious;
                      const showP = !['DRAFT', 'KEY_READY'].includes(a.status);
                      return (
                        <tr key={a.id} className="cursor-pointer hover:bg-subtle/60" onClick={() => nav(act.to)}>
                          <td className="px-5 py-4">
                            <p className="text-body font-semibold text-primary dark:text-ink">{a.title}</p>
                            <p className="text-small text-muted">{a.classLabel}</p>
                          </td>
                          <td className="tnum whitespace-nowrap px-3 py-4 text-small text-ink">{fmtDate(a.dueDate)}</td>
                          <td className="px-3 py-4">
                            {showP ? (
                              <>
                                <div className="mb-1.5 flex justify-between text-caption">
                                  <span className="tnum font-semibold text-ink">
                                    {p.done}/{p.denom}
                                  </span>
                                  <span className="tnum text-muted">{Math.round(p.value * 100)}%</span>
                                </div>
                                <ProgressBar value={p.value} tone={a.status === 'COMPLETED' ? 'success' : a.status === 'REVIEW' && flagged ? 'warning' : 'primary'} />
                              </>
                            ) : (
                              <span className="text-small text-muted">Not started</span>
                            )}
                          </td>
                          <td className="px-3 py-4">
                            <AssignmentChip status={a.status} paused={a.paused} needsReview={flagged} />
                          </td>
                          <td className="px-5 py-4 text-right">
                            <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-small font-semibold text-primary">
                              {act.label}
                              <Icon name="chevron_right" size={18} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex items-center justify-between border-t border-line px-5 py-3 text-small text-muted">
                  <span>
                    Showing {data.recent.length} of {data.totalAssignments} assignments
                  </span>
                  <Link to="/assignments" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                    View all assignments <Icon name="arrow_forward" size={18} />
                  </Link>
                </div>
              </Card>
            </>
          ) : null}
        </section>

        {/* Right column (desktop) */}
        <aside className="hidden space-y-6 lg:block">
          <Card>
            <h2 className="border-b border-line pb-3 text-h3 text-ink">Quick Actions</h2>
            <div className="mt-4 space-y-3">
              <Button full size="lg" icon="add" onClick={() => nav('/assignments/new')}>
                New Assignment
              </Button>
              <Button full size="lg" variant="secondary" icon="group_add" onClick={() => nav('/classes/new')}>
                Add Class
              </Button>
              <Link to="/reports" className="flex items-center justify-between rounded-ctl px-1 py-2 text-body text-ink hover:text-primary">
                <span className="flex items-center gap-2">
                  <Icon name="bar_chart" className="text-muted" /> View class reports
                </span>
                <Icon name="chevron_right" className="text-muted" />
              </Link>
            </div>
          </Card>
          <Card>
            <h2 className="border-b border-line pb-3 text-h3 text-ink">Setup status</h2>
            <ul className="mt-4 space-y-3">
              <StatusRow ok={Boolean(me?.driveAccess)} icon="add_to_drive" title="Google Drive access" okText="Connected" badText="Sign in again to grant access" />
              <StatusRow ok={Boolean(config?.aiConfigured)} icon="smart_toy" title="AI evaluation (Claude)" okText="Ready" badText="API key not configured on server" />
              <StatusRow ok={(s?.classes ?? 0) > 0} icon="class" title="Classes registered" okText={`${s?.classes ?? 0} active`} badText="Add your first class" />
            </ul>
          </Card>
        </aside>
      </div>

      {/* Mobile FAB */}
      <button
        type="button"
        aria-label="New assignment"
        onClick={() => nav('/assignments/new')}
        className="fixed bottom-[calc(80px+env(safe-area-inset-bottom))] right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-on shadow-modal lg:hidden"
      >
        <Icon name="add" size={28} />
      </button>
    </Page>
  );
}

function StatusRow({ ok, icon, title, okText, badText }: { ok: boolean; icon: string; title: string; okText: string; badText: string }) {
  return (
    <li className="flex items-start gap-3 rounded-ctl border border-line bg-subtle/50 p-3">
      <Icon name={icon} className={ok ? 'text-accent' : 'text-warning'} />
      <div className="min-w-0 flex-1">
        <p className="text-small font-semibold text-ink">{title}</p>
        <p className={ok ? 'text-small text-success' : 'text-small text-warning'}>{ok ? okText : badText}</p>
      </div>
      <Icon name={ok ? 'check_circle' : 'error'} size={18} className={ok ? 'text-success' : 'text-warning'} />
    </li>
  );
}
