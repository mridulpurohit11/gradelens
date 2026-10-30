import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '@/lib/api';
import type { FlagBrief, FlagDetail } from '@/lib/types';
import { fmtDateTime, fmtPct } from '@/lib/format';
import { Page } from '@/components/layout/AppShell';
import { Banner, Button, Card, Chip, Dialog, ErrorState, Field, Icon, ProgressBar, Segmented, SkeletonList, TextArea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { PageViewer } from '@/components/PageViewer';

function Panel({ s, badge }: { s: FlagBrief; badge: { label: string; tone: 'success' | 'danger' | 'neutral' } }) {
  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/submissions/${s.id}`} className="text-h3 text-primary hover:underline dark:text-ink">
            {s.name}
          </Link>
          {s.rollNo ? <span className="tnum text-small text-muted"> · {s.rollNo}</span> : null}
          <p className="text-small text-muted">Submitted {fmtDateTime(s.submittedAt)}</p>
        </div>
        <Chip tone={badge.tone}>{badge.label}</Chip>
      </div>
      <PageViewer submissionId={s.id} pageCount={s.pageCount} compact />
    </Card>
  );
}

function Metric({ label, value, invert }: { label: string; value: number | null; invert?: boolean }) {
  if (value === null || value === undefined) return null;
  const high = invert ? value < 0.35 : value >= 0.6;
  const tone = high ? 'danger' : invert ? 'success' : value >= 0.35 ? 'warning' : 'primary';
  const text = invert ? (value < 0.35 ? `Low match (${fmtPct(value)})` : value < 0.6 ? `Uncertain (${fmtPct(value)})` : `Consistent (${fmtPct(value)})`) : `${fmtPct(value)} match`;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-body text-ink">{label}</span>
        <span className="tnum shrink-0 text-small font-semibold text-ink">{text}</span>
      </div>
      <ProgressBar value={value} tone={tone} />
    </div>
  );
}

export default function FraudComparison() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['flag', id], queryFn: () => api<FlagDetail>(`/flags/${id}`) });
  const [dialog, setDialog] = useState<'copied' | 'note' | null>(null);
  const [target, setTarget] = useState<'BOTH' | 'B' | 'A'>('BOTH');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const f = q.data;
  const done = async (msg: string) => {
    toast.show(msg);
    await qc.invalidateQueries({ queryKey: ['flag', id] });
    if (f) {
      void qc.invalidateQueries({ queryKey: ['results', f.assignmentId] });
      void qc.invalidateQueries({ queryKey: ['submission'] });
    }
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const act = async (kind: 'confirm' | 'dismiss' | 'note') => {
    setBusy(kind);
    try {
      if (kind === 'confirm') await api(`/flags/${id}/confirm`, { method: 'POST', body: { target: f?.type === 'HANDWRITING_MISMATCH' ? 'A' : target, note: note.trim() || undefined } });
      else if (kind === 'dismiss') await api(`/flags/${id}/dismiss`, { method: 'POST', body: { note: note.trim() || undefined } });
      else await api(`/flags/${id}/note`, { method: 'PUT', body: { note: note.trim() } });
      setDialog(null);
      await done(kind === 'confirm' ? 'Marked as copied. Marks set to 0.' : kind === 'dismiss' ? 'Flag dismissed.' : 'Note saved.');
      if (kind !== 'note' && f) nav(`/assignments/${f.assignmentId}/results`);
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading)
    return (
      <Page title="Academic Integrity Review" back={-1}>
        <SkeletonList rows={2} />
      </Page>
    );
  if (q.error || !f || !f.a)
    return (
      <Page title="Academic Integrity Review" back={-1}>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );

  const handwriting = f.type === 'HANDWRITING_MISMATCH';
  const title = handwriting ? 'Handwriting Mismatch' : 'Possible Duplicate Submission';

  return (
    <Page title="Academic Integrity Review" mobileTitle="Integrity Review" back={-1}>
      <div className="space-y-5">
        <div className="flex gap-3 rounded-card border border-danger/50 bg-danger-tint p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-danger">
            <Icon name="gpp_maybe" />
          </span>
          <div>
            <h1 className="text-h2 text-danger">{title}</h1>
            <p className="text-body text-ink">{f.details}</p>
            <p className="mt-1 text-small text-muted">{f.assignment.title}</p>
          </div>
        </div>

        {f.status !== 'OPEN' ? (
          <Banner tone={f.status === 'CONFIRMED' ? 'danger' : 'success'} title={f.status === 'CONFIRMED' ? 'Marked as copied' : 'Flag dismissed'}>
            {f.note ? `Note: ${f.note}` : 'This flag has been resolved.'}
          </Banner>
        ) : null}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel s={f.a} badge={handwriting ? { label: 'This submission', tone: 'danger' } : { label: 'Earlier submission', tone: 'success' }} />
          {f.b ? <Panel s={f.b} badge={handwriting ? { label: 'Earlier verified work', tone: 'neutral' } : { label: 'Later submission', tone: 'danger' }} /> : null}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="space-y-5">
            <h2 className="text-h3 text-ink">Similarity metrics</h2>
            {!handwriting ? (
              <>
                <Metric label="Image similarity" value={f.imageSimilarity} />
                <Metric label="Text similarity" value={f.textSimilarity} />
              </>
            ) : null}
            <Metric label="Handwriting match with own previous work" value={f.handwritingScore} invert />
            <div className="flex gap-2 rounded-ctl border border-line bg-subtle/60 p-3 text-small text-muted">
              <Icon name="info" size={18} className="mt-0.5 text-info" />
              AI flags are indicators, not proof. Please verify the pages yourself before taking action.
            </div>
          </Card>

          {f.status === 'OPEN' ? (
            <Card className="space-y-3 lg:self-start">
              <Button full size="lg" variant="danger" icon="gavel" onClick={() => setDialog('copied')}>
                Mark as Copied
              </Button>
              <p className="text-center text-caption text-muted">Sets the marks to 0 and adds a remark to the record.</p>
              <Button full size="lg" variant="secondary" icon="check_circle" onClick={() => void act('dismiss')} loading={busy === 'dismiss'}>
                Dismiss Flag
              </Button>
              <Button
                full
                variant="text"
                icon="edit_note"
                onClick={() => {
                  setNote(f.note ?? '');
                  setDialog('note');
                }}
              >
                Add Note
              </Button>
            </Card>
          ) : null}
        </div>
      </div>

      <Dialog
        open={dialog === 'copied'}
        onClose={() => setDialog(null)}
        tone="danger"
        icon="gavel"
        title="Mark this submission as copied?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="danger-solid" onClick={() => void act('confirm')} loading={busy === 'confirm'}>
              Confirm
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p>Marks will be set to 0 and a remark will be added. This is recorded in the export.</p>
          {!handwriting && f.b ? (
            <Field label="Apply to">
              <Segmented
                value={target}
                onChange={setTarget}
                size="sm"
                options={[
                  { value: 'BOTH', label: 'Both students' },
                  { value: 'B', label: f.b.name.split(' ')[0] + ' (later)' },
                  { value: 'A', label: f.a.name.split(' ')[0] + ' (earlier)' },
                ]}
              />
            </Field>
          ) : null}
          <Field label="Note" optional>
            <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Student admitted copying" />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={dialog === 'note'}
        onClose={() => setDialog(null)}
        title="Add a note"
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button onClick={() => void act('note')} loading={busy === 'note'} disabled={!note.trim()}>
              Save Note
            </Button>
          </>
        }
      >
        <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notes are visible only to you" />
      </Dialog>
    </Page>
  );
}
