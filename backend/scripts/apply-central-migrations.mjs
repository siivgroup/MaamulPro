// Applies only the two additive production migrations introduced by the
// onboarding reliability rollout. Inspection is the default; --apply is explicit.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { Pool } from 'pg';

const migrations = [
  {
    id: '20260827000000_durable_onboarding',
    file: new URL('../prisma/central/migrations/20260827000000_durable_onboarding/migration.sql', import.meta.url),
    present: async client => Boolean((await client.query("SELECT to_regclass('public.company_onboarding') AS table")).rows[0].table),
  },
  {
    id: '20260828000000_workflow_integrity',
    file: new URL('../prisma/central/migrations/20260828000000_workflow_integrity/migration.sql', import.meta.url),
    present: async client => {
      const result = await client.query(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name = 'company_users' AND column_name IN ('identity_sync_pending', 'identity_sync_after')
            OR table_name = 'subscription_transactions' AND column_name IN ('request_id', 'request_hash'))
      `);
      return result.rows.length === 4;
    },
  },
];

const { values } = parseArgs({ options: { apply: { type: 'boolean' } } });
const suppliedUrl = process.env.CENTRAL_DATABASE_DIRECT_URL || process.env.CENTRAL_DATABASE_URL;
if (!suppliedUrl) throw new Error('CENTRAL_DATABASE_URL is required.');
const direct = new URL(suppliedUrl);
if (direct.hostname.endsWith('.neon.tech')) {
  direct.hostname = direct.hostname.replace(/-pooler(?=\.)/, '');
  if (!direct.searchParams.has('sslmode')) direct.searchParams.set('sslmode', 'require');
}
if (direct.hostname.includes('-pooler.')) throw new Error('The migration connection must not use a pooled endpoint.');
const directUrl = direct.toString();

const pool = new Pool({ connectionString: directUrl, max: 1, connectionTimeoutMillis: 20_000 });
try {
  const client = await pool.connect();
  try {
    const pending = [];
    for (const migration of migrations) {
      if (await migration.present(client)) console.log(`${migration.id}: already applied`);
      else { console.log(`${migration.id}: pending`); pending.push(migration); }
    }
    if (!values.apply) {
      if (pending.length) console.log('Inspection only. Re-run with --apply after backup and a maintenance window.');
      process.exitCode = pending.length ? 2 : 0;
    } else {
      for (const migration of pending) {
        const sql = await readFile(migration.file, 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('COMMIT');
          console.log(`${migration.id}: applied`);
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
      }
    }
  } finally { client.release(); }
} finally {
  await pool.end();
}
