import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
const { CONSTRUCTION_EXPENSE_CATEGORIES, constructionExpenseCategory } = require('../src/modules/construction/construction-expense-categories.ts');
const { ConstructionService } = require('../src/modules/construction/construction.service.ts');
const { projectProgress } = require('../src/modules/construction/construction-progress.ts');

test('construction expense categories have stable finance and report behavior', () => {
  assert.equal(new Set(CONSTRUCTION_EXPENSE_CATEGORIES.map((row) => row.code)).size, CONSTRUCTION_EXPENSE_CATEGORIES.length);
  assert.equal(constructionExpenseCategory('UNSKILLED_LABOR').section, 'manpower');
  assert.equal(constructionExpenseCategory('Labor Expense').value, 'LABOR');
  assert.equal(constructionExpenseCategory('Construction Materials').section, 'materials');
  assert.equal(constructionExpenseCategory('SUPPORT_COSTS').label, 'Owner Support');
  assert.equal(constructionExpenseCategory('SUPPORT_COSTS').creditKey, 'OWNER_SUPPORT_CAPITAL');
  assert.equal(constructionExpenseCategory('OTHER').creditKey, 'TRANSACTION_EXPENSE_CASH');
});

test('worker linkage is exclusive to unskilled labor expenses', () => {
  const service = new ConstructionService({}, {});
  assert.throws(() => service.expenseData({ category: 'UNSKILLED_LABOR' }), /Worker is required/);
  assert.equal(service.expenseData({ category: 'OTHER', workerId: 'worker-1' }).workerId, null);
  assert.equal(service.expenseData({ category: 'UNSKILLED_LABOR', workerId: 'worker-1' }).workerId, 'worker-1');
});

test('only the expense worker field is conditional', async () => {
  const config = await readFile(new URL('../../frontend/src/pages/constructionConfig.ts', import.meta.url), 'utf8');
  assert.match(config, /\{ \.\.\.workerLookupField, required: true, hideWhen: \(form\) => form\.category !== 'UNSKILLED_LABOR' \}/);
  assert.doesNotMatch(config.match(/export const workerLookupField[\s\S]*?\n\};/)?.[0] || '', /hideWhen/);
});

test('project progress is the completed share of active tasks', () => {
  assert.equal(projectProgress([]), 0);
  assert.equal(projectProgress([{ status: 'COMPLETED' }, { status: 'IN_PROGRESS' }, { status: 'COMPLETED' }]), 67);
});

test('legacy financial category duplicates merge into the canonical category', async () => {
  const categories = [
    { id: 'material', name: 'Material', code: null, deletedAt: null },
    { id: 'construction-materials', name: 'Construction Materials', code: null, deletedAt: null },
  ];
  const moved = [];
  const tx = {
    category: {
      findMany: async () => [...categories],
      delete: async ({ where }) => categories.splice(categories.findIndex((row) => row.id === where.id), 1)[0],
      update: async ({ where, data }) => Object.assign(categories.find((row) => row.id === where.id), data),
    },
    transaction: { updateMany: async ({ where, data }) => moved.push([where.categoryId, data.categoryId]) },
  };
  const category = await new ConstructionService({}, {}).findOrCreateExpenseCategory(tx, 'MATERIALS');
  assert.deepEqual(moved, [['construction-materials', 'material']]);
  assert.equal(categories.length, 1);
  assert.equal(category.name, 'Materials');
  assert.equal(category.code, 'CEXP_MATERIALS');
});
