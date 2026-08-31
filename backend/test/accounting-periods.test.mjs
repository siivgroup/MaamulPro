import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
const { AccountingService } = require('../src/modules/accounting/accounting.service.ts');
const service = new AccountingService({});

test('accounting periods cover their full final day', async () => {
  let created;
  await service.createPeriod({ accountingPeriod: {
    findFirst: async () => null,
    create: async ({ data }) => (created = data),
  } }, {
    name: 'August 2026',
    startDate: new Date('2026-08-01T00:00:00.000Z'),
    endDate: new Date('2026-08-31T00:00:00.000Z'),
  });
  assert.equal(created.endDate.toISOString(), '2026-08-31T23:59:59.999Z');
});

test('posting needs coverage and a locked final day remains locked', async () => {
  await assert.rejects(
    service.assertPeriodOpen({ accountingPeriod: { findFirst: async () => null } }, new Date('2020-01-15T12:00:00.000Z')),
    /No accounting period covers 2020-01-15/,
  );
  await assert.rejects(
    service.assertPeriodOpen({ accountingPeriod: { findFirst: async ({ where }) => {
      assert.equal(where.endDate.gte.toISOString(), '2026-08-31T00:00:00.000Z');
      return { name: 'August 2026', status: 'LOCKED' };
    } } }, new Date('2026-08-31T18:00:00.000Z')),
    /August 2026.*locked/,
  );
});

test('the current month opens automatically on first accounting activity', async () => {
  let created;
  await service.assertPeriodOpen({ accountingPeriod: {
    findFirst: async () => null,
    upsert: async ({ create }) => (created = create),
  } }, new Date());
  assert.equal(created.status, 'OPEN');
  assert.equal(created.endDate.getUTCHours(), 23);
});
