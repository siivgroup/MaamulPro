import { IdentitySyncService, identityChange } from '../../common/database/identity-sync.service';
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as bcrypt from 'bcryptjs';
import { createHash, randomInt } from 'crypto';
import { CentralPrismaService } from '../../common/database/central-prisma.service';
import { TenantConnectionManager } from '../../common/database/tenant-connection.manager';
import { revealDatabaseUrl } from '../../common/database/database-credentials';
import { ResendEmailService } from '../../common/email/resend-email.service';
import { SubscriptionEntitlementService } from '../../common/subscriptions/subscription-entitlement.service';
import { hasSubscriptionAccess } from '../../common/subscriptions/entitlement-policy';
import { ENTERPRISE_CONFIG_KEY, parseEnterpriseModuleConfiguration } from '../../common/database/enterprise-config';
import { assertStrongPassword } from '../../common/security/password-policy';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS } from '../../common/database/registry';
import type { AppRole } from '../../common/database/roles';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly centralPrisma: CentralPrismaService,
    private readonly tenantManager: TenantConnectionManager,
    private readonly jwtService: JwtService,
    private readonly email: ResendEmailService,
    private readonly entitlements: SubscriptionEntitlementService,
    private readonly identities: IdentitySyncService,
  ) {}

  private get central(): any {
    return this.centralPrisma as any;
  }

  private async enterpriseConfiguration(company: any) {
    try {
      const tenantDb = this.tenantManager.getTenantDb(revealDatabaseUrl(company.dbUrl));
      const record = await tenantDb.systemConfig.findUnique({ where: { key: ENTERPRISE_CONFIG_KEY } });
      return parseEnterpriseModuleConfiguration(record?.value);
    } catch (err) {
      this.logger.warn(`Enterprise config lookup failed for company "${company.name}" (${company.id}): ${err instanceof Error ? err.message : String(err)}`);
      return parseEnterpriseModuleConfiguration(null);
    }
  }

  async loginCompanyUser(email: string, passwordAttempt: string, tenantId?: string, requestSubdomain?: string | null) {
    // 1. Locate CompanyUser in Central DB
    const companyUser = await this.central.companyUser.findFirst({
      where: { email },
      include: { company: true },
    });

    if (!companyUser) {
      throw new UnauthorizedException('Invalid email or password credentials');
    }

    if (!companyUser.isActive) {
      throw new UnauthorizedException('User account has been deactivated');
    }

    const company = companyUser.company;

    // A valid account signing in from a different tenant's subdomain is still a wrong sign-in attempt.
    if (requestSubdomain && company.subdomain !== requestSubdomain) {
      throw new UnauthorizedException('Invalid email or password credentials');
    }

    // 2. Password Verification
    let isPasswordValid = false;
    if (companyUser.passwordHash.startsWith('$argon2')) {
      isPasswordValid = await argon2.verify(companyUser.passwordHash, passwordAttempt);
    } else {
      isPasswordValid = await bcrypt.compare(passwordAttempt, companyUser.passwordHash);
    }

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password credentials');
    }

    if (companyUser.identitySyncPending) {
      throw new ServiceUnavailableException('Your account update is saved and still synchronizing. Please try signing in again shortly.');
    }

    // 3. Resolve permissions from Tenant DB
    let userPermissions: string[] = [];
    if (company.dbUrl) {
      try {
        const tenantDb = this.tenantManager.getTenantDb(revealDatabaseUrl(company.dbUrl));
        const tenantUser = await tenantDb.user.findUnique({
          where: { email },
          include: {
            rbacUserRoles: {
              include: {
                role: {
                  include: {
                    rolePermissions: {
                      include: { permission: true },
                    },
                  },
                },
              },
            },
            rbacUserPermissions: {
              include: { permission: true },
            },
          },
        });

        if (tenantUser) {
          const permSet = new Set<string>();
          const rbacRoles = (tenantUser as any).rbacUserRoles || [];
          for (const ur of rbacRoles) {
            for (const rp of ur.role.rolePermissions || []) {
              if (rp?.permission?.key) permSet.add(rp.permission.key);
            }
          }
          const directPermissions = (tenantUser as any).rbacUserPermissions || [];
          for (const up of directPermissions.filter((item: any) => item.effect === 'ALLOW')) {
            if (up.permission?.key) permSet.add(up.permission.key);
          }
          for (const up of directPermissions.filter((item: any) => item.effect === 'DENY')) {
            if (up.permission?.key) permSet.delete(up.permission.key);
          }
          if (rbacRoles.length === 0 && directPermissions.length === 0) {
            const roleTemplate = ROLE_PERMISSIONS[companyUser.role as AppRole];
            if (roleTemplate) roleTemplate.forEach((p: string) => permSet.add(p));
          }
          userPermissions = Array.from(permSet);
        } else {
          const roleTemplate = ROLE_PERMISSIONS[companyUser.role as AppRole];
          if (roleTemplate) userPermissions = [...roleTemplate];
        }
      } catch (err) {
        this.logger.warn(`Tenant permissions resolution failed for company "${company.name}" (${company.id}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (userPermissions.length === 0) {
      const roleTemplate = ROLE_PERMISSIONS[companyUser.role as AppRole];
      if (roleTemplate) userPermissions = [...roleTemplate];
    }

    // 4. Update last login
    await this.central.companyUser.update({
      where: { id: companyUser.id },
      data: { lastLoginAt: new Date() },
    });

    // 5. Generate JWT Token
    const companyEntitlements = this.entitlements.fromCompany(company);
    const accessGranted = hasSubscriptionAccess(company);
    const enterpriseConfiguration = await this.enterpriseConfiguration(company);
    const payload = {
      sub: companyUser.id,
      email: companyUser.email,
      role: companyUser.role,
      companyId: company.id,
      subdomain: company.subdomain,
      companyName: company.name,
      permissions: userPermissions,
      constructionEnabled: company.constructionEnabled,
      realEstateEnabled: company.realEstateEnabled,
      materialManagementEnabled: company.materialManagementEnabled,
      subscriptionStatus: company.subscriptionStatus,
      subscriptionExpiresAt: company.subscriptionExpiresAt,
      accessGranted,
      planKey: company.planKey,
      entitlements: companyEntitlements,
      enterpriseConfiguration,
      isSuperAdmin: false,
      sessionVersion: Number(companyUser.sessionVersion || 0),
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: companyUser.id,
        email: companyUser.email,
        role: companyUser.role,
        companyId: company.id,
        companyName: company.name,
        subdomain: company.subdomain,
        permissions: userPermissions,
        constructionEnabled: company.constructionEnabled,
        realEstateEnabled: company.realEstateEnabled,
        materialManagementEnabled: company.materialManagementEnabled,
        subscriptionStatus: company.subscriptionStatus,
        subscriptionExpiresAt: company.subscriptionExpiresAt,
        companyStatus: company.status,
        accessGranted,
        planKey: company.planKey,
        entitlements: companyEntitlements,
        enterpriseConfiguration,
      },
    };
  }

  async loginSuperAdmin(email: string, passwordAttempt: string) {
    const admin = await this.centralPrisma.centralAdmin.findFirst({
      where: { email },
    });

    if (!admin) {
      throw new UnauthorizedException('Invalid Super Admin credentials');
    }

    let isValid = false;
    if (admin.passwordHash.startsWith('$argon2')) {
      isValid = await argon2.verify(admin.passwordHash, passwordAttempt);
    } else {
      isValid = await bcrypt.compare(passwordAttempt, admin.passwordHash);
    }

    if (!isValid) {
      throw new UnauthorizedException('Invalid Super Admin credentials');
    }

    await this.central.centralAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const payload = {
      sub: admin.id,
      email: admin.email,
      name: admin.name,
      role: 'SUPER_ADMIN',
      isSuperAdmin: true,
      sessionVersion: Number(admin.sessionVersion || 0),
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: 'SUPER_ADMIN',
        isSuperAdmin: true,
      },
    };
  }

  async exchangeImpersonation(token: string) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
      throw new UnauthorizedException('The impersonation grant is invalid or expired');
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const grant = await this.central.impersonationGrant.findUnique({ where: { tokenHash } });
    const now = new Date();
    if (!grant || grant.usedAt || grant.expiresAt <= now) {
      throw new UnauthorizedException('The impersonation grant is invalid or expired');
    }
    const [companyUser, admin] = await Promise.all([
      this.central.companyUser.findUnique({ where: { id: grant.userId }, include: { company: true } }),
      this.central.centralAdmin.findUnique({ where: { id: grant.adminId }, select: { id: true } }),
    ]);
    if (
      !admin
      || !companyUser
      || !companyUser.isActive
      || companyUser.deletedAt
      || companyUser.companyId !== grant.companyId
    ) {
      throw new UnauthorizedException('The impersonation grant is invalid or expired');
    }
    const claim = await this.central.impersonationGrant.updateMany({
      where: { id: grant.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (!claim.count) throw new UnauthorizedException('The impersonation grant is invalid or expired');

    const company = companyUser.company;
    const permissions = [...ALL_PERMISSIONS];
    const entitlements = this.entitlements.fromCompany(company);
    const accessGranted = hasSubscriptionAccess(company);
    const enterpriseConfiguration = await this.enterpriseConfiguration(company);
    const payload = {
      sub: companyUser.id,
      email: companyUser.email,
      role: 'COMPANY_OWNER',
      companyId: company.id,
      subdomain: company.subdomain,
      companyName: company.name,
      permissions,
      constructionEnabled: company.constructionEnabled,
      realEstateEnabled: company.realEstateEnabled,
      materialManagementEnabled: company.materialManagementEnabled,
      subscriptionStatus: company.subscriptionStatus,
      subscriptionExpiresAt: company.subscriptionExpiresAt,
      accessGranted,
      planKey: company.planKey,
      entitlements,
      enterpriseConfiguration,
      isSuperAdmin: false,
      isImpersonating: true,
      impersonatedBy: grant.adminId,
      sessionVersion: Number(companyUser.sessionVersion || 0),
    };
    return {
      accessToken: this.jwtService.sign(payload, { expiresIn: 10 * 60 }),
      user: {
        id: companyUser.id,
        email: companyUser.email,
        role: 'COMPANY_OWNER',
        companyId: company.id,
        companyName: company.name,
        subdomain: company.subdomain,
        permissions,
        constructionEnabled: company.constructionEnabled,
        realEstateEnabled: company.realEstateEnabled,
        materialManagementEnabled: company.materialManagementEnabled,
        subscriptionStatus: company.subscriptionStatus,
        subscriptionExpiresAt: company.subscriptionExpiresAt,
        companyStatus: company.status,
        accessGranted,
        planKey: company.planKey,
        entitlements,
        enterpriseConfiguration,
        isSuperAdmin: false,
        isImpersonating: true,
        impersonatedBy: grant.adminId,
      },
    };
  }

  async currentSession(user: any) {
    if (user?.isSuperAdmin) {
      const admin = await this.central.centralAdmin.findUnique({
        where: { id: user.id },
        select: { id: true, email: true, name: true },
      });
      if (!admin) throw new UnauthorizedException('Administrator account no longer exists');
      return { ...admin, role: 'SUPER_ADMIN', isSuperAdmin: true };
    }
    const companyUser = await this.central.companyUser.findUnique({
      where: { id: user?.id },
      include: { company: true },
    });
    if (!companyUser || !companyUser.isActive || companyUser.deletedAt) {
      throw new UnauthorizedException('User account is inactive');
    }
    const company = companyUser.company;
    const enterpriseConfiguration = await this.enterpriseConfiguration(company);

    let userPermissions: string[] = [];
    if (company.dbUrl) {
      try {
        const tenantDb = this.tenantManager.getTenantDb(revealDatabaseUrl(company.dbUrl));
        const tenantUser = await tenantDb.user.findFirst({
          where: { email: companyUser.email, isActive: true, deletedAt: null },
          include: {
            rbacUserRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
            rbacUserPermissions: { include: { permission: true } },
          },
        });
        if (tenantUser) {
          const permSet = new Set<string>();
          const rbacRoles = (tenantUser as any).rbacUserRoles || [];
          for (const ur of rbacRoles) {
            for (const rp of ur.role.rolePermissions || []) {
              if (rp?.permission?.key) permSet.add(rp.permission.key);
            }
          }
          const directPermissions = (tenantUser as any).rbacUserPermissions || [];
          for (const up of directPermissions.filter((item: any) => item.effect === 'ALLOW')) {
            if (up.permission?.key) permSet.add(up.permission.key);
          }
          for (const up of directPermissions.filter((item: any) => item.effect === 'DENY')) {
            if (up.permission?.key) permSet.delete(up.permission.key);
          }
          if (rbacRoles.length === 0 && directPermissions.length === 0) {
            const roleTemplate = ROLE_PERMISSIONS[companyUser.role as AppRole];
            if (roleTemplate) roleTemplate.forEach((p: string) => permSet.add(p));
          }
          userPermissions = Array.from(permSet);
        } else {
          const roleTemplate = ROLE_PERMISSIONS[companyUser.role as AppRole];
          if (roleTemplate) userPermissions = [...roleTemplate];
        }
      } catch (err) {
        this.logger.warn(`Session permissions resolution failed: ${err instanceof Error ? err.message : String(err)}`);
        const roleTemplate = ROLE_PERMISSIONS[companyUser.role as AppRole];
        userPermissions = roleTemplate ? [...roleTemplate] : (user.permissions || []);
      }
    }

    if (userPermissions.length === 0) {
      const roleTemplate = ROLE_PERMISSIONS[companyUser.role as AppRole];
      if (roleTemplate) userPermissions = [...roleTemplate];
    }

    return {
      id: companyUser.id,
      email: companyUser.email,
      role: user?.isImpersonating ? 'COMPANY_OWNER' : companyUser.role,
      companyId: company.id,
      companyName: company.name,
      subdomain: company.subdomain,
      permissions: user?.isImpersonating ? [...ALL_PERMISSIONS] : userPermissions,
      constructionEnabled: company.constructionEnabled,
      realEstateEnabled: company.realEstateEnabled,
      materialManagementEnabled: company.materialManagementEnabled,
      subscriptionStatus: company.subscriptionStatus,
      subscriptionExpiresAt: company.subscriptionExpiresAt,
      companyStatus: company.status,
      accessGranted: hasSubscriptionAccess(company),
      planKey: company.planKey,
      entitlements: this.entitlements.fromCompany(company),
      enterpriseConfiguration,
      isSuperAdmin: false,
      isImpersonating: Boolean(user?.isImpersonating),
      impersonatedBy: user?.impersonatedBy,
    };
  }

  async logout(user: any) {
    if (user?.isImpersonating) {
      return { loggedOut: true };
    }
    if (user?.isSuperAdmin) {
      await this.central.centralAdmin.update({
        where: { id: user.id },
        data: { sessionVersion: { increment: 1 } },
      });
    } else {
      await this.central.companyUser.update({
        where: { id: user?.id },
        data: { sessionVersion: { increment: 1 } },
      });
    }
    return { loggedOut: true };
  }

  async requestPasswordReset(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.central.companyUser.findFirst({
      where: { email: normalizedEmail, isActive: true },
      include: { company: true },
    });
    const admin = user ? null : await this.central.centralAdmin.findFirst({
      where: { email: normalizedEmail },
    });
    // Do not disclose whether an address exists.
    if (!user && !admin) return { accepted: true };

    const code = String(randomInt(100000, 1000000));
    const hashedCode = await argon2.hash(code);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await this.central.emailVerification.upsert({
      where: {
        email_context: {
          email: normalizedEmail,
          context: 'PASSWORD_RESET',
        },
      },
      create: {
        email: normalizedEmail,
        context: 'PASSWORD_RESET',
        hashedCode,
        expiresAt,
      },
      update: {
        hashedCode,
        expiresAt,
        status: 'PENDING',
        attempts: 0,
        verifiedAt: null,
      },
    });

    const delivery = await this.email.send({
      to: [normalizedEmail],
      subject: 'MaamulPro password reset code',
      text: `Your MaamulPro password reset code is ${code}. It expires in 15 minutes.`,
    });
    if (!delivery.sent) {
      await this.central.emailVerification.updateMany({
        where: { email: normalizedEmail, context: 'PASSWORD_RESET', status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      throw new ServiceUnavailableException(
        'Password reset email could not be delivered. Please try again later.',
      );
    }

    return { accepted: true, expiresAt };
  }

  async resetPassword(email: string, code: string, newPassword: string) {
    assertStrongPassword(newPassword);
    const normalizedEmail = email.trim().toLowerCase();
    const verification = await this.central.emailVerification.findFirst({
      where: { email: normalizedEmail, context: 'PASSWORD_RESET', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!verification || verification.expiresAt < new Date()) {
      throw new BadRequestException('Reset code is invalid or expired');
    }
    if (verification.attempts >= 5) {
      await this.central.emailVerification.update({ where: { id: verification.id }, data: { status: 'FAILED' } });
      throw new BadRequestException('Reset code is invalid or expired');
    }
    const valid = await argon2.verify(verification.hashedCode, code);
    if (!valid) {
      await this.central.emailVerification.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Reset code is invalid or expired');
    }

    const user = await this.central.companyUser.findFirst({
      where: { email: normalizedEmail },
      include: { company: true },
    });
    const admin = user ? null : await this.central.centralAdmin.findFirst({ where: { email: normalizedEmail } });
    if (!user && !admin) throw new NotFoundException('Account not found');
    const setup = user && await this.central.companyOnboarding.findUnique({ where: { companyId: user.companyId } });
    if (setup && setup.status !== 'SUCCEEDED') throw new BadRequestException('Finish company setup before resetting its owner password.');
    const passwordHash = await argon2.hash(newPassword);
    await this.central.$transaction(async (tx: any) => {
      const consumed = await tx.emailVerification.updateMany({
        where: { id: verification.id, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'VERIFIED', verifiedAt: new Date() },
      });
      if (!consumed.count) throw new BadRequestException('Reset code has already been used or expired');
      if (user) {
        await tx.companyUser.update({ where: { id: user.id }, data: {
          passwordHash, passwordResetAt: new Date(), resetTokenHash: null,
          resetTokenExpiresAt: null, resetRequestedAt: null, ...identityChange(),
        } });
      } else {
        await tx.centralAdmin.update({ where: { id: admin.id }, data: {
          passwordHash, passwordResetAt: new Date(), sessionVersion: { increment: 1 },
        } });
      }
    });
    const syncPending = user ? await this.identities.sync(user.id) : false;
    return { reset: true, syncPending, message: syncPending
      ? 'Password saved. Access is paused while the workspace synchronizes; please sign in again shortly.'
      : 'Password reset successfully.' };

  }
}
