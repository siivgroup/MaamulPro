import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AccountMappingsService } from './account-mappings.service';
import {
  AccountBalanceQueryDto,
  CreateJournalBatchDto,
  CreateAccountingPeriodDto,
  JournalBatchQueryDto,
  JournalLineDto,
  UpsertAccountDto,
} from './dto/accounting.dto';

// Precision for money math. Two decimal places, half-up rounding, no
// implicit floating-point drift in the accountant-facing totals.
const CENT = 100;
const roundToCents = (n: number): number => Math.round(n * CENT) / CENT;

// Types allowed to source a batch. Free-form string in DB so future
// integrations don't need a schema migration to add a source.
export type JournalSource =
  | 'MANUAL'
  | 'TRANSACTION'
  | 'INVOICE'
  | 'PAYMENT'
  | 'PAYROLL'
  | 'RENTAL'
  | 'DEAL'
  | 'PURCHASE'
  | 'ADJUSTMENT'
  | 'REVERSAL';

const NORMAL_BALANCE_BY_TYPE: Record<string, 'DEBIT' | 'CREDIT'> = {
  ASSET: 'DEBIT',
  EXPENSE: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  INCOME: 'CREDIT',
};

function randomBytesHex(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

function generateBatchNumber(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `JE-${y}${m}${day}-${randomBytesHex()}`;
}

const utcDayStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const utcDayEnd = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
const sameUtcMonth = (left: Date, right: Date) => left.getUTCFullYear() === right.getUTCFullYear() && left.getUTCMonth() === right.getUTCMonth();

function monthlyPeriod(date: Date) {
  const startDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const month = String(startDate.getUTCMonth() + 1).padStart(2, '0');
  return {
    id: `system-accounting-period-${startDate.getUTCFullYear()}-${month}`,
    name: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(startDate),
    startDate,
    endDate: new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0, 23, 59, 59, 999)),
    status: 'OPEN',
  };
}

@Injectable()
export class AccountingService {

  constructor(private readonly mappings: AccountMappingsService) {}

  listPeriods(tenantDb: any) {
    return tenantDb.accountingPeriod.findMany({ orderBy: { startDate: 'desc' } });
  }

  async createPeriod(tenantDb: any, dto: CreateAccountingPeriodDto) {
    const startDate = utcDayStart(dto.startDate);
    const endDate = utcDayEnd(dto.endDate);
    if (endDate < startDate) throw new BadRequestException('Period end date must be on or after its start date');
    const overlap = await tenantDb.accountingPeriod.findFirst({
      where: { startDate: { lte: endDate }, endDate: { gte: startDate } },
    });
    if (overlap) throw new ConflictException(`Accounting period overlaps '${overlap.name}'`);
    return tenantDb.accountingPeriod.create({ data: { ...dto, startDate, endDate } });
  }

  async setPeriodLock(tenantDb: any, id: string, locked: boolean, userId?: string) {
    const period = await tenantDb.accountingPeriod.findUnique({ where: { id } });
    if (!period) throw new NotFoundException('Accounting period not found');
    return tenantDb.accountingPeriod.update({
      where: { id },
      data: { status: locked ? 'LOCKED' : 'OPEN', lockedAt: locked ? new Date() : null, lockedById: locked ? userId : null },
    });
  }

  private async assertPeriodOpen(tx: any, date: Date) {
    let period = await tx.accountingPeriod.findFirst({
      where: { startDate: { lte: date }, endDate: { gte: utcDayStart(date) } },
      select: { name: true, status: true },
    });
    if (!period && sameUtcMonth(date, new Date())) {
      const current = monthlyPeriod(date);
      period = await tx.accountingPeriod.upsert({
        where: { id: current.id }, update: {}, create: current,
        select: { name: true, status: true },
      });
    }
    if (!period) throw new ConflictException(`No accounting period covers ${date.toISOString().slice(0, 10)}`);
    if (period.status !== 'OPEN') throw new ConflictException(`Accounting period '${period.name}' is locked`);
  }

  // ────────────────────────────────────────────────────────────
  // Integration helper — post a balanced 2-line batch from a
  // mapped source. Called by every module hook (sales, purchase,
  // rental, payroll, etc.). Resolves the DR + CR mapping keys in
  // one round-trip, then posts inside the caller's transaction so
  // failure rolls the whole source-record write back.
  // ────────────────────────────────────────────────────────────

  /**
   * Reverse every still-POSTED batch that belongs to (sourceType, sourceId).
   * Called by module sync hooks after they post a fresh batch — mirrors
   * the "soft-delete prior tx rows, insert fresh" pattern that hooks like
   * syncSaleLedger and syncDealLedger already use for the informal ledger,
   * but preserves audit trail (the reversal batch stays visible).
   */
  async retractPriorForSource(
    tx: any,
    sourceType: string,
    sourceId: string,
    userId?: string,
    exceptBatchIds?: string[],
  ) {
    const prior = await tx.journalBatch.findMany({
      where: {
        sourceType,
        sourceId,
        status: 'POSTED',
        ...(exceptBatchIds?.length ? { id: { notIn: exceptBatchIds } } : {}),
      },
      select: { id: true },
    });
    for (const p of prior) {
      await this.reverseBatchWithinTx(tx, { userId, batchId: p.id, memo: `Superseded by fresh sync of ${sourceType}:${sourceId}` });
    }
  }

  /** Internal variant of reverseBatch that reuses the caller's tx. */
  async reverseBatchWithinTx(
    tx: any,
    args: { userId?: string; batchId: string; memo?: string },
  ) {
    await tx.$queryRawUnsafe('SELECT id FROM journal_batches WHERE id = $1 FOR UPDATE', args.batchId);
    const original = await tx.journalBatch.findUnique({
      where: { id: args.batchId },
      include: { entries: true },
    });
    if (!original || original.status !== 'POSTED' || original.reversedByBatchId) return null;
    const now = new Date();
    await this.assertPeriodOpen(tx, original.date);
    await this.assertPeriodOpen(tx, now);
    const reversal = await tx.journalBatch.create({
      data: {
        tenantId: original.tenantId,
        batchNumber: `JE-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}-${randomBytesHex()}`,
        date: now,
        memo: args.memo ?? `Reversal of ${original.batchNumber}`,
        sourceType: 'REVERSAL',
        sourceId: original.id,
        sourceRef: original.batchNumber,
        status: 'POSTED',
        totalDebit: Number(original.totalCredit),
        totalCredit: Number(original.totalDebit),
        postedById: args.userId,
        postedAt: now,
        reversesBatchId: original.id,
      },
    });
    await tx.journalEntry.createMany({
      data: original.entries.map((e: any, idx: number) => ({
        batchId: reversal.id,
        tenantId: original.tenantId,
        accountCode: e.accountCode,
        type: Number(e.debit) > 0 ? 'CREDIT' : 'DEBIT',
        date: now,
        memo: `Reversal of ${original.batchNumber}`,
        contactName: e.contactName,
        splitAccountCode: e.splitAccountCode,
        debit: Number(e.credit),
        credit: Number(e.debit),
        lineNumber: idx + 1,
      })),
    });
    await tx.journalBatch.update({
      where: { id: original.id },
      data: { status: 'REVERSED', reversedByBatchId: reversal.id },
    });
    return reversal;
  }

  async postFinancialEvent(
    tenantDb: any,
    args: {
      tx: any;
      tenantId: string;
      userId?: string;
      sourceType: string;
      sourceId?: string;
      sourceRef?: string;
      date?: Date;
      memo?: string;
      drKey: string;
      crKey: string;
      amount: number;
      drAccountOverride?: string;
      crAccountOverride?: string;
    },
  ) {
    if (!args.amount || args.amount <= 0) return null;
    const codes = args.drAccountOverride && args.crAccountOverride
      ? { dr: args.drAccountOverride, cr: args.crAccountOverride }
      : await (async () => {
          const resolved = await this.mappings.resolveMany(args.tx, [args.drKey, args.crKey]);
          return {
            dr: args.drAccountOverride ?? resolved[args.drKey],
            cr: args.crAccountOverride ?? resolved[args.crKey],
          };
        })();
    return this.postJournalBatch(tenantDb, {
      tenantId: args.tenantId,
      userId: args.userId,
      tx: args.tx,
      dto: {
        date: args.date,
        memo: args.memo,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        sourceRef: args.sourceRef,
        lines: [
          { accountCode: codes.dr, debit: args.amount, credit: 0 },
          { accountCode: codes.cr, debit: 0, credit: args.amount },
        ],
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  // Chart of Accounts
  // ────────────────────────────────────────────────────────────

  async listAccounts(tenantDb: any) {
    const accounts = await tenantDb.account.findMany({ orderBy: { code: 'asc' } });
    const balances = await this.getBalancesByAccount(tenantDb);
    return accounts.map((a: any) => ({
      ...a,
      currentBalance: balances.get(a.code) ?? 0,
    }));
  }

  async getChartOfAccountsTree(tenantDb: any) {
    const flat = await this.listAccounts(tenantDb);
    // Group children under parent codes.
    const byParent = new Map<string | null, any[]>();
    for (const acc of flat) {
      const p = acc.parentCode ?? null;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(acc);
    }
    const build = (parent: string | null): any[] =>
      (byParent.get(parent) ?? []).map((node) => ({
        ...node,
        children: build(node.code),
      }));
    return build(null);
  }

  async upsertAccount(tenantDb: any, tenantId: string, data: UpsertAccountDto) {
    const code = data.code || String((await tenantDb.account.findMany({ select: { code: true } }))
      .reduce((largest: number, account: { code: string }) => Math.max(largest, Number(account.code) || 0), 990) + 10);
    if (data.parentCode) {
      if (data.parentCode === code) {
        throw new BadRequestException('Account cannot be its own parent');
      }
      const parent = await tenantDb.account.findUnique({ where: { code: data.parentCode } });
      if (!parent) throw new BadRequestException('Parent account does not exist');
      if (parent.type !== data.type) {
        throw new BadRequestException('Child account must share the parent account type');
      }
    }
    const normalBalance = data.normalBalance ?? NORMAL_BALANCE_BY_TYPE[data.type];
    const existing = await tenantDb.account.findUnique({ where: { code } });
    if (existing) {
      if (existing.isSystem && existing.type !== data.type) {
        throw new BadRequestException('System account type cannot be changed');
      }
      return tenantDb.account.update({
        where: { code },
        data: {
          name: data.name,
          parentCode: data.parentCode ?? null,
          type: data.type,
          description: data.description ?? null,
          normalBalance,
          isActive: data.isActive ?? existing.isActive,
          allowNegative: data.allowNegative ?? existing.allowNegative,
        },
      });
    }
    return tenantDb.account.create({
      data: {
        code,
        name: data.name,
        parentCode: data.parentCode ?? null,
        type: data.type,
        tenantId,
        description: data.description ?? null,
        normalBalance,
        isActive: data.isActive ?? true,
        allowNegative: data.allowNegative ?? true,
      },
    });
  }

  async setAccountActive(tenantDb: any, code: string, isActive: boolean) {
    const account = await tenantDb.account.findUnique({ where: { code } });
    if (!account) throw new NotFoundException('Account not found');
    return tenantDb.account.update({ where: { code }, data: { isActive } });
  }

  async deleteAccount(tenantDb: any, code: string) {
    const account = await tenantDb.account.findUnique({ where: { code } });
    if (!account) throw new NotFoundException('Account not found');
    if (account.isSystem) throw new ConflictException('System accounts cannot be deleted');
    const [entries, children, payrolls] = await Promise.all([
      tenantDb.journalEntry.count({ where: { accountCode: code } }),
      tenantDb.account.count({ where: { parentCode: code } }),
      tenantDb.payroll.count({ where: { expenseAccountCode: code, deletedAt: null } }),
    ]);
    if (entries || children || payrolls) {
      throw new ConflictException('Account is referenced and cannot be deleted; deactivate it instead');
    }
    await tenantDb.account.delete({ where: { code } });
    return { deleted: true };
  }

  // ────────────────────────────────────────────────────────────
  // Balances
  // ────────────────────────────────────────────────────────────

  /**
   * Returns balance for every account keyed by code. Balance is signed by
   * normal_balance: for DEBIT-normal accounts, balance = DR - CR; for
   * CREDIT-normal accounts, balance = CR - DR. This gives every account
   * a positive number when it's on its natural side.
   */
  private async getBalancesByAccount(tenantDb: any, asOf?: Date): Promise<Map<string, number>> {
    const where: any = { batch: { deletedAt: null } };
    if (asOf) where.date = { lte: asOf };
    const grouped = await tenantDb.journalEntry.groupBy({
      by: ['accountCode'],
      where,
      _sum: { debit: true, credit: true },
    });
    const accounts = await tenantDb.account.findMany({
      select: { code: true, normalBalance: true },
    });
    const normalByCode = new Map<string, string>(
      accounts.map((a: any) => [a.code, a.normalBalance]),
    );
    const out = new Map<string, number>();
    for (const row of grouped) {
      const dr = Number(row._sum.debit || 0);
      const cr = Number(row._sum.credit || 0);
      const normal = normalByCode.get(row.accountCode) || 'DEBIT';
      out.set(row.accountCode, roundToCents(normal === 'CREDIT' ? cr - dr : dr - cr));
    }
    // Ensure every account has a balance (0 for those with no entries yet).
    for (const a of accounts) if (!out.has(a.code)) out.set(a.code, 0);
    return out;
  }

  async getAccountBalance(tenantDb: any, code: string, query: AccountBalanceQueryDto = {}) {
    const account = await tenantDb.account.findUnique({ where: { code } });
    if (!account) throw new NotFoundException('Account not found');
    const balances = await this.getBalancesByAccount(tenantDb, query.asOf);
    return {
      code,
      name: account.name,
      type: account.type,
      normalBalance: account.normalBalance,
      balance: balances.get(code) ?? 0,
      asOf: query.asOf ?? new Date(),
    };
  }

  // ────────────────────────────────────────────────────────────
  // Journal batch posting
  // ────────────────────────────────────────────────────────────

  /**
   * Posts a balanced journal batch. Validates:
   *   - at least two lines,
   *   - every line has exclusively DR or CR > 0,
   *   - sum(DR) === sum(CR),
   *   - all referenced accounts exist and are active,
   *   - allow_negative honoured (rejects a post that would take a
   *     no-negative account below zero on its normal side).
   * Runs in a single DB transaction. Callers passing `tx` reuse an
   * outer transaction, which is how the FinancialsService wires
   * Transaction + JournalBatch in the same commit.
   */
  async postJournalBatch(
    tenantDb: any,
    args: {
      tenantId: string;
      userId?: string;
      dto: CreateJournalBatchDto;
      tx?: any;
    },
  ) {
    const { tenantId, userId, dto } = args;
    const runner = args.tx ?? tenantDb;
    const executor = async (tx: any) => this.doPost(tx, tenantId, userId, dto);
    // If caller already gave us a transaction client, don't nest.
    return args.tx ? executor(args.tx) : tenantDb.$transaction(executor);
  }

  private async doPost(
    tx: any,
    tenantId: string,
    userId: string | undefined,
    dto: CreateJournalBatchDto,
  ) {
    const postingDate = dto.date ?? new Date();
    await this.assertPeriodOpen(tx, postingDate);
    const lines = this.normalizeLines(dto.lines);
    const totalDebit = roundToCents(lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = roundToCents(lines.reduce((s, l) => s + l.credit, 0));
    if (totalDebit !== totalCredit) {
      throw new BadRequestException(
        `Journal batch is unbalanced: DR ${totalDebit} vs CR ${totalCredit}`,
      );
    }
    if (totalDebit === 0) {
      throw new BadRequestException('Journal batch must have a non-zero total');
    }

    // Validate all accounts exist and are active (single query).
    const codes = Array.from(new Set(lines.map((l) => l.accountCode)));
    const accounts = await tx.account.findMany({
      where: { code: { in: codes } },
      select: { code: true, isActive: true, allowNegative: true, normalBalance: true, name: true },
    });
    if (accounts.length !== codes.length) {
      const found = new Set(accounts.map((a: any) => a.code));
      const missing = codes.filter((c) => !found.has(c));
      throw new BadRequestException(`Unknown account code(s): ${missing.join(', ')}`);
    }
    const inactive = accounts.filter((a: any) => !a.isActive);
    if (inactive.length) {
      throw new BadRequestException(
        `Inactive account(s) cannot be posted: ${inactive.map((a: any) => a.code).join(', ')}`,
      );
    }

    // Allow-negative enforcement: compute projected balances only for
    // the affected accounts; skip the check for accounts that already
    // allow negatives (the common case).
    const restrictedCodes = accounts
      .filter((a: any) => !a.allowNegative)
      .map((a: any) => a.code);
    if (restrictedCodes.length) {
      const current = await tx.journalEntry.groupBy({
        by: ['accountCode'],
        where: { accountCode: { in: restrictedCodes } },
        _sum: { debit: true, credit: true },
      });
      const byCode = new Map<string, { dr: number; cr: number }>();
      for (const row of current) {
        byCode.set(row.accountCode, {
          dr: Number(row._sum.debit || 0),
          cr: Number(row._sum.credit || 0),
        });
      }
      for (const line of lines) {
        const acc = accounts.find((a: any) => a.code === line.accountCode);
        if (!acc || acc.allowNegative) continue;
        const cur = byCode.get(line.accountCode) ?? { dr: 0, cr: 0 };
        cur.dr += line.debit;
        cur.cr += line.credit;
        byCode.set(line.accountCode, cur);
      }
      for (const code of restrictedCodes) {
        const cur = byCode.get(code) ?? { dr: 0, cr: 0 };
        const acc = accounts.find((a: any) => a.code === code)!;
        const projected =
          acc.normalBalance === 'CREDIT' ? cur.cr - cur.dr : cur.dr - cur.cr;
        if (projected < 0) {
          throw new BadRequestException(
            `Posting would take ${code} (${acc.name}) below zero (projected ${projected.toFixed(2)})`,
          );
        }
      }
    }

    const now = new Date();
    const batch = await tx.journalBatch.create({
      data: {
        tenantId,
        batchNumber: generateBatchNumber(),
        date: dto.date ?? now,
        memo: dto.memo,
        sourceType: dto.sourceType ?? 'MANUAL',
        sourceId: dto.sourceId,
        sourceRef: dto.sourceRef,
        status: 'POSTED',
        totalDebit,
        totalCredit,
        postedById: userId,
        postedAt: now,
      },
    });

    // createMany is much cheaper than N inserts for typical 2–20 line
    // batches, and keeps this posting path fast even when hooks fan out
    // several batches per user action.
    await tx.journalEntry.createMany({
      data: lines.map((l, idx) => ({
        batchId: batch.id,
        tenantId,
        accountCode: l.accountCode,
        type: l.debit > 0 ? 'DEBIT' : 'CREDIT',
        date: dto.date ?? now,
        memo: l.memo ?? dto.memo ?? null,
        contactName: l.contactName ?? null,
        splitAccountCode:
          lines.length === 2 ? lines[1 - idx].accountCode : null,
        debit: l.debit,
        credit: l.credit,
        lineNumber: idx + 1,
      })),
    });

    return batch;
  }

  private normalizeLines(input: JournalLineDto[]) {
    if (!input || input.length < 2) {
      throw new BadRequestException('A journal batch requires at least two lines');
    }
    return input.map((line, idx) => {
      const debit = roundToCents(Number(line.debit || 0));
      const credit = roundToCents(Number(line.credit || 0));
      if (debit < 0 || credit < 0) {
        throw new BadRequestException(`Line ${idx + 1}: amounts must be non-negative`);
      }
      if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        throw new BadRequestException(
          `Line ${idx + 1}: must have either a debit OR a credit (not both, not zero)`,
        );
      }
      return {
        accountCode: line.accountCode,
        debit,
        credit,
        memo: line.memo,
        contactName: line.contactName,
      };
    });
  }

  /**
   * Reverses a posted batch by writing a mirror batch and linking both
   * sides. Preferred to deletion because it preserves the audit trail —
   * the original entries stay, the reversal cancels them, and both are
   * visible on account statements.
   */
  async reverseBatch(
    tenantDb: any,
    args: { userId?: string; batchId: string; memo?: string },
  ) {
    return tenantDb.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT id FROM journal_batches WHERE id = $1 FOR UPDATE', args.batchId);
      const original = await tx.journalBatch.findUnique({
        where: { id: args.batchId },
        include: { entries: true },
      });
      if (!original) throw new NotFoundException('Batch not found');
      if (original.status !== 'POSTED') {
        throw new ConflictException(`Batch is ${original.status}; only POSTED batches can be reversed`);
      }
      if (original.reversedByBatchId) {
        throw new ConflictException('Batch has already been reversed');
      }
      const now = new Date();
      await this.assertPeriodOpen(tx, original.date);
      await this.assertPeriodOpen(tx, now);
      const totalDebit = Number(original.totalCredit);
      const totalCredit = Number(original.totalDebit);
      const reversal = await tx.journalBatch.create({
        data: {
          tenantId: original.tenantId,
          batchNumber: generateBatchNumber(),
          date: now,
          memo: args.memo ?? `Reversal of ${original.batchNumber}`,
          sourceType: 'REVERSAL',
          sourceId: original.id,
          sourceRef: original.batchNumber,
          status: 'POSTED',
          totalDebit,
          totalCredit,
          postedById: args.userId,
          postedAt: now,
          reversesBatchId: original.id,
        },
      });
      await tx.journalEntry.createMany({
        data: original.entries.map((e: any, idx: number) => ({
          batchId: reversal.id,
          tenantId: original.tenantId,
          accountCode: e.accountCode,
          type: Number(e.debit) > 0 ? 'CREDIT' : 'DEBIT',
          date: now,
          memo: `Reversal of ${original.batchNumber}`,
          contactName: e.contactName,
          splitAccountCode: e.splitAccountCode,
          debit: Number(e.credit),
          credit: Number(e.debit),
          lineNumber: idx + 1,
        })),
      });
      await tx.journalBatch.update({
        where: { id: original.id },
        data: { status: 'REVERSED', reversedByBatchId: reversal.id },
      });
      return reversal;
    });
  }

  // ────────────────────────────────────────────────────────────
  // Read: batches + ledger
  // ────────────────────────────────────────────────────────────

  async listJournalBatches(tenantDb: any, query: JournalBatchQueryDto) {
    const where: any = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.sourceType) where.sourceType = query.sourceType;
    if (query.startDate || query.endDate) {
      where.date = { gte: query.startDate, lte: query.endDate };
    }
    if (query.search) {
      where.OR = [
        { batchNumber: { contains: query.search, mode: 'insensitive' } },
        { memo: { contains: query.search, mode: 'insensitive' } },
        { sourceRef: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const page = query.page || 1;
    const limit = query.limit || 25;
    const [data, total] = await Promise.all([
      tenantDb.journalBatch.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { postedBy: { select: { id: true, name: true, email: true } } },
      }),
      tenantDb.journalBatch.count({ where }),
    ]);
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getJournalBatch(tenantDb: any, id: string) {
    const batch = await tenantDb.journalBatch.findUnique({
      where: { id },
      include: {
        entries: {
          include: { account: { select: { code: true, name: true, type: true } } },
          orderBy: { lineNumber: 'asc' },
        },
        postedBy: { select: { id: true, name: true, email: true } },
        reverses: { select: { id: true, batchNumber: true } },
        reversedBy: { select: { id: true, batchNumber: true } },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  /**
   * Per-account statement: chronological entries with a running
   * balance signed by normal_balance (opening balance + line effect).
   */
  async getAccountLedger(
    tenantDb: any,
    code: string,
    args: { startDate?: Date; endDate?: Date; page?: number; limit?: number } = {},
  ) {
    const account = await tenantDb.account.findUnique({ where: { code } });
    if (!account) throw new NotFoundException('Account not found');
    const normal = account.normalBalance as 'DEBIT' | 'CREDIT';
    const page = args.page || 1;
    const limit = args.limit || 100;

    const allAccounts = await tenantDb.account.findMany({ select: { code: true, parentCode: true } });
    const targetCodesSet = new Set<string>([code]);
    let added = true;
    while (added) {
      added = false;
      for (const acc of allAccounts) {
        if (acc.parentCode && targetCodesSet.has(acc.parentCode) && !targetCodesSet.has(acc.code)) {
          targetCodesSet.add(acc.code);
          added = true;
        }
      }
    }
    const targetCodes = Array.from(targetCodesSet);

    // Opening balance: everything strictly before startDate.
    let opening = 0;
    if (args.startDate) {
      const agg = await tenantDb.journalEntry.aggregate({
        where: { accountCode: { in: targetCodes }, date: { lt: args.startDate } },
        _sum: { debit: true, credit: true },
      });
      const dr = Number(agg._sum.debit || 0);
      const cr = Number(agg._sum.credit || 0);
      opening = roundToCents(normal === 'CREDIT' ? cr - dr : dr - cr);
    }

    const where: any = { accountCode: { in: targetCodes } };
    if (args.startDate || args.endDate) {
      where.date = { gte: args.startDate, lte: args.endDate };
    }
    const [rows, total] = await Promise.all([
      tenantDb.journalEntry.findMany({
        where,
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { batch: { select: { id: true, batchNumber: true, sourceType: true, sourceRef: true } } },
      }),
      tenantDb.journalEntry.count({ where }),
    ]);

    let running = opening;
    const lines = rows.map((r: any) => {
      const dr = Number(r.debit);
      const cr = Number(r.credit);
      running = roundToCents(running + (normal === 'CREDIT' ? cr - dr : dr - cr));
      return {
        id: r.id,
        date: r.date,
        batchNumber: r.batch?.batchNumber,
        batchId: r.batch?.id,
        sourceType: r.batch?.sourceType,
        sourceRef: r.batch?.sourceRef,
        memo: r.memo,
        contactName: r.contactName,
        debit: dr,
        credit: cr,
        balance: running,
      };
    });

    return {
      account: {
        code: account.code,
        name: account.name,
        type: account.type,
        normalBalance: account.normalBalance,
      },
      opening,
      closing: running,
      data: lines,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ────────────────────────────────────────────────────────────
  // Financial Reports
  // ────────────────────────────────────────────────────────────

  async getTrialBalance(tenantDb: any, args: { asOf?: Date } = {}) {
    const accounts = await tenantDb.account.findMany({ orderBy: { code: 'asc' } });
    const where: any = { batch: { deletedAt: null } };
    if (args.asOf) where.date = { lte: args.asOf };

    const grouped = await tenantDb.journalEntry.groupBy({
      by: ['accountCode'],
      where,
      _sum: { debit: true, credit: true },
    });

    const byCode = new Map<string, { dr: number; cr: number }>();
    for (const g of grouped) {
      byCode.set(g.accountCode, {
        dr: Number(g._sum.debit || 0),
        cr: Number(g._sum.credit || 0),
      });
    }

    const rows = accounts.map((a: any) => {
      const sums = byCode.get(a.code) ?? { dr: 0, cr: 0 };
      const balance = roundToCents(
        a.normalBalance === 'CREDIT' ? sums.cr - sums.dr : sums.dr - sums.cr,
      );
      return {
        code: a.code,
        name: a.name,
        type: a.type,
        normalBalance: a.normalBalance,
        totalDebit: roundToCents(sums.dr),
        totalCredit: roundToCents(sums.cr),
        balance,
      };
    });

    const totalDebit = roundToCents(rows.reduce((s: number, r: any) => s + r.totalDebit, 0));
    const totalCredit = roundToCents(rows.reduce((s: number, r: any) => s + r.totalCredit, 0));

    return { asOf: args.asOf ?? new Date(), rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
  }

  async getIncomeStatement(tenantDb: any, args: { startDate?: Date; endDate?: Date } = {}) {
    const entryWhere: any = { batch: { deletedAt: null } };
    if (args.startDate || args.endDate) {
      entryWhere.date = {};
      if (args.startDate) entryWhere.date.gte = args.startDate;
      if (args.endDate) entryWhere.date.lte = args.endDate;
    }

    const accounts = await tenantDb.account.findMany({
      where: { type: { in: ['INCOME', 'EXPENSE'] } },
      orderBy: { code: 'asc' },
    });

    const grouped = await tenantDb.journalEntry.groupBy({
      by: ['accountCode'],
      where: entryWhere,
      _sum: { debit: true, credit: true },
    });

    const byCode = new Map<string, { dr: number; cr: number }>();
    for (const g of grouped) {
      byCode.set(g.accountCode, {
        dr: Number(g._sum.debit || 0),
        cr: Number(g._sum.credit || 0),
      });
    }

    const incomeAccounts: any[] = [];
    const expenseAccounts: any[] = [];

    for (const a of accounts) {
      const sums = byCode.get(a.code) ?? { dr: 0, cr: 0 };
      const balance = roundToCents(
        a.normalBalance === 'CREDIT' ? sums.cr - sums.dr : sums.dr - sums.cr,
      );
      const row = { code: a.code, name: a.name, type: a.type, balance };
      if (a.type === 'INCOME') incomeAccounts.push(row);
      else expenseAccounts.push(row);
    }

    const totalIncome = roundToCents(incomeAccounts.reduce((s: number, r: any) => s + r.balance, 0));
    const totalExpenses = roundToCents(expenseAccounts.reduce((s: number, r: any) => s + r.balance, 0));

    return {
      period: { startDate: args.startDate ?? null, endDate: args.endDate ?? new Date() },
      incomeAccounts,
      expenseAccounts,
      totalIncome,
      totalExpenses,
      netIncome: roundToCents(totalIncome - totalExpenses),
    };
  }

  async getBalanceSheet(tenantDb: any, args: { asOf?: Date } = {}) {
    const where: any = { batch: { deletedAt: null } };
    if (args.asOf) where.date = { lte: args.asOf };

    const accounts = await tenantDb.account.findMany({
      where: { type: { in: ['ASSET', 'LIABILITY', 'EQUITY'] } },
      orderBy: { code: 'asc' },
    });

    const grouped = await tenantDb.journalEntry.groupBy({
      by: ['accountCode'],
      where,
      _sum: { debit: true, credit: true },
    });

    const byCode = new Map<string, { dr: number; cr: number }>();
    for (const g of grouped) {
      byCode.set(g.accountCode, {
        dr: Number(g._sum.debit || 0),
        cr: Number(g._sum.credit || 0),
      });
    }

    const assets: any[] = [];
    const liabilities: any[] = [];
    const equity: any[] = [];

    for (const a of accounts) {
      const sums = byCode.get(a.code) ?? { dr: 0, cr: 0 };
      const balance = roundToCents(
        a.normalBalance === 'CREDIT' ? sums.cr - sums.dr : sums.dr - sums.cr,
      );
      const row = { code: a.code, name: a.name, type: a.type, balance };
      if (a.type === 'ASSET') assets.push(row);
      else if (a.type === 'LIABILITY') liabilities.push(row);
      else equity.push(row);
    }

    // Roll current (and prior) P&L into equity so A = L + E holds
    const income = await this.getIncomeStatement(tenantDb, { endDate: args.asOf });
    const currentEarnings = Number(income.netIncome || 0);
    if (currentEarnings !== 0) {
      equity.push({
        code: '3999',
        name: 'Current Period Earnings',
        type: 'EQUITY',
        balance: currentEarnings,
      });
    }

    const totalAssets = roundToCents(assets.reduce((s: number, r: any) => s + r.balance, 0));
    const totalLiabilities = roundToCents(liabilities.reduce((s: number, r: any) => s + r.balance, 0));
    const totalEquity = roundToCents(equity.reduce((s: number, r: any) => s + r.balance, 0));

    return {
      asOf: args.asOf ?? new Date(),
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      balanced: totalAssets === roundToCents(totalLiabilities + totalEquity),
    };
  }

  async getGeneralLedger(
    tenantDb: any,
    args: { startDate?: Date; endDate?: Date; accountCodes?: string[] } = {},
  ) {
    const accountWhere: any = {};
    if (args.accountCodes?.length) accountWhere.code = { in: args.accountCodes };

    const accounts = await tenantDb.account.findMany({
      where: accountWhere,
      orderBy: { code: 'asc' },
    });

    if (!accounts.length) return [];

    const codes = accounts.map((a: any) => a.code);
    const normalByCode = new Map<string, 'DEBIT' | 'CREDIT'>(
      accounts.map((a: any) => [a.code, a.normalBalance as 'DEBIT' | 'CREDIT']),
    );

    // Opening balances — single groupBy, not N queries.
    const openingMap = new Map<string, number>();
    if (args.startDate) {
      const openAgg = await tenantDb.journalEntry.groupBy({
        by: ['accountCode'],
        where: { accountCode: { in: codes }, date: { lt: args.startDate } },
        _sum: { debit: true, credit: true },
      });
      for (const g of openAgg) {
        const normal = normalByCode.get(g.accountCode) ?? 'DEBIT';
        const dr = Number(g._sum.debit || 0);
        const cr = Number(g._sum.credit || 0);
        openingMap.set(g.accountCode, roundToCents(normal === 'CREDIT' ? cr - dr : dr - cr));
      }
    }

    const entryWhere: any = { accountCode: { in: codes } };
    if (args.startDate || args.endDate) {
      entryWhere.date = {};
      if (args.startDate) entryWhere.date.gte = args.startDate;
      if (args.endDate) entryWhere.date.lte = args.endDate;
    }

    const allEntries = await tenantDb.journalEntry.findMany({
      where: entryWhere,
      orderBy: [{ accountCode: 'asc' }, { date: 'asc' }, { createdAt: 'asc' }],
      include: { batch: { select: { batchNumber: true, sourceType: true, memo: true } } },
    });

    const entriesByCode = new Map<string, any[]>();
    for (const e of allEntries) {
      if (!entriesByCode.has(e.accountCode)) entriesByCode.set(e.accountCode, []);
      entriesByCode.get(e.accountCode)!.push(e);
    }

    const result = accounts.map((account: any) => {
      const normal = normalByCode.get(account.code) as 'DEBIT' | 'CREDIT';
      const opening = openingMap.get(account.code) ?? 0;
      const entries = entriesByCode.get(account.code) ?? [];
      let running = opening;
      const lines = entries.map((e: any) => {
        const dr = Number(e.debit);
        const cr = Number(e.credit);
        running = roundToCents(running + (normal === 'CREDIT' ? cr - dr : dr - cr));
        return {
          id: e.id,
          date: e.date,
          batchNumber: e.batch?.batchNumber,
          sourceType: e.batch?.sourceType,
          memo: e.memo ?? e.batch?.memo,
          debit: dr,
          credit: cr,
          balance: running,
        };
      });
      return {
        account: { code: account.code, name: account.name, type: account.type, normalBalance: account.normalBalance },
        opening,
        closing: running,
        entries: lines,
      };
    });

    return result.filter((r: any) => r.entries.length > 0 || r.opening !== 0);
  }
}
