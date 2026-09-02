import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DealDto,
  PropertyDto,
  RentalUnitDto,
  RentalUnitCategoryDto,
  RentalContractDto,
  RentReceiptDto,
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
        _count: { select: { deals: true, rentalContracts: true, tenants: true, units: { where: { deletedAt: null } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  getPropertyOptions(tenantDb: any) {
    return tenantDb.property.findMany({
      where: { deletedAt: null },
      select: { id: true, title: true, floors: true, type: true },
      orderBy: { title: 'asc' },
    });
  }

  async getProperty(tenantDb: any, id: string) {
    const property = await tenantDb.property.findFirst({
      where: { id, deletedAt: null },
      include: {
        deals: { where: { deletedAt: null }, include: { client: true }, orderBy: { createdAt: 'desc' } },
        rentalContracts: { where: { deletedAt: null }, include: { tenant: true, payments: true } },
        units: { where: { deletedAt: null }, include: { contracts: { where: { deletedAt: null }, include: { tenant: true } } } },
        tenants: { where: { deletedAt: null } },
        transactions: { where: { deletedAt: null }, orderBy: { date: 'desc' }, take: 50 },
      },
    });
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  async createProperty(tenantDb: any, companyId: string, data: PropertyDto) {
    const { units = [], ...propertyData } = data;
    return this.entitlements.withinTenantQuota(
      companyId,
      tenantDb,
      'properties',
      async (tx) => tx.property.create({
        data: {
          ...propertyData,
          price: propertyData.price ?? 0,
          type: propertyData.type as any,
          status: 'AVAILABLE',
          units: units.length ? { create: (await this.prepareRentalUnits(tx, units)).map((unit) => ({ ...unit, status: unit.status || 'AVAILABLE' })) } : undefined,
        },
        include: { units: true },
      }),
    );
  }

  async updateProperty(tenantDb: any, id: string, data: PropertyDto) {
    const { status: _status, units = [], ...propertyData } = data;
    const where: any = { id, deletedAt: null };
    if (data.version !== undefined) where.version = data.version;
    const result = await tenantDb.property.updateMany({
      where,
      data: {
        ...propertyData,
        ...(propertyData.price !== undefined ? { price: propertyData.price } : {}),
        ...(data.status ? { status: data.status as any } : {}),
        type: propertyData.type as any,
        version: { increment: 1 },
      },
    });
    if (!result.count) throw new ConflictException('Property changed or no longer exists; reload and retry');
    if (units.length) await tenantDb.rentalUnit.createMany({ data: (await this.prepareRentalUnits(tenantDb, units)).map((unit) => ({ ...unit, propertyId: id, status: unit.status || 'AVAILABLE' })) });
    return tenantDb.property.findUnique({ where: { id } });
  }

  getRentalUnits(tenantDb: any, propertyId?: string) {
    return tenantDb.rentalUnit.findMany({
      where: { deletedAt: null, ...(propertyId ? { propertyId } : {}) },
      include: { property: true, category: true, contracts: { where: { deletedAt: null, status: { in: ['ACTIVE', 'RENEWAL_DUE'] } }, include: { tenant: true } } },
      orderBy: [{ property: { title: 'asc' } }, { name: 'asc' }],
    });
  }

  getRentalUnitOptions(tenantDb: any, propertyId?: string) {
    return tenantDb.rentalUnit.findMany({
      where: { deletedAt: null, ...(propertyId ? { propertyId } : {}) },
      select: { id: true, propertyId: true, name: true, monthlyRent: true, status: true, property: { select: { title: true } } },
      orderBy: [{ property: { title: 'asc' } }, { name: 'asc' }],
    });
  }

  getRentalUnitCategories(tenantDb: any) {
    return tenantDb.rentalUnitCategory.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  }

  createRentalUnitCategory(tenantDb: any, data: RentalUnitCategoryDto) {
    return tenantDb.rentalUnitCategory.create({ data });
  }

  async updateRentalUnitCategory(tenantDb: any, id: string, data: RentalUnitCategoryDto) {
    return tenantDb.$transaction(async (tx: any) => {
      const result = await tx.rentalUnitCategory.updateMany({ where: { id, deletedAt: null }, data });
      if (!result.count) throw new NotFoundException('Unit category not found');
      await tx.rentalUnit.updateMany({ where: { categoryId: id, deletedAt: null }, data: { monthlyRent: data.monthlyRent, bedrooms: data.rooms, bathrooms: data.bathrooms, section: data.section } });
      return tx.rentalUnitCategory.findUnique({ where: { id } });
    });
  }

  async deleteRentalUnitCategory(tenantDb: any, id: string) {
    const activeUnits = await tenantDb.rentalUnit.count({ where: { categoryId: id, deletedAt: null } });
    if (activeUnits) throw new ConflictException('Reassign or remove units before deleting this category');
    const result = await tenantDb.rentalUnitCategory.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!result.count) throw new NotFoundException('Unit category not found');
    return { deleted: true };
  }

  async createRentalUnits(tenantDb: any, propertyId: string, units: RentalUnitDto[]) {
    if (!units.length) throw new BadRequestException('Add at least one unit');
    const property = await tenantDb.property.findFirst({ where: { id: propertyId, deletedAt: null } });
    if (!property) throw new NotFoundException('Property not found');
    return tenantDb.rentalUnit.createMany({ data: (await this.prepareRentalUnits(tenantDb, units)).map((unit) => ({ ...unit, propertyId, status: unit.status || 'AVAILABLE' })) });
  }

  async updateRentalUnit(tenantDb: any, id: string, data: RentalUnitDto) {
    const unit = await tenantDb.rentalUnit.findFirst({ where: { id, deletedAt: null } });
    if (!unit) throw new NotFoundException('Unit not found');
    const activeLease = await tenantDb.rentalContract.count({ where: { unitId: id, deletedAt: null, status: { in: ['ACTIVE', 'RENEWAL_DUE'] } } });
    if (activeLease && data.status && data.status !== 'OCCUPIED') throw new ConflictException('End or terminate the active lease before changing an occupied unit');
    if (!activeLease && data.status === 'OCCUPIED') throw new ConflictException('Only an active lease can mark a unit occupied');
    const [prepared] = await this.prepareRentalUnits(tenantDb, [data]);
    return tenantDb.rentalUnit.update({ where: { id }, data: prepared });
  }

  async deleteRentalUnit(tenantDb: any, id: string) {
    const active = await tenantDb.rentalContract.count({ where: { unitId: id, deletedAt: null, status: { in: ['ACTIVE', 'RENEWAL_DUE'] } } });
    if (active) throw new ConflictException('End or terminate the active lease before removing this unit');
    const result = await tenantDb.rentalUnit.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!result.count) throw new NotFoundException('Unit not found');
    return { deleted: true };
  }

  private async prepareRentalUnits(tenantDb: any, units: RentalUnitDto[]) {
    const categoryIds = [...new Set(units.map((unit) => unit.categoryId))];
    const categories = await tenantDb.rentalUnitCategory.findMany({ where: { id: { in: categoryIds }, deletedAt: null } });
    const byId = new Map<string, any>(categories.map((category: any) => [category.id, category]));
    return units.map((unit: any) => {
      const category = byId.get(unit.categoryId);
      if (!category) throw new BadRequestException('Select a valid unit category');
      return {
        name: unit.name, categoryId: unit.categoryId, floor: unit.floor || undefined,
        imageUrl: unit.imageUrl || undefined, status: unit.status || undefined,
        monthlyRent: Number(category.monthlyRent), bedrooms: category.rooms,
        bathrooms: category.bathrooms, section: category.section,
      };
    });
  }

  async deleteProperty(tenantDb: any, id: string) {
    const [deals, contracts] = await Promise.all([
      tenantDb.deal.count({ where: { propertyId: id, deletedAt: null } }),
      tenantDb.rentalContract.count({ where: { propertyId: id, deletedAt: null } }),
    ]);
    if (deals || contracts) throw new ConflictException('Property has active sales or rental contracts');
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
    const where: any = { deletedAt: null, type: 'SALE' };
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
    if (!deal) throw new NotFoundException('Sale not found');
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
          type: 'SALE',
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
      if (!existing) throw new NotFoundException('Sale not found');
      if (existing.type !== 'SALE') throw new ConflictException('Legacy rental record is read-only; manage the lease and payments from Rentals.');
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
          type: 'SALE',
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
      if (!deal) throw new NotFoundException('Sale not found');
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
    if (deals) throw new ConflictException('Client has active property records');
    const result = await tenantDb.tenant.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Tenant not found');
    return { deleted: true };
  }

  async getTenantRentalProfile(tenantDb: any, id: string) {
    const tenant = await tenantDb.tenant.findFirst({
      where: { id, deletedAt: null },
      include: {
        contracts: { where: { deletedAt: null }, include: { property: true, unit: true }, orderBy: { startDate: 'desc' } },
        rentPayments: { where: { deletedAt: null }, include: { contract: { include: { property: true, unit: true } }, receipts: { orderBy: { receivedAt: 'desc' } } }, orderBy: { dueDate: 'desc' } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    const payments = tenant.rentPayments.map((payment: any) => ({ ...payment, status: this.paymentStatus(Number(payment.amountDue), Number(payment.amountPaid), payment.dueDate), remaining: Number(payment.amountDue) - Number(payment.amountPaid) }));
    const totals = payments.reduce((sum: any, payment: any) => ({ due: sum.due + Number(payment.amountDue), paid: sum.paid + Number(payment.amountPaid), balance: sum.balance + payment.remaining }), { due: 0, paid: 0, balance: 0 });
    return { tenant: { ...tenant, rentPayments: undefined }, contracts: tenant.contracts, invoices: payments, receipts: payments.flatMap((payment: any) => payment.receipts.map((receipt: any) => ({ ...receipt, invoiceId: payment.id, contractId: payment.contractId }))), totals };
  }

  getRentalContracts(tenantDb: any) {
    return tenantDb.rentalContract.findMany({
      where: { deletedAt: null },
      include: { tenant: true, property: true, unit: true, payments: { where: { deletedAt: null } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createRentalContract(tenantDb: any, data: RentalContractDto) {
    this.validateDateRange(data.startDate, data.endDate);
    return tenantDb.$transaction(async (tx: any) => {
      const property = await this.lockPropertyRow(tx, data.propertyId);
      if (property.status === 'SOLD') throw new BadRequestException('Sold property cannot be rented');
      const unit = await this.assertRentalUnit(tx, data.unitId, data.propertyId, true);
      const activeContract = await tx.rentalContract.findFirst({
        where: {
          unitId: data.unitId,
          deletedAt: null,
          status: { in: ['ACTIVE', 'RENEWAL_DUE'] },
        },
      });
      if (activeContract) throw new ConflictException('Unit already has an active rental contract');
      const tenant = await tx.tenant.findFirst({ where: { id: data.tenantId, deletedAt: null } });
      if (!tenant) throw new NotFoundException('Tenant not found');
      const contract = await tx.rentalContract.create({
        data: { ...data, monthlyRent: data.monthlyRent || Number(unit.monthlyRent), billingPeriod: data.billingPeriod || 'MONTHLY', status: 'ACTIVE' },
      });
      await this.syncRentalUnitStatus(tx, data.unitId);
      await this.syncDealPropertyStatus(tx, data.propertyId);
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
      const targetUnitId = data.unitId || existing.unitId;
      if (!targetUnitId) throw new BadRequestException('A rental unit is required');
      const targetStatus = existing.status;
      // Lock every affected property in a deterministic order so concurrent
      // updates cannot double-assign the same property.
      const propertyIds = [...new Set([existing.propertyId, targetPropertyId])].sort();
      for (const propertyId of propertyIds) {
        await this.lockPropertyRow(tx, propertyId);
      }
      await this.assertRentalUnit(tx, targetUnitId, targetPropertyId, targetUnitId !== existing.unitId);
      if (['ACTIVE', 'RENEWAL_DUE'].includes(targetStatus)) {
        const activeContract = await tx.rentalContract.findFirst({
          where: {
            id: { not: id },
            unitId: targetUnitId,
            deletedAt: null,
            status: { in: ['ACTIVE', 'RENEWAL_DUE'] },
          },
        });
        if (activeContract) throw new ConflictException('Unit already has an active rental contract');
      }
      const contract = await tx.rentalContract.update({
        where: { id },
        data: { ...data, billingPeriod: data.billingPeriod || existing.billingPeriod, status: existing.status },
      });
      if (existing.unitId) await this.syncRentalUnitStatus(tx, existing.unitId);
      await this.syncRentalUnitStatus(tx, contract.unitId);
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
      if (existing.unitId) await this.syncRentalUnitStatus(tx, existing.unitId);
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
      if (contract.unitId) await this.syncRentalUnitStatus(tx, contract.unitId);
      await this.syncDealPropertyStatus(tx, contract.propertyId);
      await this.syncTenantProperty(tx, contract.tenantId);
      return { deleted: true };
    });
  }

  async getRentPayments(tenantDb: any, status?: string) {
    const payments = await tenantDb.rentPayment.findMany({
      where: { deletedAt: null },
      include: { tenant: true, receipts: true, contract: { include: { property: true, unit: true } } },
      orderBy: { dueDate: 'desc' },
    });
    const current = payments.map((payment: any) => ({ ...payment, status: this.paymentStatus(Number(payment.amountDue), Number(payment.amountPaid), payment.dueDate), remaining: Number(payment.amountDue) - Number(payment.amountPaid) }));
    return status ? current.filter((payment: any) => payment.status === status) : current;
  }

  async generateMonthlyRentInvoices(tenantDb: any, dateStr?: string) {
    const targetDate = dateStr ? new Date(dateStr) : new Date();
    if (Number.isNaN(targetDate.getTime())) throw new BadRequestException('Invalid invoice month');
    const year = targetDate.getUTCFullYear();
    const month = targetDate.getUTCMonth();
    const startOfMonth = new Date(Date.UTC(year, month, 1));
    const endOfMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
    const now = new Date();

    let generatedCount = 0;
    let skippedCount = 0;
    let totalAmount = 0;

    await tenantDb.$transaction(async (tx: any) => {
      // Lock every active contract in a deterministic order so concurrent runs
      // serialize: the second run blocks here and then sees the invoices the
      // first run committed, keeping generation idempotent.
      await tx.$queryRaw`
        SELECT "id" FROM "rental_contracts"
        WHERE "status" IN ('ACTIVE', 'RENEWAL_DUE') AND "deleted_at" IS NULL
        ORDER BY "id" FOR UPDATE`;

      const activeContracts = await tx.rentalContract.findMany({
        where: { status: { in: ['ACTIVE', 'RENEWAL_DUE'] }, deletedAt: null },
        include: { tenant: true, property: true, unit: true },
      });

      for (const contract of activeContracts) {
        await this.syncRentalUnitStatus(tx, contract.unitId);
        if (!contract.unitId || !contract.unit || Number(contract.monthlyRent) <= 0) {
          skippedCount++;
          continue;
        }

        const dueDate = this.invoiceDateForMonth(contract.startDate, contract.billingPeriod, year, month);
        if (!dueDate || (!dateStr && dueDate > now) || dueDate < startOfMonth || dueDate > endOfMonth || (contract.endDate && this.advanceBillingPeriod(dueDate, contract.billingPeriod, contract.startDate) > contract.endDate)) {
          skippedCount++;
          continue;
        }
        const existing = await tx.rentPayment.findFirst({ where: { contractId: contract.id, deletedAt: null, dueDate } });
        if (existing) { skippedCount++; continue; }

        const amountDue = this.rentForBillingPeriod(contract.monthlyRent, contract.billingPeriod);

        const payment = await tx.rentPayment.create({
          data: {
            tenantId: contract.tenantId,
            contractId: contract.id,
            amountDue,
            amountPaid: 0,
            dueDate,
            status: 'UNPAID',
            receiptNo: `INV-${year}${(month + 1).toString().padStart(2, '0')}-${contract.id.slice(-4).toUpperCase()}`,
            notes: `Automated monthly rent invoice for ${contract.tenant?.name || 'Tenant'} · ${contract.property?.title || 'Property'}`,
          },
        });

        await this.syncRentPaymentLedger(tx, payment);
        generatedCount++;
        totalAmount += amountDue;
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
    return tenantDb.$transaction(async (tx: any) => {
      const contract = await this.assertRentPaymentTenant(tx, data.contractId, data.tenantId);
      const dueDate = new Date(data.dueDate);
      if (!['ACTIVE', 'RENEWAL_DUE'].includes(contract.status) || !this.isScheduledInvoiceDate(contract, dueDate)) throw new BadRequestException('Invoice date is outside the lease billing schedule');
      if (await tx.rentPayment.findFirst({ where: { contractId: data.contractId, dueDate, deletedAt: null } })) throw new ConflictException('An invoice already exists for this lease period');
      const amountDue = Number(data.amountDue);
      if (Math.abs(amountDue - this.rentForBillingPeriod(contract.monthlyRent, contract.billingPeriod)) > 0.005) throw new BadRequestException('Invoice amount must match the lease billing amount');
      const payment = await tx.rentPayment.create({
        data: {
          ...data,
          status: this.paymentStatus(amountDue, 0, dueDate) as any,
          amountPaid: 0,
          paidDate: null,
        },
      });
      await this.syncRentPaymentLedger(tx, payment);
      return payment;
    });
  }

  async updateRentPayment(tenantDb: any, id: string, data: RentPaymentDto) {
    return tenantDb.$transaction(async (tx: any) => {
      const existing = await tx.rentPayment.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Rent payment not found');
      if (await tx.rentReceipt.count({ where: { rentPaymentId: id } })) throw new ConflictException('Invoices with receipts can only be adjusted through their receipts');
      const contract = await this.assertRentPaymentTenant(tx, data.contractId, data.tenantId);
      const amountDue = Number(data.amountDue);
      const dueDate = new Date(data.dueDate);
      if (!this.isScheduledInvoiceDate(contract, dueDate)) throw new BadRequestException('Invoice date is outside the lease billing schedule');
      if (Math.abs(amountDue - this.rentForBillingPeriod(contract.monthlyRent, contract.billingPeriod)) > 0.005) throw new BadRequestException('Invoice amount must match the lease billing amount');
      const payment = await tx.rentPayment.update({
        where: { id },
        data: {
          ...data,
          amountDue,
          status: this.paymentStatus(amountDue, 0, dueDate) as any,
          amountPaid: 0,
          paidDate: null,
        },
      });
      await this.syncRentPaymentLedger(tx, payment);
      return payment;
    }, { timeout: 15_000 });
  }

  async deleteRentPayment(tenantDb: any, id: string) {
    return tenantDb.$transaction(async (tx: any) => {
      if (await tx.rentReceipt.count({ where: { rentPaymentId: id } })) throw new ConflictException('Invoices with receipts cannot be deleted');
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

  private validateDateRange(start: Date, end?: Date) {
    if (end && new Date(end) < new Date(start)) throw new BadRequestException('End date must be on or after start date');
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

  async recordRentReceipt(tenantDb: any, rentPaymentId: string, data: RentReceiptDto) {
    return tenantDb.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "rent_payments" WHERE "id" = ${rentPaymentId} AND "deleted_at" IS NULL FOR UPDATE`;
      const payment = await tx.rentPayment.findFirst({ where: { id: rentPaymentId, deletedAt: null }, include: { contract: true } });
      if (!payment || !payment.contractId || !payment.contract) throw new NotFoundException('Rental invoice not found');
      const amount = Number(data.amount);
      const paid = Number(payment.amountPaid);
      const due = Number(payment.amountDue);
      if (amount > due - paid) throw new BadRequestException('Receipt amount cannot exceed the remaining invoice balance');
      if (data.receiptNo && await tx.rentReceipt.findFirst({ where: { receiptNo: data.receiptNo } })) throw new ConflictException('Receipt number already exists');
      const receivedAt = data.receivedAt ? new Date(data.receivedAt) : new Date();
      if (receivedAt > new Date()) throw new BadRequestException('Receipt date cannot be in the future');
      const updated = await tx.rentPayment.update({ where: { id: rentPaymentId }, data: { amountPaid: paid + amount, paidDate: receivedAt, status: this.paymentStatus(due, paid + amount, payment.dueDate) as any } });
      const receipt = await tx.rentReceipt.create({ data: { rentPaymentId, amount, receivedAt, receiptNo: data.receiptNo, notes: data.notes } });
      await this.syncRentPaymentLedger(tx, updated);
      return receipt;
    });
  }

  private async assertRentalUnit(tx: any, unitId: string, propertyId: string, forNewLease: boolean) {
    const rows: any[] = await tx.$queryRaw`
      SELECT "id", "property_id", "status" FROM "rental_units"
      WHERE "id" = ${unitId} AND "deleted_at" IS NULL FOR UPDATE`;
    const unit = rows[0];
    if (!unit || unit.property_id !== propertyId) throw new BadRequestException('Unit does not belong to the selected property');
    if (forNewLease && unit.status !== 'AVAILABLE') throw new ConflictException('Unit is not available for a new lease');
    return unit;
  }

  private async syncRentalUnitStatus(tx: any, unitId?: string | null) {
    if (!unitId) return;
    const now = new Date();
    const active = await tx.rentalContract.findFirst({ where: { unitId, deletedAt: null, status: { in: ['ACTIVE', 'RENEWAL_DUE'] }, startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] } });
    if (active) {
      await tx.rentalUnit.updateMany({ where: { id: unitId, deletedAt: null }, data: { status: 'OCCUPIED' } });
    } else {
      await tx.rentalUnit.updateMany({ where: { id: unitId, deletedAt: null, status: 'OCCUPIED' }, data: { status: 'AVAILABLE' } });
    }
  }

  private invoiceDateForMonth(start: Date, billingPeriod: string, year: number, month: number) {
    const periods: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };
    const interval = periods[billingPeriod] || 1;
    const first = new Date(start);
    const offset = (year - first.getUTCFullYear()) * 12 + month - first.getUTCMonth();
    if (offset < 0 || offset % interval) return null;
    return new Date(Date.UTC(year, month, Math.min(first.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate())));
  }

  private advanceBillingPeriod(date: Date, billingPeriod: string, anchor: Date = date) {
    const periods: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };
    const targetMonth = date.getUTCMonth() + (periods[billingPeriod] || 1);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
    return new Date(Date.UTC(date.getUTCFullYear(), targetMonth, Math.min(new Date(anchor).getUTCDate(), lastDay)));
  }

  private isScheduledInvoiceDate(contract: any, dueDate: Date) {
    const expected = this.invoiceDateForMonth(contract.startDate, contract.billingPeriod, dueDate.getUTCFullYear(), dueDate.getUTCMonth());
    return Boolean(expected && expected.getTime() === dueDate.getTime() && (!contract.endDate || this.advanceBillingPeriod(dueDate, contract.billingPeriod, contract.startDate) <= contract.endDate));
  }

  private async claimAvailableProperty(tx: any, propertyId: string) {
    const property = await this.lockPropertyRow(tx, propertyId);
    if (property.status !== 'AVAILABLE') {
      throw new ConflictException('Property is not available for a new sale');
    }
  }

  private async assertRentPaymentTenant(tx: any, contractId: string, tenantId: string) {
    const contract = await tx.rentalContract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, tenantId: true, status: true, startDate: true, endDate: true, billingPeriod: true, monthlyRent: true },
    });
    if (!contract) throw new BadRequestException('Rental contract not found');
    if (contract.tenantId !== tenantId) {
      throw new BadRequestException('Tenant does not belong to the specified rental contract');
    }
    return contract;
  }

  private async syncDealPropertyStatus(tx: any, propertyId: string) {
    const now = new Date();
    const activeRental = await tx.rentalContract.findFirst({
      where: { propertyId, deletedAt: null, status: { in: ['ACTIVE', 'RENEWAL_DUE'] }, startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] },
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
    const now = new Date();
    const contract = await tx.rentalContract.findFirst({
      where: { tenantId, deletedAt: null, status: { in: ['ACTIVE', 'RENEWAL_DUE'] }, startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] },
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
          sourceRef: `SALE-PAID-${shortId}`,
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
          description: `Pending balance for ${typeLabel.toLowerCase()} - ${label}`,
          amount: total - paid,
          dealId: deal.id,
          propertyId: deal.propertyId,
        },
      });
      await this.accounting.postFinancialEvent(tx, {
          tx, tenantId: 'system',
          sourceType: 'DEAL',
          sourceId: deal.id,
          sourceRef: `SALE-DUE-${shortId}`,
          memo: `Outstanding balance on ${typeLabel.toLowerCase()} - ${label}`,
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
    const date = new Date(dueDate); const now = new Date();
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) ? 'LATE' : 'UNPAID';
  }

  private rentForBillingPeriod(monthlyRent: unknown, billingPeriod: string) {
    return Math.round(Number(monthlyRent) * ({ MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 }[billingPeriod] || 1) * 100) / 100;
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
