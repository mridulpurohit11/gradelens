import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, inArray, ne, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { ah, HttpError } from '../lib/http.js';
import type { AuthedRequest } from '../auth/middleware.js';
import type { Submission } from '../db/schema.js';
import { clientForTeacher } from '../services/google.js';
import { prepareSubmission } from '../services/sources.js';
import { refreshCompletion, regradeSubmission } from '../services/evaluation.js';
import { roundHalf } from '../services/ai.js';
import { classLabel, ownFlag, ownSubmission } from './guards.js';

export const submissionsRouter = Router();
export const flagsRouter = Router();

async function brief(sub: Submission | undefined | null) {
  if (!sub) return null;
  const st = sub.studentId ? await db.query.students.findFirst({ where: eq(schema.students.id, sub.studentId) }) : null;
  return {
    id: sub.id,
    name: st?.name ?? sub.detectedName ?? sub.label,
    rollNo: st?.rollNo ?? sub.detectedRoll ?? null,
    studentId: sub.studentId,
    submittedAt: sub.submittedAt,
    isLate: sub.isLate,
    pageCount: sub.pageCount,
    reviewStatus: sub.reviewStatus,
    total: sub.totalMarks,
    files: sub.files.map((f) => ({ name: f.name, mimeType: f.mimeType })),
  };
}

submissionsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { submission: s, assignment: a } = await ownSubmission(t.id, req.params.id);
    const [cls, questions, scores, flags, student] = await Promise.all([
      db.query.classes.findFirst({ where: eq(schema.classes.id, a.classId) }),
      db.query.questions.findMany({ where: eq(schema.questions.assignmentId, a.id), orderBy: asc(schema.questions.order) }),
      db.query.questionScores.findMany({ where: eq(schema.questionScores.submissionId, s.id) }),
      db.query.fraudFlags.findMany({
        where: or(eq(schema.fraudFlags.submissionAId, s.id), eq(schema.fraudFlags.submissionBId, s.id)),
      }),
      s.studentId ? db.query.students.findFirst({ where: eq(schema.students.id, s.studentId) }) : Promise.resolve(null),
    ]);
    const others = await Promise.all(
      flags.map(async (f) => {
        const otherId = f.submissionAId === s.id ? f.submissionBId : f.submissionAId;
        const other = otherId ? await db.query.submissions.findFirst({ where: eq(schema.submissions.id, otherId) }) : null;
        return { ...f, other: await brief(other) };
      }),
    );
    const scoreBy = new Map(scores.map((x) => [x.questionId, x]));
    const total = questions.reduce((sum, q) => sum + q.marks, 0);
    res.json({
      id: s.id,
      assignment: { id: a.id, title: a.title, status: a.status, dueDate: a.dueDate },
      class: cls ? { id: cls.id, label: classLabel(cls) } : null,
      student: student ? { id: student.id, name: student.name, rollNo: student.rollNo } : null,
      label: s.label,
      name: student?.name ?? s.detectedName ?? s.label,
      rollNo: student?.rollNo ?? s.detectedRoll ?? null,
      status: s.status,
      reviewStatus: s.reviewStatus,
      totalMarks: total,
      awarded: s.reviewStatus === 'COPIED' ? 0 : s.totalMarks,
      aiTotal: s.aiTotal,
      confidence: s.confidence,
      legibility: s.legibility,
      modelUsed: s.modelUsed,
      escalated: s.escalated,
      submittedAt: s.submittedAt,
      isLate: s.isLate,
      pageCount: s.pageCount,
      files: s.files.map((f) => ({ name: f.name, mimeType: f.mimeType, driveUrl: f.id.startsWith('demo:') ? null : `https://drive.google.com/file/d/${f.id}/view` })),
      overallFeedback: s.overallFeedback,
      concerns: s.aiConcerns,
      teacherRemark: s.teacherRemark,
      handwritingScore: s.handwritingScore,
      detectedName: s.detectedName,
      detectedRoll: s.detectedRoll,
      error: s.error,
      transcriptAvailable: Boolean(s.transcript),
      questions: questions.map((q, i) => {
        const sc = scoreBy.get(q.id);
        return {
          id: q.id,
          number: i + 1,
          text: q.text,
          maxMarks: q.marks,
          rubric: q.rubric,
          marks: sc?.marks ?? null,
          aiMarks: sc?.aiMarks ?? null,
          attempted: sc?.attempted ?? null,
          feedback: sc?.feedback ?? null,
          covered: sc?.covered ?? [],
          missing: sc?.missing ?? [],
          confidence: sc?.confidence ?? null,
          edited: sc?.edited ?? false,
        };
      }),
      flags: others.map((f) => ({
        id: f.id,
        type: f.type,
        status: f.status,
        details: f.details,
        imageSimilarity: f.imageSimilarity,
        textSimilarity: f.textSimilarity,
        handwritingScore: f.handwritingScore,
        other: f.other,
      })),
    });
  }),
);

/** Serves one page image of the submission (downloaded from Drive and cached). */
submissionsRouter.get(
  '/:id/pages/:n',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { submission } = await ownSubmission(t.id, req.params.id);
    const n = Number(req.params.n);
    if (!Number.isInteger(n) || n < 0) throw new HttpError(400, 'Invalid page');
    const prepared = await prepareSubmission(() => clientForTeacher(t), submission.files);
    const page = prepared.pages[n];
    if (!page) throw new HttpError(404, 'Page not found');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(page);
  }),
);

submissionsRouter.get(
  '/:id/transcript',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { submission } = await ownSubmission(t.id, req.params.id);
    res.json({ transcript: submission.transcript ?? '' });
  }),
);

submissionsRouter.put(
  '/:id',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { submission: s, assignment: a } = await ownSubmission(t.id, req.params.id);
    if (s.status !== 'GRADED') throw new HttpError(409, 'This submission has not been evaluated yet.');
    const body = z
      .object({
        scores: z.array(z.object({ questionId: z.string(), marks: z.number().min(0) })).optional(),
        remark: z.string().trim().max(1000).optional().nullable(),
        reviewStatus: z.enum(['APPROVED', 'NEEDS_REVIEW', 'SUSPICIOUS', 'PENDING']).optional(),
      })
      .parse(req.body);
    const questions = await db.query.questions.findMany({ where: eq(schema.questions.assignmentId, a.id) });
    const qById = new Map(questions.map((q) => [q.id, q]));
    await db.transaction(async (tx) => {
      for (const sc of body.scores ?? []) {
        const q = qById.get(sc.questionId);
        if (!q) throw new HttpError(400, 'Unknown question');
        if (sc.marks > q.marks) throw new HttpError(400, `Marks for this question cannot exceed ${q.marks}.`, 'MARKS_RANGE');
        await tx
          .update(schema.questionScores)
          .set({ marks: roundHalf(sc.marks), edited: true })
          .where(and(eq(schema.questionScores.submissionId, s.id), eq(schema.questionScores.questionId, sc.questionId)));
      }
      const all = await tx.query.questionScores.findMany({ where: eq(schema.questionScores.submissionId, s.id) });
      const total = all.reduce((sum, x) => sum + x.marks, 0);
      const nextStatus = body.reviewStatus ?? (s.reviewStatus === 'COPIED' ? 'COPIED' : s.reviewStatus);
      await tx
        .update(schema.submissions)
        .set({
          totalMarks: total,
          ...(body.remark !== undefined ? { teacherRemark: body.remark || null } : {}),
          reviewStatus: nextStatus,
          approvedAt: nextStatus === 'APPROVED' ? new Date() : null,
        })
        .where(eq(schema.submissions.id, s.id));
    });
    await refreshCompletion(a.id);
    res.json({ ok: true });
  }),
);

submissionsRouter.post(
  '/:id/regrade',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { submission, assignment } = await ownSubmission(t.id, req.params.id);
    if (submission.status === 'PROCESSING' || submission.status === 'QUEUED') throw new HttpError(409, 'This submission is already being evaluated.');
    if (!env.aiConfigured) throw new HttpError(503, 'The Claude API key is not configured on the server.', 'AI_NOT_CONFIGURED');
    const { strong } = z.object({ strong: z.boolean().default(true) }).parse(req.body ?? {});
    await regradeSubmission(submission, strong);
    res.json({ ok: true, assignmentId: assignment.id });
  }),
);

/** Assigns an unmatched upload to a roster student. */
submissionsRouter.put(
  '/:id/student',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { submission, assignment } = await ownSubmission(t.id, req.params.id);
    const { studentId } = z.object({ studentId: z.string().min(1) }).parse(req.body);
    const st = await db.query.students.findFirst({
      where: and(eq(schema.students.id, studentId), eq(schema.students.classId, assignment.classId)),
    });
    if (!st) throw new HttpError(404, 'Student not found in this class');
    const clash = await db.query.submissions.findFirst({
      where: and(eq(schema.submissions.assignmentId, assignment.id), eq(schema.submissions.studentId, studentId), ne(schema.submissions.id, submission.id)),
    });
    if (clash) throw new HttpError(409, `${st.name} already has a submission for this assignment.`, 'DUPLICATE_STUDENT');
    await db
      .update(schema.submissions)
      .set({ studentId, reviewStatus: submission.reviewStatus === 'NEEDS_REVIEW' && (submission.confidence ?? 0) >= env.ESCALATION_CONFIDENCE ? 'PENDING' : submission.reviewStatus })
      .where(eq(schema.submissions.id, submission.id));
    res.json({ ok: true });
  }),
);

// ---------- Integrity flags ----------

flagsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { flag, assignment } = await ownFlag(t.id, req.params.id);
    const [a, b] = await Promise.all([
      db.query.submissions.findFirst({ where: eq(schema.submissions.id, flag.submissionAId) }),
      flag.submissionBId ? db.query.submissions.findFirst({ where: eq(schema.submissions.id, flag.submissionBId) }) : Promise.resolve(null),
    ]);
    res.json({
      ...flag,
      assignment: { id: assignment.id, title: assignment.title },
      a: await brief(a),
      b: await brief(b),
    });
  }),
);

async function settleSubmissions(ids: string[]) {
  // Submissions that no longer have any open flag go back to the normal review queue.
  for (const id of ids) {
    const s = await db.query.submissions.findFirst({ where: eq(schema.submissions.id, id) });
    if (!s || s.reviewStatus !== 'SUSPICIOUS') continue;
    const open = await db.query.fraudFlags.findFirst({
      where: and(
        eq(schema.fraudFlags.status, 'OPEN'),
        or(eq(schema.fraudFlags.submissionAId, id), eq(schema.fraudFlags.submissionBId, id)),
      ),
    });
    if (!open) {
      const next = (s.confidence ?? 0) >= env.ESCALATION_CONFIDENCE && s.studentId ? 'PENDING' : 'NEEDS_REVIEW';
      await db.update(schema.submissions).set({ reviewStatus: next }).where(eq(schema.submissions.id, id));
    }
  }
}

flagsRouter.post(
  '/:id/confirm',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { flag, assignment } = await ownFlag(t.id, req.params.id);
    const { target, note } = z
      .object({ target: z.enum(['A', 'B', 'BOTH']).default('BOTH'), note: z.string().trim().max(1000).optional() })
      .parse(req.body ?? {});
    const ids = [
      ...(target !== 'B' ? [flag.submissionAId] : []),
      ...(target !== 'A' && flag.submissionBId && flag.type !== 'HANDWRITING_MISMATCH' ? [flag.submissionBId] : []),
    ];
    if (!ids.length) ids.push(flag.submissionAId);
    await db.transaction(async (tx) => {
      await tx.update(schema.fraudFlags).set({ status: 'CONFIRMED', note: note ?? flag.note }).where(eq(schema.fraudFlags.id, flag.id));
      const subs = await tx.query.submissions.findMany({ where: inArray(schema.submissions.id, ids) });
      for (const s of subs) {
        const remark = ['Marked as copied (academic integrity).', note, s.teacherRemark].filter(Boolean).join(' ');
        await tx
          .update(schema.submissions)
          .set({ reviewStatus: 'COPIED', totalMarks: 0, teacherRemark: remark.slice(0, 1000), approvedAt: new Date() })
          .where(eq(schema.submissions.id, s.id));
      }
    });
    const others = [flag.submissionAId, flag.submissionBId].filter((x): x is string => Boolean(x) && !ids.includes(x!));
    await settleSubmissions(others);
    await refreshCompletion(assignment.id);
    res.json({ ok: true, copied: ids });
  }),
);

flagsRouter.post(
  '/:id/dismiss',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { flag, assignment } = await ownFlag(t.id, req.params.id);
    const { note } = z.object({ note: z.string().trim().max(1000).optional() }).parse(req.body ?? {});
    await db.update(schema.fraudFlags).set({ status: 'DISMISSED', note: note ?? flag.note }).where(eq(schema.fraudFlags.id, flag.id));
    await settleSubmissions([flag.submissionAId, flag.submissionBId].filter((x): x is string => Boolean(x)));
    await refreshCompletion(assignment.id);
    res.json({ ok: true });
  }),
);

flagsRouter.put(
  '/:id/note',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { flag } = await ownFlag(t.id, req.params.id);
    const { note } = z.object({ note: z.string().trim().max(1000) }).parse(req.body);
    await db.update(schema.fraudFlags).set({ note }).where(eq(schema.fraudFlags.id, flag.id));
    res.json({ ok: true });
  }),
);
