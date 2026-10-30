import ExcelJS from 'exceljs';
import { HttpError } from '../lib/http.js';

export type RosterStudent = { name: string; rollNo: string; email?: string | null };
export type RosterResult = { students: RosterStudent[]; warnings: string[] };

/** Minimal RFC-4180 CSV parser (handles quotes, escaped quotes, CRLF, ; or , delimiters). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const o = v as unknown as Record<string, unknown>;
    if ('text' in o && typeof o.text === 'string') return o.text;
    if ('result' in o) return String(o.result ?? '');
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('hyperlink' in o) return String(o.hyperlink);
    return '';
  }
  return String(v);
}

export async function parseSpreadsheetFile(buffer: Buffer, filename: string): Promise<string[][]> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return parseCsv(buffer.toString('utf8'));
  if (lower.endsWith('.xls')) {
    throw new HttpError(400, 'Old .xls files are not supported. Please save the file as .xlsx or .csv.', 'ROSTER_FORMAT');
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new HttpError(400, 'Could not read this Excel file. Please upload a valid .xlsx or .csv file.', 'ROSTER_FORMAT');
  }
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0) ?? wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals = (r.values as ExcelJS.CellValue[]).slice(1).map(cellToString);
    rows.push(vals);
  });
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const NAME_RE = /\bname\b|student/i;
const NAME_EXCLUDE_RE = /father|mother|parent|guardian|file|teacher|faculty|course|subject|user ?name|institute|college|school/i;
const ROLL_RE = /roll|enrol|enroll|registration|reg\.? ?no|student ?id|admission|\buid\b|\bid\b|university ?no|sap/i;
const EMAIL_RE = /e-?mail/i;

export type ColumnMap = { header: number; name: number; roll: number; email: number };

/** Finds the header row and the name / roll / email columns. */
export function detectColumns(rows: string[][]): ColumnMap | null {
  for (let h = 0; h < Math.min(rows.length, 10); h++) {
    const r = rows[h].map((c) => c.trim());
    const roll = r.findIndex((c) => ROLL_RE.test(c) && !EMAIL_RE.test(c));
    let name = r.findIndex((c, i) => i !== roll && /\bname\b/i.test(c) && !NAME_EXCLUDE_RE.test(c));
    if (name < 0) name = r.findIndex((c, i) => i !== roll && NAME_RE.test(c) && !NAME_EXCLUDE_RE.test(c) && !ROLL_RE.test(c));
    const email = r.findIndex((c) => EMAIL_RE.test(c));
    if (name >= 0 || roll >= 0) return { header: h, name, roll, email };
  }
  return null;
}

const looksLikeId = (s: string) => /\d/.test(s) && !/\s{1}\S+\s/.test(s.trim()) && s.trim().length <= 30;
const looksLikeName = (s: string) => /^[A-Za-z][A-Za-z .'-]{1,80}$/.test(s.trim()) && !/\d/.test(s);

export function rowsToRoster(rows: string[][]): RosterResult {
  const warnings: string[] = [];
  if (!rows.length) return { students: [], warnings: ['The file is empty.'] };

  let map = detectColumns(rows);
  let dataStart: number;
  if (map) {
    dataStart = map.header + 1;
  } else {
    // No header row: infer from the first data row.
    const sample = rows[0];
    const roll = sample.findIndex(looksLikeId);
    const name = sample.findIndex((c, i) => i !== roll && looksLikeName(c));
    map = { header: -1, name, roll, email: sample.findIndex((c) => /@/.test(c)) };
    dataStart = 0;
  }
  if (map.name < 0 && map.roll < 0) {
    return { students: [], warnings: ['Could not find "Name" or "Roll No / Student ID" columns.'] };
  }
  if (map.roll < 0) warnings.push('No Roll No / Student ID column found; IDs were generated from names.');

  const seen = new Set<string>();
  const students: RosterStudent[] = [];
  let skipped = 0;
  let dupes = 0;
  for (let i = dataStart; i < rows.length; i++) {
    const r = rows[i];
    const name = (map.name >= 0 ? r[map.name] : '')?.trim().replace(/\s+/g, ' ') ?? '';
    let roll = (map.roll >= 0 ? r[map.roll] : '')?.trim().replace(/\s+/g, '') ?? '';
    const email = map.email >= 0 ? r[map.email]?.trim() || null : null;
    if (!name && !roll) continue;
    if (!roll) roll = `NOID-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    if (!name) {
      skipped++;
      continue;
    }
    const key = roll.toUpperCase();
    if (seen.has(key)) {
      dupes++;
      continue;
    }
    seen.add(key);
    students.push({ name, rollNo: roll, email });
  }
  if (skipped) warnings.push(`${skipped} row(s) without a student name were skipped.`);
  if (dupes) warnings.push(`${dupes} duplicate Roll No / Student ID row(s) were skipped.`);
  if (students.length > 2000) {
    return { students: students.slice(0, 2000), warnings: [...warnings, 'Only the first 2000 students were imported.'] };
  }
  return { students, warnings };
}
