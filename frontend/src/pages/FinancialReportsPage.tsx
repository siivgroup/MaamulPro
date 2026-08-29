import { useEffect, useRef, useState } from 'react';
import AppShell from '../components/maamulpro/AppShell';
import {
    ErrorAlert,
    LoadingState,
    PageHeader,
    money,
    shortDate,
} from '../components/maamulpro/PageKit';
import { ReportHeader } from '../components/maamulpro/ReportHeader';
import { api } from '../lib/api';
import { useBranding } from '../hooks/useBranding';

// ── Types ────────────────────────────────────────────────────

type TrialBalanceRow = {
    code: string;
    name: string;
    type: string;
    normalBalance: string;
    totalDebit: number;
    totalCredit: number;
    balance: number;
};

type TrialBalanceData = {
    asOf: string;
    rows: TrialBalanceRow[];
    totalDebit: number;
    totalCredit: number;
    balanced: boolean;
};

type PnLRow = { code: string; name: string; type: string; balance: number };
type IncomeStatementData = {
    period: { startDate: string | null; endDate: string };
    incomeAccounts: PnLRow[];
    expenseAccounts: PnLRow[];
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
};

type BalanceSheetData = {
    asOf: string;
    assets: PnLRow[];
    liabilities: PnLRow[];
    equity: PnLRow[];
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    balanced: boolean;
};

type GLEntry = {
    id: string;
    date: string;
    batchNumber?: string;
    sourceType?: string;
    memo?: string;
    debit: number;
    credit: number;
    balance: number;
};

type GLAccount = {
    account: { code: string; name: string; type: string; normalBalance: string };
    opening: number;
    closing: number;
    entries: GLEntry[];
};

// ── Helpers ───────────────────────────────────────────────────

function fmt(v: number) {
    return money(v);
}

function colorBalance(v: number) {
    if (v > 0) return 'text-success';
    if (v < 0) return 'text-danger';
    return '';
}

function typeBadge(type: string) {
    const map: Record<string, string> = {
        ASSET: 'badge-outline-primary',
        LIABILITY: 'badge-outline-warning',
        EQUITY: 'badge-outline-info',
        INCOME: 'badge-outline-success',
        EXPENSE: 'badge-outline-danger',
    };
    return <span className={`badge ${map[type] ?? 'badge-outline-secondary'} text-xs`}>{type}</span>;
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <label className="flex flex-col gap-0.5 text-xs font-semibold text-white-dark">
            {label}
            <input
                type="date"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="form-input h-8 text-xs"
            />
        </label>
    );
}

function SectionTotal({ label, value, highlighted = false }: { label: string; value: number; highlighted?: boolean }) {
    return (
        <tr className={highlighted ? 'border-t-2 border-black/20 font-extrabold dark:border-white/20' : 'border-t font-bold'}>
            <td className="py-2 pl-3 pr-2 text-sm">{label}</td>
            <td />
            <td className={`py-2 pr-3 text-right text-sm ${colorBalance(value)}`}>{fmt(value)}</td>
        </tr>
    );
}

// ── Tab: Trial Balance ────────────────────────────────────────

function TrialBalanceTab() {
    const [asOf, setAsOf] = useState('');
    const [data, setData] = useState<TrialBalanceData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function load() {
        setLoading(true);
        setError('');
        try {
            const params = asOf ? `?asOf=${asOf}` : '';
            const result = await api<TrialBalanceData>(`/api/accounting/reports/trial-balance${params}`);
            setData(result);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load trial balance');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    const typeOrder = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];
    const grouped = data
        ? typeOrder.map((t) => ({ type: t, rows: data.rows.filter((r) => r.type === t) })).filter((g) => g.rows.length)
        : [];

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-end gap-3">
                <DateInput label="As of date" value={asOf} onChange={setAsOf} />
                <button className="btn btn-primary btn-sm mt-4" onClick={load} disabled={loading}>Run</button>
            </div>

            {error && <ErrorAlert message={error} onRetry={load} />}
            {loading && <LoadingState />}

            {data && !loading && (
                <div className="overflow-x-auto rounded-lg border border-white-light dark:border-[#1b2e4b]">
                    <table className="w-full table-auto text-sm">
                        <thead>
                            <tr className="bg-white-light/50 dark:bg-[#1a2941]">
                                <th className="py-3 pl-3 text-left font-semibold">Account</th>
                                <th className="py-3 text-left font-semibold">Type</th>
                                <th className="py-3 pr-3 text-right font-semibold">Debit</th>
                                <th className="py-3 pr-3 text-right font-semibold">Credit</th>
                                <th className="py-3 pr-3 text-right font-semibold">Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {grouped.map(({ type, rows }) => (
                                <>
                                    <tr key={`hdr-${type}`} className="bg-white-light/30 dark:bg-[#1a2941]/60">
                                        <td colSpan={5} className="py-1.5 pl-3 text-xs font-bold uppercase tracking-wider text-white-dark">{type}</td>
                                    </tr>
                                    {rows.map((r) => (
                                        <tr key={r.code} className="border-t border-white-light dark:border-[#1b2e4b] hover:bg-white-light/30 dark:hover:bg-[#1a2941]/40">
                                            <td className="py-2 pl-5 pr-2">
                                                <span className="font-mono text-xs text-white-dark">{r.code}</span>
                                                <span className="ml-2">{r.name}</span>
                                            </td>
                                            <td className="py-2 pr-2">{typeBadge(r.type)}</td>
                                            <td className="py-2 pr-3 text-right">{r.totalDebit > 0 ? fmt(r.totalDebit) : '—'}</td>
                                            <td className="py-2 pr-3 text-right">{r.totalCredit > 0 ? fmt(r.totalCredit) : '—'}</td>
                                            <td className={`py-2 pr-3 text-right font-semibold ${colorBalance(r.balance)}`}>{fmt(r.balance)}</td>
                                        </tr>
                                    ))}
                                </>
                            ))}
                            <tr className="border-t-2 border-black/20 bg-white-light/60 font-extrabold dark:border-white/20 dark:bg-[#1a2941]">
                                <td className="py-3 pl-3 text-sm" colSpan={2}>Totals</td>
                                <td className="py-3 pr-3 text-right text-sm">{fmt(data.totalDebit)}</td>
                                <td className="py-3 pr-3 text-right text-sm">{fmt(data.totalCredit)}</td>
                                <td className="py-3 pr-3 text-right text-sm">
                                    {data.balanced
                                        ? <span className="badge badge-outline-success text-xs">Balanced</span>
                                        : <span className="badge badge-outline-danger text-xs">Out of balance</span>}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ── Tab: Income Statement ─────────────────────────────────────

function IncomeStatementTab() {
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [data, setData] = useState<IncomeStatementData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function load() {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams();
            if (startDate) params.set('startDate', startDate);
            if (endDate) params.set('endDate', endDate);
            const result = await api<IncomeStatementData>(`/api/accounting/reports/income-statement?${params}`);
            setData(result);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load income statement');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-end gap-3">
                <DateInput label="From" value={startDate} onChange={setStartDate} />
                <DateInput label="To" value={endDate} onChange={setEndDate} />
                <button className="btn btn-primary btn-sm mt-4" onClick={load} disabled={loading}>Run</button>
            </div>

            {error && <ErrorAlert message={error} onRetry={load} />}
            {loading && <LoadingState />}

            {data && !loading && (
                <div className="grid gap-5 md:grid-cols-2">
                    {/* Revenue */}
                    <div className="rounded-lg border border-white-light dark:border-[#1b2e4b]">
                        <div className="bg-success/10 px-4 py-2.5 font-bold text-success">Revenue</div>
                        <table className="w-full text-sm">
                            <tbody>
                                {data.incomeAccounts.map((r) => (
                                    <tr key={r.code} className="border-t border-white-light dark:border-[#1b2e4b]">
                                        <td className="py-2 pl-4 pr-2">
                                            <span className="font-mono text-xs text-white-dark">{r.code}</span>
                                            <span className="ml-2">{r.name}</span>
                                        </td>
                                        <td className="py-2 pr-4 text-right font-semibold text-success">{fmt(r.balance)}</td>
                                    </tr>
                                ))}
                                {data.incomeAccounts.length === 0 && (
                                    <tr><td colSpan={2} className="py-4 text-center text-white-dark text-sm">No revenue in period</td></tr>
                                )}
                                <SectionTotal label="Total Revenue" value={data.totalIncome} />
                            </tbody>
                        </table>
                    </div>

                    {/* Expenses */}
                    <div className="rounded-lg border border-white-light dark:border-[#1b2e4b]">
                        <div className="bg-danger/10 px-4 py-2.5 font-bold text-danger">Expenses</div>
                        <table className="w-full text-sm">
                            <tbody>
                                {data.expenseAccounts.map((r) => (
                                    <tr key={r.code} className="border-t border-white-light dark:border-[#1b2e4b]">
                                        <td className="py-2 pl-4 pr-2">
                                            <span className="font-mono text-xs text-white-dark">{r.code}</span>
                                            <span className="ml-2">{r.name}</span>
                                        </td>
                                        <td className="py-2 pr-4 text-right font-semibold text-danger">{fmt(r.balance)}</td>
                                    </tr>
                                ))}
                                {data.expenseAccounts.length === 0 && (
                                    <tr><td colSpan={2} className="py-4 text-center text-white-dark text-sm">No expenses in period</td></tr>
                                )}
                                <SectionTotal label="Total Expenses" value={data.totalExpenses} />
                            </tbody>
                        </table>
                    </div>

                    {/* Net Income */}
                    <div className="col-span-full rounded-lg border-2 border-black/10 bg-white-light/60 p-5 dark:border-white/10 dark:bg-[#1a2941]">
                        <div className="flex items-center justify-between">
                            <span className="text-lg font-extrabold">Net Income</span>
                            <span className={`text-2xl font-extrabold ${colorBalance(data.netIncome)}`}>
                                {fmt(data.netIncome)}
                            </span>
                        </div>
                        <div className="mt-1 text-xs text-white-dark">
                            {data.period.startDate ? `${shortDate(data.period.startDate)} – ` : 'All time through '}
                            {shortDate(data.period.endDate)}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Tab: Balance Sheet ────────────────────────────────────────

function BalanceSheetTab() {
    const [asOf, setAsOf] = useState('');
    const [data, setData] = useState<BalanceSheetData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    async function load() {
        setLoading(true);
        setError('');
        try {
            const params = asOf ? `?asOf=${asOf}` : '';
            const result = await api<BalanceSheetData>(`/api/accounting/reports/balance-sheet${params}`);
            setData(result);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load balance sheet');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { load(); }, []);

    function Section({ title, rows, total, color }: { title: string; rows: PnLRow[]; total: number; color: string }) {
        return (
            <div className="rounded-lg border border-white-light dark:border-[#1b2e4b]">
                <div className={`px-4 py-2.5 font-bold ${color}`}>{title}</div>
                <table className="w-full text-sm">
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.code} className="border-t border-white-light dark:border-[#1b2e4b]">
                                <td className="py-2 pl-4 pr-2">
                                    <span className="font-mono text-xs text-white-dark">{r.code}</span>
                                    <span className="ml-2">{r.name}</span>
                                </td>
                                <td className={`py-2 pr-4 text-right font-semibold ${colorBalance(r.balance)}`}>{fmt(r.balance)}</td>
                            </tr>
                        ))}
                        {rows.length === 0 && (
                            <tr><td colSpan={2} className="py-4 text-center text-sm text-white-dark">No accounts</td></tr>
                        )}
                        <SectionTotal label={`Total ${title}`} value={total} />
                    </tbody>
                </table>
            </div>
        );
    }

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-end gap-3">
                <DateInput label="As of date" value={asOf} onChange={setAsOf} />
                <button className="btn btn-primary btn-sm mt-4" onClick={load} disabled={loading}>Run</button>
            </div>

            {error && <ErrorAlert message={error} onRetry={load} />}
            {loading && <LoadingState />}

            {data && !loading && (
                <div className="space-y-5">
                    <Section title="Assets" rows={data.assets} total={data.totalAssets} color="bg-primary/10 text-primary" />
                    <div className="grid gap-5 md:grid-cols-2">
                        <Section title="Liabilities" rows={data.liabilities} total={data.totalLiabilities} color="bg-warning/10 text-warning" />
                        <Section title="Equity" rows={data.equity} total={data.totalEquity} color="bg-info/10 text-info" />
                    </div>
                    <div className="rounded-lg border-2 border-black/10 bg-white-light/60 p-5 dark:border-white/10 dark:bg-[#1a2941]">
                        <div className="flex items-center justify-between">
                            <span className="font-bold">Liabilities + Equity</span>
                            <span className="font-bold">{fmt(data.totalLiabilities + data.totalEquity)}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                            <span className="font-bold">Total Assets</span>
                            <span className="font-bold">{fmt(data.totalAssets)}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-end">
                            {data.balanced
                                ? <span className="badge badge-outline-success">Balanced</span>
                                : <span className="badge badge-outline-danger">Out of balance</span>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Tab: General Ledger ───────────────────────────────────────

function GeneralLedgerTab() {
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [accountSearch, setAccountSearch] = useState('');
    const [accounts, setAccounts] = useState<{ code: string; name: string; type: string }[]>([]);
    const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
    const [data, setData] = useState<GLAccount[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    useEffect(() => {
        api<{ code: string; name: string; type: string }[]>('/api/accounting/accounts')
            .then((r) => setAccounts(r))
            .catch(() => {});
    }, []);

    const filteredAccounts = accounts.filter(
        (a) =>
            !accountSearch ||
            a.name.toLowerCase().includes(accountSearch.toLowerCase()) ||
            a.code.toLowerCase().includes(accountSearch.toLowerCase()),
    );

    function toggleCode(code: string) {
        setSelectedCodes((prev) =>
            prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
        );
    }

    async function load() {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams();
            if (startDate) params.set('startDate', startDate);
            if (endDate) params.set('endDate', endDate);
            if (selectedCodes.length) params.set('accountCodes', selectedCodes.join(','));
            const result = await api<GLAccount[]>(`/api/accounting/reports/general-ledger?${params}`);
            setData(result);
            setExpanded(new Set(result.map((r) => r.account.code)));
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load general ledger');
        } finally {
            setLoading(false);
        }
    }

    function toggle(code: string) {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(code)) next.delete(code);
            else next.add(code);
            return next;
        });
    }

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-end gap-3">
                <DateInput label="From" value={startDate} onChange={setStartDate} />
                <DateInput label="To" value={endDate} onChange={setEndDate} />
                <div className="flex flex-col gap-0.5 text-xs font-semibold text-white-dark">
                    <span>Filter accounts ({selectedCodes.length ? `${selectedCodes.length} selected` : 'all'})</span>
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search accounts…"
                            value={accountSearch}
                            onChange={(e) => setAccountSearch(e.target.value)}
                            className="form-input h-8 text-xs"
                        />
                    </div>
                    {accountSearch && (
                        <div className="absolute z-20 mt-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-white-light bg-white shadow-lg dark:border-[#1b2e4b] dark:bg-[#1a2941]">
                            {filteredAccounts.slice(0, 20).map((a) => (
                                <label key={a.code} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-white-light/50 dark:hover:bg-[#1b2e4b]">
                                    <input
                                        type="checkbox"
                                        checked={selectedCodes.includes(a.code)}
                                        onChange={() => toggleCode(a.code)}
                                        className="form-checkbox"
                                    />
                                    <span className="font-mono text-xs text-white-dark">{a.code}</span>
                                    <span>{a.name}</span>
                                </label>
                            ))}
                        </div>
                    )}
                </div>
                {selectedCodes.length > 0 && (
                    <button className="btn btn-sm btn-outline-danger mt-4" onClick={() => setSelectedCodes([])}>Clear filter</button>
                )}
                <button className="btn btn-primary btn-sm mt-4" onClick={load} disabled={loading}>Run</button>
            </div>

            {error && <ErrorAlert message={error} onRetry={load} />}
            {loading && <LoadingState />}

            {!loading && data.length === 0 && !error && (
                <p className="py-10 text-center text-white-dark">No journal entries found. Click Run to load.</p>
            )}

            {!loading && data.map((g) => (
                <div key={g.account.code} className="mb-5 rounded-lg border border-white-light dark:border-[#1b2e4b]">
                    <button
                        onClick={() => toggle(g.account.code)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left font-bold hover:bg-white-light/30 dark:hover:bg-[#1a2941]/40"
                    >
                        <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-white-dark">{g.account.code}</span>
                            <span>{g.account.name}</span>
                            {typeBadge(g.account.type)}
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                            <span className="text-white-dark">Closing: <span className={`font-bold ${colorBalance(g.closing)}`}>{fmt(g.closing)}</span></span>
                            <span className={`transition-transform ${expanded.has(g.account.code) ? 'rotate-180' : ''}`}>▼</span>
                        </div>
                    </button>

                    {expanded.has(g.account.code) && (
                        <div className="border-t border-white-light dark:border-[#1b2e4b]">
                            <table className="w-full table-auto text-sm">
                                <thead>
                                    <tr className="bg-white-light/50 dark:bg-[#1a2941]/60 text-xs">
                                        <th className="py-2 pl-4 text-left">Date</th>
                                        <th className="py-2 text-left">Ref</th>
                                        <th className="py-2 text-left">Memo</th>
                                        <th className="py-2 pr-3 text-right">Debit</th>
                                        <th className="py-2 pr-3 text-right">Credit</th>
                                        <th className="py-2 pr-3 text-right">Balance</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-t border-white-light bg-white-light/20 text-xs italic text-white-dark dark:border-[#1b2e4b] dark:bg-[#1a2941]/20">
                                        <td colSpan={5} className="py-1.5 pl-4">Opening balance</td>
                                        <td className="py-1.5 pr-3 text-right font-semibold">{fmt(g.opening)}</td>
                                    </tr>
                                    {g.entries.map((e) => (
                                        <tr key={e.id} className="border-t border-white-light dark:border-[#1b2e4b] hover:bg-white-light/30 dark:hover:bg-[#1a2941]/40">
                                            <td className="py-2 pl-4 pr-2 text-xs">{shortDate(e.date)}</td>
                                            <td className="py-2 pr-2 font-mono text-xs text-white-dark">{e.batchNumber ?? '—'}</td>
                                            <td className="py-2 pr-2 text-xs text-white-dark">{e.memo ?? '—'}</td>
                                            <td className="py-2 pr-3 text-right">{e.debit > 0 ? fmt(e.debit) : '—'}</td>
                                            <td className="py-2 pr-3 text-right">{e.credit > 0 ? fmt(e.credit) : '—'}</td>
                                            <td className={`py-2 pr-3 text-right font-semibold ${colorBalance(e.balance)}`}>{fmt(e.balance)}</td>
                                        </tr>
                                    ))}
                                    <tr className="border-t-2 border-black/10 bg-white-light/60 font-bold dark:border-white/10 dark:bg-[#1a2941]">
                                        <td colSpan={5} className="py-2 pl-4 text-xs">Closing balance</td>
                                        <td className={`py-2 pr-3 text-right ${colorBalance(g.closing)}`}>{fmt(g.closing)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

// ── Page ──────────────────────────────────────────────────────

const TABS = [
    { id: 'trial-balance', label: 'Trial Balance' },
    { id: 'income-statement', label: 'Income Statement' },
    { id: 'balance-sheet', label: 'Balance Sheet' },
    { id: 'general-ledger', label: 'General Ledger' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function FinancialReportsPage() {
    const [tab, setTab] = useState<TabId>('trial-balance');
    const printRef = useRef<HTMLDivElement>(null);
    const branding = useBranding();

    function handlePrint() {
        const prev = document.title;
        document.title = '';
        window.print();
        setTimeout(() => { document.title = prev; }, 500);
    }

    const activeTab = TABS.find((t) => t.id === tab);

    return (
        <AppShell>
            <style>{`
                @media print {
                    .print\\:hidden { display: none !important; }
                    [class*="layout"], [class*="wrapper"] { margin: 0 !important; padding: 0 !important; width: 100% !important; }
                }
            `}</style>
            <div className="p-5 print:p-0">
                <div className="print:hidden">
                    <PageHeader
                        title="Financial Reports"
                        actions={
                            <button className="btn btn-outline-primary btn-sm" onClick={handlePrint}>
                                Print / Export PDF
                            </button>
                        }
                    />
                </div>

                {/* Tabs — hidden in print */}
                <div className="mb-5 border-b border-white-light dark:border-[#1b2e4b] print:hidden">
                    <nav className="flex gap-1">
                        {TABS.map((t) => (
                            <button
                                key={t.id}
                                onClick={() => setTab(t.id)}
                                className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                                    tab === t.id
                                        ? 'border-primary text-primary'
                                        : 'border-transparent text-white-dark hover:text-black dark:hover:text-white'
                                }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </nav>
                </div>

                <div ref={printRef}>
                    <ReportHeader branding={branding} title={activeTab?.label ?? 'Financial Report'} />
                    {tab === 'trial-balance' && <TrialBalanceTab />}
                    {tab === 'income-statement' && <IncomeStatementTab />}
                    {tab === 'balance-sheet' && <BalanceSheetTab />}
                    {tab === 'general-ledger' && <GeneralLedgerTab />}
                    <div className="mt-8 flex justify-between border-t border-white-light pt-3 text-[10px] text-white-dark dark:border-[#1b2e4b] hidden print:flex">
                        <span>{branding?.companyName || 'MaamulPro'} · Confidential</span>
                        <span>Generated {new Date().toLocaleString()}</span>
                    </div>
                </div>
            </div>
        </AppShell>
    );
}
