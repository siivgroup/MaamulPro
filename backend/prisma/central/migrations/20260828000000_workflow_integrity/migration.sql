ALTER TABLE "company_users" ADD COLUMN "identity_sync_pending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "company_users" ADD COLUMN "identity_sync_after" TIMESTAMP(3);
CREATE INDEX "company_users_identity_sync_pending_identity_sync_after_idx" ON "company_users"("identity_sync_pending", "identity_sync_after");
ALTER TABLE "subscription_transactions" ADD COLUMN "request_id" TEXT;
ALTER TABLE "subscription_transactions" ADD COLUMN "request_hash" TEXT;
CREATE UNIQUE INDEX "subscription_transactions_request_id_key" ON "subscription_transactions"("request_id");
