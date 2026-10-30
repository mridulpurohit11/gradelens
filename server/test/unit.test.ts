import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { parseCsv, rowsToRoster, detectColumns } from '../src/services/roster.js';
import { matchStudent, groupFolderFiles, detectSheetLayout, groupSheetRows, fileStem, parseSheetTimestamp } from '../src/services/matching.js';
import { textSimilarity, removeCommon } from '../src/services/similarity.js';
import { fingerprint, pageSimilarity, enhancePage } from '../src/services/images.js';
import { normalizeRubric, sanitizeGrade, roundHalf } from '../src/services/ai.js';
import { parseDriveFolderId, parseSpreadsheet, extractDriveFileIds } from '../src/services/google.js';
import { comparePairs } from '../src/services/fraud.js';

const roster = [
  { id: 's1', name: 'Aarav Sharma', rollNo: 'MCA23001', email: 'aarav@example.edu' },
  { id: 's2', name: 'Priya Negi', rollNo: 'MCA23002', email: null },
  { id: 's3', name: 'Rohit Bisht', rollNo: 'MCA23003', email: null },
  { id: 's4', name: 'Rohit Rana', rollNo: 'MCA23013', email: null },
];

describe('roster parsing', () => {
  it('parses quoted CSV with semicolons and CRLF', () => {
    const rows = parseCsv('﻿Name;Roll No\r\n"Sharma, Aarav";MCA1\r\nPriya;MCA2\r\n');
    expect(rows).toEqual([
      ['Name', 'Roll No'],
      ['Sharma, Aarav', 'MCA1'],
      ['Priya', 'MCA2'],
    ]);
  });

  it('detects header columns and dedupes roll numbers', () => {
    const rows = [
      ['S.No', 'Student Name', 'Father Name', 'Enrollment No', 'Email ID'],
      ['1', 'Aarav Sharma', 'X', 'MCA23001', 'a@x.in'],
      ['2', 'Priya Negi', 'Y', 'MCA23002', ''],
      ['3', 'Duplicate', 'Z', 'mca23001', ''],
    ];
    expect(detectColumns(rows)).toMatchObject({ header: 0, name: 1, roll: 3, email: 4 });
    const r = rowsToRoster(rows);
    expect(r.students).toHaveLength(2);
    expect(r.students[0]).toEqual({ name: 'Aarav Sharma', rollNo: 'MCA23001', email: 'a@x.in' });
    expect(r.warnings.join(' ')).toMatch(/duplicate/i);
  });

  it('handles a roster without headers', () => {
    const r = rowsToRoster([
      ['Aarav Sharma', 'MCA23001'],
      ['Priya Negi', 'MCA23002'],
    ]);
    expect(r.students.map((s) => s.rollNo)).toEqual(['MCA23001', 'MCA23002']);
  });
});

describe('student matching', () => {
  it('matches roll numbers inside file names', () => {
    expect(matchStudent('MCA23002_Assignment2.jpg', roster)?.id).toBe('s2');
    expect(matchStudent('assignment - mca 23003 (1).pdf', roster)?.id).toBe('s3');
  });
  it('matches names regardless of order and case', () => {
    expect(matchStudent('negi priya assignment 2', roster)?.id).toBe('s2');
    expect(matchStudent('IMG_2026 - Aarav Sharma.jpg', roster)?.id).toBe('s1');
  });
  it('returns null for ambiguous first names', () => {
    expect(matchStudent('Rohit.jpg', roster)).toBeNull();
  });
  it('prefers the longest roll match', () => {
    expect(matchStudent('MCA230013.jpg', [{ id: 'a', name: 'A', rollNo: 'MCA2300' }, { id: 'b', name: 'B', rollNo: 'MCA230013' }])?.id).toBe('b');
  });
  it('strips page markers from file stems', () => {
    expect(fileStem('Aarav Sharma page 2.jpg')).toBe('Aarav Sharma');
    expect(fileStem('scan (3).png')).toBe('scan');
  });
  it('groups pages per student and per sub-folder', () => {
    const f = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, mimeType: 'image/jpeg', createdTime: '2026-10-28T10:00:00Z', modifiedTime: null, size: 1, ...extra });
    const groups = groupFolderFiles(
      [
        f('1', 'MCA23001_p1.jpg'),
        f('2', 'MCA23001_p2.jpg'),
        f('3', 'page1.jpg', { topFolderId: 'F', topFolderName: 'Priya Negi' }),
        f('4', 'page2.jpg', { topFolderId: 'F', topFolderName: 'Priya Negi' }),
        f('5', 'unknown kid.jpg'),
      ],
      roster,
    );
    expect(groups).toHaveLength(3);
    expect(groups.find((g) => g.studentId === 's1')?.files).toHaveLength(2);
    expect(groups.find((g) => g.studentId === 's2')?.files).toHaveLength(2);
    expect(groups.find((g) => !g.studentId)?.label).toBe('unknown kid');
  });
  it('reads Google Form response sheets', () => {
    const rows = [
      ['Timestamp', 'Email Address', 'Full Name', 'Roll Number', 'Upload your assignment'],
      ['28/10/2026 19:02:11', 'x@y.in', 'Priya Negi', 'MCA23002', 'https://drive.google.com/open?id=FILEAAAAAAAAAAA1, https://drive.google.com/open?id=FILEAAAAAAAAAAA2'],
      ['29/10/2026 08:00:00', 'z@y.in', 'Priya Negi', 'MCA23002', 'https://drive.google.com/open?id=FILEBBBBBBBBBBB1'],
      ['29/10/2026 09:00:00', 'q@y.in', 'Someone Else', 'XYZ', 'https://drive.google.com/open?id=FILECCCCCCCCCCC1'],
    ];
    const layout = detectSheetLayout(rows)!;
    expect(layout).toMatchObject({ name: 2, roll: 3, email: 1, timestamp: 0, fileCols: [4] });
    const groups = groupSheetRows(rows, layout, roster, extractDriveFileIds);
    expect(groups).toHaveLength(2);
    const priya = groups.find((g) => g.studentId === 's2')!;
    expect(priya.fileIds).toEqual(['FILEBBBBBBBBBBB1']); // latest response wins
    expect(parseSheetTimestamp('28/10/2026 19:02:11')).toBe('2026-10-28T13:32:11.000Z');
  });
});

describe('google link parsing', () => {
  it('parses folder and sheet links', () => {
    expect(parseDriveFolderId('https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOpQrStUv?usp=sharing')).toBe('1AbCdEfGhIjKlMnOpQrStUv');
    expect(parseSpreadsheet('https://docs.google.com/spreadsheets/d/1abcDEFghiJKLmnoPQRstuVWXyz0123456789/edit#gid=42')).toEqual({ id: '1abcDEFghiJKLmnoPQRstuVWXyz0123456789', gid: 42 });
    expect(parseDriveFolderId('hello')).toBeNull();
    expect(extractDriveFileIds('https://drive.google.com/file/d/AAAAAAAAAAAA/view, https://drive.google.com/open?id=BBBBBBBBBBBB')).toEqual(['AAAAAAAAAAAA', 'BBBBBBBBBBBB']);
  });
});

describe('text similarity', () => {
  const answer =
    'merge sort is a divide and conquer algorithm that splits the array into two halves sorts each half recursively and merges the sorted halves using an auxiliary array the recurrence is t of n equals two t of n by two plus n which solves to n log n in all cases and it is a stable sort that needs linear extra space for merging';
  it('scores copied text high and different text low', () => {
    const copied = answer.replace('auxiliary', 'extra');
    const different =
      'quick sort picks a pivot element and partitions the array so smaller elements go left and larger elements go right then it recursively sorts both partitions the worst case happens when the pivot is always the minimum or maximum giving quadratic time while the average case is n log n with good pivot choice randomized pivots help avoid the worst case';
    expect(textSimilarity(answer, copied)).toBeGreaterThan(0.7);
    expect(textSimilarity(answer, different)).toBeLessThan(0.15);
  });
  it('ignores very short answers', () => {
    expect(textSimilarity('merge sort', 'merge sort')).toBe(0);
  });
  it('removes phrases copied from the question', () => {
    expect(removeCommon('explain merge sort with an example merge sort splits', 'Explain merge sort with an example')).not.toMatch(/explain merge sort with/);
  });
});

async function textImage(lines: string[], seed = 0) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1300"><rect width="100%" height="100%" fill="#fdfcf7"/>${Array.from({ length: 18 }, (_, i) => `<line x1="30" x2="970" y1="${120 + i * 64}" y2="${120 + i * 64}" stroke="#c9d6ea" stroke-width="2"/>`).join('')}<g font-family="sans-serif" font-size="34" fill="#1d3b8f">${lines.map((l, i) => `<text x="${60 + seed}" y="${110 + i * 64}">${l}</text>`).join('')}</g></svg>`;
  return enhancePage(await sharp(Buffer.from(svg)).jpeg().toBuffer());
}

describe('page fingerprints', () => {
  it('recognises the same page re-uploaded and distinguishes different pages', async () => {
    const a = await textImage(['Q1 Merge sort divides the array', 'into halves and merges them', 'T(n) = 2T(n/2) + n', 'Example 38 27 43 3 9 82 10']);
    const b = await textImage(['Q2 Quick sort chooses a pivot', 'worst case is quadratic time', 'T(n) = T(n-1) + n', 'random pivot avoids worst case']);
    const aRecompressed = await sharp(a).resize({ width: 900 }).jpeg({ quality: 55 }).toBuffer();
    const [fa, fb, fa2] = await Promise.all([fingerprint(a), fingerprint(b), fingerprint(aRecompressed)]);
    expect(pageSimilarity(fa, fa2)).toBeGreaterThan(0.85);
    expect(pageSimilarity(fa, fb)).toBeLessThan(0.6);
  });
});

describe('fraud pairing', () => {
  it('orders the earlier submission first', () => {
    const page = (h: string) => ({ hash: h, vec: null });
    const pairs = comparePairs([
      { id: 'late', label: 'B', submittedAt: new Date('2026-10-29'), createdAt: new Date(), pages: [page('ffffffffffffffff')], shingles: new Set(), reviewStatus: 'PENDING' },
      { id: 'early', label: 'A', submittedAt: new Date('2026-10-27'), createdAt: new Date(), pages: [page('ffffffffffffffff')], shingles: new Set(), reviewStatus: 'PENDING' },
      { id: 'other', label: 'C', submittedAt: new Date('2026-10-27'), createdAt: new Date(), pages: [page('0000000000000000')], shingles: new Set(), reviewStatus: 'PENDING' },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: 'early', b: 'late' });
  });
});

describe('AI output safety', () => {
  it('normalises rubric marks to the question total', () => {
    const r = normalizeRubric([{ point: 'a', marks: 1 }, { point: 'b', marks: 1 }, { point: 'c', marks: 1 }], 5);
    expect(r.reduce((s, x) => s + x.marks, 0)).toBe(5);
    expect(r.every((x) => x.marks % 0.5 === 0)).toBe(true);
    expect(normalizeRubric([], 4)).toEqual([{ point: 'Complete and correct answer', marks: 4 }]);
  });
  it('clamps awarded marks and fills missing questions', () => {
    const ctx = {
      course: 'MCA', subject: 'DAA', title: 'A2', strictness: 'STANDARD', wantTranscript: false,
      questions: [
        { number: 1, text: 'q1', marks: 5, modelAnswer: null, rubric: [] },
        { number: 2, text: 'q2', marks: 5, modelAnswer: null, rubric: [] },
      ],
    };
    const g = sanitizeGrade(
      {
        detected_name: 'Priya', detected_roll: 'MCA23002', legibility: 'good',
        questions: [{ question_number: 1, attempted: true, marks_awarded: 7.3, covered_points: [], missing_points: [], feedback: 'ok', confidence: 0.9 }],
        overall_feedback: 'fine', overall_confidence: 0.95, transcript: 'should be dropped', concerns: [],
      },
      ctx,
    );
    expect(g.questions[0].marks).toBe(5);
    expect(g.questions[1]).toMatchObject({ attempted: false, marks: 0 });
    expect(g.transcript).toBe('');
    expect(g.confidence).toBeLessThanOrEqual(0.9);
    expect(roundHalf(2.74)).toBe(2.5);
  });
});
