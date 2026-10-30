import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, errorMessage } from '@/lib/api';
import type { StudentRow, SubmissionDetail as Detail } from '@/lib/types';
import { fmtDateTime, fmtNum, fmtPct } from '@/lib/format';
import { Page } from '@/components/layout/AppShell';
import { Banner, Button, Card, Chip, ConfirmDialog, ErrorState, Field, Icon, Input, Select, SkeletonList, TextArea } from '@/components/ui';
import { ReviewChip } from '@/components/ui/status';
import { useToast } from '@/components/ui/toast';
import { PageViewer } from '@/components/PageViewer';

export default function SubmissionDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['submission', id],
    queryFn: () => api<Detail>(`/submissions/${id}`),
    refetchInterval: (x) => (x.state.data && ['QUEUED', 'PROCESSING'].includes(x.state.data.status) ? 4000 : false),
  });
  const d = q.data;
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRegrade, setConfirmRegrade] = useState(false);

  useEffect(() => {
    if (!d) return;
    setMarks(Object.fromEntries(d.questions.map((x) => [x.id, x.marks === null ? '' : String(x.marks)])));
    setRemark(d.teacherRemark ?? '');
  }, [d]);

  const total = useMemo(() => (d ? d.questions.reduce((s, x) => s + (Number(marks[x.id]) || 0), 0) : 0), [d, marks]);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['submission', id] });
    if (d) {
      void qc.invalidateQueries({ queryKey: ['results', d.assignment.id] });
      void qc.invalidateQueries({ queryKey: ['progress', d.assignment.id] });
    }
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const save = async (reviewStatus?: 'APPROVED' | 'SUSPICIOUS') => {
    if (!d) return;
    const over = d.questions.find((x) => (Number(marks[x.id]) || 0) > x.maxMarks || (Number(marks[x.id]) || 0) < 0);
    if (over) {
      toast.show(`Q${over.number}: marks must be between 0 and ${fmtNum(over.maxMarks)}.`, { kind: 'error' });
      return;
    }
    setBusy(reviewStatus ?? 'save');
    try {
      await api(`/submissions/${id}`, {
        method: 'PUT',
        body: {
          scores: d.questions.filter((x) => x.marks !== null && String(x.marks) !== marks[x.id]).map((x) => ({ questionId: x.id, marks: Number(marks[x.id]) || 0 })),
          remark: remark.trim() || null,
          ...(reviewStatus ? { reviewStatus } : {}),
        },
      });
      await invalidate();
      toast.show(reviewStatus === 'APPROVED' ? 'Marks approved.' : reviewStatus === 'SUSPICIOUS' ? 'Marked as suspicious.' : 'Changes saved.');
      if (reviewStatus === 'APPROVED') nav(-1);
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const regrade = async () => {
    setBusy('regrade');
    try {
      await api(`/submissions/${id}/regrade`, { method: 'POST', body: { strong: true } });
      setConfirmRegrade(false);
      toast.show('Re-evaluating with the stronger AI model…', { kind: 'info' });
      await invalidate();
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading)
    return (
      <Page title="Submission Detail" back={-1}>
        <SkeletonList rows={3} />
      </Page>
    );
  if (q.error || !d)
    return (
      <Page title="Submission Detail" back={-1}>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );

  const graded = d.status === 'GRADED';
  const openFlags = d.flags.filter((f) => f.status === 'OPEN');
  const copied = d.reviewStatus === 'COPIED';

  const bottom = graded ? (
    <>
      {d.reviewStatus !== 'SUSPICIOUS' && !copied ? (
        <Button size="lg" variant="danger" icon="flag" onClick={() => void save('SUSPICIOUS')} loading={busy === 'SUSPICIOUS'}>
          Mark Suspicious
        </Button>
      ) : (
        <Button size="lg" variant="secondary" icon="save" onClick={() => void save()} loading={busy === 'save'}>
          Save
        </Button>
      )}
      <Button size="lg" icon="check" onClick={() => void save('APPROVED')} loading={busy === 'APPROVED'} disabled={copied}>
        Save & Approve
      </Button>
    </>
  ) : undefined;

  return (
    <Page title="Submission Detail" back={-1} bottomBar={bottom}>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,55fr)_minmax(0,45fr)] lg:items-start">
        {/* Left: viewer (desktop sticky) */}
        <div className="hidden lg:sticky lg:top-24 lg:block">
          <PageViewer submissionId={d.id} pageCount={d.pageCount || (graded ? 0 : d.files.length)} files={d.files} />
        </div>

        {/* Right: marks */}
        <div className="space-y-4">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-h2 text-ink">
                  {d.name}
                  {d.rollNo ? <span className="tnum font-normal text-muted"> · {d.rollNo}</span> : null}
                </h1>
                <p className="text-small text-muted">{d.class?.label}</p>
              </div>
              <ReviewChip status={d.status} review={d.reviewStatus} />
            </div>
            <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
              <div>
                <p className="eyebrow">Awarded</p>
                <p className="tnum mt-1 text-[32px] font-semibold leading-none text-primary dark:text-ink">
                  {graded ? fmtNum(copied ? 0 : total) : '—'}
                  <span className="text-h3 font-normal text-muted"> / {fmtNum(d.totalMarks)}</span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-small text-muted">Percentage</p>
                <p className="tnum text-h2 text-ink">{graded && d.totalMarks ? fmtPct((copied ? 0 : total) / d.totalMarks, 1) : '—'}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-small text-muted">
              <span className="flex items-center gap-1">
                <Icon name="schedule" size={16} /> Submitted {fmtDateTime(d.submittedAt)}
              </span>
              {d.isLate ? <Chip tone="warning">Late</Chip> : null}
              {d.escalated ? <Chip tone="info" icon="smart_toy">Second AI opinion</Chip> : null}
            </div>
          </Card>

          {d.status === 'QUEUED' || d.status === 'PROCESSING' ? <Banner tone="info" icon="hourglass_top">This submission is being evaluated. This page refreshes automatically.</Banner> : null}
          {d.status === 'FAILED' ? (
            <Banner tone="danger" title="This submission could not be evaluated" action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => setConfirmRegrade(true)}>Try again</Button>}>
              {d.error}
            </Banner>
          ) : null}

          {!d.student ? <AssignStudent d={d} onDone={() => void invalidate()} /> : null}

          {openFlags.map((f) => (
            <div key={f.id} className="rounded-card border border-danger/50 bg-danger-tint p-4">
              <p className="flex items-center gap-2 text-body font-semibold text-danger">
                <Icon name="flag" fill /> {f.type === 'HANDWRITING_MISMATCH' ? 'Handwriting differs from earlier work' : 'Flagged as a possible duplicate'}
              </p>
              <p className="mt-1 text-small text-ink">{f.details}</p>
              {f.other ? (
                <p className="mt-1 text-small text-muted">
                  {f.type === 'HANDWRITING_MISMATCH' ? 'Compared with: ' : 'Matches: '}
                  {f.other.name} {f.other.rollNo ? `(${f.other.rollNo})` : ''}
                </p>
              ) : null}
              <Link to={`/flags/${f.id}`} className="mt-2 inline-flex items-center gap-1 text-small font-semibold text-danger underline underline-offset-2">
                View comparison <Icon name="arrow_forward" size={16} />
              </Link>
            </div>
          ))}
          {copied ? <Banner tone="danger" icon="block" title="Marked as copied">Marks are set to 0. {d.teacherRemark}</Banner> : null}

          {graded && d.reviewStatus === 'NEEDS_REVIEW' ? (
            <div className="rounded-card border border-warning/50 bg-warning-tint p-4">
              <p className="flex items-center gap-2 text-body font-semibold text-warning">
                <Icon name="rate_review" /> Please check this evaluation
              </p>
              <p className="mt-1 text-small text-ink">
                AI confidence is {fmtPct(d.confidence)}
                {d.legibility && d.legibility !== 'good' ? ` and the handwriting legibility is ${d.legibility}` : ''}.
              </p>
              {d.concerns.length ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-small text-ink">
                  {d.concerns.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : null}
              <Button size="sm" variant="secondary" icon="smart_toy" className="mt-3" onClick={() => setConfirmRegrade(true)}>
                Re-check with stronger AI
              </Button>
            </div>
          ) : null}

          <div className="lg:hidden">
            <PageViewer submissionId={d.id} pageCount={d.pageCount || (graded ? 0 : d.files.length)} files={d.files} compact />
          </div>

          {graded ? (
            <>
              {d.overallFeedback ? (
                <Card className="border-info/30 bg-info-tint/60">
                  <p className="flex items-center gap-2 text-small font-semibold text-info">
                    <Icon name="auto_awesome" size={18} /> AI evaluator summary
                  </p>
                  <p className="mt-1 text-body text-ink">{d.overallFeedback}</p>
                </Card>
              ) : null}

              <div className="flex items-center justify-between pt-1">
                <h2 className="text-h3 text-ink">Question breakdown</h2>
                <span className="text-small text-muted">{d.questions.length} questions</span>
              </div>

              {d.questions.map((x) => {
                const val = marks[x.id] ?? '';
                const changed = x.marks !== null && String(x.marks) !== val;
                const full = Number(val) >= x.maxMarks;
                return (
                  <Card key={x.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-tint text-small font-bold text-primary">{x.number}</span>
                      <p className="min-w-0 flex-1 text-body font-semibold text-ink">{x.text}</p>
                      <label className={clsx('flex shrink-0 items-center gap-1 rounded-ctl border px-2 py-1', changed ? 'border-primary bg-primary-tint' : 'border-line bg-subtle/50')}>
                        <span className="sr-only">Marks for question {x.number}</span>
                        <Input
                          type="number"
                          inputMode="decimal"
                          step={0.5}
                          min={0}
                          max={x.maxMarks}
                          value={val}
                          disabled={copied}
                          onChange={(e) => setMarks((m) => ({ ...m, [x.id]: e.target.value }))}
                          className="h-9 w-16 border-none bg-transparent px-1 text-center text-h3 focus:ring-0 lg:h-9"
                        />
                        <span className="tnum text-small text-muted">/ {fmtNum(x.maxMarks)}</span>
                      </label>
                    </div>
                    {changed ? <p className="mt-1 text-right text-caption text-primary">AI suggested {fmtNum(x.aiMarks)}</p> : null}

                    {x.attempted === false ? (
                      <p className="mt-3 rounded-ctl bg-subtle px-3 py-2 text-small text-muted">Not attempted.</p>
                    ) : (
                      <>
                        {x.feedback ? (
                          <div className={clsx('mt-3 rounded-ctl border px-3 py-2.5', (x.confidence ?? 1) < 0.7 ? 'border-warning/40 bg-warning-tint' : 'border-line bg-subtle/50')}>
                            <p className={clsx('mb-0.5 flex items-center gap-1 text-caption font-semibold', (x.confidence ?? 1) < 0.7 ? 'text-warning' : 'text-muted')}>
                              <Icon name="auto_awesome" size={14} /> AI feedback{x.confidence !== null ? ` · confidence ${fmtPct(x.confidence)}` : ''}
                            </p>
                            <p className="text-small text-ink">{x.feedback}</p>
                          </div>
                        ) : null}
                        {x.covered.length ? (
                          <div className="mt-3">
                            <p className="mb-1 text-caption font-semibold text-success">Covered</p>
                            <ul className="space-y-1">
                              {x.covered.map((c) => (
                                <li key={c} className="flex items-start gap-2 text-small text-ink">
                                  <Icon name="check_circle" size={16} className="mt-0.5 text-success" />
                                  {c}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {x.missing.length && !full ? (
                          <div className="mt-3">
                            <p className="mb-1 text-caption font-semibold text-danger">Missing / incorrect</p>
                            <ul className="space-y-1">
                              {x.missing.map((c) => (
                                <li key={c} className="flex items-start gap-2 text-small text-ink">
                                  <Icon name="cancel" size={16} className="mt-0.5 text-danger" />
                                  {c}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </>
                    )}
                  </Card>
                );
              })}

              <Card>
                <Field label="Teacher remark" optional hint="Included in the exported results.">
                  <TextArea rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Add a remark for this submission" />
                </Field>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" icon="smart_toy" onClick={() => setConfirmRegrade(true)}>
                    Re-check with stronger AI
                  </Button>
                  <Button variant="ghost" size="sm" icon="save" onClick={() => void save()} loading={busy === 'save'} className="lg:hidden">
                    Save without approving
                  </Button>
                </div>
              </Card>
            </>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmRegrade}
        onClose={() => setConfirmRegrade(false)}
        onConfirm={regrade}
        loading={busy === 'regrade'}
        icon="smart_toy"
        title="Re-check with the stronger AI model?"
        body="The submission is evaluated again with the more accurate (and more expensive) review model. Manual mark changes on this submission will be replaced."
        confirmLabel="Re-check"
      />
    </Page>
  );
}

function AssignStudent({ d, onDone }: { d: Detail; onDone: () => void }) {
  const toast = useToast();
  const classId = d.class?.id;
  const students = useQuery({ queryKey: ['students', classId], queryFn: () => api<StudentRow[]>(`/classes/${classId}/students`), enabled: Boolean(classId) });
  const [sel, setSel] = useState('');
  const [busy, setBusy] = useState(false);
  const assign = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      await api(`/submissions/${d.id}/student`, { method: 'PUT', body: { studentId: sel } });
      toast.show('Submission assigned to student.');
      onDone();
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-card border border-warning/50 bg-warning-tint p-4">
      <p className="flex items-center gap-2 text-body font-semibold text-warning">
        <Icon name="person_search" /> Not matched to a student
      </p>
      <p className="mt-1 text-small text-ink">
        Uploaded as “{d.label}”.
        {d.detectedName || d.detectedRoll ? ` The paper says: ${[d.detectedName, d.detectedRoll].filter(Boolean).join(' · ')}.` : ''}
      </p>
      <div className="mt-3 flex gap-2">
        <div className="min-w-0 flex-1">
          <Select value={sel} onChange={(e) => setSel(e.target.value)} placeholder="Select student">
            {(students.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.rollNo}
              </option>
            ))}
          </Select>
        </div>
        <Button onClick={assign} loading={busy} disabled={!sel}>
          Assign
        </Button>
      </div>
    </div>
  );
}
