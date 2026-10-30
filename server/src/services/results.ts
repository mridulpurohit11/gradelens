import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Assignment, Question, Student } from '../db/schema.js';

export type ResultRow = {
  submissionId: string | null;
  studentId: string | null;
  name: string;
  rollNo: string | null;
  status: string; // QUEUED | PROCESSING | GRADED | FAILED | MISSING
  reviewStatus: string; // PENDING | APPROVED | NEEDS_REVIEW | SUSPICIOUS | COPIED | MISSING
  total: number | null;
  scores: (number | null)[];
  confidence: number | null;
  isLate: boolean;
  submittedAt: string | null;
  feedback: string | null;
  remark: string | null;
  flagSummary: string | null;
  note: string | null;
  error: string | null;
  escalated: boolean;
};

export async function loadAssignmentBundle(assignmentId: string) {
  const assignment = (await db.query.assignments.findFirst({ where: eq(schema.assignments.id, assignmentId) })) as Assignment;
  const [cls, questions, students, submissions, flags] = await Promise.all([
    db.query.classes.findFirst({ where: eq(schema.classes.id, assignment.classId) }),
    db.query.questions.findMany({ where: eq(schema.questions.assignmentId, assignmentId), orderBy: asc(schema.questions.order) }),
    db.query.students.findMany({ where: eq(schema.students.classId, assignment.classId), orderBy: asc(schema.students.rollNo) }),
    db.query.submissions.findMany({ where: eq(schema.submissions.assignmentId, assignmentId) }),
    db.query.fraudFlags.findMany({ where: eq(schema.fraudFlags.assignmentId, assignmentId) }),
  ]);
  const subIds = submissions.map((s) => s.id);
  const scores = subIds.length
    ? await db.query.questionScores.findMany({ where: inArray(schema.questionScores.submissionId, subIds) })
    : [];
  return { assignment, cls: cls!, questions, students, submissions, flags, scores };
}

export type Bundle = Awaited<ReturnType<typeof loadAssignmentBundle>>;

export const totalMarksOf = (questions: Pick<Question, 'marks'>[]) => questions.reduce((s, q) => s + q.marks, 0);

function flagText(b: Bundle, submissionId: string, nameOf: (id: string | null) => string): string | null {
  const open = b.flags.filter((f) => f.status !== 'DISMISSED' && (f.submissionAId === submissionId || f.submissionBId === submissionId));
  if (!open.length) return null;
  return open
    .map((f) => {
      const other = f.submissionAId === submissionId ? f.submissionBId : f.submissionAId;
      if (f.type === 'HANDWRITING_MISMATCH') return 'Handwriting differs from earlier submission';
      const pct = Math.round(100 * Math.max(f.imageSimilarity ?? 0, f.textSimilarity ?? 0));
      return `${f.type === 'DUPLICATE_IMAGE' ? 'Duplicate image' : 'Similar answers'} with ${nameOf(other)} (${pct}%)`;
    })
    .join('; ');
}

/** One row per roster student (missing included) plus unmatched uploads. */
export function buildResultRows(b: Bundle): ResultRow[] {
  const studentById = new Map<string, Student>(b.students.map((s) => [s.id, s]));
  const subByStudent = new Map(b.submissions.filter((s) => s.studentId).map((s) => [s.studentId!, s]));
  const subById = new Map(b.submissions.map((s) => [s.id, s]));
  const nameOf = (subId: string | null) => {
    const s = subId ? subById.get(subId) : null;
    if (!s) return 'another submission';
    const st = s.studentId ? studentById.get(s.studentId) : null;
    return st ? `${st.name} (${st.rollNo})` : s.label;
  };
  const scoreMap = new Map<string, Map<string, number>>();
  for (const sc of b.scores) {
    const m = scoreMap.get(sc.submissionId) ?? new Map<string, number>();
    m.set(sc.questionId, sc.marks);
    scoreMap.set(sc.submissionId, m);
  }

  const rowFor = (sub: (typeof b.submissions)[number], st: Student | null): ResultRow => {
    const m = scoreMap.get(sub.id);
    const graded = sub.status === 'GRADED';
    return {
      submissionId: sub.id,
      studentId: st?.id ?? null,
      name: st?.name ?? sub.detectedName ?? sub.label,
      rollNo: st?.rollNo ?? sub.detectedRoll ?? null,
      status: sub.status,
      reviewStatus: sub.reviewStatus,
      total: graded ? (sub.reviewStatus === 'COPIED' ? 0 : sub.totalMarks ?? 0) : null,
      scores: b.questions.map((q) => (graded ? (sub.reviewStatus === 'COPIED' ? 0 : m?.get(q.id) ?? 0) : null)),
      confidence: sub.confidence,
      isLate: sub.isLate,
      submittedAt: sub.submittedAt?.toISOString() ?? null,
      feedback: sub.overallFeedback,
      remark: sub.teacherRemark,
      flagSummary: flagText(b, sub.id, nameOf),
      note: st ? null : 'Not matched to the class roster',
      error: sub.error,
      escalated: sub.escalated,
    };
  };

  const rows: ResultRow[] = [];
  for (const st of b.students) {
    const sub = subByStudent.get(st.id);
    if (sub) rows.push(rowFor(sub, st));
    else
      rows.push({
        submissionId: null,
        studentId: st.id,
        name: st.name,
        rollNo: st.rollNo,
        status: 'MISSING',
        reviewStatus: 'MISSING',
        total: null,
        scores: b.questions.map(() => null),
        confidence: null,
        isLate: false,
        submittedAt: null,
        feedback: null,
        remark: null,
        flagSummary: null,
        note: 'No submission found',
        error: null,
        escalated: false,
      });
  }
  for (const sub of b.submissions) if (!sub.studentId) rows.push(rowFor(sub, null));
  return rows;
}

/** Aggregate analytics for the Reports screen. */
export function buildReport(b: Bundle) {
  const rows = buildResultRows(b);
  const totalMarks = totalMarksOf(b.questions);
  const graded = rows.filter((r) => r.status === 'GRADED' && r.total !== null);
  const totals = graded.map((r) => r.total as number);
  const avg = totals.length ? totals.reduce((s, t) => s + t, 0) / totals.length : 0;
  const rosterSize = b.students.length;
  const submittedCount = rows.filter((r) => r.studentId && r.status !== 'MISSING').length;

  const questionPerformance = b.questions.map((q, i) => {
    const vals = graded.map((r) => r.scores[i] ?? 0);
    const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    return { questionId: q.id, number: i + 1, text: q.text, marks: q.marks, average: mean, percent: q.marks ? mean / q.marks : 0 };
  });

  const bucketCount = 4;
  const width = totalMarks / bucketCount || 1;
  const distribution = Array.from({ length: bucketCount }, (_, i) => {
    const from = Math.round(i * width * 10) / 10;
    const to = Math.round((i + 1) * width * 10) / 10;
    const count = totals.filter((t) => (i === bucketCount - 1 ? t >= from && t <= to : t >= from && t < to)).length;
    return { label: `${trim(from)}–${trim(to)}`, from, to, count };
  });

  const topPerformers = [...graded]
    .filter((r) => r.reviewStatus !== 'COPIED')
    .sort((a, b2) => (b2.total ?? 0) - (a.total ?? 0))
    .slice(0, 5)
    .map((r) => ({ name: r.name, rollNo: r.rollNo, total: r.total }));

  return {
    totalMarks,
    evaluated: graded.length,
    average: avg,
    highest: totals.length ? Math.max(...totals) : null,
    lowest: totals.length ? Math.min(...totals) : null,
    submissionRate: rosterSize ? submittedCount / rosterSize : null,
    submitted: submittedCount,
    rosterSize,
    questionPerformance,
    distribution,
    topPerformers,
    missing: rows.filter((r) => r.status === 'MISSING').map((r) => ({ name: r.name, rollNo: r.rollNo })),
    late: rows.filter((r) => r.isLate).length,
  };
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export const reviewCounts = (rows: ResultRow[]) => ({
  total: rows.length,
  evaluated: rows.filter((r) => r.status === 'GRADED').length,
  approved: rows.filter((r) => r.reviewStatus === 'APPROVED').length,
  pending: rows.filter((r) => r.reviewStatus === 'PENDING' && r.status === 'GRADED').length,
  needsReview: rows.filter((r) => r.reviewStatus === 'NEEDS_REVIEW').length,
  suspicious: rows.filter((r) => r.reviewStatus === 'SUSPICIOUS').length,
  copied: rows.filter((r) => r.reviewStatus === 'COPIED').length,
  missing: rows.filter((r) => r.status === 'MISSING').length,
  inProgress: rows.filter((r) => r.status === 'QUEUED' || r.status === 'PROCESSING').length,
  failed: rows.filter((r) => r.status === 'FAILED').length,
  unmatched: rows.filter((r) => !r.studentId && r.submissionId).length,
});

export async function teacherAssignmentIds(teacherId: string) {
  const rows = await db
    .select({ id: schema.assignments.id })
    .from(schema.assignments)
    .where(and(eq(schema.assignments.teacherId, teacherId)));
  return rows.map((r) => r.id);
}
