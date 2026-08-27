import { IdentitySyncService, identityChange } from '../../common/database/identity-sync.service';
import { AccountSecurityService } from '../../common/security/account-security.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CentralPrismaService } from '../../common/database/central-prisma.service';
import { TenantConnectionManager } from '../../common/database/tenant-connection.manager';
import {
  NeonManagementService,
} from '../../common/database/neon-management.service';
import { revealDatabaseUrl } from '../../common/database/database-credentials';
import { setupFailure } from '../../common/database/onboarding-errors';
import { getDatabaseConnectionPair, isNeonDatabaseUrl } from '../../common/database/database-url';
import { applyCompanySchema } from '../../common/database/tenant-schema-sql';
import { CompanyOnboardingService } from './company-onboarding.service';
import { synchronizeTenantConfiguration } from '../../common/database/tenant-setup';
import { withOnboardingLock } from '../../common/database/onboarding-database';
import { CreateCompanyDto } from './superadmin.dto';
import * as argon2 from 'argon2';
import { SubscriptionLifecycleService } from '../../common/subscriptions/subscription-lifecycle.service';
import { SubscriptionEntitlementService } from '../../common/subscriptions/subscription-entitlement.service';
import { syncPermissionsToDb } from '../../common/database/rbac-sync';
import { createHash, randomBytes } from 'crypto';
import {
  EnterpriseModuleConfiguration,
  ENTERPRISE_CONFIG_KEY,
  parseEnterpriseModuleConfiguration,
} from '../../common/database/enterprise-config';
import { addBillingMonths, hasSubscriptionAccess } from '../../common/subscriptions/entitlement-policy';

const tenantUrl = (subdomain: string) => {
  const baseDomain = String(process.env.TENANT_BASE_DOMAIN || 'maamulpro.site')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return `https://${subdomain}.${baseDomain}`;
};

@Injectable()
export class SuperAdminService {
  private platformMetricsCache?: { expiresAt: number; value: any };
  private platformMetricsInFlight?: Promise<any>;

  constructor(
    private readonly centralPrisma: CentralPrismaService,
    private readonly tenantManager: TenantConnectionManager,
    private readonly neonManagement: NeonManagementService,
    private readonly subscriptions: SubscriptionLifecycleService,
    private readonly entitlements: SubscriptionEntitlementService,
    private readonly onboarding: CompanyOnboardingService,
    private readonly identities: IdentitySyncService,
    private readonly security: AccountSecurityService,
  ) {}

  private get central(): any {
    return this.centralPrisma as any;
  }

  async getAccount(adminId: string) {
    const account = await this.central.centralAdmin.findUnique({
      where: { id: adminId },
      select: { id: true, email: true, name: true, createdAt: true, lastLoginAt: true, passwordResetAt: true },
    });
    if (!account) throw new NotFoundException('Platform administrator not found');
    return { ...account, role: 'SUPER_ADMIN' };
  }

  async sendAccountEmailVerification(adminId: string, email: string, currentPassword: string) {
    return this.security.sendEmailChange('admin', adminId, email, currentPassword);
  }

  async updateAccountEmail(adminId: string, email: string, currentPassword: string, verificationCode: string) {
    return this.security.changeEmail('admin', adminId, email, currentPassword, verificationCode);
  }

  async updateAccountPassword(adminId: string, currentPassword: string, newPassword: string) {
    return this.security.changePassword('admin', adminId, currentPassword, newPassword);
  }

  // -----------------------------------------------------------
  // Company & Tenant Management
  // -----------------------------------------------------------

  getNeonStatus() {
    return this.neonManagement.status();
  }

  private moduleMode(modules: { construction: boolean; realEstate: boolean; materials: boolean }) {
    if (modules.construction && modules.realEstate && modules.materials) return 'ENTERPRISE';
    if (modules.construction && modules.realEstate) return 'HYBRID';
    if (modules.construction && modules.materials) return 'CONSTRUCTION_MATERIAL';
    if (modules.realEstate && modules.materials) return 'REAL_ESTATE_MATERIAL';
    if (modules.construction) return 'CONSTRUCTION_ONLY';
    if (modules.materials) return 'MATERIAL_MANAGEMENT_ONLY';
    return 'REAL_ESTATE_ONLY';
  }

  private synchronizeTenantConfiguration(company: any, runtimeUrl?: string) {
    return synchronizeTenantConfiguration(this.tenantManager.getTenantDb(runtimeUrl || revealDatabaseUrl(company.dbUrl)), company);
  }

  createCompany(data: CreateCompanyDto, adminId: string) {
    return this.onboarding.start(data, adminId);
  }

  getOnboarding(id: string) { return this.onboarding.status(id); }
  retryOnboarding(id: string) { return this.onboarding.retry(id); }

  async checkCompanyEmailAvailability(email: string) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new BadRequestException('Enter a valid email address');
    }
    const [company, user, admin] = await Promise.all([
      this.central.company.findFirst({ where: { adminEmail: normalized } }),
      this.central.companyUser.findFirst({ where: { email: normalized } }),
      this.central.centralAdmin.findFirst({ where: { email: normalized } }),
    ]);
    return {
      available: !company && !user && !admin,
      ...((company || user || admin) ? { error: 'This email is already associated with an existing account.' } : {}),
    };
  }

  async sendCompanyOnboardingVerification(email: string) {
    const availability = await this.checkCompanyEmailAvailability(email);
    if (!availability.available) throw new ConflictException(availability.error);
    const normalized = email.trim().toLowerCase();
    const challenge = await this.security.issue(normalized, 'COMPANY_ONBOARDING');
    return this.security.deliverCode(normalized, 'COMPANY_ONBOARDING', challenge);
  }

  async verifyCompanyOnboardingEmail(email: string, code: string) {
    return this.security.consume(email, 'COMPANY_ONBOARDING', code, undefined, async () => ({ verified: true }));
  }

  async getAllCompanies(query?: { search?: string; status?: string; page?: number; pageSize?: number }) {
    const where: any = {};
    if (query?.status) {
      where.status = query.status;
    }
    if (query?.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { subdomain: { contains: query.search, mode: 'insensitive' } },
        { adminEmail: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const paginationRequested = Boolean(query?.page || query?.pageSize);
    const page = Math.max(1, query?.page || 1);
    const pageSize = Math.min(100, Math.max(10, query?.pageSize || 20));
    const [companies, total] = await Promise.all([
      this.central.company.findMany({
      where,
      include: {
        onboarding: { select: { id: true, status: true, stage: true } },
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        invoices: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'desc' },
      ...(paginationRequested ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
      }),
      this.central.company.count({ where }),
    ]);
    const data = companies.map((company: any) => this.sanitizeCompany(company));
    return paginationRequested ? { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } } : data;
  }

  async getCompanyById(id: string) {
    const company = await this.central.company.findUnique({
      where: { id },
      include: {
        onboarding: { select: { id: true, status: true, stage: true } },
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
        },
        invoices: {
          orderBy: { createdAt: 'desc' },
        },
        subscriptionTransactions: {
          orderBy: { createdAt: 'desc' },
        },
        users: true,
      },
    });

    if (!company) {
      throw new NotFoundException(`Company with ID '${id}' not found`);
    }

    return this.sanitizeCompany(company);
  }

  private sanitizeCompany(company: any) {
    const { dbUrl, users, ...safeCompany } = company;
    let provider = company.dbProvider ? String(company.dbProvider).toUpperCase() : 'POSTGRESQL';
    if (!company.dbProvider && dbUrl) {
      try {
        provider = isNeonDatabaseUrl(revealDatabaseUrl(dbUrl)) ? 'NEON' : 'POSTGRESQL';
      } catch {
        provider = String(process.env.DATABASE_PROVIDER || '').toUpperCase() || 'POSTGRESQL';
      }
    }
    const safeUsers = Array.isArray(users)
      ? users.map(({ passwordHash, resetTokenHash, resetTokenExpiresAt, ...user }: any) => user)
      : undefined;
    return {
      ...safeCompany,
      ...(Array.isArray(safeCompany.subscriptions)
        ? {
            currentSubscription: safeCompany.subscriptions.find(
              (row: any) => ['ACTIVE', 'SUSPENDED'].includes(row.status),
            ) || safeCompany.subscriptions.find((row: any) => row.status === 'PENDING')
              || safeCompany.subscriptions[0]
              || null,
          }
        : {}),
      ...(safeUsers ? { users: safeUsers } : {}),
      database: {
        configured: Boolean(dbUrl),
        provider,
        runtimeConnection: provider === 'NEON' ? 'POOLED' : 'DIRECT',
      },
    };
  }

  async updateCompanyStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_SETUP') {
    await this.onboarding.assertComplete(id);
    const current = await this.central.company.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Company with ID '${id}' not found`);
    if (status === 'ACTIVE') {
      try {
        const tenantDb = this.tenantManager.getTenantDb(revealDatabaseUrl(current.dbUrl));
        const [owner, companyNameConfig] = await Promise.all([
          tenantDb.user.findFirst({ where: { email: current.adminEmail.toLowerCase(), deletedAt: null } }),
          tenantDb.systemConfig.findUnique({ where: { key: 'company_name' } }),
        ]);
        if (!owner || !companyNameConfig) throw new Error('Tenant setup is incomplete');
      } catch {
        throw new BadRequestException('Company setup is incomplete. Tenant schema, owner or configuration records are not ready.');
      }
    }

    const company = await this.central.company.update({
      where: { id },
      data: {
        status,
        version: { increment: 1 },
      },
    });
    return this.sanitizeCompany(company);
  }

  async updateCompanyModules(
    id: string,
    modules: { constructionEnabled?: boolean; realEstateEnabled?: boolean; materialManagementEnabled?: boolean },
  ) {
    await this.onboarding.assertComplete(id);
    const current = await this.central.company.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Company with ID '${id}' not found`);
    if (current.status !== 'ACTIVE') {
      throw new BadRequestException('Activate the company before changing its modules');
    }
    const configured = {
      construction: modules.constructionEnabled ?? this.entitlements.tenantModulesFromCompany(current).construction,
      realEstate: modules.realEstateEnabled ?? this.entitlements.tenantModulesFromCompany(current).realEstate,
      materials: modules.materialManagementEnabled ?? this.entitlements.tenantModulesFromCompany(current).materials,
    };
    if (!configured.construction && !configured.realEstate && !configured.materials) {
      throw new BadRequestException('At least one tenant module must remain enabled');
    }
    const entitlementData = {
      entitlements: { ...(current.entitlements as any), tenantModules: configured },
      constructionEnabled: configured.construction,
      realEstateEnabled: configured.realEstate,
      materialManagementEnabled: configured.materials,
    };
    const company = await this.central.company.update({
      where: { id },
      data: {
        ...entitlementData,
        mode: this.moduleMode(configured),
        version: { increment: 1 },
      },
    });
    await this.synchronizeTenantConfiguration(company).catch(() => undefined);
    return this.sanitizeCompany(company);
  }

  async syncCompanyRbac(id: string) {
    await this.onboarding.assertComplete(id);
    const company = await this.central.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException(`Company with ID '${id}' not found`);
    const tenantDb = this.tenantManager.getTenantDb(revealDatabaseUrl(company.dbUrl));
    return syncPermissionsToDb(tenantDb as any);
  }

  async generateCompanyOwnerTemporaryPassword(id: string) {
    await this.onboarding.assertComplete(id);
    const company = await this.central.company.findUnique({
      where: { id },
      include: { users: { where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } } },
    });
    if (!company) throw new NotFoundException(`Company with ID '${id}' not found`);
    const owner = company.users.find((user: any) => user.email.toLowerCase() === company.adminEmail.toLowerCase())
      || company.users.find((user: any) => ['COMPANY_OWNER', 'SUPER_ADMIN'].includes(user.role))
      || company.users[0];
    if (!owner) throw new NotFoundException('Company owner account was not found');
    const temporaryPassword = `${randomBytes(6).toString('base64url')}A9!`;
    const passwordHash = await argon2.hash(temporaryPassword);
    const passwordResetAt = new Date();
    await this.central.companyUser.update({
      where: { id: owner.id },
      data: {
        ...identityChange(),
        passwordHash,
        passwordResetAt,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
        resetRequestedAt: null,
      },
    });
    const syncPending = await this.identities.sync(owner.id);
    await this.security.notifyChange({ ...owner, company }, 'password', true);
    return { password: temporaryPassword, adminEmail: owner.email, passwordResetAt, syncPending };
  }

  async createCompanyImpersonation(id: string, adminId: string) {
    await this.onboarding.assertComplete(id);
    const company = await this.central.company.findUnique({
      where: { id },
      include: { users: { where: { isActive: true, deletedAt: null }, orderBy: { createdAt: 'asc' } } },
    });
    if (!company) throw new NotFoundException(`Company with ID '${id}' not found`);
    const owner = company.users.find((user: any) => user.email.toLowerCase() === company.adminEmail.toLowerCase())
      || company.users.find((user: any) => user.role === 'COMPANY_OWNER')
      || company.users[0];
    if (!owner) throw new NotFoundException('Company owner account was not found');

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 60_000);
    try {
      await this.central.$transaction(async (tx: any) => {
        await tx.impersonationGrant.deleteMany({ where: { expiresAt: { lt: new Date() } } });
        await tx.impersonationGrant.create({
          data: { tokenHash, adminId, companyId: company.id, userId: owner.id, expiresAt },
        });
      });
    } catch (error: any) {
      if (error?.code === 'P2021' || /impersonation.?grant/i.test(String(error?.message || ''))) {
        throw new ServiceUnavailableException('Impersonation storage is not initialized. Apply the central database migration and retry.');
      }
      throw error;
    }
    return { token, expiresAt, subdomain: company.subdomain };
  }

  async getCompanyEnterpriseConfiguration(id: string) {
    await this.onboarding.assertComplete(id);
    const company = await this.central.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException(`Company with ID '${id}' not found`);
    const tenantDb = this.tenantManager.getTenantDb(revealDatabaseUrl(company.dbUrl));
    const record = await tenantDb.systemConfig.findUnique({ where: { key: ENTERPRISE_CONFIG_KEY } });
    return parseEnterpriseModuleConfiguration(record?.value);
  }

  async updateCompanyEnterpriseConfiguration(id: string, configuration: EnterpriseModuleConfiguration) {
    await this.onboarding.assertComplete(id);
    const company = await this.central.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException(`Company with ID '${id}' not found`);
    if (!configuration || typeof configuration !== 'object') {
      throw new BadRequestException('Enterprise configuration is required');
    }
    const normalized = parseEnterpriseModuleConfiguration(JSON.stringify(configuration));
    normalized.workspaceControls.construction = Boolean(company.constructionEnabled)
      && normalized.workspaceControls.construction !== false;
    normalized.workspaceControls.real_estate = Boolean(company.realEstateEnabled)
      && normalized.workspaceControls.real_estate !== false;
    normalized.workspaceControls.material_management = Boolean(company.materialManagementEnabled)
      && normalized.workspaceControls.material_management !== false;
    const tenantDb = this.tenantManager.getTenantDb(revealDatabaseUrl(company.dbUrl));
    await tenantDb.systemConfig.upsert({
      where: { key: ENTERPRISE_CONFIG_KEY },
      update: { value: JSON.stringify(normalized) },
      create: { key: ENTERPRISE_CONFIG_KEY, value: JSON.stringify(normalized) },
    });
    const synchronization = await syncPermissionsToDb(tenantDb as any);
    return { configuration: normalized, synchronization };
  }

  // -----------------------------------------------------------
  // Tenant Subscriptions & Invoicing
  // -----------------------------------------------------------

  markInvoicePaid(invoiceId: string, paymentMethod = 'MANUAL_BANK_TRANSFER', adminId?: string) {
    return this.subscriptions.markInvoicePaid(invoiceId, paymentMethod, adminId);
  }

  extendInvoiceDueDate(invoiceId: string, extendDays = 7, newDueDate?: string) {
    return this.subscriptions.extendInvoiceDueDate(invoiceId, extendDays, newDueDate);
  }


  async configureCompanySubscription(
    companyId: string,
    data: { requestId: string; amount: number; termDurationMonths: number; autoRecur?: boolean; notes?: string },
    adminId?: string,
  ) {
    await this.onboarding.assertComplete(companyId);
    const amount = Number(data.amount), termDurationMonths = Number(data.termDurationMonths);
    if (!data.requestId || !Number.isFinite(amount) || amount < 0 || !Number.isInteger(termDurationMonths) || termDurationMonths < 1) {
      throw new BadRequestException('A request reference, valid amount, and whole billing term are required');
    }
    const requestHash = createHash('sha256').update(JSON.stringify({ companyId, amount, termDurationMonths,
      autoRecur: data.autoRecur ?? false, notes: data.notes || null })).digest('hex');
    await this.central.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', companyId);
      const replay = await tx.subscriptionTransaction.findUnique({ where: { requestId: data.requestId } });
      if (replay) {
        if (replay.requestHash !== requestHash) throw new ConflictException({ code: 'SUBMISSION_CONFLICT', message: 'This subscription request was already used with different details' });
        return;
      }
      const company = await tx.company.findUnique({ where: { id: companyId } });
      if (!company) throw new NotFoundException('Company not found');
      const active = hasSubscriptionAccess(company);
      if (!active && !['PENDING', 'EXPIRED', 'CANCELLED'].includes(company.subscriptionStatus)) {
        throw new ConflictException('Resume the suspended subscription or settle its existing invoice before configuring another term');
      }
      if (!active && await tx.invoice.findFirst({ where: { companyId, status: { in: ['UNPAID', 'OVERDUE'] } } })) {
        throw new ConflictException('Settle or cancel the outstanding invoice before approving another subscription');
      }
      const startAt = new Date(), expiresAt = addBillingMonths(startAt, termDurationMonths);
      await tx.company.update({ where: { id: companyId }, data: {
        subscriptionAmount: amount, termDurationMonths, autoRecur: data.autoRecur ?? false,
        version: { increment: 1 },
        ...(!active ? { subscriptionStatus: 'ACTIVE', subscriptionStartAt: startAt,
          subscriptionExpiresAt: expiresAt, accessGranted: true,
          ...(company.status === 'PENDING_SETUP' ? { status: 'ACTIVE' } : {}),
        } : {}),
      } });
      if (!active) await tx.invoice.create({ data: {
        invoiceNumber: 'APPROVAL-' + data.requestId, idempotencyKey: 'APPROVAL_' + data.requestId,
        companyId, amount, kind: 'INITIAL', status: 'PAID', dueDate: startAt, expiresAt,
        periodStart: startAt, periodEnd: expiresAt, paidAt: startAt, paymentMethod: 'MANUAL_PLATFORM_APPROVAL',
        notes: data.notes || 'Subscription configured by platform administration',
      } });
      await tx.subscriptionTransaction.create({ data: {
        requestId: data.requestId, requestHash, companyId, transactionType: active ? 'UPDATE' : 'APPROVAL',
        amount, termDurationMonths, previousStatus: company.subscriptionStatus,
        newStatus: active ? company.subscriptionStatus : 'ACTIVE',
        ...(!active ? { startAt, expiresAt } : {}), approvedBy: adminId, notes: data.notes,
      } });
    }).catch((error: unknown) => {
      if (error instanceof HttpException && (error.getResponse() as any)?.code !== 'SUBMISSION_CONFLICT') {
        throw new HttpException({ code: 'SUBSCRIPTION_REJECTED', message: error.message }, error.getStatus());
      }
      throw error;
    });
    return this.getCompanyById(companyId);
  }

  async createRenewalInvoice(companyId: string, adminId?: string) {
    await this.onboarding.assertComplete(companyId);
    // Route through SubscriptionLifecycleService so a renewal Invoice and the
    // TenantSubscription lifecycle record stay consistent with company state.
    return this.subscriptions.createRenewalInvoice(companyId, adminId);
  }

  async suspendSubscription(companyId: string, adminId?: string, notes?: string) {
    await this.onboarding.assertComplete(companyId);
    return this.subscriptions.suspendSubscription(companyId, adminId, notes);
  }

  async resumeSubscription(companyId: string, adminId?: string, notes?: string) {
    await this.onboarding.assertComplete(companyId);
    return this.subscriptions.resumeSubscription(companyId, adminId, notes);
  }

  async cancelSubscription(companyId: string, adminId?: string, notes?: string) {
    await this.onboarding.assertComplete(companyId);
    return this.subscriptions.cancelSubscription(companyId, adminId, notes);
  }

  async setSubscriptionAutoRenew(companyId: string, autoRenew: boolean, adminId?: string) {
    await this.onboarding.assertComplete(companyId);
    const company = await this.central.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException(`Company with ID '${companyId}' not found`);
    await this.central.$transaction(async (tx: any) => {
      await tx.company.update({
        where: { id: companyId },
        data: { autoRecur: autoRenew, version: { increment: 1 } },
      });
      await tx.tenantSubscription.updateMany({
        where: { companyId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
        data: { autoRenew, version: { increment: 1 } },
      });
      await tx.subscriptionTransaction.create({
        data: {
          companyId,
          transactionType: 'AUTO_RENEW_UPDATED',
          previousStatus: company.subscriptionStatus,
          newStatus: company.subscriptionStatus,
          approvedBy: adminId,
          notes: `Automatic renewal ${autoRenew ? 'enabled' : 'disabled'}`,
        },
      });
    });
    return { autoRenew };
  }

  cancelInvoice(invoiceId: string, adminId?: string, notes?: string) {
    return this.subscriptions.cancelInvoice(invoiceId, adminId, notes);
  }

  // -----------------------------------------------------------
  // Super Admin Financial Metrics & Analytics
  // -----------------------------------------------------------

  async getPlatformFinancialSummary() {
    if (this.platformMetricsCache && this.platformMetricsCache.expiresAt > Date.now()) {
      return this.platformMetricsCache.value;
    }
    if (this.platformMetricsInFlight) return this.platformMetricsInFlight;
    this.platformMetricsInFlight = this.calculatePlatformFinancialSummary();
    try {
      const value = await this.platformMetricsInFlight;
      this.platformMetricsCache = { value, expiresAt: Date.now() + 15_000 };
      return value;
    } finally {
      this.platformMetricsInFlight = undefined;
    }
  }

  private async calculatePlatformFinancialSummary() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const [
      totalCompanies,
      activeCompanies,
      expiredCompanies,
      trialCompanies,
      totalUsers,
      activeSubscriptions,
      monthlyRevenue,
      outstandingInvoices,
      latestRegistrations,
      recentTransactions,
      statusRows,
      growthRows,
      revenueRows,
      expiringSoon,
    ] = await Promise.all([
      this.central.company.count(),
      this.central.company.count({ where: { status: 'ACTIVE' } }),
      this.central.company.count({ where: { subscriptionStatus: 'EXPIRED' } }),
      this.central.tenantSubscription.count({
        where: { status: 'ACTIVE', plan: { priceMonthly: 0 } },
      }),
      this.central.companyUser.count({ where: { isActive: true, deletedAt: null } }),
      this.central.tenantSubscription.count({ where: { status: 'ACTIVE', expiresAt: { gt: now } } }),
      this.central.invoice.aggregate({ where: { status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amount: true } }),
      this.central.invoice.aggregate({ where: { status: { in: ['UNPAID', 'OVERDUE'] } }, _sum: { amount: true }, _count: { id: true } }),
      this.central.company.findMany({
        take: 6,
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, subdomain: true, status: true, subscriptionStatus: true, createdAt: true },
      }),
      this.central.subscriptionTransaction.findMany({
        take: 8,
        orderBy: { createdAt: 'desc' },
        include: { company: { select: { id: true, name: true, subdomain: true } } },
      }),
      this.central.company.groupBy({ by: ['subscriptionStatus'], _count: { id: true } }),
      this.central.company.findMany({ where: { createdAt: { gte: sixMonthsAgo } }, select: { createdAt: true } }),
      this.central.invoice.findMany({ where: { status: 'PAID', paidAt: { gte: sixMonthsAgo } }, select: { amount: true, paidAt: true } }),
      this.central.company.count({
        where: { subscriptionStatus: 'ACTIVE', subscriptionExpiresAt: { gte: now, lte: new Date(now.getTime() + 7 * 86400000) } },
      }),
    ]);
    const [pendingCompanies, suspendedCompanies, pendingSubscriptions, modeRows] = await Promise.all([
      this.central.company.count({ where: { status: 'PENDING_SETUP' } }),
      this.central.company.count({ where: { status: 'SUSPENDED' } }),
      this.central.company.count({ where: { subscriptionStatus: 'PENDING' } }),
      this.central.company.groupBy({ by: ['mode'], _count: { id: true } }),
    ]);

    const months = Array.from({ length: 6 }, (_, index) => new Date(now.getFullYear(), now.getMonth() - 5 + index, 1));
    const monthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;
    const growthMap = new Map<string, number>();
    const revenueMap = new Map<string, number>();
    growthRows.forEach((row: any) => {
      const key = monthKey(new Date(row.createdAt));
      growthMap.set(key, (growthMap.get(key) || 0) + 1);
    });
    revenueRows.forEach((row: any) => {
      if (!row.paidAt) return;
      const key = monthKey(new Date(row.paidAt));
      revenueMap.set(key, (revenueMap.get(key) || 0) + Number(row.amount || 0));
    });

    return {
      totalCompanies,
      activeCompanies,
      pendingCompanies,
      suspendedCompanies,
      pendingSubscriptions,
      expiredCompanies,
      trialCompanies,
      totalUsers,
      activeSubscriptions,
      monthlyRevenue: Number(monthlyRevenue._sum.amount || 0),
      outstandingInvoices: { count: outstandingInvoices._count.id, amount: Number(outstandingInvoices._sum.amount || 0) },
      latestRegistrations,
      recentTransactions,
      subscriptionStatusDistribution: statusRows.map((row: any) => ({ status: row.subscriptionStatus, count: row._count.id })),
      companyStatusDistribution: [
        { status: 'ACTIVE', count: activeCompanies },
        { status: 'PENDING_SETUP', count: pendingCompanies },
        { status: 'SUSPENDED', count: suspendedCompanies },
      ],
      moduleDistribution: modeRows.map((row: any) => ({ mode: row.mode, count: row._count.id })),
      growthTrend: months.map((month) => ({ label: month.toLocaleString('en-US', { month: 'short' }), value: growthMap.get(monthKey(month)) || 0 })),
      revenueTrend: months.map((month) => ({ label: month.toLocaleString('en-US', { month: 'short' }), value: revenueMap.get(monthKey(month)) || 0 })),
      systemHealth: { database: 'OPERATIONAL', expiringSoon },
    };
  }

  async updateCompany(id: string, data: Partial<CreateCompanyDto & { phone?: string; address?: string; description?: string; logoUrl?: string }>) {
    await this.onboarding.assertComplete(id);
    const current = await this.central.company.findUnique({ where: { id }, include: { users: { where: { role: 'COMPANY_OWNER' }, take: 1 } } });
    if (!current) throw new NotFoundException(`Company with ID '${id}' not found`);
    const moduleChangeRequested = data.constructionEnabled !== undefined
      || data.realEstateEnabled !== undefined
      || data.materialManagementEnabled !== undefined;
    if (moduleChangeRequested) {
      await this.updateCompanyModules(id, {
        constructionEnabled: data.constructionEnabled,
        realEstateEnabled: data.realEstateEnabled,
        materialManagementEnabled: data.materialManagementEnabled,
      });
      data = {
        ...data,
        constructionEnabled: undefined,
        realEstateEnabled: undefined,
        materialManagementEnabled: undefined,
      };
    }
    const adminEmail = data.adminEmail?.trim().toLowerCase();
    if (adminEmail && adminEmail !== current.adminEmail) {
      const duplicate = await this.central.company.findFirst({ where: { adminEmail, NOT: { id } } });
      if (duplicate) throw new ConflictException('The administrator email is already in use');
    }
    const subdomain = data.subdomain?.trim().toLowerCase();
    if (subdomain && subdomain !== current.subdomain) {
      if (!/^[a-z0-9-]+$/.test(subdomain) || subdomain.length < 2 || subdomain.length > 30) {
        throw new BadRequestException('Subdomain must contain 2-30 characters of lowercase letters, numbers, and hyphens');
      }
      const duplicate = await this.central.company.findFirst({ where: { subdomain, NOT: { id } } });
      if (duplicate) throw new ConflictException('Subdomain is already in use by another company');
    }
    const update: any = {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(subdomain ? { subdomain } : {}),
      ...(data.adminName !== undefined ? { adminName: data.adminName.trim() } : {}),
      ...(adminEmail ? { adminEmail } : {}),
      ...(data.companyType !== undefined ? { companyType: data.companyType.trim() || null } : {}),
      ...(data.phone !== undefined ? { phone: data.phone.trim() || null } : {}),
      ...(data.address !== undefined ? { address: data.address.trim() || null } : {}),
      ...(data.description !== undefined ? { description: data.description.trim() || null } : {}),
      ...(data.logoUrl !== undefined ? { logoUrl: data.logoUrl.trim() || null } : {}),
      version: { increment: 1 },
    };

    const updated = await this.central.$transaction(async (tx: any) => {
      if (adminEmail && current.users[0]) await this.security.assertAvailable(tx, adminEmail, 'user', current.users[0].id);
      if ((adminEmail || data.adminName !== undefined) && current.users[0]) await tx.companyUser.update({
        where: { id: current.users[0].id }, data: { ...(adminEmail ? { email: adminEmail } : {}), ...identityChange() },
      });
      return tx.company.update({ where: { id }, data: update });
    });
    const syncPending = current.users[0] && (adminEmail || data.adminName !== undefined)
      ? await this.identities.sync(current.users[0].id) : false;
    if (adminEmail && adminEmail !== current.adminEmail && current.users[0]) {
      await this.security.notifyChange({ ...current.users[0], company: current }, 'email', true, adminEmail);
    }
    let synchronizationWarning: string | undefined = syncPending
      ? 'Owner profile saved. Access is paused while the workspace identity synchronizes automatically.' : undefined;
    try {
      await this.synchronizeTenantConfiguration(updated);
    } catch {
      synchronizationWarning = synchronizationWarning || 'The platform profile was saved, but tenant configuration could not be synchronized. Retry after restoring the tenant database connection.';
    }
    return { ...(await this.getCompanyById(updated.id)), ...(synchronizationWarning ? { synchronizationWarning } : {}) };
  }

  async deleteCompany(id: string) {
    const result = await withOnboardingLock(async (guard) => {
      const company = await this.central.company.findUnique({ where: { id }, include: { onboarding: true } });
      if (!company) throw new NotFoundException('Company not found');
      if (company.onboarding && !['SUCCEEDED', 'DELETING'].includes(company.onboarding.status)) {
        throw new ConflictException({ message: 'Finish or recover this company setup before deleting it.', onboardingId: company.onboarding.id });
      }
      await guard();
      await this.central.$transaction(async (tx: any) => {
        await tx.company.update({ where: { id }, data: { status: 'SUSPENDED', accessGranted: false } });
        if (company.onboarding) await tx.companyOnboarding.update({ where: { id: company.onboarding.id }, data: { status: 'DELETING' } });
      });
      const revealedUrl = revealDatabaseUrl(company.dbUrl);
      await this.tenantManager.disconnectTenant(revealedUrl);
      await guard();
      let tenantDatabaseDeleted = false;
      if (company.dbCreatedByMaamulPro) {
        const pair = getDatabaseConnectionPair(revealedUrl);
        await this.neonManagement.deleteCreatedDatabase({ ...pair, createdByMaamulPro: true,
          databaseName: company.onboarding?.databaseName || decodeURIComponent(new URL(pair.directUrl).pathname.slice(1)),
          projectId: company.onboarding?.projectId || process.env.NEON_PROJECT_ID,
          branchId: company.onboarding?.branchId || process.env.NEON_BRANCH_ID,
          databaseOwner: company.onboarding?.databaseOwner || decodeURIComponent(new URL(pair.directUrl).username),
        });
        tenantDatabaseDeleted = true;
      }
      await guard();
      await this.central.$transaction(async (tx: any) => {
        if (company.onboarding) await tx.companyOnboarding.update({ where: { id: company.onboarding.id }, data: { status: 'CANCELLED' } });
        await tx.company.delete({ where: { id } });
      });
      return { deleted: true, id, name: company.name, tenantDatabaseDeleted };
    });
    if (!result) throw new ConflictException('Another company setup or deletion is running. Try again shortly.');
    return result;
  }

  async getPlatformNotifications() {
    const now = new Date();
    const [registrations, invoices, transactions, expiredCompanies, expiringCompanies, passwordResetRequests] = await Promise.all([
      this.central.company.findMany({ take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, createdAt: true } }),
      this.central.invoice.findMany({ where: { status: { in: ['UNPAID', 'OVERDUE', 'EXPIRED'] } }, take: 5, orderBy: { updatedAt: 'desc' }, include: { company: { select: { id: true, name: true } } } }),
      this.central.subscriptionTransaction.findMany({ take: 5, orderBy: { createdAt: 'desc' }, include: { company: { select: { id: true, name: true } } } }),
      this.central.company.findMany({ where: { subscriptionStatus: 'EXPIRED' }, take: 5, orderBy: { subscriptionExpiresAt: 'desc' }, select: { id: true, name: true, subscriptionExpiresAt: true } }),
      this.central.company.findMany({ where: { subscriptionStatus: 'ACTIVE', subscriptionExpiresAt: { gte: now, lte: new Date(now.getTime() + 7 * 86400000) } }, take: 5, orderBy: { subscriptionExpiresAt: 'asc' }, select: { id: true, name: true, subscriptionExpiresAt: true } }),
      this.central.emailVerification.findMany({
        where: { context: 'PASSWORD_RESET', status: 'PENDING' },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, createdAt: true, expiresAt: true },
      }),
    ]);
    const resetEmails = [...new Set(passwordResetRequests.map((request: any) => request.email))];
    const resetCompanies = resetEmails.length
      ? await this.central.company.findMany({ where: { adminEmail: { in: resetEmails } }, select: { id: true, name: true, adminEmail: true } })
      : [];
    const resetCompanyByEmail = new Map<string, { id: string; name: string; adminEmail: string }>(
      resetCompanies.map((company: any) => [company.adminEmail.toLowerCase(), company]),
    );
    const notifications = [
      ...registrations.map((row: any) => ({ id: `company-${row.id}`, category: 'REGISTRATION', title: 'New company registration', details: `${row.name} registered on the platform.`, createdAt: row.createdAt, companyId: row.id })),
      ...invoices.map((row: any) => ({
        id: `invoice-${row.id}`,
        category: ['OVERDUE', 'EXPIRED'].includes(row.status) ? 'FAILED_PAYMENT' : 'OUTSTANDING_INVOICE',
        title: row.status === 'EXPIRED' ? 'Invoice expired' : row.status === 'OVERDUE' ? 'Overdue invoice' : 'Outstanding invoice',
        details: `${row.company.name} has ${row.status.toLowerCase()} invoice ${row.invoiceNumber}.`,
        createdAt: row.updatedAt || row.dueDate,
        companyId: row.companyId,
      })),
      ...transactions.map((row: any) => ({ id: `subscription-${row.id}`, category: 'SUBSCRIPTION', title: row.transactionType.replace(/_/g, ' '), details: `${row.company.name}: subscription status changed to ${row.newStatus}.`, createdAt: row.createdAt, companyId: row.companyId })),
      ...expiredCompanies.map((row: any) => ({ id: `expired-${row.id}`, category: 'EXPIRED_SUBSCRIPTION', title: 'Subscription expired', details: `${row.name}'s subscription has expired.`, createdAt: row.subscriptionExpiresAt || now, companyId: row.id })),
      ...expiringCompanies.map((row: any) => ({ id: `expiring-${row.id}`, category: 'SUBSCRIPTION_RENEWAL', title: 'Subscription expiring soon', details: `${row.name}'s subscription expires soon.`, createdAt: row.subscriptionExpiresAt || now, companyId: row.id })),
      ...passwordResetRequests.map((request: any) => {
        const company = resetCompanyByEmail.get(request.email.toLowerCase());
        return company ? {
          id: `password-reset-${request.id}`,
          category: 'PASSWORD_RESET',
          title: 'Admin password reset requested',
          details: `${company.name}: a reset code was sent to ${company.adminEmail}.`,
          createdAt: request.createdAt,
          companyId: company.id,
        } : null;
      }).filter(Boolean),
    ].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 12);
    return { notifications };
  }

  async syncTenantSchemas() {
    const companies = await this.central.company.findMany({
      where: { status: { not: 'PENDING_SETUP' }, OR: [{ onboarding: null }, { onboarding: { status: 'SUCCEEDED' } }] },
      select: { id: true, name: true, dbUrl: true },
    });

    const results: { companyId: string; name: string; status: string; error?: string }[] = [];
    for (const company of companies) {
      try {
        const { directUrl } = getDatabaseConnectionPair(revealDatabaseUrl(company.dbUrl));
        await applyCompanySchema(directUrl);
        results.push({ companyId: company.id, name: company.name, status: 'ok' });
      } catch (err) {
        const failure = setupFailure(err, 'SCHEMA');
        results.push({ companyId: company.id, name: company.name, status: 'error', error: `${failure.message} Reference: ${failure.code}` });
      }
    }

    const ok = results.filter((r) => r.status === 'ok').length;
    const failed = results.filter((r) => r.status === 'error');
    return { total: companies.length, ok, failed: failed.length, details: failed };
  }
}
