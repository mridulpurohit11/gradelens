import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { Teacher } from '../db/schema.js';
import { verifySession } from '../lib/jwt.js';

export type AuthedRequest = Request & { teacher: Teacher };

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please sign in', code: 'UNAUTHENTICATED' });
  try {
    const claims = verifySession(token);
    const teacher = await db.query.teachers.findFirst({ where: eq(schema.teachers.id, claims.sub) });
    if (!teacher) return res.status(401).json({ error: 'Account not found', code: 'UNAUTHENTICATED' });
    (req as AuthedRequest).teacher = teacher;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.', code: 'UNAUTHENTICATED' });
  }
}
