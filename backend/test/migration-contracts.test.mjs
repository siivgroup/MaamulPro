import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('tenant controllers declare permission contracts for migrated business routes', async () => {
  const controllers = await Promise.all([
    read('../src/modules/construction/construction.controller.ts'),
    read('../src/modules/real-estate/real-estate.controller.ts'),
    read('../src/modules/material-management/material-management.controller.ts'),
    read('../src/modules/financials/financials.controller.ts'),
    read('../src/modules/payroll/payroll.controller.ts'),
    read('../src/modules/staff/staff.controller.ts'),
    read('../src/modules/reports/reports.controller.ts'),
  ]);
  const source = controllers.join('\n');
  const requiredPermissions = [
    'projects.read',
    'construction_tasks.read',
    'construction_expenses.read',
    'construction_inventory.read',
    'manpower.read',
    'workforce_contracts.read',
    'properties.read',
    'clients.read',
    'deals.read',
    'rentals.read',
    'materials_products.read',
    'suppliers.read',
    'purchases.read',
    'material_sales.read',
    'transportation.read',
    'financials.read',
    'payroll.read',
    'users.read',
    'reports.read',
  ];
  for (const permission of requiredPermissions) {
    const guard = permission === 'clients.read'
      ? /RequireAnyPermission\('clients\.read', 'rentals\.read'\)/
      : new RegExp(`RequirePermissions\\('${permission.replace('.', '\\.')}\\'\\)`);
    assert.match(source, guard, permission);
  }
});

test('Vristo routes expose every migrated business workspace', async () => {
  const routes = await read('../../frontend/src/router/routes.tsx');
  const paths = [
    '/app/staff',
    '/app/financials',
    '/app/payroll',
    '/app/construction/projects',
    '/app/construction/expenses',
    '/app/construction/inventory',
    '/app/construction/contracts',
    '/app/real-estate/properties',
    '/app/real-estate/clients',
    '/app/real-estate/deals',
    '/app/real-estate/rental-contracts',
    '/app/real-estate/rent-payments',
    '/app/materials/inventory',
    '/app/materials/suppliers',
    '/app/materials/purchases',
    '/app/materials/sales',
    '/app/materials/transportation',
    '/app/reports',
    '/app/report-schedules',
    '/app/roles',
    '/app/settings',
    '/superadmin/dashboard',
    '/superadmin/companies',
    '/superadmin/companies/new',
    '/superadmin/companies/:id',
    '/superadmin/billing',
    '/superadmin/account',
  ];
  for (const path of paths) {
    const literalRoute = routes.includes(`path: '${path}'`);
    const generatedReportRoute = path === '/app/reports' && routes.includes("reportRoutes('/app/reports'");
    assert.ok(literalRoute || generatedReportRoute, path);
  }
});

test('superadmin uses direct subscriptions and modules without a plans workflow', async () => {
  const [routes, sidebar, controller, onboarding, billing, schema, guard, middleware, appShell] = await Promise.all([
    read('../../frontend/src/router/routes.tsx'),
    read('../../frontend/src/components/Layouts/Sidebar.tsx'),
    read('../src/modules/superadmin/superadmin.controller.ts'),
    read('../../frontend/src/pages/CompanyOnboardingPage.tsx'),
    read('../../frontend/src/pages/SuperAdminBillingPage.tsx'),
    read('../prisma/central/schema.prisma'),
    read('../src/common/guards/tenant-access.guard.ts'),
    read('../src/common/middleware/tenant-resolver.middleware.ts'),
    read('../../frontend/src/components/maamulpro/AppShell.tsx'),
  ]);
  assert.doesNotMatch(routes, /\/superadmin\/plans/);
  assert.doesNotMatch(sidebar, /\/superadmin\/plans/);
  assert.doesNotMatch(controller, /@(?:Get|Post|Patch|Delete)\(['"]plans/);
  assert.doesNotMatch(onboarding, /\bplanId\b/);
  assert.doesNotMatch(billing, /\bplanId\b/);
  assert.match(onboarding, /constructionEnabled/);
  assert.match(onboarding, /realEstateEnabled/);
  assert.match(onboarding, /materialManagementEnabled/);
  assert.match(billing, /termDurationMonths/);
  assert.match(controller, /companies\/:id\/modules/);
  assert.match(controller, /companies\/:id\/subscription/);
  assert.match(schema, /entitlements\s+Json/);
  assert.match(schema, /entitlementSnapshot\s+Json/);
  assert.match(schema, /enum InvoiceStatus[\s\S]*OVERDUE[\s\S]*EXPIRED/);
  assert.match(guard, /subscriptionExpiresAt/);
  assert.match(guard, /features\.payroll/);
  assert.match(guard, /features\.advancedReports/);
  assert.match(middleware, /subscriptionEntitlements\.fromCompany/);
  assert.match(sidebar, /group\.feature/);
  assert.match(appShell, /\/app\/construction/);
  assert.match(appShell, /\/app\/no-access/);
});

test('capacity limits are checked at every supported creation boundary', async () => {
  const [staff, construction, realEstate] = await Promise.all([
    read('../src/modules/staff/staff.service.ts'),
    read('../src/modules/construction/construction.service.ts'),
    read('../src/modules/real-estate/real-estate.service.ts'),
  ]);
  assert.match(staff, /withUserQuota\(companyId/);
  assert.match(construction, /withinTenantQuota\([\s\S]*'constructionProjects'/);
  assert.match(realEstate, /withinTenantQuota\([\s\S]*'properties'/);
});

test('security baseline remains globally registered', async () => {
  const appModule = await read('../src/app.module.ts');
  const main = await read('../src/main.ts');
  assert.match(appModule, /APP_GUARD[\s\S]*JwtAuthGuard/);
  assert.match(appModule, /APP_GUARD[\s\S]*PermissionsGuard/);
  assert.match(main, /forbidNonWhitelisted:\s*true/);
  assert.match(main, /CORS_ALLOWED_ORIGINS/);
});

test('production integrations are wired into the Nest cutover', async () => {
  const [appModule, auth, cron, provisioning, uploads, email] = await Promise.all([
    read('../src/app.module.ts'),
    read('../src/modules/auth/auth.service.ts'),
    read('../src/modules/cron/cron.service.ts'),
    read('../src/common/database/tenant-provisioning.service.ts'),
    read('../src/modules/uploads/uploads.service.ts'),
    read('../src/common/email/resend-email.service.ts'),
  ]);
  assert.match(appModule, /UploadsModule/);
  assert.match(appModule, /EmailModule/);
  assert.match(cron, /processDueReportSchedules/);
  assert.match(auth, /AccountSecurityService/);
  assert.match(cron, /ResendEmailService/);
  assert.match(email, /resend\.emails\.send/);
  assert.match(provisioning, /applyCompanySchema/);
  assert.match(provisioning, /syncPermissionsToDb/);
  assert.match(uploads, /@vercel\/blob/);
});
