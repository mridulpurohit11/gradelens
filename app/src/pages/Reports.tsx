import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { copyText } from '@/lib/platform';
import type { AssignmentListItem, Report } from '@/lib/types';
import { fmtNum, fmtPct } from '@/lib/format';
import { Page } from '@/components/layout/AppShell';
import { Button, Card, Chip, EmptyState, ErrorState, Field, Icon, Select, Skeleton, SkeletonList, StatCard } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { BarList, ColumnChart } from '@/components/charts';

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const list = useQuery({ queryKey: ['assignments', 'all'], queryFn: () => api<AssignmentListItem[]>('/assignments') });
  const evaluated = useMemo(() => (list.data ?? []).filter((a) => a.graded > 0), [list.data]);
  const classes = useMemo(() => {
    const m = new Map<string, string>();
    evaluated.forEach((a) => m.set(a.classId ?? a.classLabel, a.classLabel));
    return [...m.entries()];
  }, [evaluated]);

  const assignmentId = params.get('assignment') ?? '';
  const current = evaluated.find((a) => a.id === assignmentId);
  const classId = params.get('class') ?? current?.classId ?? classes[0]?.[0] ?? '';
  const inClass = evaluated.filter((a) => (a.classId ?? a.classLabel) === classId);

  useEffect(() => {
    if (!list.data || !evaluated.length) return;
    if (!current || (current.classId ?? current.classLabel) !== classId) {
      const first = inClass[0] ?? evaluated[0];
      setParams({ class: first.classId ?? first.classLabel, assignment: first.id }, { replace: true });
    }
  }, [list.data, evaluated, current, classId, inClass, setParams]);

  const report = useQuery({
    queryKey: ['report', current?.id],
    queryFn: () => api<Report>(`/assignments/${current!.id}/report`),
    enabled: Boolean(current),
  });
  const r = report.data;

  return (
    <Page title="Reports & Analytics" tab>
      <h1 className="mb-4 hidden text-h1 text-primary dark:text-ink lg:block">Reports & Analytics</h1>
      <h1 className="mb-4 text-h2 text-ink lg:hidden">Reports & Analytics</h1>
      {list.isLoading ? (
        <SkeletonList rows={3} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !evaluated.length ? (
        <EmptyState icon="monitoring" title="No data yet" body="Reports appear after an assignment has been evaluated." action={<Link to="/assignments"><Button icon="assignment">Go to Assignments</Button></Link>} />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-3xl">
            <Field label="Class">
              <Select
                value={classId}
                onChange={(e) => {
                  const first = evaluated.find((a) => (a.classId ?? a.classLabel) === e.target.value);
                  setParams({ class: e.target.value, assignment: first?.id ?? '' }, { replace: true });
                }}
              >
                {classes.map(([idv, label]) => (
                  <option key={idv} value={idv}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Assignment">
              <Select value={current?.id ?? ''} onChange={(e) => setParams({ class: classId, assignment: e.target.value }, { replace: true })}>
                {inClass.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {report.isLoading || !r ? (
            report.error ? (
              <ErrorState error={report.error} onRetry={() => void report.refetch()} />
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} className="h-28 rounded-card" />
                ))}
              </div>
            )
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                <StatCard label="Class Average" value={<>{fmtNum(r.average)}<span className="text-h3 font-normal text-muted"> / {fmtNum(r.totalMarks)}</span></>} sub={`${fmtPct(r.totalMarks ? r.average / r.totalMarks : 0)} mean`} icon="functions" />
                <StatCard label="Highest Score" value={<>{fmtNum(r.highest)}<span className="text-h3 font-normal text-muted"> / {fmtNum(r.totalMarks)}</span></>} sub={r.topPerformers[0]?.name ?? '—'} icon="emoji_events" />
                <StatCard label="Lowest Score" value={<>{fmtNum(r.lowest)}<span className="text-h3 font-normal text-muted"> / {fmtNum(r.totalMarks)}</span></>} sub={`${r.evaluated} evaluated`} icon="south" />
                <StatCard label="Submission Rate" value={fmtPct(r.submissionRate)} sub={`${r.submitted}/${r.rosterSize} submitted${r.late ? ` · ${r.late} late` : ''}`} icon="fact_check" />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
                <Card>
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-h3 text-ink">Question performance</h2>
                      <p className="text-small text-muted">Average marks per question</p>
                    </div>
                    <Chip tone="primary">{r.questionPerformance.length} questions</Chip>
                  </div>
                  <BarList
                    data={r.questionPerformance.map((qp) => ({
                      key: qp.questionId,
                      label: `Q${qp.number}: ${qp.text}`,
                      value: qp.average,
                      max: qp.marks,
                      display: `${fmtNum(qp.average)} / ${fmtNum(qp.marks)} (${fmtPct(qp.percent)})`,
                      tooltip: qp.text,
                    }))}
                  />
                  {r.questionPerformance.length ? (
                    <p className="mt-4 text-small text-muted">
                      Weakest: <b className="text-ink">Q{[...r.questionPerformance].sort((a, b) => a.percent - b.percent)[0].number}</b> — consider revisiting this topic in class.
                    </p>
                  ) : null}
                </Card>
                <Card>
                  <div className="mb-5">
                    <h2 className="text-h3 text-ink">Marks distribution</h2>
                    <p className="text-small text-muted">Number of students per score range (N = {r.evaluated})</p>
                  </div>
                  <ColumnChart
                    data={r.distribution.map((dd, i) => ({
                      key: dd.label,
                      label: dd.label,
                      value: dd.count,
                      emphasis: i === r.distribution.length - 1,
                      tooltip: `${dd.count} student${dd.count === 1 ? '' : 's'} scored ${dd.label}`,
                    }))}
                  />
                </Card>
                <Card>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-h3 text-ink">
                      <Icon name="workspace_premium" className="text-warning" /> Top performers
                    </h2>
                    <span className="text-small text-muted">Top {r.topPerformers.length}</span>
                  </div>
                  <ol className="divide-y divide-line">
                    {r.topPerformers.map((t, i) => (
                      <li key={`${t.rollNo}-${i}`} className="flex items-center gap-3 py-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-tint text-small font-bold text-primary">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-body font-semibold text-ink">{t.name}</span>
                          <span className="tnum block text-caption text-muted">{t.rollNo}</span>
                        </span>
                        <span className="tnum text-right text-body font-semibold text-ink">
                          {fmtNum(t.total)} / {fmtNum(r.totalMarks)}
                          <span className="block text-caption font-normal text-success">{fmtPct((t.total ?? 0) / (r.totalMarks || 1), 1)}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </Card>
                <Card>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-h3 text-ink">
                      <Icon name="person_off" className="text-danger" /> Missing submissions
                    </h2>
                    <Chip tone={r.missing.length ? 'danger' : 'success'}>{r.missing.length ? `${r.missing.length} pending` : 'None'}</Chip>
                  </div>
                  {r.missing.length ? (
                    <>
                      <ul className="max-h-72 divide-y divide-line overflow-y-auto">
                        {r.missing.map((m) => (
                          <li key={m.rollNo ?? m.name} className="flex justify-between gap-3 py-2.5 text-small">
                            <span className="text-ink">{m.name}</span>
                            <span className="tnum text-muted">{m.rollNo}</span>
                          </li>
                        ))}
                      </ul>
                      <Button
                        variant="tint"
                        full
                        icon="content_copy"
                        className="mt-3"
                        onClick={async () => {
                          const ok = await copyText(r.missing.map((m) => `${m.name} (${m.rollNo ?? '-'})`).join('\n'));
                          toast.show(ok ? 'List copied. Paste it in your class group to remind students.' : 'Could not copy the list.', { kind: ok ? 'success' : 'error' });
                        }}
                      >
                        Copy list to remind students
                      </Button>
                    </>
                  ) : (
                    <p className="py-4 text-small text-muted">Every student has submitted.</p>
                  )}
                </Card>
              </div>
              <div className="mt-6">
                <Link to={`/assignments/${current!.id}/export`}>
                  <Button size="lg" icon="download" full className="lg:w-auto">
                    Export Summary Report (PDF / Excel)
                  </Button>
                </Link>
              </div>
            </>
          )}
        </>
      )}
    </Page>
  );
}
