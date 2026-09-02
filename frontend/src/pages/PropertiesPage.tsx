import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/maamulpro/AppShell';
import { AuthenticatedImage } from '../components/maamulpro/AuthenticatedImage';
import { EmptyState, ErrorAlert, LoadingState, Modal, PageHeader, StatGrid, StatusPill, money } from '../components/maamulpro/PageKit';
import { useApiRows } from '../hooks/useApiData';
import { usePermissions } from '../hooks/usePermissions';
import { api } from '../lib/api';

type PropertyForm = {
    title: string;
    type: 'RENT' | 'SALE' | string;
    price: string;
    floors: string;
    area: string;
    address: string;
    description: string;
    imageUrl: string;
    status: string;
    version?: number;
};

const blankForm = (): PropertyForm => ({
    title: '',
    type: 'RENT',
    price: '',
    floors: '',
    area: '',
    address: '',
    description: '',
    imageUrl: '',
    status: 'AVAILABLE',
});

const PropertiesPage = () => {
    const state = useApiRows<any>('/api/real-estate/properties');
    const { hasPermission } = usePermissions();

    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [type, setType] = useState('');

    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<any | null>(null);
    const [form, setForm] = useState<PropertyForm>(blankForm());
    const [formError, setFormError] = useState('');
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);

    const [deleteTarget, setDeleteTarget] = useState<any>(null);
    const [deleting, setDeleting] = useState(false);

    const openCreate = () => {
        setEditing(null);
        setForm(blankForm());
        setFormError('');
        setModalOpen(true);
    };

    const openEdit = (property: any) => {
        setEditing(property);
        setForm({
            title: property.title || '',
            type: property.type || 'RENT',
            price: property.price ? String(property.price) : '',
            floors: property.floors ? String(property.floors) : '',
            area: property.area ? String(property.area) : '',
            address: property.address || '',
            description: property.description || '',
            imageUrl: property.imageUrl || '',
            status: property.status || 'AVAILABLE',
            version: property.version,
        });
        setFormError('');
        setModalOpen(true);
    };

    const uploadImage = async (file?: File) => {
        if (!file) return;
        setUploading(true);
        setFormError('');
        const data = new FormData();
        data.append('file', file);
        try {
            const result = await api<{ url: string }>('/api/uploads/images?folder=properties', { method: 'POST', body: data });
            setForm((current) => ({ ...current, imageUrl: result.url }));
        } catch (reason) {
            setFormError(reason instanceof Error ? reason.message : 'Image upload failed');
        } finally {
            setUploading(false);
        }
    };

    const saveProperty = async () => {
        if (!form.title.trim()) {
            setFormError('Property title is required.');
            return;
        }
        if (form.type === 'SALE' && (!form.price || Number(form.price) <= 0)) {
            setFormError('Sale price is required for properties for sale.');
            return;
        }

        setSaving(true);
        setFormError('');

        const payload: Record<string, any> = {
            title: form.title.trim(),
            type: form.type,
            floors: form.floors ? Number(form.floors) : undefined,
            area: form.area ? Number(form.area) : undefined,
            address: form.address.trim() || undefined,
            description: form.description.trim() || undefined,
            imageUrl: form.imageUrl || undefined,
        };

        if (form.type === 'SALE') {
            payload.price = Number(form.price);
        } else {
            payload.price = 0;
        }

        if (editing) {
            payload.status = form.status;
            if (form.version !== undefined) payload.version = form.version;
        }

        try {
            if (editing) {
                await api(`/api/real-estate/properties/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
                if (editing.imageUrl && editing.imageUrl !== form.imageUrl) {
                    void api('/api/uploads/images', { method: 'DELETE', body: JSON.stringify({ url: editing.imageUrl }) }).catch(() => undefined);
                }
            } else {
                await api('/api/real-estate/properties', { method: 'POST', body: JSON.stringify(payload) });
            }
            setModalOpen(false);
            setEditing(null);
            setForm(blankForm());
            await state.reload();
        } catch (reason) {
            setFormError(reason instanceof Error ? reason.message : 'Unable to save property');
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await api(`/api/real-estate/properties/${deleteTarget.id}`, { method: 'DELETE' });
            if (deleteTarget.imageUrl) {
                void api('/api/uploads/images', { method: 'DELETE', body: JSON.stringify({ url: deleteTarget.imageUrl }) }).catch(() => undefined);
            }
            setDeleteTarget(null);
            await state.reload();
        } catch (reason) {
            state.setError(reason instanceof Error ? reason.message : 'Unable to delete property');
        } finally {
            setDeleting(false);
        }
    };

    const rows = useMemo(() => {
        return state.rows.filter((row) => {
            const matchesStatus = !status || row.status === status;
            const matchesType = !type || row.type === type;
            const matchesSearch = !search || JSON.stringify(row).toLowerCase().includes(search.toLowerCase());
            return matchesStatus && matchesType && matchesSearch;
        });
    }, [state.rows, search, status, type]);

    return (
        <AppShell>
            <PageHeader
                eyebrow="Real estate"
                title="Properties"
                description="Portfolio listings, valuation, occupancy and transaction history."
                actions={
                    hasPermission('properties.create') ? (
                        <button className="btn btn-primary" onClick={openCreate}>
                            Add property
                        </button>
                    ) : undefined
                }
            />

            <StatGrid
                items={[
                    { label: 'Portfolio', value: state.rows.length },
                    { label: 'Available', value: state.rows.filter((row) => row.status === 'AVAILABLE').length, tone: 'success' },
                    { label: 'For Rent', value: state.rows.filter((row) => row.type === 'RENT').length, tone: 'info' },
                    { label: 'For Sale', value: state.rows.filter((row) => row.type === 'SALE').length, tone: 'warning' },
                ]}
            />

            <div className="panel mb-5 grid gap-3 md:grid-cols-3">
                <input
                    className="form-input"
                    placeholder="Search title, address…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <select className="form-select" value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="">All types</option>
                    <option value="RENT">Rent</option>
                    <option value="SALE">Sale</option>
                </select>
                <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option>
                    {['AVAILABLE', 'SOLD', 'RENTED', 'UNDER_CONTRACT'].map((value) => (
                        <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
                    ))}
                </select>
            </div>

            {state.error && <ErrorAlert message={state.error} onRetry={state.reload} />}

            {state.loading ? (
                <div className="panel">
                    <LoadingState />
                </div>
            ) : !rows.length ? (
                <div className="panel">
                    <EmptyState
                        title="No matching properties"
                        description={search || status || type ? 'Try adjusting your search filters.' : 'Add your first property listing to get started.'}
                        action={hasPermission('properties.create') && !search && !status && !type ? (
                            <button className="btn btn-primary" onClick={openCreate}>Add property</button>
                        ) : undefined}
                    />
                </div>
            ) : (
                <section className="panel overflow-hidden p-0">
                    <div className="overflow-x-auto">
                        <table className="table-hover w-full">
                            <thead>
                                <tr>
                                    <th>Property</th>
                                    <th>Type</th>
                                    <th>Floors</th>
                                    <th>Units</th>
                                    <th>Price</th>
                                    <th>Address</th>
                                    <th>Status</th>
                                    <th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((property) => (
                                    <tr key={property.id}>
                                        <td>
                                            <div className="flex items-center gap-3">
                                                {property.imageUrl ? (
                                                    <AuthenticatedImage
                                                        className="h-10 w-10 rounded object-cover"
                                                        src={property.imageUrl}
                                                        alt=""
                                                    />
                                                ) : (
                                                    <div className="grid h-10 w-10 place-items-center rounded bg-primary-light text-primary font-bold">
                                                        ⌂
                                                    </div>
                                                )}
                                                <div>
                                                    <Link
                                                        to={`/app/real-estate/properties/${property.id}`}
                                                        className="font-bold text-primary hover:underline"
                                                    >
                                                        {property.title}
                                                    </Link>
                                                    {property.area ? (
                                                        <span className="block text-xs text-white-dark">
                                                            {property.area} m²
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <span
                                                className={`badge ${
                                                    property.type === 'RENT'
                                                        ? 'badge-outline-info'
                                                        : property.type === 'SALE'
                                                        ? 'badge-outline-success'
                                                        : 'badge-outline-primary'
                                                }`}
                                            >
                                                {property.type === 'RENT' ? 'Rent' : property.type === 'SALE' ? 'Sale' : property.type}
                                            </span>
                                        </td>
                                        <td>{property.floors ? `${property.floors} floors` : '—'}</td>
                                        <td>{property._count?.units ?? (property.units ? property.units.length : 0)}</td>
                                        <td>
                                            {property.type === 'RENT' ? (
                                                <span className="text-xs italic text-white-dark">Managed by units</span>
                                            ) : (
                                                <strong className="text-primary">{money(property.price)}</strong>
                                            )}
                                        </td>
                                        <td className="max-w-xs truncate">{property.address || '—'}</td>
                                        <td>
                                            <StatusPill value={property.status} />
                                        </td>
                                        <td className="text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <Link
                                                    className="btn btn-sm btn-outline-info"
                                                    to={`/app/real-estate/properties/${property.id}`}
                                                >
                                                    View
                                                </Link>
                                                {hasPermission('properties.update') && (
                                                    <button
                                                        className="btn btn-sm btn-outline-primary"
                                                        onClick={() => openEdit(property)}
                                                    >
                                                        Edit
                                                    </button>
                                                )}
                                                {hasPermission('properties.delete') && (
                                                    <button
                                                        className="btn btn-sm btn-outline-danger"
                                                        onClick={() => setDeleteTarget(property)}
                                                    >
                                                        Delete
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
            )}

            {/* Property Create / Edit Modal */}
            <Modal
                open={modalOpen}
                onClose={() => !saving && !uploading && setModalOpen(false)}
                title={editing ? 'Edit property' : 'Add property'}
            >
                <div className="space-y-4">
                    {formError && <p className="rounded-md bg-danger-light p-3 text-sm text-danger">{formError}</p>}

                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="block font-semibold md:col-span-2">
                            Title *
                            <input
                                className="form-input mt-1"
                                placeholder="Property name / Building title"
                                value={form.title}
                                onChange={(e) => setForm({ ...form, title: e.target.value })}
                            />
                        </label>

                        <label className="block font-semibold">
                            Property type *
                            <select
                                className="form-select mt-1"
                                value={form.type}
                                onChange={(e) => setForm({ ...form, type: e.target.value })}
                            >
                                <option value="RENT">Rent</option>
                                <option value="SALE">Sale</option>
                            </select>
                        </label>

                        {form.type === 'SALE' ? (
                            <label className="block font-semibold">
                                Price *
                                <input
                                    type="number"
                                    min="0"
                                    className="form-input mt-1"
                                    placeholder="85000"
                                    value={form.price}
                                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                                />
                            </label>
                        ) : (
                            <div className="flex flex-col justify-center rounded-md bg-info-light/40 p-3 text-xs text-info dark:bg-info-dark-light">
                                <span className="font-semibold">Rent Property</span>
                                <span>Unit prices are configured under Units & Categories.</span>
                            </div>
                        )}

                        <label className="block font-semibold">
                            Floors
                            <input
                                type="number"
                                min="1"
                                className="form-input mt-1"
                                placeholder="e.g. 5"
                                value={form.floors}
                                onChange={(e) => setForm({ ...form, floors: e.target.value })}
                            />
                        </label>

                        <label className="block font-semibold">
                            Area (sq m)
                            <input
                                type="number"
                                min="0"
                                className="form-input mt-1"
                                placeholder="e.g. 180"
                                value={form.area}
                                onChange={(e) => setForm({ ...form, area: e.target.value })}
                            />
                        </label>

                        <label className="block font-semibold md:col-span-2">
                            Address
                            <input
                                className="form-input mt-1"
                                placeholder="Waddada Maka Al-Mukarama, Muqdisho"
                                value={form.address}
                                onChange={(e) => setForm({ ...form, address: e.target.value })}
                            />
                        </label>

                        <label className="block font-semibold md:col-span-2">
                            Description
                            <textarea
                                rows={3}
                                className="form-textarea mt-1"
                                placeholder="Ku sharax xaaladda, adeegyada, iyo muuqaalada hantida."
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                            />
                        </label>
                    </div>

                    <label className="block font-semibold">
                        Property image <span className="font-normal text-white-dark">(optional)</span>
                        <input
                            className="form-input mt-1"
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            disabled={uploading}
                            onChange={(e) => void uploadImage(e.target.files?.[0])}
                        />
                    </label>

                    {form.imageUrl && (
                        <div className="flex items-center gap-3">
                            <AuthenticatedImage className="h-24 w-32 rounded object-cover" src={form.imageUrl} alt="Property preview" />
                            <button
                                type="button"
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => setForm({ ...form, imageUrl: '' })}
                            >
                                Remove image
                            </button>
                        </div>
                    )}

                    {editing && (
                        <label className="block font-semibold">
                            Status
                            <select
                                className="form-select mt-1"
                                value={form.status}
                                onChange={(e) => setForm({ ...form, status: e.target.value })}
                            >
                                {['AVAILABLE', 'SOLD', 'RENTED', 'UNDER_CONTRACT'].map((st) => (
                                    <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>
                                ))}
                            </select>
                        </label>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            className="btn btn-outline-dark"
                            type="button"
                            disabled={saving || uploading}
                            onClick={() => setModalOpen(false)}
                        >
                            Cancel
                        </button>
                        <button
                            className="btn btn-primary"
                            disabled={saving || uploading}
                            onClick={() => void saveProperty()}
                        >
                            {uploading ? 'Uploading…' : saving ? 'Saving…' : editing ? 'Update property' : 'Create property'}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Delete Modal */}
            <Modal open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)} title="Delete property">
                <div className="space-y-4">
                    <p className="text-white-dark">
                        Permanently delete <strong>{deleteTarget?.title}</strong>? Properties with active leases or sales cannot be deleted.
                    </p>
                    <div className="flex justify-end gap-2">
                        <button className="btn btn-outline-dark" disabled={deleting} onClick={() => setDeleteTarget(null)}>
                            Cancel
                        </button>
                        <button className="btn btn-danger" disabled={deleting} onClick={confirmDelete}>
                            {deleting ? 'Please wait…' : 'Delete property'}
                        </button>
                    </div>
                </div>
            </Modal>
        </AppShell>
    );
};

export default PropertiesPage;
