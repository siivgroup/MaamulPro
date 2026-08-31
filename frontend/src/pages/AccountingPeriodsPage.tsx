import { FormEvent, useEffect, useState } from 'react';
import AppShell from '../components/maamulpro/AppShell';
import { EmptyState, ErrorAlert, Field, LoadingState, PageHeader, StatusPill, shortDate } from '../components/maamulpro/PageKit';
import { api, sessionStore } from '../lib/api';

type Period = { id: string; name: string; startDate: string; endDate: string; status: string; lockedAt?: string };

const AccountingPeriodsPage = () => {
    const canManage = Boolean(sessionStore.get()?.user.permissions?.includes('accounting.approve') || ['COMPANY_OWNER', 'SUPER_ADMIN'].includes(sessionStore.get()?.user.role || ''));
    const [rows, setRows] = useState<Period[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
    const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });
    const load = () => { setLoading(true); api<Period[]>('/api/accounting/periods').then(setRows).catch((reason) => setError(reason.message)).finally(() => setLoading(false)); };
    useEffect(load, []);
    const create = async (event: FormEvent) => { event.preventDefault(); try { await api('/api/accounting/periods', { method: 'POST', body: JSON.stringify(form) }); setForm({ name: '', startDate: '', endDate: '' }); load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create period'); } };
    const toggle = async (row: Period) => { try { await api(`/api/accounting/periods/${row.id}/${row.status === 'LOCKED' ? 'unlock' : 'lock'}`, { method: 'POST' }); load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update period'); } };
    return <AppShell><PageHeader eyebrow="Accounting controls" title="Accounting periods" description="The current month opens automatically. Lock completed periods to prevent late or accidental postings." />
        {error && <ErrorAlert message={error} onRetry={load} />}
        {canManage && <form className="panel mb-5 grid items-end gap-4 md:grid-cols-4" onSubmit={create}><Field label="Period name" required><input className="form-input mt-1" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field><Field label="Start date" required><input className="form-input mt-1" type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></Field><Field label="End date" required><input className="form-input mt-1" type="date" required value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field><button className="btn btn-primary">Create period</button></form>}
        {loading ? <div className="panel"><LoadingState label="Loading accounting periods…" /></div> : !rows.length ? <div className="panel"><EmptyState title="No accounting periods" description="The current month will be created automatically when accounting activity begins." /></div> : <div className="panel overflow-hidden p-0"><div className="overflow-x-auto"><table className="table-hover"><thead><tr><th>Period</th><th>From</th><th>To</th><th>Status</th>{canManage && <th />}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="font-bold">{row.name}</td><td>{shortDate(row.startDate)}</td><td>{shortDate(row.endDate)}</td><td><StatusPill value={row.status} /></td>{canManage && <td><button className={`btn btn-sm ${row.status === 'LOCKED' ? 'btn-outline-success' : 'btn-outline-danger'}`} onClick={() => toggle(row)}>{row.status === 'LOCKED' ? 'Unlock' : 'Lock'}</button></td>}</tr>)}</tbody></table></div></div>}
    </AppShell>;
};

export default AccountingPeriodsPage;
