import { FormEvent, useEffect, useState } from 'react';
import { Field, FormActions, Modal } from './PageKit';
import { api } from '../../lib/api';

type StaffOption = { id: string; firstName: string; lastName: string; position?: string };
type Option = { id: string; name: string };
type Worker = { id: string; firstName?: string; lastName?: string; phone?: string; position?: string };

const emptyForm = { firstName: '', lastName: '', phone: '', position: '', workerTypeId: '', assignedProjectId: '', notes: '' };

export const AddManpowerWorkerModal = ({ open, onClose, onCreated, workerTypes, projects }: { open: boolean; onClose: () => void; onCreated: (worker: Worker) => void; workerTypes?: Option[]; projects?: Option[] }) => {
    const [mode, setMode] = useState<'existing' | 'new'>('existing');
    const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
    const [linkedStaffId, setLinkedStaffId] = useState('');
    const [form, setForm] = useState(emptyForm);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        setMode('existing'); setLinkedStaffId(''); setForm(emptyForm); setError('');
        api<StaffOption[]>('/api/staff/options').then(setStaffOptions).catch(() => setStaffOptions([]));
    }, [open]);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        if (mode === 'existing' && !linkedStaffId) { setError('Select a staff member.'); return; }
        if (mode === 'new' && !(form.firstName.trim() && form.lastName.trim())) { setError('First and last name are required.'); return; }
        setSaving(true);
        try {
            const classification = { workerTypeId: form.workerTypeId || undefined, assignedProjectId: form.assignedProjectId || undefined, notes: form.notes || undefined };
            const payload = mode === 'existing' ? { linkedStaffId, ...classification } : { ...form, ...classification };
            const worker = await api<Worker>('/api/construction/manpower/workers', { method: 'POST', body: JSON.stringify(payload) });
            onCreated(worker);
            onClose();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to create worker');
        } finally {
            setSaving(false);
        }
    };

    return <Modal open={open} onClose={onClose} title="Add worker">
        <form className="space-y-4" onSubmit={submit}>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="flex gap-2">
                <button type="button" className={`btn btn-sm ${mode === 'existing' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setMode('existing')}>Existing staff</button>
                <button type="button" className={`btn btn-sm ${mode === 'new' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setMode('new')}>New outside worker</button>
            </div>
            {mode === 'existing'
                ? <Field label="Staff member" required><select className="form-select mt-1" value={linkedStaffId} onChange={(e) => setLinkedStaffId(e.target.value)}><option value="">Select staff…</option>{staffOptions.map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName}</option>)}</select></Field>
                : <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="First name" required><input className="form-input mt-1" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
                    <Field label="Last name" required><input className="form-input mt-1" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
                    <Field label="Phone"><input className="form-input mt-1" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
                    <Field label="Position"><input className="form-input mt-1" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></Field>
                </div>}
            {(workerTypes || projects) && <div className="grid gap-4 sm:grid-cols-2">
                {workerTypes && <Field label="Worker type"><select className="form-select mt-1" value={form.workerTypeId} onChange={(e) => setForm({ ...form, workerTypeId: e.target.value })}><option value="">Unclassified</option>{workerTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></Field>}
                {projects && <Field label="Assigned project"><select className="form-select mt-1" value={form.assignedProjectId} onChange={(e) => setForm({ ...form, assignedProjectId: e.target.value })}><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></Field>}
                <div className="sm:col-span-2"><Field label="Notes"><textarea className="form-textarea mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
            </div>}
            <FormActions onCancel={onClose} loading={saving} saveLabel="Add worker" />
        </form>
    </Modal>;
};
