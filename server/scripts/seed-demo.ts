/**
 * Creates demo data for trying the app without Google Drive or the Claude API.
 * Usage: DEV_LOGIN=true npm run seed:demo   (then sign in with "Continue in demo mode")
 * Never run this against your production database.
 */
import { eq } from 'drizzle-orm';
import { db, pool, runMigrations, schema } from '../src/db/index.js';
import { env } from '../src/env.js';

const EMAIL = 'demo.teacher@example.edu';

const FIRST = ['Aarav', 'Priya', 'Rohit', 'Ananya', 'Kunal', 'Vikram', 'Deepa', 'Saurabh', 'Pooja', 'Arjun', 'Neha', 'Karan', 'Isha', 'Manish', 'Ritika', 'Aditya', 'Sneha', 'Rahul', 'Kavya', 'Yash', 'Simran', 'Harsh', 'Tanvi', 'Nikhil', 'Shruti', 'Gaurav', 'Meera', 'Ankit', 'Divya', 'Mohit'];
const LAST = ['Sharma', 'Negi', 'Bisht', 'Joshi', 'Rana', 'Aditya', 'Rawat', 'Negi', 'Joshi', 'Pant', 'Bhatt', 'Thapa', 'Rawat', 'Dobhal', 'Kandari', 'Semwal', 'Panwar', 'Chauhan', 'Butola', 'Uniyal'];

function roster(prefix: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
    rollNo: `${prefix}${String(i + 1).padStart(3, '0')}`,
  }));
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

async function main() {
  if (env.isProd) throw new Error('Refusing to seed demo data in production.');
  await runMigrations();
  const existing = await db.query.teachers.findFirst({ where: eq(schema.teachers.email, EMAIL) });
  if (existing) await db.delete(schema.teachers).where(eq(schema.teachers.id, existing.id));

  const [t] = await db
    .insert(schema.teachers)
    .values({
      googleSub: `dev:${EMAIL}`,
      email: EMAIL,
      name: 'Dr. Neha Rawat',
      designation: 'Assistant Professor',
      phone: '+91 98765 43210',
      university: 'Graphic Era Hill University',
      campus: 'Dehradun',
      department: 'Computer Applications',
      employeeId: 'FAC-0894',
      subjects: ['Design and Analysis of Algorithms', 'Programming in Java', 'Android Application Development'],
      profileComplete: true,
      createdAt: new Date('2026-10-01T09:00:00+05:30'),
    })
    .returning();

  const classDefs = [
    { course: 'MCA', semester: 'Semester 3', section: 'A', subjectName: 'Design and Analysis of Algorithms', subjectCode: 'TMC-301', prefix: 'MCA23', n: 45, sourceType: 'DRIVE_FOLDER' },
    { course: 'MCA', semester: 'Semester 1', section: 'B', subjectName: 'Programming in Java', subjectCode: 'TMC-102', prefix: 'MCA24', n: 52, sourceType: 'GOOGLE_SHEET' },
    { course: 'BCA', semester: 'Semester 5', section: 'A', subjectName: 'Android Application Development', subjectCode: 'TBC-504', prefix: 'BCA22', n: 48, sourceType: 'DRIVE_FOLDER' },
  ];

  const classes = [];
  for (const c of classDefs) {
    const [row] = await db
      .insert(schema.classes)
      .values({
        teacherId: t.id,
        course: c.course,
        semester: c.semester,
        section: c.section,
        subjectName: c.subjectName,
        subjectCode: c.subjectCode,
        sourceType: c.sourceType,
        sourceUrl: c.sourceType === 'DRIVE_FOLDER' ? 'https://drive.google.com/drive/folders/1DemoFolderIdForGradeLens' : 'https://docs.google.com/spreadsheets/d/1DemoSheetIdForGradeLensDemoData000/edit',
        sourceId: 'demo',
      })
      .returning();
    const studs = await db.insert(schema.students).values(roster(c.prefix, c.n).map((s) => ({ ...s, classId: row.id }))).returning();
    classes.push({ row, studs });
  }

  const QUESTIONS = [
    { text: 'Explain Merge Sort with an example.', marks: 5, rubric: [{ point: 'Correct definition & divide-and-conquer concept', marks: 1 }, { point: 'Step-by-step algorithm explanation', marks: 2 }, { point: 'Working trace with a numerical example', marks: 1 }, { point: 'Time and space complexity', marks: 1 }] },
    { text: 'Analyze the worst-case time complexity of Quick Sort with its recurrence relation.', marks: 5, rubric: [{ point: 'Worst-case partition condition', marks: 1 }, { point: 'Recurrence T(n) = T(n-1) + O(n)', marks: 2 }, { point: 'Solution of the recurrence O(n²)', marks: 1 }, { point: 'Mitigation via randomized pivot', marks: 1 }] },
    { text: 'Compare Heap Sort and Merge Sort memory requirements.', marks: 5, rubric: [{ point: 'Heap Sort is in-place O(1) extra space', marks: 2 }, { point: 'Merge Sort needs O(n) auxiliary space', marks: 2 }, { point: 'Conclusion / trade-off', marks: 1 }] },
    { text: 'Write the partition algorithm in pseudocode.', marks: 5, rubric: [{ point: 'Correct pivot selection', marks: 1 }, { point: 'Correct loop and swaps', marks: 3 }, { point: 'Returns final pivot index', marks: 1 }] },
  ];

  const now = Date.now();
  const day = 86_400_000;

  async function makeAssignment(
    cls: (typeof classes)[number],
    title: string,
    opts: { status: string; due: number; graded: number; approvedRatio: number; flags?: boolean; seed: number; finished?: number },
  ) {
    const [a] = await db
      .insert(schema.assignments)
      .values({
        classId: cls.row.id,
        teacherId: t.id,
        title,
        dueDate: new Date(now + opts.due * day),
        status: opts.status,
        sourceType: cls.row.sourceType,
        sourceUrl: cls.row.sourceUrl,
        sourceId: 'demo',
        evaluationStartedAt: opts.graded ? new Date(now - 1 * day) : null,
        evaluationFinishedAt: opts.finished !== undefined ? new Date(now + opts.finished * day) : null,
        costUsd: opts.graded * 0.0011,
        createdAt: new Date(now + (opts.due - 7) * day),
      })
      .returning();
    const qs = await db
      .insert(schema.questions)
      .values(QUESTIONS.map((q, i) => ({ assignmentId: a.id, order: i, text: q.text, marks: q.marks, rubric: q.rubric, modelAnswer: 'Model answer prepared by AI and reviewed by the teacher.', approved: true, aiGenerated: true })))
      .returning();
    const rand = rng(opts.seed);
    const subs = [];
    const submittedStudents = cls.studs.slice(0, cls.studs.length - 3);
    for (const [i, st] of submittedStudents.entries()) {
      const isGraded = i < opts.graded;
      const scores = qs.map((q) => Math.min(q.marks, Math.round((q.marks * (0.45 + rand() * 0.6)) * 2) / 2));
      const total = scores.reduce((s, x) => s + x, 0);
      const confidence = 0.6 + rand() * 0.39;
      let review = 'PENDING';
      if (isGraded) {
        if (confidence < 0.7) review = 'NEEDS_REVIEW';
        else if (i / opts.graded < opts.approvedRatio) review = 'APPROVED';
      }
      const [s] = await db
        .insert(schema.submissions)
        .values({
          assignmentId: a.id,
          studentId: st.id,
          groupKey: `student:${st.id}`,
          label: `${st.rollNo}_${st.name.replace(' ', '_')}`,
          files: [1, 2, 3].map((p) => ({ id: `demo:${st.rollNo}:${p}`, name: `${st.rollNo} ${st.name} page ${p}.jpg`, mimeType: 'image/jpeg', createdTime: new Date(now + (opts.due - 1) * day).toISOString() })),
          submittedAt: new Date(now + (opts.due - 1) * day + i * 60_000),
          isLate: i % 17 === 5,
          status: isGraded ? 'GRADED' : i === opts.graded ? 'PROCESSING' : 'QUEUED',
          reviewStatus: review,
          totalMarks: isGraded ? total : null,
          aiTotal: isGraded ? total : null,
          confidence: isGraded ? confidence : null,
          legibility: isGraded ? (confidence < 0.7 ? 'fair' : 'good') : null,
          modelUsed: isGraded ? (confidence < 0.7 ? 'claude-sonnet-5-5' : 'claude-haiku-5-5') : null,
          escalated: isGraded && confidence < 0.7,
          pageCount: 3,
          overallFeedback: isGraded ? 'Clear explanation of the core algorithms; complexity derivations need more intermediate steps.' : null,
          gradedAt: isGraded ? new Date(now - day + i * 30_000) : null,
          approvedAt: review === 'APPROVED' ? new Date() : null,
          aiConcerns: confidence < 0.7 ? ['Some handwriting on page 2 is hard to read.'] : [],
        })
        .returning();
      if (isGraded) {
        await db.insert(schema.questionScores).values(
          qs.map((q, k) => ({
            submissionId: s.id,
            questionId: q.id,
            aiMarks: scores[k],
            marks: scores[k],
            attempted: true,
            feedback:
              scores[k] >= q.marks - 0.5
                ? 'Complete and accurate answer covering every marking point.'
                : 'Core idea is correct, but some marking points are missing or incomplete.',
            covered: q.rubric.slice(0, Math.max(1, Math.round((scores[k] / q.marks) * q.rubric.length))).map((r) => r.point),
            missing: q.rubric.slice(Math.max(1, Math.round((scores[k] / q.marks) * q.rubric.length))).map((r) => r.point),
            confidence: Math.min(1, confidence + rand() * 0.05),
          })),
        );
      }
      subs.push(s);
    }
    if (opts.flags && subs.length > 6) {
      const [x, y, z] = [subs[2], subs[4], subs[3]];
      await db.insert(schema.fraudFlags).values([
        { assignmentId: a.id, submissionAId: x.id, submissionBId: y.id, type: 'DUPLICATE_IMAGE', imageSimilarity: 0.96, textSimilarity: 0.94, details: 'The same page image appears in both submissions (96% visual match).' },
        { assignmentId: a.id, submissionAId: z.id, submissionBId: subs[10].id, type: 'TEXT_SIMILARITY', imageSimilarity: 0.31, textSimilarity: 0.62, details: 'Answers are 62% similar in wording.' },
      ]);
      await db.update(schema.submissions).set({ reviewStatus: 'SUSPICIOUS' }).where(eq(schema.submissions.id, x.id));
      await db.update(schema.submissions).set({ reviewStatus: 'SUSPICIOUS' }).where(eq(schema.submissions.id, y.id));
      await db.update(schema.submissions).set({ reviewStatus: 'SUSPICIOUS' }).where(eq(schema.submissions.id, z.id));
      await db.update(schema.submissions).set({ reviewStatus: 'SUSPICIOUS' }).where(eq(schema.submissions.id, subs[10].id));
    }
    return a;
  }

  const [mca3, mca1, bca5] = classes;
  // Evaluated in the past (approved)
  await makeAssignment(bca5, 'Lab Practical 3 – Activity Lifecycle', { status: 'COMPLETED', due: -14, graded: 45, approvedRatio: 1.01, seed: 3, finished: -13 });
  // Evaluated, needs review with flags
  const a1 = await makeAssignment(mca1, 'Assignment 1 – Object Oriented Principles', { status: 'REVIEW', due: -11, graded: 49, approvedRatio: 0.6, flags: true, seed: 7, finished: -10 });
  // Fully evaluated assignment in review
  await makeAssignment(mca3, 'Assignment 1 – Asymptotic Notation', { status: 'REVIEW', due: -6, graded: 42, approvedRatio: 0.5, flags: true, seed: 11, finished: -5 });
  // Currently evaluating
  await makeAssignment(mca3, 'Assignment 2 – Sorting Algorithms', { status: 'EVALUATING', due: 1, graded: 28, approvedRatio: 0, flags: true, seed: 5 });
  // Draft awaiting key
  const [draft] = await db
    .insert(schema.assignments)
    .values({ classId: mca3.row.id, teacherId: t.id, title: 'Assignment 3 – Dynamic Programming', dueDate: new Date(now + 6 * day), status: 'DRAFT', sourceType: 'DRIVE_FOLDER', sourceUrl: mca3.row.sourceUrl, sourceId: 'demo' })
    .returning();
  await db.insert(schema.questions).values([
    { assignmentId: draft.id, order: 0, text: 'Explain the principle of optimality with an example.', marks: 5 },
    { assignmentId: draft.id, order: 1, text: 'Solve the 0/1 knapsack problem for the given instance using dynamic programming.', marks: 10 },
  ]);

  await db.insert(schema.notifications).values([
    { teacherId: t.id, type: 'FRAUD', title: 'Possible copied submissions', body: `${a1.title}: 2 integrity flag(s) need your review.`, link: `/assignments/${a1.id}/results?filter=SUSPICIOUS` },
    { teacherId: t.id, type: 'EVALUATION_COMPLETE', title: 'Evaluation completed', body: `${a1.title}: 49 submissions evaluated.`, link: `/assignments/${a1.id}/results` },
  ]);

  console.log(`Demo data created for ${EMAIL}. Sign in with "Continue in demo mode" on the login screen.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
