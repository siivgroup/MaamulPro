import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CentralPrismaService } from '../../common/database/central-prisma.service';
import { CompanyModules, companyPermissionKeys, companyRoleAllowed } from '../../common/database/company-access';
import { isAppRole } from '../../common/database/roles';
import {
  AssignUserRolesDto,
  CreateRoleDto,
  SetDirectPermissionDto,
  UpdateRoleDto,
} from './dto/rbac.dto';

@Injectable()
export class RbacService {
  constructor(private readonly centralPrisma: CentralPrismaService) {}

  private get central(): any {
    return this.centralPrisma as any;
  }

  private async bumpSessionVersions(userIds: string[]) {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    if (!unique.length) return;
    await this.central.companyUser.updateMany({
      where: { id: { in: unique } },
      data: { sessionVersion: { increment: 1 } },
    });
  }

  private async usersHoldingRole(tenantDb: any, roleId: string): Promise<string[]> {
    const rows = await tenantDb.rbacUserRole.findMany({ where: { roleId }, select: { userId: true } });
    return rows.map((row: { userId: string }) => row.userId);
  }

  listPermissions(tenantDb: any, company: CompanyModules) {
    return tenantDb.rbacPermission.findMany({
      where: { key: { in: [...companyPermissionKeys(company)] } },
      orderBy: [{ workspace: 'asc' }, { module: 'asc' }, { action: 'asc' }],
    });
  }

  async listRoles(tenantDb: any, company: CompanyModules) {
    const roles = await tenantDb.rbacRole.findMany({
      where: { deletedAt: null },
      include: {
        rolePermissions: { include: { permission: true } },
        _count: { select: { userRoles: true } },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.filter((role: any) => companyRoleAllowed(role, company)).map((role: any) => this.scopedRole(role, company));
  }

  private scopedRole(role: any, company: CompanyModules) {
    const allowed = companyPermissionKeys(company);
    return { ...role, rolePermissions: role.rolePermissions.filter((link: any) => allowed.has(link.permission?.key)) };
  }

  private assertRole(role: any, company: CompanyModules) {
    if (!companyRoleAllowed(role, company)) throw new ForbiddenException('This role is not available for your company’s enabled modules.');
  }

  async createRole(tenantDb: any, data: CreateRoleDto, company: CompanyModules) {
    if (isAppRole(data.key)) throw new BadRequestException('This role key is reserved for a system role');
    const existing = await tenantDb.rbacRole.findFirst({ where: { key: data.key, deletedAt: null } });
    if (existing) throw new ConflictException(`Role key '${data.key}' already exists`);
    await this.validatePermissions(tenantDb, data.permissionIds, company);
    return tenantDb.rbacRole.create({
      data: {
        key: data.key,
        name: data.name,
        description: data.description,
        isActive: data.isActive ?? true,
        rolePermissions: {
          create: data.permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
      include: { rolePermissions: { include: { permission: true } } },
    });
  }

  async updateRole(tenantDb: any, id: string, data: UpdateRoleDto, company: CompanyModules) {
    const role = await tenantDb.rbacRole.findUnique({ where: { id }, include: { rolePermissions: { include: { permission: true } } } });
    if (!role || role.deletedAt) throw new NotFoundException('Role not found');
    this.assertRole(role, company);
    if (data.permissionIds) await this.validatePermissions(tenantDb, data.permissionIds, company);
    const affected = await this.usersHoldingRole(tenantDb, id);
    const updated = await tenantDb.$transaction(async (tx: any) => {
      if (data.permissionIds) {
        await tx.rbacRolePermission.deleteMany({ where: { roleId: id } });
        if (data.permissionIds.length) {
          await tx.rbacRolePermission.createMany({
            data: data.permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
          });
        }
      }
      return tx.rbacRole.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description,
          isActive: data.isActive,
        },
        include: { rolePermissions: { include: { permission: true } } },
      });
    });
    await this.bumpSessionVersions(affected);
    return this.scopedRole(updated, company);
  }

  async deleteRole(tenantDb: any, id: string, company: CompanyModules) {
    const role = await tenantDb.rbacRole.findUnique({
      where: { id },
      include: { _count: { select: { userRoles: true } }, rolePermissions: { include: { permission: true } } },
    });
    if (!role || role.deletedAt) throw new NotFoundException('Role not found');
    this.assertRole(role, company);
    if (role.isSystem) throw new BadRequestException('System roles cannot be deleted');
    const affected = role._count.userRoles > 0 ? await this.usersHoldingRole(tenantDb, id) : [];
    await tenantDb.$transaction(async (tx: any) => {
      if (affected.length) await tx.rbacUserRole.deleteMany({ where: { roleId: id } });
      await tx.rbacRole.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    });
    if (affected.length) await this.bumpSessionVersions(affected);
    return { deleted: true };
  }

  async getUserAccess(tenantDb: any, userId: string, company: CompanyModules) {
    const user = await tenantDb.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        approvalLimit: true,
        rbacUserRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
        rbacUserPermissions: { include: { permission: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const allowed = companyPermissionKeys(company);
    return {
      ...user,
      rbacUserRoles: user.rbacUserRoles.filter((link: any) => !link.role.deletedAt && companyRoleAllowed(link.role, company))
        .map((link: any) => ({ ...link, role: this.scopedRole(link.role, company) })),
      rbacUserPermissions: user.rbacUserPermissions.filter((link: any) => allowed.has(link.permission?.key)),
    };
  }

  async setApprovalLimit(tenantDb: any, userId: string, approvalLimit: number, company: CompanyModules) {
    await this.getUserAccess(tenantDb, userId, company);
    await tenantDb.user.update({ where: { id: userId }, data: { approvalLimit: approvalLimit > 0 ? approvalLimit : null } });
    return this.getUserAccess(tenantDb, userId, company);
  }

  async assignUserRoles(tenantDb: any, userId: string, data: AssignUserRolesDto, company: CompanyModules) {
    await this.getUserAccess(tenantDb, userId, company);
    const roles = await tenantDb.rbacRole.findMany({
      where: { id: { in: data.roleIds }, deletedAt: null, isActive: true },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (roles.length !== data.roleIds.length) {
      throw new BadRequestException('One or more roles are invalid or inactive');
    }
    roles.forEach((role: any) => this.assertRole(role, company));
    await tenantDb.$transaction([
      tenantDb.rbacUserRole.deleteMany({ where: { userId } }),
      tenantDb.rbacUserRole.createMany({
        data: data.roleIds.map((roleId) => ({ userId, roleId })),
      }),
    ]);
    await this.bumpSessionVersions([userId]);
    return this.getUserAccess(tenantDb, userId, company);
  }

  async setDirectPermission(
    tenantDb: any,
    userId: string,
    data: SetDirectPermissionDto,
    company: CompanyModules,
  ) {
    await this.getUserAccess(tenantDb, userId, company);
    const permission = await tenantDb.rbacPermission.findUnique({
      where: { id: data.permissionId },
    });
    if (!permission) throw new NotFoundException('Permission not found');
    if (!companyPermissionKeys(company).has(permission.key)) throw new ForbiddenException('This permission is not available for your company’s enabled modules.');
    await tenantDb.$transaction(async (tx: any) => {
      // Legacy provisioned tenants lack the composite unique index required by
      // Prisma upsert. Serialize on the existing user row, including first grants.
      await tx.$queryRawUnsafe('SELECT id FROM users WHERE id = $1 FOR UPDATE', userId);
      const where = { userId, permissionId: data.permissionId };
      const updated = await tx.rbacUserPermission.updateMany({ where, data: { effect: data.effect, reason: data.reason } });
      if (!updated.count) await tx.rbacUserPermission.create({ data: { ...where, effect: data.effect, reason: data.reason } });
    });
    await this.bumpSessionVersions([userId]);
    return this.getUserAccess(tenantDb, userId, company);
  }

  async removeDirectPermission(tenantDb: any, userId: string, permissionId: string, company: CompanyModules) {
    await tenantDb.$transaction(async (tx: any) => {
      await tx.$queryRawUnsafe('SELECT id FROM users WHERE id = $1 FOR UPDATE', userId);
      await tx.rbacUserPermission.deleteMany({ where: { userId, permissionId } });
    });
    await this.bumpSessionVersions([userId]);
    return this.getUserAccess(tenantDb, userId, company);
  }

  private async validatePermissions(tenantDb: any, permissionIds: string[], company: CompanyModules) {
    const permissions = await tenantDb.rbacPermission.findMany({ where: { id: { in: permissionIds } } });
    if (permissions.length !== permissionIds.length) {
      throw new BadRequestException('One or more permission IDs are invalid');
    }
    const allowed = companyPermissionKeys(company);
    if (permissions.some((permission: any) => !allowed.has(permission.key))) throw new ForbiddenException('One or more permissions are not available for your company’s enabled modules.');
  }
}
