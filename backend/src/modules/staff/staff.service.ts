import { IdentitySyncService, identityChange } from '../../common/database/identity-sync.service';
import { AccountSecurityService } from '../../common/security/account-security.service';
import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { CentralPrismaService } from '../../common/database/central-prisma.service';
import * as argon2 from 'argon2';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import {
  CreateStaffDto,
  StaffAccountDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import { SubscriptionEntitlementService } from '../../common/subscriptions/subscription-entitlement.service';
import { assertStrongPassword } from '../../common/security/password-policy';

@Injectable()
export class StaffService {
  constructor(
    private readonly centralPrisma: CentralPrismaService,
    private readonly entitlements: SubscriptionEntitlementService,
    private readonly identities: IdentitySyncService,
    private readonly security: AccountSecurityService,
  ) {}

  private get central(): any {
    return this.centralPrisma as any;
  }

  async listUserAccounts(tenantDb: any) {
    if (!tenantDb) return [];
    return tenantDb.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: [{ name: 'asc' }],
    });
  }

  async getStaff(tenantDb: any, query: PaginationQueryDto & { department?: string; status?: string }) {
    if (!tenantDb) return [];
    const where: any = { deletedAt: null };
    if (query?.department) where.department = query.department;
    if (query?.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.status) where.status = query.status;
    const page = query.page || 1;
    const limit = query.limit || 25;
    const [data, total] = await Promise.all([
      tenantDb.staff.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, email: true, role: true, isActive: true } }, assignedProject: true, workerType: true },
        orderBy: { createdAt: 'desc' },
      }),
      tenantDb.staff.count({ where }),
    ]);
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  getStaffOptions(tenantDb: any, department?: string) {
    return tenantDb.staff.findMany({
      where: { deletedAt: null, status: 'ACTIVE', ...(department ? { department } : {}) },
      select: { id: true, firstName: true, lastName: true, position: true, department: true, salary: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
  }

  async getStaffById(tenantDb: any, id: string) {
    const staff = await tenantDb.staff.findFirst({
      where: { id, deletedAt: null },
      include: { user: { select: { id: true, name: true, email: true, role: true, isActive: true } }, assignedProject: true, workerType: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    return staff;
  }

  async createStaff(tenantDb: any, companyId: string, data: CreateStaffDto) {
    if (!tenantDb) throw new BadRequestException('Tenant DB not available');
    const create = (centralDb: any) => tenantDb.$transaction(async (tx: any) => {
      const staff = await tx.staff.create({
        data: {
          firstName: data.firstName.trim(),
          lastName: data.lastName.trim(),
          phone: data.phone,
          position: data.position,
          department: (data.department as any) || 'GENERAL',
          salary: data.salary || 0,
          hireDate: data.hireDate,
          status: (data.status as any) || 'ACTIVE',
          notes: data.notes,
          photoUrl: data.photoUrl,
          workerTypeId: data.workerTypeId,
          assignedProjectId: data.assignedProjectId,
        },
      });

      // 2. Optional User Account creation
      if (data.createAccount) {
        if (!data.email || !data.temporaryPassword) {
          throw new BadRequestException('Email and temporary password are required');
        }
        assertStrongPassword(data.temporaryPassword);
        const existingCentral = await centralDb.companyUser.findUnique({
          where: { email: data.email },
        });

        if (existingCentral) {
          throw new ConflictException(`User account with email '${data.email}' already exists.`);
        }

        const defaultHash = await argon2.hash(data.temporaryPassword);

        // Create Tenant DB User
        const tenantUser = await tx.user.create({
          data: {
            email: data.email,
            name: `${data.firstName} ${data.lastName}`,
            passwordHash: defaultHash,
            role: (data.role || 'STAFF') as any,
          },
        });

        // Link User to Staff
        await tx.staff.update({
          where: { id: staff.id },
          data: { userId: tenantUser.id },
        });

        // Create Central CompanyUser record
        await centralDb.companyUser.create({
          data: {
            id: tenantUser.id,
            email: data.email,
            passwordHash: defaultHash,
            companyId,
            role: data.role || 'STAFF',
          },
        });
      }

      return staff;
    });
    return data.createAccount
      ? this.entitlements.withUserQuota(companyId, create)
      : create(this.central);
  }

  async updateStaff(tenantDb: any, id: string, data: UpdateStaffDto) {
    await this.getStaffById(tenantDb, id);
    return tenantDb.staff.update({ where: { id }, data: data as any });
  }

  async deleteStaff(tenantDb: any, id: string, currentUserId?: string) {
    const staff = await this.getStaffById(tenantDb, id);
    if (currentUserId && staff.userId === currentUserId) {
      throw new BadRequestException('You cannot delete your own staff record.');
    }
    const now = new Date();
    if (staff.userId) {
      // Revoke central authorization FIRST so the user can never remain
      // authenticated without tenant membership if a later write fails.
      try {
        await this.central.companyUser.update({
          where: { id: staff.userId },
          data: { isActive: false, deletedAt: now, sessionVersion: { increment: 1 } },
        });
      } catch (error) {
        throw new ConflictException('Failed to revoke the staff account; deletion was rolled back');
      }
    }
    try {
      // Soft-delete instead of hard-delete so WorkforceContractPayment (and all
      // other payroll/history records) keyed to this staff row are preserved.
      await tenantDb.$transaction(async (tx: any) => {
        await tx.staff.update({
          where: { id },
          data: { status: 'INACTIVE', deletedAt: now },
        });
        if (staff.userId) {
          await tx.user.update({
            where: { id: staff.userId },
            data: { isActive: false, deletedAt: now },
          });
        }
      });
    } catch (error) {
      // Compensation: the tenant write failed, so restore the central account to
      // keep central authorization and tenant membership in sync.
      if (staff.userId) {
        await this.central.companyUser
          .update({ where: { id: staff.userId }, data: { isActive: true, deletedAt: null } })
          .catch(() => undefined);
      }
      throw error;
    }
    return { deleted: true };
  }

  async createAccount(tenantDb: any, companyId: string, staffId: string, data: StaffAccountDto) {
    assertStrongPassword(data.temporaryPassword);
    const staff = await this.getStaffById(tenantDb, staffId);
    if (staff.userId) throw new ConflictException('Staff member already has a user account');
    const email = data.email.toLowerCase();
    const passwordHash = await argon2.hash(data.temporaryPassword);
    return this.entitlements.withUserQuota(companyId, async (centralTx) => {
      if (await centralTx.companyUser.findUnique({ where: { email } })) {
        throw new ConflictException('Email is already in use');
      }
      // Tenant membership is created first; the central record references the same
      // id so central authorization is never granted to a user lacking tenant
      // membership. If the central write fails, the tenant user is removed.
      const user = await tenantDb.user.create({
        data: { email, name: `${staff.firstName} ${staff.lastName}`, passwordHash, role: data.role as any },
      });
      try {
        await centralTx.companyUser.create({
          data: { id: user.id, email, passwordHash, companyId, role: data.role },
        });
        await tenantDb.staff.update({ where: { id: staffId }, data: { userId: user.id } });
      } catch (error) {
        await tenantDb.user.delete({ where: { id: user.id } }).catch(() => undefined);
        throw error;
      }
      return this.getStaffById(tenantDb, staffId);
    });
  }

  async setAccountStatus(tenantDb: any, companyId: string, staffId: string, isActive: boolean) {
    const staff = await this.getStaffById(tenantDb, staffId);
    if (!staff.userId) throw new BadRequestException('Staff member has no user account');
    const current = await this.central.companyUser.findUnique({ where: { id: staff.userId } });
    if (current?.isActive === isActive) return { isActive, ...await this.syncAccount(staff.userId) };
    const save = (tx: any) => tx.companyUser.update({
      where: { id: staff.userId }, data: { isActive, ...identityChange() },
    });
    if (isActive) await this.entitlements.withUserQuota(companyId, save);
    else await save(this.central);
    return { isActive, ...await this.syncAccount(staff.userId) };
  }

  async updateAccountEmail(tenantDb: any, staffId: string, email: string) {
    const staff = await this.getStaffById(tenantDb, staffId);
    if (!staff.userId) throw new BadRequestException('Staff member has no user account');
    const normalized = email.trim().toLowerCase();
    const account = await this.central.companyUser.findUnique({ where: { id: staff.userId }, include: { company: true } });
    if (account.email === normalized) return { email: normalized, ...await this.syncAccount(staff.userId) };
    await this.central.$transaction(async (tx: any) => {
      await this.security.assertAvailable(tx, normalized, 'user', staff.userId);
      await tx.companyUser.update({ where: { id: staff.userId }, data: { email: normalized, ...identityChange() } });
      if (account.role === 'COMPANY_OWNER') await tx.company.update({ where: { id: account.companyId }, data: { adminEmail: normalized } });
    });
    await this.security.notifyChange(account, 'email', true, normalized);
    return { email: normalized, ...await this.syncAccount(staff.userId) };
  }

  async resetPassword(tenantDb: any, staffId: string, temporaryPassword: string) {
    assertStrongPassword(temporaryPassword);
    const staff = await this.getStaffById(tenantDb, staffId);
    if (!staff.userId) throw new BadRequestException('Staff member has no user account');
    const account = await this.central.companyUser.findUnique({ where: { id: staff.userId }, include: { company: true } });
    const passwordHash = await argon2.hash(temporaryPassword);
    await this.central.companyUser.update({ where: { id: staff.userId }, data: {
      passwordHash, passwordResetAt: new Date(), resetTokenHash: null,
      resetTokenExpiresAt: null, resetRequestedAt: null, ...identityChange(),
    } });
    const result = { reset: true, ...await this.syncAccount(staff.userId) };
    await this.security.notifyChange(account, 'password', true);
    return result;
  }

  async updateAccountRole(tenantDb: any, staffId: string, role: string) {
    const staff = await this.getStaffById(tenantDb, staffId);
    if (!staff.userId) throw new BadRequestException('Staff member has no user account');
    await this.central.companyUser.update({ where: { id: staff.userId }, data: { role, ...identityChange() } });
    return { role, ...await this.syncAccount(staff.userId) };
  }

  private async syncAccount(userId: string) {
    const syncPending = await this.identities.sync(userId);
    return { syncPending, message: syncPending
      ? 'Account change saved. Access is paused while the workspace synchronizes; retry happens automatically.'
      : 'Account updated successfully.' };
  }

  async getStaffActivity(tenantDb: any, staffId: string) {
    const staff = await this.getStaffById(tenantDb, staffId);
    if (!staff.userId) return [];
    return tenantDb.activityLog.findMany({
      where: { userId: staff.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
