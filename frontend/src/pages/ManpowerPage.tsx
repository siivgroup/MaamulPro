import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/maamulpro/AppShell';
import { EmptyState, ErrorAlert, Field, FormActions, LoadingState, Modal, PageHeader, StatGrid, money, shortDate } from '../components/maamulpro/PageKit';
import { AddManpowerWorkerModal } from '../components/maamulpro/AddManpowerWorkerModal';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { usePermissions } from '../hooks/usePermissions';

type Dashboard = { workers: any[]; workerTypes: any[]; expenses: any[]; ledger: any[]; summary: { workerCount: number; expenseCount: number; totalExpenses: number } };
const emptyEdit = { firstName: '', lastName: '', phone: '', position: '', workerTypeId: '', assignedProjectId: '', notes: '', status: 'ACTIVE' };

const ManpowerPage = () => {
    const { hasPermission } = usePermissions();
    const canCreate = hasPermission('manpower.create');
    const canUpdate = hasPermission('manpower.update');
    const canDelete = hasPermission('manpower.delete');
    const [data, setData] = useState<Dashboard | null>(null); const [projects, setProjects] = useState<any[]>([]); const [projectId, setProjectId] = useState(''); const [error, setError] = useState('');
    const load = () => { setError(''); Promise.all([api<Dashboard>(`/api/construction/manpower${projectId ? `?projectId=${projectId}` : ''}`), api<any>('/api/construction/projects')]).then(([dashboard, rows]) => { setData(dashboard); setProjects(Array.isArray(rows) ? rows : rows.data || []); }).catch((reason) => setError(reason.message)); };
    useEffect(load, [projectId]);

    const [newWorkerOpen, setNewWorkerOpen] = useState(false);
    const [form, setForm] = useState<Record<string, any>>(emptyEdit);
    const [editing, setEditing] = useState<any | null>(null);
    const [modal, setModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
    const [deleting, setDeleting] = useState(false);

    const openEdit = (worker: any) => { setEditing(worker); setForm({ ...emptyEdit, firstName: worker.firstName, lastName: worker.lastName, phone: worker.phone || '', position: worker.position || '', workerTypeId: worker.workerTypeId || '', assignedProjectId: worker.assignedProjectId || '', notes: worker.notes || '', status: worker.status || 'ACTIVE' }); setModal(true); };
    const saveWorker = async (event: FormEvent) => {
        event.preventDefault(); setSaving(true);
        try {
            const payload = { ...form, workerTypeId: form.workerTypeId || undefined, assignedProjectId: form.assignedProjectId || undefined };
            await api(`/api/construction/manpower/workers/${editing.id}`, { method: 'PATCH', silent: true, body: JSON.stringify(payload) });
            setModal(false); toast.success('Worker updated.'); load();
        } catch (reason) { const msg = reason instanceof Error ? reason.message : 'Unable to save worker'; toast.error(msg); setError(msg); } finally { setSaving(false); }
    };
    const confirmDelete = async () => {
        if (!deleteTarget) return; setDeleting(true);
        try { await api(`/api/construction/manpower/workers/${deleteTarget.id}`, { method: 'DELETE', silent: true }); toast.success('Worker removed.'); setDeleteTarget(null); load(); }
        catch (reason) { const msg = reason instanceof Error ? reason.message : 'Unable to remove worker'; toast.error(msg); setError(msg); } finally { setDeleting(false); }
    };

    return <AppShell>
        <PageHeader eyebrow="Construction workforce" title="Manpower dashboard" description="Worker assignments, labor classifications, operational costs and ledger activity." actions={<>
            <select className="form-select w-64" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All projects</option>{projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
            <Link className="btn btn-outline-primary" to="/app/construction/worker-types">Worker types</Link>
            <Link className="btn btn-outline-primary" to="/app/construction/worker-ledger">Worker ledger</Link>
            {canCreate && <button className="btn btn-primary" onClick={() => setNewWorkerOpen(true)}>Register worker</button>}
        </>} />
        {error && <ErrorAlert message={error} onRetry={load} />}
        {!data ? <div className="panel"><LoadingState /></div> : <>
            <StatGrid items={[
                { label: 'Construction workers', value: data.summary.workerCount },
                { label: 'Worker types', value: data.workerTypes.length, tone: 'info' },
                { label: 'Expense entries', value: data.summary.expenseCount, tone: 'warning' },
                { label: 'Labor/site expenses', value: money(data.summary.totalExpenses), tone: 'danger' },
            ]} />
            <div className="panel mb-6 overflow-hidden p-0"><div className="p-5"><h2 className="text-lg font-bold">Workforce</h2><p className="text-sm text-white-dark">Current construction staff and assignments</p></div>{!data.workers.length ? <EmptyState title="No construction workers" action={canCreate ? <button className="btn btn-primary" onClick={() => setNewWorkerOpen(true)}>Register worker</button> : undefined} /> : <div className="overflow-x-auto"><table className="table-hover"><thead><tr><th>Name</th><th>Position</th><th>Type</th><th>Project</th>{(canUpdate || canDelete) && <th>Actions</th>}</tr></thead><tbody>{data.workers.map((worker) => <tr key={worker.id}><td><strong>{worker.firstName} {worker.lastName}</strong><p className="text-xs text-white-dark">{worker.phone || worker.email || ''}</p></td><td>{worker.position || '—'}</td><td>{worker.workerType ? <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: worker.workerType.color || '#6366f1' }} />{worker.workerType.name}</span> : 'Unclassified'}</td><td>{worker.assignedProject?.name || '—'}</td>{(canUpdate || canDelete) && <td><div className="flex gap-2">{canUpdate && <button className="btn btn-sm btn-outline-primary" onClick={() => openEdit(worker)}>Edit</button>}{canDelete && <button className="btn btn-sm btn-outline-danger" onClick={() => setDeleteTarget(worker)}>Remove</button>}</div></td>}</tr>)}</tbody></table></div>}</div>
            <div className="panel overflow-hidden p-0"><div className="p-5"><h2 className="text-lg font-bold">Latest expenses</h2><p className="text-sm text-white-dark">Site and labor operational costs</p></div>{!data.expenses.length ? <EmptyState title="No expenses recorded" /> : <div className="overflow-x-auto"><table className="table-hover"><thead><tr><th>Date</th><th>Description</th><th>Project</th><th>Amount</th></tr></thead><tbody>{data.expenses.slice(0, 12).map((row) => <tr key={row.id}><td>{shortDate(row.date)}</td><td>{row.description}</td><td>{row.project?.name || 'General'}</td><td className="font-bold text-danger">{money(row.amount)}</td></tr>)}</tbody></table></div>}</div>
            <div className="panel mt-6 overflow-hidden p-0"><div className="p-5"><h2 className="text-lg font-bold">Worker ledger</h2><p className="text-sm text-white-dark">Latest labor income and expense entries</p></div>{!data.ledger.length ? <EmptyState title="No worker ledger activity" /> : <div className="overflow-x-auto"><table className="table-hover"><thead><tr><th>Date</th><th>Worker</th><th>Project</th><th>Description</th><th>Type</th><th>Amount</th></tr></thead><tbody>{data.ledger.slice(0, 20).map((row) => <tr key={row.id}><td>{shortDate(row.date)}</td><td>{row.worker ? `${row.worker.firstName} ${row.worker.lastName}` : 'General'}</td><td>{row.project?.name || 'General'}</td><td>{row.description}</td><td><span className={`badge ${row.type === 'INCOME' ? 'bg-success-light text-success' : 'bg-danger-light text-danger'}`}>{row.type}</span></td><td>{money(row.amount)}</td></tr>)}</tbody></table></div>}</div>
        </>}
        <AddManpowerWorkerModal open={newWorkerOpen} onClose={() => setNewWorkerOpen(false)} onCreated={() => { toast.success('Worker registered.'); load(); }} workerTypes={data?.workerTypes} projects={projects} />
        <Modal open={modal} onClose={() => setModal(false)} title="Edit worker"><form className="grid gap-4 sm:grid-cols-2" onSubmit={saveWorker}>
            {editing?.linkedStaffId
                ? <div className="sm:col-span-2 rounded-md bg-white-light/40 p-3 text-sm text-white-dark dark:bg-[#191e3a]">Identity for <strong>{form.firstName} {form.lastName}</strong> is linked to their staff record and can't be edited here.</div>
                : <>
                    <Field label="First name" required><input className="form-input mt-1" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
                    <Field label="Last name" required><input className="form-input mt-1" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
                    <Field label="Phone"><input className="form-input mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                    <Field label="Position"><input className="form-input mt-1" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></Field>
                </>}
            <Field label="Worker type"><select className="form-select mt-1" value={form.workerTypeId} onChange={(e) => setForm({ ...form, workerTypeId: e.target.value })}><option value="">Unclassified</option>{data?.workerTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></Field>
            <Field label="Assigned project"><select className="form-select mt-1" value={form.assignedProjectId} onChange={(e) => setForm({ ...form, assignedProjectId: e.target.value })}><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
            <Field label="Status"><select className="form-select mt-1" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ON_LEAVE">On leave</option><option value="TERMINATED">Terminated</option></select></Field>
            <div className="sm:col-span-2"><Field label="Notes"><textarea className="form-textarea mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
            <FormActions onCancel={() => setModal(false)} loading={saving} saveLabel="Save worker" savingLabel="Saving…" />
        </form></Modal>
        <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Remove worker">
            <div className="space-y-4">
                <p className="text-white-dark">Remove <strong>{deleteTarget?.firstName} {deleteTarget?.lastName}</strong> from the workforce? This cannot be undone.</p>
                <div className="flex justify-end gap-2">
                    <button className="btn btn-outline-dark" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button>
                    <button className="btn btn-danger" disabled={deleting} onClick={confirmDelete}>{deleting ? 'Please wait…' : 'Remove'}</button>
                </div>
            </div>
        </Modal>
    </AppShell>;
};

export default ManpowerPage;
