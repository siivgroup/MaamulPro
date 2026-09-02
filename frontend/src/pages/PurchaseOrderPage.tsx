import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppShell from '../components/maamulpro/AppShell';
import { ErrorAlert, LoadingState, Modal, PageHeader, StatusPill, money, shortDate } from '../components/maamulpro/PageKit';
import { usePermissions } from '../hooks/usePermissions';
import { api } from '../lib/api';

const actions: Record<string, { status: string; label: string; tone: string; message: string }[]> = {
    DRAFT: [{ status: 'ORDERED', label: 'Mark ordered', tone: 'primary', message: 'This confirms that the order has been sent to the supplier.' }, { status: 'CANCELLED', label: 'Cancel order', tone: 'danger', message: 'This cancels the draft without changing inventory or accounting.' }],
    ORDERED: [{ status: 'RECEIVED', label: 'Receive stock', tone: 'success', message: 'This will increase inventory, update weighted costs, create the supplier payable, and post the accounting entry.' }, { status: 'CANCELLED', label: 'Cancel order', tone: 'danger', message: 'This cancels the order without receiving stock.' }],
    CANCELLED: [{ status: 'DRAFT', label: 'Reopen draft', tone: 'warning', message: 'This returns the cancelled order to draft.' }],
};

const PurchaseOrderPage = () => {
    const { id = '' } = useParams();
    const { hasPermission } = usePermissions();
    const [order, setOrder] = useState<any>();
    const [pending, setPending] = useState<any>();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const load = async () => { try { setOrder(await api(`/api/materials/purchases/${id}`)); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load purchase order'); } };
    useEffect(() => { void load(); }, [id]);
    const transition = async () => {
        if (!pending) return;
        setSaving(true); setError(''); setMessage('');
        try { await api(`/api/materials/purchases/${id}/status`, { method: 'POST', body: JSON.stringify({ status: pending.status }) }); setPending(undefined); await load(); setMessage(`Purchase order ${pending.label.toLowerCase()}.`); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update purchase order'); }
        finally { setSaving(false); }
    };
    return <AppShell>
        <PageHeader eyebrow="Procurement" title={order?.orderNo || 'Purchase order'} description="Purchase details, receiving status, inventory impact, and supplier payable." actions={<><Link className="btn btn-outline-primary" to="/app/materials/purchases">Back to purchases</Link>{hasPermission('purchases.update') && ['DRAFT', 'ORDERED'].includes(order?.status) && <Link className="btn btn-outline-primary" to={`/app/materials/purchases/${id}/edit`}>Edit</Link>}{hasPermission('purchases.update') && (actions[order?.status] || []).map((item) => <button key={item.status} className={`btn btn-${item.tone}`} onClick={() => setPending(item)}>{item.label}</button>)}</>} />
        {message && <div className="mb-5 rounded-md bg-success-light p-4 text-sm font-semibold text-success">{message}</div>}
        {error && <ErrorAlert message={error} onRetry={load} />}
        {!order ? <div className="panel"><LoadingState /></div> : <div className="space-y-5">
            <section className="panel"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-bold">{order.supplier?.name || 'No supplier'}</h2><p className="mt-1 text-sm text-white-dark">Created {shortDate(order.createdAt)}</p></div><StatusPill value={order.status} /></div><dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-xs font-bold uppercase text-white-dark">Ordered date</dt><dd className="mt-1 font-semibold">{shortDate(order.orderedAt)}</dd></div><div><dt className="text-xs font-bold uppercase text-white-dark">Received date</dt><dd className="mt-1 font-semibold">{shortDate(order.receivedAt)}</dd></div><div><dt className="text-xs font-bold uppercase text-white-dark">Items</dt><dd className="mt-1 font-semibold">{order.items.length}</dd></div><div><dt className="text-xs font-bold uppercase text-white-dark">Total</dt><dd className="mt-1 text-lg font-bold">{money(order.totalCost)}</dd></div></dl>{order.notes && <p className="mt-5 whitespace-pre-wrap border-t border-white-light pt-4 text-sm text-white-dark dark:border-dark">{order.notes}</p>}</section>
            <section className="panel overflow-hidden p-0"><div className="p-5"><h2 className="text-xl font-bold">Order items</h2><p className="text-sm text-white-dark">Quantities and costs used for inventory valuation.</p></div><div className="overflow-x-auto"><table className="table-hover w-full"><thead><tr><th>Material</th><th>Unit</th><th>Warehouse</th><th>Quantity</th><th>Unit cost</th><th>Total</th></tr></thead><tbody>{order.items.map((item: any) => <tr key={item.id}><td className="font-semibold">{item.material?.name}</td><td>{item.material?.unit || '—'}</td><td>{item.material?.warehouse || '—'}</td><td>{Number(item.quantity).toLocaleString()}</td><td>{money(item.unitCost)}</td><td>{money(Number(item.quantity) * Number(item.unitCost))}</td></tr>)}</tbody><tfoot><tr><th colSpan={5} className="text-right">Order total</th><th>{money(order.totalCost)}</th></tr></tfoot></table></div></section>
        </div>}
        <Modal open={Boolean(pending)} onClose={() => !saving && setPending(undefined)} title={pending?.label || 'Update purchase order'}><div className="space-y-4"><p>{pending?.message}</p>{pending?.status === 'RECEIVED' && <div className="rounded-md bg-warning-light p-4 text-sm"><strong>Confirm received stock:</strong> {order?.items.length} item lines totaling {money(order?.totalCost)} from {order?.supplier?.name}.</div>}<div className="flex justify-end gap-2"><button className="btn btn-outline-dark" disabled={saving} onClick={() => setPending(undefined)}>Back</button><button className={`btn btn-${pending?.tone || 'primary'}`} disabled={saving} onClick={transition}>{saving ? 'Please wait…' : pending?.label}</button></div></div></Modal>
    </AppShell>;
};

export default PurchaseOrderPage;
