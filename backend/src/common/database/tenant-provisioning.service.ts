import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { applyCompanySchema } from './tenant-schema-sql';
import { syncPermissionsToDb } from './rbac-sync';
import { TenantConnectionManager } from './tenant-connection.manager';
import { DatabaseConnectionPair, getDatabaseConnectionPair } from './database-url';
import { setupDiagnostic, setupFailure } from './onboarding-errors';

@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly tenantManager: TenantConnectionManager) {}

  async provision(databaseUrl: string): Promise<DatabaseConnectionPair> {
    let connections: DatabaseConnectionPair;
    try {
      connections = getDatabaseConnectionPair(databaseUrl);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Tenant database URL is invalid');
    }
    const existing = this.inFlight.get(connections.directUrl);
    if (existing) {
      await existing;
      return connections;
    }

    const operation = this.run(connections).finally(() => this.inFlight.delete(connections.directUrl));
    this.inFlight.set(connections.directUrl, operation);
    await operation;
    return connections;
  }

  private async run(connections: DatabaseConnectionPair) {
    try {
      await applyCompanySchema(connections.directUrl);
      const tenantDb = this.tenantManager.getTenantDb(connections.runtimeUrl);
      await tenantDb.$queryRaw`SELECT 1`;
      await syncPermissionsToDb(tenantDb as any);
      this.logger.log('Tenant schema and RBAC registry provisioned successfully');
    } catch (error) {
      const failure = setupFailure(error, 'SCHEMA');
      this.logger.error(JSON.stringify({ event: 'tenant_provisioning_failed', ...failure, diagnostic: setupDiagnostic(error) }));
      throw new BadRequestException(failure);
    }
  }

}
