import { pendingBillingSubmission, reserveBillingSubmission, completeBillingSubmission } from '../lib/billing-submission';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Edit3, PauseCircle, RefreshCw, Search } from 'lucide-react';
import AppShell from '../components/maamulpro/AppShell';
import { CurrencyInput, EmptyState, ErrorAlert, FormActions, LoadingState, Modal, PageHeader, StatGrid, StatusPill, money, shortDate } from '../components/maamulpro/PageKit';
import { api, ApiError } from '../lib/api';

type Company = any;
type SubscriptionForm = { amount: string; termDurationMonths: string; autoRecur: boolean; notes: string };
const emptyForm: SubscriptionForm = { amount: '', termDurationMonths: '1', autoRecur: false, notes: '' };

const SuperAdminBillingPage = () => {
    const [companies, setCompanies] = useState<Company[]>([]);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('all');
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState('');
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [approveCompany, setApproveCompany] = useState<Company | null>(null);
    const [editCompany, setEditCompany] = useState<Company | null>(null);
    const [form, setForm] = useState<SubscriptionForm>(emptyForm);

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            setCompanies(await api<Company[]>('/api/superadmin/companies'));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to load subscriptions.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const run = async (key: string, path: string, method: 'POST' | 'PATCH' = 'POST', body: unknown = {}) => {
        setWorking(key);
        setError('');
        setMessage('');
        try {
            await api<any>(path, { method, body: JSON.stringify(body), silent: true }).then((saved) => { if (!saved || (key.startsWith('configure-') && typeof saved.id !== 'string')) throw new Error('Unable to confirm subscription status. Retry the saved submission.'); });
            await load();
            setMessage('Subscription updated successfully.');
            return true;
        } catch (reason) {
            if (key.startsWith('configure-') && reason instanceof ApiError && (reason.code === 'SUBSCRIPTION_REJECTED' || reason.status === 400)) completeBillingSubmission('subscription:' + key.slice('configure-'.length));
            setError(reason instanceof Error ? reason.message : 'Subscription action failed.');
            return false;
        } finally {
            setWorking('');
        }
    };

    const filtered = useMemo(() => companies.filter((company) => {
        const term = search.trim().toLowerCase();
        const matchesSearch = !term
            || company.name.toLowerCase().includes(term)
            || company.subdomain.toLowerCase().includes(term)
            || company.adminEmail.toLowerCase().includes(term);
        return matchesSearch && (status === 'all' || company.subscriptionStatus === status);
    }), [companies, search, status]);

    const stats = {
        total: companies.length,
        active: companies.filter((company) => company.subscriptionStatus === 'ACTIVE').length,
        pending: companies.filter((company) => company.subscriptionStatus === 'PENDING').length,
        expired: companies.filter((company) => company.subscriptionStatus === 'EXPIRED').length,
        suspended: companies.filter((company) => company.subscriptionStatus === 'SUSPENDED').length,
    };

    const openApprove = (company: Company) => {
        setApproveCompany(company);
        setForm({
            amount: String(company.subscriptionAmount ?? ''),
            termDurationMonths: String(company.termDurationMonths || 1),
            autoRecur: Boolean(company.autoRecur),
            notes: '',
            ...pendingBillingSubmission('subscription:' + company.id)?.payload,
        });
    };

    const openEdit = (company: Company) => {
        setEditCompany(company);
        setForm({
            amount: String(company.subscriptionAmount ?? ''),
            termDurationMonths: String(company.termDurationMonths || 1),
            autoRecur: Boolean(company.autoRecur),
            notes: '',
            ...pendingBillingSubmission('subscription:' + company.id)?.payload,
        });
    };

    const submitConfiguration = async (event: FormEvent, company: Company, close: () => void) => {
        event.preventDefault();
        try {
        const submission = reserveBillingSubmission('subscription:' + company.id, {
            amount: Number(form.amount),
            termDurationMonths: Number(form.termDurationMonths),
            autoRecur: form.autoRecur,
            notes: form.notes || undefined,
        });
        const success = await run(`configure-${company.id}`, `/api/superadmin/companies/${company.id}/subscription`, 'PATCH', { ...submission.payload, requestId: submission.requestId });
        if (success) { completeBillingSubmission('subscription:' + company.id); close(); }
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save subscription'); }
    };

    const daysRemaining = (value?: string | null) => {
        if (!value) return null;
        return Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000);
    };

    return <AppShell>
        <PageHeader eyebrow="Platform administration" title="Subscriptions" description="Manage all company subscriptions using direct amount, duration, renewal and access controls." />
        {error && !approveCompany && !editCompany && <ErrorAlert message={error} onRetry={load} />}
        {message && <div className="mb-5 rounded-md bg-success-light p-4 text-success">{message}</div>}

        {loading ? <div className="panel"><LoadingState /></div> : <>
            <StatGrid items={[
                { label: 'Total', value: stats.total },
                { label: 'Active', value: stats.active, tone: 'success' },
                { label: 'Pending', value: stats.pending, tone: 'warning' },
                { label: 'Expired', value: stats.expired, tone: 'danger' },
            ]} />
            <div className="mb-6 grid grid-cols-2 gap-3 sm:hidden"><div className="panel"><p className="text-xs text-white-dark">Suspended</p><p className="mt-1 text-2xl font-bold">{stats.suspended}</p></div></div>

            <section className="panel overflow-hidden p-0">
                <div className="border-b border-white-light p-5 dark:border-dark">
                    <h2 className="text-lg font-bold">All subscriptions</h2>
                    <p className="mt-1 text-xs text-white-dark">Search, filter and manage direct company subscription details.</p>
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                        <div className="relative flex-1"><Search className="absolute left-3 top-3 text-white-dark" size={17} /><input className="form-input pl-10" placeholder="Search companies…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
                        <select className="form-select sm:w-52" value={status} onChange={(event) => setStatus(event.target.value)}>
                            <option value="all">All statuses</option>
                            <option value="ACTIVE">Active</option>
                            <option value="PENDING">Pending</option>
                            <option value="EXPIRED">Expired</option>
                            <option value="SUSPENDED">Suspended</option>
                            <option value="CANCELLED">Cancelled</option>
                        </select>
                    </div>
                </div>

                {!filtered.length ? <EmptyState title="No subscriptions found" /> : <div className="overflow-x-auto"><table className="table-hover w-full">
                    <thead><tr><th>Company</th><th>Amount</th><th>Duration</th><th>Start</th><th>Expiry</th><th>Auto-renew</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>{filtered.map((company) => {
                        const days = daysRemaining(company.subscriptionExpiresAt);
                        const busy = working.endsWith(company.id);
                        return <tr key={company.id}>
                            <td><strong>{company.name}</strong><p className="text-xs text-white-dark">{company.subdomain}</p></td>
                            <td className="font-semibold">{company.subscriptionAmount == null ? '—' : money(company.subscriptionAmount)}</td>
                            <td>{company.termDurationMonths ? `${company.termDurationMonths}m` : '—'}</td>
                            <td>{shortDate(company.subscriptionStartAt)}</td>
                            <td>{shortDate(company.subscriptionExpiresAt)}{company.subscriptionStatus === 'ACTIVE' && days != null && <small className={`block ${days <= 7 ? 'text-danger' : 'text-white-dark'}`}>{days <= 0 ? 'Expired' : `${days}d left`}</small>}</td>
                            <td>{company.autoRecur ? <CheckCircle2 className="text-success" size={18} /> : '—'}</td>
                            <td><StatusPill value={company.subscriptionStatus} /></td>
                            <td><div className="flex min-w-[250px] flex-wrap gap-2">
                                {company.subscriptionStatus === 'PENDING' && <button className="btn btn-sm btn-outline-success" disabled={busy} onClick={() => openApprove(company)}><CheckCircle2 className="mr-1" size={14} /> Approve</button>}
                                {company.subscriptionStatus === 'ACTIVE' && <>
                                    <button className="btn btn-sm btn-outline-primary" disabled={busy} onClick={() => openEdit(company)} title="Edit subscription"><Edit3 size={14} /></button>
                                    <button className="btn btn-sm btn-outline-primary" disabled={busy} onClick={() => run(`renew-${company.id}`, `/api/superadmin/companies/${company.id}/subscription/renew`)} title="Renew subscription"><RefreshCw size={14} /></button>
                                    <button className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => run(`suspend-${company.id}`, `/api/superadmin/companies/${company.id}/subscription/suspend`, 'POST', { notes: 'Suspended from subscriptions page' })} title="Suspend access"><PauseCircle size={14} /></button>
                                </>}
                                {['EXPIRED', 'SUSPENDED', 'CANCELLED'].includes(company.subscriptionStatus) && <button className="btn btn-sm btn-outline-success" disabled={busy} onClick={() => openApprove(company)}><RefreshCw className="mr-1" size={14} /> Reactivate</button>}
                            </div></td>
                        </tr>;
                    })}</tbody>
                </table></div>}
            </section>
        </>}

        <Modal title={approveCompany?.subscriptionStatus === 'PENDING' ? 'Approve subscription' : 'Reactivate subscription'} open={Boolean(approveCompany)} onClose={() => setApproveCompany(null)}>
            {approveCompany && <form className="space-y-4" onSubmit={(event) => submitConfiguration(event, approveCompany, () => setApproveCompany(null))}>{error && <ErrorAlert message={error} />}
                <p className="text-sm text-white-dark">Configure subscription details and grant platform access to {approveCompany.name}.</p>
                <label className="block"><span className="font-semibold">Amount</span><CurrencyInput className="form-input mt-1" min="0" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
                <label className="block"><span className="font-semibold">Term duration (months)</span><input className="form-input mt-1" type="number" min="1" required value={form.termDurationMonths} onChange={(event) => setForm({ ...form, termDurationMonths: event.target.value })} /></label>
                <label className="flex cursor-pointer items-center justify-between rounded-md border border-white-light p-3 dark:border-dark"><span><strong className="block">Auto-renew</strong><small className="text-white-dark">Extend the billing term automatically</small></span><input className="form-checkbox" type="checkbox" checked={form.autoRecur} onChange={(event) => setForm({ ...form, autoRecur: event.target.checked })} /></label>
                <label className="block"><span className="font-semibold">Notes</span><textarea className="form-textarea mt-1" rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
                <div className="flex justify-end gap-2"><button className="btn btn-outline-dark" type="button" onClick={() => setApproveCompany(null)}>Cancel</button><button className="btn btn-success" disabled={Boolean(working)}>{working ? 'Processing…' : 'Approve & grant access'}</button></div>
            </form>}
        </Modal>

        <Modal title="Edit subscription" open={Boolean(editCompany)} onClose={() => setEditCompany(null)}>
            {editCompany && <form className="space-y-4" onSubmit={(event) => submitConfiguration(event, editCompany, () => setEditCompany(null))}>{error && <ErrorAlert message={error} />}
                <p className="text-sm text-white-dark">Update direct subscription details for {editCompany.name} without changing tenant modules.</p>
                <label className="block"><span className="font-semibold">Amount</span><CurrencyInput className="form-input mt-1" min="0" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
                <label className="block"><span className="font-semibold">Term duration (months)</span><input className="form-input mt-1" type="number" min="1" required value={form.termDurationMonths} onChange={(event) => setForm({ ...form, termDurationMonths: event.target.value })} /></label>
                <label className="flex cursor-pointer items-center justify-between rounded-md border border-white-light p-3 dark:border-dark"><span><strong className="block">Auto-renew</strong></span><input className="form-checkbox" type="checkbox" checked={form.autoRecur} onChange={(event) => setForm({ ...form, autoRecur: event.target.checked })} /></label>
                <label className="block"><span className="font-semibold">Notes</span><textarea className="form-textarea mt-1" rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
                <FormActions onCancel={() => setEditCompany(null)} loading={Boolean(working)} saveLabel="Save changes" savingLabel="Saving…" />
            </form>}
        </Modal>
    </AppShell>;
};

export default SuperAdminBillingPage;
