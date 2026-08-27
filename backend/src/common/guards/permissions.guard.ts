import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { CentralPrismaService } from '../database/central-prisma.service';
import { ROLE_PERMISSIONS } from '../database/registry';
import type { AppRole } from '../database/roles';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly permissionCache = new Map<string, { expiresAt: number; permissions: string[] }>();
  private readonly principalCache = new Map<string, { expiresAt: number; role: string; active: boolean }>();

  constructor(private reflector: Reflector, private readonly centralPrisma: CentralPrismaService) {}

  private async currentPrincipal(userId: string) {
    const cached = this.principalCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached;
    const principal = await (this.centralPrisma as any).companyUser.findUnique({
      where: { id: userId },
      select: { role: true, isActive: true, deletedAt: true },
    });
    const current = {
      role: principal?.role || '',
      active: Boolean(principal?.isActive && !principal?.deletedAt),
      expiresAt: Date.now() + 2_000,
    };
    this.principalCache.set(userId, current);
    return current;
  }

  private async currentPermissions(tenantDb: any, user: any, companyId: string): Promise<string[]> {
    const key = `${companyId}:${user.id}`;
    const cached = this.permissionCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.permissions;
    const tenantUser = await tenantDb?.user?.findFirst({
      where: { id: user.id, email: user.email, isActive: true, deletedAt: null },
      include: {
        rbacUserRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
        rbacUserPermissions: { include: { permission: true } },
      },
    });
    if (!tenantUser) {
      // Fail closed: without an active tenant user, no tenant permissions are granted.
      // A central role template must never authorize a user who no longer has an
      // active tenant membership (owner/superadmin are handled before this call).
      const denied: string[] = [];
      this.permissionCache.set(key, { permissions: denied, expiresAt: Date.now() + 2_000 });
      return denied;
    }
    const permissions = new Set<string>();
    const rbacRoles = tenantUser.rbacUserRoles || [];
    for (const assignment of rbacRoles) {
      for (const rolePermission of assignment.role?.rolePermissions || []) {
        if (rolePermission.permission?.key) permissions.add(rolePermission.permission.key);
      }
    }
    const directPerms = tenantUser.rbacUserPermissions || [];
    for (const direct of directPerms) {
      if (!direct.permission?.key) continue;
      if (direct.effect === 'DENY') permissions.delete(direct.permission.key);
      else permissions.add(direct.permission.key);
    }
    if (rbacRoles.length === 0 && directPerms.length === 0) {
      const roleTemplate = ROLE_PERMISSIONS[user.role as AppRole];
      if (roleTemplate) roleTemplate.forEach((p: string) => permissions.add(p));
    }
    const resolved = Array.from(permissions);
    this.permissionCache.set(key, { permissions: resolved, expiresAt: Date.now() + 2_000 });
    return resolved;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const anyOfPermissions = this.reflector.getAllAndOverride<string[]>(
      ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions && !anyOfPermissions && !requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) {
      return false;
    }

    // Platform authority comes from the verified central-admin principal, never
    // a tenant role name or the tenant-owner/impersonation permission bypass.
    if (requiredRoles?.includes('SUPER_ADMIN')) {
      if (user.isSuperAdmin === true && !user.isImpersonating) return true;
      throw new ForbiddenException('Platform administrator access is required');
    }
    if (user.isSuperAdmin === true || user.isImpersonating) {
      return true;
    }

    const principal = await this.currentPrincipal(user.id);
    if (!principal.active) {
      throw new ForbiddenException('User account is inactive');
    }
    user.role = principal.role;
    if (user.role === 'COMPANY_OWNER') return true;
    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.includes(user.role);
      if (!hasRole) {
        throw new ForbiddenException(`Requires one of roles: ${requiredRoles.join(', ')}`);
      }
    }

    // Load once if either check needs it.
    let userPermissions: string[] | null = null;
    const loadPermissions = async () => {
      if (userPermissions) return userPermissions;
      userPermissions = await this.currentPermissions(
        request.tenantDb,
        user,
        request.tenantContext?.companyId || user.companyId,
      );
      user.permissions = userPermissions;
      return userPermissions;
    };

    if (requiredPermissions && requiredPermissions.length > 0) {
      const perms = await loadPermissions();
      const hasAllPermissions = requiredPermissions.every((p) => perms.includes(p));
      if (!hasAllPermissions) {
        throw new ForbiddenException(`Missing required permissions: ${requiredPermissions.join(', ')}`);
      }
    }

    if (anyOfPermissions && anyOfPermissions.length > 0) {
      const perms = await loadPermissions();
      const hasAny = anyOfPermissions.some((p) => perms.includes(p));
      if (!hasAny) {
        throw new ForbiddenException(`Missing one of required permissions: ${anyOfPermissions.join(', ')}`);
      }
    }

    return true;
  }
}
