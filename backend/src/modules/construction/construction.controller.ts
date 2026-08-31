import { Controller, Get, Post, Body, Query, UseGuards, Param, Patch, Delete, ForbiddenException } from '@nestjs/common';
import { ConstructionService } from './construction.service';
import { GetTenantContext, GetTenantDb } from '../../common/decorators/tenant-context.decorator';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StaffService } from '../staff/staff.service';
import { CreateStaffDto, UpdateStaffDto } from '../staff/dto/staff.dto';
import {
  ConstructionMaterialDto,
  ContractAdjustmentDto,
  ContractAssignmentDto,
  ContractPaymentDto,
  ContractStatusDto,
  DailyExpenseDto,
  InventoryMovementDto,
  OutsideWorkerDto,
  ProjectDto,
  TaskDto,
  WorkerLedgerDto,
  WorkerTypeDto,
  WorkforceContractDto,
} from './dto/construction.dto';

@Controller('api/construction')
@UseGuards(TenantAccessGuard)
export class ConstructionController {
  constructor(
    private readonly constructionService: ConstructionService,
    private readonly staffService: StaffService,
  ) {}

  private async requireConstructionWorker(db: any, id: string) {
    const staff = await this.staffService.getStaffById(db, id);
    if (staff.department !== 'CONSTRUCTION') throw new ForbiddenException('Not a construction worker');
    return staff;
  }

  @Get('projects')
  @RequirePermissions('projects.read')
  async getProjects(
    @GetTenantDb() tenantDb: any,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.constructionService.getProjects(tenantDb, { status, search });
  }

  @Get('projects/options')
  @RequireAnyPermission('projects.read', 'construction_tasks.read', 'construction_tasks.create', 'construction_expenses.read', 'construction_expenses.create', 'workforce_contracts.read', 'workforce_contracts.create', 'construction_inventory.read', 'construction_inventory.create', 'users.create', 'users.update')
  getProjectOptions(@GetTenantDb() db: any) {
    return this.constructionService.getProjectOptions(db);
  }

  @Post('projects')
  @RequirePermissions('projects.create')
  async createProject(
    @GetTenantDb() tenantDb: any,
    @GetTenantContext('companyId') companyId: string,
    @Body() body: ProjectDto,
  ) {
    return this.constructionService.createProject(tenantDb, companyId, body);
  }

  @Get('projects/:id')
  @RequirePermissions('projects.read')
  getProject(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.constructionService.getProject(db, id);
  }

  @Patch('projects/:id')
  @RequirePermissions('projects.update')
  updateProject(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: ProjectDto) {
    return this.constructionService.updateProject(db, id, body);
  }

  @Delete('projects/:id')
  @RequirePermissions('projects.delete')
  deleteProject(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.constructionService.deleteProject(db, id);
  }

  @Get('tasks')
  @RequirePermissions('construction_tasks.read')
  getTasks(
    @GetTenantDb() db: any,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.constructionService.getTasks(db, { projectId, status, search });
  }

  @Post('tasks')
  @RequirePermissions('construction_tasks.create')
  createTask(@GetTenantDb() db: any, @Body() body: TaskDto) {
    return this.constructionService.createTask(db, body);
  }

  @Get('tasks/:id')
  @RequirePermissions('construction_tasks.read')
  getTask(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.constructionService.getTask(db, id);
  }

  @Patch('tasks/:id')
  @RequirePermissions('construction_tasks.update')
  updateTask(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: TaskDto) {
    return this.constructionService.updateTask(db, id, body);
  }

  @Delete('tasks/:id')
  @RequirePermissions('construction_tasks.delete')
  deleteTask(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.constructionService.deleteTask(db, id);
  }

  @Get('contracts')
  @RequirePermissions('workforce_contracts.read')
  async getWorkforceContracts(
    @GetTenantDb() tenantDb: any,
    @Query('projectId') projectId?: string,
  ) {
    return this.constructionService.getWorkforceContracts(tenantDb, projectId);
  }

  @Get('contracts/workspace')
  @RequirePermissions('workforce_contracts.read')
  async getWorkforceContractsWorkspace(
    @GetTenantDb() db: any,
    @CurrentUser() user: any,
  ) {
    const permissions = user?.permissions || [];
    const isOwner = user?.isImpersonating || ['COMPANY_OWNER', 'SUPER_ADMIN'].includes(user?.role);
    const canEdit = isOwner || permissions.includes('workforce_contracts.create') || permissions.includes('workforce_contracts.update');
    const canAssign = isOwner || permissions.includes('workforce_contracts.update');
    const [contracts, projects, staff] = await Promise.all([
      this.constructionService.getWorkforceContracts(db),
      canEdit ? this.constructionService.getProjectOptions(db) : [],
      canAssign ? this.staffService.getStaffOptions(db, 'CONSTRUCTION') : [],
    ]);
    return { contracts, projects, staff };
  }

  @Post('contracts')
  @RequirePermissions('workforce_contracts.create')
  async createWorkforceContract(@GetTenantDb() tenantDb: any, @Body() body: WorkforceContractDto) {
    return this.constructionService.createWorkforceContract(tenantDb, body);
  }

  @Get('contracts/:id')
  @RequirePermissions('workforce_contracts.read')
  getWorkforceContract(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.constructionService.getWorkforceContract(db, id);
  }

  @Patch('contracts/:id')
  @RequirePermissions('workforce_contracts.update')
  updateWorkforceContract(
    @GetTenantDb() db: any,
    @Param('id') id: string,
    @Body() body: WorkforceContractDto,
  ) {
    return this.constructionService.updateWorkforceContract(db, id, body);
  }

  @Delete('contracts/:id')
  @RequirePermissions('workforce_contracts.delete')
  deleteWorkforceContract(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.constructionService.deleteWorkforceContract(db, id);
  }

  @Post('contracts/:id/status')
  @RequirePermissions('workforce_contracts.update')
  transitionWorkforceContract(
    @GetTenantDb() db: any,
    @Param('id') id: string,
    @Body() body: ContractStatusDto,
  ) {
    return this.constructionService.transitionWorkforceContract(db, id, body.status);
  }

  @Post('contracts/:id/workers')
  @RequirePermissions('workforce_contracts.update')
  assignContractWorker(
    @GetTenantDb() db: any,
    @Param('id') id: string,
    @Body() body: ContractAssignmentDto,
  ) {
    return this.constructionService.assignContractWorker(db, id, body);
  }

  @Delete('contracts/:id/workers/:staffId')
  @RequirePermissions('workforce_contracts.update')
  removeContractWorker(
    @GetTenantDb() db: any,
    @Param('id') id: string,
    @Param('staffId') staffId: string,
  ) {
    return this.constructionService.removeContractWorker(db, id, staffId);
  }

  @Post('contracts/:id/payments')
  @RequirePermissions('workforce_contracts.pay')
  recordContractPayment(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: ContractPaymentDto,
  ) {
    return this.constructionService.recordContractPayment(db, id, userId, body);
  }

  @Post('contracts/:id/adjustments')
  @RequirePermissions('workforce_contracts.update')
  adjustContractBudget(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: ContractAdjustmentDto,
  ) {
    return this.constructionService.adjustContractBudget(db, id, userId, body);
  }

  @Get('worker-types')
  @RequirePermissions('manpower.read')
  listWorkerTypes(@GetTenantDb() db: any) {
    return this.constructionService.listWorkerTypes(db);
  }

  @Post('worker-types')
  @RequirePermissions('manpower.create')
  createWorkerType(@GetTenantDb() db: any, @Body() body: WorkerTypeDto) {
    return this.constructionService.createWorkerType(db, body);
  }

  @Patch('worker-types/:id')
  @RequirePermissions('manpower.update')
  updateWorkerType(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: WorkerTypeDto) {
    return this.constructionService.updateWorkerType(db, id, body);
  }

  @Delete('worker-types/:id')
  @RequirePermissions('manpower.delete')
  deleteWorkerType(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.constructionService.deleteWorkerType(db, id);
  }

  @Get('manpower')
  @RequirePermissions('manpower.read')
  getManpowerDashboard(@GetTenantDb() db: any, @Query('projectId') projectId?: string) {
    return this.constructionService.getManpowerDashboard(db, projectId);
  }

  @Post('manpower/workers')
  @RequirePermissions('manpower.create')
  createManpowerWorker(
    @GetTenantDb() db: any,
    @GetTenantContext('companyId') companyId: string,
    @Body() body: CreateStaffDto,
  ) {
    return this.staffService.createStaff(db, companyId, { ...body, department: 'CONSTRUCTION' });
  }

  @Patch('manpower/workers/:id')
  @RequirePermissions('manpower.update')
  async updateManpowerWorker(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: UpdateStaffDto) {
    await this.requireConstructionWorker(db, id);
    return this.staffService.updateStaff(db, id, { ...body, department: 'CONSTRUCTION' });
  }

  @Delete('manpower/workers/:id')
  @RequirePermissions('manpower.delete')
  async deleteManpowerWorker(@GetTenantDb() db: any, @Param('id') id: string, @CurrentUser('id') userId: string) {
    await this.requireConstructionWorker(db, id);
    return this.staffService.deleteStaff(db, id, userId);
  }

  @Get('expenses')
  @RequirePermissions('construction_expenses.read')
  listDailyExpenses(@GetTenantDb() db: any, @Query('projectId') projectId?: string) {
    return this.constructionService.listDailyExpenses(db, projectId);
  }

  @Get('outside-workers/options')
  @RequireAnyPermission('construction_expenses.read', 'construction_expenses.create')
  getOutsideWorkerOptions(@GetTenantDb() db: any) {
    return this.constructionService.getOutsideWorkerOptions(db);
  }

  @Post('outside-workers')
  @RequirePermissions('construction_expenses.create')
  createOutsideWorker(@GetTenantDb() db: any, @Body() body: OutsideWorkerDto) {
    return this.constructionService.createOutsideWorker(db, body);
  }

  @Post('expenses')
  @RequirePermissions('construction_expenses.create')
  createDailyExpense(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Body() body: DailyExpenseDto,
  ) {
    return this.constructionService.createDailyExpense(db, userId, body);
  }

  @Get('expenses/:id')
  @RequirePermissions('construction_expenses.read')
  getDailyExpense(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.constructionService.getDailyExpense(db, id);
  }

  @Patch('expenses/:id')
  @RequirePermissions('construction_expenses.update')
  updateDailyExpense(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: DailyExpenseDto,
  ) {
    return this.constructionService.updateDailyExpense(db, id, userId, body);
  }

  @Delete('expenses/:id')
  @RequirePermissions('construction_expenses.delete')
  deleteDailyExpense(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.constructionService.deleteDailyExpense(db, id);
  }

  @Get('worker-ledger')
  @RequirePermissions('manpower.read')
  listWorkerLedger(
    @GetTenantDb() db: any,
    @Query('projectId') projectId?: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.constructionService.listWorkerLedger(db, projectId, staffId);
  }

  @Post('worker-ledger')
  @RequirePermissions('manpower.create')
  createWorkerLedgerEntry(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Body() body: WorkerLedgerDto,
  ) {
    return this.constructionService.createWorkerLedgerEntry(db, userId, body);
  }

  @Delete('worker-ledger/:id')
  @RequirePermissions('manpower.delete')
  deleteWorkerLedgerEntry(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.constructionService.deleteWorkerLedgerEntry(db, id);
  }

  @Get('inventory')
  @RequirePermissions('construction_inventory.read')
  getInventory(@GetTenantDb() db: any, @Query('projectId') projectId?: string) {
    return this.constructionService.getInventory(db, projectId);
  }

  @Post('inventory/movements')
  @RequirePermissions('construction_inventory.create')
  createInventoryMovement(
    @GetTenantDb() db: any,
    @CurrentUser('id') userId: string,
    @Body() body: InventoryMovementDto,
  ) {
    return this.constructionService.createInventoryMovement(db, userId, body);
  }

  @Get('materials')
  @RequirePermissions('construction_inventory.read')
  getMaterials(@GetTenantDb() db: any, @Query('search') search?: string) {
    return this.constructionService.getMaterials(db, search);
  }

  @Get('materials/options')
  @RequireAnyPermission('construction_inventory.read', 'construction_inventory.create')
  getMaterialOptions(@GetTenantDb() db: any) {
    return this.constructionService.getMaterialOptions(db);
  }

  @Post('materials')
  @RequirePermissions('construction_inventory.create')
  createMaterial(@GetTenantDb() db: any, @Body() body: ConstructionMaterialDto) {
    return this.constructionService.createMaterial(db, body);
  }

  @Get('materials/:id')
  @RequirePermissions('construction_inventory.read')
  getMaterial(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.constructionService.getMaterial(db, id);
  }

  @Patch('materials/:id')
  @RequirePermissions('construction_inventory.update')
  updateMaterial(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: ConstructionMaterialDto) {
    return this.constructionService.updateMaterial(db, id, body);
  }

  @Delete('materials/:id')
  @RequirePermissions('construction_inventory.delete')
  deleteMaterial(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.constructionService.deleteMaterial(db, id);
  }
}
