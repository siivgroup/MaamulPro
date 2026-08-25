const baseDomain = (process.env.TENANT_BASE_DOMAIN || 'maamulpro.site')
  .trim()
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '');

export function isPlatformHost(hostHeader?: string): boolean {
  const hostname = (hostHeader || '').replace(/^\[|\]$/g, '').split(':')[0].toLowerCase();
  return hostname === `app.${baseDomain}` || hostname === baseDomain;
}
