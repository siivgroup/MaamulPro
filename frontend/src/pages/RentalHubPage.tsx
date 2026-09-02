import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/maamulpro/AppShell';
import { EmptyState, ErrorAlert, LoadingState, Modal, PageHeader, StatGrid, StatusPill, money, shortDate } from '../components/maamulpro/PageKit';
import { api } from '../lib/api';
import { unwrapRows } from '../hooks/useApiData';
import { usePermissions } from '../hooks/usePermissions';

type State = { tenants: any[]; properties: any[]; units: any[]; contracts: any[]; payments: any[] };

const currentMonthValue = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

const RentalHubPage = () => {
    const { hasPermission } = usePermissions();
    const canCreate = hasPermission('rentals.create');
    const [data, setData] = useState<State | null>(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [generating, setGenerating] = useState(false);
    const [invoiceMonth, setInvoiceMonth] = useState<string | null>(null);

    const load = () => api<State>('/api/real-estate/rentals/workspace')
        .then((workspace) => setData({ tenants: unwrapRows(workspace.tenants), properties: unwrapRows(workspace.properties), units: unwrapRows(workspace.units), contracts: unwrapRows(workspace.contracts), payments: unwrapRows(workspace.payments) }))
        .catch((reason) => setError(reason.message));
    useEffect(() => { load(); }, []);

    const openGenerateInvoices = () => { setError(''); setMessage(''); setInvoiceMonth(currentMonthValue()); };
    const confirmGenerateInvoices = async () => {
        if (!invoiceMonth) return;
        setGenerating(true);
        try {
            const [year, month] = invoiceMonth.split('-').map(Number);
            const date = new Date(Date.UTC(year, month - 1, 1)).toISOString();
            const res = await api<{ message: string }>('/api/real-estate/generate-rent-invoices', { method: 'POST', body: JSON.stringify({ date }) });
            setMessage(res.message);
            setInvoiceMonth(null);
            await load();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate rental invoices');
        } finally {
            setGenerating(false);
        }
    };

    const activeContracts = data?.contracts.filter((row) => row.status === 'ACTIVE').length || 0;
    const hasTenants = (data?.tenants.length || 0) > 0;
    const hasProperties = (data?.properties.length || 0) > 0;
    const availableUnits = data?.units.filter((unit) => unit.status === 'AVAILABLE').length || 0;
    const canStartLease = hasTenants && hasProperties && availableUnits > 0;

    return <AppShell>
        <PageHeader eyebrow="Rental management" title="Rentals" description="Tenants, leases, renewals, payment obligations and collections in one workspace." actions={<>
            <Link className="btn btn-outline-primary" to="/app/real-estate/clients">Manage tenants</Link>
            <Link className="btn btn-outline-primary" to="/app/real-estate/units">Manage units</Link>
            {canCreate && activeContracts > 0 && <button className="btn btn-outline-success" disabled={generating} onClick={openGenerateInvoices}>Generate invoices</button>}
            {canCreate && (canStartLease
                ? <Link className="btn btn-primary" to="/app/real-estate/rental-contracts/new">New lease</Link>
                : <span title={!hasProperties ? 'Add a property first' : 'Add a tenant first'}><button className="btn btn-primary" disabled>New lease</button></span>)}
        </>} />
        {message && <div className="mb-5 rounded-md bg-success-light p-4 text-sm font-semibold text-success">{message}</div>}
        {error && <ErrorAlert message={error} onRetry={load} />}
        {!data ? <div className="panel"><LoadingState /></div> : <>
            {canCreate && !canStartLease && <div className="mb-5 rounded-md border border-warning bg-warning-light p-4 text-sm">
                <p className="font-semibold">Before you can create a lease, add {[!hasProperties && 'a property', !hasTenants && 'a tenant', hasProperties && !availableUnits && 'an available unit'].filter(Boolean).join(' and ')}.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                    {!hasProperties && <Link className="btn btn-sm btn-outline-primary" to="/app/real-estate/properties/new">Add property</Link>}
                    {!hasTenants && <Link className="btn btn-sm btn-outline-primary" to="/app/real-estate/tenants">Add tenant</Link>}
                    {hasProperties && !availableUnits && <Link className="btn btn-sm btn-outline-primary" to="/app/real-estate/units">Add units</Link>}
                </div>
            </div>}
            <StatGrid items={[
                { label: 'Tenants', value: data.tenants.length },
                { label: 'Active leases', value: activeContracts, tone: 'success' },
                { label: 'Monthly contracted', value: money(data.contracts.filter((row) => row.status === 'ACTIVE').reduce((sum, row) => sum + Number(row.monthlyRent || 0), 0)), tone: 'info' },
                { label: 'Late / unpaid', value: data.payments.filter((row) => ['LATE', 'UNPAID'].includes(row.status)).length, tone: 'danger' },
            ]} />
            <div className="grid gap-6 xl:grid-cols-2">
                <div className="panel overflow-hidden p-0">
                    <div className="flex justify-between p-5"><h2 className="text-lg font-bold">Lease register</h2><Link className="text-primary" to="/app/real-estate/rental-contracts">Manage</Link></div>
                    {!data.contracts.length ? <EmptyState title="No rental contracts yet" description={canStartLease ? 'Create the first lease for an available unit.' : 'Add a property, unit and tenant before creating your first lease.'} action={canCreate && canStartLease ? <Link className="btn btn-primary" to="/app/real-estate/rental-contracts/new">New lease</Link> : undefined} />
                        : <div className="overflow-x-auto"><table className="table-hover"><thead><tr><th>Tenant</th><th>Property / unit</th><th>Monthly rent</th><th>Ends</th><th>Status</th></tr></thead><tbody>{data.contracts.slice(0, 12).map((row) => <tr key={row.id}><td><Link className="text-primary" to={`/app/real-estate/tenants/${row.tenantId}/rental-profile`}>{row.tenant?.name}</Link></td><td>{row.property?.title} / {row.unit?.name || 'Legacy property lease'}</td><td>{money(row.monthlyRent)}</td><td>{row.endDate ? shortDate(row.endDate) : 'Open-ended'}</td><td><StatusPill value={row.status} /></td></tr>)}</tbody></table></div>}
                </div>
                <div className="panel overflow-hidden p-0">
                    <div className="flex justify-between p-5"><h2 className="text-lg font-bold">Payment obligations</h2><Link className="text-primary" to="/app/real-estate/rent-payments">Manage</Link></div>
                    {!data.payments.length ? <EmptyState title="No rental invoices" description={activeContracts > 0 ? 'Generate invoices for active leases according to their billing periods.' : 'Invoices appear automatically after an active lease reaches its billing date.'} action={canCreate && activeContracts > 0 ? <button className="btn btn-primary" onClick={openGenerateInvoices}>Generate invoices</button> : undefined} />
                        : <div className="overflow-x-auto"><table className="table-hover"><thead><tr><th>Tenant</th><th>Due</th><th>Paid</th><th>Status</th></tr></thead><tbody>{data.payments.slice(0, 12).map((row) => <tr key={row.id}><td>{row.tenant?.name}</td><td>{money(row.amountDue)}</td><td>{money(row.amountPaid)}</td><td><StatusPill value={row.status} /></td></tr>)}</tbody></table></div>}
                </div>
            </div>
        </>}
        <Modal open={Boolean(invoiceMonth)} onClose={() => !generating && setInvoiceMonth(null)} title="Generate rental invoices">
            <div className="space-y-4">
                <p className="text-sm text-white-dark">This creates invoices due in the selected month using each lease's monthly, quarterly, or yearly billing period. Existing invoices are skipped.</p>
                <div>
                    <label className="font-semibold" htmlFor="invoice-month">Month</label>
                    <input id="invoice-month" type="month" className="form-input mt-1" value={invoiceMonth || ''} onChange={(e) => setInvoiceMonth(e.target.value)} />
                </div>
                <div className="rounded-md bg-primary-light p-3 text-sm"><span className="font-semibold">{activeContracts}</span> active lease{activeContracts === 1 ? '' : 's'} will be considered.</div>
                <div className="flex justify-end gap-2 border-t border-white-light pt-4 dark:border-[#191e3a]">
                    <button className="btn btn-outline-dark" disabled={generating} onClick={() => setInvoiceMonth(null)}>Cancel</button>
                    <button className="btn btn-primary" disabled={generating || !invoiceMonth} onClick={confirmGenerateInvoices}>{generating ? 'Generating…' : 'Generate invoices'}</button>
                </div>
            </div>
        </Modal>
    </AppShell>;
};

export default RentalHubPage;
