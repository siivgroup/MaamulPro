import { FormEvent, useMemo, useState } from 'react';
import AppShell from '../components/maamulpro/AppShell';
import {
    EmptyState,
    ErrorAlert,
    Field,
    FormActions,
    LoadingState,
    Modal,
    PageHeader,
    StatGrid,
    formatDescription,
    formatReference,
    money,
    shortDate,
} from '../components/maamulpro/PageKit';
import { api } from '../lib/api';
import { useApiRows } from '../hooks/useApiData';
import { usePermissions } from '../hooks/usePermissions';

type Account = {
    code: string;
    name: string;
    parentCode?: string | null;
    type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
    normalBalance: 'DEBIT' | 'CREDIT';
    description?: string | null;
    isActive: boolean;
    allowNegative: boolean;
    isSystem: boolean;
    currentBalance: number;
};

const blankForm = {
    code: '',
    name: '',
    type: 'EXPENSE' as Account['type'],
    parentCode: '',
    description: '',
    isActive: true,
    allowNegative: true,
};

const typeTone: Record<Account['type'], string> = {
    ASSET: 'bg-primary-light text-primary',
    LIABILITY: 'bg-warning-light text-warning',
    EQUITY: 'bg-secondary-light text-secondary',
    INCOME: 'bg-success-light text-success',
    EXPENSE: 'bg-danger-light text-danger',
};

const AccountsPage = () => {
    const state = useApiRows<Account>('/api/accounting/accounts');
    const { hasPermission } = usePermissions();
    const canManage = hasPermission('accounting.manage');
    const [form, setForm] = useState(blankForm);
    const [editing, setEditing] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [deleteCode, setDeleteCode] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [showInactive, setShowInactive] = useState(false);

    const [viewAccount, setViewAccount] = useState<Account | null>(null);
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [ledgerData, setLedgerData] = useState<{
        openingBalance: number;
        lines: Array<{
            id: string;
            accountCode?: string;
            date: string;
            batchNumber?: string;
            sourceType?: string;
            sourceRef?: string;
            memo?: string;
            debit: number;
            credit: number;
            balance: number;
        }>;
        total: number;
    } | null>(null);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const openDetail = async (acc: Account, start = startDate, end = endDate) => {
        setViewAccount(acc);
        setLedgerLoading(true);
        try {
            const params = new URLSearchParams();
            if (start) params.set('startDate', start);
            if (end) params.set('endDate', end);
            const res = await api<{
                account: Account;
                opening?: number;
                openingBalance?: number;
                closing?: number;
                data?: any[];
                lines?: any[];
                total?: number;
                pagination?: { total: number };
            }>(`/api/accounting/accounts/${acc.code}/ledger?${params.toString()}`);
            const lines = res.lines || res.data || [];
            const openingBalance = res.openingBalance ?? res.opening ?? 0;
            const total = res.total ?? res.pagination?.total ?? lines.length;
            setLedgerData({
                openingBalance,
                lines,
                total,
            });
        } catch (err) {
            console.error('Failed to load account ledger:', err);
        } finally {
            setLedgerLoading(false);
        }
    };

    const applyLedgerDates = (start: string, end: string) => {
        setStartDate(start);
        setEndDate(end);
        if (viewAccount) {
            openDetail(viewAccount, start, end);
        }
    };

    const rows = useMemo(
        () => (showInactive ? state.rows : state.rows.filter((r) => r.isActive)),
        [state.rows, showInactive],
    );

    // Group children under parents in a stable, code-sorted tree.
    const tree = useMemo(() => {
        const byParent = new Map<string | null, Account[]>();
        for (const acc of rows) {
            const key = acc.parentCode ?? null;
            if (!byParent.has(key)) byParent.set(key, []);
            byParent.get(key)!.push(acc);
        }
        for (const list of byParent.values()) list.sort((a, b) => a.code.localeCompare(b.code));
        const flatten = (parent: string | null, depth: number, out: Array<Account & { depth: number }>) => {
            for (const acc of byParent.get(parent) ?? []) {
                out.push({ ...acc, depth });
                flatten(acc.code, depth + 1, out);
            }
        };
        const out: Array<Account & { depth: number }> = [];
        flatten(null, 0, out);
        return out;
    }, [rows]);

    const totals = useMemo(() => {
        const t = { ASSET: 0, LIABILITY: 0, EQUITY: 0, INCOME: 0, EXPENSE: 0 } as Record<Account['type'], number>;
        for (const a of state.rows) if (!a.parentCode) t[a.type] += a.currentBalance;
        return t;
    }, [state.rows]);

    const save = async (event: FormEvent) => {
        event.preventDefault();
        try {
            await api(
                editing ? `/api/accounting/accounts/${editing}` : '/api/accounting/accounts',
                {
                    method: editing ? 'PATCH' : 'POST',
                    body: JSON.stringify({
                        ...form,
                        parentCode: form.parentCode || undefined,
                        description: form.description || undefined,
                    }),
                },
            );
            setOpen(false);
            await state.reload();
        } catch (reason) {
            state.setError(reason instanceof Error ? reason.message : 'Unable to save account');
        }
    };

    const toggleActive = async (row: Account) => {
        try {
            await api(`/api/accounting/accounts/${row.code}/active`, {
                method: 'PATCH',
                body: JSON.stringify({ isActive: !row.isActive }),
            });
            await state.reload();
        } catch (reason) {
            state.setError(reason instanceof Error ? reason.message : 'Unable to update account');
        }
    };

    const confirmDelete = async () => {
        if (!deleteCode) return;
        setDeleting(true);
        try {
            await api(`/api/accounting/accounts/${deleteCode}`, { method: 'DELETE' });
            setDeleteCode(null);
            await state.reload();
        } catch (reason) {
            state.setError(reason instanceof Error ? reason.message : 'Unable to delete account');
        } finally {
            setDeleting(false);
        }
    };

    const openCreate = () => {
        setEditing(null);
        setForm(blankForm);
        setOpen(true);
    };

    const openEdit = (row: Account) => {
        setEditing(row.code);
        setForm({
            code: row.code,
            name: row.name,
            type: row.type,
            parentCode: row.parentCode || '',
            description: row.description || '',
            isActive: row.isActive,
            allowNegative: row.allowNegative,
        });
        setOpen(true);
    };

    const parentOptions = state.rows
        .filter((row) => row.code !== editing && row.type === form.type)
        .sort((a, b) => a.code.localeCompare(b.code));

    return (
        <AppShell>
            <PageHeader
                eyebrow="Accounting"
                title="Chart of Accounts"
                description="Hierarchical accounts used by double-entry postings and financial reports. Balances update as journal entries are posted."
                actions={
                    <>
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-white-dark">
                            <input
                                type="checkbox"
                                className="form-checkbox"
                                checked={showInactive}
                                onChange={(e) => setShowInactive(e.target.checked)}
                            />
                            Show inactive
                        </label>
                        {canManage && (
                            <button className="btn btn-primary" onClick={openCreate}>
                                Add account
                            </button>
                        )}
                    </>
                }
            />
            {state.error && <ErrorAlert message={state.error} onRetry={state.reload} />}
            <StatGrid
                items={[
                    { label: 'Assets', value: money(totals.ASSET), tone: 'primary' },
                    { label: 'Liabilities', value: money(totals.LIABILITY), tone: 'warning' },
                    { label: 'Equity', value: money(totals.EQUITY), tone: 'secondary' },
                    { label: 'Income', value: money(totals.INCOME), tone: 'success' },
                    { label: 'Expenses', value: money(totals.EXPENSE), tone: 'danger' },
                ]}
            />
            <div className="panel overflow-hidden p-0">
                {state.loading ? (
                    <LoadingState />
                ) : !tree.length ? (
                    <EmptyState
                        title="No accounts configured"
                        description="Add your first account to start recording balanced journal entries."
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="table-hover w-full">
                            <thead>
                                <tr>
                                    <th>Code</th>
                                    <th>Account</th>
                                    <th>Type</th>
                                    <th className="text-right">Balance</th>
                                    <th>Status</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {tree.map((row) => (
                                    <tr
                                        key={row.code}
                                        className={`group cursor-pointer ${row.isActive ? '' : 'opacity-60'} transition-all duration-150 hover:bg-primary/10 dark:hover:bg-primary/20`}
                                        onClick={() => openDetail(row)}
                                        title={`Click to view ledger for account ${row.code} · ${row.name}`}
                                    >
                                        <td className="font-mono font-bold text-primary group-hover:underline">
                                            <span className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">{row.code}</span>
                                        </td>
                                        <td>
                                            <span style={{ paddingLeft: row.depth * 20 }}>
                                                {row.depth > 0 && <span className="text-white-dark">↳ </span>}
                                                <span className="font-semibold text-secondary dark:text-white group-hover:text-primary transition-colors duration-150">{row.name}</span>
                                                {row.isSystem && (
                                                    <span className="ml-2 rounded bg-secondary-light px-1 py-0.5 text-[10px] uppercase text-secondary">
                                                        system
                                                    </span>
                                                )}
                                            </span>
                                            {row.description && (
                                                <div
                                                    className="text-xs text-white-dark"
                                                    style={{ paddingLeft: row.depth * 20 }}
                                                >
                                                    {row.description}
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            <span className={`badge ${typeTone[row.type]} group-hover:shadow-sm`}>{row.type}</span>
                                        </td>
                                        <td className="text-right font-mono font-bold group-hover:text-primary transition-colors duration-150">
                                            {money(row.currentBalance)}
                                        </td>
                                        <td>
                                            {row.isActive ? (
                                                <span className="badge bg-success-light text-success">Active</span>
                                            ) : (
                                                <span className="badge bg-danger-light text-danger">Inactive</span>
                                            )}
                                            {!row.allowNegative && (
                                                <span className="ml-1 badge bg-warning-light text-warning">
                                                    No-negative
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    className="btn btn-sm btn-outline-info"
                                                    onClick={(e) => { e.stopPropagation(); openDetail(row); }}
                                                >
                                                    Ledger
                                                </button>
                                                {canManage && <>
                                                    <button
                                                        className="btn btn-sm btn-outline-primary"
                                                        onClick={(e) => { e.stopPropagation(); openEdit(row); }}
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        className="btn btn-sm btn-outline-secondary"
                                                        onClick={(e) => { e.stopPropagation(); toggleActive(row); }}
                                                    >
                                                        {row.isActive ? 'Deactivate' : 'Activate'}
                                                    </button>
                                                    {!row.isSystem && (
                                                        <button
                                                            className="btn btn-sm btn-outline-danger"
                                                            onClick={(e) => { e.stopPropagation(); setDeleteCode(row.code); }}
                                                        >
                                                            Delete
                                                        </button>
                                                    )}
                                                </>}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <Modal title={editing ? 'Edit account' : 'Add account'} open={open} onClose={() => setOpen(false)}>
                <form className="space-y-4" onSubmit={save}>
                    <div className="grid gap-4 md:grid-cols-2">
                        {editing && <Field label="Account code">
                            <input className="form-input mt-1" disabled value={form.code} />
                        </Field>}
                        <Field label="Type" required>
                            <select
                                className="form-select mt-1"
                                value={form.type}
                                onChange={(e) =>
                                    setForm({
                                        ...form,
                                        type: e.target.value as Account['type'],
                                        parentCode: '',
                                    })
                                }
                            >
                                {(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const).map((t) => (
                                    <option key={t} value={t}>
                                        {t}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </div>
                    <Field label="Account name" required>
                        <input
                            className="form-input mt-1"
                            required
                            placeholder="e.g. Office operating account"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                        />
                    </Field>
                    <Field label="Parent account (same type)">
                        <select
                            className="form-select mt-1"
                            value={form.parentCode}
                            onChange={(e) => setForm({ ...form, parentCode: e.target.value })}
                        >
                            <option value="">Root account</option>
                            {parentOptions.map((row) => (
                                <option key={row.code} value={row.code}>
                                    {row.code} · {row.name}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Description">
                        <textarea
                            className="form-textarea mt-1"
                            rows={2}
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                        />
                    </Field>
                    <div className="grid gap-2 md:grid-cols-2">
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                className="form-checkbox"
                                checked={form.isActive}
                                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                            />
                            <span className="text-sm">Active</span>
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                className="form-checkbox"
                                checked={form.allowNegative}
                                onChange={(e) => setForm({ ...form, allowNegative: e.target.checked })}
                            />
                            <span className="text-sm">Allow negative balance</span>
                        </label>
                    </div>
                    <FormActions onCancel={() => setOpen(false)} saveLabel="Save account" />
                </form>
            </Modal>
            <Modal open={Boolean(deleteCode)} onClose={() => setDeleteCode(null)} title="Delete account">
                <div className="space-y-4">
                    <p className="text-white-dark">
                        This permanently removes account <strong>{deleteCode}</strong>. Only accounts with no
                        journal entries or children can be deleted; otherwise, deactivate it instead.
                    </p>
                    <div className="flex justify-end gap-2">
                        <button
                            className="btn btn-outline-dark"
                            disabled={deleting}
                            onClick={() => setDeleteCode(null)}
                        >
                            Cancel
                        </button>
                        <button className="btn btn-danger" disabled={deleting} onClick={confirmDelete}>
                            {deleting ? 'Please wait…' : 'Delete account'}
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal open={Boolean(viewAccount)} onClose={() => setViewAccount(null)} title={`Account Detail · ${viewAccount?.code || ''}`} wide>
                {viewAccount && (
                    <div className="space-y-5">
                        <div className="rounded-lg border border-white-light bg-slate-50 p-4 dark:border-dark dark:bg-[#0e1726]">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-lg font-bold text-primary">{viewAccount.code}</span>
                                        <h3 className="text-lg font-bold text-secondary dark:text-white">{viewAccount.name}</h3>
                                        <span className={`badge ${typeTone[viewAccount.type]}`}>{viewAccount.type}</span>
                                        {viewAccount.isSystem && <span className="badge bg-secondary-light text-secondary">System</span>}
                                    </div>
                                    {viewAccount.description && (
                                        <p className="mt-1 text-sm text-white-dark">{viewAccount.description}</p>
                                    )}
                                </div>
                                <div className="text-right">
                                    <div className="text-xs uppercase text-white-dark">Current Balance</div>
                                    <div className="text-2xl font-extrabold text-secondary dark:text-white">{money(viewAccount.currentBalance)}</div>
                                </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-4 border-t border-white-light pt-3 text-xs text-white-dark dark:border-dark">
                                <div>Normal Balance: <strong className="text-secondary dark:text-white">{viewAccount.normalBalance}</strong></div>
                                {viewAccount.parentCode && <div>Parent Account: <strong className="text-secondary dark:text-white">{viewAccount.parentCode}</strong></div>}
                                <div>Status: <strong className={viewAccount.isActive ? 'text-success' : 'text-danger'}>{viewAccount.isActive ? 'Active' : 'Inactive'}</strong></div>
                                <div>Allow Negative: <strong className="text-secondary dark:text-white">{viewAccount.allowNegative ? 'Yes' : 'No'}</strong></div>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white-light p-3 dark:border-dark">
                            <div className="text-sm font-bold text-secondary dark:text-white">Account Ledger & Transactions</div>
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    type="date"
                                    className="form-input text-xs"
                                    value={startDate}
                                    onChange={(e) => applyLedgerDates(e.target.value, endDate)}
                                />
                                <span className="text-xs text-white-dark">to</span>
                                <input
                                    type="date"
                                    className="form-input text-xs"
                                    value={endDate}
                                    onChange={(e) => applyLedgerDates(startDate, e.target.value)}
                                />
                                {(startDate || endDate) && (
                                    <button
                                        type="button"
                                        className="btn btn-xs btn-outline-dark"
                                        onClick={() => applyLedgerDates('', '')}
                                    >
                                        Clear dates
                                    </button>
                                )}
                            </div>
                        </div>

                        {ledgerLoading ? (
                            <LoadingState label="Loading account ledger…" />
                        ) : !ledgerData || !ledgerData.lines.length ? (
                            <EmptyState title="No transactions posted to this account" description="Post journal entries or record synchronized operational transactions to see ledger activity." />
                        ) : (
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                    <div className="rounded-md bg-primary-light p-3 text-center">
                                        <div className="text-[10px] font-bold uppercase text-primary">Opening Balance</div>
                                        <div className="text-base font-bold text-primary">{money(ledgerData.openingBalance)}</div>
                                    </div>
                                    <div className="rounded-md bg-success-light p-3 text-center">
                                        <div className="text-[10px] font-bold uppercase text-success">Total Debits</div>
                                        <div className="text-base font-bold text-success">{money(ledgerData.lines.reduce((s, l) => s + (l.debit || 0), 0))}</div>
                                    </div>
                                    <div className="rounded-md bg-danger-light p-3 text-center">
                                        <div className="text-[10px] font-bold uppercase text-danger">Total Credits</div>
                                        <div className="text-base font-bold text-danger">{money(ledgerData.lines.reduce((s, l) => s + (l.credit || 0), 0))}</div>
                                    </div>
                                    <div className="rounded-md bg-secondary-light p-3 text-center">
                                        <div className="text-[10px] font-bold uppercase text-secondary">Ending Balance</div>
                                        <div className="text-base font-bold text-secondary">{money(ledgerData.lines[ledgerData.lines.length - 1]?.balance ?? ledgerData.openingBalance)}</div>
                                    </div>
                                </div>

                                <div className="overflow-x-auto rounded-lg border border-white-light dark:border-dark">
                                    <table className="table-hover w-full text-xs">
                                        <thead>
                                            <tr>
                                                <th>Date</th>
                                                <th>Account</th>
                                                <th>Batch #</th>
                                                <th>Source</th>
                                                <th>Reference</th>
                                                <th>Description / Memo</th>
                                                <th className="text-right">Debit</th>
                                                <th className="text-right">Credit</th>
                                                <th className="text-right">Running Balance</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {ledgerData.lines.map((line) => (
                                                <tr key={line.id}>
                                                    <td>{shortDate(line.date)}</td>
                                                    <td className="font-mono text-xs font-bold text-primary">{line.accountCode || viewAccount.code}</td>
                                                    <td className="font-mono font-semibold">{line.batchNumber || '—'}</td>
                                                    <td>
                                                        {line.sourceType && (
                                                            <span className="badge bg-primary-light text-primary text-[10px]">
                                                                {line.sourceType}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="font-mono text-white-dark">{formatReference(line.sourceRef, line.id)}</td>
                                                    <td>{formatDescription(line.memo)}</td>
                                                    <td className="text-right font-mono font-semibold text-success">
                                                        {line.debit > 0 ? money(line.debit) : '—'}
                                                    </td>
                                                    <td className="text-right font-mono font-semibold text-danger">
                                                        {line.credit > 0 ? money(line.credit) : '—'}
                                                    </td>
                                                    <td className="text-right font-mono font-bold">
                                                        {money(line.balance)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </Modal>
        </AppShell>
    );
};

export default AccountsPage;
