-- DropForeignKey
ALTER TABLE "contact_jobs" DROP CONSTRAINT "contact_jobs_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "contact_jobs" DROP CONSTRAINT "contact_jobs_job_id_fkey";

-- DropForeignKey
ALTER TABLE "runs" DROP CONSTRAINT "runs_input_contact_id_fkey";

-- DropForeignKey
ALTER TABLE "runs" DROP CONSTRAINT "runs_job_id_fkey";

-- DropIndex
DROP INDEX "connections_tokens_key_idx";

-- DropIndex
DROP INDEX "contacts_company_key_idx";

-- DropIndex
DROP INDEX "contacts_key_key";

-- DropIndex
DROP INDEX "mailboxes_key_key";

-- AlterTable
ALTER TABLE "connections" ADD COLUMN     "user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "contact_jobs" ADD COLUMN     "user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "mailboxes" ADD COLUMN     "user_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "user_id" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(320),
    "name" VARCHAR(200) NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "connections_user_id_tokens_key_idx" ON "connections"("user_id", "tokens_key");

-- CreateIndex
CREATE INDEX "contacts_user_id_company_key_idx" ON "contacts"("user_id", "company_key");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_user_id_key_key" ON "contacts"("user_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_id_user_id_key" ON "contacts"("id", "user_id");

-- CreateIndex
CREATE INDEX "jobs_user_id_idx" ON "jobs"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_id_user_id_key" ON "jobs"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_user_id_key_key" ON "mailboxes"("user_id", "key");

-- CreateIndex
CREATE INDEX "runs_user_id_created_at_idx" ON "runs"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_jobs" ADD CONSTRAINT "contact_jobs_contact_id_user_id_fkey" FOREIGN KEY ("contact_id", "user_id") REFERENCES "contacts"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_jobs" ADD CONSTRAINT "contact_jobs_job_id_user_id_fkey" FOREIGN KEY ("job_id", "user_id") REFERENCES "jobs"("id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_job_id_user_id_fkey" FOREIGN KEY ("job_id", "user_id") REFERENCES "jobs"("id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_input_contact_id_user_id_fkey" FOREIGN KEY ("input_contact_id", "user_id") REFERENCES "contacts"("id", "user_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Emails are stored lowercase, so Sam@x.com and sam@x.com can't become two accounts. Added by hand: Prisma's schema
-- can't say this, and Prisma leaves check constraints alone when it compares the schema with the database.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));
