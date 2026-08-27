import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CentralPrismaService } from '../../common/database/central-prisma.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  ChangePasswordDto,
  UpdateCompanySettingsDto,
  UpdateLanguageDto,
  UpdateProfileDto,
} from './dto/settings.dto';
import { OperationalAlertsService } from './operational-alerts.service';
import { AccountSecurityService } from '../../common/security/account-security.service';

const CONFIG_KEYS: Record<keyof UpdateCompanySettingsDto, string> = {
  companyName: 'company_name',
  logoUrl: 'logo_url',
  companyEmail: 'company_email',
  companyPhone: 'company_phone',
  companyAddress: 'company_address',
  companyDescription: 'company_description',
  automaticRentInvoices: 'automatic_rent_invoices',
  automaticPayrollDrafts: 'automatic_payroll_drafts',
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly centralPrisma: CentralPrismaService,
    private readonly operationalAlerts: OperationalAlertsService,
    private readonly security: AccountSecurityService,
  ) {}

  async getSettings(tenantDb: any, tenant: any) {
    const rows = await tenantDb.systemConfig.findMany();
    const values = Object.fromEntries(rows.map((row: any) => [row.key, row.value]));
    const [users, constructionProjects, properties] = await Promise.all([
      (this.centralPrisma as any).companyUser.count({
        where: { companyId: tenant.companyId, isActive: true, deletedAt: null },
      }),
      tenant.entitlements?.features?.construction
        ? tenantDb.project.count({ where: { deletedAt: null } })
        : 0,
      tenant.entitlements?.features?.realEstate
        ? tenantDb.property.count({ where: { deletedAt: null } })
        : 0,
    ]);
    return {
      companyName: values.company_name || tenant.companyName,
      logoUrl: values.logo_url || null,
      companyEmail: values.company_email || '',
      companyPhone: values.company_phone || '',
      companyAddress: values.company_address || '',
      companyDescription: values.company_description || '',
      automaticRentInvoices: values.automatic_rent_invoices !== 'false',
      automaticPayrollDrafts: values.automatic_payroll_drafts === 'true',
      subdomain: tenant.subdomain,
      constructionEnabled: tenant.constructionEnabled,
      realEstateEnabled: tenant.realEstateEnabled,
      materialManagementEnabled: tenant.materialManagementEnabled,
      moduleMode: tenant.mode,
      subscriptionStatus: tenant.subscriptionStatus,
      subscriptionExpiresAt: tenant.subscriptionExpiresAt,
      accessGranted: tenant.accessGranted,
      entitlements: tenant.entitlements,
      usage: { users, constructionProjects, properties },
    };
  }

  async updateSettings(tenantDb: any, data: UpdateCompanySettingsDto) {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    await tenantDb.$transaction(
      entries.map(([field, value]) =>
        tenantDb.systemConfig.upsert({
          where: { key: CONFIG_KEYS[field as keyof UpdateCompanySettingsDto] },
          update: { value: String(value) },
          create: {
            key: CONFIG_KEYS[field as keyof UpdateCompanySettingsDto],
            value: String(value),
          },
        }),
      ),
    );
    return { updated: entries.map(([key]) => key) };
  }

  async getProfile(tenantDb: any, userId: string) {
    const profile = await tenantDb.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        language: true,
        isActive: true,
      },
    });
    if (!profile) throw new NotFoundException('User profile not found');
    return profile;
  }

  async updateProfile(tenantDb: any, userId: string, data: UpdateProfileDto) {
    const current = await this.getProfile(tenantDb, userId);
    if (data.email && data.email.trim().toLowerCase() !== current.email.toLowerCase()) {
      throw new BadRequestException('Use email verification to change your login email.');
    }
    return tenantDb.user.update({
      where: { id: userId },
      data: { name: data.name?.trim(), avatarUrl: data.avatarUrl },
      select: { id: true, name: true, email: true, avatarUrl: true, language: true },
    });
  }

  async changePassword(_tenantDb: any, userId: string, data: ChangePasswordDto) {
    return this.security.changePassword('user', userId, data.currentPassword, data.newPassword);
  }

  sendEmailVerification(userId: string, email: string, currentPassword: string) {
    return this.security.sendEmailChange('user', userId, email, currentPassword);
  }

  changeEmail(userId: string, email: string, currentPassword: string, verificationCode: string) {
    return this.security.changeEmail('user', userId, email, currentPassword, verificationCode);
  }

  updateLanguage(tenantDb: any, userId: string, data: UpdateLanguageDto) {
    return tenantDb.user.update({
      where: { id: userId },
      data: { language: data.language },
      select: { id: true, language: true },
    });
  }

  async getActivityLogs(tenantDb: any, query: PaginationQueryDto & {
    entity?: string;
    userId?: string;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 25;
    const where: any = {};
    if (query.entity) where.entity = query.entity;
    if (query.userId) where.userId = query.userId;
    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: 'insensitive' } },
        { entity: { contains: query.search, mode: 'insensitive' } },
        { details: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      tenantDb.activityLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      tenantDb.activityLog.count({ where }),
    ]);
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async clearActivityLogs(tenantDb: any) {
    const result = await tenantDb.activityLog.deleteMany();
    return { deletedCount: result.count };
  }

  async getNotifications(tenantDb: any, userId: string, principal: any = {}) {
    const permissions = principal?.permissions || [];
    const isOwner = Boolean(principal?.isImpersonating) || ['COMPANY_OWNER', 'SUPER_ADMIN'].includes(principal?.role);
    const canViewActivity = isOwner || permissions.includes('activity_logs.read');
    await this.operationalAlerts.reconcileTenantIfStale(tenantDb);
    const [alerts, lastRead, activity] = await Promise.all([
      this.operationalAlerts.getAlertsForUser(tenantDb, userId, permissions, isOwner),
      canViewActivity ? tenantDb.activityLog.findFirst({
        where: { userId, action: 'UPDATE', entity: 'notification_center' },
        orderBy: { createdAt: 'desc' },
      }) : Promise.resolve(null),
      canViewActivity ? tenantDb.activityLog.findMany({
        where: { NOT: { entity: 'notification_center' } },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }) : Promise.resolve([]),
    ]);
    const activityNotifications = activity.map((row: any) => ({
        id: row.id,
        action: row.action,
        entity: row.entity,
        details: row.details,
        createdAt: row.createdAt,
        actorName: row.user?.name || row.user?.email || 'System',
        isUnread: !lastRead || row.createdAt > lastRead.createdAt,
      }));
    return {
      alerts,
      activity: activityNotifications,
      notifications: activityNotifications,
      unreadAlertCount: alerts.filter((alert: any) => alert.isUnread).length,
      unreadCount: alerts.filter((alert: any) => alert.isUnread).length + activityNotifications.filter((item: any) => item.isUnread).length,
      lastSeenAt: lastRead?.createdAt || null,
    };
  }

  async searchRecords(tenantDb: any, query: string, principal: any = {}) {
    const text = query.trim().slice(0, 100);
    if (text.length < 2) return [];
    const permissions = principal?.permissions || [];
    const isOwner = Boolean(principal?.isImpersonating) || ['COMPANY_OWNER', 'SUPER_ADMIN'].includes(principal?.role);
    const can = (permission: string) => isOwner || permissions.includes(permission);
    const canAny = (...required: string[]) => isOwner || required.some((permission) => permissions.includes(permission));
    const contains = { contains: text, mode: 'insensitive' } as any;
    const searches: Promise<any[]>[] = [];

    if (can('projects.read')) searches.push(tenantDb.project.findMany({ where: { deletedAt: null, OR: [{ name: contains }, { location: contains }] }, select: { id: true, name: true, location: true }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.name, description: row.location || 'Construction project', section: 'Projects', targetPath: `/app/construction/projects/${row.id}` }))));
    if (can('construction_tasks.read')) searches.push(tenantDb.projectTask.findMany({ where: { deletedAt: null, OR: [{ title: contains }, { description: contains }] }, include: { project: { select: { name: true } } }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.title, description: row.project?.name || 'Construction task', section: 'Tasks', targetPath: `/app/construction/tasks?record=${row.id}` }))));
    if (can('construction_expenses.read')) searches.push(tenantDb.dailyOperationalExpense.findMany({ where: { deletedAt: null, OR: [{ description: contains }, { category: contains }, { project: { is: { name: contains } } }, { staff: { is: { firstName: contains } } }, { staff: { is: { lastName: contains } } }] }, include: { project: { select: { name: true } }, staff: { select: { firstName: true, lastName: true } } }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.description, description: row.project?.name || [row.staff?.firstName, row.staff?.lastName].filter(Boolean).join(' ') || row.category, section: 'Construction expenses', targetPath: `/app/construction/expenses?record=${row.id}` }))));
    if (can('manpower.read')) {
      searches.push(tenantDb.workerType.findMany({ where: { deletedAt: null, OR: [{ name: contains }, { description: contains }] }, select: { id: true, name: true, description: true }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.name, description: row.description || 'Worker type', section: 'Worker types', targetPath: `/app/construction/worker-types?record=${row.id}` }))));
      searches.push(tenantDb.workerLedgerEntry.findMany({ where: { OR: [{ description: contains }, { project: { is: { name: contains } } }, { staff: { is: { firstName: contains } } }, { staff: { is: { lastName: contains } } }] }, include: { project: { select: { name: true } }, staff: { select: { firstName: true, lastName: true } } }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.description, description: row.project?.name || [row.staff?.firstName, row.staff?.lastName].filter(Boolean).join(' ') || 'Worker ledger entry', section: 'Worker ledger', targetPath: `/app/construction/worker-ledger?record=${row.id}` }))));
    }
    if (can('users.read')) searches.push(tenantDb.staff.findMany({ where: { deletedAt: null, OR: [{ firstName: contains }, { lastName: contains }, { phone: contains }, { position: contains }] }, select: { id: true, firstName: true, lastName: true, position: true }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: `${row.firstName} ${row.lastName}`, description: row.position || 'Staff member', section: 'Staff', targetPath: '/app/staff' }))));
    if (can('properties.read')) searches.push(tenantDb.property.findMany({ where: { deletedAt: null, OR: [{ title: contains }, { address: contains }] }, select: { id: true, title: true, address: true }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.title, description: row.address || 'Property', section: 'Properties', targetPath: `/app/real-estate/properties/${row.id}` }))));
    if (canAny('clients.read', 'rentals.read')) searches.push(tenantDb.tenant.findMany({ where: { deletedAt: null, OR: [{ name: contains }, { email: contains }, { phone: contains }] }, select: { id: true, name: true, phone: true }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.name, description: row.phone || 'Client / tenant', section: 'Clients', targetPath: `/app/real-estate/clients?record=${row.id}` }))));
    if (can('deals.read')) searches.push(tenantDb.deal.findMany({ where: { deletedAt: null, OR: [{ notes: contains }, { property: { is: { title: contains } } }, { client: { is: { name: contains } } }] }, include: { property: { select: { title: true } }, client: { select: { name: true } } }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: `${row.property?.title || 'Property'} · ${row.type}`, description: row.client?.name || 'Property deal', section: 'Deals', targetPath: `/app/real-estate/deals/${row.id}` }))));
    if (can('rentals.read')) {
      searches.push(tenantDb.rentalContract.findMany({ where: { deletedAt: null, OR: [{ tenant: { is: { name: contains } } }, { property: { is: { title: contains } } }] }, include: { tenant: { select: { name: true } }, property: { select: { title: true } } }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.property?.title || 'Rental contract', description: row.tenant?.name || 'Tenant', section: 'Rental contracts', targetPath: `/app/real-estate/rental-contracts?record=${row.id}` }))));
      searches.push(tenantDb.rentPayment.findMany({ where: { deletedAt: null, OR: [{ receiptNo: contains }, { tenant: { is: { name: contains } } }] }, include: { tenant: { select: { name: true } } }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.receiptNo || `Rent payment for ${row.tenant?.name || 'tenant'}`, description: row.tenant?.name || 'Rent payment', section: 'Rent payments', targetPath: `/app/real-estate/rent-payments?record=${row.id}` }))));
    }
    if (can('materials_products.read')) searches.push(tenantDb.material.findMany({ where: { deletedAt: null, OR: [{ name: contains }, { category: contains }, { warehouse: contains }] }, select: { id: true, name: true, warehouse: true }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.name, description: row.warehouse || 'Material product', section: 'Materials', targetPath: `/app/materials/inventory/manage?record=${row.id}` }))));
    if (can('construction_inventory.read')) searches.push(tenantDb.constructionMaterial.findMany({ where: { deletedAt: null, OR: [{ name: contains }, { category: contains }, { warehouse: contains }] }, select: { id: true, name: true, warehouse: true }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.name, description: row.warehouse || 'Construction material', section: 'Construction materials', targetPath: `/app/construction/inventory/manage?record=${row.id}` }))));
    if (can('material_customers.read')) searches.push(tenantDb.materialCustomer.findMany({ where: { deletedAt: null, OR: [{ name: contains }, { email: contains }, { phone: contains }] }, select: { id: true, name: true, phone: true }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.name, description: row.phone || 'Material customer', section: 'Material customers', targetPath: `/app/materials/customers?record=${row.id}` }))));
    if (can('suppliers.read')) searches.push(tenantDb.supplier.findMany({ where: { deletedAt: null, OR: [{ name: contains }, { email: contains }, { phone: contains }] }, select: { id: true, name: true, phone: true }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.name, description: row.phone || 'Supplier', section: 'Suppliers', targetPath: `/app/materials/suppliers?record=${row.id}` }))));
    if (can('purchases.read')) searches.push(tenantDb.purchaseOrder.findMany({ where: { deletedAt: null, OR: [{ orderNo: contains }, { supplier: { is: { name: contains } } }] }, include: { supplier: { select: { name: true } } }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.orderNo, description: row.supplier?.name || 'Purchase order', section: 'Purchases', targetPath: `/app/materials/purchases?record=${row.id}` }))));
    if (can('material_sales.read')) searches.push(tenantDb.materialSale.findMany({ where: { deletedAt: null, OR: [{ invoiceNo: contains }, { customer: { is: { name: contains } } }] }, include: { customer: { select: { name: true } } }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.invoiceNo, description: row.customer?.name || 'Material sale', section: 'Material sales', targetPath: `/app/materials/sales?record=${row.id}` }))));
    if (can('transportation.read')) searches.push(tenantDb.transportationRecord.findMany({ where: { deletedAt: null, OR: [{ deliveryNo: contains }, { responsiblePerson: contains }, { notes: contains }] }, select: { id: true, deliveryNo: true, responsiblePerson: true }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.deliveryNo, description: row.responsiblePerson || 'Transportation record', section: 'Transportation', targetPath: `/app/materials/transportation?record=${row.id}` }))));
    if (can('payroll.read')) searches.push(tenantDb.payroll.findMany({ where: { deletedAt: null, name: contains }, select: { id: true, name: true, year: true, month: true }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.name, description: `${row.year}-${String(row.month).padStart(2, '0')} payroll`, section: 'Payroll', targetPath: `/app/payroll?record=${row.id}` }))));
    if (can('transactions.read')) searches.push(tenantDb.transaction.findMany({ where: { deletedAt: null, OR: [{ referenceId: contains }, { description: contains }, { notes: contains }, { category: { is: { name: contains } } }] }, include: { category: { select: { name: true } } }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.description, description: `${row.category?.name || row.type} · ${row.referenceId}`, section: 'Financial transactions', targetPath: '/app/financials' }))));
    if (can('accounting.read')) {
      searches.push(tenantDb.account.findMany({ where: { OR: [{ code: contains }, { name: contains }, { description: contains }] }, select: { code: true, name: true, type: true }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.code, label: `${row.code} · ${row.name}`, description: row.type, section: 'Chart of accounts', targetPath: '/app/financials/accounts' }))));
      searches.push(tenantDb.journalEntry.findMany({ where: { OR: [{ accountCode: contains }, { contactName: contains }, { memo: contains }, { batch: { is: { batchNumber: contains } } }] }, include: { batch: { select: { batchNumber: true } } }, take: 5 }).then((rows: any[]) => rows.map((row) => ({ id: row.id, label: row.memo || row.contactName || `Journal entry ${row.batch?.batchNumber || row.accountCode}`, description: `${row.accountCode} · ${row.batch?.batchNumber || 'Manual journal'}`, section: 'Journal entries', targetPath: '/app/financials/journals' }))));
    }

    return (await Promise.all(searches)).flat().slice(0, 30);
  }

  async markNotificationsRead(tenantDb: any, userId: string, principal: any = {}) {
    const permissions = principal?.permissions || [];
    const isOwner = Boolean(principal?.isImpersonating) || ['COMPANY_OWNER', 'SUPER_ADMIN'].includes(principal?.role);
    await this.operationalAlerts.markAlertsRead(tenantDb, userId, permissions, isOwner);
    return tenantDb.activityLog.create({
      data: {
        userId,
        action: 'UPDATE',
        entity: 'notification_center',
        details: 'Marked all notifications as read',
      },
    });
  }

  private alertAccess(principal: any) {
    return {
      permissions: principal?.permissions || [],
      isOwner: Boolean(principal?.isImpersonating) || ['COMPANY_OWNER', 'SUPER_ADMIN'].includes(principal?.role),
    };
  }

  markNotificationRead(tenantDb: any, alertId: string, userId: string, principal: any = {}) {
    const access = this.alertAccess(principal);
    return this.operationalAlerts.markAlertRead(tenantDb, alertId, userId, access.permissions, access.isOwner);
  }

  dismissNotification(tenantDb: any, alertId: string, userId: string, principal: any = {}) {
    const access = this.alertAccess(principal);
    return this.operationalAlerts.dismissAlert(tenantDb, alertId, userId, access.permissions, access.isOwner);
  }
}
