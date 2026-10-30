import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { env } from '../env.js';
import { ah, HttpError } from '../lib/http.js';
import type { AuthedRequest } from '../auth/middleware.js';
import type { Assignment, Teacher } from '../db/schema.js';
import { clientForTeacher, createSpreadsheet } from '../services/google.js';
import { extractQuestions, generateAnswerKey, normalizeRubric, roundHalf } from '../services/ai.js';
import { prepareFile } from '../services/images.js';
import { parseSource, scanSource, type SourceType } from '../services/sources.js';
import { addUsage, isRunning, kick, refreshCompletion, startEvaluation, syncSubmissions } from '../services/evaluation.js';
import { buildReport, buildResultRows, loadAssignmentBundle, reviewCounts, totalMarksOf } from '../services/results.js';
import { googleSheetTabs, toPdf, toXlsx, type ExportOptions } from '../services/exports.js';
import { runFraudChecks } from '../services/fraud.js';
import { assignmentCounts, rosterSizes } from './dashboard.js';
import { classLabel, ownAssignment, ownClass, ownQuestion } from './guards.js';

export const assignmentsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const strictness = z.enum(['LENIENT', 'STANDARD', 'STRICT']);
const sourceType = z.enum(['DRIVE_FOLDER', 'GOOGLE_SHEET']);
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date')
  .transform((d) => new Date(`${d}T23:59:59+05:30`)); // due at the end of the day, India time

const assignmentSchema = z.object({
  classId: z.string().min(1, 'Select a class'),
  title: z.string().trim().min(2, 'Assignment title is required').max(160),
  dueDate: dateOnly.optional().nullable(),
  strictness: strictness.optional(),
  fraudDetection: z.boolean().optional(),
  handwritingCheck: z.boolean().optional(),
  sourceType: sourceType.optional().nullable(),
  sourceUrl: z.string().trim().max(500).optional().nullable(),
});

const EDITABLE_STATES = new Set(['DRAFT', 'KEY_READY']);

async function serialize(a: Assignment) {
  const [cls, questions, counts, sizes] = await Promise.all([
    db.query.classes.findFirst({ where: eq(schema.classes.id, a.classId) }),
    db.query.questions.findMany({ where: eq(schema.questions.assignmentId, a.id), orderBy: asc(schema.questions.order) }),
    assignmentCounts([a.id]),
    rosterSizes([a.classId]),
  ]);
  const k = counts.get(a.id)!;
  return {
    ...a,
    costInr: a.costUsd * env.USD_TO_INR,
    class: cls ? { id: cls.id, label: classLabel(cls), course: cls.course, semester: cls.semester, section: cls.section, subjectName: cls.subjectName, subjectCode: cls.subjectCode, sourceType: cls.sourceType, sourceUrl: cls.sourceUrl } : null,
    questions,
    totalMarks: totalMarksOf(questions),
    keyApproved: questions.length > 0 && questions.every((q) => q.approved),
    rosterSize: sizes.get(a.classId) ?? 0,
    counts: { ...k, average: Number.isNaN(k.average) ? null : k.average },
    running: isRunning(a.id),
  };
}

async function syncKeyStatus(assignmentId: string) {
  const a = await db.query.assignments.findFirst({ where: eq(schema.assignments.id, assignmentId) });
  if (!a || !EDITABLE_STATES.has(a.status)) return;
  const qs = await db.query.questions.findMany({ where: eq(schema.questions.assignmentId, assignmentId) });
  const next = qs.length && qs.every((q) => q.approved) ? 'KEY_READY' : 'DRAFT';
  if (next !== a.status) await db.update(schema.assignments).set({ status: next }).where(eq(schema.assignments.id, assignmentId));
}

function sourcePatch(type?: SourceType | null, url?: string | null) {
  if (!type || !url) return { sourceType: null, sourceUrl: null, sourceId: null };
  return { sourceType: type, sourceUrl: url, sourceId: parseSource(type, url) };
}

assignmentsRouter.get(
  '/',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const filters = [eq(schema.assignments.teacherId, t.id)];
    if (typeof req.query.classId === 'string') filters.push(eq(schema.assignments.classId, req.query.classId));
    const list = await db.query.assignments.findMany({ where: and(...filters), orderBy: desc(schema.assignments.createdAt) });
    const ids = list.map((a) => a.id);
    const [counts, classes, totals] = await Promise.all([
      assignmentCounts(ids),
      db.query.classes.findMany({ where: eq(schema.classes.teacherId, t.id) }),
      ids.length
        ? db
            .select({ assignmentId: schema.questions.assignmentId, total: sql<number>`sum(${schema.questions.marks})::float`, n: sql<number>`count(*)::int` })
            .from(schema.questions)
            .where(inArray(schema.questions.assignmentId, ids))
            .groupBy(schema.questions.assignmentId)
        : Promise.resolve([]),
    ]);
    const sizes = await rosterSizes(classes.map((c) => c.id));
    const classById = new Map(classes.map((c) => [c.id, c]));
    const totalBy = new Map(totals.map((x) => [x.assignmentId, x]));
    res.json(
      list.map((a) => {
        const k = counts.get(a.id)!;
        const c = classById.get(a.classId);
        return {
          id: a.id,
          title: a.title,
          status: a.status,
          paused: a.paused,
          dueDate: a.dueDate,
          classId: a.classId,
          classLabel: c ? classLabel(c) : '',
          subjectName: c?.subjectName ?? '',
          createdAt: a.createdAt,
          finishedAt: a.evaluationFinishedAt,
          totalMarks: totalBy.get(a.id)?.total ?? 0,
          questionCount: totalBy.get(a.id)?.n ?? 0,
          rosterSize: sizes.get(a.classId) ?? 0,
          ...k,
          average: Number.isNaN(k.average) ? null : k.average,
        };
      }),
    );
  }),
);

assignmentsRouter.post(
  '/',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const body = assignmentSchema.parse(req.body);
    const cls = await ownClass(t.id, body.classId);
    const src =
      body.sourceType !== undefined || body.sourceUrl !== undefined
        ? sourcePatch(body.sourceType, body.sourceUrl)
        : sourcePatch(cls.sourceType as SourceType | null, cls.sourceUrl);
    const [a] = await db
      .insert(schema.assignments)
      .values({
        classId: cls.id,
        teacherId: t.id,
        title: body.title,
        dueDate: body.dueDate ?? null,
        strictness: body.strictness ?? t.strictness,
        fraudDetection: body.fraudDetection ?? t.fraudDetection,
        handwritingCheck: body.handwritingCheck ?? t.handwritingCheck,
        ...src,
      })
      .returning();
    res.status(201).json(await serialize(a));
  }),
);

assignmentsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    res.json(await serialize(await ownAssignment(t.id, req.params.id)));
  }),
);

assignmentsRouter.put(
  '/:id',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    const body = assignmentSchema.partial().parse(req.body);
    if (body.classId && body.classId !== a.classId) {
      if (!EDITABLE_STATES.has(a.status)) throw new HttpError(409, 'The class cannot be changed after evaluation has started.');
      await ownClass(t.id, body.classId);
    }
    const patch: Partial<Assignment> = {
      ...(body.classId ? { classId: body.classId } : {}),
      ...(body.title ? { title: body.title } : {}),
      ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
      ...(body.strictness ? { strictness: body.strictness } : {}),
      ...(body.fraudDetection !== undefined ? { fraudDetection: body.fraudDetection } : {}),
      ...(body.handwritingCheck !== undefined ? { handwritingCheck: body.handwritingCheck } : {}),
    };
    if (body.sourceType !== undefined || body.sourceUrl !== undefined) {
      Object.assign(patch, sourcePatch(body.sourceType ?? (a.sourceType as SourceType | null), body.sourceUrl ?? a.sourceUrl));
    }
    const [updated] = await db.update(schema.assignments).set(patch).where(eq(schema.assignments.id, a.id)).returning();
    res.json(await serialize(updated));
  }),
);

assignmentsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    if (a.status === 'EVALUATING' && !a.paused) throw new HttpError(409, 'Pause the evaluation before deleting this assignment.', 'BUSY');
    await db.delete(schema.assignments).where(eq(schema.assignments.id, a.id));
    res.json({ ok: true });
  }),
);

// ---------- Questions & answer key ----------

assignmentsRouter.post(
  '/:id/questions/extract',
  upload.single('file'),
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    if (!req.file) throw new HttpError(400, 'Upload a PDF, image or DOCX file with the questions.');
    const { buffer, mimetype, originalname } = req.file;
    let pages: Buffer[] = [];
    let text = '';
    if (mimetype !== 'application/pdf') {
      try {
        const prepared = await prepareFile(buffer, mimetype, originalname);
        pages = prepared.pages;
        text = prepared.text;
      } catch {
        throw new HttpError(400, 'This file could not be read. Upload a PDF, JPG, PNG or DOCX.');
      }
      if (!pages.length && !text) throw new HttpError(400, 'Unsupported file. Upload a PDF, JPG, PNG or DOCX.');
    }
    const { questions, usage } = await extractQuestions({ data: buffer, mimeType: mimetype, pages, text });
    await addUsage(a.id, usage);
    if (!questions.length) throw new HttpError(422, 'No questions were found in this file. Try typing them manually.', 'NO_QUESTIONS_FOUND');
    res.json({ questions });
  }),
);

const questionInput = z.object({
  id: z.string().optional(),
  text: z.string().trim().min(3, 'Question text is required').max(5000),
  marks: z.number().positive('Marks must be more than 0').max(1000),
});

assignmentsRouter.put(
  '/:id/questions',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    if (!EDITABLE_STATES.has(a.status)) {
      throw new HttpError(409, 'Questions cannot be changed after evaluation has started.', 'LOCKED');
    }
    const { questions } = z.object({ questions: z.array(questionInput).min(1, 'Add at least one question').max(50) }).parse(req.body);
    const existing = await db.query.questions.findMany({ where: eq(schema.questions.assignmentId, a.id) });
    const byId = new Map(existing.map((q) => [q.id, q]));
    await db.transaction(async (tx) => {
      const keep = new Set<string>();
      for (const [i, q] of questions.entries()) {
        const marks = roundHalf(q.marks);
        const prev = q.id ? byId.get(q.id) : undefined;
        if (prev) {
          keep.add(prev.id);
          const changed = prev.text !== q.text || prev.marks !== marks;
          await tx
            .update(schema.questions)
            .set({
              order: i,
              text: q.text,
              marks,
              ...(changed
                ? { approved: false, rubric: prev.rubric.length ? normalizeRubric(prev.rubric, marks) : [] }
                : {}),
            })
            .where(eq(schema.questions.id, prev.id));
        } else {
          await tx.insert(schema.questions).values({ assignmentId: a.id, order: i, text: q.text, marks });
        }
      }
      const drop = existing.filter((q) => !keep.has(q.id)).map((q) => q.id);
      if (drop.length) await tx.delete(schema.questions).where(inArray(schema.questions.id, drop));
    });
    await syncKeyStatus(a.id);
    res.json(await serialize((await ownAssignment(t.id, a.id))));
  }),
);

assignmentsRouter.post(
  '/:id/answer-key',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    if (!EDITABLE_STATES.has(a.status)) throw new HttpError(409, 'The answer key is locked after evaluation has started.', 'LOCKED');
    const { questionIds, regenerate } = z
      .object({ questionIds: z.array(z.string()).optional(), regenerate: z.boolean().default(false) })
      .parse(req.body ?? {});
    const cls = await ownClass(t.id, a.classId);
    const all = await db.query.questions.findMany({ where: eq(schema.questions.assignmentId, a.id), orderBy: asc(schema.questions.order) });
    if (!all.length) throw new HttpError(400, 'Add questions first.');
    const targets = all.filter((q) => (questionIds ? questionIds.includes(q.id) : regenerate || !q.modelAnswer));
    if (targets.length) {
      const { questions, usage } = await generateAnswerKey(
        { course: `${cls.course} ${cls.semester}`, subject: cls.subjectName, title: a.title },
        targets.map((q) => ({ number: all.indexOf(q) + 1, text: q.text, marks: q.marks })),
      );
      await addUsage(a.id, usage);
      for (const out of questions) {
        const q = all[out.number - 1];
        await db
          .update(schema.questions)
          .set({ modelAnswer: out.modelAnswer, rubric: out.rubric, approved: false, aiGenerated: true })
          .where(eq(schema.questions.id, q.id));
      }
    }
    await syncKeyStatus(a.id);
    res.json(await serialize(await ownAssignment(t.id, a.id)));
  }),
);

assignmentsRouter.post(
  '/:id/answer-key/approve',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.assignmentId, a.id) });
    const incomplete = qs.filter((q) => !q.rubric.length);
    if (incomplete.length) throw new HttpError(400, 'Every question needs a marking scheme before it can be approved.');
    await db.update(schema.questions).set({ approved: true }).where(eq(schema.questions.assignmentId, a.id));
    await syncKeyStatus(a.id);
    res.json(await serialize(await ownAssignment(t.id, a.id)));
  }),
);

export const questionsRouter = Router();

questionsRouter.put(
  '/:id',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { question, assignment } = await ownQuestion(t.id, req.params.id);
    if (!EDITABLE_STATES.has(assignment.status)) throw new HttpError(409, 'The answer key is locked after evaluation has started.', 'LOCKED');
    const body = z
      .object({
        text: z.string().trim().min(3).max(5000).optional(),
        marks: z.number().positive().max(1000).optional(),
        modelAnswer: z.string().trim().max(10_000).optional().nullable(),
        rubric: z
          .array(z.object({ point: z.string().trim().min(1, 'Marking point cannot be empty').max(300), marks: z.number().min(0).max(1000) }))
          .max(15)
          .optional(),
        approved: z.boolean().optional(),
      })
      .parse(req.body);
    const marks = body.marks !== undefined ? roundHalf(body.marks) : question.marks;
    const rubric = body.rubric ?? question.rubric;
    const sum = roundHalf(rubric.reduce((s, r) => s + r.marks, 0));
    if (body.approved && !rubric.length) throw new HttpError(400, 'Add at least one marking point before approving.');
    if (rubric.length && Math.abs(sum - marks) > 0.001 && (body.rubric || body.approved)) {
      throw new HttpError(400, `Marking scheme adds up to ${sum}, but the question carries ${marks} marks.`, 'RUBRIC_SUM');
    }
    const [q] = await db
      .update(schema.questions)
      .set({
        ...(body.text ? { text: body.text } : {}),
        marks,
        ...(body.modelAnswer !== undefined ? { modelAnswer: body.modelAnswer } : {}),
        rubric,
        ...(body.approved !== undefined ? { approved: body.approved } : {}),
      })
      .where(eq(schema.questions.id, question.id))
      .returning();
    await syncKeyStatus(assignment.id);
    res.json(q);
  }),
);

// ---------- Submissions source ----------

/** Step 3 preview: how many submissions are in the source and who is missing (nothing is saved). */
assignmentsRouter.post(
  '/:id/source/preview',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    const body = z.object({ type: sourceType, url: z.string().trim().min(10, 'Paste a link') }).parse(req.body);
    const roster = await db.query.students.findMany({ where: eq(schema.students.classId, a.classId), orderBy: asc(schema.students.rollNo) });
    const { groups, skippedFiles } = await scanSource(clientForTeacher(t), body.type, body.url, roster);
    const matched = new Set(groups.map((g) => g.studentId).filter(Boolean));
    const missing = roster.filter((s) => !matched.has(s.id));
    res.json({
      found: groups.length,
      matched: matched.size,
      unmatched: groups.filter((g) => !g.studentId).map((g) => g.label).slice(0, 50),
      missing: missing.map((s) => ({ name: s.name, rollNo: s.rollNo })),
      skippedFiles,
      rosterSize: roster.length,
    });
  }),
);

// ---------- Evaluation ----------

assignmentsRouter.post(
  '/:id/evaluate',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    if (a.status === 'EVALUATING' && !a.paused) throw new HttpError(409, 'Evaluation is already running.', 'BUSY');
    const result = await startEvaluation(t, a);
    res.json({ ...result, assignment: await serialize(await ownAssignment(t.id, a.id)) });
  }),
);

assignmentsRouter.post(
  '/:id/pause',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    if (a.status !== 'EVALUATING') throw new HttpError(409, 'Evaluation is not running.');
    await db.update(schema.assignments).set({ paused: true }).where(eq(schema.assignments.id, a.id));
    res.json({ ok: true });
  }),
);

assignmentsRouter.post(
  '/:id/resume',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    if (a.status !== 'EVALUATING') throw new HttpError(409, 'Evaluation is not paused.');
    await db.update(schema.assignments).set({ paused: false, lastError: null }).where(eq(schema.assignments.id, a.id));
    kick(a.id);
    res.json({ ok: true });
  }),
);

/** Picks up late or re-uploaded submissions after evaluation. */
assignmentsRouter.post(
  '/:id/rescan',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    if (EDITABLE_STATES.has(a.status)) throw new HttpError(409, 'Start the evaluation first.');
    const result = await syncSubmissions(t, a);
    if (result.queued > 0) {
      await db
        .update(schema.assignments)
        .set({ status: 'EVALUATING', paused: false, lastError: null, evaluationFinishedAt: null })
        .where(eq(schema.assignments.id, a.id));
      kick(a.id);
    }
    res.json(result);
  }),
);

assignmentsRouter.get(
  '/:id/progress',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    const subs = await db.query.submissions.findMany({
      where: eq(schema.submissions.assignmentId, a.id),
      orderBy: desc(schema.submissions.updatedAt),
    });
    const students = await db.query.students.findMany({ where: eq(schema.students.classId, a.classId) });
    const stById = new Map(students.map((s) => [s.id, s]));
    const done = subs.filter((s) => s.status === 'GRADED' || s.status === 'FAILED');
    const total = subs.length;
    // Estimate from the observed throughput of this run.
    const started = a.evaluationStartedAt?.getTime() ?? Date.now();
    const recentDone = done.filter((s) => s.gradedAt && s.gradedAt.getTime() >= started);
    const elapsed = (Date.now() - started) / 1000;
    const rate = recentDone.length && elapsed > 5 ? recentDone.length / elapsed : env.EVAL_CONCURRENCY / 20;
    const remaining = total - done.length;
    const flags = await db.query.fraudFlags.findMany({ where: and(eq(schema.fraudFlags.assignmentId, a.id), eq(schema.fraudFlags.status, 'OPEN')) });
    res.json({
      status: a.status,
      paused: a.paused,
      lastError: a.lastError,
      running: isRunning(a.id),
      total,
      done: done.length,
      graded: subs.filter((s) => s.status === 'GRADED').length,
      failed: subs.filter((s) => s.status === 'FAILED').length,
      queued: subs.filter((s) => s.status === 'QUEUED').length,
      processing: subs.filter((s) => s.status === 'PROCESSING').length,
      etaSeconds: remaining > 0 ? Math.round(remaining / Math.max(rate, 0.01)) : 0,
      costUsd: a.costUsd,
      costInr: a.costUsd * env.USD_TO_INR,
      items: subs.slice(0, 80).map((s) => {
        const st = s.studentId ? stById.get(s.studentId) : null;
        const flag = flags.find((f) => f.submissionAId === s.id || f.submissionBId === s.id);
        return {
          id: s.id,
          name: st?.name ?? s.detectedName ?? s.label,
          rollNo: st?.rollNo ?? s.detectedRoll ?? null,
          status: s.status,
          reviewStatus: s.reviewStatus,
          total: s.totalMarks,
          confidence: s.confidence,
          error: s.error,
          flag: flag ? { id: flag.id, type: flag.type, score: Math.max(flag.imageSimilarity ?? 0, flag.textSimilarity ?? 0) } : null,
        };
      }),
    });
  }),
);

assignmentsRouter.get(
  '/:id/results',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    const b = await loadAssignmentBundle(a.id);
    const rows = buildResultRows(b);
    res.json({
      assignment: { id: a.id, title: a.title, status: a.status, dueDate: a.dueDate, paused: a.paused, costInr: a.costUsd * env.USD_TO_INR, fraudDetection: a.fraudDetection },
      class: { id: b.cls.id, label: classLabel(b.cls), subjectName: b.cls.subjectName },
      totalMarks: totalMarksOf(b.questions),
      questions: b.questions.map((q, i) => ({ id: q.id, number: i + 1, marks: q.marks })),
      counts: reviewCounts(rows),
      rows,
      flags: b.flags.filter((f) => f.status === 'OPEN').map((f) => ({ id: f.id, a: f.submissionAId, b: f.submissionBId, type: f.type })),
    });
  }),
);

assignmentsRouter.post(
  '/:id/approve-all',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    const updated = await db
      .update(schema.submissions)
      .set({ reviewStatus: 'APPROVED', approvedAt: new Date() })
      .where(and(eq(schema.submissions.assignmentId, a.id), eq(schema.submissions.status, 'GRADED'), eq(schema.submissions.reviewStatus, 'PENDING')))
      .returning({ id: schema.submissions.id });
    await refreshCompletion(a.id);
    res.json({ approved: updated.length });
  }),
);

assignmentsRouter.post(
  '/:id/fraud-check',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    const created = await runFraudChecks(a.id);
    res.json({ created });
  }),
);

assignmentsRouter.get(
  '/:id/report',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    const b = await loadAssignmentBundle(a.id);
    res.json({
      assignment: { id: a.id, title: a.title, status: a.status },
      class: { id: b.cls.id, label: classLabel(b.cls) },
      ...buildReport(b),
    });
  }),
);

// ---------- Exports ----------

const exportOpts = (q: Record<string, unknown>): ExportOptions => ({
  includeFeedback: q.feedback === '1' || q.feedback === true,
  includeFraud: q.fraud === '1' || q.fraud === true,
  includeTimestamps: q.timestamps === '1' || q.timestamps === true,
});

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 60) || 'results';

assignmentsRouter.get(
  '/:id/export',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const a = await ownAssignment(t.id, req.params.id);
    const b = await loadAssignmentBundle(a.id);
    const opts = exportOpts(req.query as Record<string, unknown>);
    const base = `${safeName(a.title)}_${safeName(`${b.cls.course}_${b.cls.semester}_${b.cls.section}`)}`;
    if (req.query.format === 'pdf') {
      const pdf = await toPdf(b, opts);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
      return res.send(pdf);
    }
    const xlsx = await toXlsx(b, opts);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    return res.send(xlsx);
  }),
);

assignmentsRouter.post(
  '/:id/export/google-sheet',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher as Teacher;
    const a = await ownAssignment(t.id, req.params.id);
    const b = await loadAssignmentBundle(a.id);
    const opts = exportOpts(req.body ?? {});
    const url = await createSpreadsheet(clientForTeacher(t), `${a.title} – ${classLabel(b.cls)} – Results`, googleSheetTabs(b, opts));
    res.json({ url });
  }),
);
