import { ALL_PERMISSION_KEYS, PERMISSION_MODULES, ROLE_PERMISSION_TEMPLATES } from "./permissions";
import type { AppRole } from "./roles";

type DbClient = {
  rbacPermission: {
    findMany: (args?: any) => Promise<any[]>;
    createMany?: (args: { data: any[] }) => Promise<any>;
    create: (args: { data: any }) => Promise<any>;
    update: (args: { where: { id: string }; data: any }) => Promise<any>;
  };
  rbacRole: {
    findMany: (args?: any) => Promise<any[]>;
    create: (args: { data: any }) => Promise<any>;
    update: (args: { where: { id: string }; data: any }) => Promise<any>;
  };
  rbacRolePermission: {
    findMany: (args?: any) => Promise<any[]>;
    createMany?: (args: { data: any[] }) => Promise<any>;
    create: (args: { data: any }) => Promise<any>;
    deleteMany: (args: { where: { roleId: string; permissionId: string | { in: string[] } } }) => Promise<any>;
  };
};

function parseModuleFromKey(key: string): string {
  const parts = key.split(".");
  if (parts.length >= 2) return parts[0];
  return key;
}

function parseActionFromKey(key: string): string {
  const parts = key.split(".");
  if (parts.length >= 2) return parts[parts.length - 1];
  return "read";
}

export async function syncPermissionsToDb(db: DbClient, guard?: () => Promise<void>) {
  const results = { permissions: 0, roles: 0, rolePermissions: 0 };

  // 1. Build module lookup from PERMISSION_MODULES
  const moduleWorkspaceMap = new Map<string, string>();
  for (const mod of PERMISSION_MODULES) {
    for (const perm of mod.permissions) {
      if (!moduleWorkspaceMap.has(perm)) {
        moduleWorkspaceMap.set(perm, mod.workspace);
      }
    }
  }

  // 2. Fetch all existing permissions
  const existingPerms = await db.rbacPermission.findMany();
  const existingPermMap = new Map(existingPerms.map((p: any) => [p.key, p]));

  const permsToCreate: any[] = [];
  const permsToUpdate: any[] = [];

  for (const key of ALL_PERMISSION_KEYS) {
    const module = parseModuleFromKey(key);
    const action = parseActionFromKey(key);
    const workspace = moduleWorkspaceMap.get(key) ?? null;
    const label = key.replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    const existing = existingPermMap.get(key);
    if (!existing) {
      permsToCreate.push({
        key,
        module,
        action,
        workspace,
        label,
        isSystem: true,
      });
    } else if (
      existing.module !== module ||
      existing.action !== action ||
      existing.workspace !== workspace ||
      existing.label !== label
    ) {
      permsToUpdate.push({
        id: existing.id,
        data: { module, action, workspace, label },
      });
    }
  }

  // Batch create new permissions
  if (permsToCreate.length > 0) {
    if (typeof db.rbacPermission.createMany === "function") {
      await guard?.();

      await db.rbacPermission.createMany({ data: permsToCreate });
    } else {
      for (const p of permsToCreate) {
        await guard?.();

        await db.rbacPermission.create({ data: p });
      }
    }
    results.permissions += permsToCreate.length;
  }

  // Update changed permissions
  for (const p of permsToUpdate) {
    await guard?.();

    await db.rbacPermission.update({
      where: { id: p.id },
      data: p.data,
    });
    results.permissions++;
  }

  // Refresh permissions map if we added/updated
  const allPerms = permsToCreate.length > 0 || permsToUpdate.length > 0
    ? await db.rbacPermission.findMany()
    : existingPerms;
  const permMap = new Map(allPerms.map((p: any) => [p.key, p]));

  // 3. Fetch all existing roles
  const existingRoles = await db.rbacRole.findMany();
  const existingRoleMap = new Map(existingRoles.map((r: any) => [r.key, r]));

  const roleEntries = Object.entries(ROLE_PERMISSION_TEMPLATES) as [AppRole, string[]][];
  const rolesToCreate: any[] = [];
  const rolesToUpdate: any[] = [];

  for (const [roleKey, permissions] of roleEntries) {
    const name = roleKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const existing = existingRoleMap.get(roleKey);
    if (!existing) {
      rolesToCreate.push({
        key: roleKey,
        name,
        isSystem: true,
        isActive: true,
      });
    } else if (existing.name !== name || !existing.isActive) {
      rolesToUpdate.push({
        id: existing.id,
        data: { name, isActive: true },
      });
    }
  }

  // Create missing roles
  for (const r of rolesToCreate) {
    await guard?.();

    await db.rbacRole.create({ data: r });
    results.roles++;
  }
  // Update changed roles
  for (const r of rolesToUpdate) {
    await guard?.();

    await db.rbacRole.update({
      where: { id: r.id },
      data: r.data,
    });
    results.roles++;
  }

  // Refresh roles map if we changed any
  const allRoles = rolesToCreate.length > 0 || rolesToUpdate.length > 0
    ? await db.rbacRole.findMany()
    : existingRoles;
  const roleMap = new Map(allRoles.map((r: any) => [r.key, r]));

  // 4. Batch sync role permissions links
  const existingLinks = await db.rbacRolePermission.findMany();
  const existingLinkSet = new Set(existingLinks.map((l: any) => `${l.roleId}:${l.permissionId}`));

  const linksToCreate: any[] = [];
  const linksToDeleteByRoleAndPerm: { roleId: string; permissionId: string }[] = [];

  for (const [roleKey, permissions] of roleEntries) {
    const roleRecord = roleMap.get(roleKey);
    if (!roleRecord) continue;

    // Get valid permission IDs for this role
    const validPermissionIds = permissions
      .map((key) => permMap.get(key)?.id)
      .filter((id): id is string => !!id);

    const validIdSet = new Set(validPermissionIds);

    // Find links to remove for this role
    const roleLinks = existingLinks.filter((l: any) => l.roleId === roleRecord.id);
    for (const link of roleLinks) {
      if (!validIdSet.has(link.permissionId)) {
        linksToDeleteByRoleAndPerm.push({
          roleId: roleRecord.id,
          permissionId: link.permissionId,
        });
      }
    }

    // Find links to add for this role
    for (const permissionId of validPermissionIds) {
      const linkKey = `${roleRecord.id}:${permissionId}`;
      if (!existingLinkSet.has(linkKey)) {
        linksToCreate.push({
          roleId: roleRecord.id,
          permissionId,
        });
      }
    }
  }

  // Delete stale links in bulk
  for (const item of linksToDeleteByRoleAndPerm) {
    await guard?.();

    await db.rbacRolePermission.deleteMany({
      where: { roleId: item.roleId, permissionId: item.permissionId },
    });
  }

  // Batch create new links
  if (linksToCreate.length > 0) {
    if (typeof db.rbacRolePermission.createMany === "function") {
      await guard?.();

      await db.rbacRolePermission.createMany({ data: linksToCreate });
    } else {
      for (const link of linksToCreate) {
        await guard?.();

        await db.rbacRolePermission.create({ data: link });
      }
    }
    results.rolePermissions += linksToCreate.length;
  }

  return results;
}
