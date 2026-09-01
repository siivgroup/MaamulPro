import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('construction and material-management records stay separate end to end', async () => {
  const [reports, construction, materials, payroll, tenantSql, materialDto, projectReportsPage] = await Promise.all([
    read('../src/modules/reports/reports.service.ts'),
    read('../src/modules/construction/construction.service.ts'),
    read('../src/modules/material-management/material-management.service.ts'),
    read('../src/modules/payroll/payroll.service.ts'),
    read('../src/common/database/tenant-schema-sql.ts'),
    read('../src/modules/material-management/material-management.dto.ts'),
    read('../../frontend/src/pages/ProjectReportsPage.tsx'),
  ]);

  assert.match(reports, /constructionTransactionCategory/);
  for (const prefix of ['construction-procurement:', 'expense:', 'wfpayment:', 'ledger:', 'payroll-', 'subpayment:']) {
    assert.match(reports, new RegExp(prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const prefix of ['purchase:', 'sale:', 'transport:']) {
    assert.match(reports, new RegExp(`reference\\.startsWith\\('${prefix}'\\)`));
  }
  assert.match(construction, /sourceType: 'CONSTRUCTION_PROCUREMENT'/);
  assert.match(construction, /referenceId = `construction-procurement:/);
  assert.match(construction, /data\.type === 'RESTOCK'/);
  assert.match(materials, /db\.material\.findMany/);
  assert.match(materials, /tx\.inventoryTransaction\.create/);
  assert.match(payroll, /projectId: payroll\.projectId/);
  assert.match(projectReportsPage, /const groupKey = cfg\.primaryValue\(category, row\)/);
  assert.match(projectReportsPage, /cat === 'manpower' \? row\.worker : row\.expenseCategory/);
  for (const unit of ['TRUCK_LOAD', 'LOT', 'SQUARE_METER', 'SET', 'BUCKET']) {
    assert.match(tenantSql, new RegExp(`ALTER TYPE "UnitType" ADD VALUE IF NOT EXISTS '${unit}'`));
    assert.match(materialDto, new RegExp(`'${unit}'`));
  }
});
