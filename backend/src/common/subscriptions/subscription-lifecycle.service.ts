import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CentralPrismaService } from '../database/central-prisma.service';
import {
  addBillingPeriod,
  addBillingMonths,
  legacyPlanTier,
  planEntitlements,
} from './entitlement-policy';
import { SubscriptionEntitlementService } from './subscription-entitlement.service';

const DAY = 24 * 60 * 60 * 1000;
const INVOICE_DUE_DAYS = 7;
const INVOICE_EXPIRY_DAYS = 30;
const OPEN_INVOICE_STATUSES = ['UNPAID', 'OVERDUE'];

@Injectable()
export class SubscriptionLifecycleService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionLifecycleService.name);
  constructor(
    private readonly centralPrisma: CentralPrismaService,
    private readonly entitlements: SubscriptionEntitlementService,
  ) {}

  private get central(): any {
    return this.centralPrisma as any;
  }

  async onModuleInit() {
    try {
      await this.backfillLegacyEntitlements();
      await this.reconcileBillingLifecycle();
    } catch (error: any) {
      this.logger.warn(`Initial subscription reconciliation could not complete: ${error.message}`);
    }
  }

  private invoiceNumber() {
    return `INV-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  }

  private durationMonths(cycle: string) {
    return cycle === 'YEARLY' ? 12 : 1;
  }

  async assignSubscription(
    companyId: string,
    planId: string,
    billingCycle: 'MONTHLY' | 'YEARLY' = 'MONTHLY',
    adminId?: string,
  ) {
    if (!['MONTHLY', 'YEARLY'].includes(billingCycle)) {
      throw new BadRequestException('Billing cycle must be MONTHLY or YEARLY');
    }
    const [company, plan] = await Promise.all([
      this.central.company.findUnique({ where: { id: companyId } }),
      this.central.subscriptionPlan.findUnique({ where: { id: planId } }),
    ]);
    if (!company) throw new NotFoundException(`Company with ID '${companyId}' not found`);
    if (!plan) throw new NotFoundException(`Plan with ID '${planId}' not found`);
    if (!plan.isActive) throw new BadRequestException('Inactive subscription plans cannot be assigned');

    const now = new Date();
    const periodEnd = addBillingPeriod(now, billingCycle);
    const amount = Number(billingCycle === 'YEARLY' ? plan.priceYearly : plan.priceMonthly);
    const activeSubscription = await this.central.tenantSubscription.findFirst({
      where: { companyId, status: 'ACTIVE', expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    const kind = activeSubscription ? 'PLAN_CHANGE' : 'INITIAL';

    const result = await this.central.$transaction(async (tx: any) => {
      const pending = await tx.tenantSubscription.findMany({
        where: { companyId, status: 'PENDING' },
        select: { id: true },
      });
      const pendingIds = pending.map((row: any) => row.id);
      if (pendingIds.length) {
        await tx.invoice.updateMany({
          where: { subscriptionId: { in: pendingIds }, status: { in: OPEN_INVOICE_STATUSES } },
          data: { status: 'CANCELLED', cancelledAt: now },
        });
        await tx.tenantSubscription.updateMany({
          where: { id: { in: pendingIds } },
          data: { status: 'CANCELLED', cancelledAt: now },
        });
      }

      const snapshot = planEntitlements(plan);
      const subscription = await tx.tenantSubscription.create({
        data: {
          companyId,
          planId,
          billingCycle,
          status: 'PENDING',
          amount,
          startAt: now,
          expiresAt: periodEnd,
          nextBillingAt: periodEnd,
          autoRenew: true,
          entitlementSnapshot: snapshot,
        },
      });
      const dueDate = new Date(now.getTime() + INVOICE_DUE_DAYS * DAY);
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: this.invoiceNumber(),
          companyId,
          subscriptionId: subscription.id,
          amount,
          kind,
          status: 'UNPAID',
          dueDate,
          expiresAt: new Date(now.getTime() + INVOICE_EXPIRY_DAYS * DAY),
          periodStart: now,
          periodEnd,
          idempotencyKey: `ASSIGN_${subscription.id}`,
          notes: `${kind === 'PLAN_CHANGE' ? 'Plan change' : 'Initial subscription'} invoice for ${plan.name} (${billingCycle})`,
        },
      });
      if (!activeSubscription) {
        await tx.company.update({
          where: { id: companyId },
          data: {
            subscriptionStatus: 'PENDING',
            accessGranted: false,
            autoRecur: true,
            version: { increment: 1 },
          },
        });
      }
      await tx.subscriptionTransaction.create({
        data: {
          companyId,
          transactionType: kind === 'PLAN_CHANGE' ? 'PLAN_CHANGE_REQUESTED' : 'SUBSCRIPTION_ASSIGNED',
          amount,
          termDurationMonths: this.durationMonths(billingCycle),
          previousStatus: company.subscriptionStatus,
          newStatus: activeSubscription ? company.subscriptionStatus : 'PENDING',
          approvedBy: adminId,
          notes: `${plan.name} assigned; activation is pending invoice payment`,
        },
      });
      return { subscription, invoice };
    });

    if (amount === 0) {
      const paidInvoice = await this.markInvoicePaid(result.invoice.id, 'NO_CHARGE', adminId);
      return { ...result, invoice: paidInvoice, activated: true };
    }
    return { ...result, activated: false };
  }

  async markInvoicePaid(
    invoiceId: string,
    paymentMethod = 'MANUAL_BANK_TRANSFER',
    adminId?: string,
  ) {
    const invoice = await this.central.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        company: true,
        subscription: { include: { plan: true } },
      },
    });
    if (!invoice) throw new NotFoundException(`Invoice '${invoiceId}' not found`);
    if (invoice.status === 'PAID') return invoice;
    if (['CANCELLED', 'EXPIRED'].includes(invoice.status)) {
      throw new ConflictException(`A ${invoice.status.toLowerCase()} invoice cannot be paid`);
    }
    const now = new Date();
    if (new Date(invoice.expiresAt) <= now) {
      await this.expireInvoice(invoice);
      throw new ConflictException('Invoice has expired and must be reissued');
    }
    if (!invoice.subscription) {
      return this.markDirectInvoicePaid(invoice, paymentMethod, adminId, now);
    }
    if (!invoice.subscription || !invoice.subscription.plan) {
      throw new BadRequestException('Invoice is not connected to a valid subscription');
    }
    if (!invoice.subscription.plan.isActive && invoice.kind !== 'RENEWAL') {
      throw new BadRequestException('The assigned plan is no longer available');
    }

    return this.central.$transaction(async (tx: any) => {
      const currentInvoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (currentInvoice.status === 'PAID') return currentInvoice;
      const subscription = invoice.subscription;
      if (subscription.status === 'CANCELLED') {
        throw new ConflictException('The subscription request was cancelled');
      }
      const plan = subscription.plan;
      const snapshot = planEntitlements(plan);
      const periodStart = invoice.kind === 'RENEWAL'
        ? new Date(invoice.periodStart)
        : now;
      const periodEnd = invoice.kind === 'RENEWAL'
        ? new Date(invoice.periodEnd)
        : addBillingPeriod(periodStart, subscription.billingCycle);
      const claim = await tx.invoice.updateMany({
        where: { id: invoiceId, status: { in: OPEN_INVOICE_STATUSES } },
        data: {
          status: 'PAID',
          paidAt: now,
          paymentMethod,
          periodStart,
          periodEnd,
        },
      });
      if (!claim.count) {
        const settled = await tx.invoice.findUnique({ where: { id: invoiceId } });
        if (settled?.status === 'PAID') return settled;
        throw new ConflictException('Invoice status changed before payment could be recorded');
      }

      if (invoice.kind !== 'RENEWAL') {
        await tx.tenantSubscription.updateMany({
          where: {
            companyId: invoice.companyId,
            id: { not: subscription.id },
            status: { in: ['ACTIVE', 'SUSPENDED'] },
          },
          data: { status: 'CANCELLED', cancelledAt: now, autoRenew: false },
        });
      }
      await tx.tenantSubscription.update({
        where: { id: subscription.id },
        data: {
          status: 'ACTIVE',
          amount: invoice.amount,
          startAt: periodStart,
          expiresAt: periodEnd,
          nextBillingAt: periodEnd,
          activatedAt: subscription.activatedAt || now,
          suspendedAt: null,
          cancelledAt: null,
          entitlementSnapshot: snapshot,
          version: { increment: 1 },
        },
      });
      const entitlementData = this.entitlements.companyEntitlementData(
        plan,
        this.entitlements.tenantModulesFromCompany(invoice.company),
      );
      await tx.company.update({
        where: { id: invoice.companyId },
        data: {
          ...entitlementData,
          planTier: legacyPlanTier(plan.key),
          subscriptionStatus: 'ACTIVE',
          subscriptionAmount: invoice.amount,
          termDurationMonths: this.durationMonths(subscription.billingCycle),
          subscriptionStartAt: periodStart,
          subscriptionExpiresAt: periodEnd,
          autoRecur: subscription.autoRenew,
          accessGranted: true,
          ...(invoice.company.status === 'PENDING_SETUP' ? { status: 'ACTIVE' } : {}),
          version: { increment: 1 },
        },
      });
      await tx.subscriptionTransaction.create({
        data: {
          companyId: invoice.companyId,
          transactionType: invoice.kind === 'RENEWAL'
            ? 'RENEWAL_PAYMENT'
            : invoice.kind === 'PLAN_CHANGE'
              ? 'PLAN_CHANGED'
              : 'ACTIVATION',
          amount: invoice.amount,
          termDurationMonths: this.durationMonths(subscription.billingCycle),
          previousStatus: invoice.company.subscriptionStatus,
          newStatus: 'ACTIVE',
          startAt: periodStart,
          expiresAt: periodEnd,
          approvedBy: adminId,
          notes: `Invoice ${invoice.invoiceNumber} paid via ${paymentMethod}`,
        },
      });
      return tx.invoice.findUnique({ where: { id: invoiceId } });
    });
  }

  async createRenewalInvoice(companyId: string, adminId?: string) {
    const now = new Date();
    const subscription = await this.central.tenantSubscription.findFirst({
      where: {
        companyId,
        status: { in: ['ACTIVE', 'EXPIRED'] },
      },
      include: { company: true, plan: true },
      orderBy: { expiresAt: 'desc' },
    });
    if (!subscription) return this.createDirectRenewalInvoice(companyId, adminId, now);
    const existing = await this.central.invoice.findFirst({
      where: {
        subscriptionId: subscription.id,
        kind: 'RENEWAL',
        status: { in: OPEN_INVOICE_STATUSES },
      },
    });
    if (existing) return existing;

    const periodStart = new Date(subscription.expiresAt) > now
      ? new Date(subscription.expiresAt)
      : now;
    const periodEnd = addBillingPeriod(periodStart, subscription.billingCycle);
    const dueDate = periodStart > now
      ? periodStart
      : new Date(now.getTime() + INVOICE_DUE_DAYS * DAY);
    const invoice = await this.central.invoice.create({
      data: {
        invoiceNumber: this.invoiceNumber(),
        companyId,
        subscriptionId: subscription.id,
        amount: subscription.amount,
        kind: 'RENEWAL',
        status: 'UNPAID',
        dueDate,
        expiresAt: new Date(Math.max(periodStart.getTime(), now.getTime()) + INVOICE_EXPIRY_DAYS * DAY),
        periodStart,
        periodEnd,
        idempotencyKey: `RENEW_${subscription.id}_${periodStart.toISOString()}`,
        notes: `Renewal invoice for ${subscription.plan.name} (${subscription.billingCycle})`,
      },
    });
    await this.central.subscriptionTransaction.create({
      data: {
        companyId,
        transactionType: 'RENEWAL_INVOICE_CREATED',
        amount: subscription.amount,
        termDurationMonths: this.durationMonths(subscription.billingCycle),
        previousStatus: subscription.company.subscriptionStatus,
        newStatus: subscription.company.subscriptionStatus,
        startAt: periodStart,
        expiresAt: periodEnd,
        approvedBy: adminId,
        notes: `Invoice ${invoice.invoiceNumber} created`,
      },
    });
    if (Number(invoice.amount) === 0) {
      return this.markInvoicePaid(invoice.id, 'NO_CHARGE', adminId);
    }
    return invoice;
  }

  async suspendSubscription(companyId: string, adminId?: string, notes?: string) {
    return this.changeSubscriptionStatus(companyId, 'SUSPENDED', adminId, notes);
  }

  async resumeSubscription(companyId: string, adminId?: string, notes?: string) {
    const subscription = await this.central.tenantSubscription.findFirst({
      where: { companyId, status: 'SUSPENDED' },
      include: { company: true, plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) return this.resumeDirectSubscription(companyId, adminId, notes);
    const now = new Date();
    if (new Date(subscription.expiresAt) <= now) {
      throw new BadRequestException('Expired subscriptions cannot be resumed; create a renewal invoice');
    }
    return this.central.$transaction(async (tx: any) => {
      await tx.tenantSubscription.update({
        where: { id: subscription.id },
        data: { status: 'ACTIVE', suspendedAt: null, version: { increment: 1 } },
      });
      await tx.company.update({
        where: { id: companyId },
        data: {
          subscriptionStatus: 'ACTIVE',
          accessGranted: true,
          version: { increment: 1 },
        },
      });
      await this.logStatus(tx, subscription, 'RESUMPTION', 'ACTIVE', adminId, notes);
      return { status: 'ACTIVE' };
    });
  }

  async cancelSubscription(companyId: string, adminId?: string, notes?: string) {
    return this.changeSubscriptionStatus(companyId, 'CANCELLED', adminId, notes);
  }

  async setAutoRenew(companyId: string, autoRenew: boolean, adminId?: string) {
    const subscription = await this.latestSubscription(companyId, ['ACTIVE', 'SUSPENDED']);
    await this.central.$transaction(async (tx: any) => {
      await tx.tenantSubscription.update({
        where: { id: subscription.id },
        data: { autoRenew, version: { increment: 1 } },
      });
      await tx.company.update({
        where: { id: companyId },
        data: { autoRecur: autoRenew, version: { increment: 1 } },
      });
      await tx.subscriptionTransaction.create({
        data: {
          companyId,
          transactionType: 'AUTO_RENEW_UPDATED',
          previousStatus: subscription.status,
          newStatus: subscription.status,
          approvedBy: adminId,
          notes: `Automatic renewal ${autoRenew ? 'enabled' : 'disabled'}`,
        },
      });
    });
    return { autoRenew };
  }

  async cancelInvoice(invoiceId: string, adminId?: string, notes?: string) {
    const invoice = await this.central.invoice.findUnique({
      where: { id: invoiceId },
      include: { subscription: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'PAID') throw new ConflictException('Paid invoices cannot be cancelled');
    if (invoice.status === 'CANCELLED') return invoice;
    const now = new Date();
    return this.central.$transaction(async (tx: any) => {
      const claim = await tx.invoice.updateMany({
        where: { id: invoiceId, status: { in: ['DRAFT', ...OPEN_INVOICE_STATUSES] } },
        data: { status: 'CANCELLED', cancelledAt: now, notes: notes || invoice.notes },
      });
      if (!claim.count) {
        const current = await tx.invoice.findUnique({ where: { id: invoiceId } });
        if (current?.status === 'CANCELLED') return current;
        throw new ConflictException(`A ${String(current?.status || 'changed').toLowerCase()} invoice cannot be cancelled`);
      }
      if (invoice.subscription?.status === 'PENDING') {
        await tx.tenantSubscription.update({
          where: { id: invoice.subscription.id },
          data: { status: 'CANCELLED', cancelledAt: now },
        });
      }
      await tx.subscriptionTransaction.create({
        data: {
          companyId: invoice.companyId,
          transactionType: 'INVOICE_CANCELLED',
          amount: invoice.amount,
          previousStatus: invoice.status,
          newStatus: 'CANCELLED',
          approvedBy: adminId,
          notes: `Invoice ${invoice.invoiceNumber} cancelled`,
        },
      });
      return tx.invoice.findUnique({ where: { id: invoiceId } });
    });
  }

  async reconcileBillingLifecycle(now = new Date()) {
    const overdue = await this.central.invoice.updateMany({
      where: { status: 'UNPAID', dueDate: { lt: now }, expiresAt: { gt: now } },
      data: { status: 'OVERDUE' },
    });
    const expiredInvoices = await this.central.invoice.findMany({
      where: { status: { in: OPEN_INVOICE_STATUSES }, expiresAt: { lte: now } },
      include: { subscription: true },
    });
    for (const invoice of expiredInvoices) await this.expireInvoice(invoice);

    const expiredSubscriptions = await this.central.tenantSubscription.findMany({
      where: { status: { in: ['ACTIVE', 'SUSPENDED'] }, expiresAt: { lte: now } },
      include: { company: true },
    });
    for (const subscription of expiredSubscriptions) {
      await this.central.$transaction(async (tx: any) => {
        const claim = await tx.tenantSubscription.updateMany({
          where: {
            id: subscription.id,
            status: { in: ['ACTIVE', 'SUSPENDED'] },
            expiresAt: { lte: now },
          },
          data: { status: 'EXPIRED', version: { increment: 1 } },
        });
        if (!claim.count) return;
        await tx.company.update({
          where: { id: subscription.companyId },
          data: {
            subscriptionStatus: 'EXPIRED',
            accessGranted: false,
            version: { increment: 1 },
          },
        });
        await this.logStatus(tx, subscription, 'EXPIRATION', 'EXPIRED', undefined, 'Paid subscription period ended');
      });
    }
    const expiredDirectSubscriptions = await this.central.company.findMany({
      where: {
        subscriptionStatus: { in: ['ACTIVE', 'SUSPENDED'] },
        subscriptionExpiresAt: { lte: now },
        subscriptions: { none: { status: { in: ['ACTIVE', 'SUSPENDED'] } } },
      },
    });
    for (const company of expiredDirectSubscriptions) {
      await this.central.$transaction(async (tx: any) => {
        const claim = await tx.company.updateMany({
          where: {
            id: company.id,
            subscriptionStatus: { in: ['ACTIVE', 'SUSPENDED'] },
            subscriptionExpiresAt: { lte: now },
          },
          data: { subscriptionStatus: 'EXPIRED', accessGranted: false, version: { increment: 1 } },
        });
        if (!claim.count) return;
        await tx.subscriptionTransaction.create({
          data: {
            companyId: company.id,
            transactionType: 'EXPIRATION',
            previousStatus: company.subscriptionStatus,
            newStatus: 'EXPIRED',
            startAt: company.subscriptionStartAt,
            expiresAt: company.subscriptionExpiresAt,
            notes: 'Paid subscription period ended',
          },
        });
      });
    }
    return {
      overdue: overdue.count,
      expiredInvoices: expiredInvoices.length,
      expiredSubscriptions: expiredSubscriptions.length + expiredDirectSubscriptions.length,
    };
  }

  async generateUpcomingRenewalInvoices(days = 7) {
    const now = new Date();
    const subscriptions = await this.central.tenantSubscription.findMany({
      where: {
        status: 'ACTIVE',
        autoRenew: true,
        expiresAt: { gt: now, lte: new Date(now.getTime() + days * DAY) },
      },
      select: { companyId: true },
    });
    const invoices = [];
    for (const subscription of subscriptions) {
      invoices.push(await this.createRenewalInvoice(subscription.companyId));
    }
    const directCompanies = await this.central.company.findMany({
      where: {
        subscriptionStatus: 'ACTIVE',
        autoRecur: true,
        subscriptionExpiresAt: { gt: now, lte: new Date(now.getTime() + days * DAY) },
        subscriptions: { none: { status: 'ACTIVE' } },
      },
      select: { id: true },
    });
    for (const company of directCompanies) {
      invoices.push(await this.createDirectRenewalInvoice(company.id, undefined, now));
    }
    return invoices;
  }

  async syncPlanSubscribers(planId: string) {
    const plan = await this.central.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Subscription plan not found');
    const subscriptions = await this.central.tenantSubscription.findMany({
      where: { planId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
      include: { company: true },
    });
    const snapshot = planEntitlements(plan);
    for (const subscription of subscriptions) {
      const amount = Number(subscription.billingCycle === 'YEARLY' ? plan.priceYearly : plan.priceMonthly);
      await this.central.$transaction(async (tx: any) => {
        await tx.tenantSubscription.update({
          where: { id: subscription.id },
          data: { entitlementSnapshot: snapshot, amount, version: { increment: 1 } },
        });
        await tx.invoice.updateMany({
          where: {
            subscriptionId: subscription.id,
            kind: 'RENEWAL',
            status: { in: OPEN_INVOICE_STATUSES },
          },
          data: { amount },
        });
        await tx.company.update({
          where: { id: subscription.companyId },
          data: {
            ...this.entitlements.companyEntitlementData(
              plan,
              this.entitlements.tenantModulesFromCompany(subscription.company),
            ),
            planTier: legacyPlanTier(plan.key),
            subscriptionAmount: amount,
            version: { increment: 1 },
          },
        });
      });
    }
    return { synchronized: subscriptions.length };
  }

  async backfillLegacyEntitlements() {
    const subscriptions = await this.central.tenantSubscription.findMany({
      where: { status: { in: ['ACTIVE', 'SUSPENDED'] } },
      include: { company: true, plan: true },
    });
    let synchronized = 0;
    for (const subscription of subscriptions) {
      const companyEntitlements = subscription.company?.entitlements;
      const snapshot = subscription.entitlementSnapshot;
      const requiresBackfill = !companyEntitlements?.features
        || !snapshot?.features
        || !subscription.company?.planKey;
      if (!requiresBackfill) continue;
      const normalized = planEntitlements(subscription.plan);
      await this.central.$transaction(async (tx: any) => {
        await tx.tenantSubscription.update({
          where: { id: subscription.id },
          data: { entitlementSnapshot: normalized, version: { increment: 1 } },
        });
        await tx.company.update({
          where: { id: subscription.companyId },
          data: {
            ...this.entitlements.companyEntitlementData(
              subscription.plan,
              this.entitlements.tenantModulesFromCompany(subscription.company),
            ),
            planTier: legacyPlanTier(subscription.plan.key),
            version: { increment: 1 },
          },
        });
      });
      synchronized += 1;
    }
    return { synchronized };
  }

  private async latestSubscription(companyId: string, statuses: string[]) {
    const subscription = await this.central.tenantSubscription.findFirst({
      where: { companyId, status: { in: statuses } },
      include: { company: true, plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) throw new BadRequestException('No matching subscription was found');
    return subscription;
  }

  private async changeSubscriptionStatus(
    companyId: string,
    status: 'SUSPENDED' | 'CANCELLED',
    adminId?: string,
    notes?: string,
  ) {
    const subscription = await this.central.tenantSubscription.findFirst({
      where: { companyId, status: { in: ['ACTIVE', 'SUSPENDED'] } },
      include: { company: true, plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) return this.changeDirectSubscriptionStatus(companyId, status, adminId, notes);
    if (subscription.status === status) return { status };
    const now = new Date();
    return this.central.$transaction(async (tx: any) => {
      await tx.tenantSubscription.update({
        where: { id: subscription.id },
        data: {
          status,
          autoRenew: status === 'CANCELLED' ? false : subscription.autoRenew,
          suspendedAt: status === 'SUSPENDED' ? now : subscription.suspendedAt,
          cancelledAt: status === 'CANCELLED' ? now : null,
          version: { increment: 1 },
        },
      });
      await tx.company.update({
        where: { id: companyId },
        data: {
          subscriptionStatus: status,
          accessGranted: false,
          ...(status === 'CANCELLED' ? { autoRecur: false } : {}),
          version: { increment: 1 },
        },
      });
      await this.logStatus(
        tx,
        subscription,
        status === 'SUSPENDED' ? 'SUSPENSION' : 'CANCELLATION',
        status,
        adminId,
        notes,
      );
      return { status };
    });
  }

  private async createDirectRenewalInvoice(companyId: string, adminId?: string, now = new Date()) {
    const invoice = await this.central.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT id FROM tenants WHERE id = $1 FOR UPDATE', companyId);
      const company = await tx.company.findUnique({ where: { id: companyId } });
      if (!company) throw new NotFoundException('Company not found');
      if (!['ACTIVE', 'EXPIRED'].includes(company.subscriptionStatus)) {
        throw new BadRequestException('No active subscription is available to renew');
      }
      const existing = await tx.invoice.findFirst({
        where: { companyId, subscriptionId: null, kind: 'RENEWAL', status: { in: OPEN_INVOICE_STATUSES } },
      });
      if (existing) return existing;
      const months = Number(company.termDurationMonths || 0);
      if (months < 1 || company.subscriptionAmount == null) {
        throw new BadRequestException('Configure the company subscription before renewing it');
      }
      const periodStart = company.subscriptionExpiresAt && new Date(company.subscriptionExpiresAt) > now
        ? new Date(company.subscriptionExpiresAt)
        : now;
      const periodEnd = addBillingMonths(periodStart, months);
      const invoice = await tx.invoice.create({
        data: {
          invoiceNumber: this.invoiceNumber(),
          companyId,
          amount: company.subscriptionAmount,
          kind: 'RENEWAL',
          status: 'UNPAID',
          dueDate: periodStart > now ? periodStart : new Date(now.getTime() + INVOICE_DUE_DAYS * DAY),
          expiresAt: new Date(Math.max(periodStart.getTime(), now.getTime()) + INVOICE_EXPIRY_DAYS * DAY),
          periodStart,
          periodEnd,
          idempotencyKey: `DIRECT_RENEW_${companyId}_${periodStart.toISOString()}`,
          notes: `Renewal invoice for ${company.name}`,
        },
      });
      await tx.subscriptionTransaction.create({
        data: {
          companyId,
          transactionType: 'RENEWAL_INVOICE_CREATED',
          amount: company.subscriptionAmount,
          termDurationMonths: months,
          previousStatus: company.subscriptionStatus,
          newStatus: company.subscriptionStatus,
          startAt: periodStart,
          expiresAt: periodEnd,
          approvedBy: adminId,
          notes: `Invoice ${invoice.invoiceNumber} created`,
        },
      });
      return invoice;
    });
    if (Number(invoice.amount) === 0) return this.markInvoicePaid(invoice.id, 'NO_CHARGE', adminId);
    return invoice;
  }

  private async markDirectInvoicePaid(invoice: any, paymentMethod: string, adminId: string | undefined, now: Date) {
    return this.central.$transaction(async (tx: any) => {
      const claim = await tx.invoice.updateMany({
        where: { id: invoice.id, status: { in: OPEN_INVOICE_STATUSES } },
        data: { status: 'PAID', paidAt: now, paymentMethod },
      });
      if (!claim.count) {
        const settled = await tx.invoice.findUnique({ where: { id: invoice.id } });
        if (settled?.status === 'PAID') return settled;
        throw new ConflictException('Invoice status changed before payment could be recorded');
      }
      await tx.company.update({
        where: { id: invoice.companyId },
        data: {
          subscriptionStatus: 'ACTIVE',
          subscriptionAmount: invoice.amount,
          subscriptionStartAt: invoice.periodStart,
          subscriptionExpiresAt: invoice.periodEnd,
          accessGranted: true,
          ...(invoice.company.status === 'PENDING_SETUP' ? { status: 'ACTIVE' } : {}),
          version: { increment: 1 },
        },
      });
      await tx.subscriptionTransaction.create({
        data: {
          companyId: invoice.companyId,
          transactionType: invoice.kind === 'RENEWAL' ? 'RENEWAL_PAYMENT' : 'ACTIVATION',
          amount: invoice.amount,
          termDurationMonths: invoice.company.termDurationMonths,
          previousStatus: invoice.company.subscriptionStatus,
          newStatus: 'ACTIVE',
          startAt: invoice.periodStart,
          expiresAt: invoice.periodEnd,
          approvedBy: adminId,
          notes: `Invoice ${invoice.invoiceNumber} paid via ${paymentMethod}`,
        },
      });
      return tx.invoice.findUnique({ where: { id: invoice.id } });
    });
  }

  private async changeDirectSubscriptionStatus(
    companyId: string,
    status: 'SUSPENDED' | 'CANCELLED',
    adminId?: string,
    notes?: string,
  ) {
    const company = await this.central.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (!['ACTIVE', 'SUSPENDED'].includes(company.subscriptionStatus)) {
      throw new BadRequestException('No matching subscription was found');
    }
    if (company.subscriptionStatus === status) return { status };
    await this.central.$transaction(async (tx: any) => {
      await tx.company.update({
        where: { id: companyId },
        data: {
          subscriptionStatus: status,
          accessGranted: false,
          ...(status === 'CANCELLED' ? { autoRecur: false } : {}),
          version: { increment: 1 },
        },
      });
      await tx.subscriptionTransaction.create({
        data: {
          companyId,
          transactionType: status === 'SUSPENDED' ? 'SUSPENSION' : 'CANCELLATION',
          previousStatus: company.subscriptionStatus,
          newStatus: status,
          approvedBy: adminId,
          notes,
        },
      });
    });
    return { status };
  }

  private async resumeDirectSubscription(companyId: string, adminId?: string, notes?: string) {
    const company = await this.central.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');
    if (company.subscriptionStatus !== 'SUSPENDED') {
      throw new BadRequestException('No matching subscription was found');
    }
    if (!company.subscriptionExpiresAt || new Date(company.subscriptionExpiresAt) <= new Date()) {
      throw new BadRequestException('Expired subscriptions cannot be resumed; configure a new subscription term');
    }
    await this.central.$transaction(async (tx: any) => {
      await tx.company.update({
        where: { id: companyId },
        data: { subscriptionStatus: 'ACTIVE', accessGranted: true, version: { increment: 1 } },
      });
      await tx.subscriptionTransaction.create({
        data: {
          companyId,
          transactionType: 'RESUMPTION',
          previousStatus: company.subscriptionStatus,
          newStatus: 'ACTIVE',
          approvedBy: adminId,
          notes,
        },
      });
    });
    return { status: 'ACTIVE' };
  }

  private async expireInvoice(invoice: any) {
    const now = new Date();
    return this.central.$transaction(async (tx: any) => {
      const claim = await tx.invoice.updateMany({
        where: { id: invoice.id, status: { in: OPEN_INVOICE_STATUSES } },
        data: { status: 'EXPIRED' },
      });
      if (!claim.count) return;
      if (invoice.subscription?.status === 'PENDING') {
        await tx.tenantSubscription.update({
          where: { id: invoice.subscription.id },
          data: { status: 'CANCELLED', cancelledAt: now, autoRenew: false },
        });
      }
      await tx.subscriptionTransaction.create({
        data: {
          companyId: invoice.companyId,
          transactionType: 'INVOICE_EXPIRED',
          amount: invoice.amount,
          previousStatus: invoice.status,
          newStatus: 'EXPIRED',
          notes: `Invoice ${invoice.invoiceNumber} expired without payment`,
        },
      });
    });
  }

  async extendInvoiceDueDate(invoiceId: string, extendDays = 7, newDueDateStr?: string) {
    const invoice = await this.central.invoice.findUnique({
      where: { id: invoiceId },
      include: { company: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    let newDueDate: Date;
    if (newDueDateStr) {
      newDueDate = new Date(newDueDateStr);
      if (isNaN(newDueDate.getTime())) throw new BadRequestException('Invalid due date provided');
    } else {
      const baseDate = new Date(invoice.dueDate > new Date() ? invoice.dueDate : new Date());
      newDueDate = new Date(baseDate.getTime() + extendDays * 24 * 60 * 60 * 1000);
    }

    const newStatus = newDueDate > new Date() ? 'UNPAID' : invoice.status;
    const updated = await this.central.invoice.update({
      where: { id: invoiceId },
      data: {
        dueDate: newDueDate,
        status: newStatus,
      },
    });

    await this.central.subscriptionTransaction.create({
      data: {
        companyId: invoice.companyId,
        transactionType: 'INVOICE_EXTENSION',
        amount: invoice.amount,
        previousStatus: invoice.status,
        newStatus,
        notes: `Extended invoice ${invoice.invoiceNumber} due date to ${newDueDate.toISOString().slice(0, 10)}`,
      },
    });

    return updated;
  }

  private logStatus(
    tx: any,
    subscription: any,
    transactionType: string,
    status: string,
    adminId?: string,
    notes?: string,
  ) {
    return tx.subscriptionTransaction.create({
      data: {
        companyId: subscription.companyId,
        transactionType,
        amount: subscription.amount,
        termDurationMonths: this.durationMonths(subscription.billingCycle),
        previousStatus: subscription.status,
        newStatus: status,
        startAt: subscription.startAt,
        expiresAt: subscription.expiresAt,
        approvedBy: adminId,
        notes,
      },
    });
  }
}

