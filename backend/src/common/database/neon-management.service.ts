import { Injectable } from '@nestjs/common';
import { DatabaseConnectionPair, getCentralDatabaseUrls, getDatabaseConnectionPair, withDatabaseName } from './database-url';
import { protectDatabaseUrl } from './database-credentials';
import { SetupError } from './onboarding-errors';

export type NeonTenantDatabase = DatabaseConnectionPair & {
  databaseName: string;
  createdByMaamulPro: boolean;
  projectId?: string;
  branchId?: string;
  databaseOwner?: string;
};

@Injectable()
export class NeonManagementService {
  status() {
    let configurationError: string | undefined;
    if (this.isConfigured()) {
      try { this.prepareTenantDatabase('00000000-0000-4000-8000-000000000000'); }
      catch (error) { configurationError = error instanceof SetupError ? error.message : 'Automatic database setup needs administrator configuration.'; }
    }
    return { provider: 'neon', automaticProvisioning: this.isConfigured(), configurationError,
      encryptedTenantCredentials: Boolean(process.env.TENANT_DATABASE_ENCRYPTION_KEY), runtimeConnection: 'pooled', migrationConnection: 'direct' };
  }

  // Pure preflight: caller commits this target to the journal before mutation.
  prepareTenantDatabase(requestId: string, suppliedUrl?: string): NeonTenantDatabase {
    try {
      if (suppliedUrl?.trim()) {
        const pair = getDatabaseConnectionPair(suppliedUrl);
        protectDatabaseUrl(pair.runtimeUrl, true);
        return { ...pair, databaseName: decodeURIComponent(new URL(pair.directUrl).pathname.slice(1)), createdByMaamulPro: false };
      }
      if (!this.isConfigured()) throw new Error('Configure NEON_API_KEY, NEON_PROJECT_ID and NEON_BRANCH_ID.');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new Error('Invalid request identifier');
      const prefix = String(process.env.NEON_TENANT_DATABASE_PREFIX || 'tenant_').toLowerCase();
      if (!/^[a-z][a-z0-9_]{0,30}$/.test(prefix)) throw new Error('NEON_TENANT_DATABASE_PREFIX must be a safe identifier of at most 31 characters.');
      const databaseOwner = String(process.env.NEON_DB_ROLE || process.env.NEON_DATABASE_OWNER || 'neondb_owner').trim();
      const baseUrl = process.env.NEON_TENANT_BASE_URL || getCentralDatabaseUrls().directUrl;
      if (decodeURIComponent(new URL(baseUrl).username) !== databaseOwner) throw new Error('NEON_DB_ROLE does not match the database connection user.');
      const databaseName = prefix + requestId.replace(/-/g, '').toLowerCase();
      const pair = getDatabaseConnectionPair(withDatabaseName(baseUrl, databaseName));
      if (!pair.isNeon) throw new Error('Automatic provisioning requires Neon');
      protectDatabaseUrl(pair.runtimeUrl, true);
      return { ...pair, databaseName, databaseOwner, createdByMaamulPro: true,
        projectId: process.env.NEON_PROJECT_ID, branchId: process.env.NEON_BRANCH_ID };
    } catch (error) {
      // Only local validation runs here. Allowlist its messages; never echo a URL.
      const reason = error instanceof Error && /^(TENANT_DATABASE_ENCRYPTION_KEY|CENTRAL_DATABASE_URL|DATABASE_PROVIDER=neon|NEON_DB_ROLE|NEON_TENANT_DATABASE_PREFIX|Configure NEON_|Database URL (is invalid|must identify)|Automatic provisioning requires Neon)/.test(error.message)
        ? error.message : 'The database connection URL or request identifier is invalid.';
      throw new SetupError('SETUP_CONFIGURATION', `${reason} No database has been created.`, false,
        'Check the database URL, Neon role, project/branch, and tenant credential encryption key.');
    }
  }

  async validateTarget(database: NeonTenantDatabase, signal?: AbortSignal) {
    if (!database.projectId || !database.branchId || !database.databaseOwner) throw new SetupError('DATABASE_OWNERSHIP', 'Database ownership needs administrator verification.');
    if (decodeURIComponent(new URL(database.directUrl).pathname.slice(1)) !== database.databaseName) throw new SetupError('DATABASE_OWNERSHIP', 'The saved database target does not match its connection.');
    const payload = await this.request(`https://console.neon.tech/api/v2/projects/${encodeURIComponent(database.projectId)}/endpoints`, 'GET', signal);
    const host = new URL(database.directUrl).hostname;
    if (!payload.endpoints?.some((endpoint: any) => endpoint.branch_id === database.branchId && endpoint.host === host)) {
      throw new SetupError('DATABASE_BRANCH_MISMATCH', 'The database connection does not point to the saved Neon branch.');
    }
  }

  async inspectDatabase(database: NeonTenantDatabase, signal?: AbortSignal) {
    return (await this.request(this.url(database, true), 'GET', signal, undefined, true))?.database || null;
  }

  async ensureDatabase(database: NeonTenantDatabase, requestedAt: Date | null, recordIntent: () => Promise<void>, signal?: AbortSignal) {
    await this.validateTarget(database, signal);
    const existing = await this.inspectDatabase(database, signal);
    if (existing) {
      if (!requestedAt || existing.owner_name !== database.databaseOwner || !existing.created_at || new Date(existing.created_at).getTime() < new Date(requestedAt).getTime() - 30_000) {
        throw new SetupError('DATABASE_OWNERSHIP', 'A database already exists at this target, but it cannot be verified as part of this setup.');
      }
      return;
    }
    await recordIntent();
    signal?.throwIfAborted();
    await this.request(this.url(database), 'POST', signal, { database: { name: database.databaseName, owner_name: database.databaseOwner } });
  }

  async deleteCreatedDatabase(database?: NeonTenantDatabase) {
    if (!database?.createdByMaamulPro) return;
    await this.validateTarget(database);
    const existing = await this.inspectDatabase(database);
    if (!existing) return;
    if (existing.owner_name !== database.databaseOwner) throw new SetupError('DATABASE_OWNERSHIP', 'Database ownership changed. Deletion was stopped.');
    await this.request(this.url(database, true), 'DELETE');
    if (await this.inspectDatabase(database)) throw new SetupError('DATABASE_DELETE_PENDING', 'Database deletion has not been confirmed. The company record is retained.', true);
  }

  private isConfigured() {
    return ['NEON_API_KEY', 'NEON_PROJECT_ID', 'NEON_BRANCH_ID'].every(key => Boolean(process.env[key]?.trim()));
  }

  private url(database: NeonTenantDatabase, named = false) {
    const base = `https://console.neon.tech/api/v2/projects/${encodeURIComponent(database.projectId!)}/branches/${encodeURIComponent(database.branchId!)}/databases`;
    return named ? `${base}/${encodeURIComponent(database.databaseName)}` : base;
  }

  private async request(url: string, method: string, signal?: AbortSignal, body?: unknown, missingAllowed = false): Promise<any> {
    let response: Response;
    try {
      response = await fetch(url, { method, headers: { accept: 'application/json', authorization: `Bearer ${process.env.NEON_API_KEY}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    } catch {
      if (signal?.aborted) signal.throwIfAborted();
      throw new SetupError('PROVIDER_UNREACHABLE', 'The database provider did not confirm the request. Your setup is saved.', true, 'Retry to check the saved database before continuing.');
    }
    if (missingAllowed && response.status === 404) return null;
    if (!response.ok) {
      const retryable = [409, 423, 429, 500, 502, 503, 504].includes(response.status);
      throw new SetupError(`PROVIDER_${response.status}`, [401, 403].includes(response.status)
        ? 'The database provider rejected the platform credentials or permissions.'
        : `The database provider could not complete this step (HTTP ${response.status}). Your setup is saved.`, retryable,
        retryable ? 'Retry the saved setup.' : 'Ask the platform administrator to check the provider configuration.');
    }
    if (response.status === 204) return {};
    try { return await response.json(); }
    catch { throw new SetupError('PROVIDER_RESPONSE_INVALID', 'The database provider returned an unreadable response. Your setup is saved.', true); }
  }
}
