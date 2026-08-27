import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { GetTenantContext, GetTenantDb } from '../../common/decorators/tenant-context.decorator';
import { CompanyModules } from '../../common/database/company-access';
import { TenantAccessGuard } from '../../common/guards/tenant-access.guard';
import {
  AssignUserRolesDto,
  CreateRoleDto,
  SetDirectPermissionDto,
  SetApprovalLimitDto,
  UpdateRoleDto,
} from './dto/rbac.dto';
import { RbacService } from './rbac.service';

@Controller('api/rbac')
@UseGuards(TenantAccessGuard)
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get('permissions')
  @RequirePermissions('roles.read')
  listPermissions(@GetTenantDb() db: any, @GetTenantContext() company: CompanyModules) {
    return this.rbac.listPermissions(db, company);
  }

  @Get('roles')
  @RequireAnyPermission('roles.read', 'users.create', 'users.update')
  listRoles(@GetTenantDb() db: any, @GetTenantContext() company: CompanyModules) {
    return this.rbac.listRoles(db, company);
  }

  @Post('roles')
  @RequirePermissions('roles.create')
  createRole(@GetTenantDb() db: any, @Body() body: CreateRoleDto, @GetTenantContext() company: CompanyModules) {
    return this.rbac.createRole(db, body, company);
  }

  @Patch('roles/:id')
  @RequirePermissions('roles.update')
  updateRole(@GetTenantDb() db: any, @Param('id') id: string, @Body() body: UpdateRoleDto, @GetTenantContext() company: CompanyModules) {
    return this.rbac.updateRole(db, id, body, company);
  }

  @Delete('roles/:id')
  @RequirePermissions('roles.delete')
  deleteRole(@GetTenantDb() db: any, @Param('id') id: string, @GetTenantContext() company: CompanyModules) {
    return this.rbac.deleteRole(db, id, company);
  }

  @Get('users/:userId')
  @RequirePermissions('users.read', 'roles.read')
  getUserAccess(@GetTenantDb() db: any, @Param('userId') userId: string, @GetTenantContext() company: CompanyModules) {
    return this.rbac.getUserAccess(db, userId, company);
  }

  @Patch('users/:userId/roles')
  @RequirePermissions('users.update', 'roles.update')
  assignUserRoles(
    @GetTenantDb() db: any,
    @Param('userId') userId: string,
    @Body() body: AssignUserRolesDto,
    @GetTenantContext() company: CompanyModules,
  ) {
    return this.rbac.assignUserRoles(db, userId, body, company);
  }

  @Patch('users/:userId/approval-limit')
  @RequirePermissions('users.update', 'roles.update')
  setApprovalLimit(@GetTenantDb() db: any, @Param('userId') userId: string, @Body() body: SetApprovalLimitDto, @GetTenantContext() company: CompanyModules) {
    return this.rbac.setApprovalLimit(db, userId, body.approvalLimit, company);
  }

  @Post('users/:userId/permissions')
  @RequirePermissions('users.update', 'roles.update')
  setDirectPermission(
    @GetTenantDb() db: any,
    @Param('userId') userId: string,
    @Body() body: SetDirectPermissionDto,
    @GetTenantContext() company: CompanyModules,
  ) {
    return this.rbac.setDirectPermission(db, userId, body, company);
  }

  @Delete('users/:userId/permissions/:permissionId')
  @RequirePermissions('users.update', 'roles.update')
  removeDirectPermission(
    @GetTenantDb() db: any,
    @Param('userId') userId: string,
    @Param('permissionId') permissionId: string,
    @GetTenantContext() company: CompanyModules,
  ) {
    return this.rbac.removeDirectPermission(db, userId, permissionId, company);
  }
}
