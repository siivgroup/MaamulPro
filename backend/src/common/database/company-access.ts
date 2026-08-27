import { PERMISSION_MODULES, ROLE_WORKSPACE_MAP } from './permissions';
import { isAppRole } from './roles';

export type CompanyModules = {
  constructionEnabled?: boolean;
  realEstateEnabled?: boolean;
  materialManagementEnabled?: boolean;
};

function companyWorkspaces(company: CompanyModules) {
  return new Set([
    'core',
    ...(company?.constructionEnabled === true ? ['construction'] : []),
    ...(company?.realEstateEnabled === true ? ['real_estate'] : []),
    ...(company?.materialManagementEnabled === true ? ['material_management'] : []),
  ]);
}

// Use the code registry, not editable/legacy database workspace labels.
export function companyPermissionKeys(company: CompanyModules): Set<string> {
  const workspaces = companyWorkspaces(company);
  return new Set(PERMISSION_MODULES.filter(module => workspaces.has(module.workspace)).flatMap(module => module.permissions));
}

export function companyAccountRoleAllowed(key: string, company: CompanyModules): boolean {
  if (!isAppRole(key) || key === 'SUPER_ADMIN' || key === 'COMPANY_OWNER') return false;
  const workspaces = ROLE_WORKSPACE_MAP[key];
  const enabled = companyWorkspaces(company);
  // Shared roles remain available. Cross-module specialists receive only the
  // permissions of the enabled workspaces, just like shared administrators.
  return !workspaces.length || workspaces.some(workspace => enabled.has(workspace));
}

export function companyRoleAllowed(role: { key: string; rolePermissions?: { permission: { key: string } }[] }, company: CompanyModules): boolean {
  if (isAppRole(role.key)) return companyAccountRoleAllowed(role.key, company);
  const allowed = companyPermissionKeys(company);
  // A custom role containing disabled/unknown permissions cannot be assigned.
  return Array.isArray(role.rolePermissions) && role.rolePermissions.every(link => allowed.has(link.permission?.key));
}
