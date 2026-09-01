import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/maamulpro/AppShell';
import { EmptyState, ErrorAlert, LoadingState, PageHeader, StatGrid, StatusPill, money, shortDate } from '../components/maamulpro/PageKit';
import { api } from '../lib/api';
import { unwrapRows } from '../hooks/useApiData';
import { usePermissions } from '../hooks/usePermissions';

type State = { properties: any[]; clients: any[]; deals: any[]; contracts: any[]; payments: any[] };

const RealEstateOverviewPage = () => {
    const { hasPermission, hasAnyPermission } = usePermissions();
    const [data, setData] = useState<State | null>(null); const [error, setError] = useState('');
    const read = (permission: string, url: string) => hasPermission(permission) ? api<unknown>(url) : Promise.resolve([]);
    const load = () => Promise.all([read('properties.read', '/api/real-estate/properties'), hasAnyPermission(['clients.read', 'rentals.read']) ? api<unknown>('/api/real-estate/tenants') : Promise.resolve([]), read('deals.read', '/api/real-estate/deals'), read('rentals.read', '/api/real-estate/rental-contracts'), read('rentals.read', '/api/real-estate/rent-payments')])
        .then(([properties, clients, deals, contracts, payments]) => setData({ properties: unwrapRows(properties), clients: unwrapRows(clients), deals: unwrapRows(deals), contracts: unwrapRows(contracts), payments: unwrapRows(payments) })).catch((reason) => setError(reason.message));
    useEffect(() => { load(); }, []);
    const revenue = data?.deals.reduce((sum, deal) => sum + Number(deal.paidAmount || 0), 0) || 0;
    const outstanding = data?.payments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amountDue || 0) - Number(payment.amountPaid || 0)), 0) || 0;
    return <AppShell>
        <PageHeader eyebrow="Real estate workspace" title="Portfolio overview" description="Property availability, client activity, sales, rentals and collection health." actions={<>{hasPermission('reports.real_estate.read') && <Link className="btn btn-outline-primary" to="/app/real-estate/reports">Reports</Link>}{hasPermission('properties.create') && <Link className="btn btn-primary" to="/app/real-estate/properties/new">Add property</Link>}</>} />
        {error && <ErrorAlert message={error} onRetry={load} />}
        {!data ? <div className="panel"><LoadingState /></div> : <>
            <StatGrid items={[
                { label: 'Properties', value: data.properties.length, hint: `${data.properties.filter((row) => row.status === 'AVAILABLE').length} available` },
                { label: 'Active leases', value: data.contracts.filter((row) => row.status === 'ACTIVE').length, tone: 'info' },
                { label: 'Sales collections', value: money(revenue), tone: 'success' },
                { label: 'Rent outstanding', value: money(outstanding), tone: 'danger' },
            ]} />
            <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
                { title: 'Properties', to: '/app/real-estate/properties', description: 'Listings and occupancy', visible: hasPermission('properties.read') },
                { title: 'Clients', to: '/app/real-estate/clients', description: `${data.clients.length} contacts`, visible: hasAnyPermission(['clients.read', 'rentals.read']) },
                { title: 'Sales', to: '/app/real-estate/sales', description: 'Sales and collections', visible: hasPermission('deals.read') },
                { title: 'Rentals', to: '/app/real-estate/rentals', description: 'Tenants, leases and rent', visible: hasPermission('rentals.read') },
            ].filter((tile) => tile.visible).map((tile) => <Link className="panel transition hover:-translate-y-1 hover:border-primary" to={tile.to} key={tile.to}><h2 className="font-bold text-primary">{tile.title}</h2><p className="mt-1 text-sm text-white-dark">{tile.description}</p></Link>)}</div>
            <div className="grid gap-6 xl:grid-cols-2">
                {hasPermission('deals.read') && <div className="panel overflow-hidden p-0"><div className="flex items-center justify-between p-5"><div><h2 className="text-lg font-bold">Recent sales</h2><p className="text-sm text-white-dark">Latest property sale settlements</p></div><Link to="/app/real-estate/sales" className="text-primary">View all</Link></div>{!data.deals.length ? <EmptyState title="No sales yet" description="Record a property sale to start tracking settlement." action={hasPermission('deals.create') ? <Link className="btn btn-primary" to="/app/real-estate/sales/new">Create first sale</Link> : undefined} /> : <div className="overflow-x-auto"><table className="table-hover"><thead><tr><th>Property</th><th>Buyer</th><th>Collected</th><th>Status</th></tr></thead><tbody>{data.deals.slice(0, 8).map((deal) => <tr key={deal.id}><td><Link className="text-primary" to={`/app/real-estate/sales/${deal.id}`}>{deal.property?.title || 'Property'}</Link></td><td>{deal.client?.name}</td><td>{money(deal.paidAmount)}</td><td><StatusPill value={deal.paymentStatus} /></td></tr>)}</tbody></table></div>}</div>}
                {hasPermission('rentals.read') && <div className="panel overflow-hidden p-0"><div className="flex items-center justify-between p-5"><div><h2 className="text-lg font-bold">Rent collection</h2><p className="text-sm text-white-dark">Latest tenant obligations</p></div><Link to="/app/real-estate/rent-payments" className="text-primary">View all</Link></div>{!data.payments.length ? <EmptyState title="No rent payments" description="Rent payments appear here once you generate monthly invoices from the Rentals workspace." action={<Link className="btn btn-outline-primary" to="/app/real-estate/rentals">Open Rentals</Link>} /> : <div className="overflow-x-auto"><table className="table-hover"><thead><tr><th>Tenant</th><th>Due</th><th>Amount</th><th>Status</th></tr></thead><tbody>{data.payments.slice(0, 8).map((row) => <tr key={row.id}><td>{row.tenant?.name || 'Tenant'}</td><td>{shortDate(row.dueDate)}</td><td>{money(row.amountDue)}</td><td><StatusPill value={row.status} /></td></tr>)}</tbody></table></div>}</div>}
            </div>
        </>}
    </AppShell>;
};

export default RealEstateOverviewPage;
