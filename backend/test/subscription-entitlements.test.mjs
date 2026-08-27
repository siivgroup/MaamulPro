import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/common/subscriptions/entitlement-policy.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const policy = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('feature aliases normalize into one canonical entitlement contract', () => {
  assert.deepEqual(policy.normalizePlanFeatures({
    constructionEnabled: true,
    real_estate: true,
    materialManagement: false,
    payroll: true,
    reports: true,
  }), {
    construction: true,
    realEstate: true,
    materials: false,
    payroll: true,
    advancedReports: true,
    prioritySupport: false,
  });
});

test('zero limits are unlimited and positive limits stop at capacity', () => {
  assert.equal(policy.isAtLimit(500, 0), false);
  assert.equal(policy.isAtLimit(4, 5), false);
  assert.equal(policy.isAtLimit(5, 5), true);
  assert.equal(policy.isAtLimit(6, 5), true);
});

test('billing periods preserve monthly and yearly terms', () => {
  const start = new Date('2026-07-28T00:00:00.000Z');
  assert.equal(policy.addBillingPeriod(start, 'MONTHLY').toISOString(), '2026-08-28T00:00:00.000Z');
  assert.equal(policy.addBillingPeriod(start, 'YEARLY').toISOString(), '2027-07-28T00:00:00.000Z');
});

test('access requires company, payment, status and unexpired time', () => {
  const active = {
    status: 'ACTIVE',
    subscriptionStatus: 'ACTIVE',
    accessGranted: true,
    subscriptionExpiresAt: '2026-08-01T00:00:00.000Z',
  };
  const now = new Date('2026-07-28T00:00:00.000Z');
  assert.equal(policy.hasSubscriptionAccess(active, now), true);
  assert.equal(policy.hasSubscriptionAccess({ ...active, subscriptionStatus: 'PENDING' }, now), false);
  assert.equal(policy.hasSubscriptionAccess({ ...active, subscriptionExpiresAt: now }, now), false);
});

test('billing months clamp month-end and leap-year dates without local timezone drift',()=>{
  for(const [start,months,expected] of [
    ['2027-01-31T18:42:10.000Z',1,'2027-02-28T18:42:10.000Z'],
    ['2028-01-31T18:42:10.000Z',1,'2028-02-29T18:42:10.000Z'],
    ['2028-02-29T18:42:10.000Z',12,'2029-02-28T18:42:10.000Z'],
    ['2026-12-31T18:42:10.000Z',2,'2027-02-28T18:42:10.000Z'],
    ['2026-08-31T18:42:10.000Z',1,'2026-09-30T18:42:10.000Z'],
  ]){
    const original=new Date(start);assert.equal(policy.addBillingMonths(original,months).toISOString(),expected);assert.equal(original.toISOString(),start);
  }
  for(const months of [0,-1,1.5,NaN])assert.throws(()=>policy.addBillingMonths(new Date(),months));
});
