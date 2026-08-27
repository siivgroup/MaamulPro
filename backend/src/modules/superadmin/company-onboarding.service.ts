import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import * as argon2 from 'argon2';
import { Prisma } from '../../generated/central/client';
import { CentralPrismaService } from '../../common/database/central-prisma.service';
import { TenantConnectionManager } from '../../common/database/tenant-connection.manager';
import { NeonManagementService, NeonTenantDatabase } from '../../common/database/neon-management.service';
import { databaseIdentity, getCentralDatabaseUrls, getDatabaseConnectionPair } from '../../common/database/database-url';
import { protectDatabaseUrl, revealDatabaseUrl } from '../../common/database/database-credentials';
import { applyCompanySchema } from '../../common/database/tenant-schema-sql';
import { syncPermissionsToDb } from '../../common/database/rbac-sync';
import { seedTenantDefaults } from '../../common/database/tenant-setup';
import { assertEmptyOrOwned, withOnboardingLock } from '../../common/database/onboarding-database';
import { SetupError, setupDiagnostic, setupFailure } from '../../common/database/onboarding-errors';
import { assertStrongPassword } from '../../common/security/password-policy';
import { CreateCompanyDto } from './superadmin.dto';
import { addBillingMonths, hasSubscriptionAccess } from '../../common/subscriptions/entitlement-policy';

const normalizedInputs = (data: CreateCompanyDto) => ({
  name: data.name.trim(), subdomain: data.subdomain.trim().toLowerCase(), adminName: data.adminName.trim(), adminEmail: data.adminEmail.trim().toLowerCase(),
  companyType: data.companyType?.trim() || null, phone: data.phone?.trim() || null, address: data.address?.trim() || null,
  description: data.description?.trim() || null, logoUrl: data.logoUrl?.trim() || null,
  constructionEnabled: Boolean(data.constructionEnabled), realEstateEnabled: Boolean(data.realEstateEnabled), materialManagementEnabled: Boolean(data.materialManagementEnabled),
  subscriptionAmount: data.subscriptionAmount ?? null, subscriptionTermMonths: data.subscriptionTermMonths ?? null, autoRecur: data.autoRecur ?? false,
  manualDatabase: Boolean(data.dbUrl?.trim()),
});
const comparable = (value: object) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

@Injectable()
export class CompanyOnboardingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CompanyOnboardingService.name);
  private running = false;
  constructor(private readonly central: CentralPrismaService, private readonly tenants: TenantConnectionManager, private readonly neon: NeonManagementService) {}
  private get db(): any { return this.central; }

  async start(data: CreateCompanyDto, adminId: string) {
    const id = String(data.onboardingRequestId || '').toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new BadRequestException('A valid onboarding request ID is required.');
    const inputs = normalizedInputs(data);
    const replay = async (job: any) => {
      const owner = await this.db.companyUser.findUnique({ where: { id: job.ownerId } });
      const company = job.companyId && await this.db.company.findUnique({ where: { id: job.companyId } });
      if (!company || !owner || comparable(job.inputs) !== comparable(inputs) || !(await argon2.verify(job.passwordHash, data.adminPassword))
        || (inputs.manualDatabase && getDatabaseConnectionPair(data.dbUrl).runtimeUrl !== revealDatabaseUrl(company.dbUrl))) {
        throw new ConflictException({ code: 'ONBOARDING_REQUEST_CONFLICT', message: 'This request reference belongs to a different or removed setup. Open the saved company setup.', onboardingId: id });
      }
      return { onboardingId: id, companyId: company.id, status: job.status };
    };
    const existing = await this.db.companyOnboarding.findUnique({ where: { id } });
    if (existing) return replay(existing);
    try {
      if (!inputs.constructionEnabled && !inputs.realEstateEnabled && !inputs.materialManagementEnabled) throw new BadRequestException('Select at least one tenant module during onboarding');
      assertStrongPassword(data.adminPassword);
      if ((inputs.subscriptionAmount === null) !== (inputs.subscriptionTermMonths === null)
        || (inputs.subscriptionAmount !== null && (!Number.isFinite(inputs.subscriptionAmount) || inputs.subscriptionAmount < 0 || !Number.isInteger(inputs.subscriptionTermMonths) || inputs.subscriptionTermMonths < 1))) {
        throw new BadRequestException('Provide both a valid subscription amount and term, or leave both empty.');
      }
      const target = this.neon.prepareTenantDatabase(id, data.dbUrl);
      const identity = databaseIdentity(target.directUrl);
      if (identity === databaseIdentity(getCentralDatabaseUrls().directUrl)) throw new SetupError('DATABASE_IS_CENTRAL', 'The platform database cannot be used as a company database.');
      const protectedUrl = protectDatabaseUrl(target.runtimeUrl, true);
      const passwordHash = await argon2.hash(data.adminPassword);
      const ownerId = randomUUID();
      const company = await this.db.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('maamulpro-onboarding-reservation'))");
        const replayJob = await tx.companyOnboarding.findUnique({ where: { id } });
        if (replayJob) return { id: replayJob.companyId, replayJob };
        const registered = await tx.company.findMany({ select: { dbUrl: true } });
        if (registered.some((row: any) => databaseIdentity(revealDatabaseUrl(row.dbUrl)) === identity)) throw new SetupError('DATABASE_ALREADY_ASSIGNED', 'This database is already assigned to a company.');
        const verification = await tx.emailVerification.findUnique({ where: { email_context: { email: inputs.adminEmail, context: 'COMPANY_ONBOARDING' } } });
        if (!verification || verification.status !== 'VERIFIED' || !verification.verifiedAt || verification.expiresAt < new Date()) throw new BadRequestException('Verify the company administrator email before creating the company');
        const duplicate = await tx.centralAdmin.findFirst({ where: { email: { equals: inputs.adminEmail, mode: 'insensitive' } } });
        if (duplicate) throw new ConflictException('This administrator email is already in use.');
        const { manualDatabase, subscriptionAmount, subscriptionTermMonths, autoRecur, ...profile } = inputs;
        const modes = ['REAL_ESTATE_ONLY', 'CONSTRUCTION_ONLY', 'REAL_ESTATE_ONLY', 'HYBRID', 'MATERIAL_MANAGEMENT_ONLY', 'CONSTRUCTION_MATERIAL', 'REAL_ESTATE_MATERIAL', 'ENTERPRISE'];
        const mode = modes[Number(inputs.constructionEnabled) + 2 * Number(inputs.realEstateEnabled) + 4 * Number(inputs.materialManagementEnabled)];
        const created = await tx.company.create({ data: { ...profile, mode, dbUrl: protectedUrl, dbProvider: target.isNeon ? 'NEON' : 'POSTGRESQL', dbCreatedByMaamulPro: target.createdByMaamulPro,
          status: 'PENDING_SETUP', subscriptionStatus: 'PENDING', accessGranted: false,
          entitlements: { tenantModules: { construction: inputs.constructionEnabled, realEstate: inputs.realEstateEnabled, materials: inputs.materialManagementEnabled } } } });
        await tx.companyUser.create({ data: { id: ownerId, email: inputs.adminEmail, passwordHash, companyId: created.id, role: 'COMPANY_OWNER', isActive: false } });
        await tx.companyOnboarding.create({ data: { id, companyId: created.id, ownerId, passwordHash, adminId, verificationId: verification.id, verifiedAt: verification.verifiedAt, inputs,
          databaseIdentity: identity, databaseName: target.databaseName, projectId: target.projectId, branchId: target.branchId, databaseOwner: target.databaseOwner } });
        return created;
      }, { timeout: 15_000 });
      if (company.replayJob) return replay(company.replayJob);
      return { onboardingId: id, companyId: company.id, status: 'QUEUED' };
    } catch (error) {
      if ((error as any)?.code === 'P2002') {
        const winner = await this.db.companyOnboarding.findUnique({ where: { id } });
        if (winner) return replay(winner);
        throw new ConflictException({ code: 'COMPANY_IDENTITY_CONFLICT', message: 'The company address, owner email, or database is already reserved. Open the existing company setup.' });
      }
      if (error instanceof SetupError) {
        const response = setupFailure(error, 'VALIDATION');
        if (error.code === 'DATABASE_ALREADY_ASSIGNED') throw new ConflictException(response);
        throw new BadRequestException(response);
      }
      throw error;
    }
  }

  async status(id: string) {
    const job = await this.db.companyOnboarding.findUnique({ where: { id }, include: { company: true } });
    if (!job) throw new NotFoundException('Setup reference not found.');
    const company = job.company;
    const baseDomain = String(process.env.TENANT_BASE_DOMAIN || 'maamulpro.site').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return { onboardingId: job.id, companyId: job.companyId, status: job.status, stage: job.stage, retryCount: job.retryCount,
      error: job.status === 'SUCCEEDED' ? null : job.error, updatedAt: job.updatedAt,
      result: job.status === 'SUCCEEDED' && company ? { id: company.id, name: company.name, adminEmail: company.adminEmail, dbName: job.databaseName,
        loginUrl: `https://${company.subdomain}.${baseDomain}/sign-in`, accessGranted: hasSubscriptionAccess(company),
        modulesEnabled: [company.constructionEnabled && 'Construction', company.realEstateEnabled && 'Real estate', company.materialManagementEnabled && 'Materials'].filter(Boolean) } : null };
  }

  async retry(id: string) {
    const job = await this.db.companyOnboarding.findUnique({ where: { id } });
    if (!job?.companyId) throw new NotFoundException('Saved setup not found.');
    if (['FAILED', 'NEEDS_REVIEW'].includes(job.status)) {
      if (['DATABASE_OWNERSHIP', 'DATABASE_NOT_EMPTY', 'DATABASE_BRANCH_MISMATCH'].includes(job.error?.code)) throw new ConflictException({ ...job.error, onboardingId: id });
      await this.db.companyOnboarding.updateMany({ where: { id, status: { in: ['FAILED', 'NEEDS_REVIEW'] } }, data: { status: 'QUEUED', retryCount: 0, nextAttemptAt: new Date() } });
    }
    return this.status(id);
  }

  async assertComplete(companyId: string) {
    const job = await this.db.companyOnboarding.findUnique({ where: { companyId } });
    if (job && job.status !== 'SUCCEEDED') throw new ConflictException({ code: 'ONBOARDING_INCOMPLETE', message: 'Company setup is unfinished. Open the saved setup before changing this company.', onboardingId: job.id });
  }

  onApplicationBootstrap() { void this.processPending(); }

  @Interval(5000)
  async processPending() {
    if (this.running) return;
    this.running = true;
    try {
      await withOnboardingLock(async (guard, signal) => {
        const job = await this.db.companyOnboarding.findFirst({ where: { status: { in: ['QUEUED', 'RUNNING'] }, nextAttemptAt: { lte: new Date() }, companyId: { not: null } }, orderBy: { createdAt: 'asc' }, include: { company: true } });
        if (job) await this.run(job, guard, signal);
      });
    } catch (error) { this.logger.warn(JSON.stringify({ event: 'onboarding_worker_unavailable', ...setupDiagnostic(error) })); }
    finally { this.running = false; }
  }

  async run(job: any, guard: () => Promise<void>, signal: AbortSignal) {
    if (job.status === 'SUCCEEDED') return;
    const advance = async (stage: string, extra: object = {}) => {
      await guard();
      await this.db.companyOnboarding.update({ where: { id: job.id }, data: { stage, status: 'RUNNING', error: Prisma.DbNull, ...extra } });
      job.stage = stage;
    };
    try {
      await guard();
      if (!['DATABASE', 'READINESS', 'SCHEMA', 'PERMISSIONS', 'OWNER_DEFAULTS', 'FINALIZATION'].includes(job.stage)) throw new SetupError('SETUP_STAGE_INVALID', 'The saved setup stage needs administrator review.');
      await this.db.companyOnboarding.update({ where: { id: job.id }, data: { status: 'RUNNING', error: Prisma.DbNull } });
      const company = job.company;
      const pair = getDatabaseConnectionPair(revealDatabaseUrl(company.dbUrl));
      const target: NeonTenantDatabase = { ...pair, databaseName: job.databaseName, createdByMaamulPro: company.dbCreatedByMaamulPro, projectId: job.projectId, branchId: job.branchId, databaseOwner: job.databaseOwner };
      if (job.stage === 'DATABASE') {
        if (target.createdByMaamulPro) await this.neon.ensureDatabase(target, job.createRequestedAt, async () => {
          await guard();
          await this.db.companyOnboarding.update({ where: { id: job.id }, data: { createRequestedAt: job.createRequestedAt || new Date() } });
        }, signal);
        else await this.checkManualDatabase(pair.directUrl, job.id);
        await advance('READINESS', { databaseConfirmed: true });
      }
      if (job.stage === 'READINESS') {
        await guard();
        await this.tenants.getTenantDb(pair.runtimeUrl).$queryRaw`SELECT 1`;
        await advance('SCHEMA');
      }
      if (job.stage === 'SCHEMA') {
        await guard();
        await applyCompanySchema(pair.directUrl, job.id);
        await advance('PERMISSIONS');
      }
      const tenant = this.tenants.getTenantDb(pair.runtimeUrl);
      if (job.stage === 'PERMISSIONS') {
        await guard();
        await syncPermissionsToDb(tenant as any, guard);
        await advance('OWNER_DEFAULTS');
      }
      if (job.stage === 'OWNER_DEFAULTS') {
        await guard();
        const owner = await this.db.companyUser.findUnique({ where: { id: job.ownerId } });
        if (!owner) throw new SetupError('OWNER_MISSING', 'The reserved owner account is missing.');
        await tenant.$transaction(async (tx: any) => {
          await tx.user.upsert({ where: { id: owner.id }, update: {}, create: { id: owner.id, email: owner.email, name: company.adminName, passwordHash: owner.passwordHash, role: 'COMPANY_OWNER' } });
          await seedTenantDefaults(tx, company, owner.id, guard);
        }, { timeout: 60_000 });
        await advance('FINALIZATION');
      }
      if (job.stage === 'FINALIZATION') {
        await guard();
        await this.finalize(job);
      }
      this.logger.log(JSON.stringify({ event: 'onboarding_succeeded', onboardingId: job.id, companyId: job.companyId }));
    } catch (error) {
      if (signal.aborted) throw error;
      const saved = await this.db.companyOnboarding.findUnique({ where: { id: job.id } });
      if (saved?.status === 'SUCCEEDED') return;
      const failure = { ...setupFailure(error, job.stage), onboardingId: job.id };
      this.logger.error(JSON.stringify({ event: 'onboarding_failed', ...failure, diagnostic: setupDiagnostic(error) }));
      await guard();
      const retryCount = job.retryCount + 1;
      await this.db.companyOnboarding.updateMany({ where: { id: job.id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { error: failure, retryCount,
        status: !failure.retryable ? 'NEEDS_REVIEW' : retryCount >= 3 ? 'FAILED' : 'QUEUED',
        nextAttemptAt: new Date(Date.now() + [5000, 15000, 60000][Math.min(retryCount - 1, 2)]) } });
    }
  }

  private async checkManualDatabase(url: string, id: string) {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
    try { await client.connect(); await client.query('BEGIN READ ONLY'); await assertEmptyOrOwned(client, id); }
    finally { await client.end(); }
  }

  async finalize(job: any) {
    await this.db.$transaction(async (tx: any) => {
      // This row lock also makes commit-response loss safe to replay.
      await tx.$queryRawUnsafe('SELECT id FROM company_onboarding WHERE id=$1 FOR UPDATE', job.id);
      const current = await tx.companyOnboarding.findUnique({ where: { id: job.id } });
      if (current.status === 'SUCCEEDED') return;
      if (current.stage !== 'FINALIZATION') throw new SetupError('SETUP_STAGE_CHANGED', 'Setup state changed. Review the saved setup.');
      const input = job.inputs;
      if (input.subscriptionAmount !== null && input.subscriptionTermMonths !== null) {
        const startAt = new Date();
        const expiresAt = addBillingMonths(startAt, input.subscriptionTermMonths);
        await tx.company.update({ where: { id: job.companyId }, data: { status: 'ACTIVE', subscriptionStatus: 'ACTIVE', accessGranted: true,
          subscriptionAmount: input.subscriptionAmount, termDurationMonths: input.subscriptionTermMonths, subscriptionStartAt: startAt, subscriptionExpiresAt: expiresAt, autoRecur: input.autoRecur, version: { increment: 1 } } });
        await tx.invoice.create({ data: { invoiceNumber: `SETUP-${job.id}`, companyId: job.companyId, amount: input.subscriptionAmount, kind: 'INITIAL', status: 'PAID', dueDate: startAt, expiresAt, periodStart: startAt, periodEnd: expiresAt, paidAt: startAt, paymentMethod: 'MANUAL_PLATFORM_APPROVAL', notes: 'Initial subscription configured during company onboarding' } });
        await tx.subscriptionTransaction.create({ data: { companyId: job.companyId, transactionType: 'APPROVAL', amount: input.subscriptionAmount, termDurationMonths: input.subscriptionTermMonths, previousStatus: 'PENDING', newStatus: 'ACTIVE', startAt, expiresAt, approvedBy: job.adminId } });
      }
      await tx.companyUser.update({ where: { id: job.ownerId }, data: { isActive: true } });
      await tx.emailVerification.updateMany({ where: { id: job.verificationId, verifiedAt: job.verifiedAt, status: 'VERIFIED' }, data: { status: 'EXPIRED' } });
      await tx.companyOnboarding.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', error: Prisma.DbNull } });
    }, { timeout: 15_000 });
  }
}
