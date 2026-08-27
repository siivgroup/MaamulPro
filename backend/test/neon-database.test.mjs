import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');

const {
  getDatabaseConnectionPair,
  isNeonDatabaseUrl,
} = require('../src/common/database/database-url.ts');
const {
  protectDatabaseUrl,
  revealDatabaseUrl,
} = require('../src/common/database/database-credentials.ts');
const { NeonManagementService } = require('../src/common/database/neon-management.service.ts');

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Neon URLs use pooling at runtime and direct endpoints for schema work', () => {
  const previousProvider = process.env.DATABASE_PROVIDER;
  delete process.env.DATABASE_PROVIDER;
  try {
    const pair = getDatabaseConnectionPair(
      'postgresql://owner:secret@ep-example.us-east-2.aws.neon.tech/tenant_alpha',
    );
    assert.equal(new URL(pair.runtimeUrl).hostname, 'ep-example-pooler.us-east-2.aws.neon.tech');
    assert.equal(new URL(pair.directUrl).hostname, 'ep-example.us-east-2.aws.neon.tech');
    assert.equal(new URL(pair.runtimeUrl).searchParams.get('sslmode'), 'require');
    assert.equal(new URL(pair.directUrl).searchParams.get('sslmode'), 'require');
    assert.equal(pair.isNeon, true);
    assert.equal(isNeonDatabaseUrl(pair.runtimeUrl), true);
    for (const option of ['host=other-db', 'port=5433', 'user=other-owner', 'options=-csearch_path%3Dother', 'sslkey=private.key']) {
      assert.throws(() => getDatabaseConnectionPair(`${pair.runtimeUrl}&${option}`), /without query overrides/);
    }
  } finally {
    if (previousProvider === undefined) delete process.env.DATABASE_PROVIDER;
    else process.env.DATABASE_PROVIDER = previousProvider;
  }
});

test('tenant database URLs are encrypted and can be recovered with the deployment key', () => {
  const previousProvider = process.env.DATABASE_PROVIDER;
  const previousKey = process.env.TENANT_DATABASE_ENCRYPTION_KEY;
  process.env.DATABASE_PROVIDER = 'neon';
  process.env.TENANT_DATABASE_ENCRYPTION_KEY = 'a'.repeat(64);
  try {
    const raw = 'postgresql://owner:secret@ep-example-pooler.us-east-2.aws.neon.tech/tenant_alpha?sslmode=require';
    const stored = protectDatabaseUrl(raw, true);
    assert.match(stored, /^enc:v1:/);
    assert.equal(stored.includes('owner'), false);
    assert.equal(stored.includes('secret'), false);
    assert.equal(revealDatabaseUrl(stored), raw);
  } finally {
    if (previousProvider === undefined) delete process.env.DATABASE_PROVIDER;
    else process.env.DATABASE_PROVIDER = previousProvider;
    if (previousKey === undefined) delete process.env.TENANT_DATABASE_ENCRYPTION_KEY;
    else process.env.TENANT_DATABASE_ENCRYPTION_KEY = previousKey;
  }
});

test('automatic onboarding validates before creation and resumes an uncertain provider response', async (t) => {
  const keys = ['DATABASE_PROVIDER','CENTRAL_DATABASE_URL','NEON_API_KEY','NEON_PROJECT_ID','NEON_BRANCH_ID','NEON_DB_ROLE','NEON_TENANT_BASE_URL','NEON_TENANT_DATABASE_PREFIX','TENANT_DATABASE_ENCRYPTION_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  Object.assign(process.env, { DATABASE_PROVIDER: 'neon', CENTRAL_DATABASE_URL: 'postgresql://owner:secret@ep-test-pooler.us-east-2.aws.neon.tech/central', NEON_API_KEY: 'fake', NEON_PROJECT_ID: 'project', NEON_BRANCH_ID: 'branch', NEON_DB_ROLE: 'owner', NEON_TENANT_BASE_URL: 'invalid', NEON_TENANT_DATABASE_PREFIX: 'tenant_', TENANT_DATABASE_ENCRYPTION_KEY: 'a'.repeat(64) });
  let posts = 0, exists = false;
  const id = '12345678-1234-4234-8234-123456789abc';
  const service = new NeonManagementService();
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/endpoints')) return Response.json({ endpoints: [{ branch_id: 'branch', host: 'ep-test.us-east-2.aws.neon.tech' }] });
    if (init.method === 'POST') { posts++; exists = true; throw new Error('lost response'); }
    return exists ? Response.json({ database: { name: 'tenant_' + id.replaceAll('-', ''), owner_name: 'owner', created_at: new Date().toISOString() } }) : new Response('{}', { status: 404 });
  });
  assert.throws(() => service.prepareTenantDatabase(id), /connection URL or request identifier is invalid/);
  assert.equal(posts, 0);
  process.env.NEON_TENANT_BASE_URL = 'postgresql://owner:secret@ep-test.us-east-2.aws.neon.tech/central';
  process.env.TENANT_DATABASE_ENCRYPTION_KEY = 'invalid';
  assert.throws(() => service.prepareTenantDatabase(id), /ENCRYPTION_KEY/);
  assert.equal(posts, 0);
  process.env.TENANT_DATABASE_ENCRYPTION_KEY = 'a'.repeat(64);
  const target = service.prepareTenantDatabase(id);
  assert.equal(target.databaseName, 'tenant_' + id.replaceAll('-', ''));
  const requestedAt = new Date();
  await assert.rejects(service.ensureDatabase(target, null, async () => {}), /did not confirm/);
  await service.ensureDatabase(target, requestedAt, async () => assert.fail('must not create again'));
  assert.equal(posts, 1);
  await assert.rejects(service.ensureDatabase(target, null, async () => {}), /cannot be verified/);
  assert.notEqual(service.prepareTenantDatabase('22345678-1234-4234-8234-123456789abc').databaseName, target.databaseName);
});

test('Neon database services are singletons and credentials are not exposed by company APIs', async () => {
  const [databaseModule, appModule, superAdminService, provisioning, schemaSql, encryptionScript] = await Promise.all([
    read('../src/common/database/database.module.ts'),
    read('../src/app.module.ts'),
    read('../src/modules/superadmin/superadmin.service.ts'),
    read('../src/common/database/tenant-provisioning.service.ts'),
    read('../src/common/database/tenant-schema-sql.ts'),
    read('../scripts/encrypt-tenant-database-urls.ts'),
  ]);
  assert.match(databaseModule, /@Global\(\)/);
  assert.match(appModule, /DatabaseModule/);
  assert.match(await read('../src/modules/superadmin/company-onboarding.service.ts'), /protectDatabaseUrl\(target\.runtimeUrl, true\)/);
  assert.match(superAdminService, /const \{ dbUrl, users, \.\.\.safeCompany \} = company/);
  assert.match(superAdminService, /resetTokenHash/);
  assert.doesNotMatch(superAdminService, /include:\s*\{\s*company:\s*true\s*\}/);
  assert.match(provisioning, /applyCompanySchema\(connections\.directUrl\)/);
  assert.match(provisioning, /getTenantDb\(connections\.runtimeUrl\)/);
  assert.match(schemaSql, /const \{ directUrl \} = getDatabaseConnectionPair\(companyDbUrl\)/);
  assert.match(schemaSql, /connectionString:\s*directUrl/);
  assert.match(encryptionScript, /protectDatabaseUrl\(company\.dbUrl, true\)/);
});
