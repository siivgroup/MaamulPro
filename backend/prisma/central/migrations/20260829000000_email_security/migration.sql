ALTER TABLE "email_verifications"
  ADD COLUMN IF NOT EXISTS "subject_key" TEXT,
  ADD COLUMN IF NOT EXISTS "subject_version" INTEGER;

-- Legacy challenges cannot authorize changes without a bound account/version.
UPDATE "email_verifications" SET "status" = 'EXPIRED'
WHERE "context" IN ('PASSWORD_RESET', 'EMAIL_CHANGE')
  AND "status" = 'PENDING' AND "subject_key" IS NULL;
