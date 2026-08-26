const baseDomain = (process.env.TENANT_BASE_DOMAIN || 'maamulpro.site')
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '');

// Accepts a Host header (no scheme) or an Origin/Referer header (with scheme) — both resolve to the same hostname.
export function isPlatformHost(hostOrOrigin?: string): boolean {
  const hostname = (hostOrOrigin || '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^\[|\]$/g, '')
    .split(/[/:]/)[0]
    .toLowerCase();
  return hostname === `admin.${baseDomain}` || hostname === baseDomain;
}
