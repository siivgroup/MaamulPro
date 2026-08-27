import { Controller, Get, Post, Body, Query, UseGuards, Param, Patch, Delete, ForbiddenException } from '@nestjs/common';
import { StaffService } from './staff.service';
import { GetTenantDb, GetTenantContext } from '../../common/decorators/tenant-context.decorator';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  AccountStatusDto,
  CreateStaffDto,
  StaffAccountDto,
  StaffEmailDto,
  StaffPasswordDto,
  StaffRoleDto,
  UpdateStaffDto,
} from './dto/staff.dto';

@Controller('api/staff')
@UseGuards(TenantAccessGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @RequirePermissions('users.read')
  async getStaff(
    @GetTenantDb() tenantDb: any,
    @Query() query: PaginationQueryDto,
    @Query('department') department?: string,
    @Query('status') status?: string,
  ) {
    return this.staffService.getStaff(tenantDb, { ...query, department, status });
  }

  @Get('options')
  @RequireAnyPermission('users.read', 'construction_tasks.create', 'construction_tasks.update', 'construction_expenses.create', 'construction_expenses.update', 'workforce_contracts.create', 'workforce_contracts.update')
  getStaffOptions(@GetTenantDb() db: any, @Query('department') department?: string) {
    return this.staffService.getStaffOptions(db, department);
  }

  @Get('accounts')
  @RequirePermissions('users.read')
  listAccounts(@GetTenantDb() db: any) {
    return this.staffService.listUserAccounts(db);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  getStaffById(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.staffService.getStaffById(db, id);
  }

  @Post()
  @RequirePermissions('users.create')
  async createStaff(
    @GetTenantDb() tenantDb: any,
    @GetTenantContext('companyId') companyId: string,
    @Body() body: CreateStaffDto,
  ) {
    return this.staffService.createStaff(tenantDb, companyId, body);
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  updateStaff(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: UpdateStaffDto) {
    return this.staffService.updateStaff(db, id, body);
  }

  @Delete(':id')
  @RequirePermissions('users.delete')
  deleteStaff(@GetTenantDb() db: any, @Param('id') id: string, @CurrentUser('id') currentUserId: string) {
    return this.staffService.deleteStaff(db, id, currentUserId);
  }

  @Post(':id/account')
  @RequirePermissions('users.create')
  createAccount(
    @GetTenantDb() db: any,
    @GetTenantContext('companyId') companyId: string,
    @Param('id') id: string,
    @Body() body: StaffAccountDto,
  ) {
    return this.staffService.createAccount(db, companyId, id, body);
  }

  @Patch(':id/account/status')
  @RequirePermissions('users.update')
  setAccountStatus(
    @GetTenantDb() db: any,
    @GetTenantContext('companyId') companyId: string,
    @Param('id') id: string,
    @Body() body: AccountStatusDto,
  ) {
    return this.staffService.setAccountStatus(db, companyId, id, body.isActive);
  }

  @Patch(':id/account/email')
  @RequirePermissions('users.update')
  updateEmail(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: StaffEmailDto, @CurrentUser() user: any) {
    if (user?.isImpersonating) throw new ForbiddenException('Cannot change credentials while impersonating.');
    return this.staffService.updateAccountEmail(db, id, body.email);
  }

  @Post(':id/account/reset-password')
  @RequirePermissions('users.update')
  resetPassword(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: StaffPasswordDto, @CurrentUser() user: any) {
    if (user?.isImpersonating) throw new ForbiddenException('Cannot change credentials while impersonating.');
    return this.staffService.resetPassword(db, id, body.temporaryPassword);
  }

  @Patch(':id/account/role')
  @RequirePermissions('users.update')
  updateRole(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: StaffRoleDto) {
    return this.staffService.updateAccountRole(db, id, body.role);
  }

  @Get(':id/activity')
  @RequirePermissions('activity_logs.read')
  getActivity(@GetTenantDb() db: any, @Param('id') id: string) {
    return this.staffService.getStaffActivity(db, id);
  }
}
