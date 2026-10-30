import pLimit from 'p-limit';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Assignment, Submission, Teacher } from '../db/schema.js';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';
import { clientForTeacher } from './google.js';
import { AiError, compareHandwriting, gradeSubmission, type AiUsage, type GradeContext, type GradeResult } from './ai.js';
import { prepareSubmission, scanSource, type SourceType } from './sources.js';
import { fingerprint } from './images.js';
import { matchStudent } from './matching.js';
import { runFraudChecks } from './fraud.js';
import { notify } from './notify.js';

const HANDWRITING_MISMATCH_THRESHOLD = 0.35;
const MAX_ATTEMPTS = 3;

/** Global limiter: total concurrent Claude grading calls across all assignments. */
const limit = pLimit(env.EVAL_CONCURRENCY);
const runners = new Map<string, Promise<void>>();
/** Submissions the teacher asked to re-check with the stronger review model. */
const forceReview = new Set<string>();

export function isRunning(assignmentId: string) {
  return runners.has(assignmentId);
}

async function addUsage(assignmentId: string, usage: AiUsage) {
  await db
    .update(schema.assignments)
    .set({
      inputTokens: sql`${schema.assignments.inputTokens} + ${usage.inputTokens}`,
      outputTokens: sql`${schema.assignments.outputTokens} + ${usage.outputTokens}`,
      costUsd: sql`${schema.assignments.costUsd} + ${usage.costUsd}`,
    })
    .where(eq(schema.assignments.id, assignmentId));
}

export { addUsage };

export async function loadAssignmentForTeacher(teacherId: string, id: string) {
  const a = await db.query.assignments.findFirst({
    where: and(eq(schema.assignments.id, id), eq(schema.assignments.teacherId, teacherId)),
  });
  if (!a) throw new HttpError(404, 'Assignment not found', 'NOT_FOUND');
  return a;
}

/** Scans the source and creates/updates one submission row per student (new files are queued). */
export async function syncSubmissions(teacher: Teacher, assignment: Assignment) {
  if (!assignment.sourceType || !assignment.sourceUrl) {
    throw new HttpError(400, 'Add a Google Drive folder or Google Sheet link for submissions first.', 'NO_SOURCE');
  }
  const roster = await db.query.students.findMany({ where: eq(schema.students.classId, assignment.classId) });
  const auth = clientForTeacher(teacher);
  const { groups, skippedFiles } = await scanSource(auth, assignment.sourceType as SourceType, assignment.sourceUrl, roster);

  const existing = await db.query.submissions.findMany({ where: eq(schema.submissions.assignmentId, assignment.id) });
  const byKey = new Map(existing.map((s) => [s.groupKey, s]));
  const due = assignment.dueDate; // stored as the end of the due day
  let queued = 0;

  for (const g of groups) {
    const submittedAt = g.submittedAt ? new Date(g.submittedAt) : null;
    const isLate = Boolean(due && submittedAt && submittedAt > due);
    const prev = byKey.get(g.groupKey);
    const fileSig = (files: { id: string; modifiedTime?: string | null }[]) =>
      files
        .map((f) => `${f.id}@${f.modifiedTime ?? ''}`)
        .sort()
        .join(',');
    if (!prev) {
      await db.insert(schema.submissions).values({
        assignmentId: assignment.id,
        groupKey: g.groupKey,
        label: g.label,
        studentId: g.studentId,
        files: g.files,
        submittedAt,
        isLate,
        status: 'QUEUED',
      });
      queued++;
    } else if (fileSig(prev.files) !== fileSig(g.files)) {
      // The student re-uploaded or added pages: grade again.
      await db
        .update(schema.submissions)
        .set({ files: g.files, submittedAt, isLate, label: g.label, studentId: g.studentId ?? prev.studentId, status: 'QUEUED', attempts: 0, error: null })
        .where(eq(schema.submissions.id, prev.id));
      queued++;
    } else if (prev.status === 'FAILED') {
      await db.update(schema.submissions).set({ status: 'QUEUED', attempts: 0, error: null }).where(eq(schema.submissions.id, prev.id));
      queued++;
    }
  }

  const matchedStudents = new Set(groups.map((g) => g.studentId).filter(Boolean));
  for (const s of existing) if (s.studentId) matchedStudents.add(s.studentId);
  const missing = roster.filter((s) => !matchedStudents.has(s.id));
  return {
    found: groups.length,
    queued,
    skippedFiles,
    unmatched: groups.filter((g) => !g.studentId).length,
    missing: missing.length,
    rosterSize: roster.length,
  };
}

/** Starts (or resumes) background evaluation of all queued submissions. */
export async function startEvaluation(teacher: Teacher, assignment: Assignment) {
  const qs = await db.query.questions.findMany({ where: eq(schema.questions.assignmentId, assignment.id) });
  if (!qs.length) throw new HttpError(400, 'Add at least one question before evaluating.', 'NO_QUESTIONS');
  if (qs.some((q) => !q.approved)) throw new HttpError(400, 'Approve the answer key for every question first.', 'KEY_NOT_APPROVED');
  if (!env.aiConfigured) throw new HttpError(503, 'The Claude API key is not configured on the server.', 'AI_NOT_CONFIGURED');

  const sync = await syncSubmissions(teacher, assignment);
  await db
    .update(schema.assignments)
    .set({
      status: 'EVALUATING',
      paused: false,
      lastError: null,
      evaluationStartedAt: assignment.evaluationStartedAt ?? new Date(),
      evaluationFinishedAt: null,
    })
    .where(eq(schema.assignments.id, assignment.id));
  kick(assignment.id);
  return sync;
}

export function kick(assignmentId: string) {
  if (runners.has(assignmentId)) return;
  const p = runAssignment(assignmentId)
    .catch((err) => console.error('[eval] runner crashed', assignmentId, err))
    .finally(() => runners.delete(assignmentId));
  runners.set(assignmentId, p);
}

async function runAssignment(assignmentId: string) {
  for (;;) {
    const a = await db.query.assignments.findFirst({ where: eq(schema.assignments.id, assignmentId) });
    if (!a || a.paused || a.status !== 'EVALUATING') return;
    const queued = await db
      .select({ id: schema.submissions.id })
      .from(schema.submissions)
      .where(and(eq(schema.submissions.assignmentId, assignmentId), eq(schema.submissions.status, 'QUEUED')))
      .orderBy(asc(schema.submissions.createdAt));
    if (!queued.length) break;

    const ctx = await buildContext(a);
    const teacher = await db.query.teachers.findFirst({ where: eq(schema.teachers.id, a.teacherId) });
    if (!teacher) return;

    let stop: string | null = null;
    await Promise.all(
      queued.map(({ id }) =>
        limit(async () => {
          if (stop) return;
          const fresh = await db.query.assignments.findFirst({
            where: eq(schema.assignments.id, assignmentId),
            columns: { paused: true, status: true },
          });
          if (!fresh || fresh.paused || fresh.status !== 'EVALUATING') {
            stop = 'paused';
            return;
          }
          const err = await processSubmission(teacher, a, ctx, id);
          if (err) stop = err;
        }),
      ),
    );
    if (stop && stop !== 'paused') {
      await db
        .update(schema.assignments)
        .set({ paused: true, lastError: stop })
        .where(eq(schema.assignments.id, assignmentId));
      await notify(teacher, 'ACTION_REQUIRED', 'Evaluation paused', stop, `/assignments/${assignmentId}/progress`);
      return;
    }
    if (stop === 'paused') return;
  }
  await finalizeAssignment(assignmentId);
}

async function buildContext(a: Assignment): Promise<GradeContext & { classId: string }> {
  const cls = await db.query.classes.findFirst({ where: eq(schema.classes.id, a.classId) });
  const qs = await db.query.questions.findMany({
    where: eq(schema.questions.assignmentId, a.id),
    orderBy: asc(schema.questions.order),
  });
  return {
    classId: a.classId,
    course: cls ? `${cls.course} · ${cls.semester} · Section ${cls.section}` : 'University course',
    subject: cls ? `${cls.subjectName}${cls.subjectCode ? ` (${cls.subjectCode})` : ''}` : '',
    title: a.title,
    strictness: a.strictness,
    wantTranscript: a.fraudDetection,
    questions: qs.map((q, i) => ({ number: i + 1, text: q.text, marks: q.marks, modelAnswer: q.modelAnswer, rubric: q.rubric })),
  };
}

function needsEscalation(r: GradeResult) {
  return r.confidence < env.ESCALATION_CONFIDENCE || r.legibility === 'poor' || r.legibility === 'unreadable';
}

/** Grades one submission. Returns a fatal error message that should pause the whole run, or null. */
async function processSubmission(
  teacher: Teacher,
  a: Assignment,
  ctx: GradeContext & { classId: string },
  submissionId: string,
): Promise<string | null> {
  const [sub] = await db
    .update(schema.submissions)
    .set({ status: 'PROCESSING', attempts: sql`${schema.submissions.attempts} + 1` })
    .where(and(eq(schema.submissions.id, submissionId), eq(schema.submissions.status, 'QUEUED')))
    .returning();
  if (!sub) return null; // picked up elsewhere

  try {
    const auth = clientForTeacher(teacher);
    const prepared = await prepareSubmission(auth, sub.files);
    if (!prepared.pages.length && !prepared.text.trim()) {
      await db
        .update(schema.submissions)
        .set({
          status: 'FAILED',
          reviewStatus: 'NEEDS_REVIEW',
          error: prepared.notes[0] ?? 'No readable pages were found in this submission.',
        })
        .where(eq(schema.submissions.id, sub.id));
      return null;
    }

    const pageHashes = await Promise.all(prepared.pages.map((p) => fingerprint(p)));

    const strong = forceReview.delete(sub.id);
    const firstModel = strong ? env.REVIEW_MODEL : env.GRADING_MODEL;
    let { result, usage } = await gradeSubmission(ctx, prepared, firstModel);
    await addUsage(a.id, usage);
    let modelUsed = firstModel;
    let escalated = strong;
    if (!strong && teacher.smartEscalation && env.REVIEW_MODEL !== env.GRADING_MODEL && needsEscalation(result)) {
      try {
        const second = await gradeSubmission(ctx, prepared, env.REVIEW_MODEL);
        await addUsage(a.id, second.usage);
        result = second.result;
        modelUsed = env.REVIEW_MODEL;
        escalated = true;
      } catch (err) {
        console.warn('[eval] escalation failed, keeping first result', (err as Error).message);
      }
    }

    // Identify unmatched uploads from the name / roll number written on the paper.
    let studentId = sub.studentId;
    if (!studentId && (result.detectedRoll || result.detectedName)) {
      const roster = await db.query.students.findMany({ where: eq(schema.students.classId, ctx.classId) });
      const found = matchStudent(result.detectedRoll, roster) ?? matchStudent(result.detectedName, roster);
      if (found) {
        const taken = await db.query.submissions.findFirst({
          where: and(eq(schema.submissions.assignmentId, a.id), eq(schema.submissions.studentId, found.id), ne(schema.submissions.id, sub.id)),
          columns: { id: true },
        });
        if (!taken) studentId = found.id;
      }
    }

    const total = result.questions.reduce((s, q) => s + q.marks, 0);
    const lowConfidence = result.confidence < env.ESCALATION_CONFIDENCE || result.legibility === 'unreadable' || result.legibility === 'poor';
    const concerns = [...result.concerns, ...prepared.notes];
    const reviewStatus = lowConfidence || result.concerns.length || !studentId ? 'NEEDS_REVIEW' : 'PENDING';

    const qs = await db.query.questions.findMany({
      where: eq(schema.questions.assignmentId, a.id),
      orderBy: asc(schema.questions.order),
    });

    await db.transaction(async (tx) => {
      await tx.delete(schema.questionScores).where(eq(schema.questionScores.submissionId, sub.id));
      if (qs.length) {
        await tx.insert(schema.questionScores).values(
          qs.map((q, i) => {
            const r = result.questions.find((x) => x.number === i + 1);
            return {
              submissionId: sub.id,
              questionId: q.id,
              aiMarks: r?.marks ?? 0,
              marks: r?.marks ?? 0,
              attempted: r?.attempted ?? false,
              feedback: r?.feedback ?? null,
              covered: r?.covered ?? [],
              missing: r?.missing ?? [],
              confidence: r?.confidence ?? null,
            };
          }),
        );
      }
      await tx
        .update(schema.submissions)
        .set({
          status: 'GRADED',
          reviewStatus,
          studentId,
          totalMarks: total,
          aiTotal: total,
          confidence: result.confidence,
          legibility: result.legibility,
          modelUsed,
          escalated,
          pageCount: prepared.pages.length,
          pageHashes,
          transcript: result.transcript || null,
          detectedName: result.detectedName || null,
          detectedRoll: result.detectedRoll || null,
          overallFeedback: result.overallFeedback || null,
          aiConcerns: concerns,
          error: null,
          gradedAt: new Date(),
          approvedAt: null,
        })
        .where(eq(schema.submissions.id, sub.id));
    });

    if (a.handwritingCheck && studentId && prepared.pages.length) {
      await checkHandwriting(teacher, a, { ...sub, studentId }, prepared.pages[0]).catch((err) =>
        console.warn('[eval] handwriting check failed', (err as Error).message),
      );
    }
    return null;
  } catch (err) {
    if (err instanceof HttpError && ['GOOGLE_REAUTH', 'AI_AUTH', 'AI_NOT_CONFIGURED', 'GOOGLE_API_DISABLED', 'GOOGLE_NOT_CONFIGURED'].includes(err.code ?? '')) {
      await db.update(schema.submissions).set({ status: 'QUEUED' }).where(eq(schema.submissions.id, sub.id));
      return err.message;
    }
    const retryable = err instanceof AiError ? err.retryable : err instanceof HttpError && [429, 502, 503].includes(err.status);
    const message = err instanceof Error ? err.message : 'Evaluation failed';
    console.warn('[eval] submission failed', sub.id, message);
    if (retryable && sub.attempts < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 2000 * sub.attempts));
      await db.update(schema.submissions).set({ status: 'QUEUED', error: message }).where(eq(schema.submissions.id, sub.id));
    } else {
      await db
        .update(schema.submissions)
        .set({ status: 'FAILED', reviewStatus: 'NEEDS_REVIEW', error: message })
        .where(eq(schema.submissions.id, sub.id));
    }
    return null;
  }
}

/** Compares this submission's handwriting with the same student's latest earlier submission. */
async function checkHandwriting(teacher: Teacher, a: Assignment, sub: Submission & { studentId: string }, currentPage: Buffer) {
  const previous = await db
    .select()
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.studentId, sub.studentId),
        ne(schema.submissions.assignmentId, a.id),
        eq(schema.submissions.status, 'GRADED'),
        inArray(schema.submissions.reviewStatus, ['APPROVED', 'PENDING']),
      ),
    )
    .orderBy(desc(schema.submissions.gradedAt))
    .limit(1);
  const ref = previous[0];
  if (!ref || !ref.files.length) return;

  const auth = clientForTeacher(teacher);
  const refPrepared = await prepareSubmission(auth, ref.files.slice(0, 1));
  if (!refPrepared.pages.length) return;
  const { probability, reasoning, usage } = await compareHandwriting(refPrepared.pages[0], currentPage);
  await addUsage(a.id, usage);
  await db.update(schema.submissions).set({ handwritingScore: probability }).where(eq(schema.submissions.id, sub.id));
  await db
    .delete(schema.fraudFlags)
    .where(and(eq(schema.fraudFlags.submissionAId, sub.id), eq(schema.fraudFlags.type, 'HANDWRITING_MISMATCH'), eq(schema.fraudFlags.status, 'OPEN')));
  if (probability < HANDWRITING_MISMATCH_THRESHOLD) {
    await db.insert(schema.fraudFlags).values({
      assignmentId: a.id,
      submissionAId: sub.id,
      submissionBId: ref.id,
      type: 'HANDWRITING_MISMATCH',
      handwritingScore: probability,
      details: `Handwriting differs from this student's earlier submission. ${reasoning}`,
    });
    await db
      .update(schema.submissions)
      .set({ reviewStatus: 'SUSPICIOUS' })
      .where(and(eq(schema.submissions.id, sub.id), inArray(schema.submissions.reviewStatus, ['PENDING', 'NEEDS_REVIEW'])));
  }
}

async function finalizeAssignment(assignmentId: string) {
  const a = await db.query.assignments.findFirst({ where: eq(schema.assignments.id, assignmentId) });
  if (!a || a.status !== 'EVALUATING') return;
  let flags = 0;
  if (a.fraudDetection) {
    try {
      flags = await runFraudChecks(assignmentId);
    } catch (err) {
      console.error('[eval] fraud checks failed', err);
    }
  }
  await db
    .update(schema.assignments)
    .set({ status: 'REVIEW', evaluationFinishedAt: new Date(), lastError: null })
    .where(eq(schema.assignments.id, assignmentId));

  const teacher = await db.query.teachers.findFirst({ where: eq(schema.teachers.id, a.teacherId) });
  if (!teacher) return;
  const counts = await db
    .select({ status: schema.submissions.status, n: sql<number>`count(*)::int` })
    .from(schema.submissions)
    .where(eq(schema.submissions.assignmentId, assignmentId))
    .groupBy(schema.submissions.status);
  const graded = counts.find((c) => c.status === 'GRADED')?.n ?? 0;
  const failed = counts.find((c) => c.status === 'FAILED')?.n ?? 0;
  await notify(
    teacher,
    'EVALUATION_COMPLETE',
    'Evaluation completed',
    `${a.title}: ${graded} submission${graded === 1 ? '' : 's'} evaluated${failed ? `, ${failed} could not be read` : ''}.`,
    `/assignments/${assignmentId}/results`,
  );
  const openFlags = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.fraudFlags)
    .where(and(eq(schema.fraudFlags.assignmentId, assignmentId), eq(schema.fraudFlags.status, 'OPEN')));
  if ((openFlags[0]?.n ?? 0) > 0 || flags > 0) {
    await notify(
      teacher,
      'FRAUD',
      'Possible copied submissions',
      `${a.title}: ${openFlags[0]?.n ?? flags} integrity flag(s) need your review.`,
      `/assignments/${assignmentId}/results?filter=SUSPICIOUS`,
    );
  }
}

/** Marks an assignment COMPLETED once every graded submission has been approved or resolved. */
export async function refreshCompletion(assignmentId: string) {
  const a = await db.query.assignments.findFirst({ where: eq(schema.assignments.id, assignmentId) });
  if (!a || (a.status !== 'REVIEW' && a.status !== 'COMPLETED')) return;
  const pending = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.assignmentId, assignmentId),
        inArray(schema.submissions.reviewStatus, ['PENDING', 'NEEDS_REVIEW', 'SUSPICIOUS']),
      ),
    );
  const next = (pending[0]?.n ?? 0) === 0 ? 'COMPLETED' : 'REVIEW';
  if (next !== a.status) await db.update(schema.assignments).set({ status: next }).where(eq(schema.assignments.id, assignmentId));
}

/** Re-queue a single submission (e.g. teacher asks for a second opinion). */
export async function regradeSubmission(submission: Submission, useReviewModel = false) {
  if (useReviewModel) forceReview.add(submission.id);
  await db
    .update(schema.submissions)
    .set({ status: 'QUEUED', attempts: 0, error: null })
    .where(eq(schema.submissions.id, submission.id));
  await db
    .update(schema.assignments)
    .set({ status: 'EVALUATING', paused: false, lastError: null, evaluationFinishedAt: null })
    .where(eq(schema.assignments.id, submission.assignmentId));
  kick(submission.assignmentId);
}

/** On boot: resume runs that were interrupted by a restart. */
export async function resumeInterruptedRuns() {
  await db
    .update(schema.submissions)
    .set({ status: 'QUEUED' })
    .where(eq(schema.submissions.status, 'PROCESSING'));
  const active = await db.query.assignments.findMany({
    where: and(eq(schema.assignments.status, 'EVALUATING'), eq(schema.assignments.paused, false)),
    columns: { id: true },
  });
  for (const a of active) kick(a.id);
  if (active.length) console.log(`[eval] resumed ${active.length} evaluation run(s)`);
}
