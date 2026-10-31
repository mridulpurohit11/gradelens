import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Assignment, ClassItem, SourceType, Strictness } from '@/lib/types';
import { fmtDate, fmtNum, toDateInput } from '@/lib/format';
import { Page } from '@/components/layout/AppShell';
import { Banner, Button, Card, Chip, Dialog, EmptyState, ErrorState, Field, Icon, Input, Segmented, Select, SkeletonList, Spinner, Stepper, TextArea, Toggle } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { SourcePicker, sourceLinkError } from '@/components/sources';

const STEPS = ['Class', 'Questions & Marks', 'Submissions'];
const EDITABLE = new Set(['DRAFT', 'KEY_READY']);

export default function AssignmentWizard() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const classes = useQuery({ queryKey: ['classes'], queryFn: () => api<ClassItem[]>('/classes') });
  const assignment = useQuery({ queryKey: ['assignment', id], queryFn: () => api<Assignment>(`/assignments/${id}`), enabled: Boolean(id) });

  const a = assignment.data;
  const stepParam = Number(params.get('step'));
  const step = !id ? 0 : stepParam >= 1 && stepParam <= 3 ? stepParam - 1 : a && a.questions.length ? 2 : 1;
  const goStep = (i: number) => {
    if (!id) return;
    setParams({ step: String(i + 1) }, { replace: true });
    window.scrollTo(0, 0);
  };

  const title = id ? 'Edit Assignment' : 'Create Assignment';
  if (classes.isLoading || (id && assignment.isLoading))
    return (
      <Page title={title} back="/assignments">
        <SkeletonList rows={2} />
      </Page>
    );
  if (classes.error || assignment.error)
    return (
      <Page title={title} back="/assignments">
        <ErrorState error={classes.error ?? assignment.error} onRetry={() => void (classes.refetch(), assignment.refetch())} />
      </Page>
    );
  if (!classes.data?.length)
    return (
      <Page title={title} back="/assignments">
        <EmptyState icon="class" title="Register a class first" body="Assignments belong to a class. Add a class with its students to continue." action={<Button icon="add" onClick={() => nav('/classes/new')}>Add Class</Button>} />
      </Page>
    );
  if (a && !EDITABLE.has(a.status))
    return (
      <Page title={title} back="/assignments">
        <EmptyState
          icon="lock"
          title="This assignment is locked"
          body="Questions and the answer key cannot be changed after evaluation has started."
          action={
            <Link to={a.status === 'EVALUATING' ? `/assignments/${a.id}/progress` : `/assignments/${a.id}/results`}>
              <Button icon="arrow_forward">{a.status === 'EVALUATING' ? 'View progress' : 'View results'}</Button>
            </Link>
          }
        />
      </Page>
    );

  return (
    <Page title={title} back={a ? '/assignments' : -1}>
      <div className="mx-auto max-w-3xl">
        <Card className="mb-5">
          <Stepper steps={STEPS} current={step} onStep={id ? goStep : undefined} />
        </Card>
        {step === 0 ? (
          <StepClass classes={classes.data} assignment={a} onDone={(aid) => nav(`/assignments/${aid}/edit?step=2`, { replace: true })} />
        ) : a ? (
          <>
            <SummaryCard a={a} onEdit={() => goStep(0)} />
            {step === 1 ? <StepQuestions a={a} onBack={() => goStep(0)} onDone={() => goStep(2)} /> : <StepSubmissions a={a} onBack={() => goStep(1)} />}
          </>
        ) : null}
      </div>
    </Page>
  );
}

function SummaryCard({ a, onEdit }: { a: Assignment; onEdit: () => void }) {
  return (
    <Card className="mb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-caption text-muted">
            <Icon name="school" size={16} /> Course & class
          </p>
          <p className="mt-0.5 text-h3 text-primary dark:text-ink">{a.class?.label}</p>
        </div>
        <Button variant="text" icon="edit" onClick={onEdit} className="text-small">
          Edit
        </Button>
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-caption text-muted">Assignment</p>
        <p className="text-body font-semibold text-ink">{a.title}</p>
        <p className="mt-1 flex items-center gap-1 text-small text-muted">
          <Icon name="event" size={16} /> Due: {fmtDate(a.dueDate)}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip tone="primary">{a.class?.course}</Chip>
        <Chip tone="primary">{a.class?.semester}</Chip>
        <Chip tone="primary">Section {a.class?.section}</Chip>
        <Chip tone="neutral">{a.class?.subjectName}</Chip>
      </div>
    </Card>
  );
}

// ---------- Step 1: class, title, due date ----------

function StepClass({ classes, assignment, onDone }: { classes: ClassItem[]; assignment?: Assignment; onDone: (id: string) => void }) {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const preset = params.get('classId');
  const [classId, setClassId] = useState(assignment?.classId ?? (preset && classes.some((c) => c.id === preset) ? preset : classes.length === 1 ? classes[0].id : ''));
  const [title, setTitle] = useState(assignment?.title ?? '');
  const [due, setDue] = useState(toDateInput(assignment?.dueDate));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cls = classes.find((c) => c.id === classId);
  const errs = { classId: !classId ? 'Select a class' : null, title: title.trim().length < 2 ? 'Assignment title is required' : null };

  const next = async () => {
    setTouched(true);
    if (errs.classId || errs.title) return;
    setBusy(true);
    setError(null);
    try {
      const body = { classId, title: title.trim(), dueDate: due || null };
      const a = await api<Assignment>(assignment ? `/assignments/${assignment.id}` : '/assignments', { method: assignment ? 'PUT' : 'POST', body });
      qc.setQueryData(['assignment', a.id], a);
      void qc.invalidateQueries({ queryKey: ['assignments'] });
      onDone(a.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="space-y-5">
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Field label="Select Class" required error={touched ? errs.classId : null}>
          <Select value={classId} onChange={(e) => setClassId(e.target.value)} placeholder="Choose a registered class" invalid={touched && !!errs.classId}>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} — {c.subjectName}
              </option>
            ))}
          </Select>
        </Field>
        {cls ? (
          <div className="flex flex-wrap gap-2">
            <Chip tone="primary" icon="lock">
              {cls.course}
            </Chip>
            <Chip tone="primary">{cls.semester}</Chip>
            <Chip tone="primary">Section {cls.section}</Chip>
            <Chip tone="neutral">{cls.subjectName}</Chip>
            <Chip tone="neutral" icon="group">
              {cls.studentCount} students
            </Chip>
          </div>
        ) : null}
        <Field label="Assignment Title" required error={touched ? errs.title : null}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Assignment 2 – Sorting Algorithms" invalid={touched && !!errs.title} />
        </Field>
        <Field label="Due Date" optional hint="Uploads after the end of this day are marked late.">
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
      </Card>
      <WizardFooter>
        <Button size="lg" onClick={next} loading={busy} iconRight="arrow_forward" className="flex-1 sm:flex-none sm:px-10">
          Next
        </Button>
      </WizardFooter>
    </>
  );
}

function WizardFooter({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mt-6 hidden justify-end gap-3 sm:flex">{children}</div>
      <div className="h-24 sm:hidden" />
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 backdrop-blur sm:hidden">
        <div className="flex gap-3 pb-3">{children}</div>
      </div>
    </>
  );
}

// ---------- Step 2: questions, marks, integrity, strictness ----------

type QDraft = { key: string; id?: string; text: string; marks: string };
let qseq = 0;

function StepQuestions({ a, onBack, onDone }: { a: Assignment; onBack: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { config } = useAuth();
  const [qs, setQs] = useState<QDraft[]>(() => a.questions.map((q) => ({ key: q.id, id: q.id, text: q.text, marks: String(q.marks) })));
  const [opts, setOpts] = useState({ fraudDetection: a.fraudDetection, handwritingCheck: a.handwritingCheck, strictness: a.strictness as Strictness });
  const [extracting, setExtracting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<HTMLTextAreaElement>(null);
  const [focusNew, setFocusNew] = useState(false);
  useEffect(() => {
    if (focusNew) {
      lastRef.current?.focus();
      setFocusNew(false);
    }
  }, [focusNew]);

  const total = qs.reduce((s, q) => s + (Number(q.marks) || 0), 0);
  const invalid = (q: QDraft) => q.text.trim().length < 3 || !(Number(q.marks) > 0);

  const extract = async (file: File) => {
    setExtracting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<{ questions: { text: string; marks: number }[] }>(`/assignments/${a.id}/questions/extract`, { method: 'POST', body: fd });
      setQs((prev) => [...prev.filter((q) => q.text.trim()), ...r.questions.map((q) => ({ key: `n${++qseq}`, text: q.text, marks: q.marks ? String(q.marks) : '' }))]);
      toast.show(`${r.questions.length} question${r.questions.length === 1 ? '' : 's'} extracted. Check the marks for each.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExtracting(false);
    }
  };

  const save = async () => {
    setTouched(true);
    if (!qs.length) {
      setError('Add at least one question.');
      return;
    }
    if (qs.some(invalid)) {
      setError('Every question needs text and marks greater than 0.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/assignments/${a.id}`, { method: 'PUT', body: opts });
      const updated = await api<Assignment>(`/assignments/${a.id}/questions`, {
        method: 'PUT',
        body: { questions: qs.map((q) => ({ id: q.id, text: q.text.trim(), marks: Number(q.marks) })) },
      });
      qc.setQueryData(['assignment', a.id], updated);
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-h3 text-ink">
          <Icon name="quiz" className="text-primary" /> Questions & Marks
        </h2>
        <span className="text-small text-muted">{qs.length} defined</span>
      </div>

      {error ? <Banner tone="danger" className="mb-4">{error}</Banner> : null}

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={extracting || !config?.aiConfigured}
        className="flex w-full flex-col items-center rounded-card border-2 border-dashed border-line bg-surface px-4 py-6 text-center transition-colors hover:border-primary/60 disabled:opacity-60"
      >
        {extracting ? <Spinner className="h-8 w-8 text-primary" /> : <Icon name="cloud_upload" size={32} className="text-primary" />}
        <span className="mt-2 text-body font-semibold text-ink">{extracting ? 'Reading questions with AI…' : 'Upload questions (PDF, Image, DOCX)'}</span>
        <span className="mt-0.5 text-small text-muted">{config?.aiConfigured ? 'Questions and marks are extracted automatically.' : 'AI is not configured on the server — type questions manually.'}</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void extract(f);
          e.target.value = '';
        }}
      />
      <div className="mt-3 text-center">
        <Button
          variant="text"
          icon="edit_note"
          onClick={() => {
            setQs((p) => [...p, { key: `n${++qseq}`, text: '', marks: '' }]);
            setFocusNew(true);
          }}
        >
          Type questions manually
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        {qs.map((q, i) => (
          <Card key={q.key} className="p-4">
            <div className="flex items-start gap-3">
              <span className="mt-1 rounded-ctl bg-primary-tint px-2 py-0.5 text-caption font-bold text-primary">Q{i + 1}</span>
              <div className="min-w-0 flex-1">
                <TextArea
                  ref={i === qs.length - 1 ? lastRef : undefined}
                  rows={3}
                  value={q.text}
                  onChange={(e) => setQs((p) => p.map((x) => (x.key === q.key ? { ...x, text: e.target.value } : x)))}
                  placeholder="Type the question"
                  aria-label={`Question ${i + 1}`}
                  invalid={touched && q.text.trim().length < 3}
                />
              </div>
              <div className="w-20 shrink-0">
                <label className="mb-1 block text-caption text-muted" htmlFor={`m-${q.key}`}>
                  Marks
                </label>
                <Input
                  id={`m-${q.key}`}
                  inputMode="decimal"
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={q.marks}
                  onChange={(e) => setQs((p) => p.map((x) => (x.key === q.key ? { ...x, marks: e.target.value } : x)))}
                  className="h-11 text-center font-semibold"
                  invalid={touched && !(Number(q.marks) > 0)}
                />
              </div>
            </div>
            <div className="mt-2 flex justify-end">
              <Button variant="ghost" size="sm" icon="delete" className="text-muted hover:text-danger" onClick={() => setQs((p) => p.filter((x) => x.key !== q.key))}>
                Remove
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between rounded-card border border-primary/20 bg-primary-tint px-5 py-4">
        <span className="flex items-center gap-2 text-body text-ink">
          <Icon name="functions" className="text-primary" /> Total marks
        </span>
        <span className="tnum text-h2 text-primary">{fmtNum(total)}</span>
      </div>

      <Card className="mt-5 space-y-5">
        <div>
          <h3 className="text-h3 text-ink">Academic Integrity</h3>
          <p className="text-small text-muted">Checks run automatically during evaluation.</p>
        </div>
        <Toggle icon="policy" label="Fraud Detection" description="Detect duplicate, copied or reused submissions." checked={opts.fraudDetection} onChange={(v) => setOpts((o) => ({ ...o, fraudDetection: v }))} />
        <Toggle icon="draw" label="Handwriting Verification" description="Compare handwriting with the student's previous submissions." checked={opts.handwritingCheck} onChange={(v) => setOpts((o) => ({ ...o, handwritingCheck: v }))} />
        <div className="border-t border-line pt-5">
          <p className="mb-2 text-body font-semibold text-ink">Grading Strictness</p>
          <Segmented
            value={opts.strictness}
            onChange={(v) => setOpts((o) => ({ ...o, strictness: v }))}
            options={[
              { value: 'LENIENT', label: 'Lenient' },
              { value: 'STANDARD', label: 'Standard' },
              { value: 'STRICT', label: 'Strict' },
            ]}
          />
          <p className="mt-2 text-caption text-muted">
            {opts.strictness === 'LENIENT'
              ? 'Generous partial credit when the core idea is right.'
              : opts.strictness === 'STRICT'
                ? 'Marks only for complete, precise answers; missing steps are penalised.'
                : 'Balanced partial marking according to the marking scheme.'}
          </p>
        </div>
      </Card>

      <WizardFooter>
        <Button variant="secondary" size="lg" icon="arrow_back" onClick={onBack} className="flex-1 sm:flex-none">
          Back
        </Button>
        <Button size="lg" onClick={save} loading={busy} iconRight="arrow_forward" className="flex-[2] sm:flex-none sm:px-10">
          Next
        </Button>
      </WizardFooter>
    </>
  );
}

// ---------- Step 3: submission source ----------

function StepSubmissions({ a, onBack }: { a: Assignment; onBack: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { config } = useAuth();
  const [source, setSource] = useState<{ type: SourceType; url: string }>({
    type: a.sourceType ?? a.class?.sourceType ?? 'DRIVE_FOLDER',
    url: a.sourceUrl ?? a.class?.sourceUrl ?? '',
  });
  const [preview, setPreview] = useState<{ found: number; missing: { name: string; rollNo: string }[]; unmatched: string[]; rosterSize: number } | null>(null);
  const [showMissing, setShowMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const hasKey = a.questions.length > 0 && a.questions.every((q) => q.rubric.length > 0);

  const verify = async (type: SourceType, url: string) => {
    const r = await api<{ found: number; matched: number; missing: { name: string; rollNo: string }[]; unmatched: string[]; rosterSize: number }>(`/assignments/${a.id}/source/preview`, {
      method: 'POST',
      body: { type, url },
    });
    setPreview(r);
    return {
      message: `${r.found} submission${r.found === 1 ? '' : 's'} found · ${r.missing.length} student${r.missing.length === 1 ? '' : 's'} missing`,
      warning: r.unmatched.length ? `${r.unmatched.length} upload(s) could not be matched to a student by name or ID — they will still be evaluated and can be assigned later.` : undefined,
    };
  };

  const proceed = async () => {
    const invalid = sourceLinkError(source.type, source.url);
    setLinkError(invalid);
    if (invalid) {
      setError('Add the link where students submitted their work.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Check that the folder/sheet can be opened before moving on.
      try {
        await verify(source.type, source.url.trim());
      } catch (e) {
        setLinkError(errorMessage(e));
        throw new Error('The submission link could not be opened. Check the link and that it is shared with your Google account.');
      }
      await api(`/assignments/${a.id}`, { method: 'PUT', body: { sourceType: source.type, sourceUrl: source.url.trim() } });
      if (!hasKey) {
        const updated = await api<Assignment>(`/assignments/${a.id}/answer-key`, { method: 'POST', body: {} });
        qc.setQueryData(['assignment', a.id], updated);
      } else await qc.invalidateQueries({ queryKey: ['assignment', a.id] });
      nav(`/assignments/${a.id}/key`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-h3 text-ink">
          <Icon name="drive_folder_upload" className="text-primary" /> Submissions Source
        </h2>
        {a.class?.sourceUrl && source.url === a.class.sourceUrl ? <Chip tone="success">From class</Chip> : null}
      </div>
      {error ? <Banner tone="danger" className="mb-4">{error}</Banner> : null}
      <Card>
        <SourcePicker
          type={source.type}
          url={source.url}
          error={linkError}
          onChange={(type, url) => {
            setSource({ type, url });
            if (linkError) setLinkError(sourceLinkError(type, url));
          }}
          verify={verify}
          autoVerify={Boolean(source.url)}
        />
        {preview?.missing.length ? (
          <div className="mt-3">
            <Button variant="text" icon="person_search" onClick={() => setShowMissing(true)} className="text-small">
              View missing students
            </Button>
          </div>
        ) : null}
      </Card>
      {!hasKey && !config?.aiConfigured ? <Banner tone="warning" className="mt-4">AI is not configured on the server, so the answer key cannot be generated automatically.</Banner> : null}
      {busy && !hasKey ? (
        <p className="mt-4 flex items-center justify-center gap-2 text-small text-muted">
          <Spinner className="h-4 w-4" /> Writing model answers and marking schemes… this takes about 20–40 seconds.
        </p>
      ) : null}

      <WizardFooter>
        <Button variant="secondary" size="lg" icon="arrow_back" onClick={onBack} className="flex-1 sm:flex-none">
          Back
        </Button>
        <Button size="lg" onClick={proceed} loading={busy} icon={hasKey ? 'fact_check' : 'auto_awesome'} className="flex-[2] sm:flex-none sm:px-8">
          {hasKey ? 'Review Answer Key' : 'Generate Answer Key'}
        </Button>
      </WizardFooter>

      <Dialog open={showMissing} onClose={() => setShowMissing(false)} title={`Missing students (${preview?.missing.length ?? 0})`} actions={<Button onClick={() => setShowMissing(false)}>Close</Button>}>
        <ul className="max-h-[50dvh] divide-y divide-line overflow-y-auto text-ink">
          {preview?.missing.map((m) => (
            <li key={m.rollNo} className="flex justify-between py-2 text-small">
              <span>{m.name}</span>
              <span className="tnum text-muted">{m.rollNo}</span>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}

