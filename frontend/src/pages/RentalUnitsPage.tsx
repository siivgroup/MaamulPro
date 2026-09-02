import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/maamulpro/AppShell';
import { AuthenticatedImage } from '../components/maamulpro/AuthenticatedImage';
import { ErrorAlert, LoadingState, Modal, PageHeader, StatusPill, money } from '../components/maamulpro/PageKit';
import { unwrapRows } from '../hooks/useApiData';
import { usePermissions } from '../hooks/usePermissions';
import { api } from '../lib/api';

type Category = { id: string; name: string; rooms: number; bathrooms: number; monthlyRent: number; section: string };
type Unit = { id: string; propertyId: string; name: string; floor?: string; imageUrl?: string; monthlyRent: number; status: string; bedrooms?: number; bathrooms?: number; section?: string; category?: Category; property?: { title: string }; contracts?: unknown[] };
type Form = { name: string; floor: string; categoryId: string; imageUrl: string; status: string; propertyId: string };
const blank = (propId = ''): Form => ({ name: '', floor: '', categoryId: '', imageUrl: '', status: 'AVAILABLE', propertyId: propId });

const RentalUnitsPage = () => {
    const { hasPermission } = usePermissions();
    const [properties, setProperties] = useState<any[]>([]);
    const [categories, setCategories] = useState<Category[]>([]);
    const [units, setUnits] = useState<Unit[]>([]);
    const [propertyId, setPropertyId] = useState('');
    const [form, setForm] = useState<Form>(blank());
    const [editing, setEditing] = useState<Unit | null>(null);
    const [viewing, setViewing] = useState<Unit | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Unit | null>(null);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');

    const load = async () => {
        setLoading(true);
        try {
            const [propertyResult, categoryResult, unitResult] = await Promise.all([
                api('/api/real-estate/properties/options'),
                api('/api/real-estate/unit-categories'),
                api('/api/real-estate/units'),
            ]);
            setProperties(unwrapRows(propertyResult));
            setCategories(unwrapRows(categoryResult));
            setUnits(unwrapRows(unitResult));
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load units'); }
        finally { setLoading(false); }
    };

    useEffect(() => { void load(); }, []);

    const activeProperty = useMemo(() => {
        const targetId = form.propertyId || propertyId;
        return properties.find((p) => p.id === targetId);
    }, [properties, form.propertyId, propertyId]);

    const floorOptions = useMemo(() => {
        const count = Number(activeProperty?.floors) > 0 ? Number(activeProperty.floors) : 10;
        return Array.from({ length: count }, (_, i) => `Floor ${i + 1}`);
    }, [activeProperty?.floors]);

    const selectedCategory = categories.find((category) => category.id === form.categoryId);

    const openCreate = () => {
        setEditing(null);
        setForm(blank(propertyId));
        setError('');
        setOpen(true);
    };

    const openEdit = (unit: Unit) => {
        setEditing(unit);
        const normalizedFloor = unit.floor ? (unit.floor.toLowerCase().startsWith('floor') ? unit.floor : `Floor ${unit.floor}`) : '';
        setForm({
            name: unit.name,
            floor: normalizedFloor,
            categoryId: unit.category?.id || '',
            imageUrl: unit.imageUrl || '',
            status: unit.status,
            propertyId: unit.propertyId,
        });
        setError('');
        setOpen(true);
    };

    const uploadImage = async (file?: File) => {
        if (!file) return;
        setUploading(true);
        setError('');
        const data = new FormData(); data.append('file', file);
        try {
            const result = await api<{ url: string }>('/api/uploads/images?folder=properties', { method: 'POST', body: data });
            setForm((current) => ({ ...current, imageUrl: result.url }));
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Image upload failed'); }
        finally { setUploading(false); }
    };

    const save = async () => {
        const targetPropertyId = form.propertyId || propertyId;
        if (!targetPropertyId || !form.name.trim() || !form.categoryId) {
            setError('Property, unit name, and category are required.');
            return;
        }
        setSaving(true);
        setError('');
        const payload = {
            name: form.name.trim(),
            floor: form.floor.trim() || undefined,
            categoryId: form.categoryId,
            imageUrl: form.imageUrl || undefined,
            status: form.status,
        };
        try {
            if (editing) {
                await api(`/api/real-estate/units/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
                if (editing.imageUrl && editing.imageUrl !== form.imageUrl) void api('/api/uploads/images', { method: 'DELETE', body: JSON.stringify({ url: editing.imageUrl }) }).catch(() => undefined);
            } else {
                await api(`/api/real-estate/properties/${targetPropertyId}/units`, { method: 'POST', body: JSON.stringify({ units: [payload] }) });
            }
            setOpen(false);
            setEditing(null);
            setForm(blank());
            await load();
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save unit'); }
        finally { setSaving(false); }
    };

    const remove = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await api(`/api/real-estate/units/${deleteTarget.id}`, { method: 'DELETE' });
            if (deleteTarget.imageUrl) void api('/api/uploads/images', { method: 'DELETE', body: JSON.stringify({ url: deleteTarget.imageUrl }) }).catch(() => undefined);
            setDeleteTarget(null);
            await load();
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to remove unit'); }
        finally { setDeleting(false); }
    };

    const shown = propertyId ? units.filter((unit) => unit.propertyId === propertyId) : units;

    return <AppShell>
        <PageHeader eyebrow="Rental management" title="Units" description="Create a unit by choosing a category; its rooms, bathrooms, rent fee, and section are filled automatically." actions={<><Link className="btn btn-outline-primary" to="/app/real-estate/unit-categories">Manage categories</Link><Link className="btn btn-outline-primary" to="/app/real-estate/rentals">Rentals</Link>{hasPermission('rentals.create') && <button className="btn btn-primary" onClick={openCreate}>Add unit</button>}</>} />
        {error && <ErrorAlert message={error} onRetry={load} />}
        {loading ? <div className="panel"><LoadingState /></div> : <section className="panel overflow-hidden p-0">
            <div className="flex items-center justify-between gap-3 p-5"><h2 className="text-lg font-bold">Unit register</h2><select className="form-select w-64" value={propertyId} onChange={(event) => setPropertyId(event.target.value)}><option value="">All properties</option>{properties.map((property) => <option value={property.id} key={property.id}>{property.title}</option>)}</select></div>
            <div className="overflow-x-auto"><table className="table-hover"><thead><tr><th>Unit</th><th>Property / floor</th><th>Category</th><th>Rent fee</th><th>Status</th><th>Actions</th></tr></thead><tbody>{shown.map((unit) => <tr key={unit.id}><td><div className="flex items-center gap-3">{unit.imageUrl ? <AuthenticatedImage className="h-10 w-10 rounded object-cover" src={unit.imageUrl} alt="" /> : <div className="grid h-10 w-10 place-items-center rounded bg-primary-light text-primary">⌂</div>}<strong>{unit.name}</strong></div></td><td>{unit.property?.title}<div className="text-xs text-white-dark">{unit.floor ? (unit.floor.toLowerCase().startsWith('floor') ? unit.floor : `Floor ${unit.floor}`) : 'Floor not set'}</div></td><td>{unit.category?.name || 'Legacy'}</td><td>{money(unit.monthlyRent)}</td><td><StatusPill value={unit.status} /></td><td><div className="flex flex-wrap gap-2"><button className="btn btn-sm btn-outline-info" onClick={() => setViewing(unit)}>View</button>{hasPermission('rentals.update') && <button className="btn btn-sm btn-outline-primary" onClick={() => openEdit(unit)}>Edit</button>}{hasPermission('rentals.delete') && !unit.contracts?.length && <button className="btn btn-sm btn-outline-danger" onClick={() => setDeleteTarget(unit)}>Delete</button>}</div></td></tr>)}{!shown.length && <tr><td colSpan={6} className="p-6 text-center text-white-dark">No units found.</td></tr>}</tbody></table></div>
        </section>}
        <Modal open={open} onClose={() => !saving && !uploading && setOpen(false)} title={editing ? 'Edit unit' : 'Add unit'}><div className="space-y-4">
            <label className="block font-semibold">Property *
                <select
                    className="form-select mt-1"
                    disabled={Boolean(editing)}
                    value={form.propertyId || propertyId}
                    onChange={(event) => {
                        const newPropId = event.target.value;
                        setForm({ ...form, propertyId: newPropId, floor: '' });
                    }}
                >
                    <option value="">Select property…</option>
                    {properties.map((property) => <option value={property.id} key={property.id}>{property.title}</option>)}
                </select>
            </label>
            {!categories.length && <p className="rounded-md bg-warning-light p-3 text-sm">Create a unit category first.</p>}
            <div className="grid gap-4 md:grid-cols-2">
                <label className="block font-semibold">Unit name *
                    <input className="form-input mt-1" placeholder="e.g. Unit 101, Flat A" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </label>
                <label className="block font-semibold">Located floor
                    <select
                        className="form-select mt-1"
                        value={form.floor}
                        onChange={(event) => setForm({ ...form, floor: event.target.value })}
                        disabled={!(form.propertyId || propertyId)}
                    >
                        <option value="">{form.propertyId || propertyId ? 'Select floor…' : 'Select property first'}</option>
                        {floorOptions.map((fl) => (
                            <option key={fl} value={fl}>{fl}</option>
                        ))}
                    </select>
                    {activeProperty?.floors ? <span className="mt-1 block text-xs text-white-dark">{activeProperty.floors} floors configured for this property</span> : null}
                </label>
                <label className="block font-semibold md:col-span-2">Category *
                    <select className="form-select mt-1" value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}>
                        <option value="">Select category…</option>
                        {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
                    </select>
                </label>
            </div>
            {selectedCategory && (
                <div className="rounded-lg border border-primary/20 bg-primary-light/50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-primary">Auto-populated from {selectedCategory.name}</span>
                        <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Category details</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                        <div className="rounded bg-white p-2.5 shadow-sm dark:bg-[#121e32]">
                            <span className="block text-xs text-white-dark">Rooms</span>
                            <strong className="text-base">{selectedCategory.rooms}</strong>
                        </div>
                        <div className="rounded bg-white p-2.5 shadow-sm dark:bg-[#121e32]">
                            <span className="block text-xs text-white-dark">Bathrooms</span>
                            <strong className="text-base">{selectedCategory.bathrooms}</strong>
                        </div>
                        <div className="rounded bg-white p-2.5 shadow-sm dark:bg-[#121e32]">
                            <span className="block text-xs text-white-dark">Rent fee</span>
                            <strong className="text-base text-primary">{money(selectedCategory.monthlyRent)}</strong>
                        </div>
                        <div className="rounded bg-white p-2.5 shadow-sm dark:bg-[#121e32]">
                            <span className="block text-xs text-white-dark">Section</span>
                            <strong className="text-base">{selectedCategory.section}</strong>
                        </div>
                    </div>
                </div>
            )}
            <label className="block font-semibold">Unit image <span className="font-normal text-white-dark">(optional)</span><input className="form-input mt-1" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading} onChange={(event) => void uploadImage(event.target.files?.[0])} /></label>
            {form.imageUrl && <div className="flex items-center gap-3"><AuthenticatedImage className="h-24 w-32 rounded object-cover" src={form.imageUrl} alt="Unit preview" /><button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setForm({ ...form, imageUrl: '' })}>Remove image</button></div>}
            {editing && <label className="block font-semibold">Status<select className="form-select mt-1" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{(editing.status === 'OCCUPIED' ? ['OCCUPIED'] : ['AVAILABLE', 'MAINTENANCE', 'INACTIVE']).map((status) => <option value={status} key={status}>{status.replace('_', ' ')}</option>)}</select></label>}
            <div className="flex justify-end gap-2"><button className="btn btn-outline-dark" type="button" disabled={saving || uploading} onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={saving || uploading || !categories.length} onClick={() => void save()}>{uploading ? 'Uploading…' : saving ? 'Saving…' : 'Save unit'}</button></div>
        </div></Modal>
        <Modal open={Boolean(viewing)} onClose={() => setViewing(null)} title="Unit details">
            {viewing && <div className="space-y-4">{viewing.imageUrl && <AuthenticatedImage className="h-48 w-full rounded-lg object-cover" src={viewing.imageUrl} alt="" />}<div className="grid grid-cols-2 gap-4"><div><p className="text-xs font-bold uppercase text-white-dark">Unit</p><p className="font-semibold">{viewing.name}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Property</p><p className="font-semibold">{viewing.property?.title}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Located floor</p><p className="font-semibold">{viewing.floor ? (viewing.floor.toLowerCase().startsWith('floor') ? viewing.floor : `Floor ${viewing.floor}`) : '—'}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Category</p><p className="font-semibold">{viewing.category?.name || '—'}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Rooms / bathrooms</p><p className="font-semibold">{viewing.bedrooms ?? '—'} / {viewing.bathrooms ?? '—'}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Rent fee</p><p className="font-semibold">{money(viewing.monthlyRent)}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Section</p><p className="font-semibold">{viewing.section || '—'}</p></div><div><p className="text-xs font-bold uppercase text-white-dark">Status</p><StatusPill value={viewing.status} /></div></div></div>}
        </Modal>
        <Modal open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)} title="Delete unit">
            {deleteTarget && <div className="space-y-4"><p className="text-white-dark">This action permanently removes <strong>{deleteTarget.name}</strong> and cannot be undone.</p><div className="flex justify-end gap-2"><button className="btn btn-outline-dark" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button><button className="btn btn-danger" disabled={deleting} onClick={() => void remove()}>{deleting ? 'Please wait…' : 'Delete record'}</button></div></div>}
        </Modal>
    </AppShell>;
};

export default RentalUnitsPage;
