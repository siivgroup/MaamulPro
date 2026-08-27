type Workspace = { id: string; name: string; subdomain?: string; logoUrl?: string | null };
export type EmailContent =
  | { template: 'password-reset' | 'onboarding-verification' | 'email-change'; recipient: string; name?: string; workspace?: string; subdomain?: string; code: string; expiresAt: Date; admin?: boolean }
  | { template: 'account-change'; recipient: string; change: 'password' | 'email'; changedAt: Date; administrator?: boolean; admin?: boolean; subdomain?: string; newEmail?: string }
  | { template: 'report'; company: Workspace; title: string; generatedAt: Date; period?: string }
  | { template: 'digest'; company: Workspace; alerts: { severity: string; title: string; details?: string | null }[] };

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export function emailOrigin(subdomain?: string): string {
  const base = String(process.env.TENANT_BASE_DOMAIN || 'maamulpro.site').trim().toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(base)) throw new Error('Invalid email base domain');
  if (subdomain) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain) || subdomain === 'admin') throw new Error('Invalid email workspace');
    return `https://${subdomain}.${base}`;
  }
  const url = new URL(process.env.EMAIL_PUBLIC_ORIGIN || `https://admin.${base}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
    || ![base, `admin.${base}`].includes(url.hostname)) throw new Error('Invalid email public origin');
  return url.origin;
}

export function companyEmailLogo(company: Workspace): string | null {
  try {
    const url = new URL(company.logoUrl || '');
    const pathname = decodeURIComponent(url.pathname);
    const store = /^vercel_blob_rw_([^_]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN || '')?.[1]?.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
      || !store || url.hostname !== `${store}.public.blob.vercel-storage.com`
      || !pathname.startsWith(`/${company.id}/branding/`)
      || pathname.includes('..') || pathname.includes('\\')
      || !/\.(png|jpe?g|gif|webp)$/i.test(pathname)) return null;
    return url.href;
  } catch { return null; }
}

export async function emailCompany(db: any, company: Workspace): Promise<Workspace> {
  const rows = await db.systemConfig.findMany({ where: { key: { in: ['company_name', 'logo_url'] } } });
  const values = Object.fromEntries(rows.map((row: any) => [row.key, row.value]));
  return { ...company, name: values.company_name || company.name, logoUrl: values.logo_url || null };
}

/** One renderer owns markup; callers provide data, never HTML or arbitrary links. */
export function renderEmail(content: EmailContent) {
  const platformLogo = `${emailOrigin()}/assets/images/email-logo.png`;
  const company = 'company' in content ? content.company : undefined;
  const companyLogo = company && companyEmailLogo(company);
  const logo = companyLogo || platformLogo;
  const brand = company?.name || 'MaamulPro';
  const paragraphs: string[] = [];
  let title: string, subject: string, preview: string, code = '', actionLabel = '', actionUrl = '';
  const timestamp = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  let security = '';
  switch (content.template) {
    case 'password-reset':
    case 'onboarding-verification':
    case 'email-change': {
      title = content.template === 'password-reset' ? 'Reset your password' : content.template === 'email-change' ? 'Verify your new email address' : 'Verify your company email';
      subject = `MaamulPro: ${title}`;
      preview = `${title}. This code expires soon; never share it.`;
      if (content.name) paragraphs.push(`Hello ${content.name},`);
      paragraphs.push(content.template === 'password-reset'
        ? `We received a password reset request for ${content.recipient}${content.workspace ? ` at ${content.workspace}` : ''}.`
        : content.template === 'email-change'
          ? `Confirm ${content.recipient} as your new MaamulPro login email. Your existing address stays in place until verification succeeds.`
          : `A company setup has requested ${content.recipient} as its owner email. Enter this code in the company setup form to verify the address.`);
      paragraphs.push(`Enter the six-digit code in the MaamulPro form. Expires ${timestamp(content.expiresAt)}.`);
      if (!/^\d{6}$/.test(content.code)) throw new Error('Invalid email verification code');
      code = content.code;
      security = 'Never share this code or your password. MaamulPro will never ask you to send them by email. If you did not request this, ignore this email; no change has been authorized by this message.';
      break;
    }
    case 'account-change': {
      title = content.change === 'password' ? 'Your password was changed' : 'Your login email was changed';
      subject = `MaamulPro security: ${title}`;
      preview = `${title}. Review this account activity.`;
      paragraphs.push(`Account: ${content.recipient}`, `Changed ${timestamp(content.changedAt)}${content.administrator ? ' by an administrator' : ''}.`);
      if (content.newEmail) paragraphs.push(`New login email: ${content.newEmail}`);
      paragraphs.push('Previous sessions have been revoked. Workspace access may remain paused briefly while the saved change synchronizes.');
      security = 'If you did not authorize this change, recover your account immediately and contact your workspace administrator or MaamulPro support. Do not reply with passwords or verification codes.';
      actionLabel = 'Open account recovery';
      actionUrl = `${emailOrigin(content.subdomain)}${content.admin ? '/superadmin/forgot-password' : '/forgot-password'}`;
      break;
    }
    case 'report':
      title = content.title; subject = `${brand}: ${title}`; preview = 'Your scheduled report is attached as a CSV file.';
      paragraphs.push(`Your scheduled report for ${brand} is attached as a CSV file.`, `Generated ${timestamp(content.generatedAt)}.`);
      if (content.period) paragraphs.push(`Reporting period: ${content.period}`);
      paragraphs.push('This report contains company information. Share it only with authorized recipients.');
      actionLabel = 'Open workspace'; actionUrl = `${emailOrigin(content.company.subdomain)}/app/dashboard`;
      break;
    case 'digest': {
      title = 'Your operational alert summary'; subject = `${brand}: ${content.alerts.length} active operational alerts`;
      preview = `${content.alerts.length} operational alerts to review in your workspace.`;
      const counts = new Map<string, number>();
      for (const alert of content.alerts) counts.set(alert.severity, (counts.get(alert.severity) || 0) + 1);
      paragraphs.push(preview, counts.size ? `By severity: ${[...counts].map(([severity, count]) => `${severity}: ${count}`).join('; ')}.` : 'There are no active alerts.');
      for (const alert of content.alerts.slice(0, 50)) paragraphs.push(`[${alert.severity}] ${alert.title}${alert.details ? `: ${alert.details}` : ''}`);
      if (content.alerts.length > 50) paragraphs.push(`Showing 50 of ${content.alerts.length} alerts. Open your workspace for the full list.`);
      actionLabel = 'Review workspace alerts'; actionUrl = `${emailOrigin(content.company.subdomain)}/app/dashboard`;
      break;
    }
  }
  const support = String(process.env.EMAIL_SUPPORT_ADDRESS || '').trim();
  if (support && !/^[^\s<>@"\r\n]+@[^\s<>@"\r\n]+\.[^\s<>@"\r\n]+$/.test(support)) throw new Error('Invalid email support address');
  const footer = `${company ? 'Sent through MaamulPro. ' : ''}You received this transactional email because of account activity or a configured workspace schedule.${support ? ` Support: ${support}.` : ''}`;
  const h = escapeHtml;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h(title)}</title></head>
<body style="margin:0;padding:0;background:#EDF0F3;color:#2A3442;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${h(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px">
<tr><td align="center" style="padding:28px 28px 12px;text-align:center"><img src="${h(logo)}" width="64" height="64" alt="${h(companyLogo ? brand : 'MaamulPro')} logo" style="display:block;margin:0 auto;object-fit:contain"><p style="font-size:20px;font-weight:bold;overflow-wrap:anywhere;word-break:break-word">${h(brand)}</p></td></tr>
<tr><td style="padding:0 28px 28px;overflow-wrap:anywhere;word-break:break-word"><h1 style="font-size:25px;line-height:1.3;margin:0 0 20px">${h(title)}</h1>
${paragraphs.map(p => `<p style="font-size:16px;line-height:1.6;margin:0 0 16px">${h(p)}</p>`).join('')}
${code ? `<div style="background:#E6F5F5;border:1px solid #0E8B8B;border-radius:6px;padding:20px;text-align:center"><p style="margin:0 0 8px;font-size:14px">Your verification code</p><p style="margin:0;font-size:30px;font-weight:bold;letter-spacing:6px;color:#2A3442">${code}</p></div>` : ''}
${actionUrl ? `<p style="margin:24px 0"><a href="${h(actionUrl)}" style="display:inline-block;background:#2A3442;color:#ffffff;padding:14px 22px;border-radius:5px;text-decoration:none;font-weight:bold">${h(actionLabel)}</a></p><p style="font-size:12px;line-height:1.5">Or open: <a href="${h(actionUrl)}" style="color:#2A3442;word-break:break-all">${h(actionUrl)}</a></p>` : ''}
${security ? `<p style="margin-top:24px;padding:16px;background:#E6F5F5;font-size:14px;line-height:1.6">${h(security)}</p>` : ''}
</td></tr><tr><td style="padding:20px 28px;background:#f8fafb;font-size:12px;line-height:1.6;color:#2A3442">${h(footer)}<br>© ${new Date().getUTCFullYear()} MaamulPro</td></tr>
</table></td></tr></table></body></html>`;
  const text = [brand, title, ...paragraphs, code ? `Verification code: ${code}` : '', actionUrl ? `${actionLabel}: ${actionUrl}` : '', security, footer].filter(Boolean).join('\n\n');
  return { subject: subject.replace(/[\r\n]/g, ' ').slice(0, 200), html, text };
}
