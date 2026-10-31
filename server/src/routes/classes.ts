import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { ah, HttpError } from '../lib/http.js';
import type { AuthedRequest } from '../auth/middleware.js';
import { clientForTeacher } from '../services/google.js';
import { parseSpreadsheetFile, rowsToRoster } from '../services/roster.js';
import { parseSource, rosterFromSheet, verifySource, type SourceType } from '../services/sources.js';
import { assignmentCounts, rosterSizes } from './dashboard.js';
import { classLabel, ownClass } from './guards.js';

export const classesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const studentSchema = z.object({
  name: z.string().trim().min(1, 'Student name is required').max(120),
  rollNo: z.string().trim().min(1, 'Student ID is required').max(60),
  email: z.string().trim().email().max(160).optional().nullable().or(z.literal('')),
});

const sourceType = z.enum(['DRIVE_FOLDER', 'GOOGLE_SHEET']);

const classSchema = z.object({
  course: z.string().trim().min(1, 'Course is required').max(40),
  semester: z.string().trim().min(1, 'Semester is required').max(40),
  section: z.string().trim().min(1, 'Section is required').max(20),
  subjectName: z.string().trim().min(2, 'Subject name is required').max(160),
  subjectCode: z.string().trim().max(40).optional().nullable(),
  sourceType: sourceType,
  sourceUrl: z.string().trim().min(10, 'Google Drive folder or Sheet link is required').max(500),
  rosterSheetUrl: z.string().trim().max(500).optional().nullable(),
  students: z.array(studentSchema).max(2000).optional(),
});

async function serializeClasses(classes: (typeof schema.classes.$inferSelect)[]) {
  const ids = classes.map((c) => c.id);
  const sizes = await rosterSizes(ids);
  const assignments = ids.length
    ? await db.query.assignments.findMany({ where: inArray(schema.assignments.classId, ids), orderBy: desc(schema.assignments.createdAt) })
    : [];
  const counts = await assignmentCounts(assignments.map((a) => a.id));
  return classes.map((c) => {
    const own = assignments.filter((a) => a.classId === c.id);
    const last = own[0];
    return {
      ...c,
      label: classLabel(c),
      studentCount: sizes.get(c.id) ?? 0,
      assignmentCount: own.length,
      lastAssignment: last
        ? { id: last.id, title: last.title, status: last.status, dueDate: last.dueDate, createdAt: last.createdAt, finishedAt: last.evaluationFinishedAt, needsReview: (counts.get(last.id)?.needsReview ?? 0) + (counts.get(last.id)?.suspicious ?? 0) }
        : null,
    };
  });
}

function normalizeSource(body: { sourceType?: SourceType | null; sourceUrl?: string | null }) {
  if (!body.sourceType || !body.sourceUrl) return { sourceType: null, sourceUrl: null, sourceId: null };
  return { sourceType: body.sourceType, sourceUrl: body.sourceUrl, sourceId: parseSource(body.sourceType, body.sourceUrl) };
}

classesRouter.get(
  '/',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const classes = await db.query.classes.findMany({
      where: and(eq(schema.classes.teacherId, t.id), eq(schema.classes.archived, req.query.archived === '1')),
      orderBy: [asc(schema.classes.course), asc(schema.classes.semester), asc(schema.classes.section)],
    });
    res.json(await serializeClasses(classes));
  }),
);

classesRouter.post(
  '/',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const body = classSchema.parse(req.body);
    const src = normalizeSource(body);
    const created = await db.transaction(async (tx) => {
      const [c] = await tx
        .insert(schema.classes)
        .values({
          teacherId: t.id,
          course: body.course,
          semester: body.semester,
          section: body.section.toUpperCase(),
          subjectName: body.subjectName,
          subjectCode: body.subjectCode || null,
          rosterSheetUrl: body.rosterSheetUrl || null,
          ...src,
        })
        .returning();
      if (body.students?.length) {
        const seen = new Set<string>();
        const rows = body.students.filter((s) => {
          const k = s.rollNo.toUpperCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        await tx.insert(schema.students).values(rows.map((s) => ({ classId: c.id, name: s.name, rollNo: s.rollNo, email: s.email || null })));
      }
      return c;
    });
    const [out] = await serializeClasses([created]);
    res.status(201).json(out);
  }),
);

classesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const c = await ownClass(t.id, req.params.id);
    const [out] = await serializeClasses([c]);
    res.json(out);
  }),
);

classesRouter.put(
  '/:id',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const c = await ownClass(t.id, req.params.id);
    const body = classSchema.partial().extend({ archived: z.boolean().optional() }).parse(req.body);
    const { students: _ignored, ...rest } = body;
    void _ignored;
    const patch: Record<string, unknown> = { ...rest };
    if ('sourceType' in body || 'sourceUrl' in body) Object.assign(patch, normalizeSource({ sourceType: body.sourceType ?? c.sourceType as SourceType, sourceUrl: body.sourceUrl }));
    if (body.section) patch.section = body.section.toUpperCase();
    const [updated] = await db.update(schema.classes).set(patch).where(eq(schema.classes.id, c.id)).returning();
    const [out] = await serializeClasses([updated]);
    res.json(out);
  }),
);

classesRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const c = await ownClass(t.id, req.params.id);
    const running = await db.query.assignments.findFirst({
      where: and(eq(schema.assignments.classId, c.id), eq(schema.assignments.status, 'EVALUATING'), eq(schema.assignments.paused, false)),
    });
    if (running) throw new HttpError(409, 'An evaluation is running for this class. Pause it before deleting the class.', 'BUSY');
    await db.delete(schema.classes).where(eq(schema.classes.id, c.id));
    res.json({ ok: true });
  }),
);

// ----- Students -----

classesRouter.get(
  '/:id/students',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const c = await ownClass(t.id, req.params.id);
    const students = await db.query.students.findMany({ where: eq(schema.students.classId, c.id), orderBy: asc(schema.students.rollNo) });
    const ids = students.map((s) => s.id);
    const stats = ids.length
      ? await db
          .select({
            studentId: schema.submissions.studentId,
            n: sql<number>`count(*)::int`,
            avgPct: sql<number>`avg(${schema.submissions.totalMarks} / nullif((select sum(q.marks) from questions q where q.assignment_id = ${schema.submissions.assignmentId}), 0))::float`,
          })
          .from(schema.submissions)
          .where(and(inArray(schema.submissions.studentId, ids), eq(schema.submissions.status, 'GRADED')))
          .groupBy(schema.submissions.studentId)
      : [];
    const byId = new Map(stats.map((s) => [s.studentId, s]));
    res.json(
      students.map((s) => ({
        ...s,
        submitted: byId.get(s.id)?.n ?? 0,
        averagePercent: byId.get(s.id)?.avgPct ?? null,
      })),
    );
  }),
);

classesRouter.post(
  '/:id/students',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const c = await ownClass(t.id, req.params.id);
    const body = z
      .object({ students: z.array(studentSchema).min(1).max(2000), mode: z.enum(['merge', 'replace']).default('merge') })
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      const existing = await tx.query.students.findMany({ where: eq(schema.students.classId, c.id) });
      const byRoll = new Map(existing.map((s) => [s.rollNo.toUpperCase(), s]));
      let added = 0;
      let updated = 0;
      const keep = new Set<string>();
      for (const s of body.students) {
        const prev = byRoll.get(s.rollNo.toUpperCase());
        if (prev) {
          keep.add(prev.id);
          if (prev.name !== s.name || (s.email && prev.email !== s.email)) {
            await tx.update(schema.students).set({ name: s.name, email: s.email || prev.email }).where(eq(schema.students.id, prev.id));
            updated++;
          }
        } else {
          const [row] = await tx.insert(schema.students).values({ classId: c.id, name: s.name, rollNo: s.rollNo, email: s.email || null }).returning();
          byRoll.set(s.rollNo.toUpperCase(), row);
          keep.add(row.id);
          added++;
        }
      }
      let removed = 0;
      if (body.mode === 'replace') {
        const drop = existing.filter((s) => !keep.has(s.id)).map((s) => s.id);
        if (drop.length) {
          await tx.delete(schema.students).where(inArray(schema.students.id, drop));
          removed = drop.length;
        }
      }
      return { added, updated, removed };
    });
    res.json(result);
  }),
);

classesRouter.put(
  '/:id/students/:studentId',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const c = await ownClass(t.id, req.params.id);
    const body = studentSchema.partial().parse(req.body);
    const [s] = await db
      .update(schema.students)
      .set({ ...body, email: body.email === '' ? null : body.email })
      .where(and(eq(schema.students.id, req.params.studentId), eq(schema.students.classId, c.id)))
      .returning();
    if (!s) throw new HttpError(404, 'Student not found');
    res.json(s);
  }),
);

classesRouter.delete(
  '/:id/students/:studentId',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const c = await ownClass(t.id, req.params.id);
    await db.delete(schema.students).where(and(eq(schema.students.id, req.params.studentId), eq(schema.students.classId, c.id)));
    res.json({ ok: true });
  }),
);

// ----- Helpers used by the Add Class form (no class required yet) -----

export const toolsRouter = Router();

/** Parses an uploaded Excel/CSV roster or a Google Sheet link and returns the students for preview. */
toolsRouter.post(
  '/roster/parse',
  upload.single('file'),
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    if (req.file) {
      const rows = await parseSpreadsheetFile(req.file.buffer, req.file.originalname);
      return res.json(rowsToRoster(rows));
    }
    const { sheetUrl } = z.object({ sheetUrl: z.string().trim().min(10, 'Paste a Google Sheet link') }).parse(req.body);
    return res.json(await rosterFromSheet(clientForTeacher(t), sheetUrl));
  }),
);

toolsRouter.post(
  '/sources/verify',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { type, url } = z.object({ type: sourceType, url: z.string().trim().min(10, 'Paste a link') }).parse(req.body);
    res.json(await verifySource(clientForTeacher(t), type, url));
  }),
);

/** Class analytics: average percentage per assignment. */
classesRouter.get(
  '/:id/analytics',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const c = await ownClass(t.id, req.params.id);
    const assignments = await db.query.assignments.findMany({ where: eq(schema.assignments.classId, c.id), orderBy: asc(schema.assignments.createdAt) });
    const ids = assignments.map((a) => a.id);
    const totals = ids.length
      ? await db
          .select({ assignmentId: schema.questions.assignmentId, total: sql<number>`sum(${schema.questions.marks})::float` })
          .from(schema.questions)
          .where(inArray(schema.questions.assignmentId, ids))
          .groupBy(schema.questions.assignmentId)
      : [];
    const totalBy = new Map(totals.map((x) => [x.assignmentId, x.total]));
    const counts = await assignmentCounts(ids);
    const size = (await rosterSizes([c.id])).get(c.id) ?? 0;
    res.json({
      rosterSize: size,
      assignments: assignments.map((a) => {
        const k = counts.get(a.id)!;
        const total = totalBy.get(a.id) ?? 0;
        return {
          id: a.id,
          title: a.title,
          status: a.status,
          totalMarks: total,
          average: Number.isNaN(k.average) ? null : k.average,
          averagePercent: !Number.isNaN(k.average) && total ? k.average / total : null,
          graded: k.graded,
          submissions: k.submissions,
        };
      }),
    });
  }),
);
