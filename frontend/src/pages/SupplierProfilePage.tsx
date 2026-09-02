import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppShell from '../components/maamulpro/AppShell';
import { EmptyState, ErrorAlert, LoadingState, Modal, PageHeader, StatGrid, StatusPill, money, shortDate } from '../components/maamulpro/PageKit';
import { usePermissions } from '../hooks/usePermissions';
import { api } from '../lib/api';
import { todayInputValue } from '../lib/date';

type Tab = 'profile' | 'purchases' | 'statement';
const tabs: { id: Tab; label: string }[] = [{ id: 'profile', label: 'Profile' }, { id: 'purchases', label: 'Purchases' }, { id: 'statement', label: 'Account statement' }];

const SupplierProfilePage = () => {
    const { id = '' } = useParams();
    const { hasPermission } = usePermissions();
    const [supplier, setSupplier] = useState<any>();
    const [tab, setTab] = useState<Tab>('profile');
    const [paying, setPaying] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ amount: '', date: todayInputValue(), referenceNo: '', paymentMethod: '', notes: '' });
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const load = async () => { try { setSupplier(await api(`/api/materials/suppliers/${id}`)); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load supplier'); } };
    useEffect(() => { void load(); }, [id]);
    const openPayment = () => { setForm({ amount: String(Number(supplier.balance)), date: todayInputValue(), referenceNo: `SP-${Date.now()}`, paymentMethod: '', notes: '' }); setPaying(true); setError(''); };
    const submitPayment = async (event: FormEvent) => {
        event.preventDefault();
        const amount = Number(form.amount);
        if (!(amount > 0) || amount > Number(supplier.balance)) { setError('Payment must be positive and cannot exceed the outstanding balance.'); return; }
        setSaving(true); setError(''); setMessage('');
        try {
            await api(`/api/materials/suppliers/${id}/payments`, { method: 'POST', body: JSON.stringify({ ...form, amount, date: new Date(`${form.date}T00:00:00`).toISOString(), referenceNo: form.referenceNo.trim(), paymentMethod: form.paymentMethod.trim() || undefined, notes: form.notes.trim() || undefined }) });
            setPaying(false); await load(); setMessage('Supplier payment recorded.'); setTab('statement');
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to record payment'); }
        finally { setSaving(false); }
    };
    const received = supplier?.purchaseOrders.filter((row: any) => row.status === 'RECEIVED') || [];
    return <AppShell>
        <PageHeader eyebrow="Supplier account" title={supplier?.name || 'Supplier profile'} description="Purchases, payments, and outstanding payable balance." actions={<><Link className="btn btn-outline-primary" to="/app/materials/suppliers">Back to suppliers</Link>{hasPermission('suppliers.update') && Number(supplier?.balance) > 0 && <button className="btn btn-primary" onClick={openPayment}>Record payment</button>}</>} />
        {message && <div className="mb-5 rounded-md bg-success-light p-4 text-sm font-semibold text-success">{message}</div>}
        {error && <ErrorAlert message={error} onRetry={load} />}
        {!supplier ? <div className="panel"><LoadingState /></div> : <>
            <StatGrid items={[{ label: 'Purchase orders', value: supplier.purchaseOrders.length }, { label: 'Received purchases', value: received.length }, { label: 'Purchased value', value: money(received.reduce((sum: number, row: any) => sum + Number(row.totalCost), 0)) }, { label: 'Outstanding payable', value: money(supplier.balance), tone: Number(supplier.balance) ? 'danger' : 'success' }]} />
            <div className="panel mb-5 overflow-x-auto p-0"><div className="flex min-w-max border-b border-white-light px-3 pt-2 dark:border-dark" role="tablist" aria-label="Supplier profile sections">{tabs.map((item) => <button type="button" role="tab" aria-selected={tab === item.id} className={`border-b-2 px-5 py-3 font-semibold ${tab === item.id ? 'border-primary text-primary' : 'border-transparent text-white-dark hover:text-primary'}`} onClick={() => setTab(item.id)} key={item.id}>{item.label}{item.id === 'purchases' ? ` (${supplier.purchaseOrders.length})` : item.id === 'statement' ? ` (${supplier.transactions.length})` : ''}</button>)}</div></div>
            {tab === 'profile' && <section className="panel max-w-4xl"><div className="mb-5 flex justify-between"><div><h2 className="text-xl font-bold">Supplier details</h2><p className="text-sm text-white-dark">Contact and account information.</p></div>{hasPermission('suppliers.update') && <Link className="btn btn-sm btn-outline-primary" to={`/app/materials/suppliers/${id}/edit`}>Edit profile</Link>}</div><dl className="grid gap-5 sm:grid-cols-2"><div><dt className="text-xs font-bold uppercase text-white-dark">Name</dt><dd className="mt-1 font-semibold">{supplier.name}</dd></div><div><dt className="text-xs font-bold uppercase text-white-dark">Phone</dt><dd className="mt-1 font-semibold">{supplier.phone || '—'}</dd></div><div><dt className="text-xs font-bold uppercase text-white-dark">Email</dt><dd className="mt-1 font-semibold">{supplier.email || '—'}</dd></div><div><dt className="text-xs font-bold uppercase text-white-dark">Address</dt><dd className="mt-1 font-semibold">{supplier.address || '—'}</dd></div><div className="sm:col-span-2"><dt className="text-xs font-bold uppercase text-white-dark">Notes</dt><dd className="mt-1 whitespace-pre-wrap font-semibold">{supplier.notes || '—'}</dd></div></dl></section>}
            {tab === 'purchases' && <section className="panel overflow-hidden p-0"><div className="overflow-x-auto"><table className="table-hover w-full"><thead><tr><th>Order</th><th>Ordered</th><th>Received</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>{supplier.purchaseOrders.map((row: any) => <tr key={row.id}><td><Link className="font-semibold text-primary hover:underline" to={`/app/materials/purchases/${row.id}`}>{row.orderNo}</Link></td><td>{shortDate(row.orderedAt)}</td><td>{shortDate(row.receivedAt)}</td><td>{row.items.length}</td><td>{money(row.totalCost)}</td><td><StatusPill value={row.status} /></td></tr>)}{!supplier.purchaseOrders.length && <tr><td colSpan={6}><EmptyState title="No purchase orders" /></td></tr>}</tbody></table></div></section>}
            {tab === 'statement' && <section className="panel overflow-hidden p-0"><div className="overflow-x-auto"><table className="table-hover w-full"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th><th>Charge</th><th>Payment</th><th>Balance</th></tr></thead><tbody>{supplier.transactions.map((row: any) => { const amount = Number(row.amount); return <tr key={row.id}><td>{shortDate(row.date)}</td><td><StatusPill value={row.type} /></td><td>{row.referenceNo || row.purchaseOrder?.orderNo || '—'}</td><td>{row.description}</td><td>{amount > 0 ? money(amount) : '—'}</td><td>{amount < 0 ? money(-amount) : '—'}</td><td>{money(row.runningBalance)}</td></tr>; })}{!supplier.transactions.length && <tr><td colSpan={7}><EmptyState title="No supplier transactions" /></td></tr>}</tbody></table></div></section>}
        </>}
        <Modal open={paying} onClose={() => !saving && setPaying(false)} title="Record supplier payment"><form className="space-y-4" onSubmit={submitPayment}><p className="rounded-md bg-warning-light p-3 text-sm">Outstanding payable: <strong>{money(supplier?.balance)}</strong></p><label className="block font-semibold">Amount *<input className="form-input mt-1" required type="number" min="0.01" max={supplier?.balance} step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label><label className="block font-semibold">Payment date *<input className="form-input mt-1" required type="date" max={todayInputValue()} value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label><label className="block font-semibold">Reference number *<input className="form-input mt-1" required value={form.referenceNo} onChange={(event) => setForm({ ...form, referenceNo: event.target.value })} /></label><label className="block font-semibold">Payment method<input className="form-input mt-1" placeholder="Cash, bank transfer…" value={form.paymentMethod} onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })} /></label><label className="block font-semibold">Notes<textarea className="form-textarea mt-1" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><div className="flex justify-end gap-2"><button type="button" className="btn btn-outline-dark" disabled={saving} onClick={() => setPaying(false)}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Record payment'}</button></div></form></Modal>
    </AppShell>;
};

export default SupplierProfilePage;
