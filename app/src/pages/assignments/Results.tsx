import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api, errorMessage } from '@/lib/api';
import type { ResultRow, Results as ResultsData } from '@/lib/types';
import { fmtDate, fmtInr, fmtNum } from '@/lib/format';
import { Page } from '@/components/layout/AppShell';
import { Banner, Button, Card, Chip, ConfirmDialog, ErrorState, FilterChip, Icon, IconButton, Input, Select, SkeletonList, StatCard } from '@/components/ui';
import { ReviewChip } from '@/components/ui/status';
import { useToast } from '@/components/ui/toast';

type Filter = 'ALL' | 'APPROVED' | 'PENDING' | 'NEEDS_REVIEW' | 'SUSPICIOUS' | 'MISSING';
type Sort = 'name' | 'roll' | 'marks-desc' | 'marks-asc';

const matches = (r: ResultRow, f: Filter) => {
  switch (f) {
    case 'ALL':
      return true;
    case 'APPROVED':
      return r.reviewStatus === 'APPROVED';
    case 'PENDING':
      return r.reviewStatus === 'PENDING' && r.status === 'GRADED';
    case 'NEEDS_REVIEW':
      return r.reviewStatus === 'NEEDS_REVIEW' || r.status === 'FAILED';
    case 'SUSPICIOUS':
      return r.reviewStatus === 'SUSPICIOUS' || r.reviewStatus === 'COPIED';
    case 'MISSING':
      return r.status === 'MISSING';
  }
};

function rowNote(r: ResultRow) {
  if (r.status === 'MISSING') return { icon: 'cloud_off', text: 'No submission found', tone: 'text-muted' };
  if (r.status === 'FAILED') return { icon: 'error', text: r.error ?? 'Could not be read', tone: 'text-danger' };
  if (r.status === 'QUEUED' || r.status === 'PROCESSING') return { icon: 'hourglass_top', text: 'Being evaluated…', tone: 'text-muted' };
  if (r.flagSummary && (r.reviewStatus === 'SUSPICIOUS' || r.reviewStatus === 'COPIED')) return { icon: 'flag', text: r.flagSummary, tone: 'text-danger' };
  if (!r.studentId) return { icon: 'person_off', text: 'Not matched to a student — assign it', tone: 'text-warning' };
  if (r.reviewStatus === 'NEEDS_REVIEW') return { icon: 'rate_review', text: 'Low AI confidence — please check', tone: 'text-warning' };
  if (r.reviewStatus === 'APPROVED') return { icon: 'verified', text: r.remark ?? 'Approved', tone: 'text-success' };
  return { icon: 'smart_toy', text: r.escalated ? 'Graded by AI · second opinion' : 'Graded by AI', tone: 'text-muted' };
}

export default function Results() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as Filter) || 'ALL';
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('roll');
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const r = useQuery({
    queryKey: ['results', id],
    queryFn: () => api<ResultsData>(`/assignments/${id}/results`),
    refetchInterval: (x) => (x.state.data?.assignment.status === 'EVALUATING' && !x.state.data.assignment.paused ? 5000 : false),
  });
  const data = r.data;

  const rows = useMemo(() => {
    if (!data) return [];
    const n = q.trim().toLowerCase();
    const list = data.rows.filter((x) => matches(x, filter) && (!n || x.name.toLowerCase().includes(n) || (x.rollNo ?? '').toLowerCase().includes(n)));
    const byName = (a: ResultRow, b: ResultRow) => a.name.localeCompare(b.name);
    const sorters: Record<Sort, (a: ResultRow, b: ResultRow) => number> = {
      name: byName,
      roll: (a, b) => (a.rollNo ?? 'zzz').localeCompare(b.rollNo ?? 'zzz', undefined, { numeric: true }),
      'marks-desc': (a, b) => (b.total ?? -1) - (a.total ?? -1) || byName(a, b),
      'marks-asc': (a, b) => (a.total ?? 1e9) - (b.total ?? 1e9) || byName(a, b),
    };
    return [...list].sort(sorters[sort]);
  }, [data, filter, q, sort]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['results', id] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['assignments'] });
  };

  const approveAll = async () => {
    setBusy('approve');
    try {
      const res = await api<{ approved: number }>(`/assignments/${id}/approve-all`, { method: 'POST' });
      toast.show(`${res.approved} submission${res.approved === 1 ? '' : 's'} approved.`);
      setConfirmApprove(false);
      await refresh();
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const rescan = async () => {
    setBusy('rescan');
    try {
      const res = await api<{ queued: number; found: number }>(`/assignments/${id}/rescan`, { method: 'POST' });
      if (res.queued) {
        toast.show(`${res.queued} new or updated submission${res.queued === 1 ? '' : 's'} found. Evaluating now.`);
        nav(`/assignments/${id}/progress`);
      } else toast.show('No new submissions found.', { kind: 'info' });
      await refresh();
    } catch (e) {
      toast.show(errorMessage(e), { kind: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const open = (row: ResultRow) => {
    if (row.submissionId) nav(`/submissions/${row.submissionId}`);
  };

  if (r.isLoading)
    return (
      <Page title="Results Review" back="/assignments">
        <SkeletonList rows={4} />
      </Page>
    );
  if (r.error || !data)
    return (
      <Page title="Results Review" back="/assignments">
        <ErrorState error={r.error} onRetry={() => void r.refetch()} />
      </Page>
    );

  const c = data.counts;
  const filters: { f: Filter; label: string; n: number }[] = [
    { f: 'ALL', label: 'All', n: c.total },
    { f: 'PENDING', label: 'Pending', n: c.pending },
    { f: 'APPROVED', label: 'Approved', n: c.approved },
    { f: 'NEEDS_REVIEW', label: 'Needs Review', n: c.needsReview + c.failed },
    { f: 'SUSPICIOUS', label: 'Suspicious', n: c.suspicious + c.copied },
    { f: 'MISSING', label: 'Missing', n: c.missing },
  ];

  const bottom = (
    <>
      <Button size="lg" variant="secondary" icon="done_all" onClick={() => setConfirmApprove(true)} disabled={!c.pending}>
        Approve All Clean ({c.pending})
      </Button>
      <Button size="lg" icon="ios_share" onClick={() => nav(`/assignments/${id}/export`)}>
        Export Results
      </Button>
    </>
  );

  return (
    <Page
      title="Results Review"
      back="/assignments"
      bottomBar={bottom}
      actions={
        <>
          <IconButton icon="sync" label="Check for new submissions" onClick={rescan} disabled={busy === 'rescan'} />
          <IconButton icon="download" label="Export" onClick={() => nav(`/assignments/${id}/export`)} />
        </>
      }
    >
      <Card className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Evaluation record</p>
            <h1 className="mt-1 text-h2 text-primary dark:text-ink">{data.assignment.title}</h1>
          </div>
          <div className="hidden shrink-0 gap-2 lg:flex">
            <Button variant="secondary" icon="sync" loading={busy === 'rescan'} onClick={rescan}>
              Check for new submissions
            </Button>
            <Link to={`/reports?assignment=${id}`}>
              <Button variant="secondary" icon="bar_chart">
                Analytics
              </Button>
            </Link>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
          <Chip tone="primary">{data.class.label}</Chip>
          <Chip tone="primary">Total marks: {fmtNum(data.totalMarks)}</Chip>
          {data.assignment.dueDate ? <Chip tone="primary" icon="event">Due {fmtDate(data.assignment.dueDate)}</Chip> : null}
          <Chip tone="neutral" icon="smart_toy">AI cost {fmtInr(data.assignment.costInr)}</Chip>
        </div>
      </Card>

      {data.assignment.status === 'EVALUATING' ? (
        <Banner tone="info" className="mb-4" action={<Link to={`/assignments/${id}/progress`} className="font-semibold text-primary hover:underline">View progress</Link>}>
          Evaluation is still running ({c.inProgress} remaining). Results update automatically.
        </Banner>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Evaluated" value={c.evaluated} sub={`of ${c.total - c.missing} submitted`} onClick={() => setParams({}, { replace: true })} />
        <StatCard label="Needs Review" value={c.needsReview + c.failed} sub="Low confidence or unreadable" tone={c.needsReview + c.failed ? 'warning' : undefined} onClick={() => setParams({ filter: 'NEEDS_REVIEW' }, { replace: true })} />
        <StatCard label="Suspicious" value={c.suspicious} sub={c.copied ? `${c.copied} marked copied` : 'Integrity flags'} tone={c.suspicious ? 'danger' : undefined} onClick={() => setParams({ filter: 'SUSPICIOUS' }, { replace: true })} />
        <StatCard label="Missing" value={c.missing} sub="Not submitted" onClick={() => setParams({ filter: 'MISSING' }, { replace: true })} />
      </div>

      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="lg:w-80">
          <Input icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or ID" aria-label="Search submissions" />
        </div>
        <div className="scrollbar-none -mx-4 flex flex-1 gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
          {filters.map((f) => (
            <FilterChip key={f.f} active={filter === f.f} count={f.n} onClick={() => setParams(f.f === 'ALL' ? {} : { filter: f.f }, { replace: true })}>
              {f.label}
            </FilterChip>
          ))}
        </div>
      </div>
      <div className="mb-3 flex items-center justify-between gap-3 text-small text-muted">
        <span>
          Showing {rows.length} of {c.total}
        </span>
        <label className="flex items-center gap-2">
          <Icon name="swap_vert" size={18} />
          <span className="sr-only">Sort by</span>
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-9 w-auto py-0 text-small font-semibold text-primary">
            <option value="roll">Student ID</option>
            <option value="name">Name</option>
            <option value="marks-desc">Marks (high to low)</option>
            <option value="marks-asc">Marks (low to high)</option>
          </Select>
        </label>
      </div>

      {!rows.length ? (
        <Card className="py-10 text-center text-body text-muted">No submissions match this filter.</Card>
      ) : (
        <>
          {/* Mobile list */}
          <div className="space-y-2.5 lg:hidden">
            {rows.map((row) => {
              const note = rowNote(row);
              return (
                <button
                  key={row.submissionId ?? row.studentId}
                  type="button"
                  onClick={() => open(row)}
                  disabled={!row.submissionId}
                  className={clsx('card block w-full p-4 text-left', row.submissionId && 'transition-colors hover:border-primary/40')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-body font-semibold text-ink">
                        {row.name} <span className="tnum font-normal text-muted">· {row.rollNo ?? '—'}</span>
                      </p>
                      <p className={clsx('mt-1 flex items-start gap-1 text-small', note.tone)}>
                        <Icon name={note.icon} size={16} className="mt-0.5" />
                        <span className="line-clamp-2">{note.text}</span>
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="tnum text-h3 text-ink">
                        {row.total === null ? '—' : fmtNum(row.total)}
                        <span className="text-small font-normal text-muted"> / {fmtNum(data.totalMarks)}</span>
                      </span>
                      <ReviewChip status={row.status} review={row.reviewStatus} />
                    </div>
                  </div>
                  {row.isLate ? <Chip tone="warning" icon="schedule" className="mt-2">Late</Chip> : null}
                </button>
              );
            })}
          </div>

          {/* Desktop table */}
          <Card padded={false} className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[860px] text-left">
              <thead className="border-b border-line bg-subtle/60">
                <tr className="text-caption font-semibold uppercase tracking-[0.05em] text-muted">
                  <th className="w-12 px-4 py-3">#</th>
                  <th className="px-3 py-3">Student</th>
                  <th className="px-3 py-3">Student ID</th>
                  {data.questions.map((qq) => (
                    <th key={qq.id} className="px-2 py-3 text-center">
                      Q{qq.number}
                      <span className="block font-normal normal-case tracking-normal">/{fmtNum(qq.marks)}</span>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right">Total</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row, i) => {
                  const note = rowNote(row);
                  return (
                    <tr key={row.submissionId ?? row.studentId} onClick={() => open(row)} className={clsx(row.submissionId && 'cursor-pointer hover:bg-subtle/60')}>
                      <td className="tnum px-4 py-3 text-small text-muted">{i + 1}</td>
                      <td className="px-3 py-3 text-body font-semibold text-ink">
                        {row.name}
                        {row.isLate ? <Chip tone="warning" className="ml-2">Late</Chip> : null}
                      </td>
                      <td className="tnum px-3 py-3 text-body text-ink">{row.rollNo ?? '—'}</td>
                      {row.scores.map((s, k) => (
                        <td key={k} className="tnum px-2 py-3 text-center text-body text-ink">
                          {s === null ? <span className="text-muted">—</span> : fmtNum(s)}
                        </td>
                      ))}
                      <td className="tnum px-3 py-3 text-right text-body font-semibold text-ink">{row.total === null ? '—' : fmtNum(row.total)}</td>
                      <td className="px-3 py-3">
                        <ReviewChip status={row.status} review={row.reviewStatus} />
                      </td>
                      <td className={clsx('max-w-[260px] px-4 py-3 text-small', note.tone)}>
                        <span className="line-clamp-2">{note.text}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={confirmApprove}
        onClose={() => setConfirmApprove(false)}
        onConfirm={approveAll}
        loading={busy === 'approve'}
        icon="done_all"
        title={`Approve ${c.pending} clean submission${c.pending === 1 ? '' : 's'}?`}
        body="Submissions without flags and with high AI confidence will be approved with their current marks. Flagged and low-confidence submissions stay in review."
        confirmLabel="Approve"
      />
    </Page>
  );
}
