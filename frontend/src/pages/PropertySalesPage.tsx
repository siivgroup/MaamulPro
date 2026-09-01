import { Link } from 'react-router-dom';
import AppShell from '../components/maamulpro/AppShell';
import { EmptyState, ErrorAlert, LoadingState, PageHeader, StatGrid, StatusPill, money, shortDate } from '../components/maamulpro/PageKit';
import { useApiRows } from '../hooks/useApiData';
import { usePermissions } from '../hooks/usePermissions';

const PropertySalesPage = () => {
    const { hasPermission } = usePermissions();
    const state = useApiRows<any>('/api/real-estate/deals'); const rows = state.rows.filter((row) => row.type === 'SALE');
    return <AppShell><PageHeader eyebrow="Real estate revenue" title="Property sales" description="Sales pipeline, settlement status, collections and outstanding balances." actions={hasPermission('deals.create') ? <Link className="btn btn-primary" to="/app/real-estate/sales/new">New sale</Link> : undefined} />
        <StatGrid items={[{ label: 'Sales', value: rows.length }, { label: 'Contracted value', value: money(rows.reduce((sum, row) => sum + Number(row.totalAmount), 0)), tone: 'info' }, { label: 'Collected', value: money(rows.reduce((sum, row) => sum + Number(row.paidAmount), 0)), tone: 'success' }, { label: 'Outstanding', value: money(rows.reduce((sum, row) => sum + Number(row.totalAmount) - Number(row.paidAmount), 0)), tone: 'danger' }]} />
        {state.error && <ErrorAlert message={state.error} onRetry={state.reload} />}{state.loading ? <div className="panel"><LoadingState /></div> : !rows.length ? <div className="panel"><EmptyState title="No property sales" description="Create a sale to begin tracking settlement." action={hasPermission('deals.create') ? <Link className="btn btn-primary" to="/app/real-estate/sales/new">New sale</Link> : undefined} /></div> : <div className="panel overflow-hidden p-0"><div className="overflow-x-auto"><table className="table-hover"><thead><tr><th>Property</th><th>Buyer</th><th>Closed</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.property?.title}</td><td>{row.client?.name}</td><td>{shortDate(row.closedAt)}</td><td>{money(row.totalAmount)}</td><td className="text-success">{money(row.paidAmount)}</td><td className="text-danger">{money(Number(row.totalAmount) - Number(row.paidAmount))}</td><td><StatusPill value={row.paymentStatus} /></td><td><Link className="text-primary" to={`/app/real-estate/sales/${row.id}`}>Open</Link></td></tr>)}</tbody></table></div></div>}
    </AppShell>;
};

export default PropertySalesPage;
