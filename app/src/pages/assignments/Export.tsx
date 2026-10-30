import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiBlob, api, errorMessage } from '@/lib/api';
import { openExternal, saveFile } from '@/lib/platform';
import type { Results } from '@/lib/types';
import { fmtNum } from '@/lib/format';
import { Page } from '@/components/layout/AppShell';
import { Banner, Button, Card, Chip, ErrorState, Icon, SkeletonList, Toggle } from '@/components/ui';
import { ReviewChip } from '@/components/ui/status';
import { useToast } from '@/components/ui/toast';

export default function ExportPage() {
  const { id } = useParams();
  const toast = useToast();
  const r = useQuery({ queryKey: ['results', id], queryFn: () => api<Results>(`/assignments/${id}/results`) });
  const [opts, setOpts] = useState({ feedback: true, fraud: true, timestamps: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);

  const query = `feedback=${opts.feedback ? 1 : 0}&fraud=${opts.fraud ? 1 : 0}&timestamps=${opts.timestamps ? 1 : 0}`;

  const download = async (format: 'xlsx' | 'pdf') => {
    setBusy(format);
    try {
      const { blob, filename } = await apiBlob(`/assignments/${id}/export?format=${format}&${query}`);
      await saveFile(blob, filename ?? `results.${format}`);
      toast.show(format === 'pdf' ? 'PDF report downloaded.' : 'Results exported successfully.');
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const toSheets = async () => {
    setBusy('sheet');
    try {
      const res = await api<{ url: string }>(`/assignments/${id}/export/google-sheet`, { method: 'POST', body: opts });
      setSheetUrl(res.url);
      toast.show('Results exported to Google Sheets.', { action: { label: 'Open', onClick: () => void openExternal(res.url) } });
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (r.isLoading)
    return (
      <Page title="Export Evaluation Records" back={`/assignments/${id}/results`}>
        <SkeletonList rows={3} />
      </Page>
    );
  if (r.error || !r.data)
    return (
      <Page title="Export Evaluation Records" back={`/assignments/${id}/results`}>
        <ErrorState error={r.error} onRetry={() => void r.refetch()} />
      </Page>
    );
  const d = r.data;
  const preview = d.rows.filter((x) => x.status !== 'MISSING').slice(0, 3);
  const pendingReview = d.counts.needsReview + d.counts.suspicious + d.counts.pending;

  return (
    <Page title="Export Evaluation Records" mobileTitle="Export Records" back={`/assignments/${id}/results`}>
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Chip tone="info" icon="description">
                  Evaluation record
                </Chip>
                <h1 className="mt-2 text-h2 text-primary dark:text-ink">{d.assignment.title}</h1>
                <p className="text-small text-muted">{d.class.label}</p>
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl bg-primary-tint text-primary">
                <Icon name="school" />
              </span>
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-body text-ink">
              <Icon name="fact_check" className="text-primary" />
              <b>{d.counts.evaluated}</b> evaluated · <b>{d.counts.missing}</b> missing · {d.counts.total} rows
            </div>
          </Card>
          {pendingReview ? (
            <Banner tone="warning" title={`${pendingReview} submission(s) are not approved yet`}>
              You can export now — their current AI marks and status will be included.
            </Banner>
          ) : null}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-h3 text-ink">Preview ({d.counts.total} students)</h2>
              <span className="text-small text-muted">Showing {preview.length}</span>
            </div>
            <div className="space-y-3">
              {preview.map((row, i) => (
                <Card key={row.submissionId ?? i} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <span className="tnum text-small text-muted">{String(i + 1).padStart(2, '0')}</span>
                      <div className="min-w-0">
                        <p className="truncate text-body font-semibold text-ink">{row.name}</p>
                        <p className="tnum font-mono text-caption text-muted">{row.rollNo ?? '—'}</p>
                      </div>
                    </div>
                    <ReviewChip status={row.status} review={row.reviewStatus} />
                  </div>
                  <div className="mt-3 grid grid-flow-col auto-cols-fr gap-0 divide-x divide-line rounded-ctl border border-line bg-subtle/50">
                    {d.questions.map((qq, k) => (
                      <div key={qq.id} className="px-2 py-2 text-center">
                        <p className="text-caption text-muted">Q{qq.number}</p>
                        <p className="tnum text-small font-semibold text-ink">
                          {row.scores[k] === null ? '—' : fmtNum(row.scores[k])}
                          <span className="font-normal text-muted">/{fmtNum(qq.marks)}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-small">
                    <span className={row.flagSummary ? 'truncate text-danger' : 'truncate text-muted'}>{row.flagSummary ?? row.remark ?? row.feedback ?? ''}</span>
                    <span className="tnum shrink-0 text-ink">
                      Total: <b>{row.total === null ? '—' : fmtNum(row.total)}</b>/{fmtNum(d.totalMarks)}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <Card className="space-y-5">
            <h2 className="flex items-center gap-2 text-h3 text-ink">
              <Icon name="tune" className="text-primary" /> Export options
            </h2>
            <Toggle label="Include AI feedback" description="Adds the evaluator's feedback for each student." checked={opts.feedback} onChange={(v) => setOpts((o) => ({ ...o, feedback: v }))} />
            <Toggle label="Include integrity remarks" description="Adds duplicate and similarity flags." checked={opts.fraud} onChange={(v) => setOpts((o) => ({ ...o, fraud: v }))} />
            <Toggle label="Include submission times" description="Adds upload time (IST) and late status." checked={opts.timestamps} onChange={(v) => setOpts((o) => ({ ...o, timestamps: v }))} />
          </Card>
          <div className="space-y-3">
            <Button size="lg" full icon="table_view" loading={busy === 'xlsx'} onClick={() => void download('xlsx')}>
              Export to Excel (.xlsx)
            </Button>
            <Button size="lg" full variant="secondary" icon="add_to_drive" loading={busy === 'sheet'} onClick={() => void toSheets()}>
              Export to Google Sheets
            </Button>
            <Button size="lg" full variant="secondary" icon="picture_as_pdf" loading={busy === 'pdf'} onClick={() => void download('pdf')}>
              Download PDF Report
            </Button>
          </div>
          {sheetUrl ? (
            <Banner tone="success" title="Google Sheet created" action={<Button size="sm" variant="secondary" icon="open_in_new" onClick={() => void openExternal(sheetUrl)}>Open sheet</Button>}>
              Saved in your Google Drive.
            </Banner>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
