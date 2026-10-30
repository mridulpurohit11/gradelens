import { randomUUID } from 'node:crypto';
import {
  pgTable,
  text,
  boolean,
  timestamp,
  doublePrecision,
  integer,
  jsonb,
  customType,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());

export type FileRef = {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string | null;
  modifiedTime?: string | null;
  size?: number | null;
};

export type RubricPoint = { point: string; marks: number };

export const teachers = pgTable('teachers', {
  id: id(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  googlePicture: text('google_picture'),
  photo: bytea('photo'),
  photoMime: text('photo_mime'),
  designation: text('designation'),
  phone: text('phone'),
  university: text('university'),
  campus: text('campus'),
  department: text('department'),
  employeeId: text('employee_id'),
  subjects: jsonb('subjects').$type<string[]>().notNull().default([]),
  profileComplete: boolean('profile_complete').notNull().default(false),
  // Preferences
  strictness: text('strictness').notNull().default('STANDARD'),
  fraudDetection: boolean('fraud_detection').notNull().default(true),
  handwritingCheck: boolean('handwriting_check').notNull().default(true),
  smartEscalation: boolean('smart_escalation').notNull().default(true),
  theme: text('theme').notNull().default('SYSTEM'),
  notifyEvalComplete: boolean('notify_eval_complete').notNull().default(true),
  notifyFraud: boolean('notify_fraud').notNull().default(true),
  // Google OAuth (refresh token encrypted at rest)
  googleRefreshTokenEnc: text('google_refresh_token_enc'),
  googleScopes: text('google_scopes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authHandoffs = pgTable('auth_handoffs', {
  id: text('id').primaryKey(),
  teacherId: text('teacher_id'),
  token: text('token'),
  error: text('error'),
  used: boolean('used').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const classes = pgTable(
  'classes',
  {
    id: id(),
    teacherId: text('teacher_id')
      .notNull()
      .references(() => teachers.id, { onDelete: 'cascade' }),
    course: text('course').notNull(),
    semester: text('semester').notNull(),
    section: text('section').notNull(),
    subjectName: text('subject_name').notNull(),
    subjectCode: text('subject_code'),
    sourceType: text('source_type'), // DRIVE_FOLDER | GOOGLE_SHEET
    sourceUrl: text('source_url'),
    sourceId: text('source_id'),
    rosterSheetUrl: text('roster_sheet_url'),
    archived: boolean('archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('classes_teacher_idx').on(t.teacherId)],
);

export const students = pgTable(
  'students',
  {
    id: id(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    rollNo: text('roll_no').notNull(),
    email: text('email'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('students_class_roll_uq').on(t.classId, t.rollNo), index('students_class_idx').on(t.classId)],
);

export const assignments = pgTable(
  'assignments',
  {
    id: id(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    teacherId: text('teacher_id')
      .notNull()
      .references(() => teachers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }),
    strictness: text('strictness').notNull().default('STANDARD'),
    fraudDetection: boolean('fraud_detection').notNull().default(true),
    handwritingCheck: boolean('handwriting_check').notNull().default(true),
    sourceType: text('source_type'),
    sourceUrl: text('source_url'),
    sourceId: text('source_id'),
    // DRAFT -> KEY_READY -> EVALUATING -> REVIEW -> COMPLETED (or FAILED)
    status: text('status').notNull().default('DRAFT'),
    paused: boolean('paused').notNull().default(false),
    lastError: text('last_error'),
    evaluationStartedAt: timestamp('evaluation_started_at', { withTimezone: true }),
    evaluationFinishedAt: timestamp('evaluation_finished_at', { withTimezone: true }),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('assignments_teacher_idx').on(t.teacherId), index('assignments_class_idx').on(t.classId)],
);

export const questions = pgTable(
  'questions',
  {
    id: id(),
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    order: integer('order').notNull(),
    text: text('text').notNull(),
    marks: doublePrecision('marks').notNull(),
    modelAnswer: text('model_answer'),
    rubric: jsonb('rubric').$type<RubricPoint[]>().notNull().default([]),
    approved: boolean('approved').notNull().default(false),
    aiGenerated: boolean('ai_generated').notNull().default(false),
  },
  (t) => [index('questions_assignment_idx').on(t.assignmentId)],
);

export const submissions = pgTable(
  'submissions',
  {
    id: id(),
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    studentId: text('student_id').references(() => students.id, { onDelete: 'set null' }),
    groupKey: text('group_key').notNull(),
    label: text('label').notNull(),
    files: jsonb('files').$type<FileRef[]>().notNull().default([]),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    isLate: boolean('is_late').notNull().default(false),
    // QUEUED | PROCESSING | GRADED | FAILED
    status: text('status').notNull().default('QUEUED'),
    // PENDING | APPROVED | NEEDS_REVIEW | SUSPICIOUS | COPIED
    reviewStatus: text('review_status').notNull().default('PENDING'),
    totalMarks: doublePrecision('total_marks'),
    aiTotal: doublePrecision('ai_total'),
    confidence: doublePrecision('confidence'),
    legibility: text('legibility'),
    modelUsed: text('model_used'),
    escalated: boolean('escalated').notNull().default(false),
    pageCount: integer('page_count').notNull().default(0),
    pageHashes: jsonb('page_hashes').$type<string[]>().notNull().default([]),
    transcript: text('transcript'),
    detectedName: text('detected_name'),
    detectedRoll: text('detected_roll'),
    overallFeedback: text('overall_feedback'),
    aiConcerns: jsonb('ai_concerns').$type<string[]>().notNull().default([]),
    teacherRemark: text('teacher_remark'),
    handwritingScore: doublePrecision('handwriting_score'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('submissions_assignment_group_uq').on(t.assignmentId, t.groupKey),
    index('submissions_assignment_idx').on(t.assignmentId),
    index('submissions_student_idx').on(t.studentId),
  ],
);

export const questionScores = pgTable(
  'question_scores',
  {
    id: id(),
    submissionId: text('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    aiMarks: doublePrecision('ai_marks').notNull(),
    marks: doublePrecision('marks').notNull(),
    attempted: boolean('attempted').notNull().default(true),
    feedback: text('feedback'),
    covered: jsonb('covered').$type<string[]>().notNull().default([]),
    missing: jsonb('missing').$type<string[]>().notNull().default([]),
    confidence: doublePrecision('confidence'),
    edited: boolean('edited').notNull().default(false),
  },
  (t) => [uniqueIndex('question_scores_sub_q_uq').on(t.submissionId, t.questionId)],
);

export const fraudFlags = pgTable(
  'fraud_flags',
  {
    id: id(),
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    submissionAId: text('submission_a_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    submissionBId: text('submission_b_id').references(() => submissions.id, { onDelete: 'cascade' }),
    // DUPLICATE_IMAGE | TEXT_SIMILARITY | HANDWRITING_MISMATCH
    type: text('type').notNull(),
    imageSimilarity: doublePrecision('image_similarity'),
    textSimilarity: doublePrecision('text_similarity'),
    handwritingScore: doublePrecision('handwriting_score'),
    details: text('details'),
    // OPEN | CONFIRMED | DISMISSED
    status: text('status').notNull().default('OPEN'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('fraud_flags_assignment_idx').on(t.assignmentId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    teacherId: text('teacher_id')
      .notNull()
      .references(() => teachers.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    read: boolean('read').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_teacher_idx').on(t.teacherId)],
);

export type Teacher = typeof teachers.$inferSelect;
export type ClassRow = typeof classes.$inferSelect;
export type Student = typeof students.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type QuestionScore = typeof questionScores.$inferSelect;
export type FraudFlag = typeof fraudFlags.$inferSelect;
