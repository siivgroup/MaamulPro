import { useCallback, useEffect, useMemo, useState } from 'react';
import AppShell from '../components/maamulpro/AppShell';
import {
    EmptyState,
    ErrorAlert,
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
import { usePermissions } from '../hooks/usePermissions';

type BatchListItem = {
    id: string;
    batchNumber: string;
    date: string;
    memo?: string | null;
    sourceType: string;
    sourceRef?: string | null;
    status: 'POSTED' | 'PENDING_APPROVAL' | 'REVERSED' | 'VOID';
    totalDebit: string | number;
    totalCredit: string | number;
    postedBy?: { name?: string; email?: string } | null;
    reversedByBatchId?: string | null;
};

type BatchDetail = BatchListItem & {
    entries: Array<{
        id: string;
        accountCode: string;
        debit: string | number;
        credit: string | number;
        memo?: string | null;
        contactName?: string | null;
        lineNumber: number;
        account?: { code: string; name: string; type: string };
    }>;
    reverses?: { id: string; batchNumber: string } | null;
    reversedBy?: { id: string; batchNumber: string } | null;
};

const statusTone: Record<BatchListItem['status'], string> = {
    POSTED: 'bg-success-light text-success',
    PENDING_APPROVAL: 'bg-warning-light text-warning',
    REVERSED: 'bg-secondary-light text-secondary',
    VOID: 'bg-danger-light text-danger',
};

const JournalEntriesPage = () => {
    const { hasPermission } = usePermissions();
    const [rows, setRows] = useState<BatchListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [sourceFilter, setSourceFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [search, setSearch] = useState('');
    const [detail, setDetail] = useState<BatchDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [reversing, setReversing] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ limit: '100' });
            if (sourceFilter) params.set('sourceType', sourceFilter);
            if (statusFilter) params.set('status', statusFilter);
            if (search) params.set('search', search);
            const result = await api<{ data: BatchListItem[] }>(
                `/api/accounting/journals?${params.toString()}`,
            );
            setRows(result.data || []);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to load journal entries');
        } finally {
            setLoading(false);
        }
    }, [sourceFilter, statusFilter, search]);

    useEffect(() => {
        reload();
    }, [reload]);

    const openDetail = async (id: string) => {
        setDetailLoading(true);
        try {
            const result = await api<BatchDetail>(`/api/accounting/journals/${id}`);
            setDetail(result);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to load batch');
        } finally {
            setDetailLoading(false);
        }
    };

    const reverse = async (batch: BatchDetail) => {
        setReversing(batch.id);
        try {
            await api(`/api/accounting/journals/${batch.id}/reverse`, { method: 'POST' });
            setDetail(null);
            await reload();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to reverse batch');
        } finally {
            setReversing(null);
        }
    };

    const totals = useMemo(() => {
        const posted = rows.filter((r) => r.status === 'POSTED');
        const totalDebit = posted.reduce((s, r) => s + Number(r.totalDebit), 0);
        return {
            batches: rows.length,
            posted: posted.length,
            reversed: rows.filter((r) => r.status === 'REVERSED').length,
            totalDebit,
        };
    }, [rows]);

    return (
        <AppShell>
            <PageHeader
                eyebrow="Accounting"
                title="Journal Entries"
                description="Every balanced double-entry batch posted to the ledger. Transactions, invoices, payments and payroll postings appear here."
            />
            {error && <ErrorAlert message={error} onRetry={reload} />}
            <StatGrid
                items={[
                    { label: 'Total batches', value: totals.batches },
                    { label: 'Posted', value: totals.posted, tone: 'success' },
                    { label: 'Reversed', value: totals.reversed, tone: 'secondary' },
                    { label: 'Total DR posted', value: money(totals.totalDebit) },
                ]}
            />
            <div className="panel mb-4 flex flex-wrap items-center gap-3 p-4">
                <input
                    className="form-input max-w-xs"
                    placeholder="Search batch # / memo / ref"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <select
                    className="form-select max-w-xs"
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                >
                    <option value="">All sources</option>
                    {['MANUAL', 'TRANSACTION', 'INVOICE', 'PAYMENT', 'PAYROLL', 'RENTAL', 'DEAL', 'PURCHASE', 'REVERSAL'].map(
                        (s) => (
                            <option key={s} value={s}>
                                {s === 'DEAL' ? 'SALE' : s}
                            </option>
                        ),
                    )}
                </select>
                <select
                    className="form-select max-w-xs"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
                    <option value="">All statuses</option>
                    {['POSTED', 'PENDING_APPROVAL', 'REVERSED', 'VOID'].map((s) => (
                        <option key={s} value={s}>
                            {s}
                        </option>
                    ))}
                </select>
            </div>
            <div className="panel overflow-hidden p-0">
                {loading ? (
                    <LoadingState />
                ) : !rows.length ? (
                    <EmptyState
                        title="No journal entries yet"
                        description="Post a transaction, invoice or payment — the balanced entry will show up here."
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="table-hover w-full">
                            <thead>
                                <tr>
                                    <th>Batch #</th>
                                    <th>Date</th>
                                    <th>Source</th>
                                    <th>Memo</th>
                                    <th className="text-right">Amount</th>
                                    <th>Status</th>
                                    <th>Posted by</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row.id}>
                                        <td className="font-mono">{row.batchNumber}</td>
                                        <td>{shortDate(row.date)}</td>
                                        <td>
                                            <span className="badge bg-primary-light text-primary">
                                                {row.sourceType}
                                            </span>
                                            {row.sourceRef && (
                                                <span className="ml-1 text-xs text-white-dark font-mono">
                                                    {formatReference(row.sourceRef)}
                                                </span>
                                            )}
                                        </td>
                                        <td>{formatDescription(row.memo)}</td>
                                        <td className="text-right font-mono">
                                            {money(Number(row.totalDebit))}
                                        </td>
                                        <td>
                                            <span className={`badge ${statusTone[row.status]}`}>
                                                {row.status}
                                            </span>
                                        </td>
                                        <td className="text-sm">{row.postedBy?.name || '—'}</td>
                                        <td>
                                            <button
                                                className="btn btn-sm btn-outline-primary"
                                                onClick={() => openDetail(row.id)}
                                            >
                                                View
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title="Journal batch" wide>
                {detailLoading || !detail ? (
                    <LoadingState />
                ) : (
                    <div className="space-y-4">
                        <div className="grid gap-2 md:grid-cols-4">
                            <div>
                                <div className="text-xs uppercase text-white-dark">Batch #</div>
                                <div className="font-mono">{detail.batchNumber}</div>
                            </div>
                            <div>
                                <div className="text-xs uppercase text-white-dark">Date</div>
                                <div>{shortDate(detail.date)}</div>
                            </div>
                            <div>
                                <div className="text-xs uppercase text-white-dark">Status</div>
                                <span className={`badge ${statusTone[detail.status]}`}>{detail.status}</span>
                            </div>
                            <div>
                                <div className="text-xs uppercase text-white-dark">Source</div>
                                <div>
                                    <span className="badge bg-primary-light text-primary">
                                        {detail.sourceType}
                                    </span>
                                    {detail.sourceRef && (
                                        <span className="ml-1 text-xs text-white-dark font-mono">
                                            {formatReference(detail.sourceRef)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                        {detail.memo && (
                            <div>
                                <div className="text-xs uppercase text-white-dark">Memo</div>
                                <div>{detail.memo}</div>
                            </div>
                        )}
                        {detail.reversedBy && (
                            <div className="rounded-md bg-danger-light p-3 text-sm font-semibold text-danger">
                                ⚠️ This transaction was reversed by batch <span className="font-mono underline">{detail.reversedBy.batchNumber}</span>.
                            </div>
                        )}
                        {detail.reverses && (
                            <div className="rounded-md bg-info-light p-3 text-sm font-semibold text-info">
                                ℹ️ This is a reversing entry for batch <span className="font-mono underline">{detail.reverses.batchNumber}</span>.
                            </div>
                        )}
                        <div className="overflow-x-auto">
                            <table className="table-hover w-full">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Account</th>
                                        <th className="text-right">Debit</th>
                                        <th className="text-right">Credit</th>
                                        <th>Memo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.entries.map((line) => (
                                        <tr key={line.id}>
                                            <td>{line.lineNumber}</td>
                                            <td>
                                                <span className="font-mono">{line.accountCode}</span>
                                                {line.account && (
                                                    <span className="ml-2 text-sm text-white-dark">
                                                        {line.account.name}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="text-right font-mono">
                                                {Number(line.debit) > 0 ? money(Number(line.debit)) : ''}
                                            </td>
                                            <td className="text-right font-mono">
                                                {Number(line.credit) > 0 ? money(Number(line.credit)) : ''}
                                            </td>
                                            <td>{line.memo || ''}</td>
                                        </tr>
                                    ))}
                                    <tr className="border-t-2 font-bold">
                                        <td colSpan={2} className="text-right">
                                            Totals
                                        </td>
                                        <td className="text-right font-mono">
                                            {money(Number(detail.totalDebit))}
                                        </td>
                                        <td className="text-right font-mono">
                                            {money(Number(detail.totalCredit))}
                                        </td>
                                        <td />
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        {hasPermission('accounting.post') && detail.status === 'POSTED' && !detail.reversedByBatchId && (
                            <div className="flex justify-end gap-2">
                                <button
                                    className="btn btn-outline-warning"
                                    disabled={reversing === detail.id}
                                    onClick={() => reverse(detail)}
                                >
                                    {reversing === detail.id ? 'Reversing…' : 'Reverse this batch'}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </Modal>
        </AppShell>
    );
};

export default JournalEntriesPage;
