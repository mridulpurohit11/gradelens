import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { buildReport, buildResultRows, totalMarksOf, type Bundle, type ResultRow } from './results.js';

export type ExportOptions = { includeFeedback: boolean; includeFraud: boolean; includeTimestamps: boolean };

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending approval',
  APPROVED: 'Approved',
  NEEDS_REVIEW: 'Needs review',
  SUSPICIOUS: 'Suspicious',
  COPIED: 'Marked as copied',
  MISSING: 'Missing',
};

export function statusLabel(r: ResultRow) {
  if (r.status === 'FAILED') return 'Could not evaluate';
  if (r.status === 'QUEUED' || r.status === 'PROCESSING') return 'Evaluating';
  return STATUS_LABEL[r.reviewStatus] ?? r.reviewStatus;
}

export const classLabel = (b: Bundle) => `${b.cls.course} · ${b.cls.semester} · Section ${b.cls.section}`;

const fmt = (n: number | null) => (n === null ? '' : Number.isInteger(n) ? n : Number(n.toFixed(2)));

/** Tabular export shared by Excel and Google Sheets. */
export function resultsTable(b: Bundle, o: ExportOptions) {
  const rows = buildResultRows(b);
  const total = totalMarksOf(b.questions);
  const headers = [
    'S.No',
    'Student Name',
    'Student ID',
    ...b.questions.map((q, i) => `Q${i + 1} (${fmt(q.marks)})`),
    `Total (${fmt(total)})`,
    'Percentage',
    'Status',
    'Remarks',
    ...(o.includeFeedback ? ['AI Feedback'] : []),
    ...(o.includeFraud ? ['Integrity Remarks'] : []),
    ...(o.includeTimestamps ? ['Submitted At (IST)', 'Late'] : []),
  ];
  const body = rows.map((r, i) => [
    i + 1,
    r.name,
    r.rollNo ?? '',
    ...r.scores.map((s) => (s === null ? '' : fmt(s))),
    r.total === null ? (r.status === 'MISSING' ? 0 : '') : fmt(r.total),
    r.total === null || !total ? (r.status === 'MISSING' ? '0%' : '') : `${Math.round((r.total / total) * 1000) / 10}%`,
    statusLabel(r),
    [r.remark, r.isLate ? 'Late submission' : null, r.note].filter(Boolean).join('; '),
    ...(o.includeFeedback ? [r.feedback ?? ''] : []),
    ...(o.includeFraud ? [r.flagSummary ?? ''] : []),
    ...(o.includeTimestamps
      ? [r.submittedAt ? new Date(r.submittedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '', r.isLate ? 'Yes' : 'No']
      : []),
  ]);
  return { headers, body, rows };
}

function summaryRows(b: Bundle) {
  const rep = buildReport(b);
  const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 1000) / 10}%`);
  return [
    ['Assignment', b.assignment.title],
    ['Class', classLabel(b)],
    ['Subject', `${b.cls.subjectName}${b.cls.subjectCode ? ` (${b.cls.subjectCode})` : ''}`],
    ['Total marks', fmt(rep.totalMarks)],
    ['Students in class', rep.rosterSize],
    ['Submissions evaluated', rep.evaluated],
    ['Submission rate', pct(rep.submissionRate)],
    ['Class average', rep.evaluated ? fmt(Math.round(rep.average * 100) / 100) : '—'],
    ['Highest', rep.highest ?? '—'],
    ['Lowest', rep.lowest ?? '—'],
    ['Generated', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST'],
    ['Note', 'Marks were suggested by AI and reviewed by the faculty member.'],
  ] as (string | number)[][];
}

export async function toXlsx(b: Bundle, o: ExportOptions): Promise<Buffer> {
  const { headers, body } = resultsTable(b, o);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GradeLens';
  wb.created = new Date();
  const ws = wb.addWorksheet('Results', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.addRow(headers);
  body.forEach((r) => ws.addRow(r));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 28;
  ws.columns.forEach((col, i) => {
    const h = headers[i] ?? '';
    col.width = i === 0 ? 6 : h === 'Student Name' ? 26 : /Remarks|Feedback/.test(h) ? 48 : Math.max(10, h.length + 2);
    if (/Remarks|Feedback/.test(h)) col.alignment = { wrapText: true, vertical: 'top' };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  const sum = wb.addWorksheet('Summary');
  summaryRows(b).forEach((r) => sum.addRow(r));
  sum.getColumn(1).width = 24;
  sum.getColumn(1).font = { bold: true };
  sum.getColumn(2).width = 60;

  const rep = buildReport(b);
  const qs = wb.addWorksheet('Question Analysis');
  qs.addRow(['Question', 'Max Marks', 'Average', 'Average %', 'Question Text']);
  rep.questionPerformance.forEach((q) =>
    qs.addRow([`Q${q.number}`, q.marks, Math.round(q.average * 100) / 100, `${Math.round(q.percent * 1000) / 10}%`, q.text]),
  );
  qs.getRow(1).font = { bold: true };
  qs.getColumn(5).width = 80;

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function googleSheetTabs(b: Bundle, o: ExportOptions) {
  const { headers, body } = resultsTable(b, o);
  return [
    { title: 'Results', rows: [headers, ...body] as (string | number | null)[][] },
    { title: 'Summary', rows: summaryRows(b) },
  ];
}

/** Consolidated PDF report: summary, question analysis and the marks table. */
export async function toPdf(b: Bundle, o: ExportOptions): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: `${b.assignment.title} – Results`, Author: 'GradeLens' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const navy = '#1E3A5F';
  const muted = '#5F6B7A';
  const pageW = doc.page.width - 72;

  doc.fillColor(navy).font('Helvetica-Bold').fontSize(18).text(b.assignment.title);
  doc.moveDown(0.2).fillColor(muted).font('Helvetica').fontSize(10).text(`${classLabel(b)} · ${b.cls.subjectName}`);
  doc.moveDown(0.8);

  const rep = buildReport(b);
  const cards: [string, string][] = [
    ['Class average', rep.evaluated ? `${fmt(Math.round(rep.average * 10) / 10)} / ${fmt(rep.totalMarks)}` : '—'],
    ['Highest', rep.highest !== null ? `${fmt(rep.highest)} / ${fmt(rep.totalMarks)}` : '—'],
    ['Lowest', rep.lowest !== null ? `${fmt(rep.lowest)} / ${fmt(rep.totalMarks)}` : '—'],
    ['Submission rate', rep.submissionRate !== null ? `${Math.round(rep.submissionRate * 100)}% (${rep.submitted}/${rep.rosterSize})` : '—'],
  ];
  const cw = (pageW - 3 * 10) / 4;
  const top = doc.y;
  cards.forEach(([label, value], i) => {
    const x = 36 + i * (cw + 10);
    doc.roundedRect(x, top, cw, 52, 6).lineWidth(0.8).strokeColor('#E1E5EB').stroke();
    doc.fillColor(muted).font('Helvetica').fontSize(9).text(label, x + 10, top + 10, { width: cw - 20 });
    doc.fillColor('#1A1D23').font('Helvetica-Bold').fontSize(14).text(value, x + 10, top + 26, { width: cw - 20 });
  });
  doc.y = top + 66;
  doc.x = 36;

  doc.fillColor(navy).font('Helvetica-Bold').fontSize(12).text('Question-wise performance');
  doc.moveDown(0.4);
  for (const q of rep.questionPerformance) {
    const y = doc.y;
    doc.fillColor('#1A1D23').font('Helvetica').fontSize(9).text(`Q${q.number}`, 36, y, { width: 30 });
    doc.rect(70, y + 1, 300, 8).fillColor('#E8EEF5').fill();
    doc.rect(70, y + 1, 300 * Math.min(1, q.percent), 8).fillColor(navy).fill();
    doc.fillColor(muted).text(`${fmt(Math.round(q.average * 10) / 10)} / ${fmt(q.marks)} (${Math.round(q.percent * 100)}%)`, 380, y, { width: 140 });
    doc.y = y + 16;
  }
  doc.x = 36;
  doc.moveDown(0.8);

  const { headers, body } = resultsTable(b, { ...o, includeTimestamps: false, includeFeedback: false });
  const remarkIdx = headers.indexOf('Remarks');
  const cols: number[] = headers.map((h, i): number => {
    if (i === 0) return 30;
    if (h === 'Student Name') return 130;
    if (h === 'Student ID') return 80;
    if (h === 'Status') return 85;
    if (i === remarkIdx || h === 'Integrity Remarks') return 0; // flexible
    return 46;
  });
  const fixed = cols.reduce((s, c) => s + c, 0);
  const flexCount = cols.filter((c) => c === 0).length || 1;
  const flexW = Math.max(60, (pageW - fixed) / flexCount);
  const widths = cols.map((c) => (c === 0 ? flexW : c));

  const drawHeader = () => {
    const y = doc.y;
    doc.rect(36, y, pageW, 20).fillColor(navy).fill();
    let x = 36;
    headers.forEach((h, i) => {
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8).text(h, x + 4, y + 6, { width: widths[i] - 8, lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + 20;
  };
  drawHeader();
  body.forEach((r, ri) => {
    const cells = r.map((c) => String(c ?? ''));
    const heights = cells.map((c, i) => doc.font('Helvetica').fontSize(8).heightOfString(c, { width: widths[i] - 8 }));
    const h = Math.max(16, Math.min(60, Math.max(...heights) + 8));
    if (doc.y + h > doc.page.height - 40) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    if (ri % 2 === 1) doc.rect(36, y, pageW, h).fillColor('#F7F8FA').fill();
    let x = 36;
    cells.forEach((c, i) => {
      doc.fillColor('#1A1D23').font('Helvetica').fontSize(8).text(c, x + 4, y + 4, { width: widths[i] - 8, height: h - 6, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + h;
  });

  doc.moveDown(1);
  doc.x = 36;
  doc.fillColor(muted).font('Helvetica').fontSize(8).text(
    `Generated by GradeLens on ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST. Marks were suggested by AI and reviewed by the faculty member.`,
  );
  doc.end();
  return done;
}
