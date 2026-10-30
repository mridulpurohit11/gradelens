import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ClassItem } from '@/lib/types';
import { fmtDate } from '@/lib/format';
import { Page } from '@/components/layout/AppShell';
import { Button, Card, EmptyState, ErrorState, FilterChip, Icon, Input, SkeletonList } from '@/components/ui';
import { AssignmentChip } from '@/components/ui/status';

function SourceTag({ c }: { c: ClassItem }) {
  if (!c.sourceType) return <span className="text-muted">No source linked</span>;
  return (
    <span className="inline-flex items-center gap-1 text-accent">
      <Icon name="cloud_done" size={18} />
      {c.sourceType === 'DRIVE_FOLDER' ? 'Google Drive linked' : 'Google Sheet linked'}
    </span>
  );
}

export default function ClassesList() {
  const nav = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['classes'], queryFn: () => api<ClassItem[]>('/classes') });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>('ALL');

  const filters = useMemo(() => {
    const out: { key: string; label: string; count: number }[] = [];
    if (!data) return out;
    const courses = [...new Set(data.map((c) => c.course))];
    const sems = [...new Set(data.map((c) => c.semester))];
    courses.forEach((c) => out.push({ key: `c:${c}`, label: c, count: data.filter((x) => x.course === c).length }));
    sems.forEach((s) => out.push({ key: `s:${s}`, label: s, count: data.filter((x) => x.semester === s).length }));
    return out;
  }, [data]);

  const list = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.filter((c) => {
      if (filter.startsWith('c:') && c.course !== filter.slice(2)) return false;
      if (filter.startsWith('s:') && c.semester !== filter.slice(2)) return false;
      if (!needle) return true;
      return [c.label, c.subjectName, c.subjectCode ?? ''].some((x) => x.toLowerCase().includes(needle));
    });
  }, [data, q, filter]);

  return (
    <Page title="Classes" tab>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="hidden lg:block">
          <h1 className="text-h1 text-primary dark:text-ink">Registered Classes</h1>
          <p className="text-body text-muted">{data ? `${data.length} active ${data.length === 1 ? 'class' : 'classes'}` : 'Loading…'}</p>
        </div>
        <div className="lg:w-96">
          <Input icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search classes, courses or subjects" aria-label="Search classes" />
        </div>
      </div>

      {data && data.length > 0 ? (
        <div className="scrollbar-none -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
          <FilterChip active={filter === 'ALL'} onClick={() => setFilter('ALL')} count={data.length}>
            All
          </FilterChip>
          {filters.map((f) => (
            <FilterChip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)} count={f.count}>
              {f.label}
            </FilterChip>
          ))}
        </div>
      ) : null}

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-h2 text-ink lg:hidden">Registered Classes</h2>
        <span className="hidden lg:block" />
        <Button icon="add" onClick={() => nav('/classes/new')}>
          Add Class
        </Button>
      </div>

      {isLoading ? (
        <SkeletonList rows={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data?.length ? (
        <EmptyState
          icon="class"
          title="No classes registered yet"
          body="Register a class to start evaluating assignments."
          action={
            <Button icon="add" onClick={() => nav('/classes/new')}>
              Add your first class
            </Button>
          }
        />
      ) : !list.length ? (
        <EmptyState icon="search_off" title="No matching classes" body="Try a different search or filter." />
      ) : (
        <>
          <div className="grid gap-3 lg:hidden">
            {list.map((c) => (
              <Link key={c.id} to={`/classes/${c.id}`} className="card block p-4 transition-colors hover:border-primary/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-h3 text-ink">{c.label}</h3>
                    <p className="text-body text-muted">{c.subjectName}</p>
                  </div>
                  <Icon name="chevron_right" className="mt-0.5 text-muted" />
                </div>
                <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-small">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="inline-flex items-center gap-1 text-muted">
                      <Icon name="group" size={18} /> {c.studentCount} Students
                    </span>
                    <SourceTag c={c} />
                  </div>
                  <span className="flex items-center gap-1 text-muted">
                    <Icon name="calendar_today" size={18} />
                    {c.lastAssignment ? `Last assignment: ${fmtDate(c.lastAssignment.createdAt)}` : 'No assignments yet'}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <Card padded={false} className="hidden overflow-hidden lg:block">
            <table className="w-full text-left">
              <thead className="border-b border-line bg-subtle/60">
                <tr className="text-caption font-semibold uppercase tracking-[0.05em] text-muted">
                  <th className="px-5 py-3">Class & section</th>
                  <th className="px-3 py-3">Subject</th>
                  <th className="px-3 py-3">Students</th>
                  <th className="px-3 py-3">Submission source</th>
                  <th className="px-3 py-3">Recent assignment</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-subtle/60" onClick={() => nav(`/classes/${c.id}`)}>
                    <td className="px-5 py-4">
                      <p className="text-body font-semibold text-primary dark:text-ink">{c.label}</p>
                    </td>
                    <td className="px-3 py-4">
                      <p className="text-body text-ink">{c.subjectName}</p>
                      {c.subjectCode ? <p className="font-mono text-caption text-muted">{c.subjectCode}</p> : null}
                    </td>
                    <td className="tnum px-3 py-4 text-body text-ink">{c.studentCount}</td>
                    <td className="px-3 py-4 text-small">
                      <SourceTag c={c} />
                    </td>
                    <td className="px-3 py-4">
                      {c.lastAssignment ? (
                        <>
                          <p className="text-small text-ink">{c.lastAssignment.title}</p>
                          <p className="text-caption text-muted">{c.lastAssignment.dueDate ? `Due ${fmtDate(c.lastAssignment.dueDate)}` : fmtDate(c.lastAssignment.createdAt)}</p>
                        </>
                      ) : (
                        <span className="text-small text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-4">{c.lastAssignment ? <AssignmentChip status={c.lastAssignment.status} needsReview={c.lastAssignment.needsReview} /> : null}</td>
                    <td className="px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link to={`/classes/${c.id}`} onClick={(e) => e.stopPropagation()} className="text-small font-semibold text-primary hover:underline">
                          View
                        </Link>
                        <Link to={`/classes/${c.id}/edit`} onClick={(e) => e.stopPropagation()} aria-label="Edit class" className="rounded p-1 text-muted hover:bg-subtle hover:text-primary">
                          <Icon name="edit" size={20} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-line px-5 py-3 text-small text-muted">
              Showing {list.length} of {data.length} classes
            </div>
          </Card>
        </>
      )}
    </Page>
  );
}
