import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { GetTenantDb } from '../../common/decorators/tenant-context.decorator';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ReportScheduleDto } from './reports.dto';

// Workspace → required permission to view/run reports in that workspace.
// A user must hold the specific workspace permission to see or run those reports.
const REPORT_WORKSPACE_PERMISSION: Record<string, string> = {
  core: 'reports.read',
  payroll: 'reports.read',
  construction: 'reports.construction.read',
  real_estate: 'reports.real_estate.read',
  material_management: 'reports.material.read',
};

const ANY_REPORT_PERMISSION = Object.values(REPORT_WORKSPACE_PERMISSION);

function isOwner(user: any): boolean {
  return user?.isSuperAdmin || user?.role === 'SUPER_ADMIN' || user?.role === 'COMPANY_OWNER';
}

function userHas(user: any, key: string): boolean {
  if (isOwner(user)) return true;
  return Array.isArray(user?.permissions) && user.permissions.includes(key);
}

function requireAnyReportPermission(user: any) {
  if (isOwner(user)) return;
  const permissions: string[] = user?.permissions || [];
  const hasAny = ANY_REPORT_PERMISSION.some((key) => permissions.includes(key));
  if (!hasAny) {
    throw new ForbiddenException('Missing required reports permission');
  }
}

function requireReportPermission(user: any, workspace: string) {
  if (isOwner(user)) return;
  const required = REPORT_WORKSPACE_PERMISSION[workspace] || 'reports.read';
  if (!userHas(user, required)) {
    throw new ForbiddenException(`Missing required permission: ${required}`);
  }
}

@Controller('api/reports')
@UseGuards(TenantAccessGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('financial')
  @RequirePermissions('reports.read')
  async getFinancialReport(
    @GetTenantDb() tenantDb: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getFinancialReport(tenantDb, startDate, endDate);
  }

  @Get('construction')
  @RequirePermissions('reports.construction.read')
  async getConstructionReport(@GetTenantDb() tenantDb: any) {
    return this.reportsService.getConstructionReport(tenantDb);
  }

  // The registry is scoped to what the user can actually see. We require any
  // reports.* permission to hit the endpoint; the service filters the payload.
  @Get('registry')
  @RequireAnyPermission('reports.read', 'reports.construction.read', 'reports.real_estate.read', 'reports.material.read')
  getRegistry(@CurrentUser() user: any) {
    requireAnyReportPermission(user);
    const registry = this.reportsService.getRegistry();
    if (isOwner(user)) return registry;
    return registry.filter((report) => userHas(user, REPORT_WORKSPACE_PERMISSION[report.workspace] || 'reports.read'));
  }

  @Get('run/:reportId')
  @RequireAnyPermission('reports.read', 'reports.construction.read', 'reports.real_estate.read', 'reports.material.read')
  runReport(
    @GetTenantDb() db: any,
    @CurrentUser() user: any,
    @Param('reportId') reportId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('entityId') entityId?: string,
    @Query('projectId') projectId?: string,
    @Query('compareStartDate') compareStartDate?: string,
    @Query('compareEndDate') compareEndDate?: string,
  ) {
    const report = this.reportsService.getRegistry().find((row) => row.id === reportId);
    if (!report) throw new ForbiddenException('Report not found');
    requireReportPermission(user, report.workspace);
    return this.reportsService.compareReport(db, reportId, { startDate, endDate, entityId, projectId, compareStartDate, compareEndDate });
  }

  @Get('export/:reportId')
  @RequireAnyPermission('reports.read', 'reports.construction.read', 'reports.real_estate.read', 'reports.material.read')
  async exportReport(
    @GetTenantDb() db: any,
    @CurrentUser() user: any,
    @Param('reportId') reportId: string,
    @Query('format') format = 'csv',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('entityId') entityId?: string,
    @Query('projectId') projectId?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    const report = this.reportsService.getRegistry().find((row) => row.id === reportId);
    if (!report) throw new ForbiddenException('Report not found');
    requireReportPermission(user, report.workspace);
    if (!['csv', 'xls', 'pdf'].includes(format)) throw new BadRequestException('Format must be csv, xls, or pdf');
    let branding: { companyName: string; companyAddress: string; companyPhone: string; companyEmail: string } | undefined;
    if (format === 'pdf') {
      const configRows: { key: string; value: string }[] = await db.systemConfig.findMany({ select: { key: true, value: true } });
      const cfg = Object.fromEntries(configRows.map((r) => [r.key, r.value]));
      branding = {
        companyName: cfg.company_name || user.companyName || '',
        companyAddress: cfg.company_address || '',
        companyPhone: cfg.company_phone || '',
        companyEmail: cfg.company_email || '',
      };
    }
    const file = await this.reportsService.exportReport(db, reportId, format as 'csv' | 'xls' | 'pdf', { startDate, endDate, entityId, projectId }, branding);
    response?.setHeader('Content-Type', file.contentType);
    response?.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return new StreamableFile(file.content);
  }

  @Get('projects')
  @RequireAnyPermission('reports.read', 'reports.construction.read')
  listProjectReports(@GetTenantDb() db: any) {
    return this.reportsService.listProjectReports(db);
  }

  @Get('projects/:projectId/overview')
  @RequireAnyPermission('reports.read', 'reports.construction.read')
  getProjectOverview(
    @GetTenantDb() db: any,
    @Param('projectId') projectId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getProjectOverview(db, projectId, { startDate, endDate });
  }

  @Get('projects/:projectId/:category/:txnId')
  @RequireAnyPermission('reports.read', 'reports.construction.read')
  getProjectCategoryDetail(
    @GetTenantDb() db: any,
    @Param('projectId') projectId: string,
    @Param('category') category: string,
    @Param('txnId') txnId: string,
  ) {
    return this.reportsService.getProjectCategoryDetail(db, projectId, category, txnId);
  }

  @Get('projects/:projectId/:category')
  @RequireAnyPermission('reports.read', 'reports.construction.read')
  getProjectCategoryLedger(
    @GetTenantDb() db: any,
    @Param('projectId') projectId: string,
    @Param('category') category: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('filter') filter?: string,
  ) {
    return this.reportsService.getProjectCategoryLedger(db, projectId, category, { startDate, endDate, filter });
  }

  @Get('properties')
  @RequirePermissions('reports.real_estate.read')
  listPropertyReports(@GetTenantDb() db: any) {
    return this.reportsService.listPropertyReports(db);
  }

  @Get('properties/:propertyId/overview')
  @RequirePermissions('reports.real_estate.read')
  getPropertyOverview(
    @GetTenantDb() db: any,
    @Param('propertyId') propertyId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getPropertyOverview(db, propertyId, { startDate, endDate });
  }

  @Get('properties/:propertyId/:category/:txnId')
  @RequirePermissions('reports.real_estate.read')
  getPropertyCategoryDetail(
    @GetTenantDb() db: any,
    @Param('propertyId') propertyId: string,
    @Param('category') category: string,
    @Param('txnId') txnId: string,
  ) {
    return this.reportsService.getPropertyCategoryDetail(db, propertyId, category, txnId);
  }

  @Get('properties/:propertyId/:category')
  @RequirePermissions('reports.real_estate.read')
  getPropertyCategoryLedger(
    @GetTenantDb() db: any,
    @Param('propertyId') propertyId: string,
    @Param('category') category: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('filter') filter?: string,
  ) {
    return this.reportsService.getPropertyCategoryLedger(db, propertyId, category, { startDate, endDate, filter });
  }

  @Get('materials')
  @RequirePermissions('reports.material.read')
  listMaterialReports(@GetTenantDb() db: any) {
    return this.reportsService.listMaterialReports(db);
  }

  @Get('materials/:materialId/overview')
  @RequirePermissions('reports.material.read')
  getMaterialOverview(
    @GetTenantDb() db: any,
    @Param('materialId') materialId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportsService.getMaterialOverview(db, materialId, { startDate, endDate });
  }

  @Get('materials/:materialId/:category/:txnId')
  @RequirePermissions('reports.material.read')
  getMaterialCategoryDetail(
    @GetTenantDb() db: any,
    @Param('materialId') materialId: string,
    @Param('category') category: string,
    @Param('txnId') txnId: string,
  ) {
    return this.reportsService.getMaterialCategoryDetail(db, materialId, category, txnId);
  }

  @Get('materials/:materialId/:category')
  @RequirePermissions('reports.material.read')
  getMaterialCategoryLedger(
    @GetTenantDb() db: any,
    @Param('materialId') materialId: string,
    @Param('category') category: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('filter') filter?: string,
  ) {
    return this.reportsService.getMaterialCategoryLedger(db, materialId, category, { startDate, endDate, filter });
  }

  @Get('schedules')
  @RequirePermissions('reports.admin')
  listSchedules(@GetTenantDb() db: any) {
    return this.reportsService.listSchedules(db);
  }

  @Post('schedules')
  @RequirePermissions('reports.admin')
  createSchedule(@GetTenantDb() db: any, @Body() body: ReportScheduleDto) {
    return this.reportsService.createSchedule(db, body);
  }

  @Patch('schedules/:id')
  @RequirePermissions('reports.admin')
  updateSchedule(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: ReportScheduleDto) {
    return this.reportsService.updateSchedule(db, id, body);
  }

  @Delete('schedules/:id')
  @RequirePermissions('reports.admin')
  deleteSchedule(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.reportsService.deleteSchedule(db, id);
  }
}
