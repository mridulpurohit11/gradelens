import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { ah, HttpError } from '../lib/http.js';
import type { AuthedRequest } from '../auth/middleware.js';
import type { Teacher } from '../db/schema.js';
import { revokeTeacherToken } from '../services/google.js';
import { classLabel } from './guards.js';

export const meRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

export function publicTeacher(t: Teacher) {
  return {
    id: t.id,
    email: t.email,
    name: t.name,
    hasPhoto: Boolean(t.photo),
    photoVersion: t.updatedAt.getTime(),
    googlePicture: t.googlePicture,
    designation: t.designation,
    phone: t.phone,
    university: t.university,
    campus: t.campus,
    department: t.department,
    employeeId: t.employeeId,
    subjects: t.subjects,
    profileComplete: t.profileComplete,
    preferences: {
      strictness: t.strictness,
      fraudDetection: t.fraudDetection,
      handwritingCheck: t.handwritingCheck,
      smartEscalation: t.smartEscalation,
      theme: t.theme,
      notifyEvalComplete: t.notifyEvalComplete,
      notifyFraud: t.notifyFraud,
    },
    driveAccess: Boolean(t.googleRefreshTokenEnc) && (t.googleScopes ?? '').includes('drive'),
    createdAt: t.createdAt,
  };
}

meRouter.get(
  '/',
  ah(async (req, res) => {
    res.json(publicTeacher((req as AuthedRequest).teacher));
  }),
);

const trimmed = (max: number) => z.string().trim().max(max);
const profileSchema = z.object({
  name: trimmed(120).min(2, 'Full name is required').optional(),
  designation: trimmed(80).optional().nullable(),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9+\-\s()]*$/, 'Phone number can contain digits only')
    .optional()
    .nullable(),
  university: trimmed(160).optional().nullable(),
  campus: trimmed(80).optional().nullable(),
  department: trimmed(160).optional().nullable(),
  employeeId: trimmed(60).optional().nullable(),
  subjects: z.array(trimmed(120).min(1)).max(30).optional(),
  profileComplete: z.boolean().optional(),
});

meRouter.put(
  '/',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const body = profileSchema.parse(req.body);
    if (body.profileComplete) {
      const merged = { ...t, ...body };
      const missing = [
        !merged.name && 'Full name',
        !merged.designation && 'Designation',
        !merged.university && 'University',
        !merged.department && 'Department',
      ].filter(Boolean);
      if (missing.length) throw new HttpError(400, `Please fill: ${missing.join(', ')}`, 'PROFILE_INCOMPLETE');
    }
    const [updated] = await db.update(schema.teachers).set(body).where(eq(schema.teachers.id, t.id)).returning();
    res.json(publicTeacher(updated));
  }),
);

const prefsSchema = z.object({
  strictness: z.enum(['LENIENT', 'STANDARD', 'STRICT']).optional(),
  fraudDetection: z.boolean().optional(),
  handwritingCheck: z.boolean().optional(),
  smartEscalation: z.boolean().optional(),
  theme: z.enum(['LIGHT', 'DARK', 'SYSTEM']).optional(),
  notifyEvalComplete: z.boolean().optional(),
  notifyFraud: z.boolean().optional(),
});

meRouter.put(
  '/preferences',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const body = prefsSchema.parse(req.body);
    const [updated] = await db.update(schema.teachers).set(body).where(eq(schema.teachers.id, t.id)).returning();
    res.json(publicTeacher(updated));
  }),
);

meRouter.post(
  '/photo',
  upload.single('photo'),
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    if (!req.file) throw new HttpError(400, 'Choose a photo to upload');
    let photo: Buffer;
    try {
      photo = await sharp(req.file.buffer).rotate().resize(320, 320, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
    } catch {
      throw new HttpError(400, 'This image could not be read. Please upload a JPG or PNG.');
    }
    const [updated] = await db
      .update(schema.teachers)
      .set({ photo, photoMime: 'image/jpeg' })
      .where(eq(schema.teachers.id, t.id))
      .returning();
    res.json(publicTeacher(updated));
  }),
);

meRouter.delete(
  '/photo',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const [updated] = await db.update(schema.teachers).set({ photo: null, photoMime: null }).where(eq(schema.teachers.id, t.id)).returning();
    res.json(publicTeacher(updated));
  }),
);

meRouter.get(
  '/photo',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    if (!t.photo) throw new HttpError(404, 'No photo');
    res.setHeader('Content-Type', t.photoMime ?? 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(t.photo);
  }),
);

/** Profile statistics and evaluation history. */
meRouter.get(
  '/stats',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const assignments = await db.query.assignments.findMany({
      where: eq(schema.assignments.teacherId, t.id),
      orderBy: desc(schema.assignments.updatedAt),
    });
    const ids = assignments.map((a) => a.id);
    const classes = await db.query.classes.findMany({ where: eq(schema.classes.teacherId, t.id) });
    const classById = new Map(classes.map((c) => [c.id, c]));
    const graded = ids.length
      ? await db
          .select({ assignmentId: schema.submissions.assignmentId, n: sql<number>`count(*)::int` })
          .from(schema.submissions)
          .where(and(inArray(schema.submissions.assignmentId, ids), eq(schema.submissions.status, 'GRADED')))
          .groupBy(schema.submissions.assignmentId)
      : [];
    const gradedBy = new Map(graded.map((g) => [g.assignmentId, g.n]));
    const flags = ids.length
      ? await db
          .select({ status: schema.fraudFlags.status, n: sql<number>`count(*)::int` })
          .from(schema.fraudFlags)
          .where(inArray(schema.fraudFlags.assignmentId, ids))
          .groupBy(schema.fraudFlags.status)
      : [];
    const evaluated = assignments.filter((a) => a.evaluationFinishedAt);
    res.json({
      assignmentsChecked: evaluated.length,
      studentsEvaluated: [...gradedBy.values()].reduce((s, n) => s + n, 0),
      classesRegistered: classes.filter((c) => !c.archived).length,
      fraudFlagged: flags.filter((f) => f.status !== 'DISMISSED').reduce((s, f) => s + f.n, 0),
      fraudConfirmed: flags.find((f) => f.status === 'CONFIRMED')?.n ?? 0,
      memberSince: t.createdAt,
      totalCostUsd: assignments.reduce((s, a) => s + a.costUsd, 0),
      history: evaluated
        .sort((a, b) => (b.evaluationFinishedAt!.getTime() - a.evaluationFinishedAt!.getTime()))
        .slice(0, 20)
        .map((a) => {
          const c = classById.get(a.classId);
          return {
            id: a.id,
            title: a.title,
            date: a.evaluationFinishedAt,
            classLabel: c ? classLabel(c) : '',
            course: c?.course,
            semester: c?.semester,
            section: c?.section,
            evaluated: gradedBy.get(a.id) ?? 0,
            status: a.status,
          };
        }),
    });
  }),
);

/** Personal data export (JSON) — everything GradeLens stores about the teacher. */
meRouter.get(
  '/export',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const classes = await db.query.classes.findMany({ where: eq(schema.classes.teacherId, t.id) });
    const classIds = classes.map((c) => c.id);
    const students = classIds.length ? await db.query.students.findMany({ where: inArray(schema.students.classId, classIds) }) : [];
    const assignments = await db.query.assignments.findMany({ where: eq(schema.assignments.teacherId, t.id) });
    const aIds = assignments.map((a) => a.id);
    const questions = aIds.length ? await db.query.questions.findMany({ where: inArray(schema.questions.assignmentId, aIds) }) : [];
    const submissions = aIds.length
      ? await db.query.submissions.findMany({
          where: and(inArray(schema.submissions.assignmentId, aIds), isNotNull(schema.submissions.gradedAt)),
          columns: { pageHashes: false, transcript: false },
        })
      : [];
    res.setHeader('Content-Disposition', `attachment; filename="gradelens-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ profile: publicTeacher(t), classes, students, assignments, questions, submissions });
  }),
);

/** Permanently deletes the account and every class, assignment and result (cascade). */
meRouter.delete(
  '/',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const { confirm } = z.object({ confirm: z.literal('DELETE') }).parse(req.body ?? {});
    void confirm;
    await revokeTeacherToken(t);
    await db.delete(schema.teachers).where(eq(schema.teachers.id, t.id));
    res.json({ ok: true });
  }),
);
