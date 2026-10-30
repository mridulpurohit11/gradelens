import { Router } from 'express';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { ah } from '../lib/http.js';
import type { AuthedRequest } from '../auth/middleware.js';
import { classLabel } from './guards.js';

export const dashboardRouter = Router();

/** Per-assignment submission counts used by dashboard and lists. */
export async function assignmentCounts(ids: string[]) {
  if (!ids.length) return new Map<string, Record<string, number>>();
  const rows = await db
    .select({
      assignmentId: schema.submissions.assignmentId,
      status: schema.submissions.status,
      review: schema.submissions.reviewStatus,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.submissions)
    .where(inArray(schema.submissions.assignmentId, ids))
    .groupBy(schema.submissions.assignmentId, schema.submissions.status, schema.submissions.reviewStatus);
  const flags = await db
    .select({ assignmentId: schema.fraudFlags.assignmentId, n: sql<number>`count(*)::int` })
    .from(schema.fraudFlags)
    .where(and(inArray(schema.fraudFlags.assignmentId, ids), eq(schema.fraudFlags.status, 'OPEN')))
    .groupBy(schema.fraudFlags.assignmentId);
  const avg = await db
    .select({ assignmentId: schema.submissions.assignmentId, avg: sql<number>`avg(${schema.submissions.totalMarks})::float` })
    .from(schema.submissions)
    .where(and(inArray(schema.submissions.assignmentId, ids), eq(schema.submissions.status, 'GRADED')))
    .groupBy(schema.submissions.assignmentId);
  const out = new Map<string, Record<string, number>>();
  for (const id of ids) out.set(id, { submissions: 0, graded: 0, queued: 0, failed: 0, approved: 0, needsReview: 0, suspicious: 0, pending: 0, openFlags: 0, average: NaN });
  for (const r of rows) {
    const c = out.get(r.assignmentId)!;
    c.submissions += r.n;
    if (r.status === 'GRADED') c.graded += r.n;
    if (r.status === 'QUEUED' || r.status === 'PROCESSING') c.queued += r.n;
    if (r.status === 'FAILED') c.failed += r.n;
    if (r.review === 'APPROVED') c.approved += r.n;
    if (r.review === 'NEEDS_REVIEW') c.needsReview += r.n;
    if (r.review === 'SUSPICIOUS') c.suspicious += r.n;
    if (r.review === 'PENDING' && r.status === 'GRADED') c.pending += r.n;
  }
  for (const f of flags) out.get(f.assignmentId)!.openFlags = f.n;
  for (const a of avg) out.get(a.assignmentId)!.average = a.avg;
  return out;
}

export async function rosterSizes(classIds: string[]) {
  if (!classIds.length) return new Map<string, number>();
  const rows = await db
    .select({ classId: schema.students.classId, n: sql<number>`count(*)::int` })
    .from(schema.students)
    .where(inArray(schema.students.classId, classIds))
    .groupBy(schema.students.classId);
  return new Map(rows.map((r) => [r.classId, r.n]));
}

dashboardRouter.get(
  '/dashboard',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const classes = await db.query.classes.findMany({ where: eq(schema.classes.teacherId, t.id) });
    const classById = new Map(classes.map((c) => [c.id, c]));
    const assignments = await db.query.assignments.findMany({
      where: eq(schema.assignments.teacherId, t.id),
      orderBy: desc(schema.assignments.updatedAt),
    });
    const ids = assignments.map((a) => a.id);
    const counts = await assignmentCounts(ids);
    const sizes = await rosterSizes(classes.map((c) => c.id));
    const flagTypes = ids.length
      ? await db
          .select({ type: schema.fraudFlags.type, n: sql<number>`count(*)::int` })
          .from(schema.fraudFlags)
          .where(and(inArray(schema.fraudFlags.assignmentId, ids), eq(schema.fraudFlags.status, 'OPEN')))
          .groupBy(schema.fraudFlags.type)
      : [];
    const all = [...counts.values()];
    const evaluatedClasses = new Set(assignments.filter((a) => (counts.get(a.id)?.graded ?? 0) > 0).map((a) => a.classId));
    res.json({
      stats: {
        assignmentsChecked: assignments.filter((a) => a.evaluationFinishedAt).length,
        activeAssignments: assignments.filter((a) => ['EVALUATING', 'REVIEW'].includes(a.status)).length,
        studentsEvaluated: all.reduce((s, c) => s + c.graded, 0),
        classesEvaluated: evaluatedClasses.size,
        pendingReviews: all.reduce((s, c) => s + c.needsReview + c.failed, 0),
        fraudFlags: flagTypes.reduce((s, f) => s + f.n, 0),
        duplicateFlags: flagTypes.filter((f) => f.type !== 'HANDWRITING_MISMATCH').reduce((s, f) => s + f.n, 0),
        handwritingFlags: flagTypes.find((f) => f.type === 'HANDWRITING_MISMATCH')?.n ?? 0,
        classes: classes.filter((c) => !c.archived).length,
      },
      recent: assignments.slice(0, 6).map((a) => {
        const c = classById.get(a.classId);
        const k = counts.get(a.id)!;
        return {
          id: a.id,
          title: a.title,
          status: a.status,
          paused: a.paused,
          dueDate: a.dueDate,
          finishedAt: a.evaluationFinishedAt,
          classLabel: c ? classLabel(c) : '',
          subjectName: c?.subjectName ?? '',
          rosterSize: sizes.get(a.classId) ?? 0,
          ...k,
          average: Number.isNaN(k.average) ? null : k.average,
        };
      }),
      totalAssignments: assignments.length,
    });
  }),
);

dashboardRouter.get(
  '/notifications',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const items = await db.query.notifications.findMany({
      where: eq(schema.notifications.teacherId, t.id),
      orderBy: desc(schema.notifications.createdAt),
      limit: 30,
    });
    res.json({ items, unread: items.filter((n) => !n.read).length });
  }),
);

dashboardRouter.post(
  '/notifications/read',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    await db.update(schema.notifications).set({ read: true }).where(eq(schema.notifications.teacherId, t.id));
    res.json({ ok: true });
  }),
);

dashboardRouter.get(
  '/search',
  ah(async (req, res) => {
    const t = (req as AuthedRequest).teacher;
    const q = String(req.query.q ?? '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ classes: [], assignments: [], students: [] });
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const classes = await db.query.classes.findMany({
      where: and(
        eq(schema.classes.teacherId, t.id),
        or(
          ilike(schema.classes.subjectName, like),
          ilike(schema.classes.course, like),
          ilike(schema.classes.subjectCode, like),
          ilike(schema.classes.section, like),
        ),
      ),
      limit: 5,
    });
    const assignments = await db.query.assignments.findMany({
      where: and(eq(schema.assignments.teacherId, t.id), ilike(schema.assignments.title, like)),
      limit: 5,
    });
    const myClasses = await db.query.classes.findMany({ where: eq(schema.classes.teacherId, t.id), columns: { id: true, course: true, semester: true, section: true } });
    const classById = new Map(myClasses.map((c) => [c.id, c]));
    const students = myClasses.length
      ? await db.query.students.findMany({
          where: and(
            inArray(schema.students.classId, myClasses.map((c) => c.id)),
            or(ilike(schema.students.name, like), ilike(schema.students.rollNo, like)),
          ),
          limit: 8,
        })
      : [];
    res.json({
      classes: classes.map((c) => ({ id: c.id, label: classLabel(c), subjectName: c.subjectName })),
      assignments: assignments.map((a) => ({ id: a.id, title: a.title, status: a.status, classLabel: classById.get(a.classId) ? classLabel(classById.get(a.classId)!) : '' })),
      students: students.map((s) => ({ id: s.id, name: s.name, rollNo: s.rollNo, classId: s.classId, classLabel: classById.get(s.classId) ? classLabel(classById.get(s.classId)!) : '' })),
    });
  }),
);
