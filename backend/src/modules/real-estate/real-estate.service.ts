import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DealDto,
  PropertyDto,
  RentalContractDto,
  RentPaymentDto,
  TenantDto,
} from './real-estate.dto';
import { SubscriptionEntitlementService } from '../../common/subscriptions/subscription-entitlement.service';
import { AccountingService } from '../accounting/accounting.service';

@Injectable()
export class RealEstateService {
  constructor(
    private readonly entitlements: SubscriptionEntitlementService,
    private readonly accounting: AccountingService,
  ) {}

  // Financial source records and journal entries commit atomically.
  getProperties(tenantDb: any, query?: { type?: string; status?: string; search?: string }) {
    const where: any = { deletedAt: null };
    if (query?.type) where.type = query.type;
    if (query?.status) where.status = query.status;
    if (query?.search) where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { address: { contains: query.search, mode: 'insensitive' } },
    ];
    return tenantDb.property.findMany({
      where,
      include: {
        _count: { select: { deals: true, rentalContracts: true, tenants: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getPropertyOptions(tenantDb: any) {
    return tenantDb.property.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    });
  }

  async getProperty(tenantDb: any, id: string) {
    const property = await tenantDb.property.findFirst({
      where: { id, deletedAt: null },
      include: {
        deals: { where: { deletedAt: null }, include: { client: true }, orderBy: { createdAt: 'desc' } },
        rentalContracts: { where: { deletedAt: null }, include: { tenant: true, payments: true } },
        tenants: { where: { deletedAt: null } },
        transactions: { where: { deletedAt: null }, orderBy: { date: 'desc' }, take: 50 },
      },
    });
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  async createProperty(tenantDb: any, companyId: string, data: PropertyDto) {
    return this.entitlements.withinTenantQuota(
      companyId,
      tenantDb,
      'properties',
      (tx) => tx.property.create({
        data: { ...data, type: data.type as any, status: 'AVAILABLE' },
      }),
    );
  }

  async updateProperty(tenantDb: any, id: string, data: PropertyDto) {
    const { status: _status, ...propertyData } = data;
    const where: any = { id, deletedAt: null };
    if (data.version !== undefined) where.version = data.version;
    const result = await tenantDb.property.updateMany({
      where,
      data: {
        ...propertyData,
        type: propertyData.type as any,
        version: { increment: 1 },
      },
    });
    if (!result.count) throw new ConflictException('Property changed or no longer exists; reload and retry');
    return tenantDb.property.findUnique({ where: { id } });
  }

  async deleteProperty(tenantDb: any, id: string) {
    const [deals, contracts] = await Promise.all([
      tenantDb.deal.count({ where: { propertyId: id, deletedAt: null } }),
      tenantDb.rentalContract.count({ where: { propertyId: id, deletedAt: null } }),
    ]);
    if (deals || contracts) throw new ConflictException('Property has active deals or rental contracts');
    const result = await tenantDb.property.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (!result.count) throw new NotFoundException('Property not found');
    return { deleted: true };
  }

  getDeals(
    tenantDb: any,
    query?: { propertyId?: string; clientId?: string; paymentStatus?: string },
  ) {
    const where: any = { deletedAt: null };
    if (query?.propertyId) where.propertyId = query.propertyId;
    if (query?.clientId) where.clientId = query.clientId;
    if (query?.paymentStatus) where.paymentStatus = query.paymentStatus;
    return tenantDb.deal.findMany({
      where,
      include: { property: true, client: true, createdBy: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  getTenantOptions(tenantDb: any) {
    return tenantDb.tenant.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async getDeal(tenantDb: any, id: string) {
    const deal = await tenantDb.deal.findFirst({
      where: { id, deletedAt: null },
      include: { property: true, client: true, createdBy: true, transactions: { where: { deletedAt: null } } },
    });
    if (!deal) throw new NotFoundException('Deal not found');
    return deal;
  }

  async createDeal(tenantDb: any, userId: string, data: DealDto) {
    this.validateDealAmounts(data);
    return tenantDb.$transaction(async (tx: any) => {
      await this.claimAvailableProperty(tx, data.propertyId);
      const client = await tx.tenant.findFirst({ where: { id: data.clientId, deletedAt: null } });
      if (!client) throw new NotFoundException('Client not found');
      const paidAmount = Number(data.paidAmount || 0);
      const paymentStatus = this.dealPaymentStatus(Number(data.totalAmount), paidAmount);
      const deal = await tx.deal.create({
        data: {
          ...data,
          type: data.type as any,
          paymentStatus: paymentStatus as any,
          paidAmount,
          createdById: userId,
        },
      });
      await this.syncDealPropertyStatus(tx, data.propertyId);
      await this.syncDealLedger(tx, deal);
      return deal;
    });
  }

  async updateDeal(tenantDb: any, id: string, data: DealDto) {
    this.validateDealAmounts(data);
    return tenantDb.$transaction(async (tx: any) => {
      const existing = await tx.deal.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Deal not found');
      if (data.propertyId !== existing.propertyId) await this.claimAvailableProperty(tx, data.propertyId);
      const where: any = { id, deletedAt: null };
      if (data.version !== undefined) where.version = data.version;
      const paidAmount = Number(data.paidAmount ?? existing.paidAmount ?? 0);
      const totalAmount = Number(data.totalAmount ?? existing.totalAmount);
      const paymentStatus = this.dealPaymentStatus(totalAmount, paidAmount);
      const result = await tx.deal.updateMany({
        where,
        data: {
          ...data,
          type: data.type as any,
          paidAmount,
          totalAmount,
          paymentStatus: paymentStatus as any,
          version: { increment: 1 },
        },
      });
      if (!result.count) throw new ConflictException('Deal changed or no longer exists; reload and retry');
      const deal = await tx.deal.findUnique({ where: { id } });
      await this.syncDealPropertyStatus(tx, deal.propertyId);
      if (existing.propertyId !== deal.propertyId) await this.syncDealPropertyStatus(tx, existing.propertyId);
      await this.syncDealLedger(tx, deal);
      return deal;
    }, { timeout: 15_000 });
  }

  async deleteDeal(tenantDb: any, id: string) {
    return tenantDb.$transaction(async (tx: any) => {
      const deal = await tx.deal.findFirst({ where: { id, deletedAt: null } });
      if (!deal) throw new NotFoundException('Deal not found');
      await tx.deal.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await tx.transaction.updateMany({
        where: { dealId: id, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.accounting.retractPriorForSource(tx, 'DEAL', id);
      await this.syncDealPropertyStatus(tx, deal.propertyId);
      return { deleted: true };
    });
  }

  getTenants(tenantDb: any) {
    return tenantDb.tenant.findMany({
      where: { deletedAt: null },
      include: { property: true, contracts: { where: { deletedAt: null } }, rentPayments: { where: { deletedAt: null } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  createTenant(tenantDb: any, data: TenantDto) {
    return tenantDb.tenant.create({ data });
  }

  async updateTenant(tenantDb: any, id: string, data: TenantDto) {
    const result = await tenantDb.tenant.updateMany({ where: { id, deletedAt: null }, data });
    if (!result.count) throw new NotFoundException('Tenant not found');
    return tenantDb.tenant.findUnique({ where: { id } });
  }

  async deleteTenant(tenantDb: any, id: string) {
    const active = await tenantDb.rentalContract.count({
      where: { tenantId: id, deletedAt: null, status: { in: ['ACTIVE', 'RENEWAL_DUE'] } },
    });
    if (active) throw new ConflictException('Tenant has an active rental contract');
    const deals = await tenantDb.deal.count({ where: { clientId: id, deletedAt: null } });
    if (deals) throw new ConflictException('Client has active deals');
    const result = await tenantDb.tenant.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Tenant not found');
    return { deleted: true };
  }

  getRentalContracts(tenantDb: any) {
    return tenantDb.rentalContract.findMany({
      where: { deletedAt: null },
      include: { tenant: true, property: true, payments: { where: { deletedAt: null } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createRentalContract(tenantDb: any, data: RentalContractDto) {
    this.validateDateRange(data.startDate, data.endDate);
    return tenantDb.$transaction(async (tx: any) => {
      const property = await this.lockPropertyRow(tx, data.propertyId);
      if (property.status === 'SOLD') throw new BadRequestException('Sold property cannot be rented');
      const activeContract = await tx.rentalContract.findFirst({
        where: {
          propertyId: data.propertyId,
          deletedAt: null,
          status: { in: ['ACTIVE', 'RENEWAL_DUE'] },
        },
      });
      if (activeContract) throw new ConflictException('Property already has an active rental contract');
      const tenant = await tx.tenant.findFirst({ where: { id: data.tenantId, deletedAt: null } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      const contract = await tx.rentalContract.create({
        data: { ...data, status: 'ACTIVE' },
      });
      await tx.property.update({
        where: { id: data.propertyId },
        data: { status: 'RENTED', version: { increment: 1 } },
      });
      await tx.tenant.update({ where: { id: data.tenantId }, data: { propertyId: data.propertyId } });
      return contract;
    });
  }

  async updateRentalContract(tenantDb: any, id: string, data: RentalContractDto) {
    this.validateDateRange(data.startDate, data.endDate);
    return tenantDb.$transaction(async (tx: any) => {
      const existing = await tx.rentalContract.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Rental contract not found');
      const targetPropertyId = data.propertyId || existing.propertyId;
      const targetStatus = existing.status;
      // Lock every affected property in a deterministic order so concurrent
      // updates cannot double-assign the same property.
      const propertyIds = [...new Set([existing.propertyId, targetPropertyId])].sort();
      for (const propertyId of propertyIds) {
        await this.lockPropertyRow(tx, propertyId);
      }
      if (['ACTIVE', 'RENEWAL_DUE'].includes(targetStatus)) {
        const activeContract = await tx.rentalContract.findFirst({
          where: {
            id: { not: id },
            propertyId: targetPropertyId,
            deletedAt: null,
            status: { in: ['ACTIVE', 'RENEWAL_DUE'] },
          },
        });
        if (activeContract) throw new ConflictException('Property already has an active rental contract');
      }
      const contract = await tx.rentalContract.update({
        where: { id },
        data: { ...data, status: existing.status },
      });
      await this.syncDealPropertyStatus(tx, contract.propertyId);
      if (existing.propertyId !== contract.propertyId) await this.syncDealPropertyStatus(tx, existing.propertyId);
      await this.syncTenantProperty(tx, existing.tenantId);
      if (existing.tenantId !== contract.tenantId) await this.syncTenantProperty(tx, contract.tenantId);
      return contract;
    });
  }

  async transitionRentalContract(tenantDb: any, id: string, status: string) {
    return tenantDb.$transaction(async (tx: any) => {
      const existing = await tx.rentalContract.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Rental contract not found');
      const allowed: Record<string, string[]> = {
        ACTIVE: ['RENEWAL_DUE', 'EXPIRED', 'TERMINATED'],
        RENEWAL_DUE: ['ACTIVE', 'EXPIRED', 'TERMINATED'],
        EXPIRED: ['ACTIVE', 'TERMINATED'],
        TERMINATED: [],
      };
      if (!allowed[existing.status]?.includes(status)) throw new BadRequestException(`Cannot change ${existing.status} lease to ${status}`);
      const contract = await tx.rentalContract.update({ where: { id }, data: { status: status as any } });
      await this.syncDealPropertyStatus(tx, existing.propertyId);
      await this.syncTenantProperty(tx, existing.tenantId);
      return contract;
    });
  }

  async deleteRentalContract(tenantDb: any, id: string) {
    return tenantDb.$transaction(async (tx: any) => {
      const contract = await tx.rentalContract.findFirst({ where: { id, deletedAt: null } });
      if (!contract) throw new NotFoundException('Rental contract not found');
      await tx.rentalContract.update({ where: { id }, data: { deletedAt: new Date(), status: 'TERMINATED' } });
      await this.syncDealPropertyStatus(tx, contract.propertyId);
      await this.syncTenantProperty(tx, contract.tenantId);
      return { deleted: true };
    });
  }

  getRentPayments(tenantDb: any, status?: string) {
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    return tenantDb.rentPayment.findMany({
      where,
      include: { tenant: true, contract: { include: { property: true } } },
      orderBy: { dueDate: 'desc' },
    });
  }

  async generateMonthlyRentInvoices(tenantDb: any, dateStr?: string) {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const startOfMonth = new Date(Date.UTC(year, month, 1));
    const endOfMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

    let generatedCount = 0;
    let skippedCount = 0;
    let totalAmount = 0;

    await tenantDb.$transaction(async (tx: any) => {
      // Lock every active contract in a deterministic order so concurrent runs
      // serialize: the second run blocks here and then sees the invoices the
      // first run committed, keeping generation idempotent.
      await tx.$queryRaw`
        SELECT "id" FROM "rental_contracts"
        WHERE "status" = 'ACTIVE' AND "deleted_at" IS NULL
        ORDER BY "id" FOR UPDATE`;

      const activeContracts = await tx.rentalContract.findMany({
        where: { status: 'ACTIVE', deletedAt: null },
        include: { tenant: true, property: true },
      });

      for (const contract of activeContracts) {
        const existing = await tx.rentPayment.findFirst({
          where: {
            contractId: contract.id,
            deletedAt: null,
            dueDate: { gte: startOfMonth, lte: endOfMonth },
          },
        });

        if (existing) {
          skippedCount++;
          continue;
        }

        const monthlyRent = Number(contract.monthlyRent || 0);
        if (monthlyRent <= 0) {
          skippedCount++;
          continue;
        }

        const dueDate = new Date(Date.UTC(year, month, 1));
        const payment = await tx.rentPayment.create({
          data: {
            tenantId: contract.tenantId,
            contractId: contract.id,
            amountDue: monthlyRent,
            amountPaid: 0,
            dueDate,
            status: 'UNPAID',
            receiptNo: `INV-${year}${(month + 1).toString().padStart(2, '0')}-${contract.id.slice(-4).toUpperCase()}`,
            notes: `Automated monthly rent invoice for ${contract.tenant?.name || 'Tenant'} · ${contract.property?.title || 'Property'}`,
          },
        });

        await this.syncRentPaymentLedger(tx, payment);
        generatedCount++;
        totalAmount += monthlyRent;
      }
    });

    return {
      message: `Generated ${generatedCount} rent invoice(s) for ${targetDate.toLocaleString('default', { month: 'long', year: 'numeric' })}.`,
      generatedCount,
      skippedCount,
      totalAmount,
    };
  }

  async createRentPayment(tenantDb: any, data: RentPaymentDto) {
    this.validatePayment(data);
    return tenantDb.$transaction(async (tx: any) => {
      if (data.contractId) await this.assertRentPaymentTenant(tx, data.contractId, data.tenantId);
      const amountPaid = Number(data.amountPaid || 0);
      const amountDue = Number(data.amountDue);
      const status = this.paymentStatus(amountDue, amountPaid, new Date(data.dueDate));
      const payment = await tx.rentPayment.create({
        data: {
          ...data,
          status: status as any,
          amountPaid,
          paidDate: amountPaid > 0 ? (data.paidDate ? new Date(data.paidDate) : new Date()) : null,
        },
      });
      await this.syncRentPaymentLedger(tx, payment);
      return payment;
    });
  }

  async updateRentPayment(tenantDb: any, id: string, data: RentPaymentDto) {
    this.validatePayment(data);
    return tenantDb.$transaction(async (tx: any) => {
      const existing = await tx.rentPayment.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Rent payment not found');
      const contractId = data.contractId ?? existing.contractId;
      const tenantId = data.tenantId ?? existing.tenantId;
      if (contractId) await this.assertRentPaymentTenant(tx, contractId, tenantId);
      const amountPaid = Number(data.amountPaid ?? existing.amountPaid ?? 0);
      const amountDue = Number(data.amountDue ?? existing.amountDue);
      const dueDate = data.dueDate ? new Date(data.dueDate) : existing.dueDate;
      const status = this.paymentStatus(amountDue, amountPaid, dueDate);
      const payment = await tx.rentPayment.update({
        where: { id },
        data: {
          ...data,
          amountPaid,
          amountDue,
          status: status as any,
          paidDate: amountPaid > 0 ? (data.paidDate ? new Date(data.paidDate) : existing.paidDate || new Date()) : null,
        },
      });
      await this.syncRentPaymentLedger(tx, payment);
      return payment;
    }, { timeout: 15_000 });
  }

  async updateRentPaymentStatus(tenantDb: any, id: string, status: string) {
    return tenantDb.$transaction(async (tx: any) => {
      const existing = await tx.rentPayment.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Rent payment not found');
      const amountDue = Number(existing.amountDue);
      let amountPaid = Number(existing.amountPaid);
      let paidDate = existing.paidDate;
      if (status === 'PAID') {
        amountPaid = amountDue;
        paidDate = new Date();
      } else if (status === 'UNPAID' || status === 'LATE') {
        amountPaid = 0;
        paidDate = null;
      } else if (status === 'PARTIAL' && !(amountPaid > 0 && amountPaid < amountDue)) {
        throw new BadRequestException('PARTIAL status requires amountPaid between 0 and amountDue');
      }
      const derived = this.paymentStatus(amountDue, amountPaid, existing.dueDate);
      const payment = await tx.rentPayment.update({
        where: { id },
        data: {
          status: derived as any,
          paidDate,
          amountPaid,
        },
      });
      await this.syncRentPaymentLedger(tx, payment);
      return payment;
    }, { timeout: 15_000 });
  }

  async deleteRentPayment(tenantDb: any, id: string) {
    return tenantDb.$transaction(async (tx: any) => {
      const result = await tx.rentPayment.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (!result.count) throw new NotFoundException('Rent payment not found');
      await tx.transaction.updateMany({
        where: { referenceId: { startsWith: `rentpayment:${id}:` }, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.accounting.retractPriorForSource(tx, 'RENT_INVOICE', id);
      await this.accounting.retractPriorForSource(tx, 'RENT_RECEIPT', id);
      await this.accounting.retractPriorForSource(tx, 'RENT_PAYMENT', id);
      return { deleted: true };
    });
  }

  private validateDealAmounts(data: DealDto) {
    if (Number(data.paidAmount || 0) > data.totalAmount) {
      throw new BadRequestException('Paid amount cannot exceed total amount');
    }
  }

  private validatePayment(data: RentPaymentDto) {
    if (Number(data.amountPaid || 0) > data.amountDue) {
      throw new BadRequestException('Paid amount cannot exceed amount due');
    }
  }

  private validateDateRange(start: Date, end: Date) {
    if (new Date(end) < new Date(start)) throw new BadRequestException('End date must be on or after start date');
  }

  private async lockPropertyRow(tx: any, propertyId: string) {
    // Row lock: concurrent claims on the same property serialize, and the
    // waiting transaction re-reads the committed row once the lock releases.
    const rows: any[] = await tx.$queryRaw`
      SELECT "id", "status" FROM "properties"
      WHERE "id" = ${propertyId} AND "deleted_at" IS NULL
      FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('Property not found');
    return rows[0];
  }

  private async claimAvailableProperty(tx: any, propertyId: string) {
    const property = await this.lockPropertyRow(tx, propertyId);
    if (property.status !== 'AVAILABLE') {
      throw new ConflictException('Property is not available for a new deal');
    }
  }

  private async assertRentPaymentTenant(tx: any, contractId: string, tenantId: string) {
    const contract = await tx.rentalContract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, tenantId: true },
    });
    if (!contract) throw new BadRequestException('Rental contract not found');
    if (contract.tenantId !== tenantId) {
      throw new BadRequestException('Tenant does not belong to the specified rental contract');
    }
  }

  private async syncDealPropertyStatus(tx: any, propertyId: string) {
    const activeRental = await tx.rentalContract.findFirst({
      where: { propertyId, deletedAt: null, status: { in: ['ACTIVE', 'RENEWAL_DUE'] } },
    });
    if (activeRental) {
      await tx.property.update({ where: { id: propertyId }, data: { status: 'RENTED', version: { increment: 1 } } });
      return;
    }
    const deal = await tx.deal.findFirst({
      where: { propertyId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    let status = 'AVAILABLE';
    if (deal?.type === 'SALE') status = deal.paymentStatus === 'PAID' ? 'SOLD' : 'UNDER_CONTRACT';
    if (deal?.type === 'RENTAL') status = ['PAID', 'PARTIAL', 'OVERDUE'].includes(deal.paymentStatus) ? 'RENTED' : 'UNDER_CONTRACT';
    await tx.property.update({ where: { id: propertyId }, data: { status, version: { increment: 1 } } });
  }

  private async syncTenantProperty(tx: any, tenantId: string) {
    const contract = await tx.rentalContract.findFirst({
      where: { tenantId, deletedAt: null, status: { in: ['ACTIVE', 'RENEWAL_DUE'] } },
      orderBy: { createdAt: 'desc' },
      select: { propertyId: true },
    });
    await tx.tenant.updateMany({
      where: { id: tenantId, deletedAt: null },
      data: { propertyId: contract?.propertyId || null },
    });
  }

  private async syncDealLedger(tx: any, deal: any) {
    await tx.transaction.updateMany({
      where: { dealId: deal.id, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    await this.accounting.retractPriorForSource(tx, 'DEAL', deal.id);
    if (deal.paymentStatus === 'REFUNDED' || Number(deal.totalAmount) <= 0) return;

    const fullDeal = await tx.deal.findUnique({
      where: { id: deal.id },
      include: { property: true, client: true },
    });
    const propTitle = fullDeal?.property?.title || 'Property';
    const clientName = fullDeal?.client ? (fullDeal.client.fullName || fullDeal.client.name) : '';
    const label = clientName ? `${propTitle} (${clientName})` : propTitle;

    const paid = Number(deal.paidAmount);
    const total = Number(deal.totalAmount);
    const typeLabel = deal.type === 'RENTAL' ? 'Rental' : 'Sale';
    const isRental = deal.type === 'RENTAL';
    const shortId = deal.id.slice(-6).toUpperCase();

    if (paid > 0) {
      await tx.transaction.create({
        data: {
          referenceId: `deal:${deal.id}:paid:${deal.version}`,
          type: 'INCOME',
          status: 'CLEARED',
          description: `${typeLabel} payment received for ${label}`,
          amount: paid,
          dealId: deal.id,
          propertyId: deal.propertyId,
        },
      });
      await this.accounting.postFinancialEvent(tx, {
          tx, tenantId: 'system',
          sourceType: 'DEAL',
          sourceId: deal.id,
          sourceRef: `DEAL-PAID-${shortId}`,
          memo: `${typeLabel} payment received for ${label}`,
          drKey: isRental ? 'RENTAL_RECEIPT_CASH' : 'DEAL_SALE_CASH',
          crKey: isRental ? 'RENTAL_INVOICE_REVENUE' : 'DEAL_SALE_REVENUE',
          amount: paid,
        });
    }
    if (total - paid > 0) {
      await tx.transaction.create({
        data: {
          referenceId: `deal:${deal.id}:due:${deal.version}`,
          type: 'INCOME',
          status: deal.paymentStatus === 'OVERDUE' ? 'PROCESSING' : 'PENDING',
          description: `Pending balance for ${typeLabel.toLowerCase()} deal - ${label}`,
          amount: total - paid,
          dealId: deal.id,
          propertyId: deal.propertyId,
        },
      });
      await this.accounting.postFinancialEvent(tx, {
          tx, tenantId: 'system',
          sourceType: 'DEAL',
          sourceId: deal.id,
          sourceRef: `DEAL-DUE-${shortId}`,
          memo: `Outstanding balance on ${typeLabel.toLowerCase()} deal - ${label}`,
          drKey: isRental ? 'RENTAL_INVOICE_AR' : 'SALES_INVOICE_AR',
          crKey: isRental ? 'RENTAL_INVOICE_REVENUE' : 'DEAL_SALE_REVENUE',
          amount: total - paid,
        });
    }
  }

  private dealPaymentStatus(total: number, paid: number, explicit?: string) {
    if (explicit === 'REFUNDED') return 'REFUNDED';
    if (paid <= 0) return 'PENDING';
    if (paid >= total) return 'PAID';
    return 'PARTIAL';
  }

  private paymentStatus(due: number, paid: number, dueDate: Date) {
    if (paid >= due) return 'PAID';
    if (paid > 0) return 'PARTIAL';
    return new Date(dueDate) < new Date() ? 'LATE' : 'UNPAID';
  }

  private async syncRentPaymentLedger(tx: any, payment: any) {
    const prefix = `rentpayment:${payment.id}:`;
    await tx.transaction.updateMany({
      where: { referenceId: { startsWith: prefix }, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    // Accrual: keep invoice (AR/Revenue for full due) separate from receipt (Cash/AR for paid)
    await this.accounting.retractPriorForSource(tx, 'RENT_INVOICE', payment.id);
    await this.accounting.retractPriorForSource(tx, 'RENT_RECEIPT', payment.id);
    // Legacy source key used by older posts
    await this.accounting.retractPriorForSource(tx, 'RENT_PAYMENT', payment.id);

    const contract = payment.contractId
      ? await tx.rentalContract.findUnique({
          where: { id: payment.contractId },
          include: { property: true, tenant: true },
        })
      : null;
    const propertyId = contract?.propertyId || null;
    const propertyTitle = contract?.property?.title || 'Property';
    const tenantName = contract?.tenant ? (contract.tenant.fullName || contract.tenant.name) : '';
    const label = tenantName ? `${propertyTitle} (${tenantName})` : propertyTitle;
    const shortId = payment.id.slice(-6).toUpperCase();

    const paid = Number(payment.amountPaid);
    const due = Number(payment.amountDue);

    if (due > 0) {
      await this.accounting.postFinancialEvent(tx, {
          tx, tenantId: 'system',
          sourceType: 'RENT_INVOICE',
          sourceId: payment.id,
          sourceRef: `RENT-INV-${shortId}`,
          date: payment.dueDate,
          memo: `Rent invoice - ${label}`,
          drKey: 'RENTAL_INVOICE_AR',
          crKey: 'RENTAL_INVOICE_REVENUE',
          amount: due,
        });
    }

    if (paid > 0) {
      await tx.transaction.create({
        data: {
          referenceId: `${prefix}paid:${payment.updatedAt.getTime()}`,
          type: 'INCOME',
          status: 'CLEARED',
          description: `Rent payment received for ${label}`,
          amount: paid,
          date: payment.paidDate || new Date(),
          propertyId,
        },
      });
      await this.accounting.postFinancialEvent(tx, {
          tx, tenantId: 'system',
          sourceType: 'RENT_RECEIPT',
          sourceId: payment.id,
          sourceRef: `RENT-REC-${shortId}`,
          date: payment.paidDate || new Date(),
          memo: `Rent payment received for ${label}`,
          drKey: 'RENTAL_RECEIPT_CASH',
          crKey: 'RENTAL_RECEIPT_AR',
          amount: paid,
        });
    }
  }
}
