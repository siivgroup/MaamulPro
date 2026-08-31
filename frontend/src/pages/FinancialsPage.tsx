import { pendingBillingSubmission, reserveBillingSubmission, completeBillingSubmission } from '../lib/billing-submission';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/maamulpro/AppShell';
import { CurrencyInput, EmptyState, ErrorAlert, Field, FormActions, LoadingState, Modal, PageHeader, StatGrid, StatusPill, formatDescription, formatReference, money, shortDate } from '../components/maamulpro/PageKit';
import { api, ApiError } from '../lib/api';
import { unwrapRows } from '../hooks/useApiData';
import { usePermissions } from '../hooks/usePermissions';

type Transaction = { id: string; version: number; referenceId: string; type: 'INCOME' | 'EXPENSE'; status: string; description: string; amount: number; date: string; notes?: string; categoryId?: string; projectId?: string; propertyId?: string; materialId?: string; sourceManaged?: boolean; category?: { name: string }; project?: { name: string }; property?: { title: string }; material?: { name: string } };
const blank = { type: 'EXPENSE', status: 'CLEARED', description: '', amount: '', date: '', categoryId: '', projectId: '', propertyId: '', materialId: '', notes: '' };
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const FinancialsPage = () => {
    const { user, hasPermission } = usePermissions();
    const canUseConstruction = Boolean(user?.constructionEnabled && user.entitlements?.features.construction && hasPermission('projects.read'));
    const canUseRealEstate = Boolean(user?.realEstateEnabled && user.entitlements?.features.realEstate && hasPermission('properties.read'));
    const canUseMaterials = Boolean(user?.materialManagementEnabled && user.entitlements?.features.materials && hasPermission('materials_products.read'));
    const [rows, setRows] = useState<Transaction[]>([]);
    const [summary, setSummary] = useState({ totalIncome: 0, totalExpense: 0, netBalance: 0, totalCount: 0 });
    const [categories, setCategories] = useState<Record<string, any>[]>([]);
    const [projects, setProjects] = useState<Record<string, any>[]>([]);
    const [properties, setProperties] = useState<Record<string, any>[]>([]);
    const [materials, setMaterials] = useState<Record<string, any>[]>([]);
    const [filters, setFilters] = useState({ search: '', type: '', status: '', categoryId: '', startDate: '', endDate: '' });
    const [form, setForm] = useState<Record<string, any>>(blank);
    const [editing, setEditing] = useState<Transaction | null>(null);
    const [open, setOpen] = useState(false);
    const [submissionReference, setSubmissionReference] = useState(() => { try { return pendingBillingSubmission('cashbook')?.requestId || ''; } catch { return ''; } });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
    const [deleting, setDeleting] = useState(false);
    const query = useMemo(() => { const params = new URLSearchParams({ limit: '100' }); Object.entries(filters).forEach(([key, value]) => value && params.set(key, value)); return params.toString(); }, [filters]);
    const loadLookups = useCallback(async () => {
        try {
            const [categoryRows, projectResult, propertyResult, materialResult] = await Promise.all([
                api<any[]>('/api/financials/categories'),
                canUseConstruction ? api<unknown>('/api/construction/projects') : Promise.resolve([]),
                canUseRealEstate ? api<unknown>('/api/real-estate/properties') : Promise.resolve([]),
                canUseMaterials ? api<unknown>('/api/materials/products') : Promise.resolve([]),
            ]);
            setCategories(categoryRows); setProjects(unwrapRows(projectResult)); setProperties(unwrapRows(propertyResult)); setMaterials(unwrapRows(materialResult));
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load transaction options'); }
    }, [canUseConstruction, canUseRealEstate, canUseMaterials]);
    const load = async () => {
        setLoading(true); setError('');
        try {
            const [transactionResult, summaryResult] = await Promise.all([
                hasPermission('transactions.read') ? api<unknown>(`/api/financials/transactions?${query}`) : Promise.resolve([]), api<typeof summary>(`/api/financials/summary?${query}`),
            ]);
            setRows(unwrapRows<Transaction>(transactionResult)); setSummary(summaryResult);
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load financials'); } finally { setLoading(false); }
    };
    useEffect(() => { const timer = setTimeout(load, 200); return () => clearTimeout(timer); }, [query, canUseConstruction, canUseRealEstate, canUseMaterials]);
    useEffect(() => { void loadLookups(); }, [loadLookups]);
    const save = async (event: FormEvent) => {
        event.preventDefault(); setError('');
        try {
            const payload: any = Object.fromEntries(Object.keys(blank).map((key) => [key, form[key]]));
            Object.assign(payload, { amount: Number(form.amount), date: form.date || undefined, categoryId: form.categoryId || undefined, projectId: form.projectId || undefined, propertyId: form.propertyId || undefined, materialId: form.materialId || undefined });
            if (editing) payload.version = editing.version;
            const submission = editing ? null : reserveBillingSubmission('cashbook', payload);
            if (submission) setSubmissionReference(submission.requestId);
            await api<Transaction>(editing ? `/api/financials/transactions/${editing.id}` : '/api/financials/transactions', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload), silent: true, ...(submission ? { headers: { 'x-idempotency-key': submission.requestId } } : {}) }).then((saved) => { if (!saved?.id) throw new Error('Unable to confirm the saved transaction. Retry with the same reference.'); });
            if (submission) { completeBillingSubmission('cashbook'); setSubmissionReference(''); }
            setOpen(false); setMessage('Transaction saved successfully.'); await load();
        } catch (reason) { if (!editing && reason instanceof ApiError && (reason.status === 400 || reason.code === 'TRANSACTION_REJECTED')) { completeBillingSubmission('cashbook'); setSubmissionReference(''); } setError(reason instanceof Error ? reason.message : 'Unable to confirm transaction. Your submission is saved; retry to check it safely.'); }
    };
    const [sourceType, setSourceType] = useState<'none' | 'project' | 'property' | 'material'>('none');
    const edit = (row: Transaction) => { setEditing(row); setForm(Object.fromEntries(Object.keys(blank).map((key) => [key, key === 'date' ? row.date?.slice(0, 10) || '' : key === 'amount' ? Number(row.amount) : row[key as keyof Transaction] ?? blank[key as keyof typeof blank]]))); setSourceType(canUseConstruction && row.projectId ? 'project' : canUseRealEstate && row.propertyId ? 'property' : canUseMaterials && row.materialId ? 'material' : 'none'); setOpen(true); };
    const confirmDelete = async () => { if (!deleteTarget) return; setDeleting(true); try { await api(`/api/financials/transactions/${deleteTarget.id}`, { method: 'DELETE' }); setDeleteTarget(null); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to delete transaction'); } finally { setDeleting(false); } };
    const exportCsv = () => {
        const headers = ['Date', 'Reference', 'Type', 'Description', 'Category', 'Source', 'Amount', 'Status', 'Notes'];
        const body = rows.map((row) => [shortDate(row.date), formatReference(row.referenceId, row.id), row.type, formatDescription(row.description), row.category?.name, row.project?.name || row.property?.title || row.material?.name || 'General', row.amount, row.status, row.notes].map(csvCell).join(','));
        const url = URL.createObjectURL(new Blob([[headers.join(','), ...body].join('\n')], { type: 'text/csv' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
    };
    return <AppShell>
        <PageHeader eyebrow="Unified ledger" title="Financials" description="Company income, expenses, categorized sources and synchronized operational ledger entries." actions={<>{hasPermission('transactions.read') && <button className="btn btn-outline-primary" onClick={exportCsv}>Export CSV</button>}{hasPermission('transactions.create') && <button className="btn btn-primary" onClick={() => { setEditing(null); const draft = pendingBillingSubmission('cashbook'); setForm({ ...blank, ...draft?.payload }); setSourceType(draft?.payload.projectId ? 'project' : draft?.payload.propertyId ? 'property' : draft?.payload.materialId ? 'material' : 'none'); setSubmissionReference(draft?.requestId || ''); setError(''); setOpen(true); }}>{submissionReference ? 'Resume transaction' : 'New transaction'}</button>}</>} />
        {message && <div className="mb-5 rounded-md bg-success-light p-4 text-success">{message}</div>}{error && !open && <ErrorAlert message={error} onRetry={load} />}
        <StatGrid items={[{ label: 'Total income', value: money(summary.totalIncome), tone: 'success' }, { label: 'Total expenses', value: money(summary.totalExpense), tone: 'danger' }, { label: 'Net balance', value: money(summary.netBalance), tone: summary.netBalance >= 0 ? 'primary' : 'danger' }, { label: 'Transactions', value: summary.totalCount }]} />
        <div className="panel mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><input className="form-input xl:col-span-2" placeholder="Search reference or description…" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} /><select className="form-select" value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="">All types</option><option>INCOME</option><option>EXPENSE</option></select><select className="form-select" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">All statuses</option>{['PENDING', 'PROCESSING', 'CLEARED', 'CANCELLED'].map((value) => <option key={value}>{value}</option>)}</select><input className="form-input" type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} /><input className="form-input" type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} /></div>
        <div className="panel overflow-hidden p-0">{loading ? <LoadingState /> : !rows.length ? <EmptyState title="No transactions match these filters" /> : <div className="overflow-x-auto"><table className="table-hover w-full"><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Category / source</th><th>Status</th><th className="text-right">Amount</th><th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{shortDate(row.date)}</td><td className="font-mono text-xs font-semibold text-primary">{formatReference(row.referenceId, row.id)}</td><td className="font-semibold">{formatDescription(row.description)}</td><td>{row.category?.name || 'Uncategorized'}<small className="block text-white-dark">{row.project?.name || row.property?.title || row.material?.name || 'General'}</small></td><td><StatusPill value={row.status} /></td><td className={`text-right font-bold ${row.type === 'INCOME' ? 'text-success' : 'text-danger'}`}>{row.type === 'INCOME' ? '+' : '−'}{money(row.amount)}</td><td>{row.sourceManaged ? <span className="text-xs text-white-dark">Managed at source</span> : <div className="flex gap-2">{hasPermission('transactions.update') && <button className="btn btn-sm btn-outline-primary" onClick={() => edit(row)}>Edit</button>}{hasPermission('transactions.delete') && <button className="btn btn-sm btn-outline-danger" onClick={() => setDeleteTarget(row)}>Delete</button>}</div>}</td></tr>)}</tbody></table></div>}</div>
        <Modal title={editing ? 'Edit transaction' : 'New transaction'} open={open} onClose={() => setOpen(false)}><form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
            {!editing && submissionReference && <p className="sm:col-span-2 text-sm text-white-dark" role="status">Submission reference: {submissionReference}. Retrying confirms this same transaction without creating a duplicate.</p>}
            {error && <div className="sm:col-span-2"><ErrorAlert message={error} /></div>}
            <Field label="Type" required><select className="form-select mt-1" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option>INCOME</option><option>EXPENSE</option></select></Field><Field label="Status"><select className="form-select mt-1" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{['PENDING', 'PROCESSING', 'CLEARED', 'CANCELLED'].map((value) => <option key={value}>{value}</option>)}</select></Field>
            <div className="sm:col-span-2"><Field label="Description" required><input className="form-input mt-1" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div><Field label="Amount" required><CurrencyInput className="form-input mt-1" min=".01" step=".01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Date"><input className="form-input mt-1" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="Category"><select className="form-select mt-1" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}><option value="">Uncategorized</option>{categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
            <Field label="Source Module"><select className="form-select mt-1" value={sourceType} onChange={(e) => { const type = e.target.value as 'none' | 'project' | 'property' | 'material'; setSourceType(type); setForm({ ...form, projectId: '', propertyId: '', materialId: '' }); }}><option value="none">General / Unassigned</option>{canUseConstruction && <option value="project">Construction Project</option>}{canUseRealEstate && <option value="property">Real Estate Property</option>}{canUseMaterials && <option value="material">Material</option>}</select></Field>
            {canUseConstruction && sourceType === 'project' && <Field label="Project"><select className="form-select mt-1" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value, propertyId: '', materialId: '' })}><option value="">Select project…</option>{projects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
            {canUseRealEstate && sourceType === 'property' && <Field label="Property"><select className="form-select mt-1" value={form.propertyId} onChange={(e) => setForm({ ...form, propertyId: e.target.value, projectId: '', materialId: '' })}><option value="">Select property…</option>{properties.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select></Field>}
            {canUseMaterials && sourceType === 'material' && <Field label="Material"><select className="form-select mt-1" value={form.materialId} onChange={(e) => setForm({ ...form, materialId: e.target.value, projectId: '', propertyId: '' })}><option value="">Select material…</option>{materials.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
            <div className="sm:col-span-2"><Field label="Notes"><textarea className="form-textarea mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div><FormActions onCancel={() => setOpen(false)} saveLabel="Save transaction" />
        </form></Modal>
        <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Delete transaction">
            <div className="space-y-4">
                <p className="text-white-dark">This action permanently deletes transaction <strong>{deleteTarget ? formatReference(deleteTarget.referenceId, deleteTarget.id) : ''}</strong> and cannot be undone.</p>
                <div className="flex justify-end gap-2">
                    <button className="btn btn-outline-dark" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</button>
                    <button className="btn btn-danger" disabled={deleting} onClick={confirmDelete}>{deleting ? 'Please wait…' : 'Delete transaction'}</button>
                </div>
            </div>
        </Modal>
    </AppShell>;
};

export default FinancialsPage;
