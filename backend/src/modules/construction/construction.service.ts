import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { AccountingService } from '../accounting/accounting.service';
import {
  ConstructionMaterialDto,
  ContractAdjustmentDto,
  ContractAssignmentDto,
  ContractPaymentDto,
  DailyExpenseDto,
  InventoryMovementDto,
  ManpowerWorkerDto,
  ProjectDto,
  TaskDto,
  WorkerLedgerDto,
  WorkerTypeDto,
  WorkforceContractDto,
} from './dto/construction.dto';
import { SubscriptionEntitlementService } from '../../common/subscriptions/subscription-entitlement.service';
import { CONSTRUCTION_EXPENSE_CATEGORIES, constructionExpenseCategory } from './construction-expense-categories';
import { determineProjectStatus, projectProgress, taskProgress } from './construction-progress';

@Injectable()
export class ConstructionService {
  constructor(
    private readonly entitlements: SubscriptionEntitlementService,
    private readonly accounting: AccountingService,
  ) {}

  // -----------------------------------------------------------
  // Projects & Tasks
  // -----------------------------------------------------------

  async syncProjectProgressAndStatus(tenantDb: any, projectId: string) {
    if (!tenantDb || !projectId) return;
    const project = await tenantDb.project.findFirst({
      where: { id: projectId, deletedAt: null },
      include: {
        tasks: { where: { deletedAt: null }, select: { status: true } },
      },
    });
    if (!project) return;

    const progress = projectProgress(project.tasks);
    const status = determineProjectStatus(project.status, project.tasks);

    if (project.progress !== progress || project.status !== status) {
      await tenantDb.project.update({
        where: { id: projectId },
        data: { progress, status: status as any },
      });
    }
  }

  async getProjects(tenantDb: any, query?: { status?: string; search?: string }) {
    if (!tenantDb) return [];
    const where: any = { deletedAt: null };
    if (query?.status) where.status = query.status;
    if (query?.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { location: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const projects = await tenantDb.project.findMany({
      where,
      include: {
        tasks: { where: { deletedAt: null } },
        dailyExpenses: { where: { deletedAt: null } },
        assignedStaff: { where: { deletedAt: null } },
        _count: { select: { tasks: true, workforceContracts: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return projects.map((project: any) => ({ ...project, progress: projectProgress(project.tasks) }));
  }

  getProjectOptions(tenantDb: any) {
    return tenantDb.project.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async createProject(
    tenantDb: any,
    companyId: string,
    data: ProjectDto,
  ) {
    if (!tenantDb) throw new BadRequestException('Tenant DB not available');
    return this.entitlements.withinTenantQuota(
      companyId,
      tenantDb,
      'constructionProjects',
      (tx) => tx.project.create({
        data: {
          name: data.name,
          description: data.description,
          location: data.location,
          budget: data.budget,
          startDate: data.startDate ? new Date(data.startDate) : null,
          endDate: data.endDate ? new Date(data.endDate) : null,
          status: (data.status || 'PLANNING') as any,
          imageUrl: data.imageUrl,
          progress: 0,
        },
      }),
    );
  }

  async getProject(tenantDb: any, id: string) {
    const project = await tenantDb.project.findFirst({
      where: { id, deletedAt: null },
      include: {
        tasks: { where: { deletedAt: null }, include: { assignee: true, staff: true } },
        assignedStaff: true,
        dailyExpenses: { where: { deletedAt: null } },
        workforceContracts: { where: { deletedAt: null } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return { ...project, progress: projectProgress(project.tasks) };
  }

  async updateProject(tenantDb: any, id: string, data: ProjectDto) {
    await this.getProject(tenantDb, id);
    const updated = await tenantDb.project.update({
      where: { id },
      data: { ...data, status: data.status as any },
    });
    await this.syncProjectProgressAndStatus(tenantDb, id);
    return updated;
  }

  async deleteProject(tenantDb: any, id: string) {
    await this.getProject(tenantDb, id);
    await tenantDb.$transaction([
      tenantDb.projectTask.updateMany({ where: { projectId: id, deletedAt: null }, data: { deletedAt: new Date() } }),
      tenantDb.project.update({ where: { id }, data: { deletedAt: new Date() } }),
    ]);
    return { deleted: true };
  }

  getTasks(tenantDb: any, query: { projectId?: string; status?: string; search?: string }) {
    const where: any = { deletedAt: null };
    if (query.projectId) where.projectId = query.projectId;
    if (query.status) where.status = query.status;
    if (query.search) where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
    ];
    return tenantDb.projectTask.findMany({
      where,
      include: { project: true, assignee: true, staff: true },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createTask(tenantDb: any, data: TaskDto) {
    const status = (data.status as any) || 'NOT_STARTED';
    const computedProgress = taskProgress(status);
    const task = await tenantDb.projectTask.create({
      data: {
        ...data,
        status,
        priority: (data.priority as any) || 'MEDIUM',
        progress: computedProgress,
      },
    });
    await this.syncProjectProgressAndStatus(tenantDb, data.projectId);
    return task;
  }

  async getTask(tenantDb: any, id: string) {
    const task = await tenantDb.projectTask.findFirst({
      where: { id, deletedAt: null },
      include: { project: true, assignee: true, staff: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async updateTask(tenantDb: any, id: string, data: TaskDto) {
    const task = await tenantDb.projectTask.findFirst({ where: { id, deletedAt: null } });
    if (!task) throw new NotFoundException('Task not found');

    const nextStatus = (data.status as any) ?? task.status;
    const computedProgress = taskProgress(nextStatus);

    const updatedTask = await tenantDb.projectTask.update({
      where: { id },
      data: {
        ...data,
        status: nextStatus,
        priority: (data.priority as any) ?? task.priority,
        progress: computedProgress,
      },
    });

    await this.syncProjectProgressAndStatus(tenantDb, task.projectId);
    if (data.projectId && data.projectId !== task.projectId) {
      await this.syncProjectProgressAndStatus(tenantDb, data.projectId);
    }

    return updatedTask;
  }

  async deleteTask(tenantDb: any, id: string) {
    const task = await tenantDb.projectTask.findFirst({ where: { id, deletedAt: null } });
    if (!task) throw new NotFoundException('Task not found');

    await tenantDb.projectTask.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.syncProjectProgressAndStatus(tenantDb, task.projectId);
    return { deleted: true };
  }

  async getWorkforceContracts(tenantDb: any, projectId?: string) {
    if (!tenantDb) return [];
    const where: any = { deletedAt: null };
    if (projectId) where.projectId = projectId;

    const contracts = await tenantDb.workforceContract.findMany({
      where,
      include: {
        project: true,
        payments: { include: { staff: true, worker: { include: { linkedStaff: true } } } },
        budgetAdjustments: true,
        workerAssignments: {
          where: { removedAt: null },
          include: { staff: true, worker: { include: { linkedStaff: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return contracts.map((contract: any) => ({
      ...contract,
      workerAssignments: contract.workerAssignments.map((row: any) => this.resolveWorker(row)),
      payments: contract.payments.map((row: any) => this.resolveWorker(row)),
    }));
  }

  async createWorkforceContract(tenantDb: any, data: WorkforceContractDto) {
    if (!tenantDb) throw new BadRequestException('Tenant DB not available');
    this.validateDateRange(data.startDate, data.endDate);

    const contract = await tenantDb.workforceContract.create({
      data: {
        title: data.title,
        description: data.description,
        projectId: data.projectId,
        originalBudget: data.originalBudget,
        startDate: data.startDate ? new Date(data.startDate) : null,
        endDate: data.endDate ? new Date(data.endDate) : null,
        status: (data.status as any) || 'ACTIVE',
        notes: data.notes,
      },
    });
    await this.syncContractBudget(tenantDb, contract.id);
    return this.getWorkforceContract(tenantDb, contract.id);
  }

  async getWorkforceContract(tenantDb: any, id: string) {
    const contract = await tenantDb.workforceContract.findFirst({
      where: { id, deletedAt: null },
      include: {
        project: true,
        workerAssignments: { include: { staff: true, worker: { include: { linkedStaff: true } } } },
        payments: { include: { staff: true, worker: { include: { linkedStaff: true } }, recordedBy: true }, orderBy: { date: 'desc' } },
        budgetAdjustments: { include: { adjustedBy: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!contract) throw new NotFoundException('Workforce contract not found');
    contract.workerAssignments = contract.workerAssignments.map((row: any) => this.resolveWorker(row));
    contract.payments = contract.payments.map((row: any) => this.resolveWorker(row));
    return contract;
  }

  async updateWorkforceContract(tenantDb: any, id: string, data: WorkforceContractDto) {
    const current = await this.getWorkforceContract(tenantDb, id);
    this.validateDateRange(data.startDate, data.endDate);
    if (data.originalBudget < Number(current.totalPaid)) {
      throw new BadRequestException('Budget cannot be lower than payments already recorded');
    }
    const where: any = { id, deletedAt: null };
    if (data.version !== undefined) where.version = data.version;
    const result = await tenantDb.workforceContract.updateMany({
      where,
      data: {
        projectId: data.projectId,
        title: data.title,
        description: data.description,
        originalBudget: data.originalBudget,
        status: data.status as any,
        startDate: data.startDate,
        endDate: data.endDate,
        notes: data.notes,
        version: { increment: 1 },
      },
    });
    if (!result.count) throw new ConflictException('Contract changed or no longer exists; reload and retry');
    await this.syncContractBudget(tenantDb, id);
    return this.getWorkforceContract(tenantDb, id);
  }

  async deleteWorkforceContract(tenantDb: any, id: string) {
    const contract = await this.getWorkforceContract(tenantDb, id);
    if (Number(contract.totalPaid) > 0) {
      throw new ConflictException('A contract with recorded payments cannot be deleted');
    }
    await tenantDb.$transaction(async (tx: any) => {
      await tx.workforceContract.update({
        where: { id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await tx.transaction.updateMany({
        where: { referenceId: `wfcontract:${id}`, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
    });
    return { deleted: true };
  }

  async transitionWorkforceContract(tenantDb: any, id: string, status: string) {
    const contract = await this.getWorkforceContract(tenantDb, id);
    const allowed: Record<string, string[]> = {
      DRAFT: ['ACTIVE', 'CANCELLED'],
      ACTIVE: ['SUSPENDED', 'COMPLETED', 'CANCELLED'],
      SUSPENDED: ['ACTIVE', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };
    if (!allowed[contract.status]?.includes(status)) {
      throw new BadRequestException(`Cannot transition contract from ${contract.status} to ${status}`);
    }
    await tenantDb.workforceContract.update({
      where: { id },
      data: { status: status as any, version: { increment: 1 } },
    });
    await this.syncContractBudget(tenantDb, id);
    return this.getWorkforceContract(tenantDb, id);
  }

  async assignContractWorker(tenantDb: any, contractId: string, data: ContractAssignmentDto) {
    await this.getWorkforceContract(tenantDb, contractId);
    const worker = await tenantDb.manpowerWorker.findFirst({ where: { id: data.workerId, deletedAt: null } });
    if (!worker) throw new NotFoundException('Worker not found');
    const existing = await tenantDb.workforceContractWorker.findUnique({
      where: { contractId_workerId: { contractId, workerId: data.workerId } },
    });
    if (existing) {
      return tenantDb.workforceContractWorker.update({
        where: { id: existing.id },
        data: { role: data.role, notes: data.notes, removedAt: null, assignedAt: new Date() },
      });
    }
    return tenantDb.workforceContractWorker.create({
      data: { contractId, workerId: data.workerId, role: data.role, notes: data.notes },
    });
  }

  async removeContractWorker(tenantDb: any, contractId: string, workerId: string) {
    const result = await tenantDb.workforceContractWorker.updateMany({
      where: { contractId, workerId, removedAt: null },
      data: { removedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Active worker assignment not found');
    return { removed: true };
  }

  async recordContractPayment(
    tenantDb: any,
    contractId: string,
    userId: string,
    data: ContractPaymentDto,
  ) {
    return tenantDb.$transaction(async (tx: any) => {
      // Lock the contract row first so concurrent payments serialize: the
      // waiting transaction re-reads the latest totalPaid and cannot exceed
      // the remaining adjusted budget.
      const locked = await tx.$queryRaw`
        SELECT "id" FROM "workforce_contracts"
        WHERE "id" = ${contractId} AND "deleted_at" IS NULL
        FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('Workforce contract not found');
      const contract = await tx.workforceContract.findFirst({
        where: { id: contractId, deletedAt: null },
        include: { budgetAdjustments: true },
      });
      if (!contract) throw new NotFoundException('Workforce contract not found');
      if (!['ACTIVE', 'COMPLETED'].includes(contract.status)) {
        throw new BadRequestException('Payments can only be recorded for active or completed contracts');
      }
      if (data.workerId || data.staffId) {
        const assigned = await tx.workforceContractWorker.findFirst({
          where: {
            contractId,
            removedAt: null,
            OR: [data.workerId ? { workerId: data.workerId } : undefined, data.staffId ? { staffId: data.staffId } : undefined].filter(Boolean),
          },
        });
        if (!assigned) throw new BadRequestException('Worker is not actively assigned to this contract');
      }
      const adjustedBudget = contract.budgetAdjustments.reduce(
        (total: number, row: any) => total + Number(row.amount),
        Number(contract.originalBudget),
      );
      if (Number(contract.totalPaid) + data.amount > adjustedBudget) {
        throw new BadRequestException('Payment exceeds the remaining adjusted contract budget');
      }
      const payment = await tx.workforceContractPayment.create({
        data: {
          contractId,
          workerId: data.workerId || undefined,
          staffId: data.staffId || undefined,
          payeeName: data.payeeName,
          amount: data.amount,
          date: data.date || new Date(),
          description: data.description,
          recordedById: userId,
          notes: data.notes,
        },
      });
      await tx.workforceContract.update({
        where: { id: contractId },
        data: { totalPaid: { increment: data.amount }, version: { increment: 1 } },
      });
      const category = await this.findOrCreateExpenseCategory(tx, 'LABOR');
      await tx.workerLedgerEntry.create({
        data: {
          userId,
          workerId: data.workerId || undefined,
          staffId: data.staffId || undefined,
          projectId: contract.projectId,
          type: 'EXPENSE',
          amount: data.amount,
          description: data.description,
          date: data.date || new Date(),
        },
      });
      await tx.transaction.create({
        data: {
          referenceId: `wfpayment:${payment.id}`,
          type: 'EXPENSE',
          status: 'CLEARED',
          amount: data.amount,
          description: data.description,
          date: data.date || new Date(),
          categoryId: category.id,
          userId,
          projectId: contract.projectId,
          notes: data.notes,
        },
      });
      // Workforce contract payments are a labor expense funded from
      // cash — same posting shape as payroll. Posting failure (e.g. an
      // unmapped account) rolls back the whole payment: the operational
      // record must never exist without its journal entry.
      await this.accounting.postFinancialEvent(tx, {
        tx, tenantId: 'system', userId,
        sourceType: 'WORKFORCE_PAYMENT',
        sourceId: payment.id,
        sourceRef: `wfpayment ${payment.id}`,
        date: data.date || new Date(),
        memo: data.description,
        drKey: 'PAYROLL_EXPENSE',
        crKey: 'PAYROLL_CASH',
        amount: Number(data.amount),
      });
      return payment;
    });
  }

  async adjustContractBudget(
    tenantDb: any,
    contractId: string,
    userId: string,
    data: ContractAdjustmentDto,
  ) {
    return tenantDb.$transaction(async (tx: any) => {
      // Lock the contract row so concurrent adjustments/payments serialize and
      // the adjusted-budget-vs-totalPaid invariant stays consistent.
      const locked = await tx.$queryRaw`
        SELECT "id" FROM "workforce_contracts"
        WHERE "id" = ${contractId} AND "deleted_at" IS NULL
        FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('Workforce contract not found');
      const contract = await tx.workforceContract.findFirst({
        where: { id: contractId, deletedAt: null },
        include: { budgetAdjustments: true },
      });
      const adjustments = contract.budgetAdjustments.reduce(
        (total: number, row: any) => total + Number(row.amount),
        0,
      );
      if (Number(contract.originalBudget) + adjustments + data.amount < Number(contract.totalPaid)) {
        throw new BadRequestException('Adjusted budget cannot be lower than total payments');
      }
      const adjustment = await tx.workforceContractAdjustment.create({
        data: { contractId, amount: data.amount, reason: data.reason, adjustedById: userId },
      });
      await tx.workforceContract.update({
        where: { id: contractId },
        data: { version: { increment: 1 } },
      });
      await this.syncContractBudget(tx, contractId);
      return adjustment;
    });
  }

  // -----------------------------------------------------------
  // Worker types, manpower expenses and worker ledger
  // -----------------------------------------------------------

  listWorkerTypes(tenantDb: any) {
    return tenantDb.workerType.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  }

  async createWorkerType(tenantDb: any, data: WorkerTypeDto) {
    const existing = await tenantDb.workerType.findFirst({
      where: { name: { equals: data.name, mode: 'insensitive' }, deletedAt: null },
    });
    if (existing) throw new ConflictException('Worker type name already exists');
    return tenantDb.workerType.create({ data: { ...data, color: data.color || '#4361ee' } });
  }

  async updateWorkerType(tenantDb: any, id: string, data: WorkerTypeDto) {
    const result = await tenantDb.workerType.updateMany({
      where: { id, deletedAt: null },
      data,
    });
    if (!result.count) throw new NotFoundException('Worker type not found');
    return tenantDb.workerType.findUnique({ where: { id } });
  }

  async deleteWorkerType(tenantDb: any, id: string) {
    const assigned = await tenantDb.staff.count({ where: { workerTypeId: id, deletedAt: null } });
    const assignedWorkers = await tenantDb.manpowerWorker.count({ where: { workerTypeId: id, deletedAt: null } });
    if (assigned || assignedWorkers) throw new ConflictException('Worker type is assigned to active staff');
    const result = await tenantDb.workerType.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Worker type not found');
    return { deleted: true };
  }

  // Resolves the display identity for a row that may carry either the
  // legacy `staff` relation or the current `worker` relation (itself
  // possibly linked to a Staff record) so every read path renders the
  // same {worker: {firstName, lastName, phone, position}} shape
  // regardless of which era the row was written in.
  private resolveWorker<T extends { staff?: any; worker?: any }>(row: T): T {
    if (row.worker) {
      const linked = row.worker.linkedStaff;
      return {
        ...row,
        worker: {
          ...row.worker,
          firstName: linked?.firstName ?? row.worker.firstName,
          lastName: linked?.lastName ?? row.worker.lastName,
          phone: linked?.phone ?? row.worker.phone,
          position: linked?.position ?? row.worker.position,
        },
      };
    }
    if (row.staff) {
      const { firstName, lastName, phone, position } = row.staff;
      return { ...row, worker: { id: null, firstName, lastName, phone, position } };
    }
    return { ...row, worker: null };
  }

  private flattenManpowerWorker(worker: any) {
    if (!worker) return worker;
    const linked = worker.linkedStaff;
    return {
      ...worker,
      firstName: linked?.firstName ?? worker.firstName,
      lastName: linked?.lastName ?? worker.lastName,
      phone: linked?.phone ?? worker.phone,
      position: linked?.position ?? worker.position,
    };
  }

  listManpowerWorkers(tenantDb: any) {
    return tenantDb.manpowerWorker
      .findMany({
        where: { deletedAt: null },
        include: { linkedStaff: true, workerType: true, assignedProject: true },
        orderBy: { createdAt: 'desc' },
      })
      .then((rows: any[]) => rows.map((row) => this.flattenManpowerWorker(row)));
  }

  async getManpowerWorkerOptions(tenantDb: any) {
    const workers = await tenantDb.manpowerWorker.findMany({
      where: { deletedAt: null, status: 'ACTIVE' },
      include: { linkedStaff: true },
      orderBy: { createdAt: 'desc' },
    });
    return workers
      .map((row: any) => this.flattenManpowerWorker(row))
      .map((row: any) => ({ id: row.id, firstName: row.firstName, lastName: row.lastName, phone: row.phone, position: row.position }));
  }

  async createManpowerWorker(tenantDb: any, data: ManpowerWorkerDto) {
    if (!data.linkedStaffId && !(data.firstName && data.lastName)) {
      throw new BadRequestException('Provide either an existing staff member or a first and last name for the new worker');
    }
    if (data.linkedStaffId) {
      const staff = await tenantDb.staff.findFirst({ where: { id: data.linkedStaffId, deletedAt: null } });
      if (!staff) throw new NotFoundException('Staff member not found');
    }
    const worker = await tenantDb.manpowerWorker.create({
      data: {
        linkedStaffId: data.linkedStaffId,
        firstName: data.linkedStaffId ? undefined : data.firstName,
        lastName: data.linkedStaffId ? undefined : data.lastName,
        phone: data.linkedStaffId ? undefined : data.phone,
        position: data.linkedStaffId ? undefined : data.position,
        workerTypeId: data.workerTypeId,
        assignedProjectId: data.assignedProjectId,
        notes: data.notes,
        status: (data.status as any) || 'ACTIVE',
      },
      include: { linkedStaff: true },
    });
    return this.flattenManpowerWorker(worker);
  }

  async updateManpowerWorker(tenantDb: any, id: string, data: ManpowerWorkerDto) {
    const current = await tenantDb.manpowerWorker.findFirst({ where: { id, deletedAt: null } });
    if (!current) throw new NotFoundException('Worker not found');
    const isLinked = Boolean(current.linkedStaffId);
    const worker = await tenantDb.manpowerWorker.update({
      where: { id },
      data: {
        firstName: isLinked ? undefined : data.firstName,
        lastName: isLinked ? undefined : data.lastName,
        phone: isLinked ? undefined : data.phone,
        position: isLinked ? undefined : data.position,
        workerTypeId: data.workerTypeId,
        assignedProjectId: data.assignedProjectId,
        notes: data.notes,
        status: data.status as any,
      },
      include: { linkedStaff: true },
    });
    return this.flattenManpowerWorker(worker);
  }

  async deleteManpowerWorker(tenantDb: any, id: string) {
    const result = await tenantDb.manpowerWorker.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Worker not found');
    return { deleted: true };
  }

  async getManpowerDashboard(tenantDb: any, projectId?: string) {
    const laborCategories = CONSTRUCTION_EXPENSE_CATEGORIES
      .filter(({ section }) => section === 'manpower')
      .flatMap(({ value, label, aliases }) => [value, label, ...aliases]);
    const expenseWhere: any = { deletedAt: null, category: { in: laborCategories } };
    const ledgerWhere: any = {};
    if (projectId) {
      expenseWhere.projectId = projectId;
      ledgerWhere.projectId = projectId;
    }
    const ledgerExpenseWhere = { ...ledgerWhere, type: 'EXPENSE' };
    const [workers, workerTypes, expensesRaw, ledgerRaw, expenseTotals, ledgerExpenseTotals] = await Promise.all([
      this.listManpowerWorkers(tenantDb),
      this.listWorkerTypes(tenantDb),
      tenantDb.dailyOperationalExpense.findMany({
        where: expenseWhere,
        include: { staff: true, worker: { include: { linkedStaff: true } }, project: true, recordedBy: true },
        orderBy: { date: 'desc' },
        take: 100,
      }),
      tenantDb.workerLedgerEntry.findMany({
        where: ledgerWhere,
        include: { staff: true, worker: { include: { linkedStaff: true } }, project: true, user: true },
        orderBy: { date: 'desc' },
        take: 100,
      }),
      tenantDb.dailyOperationalExpense.aggregate({ where: expenseWhere, _sum: { amount: true }, _count: true }),
      tenantDb.workerLedgerEntry.aggregate({ where: ledgerExpenseWhere, _sum: { amount: true }, _count: true }),
    ]);
    return {
      workers,
      workerTypes,
      expenses: expensesRaw.map((row: any) => this.resolveWorker(row)),
      ledger: ledgerRaw.map((row: any) => this.resolveWorker(row)),
      summary: {
        workerCount: workers.length,
        expenseCount: expenseTotals._count + ledgerExpenseTotals._count,
        totalExpenses: Number(expenseTotals._sum.amount || 0) + Number(ledgerExpenseTotals._sum.amount || 0),
      },
    };
  }

  async listDailyExpenses(tenantDb: any, projectId?: string) {
    const where: any = { deletedAt: null };
    if (projectId) where.projectId = projectId;
    const rows = await tenantDb.dailyOperationalExpense.findMany({
      where,
      include: { staff: true, worker: { include: { linkedStaff: true } }, project: true, recordedBy: true },
      orderBy: { date: 'desc' },
    });
    return rows.map((row: any) => this.resolveWorker({ ...row, category: constructionExpenseCategory(row.category).value }));
  }

  listExpenseCategories() {
    return CONSTRUCTION_EXPENSE_CATEGORIES.map(({ value, label }) => ({ value, label }));
  }

  private expenseData(data: DailyExpenseDto) {
    const category = constructionExpenseCategory(data.category);
    if (category.value === 'UNSKILLED_LABOR' && !data.workerId) throw new BadRequestException('Worker is required for Unskilled Labor expenses');
    return { ...data, category: category.value, workerId: category.value === 'UNSKILLED_LABOR' ? data.workerId : null };
  }

  async getDailyExpense(tenantDb: any, id: string) {
    const expense = await tenantDb.dailyOperationalExpense.findFirst({
      where: { id, deletedAt: null },
      include: { staff: true, worker: { include: { linkedStaff: true } }, project: true, recordedBy: true },
    });
    if (!expense) throw new NotFoundException('Operational expense not found');
    return this.resolveWorker({ ...expense, category: constructionExpenseCategory(expense.category).value });
  }

  async createDailyExpense(tenantDb: any, userId: string, data: DailyExpenseDto) {
    return tenantDb.$transaction(async (tx: any) => {
      const expenseData = this.expenseData(data);
      const expense = await tx.dailyOperationalExpense.create({
        data: {
          ...expenseData,
          date: data.date || new Date(),
          recordedByUserId: userId,
        },
      });
      await this.syncDailyExpense(tx, expense, userId);
      return expense;
    });
  }

  async updateDailyExpense(tenantDb: any, id: string, userId: string, data: DailyExpenseDto) {
    return tenantDb.$transaction(async (tx: any) => {
      const current = await tx.dailyOperationalExpense.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new NotFoundException('Operational expense not found');
      const expenseData = this.expenseData(data);
      const expense = await tx.dailyOperationalExpense.update({
        where: { id },
        data: {
          ...expenseData,
          date: data.date || current.date,
          recordedByUserId: userId,
        },
      });
      await this.syncDailyExpense(tx, expense, userId);
      return expense;
    });
  }

  async deleteDailyExpense(tenantDb: any, id: string) {
    return tenantDb.$transaction(async (tx: any) => {
      const result = await tx.dailyOperationalExpense.updateMany({
        where: { id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (!result.count) throw new NotFoundException('Operational expense not found');
      await tx.transaction.updateMany({
        where: { referenceId: `expense:${id}`, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.accounting.retractPriorForSource(tx, 'DAILY_EXPENSE', id);
      return { deleted: true };
    });
  }

  async listWorkerLedger(tenantDb: any, projectId?: string, workerId?: string) {
    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (workerId) where.workerId = workerId;
    const rows = await tenantDb.workerLedgerEntry.findMany({
      where,
      include: { staff: true, worker: { include: { linkedStaff: true } }, project: true, user: true },
      orderBy: { date: 'desc' },
    });
    return rows.map((row: any) => this.resolveWorker(row));
  }

  async createWorkerLedgerEntry(tenantDb: any, userId: string, data: WorkerLedgerDto) {
    return tenantDb.$transaction(async (tx: any) => {
      const entry = await tx.workerLedgerEntry.create({
        data: {
          ...data,
          type: data.type as any,
          date: data.date || new Date(),
          userId,
        },
      });
      await this.syncWorkerLedger(tx, entry, userId);
      return entry;
    });
  }

  async deleteWorkerLedgerEntry(tenantDb: any, id: string) {
    return tenantDb.$transaction(async (tx: any) => {
      const entry = await tx.workerLedgerEntry.findUnique({ where: { id } });
      if (!entry) throw new NotFoundException('Worker ledger entry not found');
      await tx.workerLedgerEntry.delete({ where: { id } });
      await tx.transaction.updateMany({
        where: { referenceId: `ledger:${id}`, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.accounting.retractPriorForSource(tx, 'WORKER_LEDGER', id);
      return { deleted: true };
    });
  }

  // -----------------------------------------------------------
  // Construction inventory movements
  // -----------------------------------------------------------

  async getInventory(tenantDb: any, projectId?: string) {
    // Soft-delete legacy USAGE→cashbook rows that double-counted procurement expense.
    await tenantDb.transaction.updateMany({
      where: { referenceId: { startsWith: 'invusage:' }, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    const movementWhere: any = {};
    if (projectId) movementWhere.projectId = projectId;
    const [materials, movements] = await Promise.all([
      tenantDb.constructionMaterial.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
      }),
      tenantDb.constructionInventoryTransaction.findMany({
        where: movementWhere,
        include: { material: true, project: true, user: true },
        orderBy: { date: 'desc' },
        take: 250,
      }),
    ]);
    return {
      materials,
      movements,
      summary: {
        materialCount: materials.length,
        lowStockCount: materials.filter(
          (material: any) => Number(material.quantity) <= Number(material.lowStockThreshold),
        ).length,
        stockValue: materials.reduce(
          (total: number, material: any) => total + Number(material.quantity) * Number(material.unitCost),
          0,
        ),
      },
    };
  }

  getMaterials(tenantDb: any, search?: string) {
    const where: any = { deletedAt: null };
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { category: { contains: search, mode: 'insensitive' } },
    ];
    return tenantDb.constructionMaterial.findMany({ where, orderBy: { name: 'asc' } });
  }

  getMaterialOptions(tenantDb: any) {
    return tenantDb.constructionMaterial.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, unitCost: true, quantity: true },
      orderBy: { name: 'asc' },
    });
  }

  async getMaterial(tenantDb: any, id: string) {
    const material = await tenantDb.constructionMaterial.findFirst({ where: { id, deletedAt: null } });
    if (!material) throw new NotFoundException('Material not found');
    return material;
  }

  createMaterial(tenantDb: any, data: ConstructionMaterialDto) {
    return tenantDb.constructionMaterial.create({
      data: {
        ...data,
        unit: data.unit as any,
        status: (data.status as any) || 'ACTIVE',
        quantity: data.quantity || 0,
      },
    });
  }

  async updateMaterial(tenantDb: any, id: string, data: ConstructionMaterialDto) {
    const result = await tenantDb.constructionMaterial.updateMany({
      where: { id, deletedAt: null },
      data: { ...data, unit: data.unit as any, status: data.status as any, version: { increment: 1 } },
    });
    if (!result.count) throw new NotFoundException('Material not found');
    return tenantDb.constructionMaterial.findUnique({ where: { id } });
  }

  async deleteMaterial(tenantDb: any, id: string) {
    const result = await tenantDb.constructionMaterial.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    if (!result.count) throw new NotFoundException('Material not found');
    return { deleted: true };
  }

  async createInventoryMovement(tenantDb: any, userId: string, data: InventoryMovementDto) {
    return tenantDb.$transaction(async (tx: any) => {
      const material = await tx.constructionMaterial.findFirst({ where: { id: data.materialId, deletedAt: null } });
      if (!material) throw new NotFoundException('Material not found');
      if (data.type === 'USAGE' && !data.projectId) {
        throw new BadRequestException('A project is required for material usage');
      }
      if (data.type === 'TRANSFER') {
        throw new BadRequestException('Warehouse transfers are not supported yet; use RESTOCK / USAGE / ADJUSTMENT');
      }
      const currentQuantity = Number(material.quantity);
      const qty = Number(data.quantity);
      const eventDate = data.date || new Date();
      const unitCost = Number(data.unitCost ?? material.unitCost ?? 0);
      const totalCost = Number(data.totalCost ?? qty * unitCost);
      // ADJUSTMENT: positive adds stock, negative reduces (write-off without project)
      const delta = data.type === 'USAGE' ? -Math.abs(qty) : data.type === 'ADJUSTMENT' ? qty : Math.abs(qty);
      const nextQuantity = currentQuantity + delta;
      if (nextQuantity < 0) throw new BadRequestException('Insufficient stock for this movement');
      const nextUnitCost = data.type === 'RESTOCK' && nextQuantity > 0
        ? Math.round((((currentQuantity * Number(material.unitCost || 0)) + totalCost) / nextQuantity) * 100) / 100
        : Number(material.unitCost || 0);
      const updated = await tx.constructionMaterial.updateMany({
        where: { id: material.id, version: material.version, deletedAt: null },
        data: {
          quantity: nextQuantity,
          unitCost: nextUnitCost,
          warehouse: data.warehouse || material.warehouse,
          version: { increment: 1 },
        },
      });
      if (!updated.count) throw new ConflictException('Stock changed while recording movement; reload and retry');
      const movement = await tx.constructionInventoryTransaction.create({
        data: {
          materialId: data.materialId,
          projectId: data.projectId,
          type: data.type as any,
          quantity: Math.abs(qty),
          userId,
          notes: data.notes,
          warehouse: data.warehouse,
          date: eventDate,
          supplierId: data.supplierId,
          paymentMethod: data.paymentMethod,
          unitCost,
          totalCost,
          sourceRef: data.sourceRef,
        },
        include: { material: true, project: true, user: true },
      });
      if (data.type === 'RESTOCK' && totalCost > 0) {
        const category = await this.findOrCreateExpenseCategory(tx, 'MATERIALS');
        const referenceId = `construction-procurement:${movement.sourceRef || movement.id}`;
        await tx.transaction.create({
          data: {
            referenceId,
            type: 'EXPENSE',
            status: 'CLEARED',
            description: `${material.name} purchase`,
            amount: totalCost,
            date: eventDate,
            categoryId: category.id,
            projectId: data.projectId,
            userId,
            notes: data.paymentMethod ? `Payment method: ${data.paymentMethod}` : data.notes,
          },
        });
        await this.accounting.postFinancialEvent(tx, {
          tx,
          tenantId: 'system',
          userId,
          sourceType: 'CONSTRUCTION_PROCUREMENT',
          sourceId: movement.id,
          sourceRef: movement.sourceRef || movement.id,
          date: eventDate,
          memo: `${material.name} purchase`,
          drKey: 'PURCHASE_INVOICE_EXPENSE',
          crKey: 'TRANSACTION_EXPENSE_CASH',
          amount: totalCost,
        });
      }
      // USAGE is an internal stock movement only. Procurement was already
      // expensed at RESTOCK, so posting usage again would double-count it.
      return movement;
    });
  }

  private validateDateRange(startDate?: Date, endDate?: Date) {
    if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
      throw new BadRequestException('End date must be on or after start date');
    }
  }

  private async findOrCreateCategory(tx: any, name: string) {
    const existing = await tx.category.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, deletedAt: null },
    });
    if (existing) return existing;
    return tx.category.create({ data: { name, color: '#e7515a' } });
  }

  private async findOrCreateExpenseCategory(tx: any, value: string) {
    const definition = constructionExpenseCategory(value);
    const names = [definition.value, definition.label, ...definition.aliases];
    const candidates = await tx.category.findMany({
      where: {
        OR: [
          { code: definition.code },
          ...names.map((name) => ({ name: { equals: name, mode: 'insensitive' } })),
        ],
      },
    });
    let category = candidates.find((row: any) => row.code === definition.code)
      || candidates.find((row: any) => !row.deletedAt && row.name.toLowerCase() === definition.label.toLowerCase())
      || candidates.find((row: any) => !row.deletedAt)
      || candidates[0];
    if (!category) {
      return tx.category.upsert({
        where: { code: definition.code },
        update: { name: definition.label, deletedAt: null },
        create: { name: definition.label, code: definition.code, color: '#e7515a' },
      });
    }
    for (const duplicate of candidates.filter((row: any) => row.id !== category.id)) {
      await tx.transaction.updateMany({ where: { categoryId: duplicate.id }, data: { categoryId: category.id } });
      await tx.category.delete({ where: { id: duplicate.id } });
    }
    if (category.name !== definition.label || category.code !== definition.code || category.deletedAt) {
      category = await tx.category.update({
        where: { id: category.id },
        data: { name: definition.label, code: definition.code, deletedAt: null },
      });
    }
    return category;
  }

  private async syncDailyExpense(tx: any, expense: any, userId: string) {
    const definition = constructionExpenseCategory(expense.category);
    const category = await this.findOrCreateExpenseCategory(tx, definition.value);
    const result = await tx.transaction.upsert({
      where: { referenceId: `expense:${expense.id}` },
      create: {
        referenceId: `expense:${expense.id}`,
        type: 'EXPENSE',
        status: 'CLEARED',
        description: expense.description,
        amount: expense.amount,
        date: expense.date,
        categoryId: category.id,
        projectId: expense.projectId,
        userId,
      },
      update: {
        type: 'EXPENSE',
        status: 'CLEARED',
        description: expense.description,
        amount: expense.amount,
        date: expense.date,
        categoryId: category.id,
        projectId: expense.projectId,
        userId,
        deletedAt: null,
        version: { increment: 1 },
      },
    });
    await this.accounting.retractPriorForSource(tx, 'DAILY_EXPENSE', expense.id);
    await this.accounting.postFinancialEvent(tx, {
      tx, tenantId: 'system', userId,
      sourceType: 'DAILY_EXPENSE',
      sourceId: expense.id,
      sourceRef: `expense ${expense.id}`,
      date: expense.date,
      memo: expense.description,
      drKey: definition.debitKey,
      crKey: definition.creditKey,
      amount: Number(expense.amount),
    });
    return result;
  }

  private async syncWorkerLedger(tx: any, entry: any, userId: string) {
    const category = entry.type === 'EXPENSE'
      ? await this.findOrCreateExpenseCategory(tx, 'LABOR')
      : await this.findOrCreateCategory(tx, 'Labor Income');
    const result = await tx.transaction.upsert({
      where: { referenceId: `ledger:${entry.id}` },
      create: {
        referenceId: `ledger:${entry.id}`,
        type: entry.type,
        status: 'CLEARED',
        description: entry.description,
        amount: entry.amount,
        date: entry.date,
        categoryId: category.id,
        projectId: entry.projectId,
        userId,
      },
      update: {
        type: entry.type,
        status: 'CLEARED',
        description: entry.description,
        amount: entry.amount,
        date: entry.date,
        categoryId: category.id,
        projectId: entry.projectId,
        userId,
        deletedAt: null,
        version: { increment: 1 },
      },
    });
    await this.accounting.retractPriorForSource(tx, 'WORKER_LEDGER', entry.id);
    const isExpense = entry.type === 'EXPENSE';
    await this.accounting.postFinancialEvent(tx, {
      tx, tenantId: 'system', userId,
      sourceType: 'WORKER_LEDGER',
      sourceId: entry.id,
      sourceRef: `ledger ${entry.id}`,
      date: entry.date,
      memo: entry.description,
      drKey: isExpense ? 'PAYROLL_EXPENSE' : 'TRANSACTION_INCOME_CASH',
      crKey: isExpense ? 'PAYROLL_CASH' : 'TRANSACTION_INCOME_REVENUE',
      amount: Number(entry.amount),
    });
    return result;
  }

  private async syncContractBudget(tenantDb: any, contractId: string) {
    // Workforce budgets are commitments, not cash income. Soft-delete any
    // legacy CLEARED INCOME rows that previously inflated project P&L.
    return tenantDb.transaction.updateMany({
      where: { referenceId: `wfcontract:${contractId}`, deletedAt: null },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
  }
}
