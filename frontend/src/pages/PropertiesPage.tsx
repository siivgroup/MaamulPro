import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/maamulpro/AppShell';
import { AuthenticatedImage } from '../components/maamulpro/AuthenticatedImage';
import { EmptyState, ErrorAlert, LoadingState, Modal, PageHeader, StatGrid, StatusPill, money } from '../components/maamulpro/PageKit';
import { useApiRows } from '../hooks/useApiData';
import { usePermissions } from '../hooks/usePermissions';
import { api } from '../lib/api';

const PropertiesPage = () => {
    const state = useApiRows<any>('/api/real-estate/properties'); const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [type, setType] = useState('');
    const { hasPermission } = usePermissions();
    const [deleteTarget, setDeleteTarget] = useState<any>(null);
    const [deleting, setDeleting] = useState(false);
    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await api(`/api/real-estate/properties/${deleteTarget.id}`, { method: 'DELETE' });
            setDeleteTarget(null);
            await state.reload();
        } catch (reason) {
            state.setError(reason instanceof Error ? reason.message : 'Unable to delete property');
        } finally {
            setDeleting(false);
        }
    };
    const rows = useMemo(() => state.rows.filter((row) => (!status || row.status === status) && (!type || row.type === type) && JSON.stringify(row).toLowerCase().includes(search.toLowerCase())), [state.rows, search, status, type]);
    return <AppShell>
        <PageHeader eyebrow="Real estate" title="Properties" description="Portfolio listings, valuation, occupancy and transaction history." actions={hasPermission('properties.create') ? <Link className="btn btn-primary" to="/app/real-estate/properties/new">Add property</Link> : undefined} />
        <StatGrid items={[{ label: 'Portfolio', value: state.rows.length }, { label: 'Available', value: state.rows.filter((row) => row.status === 'AVAILABLE').length, tone: 'success' }, { label: 'Occupied / sold', value: state.rows.filter((row) => ['RENTED', 'SOLD'].includes(row.status)).length, tone: 'info' }, { label: 'Portfolio value', value: money(state.rows.reduce((sum, row) => sum + Number(row.price || 0), 0)), tone: 'warning' }]} />
        <div className="panel mb-5 grid gap-3 md:grid-cols-3"><input className="form-input" placeholder="Search title, address…" value={search} onChange={(e) => setSearch(e.target.value)} /><select className="form-select" value={type} onChange={(e) => setType(e.target.value)}><option value="">All types</option>{['HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL'].map((value) => <option key={value}>{value}</option>)}</select><select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['AVAILABLE', 'SOLD', 'RENTED', 'UNDER_CONTRACT'].map((value) => <option key={value}>{value.replace(/_/g, ' ')}</option>)}</select></div>
        {state.error && <ErrorAlert message={state.error} onRetry={state.reload} />}
        {state.loading ? <div className="panel"><LoadingState /></div> : !rows.length ? <div className="panel"><EmptyState title="No matching properties" /></div> : <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{rows.map((property) => <article className="panel overflow-hidden p-0" key={property.id}>
            {property.imageUrl ? <AuthenticatedImage className="h-48 w-full object-cover" src={property.imageUrl} alt="" /> : <div className="grid h-36 place-items-center bg-gradient-to-br from-primary/70 to-info text-4xl text-white">⌂</div>}
            <div className="p-5"><div className="flex justify-between gap-2"><div><h2 className="text-xl font-bold">{property.title}</h2><p className="text-sm text-white-dark">{property.address || 'Address not set'}</p></div><StatusPill value={property.status} /></div><p className="mt-4 text-2xl font-black text-primary">{money(property.price)}</p><div className="mt-3 flex gap-4 text-sm text-white-dark"><span>{property.type}</span>{property.area ? <span>{property.area} m²</span> : null}{property.bedrooms ? <span>{property.bedrooms} beds</span> : null}</div><div className="mt-5 flex gap-2"><Link className="btn btn-sm btn-primary flex-1" to={`/app/real-estate/properties/${property.id}`}>View property</Link>{hasPermission('properties.update') && <Link className="btn btn-sm btn-outline-primary" to={`/app/real-estate/properties/${property.id}/edit`}>Edit</Link>}{hasPermission('properties.delete') && <button className="btn btn-sm btn-outline-danger" onClick={() => setDeleteTarget(property)}>Delete</button>}</div></div>
        </article>)}</div>}
        <Modal open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)} title="Delete property">
            <div className="space-y-4">
                <p className="text-white-dark">Permanently delete <strong>{deleteTarget?.title}</strong>? Properties with active leases or sales cannot be deleted.</p>
                <div className="flex justify-end gap-2">
                    <button className="btn btn-outline-dark" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button>
                    <button className="btn btn-danger" disabled={deleting} onClick={confirmDelete}>{deleting ? 'Please wait…' : 'Delete property'}</button>
                </div>
            </div>
        </Modal>
    </AppShell>;
};

export default PropertiesPage;
