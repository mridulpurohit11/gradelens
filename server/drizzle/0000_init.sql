CREATE TABLE "assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"title" text NOT NULL,
	"due_date" timestamp with time zone,
	"strictness" text DEFAULT 'STANDARD' NOT NULL,
	"fraud_detection" boolean DEFAULT true NOT NULL,
	"handwriting_check" boolean DEFAULT true NOT NULL,
	"source_type" text,
	"source_url" text,
	"source_id" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"evaluation_started_at" timestamp with time zone,
	"evaluation_finished_at" timestamp with time zone,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text,
	"token" text,
	"error" text,
	"used" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classes" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"course" text NOT NULL,
	"semester" text NOT NULL,
	"section" text NOT NULL,
	"subject_name" text NOT NULL,
	"subject_code" text,
	"source_type" text,
	"source_url" text,
	"source_id" text,
	"roster_sheet_url" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"submission_a_id" text NOT NULL,
	"submission_b_id" text,
	"type" text NOT NULL,
	"image_similarity" double precision,
	"text_similarity" double precision,
	"handwriting_score" double precision,
	"details" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"teacher_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_scores" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"question_id" text NOT NULL,
	"ai_marks" double precision NOT NULL,
	"marks" double precision NOT NULL,
	"attempted" boolean DEFAULT true NOT NULL,
	"feedback" text,
	"covered" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision,
	"edited" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"order" integer NOT NULL,
	"text" text NOT NULL,
	"marks" double precision NOT NULL,
	"model_answer" text,
	"rubric" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" text PRIMARY KEY NOT NULL,
	"class_id" text NOT NULL,
	"name" text NOT NULL,
	"roll_no" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"student_id" text,
	"group_key" text NOT NULL,
	"label" text NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone,
	"is_late" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"review_status" text DEFAULT 'PENDING' NOT NULL,
	"total_marks" double precision,
	"ai_total" double precision,
	"confidence" double precision,
	"legibility" text,
	"model_used" text,
	"escalated" boolean DEFAULT false NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"page_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transcript" text,
	"detected_name" text,
	"detected_roll" text,
	"overall_feedback" text,
	"ai_concerns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"teacher_remark" text,
	"handwriting_score" double precision,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"graded_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" text PRIMARY KEY NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"google_picture" text,
	"photo" "bytea",
	"photo_mime" text,
	"designation" text,
	"phone" text,
	"university" text,
	"campus" text,
	"department" text,
	"employee_id" text,
	"subjects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"profile_complete" boolean DEFAULT false NOT NULL,
	"strictness" text DEFAULT 'STANDARD' NOT NULL,
	"fraud_detection" boolean DEFAULT true NOT NULL,
	"handwriting_check" boolean DEFAULT true NOT NULL,
	"smart_escalation" boolean DEFAULT true NOT NULL,
	"theme" text DEFAULT 'SYSTEM' NOT NULL,
	"notify_eval_complete" boolean DEFAULT true NOT NULL,
	"notify_fraud" boolean DEFAULT true NOT NULL,
	"google_refresh_token_enc" text,
	"google_scopes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teachers_google_sub_unique" UNIQUE("google_sub"),
	CONSTRAINT "teachers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_submission_a_id_submissions_id_fk" FOREIGN KEY ("submission_a_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_submission_b_id_submissions_id_fk" FOREIGN KEY ("submission_b_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_scores" ADD CONSTRAINT "question_scores_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_scores" ADD CONSTRAINT "question_scores_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignments_teacher_idx" ON "assignments" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "assignments_class_idx" ON "assignments" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "classes_teacher_idx" ON "classes" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "fraud_flags_assignment_idx" ON "fraud_flags" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "notifications_teacher_idx" ON "notifications" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_scores_sub_q_uq" ON "question_scores" USING btree ("submission_id","question_id");--> statement-breakpoint
CREATE INDEX "questions_assignment_idx" ON "questions" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_class_roll_uq" ON "students" USING btree ("class_id","roll_no");--> statement-breakpoint
CREATE INDEX "students_class_idx" ON "students" USING btree ("class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_assignment_group_uq" ON "submissions" USING btree ("assignment_id","group_key");--> statement-breakpoint
CREATE INDEX "submissions_assignment_idx" ON "submissions" USING btree ("assignment_id");--> statement-breakpoint
CREATE INDEX "submissions_student_idx" ON "submissions" USING btree ("student_id");