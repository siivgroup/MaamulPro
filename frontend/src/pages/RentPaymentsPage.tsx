import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/maamulpro/AppShell';
import { EmptyState, ErrorAlert, LoadingState, Modal, PageHeader, StatGrid, StatusPill, money, shortDate } from '../components/maamulpro/PageKit';
import { useApiRows } from '../hooks/useApiData';
import { usePermissions } from '../hooks/usePermissions';
import { api } from '../lib/api';
import { todayInputValue } from '../lib/date';

type Invoice = {
    id: string; dueDate: string; paidDate?: string; amountDue: number; amountPaid: number; remaining: number;
    status: string; receiptNo?: string; notes?: string; tenant?: { id: string; name: string };
    contract?: { property?: { title: string }; unit?: { name: string }; billingPeriod?: string };
    receipts?: { id: string; amount: number; receivedAt: string; receiptNo?: string; notes?: string }[];
};

const RentPaymentsPage = () => {
    const state = useApiRows<Invoice>('/api/real-estate/rent-payments');
    const { hasPermission } = usePermissions();
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [viewing, setViewing] = useState<Invoice>();
    const [receiving, setReceiving] = useState<Invoice>();
    const [amount, setAmount] = useState('');
    const [receiptNo, setReceiptNo] = useState('');
    const [receivedAt, setReceivedAt] = useState(todayInputValue());
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    const rows = useMemo(() => state.rows.filter((row) => {
        const haystack = `${row.receiptNo || ''} ${row.tenant?.name || ''} ${row.contract?.property?.title || ''} ${row.contract?.unit?.name || ''}`.toLowerCase();
        return (!search || haystack.includes(search.toLowerCase())) && (!status || row.status === status);
    }), [state.rows, search, status]);
    const totals = state.rows.reduce((sum, row) => ({ due: sum.due + Number(row.amountDue), paid: sum.paid + Number(row.amountPaid), remaining: sum.remaining + Number(row.remaining) }), { due: 0, paid: 0, remaining: 0 });

    const openReceipt = (invoice: Invoice) => {
        setReceiving(invoice); setAmount(String(invoice.remaining)); setReceiptNo(''); setReceivedAt(todayInputValue()); setNotes(''); state.setError('');
    };
    const receive = async (event: FormEvent) => {
        event.preventDefault();
        const value = Number(amount);
        if (!receiving || !(value > 0) || value > Number(receiving.remaining)) { state.setError('Receipt amount must be positive and cannot exceed the remaining balance.'); return; }
        setSaving(true); state.setError('');
        try {
            await api(`/api/real-estate/rent-payments/${receiving.id}/receipts`, { method: 'POST', body: JSON.stringify({ amount: value, receivedAt: new Date(`${receivedAt}T00:00:00`).toISOString(), receiptNo: receiptNo.trim() || undefined, notes: notes.trim() || undefined }) });
            setReceiving(undefined); await state.reload();
        } catch (reason) { state.setError(reason instanceof Error ? reason.message : 'Unable to record receipt'); }
        finally { setSaving(false); }
    };

    return <AppShell>
        <PageHeader eyebrow="Rental management" title="Rental invoices" description="Review lease invoices and record receipts against outstanding balances." actions={<Link className="btn btn-outline-primary" to="/app/real-estate/rentals">Rental workspace</Link>} />
        <StatGrid items={[{ label: 'Invoiced', value: money(totals.due) }, { label: 'Received', value: money(totals.paid), tone: 'success' }, { label: 'Outstanding', value: money(totals.remaining), tone: totals.remaining ? 'danger' : 'success' }]} />
        <div className="panel mb-5 flex flex-col gap-3 sm:flex-row"><input className="form-input flex-1" placeholder="Search tenant, property, unit, or invoice…" value={search} onChange={(event) => setSearch(event.target.value)} /><select className="form-select sm:w-56" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{['UNPAID', 'LATE', 'PARTIAL', 'PAID'].map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
        {state.error && <ErrorAlert message={state.error} onRetry={state.reload} />}
        <div className="panel overflow-x-auto p-0">{state.loading ? <LoadingState /> : !rows.length ? <EmptyState title="No rental invoices found" description="Invoices are generated from active leases according to their billing schedule." /> : <table className="table-hover w-full"><thead><tr><th>Invoice</th><th>Tenant</th><th>Property / unit</th><th>Due date</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th><th className="min-w-[190px] whitespace-nowrap text-right">Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.receiptNo || `INV-${row.id.slice(-6).toUpperCase()}`}</td><td>{row.tenant ? <Link className="text-primary" to={`/app/real-estate/tenants/${row.tenant.id}/rental-profile`}>{row.tenant.name}</Link> : '—'}</td><td>{row.contract?.property?.title || '—'} / {row.contract?.unit?.name || '—'}</td><td className="whitespace-nowrap">{shortDate(row.dueDate)}</td><td>{money(row.amountDue)}</td><td>{money(row.amountPaid)}</td><td>{money(row.remaining)}</td><td><StatusPill value={row.status} /></td><td className="whitespace-nowrap text-right"><div className="flex items-center justify-end gap-1.5"><button className="btn btn-sm btn-outline-info" onClick={() => setViewing(row)}>View</button>{hasPermission('rentals.create') && row.remaining > 0 && <button className="btn btn-sm btn-outline-success" onClick={() => openReceipt(row)}>Receive payment</button>}</div></td></tr>)}</tbody></table>}</div>
        <Modal open={Boolean(viewing)} onClose={() => setViewing(undefined)} title="Rental invoice details" wide>{viewing && <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div><p className="text-xs font-bold uppercase text-white-dark">Invoice</p><p className="font-semibold">{viewing.receiptNo || `INV-${viewing.id.slice(-6).toUpperCase()}`}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Tenant</p><p className="font-semibold">{viewing.tenant?.name}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Due</p><p className="font-semibold">{shortDate(viewing.dueDate)}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Status</p><StatusPill value={viewing.status} /></div><div><p className="text-xs font-bold uppercase text-white-dark">Amount</p><p className="font-semibold">{money(viewing.amountDue)}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Paid</p><p className="font-semibold">{money(viewing.amountPaid)}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Balance</p><p className="font-semibold">{money(viewing.remaining)}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Unit</p><p className="font-semibold">{viewing.contract?.property?.title} / {viewing.contract?.unit?.name}</p></div></div><div><h3 className="font-bold">Receipts</h3>{viewing.receipts?.length ? <div className="mt-2 overflow-x-auto"><table className="table-hover"><thead><tr><th>Date</th><th>Receipt</th><th>Amount</th><th>Notes</th></tr></thead><tbody>{viewing.receipts.map((receipt) => <tr key={receipt.id}><td>{shortDate(receipt.receivedAt)}</td><td>{receipt.receiptNo || '—'}</td><td>{money(receipt.amount)}</td><td>{receipt.notes || '—'}</td></tr>)}</tbody></table></div> : <p className="mt-2 text-sm text-white-dark">No receipts recorded.</p>}</div></div>}</Modal>
        <Modal open={Boolean(receiving)} onClose={() => !saving && setReceiving(undefined)} title="Receive rental payment"><form className="space-y-4" onSubmit={receive}><div className="rounded-md bg-primary-light p-3 text-sm">Invoice balance: <strong>{money(receiving?.remaining)}</strong></div><label className="block font-semibold">Amount received *<input className="form-input mt-1" required type="number" min="0.01" max={receiving?.remaining} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label className="block font-semibold">Received date *<input className="form-input mt-1" required type="date" max={todayInputValue()} value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></label><label className="block font-semibold">Receipt number<input className="form-input mt-1" value={receiptNo} onChange={(event) => setReceiptNo(event.target.value)} /></label><label className="block font-semibold">Notes<textarea className="form-textarea mt-1" value={notes} onChange={(event) => setNotes(event.target.value)} /></label><div className="flex justify-end gap-2"><button className="btn btn-outline-dark" type="button" disabled={saving} onClick={() => setReceiving(undefined)}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Record receipt'}</button></div></form></Modal>
    </AppShell>;
};

export default RentPaymentsPage;
