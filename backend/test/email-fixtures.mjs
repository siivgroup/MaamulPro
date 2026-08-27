export function emailFixtures() {
  const company = { id: 'example-company', name: 'Horseed Construction', subdomain: 'horseed' };
  const recipient = 'owner@example.test';
  const expiresAt = new Date(Date.now() + 600000);
  return [
    { template: 'password-reset', recipient, name: 'Amina', workspace: company.name, code: '123456', expiresAt },
    { template: 'onboarding-verification', recipient, code: '123456', expiresAt },
    { template: 'email-change', recipient, name: 'Amina', code: '123456', expiresAt },
    { template: 'account-change', recipient, change: 'email', newEmail: 'new-owner@example.test', changedAt: new Date(), subdomain: company.subdomain },
    { template: 'report', company, title: 'Monthly financial summary', generatedAt: new Date(), period: '2026-08-01 to 2026-08-27' },
    { template: 'digest', company, alerts: [{ severity: 'CRITICAL', title: 'Overdue invoice', details: 'Review the outstanding balance in your workspace.' }, { severity: 'WARNING', title: 'Contract approaching expiry' }] },
  ];
}
