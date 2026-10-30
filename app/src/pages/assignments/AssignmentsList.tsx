import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AssignmentListItem } from '@/lib/types';
import { Page } from '@/components/layout/AppShell';
import { Button, EmptyState, ErrorState, FilterChip, Input, SkeletonList } from '@/components/ui';
import { AssignmentCard } from '@/components/assignment';

type F = 'all' | 'draft' | 'evaluating' | 'review' | 'completed';
const match = (a: AssignmentListItem, f: F) =>
  f === 'all' ||
  (f === 'draft' && (a.status === 'DRAFT' || a.status === 'KEY_READY')) ||
  (f === 'evaluating' && a.status === 'EVALUATING') ||
  (f === 'review' && a.status === 'REVIEW') ||
  (f === 'completed' && a.status === 'COMPLETED');

export default function AssignmentsList() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as F) || 'all';
  const [q, setQ] = useState('');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['assignments', 'all'],
    queryFn: () => api<AssignmentListItem[]>('/assignments'),
    refetchInterval: (x) => (x.state.data?.some((a) => a.status === 'EVALUATING' && !a.paused) ? 10_000 : false),
  });
  const list = useMemo(
    () =>
      (data ?? []).filter((a) => {
        const n = q.trim().toLowerCase();
        return match(a, filter) && (!n || a.title.toLowerCase().includes(n) || a.classLabel.toLowerCase().includes(n) || a.subjectName.toLowerCase().includes(n));
      }),
    [data, filter, q],
  );
  const count = (f: F) => (data ?? []).filter((a) => match(a, f)).length;
  const filters: { f: F; label: string }[] = [
    { f: 'all', label: 'All' },
    { f: 'draft', label: 'Drafts' },
    { f: 'evaluating', label: 'Evaluating' },
    { f: 'review', label: 'Needs Review' },
    { f: 'completed', label: 'Approved' },
  ];

  return (
    <Page title="Assignments" tab>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-h2 text-ink lg:text-h1 lg:text-primary dark:lg:text-ink">Assignments</h1>
          <p className="text-small text-muted lg:text-body">Create, evaluate and review assignments for all your classes.</p>
        </div>
        <div className="flex gap-3">
          <div className="min-w-0 flex-1 lg:w-80">
            <Input icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assignments" aria-label="Search assignments" />
          </div>
          <Button icon="add" onClick={() => nav('/assignments/new')} className="shrink-0">
            <span className="hidden sm:inline">New Assignment</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </div>
      <div className="scrollbar-none -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {filters.map((x) => (
          <FilterChip key={x.f} active={filter === x.f} count={data ? count(x.f) : undefined} onClick={() => setParams(x.f === 'all' ? {} : { filter: x.f }, { replace: true })}>
            {x.label}
          </FilterChip>
        ))}
      </div>
      {isLoading ? (
        <SkeletonList rows={3} />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data?.length ? (
        <EmptyState icon="assignment_add" title="No assignments yet" body="Create an assignment, upload its questions and let GradeLens evaluate the submissions." action={<Button icon="add" onClick={() => nav('/assignments/new')}>New Assignment</Button>} />
      ) : !list.length ? (
        <EmptyState icon="search_off" title="Nothing here" body="No assignments match this filter." />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 lg:gap-4">
          {list.map((a) => (
            <AssignmentCard key={a.id} a={a} />
          ))}
        </div>
      )}
    </Page>
  );
}
