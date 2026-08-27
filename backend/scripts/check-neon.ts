import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { Pool } from 'pg';
import {
  databaseEndpointLabel,
  getCentralDatabaseUrls,
  isNeonDatabaseUrl,
} from '../src/common/database/database-url';
import { NeonManagementService } from '../src/common/database/neon-management.service';
import { protectDatabaseUrl } from '../src/common/database/database-credentials';
import { SetupError, setupFailure } from '../src/common/database/onboarding-errors';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function queryConnection(label: string, connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 5_000,
    keepAlive: true,
  });
  try {
    const result = await pool.query<{ database: string }>('SELECT current_database() AS database');
    console.log(`${label}: connected to ${databaseEndpointLabel(connectionString)} (${result.rows[0].database})`);
  } finally {
    await pool.end();
  }
}

async function check() {
  if (String(process.env.DATABASE_PROVIDER || '').toLowerCase() !== 'neon') {
    throw new SetupError('SETUP_CONFIGURATION', 'DATABASE_PROVIDER must be set to neon');
  }
  const connections = getCentralDatabaseUrls();
  if (!isNeonDatabaseUrl(connections.runtimeUrl) || !isNeonDatabaseUrl(connections.directUrl)) {
    throw new SetupError('SETUP_CONFIGURATION', 'Both central database URLs must point to Neon');
  }
  if (!new URL(connections.runtimeUrl).hostname.includes('-pooler.')) {
    throw new SetupError('SETUP_CONFIGURATION', 'CENTRAL_DATABASE_URL must resolve to a pooled Neon endpoint');
  }
  if (new URL(connections.directUrl).hostname.includes('-pooler.')) {
    throw new SetupError('SETUP_CONFIGURATION', 'CENTRAL_DATABASE_DIRECT_URL must resolve to a direct Neon endpoint');
  }
  if (!process.env.TENANT_DATABASE_ENCRYPTION_KEY) {
    throw new SetupError('SETUP_CONFIGURATION', 'TENANT_DATABASE_ENCRYPTION_KEY is required');
  }
  protectDatabaseUrl(connections.runtimeUrl, true);
  const neon = new NeonManagementService();
  const target = neon.prepareTenantDatabase('00000000-0000-4000-8000-000000000000');
  await neon.validateTarget(target);

  await queryConnection('Pooled runtime connection', connections.runtimeUrl);
  await queryConnection('Direct migration connection', connections.directUrl);
  console.log('Neon connectivity and connection-mode checks passed.');
}

check().catch((error) => {
  console.error('neon:check failed:', setupFailure(error, 'PREFLIGHT'));
  process.exitCode = 1;
});
