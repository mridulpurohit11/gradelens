import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, errorMessage } from '@/lib/api';
import type { Assignment, Progress as ProgressData } from '@/lib/types';
import { fmtDuration, fmtInr, fmtNum, fmtPct } from '@/lib/format';
import { Page } from '@/components/layout/AppShell';
import { Banner, Button, Card, Chip, ErrorState, Icon, ProgressRing, SkeletonList } from '@/components/ui';
import { ReviewChip } from '@/components/ui/status';
import { useToast } from '@/components/ui/toast';

export default function Progress() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const a = useQuery({ queryKey: ['assignment', id], queryFn: () => api<Assignment>(`/assignments/${id}`) });
  const p = useQuery({
    queryKey: ['progress', id],
    queryFn: () => api<ProgressData>(`/assignments/${id}/progress`),
    refetchInterval: (q) => (q.state.data && q.state.data.status === 'EVALUATING' && !q.state.data.paused ? 3000 : false),
  });

  const data = p.data;
  const done = data && data.status !== 'EVALUATING';
  const pct = data?.total ? data.done / data.total : 0;

  const toggle = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await api(`/assignments/${id}/${data.paused ? 'resume' : 'pause'}`, { method: 'POST' });
      await p.refetch();
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.show(data.paused ? 'Evaluation resumed.' : 'Evaluation paused.');
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const title = a.data ? `${a.data.title} · ${a.data.class?.label ?? ''}` : '';

  const bottom = done ? (
    <Button size="lg" icon="fact_check" onClick={() => nav(`/assignments/${id}/results`)} className="lg:min-w-[220px]">
      View Results
    </Button>
  ) : (
    <>
      <Button size="lg" variant="secondary" icon="north_east" onClick={() => nav('/')}>
        Run in Background
      </Button>
      <Button size="lg" variant="tint" icon={data?.paused ? 'play_arrow' : 'pause'} onClick={toggle} loading={busy} className="!flex-none px-5">
        {data?.paused ? 'Resume' : 'Pause'}
      </Button>
    </>
  );

  return (
    <Page title="Evaluation in Progress" back="/assignments" bottomBar={data ? bottom : undefined} mobileTitle={<span className="block leading-tight">Evaluation in Progress<span className="block truncate text-caption font-normal text-muted">{title}</span></span>}>
      {p.isLoading ? (
        <SkeletonList rows={3} />
      ) : p.error || !data ? (
        <ErrorState error={p.error} onRetry={() => void p.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="space-y-5">
            <p className="hidden truncate text-body text-muted lg:block">{title}</p>
            <Card>
              <div className="mb-4 flex items-center justify-between border-b border-line pb-4">
                {done ? (
                  <Chip tone="success" icon="check_circle">
                    Evaluation complete
                  </Chip>
                ) : data.paused ? (
                  <Chip tone="warning" icon="pause_circle">
                    Paused
                  </Chip>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full border border-info/40 bg-info-tint px-3 py-1 text-caption font-semibold text-info">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-info" /> AI evaluation running
                  </span>
                )}
                <span className="text-caption text-muted">AI cost {fmtInr(data.costInr)}</span>
              </div>
              <div className="flex items-center gap-5">
                <ProgressRing value={pct} size={132}>
                  <span className="tnum text-h1 text-primary dark:text-ink">
                    {data.done}/{data.total}
                  </span>
                  <span className="text-caption text-muted">Evaluated</span>
                </ProgressRing>
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <p className="tnum text-h1 text-ink">{fmtPct(pct)}</p>
                    <p className="text-small text-muted">Completed</p>
                  </div>
                  <div className="border-t border-line pt-3 text-small text-ink">
                    {done ? (
                      <span className="flex items-center gap-1.5">
                        <Icon name="task_alt" size={18} className="text-success" /> {data.graded} graded{data.failed ? `, ${data.failed} unreadable` : ''}
                      </span>
                    ) : data.paused ? (
                      <span className="flex items-center gap-1.5">
                        <Icon name="pause_circle" size={18} className="text-warning" /> {data.total - data.done} waiting
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Icon name="schedule" size={18} className="text-muted" /> About <b>{fmtDuration(data.etaSeconds)}</b> remaining
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            {data.lastError ? (
              <Banner tone="danger" title="Evaluation paused" action={<Button size="sm" icon="play_arrow" onClick={toggle} loading={busy}>Resume</Button>}>
                {data.lastError}
              </Banner>
            ) : !done ? (
              <Banner tone="info" icon="cloud_sync">
                You can safely leave this screen. Evaluation continues on the server and you will get a notification when it is complete.
              </Banner>
            ) : (
              <Banner tone="success" title="All submissions evaluated">
                Review flagged submissions and approve the marks before exporting.
              </Banner>
            )}
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-h3 text-ink">
                Live evaluation <span className="font-normal text-muted">({data.total} students)</span>
              </h2>
              {!done ? (
                <span className="flex items-center gap-1 text-caption text-muted">
                  <Icon name="sync" size={16} className="animate-spin [animation-duration:3s]" /> Auto-updating
                </span>
              ) : null}
            </div>
            <div className="space-y-2.5">
              {data.items.map((it) => {
                const flagged = it.reviewStatus === 'SUSPICIOUS';
                const clickable = it.status === 'GRADED' || it.status === 'FAILED';
                const body = (
                  <div
                    className={clsx(
                      'card p-4',
                      it.status === 'PROCESSING' && 'border-l-4 border-l-primary',
                      flagged && 'border-danger/50',
                      clickable && 'transition-colors hover:border-primary/40',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-body font-semibold text-ink">{it.name}</p>
                        <p className="tnum text-small text-muted">{it.rollNo ?? 'Unmatched upload'}</p>
                      </div>
                      <ReviewChip status={it.status} review={it.reviewStatus} />
                    </div>
                    {it.status === 'GRADED' || it.status === 'FAILED' ? (
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5 text-small">
                        {flagged && it.flag ? (
                          <span className="flex items-center gap-1 text-danger">
                            <Icon name="flag" size={16} />
                            {it.flag.type === 'HANDWRITING_MISMATCH' ? 'Handwriting differs from earlier work' : `High similarity (${fmtPct(it.flag.score)})`}
                          </span>
                        ) : it.status === 'FAILED' ? (
                          <span className="truncate text-danger">{it.error ?? 'Could not be read'}</span>
                        ) : (
                          <span className="text-muted">Confidence {fmtPct(it.confidence)}</span>
                        )}
                        {it.total !== null ? <span className="tnum shrink-0 font-semibold text-primary dark:text-ink">Marks: {fmtNum(it.total)}</span> : null}
                      </div>
                    ) : null}
                  </div>
                );
                return clickable ? (
                  <Link key={it.id} to={`/submissions/${it.id}`} className="block">
                    {body}
                  </Link>
                ) : (
                  <div key={it.id}>{body}</div>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </Page>
  );
}
