import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('rentals require a unit and recurring invoices stay within valid lease periods', () => {
  const dto = read('src/modules/real-estate/real-estate.dto.ts');
  const service = read('src/modules/real-estate/real-estate.service.ts');
  const schema = read('prisma/tenant/schema.prisma');
  const routes = read('../frontend/src/router/routes.tsx');
  const tenantProfile = read('../frontend/src/pages/TenantRentalProfilePage.tsx');

  assert.match(dto, /unitId: string/);
  assert.match(dto, /billingPeriod/);
  assert.match(schema, /model RentalUnit/);
  assert.match(schema, /model RentalUnitCategory/);
  assert.match(service, /prepareRentalUnits/);
  const unitDto = dto.match(/export class RentalUnitDto \{[\s\S]*?\n\}/)?.[0] || '';
  const categoryDto = dto.match(/export class RentalUnitCategoryDto \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(unitDto, /code\?: string|monthlyRent|bedrooms|bathrooms|area|details/);
  assert.match(unitDto, /name: string/);
  assert.match(unitDto, /categoryId: string/);
  assert.match(unitDto, /floor\?: string/);
  assert.match(unitDto, /imageUrl\?: string/);
  assert.match(categoryDto, /rooms: number/);
  assert.match(categoryDto, /bathrooms: number/);
  assert.match(categoryDto, /monthlyRent: number/);
  assert.match(categoryDto, /section: string/);
  assert.match(service, /monthlyRent: Number\(category\.monthlyRent\), bedrooms: category\.rooms/);
  assert.match(service, /Unit already has an active rental contract/);
  assert.match(service, /invoiceDateForMonth/);
  assert.match(service, /advanceBillingPeriod\(dueDate, contract\.billingPeriod, contract\.startDate\) > contract\.endDate/);
  assert.match(service, /Receipt amount cannot exceed the remaining invoice balance/);
  assert.match(service, /FROM "rent_payments"[\s\S]*FOR UPDATE/);
  assert.match(service, /rentForBillingPeriod/);
  assert.doesNotMatch(routes, /Mark paid/);
  assert.match(routes, /<RentPaymentsPage/);
  assert.match(routes, /viewTo=\{\(id\) => `\/app\/real-estate\/tenants\/\$\{id\}\/rental-profile`\}/);
  assert.match(tenantProfile, /Profile.*Leases.*Invoices.*Receipts/);
  assert.match(tenantProfile, /PATCH/);
});
