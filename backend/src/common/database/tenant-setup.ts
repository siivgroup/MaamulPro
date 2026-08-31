import { ENTERPRISE_CONFIG_KEY, parseEnterpriseModuleConfiguration } from './enterprise-config';

export async function synchronizeTenantConfiguration(tenantDb: any, company: any, guard?: () => Promise<void>) {
    const moduleValues = {
      construction: Boolean(company.constructionEnabled),
      real_estate: Boolean(company.realEstateEnabled),
      material_management: Boolean(company.materialManagementEnabled),
    };
    const values = [
      ['company_name', company.name],
      ['company_slug', company.subdomain],
      ['company_type', company.companyType || 'general'],
      ['construction_enabled', String(moduleValues.construction)],
      ['real_estate_enabled', String(moduleValues.real_estate)],
      ['material_management_enabled', String(moduleValues.material_management)],
      ['modules_enabled', Object.entries(moduleValues).filter(([, enabled]) => enabled).map(([key]) => key).join(',')],
    ];
    for (const [key, value] of values) {
      await guard?.();
      await tenantDb.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    await guard?.();
    await tenantDb.systemConfig.upsert({
      where: { key: ENTERPRISE_CONFIG_KEY },
      update: {},
      create: {
        key: ENTERPRISE_CONFIG_KEY,
        value: JSON.stringify(parseEnterpriseModuleConfiguration(null)),
      },
    });
    return tenantDb;
  }

export async function seedTenantDefaults(tenantDb: any, company: any, ownerId: string, guard?: () => Promise<void>) {
    await synchronizeTenantConfiguration(tenantDb, company, guard);
    const [firstName, ...rest] = String(company.adminName || '').trim().split(/\s+/);
    await guard?.();
    await tenantDb.staff.upsert({
      where: { userId: ownerId },
      update: { firstName: firstName || company.adminName, lastName: rest.join(' ') },
      create: {
        userId: ownerId,
        firstName: firstName || company.adminName,
        lastName: rest.join(' '),
        department: 'GENERAL',
        position: 'Company Owner',
      },
    });
    const categories = [
      ['Salary', '#3b82f6'], ['Materials', '#f59e0b'], ['Client Payment', '#10b981'],
      ['Consulting', '#8b5cf6'], ['Rent', '#ef4444'], ['Utilities', '#06b6d4'],
      ['Equipment', '#f97316'], ['Other', '#6b7280'],
    ];
    for (const [name, color] of categories) {
      await guard?.();
      await tenantDb.category.upsert({ where: { name }, update: {}, create: { name, color } });
    }
    const setupLog = await tenantDb.activityLog.findFirst({ where: { action: 'company_setup_completed', entity: 'company_setup' } });
    if (!setupLog) {
      await guard?.();
      await tenantDb.activityLog.create({
        data: { userId: ownerId, action: 'company_setup_completed', entity: 'company_setup', details: `Initial setup via platform administration for ${company.name}` },
      });
    }
  }
