import { FormEvent, useEffect, useState } from 'react';
import AppShell from '../components/maamulpro/AppShell';
import { CurrencyInput, EmptyState, Field, FormActions, LoadingState, Modal } from '../components/maamulpro/PageKit';
import { AddManpowerWorkerModal } from '../components/maamulpro/AddManpowerWorkerModal';
import { api } from '../lib/api';
import { usePermissions } from '../hooks/usePermissions';
import { DocumentAttachments } from '../components/maamulpro/DocumentAttachments';

type Project = { id: string; name: string };
type WorkerOption = { id: string; firstName?: string; lastName?: string };
type WorkerLite = { id: string | null; firstName?: string; lastName?: string };
type Assignment = { staffId?: string | null; workerId?: string | null; removedAt?: string; role?: string; worker: WorkerLite };
type Payment = { id: string; amount: number | string; date: string; description: string; worker: WorkerLite | null; payeeName?: string };
type Adjustment = { id: string; amount: number | string; reason: string; createdAt: string };
type ContractWorkspace = { contracts: Contract[]; projects: Project[]; workers: WorkerOption[] };
type Contract = {
    id: string;
    projectId: string;
    title: string;
    description?: string;
    originalBudget: number | string;
    totalPaid: number | string;
    status: string;
    startDate?: string;
    endDate?: string;
    notes?: string;
    version: number;
    project?: Project;
    workerAssignments: Assignment[];
    payments: Payment[];
    budgetAdjustments: Adjustment[];
};

const emptyContract = { projectId: '', title: '', description: '', originalBudget: '', startDate: '', endDate: '', notes: '' };
const allowedTransitions: Record<string, string[]> = {
    DRAFT: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['SUSPENDED', 'COMPLETED', 'CANCELLED'],
    SUSPENDED: ['ACTIVE', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
};
const transitionStyle: Record<string, { label: string; className: string }> = {
    ACTIVE: { label: 'Activate', className: 'btn-outline-primary' },
    SUSPENDED: { label: 'Suspend', className: 'btn-outline-warning' },
    COMPLETED: { label: 'Complete', className: 'btn-outline-success' },
    CANCELLED: { label: 'Cancel', className: 'btn-outline-danger' },
};

const WorkforceContractsPage = () => {
    const { hasPermission } = usePermissions();
    const canCreate = hasPermission('workforce_contracts.create');
    const canUpdate = hasPermission('workforce_contracts.update');
    const canDelete = hasPermission('workforce_contracts.delete');
    const canPay = hasPermission('workforce_contracts.pay');
    const canAssign = canUpdate;
    const [contracts, setContracts] = useState<Contract[]>([]);
    const [initialLoading, setInitialLoading] = useState(true);
    const [projects, setProjects] = useState<Project[]>([]);
    const [workers, setWorkers] = useState<WorkerOption[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [contractForm, setContractForm] = useState<Record<string, any>>(emptyContract);
    const [editing, setEditing] = useState<Contract | null>(null);
    const [modal, setModal] = useState(false);
    const [worker, setWorker] = useState({ workerId: '', role: '', notes: '' });
    const [newWorkerOpen, setNewWorkerOpen] = useState(false);
    const [payment, setPayment] = useState({ workerId: '', staffId: '', amount: '', date: '', description: '', notes: '' });
    const [adjustment, setAdjustment] = useState({ amount: '', reason: '' });
    const [error, setError] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<Contract | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [assignOpen, setAssignOpen] = useState(false);
    const [paymentOpen, setPaymentOpen] = useState(false);
    const [adjustOpen, setAdjustOpen] = useState(false);

    const load = async () => {
        try {
            const { contracts: contractRows, projects: projectRows, workers: workerRows } = await api<ContractWorkspace>('/api/construction/contracts/workspace');
            setContracts(contractRows);
            setProjects(projectRows);
            setWorkers(Array.isArray(workerRows) ? workerRows : []);
            if (selectedId && !contractRows.some((row) => row.id === selectedId)) setSelectedId('');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to load contracts');
        } finally {
            setInitialLoading(false);
        }
    };
    useEffect(() => { load(); }, []);
    const selected = contracts.find((row) => row.id === selectedId);
    const adjustedBudget = selected ? Number(selected.originalBudget) + selected.budgetAdjustments.reduce((sum, row) => sum + Number(row.amount), 0) : 0;

    const saveContract = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        try {
            await api(editing ? `/api/construction/contracts/${editing.id}` : '/api/construction/contracts', {
                method: editing ? 'PATCH' : 'POST',
                body: JSON.stringify({
                    ...contractForm,
                    originalBudget: Number(contractForm.originalBudget),
                    startDate: contractForm.startDate || undefined,
                    endDate: contractForm.endDate || undefined,
                    status: editing?.status,
                    version: editing?.version,
                }),
            });
            setModal(false);
            await load();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to save contract');
        }
    };
    const openCreate = () => { setEditing(null); setContractForm(emptyContract); setModal(true); };
    const openEdit = (row: Contract) => {
        setEditing(row);
        setContractForm({
            projectId: row.projectId,
            title: row.title,
            description: row.description || '',
            originalBudget: row.originalBudget,
            startDate: row.startDate?.slice(0, 10) || '',
            endDate: row.endDate?.slice(0, 10) || '',
            notes: row.notes || '',
        });
        setModal(true);
    };
    const transition = async (row: Contract, status: string) => {
        try { await api(`/api/construction/contracts/${row.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }); await load(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update status'); }
    };
    const confirmDelete = async () => {
        if (!deleteTarget) return;
        try { await api(`/api/construction/contracts/${deleteTarget.id}`, { method: 'DELETE' }); setDeleteTarget(null); await load(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to delete contract'); }
    };
    const assignWorker = async (event: FormEvent) => {
        event.preventDefault();
        if (!selected) return;
        try { await api(`/api/construction/contracts/${selected.id}/workers`, { method: 'POST', body: JSON.stringify(worker) }); setWorker({ workerId: '', role: '', notes: '' }); setAssignOpen(false); await load(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to assign worker'); }
    };
    const onWorkerCreated = (created: WorkerOption) => {
        setWorkers((current) => [...current, created]);
        setWorker((current) => ({ ...current, workerId: created.id }));
    };
    const removeWorker = async (id: string) => {
        if (!selected) return;
        try { await api(`/api/construction/contracts/${selected.id}/workers/${id}`, { method: 'DELETE' }); await load(); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to remove worker'); }
    };
    const addPayment = async (event: FormEvent) => {
        event.preventDefault();
        if (!selected) return;
        try {
            await api(`/api/construction/contracts/${selected.id}/payments`, { method: 'POST', body: JSON.stringify({ ...payment, amount: Number(payment.amount), date: payment.date || undefined }) });
            setPayment({ workerId: '', staffId: '', amount: '', date: '', description: '', notes: '' });
            setPaymentOpen(false);
            await load();
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to record payment'); }
    };
    const addAdjustment = async (event: FormEvent) => {
        event.preventDefault();
        if (!selected) return;
        try {
            await api(`/api/construction/contracts/${selected.id}/adjustments`, { method: 'POST', body: JSON.stringify({ amount: Number(adjustment.amount), reason: adjustment.reason }) });
            setAdjustment({ amount: '', reason: '' });
            setAdjustOpen(false);
            await load();
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to adjust budget'); }
    };

    return <AppShell>
        <div className="mb-6 flex items-end justify-between gap-4"><div><h1 className="text-2xl font-extrabold">Workforce Contracts</h1><p className="mt-1 text-white-dark">Contract budgets, assigned workers, payments and controlled lifecycle transitions.</p></div>{canCreate && <button className="btn btn-primary" onClick={openCreate}>New contract</button>}</div>
        {error && <div className="mb-5 rounded-md bg-danger-light p-4 text-danger">{error}</div>}
        <div className="panel overflow-x-auto p-0">
            {initialLoading ? <LoadingState label="Loading workforce contracts…" /> : !contracts.length ? <EmptyState title="No workforce contracts" description="Create a contract to track budgets, workers, and payments." action={canCreate ? <button className="btn btn-primary" onClick={openCreate}>New contract</button> : undefined} /> : <table className="table-hover w-full"><thead><tr><th>Contract</th><th>Project</th><th>Status</th><th>Budget</th><th>Paid</th><th>Workers</th><th>Actions</th></tr></thead>
                <tbody>{contracts.map((row) => <tr key={row.id}><td><button className="font-semibold text-primary" onClick={() => { setSelectedId(row.id); setDetailOpen(true); }}>{row.title}</button></td><td>{row.project?.name}</td><td><span className="badge bg-primary">{row.status}</span></td><td>${Number(row.originalBudget).toLocaleString()}</td><td>${Number(row.totalPaid).toLocaleString()}</td><td>{row.workerAssignments.filter((entry) => !entry.removedAt).length}</td><td><div className="flex flex-wrap gap-2"><button className="btn btn-sm btn-outline-dark" onClick={() => { setSelectedId(row.id); setDetailOpen(true); }}>View</button>{canUpdate && <><button className="btn btn-sm btn-outline-primary" onClick={() => openEdit(row)}>Edit</button>{allowedTransitions[row.status]?.map((status) => <button className={`btn btn-sm ${transitionStyle[status]?.className || 'btn-outline-info'}`} key={status} onClick={() => transition(row, status)}>{transitionStyle[status]?.label || status}</button>)}</>}{canDelete && <button className="btn btn-sm btn-outline-danger" onClick={() => setDeleteTarget(row)}>Delete</button>}</div></td></tr>)}</tbody>
            </table>}
        </div>
        <Modal open={detailOpen && Boolean(selected)} onClose={() => setDetailOpen(false)} title={selected?.title || 'Contract details'} wide>{selected && <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-3"><div className="panel"><p className="text-white-dark">Adjusted budget</p><p className="mt-2 text-2xl font-bold">${adjustedBudget.toLocaleString()}</p></div><div className="panel"><p className="text-white-dark">Total paid</p><p className="mt-2 text-2xl font-bold">${Number(selected.totalPaid).toLocaleString()}</p></div><div className="panel"><p className="text-white-dark">Remaining</p><p className="mt-2 text-2xl font-bold text-success">${(adjustedBudget - Number(selected.totalPaid)).toLocaleString()}</p></div></div>
            <div className="flex flex-wrap gap-2">
                {canAssign && <button className="btn btn-outline-primary" onClick={() => setAssignOpen(true)}>Assign worker</button>}
                {canPay && <button className="btn btn-outline-success" onClick={() => setPaymentOpen(true)}>Record payment</button>}
                {canUpdate && <button className="btn btn-outline-warning" onClick={() => setAdjustOpen(true)}>Adjust budget</button>}
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
                <div className="panel"><h2 className="mb-4 font-bold">Active workers</h2><div className="space-y-2">{!selected.workerAssignments.filter((entry) => !entry.removedAt).length ? <p className="text-white-dark">No workers assigned.</p> : selected.workerAssignments.filter((entry) => !entry.removedAt).map((entry) => <div className="flex items-center justify-between rounded border border-white-light p-3 dark:border-[#191e3a]" key={entry.workerId || entry.staffId || ''}><span>{entry.worker.firstName} {entry.worker.lastName} <small className="text-white-dark">{entry.role}</small></span>{canUpdate && <button className="btn btn-sm btn-outline-danger" onClick={() => removeWorker((entry.workerId || entry.staffId)!)}>Remove</button>}</div>)}</div></div>
                <div className="panel"><h2 className="mb-4 font-bold">Payment history</h2><div className="space-y-2">{!selected.payments.length ? <p className="text-white-dark">No payments recorded.</p> : selected.payments.map((row) => <div className="flex justify-between rounded border border-white-light p-3 dark:border-[#191e3a]" key={row.id}><span>{row.worker ? `${row.worker.firstName} ${row.worker.lastName}` : row.payeeName || 'Payee'}<small className="block text-white-dark">{row.description}</small></span><strong>${Number(row.amount).toLocaleString()}</strong></div>)}</div></div>
            </div>
            <DocumentAttachments entityType="workforce_contract" entityId={selected.id} canUpload={canUpdate} canSign={canUpdate} />
        </div>}</Modal>
        <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title="Assign worker"><form className="space-y-3" onSubmit={assignWorker}><select className="form-select" required value={worker.workerId} onChange={(e) => { if (e.target.value === '__new__') { setNewWorkerOpen(true); return; } setWorker({ ...worker, workerId: e.target.value }); }}><option value="">Select worker…</option>{workers.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}<option value="__new__">+ Add new worker</option></select><input className="form-input" placeholder="Role" value={worker.role} onChange={(e) => setWorker({ ...worker, role: e.target.value })} /><textarea className="form-textarea" placeholder="Notes" value={worker.notes} onChange={(e) => setWorker({ ...worker, notes: e.target.value })} /><FormActions onCancel={() => setAssignOpen(false)} saveLabel="Assign" /></form></Modal>
        <AddManpowerWorkerModal open={newWorkerOpen} onClose={() => setNewWorkerOpen(false)} onCreated={onWorkerCreated} />
        <Modal open={paymentOpen} onClose={() => setPaymentOpen(false)} title="Record payment"><form className="space-y-3" onSubmit={addPayment}><select className="form-select" required value={payment.workerId || payment.staffId} onChange={(e) => { const entry = selected?.workerAssignments.find((a) => (a.workerId || a.staffId) === e.target.value); setPayment({ ...payment, workerId: entry?.workerId || '', staffId: entry?.staffId || '' }); }}><option value="">Assigned worker…</option>{selected?.workerAssignments.filter((entry) => !entry.removedAt).map((entry) => <option key={entry.workerId || entry.staffId || ''} value={entry.workerId || entry.staffId || ''}>{entry.worker.firstName} {entry.worker.lastName}</option>)}</select><CurrencyInput className="form-input" min="0.01" step="0.01" placeholder="Amount" required value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /><input className="form-input" type="date" value={payment.date} onChange={(e) => setPayment({ ...payment, date: e.target.value })} /><input className="form-input" placeholder="Description" required value={payment.description} onChange={(e) => setPayment({ ...payment, description: e.target.value })} /><FormActions onCancel={() => setPaymentOpen(false)} saveLabel="Record payment" /></form></Modal>
        <Modal open={adjustOpen} onClose={() => setAdjustOpen(false)} title="Adjust budget"><form className="space-y-3" onSubmit={addAdjustment}><CurrencyInput className="form-input" step="0.01" placeholder="Positive or negative amount" required value={adjustment.amount} onChange={(e) => setAdjustment({ ...adjustment, amount: e.target.value })} /><textarea className="form-textarea" placeholder="Reason" required value={adjustment.reason} onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })} /><FormActions onCancel={() => setAdjustOpen(false)} saveLabel="Apply adjustment" /></form></Modal>
        <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit contract' : 'Create contract'}><form className="grid gap-4 sm:grid-cols-2" onSubmit={saveContract}>
            <Field label="Project" required><select className="form-select mt-1" required value={contractForm.projectId} onChange={(e) => setContractForm({ ...contractForm, projectId: e.target.value })}><option value="">Select project…</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>
            <Field label="Title" required><input className="form-input mt-1" required value={contractForm.title} onChange={(e) => setContractForm({ ...contractForm, title: e.target.value })} /></Field>
            <Field label="Original budget" required><CurrencyInput className="form-input mt-1" min="0" step="0.01" required value={contractForm.originalBudget} onChange={(e) => setContractForm({ ...contractForm, originalBudget: e.target.value })} /></Field>
            <Field label="Start date"><input className="form-input mt-1" type="date" value={contractForm.startDate} onChange={(e) => setContractForm({ ...contractForm, startDate: e.target.value })} /></Field>
            <Field label="End date"><input className="form-input mt-1" type="date" value={contractForm.endDate} onChange={(e) => setContractForm({ ...contractForm, endDate: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Description"><textarea className="form-textarea mt-1" value={contractForm.description} onChange={(e) => setContractForm({ ...contractForm, description: e.target.value })} /></Field></div>
            <div className="sm:col-span-2"><Field label="Notes"><textarea className="form-textarea mt-1" value={contractForm.notes} onChange={(e) => setContractForm({ ...contractForm, notes: e.target.value })} /></Field></div>
            <FormActions onCancel={() => setModal(false)} saveLabel="Save contract" />
        </form></Modal>
        <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Delete contract">
            <div className="space-y-4">
                <p className="text-white-dark">Delete contract <strong>"{deleteTarget?.title}"</strong>? This cannot be undone.</p>
                <div className="flex justify-end gap-2">
                    <button className="btn btn-outline-dark" onClick={() => setDeleteTarget(null)}>Cancel</button>
                    <button className="btn btn-danger" onClick={confirmDelete}>Delete contract</button>
                </div>
            </div>
        </Modal>
    </AppShell>;
};

export default WorkforceContractsPage;
