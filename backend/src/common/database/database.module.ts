import { Global, Module } from '@nestjs/common';
import { IdentitySyncService } from './identity-sync.service';
import { CentralPrismaService } from './central-prisma.service';
import { NeonManagementService } from './neon-management.service';
import { TenantConnectionManager } from './tenant-connection.manager';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { SubscriptionEntitlementService } from '../subscriptions/subscription-entitlement.service';
import { SubscriptionLifecycleService } from '../subscriptions/subscription-lifecycle.service';

@Global()
@Module({
  providers: [
    IdentitySyncService,
    CentralPrismaService,
    TenantConnectionManager,
    TenantProvisioningService,
    NeonManagementService,
    SubscriptionEntitlementService,
    SubscriptionLifecycleService,
  ],
  exports: [
    IdentitySyncService,
    CentralPrismaService,
    TenantConnectionManager,
    TenantProvisioningService,
    NeonManagementService,
    SubscriptionEntitlementService,
    SubscriptionLifecycleService,
  ],
})
export class DatabaseModule {}
