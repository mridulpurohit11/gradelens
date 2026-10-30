import { Link } from 'react-router-dom';
import clsx from 'clsx';
import type { AssignmentListItem, AssignmentStatus } from '@/lib/types';
import { fmtDate, fmtNum } from '@/lib/format';
import { Icon, ProgressBar } from '@/components/ui';
import { AssignmentChip } from '@/components/ui/status';

export function assignmentAction(a: { id: string; status: AssignmentStatus; needsReview?: number; suspicious?: number; questionCount?: number }) {
  switch (a.status) {
    case 'DRAFT':
      return { to: a.questionCount ? `/assignments/${a.id}/key` : `/assignments/${a.id}/edit`, label: 'Continue setup' };
    case 'KEY_READY':
      return { to: `/assignments/${a.id}/edit?step=3`, label: 'Start evaluation' };
    case 'EVALUATING':
      return { to: `/assignments/${a.id}/progress`, label: 'View progress' };
    case 'REVIEW': {
      const n = (a.needsReview ?? 0) + (a.suspicious ?? 0);
      return { to: `/assignments/${a.id}/results`, label: n ? `Review ${n} flagged` : 'Review & approve' };
    }
    default:
      return { to: `/assignments/${a.id}/results`, label: 'View results' };
  }
}

export function progressOf(a: Pick<AssignmentListItem, 'graded' | 'submissions' | 'rosterSize' | 'failed'>) {
  const denom = a.submissions || a.rosterSize || 0;
  const done = a.graded + (a.failed ?? 0);
  return { done: a.graded, denom, value: denom ? done / denom : 0 };
}

export function AssignmentCard({ a, showClass = true }: { a: AssignmentListItem; showClass?: boolean }) {
  const act = assignmentAction(a);
  const p = progressOf(a);
  const flagged = a.needsReview + a.suspicious;
  const tone = a.status === 'COMPLETED' ? 'success' : a.status === 'REVIEW' && flagged ? 'warning' : 'primary';
  const showProgress = !['DRAFT', 'KEY_READY'].includes(a.status);
  return (
    <Link to={act.to} className="card block p-4 transition-colors hover:border-primary/40 lg:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-h3 text-ink">{a.title}</h3>
          {showClass ? <p className="mt-0.5 truncate text-small text-muted">{a.classLabel}</p> : null}
        </div>
        <AssignmentChip status={a.status} paused={a.paused} needsReview={flagged} />
      </div>
      {showProgress ? (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 flex items-center justify-between text-small">
            <span className="text-muted">
              Progress: <span className="tnum">{p.done}/{p.denom}</span> evaluated
            </span>
            <span className="tnum font-semibold text-ink">{Math.round(p.value * 100)}%</span>
          </div>
          <ProgressBar value={p.value} tone={tone} />
        </div>
      ) : null}
      <div className={clsx('flex items-center justify-between gap-3 text-small', showProgress ? 'mt-3' : 'mt-4 border-t border-line pt-3')}>
        <span className="flex min-w-0 items-center gap-1.5 text-muted">
          <Icon name={a.status === 'COMPLETED' ? 'task_alt' : 'event'} size={18} />
          <span className="truncate">
            {a.status === 'COMPLETED' && a.finishedAt ? `Completed ${fmtDate(a.finishedAt)}` : a.dueDate ? `Due ${fmtDate(a.dueDate)}` : 'No due date'}
            {a.average !== null && a.totalMarks ? ` · Avg ${fmtNum(a.average)}/${fmtNum(a.totalMarks)}` : ''}
          </span>
        </span>
        <span className={clsx('flex shrink-0 items-center gap-0.5 font-semibold', flagged && a.status === 'REVIEW' ? 'text-warning' : 'text-primary')}>
          {act.label}
          <Icon name="chevron_right" size={18} />
        </span>
      </div>
    </Link>
  );
}
