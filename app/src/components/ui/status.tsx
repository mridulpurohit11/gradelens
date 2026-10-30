import type { AssignmentStatus, ReviewStatus, SubStatus } from '@/lib/types';
import { Chip, type Tone } from './index';

export function assignmentStatusInfo(
  status: AssignmentStatus,
  opts: { paused?: boolean; needsReview?: number } = {},
): { label: string; tone: Tone; icon?: string } {
  switch (status) {
    case 'DRAFT':
      return { label: 'Draft', tone: 'neutral', icon: 'edit_note' };
    case 'KEY_READY':
      return { label: 'Ready to evaluate', tone: 'primary', icon: 'task_alt' };
    case 'EVALUATING':
      return opts.paused ? { label: 'Paused', tone: 'warning', icon: 'pause_circle' } : { label: 'Evaluating', tone: 'info', icon: 'progress_activity' };
    case 'REVIEW':
      return opts.needsReview ? { label: `Needs Review (${opts.needsReview})`, tone: 'warning' } : { label: 'Pending approval', tone: 'neutral' };
    case 'COMPLETED':
      return { label: 'Approved', tone: 'success', icon: 'check_circle' };
    default:
      return { label: 'Failed', tone: 'danger', icon: 'error' };
  }
}

export function AssignmentChip({ status, paused, needsReview }: { status: AssignmentStatus; paused?: boolean; needsReview?: number }) {
  const i = assignmentStatusInfo(status, { paused, needsReview });
  return (
    <Chip tone={i.tone} icon={i.icon === 'progress_activity' ? undefined : i.icon}>
      {i.label}
    </Chip>
  );
}

export function reviewInfo(status: SubStatus, review: ReviewStatus): { label: string; tone: Tone; icon: string } {
  if (status === 'MISSING' || review === 'MISSING') return { label: 'Missing', tone: 'outline', icon: 'cloud_off' };
  if (status === 'QUEUED') return { label: 'Queued', tone: 'neutral', icon: 'hourglass_empty' };
  if (status === 'PROCESSING') return { label: 'Evaluating', tone: 'info', icon: 'autorenew' };
  if (status === 'FAILED') return { label: 'Could not read', tone: 'danger', icon: 'error' };
  switch (review) {
    case 'APPROVED':
      return { label: 'Approved', tone: 'success', icon: 'check_circle' };
    case 'NEEDS_REVIEW':
      return { label: 'Needs Review', tone: 'warning', icon: 'rate_review' };
    case 'SUSPICIOUS':
      return { label: 'Suspicious', tone: 'danger', icon: 'warning' };
    case 'COPIED':
      return { label: 'Copied', tone: 'danger', icon: 'block' };
    default:
      return { label: 'Pending', tone: 'neutral', icon: 'schedule' };
  }
}

export function ReviewChip({ status, review }: { status: SubStatus; review: ReviewStatus }) {
  const i = reviewInfo(status, review);
  return (
    <Chip tone={i.tone} icon={i.icon}>
      {i.label}
    </Chip>
  );
}
