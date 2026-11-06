-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false;

-- Everyone here came in before sign-up existed, when only the owner could get in, so their emails count as confirmed.
UPDATE "users" SET "email_verified" = true;
