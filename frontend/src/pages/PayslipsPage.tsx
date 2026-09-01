import { useMemo, useState } from 'react';
import AppShell from '../components/maamulpro/AppShell';
import { EmptyState, ErrorAlert, LoadingState, Modal, PageHeader, StatGrid, StatusPill, money } from '../components/maamulpro/PageKit';
import { ReportHeader } from '../components/maamulpro/ReportHeader';
import { useApiRows } from '../hooks/useApiData';
import { useBranding } from '../hooks/useBranding';

const printNow = () => {
    const prev = document.title;
    document.title = '';
    window.print();
    setTimeout(() => { document.title = prev; }, 500);
};

const PayslipsPage = () => {
    const state = useApiRows<Record<string, any>>('/api/payroll/payslips/list');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<Record<string, any> | null>(null);
    const branding = useBranding();
    const rows = useMemo(() => state.rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search.toLowerCase())), [state.rows, search]);
    const total = rows.reduce((sum, row) => sum + Number(row.netSalary || 0), 0);
    return <AppShell>
        <PageHeader eyebrow="Payroll documents" title="Payslips" description="Search employee payroll results, review deductions and print individual payslips." actions={<button className="btn btn-outline-primary print:hidden" onClick={printNow}>Print current view</button>} />
        {state.error && <ErrorAlert message={state.error} onRetry={state.reload} />}
        <StatGrid items={[{ label: 'Payslips', value: rows.length }, { label: 'Net payroll', value: money(total), tone: 'success' }, { label: 'Gross payroll', value: money(rows.reduce((sum, row) => sum + Number(row.grossSalary || 0), 0)) }, { label: 'Deductions & tax', value: money(rows.reduce((sum, row) => sum + Number(row.deductions || 0) + Number(row.tax || 0), 0)), tone: 'danger' }]} />
        <div className="panel mb-5 print:hidden"><input className="form-input max-w-xl" placeholder="Search employee, payslip number or period…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <div className="panel print-document overflow-hidden p-0">{state.loading ? <LoadingState /> : !rows.length ? <EmptyState title="No payslips found" /> : <div className="overflow-x-auto"><table className="table-hover w-full"><thead><tr><th>Payslip</th><th>Employee</th><th>Period</th><th>Status</th><th>Gross</th><th>Deductions</th><th>Net</th><th className="print:hidden" /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="font-mono text-xs">{row.payslipNumber || row.id.slice(0, 8)}</td><td><strong>{row.employeeName}</strong><small className="block text-white-dark">{row.employeePosition || row.employeeDepartment}</small></td><td>{row.payroll?.payPeriod || `${row.payroll?.year}-${row.payroll?.month}`}</td><td><StatusPill value={row.status} /></td><td>{money(row.grossSalary)}</td><td>{money(Number(row.deductions) + Number(row.tax))}</td><td className="font-bold text-success">{money(row.netSalary)}</td><td className="print:hidden"><button className="btn btn-sm btn-outline-primary" onClick={() => setSelected(row)}>View</button></td></tr>)}</tbody></table></div>}</div>
        <Modal title="Employee Payslip" open={Boolean(selected)} onClose={() => setSelected(null)}>{selected && <div id="payslip-print" className="print-document space-y-5">
            <ReportHeader
                branding={branding}
                title="Payslip"
                subtitle={selected.payroll?.payPeriod}
            />
            <div className="grid grid-cols-2 gap-4"><div><p className="text-xs text-white-dark">Employee</p><strong>{selected.employeeName}</strong></div><div><p className="text-xs text-white-dark">Payslip number</p><strong>{selected.payslipNumber || selected.id}</strong></div><div><p className="text-xs text-white-dark">Position</p><strong>{selected.employeePosition || '—'}</strong></div><div><p className="text-xs text-white-dark">Department</p><strong>{selected.employeeDepartment}</strong></div></div>
            <div className="rounded-lg border border-white-light dark:border-[#191e3a]">{[['Base salary', selected.baseSalary], ['Bonuses', selected.bonuses], ['Gross salary', selected.grossSalary], ['Deductions', selected.deductions], ['Tax', selected.tax], ['Net salary', selected.netSalary]].map(([label, value]) => <div key={label} className="flex justify-between border-b border-white-light p-3 last:border-0 dark:border-[#191e3a]"><span>{label}</span><strong>{money(value)}</strong></div>)}</div>
            <div className="flex justify-between border-t border-white-light pt-3 text-[10px] text-white-dark dark:border-[#191e3a]">
                <span>{branding?.companyName || 'MaamulPro'} · Confidential</span>
                <span>Generated {new Date().toLocaleString()}</span>
            </div>
            <button className="btn btn-primary w-full print:hidden" onClick={printNow}>Print payslip</button>
        </div>}</Modal>
    </AppShell>;
};

export default PayslipsPage;
