import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient as TenantPrismaClient } from '../../generated/tenant/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  connectionTimeoutMillis,
  databaseEndpointLabel,
  getDatabaseConnectionPair,
  poolSetting,
} from './database-url';

@Injectable()
export class TenantConnectionManager implements OnModuleDestroy {
  private readonly logger = new Logger(TenantConnectionManager.name);
  private readonly clients = new Map<string, TenantPrismaClient>();
  private readonly pools = new Map<string, Pool>();

  getTenantDb(databaseUrl: string): TenantPrismaClient {
    if (!databaseUrl) {
      throw new Error('Database URL is required to instantiate tenant client');
    }

    const connectionString = getDatabaseConnectionPair(databaseUrl).runtimeUrl;
    const existing = this.clients.get(connectionString);
    if (existing) {
      return existing;
    }

    const pool = new Pool({
      connectionString,
      max: poolSetting('NEON_TENANT_POOL_MAX', 3),
      min: 0,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: connectionTimeoutMillis(),
      keepAlive: true,
    });

    const adapter = new PrismaPg(pool);
    const client = new TenantPrismaClient({ adapter });

    this.pools.set(connectionString, pool);
    this.clients.set(connectionString, client);

    this.logger.log(`Initialized tenant runtime pool for ${databaseEndpointLabel(connectionString)}`);
    return client;
  }

  async disconnectTenant(databaseUrl: string): Promise<void> {
    const connectionString = getDatabaseConnectionPair(databaseUrl).runtimeUrl;
    const client = this.clients.get(connectionString);
    const pool = this.pools.get(connectionString);

    this.clients.delete(connectionString);
    this.pools.delete(connectionString);
    try { await client?.$disconnect(); }
    finally { await pool?.end(); }
  }

  async onModuleDestroy() {
    this.logger.log('Closing all multi-tenant PostgreSQL pools...');
    const disconnectPromises = Array.from(this.clients.values()).map(c => c.$disconnect().catch(() => undefined));
    const poolPromises = Array.from(this.pools.values()).map(p => p.end().catch(() => undefined));
    await Promise.all([...disconnectPromises, ...poolPromises]);
    this.clients.clear();
    this.pools.clear();
  }
}
