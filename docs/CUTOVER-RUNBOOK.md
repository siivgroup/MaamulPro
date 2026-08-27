# Staging Acceptance & Cutover Runbook

This document describes the workflow for deploying and signing off the v2 cutover from Next.js to React/Vite/NestJS.

## Prerequisites

- [ ] Next.js original application remains up as a fallback.
- [ ] Neon central database is reachable from the deployment environment.
- [ ] Vristo frontend static files build and deploy correctly to standard CDN.
- [ ] All tenant schema isolations check out with staging roles.

## Runbook Checklist

1. **Database Migration**
   - For this onboarding/integrity rollout, use
     `node scripts/apply-central-migrations.mjs --apply`; do not begin with
     `prisma db push`, which may apply unrelated schema changes.
   - Run staging seed scripts
2. **Backend Validation**
   - Ensure `test:e2e:db` passes
   - Check that `E2E_SUPER_ADMIN_EMAIL` and `E2E_SUPER_ADMIN_PASSWORD` are valid in the testing environment.
3. **Frontend Validation**
   - Execute test suites on Redux slices
   - Ensure the Vristo design system has no console errors in production build.
4. **Traffic Cutover**
   - Alter DNS/Routing from Next.js server to the new NestJS + CDN endpoints.

*(This file is part of the MaamulPro architecture guidelines and provides the AI with targeted context instead of forcing it to scan code for runbooks.)*

## Durable onboarding rollout (2026-08-27)

1. Back up the central registry and pause company creation during the coordinated rollout.
   Run `onboarding:recover -- --audit-identities` against the intended environment;
   review duplicates without automatically changing any database assignment.
2. Apply the additive `20260827000000_durable_onboarding` central migration using
   the deployment's established migration procedure. For installations originally
   created with `db push`, review/apply this migration SQL directly; do not blindly
   run historical migrations against an unbaselined database. Generate the central
   Prisma client before building the backend. There is no tenant migration required
   for existing companies; the ownership marker is created during new setup.
3. Deploy backend and frontend together. The create-company response is now 202,
   not a completed company. Old clients must not create companies during this window.
   Confirm the scheduler can use the direct central connection and the encryption
   key matches the existing deployment. Run `neon:check` before reopening creation.
4. Run contracts and builds, then `test:e2e:db`. The runner creates a disposable
   central schema and two tenant test databases. For an existing isolated test server,
   supply all three `TEST_CENTRAL_DATABASE_URL`, `TEST_TENANT_A_DATABASE_URL`,
   `TEST_TENANT_B_DATABASE_URL` and `E2E_DATABASES_ARE_DISPOSABLE=true`.
   Never use a live database: this suite writes data and creates/drops a temporary
   onboarding database. It verifies independent-process locking and one owner/invoice.
5. On staging, interrupt the API during each setup stage, lose the browser response,
   and reopen the saved reference. Confirm it resumes without a second database or
   invoice, pending companies cannot be activated early, and unrelated databases are
   rejected. Validate provider credential failures against a staging Neon branch only.
6. Monitor `onboarding_failed` and `onboarding_worker_unavailable` logs and saved
   FAILED/NEEDS_REVIEW rows. Retain the journal when cleanup fails. Do not roll back
   to the old creation code while new attempts are pending; stop new creation and
   resolve/preserve saved attempts first. Keep the additive table on rollback.

For local browser QA, `node test/onboarding-ui-preview.mjs` (from `backend`) serves
the actual progress component with a fake local API at port 5178. It exercises a
failed connection, retry, successful setup awaiting billing, and refresh without a
stored password. It does not connect to a user account or live database.

## Workflow integrity rollout

Apply these changes together with the onboarding rollout above:

1. Back up the central and tenant databases. Apply central migration
   `20260828000000_workflow_integrity` using the established migration procedure.
   It adds nullable subscription request references and pending identity markers;
   it does not modify existing passwords or invoice amounts.
   From `backend`, first inspect and then explicitly apply the two additive
   migrations with `node scripts/apply-central-migrations.mjs` and
   `node scripts/apply-central-migrations.mjs --apply`. The command uses
   `CENTRAL_DATABASE_DIRECT_URL` when provided, otherwise derives the direct
   Neon endpoint from `CENTRAL_DATABASE_URL`; it rejects pooled URLs, wraps
   each migration in a transaction, and does nothing by default.
2. Upgrade existing tenant schemas to version **28** before reopening writes.
   This adds `transactions.request_hash` and `users.identity_version`. Generate
   both Prisma clients and deploy the matching backend and frontend together.
   Cashbook creation now requires a UUID `x-idempotency-key`; subscription
   configuration requires a UUID `requestId`. Existing integrations must retain
   the same reference and inputs when retrying an uncertain response.
3. Run the Node tests, both builds and disposable PostgreSQL integration suite.
   The database suite covers real period locks, ledger rollback, concurrent
   approvals in separate processes, renewal history, and identity recovery.
   The local browser fixture at `/__financial_preview` commits the first cashbook
   write but loses its response. Refresh, choose **Resume transaction**, and save;
   `/__financial_results` must show one row and one distinct reference.
4. Identity changes revoke sessions and persist the pending marker with the
   central credential update. Tenant synchronization runs at startup and every
   five seconds; failures are retried after 30 seconds. Pending users cannot
   sign in. Inspect `company_users.identity_sync_pending` and
   `identity_sync_after` and the sanitized `IdentitySyncService` warnings if
   synchronization remains pending. Fix the connection, schema, missing user,
   email conflict or version mismatch; do not clear the marker to bypass it.
   Only password hashes are synchronized. No recovery password is stored in
   browser storage. Cashbook and subscription drafts use per-account session
   storage and are removed after confirmed success.
5. Exercise interrupted identity updates and subscription approvals on staging
   with the actual deployment roles before release. Check access resumes only
   after synchronization. Do not roll back to a backend that ignores pending
   identity markers while any are outstanding; preserve all additive fields.

Calendar billing uses UTC and clamps the source day to the destination month's
last valid day (January 31 plus one month becomes February 28 or 29). This does
not rewrite old invoice dates. Review historical cleared-but-unposted cashbook
rows and suspicious duplicate invoices separately; these fixes prevent new
occurrences but do not infer or alter historical accounting entries.
