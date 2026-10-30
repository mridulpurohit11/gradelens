/**
 * Pure helpers that turn a list of submission files (or sheet rows) into one group per student
 * and match each group to the class roster.
 */

export type RosterEntry = { id: string; name: string; rollNo: string; email?: string | null };

export type SourceFile = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string | null;
  modifiedTime: string | null;
  size: number | null;
  topFolderId?: string | null;
  topFolderName?: string | null;
};

export type SubmissionGroup = {
  groupKey: string;
  label: string;
  studentId: string | null;
  files: SourceFile[];
  submittedAt: string | null;
};

const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const tokens = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** Strips extension, page markers and Google Forms' " - Uploader Name" suffix noise. */
export function fileStem(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[\s_-]*(\(\d+\)|copy|page[\s_-]*\d+|pg[\s_-]*\d+|p\d+|img[\s_-]*\d+)$/i, '')
    .replace(/[\s_-]+\d{1,2}$/i, '')
    .trim();
}

/**
 * Finds the roster student referenced by a piece of text (file name, folder name, sheet cell).
 * Roll numbers win over names; ambiguous name matches return null.
 */
export function matchStudent(text: string, roster: RosterEntry[]): RosterEntry | null {
  if (!text) return null;
  const c = compact(text);
  const textTokens = new Set(tokens(text));

  // 1) Roll number contained in the text (prefer the longest, most specific roll).
  let best: RosterEntry | null = null;
  for (const s of roster) {
    const roll = compact(s.rollNo);
    if (roll.length < 3 || roll.startsWith('NOID')) continue;
    if (c.includes(roll) && (!best || roll.length > compact(best.rollNo).length)) best = s;
  }
  if (best) return best;

  // 2) Email local part.
  const lower = text.toLowerCase();
  for (const s of roster) {
    if (s.email && lower.includes(s.email.toLowerCase())) return s;
  }

  // 3) All name tokens present (order-independent), unique best match.
  let top: RosterEntry[] = [];
  let topScore = 0;
  for (const s of roster) {
    const nt = tokens(s.name).filter((t) => t.length >= 2 && !['MR', 'MS', 'MRS', 'DR', 'KUMAR'].includes(t));
    if (!nt.length) continue;
    if (!nt.every((t) => textTokens.has(t))) continue;
    const score = nt.length;
    if (score > topScore) {
      top = [s];
      topScore = score;
    } else if (score === topScore) top.push(s);
  }
  if (top.length === 1 && (topScore >= 2 || tokens(text).length <= 3)) return top[0];
  return null;
}

const latestUpload = (files: SourceFile[]) =>
  files
    .map((f) => f.createdTime ?? f.modifiedTime)
    .filter((t): t is string => Boolean(t))
    .sort()
    .at(-1) ?? null; // latest upload time = when the submission was completed

/** Groups Drive-folder files: one sub-folder per student, or files named after the student. */
export function groupFolderFiles(files: SourceFile[], roster: RosterEntry[]): SubmissionGroup[] {
  const groups = new Map<string, SubmissionGroup>();
  const add = (key: string, label: string, studentId: string | null, f: SourceFile) => {
    const g = groups.get(key) ?? { groupKey: key, label, studentId, files: [], submittedAt: null };
    g.files.push(f);
    groups.set(key, g);
  };

  for (const f of files) {
    if (f.topFolderId) {
      const student = matchStudent(f.topFolderName ?? '', roster) ?? matchStudent(f.name, roster);
      const key = student ? `student:${student.id}` : `folder:${f.topFolderId}`;
      add(key, f.topFolderName ?? f.name, student?.id ?? null, f);
      continue;
    }
    const student = matchStudent(f.name, roster);
    if (student) {
      add(`student:${student.id}`, fileStem(f.name), student.id, f);
    } else {
      const stem = fileStem(f.name);
      add(`file:${compact(stem) || f.id}`, stem || f.name, null, f);
    }
  }

  for (const g of groups.values()) {
    g.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    g.submittedAt = latestUpload(g.files);
  }
  return [...groups.values()];
}

export type SheetLayout = {
  header: number;
  name: number;
  roll: number;
  email: number;
  timestamp: number;
  fileCols: number[];
};

const DRIVE_LINK_RE = /drive\.google\.com|docs\.google\.com/;

/** Detects a Google Form responses sheet: identity columns + the file-upload column(s). */
export function detectSheetLayout(rows: string[][]): SheetLayout | null {
  if (rows.length < 1) return null;
  const header = rows[0].map((c) => c.trim());
  const find = (re: RegExp, exclude?: RegExp) => header.findIndex((h) => re.test(h) && !(exclude && exclude.test(h)));
  const roll = find(/roll|enrol|enroll|registration|reg\.? ?no|student ?id|admission|\buid\b|university ?no|sap/i, /e-?mail/i);
  const name = find(/name/i, /file|father|mother|teacher|faculty|subject|course|user ?name/i);
  const email = find(/e-?mail/i);
  const timestamp = find(/timestamp|submitted|date/i);
  const fileCols: number[] = [];
  for (let c = 0; c < header.length; c++) {
    if (rows.slice(1).some((r) => DRIVE_LINK_RE.test(r[c] ?? ''))) fileCols.push(c);
  }
  if (!fileCols.length) return null;
  return { header: 0, name, roll, email, timestamp, fileCols };
}

/** Parses Google Forms timestamps like "28/10/2026 19:02:11" or ISO dates. */
export function parseSheetTimestamp(v: string): string | null {
  if (!v) return null;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    // Forms in India use DD/MM/YYYY. Interpret as IST.
    const [, d, mo, y, h, mi, s] = m;
    const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${h.padStart(2, '0')}:${mi}:${(s ?? '00').padStart(2, '0')}+05:30`;
    const t = new Date(iso);
    return Number.isNaN(t.getTime()) ? null : t.toISOString();
  }
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

export type SheetRowGroup = {
  groupKey: string;
  label: string;
  studentId: string | null;
  fileIds: string[];
  submittedAt: string | null;
};

/** Turns form-response rows into groups. A student's latest response wins. */
export function groupSheetRows(
  rows: string[][],
  layout: SheetLayout,
  roster: RosterEntry[],
  extractIds: (cell: string) => string[],
): SheetRowGroup[] {
  const groups = new Map<string, SheetRowGroup>();
  for (let i = layout.header + 1; i < rows.length; i++) {
    const r = rows[i];
    const fileIds = layout.fileCols.flatMap((c) => extractIds(r[c] ?? ''));
    if (!fileIds.length) continue;
    const name = layout.name >= 0 ? (r[layout.name] ?? '').trim() : '';
    const roll = layout.roll >= 0 ? (r[layout.roll] ?? '').trim() : '';
    const email = layout.email >= 0 ? (r[layout.email] ?? '').trim() : '';
    const submittedAt = layout.timestamp >= 0 ? parseSheetTimestamp(r[layout.timestamp] ?? '') : null;
    const student =
      (roll && matchStudent(roll, roster)) ||
      (email && matchStudent(email, roster)) ||
      (name && matchStudent(name, roster)) ||
      null;
    const key = student ? `student:${student.id}` : `row:${compact(roll) || compact(email) || compact(name) || i}`;
    const prev = groups.get(key);
    if (prev && prev.submittedAt && submittedAt && prev.submittedAt > submittedAt) continue;
    groups.set(key, {
      groupKey: key,
      label: [name, roll].filter(Boolean).join(' · ') || email || `Row ${i + 1}`,
      studentId: student?.id ?? null,
      fileIds,
      submittedAt,
    });
  }
  return [...groups.values()];
}
