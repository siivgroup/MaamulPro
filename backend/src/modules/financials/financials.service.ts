import { Injectable, NotFoundException, BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { createHash } from 'crypto';
import { isUUID } from 'class-validator';
import { AccountingService } from '../accounting/accounting.service';
import { AccountMappingsService } from '../accounting/account-mappings.service';
import {
  AccountDto,
  CategoryDto,
  CreateTransactionDto,
  TransactionQueryDto,
  UpdateTransactionDto,
} from './dto/financials.dto';

const NORMAL_BALANCE_BY_TYPE: Record<string, 'DEBIT' | 'CREDIT'> = {
  ASSET: 'DEBIT',
  EXPENSE: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  INCOME: 'CREDIT',
};

const SOURCE_MANAGED_PREFIXES = [
  'construction-procurement:', 'expense:', 'ledger:', 'wfpayment:', 'wfcontract:', 'subpayment:',
  'purchase:', 'sale:', 'transport:', 'deal:', 'rentpayment:', 'payroll-', 'invusage:',
];
const isSourceManaged = (referenceId: string) => SOURCE_MANAGED_PREFIXES.some((prefix) => referenceId.toLowerCase().startsWith(prefix));

@Injectable()
export class FinancialsService {

  constructor(
    private readonly accounting: AccountingService,
    private readonly mappings: AccountMappingsService,
  ) {}

  async getTransactions(tenantDb: any, query: TransactionQueryDto) {
    if (!tenantDb) return [];
    const where: any = { deletedAt: null };
    if (query?.type) where.type = query.type;
    if (query?.status) where.status = query.status;
    if (query?.search) {
      where.OR = [
        { referenceId: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.propertyId) where.propertyId = query.propertyId;
    if (query.materialId) where.materialId = query.materialId;
    if (query.startDate || query.endDate) {
      where.date = { gte: query.startDate, lte: query.endDate };
    }
    const page = query.page || 1;
    const limit = query.limit || 25;
    const [data, total] = await Promise.all([
      tenantDb.transaction.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: { category: true, project: true, property: true, deal: true, material: true },
        orderBy: { date: 'desc' },
      }),
      tenantDb.transaction.count({ where }),
    ]);
    return { data: data.map((row: any) => ({ ...row, sourceManaged: isSourceManaged(row.referenceId) })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async createTransaction(
    tenantDb: any,
    data: CreateTransactionDto & { idempotencyKey?: string; userId?: string; tenantId?: string },
  ) {
    if (!tenantDb) throw new BadRequestException('Tenant DB not available');
    if (!isUUID(data.idempotencyKey)) throw new BadRequestException('A valid x-idempotency-key UUID is required');
    // Hash only immutable submission inputs, including omitted dates. Never hash
    // the server-generated date or the mutable cashbook row used for replay.
    const input = {
      type: data.type, status: data.status || 'PENDING', amount: Number(data.amount),
      description: data.description, date: data.date ? new Date(data.date).toISOString() : null,
      categoryId: data.categoryId || null, projectId: data.projectId || null,
      propertyId: data.propertyId || null, dealId: data.dealId || null, materialId: data.materialId || null,
      notes: data.notes || null, userId: data.userId || null,
      debitAccountCode: data.debitAccountCode || null, creditAccountCode: data.creditAccountCode || null,
    };
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    return tenantDb.$transaction(async (tx: any) => {
      // Serialize identical intents across processes before reading or posting.
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', 'financial:' + data.idempotencyKey);
      const existing = await tx.transaction.findUnique({ where: { referenceId: data.idempotencyKey } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException({ code: 'SUBMISSION_CONFLICT', message: 'This submission reference was already used with different details' });
        return existing;
      }
      const date = data.date ? new Date(data.date) : new Date();
      const batch = input.status === 'CLEARED' ? await this.postTransaction(tenantDb, tx, {
        ...input, date, tenantId: data.tenantId, referenceId: data.idempotencyKey,
      }) : null;
      const { debitAccountCode, creditAccountCode, ...row } = input;
      return tx.transaction.create({ data: {
        ...row, date, referenceId: data.idempotencyKey, requestHash,
        journalBatchId: batch?.id || null, postingStatus: batch ? 'POSTED' : 'UNPOSTED',
      } });
    }).catch((error: unknown) => {
      // Domain errors occur inside the transaction and roll back. An unknown
      // driver/commit error remains uncertain: the client must keep its intent.
      if (error instanceof HttpException && (error.getResponse() as any)?.code !== 'SUBMISSION_CONFLICT') {
        throw new HttpException({ code: 'TRANSACTION_REJECTED', message: error.message, requestId: data.idempotencyKey }, error.getStatus());
      }
      throw error;
    });
  }

  private async postTransaction(tenantDb: any, tx: any, row: any) {
    return this.accounting.postFinancialEvent(tenantDb, {
      tx, tenantId: row.tenantId || 'system', userId: row.userId || undefined,
      sourceType: 'TRANSACTION', sourceRef: row.referenceId, date: row.date,
      memo: row.description, amount: Number(row.amount),
      drKey: row.type === 'INCOME' ? 'TRANSACTION_INCOME_CASH' : 'TRANSACTION_EXPENSE_ACCOUNT',
      crKey: row.type === 'INCOME' ? 'TRANSACTION_INCOME_REVENUE' : 'TRANSACTION_EXPENSE_CASH',
      drAccountOverride: row.debitAccountCode || undefined,
      crAccountOverride: row.creditAccountCode || undefined,
    });
  }

  async updateTransaction(tenantDb: any, id: string, data: UpdateTransactionDto) {
    return tenantDb.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT id FROM transactions WHERE id = $1 FOR UPDATE', id);
      const existing = await tx.transaction.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Transaction not found');
      if (isSourceManaged(existing.referenceId)) throw new BadRequestException('This transaction is synchronized; edit it in its source module');
      if (existing.version !== data.version) throw new ConflictException('Transaction changed or no longer exists; reload and retry');
      if (existing.journalBatchId) await this.accounting.reverseBatchWithinTx(tx, {
        userId: existing.userId || undefined, batchId: existing.journalBatchId,
        memo: 'Superseded by update of transaction ' + id,
      });
      const next = { ...existing, ...Object.fromEntries(Object.entries(data).filter(([,value]) => value !== undefined)) };
      const batch = next.status === 'CLEARED' ? await this.postTransaction(tenantDb, tx, next) : null;
      const { version, ...changes } = data;
      return tx.transaction.update({ where: { id }, data: {
        ...changes, journalBatchId: batch?.id || null,
        postingStatus: batch ? 'POSTED' : 'UNPOSTED', version: { increment: 1 },
      } });
    });
  }

  async deleteTransaction(tenantDb: any, id: string) {
    return tenantDb.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT id FROM transactions WHERE id = $1 FOR UPDATE', id);
      const existing = await tx.transaction.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Transaction not found');
      if (existing.deletedAt) return { deleted: true };
      if (isSourceManaged(existing.referenceId)) throw new BadRequestException('This transaction is synchronized; delete it in its source module');
      if (existing.journalBatchId) await this.accounting.reverseBatchWithinTx(tx, {
        userId: existing.userId || undefined, batchId: existing.journalBatchId,
        memo: 'Soft-delete of transaction ' + id,
      });
      await tx.transaction.update({ where: { id }, data: {
        deletedAt: new Date(), postingStatus: 'UNPOSTED', journalBatchId: null, version: { increment: 1 },
      } });
      return { deleted: true };
    });
  }

  async getSummary(tenantDb: any, query: TransactionQueryDto) {
    const where: any = {
      deletedAt: null,
      status: 'CLEARED',
      // Legacy USAGE cashbook rows double-counted purchases; keep them out of company totals.
      NOT: { referenceId: { startsWith: 'invusage:' } },
    };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.startDate || query.endDate) where.date = { gte: query.startDate, lte: query.endDate };
    if (query.search) where.description = { contains: query.search, mode: 'insensitive' };
    const [income, expense, total] = await Promise.all([
      tenantDb.transaction.aggregate({ where: { ...where, type: 'INCOME' }, _sum: { amount: true }, _count: true }),
      tenantDb.transaction.aggregate({ where: { ...where, type: 'EXPENSE' }, _sum: { amount: true }, _count: true }),
      tenantDb.transaction.count({ where }),
    ]);
    const totalIncome = Number(income._sum.amount || 0);
    const totalExpense = Number(expense._sum.amount || 0);
    return { totalIncome, totalExpense, netBalance: totalIncome - totalExpense, totalCount: total };
  }

  listCategories(tenantDb: any) {
    return tenantDb.category.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  }

  async createCategory(tenantDb: any, data: CategoryDto) {
    try {
      return await tenantDb.category.create({ data: { ...data, color: data.color || '#6366f1' } });
    } catch {
      throw new ConflictException('Category name or code already exists');
    }
  }

  async updateCategory(tenantDb: any, id: string, data: CategoryDto) {
    const existing = await tenantDb.category.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new NotFoundException('Category not found');
    if (existing.code?.startsWith('CEXP_') && (data.name !== existing.name || (data.code !== undefined && data.code !== existing.code))) {
      throw new ConflictException('Construction expense category names and codes are managed by the Construction module');
    }
    const result = await tenantDb.category.updateMany({
      where: { id, deletedAt: null },
      data,
    });
    if (!result.count) throw new NotFoundException('Category not found');
    return tenantDb.category.findUnique({ where: { id } });
  }

  async deleteCategory(tenantDb: any, id: string) {
    const category = await tenantDb.category.findFirst({ where: { id, deletedAt: null } });
    if (!category) throw new NotFoundException('Category not found');
    if (category.code?.startsWith('CEXP_')) throw new ConflictException('Construction expense categories are managed by the Construction module');
    const used = await tenantDb.transaction.count({ where: { categoryId: id, deletedAt: null } });
    if (used) throw new ConflictException('Category is used by active transactions');
    const result = await tenantDb.category.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Category not found');
    return { deleted: true };
  }

  listAccounts(tenantDb: any) {
    return tenantDb.account.findMany({ orderBy: { code: 'asc' } });
  }

  async createAccount(tenantDb: any, tenantId: string, data: AccountDto) {
    const existing = await tenantDb.account.findUnique({ where: { code: data.code } });
    if (existing) throw new ConflictException('Account code already exists');
    if (data.parentCode) {
      const parent = await tenantDb.account.findUnique({ where: { code: data.parentCode } });
      if (!parent) throw new BadRequestException('Parent account does not exist');
    }
    return tenantDb.account.create({
      data: {
        ...data,
        tenantId,
        normalBalance: NORMAL_BALANCE_BY_TYPE[data.type] || 'DEBIT',
      },
    });
  }

  async updateAccount(tenantDb: any, code: string, data: AccountDto) {
    if (data.code !== code) throw new BadRequestException('Account code cannot be changed');
    return tenantDb.account.update({
      where: { code },
      data: {
        ...data,
        normalBalance: NORMAL_BALANCE_BY_TYPE[data.type] || 'DEBIT',
      },
    });
  }

  async deleteAccount(tenantDb: any, code: string) {
    const [journals, children, payrolls] = await Promise.all([
      tenantDb.journalEntry.count({ where: { accountCode: code } }),
      tenantDb.account.count({ where: { parentCode: code } }),
      tenantDb.payroll.count({ where: { expenseAccountCode: code, deletedAt: null } }),
    ]);
    if (journals || children || payrolls) {
      throw new ConflictException('Account is referenced and cannot be deleted');
    }
    await tenantDb.account.delete({ where: { code } });
    return { deleted: true };
  }
}
