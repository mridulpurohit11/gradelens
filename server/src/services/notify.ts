import { db, schema } from '../db/index.js';
import type { Teacher } from '../db/schema.js';

type Kind = 'EVALUATION_COMPLETE' | 'FRAUD' | 'ACTION_REQUIRED' | 'INFO';

/** Creates an in-app notification, honouring the teacher's notification preferences. */
export async function notify(
  teacher: Pick<Teacher, 'id' | 'notifyEvalComplete' | 'notifyFraud'>,
  kind: Kind,
  title: string,
  body: string,
  link?: string,
) {
  if (kind === 'EVALUATION_COMPLETE' && !teacher.notifyEvalComplete) return;
  if (kind === 'FRAUD' && !teacher.notifyFraud) return;
  await db.insert(schema.notifications).values({ teacherId: teacher.id, type: kind, title, body, link });
}
