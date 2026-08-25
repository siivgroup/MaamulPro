export const tenantBaseDomain = (import.meta.env.VITE_TENANT_BASE_DOMAIN || 'maamulpro.site')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

export const tenantHostname = (subdomain: string) => `${subdomain}.${tenantBaseDomain}`;

export const tenantUrl = (subdomain: string, path = '') => `https://${tenantHostname(subdomain)}${path}`;

export type HostKind = 'platform' | 'tenant' | 'dev';

export const hostKind = (hostname: string): HostKind => {
    if (hostname === 'localhost' || hostname === '127.0.0.1') return 'dev';
    return hostname === `app.${tenantBaseDomain}` || hostname === tenantBaseDomain ? 'platform' : 'tenant';
};
