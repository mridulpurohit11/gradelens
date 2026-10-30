import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { hamming } from './images.js';
import { containment, jaccard, removeCommon, shingles, normalizeText } from './similarity.js';

export const IMAGE_DUPLICATE_THRESHOLD = 0.85;
export const TEXT_COPY_THRESHOLD = 0.45;
const MIN_TRANSCRIPT_WORDS = 40;
const DHASH_PREFILTER = 12; // bits out of 64

type Page = { hash: string; vec: Float32Array | null };

function decodePage(fp: string): Page {
  const [hash, b64] = fp.split('|');
  if (!b64) return { hash, vec: null };
  const raw = new Int8Array(Buffer.from(b64, 'base64'));
  const vec = new Float32Array(raw.length);
  let mean = 0;
  for (let i = 0; i < raw.length; i++) mean += raw[i];
  mean /= raw.length || 1;
  let norm = 0;
  for (let i = 0; i < raw.length; i++) {
    vec[i] = raw[i] - mean;
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (!norm) return { hash, vec: null };
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return { hash, vec };
}

function dot(a: Float32Array, b: Float32Array) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Highest visual similarity between any page of A and any page of B. */
export function maxPageSimilarity(a: Page[], b: Page[]): number {
  let best = 0;
  for (const pa of a) {
    for (const pb of b) {
      if (hamming(pa.hash, pb.hash) > DHASH_PREFILTER) continue;
      const sim = pa.vec && pb.vec ? Math.max(0, dot(pa.vec, pb.vec)) : 1 - hamming(pa.hash, pb.hash) / 64;
      if (sim > best) best = sim;
    }
  }
  return best;
}

type Candidate = {
  id: string;
  label: string;
  submittedAt: Date | null;
  createdAt: Date;
  pages: Page[];
  shingles: Set<string>;
  reviewStatus: string;
};

export type PairResult = { a: string; b: string; image: number; text: number };

/** Pure pairwise comparison (exported for tests). */
export function comparePairs(cands: Candidate[]): PairResult[] {
  const out: PairResult[] = [];
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const A = cands[i];
      const B = cands[j];
      const image = A.pages.length && B.pages.length ? maxPageSimilarity(A.pages, B.pages) : 0;
      let text = 0;
      if (A.shingles.size >= MIN_TRANSCRIPT_WORDS / 2 && B.shingles.size >= MIN_TRANSCRIPT_WORDS / 2) {
        text = (containment(A.shingles, B.shingles) + jaccard(A.shingles, B.shingles)) / 2;
      }
      if (image >= IMAGE_DUPLICATE_THRESHOLD || text >= TEXT_COPY_THRESHOLD) {
        // Order so that A is the earlier ("original") submission.
        const ta = (A.submittedAt ?? A.createdAt).getTime();
        const tb = (B.submittedAt ?? B.createdAt).getTime();
        out.push(ta <= tb ? { a: A.id, b: B.id, image, text } : { a: B.id, b: A.id, image, text });
      }
    }
  }
  return out;
}

/**
 * Re-computes duplicate-image and copied-text flags for an assignment.
 * Pairs the teacher already confirmed or dismissed are left untouched.
 */
export async function runFraudChecks(assignmentId: string): Promise<number> {
  const subs = await db.query.submissions.findMany({
    where: and(eq(schema.submissions.assignmentId, assignmentId), eq(schema.submissions.status, 'GRADED')),
  });
  const qs = await db.query.questions.findMany({ where: eq(schema.questions.assignmentId, assignmentId) });
  const common = qs.map((q) => `${q.text} ${q.modelAnswer ?? ''}`).join(' ');

  const cands: Candidate[] = subs.map((s) => {
    const transcript = s.transcript ? removeCommon(s.transcript, common) : '';
    const words = normalizeText(transcript).split(' ').filter(Boolean).length;
    return {
      id: s.id,
      label: s.label,
      submittedAt: s.submittedAt,
      createdAt: s.createdAt,
      pages: (s.pageHashes ?? []).map(decodePage),
      shingles: words >= MIN_TRANSCRIPT_WORDS ? shingles(transcript) : new Set<string>(),
      reviewStatus: s.reviewStatus,
    };
  });

  const pairs = comparePairs(cands);

  const existing = await db.query.fraudFlags.findMany({ where: eq(schema.fraudFlags.assignmentId, assignmentId) });
  const decided = new Set(
    existing
      .filter((f) => f.status !== 'OPEN' && f.submissionBId)
      .map((f) => [f.submissionAId, f.submissionBId].sort().join(':')),
  );
  const stale = existing.filter((f) => f.status === 'OPEN' && f.type !== 'HANDWRITING_MISMATCH').map((f) => f.id);
  if (stale.length) await db.delete(schema.fraudFlags).where(inArray(schema.fraudFlags.id, stale));

  const flagged = new Set<string>();
  let created = 0;
  for (const p of pairs) {
    if (decided.has([p.a, p.b].sort().join(':'))) continue;
    const type = p.image >= IMAGE_DUPLICATE_THRESHOLD ? 'DUPLICATE_IMAGE' : 'TEXT_SIMILARITY';
    const details =
      type === 'DUPLICATE_IMAGE'
        ? `The same page image appears in both submissions (${Math.round(p.image * 100)}% visual match).`
        : `Answers are ${Math.round(p.text * 100)}% similar in wording.`;
    await db.insert(schema.fraudFlags).values({
      assignmentId,
      submissionAId: p.a,
      submissionBId: p.b,
      type,
      imageSimilarity: Number(p.image.toFixed(3)),
      textSimilarity: Number(p.text.toFixed(3)),
      details,
    });
    flagged.add(p.a).add(p.b);
    created++;
  }

  // Previously flagged handwriting mismatches stay flagged.
  for (const f of existing) {
    if (f.type === 'HANDWRITING_MISMATCH' && f.status === 'OPEN') flagged.add(f.submissionAId);
  }

  const toSuspicious = subs.filter((s) => flagged.has(s.id) && (s.reviewStatus === 'PENDING' || s.reviewStatus === 'NEEDS_REVIEW'));
  if (toSuspicious.length) {
    await db
      .update(schema.submissions)
      .set({ reviewStatus: 'SUSPICIOUS' })
      .where(inArray(schema.submissions.id, toSuspicious.map((s) => s.id)));
  }
  // Submissions that were suspicious only because of a flag that no longer exists go back to review.
  const cleared = subs.filter((s) => s.reviewStatus === 'SUSPICIOUS' && !flagged.has(s.id));
  if (cleared.length) {
    await db
      .update(schema.submissions)
      .set({ reviewStatus: 'NEEDS_REVIEW' })
      .where(inArray(schema.submissions.id, cleared.map((s) => s.id)));
  }
  return created;
}
