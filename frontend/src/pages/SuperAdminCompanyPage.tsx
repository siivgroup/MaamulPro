import { pendingBillingSubmission, reserveBillingSubmission, completeBillingSubmission } from '../lib/billing-submission';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, CreditCard, FileText, Globe, Settings2, Trash2, UserCog } from 'lucide-react';
import AppShell from '../components/maamulpro/AppShell';
import { CurrencyInput, EmptyState, ErrorAlert, Field, FormActions, LoadingState, Modal, PageHeader, StatGrid, StatusPill, money, shortDate } from '../components/maamulpro/PageKit';
import { api, ApiError } from '../lib/api';
import { toast } from '../lib/toast';
import EnterpriseConfigurationPanel from '../components/maamulpro/EnterpriseConfigurationPanel';
import { tenantBaseDomain, tenantHostname, tenantUrl } from '../lib/tenant-domain';

const moduleFields = [['constructionEnabled', 'Construction'], ['realEstateEnabled', 'Real estate'], ['materialManagementEnabled', 'Materials']] as const;
const managementTabs = [
    { id: 'overview', label: 'Overview', icon: Building2 },
    { id: 'access', label: 'Access & account', icon: UserCog },
    { id: 'billing', label: 'Subscription & invoices', icon: CreditCard },
    { id: 'domain', label: 'Domain', icon: Globe },
    { id: 'configuration', label: 'Tenant configuration', icon: Settings2 },
    { id: 'activity', label: 'Subscription activity', icon: FileText },
    { id: 'danger', label: 'Danger zone', icon: Trash2 },
] as const;
type Tab = (typeof managementTabs)[number]['id'];

const SuperAdminCompanyPage = () => {
    const { id = '' } = useParams();
    const navigate = useNavigate();
    const [company, setCompany] = useState<any>(null);
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const [error, setError] = useState('');
    const [editing, setEditing] = useState(false);
    const [subscriptionOpen, setSubscriptionOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [operation, setOperation] = useState('');
    const [temporaryPassword, setTemporaryPassword] = useState('');
    const [form, setForm] = useState<any>({});
    const [moduleDraft, setModuleDraft] = useState<Record<string, boolean>>({});
    const [subscriptionForm, setSubscriptionForm] = useState({ amount: '', termDurationMonths: '1', autoRecur: false, notes: '' });
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [subdomainInput, setSubdomainInput] = useState('');
    const [savingSubdomain, setSavingSubdomain] = useState(false);

    const load = () => api<any>(`/api/superadmin/companies/${id}`).then((row) => {
        setCompany(row);
        setForm({ name: row.name, adminName: row.adminName, adminEmail: row.adminEmail, companyType: row.companyType || '', phone: row.phone || '', address: row.address || '', description: row.description || '', logoUrl: row.logoUrl || '' });
        setModuleDraft({ constructionEnabled: Boolean(row.constructionEnabled), realEstateEnabled: Boolean(row.realEstateEnabled), materialManagementEnabled: Boolean(row.materialManagementEnabled) });
        setSubscriptionForm({ amount: String(row.subscriptionAmount ?? ''), termDurationMonths: String(row.termDurationMonths || 1), autoRecur: Boolean(row.autoRecur), notes: '' });
        setSubdomainInput(row.subdomain || '');
    }).catch((reason) => setError(reason.message));
    useEffect(() => { load(); }, [id]);

    const run = async (key: string, path: string, method: 'POST' | 'PATCH' | 'DELETE' = 'POST', body: unknown = {}, successMessage = 'Action completed successfully.') => {
        setOperation(key); setError('');
        try { const confirmed = await api<any>(path, { method, body: JSON.stringify(body), silent: true }); if (!confirmed || (key === 'subscription' && typeof confirmed.id !== 'string')) throw new Error('Unable to confirm this action. Retry the saved submission.'); await load(); toast.success(successMessage); return true; }
        catch (reason) { if (key === 'subscription' && reason instanceof ApiError && (reason.code === 'SUBSCRIPTION_REJECTED' || reason.status === 400)) completeBillingSubmission('subscription:' + id); const msg = reason instanceof Error ? reason.message : 'Action failed.'; setError(msg); return false; }
        finally { setOperation(''); }
    };
    const patchStatus = () => {
        const activating = company.status !== 'ACTIVE';
        return run('status', `/api/superadmin/companies/${id}/status`, 'PATCH', { status: activating ? 'ACTIVE' : 'SUSPENDED' }, activating ? 'Tenant activated.' : 'Tenant suspended.');
    };
    const saveModules = () => {
        if (!Object.values(moduleDraft).some(Boolean)) { toast.error('At least one module must remain enabled.'); return; }
        return run('modules', `/api/superadmin/companies/${id}/modules`, 'PATCH', moduleDraft, 'Modules updated.');
    };
    const sendOwnerReset = () => run('reset', '/api/auth/password/forgot', 'POST', { email: company.adminEmail }, 'Password reset email sent to owner.');
    const createTemporaryPassword = async () => {
        setOperation('temporary-password'); setError('');
        try { const result = await api<{ password: string; syncPending: boolean }>(`/api/superadmin/companies/${id}/owner/temporary-password`, { method: 'POST', silent: true }); setTemporaryPassword(result.password); toast.success(result.syncPending ? 'Password saved. Access is paused until workspace synchronization completes. Copy the password now.' : 'Temporary owner password generated. Copy it now; it will not be shown again.', 8000); }
        catch (reason) { const msg = reason instanceof Error ? reason.message : 'Unable to generate a temporary password.'; toast.error(msg); }
        finally { setOperation(''); }
    };
    const visitCompany = async () => {
        const popup = window.open('', '_blank');
        if (!popup) { toast.error('Allow pop-ups to open the company workspace.'); return; }
        popup.opener = null;
        setOperation('impersonation'); setError('');
        try {
            const grant = await api<{ token: string; subdomain: string }>(`/api/superadmin/companies/${id}/impersonation`, { method: 'POST', silent: true });
            popup.location.replace(tenantUrl(grant.subdomain, `/impersonate#${encodeURIComponent(grant.token)}`));
        } catch (reason) {
            popup.close();
            const msg = reason instanceof Error ? reason.message : 'Unable to create a secure company session.';
            setError(msg);
        } finally { setOperation(''); }
    };
    const saveProfile = async (event: FormEvent) => {
        event.preventDefault(); setSaving(true); setError('');
        try { const saved = await api<{ synchronizationWarning?: string }>(`/api/superadmin/companies/${id}`, { method: 'PATCH', body: JSON.stringify(form), silent: true }); setEditing(false); await load(); if (saved.synchronizationWarning) setError(saved.synchronizationWarning); else toast.success('Tenant profile updated.'); }
        catch (reason) { const msg = reason instanceof Error ? reason.message : 'Unable to update tenant profile.'; setError(msg); }
        finally { setSaving(false); }
    };
    const configureSubscription = async (event: FormEvent) => {
        event.preventDefault();
        try {
            const submission = reserveBillingSubmission('subscription:' + id, { amount: Number(subscriptionForm.amount), termDurationMonths: Number(subscriptionForm.termDurationMonths), autoRecur: subscriptionForm.autoRecur, notes: subscriptionForm.notes || undefined });
            const saved = await run('subscription', `/api/superadmin/companies/${id}/subscription`, 'PATCH', { ...submission.payload, requestId: submission.requestId }, 'Subscription configured.');
            if (saved) { completeBillingSubmission('subscription:' + id); setSubscriptionOpen(false); }
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save subscription'); }
    };
    const remove = async () => {
        setDeleteConfirmOpen(false);
        if (await run('delete', `/api/superadmin/companies/${id}`, 'DELETE', {}, 'Tenant deleted.')) navigate('/superadmin/companies', { replace: true });
    };
    const saveSubdomain = async (event: FormEvent) => {
        event.preventDefault();
        const next = subdomainInput.trim().toLowerCase();
        if (!/^[a-z0-9-]+$/.test(next) || next.length < 2 || next.length > 30) {
            toast.error('Subdomain must be 2-30 characters of lowercase letters, numbers, and hyphens.');
            return;
        }
        if (next === company.subdomain) { toast.info('No changes to save.'); return; }
        setSavingSubdomain(true); setError('');
        try {
            await api(`/api/superadmin/companies/${id}`, { method: 'PATCH', body: JSON.stringify({ subdomain: next }), silent: true });
            await load();
            toast.success(`Subdomain updated to ${tenantHostname(next)}`);
        } catch (reason) {
            const msg = reason instanceof Error ? reason.message : 'Unable to update subdomain.';
            setError(msg);
        } finally { setSavingSubdomain(false); }
    };

    if (!company) return <AppShell><PageHeader title="Company" />{error ? <ErrorAlert message={error} onRetry={load} /> : <div className="panel"><LoadingState /></div>}</AppShell>;
    const modules = [company.constructionEnabled && 'Construction', company.realEstateEnabled && 'Real estate', company.materialManagementEnabled && 'Materials'].filter(Boolean).join(', ') || 'None';
    const subscriptionAccessible = company.status === 'ACTIVE'
        && company.subscriptionStatus === 'ACTIVE'
        && company.accessGranted === true
        && company.subscriptionExpiresAt
        && new Date(company.subscriptionExpiresAt) > new Date();

    return <AppShell>
        <nav className="mb-5 flex items-center gap-2 text-sm" aria-label="Breadcrumb"><Link className="text-primary hover:underline" to="/superadmin/dashboard">Dashboard</Link><span className="text-white-dark">/</span><Link className="text-primary hover:underline" to="/superadmin/companies">Companies</Link><span className="text-white-dark">/</span><span className="font-semibold">{company.name}</span></nav>
        {company.onboarding && company.onboarding.status !== 'SUCCEEDED' && <div role="status" className="panel mb-5"><p>Company setup: {company.onboarding.status}. Company changes are blocked until setup finishes.</p><Link className="btn btn-primary mt-3 w-fit" to={`/superadmin/companies/new?onboarding=${company.onboarding.id}`}>Open saved setup</Link></div>}
        {error && !subscriptionOpen && <ErrorAlert message={error} onRetry={load} />}
        <div className="panel overflow-hidden p-0">
            <div className="flex items-center justify-between gap-4 border-b border-white-light px-5 py-4 dark:border-dark"><div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary-light text-primary">{company.logoUrl ? <img className="h-8 w-8 rounded object-contain" src={company.logoUrl} alt="" /> : <Building2 size={20} />}</span><div className="min-w-0"><h1 className="truncate text-xl font-bold">{company.name}</h1><p className="truncate text-xs text-white-dark">{company.subdomain}</p></div></div><button className="btn btn-primary shrink-0" disabled={Boolean(operation)} onClick={visitCompany}>{operation === 'impersonation' ? 'Opening...' : 'Visit company'}</button></div>
            <div className="flex min-h-[620px] items-stretch">
                <aside className="w-64 shrink-0 border-r border-white-light bg-gray-50/50 p-4 dark:border-dark dark:bg-[#0e1726]">
                    <nav className="flex flex-col gap-1" aria-label="Tenant management">
                        {managementTabs.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setActiveTab(item.id)} className={`flex shrink-0 items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-semibold transition ${activeTab === item.id ? 'bg-primary-light text-primary' : item.id === 'danger' ? 'text-danger hover:bg-danger-light' : 'text-white-dark hover:bg-white dark:hover:bg-black'}`} aria-current={activeTab === item.id ? 'page' : undefined}><Icon size={18} />{item.label}</button>; })}
                    </nav>
                </aside>
                <main className="min-w-0 flex-1 p-5 sm:p-7">
                    {activeTab === 'billing' && company.subscriptionStatus === 'ACTIVE' && !subscriptionAccessible && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md bg-warning-light p-4 text-warning"><span>This subscription is marked active but is missing a valid access term.</span><button className="btn btn-sm btn-warning" disabled={Boolean(operation)} onClick={() => { setSubscriptionForm((current) => ({ ...current, ...pendingBillingSubmission('subscription:' + id)?.payload })); setSubscriptionOpen(true); }}>Repair subscription access</button></div>}
                    {activeTab === 'overview' && <><div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Tenant overview</p><h2 className="mt-1 text-2xl font-extrabold">{company.name}</h2><p className="mt-1 text-sm text-white-dark">{company.subdomain} · {company.adminEmail}</p></div><StatusPill value={company.status} /></div><StatGrid items={[{ label: 'Status', value: <StatusPill value={company.status} /> }, { label: 'Modules', value: <span className="block text-sm font-bold text-secondary dark:text-white truncate mt-1" title={modules}>{modules}</span>, tone: 'info' }, { label: 'Users', value: company.users?.length || 0 }, { label: 'Subscription', value: money(company.subscriptionAmount), tone: 'success' }]} /><section><h3 className="text-lg font-bold">Company details</h3><dl className="mt-4 divide-y divide-white-light dark:divide-dark"><div className="grid gap-2 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-xs font-bold uppercase text-white-dark">Primary owner</dt><dd className="font-bold">{company.adminName}<span className="block text-sm font-normal text-white-dark">{company.adminEmail}</span></dd></div><div className="grid gap-2 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-xs font-bold uppercase text-white-dark">Subscription</dt><dd>{company.subscriptionStatus || 'PENDING'} · expires {shortDate(company.subscriptionExpiresAt)}</dd></div><div className="grid gap-2 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-xs font-bold uppercase text-white-dark">Location</dt><dd>{company.address || 'Not provided'}</dd></div><div className="grid gap-2 py-3 sm:grid-cols-[180px_minmax(0,1fr)]"><dt className="text-xs font-bold uppercase text-white-dark">Created</dt><dd>{shortDate(company.createdAt)}</dd></div></dl>{company.description && <p className="mt-4 text-sm text-white-dark">{company.description}</p>}</section></>}
                    {activeTab === 'access' && <><div className="mb-6"><h2 className="text-2xl font-extrabold">Access & account</h2><p className="mt-1 text-sm text-white-dark">Control the owner account, tenant status, and enabled product modules. Roles and permissions are synchronized automatically.</p></div><div className="grid gap-7 xl:grid-cols-2"><section><h3 className="font-bold">Tenant access</h3><p className="mt-1 text-sm text-white-dark">{company.status === 'ACTIVE' ? 'The tenant can access enabled workspaces.' : 'The tenant is not currently active.'}</p><button className={`btn mt-4 ${company.status === 'ACTIVE' ? 'btn-outline-danger' : 'btn-success'}`} disabled={Boolean(operation)} onClick={patchStatus}>{operation === 'status' ? (company.status === 'ACTIVE' ? 'Suspending…' : 'Activating…') : (company.status === 'ACTIVE' ? 'Suspend tenant' : 'Activate tenant')}</button><h3 className="mt-7 font-bold">Enabled modules</h3><div className="mt-3 space-y-3">{moduleFields.map(([key, label]) => <label className={`flex items-center justify-between rounded-md bg-gray-50 p-4 dark:bg-dark ${company.status === 'ACTIVE' ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`} key={key}><span>{label}</span><input className="form-checkbox" type="checkbox" disabled={company.status !== 'ACTIVE'} checked={Boolean(moduleDraft[key])} onChange={(event) => setModuleDraft({ ...moduleDraft, [key]: event.target.checked })} /></label>)}</div>{company.status !== 'ACTIVE' && <p className="mt-3 text-xs text-warning">Activate this tenant before changing modules.</p>}<button className="btn btn-primary mt-4" disabled={company.status !== 'ACTIVE' || Boolean(operation)} onClick={saveModules}>{operation === 'modules' ? 'Saving…' : 'Save module changes'}</button></section><section><h3 className="font-bold">Owner account tools</h3><p className="mt-1 text-sm text-white-dark">Use these actions only for the tenant’s primary administrator.</p><div className="mt-4 grid gap-3"><button className="btn btn-outline-primary" disabled={Boolean(operation)} onClick={sendOwnerReset}>{operation === 'reset' ? 'Sending…' : 'Send password reset'}</button><button className="btn btn-outline-primary" disabled={Boolean(operation)} onClick={createTemporaryPassword}>{operation === 'temporary-password' ? 'Generating…' : 'Generate temporary password'}</button><button className="btn btn-outline-dark" onClick={() => setEditing(true)}>Edit owner and tenant profile</button></div>{temporaryPassword && <div className="mt-5 rounded-md bg-primary-light p-4 text-primary"><p className="text-xs font-bold uppercase">Temporary owner password</p><div className="mt-2 flex flex-wrap items-center gap-2"><code className="rounded bg-white px-3 py-2 font-mono text-sm text-black dark:bg-black dark:text-white">{temporaryPassword}</code><button className="btn btn-sm btn-outline-primary" type="button" onClick={() => navigator.clipboard.writeText(temporaryPassword)}>Copy</button><button className="btn btn-sm btn-outline-dark" type="button" onClick={() => setTemporaryPassword('')}>Hide</button></div></div>}</section></div></>}
                    {activeTab === 'billing' && <><div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-extrabold">Subscription & invoices</h2><p className="mt-1 text-sm text-white-dark">Manage access terms, renewals, and invoice settlement for this tenant.</p></div><Link className="btn btn-outline-primary" to="/superadmin/billing">Open billing workspace</Link></div><section className="rounded-md bg-gray-50 p-5 dark:bg-dark"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase text-white-dark">Current subscription</p><div className="mt-1 flex items-center gap-2"><StatusPill value={company.subscriptionStatus} /><span className="font-bold">{money(company.subscriptionAmount)}</span></div></div><span className="text-sm text-white-dark">Expires {shortDate(company.subscriptionExpiresAt)}</span></div><div className="mt-5 flex flex-wrap gap-2">{company.subscriptionStatus === 'PENDING' && <button className="btn btn-success" disabled={Boolean(operation)} onClick={() => { setSubscriptionForm((current) => ({ ...current, ...pendingBillingSubmission('subscription:' + id)?.payload })); setSubscriptionOpen(true); }}>Approve subscription</button>}{company.subscriptionStatus === 'ACTIVE' && <button className="btn btn-outline-primary" disabled={Boolean(operation)} onClick={() => run('renew', `/api/superadmin/companies/${id}/subscription/renew`, 'POST', {}, 'Subscription renewed.')}>{operation === 'renew' ? 'Renewing…' : 'Renew subscription'}</button>}{company.subscriptionStatus === 'ACTIVE' && <button className="btn btn-outline-warning" disabled={Boolean(operation)} onClick={() => run('suspend', `/api/superadmin/companies/${id}/subscription/suspend`, 'POST', {}, 'Subscription suspended.')}>{operation === 'suspend' ? 'Suspending…' : 'Suspend access'}</button>}{['SUSPENDED', 'EXPIRED', 'CANCELLED'].includes(company.subscriptionStatus) && <button className="btn btn-success" disabled={Boolean(operation)} onClick={() => { setSubscriptionForm((current) => ({ ...current, ...pendingBillingSubmission('subscription:' + id)?.payload })); setSubscriptionOpen(true); }}>Reactivate subscription</button>}{['ACTIVE', 'SUSPENDED'].includes(company.subscriptionStatus) && <button className="btn btn-outline-dark" disabled={Boolean(operation)} onClick={() => run('auto-renew', `/api/superadmin/companies/${id}/subscription/auto-renew`, 'PATCH', { autoRenew: !company.autoRecur }, company.autoRecur ? 'Auto-renew disabled.' : 'Auto-renew enabled.')}>{operation === 'auto-renew' ? 'Saving…' : company.autoRecur ? 'Disable auto-renew' : 'Enable auto-renew'}</button>}</div></section><section className="mt-7"><h3 className="mb-4 text-lg font-bold">Invoices</h3>{!company.invoices?.length ? <EmptyState title="No invoices" /> : <div className="overflow-x-auto"><table className="table-hover w-full"><thead><tr><th>Invoice</th><th>Issued</th><th>Due</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{company.invoices.map((row: any) => <tr key={row.id}><td>{row.invoiceNumber}</td><td>{shortDate(row.createdAt)}</td><td>{shortDate(row.dueDate)}</td><td>{money(row.amount)}</td><td><StatusPill value={row.status} /></td><td>{['UNPAID', 'OVERDUE'].includes(row.status) && <div className="flex flex-wrap gap-2"><button className="btn btn-sm btn-success" disabled={Boolean(operation)} onClick={() => run(`pay-${row.id}`, `/api/superadmin/invoices/${row.id}/pay`, 'POST', { paymentMethod: 'MANUAL_BANK_TRANSFER' }, 'Invoice marked paid.')}>{operation === `pay-${row.id}` ? 'Saving…' : 'Mark paid'}</button><button className="btn btn-sm btn-outline-primary" disabled={Boolean(operation)} onClick={() => run(`extend-${row.id}`, `/api/superadmin/invoices/${row.id}/extend`, 'PATCH', { extendDays: 7 }, 'Invoice due date extended.')}>{operation === `extend-${row.id}` ? 'Saving…' : 'Extend +7 days'}</button><button className="btn btn-sm btn-outline-danger" disabled={Boolean(operation)} onClick={() => run(`cancel-${row.id}`, `/api/superadmin/invoices/${row.id}/cancel`, 'POST', {}, 'Invoice cancelled.')}>{operation === `cancel-${row.id}` ? 'Cancelling…' : 'Cancel'}</button></div>}</td></tr>)}</tbody></table></div>}</section></>}

                    {activeTab === 'domain' && (
                        <>
                            <div className="mb-6"><h2 className="text-2xl font-extrabold">Workspace domain</h2><p className="mt-1 text-sm text-white-dark">Change how the tenant is reached at <code className="font-mono">*.{tenantBaseDomain}</code>. Only superadmins can change this.</p></div>
                            <form className="max-w-xl space-y-5" onSubmit={saveSubdomain}>
                                <Field label="Subdomain" required hint="Lowercase letters, numbers, and hyphens only (2-30 characters).">
                                    <div className="mt-1 flex items-center rounded-md border border-white-light bg-gray-50 dark:border-dark dark:bg-dark">
                                        <span className="px-3 text-sm text-white-dark">https://</span>
                                        <input className="form-input flex-1 border-0 bg-transparent px-0 py-2 focus:ring-0" required minLength={2} maxLength={30} value={subdomainInput} onChange={(event) => setSubdomainInput(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} />
                                        <span className="px-3 text-sm font-semibold text-primary">.{tenantBaseDomain}</span>
                                    </div>
                                </Field>
                                <div className="rounded-md bg-gray-50 p-4 text-xs text-white-dark dark:bg-dark">
                                    <strong className="block text-secondary dark:text-white">Preview:</strong>
                                    <code className="mt-1 block font-mono text-sm font-bold text-primary">{tenantUrl(subdomainInput || 'subdomain')}</code>
                                </div>
                                <div className="rounded-md bg-warning-light p-4 text-xs text-warning">
                                    <strong className="block">Heads up</strong>
                                    <span>Changing the subdomain will break existing bookmarks and any SSO callbacks that point at the old address. Active user sessions will need to sign in again on the new URL.</span>
                                </div>
                                <button className="btn btn-primary" disabled={savingSubdomain || !subdomainInput || subdomainInput === company.subdomain}>{savingSubdomain ? 'Saving…' : 'Update subdomain'}</button>
                            </form>
                        </>
                    )}
                    {activeTab === 'configuration' && <><div className="mb-6"><h2 className="text-2xl font-extrabold">Tenant configuration</h2><p className="mt-1 text-sm text-white-dark">Control workspace access, sidebar visibility, reports, and analytics.</p></div><EnterpriseConfigurationPanel companyId={id} modules={{ construction: Boolean(company.constructionEnabled), real_estate: Boolean(company.realEstateEnabled), material_management: Boolean(company.materialManagementEnabled) }} /></>}
                    {activeTab === 'activity' && <><div className="mb-6"><h2 className="text-2xl font-extrabold">Subscription activity</h2><p className="mt-1 text-sm text-white-dark">An auditable history of subscription and access changes.</p></div>{!company.subscriptionTransactions?.length ? <EmptyState title="No subscription history" /> : <div className="overflow-x-auto"><table className="table-hover w-full"><thead><tr><th>Action</th><th>Previous</th><th>New status</th><th>Amount</th><th>Term</th><th>Date</th><th>Notes</th></tr></thead><tbody>{company.subscriptionTransactions.map((row: any) => <tr key={row.id}><td>{String(row.transactionType).replace(/_/g, ' ')}</td><td><StatusPill value={row.previousStatus} /></td><td><StatusPill value={row.newStatus} /></td><td>{row.amount == null ? '—' : money(row.amount)}</td><td>{row.termDurationMonths ? `${row.termDurationMonths} months` : '—'}</td><td>{shortDate(row.createdAt)}</td><td className="max-w-xs text-sm text-white-dark">{row.notes || '—'}</td></tr>)}</tbody></table></div>}</>}
                    {activeTab === 'danger' && <div className="max-w-2xl"><h2 className="text-2xl font-extrabold text-danger">Danger zone</h2><p className="mt-2 text-sm text-white-dark">Deleting a tenant permanently removes its central records, billing history, owner records, and managed tenant database.</p><div className="mt-6 rounded-md bg-danger-light p-5"><h3 className="font-bold text-danger">Delete tenant</h3><p className="mt-1 text-sm text-danger">This action cannot be undone.</p><button className="btn btn-danger mt-4" disabled={Boolean(operation)} onClick={() => setDeleteConfirmOpen(true)}>Delete {company.name}</button></div></div>}
                </main>
            </div>
        </div>
        <Modal open={editing} onClose={() => setEditing(false)} title="Edit tenant" wide><form className="grid gap-5 md:grid-cols-2" onSubmit={saveProfile}><Field label="Company name" required><input className="form-input mt-1" required value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="Subdomain" required hint="Lowercase letters, numbers, and hyphens"><input className="form-input mt-1" required pattern="[a-z0-9-]+" minLength={2} maxLength={30} value={form.subdomain || ''} onChange={(event) => setForm({ ...form, subdomain: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} /></Field><Field label="Company type"><input className="form-input mt-1" value={form.companyType || ''} onChange={(event) => setForm({ ...form, companyType: event.target.value })} /></Field><Field label="Owner name" required><input className="form-input mt-1" required value={form.adminName || ''} onChange={(event) => setForm({ ...form, adminName: event.target.value })} /></Field><Field label="Owner email" required><input className="form-input mt-1" type="email" required value={form.adminEmail || ''} onChange={(event) => setForm({ ...form, adminEmail: event.target.value })} /></Field><Field label="Phone"><input className="form-input mt-1" value={form.phone || ''} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field><Field label="Logo URL"><input className="form-input mt-1" value={form.logoUrl || ''} onChange={(event) => setForm({ ...form, logoUrl: event.target.value })} /></Field><div className="md:col-span-2"><Field label="Address"><input className="form-input mt-1" value={form.address || ''} onChange={(event) => setForm({ ...form, address: event.target.value })} /></Field></div><div className="md:col-span-2"><Field label="Internal description"><textarea className="form-textarea mt-1" value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field></div><FormActions onCancel={() => setEditing(false)} loading={Boolean(saving)} saveLabel="Save changes" savingLabel="Saving…" /></form></Modal>
        <Modal open={subscriptionOpen} onClose={() => setSubscriptionOpen(false)} title={company.subscriptionStatus === 'PENDING' ? 'Approve subscription' : 'Reactivate subscription'}><form className="space-y-4" onSubmit={configureSubscription}>{error && <ErrorAlert message={error} />}<p className="text-sm text-white-dark">Configure direct billing and grant platform access to {company.name}.</p><Field label="Amount" required><CurrencyInput className="form-input mt-1" min="0" step="0.01" required value={subscriptionForm.amount} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, amount: event.target.value })} /></Field><Field label="Term duration (months)" required><input className="form-input mt-1" type="number" min="1" required value={subscriptionForm.termDurationMonths} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, termDurationMonths: event.target.value })} /></Field><label className="flex cursor-pointer items-center justify-between rounded-md bg-gray-50 p-3 dark:bg-dark"><span><strong className="block">Auto-renewal</strong><small className="text-white-dark">Extend the billing term automatically</small></span><input className="form-checkbox" type="checkbox" checked={subscriptionForm.autoRecur} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, autoRecur: event.target.checked })} /></label><Field label="Notes"><textarea className="form-textarea mt-1" rows={3} value={subscriptionForm.notes} onChange={(event) => setSubscriptionForm({ ...subscriptionForm, notes: event.target.value })} /></Field><FormActions onCancel={() => setSubscriptionOpen(false)} loading={Boolean(operation)} saveLabel="Grant access" savingLabel="Saving…" /></form></Modal>
        <Modal open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} title="Delete tenant">
            <div className="space-y-4">
                <p className="text-white-dark">Permanently delete <strong>{company?.name}</strong>, its owner records, billing history and managed tenant database? This cannot be undone.</p>
                <div className="flex justify-end gap-2">
                    <button className="btn btn-outline-dark" disabled={Boolean(operation)} onClick={() => setDeleteConfirmOpen(false)}>Cancel</button>
                    <button className="btn btn-danger" disabled={Boolean(operation)} onClick={remove}>{operation === 'delete' ? 'Please wait…' : 'Delete tenant'}</button>
                </div>
            </div>
        </Modal>
    </AppShell>;
};

export default SuperAdminCompanyPage;
