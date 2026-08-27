import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CentralPrismaService } from '../../common/database/central-prisma.service';
import { TenantConnectionManager } from '../../common/database/tenant-connection.manager';
import { ReportsService } from '../reports/reports.service';
import { revealDatabaseUrl } from '../../common/database/database-credentials';
import { ResendEmailService } from '../../common/email/resend-email.service';
import { SubscriptionLifecycleService } from '../../common/subscriptions/subscription-lifecycle.service';
import { SubscriptionEntitlementService } from '../../common/subscriptions/subscription-entitlement.service';
import { syncPermissionsToDb } from '../../common/database/rbac-sync';
import { OperationalAlertsService } from '../settings/operational-alerts.service';
import { RealEstateService } from '../real-estate/real-estate.service';
import { PayrollService } from '../payroll/payroll.service';

@Injectable()
export class ScheduledJobsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScheduledJobsService.name);

  private reportDeliveryRunning = false;
  private rbacSyncRunning = false;
  private alertsSyncRunning = false;

  constructor(
    private readonly centralPrisma: CentralPrismaService,
    private readonly tenantManager: TenantConnectionManager,
    private readonly reports: ReportsService,
    private readonly email: ResendEmailService,
    private readonly subscriptionLifecycle: SubscriptionLifecycleService,
    private readonly subscriptionEntitlements: SubscriptionEntitlementService,
    private readonly operationalAlerts: OperationalAlertsService,
    private readonly realEstate: RealEstateService,
    private readonly payroll: PayrollService,
  ) {}

  private get central(): any {
    return this.centralPrisma as any;
  }

  onApplicationBootstrap() {
    void this.synchronizeTenantRbacRegistries();
  }

  @Cron('0 15 1 * * *')
  async synchronizeTenantRbacRegistries() {
    if (this.rbacSyncRunning) return;
    this.rbacSyncRunning = true;
    let synchronized = 0;
    let failed = 0;
    try {
      const companies = await this.central.company.findMany({
        where: { dbUrl: { not: '' }, OR: [{ onboarding: null }, { onboarding: { status: 'SUCCEEDED' } }] },
        select: { id: true, name: true, dbUrl: true },
      });
      for (const company of companies) {
        try {
          const tenantDb = this.tenantManager.getTenantDb(revealDatabaseUrl(company.dbUrl));
          await syncPermissionsToDb(tenantDb as any);
          synchronized++;
        } catch (error: any) {
          failed++;
          this.logger.error(`RBAC registry synchronization failed for '${company.name}' (${company.id}): ${error.message}`);
        }
      }
      this.logger.log(`Tenant RBAC registries synchronized automatically: ${synchronized} succeeded, ${failed} failed`);
    } catch (error: any) {
      this.logger.error(`Automatic tenant RBAC synchronization failed: ${error.message}`, error.stack);
    } finally {
      this.rbacSyncRunning = false;
    }
  }

  /**
   * Daily Subscription Expiration & Renewal Job
   * Runs every night at midnight to safely update expired subscriptions
   * and auto-generate renewal invoices.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async processSubscriptionRenewalsAndExpirations() {
    try {
      await this.subscriptionLifecycle.backfillLegacyEntitlements();
      const reconciliation = await this.subscriptionLifecycle.reconcileBillingLifecycle();
      const renewalInvoices = await this.subscriptionLifecycle.generateUpcomingRenewalInvoices(7);
      this.logger.log(
        `Subscription lifecycle reconciled: ${reconciliation.overdue} overdue invoices, ` +
        `${reconciliation.expiredInvoices} expired invoices, ${reconciliation.expiredSubscriptions} expired subscriptions, ` +
        `${renewalInvoices.length} renewal invoices prepared`,
      );
    } catch (error: any) {
      this.logger.error(`Error executing subscription lifecycle job: ${error.message}`, error.stack);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async reconcileInvoiceAndSubscriptionStatus() {
    try {
      await this.subscriptionLifecycle.reconcileBillingLifecycle();
    } catch (error: any) {
      this.logger.error(`Hourly billing reconciliation failed: ${error.message}`, error.stack);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async reconcileOperationalAlerts() {
    if (this.alertsSyncRunning) return;
    this.alertsSyncRunning = true;
    let synchronized = 0;
    let failed = 0;
    try {
      const companies = await this.central.company.findMany({
        where: { status: 'ACTIVE', accessGranted: true, dbUrl: { not: '' }, OR: [{ onboarding: null }, { onboarding: { status: 'SUCCEEDED' } }] },
        select: { id: true, name: true, dbUrl: true },
      });
      for (const company of companies) {
        try {
          const db = this.tenantManager.getTenantDb(revealDatabaseUrl(company.dbUrl));
          await this.operationalAlerts.reconcileTenant(db as any);
          synchronized++;
        } catch (error: any) {
          failed++;
          this.logger.error(`Operational alert reconciliation failed for '${company.name}' (${company.id}): ${error.message}`);
        }
      }
      this.logger.log(`Operational alerts reconciled: ${synchronized} succeeded, ${failed} failed`);
    } finally {
      this.alertsSyncRunning = false;
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async processDueReportSchedules() {
    if (this.reportDeliveryRunning) {
      this.logger.warn('Skipping report delivery because the previous run is still active');
      return;
    }
    if (!this.email.isConfigured()) {
      this.logger.warn('Scheduled report delivery is disabled until RESEND_API_KEY and RESEND_FROM are configured');
      return;
    }
    this.reportDeliveryRunning = true;
    const now = new Date();
    try {
      const companies = await this.central.company.findMany({
        where: { status: 'ACTIVE', accessGranted: true, dbUrl: { not: '' }, OR: [{ onboarding: null }, { onboarding: { status: 'SUCCEEDED' } }] },
        select: { id: true, name: true, adminEmail: true, dbUrl: true, entitlements: true },
      });
      for (const company of companies) {
        if (!this.subscriptionEntitlements.fromCompany(company).features.advancedReports) continue;
        try {
          const db: any = this.tenantManager.getTenantDb(revealDatabaseUrl(company.dbUrl));
          const schedules = await db.reportSchedule.findMany({
            where: {
              deletedAt: null,
              isActive: true,
              OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
            },
            orderBy: { createdAt: 'asc' },
          });
          for (const schedule of schedules) {
            try {
              const filters = this.parseReportFilters(schedule.filters);
              const result = await this.reports.runReport(db, schedule.reportId, filters);
              const csv = this.reports.reportCsv(result);
              const recipients = (schedule.recipients || company.adminEmail)
                .split(',')
                .map((value: string) => value.trim())
                .filter(Boolean);
              if (!recipients.length) throw new Error('No report recipients are configured');
              const delivery = await this.email.send({
                to: recipients,
                subject: `${company.name}: ${result.report.title}`,
                text: `${result.report.title} is attached as a CSV file.`,
                html: `<h2>${this.escapeHtml(result.report.title)}</h2><p>Your scheduled report for ${this.escapeHtml(company.name)} is attached.</p><p>Generated ${new Date(result.generatedAt).toISOString()}</p>`,
                attachments: [{
                  filename: `${schedule.reportId}-${now.toISOString().slice(0, 10)}.csv`,
                  content: csv,
                }],
              });
              const nextRunAt = this.nextReportRun(now, schedule.frequency);
              if (!delivery.sent) throw new Error('Email provider did not confirm delivery');
              await db.reportSchedule.update({
                where: { id: schedule.id },
                data: { nextRunAt, lastRunAt: now, lastSuccessAt: now, lastFailureAt: null, lastError: null, lastDeliveryId: delivery.id || null },
              });
              const actor = await db.user.findFirst({
                where: { deletedAt: null, isActive: true },
                orderBy: { createdAt: 'asc' },
              });
              if (actor) {
                await db.activityLog.create({
                  data: {
                    userId: actor.id,
                    action: 'EXPORT',
                    entity: 'report_schedule',
                    entityId: schedule.id,
                    resource: schedule.reportId,
                    details: `Scheduled report sent to ${recipients.join(', ')}`,
                    ipAddress: 'system',
                    deviceInfo: 'cron',
                  },
                });
              }
              this.logger.log(`Sent report '${schedule.name}' for '${company.name}'`);
            } catch (error: any) {
              await db.reportSchedule.update({
                where: { id: schedule.id },
                data: { lastRunAt: now, lastFailureAt: now, lastError: String(error.message || error).slice(0, 2000) },
              }).catch(() => undefined);
              this.logger.error(`Report schedule '${schedule.id}' failed for '${company.name}': ${error.message}`);
            }
          }
        } catch (error: any) {
          this.logger.error(`Unable to process report schedules for '${company.name}': ${error.message}`);
        }
      }
    } finally {
      this.reportDeliveryRunning = false;
    }
  }

  @Cron('0 0 8 * * *')
  async processOperationalAlertDigests() {
    if (!this.email.isConfigured()) return;
    const companies = await this.central.company.findMany({
      where: { status: 'ACTIVE', accessGranted: true, dbUrl: { not: '' }, OR: [{ onboarding: null }, { onboarding: { status: 'SUCCEEDED' } }] },
      select: { id: true, name: true, adminEmail: true, dbUrl: true },
    });
    for (const company of companies) {
      try {
        const db: any = this.tenantManager.getTenantDb(revealDatabaseUrl(company.dbUrl));
        await this.operationalAlerts.reconcileTenant(db);
        const alerts = await this.operationalAlerts.getDigestAlerts(db);
        if (!alerts.length || !company.adminEmail) continue;
        const critical = alerts.filter((alert: any) => alert.severity === 'CRITICAL').length;
        const lines = alerts.slice(0, 50).map((alert: any) => `- [${alert.severity}] ${alert.title}${alert.details ? `: ${alert.details}` : ''}`);
        const delivery = await this.email.send({
          to: [company.adminEmail],
          subject: `${company.name}: ${alerts.length} active operational alert${alerts.length === 1 ? '' : 's'}`,
          text: `${critical} critical alert${critical === 1 ? '' : 's'}\n\n${lines.join('\n')}`,
        });
        if (delivery.sent) await db.operationalAlert.updateMany({
          where: { id: { in: alerts.map((alert: any) => alert.id) } },
          data: { lastEmailedAt: new Date() },
        });
      } catch (error: any) {
        this.logger.error(`Operational alert digest failed for '${company.name}': ${error.message}`);
      }
    }
  }

  @Cron('0 20 2 * * *')
  async generateRecurringMonthlyRecords() {
    const companies = await this.central.company.findMany({
      where: { status: 'ACTIVE', accessGranted: true, dbUrl: { not: '' }, OR: [{ onboarding: null }, { onboarding: { status: 'SUCCEEDED' } }] },
      select: { id: true, name: true, dbUrl: true },
    });
    for (const company of companies) {
      try {
        const db: any = this.tenantManager.getTenantDb(revealDatabaseUrl(company.dbUrl));
        const configs = await db.systemConfig.findMany({ where: { key: { in: ['automatic_rent_invoices', 'automatic_payroll_drafts'] } } });
        const values = Object.fromEntries(configs.map((row: any) => [row.key, row.value]));
        if (values.automatic_rent_invoices !== 'false') await this.realEstate.generateMonthlyRentInvoices(db);
        if (values.automatic_payroll_drafts === 'true') {
          const owner = await db.user.findFirst({ where: { deletedAt: null, isActive: true, role: 'COMPANY_OWNER' }, select: { id: true } });
          if (owner) await this.payroll.generateMonthlyDraft(db, owner.id);
        }
      } catch (error: any) {
        this.logger.error(`Recurring monthly record generation failed for '${company.name}': ${error.message}`);
      }
    }
  }

  private parseReportFilters(value?: string | null) {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return {
        startDate: typeof parsed.startDate === 'string' ? parsed.startDate : parsed.from,
        endDate: typeof parsed.endDate === 'string' ? parsed.endDate : parsed.to,
        entityId: typeof parsed.entityId === 'string' ? parsed.entityId : undefined,
      };
    } catch {
      return {};
    }
  }

  private nextReportRun(from: Date, frequency: string) {
    const next = new Date(from);
    if (frequency === 'WEEKLY') next.setDate(next.getDate() + 7);
    if (frequency === 'MONTHLY') next.setMonth(next.getMonth() + 1);
    if (frequency === 'YEARLY') next.setFullYear(next.getFullYear() + 1);
    return next;
  }

  private escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[character] || character);
  }
}
