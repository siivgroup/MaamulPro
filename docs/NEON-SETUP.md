# Neon Database Setup

This document outlines the database provisioning and setup process.

## Architecture

We use **Neon Serverless PostgreSQL** for both central configuration and tenant data isolation.
- **Central Schema**: Stores metadata about tenants, routing information, and shared settings.
- **Tenant Schema**: Distinct database logic for each tenant.

## Local Configuration

1. Create a Neon account and provision a database cluster.
2. Setup the `.env` variables according to `backend/.env.example`.
3. Use the pooled connection strings for Prisma execution.
4. Use the direct connection string for Prisma schema changes and seeding.

## Encryption
Tenant connection credentials are encrypted at rest inside the central database. Configure `TENANT_DATABASE_ENCRYPTION_KEY` securely in the environment and retain it for recovery.

## Commands

```bash
cd backend
pnpm run neon:setup
```

*(This file is part of the MaamulPro architecture guidelines and provides the AI with targeted context instead of forcing it to scan code for setup scripts.)*

## Saved company onboarding

Company creation now returns HTTP 202 with `onboardingId`, `companyId`, and `status`.
Clients must send a stable UUID v4 `onboardingRequestId`, then poll
`GET /api/superadmin/onboarding/:id`. `POST /api/superadmin/onboarding/:id/retry`
resumes the same saved setup. All endpoints require a platform administrator.
Resubmitting the same ID with changed inputs is a conflict, not a new setup.

The central `company_onboarding` journal is written before database creation.
New managed names are the configured prefix plus the request UUID without hyphens;
existing databases are not renamed. Passwords are hashed and connection URLs are
encrypted, including manually supplied URLs. `TENANT_DATABASE_ENCRYPTION_KEY` is
therefore required for all new onboarding.
Connection URLs must put the host, port and credentials in the URL itself. Query
overrides such as `host`, `user`, `options`, and local certificate paths are rejected
because they can bypass database identity checks. Standard Neon SSL and channel
binding query parameters remain supported.

An existing Nest scheduler processes saved jobs every five seconds and on startup.
It requires a direct central connection for its PostgreSQL session advisory lock;
never point `CENTRAL_DATABASE_DIRECT_URL` at a transaction pooler. No extra worker,
Redis server, or queue is needed. Keep at least one API instance running; jobs
remain saved while the application is stopped. Transient failures get up to three
attempts with delays; further retries use the same reference. Configuration and
ownership failures pause for review. No failure automatically deletes a database.

Stages are DATABASE, READINESS, SCHEMA, PERMISSIONS, OWNER_DEFAULTS and FINALIZATION.
The response carries a safe cause, error code and next action. Logs correlate the
same onboarding ID with driver/provider codes and safe schema identifiers, without
passwords, connection URLs, SQL values or raw driver stack traces.

`neon:check` validates encryption and the role/project/branch/endpoint relationship
using reads only. `neon:setup` still changes the central schema, encrypts legacy
URLs and seeds central data; it is not a company-recovery command. It reports the
exact failed step and stops. Repeated seeding does not reset administrator passwords.

## Inspect and recover an existing database

Run these from `backend`, using the intended environment:

```sh
npm run onboarding:recover -- --audit-identities
npm run onboarding:recover -- --database tenant_maamulpro
```

Both commands only inspect. The identity audit detects duplicate company database
assignments regardless of password, role or Neon pooler mode. Resolve duplicates
before deploying the new creation path. The journal's unique identity constraint
protects new reservations; existing company URLs are also checked under a reservation
lock before every new setup.

Only after explicit approval, an operator may associate an empty, unregistered
database with a paused attempt:

```sh
npm run onboarding:recover -- --database EXACT_DATABASE --onboarding ATTEMPT_UUID --adopt-empty
```

The command rechecks the branch, owner, emptiness and central assignments under the
worker lock. It refuses attempts that already requested or confirmed creation, so
their resources cannot be silently abandoned. Adopted databases are treated as
customer supplied and protected from automatic deletion. Populated databases require
separate investigation; this command never overwrites or deletes their contents.
`tenant_maamulpro` must not be adopted or deleted without separate approval.
