import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
const { GlobalExceptionFilter } = require('../src/common/filters/http-exception.filter.ts');

test('production health, request tracing and operations guidance remain wired', async () => {
  const [controller, app, main, filter, monitor, runbook] = await Promise.all([
    read('../src/modules/operations/operations.controller.ts'),
    read('../src/app.module.ts'),
    read('../src/main.ts'),
    read('../src/common/filters/http-exception.filter.ts'),
    read('../src/common/interceptors/request-monitoring.interceptor.ts'),
    read('../../docs/OPERATIONS-RUNBOOK.md'),
  ]);
  assert.match(controller, /@Controller\('health'\)/);
  assert.match(controller, /SELECT 1/);
  assert.match(app, /OperationsModule/);
  assert.match(app, /RequestMonitoringInterceptor/);
  assert.match(main, /enableShutdownHooks/);
  assert.match(filter, /requestId/);
  assert.match(filter, /databaseCode === 'P2002'/);
  assert.match(filter, /databaseCode === 'P2003'/);
  assert.match(filter, /databaseCode === 'P2025'/);
  assert.match(filter, /!uniqueConflict && !missingRelation && !missingRecord/);
  assert.match(monitor, /slow_http_request/);
  assert.match(runbook, /Restore drill/);
});

test('database relationship failures are client-safe and actionable', () => {
  const filter = new GlobalExceptionFilter();
  filter.logger.error = () => undefined;
  let status;
  let body;
  const response = { status: (value) => { status = value; return response; }, json: (value) => { body = value; } };
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ method: 'POST', path: '/api/test', url: '/api/test' }) }) };
  filter.catch(Object.assign(new Error('secret database path'), { code: 'P2003' }), host);
  assert.equal(status, 400);
  assert.equal(body.message, 'A referenced record does not exist');
  assert.doesNotMatch(JSON.stringify(body), /secret database path/);
});
