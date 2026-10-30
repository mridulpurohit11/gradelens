/** Text-similarity helpers used to detect copied answers across submissions. */

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word n-gram shingles (default 4 words). */
export function shingles(text: string, n = 4): Set<string> {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const out = new Set<string>();
  if (words.length < n) {
    if (words.length) out.add(words.join(' '));
    return out;
  }
  for (let i = 0; i <= words.length - n; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

/** Fraction of the smaller submission's shingles that also appear in the other one (containment). */
export function containment(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let hit = 0;
  for (const s of small) if (big.has(s)) hit++;
  return hit / small.size;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Score used for copy detection: average of containment and Jaccard on 4-word shingles.
 * Ignores answers that are too short to be meaningful.
 */
export function textSimilarity(a: string, b: string, minWords = 40): number {
  const wa = normalizeText(a).split(' ').filter(Boolean).length;
  const wb = normalizeText(b).split(' ').filter(Boolean).length;
  if (wa < minWords || wb < minWords) return 0;
  const sa = shingles(a);
  const sb = shingles(b);
  return (containment(sa, sb) + jaccard(sa, sb)) / 2;
}

/** Shingles that appear in common phrasing taken from the question / model answer are not evidence of copying. */
export function removeCommon(text: string, common: string): string {
  if (!common) return text;
  const commonSh = shingles(common);
  const words = normalizeText(text).split(' ');
  const keep: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const sh = words.slice(i, i + 4).join(' ');
    if (!commonSh.has(sh)) keep.push(words[i]);
  }
  return keep.join(' ');
}
