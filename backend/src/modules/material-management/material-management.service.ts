import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountingService } from '../accounting/accounting.service';
import {
  MaterialCustomerDto,
  MaterialDto,
  MaterialSaleDto,
  PurchaseOrderDto,
  SupplierDto,
  TransportationDto,
} from './material-management.dto';

@Injectable()
export class MaterialManagementService {
  constructor(private readonly accounting: AccountingService) {}

  getProducts(db: any, search?: string) {
    const where: any = { deletedAt: null };
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { category: { contains: search, mode: 'insensitive' } },
      { materialType: { contains: search, mode: 'insensitive' } },
    ];
    return db.material.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  getProductOptions(db: any) {
    return db.material.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, unitCost: true, salePrice: true, quantity: true },
      orderBy: { name: 'asc' },
    });
  }

  async getProduct(db: any, id: string) {
    const product = await db.material.findFirst({ where: { id, deletedAt: null } });
    if (!product) throw new NotFoundException('Material not found');
    return product;
  }

  createProduct(db: any, data: MaterialDto) {
    return db.material.create({
      data: {
        ...data,
        unit: data.unit as any,
        status: (data.status as any) || 'ACTIVE',
        quantity: data.quantity || 0,
      },
    });
  }

  async updateProduct(db: any, id: string, data: MaterialDto) {
    const { quantity: _quantity, ...safeData } = data;
    const result = await db.material.updateMany({
      where: { id, deletedAt: null },
      data: { ...safeData, unit: data.unit as any, status: data.status as any, version: { increment: 1 } },
    });
    if (!result.count) throw new NotFoundException('Material not found');
    return db.material.findUnique({ where: { id } });
  }

  async deleteProduct(db: any, id: string) {
    const [purchases, sales, transport] = await Promise.all([
      db.purchaseOrderItem.count({ where: { materialId: id, purchaseOrder: { deletedAt: null } } }),
      db.materialSaleItem.count({ where: { materialId: id, sale: { deletedAt: null } } }),
      db.transportationItem.count({ where: { materialId: id, transportation: { deletedAt: null } } }),
    ]);
    if (purchases || sales || transport) throw new ConflictException('Material is referenced by active operations');
    const result = await db.material.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (!result.count) throw new NotFoundException('Material not found');
    return { deleted: true };
  }

  getSuppliers(db: any) {
    return db.supplier.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { purchaseOrders: true, transactions: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  getSupplierOptions(db: any) {
    return db.supplier.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  async getSupplier(db: any, id: string) {
    const supplier = await db.supplier.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { purchaseOrders: true, transactions: true } } },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  createSupplier(db: any, data: SupplierDto) {
    return db.supplier.create({ data: { ...data, balance: data.balance || 0 } });
  }

  async updateSupplier(db: any, id: string, data: SupplierDto) {
    const result = await db.supplier.updateMany({ where: { id, deletedAt: null }, data });
    if (!result.count) throw new NotFoundException('Supplier not found');
    return db.supplier.findUnique({ where: { id } });
  }

  async deleteSupplier(db: any, id: string) {
    const active = await db.purchaseOrder.count({ where: { supplierId: id, deletedAt: null } });
    if (active) throw new ConflictException('Supplier has active purchase orders');
    const result = await db.supplier.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!result.count) throw new NotFoundException('Supplier not found');
    return { deleted: true };
  }

  getPurchaseOrders(db: any) {
    return db.purchaseOrder.findMany({
      where: { deletedAt: null },
      include: { supplier: true, items: { include: { material: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPurchaseOrder(db: any, id: string) {
    const order = await db.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: { supplier: true, items: { include: { material: true } } },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    return order;
  }

  async createPurchaseOrder(db: any, userId: string, data: PurchaseOrderDto) {
    const totalCost = data.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
    return db.$transaction(async (tx: any) => {
      const order = await tx.purchaseOrder.create({
        data: {
          orderNo: data.orderNo,
          supplierId: data.supplierId,
          status: 'DRAFT',
          totalCost,
          orderedAt: data.orderedAt,
          receivedAt: undefined,
          notes: data.notes,
          items: { create: data.items },
        },
        include: { supplier: true, items: true },
      });
      if (order.status === 'RECEIVED') await this.applyPurchaseReceipt(tx, order, userId, 1);
      await this.syncPurchaseLedger(tx, order);
      return order;
    });
  }

  async updatePurchaseStatus(db: any, id: string, userId: string, status: string) {
    return db.$transaction(async (tx: any) => {
      const order = await tx.purchaseOrder.findFirst({
        where: { id, deletedAt: null },
        include: { supplier: true, items: true },
      });
      if (!order) throw new NotFoundException('Purchase order not found');
      if (order.status === status) return order;
      const allowed: Record<string, string[]> = {
        DRAFT: ['ORDERED', 'RECEIVED', 'CANCELLED'],
        ORDERED: ['RECEIVED', 'CANCELLED'],
        RECEIVED: [],
        CANCELLED: ['DRAFT'],
      };
      if (!allowed[order.status]?.includes(status)) {
        throw new BadRequestException(`Cannot transition purchase order from ${order.status} to ${status}`);
      }

      // Claim the transition before changing stock. The version predicate
      // prevents two requests from receiving the same order twice.
      const changed = await tx.purchaseOrder.updateMany({
        where: { id, deletedAt: null, status: order.status },
        data: {
          status: status as any,
          receivedAt: status === 'RECEIVED' ? new Date() : order.receivedAt,
        },
      });
      if (!changed.count) throw new ConflictException('Purchase order was changed by another request');
      const updated = await tx.purchaseOrder.findFirst({
        where: { id, deletedAt: null },
        include: { supplier: true, items: true },
      });
      if (!updated) throw new NotFoundException('Purchase order not found');
      if (order.status === 'RECEIVED') {
        await this.applyPurchaseReceipt(tx, order, userId, -1);
      } else if (updated.status === 'RECEIVED') {
        await this.applyPurchaseReceipt(tx, updated, userId, 1);
      }
      await this.syncPurchaseLedger(tx, updated);
      return updated;
    }, { timeout: 30_000 });
  }

  async updatePurchaseOrder(db: any, id: string, userId: string, data: PurchaseOrderDto) {
    const totalCost = data.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
    return db.$transaction(async (tx: any) => {
      const existing = await tx.purchaseOrder.findFirst({
        where: { id, deletedAt: null },
        include: { supplier: true, items: true },
      });
      if (!existing) throw new NotFoundException('Purchase order not found');
      if (existing.status === 'RECEIVED') {
        throw new ConflictException('Received purchase orders cannot be edited; change the status first');
      }

    const status = existing.status;
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id, deletedAt: null, status: existing.status },
        data: {
          orderNo: data.orderNo,
          supplierId: data.supplierId,
          status,
          totalCost,
          orderedAt: data.orderedAt,
          receivedAt: existing.receivedAt,
          notes: data.notes,
        },
      });
      if (!claimed.count) throw new ConflictException('Purchase order was changed by another request');
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      await tx.purchaseOrderItem.createMany({
        data: data.items.map((item) => ({ purchaseOrderId: id, ...item })),
      });
      const updated = await tx.purchaseOrder.findFirst({
        where: { id, deletedAt: null },
        include: { supplier: true, items: true },
      });
      if (!updated) throw new NotFoundException('Purchase order not found');
      if (updated.status === 'RECEIVED') await this.applyPurchaseReceipt(tx, updated, userId, 1);
      await this.syncPurchaseLedger(tx, updated);
      return updated;
    });
  }

  async deletePurchaseOrder(db: any, id: string, userId: string) {
    return db.$transaction(async (tx: any) => {
      const order = await tx.purchaseOrder.findFirst({
        where: { id, deletedAt: null },
        include: { supplier: true, items: true },
      });
      if (!order) throw new NotFoundException('Purchase order not found');
      const deleted = await tx.purchaseOrder.updateMany({
        where: { id, deletedAt: null, status: order.status },
        data: { deletedAt: new Date() },
      });
      if (!deleted.count) throw new ConflictException('Purchase order was changed by another request');
      if (order.status === 'RECEIVED') await this.applyPurchaseReceipt(tx, order, userId, -1);
      await tx.transaction.updateMany({
        where: { referenceId: `purchase:${id}`, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.accounting.retractPriorForSource(tx, 'PURCHASE', id);
      return { deleted: true };
    });
  }

  getCustomers(db: any) {
    return db.materialCustomer.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { sales: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  getCustomerOptions(db: any) {
    return db.materialCustomer.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  }

  async getCustomer(db: any, id: string) {
    const customer = await db.materialCustomer.findFirst({
      where: { id, deletedAt: null },
      include: { _count: { select: { sales: true } } },
    });
    if (!customer) throw new NotFoundException('Material customer not found');
    return customer;
  }

  createCustomer(db: any, data: MaterialCustomerDto) {
    return db.materialCustomer.create({ data: { ...data, balance: data.balance || 0 } });
  }

  async updateCustomer(db: any, id: string, data: MaterialCustomerDto) {
    const result = await db.materialCustomer.updateMany({ where: { id, deletedAt: null }, data });
    if (!result.count) throw new NotFoundException('Material customer not found');
    return db.materialCustomer.findUnique({ where: { id } });
  }

  async deleteCustomer(db: any, id: string) {
    const active = await db.materialSale.count({ where: { customerId: id, deletedAt: null } });
    if (active) throw new ConflictException('Customer has active invoices');
    const result = await db.materialCustomer.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!result.count) throw new NotFoundException('Material customer not found');
    return { deleted: true };
  }

  getSales(db: any) {
    return db.materialSale.findMany({
      where: { deletedAt: null },
      include: { customer: true, user: true, items: { include: { material: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async getSale(db: any, id: string) {
    const sale = await db.materialSale.findFirst({
      where: { id, deletedAt: null },
      include: { customer: true, user: true, items: { include: { material: true } } },
    });
    if (!sale) throw new NotFoundException('Material sale not found');
    return sale;
  }

  async createSale(db: any, userId: string, data: MaterialSaleDto) {
    const totals = this.saleTotals(data);
    return db.$transaction(async (tx: any) => {
      const sale = await tx.materialSale.create({
        data: {
          customerId: data.customerId,
          userId,
          invoiceNo: data.invoiceNo,
          ...totals,
          date: data.date || new Date(),
          notes: data.notes,
          items: { create: data.items },
        },
        include: { customer: true, items: true },
      });
      await this.applySaleStock(tx, sale, userId, -1);
      await this.adjustCustomerBalance(tx, sale.customerId, Number(sale.totalAmount) - Number(sale.paidAmount));
      await this.syncSaleLedger(tx, sale);
      return sale;
    }, { timeout: 30_000 });
  }

  async updateSale(db: any, id: string, userId: string, data: MaterialSaleDto) {
    const totals = this.saleTotals(data);
    return db.$transaction(async (tx: any) => {
      const existing = await tx.materialSale.findFirst({
        where: { id, deletedAt: null },
        include: { customer: true, items: true },
      });
      if (!existing) throw new NotFoundException('Material sale not found');
      await this.applySaleStock(tx, existing, userId, 1);
      await tx.materialSale.update({
        where: { id },
        data: {
          customer: data.customerId
            ? { connect: { id: data.customerId } }
            : { disconnect: true },
          invoiceNo: data.invoiceNo,
          ...totals,
          date: data.date || existing.date,
          notes: data.notes,
        },
      });
      await tx.materialSaleItem.deleteMany({ where: { saleId: id } });
      await tx.materialSaleItem.createMany({
        data: data.items.map((item) => ({ saleId: id, ...item })),
      });
      const sale = await tx.materialSale.findFirst({
        where: { id, deletedAt: null },
        include: { customer: true, items: true },
      });
      if (!sale) throw new NotFoundException('Material sale not found');
      await this.applySaleStock(tx, sale, userId, -1);
      await this.adjustCustomerBalance(tx, existing.customerId, Number(existing.paidAmount) - Number(existing.totalAmount));
      await this.adjustCustomerBalance(tx, sale.customerId, Number(sale.totalAmount) - Number(sale.paidAmount));
      await this.syncSaleLedger(tx, sale);
      return sale;
    }, { timeout: 60_000 });
  }

  async deleteSale(db: any, id: string, userId: string) {
    return db.$transaction(async (tx: any) => {
      const sale = await tx.materialSale.findFirst({
        where: { id, deletedAt: null },
        include: { customer: true, items: true },
      });
      if (!sale) throw new NotFoundException('Material sale not found');
      await this.applySaleStock(tx, sale, userId, 1);
      const deleted = await tx.materialSale.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (!deleted.count) throw new NotFoundException('Material sale not found');
      await this.adjustCustomerBalance(tx, sale.customerId, Number(sale.paidAmount) - Number(sale.totalAmount));
      await tx.transaction.updateMany({
        where: { referenceId: { startsWith: `sale:${id}:` }, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.accounting.retractPriorForSource(tx, 'MATERIAL_SALE', id);
      return { deleted: true };
    }, { timeout: 30_000 });
  }

  getTransportation(db: any) {
    return db.transportationRecord.findMany({
      where: { deletedAt: null },
      include: { items: { include: { material: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTransportationRecord(db: any, id: string) {
    const record = await db.transportationRecord.findFirst({
      where: { id, deletedAt: null },
      include: { items: { include: { material: true } } },
    });
    if (!record) throw new NotFoundException('Transportation record not found');
    return record;
  }

  async createTransportation(db: any, data: TransportationDto) {
    return db.$transaction(async (tx: any) => {
      const record = await tx.transportationRecord.create({
        data: {
          deliveryNo: data.deliveryNo,
          responsiblePerson: data.responsiblePerson,
          cost: data.cost,
          status: 'PENDING',
          deliveryDate: data.deliveryDate,
          notes: data.notes,
          items: { create: { materialId: data.materialId, quantity: data.quantity } },
        },
        include: { items: { include: { material: true } } },
      });
      await this.syncTransportationLedger(tx, record);
      return record;
    }, { timeout: 30_000 });
  }

  async updateTransportation(db: any, id: string, data: TransportationDto) {
    return db.$transaction(async (tx: any) => {
      const existing = await tx.transportationRecord.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Transportation record not found');
      await tx.transportationItem.deleteMany({ where: { transportationId: id } });
      const record = await tx.transportationRecord.update({
        where: { id },
        data: {
          deliveryNo: data.deliveryNo,
          responsiblePerson: data.responsiblePerson,
          cost: data.cost,
          status: existing.status,
          deliveryDate: data.deliveryDate,
          notes: data.notes,
          items: { create: { materialId: data.materialId, quantity: data.quantity } },
        },
        include: { items: { include: { material: true } } },
      });
      await this.syncTransportationLedger(tx, record);
      return record;
    });
  }

  async updateTransportationStatus(db: any, id: string, status: string) {
    return db.$transaction(async (tx: any) => {
      const existing = await tx.transportationRecord.findFirst({
        where: { id, deletedAt: null },
        include: { items: { include: { material: true } } },
      });
      if (!existing) throw new NotFoundException('Transportation record not found');
      if (existing.status === status) return existing;
      const allowed: Record<string, string[]> = {
        PENDING: ['IN_TRANSIT', 'DELIVERED', 'CANCELLED'],
        IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
        DELIVERED: [],
        CANCELLED: [],
      };
      if (!allowed[existing.status]?.includes(status)) {
        throw new BadRequestException(`Cannot transition delivery from ${existing.status} to ${status}`);
      }
      const record = await tx.transportationRecord.update({
        where: { id },
        data: {
          status: status as any,
          deliveryDate: status === 'DELIVERED' ? existing.deliveryDate || new Date() : existing.deliveryDate,
        },
        include: { items: { include: { material: true } } },
      });
      await this.syncTransportationLedger(tx, record);
      return record;
    }, { timeout: 30_000 });
  }

  async deleteTransportation(db: any, id: string) {
    return db.$transaction(async (tx: any) => {
      const result = await tx.transportationRecord.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (!result.count) throw new NotFoundException('Transportation record not found');
      await tx.transaction.updateMany({
        where: { referenceId: `transport:${id}`, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.accounting.retractPriorForSource(tx, 'TRANSPORTATION', id);
      return { deleted: true };
    });
  }

  private async applyPurchaseReceipt(tx: any, order: any, userId: string, direction: 1 | -1) {
    for (const item of order.items) {
      const material = await tx.material.findFirst({ where: { id: item.materialId, deletedAt: null } });
      if (!material) throw new NotFoundException('Purchase material not found');
      const qty = Number(item.quantity);
      const itemCost = Number(item.unitCost);
      const currentQty = Number(material.quantity);
      const currentCost = Number(material.unitCost);
      const next = currentQty + direction * qty;
      if (next < 0) throw new ConflictException(`Cannot reverse order; ${material.name} stock has already been consumed`);
      let newCost = currentCost;
      if (direction === 1 && next > 0) {
        newCost = (currentQty * currentCost + qty * itemCost) / next;
      } else if (direction === -1) {
        if (next <= 0) newCost = 0;
        else {
          const remainingValue = currentQty * currentCost - qty * itemCost;
          newCost = remainingValue / next;
          if (newCost < 0) newCost = 0;
        }
      }
      await tx.material.update({
        where: { id: material.id },
        data: { quantity: next, unitCost: newCost, version: { increment: 1 } },
      });
      await tx.inventoryTransaction.create({
        data: {
          materialId: item.materialId,
          type: direction === 1 ? 'RESTOCK' : 'ADJUSTMENT',
          quantity: item.quantity,
          userId,
          notes: `${direction === 1 ? 'Received' : 'Reverted'} purchase order ${order.orderNo}`,
        },
      });
    }
    if (order.supplierId) {
      await tx.supplier.update({ where: { id: order.supplierId }, data: { balance: { increment: direction * Number(order.totalCost) } } });
      await tx.supplierTransaction.create({
        data: {
          supplierId: order.supplierId,
          amount: direction * Number(order.totalCost),
          description: `${direction === 1 ? 'Received' : 'Reverted'} purchase order ${order.orderNo}`,
        },
      });
    }
  }

  private saleTotals(data: MaterialSaleDto) {
    const subtotal = data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const discountPercent = data.discountPercent || 0;
    const discountAmount = subtotal * discountPercent / 100;
    const totalAmount = subtotal - discountAmount;
    const paidAmount = data.paidAmount || 0;
    if (paidAmount > totalAmount) throw new BadRequestException('Paid amount cannot exceed invoice total');
    return { totalAmount, paidAmount, discountAmount, discountPercent };
  }

  private async applySaleStock(tx: any, sale: any, userId: string, direction: 1 | -1) {
    const quantities = new Map<string, number>();
    for (const item of sale.items) {
      quantities.set(item.materialId, (quantities.get(item.materialId) || 0) + Number(item.quantity));
    }
    for (const [materialId, quantity] of quantities) {
      const result = await tx.material.updateMany({
        where: direction === -1
          ? { id: materialId, deletedAt: null, quantity: { gte: quantity } }
          : { id: materialId, deletedAt: null },
        data: { quantity: { increment: direction * quantity }, version: { increment: 1 } },
      });
      if (!result.count) {
        const material = await tx.material.findUnique({ where: { id: materialId } });
        if (!material || material.deletedAt) throw new NotFoundException('Sale material not found');
        throw new BadRequestException(`Insufficient stock for ${material.name}`);
      }
    }
    for (const item of sale.items) {
      await tx.inventoryTransaction.create({
        data: {
          materialId: item.materialId,
          type: direction === -1 ? 'USAGE' : 'ADJUSTMENT',
          quantity: item.quantity,
          userId,
          notes: `${direction === -1 ? 'Material sale' : 'Reverted sale'} invoice ${sale.invoiceNo}`,
        },
      });
    }
  }

  private async adjustCustomerBalance(tx: any, customerId: string | null | undefined, amount: number) {
    if (!customerId || !amount) return;
    const result = await tx.materialCustomer.updateMany({
      where: { id: customerId, deletedAt: null },
      data: { balance: { increment: amount } },
    });
    if (!result.count) throw new NotFoundException('Material customer not found');
  }

  private async category(tx: any, name: string, color: string) {
    return (await tx.category.findFirst({ where: { name, deletedAt: null } }))
      || tx.category.create({ data: { name, color } });
  }

  private async syncPurchaseLedger(tx: any, order: any) {
    const referenceId = `purchase:${order.id}`;
    if (order.status !== 'RECEIVED' || Number(order.totalCost) <= 0) {
      await tx.transaction.updateMany({ where: { referenceId, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await this.accounting.retractPriorForSource(tx, 'PURCHASE', order.id);
      return;
    }
    const category = await this.category(tx, 'Procurement', '#ef4444');
    await tx.transaction.upsert({
      where: { referenceId },
      create: { referenceId, type: 'EXPENSE', status: 'CLEARED', description: `Procurement expense for purchase order ${order.orderNo}`, amount: order.totalCost, date: order.receivedAt || new Date(), categoryId: category.id },
      update: { amount: order.totalCost, date: order.receivedAt || new Date(), deletedAt: null, version: { increment: 1 } },
    });
    // Post the replacement batch first, then retract the prior batch only.
    // A failed post rolls the whole operation back instead of leaving the
    // source changed with the prior journal already reversed.
    const posted = await this.accounting.postFinancialEvent(tx, {
      tx,
      tenantId: 'system',
      sourceType: 'PURCHASE',
      sourceId: order.id,
      sourceRef: order.orderNo,
      date: order.receivedAt || new Date(),
      memo: `Procurement for purchase order ${order.orderNo}`,
      drKey: 'PURCHASE_INVOICE_EXPENSE',
      crKey: 'PURCHASE_INVOICE_AP',
      amount: Number(order.totalCost),
    });
    await this.accounting.retractPriorForSource(
      tx,
      'PURCHASE',
      order.id,
      undefined,
      posted ? [posted.id] : [],
    );
  }

  private async syncSaleLedger(tx: any, sale: any) {
    const prefix = `sale:${sale.id}:`;
    await tx.transaction.updateMany({ where: { referenceId: { startsWith: prefix }, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
    const total = Number(sale.totalAmount);
    const paid = Number(sale.paidAmount);
    const revenue = await this.category(tx, 'Material Sales', '#10b981');
    const receivable = await this.category(tx, 'Accounts Receivable', '#f59e0b');
    if (paid > 0) await tx.transaction.create({ data: { referenceId: `${prefix}paid:${sale.updatedAt.getTime()}`, type: 'INCOME', status: 'CLEARED', description: `Payment received for material sale invoice ${sale.invoiceNo}`, amount: paid, categoryId: revenue.id, userId: sale.userId, date: sale.date } });
    if (total - paid > 0) await tx.transaction.create({ data: { referenceId: `${prefix}due:${sale.updatedAt.getTime()}`, type: 'INCOME', status: 'PENDING', description: `Accounts receivable for material sale invoice ${sale.invoiceNo}`, amount: total - paid, categoryId: receivable.id, userId: sale.userId, date: sale.date } });
    // Post the fresh batches first, then retract prior batches (excluding the
    // just-posted ones) so a failed post rolls the whole operation back
    // instead of leaving the source changed with the prior journal reversed.
    // One batch for the paid portion (cash side) and one for the due
    // portion (AR side). Keeping them as separate batches makes the
    // ledger and AR aging reports easier to reason about.
    const postedIds: string[] = [];
    if (paid > 0) {
      const batch = await this.accounting.postFinancialEvent(tx, {
          tx, tenantId: 'system',
          sourceType: 'MATERIAL_SALE',
          sourceId: sale.id,
          sourceRef: `MAT-SALE-${sale.invoiceNo}`,
          date: sale.date, userId: sale.userId,
          memo: `Payment received on sale ${sale.invoiceNo}`,
          drKey: 'CUSTOMER_PAYMENT_CASH',
          crKey: 'SALES_INVOICE_REVENUE',
          amount: paid,
      });
      if (batch) postedIds.push(batch.id);
    }
    if (total - paid > 0) {
      const batch = await this.accounting.postFinancialEvent(tx, {
          tx, tenantId: 'system',
          sourceType: 'MATERIAL_SALE',
          sourceId: sale.id,
          sourceRef: `${sale.invoiceNo} · due`,
          date: sale.date, userId: sale.userId,
          memo: `Outstanding balance on sale ${sale.invoiceNo}`,
          drKey: 'SALES_INVOICE_AR',
          crKey: 'SALES_INVOICE_REVENUE',
          amount: total - paid,
      });
      if (batch) postedIds.push(batch.id);
    }
    await this.accounting.retractPriorForSource(tx, 'MATERIAL_SALE', sale.id, undefined, postedIds);
  }

  private async syncTransportationLedger(tx: any, record: any) {
    const referenceId = `transport:${record.id}`;
    if (record.status !== 'DELIVERED' || Number(record.cost) <= 0) {
      await tx.transaction.updateMany({ where: { referenceId, deletedAt: null }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await this.accounting.retractPriorForSource(tx, 'TRANSPORTATION', record.id);
      return;
    }
    const category = await this.category(tx, 'Transportation', '#ef4444');
    await tx.transaction.upsert({
      where: { referenceId },
      create: { referenceId, type: 'EXPENSE', status: 'CLEARED', description: `Transportation expense for delivery ${record.deliveryNo}`, amount: record.cost, date: record.deliveryDate || new Date(), categoryId: category.id },
      update: { amount: record.cost, date: record.deliveryDate || new Date(), deletedAt: null, version: { increment: 1 } },
    });
    // Post the replacement batch first, then retract the prior batch only.
    const posted = await this.accounting.postFinancialEvent(tx, {
        tx, tenantId: 'system',
        sourceType: 'TRANSPORTATION',
        sourceId: record.id,
        sourceRef: record.deliveryNo,
        date: record.deliveryDate || new Date(),
        memo: `Transportation expense for delivery ${record.deliveryNo}`,
        drKey: 'TRANSACTION_EXPENSE_ACCOUNT',
        crKey: 'TRANSACTION_EXPENSE_CASH',
        amount: Number(record.cost),
    });
    await this.accounting.retractPriorForSource(
      tx,
      'TRANSPORTATION',
      record.id,
      undefined,
      posted ? [posted.id] : [],
    );
  }
}
