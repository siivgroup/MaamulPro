import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('material purchases preserve inventory, payable, and payment invariants', async () => {
  const [service, controller, schema, routes] = await Promise.all([
    read('../src/modules/material-management/material-management.service.ts'),
    read('../src/modules/material-management/material-management.controller.ts'),
    read('../prisma/tenant/schema.prisma'),
    read('../../frontend/src/router/routes.tsx'),
  ]);
  assert.match(service, /FROM "purchase_orders"[\s\S]*FOR UPDATE/);
  assert.match(service, /FROM "materials"[\s\S]*FOR UPDATE/);
  assert.match(service, /Payment cannot exceed the supplier outstanding balance/);
  assert.match(service, /drKey: 'SUPPLIER_PAYMENT_AP', crKey: 'SUPPLIER_PAYMENT_CASH'/);
  assert.match(service, /drKey: 'PURCHASE_INVOICE_INVENTORY'/);
  assert.match(service, /Ordered or received purchase orders must be cancelled or reversed, not deleted/);
  assert.match(controller, /suppliers\/:id\/payments/);
  assert.match(schema, /referenceNo\s+String\?\s+@unique/);
  assert.match(routes, /viewTo=\{\(id\) => `\/app\/materials\/purchases\/\$\{id\}`\}/);
});
