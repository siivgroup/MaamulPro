const baseDomain = (process.env.TENANT_BASE_DOMAIN || 'maamulpro.site')
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '');

function extractHostname(hostOrOrigin?: string): string {
  return (hostOrOrigin || '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^\[|\]$/g, '')
    .split(/[/:]/)[0]
    .toLowerCase();
}

// Accepts a Host header (no scheme) or an Origin/Referer header (with scheme) — both resolve to the same hostname.
export function isPlatformHost(hostOrOrigin?: string): boolean {
  const hostname = extractHostname(hostOrOrigin);
  return hostname === `admin.${baseDomain}` || hostname === baseDomain;
}

// The tenant subdomain the request's domain resolves to, or null if it's the platform
// domain, a bare/dev host, or not a "<subdomain>.<baseDomain>" address at all.
export function resolveTenantSubdomain(hostOrOrigin?: string): string | null {
  const hostname = extractHostname(hostOrOrigin);
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return null;
  if (hostname === baseDomain || hostname === `admin.${baseDomain}`) return null;
  if (!hostname.endsWith(`.${baseDomain}`)) return null;
  return hostname.slice(0, -(`.${baseDomain}`.length));
}
