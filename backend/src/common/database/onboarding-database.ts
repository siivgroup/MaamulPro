import { Client } from 'pg';
import { getCentralDatabaseUrls } from './database-url';
import { SetupError } from './onboarding-errors';

export async function assertEmptyOrOwned(client: { query: Function }, onboardingId?: string) {
  const tables = await client.query("SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','p','v','m','f')");
  if (!tables.rows.length) return;
  if (onboardingId && tables.rows.some((row: any) => row.nspname === 'public' && row.relname === 'system_config')) {
    const marker = await client.query("SELECT value FROM public.system_config WHERE key='onboarding_attempt_id'");
    if (marker.rows[0]?.value === onboardingId) return;
  }
  throw new SetupError('DATABASE_NOT_EMPTY', 'This database contains data that is not linked to this setup. Nothing was changed.', false, 'Use an empty dedicated database or request administrator recovery.');
}

export async function withOnboardingLock<T>(work: (guard: () => Promise<void>, signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
  const client = new Client({ connectionString: getCentralDatabaseUrls().directUrl, connectionTimeoutMillis: 10_000, query_timeout: 10_000, keepAlive: true });
  const abort = new AbortController();
  client.on('error', () => abort.abort(new SetupError('SETUP_LOCK_LOST', 'Setup was interrupted and will resume safely.', true)));
  try {
    await client.connect();
    // ponytail: one setup/deletion at a time; use per-target locks if volume demands it.
    const result = await client.query("SELECT pg_try_advisory_lock(hashtext('maamulpro-onboarding')) AS locked");
    if (!result.rows[0].locked) return undefined;
    const guard = async () => { abort.signal.throwIfAborted(); await client.query('SELECT 1'); abort.signal.throwIfAborted(); };
    return await work(guard, abort.signal);
  } finally {
    abort.abort();
    await client.end().catch(() => undefined);
  }
}
