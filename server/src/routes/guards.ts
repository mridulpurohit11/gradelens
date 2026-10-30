import { and, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { HttpError } from '../lib/http.js';

export async function ownClass(teacherId: string, classId: string) {
  const c = await db.query.classes.findFirst({
    where: and(eq(schema.classes.id, classId), eq(schema.classes.teacherId, teacherId)),
  });
  if (!c) throw new HttpError(404, 'Class not found', 'NOT_FOUND');
  return c;
}

export async function ownAssignment(teacherId: string, id: string) {
  const a = await db.query.assignments.findFirst({
    where: and(eq(schema.assignments.id, id), eq(schema.assignments.teacherId, teacherId)),
  });
  if (!a) throw new HttpError(404, 'Assignment not found', 'NOT_FOUND');
  return a;
}

export async function ownSubmission(teacherId: string, id: string) {
  const s = await db.query.submissions.findFirst({ where: eq(schema.submissions.id, id) });
  if (!s) throw new HttpError(404, 'Submission not found', 'NOT_FOUND');
  const a = await ownAssignment(teacherId, s.assignmentId);
  return { submission: s, assignment: a };
}

export async function ownQuestion(teacherId: string, id: string) {
  const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, id) });
  if (!q) throw new HttpError(404, 'Question not found', 'NOT_FOUND');
  const a = await ownAssignment(teacherId, q.assignmentId);
  return { question: q, assignment: a };
}

export async function ownFlag(teacherId: string, id: string) {
  const f = await db.query.fraudFlags.findFirst({ where: eq(schema.fraudFlags.id, id) });
  if (!f) throw new HttpError(404, 'Flag not found', 'NOT_FOUND');
  const a = await ownAssignment(teacherId, f.assignmentId);
  return { flag: f, assignment: a };
}

export const classLabel = (c: { course: string; semester: string; section: string }) =>
  `${c.course} · ${c.semester} · Section ${c.section}`;
