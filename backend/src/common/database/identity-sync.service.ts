import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CentralPrismaService } from './central-prisma.service';
import { TenantConnectionManager } from './tenant-connection.manager';
import { revealDatabaseUrl } from './database-credentials';

// Central credentials are authoritative. Save the new identity and this marker
// in the SAME transaction; a failed tenant write must never undo revocation.
export const identityChange = () => ({
  sessionVersion: { increment: 1 }, identitySyncPending: true, identitySyncAfter: new Date(),
});

@Injectable()
export class IdentitySyncService implements OnModuleInit {
  private readonly logger = new Logger(IdentitySyncService.name);
  private running = false;
  constructor(private readonly central: CentralPrismaService, private readonly tenants: TenantConnectionManager) {}

  onModuleInit() { void this.processPending(); }

  @Interval(5000)
  async processPending() {
    if (this.running) return;
    this.running = true;
    try {
      const users = await (this.central as any).companyUser.findMany({
        where: { identitySyncPending: true, identitySyncAfter: { lte: new Date() } },
        select: { id: true }, orderBy: { identitySyncAfter: 'asc' }, take: 20,
      });
      for (const user of users) await this.sync(user.id);
    } catch {
      this.logger.warn('Unable to inspect pending identity updates; retrying on the next scheduled run');
    } finally { this.running = false; }
  }

  /** Returns true when synchronization is still pending, without losing the saved change. */
  async sync(userId: string): Promise<boolean> {
    try {
      return await (this.central as any).$transaction(async (tx: any) => {
        const claimed = await tx.$queryRawUnsafe('SELECT id FROM company_users WHERE id = $1 FOR UPDATE SKIP LOCKED', userId);
        if (!claimed.length) return true;
        const user = await tx.companyUser.findUnique({ where: { id: userId }, include: { company: true } });
        if (!user?.identitySyncPending) return false;
        const tenant = this.tenants.getTenantDb(revealDatabaseUrl(user.company.dbUrl));
        // Fencing also protects against a delayed tenant commit after the central
        // lock connection was lost and another process applied a newer identity.
        const changed = await tenant.user.updateMany({
          where: { id: user.id, identityVersion: { lte: user.sessionVersion } },
          data: {
            ...(user.role === 'COMPANY_OWNER' ? { name: user.company.adminName } : {}),
            email: user.email, passwordHash: user.passwordHash, role: user.role,
            isActive: user.isActive, deletedAt: user.deletedAt, passwordResetAt: user.passwordResetAt,
            identityVersion: user.sessionVersion,
          },
        });
        if (!changed.count) {
          // A missing user or an unexpectedly newer tenant version requires
          // repair. Never grant access while central and tenant identities differ.
          throw new Error('Tenant identity is missing or its version conflicts');
        }
        await tx.companyUser.update({ where: { id: user.id }, data: { identitySyncPending: false, identitySyncAfter: null } });
        return false;
      }, { timeout: 15000 });
    } catch {
      // No raw driver errors: they may contain credentials or submitted values.
      this.logger.warn(`Identity synchronization pending for user ${userId}; central authorization is protected`);
      await (this.central as any).companyUser.updateMany({
        where: { id: userId, identitySyncPending: true },
        data: { identitySyncAfter: new Date(Date.now() + 30000) },
      }).catch(() => undefined);
      return true;
    }
  }
}
