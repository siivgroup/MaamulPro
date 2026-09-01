import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
const { ReportsService } = require('../src/modules/reports/reports.service.ts');
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('print layouts remove application width and table overflow', async () => {
  const [css, projectReports, financialReports, payslips, crud] = await Promise.all([
    read('../../frontend/src/tailwind.css'),
    read('../../frontend/src/pages/ProjectReportsPage.tsx'),
    read('../../frontend/src/pages/FinancialReportsPage.tsx'),
    read('../../frontend/src/pages/PayslipsPage.tsx'),
    read('../../frontend/src/pages/CrudPage.tsx'),
  ]);
  assert.match(css, /\.main-container, \.main-content/);
  assert.match(css, /@page \{ margin: 8mm; \}/);
  assert.match(css, /padding: 8mm !important;/);
  assert.match(css, /\.print-sheet \.overflow-x-auto/);
  assert.match(css, /\.print-report-table/);
  assert.match(projectReports, /print-report-table/);
  assert.match(financialReports, /className="print-document"/);
  assert.match(payslips, /id="payslip-print" className="print-document/);
  assert.match(crud, /@page\{margin:12mm\}/);
});

test('PDF exports wrap and paginate every result row', () => {
  const rows = Array.from({ length: 80 }, (_, index) => ({ name: `Row ${index + 1}`, description: index === 79 ? 'FINAL_EXPORT_ROW' : 'A long printable description '.repeat(8) }));
  const pdf = new ReportsService().reportPdf({ report: { title: 'Layout Test' }, summary: { rowCount: rows.length }, rows });
  const content = pdf.toString('binary');
  assert.match(content, /\/Count [2-9]\d*/);
  assert.match(content, /FINAL_EXPORT_ROW/);
  assert.doesNotMatch(content, /slice\(0, 30\)/);
});
