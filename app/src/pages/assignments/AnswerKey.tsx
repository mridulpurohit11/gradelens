import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, errorMessage } from '@/lib/api';
import type { Assignment, Question, RubricPoint } from '@/lib/types';
import { fmtNum } from '@/lib/format';
import { Page } from '@/components/layout/AppShell';
import { Banner, Button, Card, Chip, ConfirmDialog, EmptyState, ErrorState, Icon, Input, SkeletonList, TextArea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';

export default function AnswerKey() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['assignment', id], queryFn: () => api<Assignment>(`/assignments/${id}`) });
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmStart, setConfirmStart] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const a = q.data;
  if (q.isLoading)
    return (
      <Page title="Answer Key & Rubric" back="/assignments">
        <SkeletonList rows={3} />
      </Page>
    );
  if (q.error || !a)
    return (
      <Page title="Answer Key & Rubric" back="/assignments">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );

  const locked = !['DRAFT', 'KEY_READY'].includes(a.status);
  const approved = a.questions.filter((x) => x.approved).length;
  const missingKey = a.questions.filter((x) => !x.rubric.length);
  const firstOpen = open ?? a.questions.find((x) => !x.approved)?.id ?? null;

  const refresh = (updated?: Assignment) => (updated ? qc.setQueryData(['assignment', id], updated) : qc.invalidateQueries({ queryKey: ['assignment', id] }));

  const generate = async (questionIds?: string[]) => {
    setBusy(questionIds ? questionIds[0] : 'all');
    try {
      const u = await api<Assignment>(`/assignments/${id}/answer-key`, { method: 'POST', body: questionIds ? { questionIds } : { regenerate: false } });
      await refresh(u);
      toast.show('Answer key generated. Please review it.');
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const approveAll = async () => {
    setBusy('approve-all');
    try {
      const u = await api<Assignment>(`/assignments/${id}/answer-key/approve`, { method: 'POST' });
      await refresh(u);
      toast.show('All questions approved.');
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    setBusy('start');
    setStartError(null);
    try {
      const r = await api<{ found: number; missing: number }>(`/assignments/${id}/evaluate`, { method: 'POST' });
      void qc.invalidateQueries({ queryKey: ['assignments'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.show(`Evaluation started for ${r.found} submission${r.found === 1 ? '' : 's'}.`);
      nav(`/assignments/${id}/progress`, { replace: true });
    } catch (e) {
      setStartError(errorMessage(e));
      setConfirmStart(false);
    } finally {
      setBusy(null);
    }
  };

  const bottom = locked ? (
    <Link to={`/assignments/${id}/results`} className="w-full lg:w-auto">
      <Button size="lg" full icon="arrow_forward">
        View Results
      </Button>
    </Link>
  ) : (
    <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:items-center lg:gap-4">
      <span className="flex items-center gap-2 text-small text-muted">
        <span className={clsx('h-2 w-2 rounded-full', approved === a.questions.length ? 'bg-success' : 'bg-warning')} />
        {approved} of {a.questions.length} approved
      </span>
      <div className="flex gap-2">
        {approved < a.questions.length ? (
          <Button size="lg" variant="secondary" icon="done_all" onClick={approveAll} loading={busy === 'approve-all'} disabled={missingKey.length > 0} className="flex-1">
            Approve All
          </Button>
        ) : null}
        <Button size="lg" icon="play_circle" onClick={() => setConfirmStart(true)} disabled={approved < a.questions.length || !a.questions.length} className="flex-[2]">
          Start Evaluation
        </Button>
      </div>
    </div>
  );

  return (
    <Page title="Answer Key & Rubric" back={`/assignments/${id}/edit?step=3`} bottomBar={bottom}>
      <div className="mx-auto max-w-3xl space-y-5">
        <Banner tone="info">Review the AI-generated answer key before evaluation begins. You can edit model answers and the marks of each marking point.</Banner>
        {a.lastError ? <Banner tone="danger">{a.lastError}</Banner> : null}
        {startError ? <Banner tone="danger" title="Evaluation could not start">{startError}</Banner> : null}

        <Card>
          <p className="eyebrow">Evaluation set</p>
          <h1 className="mt-1 text-h2 text-primary dark:text-ink">{a.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            <Chip tone="primary" icon="class">
              {a.class?.label}
            </Chip>
            <Chip tone="primary" icon="star">
              Total marks: {fmtNum(a.totalMarks)}
            </Chip>
            <Chip tone="neutral">{a.strictness.charAt(0) + a.strictness.slice(1).toLowerCase()} marking</Chip>
          </div>
        </Card>

        {!a.questions.length ? (
          <EmptyState icon="quiz" title="No questions yet" body="Add the assignment questions first." action={<Link to={`/assignments/${id}/edit?step=2`}><Button icon="edit">Add questions</Button></Link>} />
        ) : null}

        {missingKey.length && !locked ? (
          <Banner tone="warning" title={`${missingKey.length} question(s) have no marking scheme`} action={<Button size="sm" icon="auto_awesome" loading={busy === 'all'} onClick={() => void generate()}>Generate with AI</Button>}>
            Generate the answer key with AI or write the marking points yourself.
          </Banner>
        ) : null}

        {a.questions.map((question, i) => (
          <QuestionCard
            key={question.id}
            index={i}
            q={question}
            locked={locked}
            expanded={firstOpen === question.id}
            onToggle={() => setOpen(firstOpen === question.id ? '' : question.id)}
            onSaved={() => void refresh()}
            onRegenerate={() => void generate([question.id])}
            regenerating={busy === question.id}
            onApproved={() => {
              const next = a.questions.find((x, j) => j > i && !x.approved);
              setOpen(next?.id ?? '');
            }}
          />
        ))}
      </div>

      <ConfirmDialog
        open={confirmStart}
        onClose={() => setConfirmStart(false)}
        onConfirm={start}
        loading={busy === 'start'}
        icon="play_circle"
        title="Start evaluation?"
        body={
          <>
            GradeLens will read every submission in the linked {a.sourceType === 'GOOGLE_SHEET' ? 'Google Sheet' : 'Drive folder'} and grade it with AI. The answer key will be locked. Evaluation continues in the background even if you close the app.
          </>
        }
        confirmLabel="Start Evaluation"
      />
    </Page>
  );
}

function QuestionCard({
  index,
  q,
  locked,
  expanded,
  onToggle,
  onSaved,
  onRegenerate,
  regenerating,
  onApproved,
}: {
  index: number;
  q: Question;
  locked: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  onApproved: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState(q.modelAnswer ?? '');
  const [rubric, setRubric] = useState<{ point: string; marks: string }[]>(q.rubric.map((r) => ({ point: r.point, marks: String(r.marks) })));
  const [saving, setSaving] = useState(false);
  const sum = rubric.reduce((s, r) => s + (Number(r.marks) || 0), 0);

  const startEdit = () => {
    setAnswer(q.modelAnswer ?? '');
    setRubric(q.rubric.length ? q.rubric.map((r) => ({ point: r.point, marks: String(r.marks) })) : [{ point: '', marks: String(q.marks) }]);
    setEditing(true);
  };

  const save = async (approve: boolean) => {
    setSaving(true);
    try {
      const body: { modelAnswer?: string; rubric?: RubricPoint[]; approved: boolean } = { approved: approve };
      if (editing) {
        body.modelAnswer = answer.trim();
        body.rubric = rubric.filter((r) => r.point.trim()).map((r) => ({ point: r.point.trim(), marks: Number(r.marks) || 0 }));
      }
      await api(`/questions/${q.id}`, { method: 'PUT', body });
      setEditing(false);
      onSaved();
      if (approve) onApproved();
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padded={false} className={clsx('overflow-hidden', expanded && !q.approved && 'border-primary ring-1 ring-primary')}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-4 text-left lg:px-5" aria-expanded={expanded}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-small font-bold text-primary-on">{index + 1}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-h3 text-ink">
            Q{index + 1} · {fmtNum(q.marks)} Marks
          </span>
          {!expanded ? <span className="block truncate text-small text-muted">{q.text}</span> : null}
        </span>
        {q.approved ? <Chip tone="success" icon="check_circle">Approved</Chip> : q.rubric.length ? <Chip tone="warning" icon="pending">Needs review</Chip> : <Chip tone="outline">No key</Chip>}
        <Icon name={expanded ? 'expand_less' : 'expand_more'} className="text-muted" />
      </button>

      {expanded ? (
        <div className="space-y-4 border-t border-line px-4 pb-4 pt-4 lg:px-5">
          <div>
            <p className="mb-1.5 text-small font-semibold text-ink">Question</p>
            <p className="rounded-ctl border border-line bg-subtle/60 px-3 py-2.5 text-body text-ink">{q.text}</p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="eyebrow">Model answer</p>
              {q.aiGenerated ? (
                <span className="flex items-center gap-1 text-caption font-semibold text-warning">
                  <Icon name="auto_awesome" size={14} /> AI draft
                </span>
              ) : null}
            </div>
            {editing ? (
              <TextArea rows={6} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Write the expected answer" />
            ) : (
              <p className="whitespace-pre-wrap rounded-ctl border border-dashed border-line px-3 py-2.5 text-body text-ink">{q.modelAnswer || <span className="text-muted">No model answer yet.</span>}</p>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="eyebrow">Marking scheme ({fmtNum(editing ? sum : q.marks)} {editing ? `of ${fmtNum(q.marks)} ` : ''}marks)</p>
              {editing && Math.abs(sum - q.marks) > 0.001 ? <span className="text-caption font-semibold text-danger">Must add up to {fmtNum(q.marks)}</span> : null}
            </div>
            {editing ? (
              <div className="space-y-2">
                {rubric.map((r, i) => (
                  <div key={i} className="flex gap-2">
                    <div className="min-w-0 flex-1">
                      <Input value={r.point} onChange={(e) => setRubric((p) => p.map((x, j) => (j === i ? { ...x, point: e.target.value } : x)))} placeholder="Marking point" aria-label={`Marking point ${i + 1}`} />
                    </div>
                    <div className="w-20">
                      <Input type="number" inputMode="decimal" step={0.5} min={0} value={r.marks} onChange={(e) => setRubric((p) => p.map((x, j) => (j === i ? { ...x, marks: e.target.value } : x)))} className="text-center" aria-label="Marks" />
                    </div>
                    <button type="button" aria-label="Remove point" onClick={() => setRubric((p) => p.filter((_, j) => j !== i))} className="rounded-ctl px-2 text-muted hover:bg-danger-tint hover:text-danger">
                      <Icon name="close" />
                    </button>
                  </div>
                ))}
                <Button variant="text" icon="add" onClick={() => setRubric((p) => [...p, { point: '', marks: '' }])} className="text-small">
                  Add marking point
                </Button>
              </div>
            ) : q.rubric.length ? (
              <ul className="space-y-2">
                {q.rubric.map((r, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 rounded-ctl border border-line px-3 py-2.5">
                    <span className="flex items-start gap-2 text-body text-ink">
                      <Icon name={q.approved ? 'check' : 'radio_button_unchecked'} size={18} className={q.approved ? 'mt-0.5 text-success' : 'mt-0.5 text-muted'} />
                      {r.point}
                    </span>
                    <span className="tnum shrink-0 text-small font-semibold text-ink">
                      {fmtNum(r.marks)} mark{r.marks === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-muted">No marking points yet.</p>
            )}
          </div>

          {!locked ? (
            <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:justify-between">
              {editing ? (
                <>
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => void save(false)} loading={saving} className="flex-1">
                      Save
                    </Button>
                    <Button icon="done_all" onClick={() => void save(true)} loading={saving} className="flex-1">
                      Save & Approve
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Button variant="secondary" icon="edit" onClick={startEdit} className="flex-1">
                      Edit
                    </Button>
                    <Button variant="ghost" icon="auto_awesome" onClick={onRegenerate} loading={regenerating} className="flex-1">
                      {q.rubric.length ? 'Regenerate' : 'Generate'}
                    </Button>
                  </div>
                  {!q.approved ? (
                    <Button icon="done_all" onClick={() => void save(true)} loading={saving} disabled={!q.rubric.length}>
                      Approve Question
                    </Button>
                  ) : (
                    <Button variant="secondary" icon="undo" onClick={() => void save(false)} loading={saving}>
                      Mark as not approved
                    </Button>
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
