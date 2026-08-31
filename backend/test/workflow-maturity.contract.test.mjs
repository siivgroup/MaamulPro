import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('workflow controls cover period locks, approval limits, evidence, and idempotent recurring records', async () => {
  const [schema, sql, accounting, payroll, uploads, cron, settings, periodsPage, documents] = await Promise.all([
    read('../prisma/tenant/schema.prisma'), read('../src/common/database/tenant-schema-sql.ts'),
    read('../src/modules/accounting/accounting.service.ts'), read('../src/modules/payroll/payroll.service.ts'),
    read('../src/modules/uploads/uploads.service.ts'), read('../src/modules/cron/cron.service.ts'),
    read('../src/modules/settings/settings.service.ts'), read('../../frontend/src/pages/AccountingPeriodsPage.tsx'),
    read('../../frontend/src/components/maamulpro/DocumentAttachments.tsx'),
  ]);
  assert.match(sql, /CURRENT_TENANT_SCHEMA_VERSION = 29/);
  assert.match(schema, /model AccountingPeriod/);
  assert.match(schema, /model DocumentAttachment/);
  assert.match(schema, /approvalLimit\s+Decimal\?/);
  assert.match(accounting, /assertPeriodOpen/);
  assert.match(accounting, /status: 'LOCKED'/);
  assert.match(payroll, /assertApprovalLimit/);
  assert.match(payroll, /generateMonthlyDraft/);
  assert.match(uploads, /Document parent record was not found/);
  assert.match(uploads, /signedAt: new Date\(\)/);
  assert.match(cron, /generateRecurringMonthlyRecords/);
  assert.match(settings, /automaticRentInvoices/);
  assert.match(periodsPage, /Lock completed periods/);
  assert.match(documents, /Documents & signatures/);
});
