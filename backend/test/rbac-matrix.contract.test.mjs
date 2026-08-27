import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
const { companyPermissionKeys, companyAccountRoleAllowed, companyRoleAllowed } = require('../src/common/database/company-access.ts');
const { ROLE_WORKSPACE_MAP, ALL_PERMISSIONS } = require('../src/common/database/registry.ts');
const { ANY_PERMISSIONS_KEY } = require('../src/common/decorators/permissions.decorator.ts');
const construction = { constructionEnabled: true, realEstateEnabled: false, materialManagementEnabled: false };

const source = await readFile(new URL('../src/common/database/registry.ts', import.meta.url), 'utf8');
const roleBlock = (role) => source.match(new RegExp(`${role}: \\[([\\s\\S]*?)\\n  \\],`))?.[1] || '';

test('specialist role templates remain isolated to their operational duties', () => {
  assert.match(roleBlock('RENTAL_OFFICER'), /PERMISSIONS\.RENTALS_READ/);
  assert.doesNotMatch(roleBlock('RENTAL_OFFICER'), /PERMISSIONS\.PAYROLL_APPROVE/);
  assert.match(roleBlock('SITE_ENGINEER'), /PERMISSIONS\.TASKS_UPDATE/);
  assert.doesNotMatch(roleBlock('SITE_ENGINEER'), /PERMISSIONS\.MATERIAL_SALES_CREATE/);
  assert.match(roleBlock('SALES_STAFF'), /PERMISSIONS\.MATERIAL_SALES_CREATE/);
  assert.doesNotMatch(roleBlock('SALES_STAFF'), /PERMISSIONS\.ACCOUNTING_POST/);
  assert.match(roleBlock('INVENTORY_OFFICER'), /PERMISSIONS\.MATERIALS_INVENTORY_UPDATE/);
  assert.doesNotMatch(roleBlock('INVENTORY_OFFICER'), /PERMISSIONS\.USERS_DELETE/);
});

test('permission resolution is fail-closed and direct denies override grants', async () => {
  const guard = await readFile(new URL('../src/common/guards/permissions.guard.ts', import.meta.url), 'utf8');
  assert.match(guard, /without an active tenant user, no tenant permissions are granted/);
  assert.match(guard, /direct\.effect === 'DENY'\) permissions\.delete/);
  assert.match(guard, /requiredPermissions\.every/);
  assert.match(guard, /anyOfPermissions\.some/);
});

test('every module combination scopes specialists, shared roles and custom permissions', () => {
  for (let mask = 0; mask < 8; mask++) {
    const company = { constructionEnabled: Boolean(mask & 1), realEstateEnabled: Boolean(mask & 2), materialManagementEnabled: Boolean(mask & 4) };
    const allowed = companyPermissionKeys(company);
    const enabled = { core: true, construction: company.constructionEnabled, real_estate: company.realEstateEnabled, material_management: company.materialManagementEnabled };
    for (const [role, workspaces] of Object.entries(ROLE_WORKSPACE_MAP)) {
      const expected = !['SUPER_ADMIN','COMPANY_OWNER'].includes(role) && (!workspaces.length || workspaces.some(workspace => enabled[workspace]));
      assert.equal(companyAccountRoleAllowed(role, company), expected, `${mask}: ${role}`);
    }
    assert.equal(allowed.has('properties.read'), company.realEstateEnabled);
    assert.equal(allowed.has('projects.create'), company.constructionEnabled);
    assert.equal(allowed.has('materials_inventory.update'), company.materialManagementEnabled);
    assert.ok(allowed.has('roles.update'));
    assert.equal(allowed.has('unknown.read'), false);
    if (mask === 7) assert.deepEqual([...allowed].sort(), [...ALL_PERMISSIONS].sort());
  }
  const custom = { key: 'CUSTOM', rolePermissions: [{ permission: { key: 'properties.read', workspace: 'core' } }] };
  assert.equal(companyRoleAllowed(custom, construction), false);
  assert.equal(companyRoleAllowed({ ...custom, rolePermissions: [{ permission: { key: 'projects.read' } }] }, construction), true);
  assert.equal(companyAccountRoleAllowed('NOT_A_ROLE', construction), false);
});

test('module restrictions cap owners and cached old grants on shared API endpoints', async () => {
  const { PermissionsGuard } = require('../src/common/guards/permissions.guard.ts');
  const central = { companyUser: { findUnique: async () => ({ role: 'STAFF', isActive: true }) } };
  const membership = { rbacUserRoles: [], rbacUserPermissions: [{ effect: 'ALLOW', permission: { key: 'properties.read' } }] };
  const request = { user: { id: 'staff', email: 'staff@example.test', companyId: 'company' }, tenantContext: { companyId: 'company', ...construction, realEstateEnabled: true }, tenantDb: { user: { findFirst: async () => membership } } };
  const context = { getHandler: () => () => {}, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => request }) };
  const guard = new PermissionsGuard({ getAllAndOverride: key => key === ANY_PERMISSIONS_KEY ? ['properties.read', 'projects.read'] : undefined }, central);
  assert.equal(await guard.canActivate(context), true);
  request.tenantContext.realEstateEnabled = false;
  await assert.rejects(guard.canActivate(context), error => error.getStatus() === 403);
  const ownerGuard = new PermissionsGuard({ getAllAndOverride: key => key === 'permissions' ? ['properties.read'] : undefined }, { companyUser: { findUnique: async () => ({ role: 'COMPANY_OWNER', isActive: true }) } });
  await assert.rejects(ownerGuard.canActivate(context), error => error.getStatus() === 403);
  request.user.isImpersonating = true;
  await assert.rejects(ownerGuard.canActivate(context), error => error.getStatus() === 403);
});

test('staff creation and primary role changes reject disabled modules before any write', async () => {
  const { StaffService } = require('../src/modules/staff/staff.service.ts');
  const central = { company: { findUnique: async () => construction }, companyUser: { findUnique: async () => ({ companyId: 'company' }) } };
  const tenant = { staff: { findFirst: async () => ({ id: 'staff', userId: 'user' }) } };
  const service = new StaffService(central, null, null, null);
  for (const role of ['REAL_ESTATE_MANAGER','RENTAL_OFFICER','MATERIAL_MANAGER','SUPER_ADMIN','COMPANY_OWNER']) {
    await assert.rejects(service.createStaff(tenant, 'company', { createAccount: true, role }), error => error.getStatus() === 403);
    await assert.rejects(service.createAccount(tenant, 'company', 'staff', { role }), error => error.getStatus() === 403);
    await assert.rejects(service.updateAccountRole(tenant, 'staff', role), error => error.getStatus() === 403);
  }
});

test('session responses omit disabled modules and do not restore empty or inactive grants', async () => {
  const { AuthService } = require('../src/modules/auth/auth.service.ts');
  const company = { ...construction, id: 'company', dbUrl: 'postgresql://test@localhost/disposable' };
  const member = { rbacUserRoles: [], rbacUserPermissions: [{ effect: 'ALLOW', permission: { key: 'properties.read' } }] };
  const account = { id: 'user', email: 'user@example.test', isActive: true, role: 'ADMIN', company };
  const service = new AuthService({ companyUser: { findUnique: async () => account } }, { getTenantDb: () => ({ user: { findFirst: async () => member } }) }, null, { fromCompany: () => ({}) }, null);
  service.enterpriseConfiguration = async () => ({});
  assert.deepEqual((await service.currentSession({ id: 'user' })).permissions, []);
  member.rbacUserPermissions = [{ effect: 'DENY', permission: { key: 'projects.read' } }];
  assert.deepEqual((await service.currentSession({ id: 'user' })).permissions, []);
  member.rbacUserPermissions = [];
  member.rbacUserRoles = [{ role: { isActive: false, rolePermissions: [{ permission: { key: 'projects.read' } }] } }];
  assert.deepEqual((await service.currentSession({ id: 'user' })).permissions, []);
  member.rbacUserRoles[0].role.isActive = true;
  assert.deepEqual((await service.currentSession({ id: 'user' })).permissions, ['projects.read']);
});
