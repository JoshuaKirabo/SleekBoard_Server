-- CreateEnum
CREATE TYPE "lane" AS ENUM ('saved', 'applied', 'interviewing', 'offer', 'rejected', 'ghosted');

-- CreateEnum
CREATE TYPE "move_source" AS ENUM ('board', 'email');

-- CreateEnum
CREATE TYPE "contact_kind" AS ENUM ('hiring_manager', 'recruiter', 'alumni', 'peer', 'interviewer', 'internal_referral', 'other');

-- CreateEnum
CREATE TYPE "contact_source" AS ENUM ('run', 'linkedin');

-- CreateEnum
CREATE TYPE "run_kind" AS ENUM ('contact', 'note', 'fill', 'email');

-- CreateEnum
CREATE TYPE "run_status" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "step_type" AS ENUM ('message', 'tool', 'error');

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "company" VARCHAR(120) NOT NULL,
    "role" VARCHAR(200) NOT NULL,
    "location" VARCHAR(120) NOT NULL DEFAULT '',
    "status" "lane" NOT NULL DEFAULT 'saved',
    "applied" VARCHAR(10) NOT NULL DEFAULT '',
    "deadline" VARCHAR(10) NOT NULL DEFAULT '',
    "link" VARCHAR(2000) NOT NULL DEFAULT '',
    "contact" VARCHAR(120) NOT NULL DEFAULT '',
    "email" VARCHAR(200) NOT NULL DEFAULT '',
    "notes" VARCHAR(5000) NOT NULL DEFAULT '',
    "logo" VARCHAR(200000) NOT NULL DEFAULT '',
    "reply_at" TIMESTAMP(3),
    "reply_snippet" VARCHAR(200) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_moves" (
    "id" SERIAL NOT NULL,
    "job_id" TEXT NOT NULL,
    "from" "lane",
    "to" "lane",
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "move_source" NOT NULL,

    CONSTRAINT "job_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reply_suggestions" (
    "job_id" TEXT NOT NULL,
    "to" "lane" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reply_suggestions_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "company" VARCHAR(120) NOT NULL,
    "company_key" TEXT NOT NULL,
    "company_words" TEXT[],
    "type" "contact_kind" NOT NULL DEFAULT 'other',
    "title" VARCHAR(200) NOT NULL DEFAULT '',
    "location" VARCHAR(200) NOT NULL DEFAULT '',
    "email" VARCHAR(200) NOT NULL DEFAULT '',
    "link" VARCHAR(2000) NOT NULL DEFAULT '',
    "quote" VARCHAR(300) NOT NULL DEFAULT '',
    "reason" VARCHAR(300) NOT NULL DEFAULT '',
    "source" "contact_source" NOT NULL DEFAULT 'run',
    "connected_on" VARCHAR(10) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_jobs" (
    "contact_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,

    CONSTRAINT "contact_jobs_pkey" PRIMARY KEY ("contact_id","job_id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "company" VARCHAR(200) NOT NULL,
    "title" VARCHAR(300) NOT NULL DEFAULT '',
    "linkedin" VARCHAR(2000) NOT NULL DEFAULT '',
    "email" VARCHAR(200) NOT NULL DEFAULT '',
    "connected_on" VARCHAR(10) NOT NULL DEFAULT '',
    "tokens_all" TEXT[],
    "tokens_distinctive" TEXT[],
    "tokens_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "job_id" TEXT,
    "kind" "run_kind" NOT NULL,
    "status" "run_status" NOT NULL DEFAULT 'queued',
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "budget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "input_contact_id" TEXT,
    "input_link" VARCHAR(2000),
    "result" JSONB,
    "error" TEXT NOT NULL DEFAULT '',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_steps" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "type" "step_type" NOT NULL,
    "text" VARCHAR(1000) NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_usage" (
    "id" SERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "tool" TEXT NOT NULL DEFAULT '',
    "input" INTEGER NOT NULL DEFAULT 0,
    "output" INTEGER NOT NULL DEFAULT 0,
    "cost" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "run_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailboxes" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "processed" TEXT[],
    "caught_up" BOOLEAN NOT NULL DEFAULT false,
    "checked_at" TIMESTAMP(3),
    "login" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "connected_at" TIMESTAMP(3),
    "expired" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_resting" (
    "mailbox_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailbox_resting_pkey" PRIMARY KEY ("mailbox_id","message_id")
);

-- CreateIndex
CREATE INDEX "job_moves_job_id_id_idx" ON "job_moves"("job_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_key_key" ON "contacts"("key");

-- CreateIndex
CREATE INDEX "contacts_company_key_idx" ON "contacts"("company_key");

-- CreateIndex
CREATE INDEX "contacts_company_words_idx" ON "contacts" USING GIN ("company_words");

-- CreateIndex
CREATE INDEX "contact_jobs_job_id_idx" ON "contact_jobs"("job_id");

-- CreateIndex
CREATE INDEX "connections_tokens_key_idx" ON "connections"("tokens_key");

-- CreateIndex
CREATE INDEX "connections_tokens_distinctive_idx" ON "connections" USING GIN ("tokens_distinctive");

-- CreateIndex
CREATE INDEX "runs_job_id_idx" ON "runs"("job_id");

-- CreateIndex
CREATE INDEX "runs_status_idx" ON "runs"("status");

-- CreateIndex
CREATE INDEX "runs_created_at_idx" ON "runs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "run_steps_run_id_id_idx" ON "run_steps"("run_id", "id");

-- CreateIndex
CREATE INDEX "run_usage_run_id_id_idx" ON "run_usage"("run_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_key_key" ON "mailboxes"("key");

-- AddForeignKey
ALTER TABLE "job_moves" ADD CONSTRAINT "job_moves_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reply_suggestions" ADD CONSTRAINT "reply_suggestions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_jobs" ADD CONSTRAINT "contact_jobs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_jobs" ADD CONSTRAINT "contact_jobs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_input_contact_id_fkey" FOREIGN KEY ("input_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_usage" ADD CONSTRAINT "run_usage_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_resting" ADD CONSTRAINT "mailbox_resting_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
