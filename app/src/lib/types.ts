export type Strictness = 'LENIENT' | 'STANDARD' | 'STRICT';
export type Theme = 'LIGHT' | 'DARK' | 'SYSTEM';
export type SourceType = 'DRIVE_FOLDER' | 'GOOGLE_SHEET';
export type AssignmentStatus = 'DRAFT' | 'KEY_READY' | 'EVALUATING' | 'REVIEW' | 'COMPLETED' | 'FAILED';
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'NEEDS_REVIEW' | 'SUSPICIOUS' | 'COPIED' | 'MISSING';
export type SubStatus = 'QUEUED' | 'PROCESSING' | 'GRADED' | 'FAILED' | 'MISSING';

export type Me = {
  id: string;
  email: string;
  name: string;
  hasPhoto: boolean;
  photoVersion: number;
  googlePicture: string | null;
  designation: string | null;
  phone: string | null;
  university: string | null;
  campus: string | null;
  department: string | null;
  employeeId: string | null;
  subjects: string[];
  profileComplete: boolean;
  preferences: {
    strictness: Strictness;
    fraudDetection: boolean;
    handwritingCheck: boolean;
    smartEscalation: boolean;
    theme: Theme;
    notifyEvalComplete: boolean;
    notifyFraud: boolean;
  };
  driveAccess: boolean;
  createdAt: string;
};

export type AuthConfig = { googleConfigured: boolean; devLogin: boolean; aiConfigured: boolean; allowedDomains: string[] };

export type ClassItem = {
  id: string;
  course: string;
  semester: string;
  section: string;
  subjectName: string;
  subjectCode: string | null;
  sourceType: SourceType | null;
  sourceUrl: string | null;
  rosterSheetUrl: string | null;
  archived: boolean;
  label: string;
  studentCount: number;
  assignmentCount: number;
  createdAt: string;
  lastAssignment: {
    id: string;
    title: string;
    status: AssignmentStatus;
    dueDate: string | null;
    createdAt: string;
    finishedAt: string | null;
    needsReview: number;
  } | null;
};

export type StudentRow = {
  id: string;
  name: string;
  rollNo: string;
  email: string | null;
  submitted?: number;
  averagePercent?: number | null;
};

export type RosterStudent = { name: string; rollNo: string; email?: string | null };

export type Counts = {
  submissions: number;
  graded: number;
  queued: number;
  failed: number;
  approved: number;
  needsReview: number;
  suspicious: number;
  pending: number;
  openFlags: number;
  average: number | null;
};

export type AssignmentListItem = Counts & {
  id: string;
  title: string;
  status: AssignmentStatus;
  paused: boolean;
  dueDate: string | null;
  classId?: string;
  classLabel: string;
  subjectName: string;
  createdAt?: string;
  finishedAt: string | null;
  totalMarks?: number;
  questionCount?: number;
  rosterSize: number;
};

export type RubricPoint = { point: string; marks: number };

export type Question = {
  id: string;
  order: number;
  text: string;
  marks: number;
  modelAnswer: string | null;
  rubric: RubricPoint[];
  approved: boolean;
  aiGenerated: boolean;
};

export type Assignment = {
  id: string;
  classId: string;
  title: string;
  dueDate: string | null;
  strictness: Strictness;
  fraudDetection: boolean;
  handwritingCheck: boolean;
  sourceType: SourceType | null;
  sourceUrl: string | null;
  status: AssignmentStatus;
  paused: boolean;
  lastError: string | null;
  evaluationStartedAt: string | null;
  evaluationFinishedAt: string | null;
  costUsd: number;
  costInr: number;
  class: {
    id: string;
    label: string;
    course: string;
    semester: string;
    section: string;
    subjectName: string;
    subjectCode: string | null;
    sourceType: SourceType | null;
    sourceUrl: string | null;
  } | null;
  questions: Question[];
  totalMarks: number;
  keyApproved: boolean;
  rosterSize: number;
  counts: Counts;
  running: boolean;
};

export type ProgressItem = {
  id: string;
  name: string;
  rollNo: string | null;
  status: SubStatus;
  reviewStatus: ReviewStatus;
  total: number | null;
  confidence: number | null;
  error: string | null;
  flag: { id: string; type: string; score: number } | null;
};

export type Progress = {
  status: AssignmentStatus;
  paused: boolean;
  lastError: string | null;
  running: boolean;
  total: number;
  done: number;
  graded: number;
  failed: number;
  queued: number;
  processing: number;
  etaSeconds: number;
  costUsd: number;
  costInr: number;
  items: ProgressItem[];
};

export type ResultRow = {
  submissionId: string | null;
  studentId: string | null;
  name: string;
  rollNo: string | null;
  status: SubStatus;
  reviewStatus: ReviewStatus;
  total: number | null;
  scores: (number | null)[];
  confidence: number | null;
  isLate: boolean;
  submittedAt: string | null;
  feedback: string | null;
  remark: string | null;
  flagSummary: string | null;
  note: string | null;
  error: string | null;
  escalated: boolean;
};

export type Results = {
  assignment: { id: string; title: string; status: AssignmentStatus; dueDate: string | null; paused: boolean; costInr: number; fraudDetection: boolean };
  class: { id: string; label: string; subjectName: string };
  totalMarks: number;
  questions: { id: string; number: number; marks: number }[];
  counts: {
    total: number;
    evaluated: number;
    approved: number;
    pending: number;
    needsReview: number;
    suspicious: number;
    copied: number;
    missing: number;
    inProgress: number;
    failed: number;
    unmatched: number;
  };
  rows: ResultRow[];
  flags: { id: string; a: string; b: string | null; type: string }[];
};

export type FlagBrief = {
  id: string;
  name: string;
  rollNo: string | null;
  studentId: string | null;
  submittedAt: string | null;
  isLate: boolean;
  pageCount: number;
  reviewStatus: ReviewStatus;
  total: number | null;
  files: { name: string; mimeType: string }[];
};

export type SubmissionDetail = {
  id: string;
  assignment: { id: string; title: string; status: AssignmentStatus; dueDate: string | null };
  class: { id: string; label: string } | null;
  student: { id: string; name: string; rollNo: string } | null;
  label: string;
  name: string;
  rollNo: string | null;
  status: SubStatus;
  reviewStatus: ReviewStatus;
  totalMarks: number;
  awarded: number | null;
  aiTotal: number | null;
  confidence: number | null;
  legibility: string | null;
  modelUsed: string | null;
  escalated: boolean;
  submittedAt: string | null;
  isLate: boolean;
  pageCount: number;
  files: { name: string; mimeType: string; driveUrl: string | null }[];
  overallFeedback: string | null;
  concerns: string[];
  teacherRemark: string | null;
  handwritingScore: number | null;
  detectedName: string | null;
  detectedRoll: string | null;
  error: string | null;
  transcriptAvailable: boolean;
  questions: {
    id: string;
    number: number;
    text: string;
    maxMarks: number;
    rubric: RubricPoint[];
    marks: number | null;
    aiMarks: number | null;
    attempted: boolean | null;
    feedback: string | null;
    covered: string[];
    missing: string[];
    confidence: number | null;
    edited: boolean;
  }[];
  flags: {
    id: string;
    type: FlagType;
    status: 'OPEN' | 'CONFIRMED' | 'DISMISSED';
    details: string | null;
    imageSimilarity: number | null;
    textSimilarity: number | null;
    handwritingScore: number | null;
    other: FlagBrief | null;
  }[];
};

export type FlagType = 'DUPLICATE_IMAGE' | 'TEXT_SIMILARITY' | 'HANDWRITING_MISMATCH';

export type FlagDetail = {
  id: string;
  assignmentId: string;
  type: FlagType;
  status: 'OPEN' | 'CONFIRMED' | 'DISMISSED';
  imageSimilarity: number | null;
  textSimilarity: number | null;
  handwritingScore: number | null;
  details: string | null;
  note: string | null;
  assignment: { id: string; title: string };
  a: FlagBrief | null;
  b: FlagBrief | null;
};

export type Report = {
  assignment: { id: string; title: string; status: AssignmentStatus };
  class: { id: string; label: string };
  totalMarks: number;
  evaluated: number;
  average: number;
  highest: number | null;
  lowest: number | null;
  submissionRate: number | null;
  submitted: number;
  rosterSize: number;
  questionPerformance: { questionId: string; number: number; text: string; marks: number; average: number; percent: number }[];
  distribution: { label: string; from: number; to: number; count: number }[];
  topPerformers: { name: string; rollNo: string | null; total: number | null }[];
  missing: { name: string; rollNo: string | null }[];
  late: number;
};

export type Dashboard = {
  stats: {
    assignmentsChecked: number;
    activeAssignments: number;
    studentsEvaluated: number;
    classesEvaluated: number;
    pendingReviews: number;
    fraudFlags: number;
    duplicateFlags: number;
    handwritingFlags: number;
    classes: number;
  };
  recent: (AssignmentListItem & { rosterSize: number })[];
  totalAssignments: number;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
};

export type TeacherStats = {
  assignmentsChecked: number;
  studentsEvaluated: number;
  classesRegistered: number;
  fraudFlagged: number;
  fraudConfirmed: number;
  memberSince: string;
  totalCostUsd: number;
  history: {
    id: string;
    title: string;
    date: string;
    classLabel: string;
    course?: string;
    semester?: string;
    section?: string;
    evaluated: number;
    status: AssignmentStatus;
  }[];
};
