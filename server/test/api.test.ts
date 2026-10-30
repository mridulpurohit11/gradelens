import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';

// ---- Mock Google (Drive) ----
async function page(lines: string[]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="100%" height="100%" fill="#fff"/><g font-family="sans-serif" font-size="32">${lines
    .map((l, i) => `<text x="40" y="${80 + i * 60}">${l}</text>`)
    .join('')}</g></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}
const pages: Record<string, Buffer> = {};

vi.mock('../src/services/google.js', async (orig) => {
  const actual = await orig<typeof import('../src/services/google.js')>();
  const file = (id: string, name: string, createdTime: string) => ({
    id, name, mimeType: 'image/jpeg', createdTime, modifiedTime: createdTime, size: 1000, folderId: 'ROOT', folderName: 'A2', depth: 0, topFolderId: null, topFolderName: null,
  });
  return {
    ...actual,
    clientForTeacher: () => ({}) as never,
    getDriveItem: async (_a: unknown, id: string) => ({ id, name: 'Assignment 2 Submissions', mimeType: 'application/vnd.google-apps.folder' }),
    listFolderFiles: async () => [
      file('f1', 'MCA23001_Aarav.jpg', '2026-10-27T10:00:00Z'),
      file('f2', 'MCA23002_Priya.jpg', '2026-10-28T10:00:00Z'),
      file('f3', 'MCA23003_Rohit.jpg', '2026-10-29T10:00:00Z'), // re-upload of Aarav's photo
      file('f4', 'scan_0042.jpg', '2026-10-28T11:00:00Z'), // unmatched; roll is written on the paper
    ],
    downloadFile: async (_a: unknown, f: { id: string }) => ({ data: pages[f.id], mimeType: 'image/jpeg' }),
    createSpreadsheet: async () => 'https://docs.google.com/spreadsheets/d/mock/edit',
  };
});

// ---- Mock Claude ----
vi.mock('../src/services/ai.js', async (orig) => {
  const actual = await orig<typeof import('../src/services/ai.js')>();
  const usage = { inputTokens: 1000, outputTokens: 200, costUsd: 0.0002, model: 'claude-haiku-5-5' };
  return {
    ...actual,
    extractQuestions: async () => ({ questions: [{ text: 'Explain merge sort.', marks: 5 }, { text: 'Quick sort worst case.', marks: 5 }], usage }),
    generateAnswerKey: async (_ctx: unknown, qs: { number: number; marks: number }[]) => ({
      questions: qs.map((q) => ({ number: q.number, modelAnswer: 'Model answer', rubric: actual.normalizeRubric([{ point: 'Definition', marks: 2 }, { point: 'Steps', marks: 3 }], q.marks) })),
      usage,
    }),
    gradeSubmission: async (ctx: { questions: { number: number; marks: number }[] }, sub: { pages: Buffer[] }, model: string) => {
      const marker = sub.pages.length;
      void marker;
      return {
        result: {
          detectedName: 'Ananya Joshi',
          detectedRoll: 'MCA23004',
          legibility: 'good',
          questions: ctx.questions.map((q) => ({ number: q.number, attempted: true, marks: q.marks - 1, covered: ['Definition'], missing: ['Steps'], feedback: 'Good attempt.', confidence: 0.92 })),
          overallFeedback: 'Solid work.',
          confidence: 0.92,
          transcript: '',
          concerns: [],
        },
        usage: { ...usage, model },
      };
    },
    compareHandwriting: async () => ({ probability: 0.9, reasoning: 'Consistent', usage }),
  };
});

const { createApp } = await import('../src/app.js');
const { runMigrations, pool, db } = await import('../src/db/index.js');
const { sql } = await import('drizzle-orm');

const app = createApp();
let token = '';
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;`);
  await runMigrations();
  pages.f1 = await page(['Aarav Sharma MCA23001', 'Q1 merge sort divides', 'Q2 worst case n^2']);
  pages.f2 = await page(['Priya Negi MCA23002', 'Q1 merge sort is stable', 'Q2 pivot is extreme', 'more text here']);
  pages.f3 = pages.f1; // identical photo re-uploaded by another student
  pages.f4 = await page(['Ananya Joshi MCA23004', 'Q1 divide and conquer', 'Q2 sorted input']);
});

afterAll(async () => {
  await pool.end();
});

describe('GradeLens API flow', () => {
  let classId = '';
  let assignmentId = '';

  it('rejects unauthenticated requests', async () => {
    await request(app).get('/api/me').expect(401);
    const cfg = await request(app).get('/api/auth/config').expect(200);
    expect(cfg.body).toMatchObject({ googleConfigured: true, devLogin: true });
  });

  it('signs in (dev) and completes the profile', async () => {
    const r = await request(app).post('/api/auth/dev-login').send({ email: 'neha.rawat@example.edu', name: 'Neha Rawat' }).expect(200);
    token = r.body.token;
    const me = await request(app).get('/api/me').set(auth()).expect(200);
    expect(me.body.profileComplete).toBe(false);
    await request(app).put('/api/me').set(auth()).send({ profileComplete: true }).expect(400);
    const done = await request(app)
      .put('/api/me')
      .set(auth())
      .send({ name: 'Dr. Neha Rawat', designation: 'Assistant Professor', university: 'Graphic Era Hill University', campus: 'Dehradun', department: 'Computer Applications', subjects: ['DAA'], profileComplete: true })
      .expect(200);
    expect(done.body.profileComplete).toBe(true);
  });

  it('parses a CSV roster and creates a class', async () => {
    const csv = 'Student Name,Roll No\nAarav Sharma,MCA23001\nPriya Negi,MCA23002\nRohit Bisht,MCA23003\nAnanya Joshi,MCA23004\nKunal Rana,MCA23005\n';
    const parsed = await request(app).post('/api/tools/roster/parse').set(auth()).attach('file', Buffer.from(csv), 'roster.csv').expect(200);
    expect(parsed.body.students).toHaveLength(5);
    const c = await request(app)
      .post('/api/classes')
      .set(auth())
      .send({
        course: 'MCA', semester: 'Semester 3', section: 'a', subjectName: 'Design and Analysis of Algorithms', subjectCode: 'TMC-301',
        sourceType: 'DRIVE_FOLDER', sourceUrl: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv',
        students: parsed.body.students,
      })
      .expect(201);
    classId = c.body.id;
    expect(c.body).toMatchObject({ section: 'A', studentCount: 5, label: 'MCA · Semester 3 · Section A' });
    const verify = await request(app).post('/api/tools/sources/verify').set(auth()).send({ type: 'DRIVE_FOLDER', url: c.body.sourceUrl }).expect(200);
    expect(verify.body.fileCount).toBe(4);
  });

  it('creates an assignment with questions and an approved answer key', async () => {
    const a = await request(app).post('/api/assignments').set(auth()).send({ classId, title: 'Assignment 2 – Sorting Algorithms', dueDate: '2026-10-28' }).expect(201);
    assignmentId = a.body.id;
    expect(a.body.sourceType).toBe('DRIVE_FOLDER'); // inherited from the class
    const ex = await request(app).post(`/api/assignments/${assignmentId}/questions/extract`).set(auth()).attach('file', await page(['Q1', 'Q2']), 'q.jpg').expect(200);
    expect(ex.body.questions).toHaveLength(2);
    await request(app).put(`/api/assignments/${assignmentId}/questions`).set(auth()).send({ questions: ex.body.questions }).expect(200);
    await request(app).post(`/api/assignments/${assignmentId}/evaluate`).set(auth()).expect(400); // key not approved
    const key = await request(app).post(`/api/assignments/${assignmentId}/answer-key`).set(auth()).send({}).expect(200);
    expect(key.body.questions[0].rubric.reduce((s: number, r: { marks: number }) => s + r.marks, 0)).toBe(5);
    const q = key.body.questions[0];
    await request(app).put(`/api/questions/${q.id}`).set(auth()).send({ rubric: [{ point: 'x', marks: 1 }], approved: true }).expect(400);
    const approved = await request(app).post(`/api/assignments/${assignmentId}/answer-key/approve`).set(auth()).expect(200);
    expect(approved.body).toMatchObject({ status: 'KEY_READY', keyApproved: true, totalMarks: 10 });
  });

  it('previews the source and evaluates every submission', async () => {
    const pv = await request(app)
      .post(`/api/assignments/${assignmentId}/source/preview`)
      .set(auth())
      .send({ type: 'DRIVE_FOLDER', url: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv' })
      .expect(200);
    expect(pv.body).toMatchObject({ found: 4, matched: 3, rosterSize: 5 });
    const ev = await request(app).post(`/api/assignments/${assignmentId}/evaluate`).set(auth()).expect(200);
    expect(ev.body).toMatchObject({ found: 4, queued: 4 });
    let progress: { body: { status: string } } = { body: { status: '' } };
    for (let i = 0; i < 60; i++) {
      progress = await request(app).get(`/api/assignments/${assignmentId}/progress`).set(auth()).expect(200);
      if (progress.body.status === 'REVIEW') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(progress.body.status).toBe('REVIEW');
  });

  it('shows results with duplicate detection, late flags and the missing student', async () => {
    const r = await request(app).get(`/api/assignments/${assignmentId}/results`).set(auth()).expect(200);
    const byRoll = Object.fromEntries(r.body.rows.map((x: { rollNo: string }) => [x.rollNo, x]));
    expect(byRoll.MCA23004.studentId).toBeTruthy(); // matched from the roll number written on the page
    expect(byRoll.MCA23005.status).toBe('MISSING');
    expect(byRoll.MCA23001.reviewStatus).toBe('SUSPICIOUS');
    expect(byRoll.MCA23003.reviewStatus).toBe('SUSPICIOUS');
    expect(byRoll.MCA23003.isLate).toBe(true); // uploaded after the due date
    expect(byRoll.MCA23002.reviewStatus).toBe('PENDING');
    expect(byRoll.MCA23002.total).toBe(8);
    expect(r.body.counts).toMatchObject({ missing: 1, suspicious: 2 });
    expect(r.body.flags).toHaveLength(1);
    const flagId = r.body.flags[0].id;

    const flag = await request(app).get(`/api/flags/${flagId}`).set(auth()).expect(200);
    expect(flag.body.a.rollNo).toBe('MCA23001'); // earlier upload is the original
    expect(flag.body.b.rollNo).toBe('MCA23003');
    await request(app).post(`/api/flags/${flagId}/confirm`).set(auth()).send({ target: 'B' }).expect(200);

    const after = await request(app).get(`/api/assignments/${assignmentId}/results`).set(auth()).expect(200);
    const rows = Object.fromEntries(after.body.rows.map((x: { rollNo: string }) => [x.rollNo, x]));
    expect(rows.MCA23003).toMatchObject({ reviewStatus: 'COPIED', total: 0 });
    expect(rows.MCA23001.reviewStatus).toBe('PENDING');
  });

  it('lets the teacher edit marks, approve and export', async () => {
    const r = await request(app).get(`/api/assignments/${assignmentId}/results`).set(auth()).expect(200);
    const priya = r.body.rows.find((x: { rollNo: string }) => x.rollNo === 'MCA23002');
    const detail = await request(app).get(`/api/submissions/${priya.submissionId}`).set(auth()).expect(200);
    expect(detail.body.questions).toHaveLength(2);
    await request(app)
      .put(`/api/submissions/${priya.submissionId}`)
      .set(auth())
      .send({ scores: [{ questionId: detail.body.questions[0].id, marks: 9 }] })
      .expect(400);
    await request(app)
      .put(`/api/submissions/${priya.submissionId}`)
      .set(auth())
      .send({ scores: [{ questionId: detail.body.questions[0].id, marks: 5 }], remark: 'Well done', reviewStatus: 'APPROVED' })
      .expect(200);
    const pageImg = await request(app).get(`/api/submissions/${priya.submissionId}/pages/0`).set(auth()).expect(200);
    expect(pageImg.headers['content-type']).toBe('image/jpeg');

    const all = await request(app).post(`/api/assignments/${assignmentId}/approve-all`).set(auth()).expect(200);
    expect(all.body.approved).toBeGreaterThanOrEqual(1);

    const report = await request(app).get(`/api/assignments/${assignmentId}/report`).set(auth()).expect(200);
    expect(report.body).toMatchObject({ totalMarks: 10, rosterSize: 5, submitted: 4 });
    expect(report.body.missing).toEqual([{ name: 'Kunal Rana', rollNo: 'MCA23005' }]);

    const xlsx = await request(app).get(`/api/assignments/${assignmentId}/export?format=xlsx&feedback=1&fraud=1`).set(auth()).buffer(true).expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const pdf = await request(app).get(`/api/assignments/${assignmentId}/export?format=pdf`).set(auth()).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const gs = await request(app).post(`/api/assignments/${assignmentId}/export/google-sheet`).set(auth()).send({ feedback: true }).expect(200);
    expect(gs.body.url).toContain('docs.google.com');
  });

  it('serves dashboard, stats, search and notifications', async () => {
    const d = await request(app).get('/api/dashboard').set(auth()).expect(200);
    expect(d.body.stats).toMatchObject({ assignmentsChecked: 1, studentsEvaluated: 4 });
    const s = await request(app).get('/api/me/stats').set(auth()).expect(200);
    expect(s.body.history).toHaveLength(1);
    const q = await request(app).get('/api/search?q=priya').set(auth()).expect(200);
    expect(q.body.students[0].rollNo).toBe('MCA23002');
    const n = await request(app).get('/api/notifications').set(auth()).expect(200);
    expect(n.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('isolates teachers from each other', async () => {
    const other = await request(app).post('/api/auth/dev-login').send({ email: 'other@example.edu', name: 'Other' }).expect(200);
    await request(app).get(`/api/assignments/${assignmentId}`).set({ Authorization: `Bearer ${other.body.token}` }).expect(404);
    await request(app).get(`/api/classes/${classId}`).set({ Authorization: `Bearer ${other.body.token}` }).expect(404);
  });

  it('deletes the account and all data', async () => {
    await request(app).delete('/api/me').set(auth()).send({ confirm: 'DELETE' }).expect(200);
    await request(app).get('/api/me').set(auth()).expect(401);
  });
});
