import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Assignment } from '@/lib/types';
import { Page } from '@/components/layout/AppShell';
import { ErrorState, SkeletonList } from '@/components/ui';
import { assignmentAction } from '@/components/assignment';

export default function AssignmentRedirect() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['assignment', id], queryFn: () => api<Assignment>(`/assignments/${id}`) });
  if (q.data) {
    const a = q.data;
    return <Navigate replace to={assignmentAction({ id: a.id, status: a.status, needsReview: a.counts.needsReview, suspicious: a.counts.suspicious, questionCount: a.questions.length }).to} />;
  }
  return (
    <Page title="Assignment" back="/assignments">
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : <SkeletonList rows={2} />}
    </Page>
  );
}
