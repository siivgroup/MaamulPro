import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppShell from '../components/maamulpro/AppShell';
import { EmptyState, ErrorAlert, LoadingState, Modal, PageHeader, StatGrid, StatusPill, money, shortDate } from '../components/maamulpro/PageKit';
import { usePermissions } from '../hooks/usePermissions';
import { api } from '../lib/api';
import { todayInputValue } from '../lib/date';

type Tab = 'profile' | 'leases' | 'invoices' | 'receipts';
const tabs: { id: Tab; label: string }[] = [{ id: 'profile', label: 'Profile' }, { id: 'leases', label: 'Leases' }, { id: 'invoices', label: 'Invoices' }, { id: 'receipts', label: 'Receipts' }];
const emptyProfile = { name: '', email: '', phone: '', nationalIdPassport: '', notes: '' };

const TenantRentalProfilePage = () => {
    const { id = '' } = useParams();
    const { hasPermission, hasAnyPermission } = usePermissions();
    const [profile, setProfile] = useState<any>();
    const [tab, setTab] = useState<Tab>('profile');
    const [profileForm, setProfileForm] = useState(emptyProfile);
    const [editingProfile, setEditingProfile] = useState(false);
    const [invoice, setInvoice] = useState<any>();
    const [amount, setAmount] = useState('');
    const [receiptNo, setReceiptNo] = useState('');
    const [receivedAt, setReceivedAt] = useState(todayInputValue());
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    const load = async () => {
        setError('');
        try {
            const result = await api<any>(`/api/real-estate/tenants/${id}/rental-profile`);
            setProfile(result);
            setProfileForm({ name: result.tenant.name || '', email: result.tenant.email || '', phone: result.tenant.phone || '', nationalIdPassport: result.tenant.nationalIdPassport || '', notes: result.tenant.notes || '' });
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load client profile'); }
    };
    useEffect(() => { void load(); }, [id]);

    const saveProfile = async (event: FormEvent) => {
        event.preventDefault();
        if (!profileForm.name.trim()) { setError('Name is required.'); return; }
        setSaving(true); setError(''); setMessage('');
        try {
            await api(`/api/real-estate/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(Object.fromEntries(Object.entries(profileForm).map(([key, value]) => [key, value.trim() || undefined]))) });
            await load(); setEditingProfile(false); setMessage('Client profile updated.');
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update client profile'); }
        finally { setSaving(false); }
    };
    const openReceipt = (row: any) => { setInvoice(row); setAmount(String(row.remaining)); setReceiptNo(''); setReceivedAt(todayInputValue()); setNotes(''); setError(''); };
    const receive = async (event: FormEvent) => {
        event.preventDefault();
        const received = Number(amount);
        if (!invoice || !(received > 0) || received > Number(invoice.remaining)) { setError('Receipt amount must be positive and cannot exceed the remaining balance.'); return; }
        setSaving(true); setError(''); setMessage('');
        try {
            await api(`/api/real-estate/rent-payments/${invoice.id}/receipts`, { method: 'POST', body: JSON.stringify({ amount: received, receivedAt: new Date(`${receivedAt}T00:00:00`).toISOString(), receiptNo: receiptNo.trim() || undefined, notes: notes.trim() || undefined }) });
            setInvoice(undefined); await load(); setMessage('Receipt recorded.');
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to record receipt'); }
        finally { setSaving(false); }
    };

    const activeLeases = profile?.contracts.filter((lease: any) => ['ACTIVE', 'RENEWAL_DUE'].includes(lease.status)) || [];
    const previousLeases = profile?.contracts.filter((lease: any) => !['ACTIVE', 'RENEWAL_DUE'].includes(lease.status)) || [];
    const canEditProfile = hasAnyPermission(['clients.update', 'rentals.update']);
    const leaseCards = (leases: any[]) => leases.length ? <div className="grid gap-3 lg:grid-cols-2">{leases.map((lease) => <article className="rounded-md border border-white-light p-4 dark:border-dark" key={lease.id}><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold">{lease.property?.title}</h3><p className="text-sm text-white-dark">Unit {lease.unit?.name || '—'} · {lease.unit?.floor ? `Floor ${lease.unit.floor}` : 'Floor not set'}</p></div><StatusPill value={lease.status} /></div><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-white-dark">Period</dt><dd>{shortDate(lease.startDate)} – {lease.endDate ? shortDate(lease.endDate) : 'Open-ended'}</dd></div><div><dt className="text-white-dark">Rent</dt><dd>{money(lease.monthlyRent)} monthly</dd></div><div><dt className="text-white-dark">Billing</dt><dd>{String(lease.billingPeriod).replace('_', ' ')}</dd></div><div><dt className="text-white-dark">Renewal</dt><dd>{lease.renewalDate ? shortDate(lease.renewalDate) : '—'}</dd></div></dl>{lease.notes && <p className="mt-3 text-sm text-white-dark">{lease.notes}</p>}</article>)}</div> : <EmptyState title="No leases in this section" />;

    return <AppShell>
        <PageHeader eyebrow="Client account" title={profile?.tenant?.name || 'Client profile'} description="Contact details, leases, invoices, receipts, and account balances." actions={<><Link className="btn btn-outline-primary" to="/app/real-estate/clients">Back to clients</Link><Link className="btn btn-outline-primary" to="/app/real-estate/rent-payments">Rental invoices</Link></>} />
        {message && <div className="mb-5 rounded-md bg-success-light p-4 text-sm font-semibold text-success">{message}</div>}
        {error && <ErrorAlert message={error} onRetry={load} />}
        {!profile ? <div className="panel"><LoadingState /></div> : <>
            <StatGrid items={[{ label: 'Active leases', value: activeLeases.length, tone: 'info' }, { label: 'Invoiced', value: money(profile.totals.due) }, { label: 'Received', value: money(profile.totals.paid), tone: 'success' }, { label: 'Outstanding', value: money(profile.totals.balance), tone: profile.totals.balance ? 'danger' : 'success' }]} />
            <div className="panel mb-5 overflow-x-auto p-0"><div className="flex min-w-max border-b border-white-light px-3 pt-2 dark:border-dark" role="tablist" aria-label="Client profile sections">{tabs.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} className={`border-b-2 px-5 py-3 font-semibold transition-colors ${tab === item.id ? 'border-primary text-primary' : 'border-transparent text-white-dark hover:text-primary'}`} onClick={() => setTab(item.id)} key={item.id}>{item.label}{item.id === 'leases' ? ` (${profile.contracts.length})` : item.id === 'invoices' ? ` (${profile.invoices.length})` : item.id === 'receipts' ? ` (${profile.receipts.length})` : ''}</button>)}</div></div>

            {tab === 'profile' && <section className="panel max-w-4xl"><div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-bold">Profile details</h2><p className="text-sm text-white-dark">Client identity and contact information.</p></div>{canEditProfile && !editingProfile && <button className="btn btn-sm btn-outline-primary" onClick={() => setEditingProfile(true)}>Edit profile</button>}</div>{editingProfile ? <form className="space-y-4" onSubmit={saveProfile}><div className="grid gap-4 sm:grid-cols-2"><label className="font-semibold">Name *<input className="form-input mt-1" required value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} /></label><label className="font-semibold">Email<input className="form-input mt-1" type="email" value={profileForm.email} onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })} /></label><label className="font-semibold">Phone<input className="form-input mt-1" value={profileForm.phone} onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })} /></label><label className="font-semibold">National ID / Passport<input className="form-input mt-1" value={profileForm.nationalIdPassport} onChange={(event) => setProfileForm({ ...profileForm, nationalIdPassport: event.target.value })} /></label><label className="font-semibold sm:col-span-2">Notes<textarea className="form-textarea mt-1" value={profileForm.notes} onChange={(event) => setProfileForm({ ...profileForm, notes: event.target.value })} /></label></div><div className="flex justify-end gap-2"><button className="btn btn-outline-dark" type="button" disabled={saving} onClick={() => { setEditingProfile(false); setProfileForm({ name: profile.tenant.name || '', email: profile.tenant.email || '', phone: profile.tenant.phone || '', nationalIdPassport: profile.tenant.nationalIdPassport || '', notes: profile.tenant.notes || '' }); }}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button></div></form> : <dl className="grid gap-5 sm:grid-cols-2"><div><dt className="text-xs font-bold uppercase text-white-dark">Name</dt><dd className="mt-1 font-semibold">{profile.tenant.name}</dd></div><div><dt className="text-xs font-bold uppercase text-white-dark">Email</dt><dd className="mt-1 font-semibold">{profile.tenant.email || '—'}</dd></div><div><dt className="text-xs font-bold uppercase text-white-dark">Phone</dt><dd className="mt-1 font-semibold">{profile.tenant.phone || '—'}</dd></div><div><dt className="text-xs font-bold uppercase text-white-dark">National ID / Passport</dt><dd className="mt-1 font-semibold">{profile.tenant.nationalIdPassport || '—'}</dd></div><div className="sm:col-span-2"><dt className="text-xs font-bold uppercase text-white-dark">Notes</dt><dd className="mt-1 whitespace-pre-wrap font-semibold">{profile.tenant.notes || '—'}</dd></div></dl>}</section>}

            {tab === 'leases' && <section className="space-y-6"><div className="panel"><h2 className="mb-4 text-xl font-bold">Active leases</h2>{leaseCards(activeLeases)}</div><div className="panel"><h2 className="mb-4 text-xl font-bold">Previous leases</h2>{leaseCards(previousLeases)}</div></section>}

            {tab === 'invoices' && <section className="panel overflow-hidden p-0"><div className="p-5"><h2 className="text-xl font-bold">Rental invoices</h2><p className="text-sm text-white-dark">All billed periods and outstanding balances.</p></div><div className="overflow-x-auto"><table className="table-hover"><thead><tr><th>Invoice</th><th>Due</th><th>Property / unit</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th><th className="text-right">Actions</th></tr></thead><tbody>{profile.invoices.map((row: any) => <tr key={row.id}><td>{row.receiptNo || `INV-${row.id.slice(-6).toUpperCase()}`}</td><td>{shortDate(row.dueDate)}</td><td>{row.contract?.property?.title} / {row.contract?.unit?.name || '—'}</td><td>{money(row.amountDue)}</td><td>{money(row.amountPaid)}</td><td>{money(row.remaining)}</td><td><StatusPill value={row.status} /></td><td className="text-right">{hasPermission('rentals.create') && row.remaining > 0 && <button className="btn btn-sm btn-outline-success" onClick={() => openReceipt(row)}>Receive payment</button>}</td></tr>)}{!profile.invoices.length && <tr><td className="p-6 text-center text-white-dark" colSpan={8}>No rental invoices.</td></tr>}</tbody></table></div></section>}

            {tab === 'receipts' && <section className="panel overflow-hidden p-0"><div className="p-5"><h2 className="text-xl font-bold">Receipt history</h2><p className="text-sm text-white-dark">Every payment recorded against this client's invoices.</p></div><div className="overflow-x-auto"><table className="table-hover"><thead><tr><th>Date</th><th>Receipt number</th><th>Property / unit</th><th>Amount</th><th>Notes</th></tr></thead><tbody>{profile.receipts.map((receipt: any) => { const related = profile.invoices.find((item: any) => item.id === receipt.invoiceId); return <tr key={receipt.id}><td>{shortDate(receipt.receivedAt)}</td><td>{receipt.receiptNo || '—'}</td><td>{related?.contract?.property?.title || '—'} / {related?.contract?.unit?.name || '—'}</td><td>{money(receipt.amount)}</td><td>{receipt.notes || '—'}</td></tr>; })}{!profile.receipts.length && <tr><td className="p-6 text-center text-white-dark" colSpan={5}>No receipts recorded.</td></tr>}</tbody></table></div></section>}
        </>}
        <Modal open={Boolean(invoice)} onClose={() => !saving && setInvoice(undefined)} title="Receive rental payment"><form className="space-y-4" onSubmit={receive}><p className="rounded-md bg-primary-light p-3 text-sm">Remaining balance: <strong>{money(invoice?.remaining)}</strong></p><label className="block font-semibold">Amount received *<input className="form-input mt-1" required type="number" min="0.01" max={invoice?.remaining} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label className="block font-semibold">Received date *<input className="form-input mt-1" required type="date" max={todayInputValue()} value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></label><label className="block font-semibold">Receipt number<input className="form-input mt-1" value={receiptNo} onChange={(event) => setReceiptNo(event.target.value)} /></label><label className="block font-semibold">Notes<textarea className="form-textarea mt-1" value={notes} onChange={(event) => setNotes(event.target.value)} /></label><div className="flex justify-end gap-2"><button className="btn btn-outline-dark" type="button" disabled={saving} onClick={() => setInvoice(undefined)}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Record receipt'}</button></div></form></Modal>
    </AppShell>;
};

export default TenantRentalProfilePage;
