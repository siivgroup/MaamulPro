import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PayrollItemDto, PayrollTransitionDto, SavePayrollDto } from './dto/payroll.dto';
import { AccountingService } from '../accounting/accounting.service';
import { AccountMappingsService } from '../accounting/account-mappings.service';

// Money math: always work in cents so parent totals equal the sum of item
// totals after the DB stores them as Decimal(12, 2).
const roundToCents = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class PayrollService {
  constructor(
    private readonly accounting: AccountingService,
    private readonly mappings: AccountMappingsService,
  ) {}

  private async assertApprovalLimit(tx: any, userId: string, amount: number) {
    const approver = await tx.user.findUnique({ where: { id: userId }, select: { role: true, approvalLimit: true } });
    if (!approver) throw new BadRequestException('Approver account was not found');
    if (['COMPANY_OWNER', 'SUPER_ADMIN'].includes(approver.role)) return;
    if (approver.approvalLimit != null && amount > Number(approver.approvalLimit)) {
      throw new BadRequestException(`Payroll total exceeds your approval limit of ${Number(approver.approvalLimit).toFixed(2)}`);
    }
  }

  /** Cashbook + GL for a paid payroll (gross expense, net cash, tax/deduction payables). */
  private async recordPayrollPayment(tx: any, payroll: any, userId: string, description: string, cashAccountCode?: string | null) {
    const gross = Number(payroll.totalGrossSalary || 0);
    const net = Number(payroll.totalNetSalary || 0);
    const tax = Number(payroll.totalTax || 0);
    const deductions = Number(payroll.totalDeductions || 0);
    const amount = net > 0 ? net : gross;
    const paymentDate = payroll.paymentDate || new Date();

    await tx.transaction.upsert({
      where: { referenceId: `PAYROLL-${payroll.id}` },
      create: {
        referenceId: `PAYROLL-${payroll.id}`,
        type: 'EXPENSE',
        status: 'CLEARED',
        description,
        amount,
        date: paymentDate,
        projectId: payroll.projectId,
        userId,
        notes: `Expense account: ${payroll.expenseAccountCode || 'not assigned'}`,
      },
      update: {
        type: 'EXPENSE',
        status: 'CLEARED',
        description,
        amount,
        date: paymentDate,
        projectId: payroll.projectId,
        userId,
        deletedAt: null,
        version: { increment: 1 },
      },
    });

    await this.accounting.retractPriorForSource(tx, 'PAYROLL', payroll.id, userId);
    const resolved = await this.mappings.resolveMany(tx, [
      'PAYROLL_EXPENSE',
      'PAYROLL_CASH',
      'PAYROLL_TAX_PAYABLE',
      'PAYROLL_DEDUCTIONS_PAYABLE',
    ]);
    // Honor an explicit cash/payout account when one is supplied; fall back
    // to the PAYROLL_CASH mapping otherwise.
    const cashCode = cashAccountCode || resolved.PAYROLL_CASH;
    const expenseCode = payroll.expenseAccountCode || resolved.PAYROLL_EXPENSE;
    const expenseAmount = gross > 0 ? gross : net;
    const lines: { accountCode: string; debit: number; credit: number }[] = [
      { accountCode: expenseCode, debit: expenseAmount, credit: 0 },
    ];
    if (net > 0) lines.push({ accountCode: cashCode, debit: 0, credit: net });
    if (tax > 0) lines.push({ accountCode: resolved.PAYROLL_TAX_PAYABLE, debit: 0, credit: tax });
    if (deductions > 0) lines.push({ accountCode: resolved.PAYROLL_DEDUCTIONS_PAYABLE, debit: 0, credit: deductions });
    // If withholdings weren't broken out, credit cash for the full expense.
    if (lines.length === 1) {
      lines.push({ accountCode: cashCode, debit: 0, credit: expenseAmount });
    }
    await this.accounting.postJournalBatch(tx, {
      tenantId: 'system',
      userId,
      tx,
      dto: {
        date: paymentDate,
        memo: description,
        sourceType: 'PAYROLL',
        sourceId: payroll.id,
        sourceRef: `PAYROLL-${payroll.id}`,
        lines,
      },
    });
  }

  async getPayrolls(tenantDb: any, status?: string) {
    if (!tenantDb) return [];
    const where: any = {};
    if (status) where.status = status;

    return tenantDb.payroll.findMany({
      where,
      include: {
        createdByUser: true,
        approvedByUser: true,
        items: {
          include: { staff: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPayrollById(tenantDb: any, id: string) {
    if (!tenantDb) throw new BadRequestException('Tenant DB not available');
    const payroll = await tenantDb.payroll.findUnique({
      where: { id },
      include: {
        createdByUser: true,
        approvedByUser: true,
        items: {
          include: { staff: true },
        },
      },
    });

    if (!payroll) {
      throw new NotFoundException(`Payroll run with ID '${id}' not found`);
    }

    return payroll;
  }

  getEligibleStaff(tenantDb: any) {
    return tenantDb.staff.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, position: true, department: true, salary: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  getExpenseAccounts(tenantDb: any) {
    return tenantDb.account.findMany({ where: { type: 'EXPENSE' }, orderBy: { code: 'asc' } });
  }

  async validatePeriod(tenantDb: any, year: number, month: number, excludeId?: string) {
    const existing = await tenantDb.payroll.findFirst({
      where: { year, month, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true, name: true, status: true },
    });
    return { isDuplicate: Boolean(existing), existing };
  }

  async createPayroll(tenantDb: any, data: SavePayrollDto, userId: string) {
    if (!tenantDb) throw new BadRequestException('Tenant DB not available');
    this.ensureUniqueStaff(data.items);
    if (data.expenseAccountCode) await this.ensureExpenseAccount(tenantDb, data.expenseAccountCode);
    const calculated = this.calculate(data.items);
    return tenantDb.$transaction(async (tx: any) => {
      // Serialize creation for the same (year, month) so two concurrent
      // requests cannot both create an active run for the period. The
      // partial unique index on active payrolls is the backstop.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${data.year * 100 + data.month})`;
      const duplicate = await tx.payroll.findFirst({
        where: { year: data.year, month: data.month, deletedAt: null },
        select: { id: true, name: true, status: true },
      });
      if (duplicate) throw new ConflictException('A payroll already exists for this period');
      return tx.payroll.create({
        data: {
          name: data.name,
          year: data.year,
          month: data.month,
          payPeriod: data.payPeriod || `${data.year}-${String(data.month).padStart(2, '0')}`,
          paymentDate: data.paymentDate,
          status: 'DRAFT',
          expenseAccountCode: data.expenseAccountCode || null,
          createdById: userId,
          ...calculated.totals,
          items: {
            create: calculated.items.map((item) => ({
              ...item,
              status: 'DRAFT',
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  async generateMonthlyDraft(tenantDb: any, userId: string, date = new Date()) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const existing = await tenantDb.payroll.findFirst({ where: { year, month, deletedAt: null }, select: { id: true } });
    if (existing) return { generated: false, reason: 'period_exists', payrollId: existing.id };
    const staff = await this.getEligibleStaff(tenantDb);
    if (!staff.length) return { generated: false, reason: 'no_eligible_staff' };
    const payroll = await this.createPayroll(tenantDb, {
      name: `${date.toLocaleString('en', { month: 'long' })} ${year} Payroll`, year, month,
      payPeriod: `${year}-${String(month).padStart(2, '0')}`,
      items: staff.map((employee: any) => ({
        staffId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeePosition: employee.position || undefined,
        employeeDepartment: employee.department,
        baseSalary: Number(employee.salary), bonuses: 0, deductions: 0, tax: 0,
      })),
    }, userId);
    return { generated: true, payrollId: payroll.id };
  }

  async updatePayroll(tenantDb: any, id: string, data: SavePayrollDto) {
    const payroll = await this.getPayrollById(tenantDb, id);
    if (!['DRAFT', 'REJECTED'].includes(payroll.status)) {
      throw new BadRequestException(`Payroll in ${payroll.status} status cannot be edited`);
    }
    this.ensureUniqueStaff(data.items);
    if (data.expenseAccountCode) await this.ensureExpenseAccount(tenantDb, data.expenseAccountCode);
    const calculated = this.calculate(data.items);
    return tenantDb.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${data.year * 100 + data.month})`;
      const duplicate = await tx.payroll.findFirst({
        where: { year: data.year, month: data.month, deletedAt: null, id: { not: id } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException('Another payroll exists for this period');
      await tx.payrollItem.deleteMany({ where: { payrollId: id } });
      return tx.payroll.update({
        where: { id },
        data: {
          name: data.name,
          year: data.year,
          month: data.month,
          payPeriod: data.payPeriod || `${data.year}-${String(data.month).padStart(2, '0')}`,
          paymentDate: data.paymentDate,
          expenseAccountCode: data.expenseAccountCode || null,
          rejectionReason: null,
          ...calculated.totals,
          items: { create: calculated.items.map((item) => ({ ...item, status: 'DRAFT' })) },
        },
        include: { items: true },
      });
    });
  }

  async transition(tenantDb: any, id: string, data: PayrollTransitionDto, userId: string) {
    const payroll = await tenantDb.payroll.findFirst({
      where: { id, deletedAt: null },
      include: { items: true, expenseAccount: true },
    });
    if (!payroll) throw new NotFoundException('Payroll not found');
    const allowed: Record<string, string[]> = {
      submit: ['DRAFT', 'REJECTED'],
      approve: ['PENDING_APPROVAL'],
      reject: ['PENDING_APPROVAL'],
      pay: ['APPROVED'],
      reopen: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'],
    };
    if (!allowed[data.action].includes(payroll.status)) {
      throw new BadRequestException(`Cannot ${data.action} payroll in ${payroll.status} status`);
    }
    if (data.action === 'reject' && (!data.reason || data.reason.trim().length < 3)) {
      throw new BadRequestException('A rejection reason is required');
    }
    const status = {
      submit: 'PENDING_APPROVAL',
      approve: 'APPROVED',
      reject: 'REJECTED',
      pay: 'PAID',
      reopen: 'DRAFT',
    }[data.action];
    return tenantDb.$transaction(async (tx: any) => {
      if (data.action === 'approve') await this.assertApprovalLimit(tx, userId, Number(payroll.totalNetSalary || payroll.totalGrossSalary));
      await this.applyStatusToItems(
        tx,
        payroll.items,
        status,
        payroll.year,
        payroll.month,
        data.action === 'approve' || data.action === 'pay',
      );
      const updated = await tx.payroll.update({
        where: { id },
        data: {
          status,
          rejectionReason: data.action === 'reject' ? data.reason : null,
          approvedById: data.action === 'approve' ? userId : data.action === 'reopen' ? null : payroll.approvedById,
          approvedAt: data.action === 'approve' ? new Date() : data.action === 'reopen' ? null : payroll.approvedAt,
          paidAt: data.action === 'pay' ? new Date() : data.action === 'reopen' ? null : payroll.paidAt,
        },
      });
      if (data.action === 'pay') {
        if (data.accountId) await this.validatePayoutAccount(tx, data.accountId);
        await this.recordPayrollPayment(
          tx,
          payroll,
          userId,
          `Payroll Payment — ${payroll.name} (${payroll.year}-${String(payroll.month).padStart(2, '0')})`,
          data.accountId,
        );
      }
      return updated;
    });
  }

  async deletePayroll(tenantDb: any, id: string) {
    const payroll = await this.getPayrollById(tenantDb, id);
    if (payroll.status === 'PAID') throw new BadRequestException('Paid payrolls cannot be deleted');
    await tenantDb.payroll.update({ where: { id }, data: { deletedAt: new Date() } });
    return { deleted: true };
  }

  getPayslips(tenantDb: any, query: { year?: number; month?: number; staffId?: string; search?: string }) {
    const where: any = { payroll: { deletedAt: null } };
    if (query.staffId) where.staffId = query.staffId;
    if (query.year) where.payroll.year = query.year;
    if (query.month) where.payroll.month = query.month;
    if (query.search) where.OR = [
      { employeeName: { contains: query.search, mode: 'insensitive' } },
      { payslipNumber: { contains: query.search, mode: 'insensitive' } },
    ];
    return tenantDb.payrollItem.findMany({
      where,
      include: { payroll: true, staff: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve a payroll run atomically: parent status + every item status and
   * payslip number in the same transaction as the parent write.
   */
  async approvePayroll(tenantDb: any, id: string, userId: string) {
    if (!tenantDb) throw new BadRequestException('Tenant DB not available');

    return tenantDb.$transaction(async (tx: any) => {
      const payroll = await tx.payroll.findFirst({
        where: { id, deletedAt: null },
        include: { items: true },
      });
      if (!payroll) throw new NotFoundException(`Payroll run with ID '${id}' not found`);

      if (payroll.status !== 'DRAFT' && payroll.status !== 'PENDING_APPROVAL') {
        throw new BadRequestException(`Payroll status is '${payroll.status}' and cannot be approved`);
      }

      await this.assertApprovalLimit(tx, userId, Number(payroll.totalNetSalary || payroll.totalGrossSalary));

      await this.applyStatusToItems(tx, payroll.items, 'APPROVED', payroll.year, payroll.month, true);

      return tx.payroll.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
    });
  }

  /**
   * Process Payroll Payment Transactionally
   * Uses atomic Prisma transaction & status verification to ensure
   * a payroll run can NEVER be paid twice even under concurrent requests.
   * Parent + all items are flipped to PAID and every item receives its
   * payslip number atomically. An explicit payout account, when supplied,
   * is validated against the tenant chart and used as the GL cash credit.
   */
  async processPayrollPayment(tenantDb: any, id: string, accountId: string, userId: string) {
    if (!tenantDb) throw new BadRequestException('Tenant DB not available');

    return tenantDb.$transaction(async (tx: any) => {
      const payroll = await tx.payroll.findFirst({
        where: { id, deletedAt: null },
        include: { items: true },
      });

      if (!payroll) {
        throw new NotFoundException(`Payroll '${id}' not found`);
      }

      if (payroll.status === 'PAID') {
        throw new ConflictException(`Payroll '${payroll.name}' has already been processed and paid.`);
      }

      if (payroll.status !== 'APPROVED') {
        throw new BadRequestException(`Payroll must be APPROVED before payment processing.`);
      }

      if (accountId) await this.validatePayoutAccount(tx, accountId);

      // 1. Mark every item PAID with its payslip number, then the payroll PAID.
      await this.applyStatusToItems(tx, payroll.items, 'PAID', payroll.year, payroll.month, true);
      const updatedPayroll = await tx.payroll.update({
        where: { id },
        data: {
          status: 'PAID',
          paidAt: new Date(),
        },
      });

      await this.recordPayrollPayment(
        tx,
        payroll,
        userId,
        `Payroll salary payment for ${payroll.name} (${payroll.items.length} employees)`,
        accountId,
      );

      return updatedPayroll;
    });
  }

  private calculate(items: PayrollItemDto[]) {
    const totals = {
      totalBaseSalary: 0,
      totalBonuses: 0,
      totalDeductions: 0,
      totalTax: 0,
      totalGrossSalary: 0,
      totalNetSalary: 0,
    };
    const processed = items.map((item) => {
      // Round every input and derived value to cents before summing so the
      // parent totals equal the sum of the (Decimal(12,2)) item rows.
      const baseSalary = roundToCents(item.baseSalary);
      const bonuses = roundToCents(item.bonuses);
      const deductions = roundToCents(item.deductions);
      const tax = roundToCents(item.tax);
      const grossSalary = roundToCents(baseSalary + bonuses);
      const netSalary = roundToCents(grossSalary - deductions - tax);
      if (netSalary < 0) throw new BadRequestException(`Net salary cannot be negative for ${item.employeeName}`);
      totals.totalBaseSalary += baseSalary;
      totals.totalBonuses += bonuses;
      totals.totalDeductions += deductions;
      totals.totalTax += tax;
      totals.totalGrossSalary += grossSalary;
      totals.totalNetSalary += netSalary;
      return {
        staffId: item.staffId || null,
        employeeName: item.employeeName,
        employeePosition: item.employeePosition || null,
        employeeDepartment: (item.employeeDepartment as any) || 'GENERAL',
        baseSalary,
        bonuses,
        deductions,
        tax,
        grossSalary,
        netSalary,
        notes: item.notes || null,
      };
    });
    (Object.keys(totals) as (keyof typeof totals)[]).forEach((key) => {
      totals[key] = roundToCents(totals[key]);
    });
    return { items: processed, totals };
  }

  /**
   * Flip every payroll item to a new status inside the caller's transaction.
   * When `assignPayslip` is true, items that still lack a payslip number are
   * assigned a deterministic PAY-{year}{month}-{seq} number so approved/paid
   * runs always carry payslips.
   */
  private async applyStatusToItems(
    tx: any,
    items: any[],
    status: string,
    year: number,
    month: number,
    assignPayslip: boolean,
  ) {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      await tx.payrollItem.update({
        where: { id: item.id },
        data: {
          status,
          payslipNumber: assignPayslip
            ? item.payslipNumber || `PAY-${year}${String(month).padStart(2, '0')}-${String(index + 1).padStart(3, '0')}`
            : item.payslipNumber,
        },
      });
    }
  }

  /**
   * Validate that a requested payout (cash credit) account exists, is active
   * and belongs to this tenant chart. Called with the transaction client so
   * an invalid account aborts the whole payroll payment.
   */
  private async validatePayoutAccount(tx: any, accountId: string) {
    const account = await tx.account.findUnique({ where: { code: accountId } });
    if (!account) throw new BadRequestException(`Payment account '${accountId}' does not exist`);
    if (!account.isActive) throw new BadRequestException(`Payment account '${accountId}' is inactive`);
  }

  private ensureUniqueStaff(items: PayrollItemDto[]) {
    const ids = items.map((item) => item.staffId).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Duplicate staff member in payroll');
  }

  private async ensureExpenseAccount(tenantDb: any, code: string) {
    const account = await tenantDb.account.findFirst({ where: { code, type: 'EXPENSE' } });
    if (!account) throw new BadRequestException('Expense account does not exist');
  }
}
