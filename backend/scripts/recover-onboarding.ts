import 'dotenv/config';
import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { Prisma } from '../src/generated/central/client';
import { CentralPrismaService } from '../src/common/database/central-prisma.service';
import { NeonManagementService } from '../src/common/database/neon-management.service';
import { databaseIdentity, getCentralDatabaseUrls, getDatabaseConnectionPair, withDatabaseName } from '../src/common/database/database-url';
import { protectDatabaseUrl, revealDatabaseUrl } from '../src/common/database/database-credentials';
import { assertEmptyOrOwned, withOnboardingLock } from '../src/common/database/onboarding-database';
import { SetupError, setupFailure } from '../src/common/database/onboarding-errors';

const { values } = parseArgs({ options: { database: { type: 'string' }, onboarding: { type: 'string' }, 'adopt-empty': { type: 'boolean' }, 'audit-identities': { type: 'boolean' } } });

async function main() {
  const central = new CentralPrismaService();
  const db: any = central;
  try {
    if (values['audit-identities']) {
      const rows = await db.company.findMany({ select: { id: true, dbUrl: true } });
      const identities = new Map<string, string[]>();
      for (const row of rows) {
        const identity = databaseIdentity(revealDatabaseUrl(row.dbUrl));
        identities.set(identity, [...(identities.get(identity) || []), row.id]);
      }
      const duplicates = [...identities].filter(([, ids]) => ids.length > 1).map(([database, companyIds]) => ({ database, companyIds }));
      console.log(JSON.stringify({ checked: rows.length, duplicates }, null, 2));
      if (duplicates.length) process.exitCode = 1;
      return;
    }
    if (!values.database || !/^[a-z][a-z0-9_]{0,62}$/.test(values.database)) throw new SetupError('INVALID_DATABASE', 'Specify the exact safe database name with --database.');
    if (values['adopt-empty'] && !values.onboarding) throw new SetupError('ATTEMPT_REQUIRED', 'Adoption requires --onboarding and explicit --adopt-empty.');
    const neon = new NeonManagementService();
    const template = neon.prepareTenantDatabase('00000000-0000-4000-8000-000000000000');
    const pair = getDatabaseConnectionPair(withDatabaseName(template.directUrl, values.database));
    const target = { ...template, ...pair, databaseName: values.database };
    const identity = databaseIdentity(pair.directUrl);
    if (identity === databaseIdentity(getCentralDatabaseUrls().directUrl)) throw new SetupError('DATABASE_IS_CENTRAL', 'The platform database cannot be adopted.');
    const inspect = async () => {
      await neon.validateTarget(target);
      const database = await neon.inspectDatabase(target);
      if (!database) throw new SetupError('DATABASE_NOT_FOUND', 'The requested database does not exist in the configured branch.');
      const rows = await db.company.findMany({ select: { id: true, dbUrl: true } });
      const registered = rows.filter((row: any) => databaseIdentity(revealDatabaseUrl(row.dbUrl)) === identity).map((row: any) => row.id);
      const client = new Client({ connectionString: pair.directUrl, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
      let empty = false;
      try {
        await client.connect(); await client.query('BEGIN READ ONLY');
        try { await assertEmptyOrOwned(client); empty = true; }
        catch (error) { if (!(error instanceof SetupError) || error.code !== 'DATABASE_NOT_EMPTY') throw error; }
      } finally { await client.end(); }
      return { database: target.databaseName, empty, registeredCompanyIds: registered, createdAt: database.created_at, ownerMatches: database.owner_name === target.databaseOwner };
    };
    if (!values['adopt-empty']) { console.log(JSON.stringify(await inspect(), null, 2)); return; }
    const adopted = await withOnboardingLock(async guard => {
      const report = await inspect();
      if (!report.empty || report.registeredCompanyIds.length || !report.ownerMatches) throw new SetupError('ADOPTION_UNSAFE', 'Adoption refused: the database must be empty, unregistered, and owned by the configured role.');
      await guard();
      await db.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('maamulpro-onboarding-reservation'))");
        const job = await tx.companyOnboarding.findUnique({ where: { id: values.onboarding } });
        if (!job?.companyId || !['FAILED', 'NEEDS_REVIEW'].includes(job.status) || job.createRequestedAt || job.databaseConfirmed) {
          throw new SetupError('ADOPTION_UNSAFE', 'Adoption requires a paused attempt that has not requested or confirmed database creation. Existing attempt resources must not be abandoned.');
        }
        const companies = await tx.company.findMany({ select: { dbUrl: true } });
        if (companies.some((row: any) => databaseIdentity(revealDatabaseUrl(row.dbUrl)) === identity)) throw new SetupError('DATABASE_ALREADY_ASSIGNED', 'The database has been assigned to another company.');
        await tx.company.update({ where: { id: job.companyId }, data: { dbUrl: protectDatabaseUrl(pair.runtimeUrl, true), dbProvider: 'NEON', dbCreatedByMaamulPro: false } });
        await tx.companyOnboarding.update({ where: { id: job.id }, data: { databaseIdentity: identity, databaseName: target.databaseName, projectId: null, branchId: null, databaseOwner: null,
          status: 'QUEUED', stage: 'DATABASE', retryCount: 0, nextAttemptAt: new Date(), error: Prisma.DbNull } });
      }, { timeout: 15_000 });
      return true;
    });
    if (!adopted) throw new SetupError('SETUP_BUSY', 'Another setup or deletion is running. Try again later.');
    console.log('Existing empty database associated with the saved attempt. It is protected from automatic deletion.');
  } finally { await central.onModuleDestroy(); }
}

main().catch(error => { console.error('onboarding:recover failed:', setupFailure(error, 'RECOVERY')); process.exitCode = 1; });
