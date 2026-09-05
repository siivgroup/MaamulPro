import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    AlertTriangle,
    BarChart3,
    Download,
    FileSpreadsheet,
    Layers,
    Package,
    Printer,
    RotateCcw,
} from 'lucide-react';
import AppShell from '../components/maamulpro/AppShell';
import {
    EmptyState,
    ErrorAlert,
    Field,
    FormActions,
    LoadingState,
    Modal,
    PageHeader,
    StatusPill,
    shortDate,
} from '../components/maamulpro/PageKit';
import { ReportHeader } from '../components/maamulpro/ReportHeader';
import { PermissionButton } from '../components/PermissionButton';
import { useBranding } from '../hooks/useBranding';
import { usePermissions } from '../hooks/usePermissions';
import { api } from '../lib/api';
import { toast } from '../lib/toast';

type Material = {
    id: string;
    name: string;
    quantity: number | string;
    unit: string;
    unitCost: number | string;
    warehouse?: string;
    lowStockThreshold: number | string;
};

type Movement = {
    id: string;
    type: string;
    quantity: number | string;
    date: string;
    notes?: string;
    warehouse?: string;
    material?: Material;
    project?: { name: string };
};

type InventoryResponse = {
    materials: Material[];
    movements: Movement[];
    summary: { materialCount: number; lowStockCount: number; stockValue: number };
};

type ConsumptionProject = {
    projectId: string;
    projectName: string;
    projectStatus: string;
    totalCost: number;
    totalItemsCount: number;
    materials: { name: string; unit: string; quantity: number; cost: number }[];
};

type ConsumptionMaterial = {
    materialId: string;
    materialName: string;
    unit: string;
    totalQuantity: number;
    totalCost: number;
    projects: string[];
};

type ConsumptionMovement = {
    id: string;
    date: string;
    materialName: string;
    unit: string;
    quantity: number;
    unitCost: number;
    totalCost: number;
    projectName: string;
    projectId?: string;
    warehouse?: string;
    notes?: string;
    recordedBy?: string;
};

type ConsumptionReportResponse = {
    summary: {
        totalDeployedCost: number;
        totalUsages: number;
        activeProjectsConsuming: number;
        materialsConsumedCount: number;
    };
    byProject: ConsumptionProject[];
    byMaterial: ConsumptionMaterial[];
    movements: ConsumptionMovement[];
};

const MOVEMENT_TYPES = ['RESTOCK', 'USAGE', 'ADJUSTMENT'] as const;
const initialForm = { materialId: '', type: 'RESTOCK', quantity: '', projectId: '', warehouse: '', notes: '' };

const currency = (value: number | string) =>
    `$${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
    const csvContent = [
        headers.join(','),
        ...rows.map((row) =>
            row
                .map((val) => {
                    const str = String(val ?? '').replace(/"/g, '""');
                    return `"${str}"`;
                })
                .join(','),
        ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

const ConstructionInventoryPage = () => {
    const { hasPermission } = usePermissions();
    const branding = useBranding();
    const [inventory, setInventory] = useState<InventoryResponse | null>(null);
    const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [tab, setTab] = useState<'stock' | 'movements' | 'reports'>('stock');
    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState(initialForm);
    const [saving, setSaving] = useState(false);

    // Reporting state & filters
    const [reportData, setReportData] = useState<ConsumptionReportResponse | null>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [filterProjectId, setFilterProjectId] = useState('');
    const [filterMaterialId, setFilterMaterialId] = useState('');
    const [filterStartDate, setFilterStartDate] = useState('');
    const [filterEndDate, setFilterEndDate] = useState('');

    const load = () => {
        setLoading(true);
        setError('');
        return Promise.all([
            api<InventoryResponse>('/api/construction/inventory', { silent: true }),
            api<unknown>('/api/construction/projects', { silent: true })
                .then((result) => {
                    const rows = Array.isArray(result) ? result : (result as any)?.data || [];
                    return rows.map((row: any) => ({ id: row.id, name: row.name }));
                })
                .catch(() => []),
        ])
            .then(([inv, projectRows]) => {
                setInventory(inv);
                setProjects(projectRows);
            })
            .catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load inventory'))
            .finally(() => setLoading(false));
    };

    const loadReport = () => {
        setReportLoading(true);
        const params = new URLSearchParams();
        if (filterProjectId) params.set('projectId', filterProjectId);
        if (filterMaterialId) params.set('materialId', filterMaterialId);
        if (filterStartDate) params.set('startDate', filterStartDate);
        if (filterEndDate) params.set('endDate', filterEndDate);

        api<ConsumptionReportResponse>(`/api/construction/inventory/reports/consumption?${params.toString()}`, { silent: true })
            .then((data) => setReportData(data))
            .catch((err) => toast.error(err instanceof Error ? err.message : 'Unable to load consumption report'))
            .finally(() => setReportLoading(false));
    };

    useEffect(() => {
        void load();
    }, []);

    useEffect(() => {
        if (tab === 'reports') {
            loadReport();
        }
    }, [tab, filterProjectId, filterMaterialId, filterStartDate, filterEndDate]);

    const openModal = () => {
        setForm(initialForm);
        setModalOpen(true);
    };
    const closeModal = () => {
        if (!saving) setModalOpen(false);
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (form.type === 'USAGE' && !form.projectId) {
            toast.error('Select a project for material usage');
            return;
        }
        setSaving(true);
        try {
            await api('/api/construction/inventory/movements', {
                method: 'POST',
                silent: true,
                body: JSON.stringify({
                    materialId: form.materialId,
                    type: form.type,
                    quantity: Number(form.quantity),
                    projectId: form.projectId || undefined,
                    warehouse: form.warehouse || undefined,
                    notes: form.notes || undefined,
                }),
            });
            toast.success('Stock movement recorded.');
            setModalOpen(false);
            setForm(initialForm);
            await load();
            if (tab === 'reports') loadReport();
        } catch (reason) {
            toast.error(reason instanceof Error ? reason.message : 'Unable to record stock movement');
        } finally {
            setSaving(false);
        }
    };

    const handleExportStockCsv = () => {
        if (!inventory?.materials.length) return;
        const headers = ['Material Name', 'Quantity', 'Unit', 'Unit Cost ($)', 'Total Value ($)', 'Warehouse', 'Low Stock Alert'];
        const rows = inventory.materials.map((m) => [
            m.name,
            m.quantity,
            m.unit,
            Number(m.unitCost || 0).toFixed(2),
            (Number(m.quantity || 0) * Number(m.unitCost || 0)).toFixed(2),
            m.warehouse || 'Default',
            Number(m.quantity) <= Number(m.lowStockThreshold) ? 'YES' : 'NO',
        ]);
        downloadCsv(`construction-stock-on-hand-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    };

    const handleExportMovementsCsv = () => {
        if (!inventory?.movements.length) return;
        const headers = ['Date', 'Material', 'Movement Type', 'Quantity', 'Project', 'Warehouse', 'Notes'];
        const rows = inventory.movements.map((m) => [
            new Date(m.date).toLocaleDateString(),
            m.material?.name || '—',
            m.type,
            m.quantity,
            m.project?.name || '—',
            m.warehouse || '—',
            m.notes || '—',
        ]);
        downloadCsv(`construction-movement-ledger-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    };

    const handleExportConsumptionCsv = () => {
        if (!reportData?.movements.length) return;
        const headers = ['Date', 'Project', 'Material', 'Quantity', 'Unit', 'Unit Cost ($)', 'Total Cost ($)', 'Warehouse', 'Recorded By', 'Notes'];
        const rows = reportData.movements.map((m) => [
            new Date(m.date).toLocaleDateString(),
            m.projectName,
            m.materialName,
            m.quantity,
            m.unit,
            m.unitCost.toFixed(2),
            m.totalCost.toFixed(2),
            m.warehouse || '—',
            m.recordedBy || '—',
            m.notes || '—',
        ]);
        downloadCsv(`project-material-consumption-report-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    };

    const summaryCards = useMemo(
        () => [
            { label: 'Materials tracked', value: inventory?.summary.materialCount ?? '—', tone: 'text-primary' },
            { label: 'Low stock alerts', value: inventory?.summary.lowStockCount ?? '—', tone: 'text-warning' },
            { label: 'Total stock value', value: inventory ? currency(inventory.summary.stockValue) : '—', tone: 'text-success' },
        ],
        [inventory],
    );

    return (
        <AppShell>
            <div className="print:hidden">
                <PageHeader
                    title="Construction inventory"
                    actions={
                        <>
                            {hasPermission('construction_inventory.read') && (
                                <Link to="/app/construction/inventory/manage" className="btn btn-outline-primary">
                                    Manage material catalog
                                </Link>
                            )}
                            <PermissionButton perm="construction_inventory.create" className="btn btn-primary" onClick={openModal}>
                                Record movement
                            </PermissionButton>
                        </>
                    }
                />
            </div>

            {error && <ErrorAlert message={error} onRetry={load} />}

            <div className="mb-6 grid gap-4 print:hidden sm:grid-cols-3">
                {summaryCards.map((card) => (
                    <div className="panel" key={card.label}>
                        <p className="text-white-dark">{card.label}</p>
                        <p className={`mt-2 text-3xl font-bold ${card.tone}`}>{card.value}</p>
                    </div>
                ))}
            </div>

            <div className="panel p-0">
                {/* Tabs & Top Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white-light px-3 pt-3 dark:border-[#191e3a] print:hidden">
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            className={`flex items-center gap-1.5 rounded-t-md px-4 py-2 text-sm font-semibold transition ${tab === 'stock' ? 'bg-primary text-white' : 'text-white-dark hover:bg-primary-light/40'}`}
                            onClick={() => setTab('stock')}
                        >
                            <Package size={16} />
                            Stock on hand
                        </button>
                        <button
                            type="button"
                            className={`flex items-center gap-1.5 rounded-t-md px-4 py-2 text-sm font-semibold transition ${tab === 'movements' ? 'bg-primary text-white' : 'text-white-dark hover:bg-primary-light/40'}`}
                            onClick={() => setTab('movements')}
                        >
                            <Layers size={16} />
                            Movement history
                        </button>
                        <button
                            type="button"
                            className={`flex items-center gap-1.5 rounded-t-md px-4 py-2 text-sm font-semibold transition ${tab === 'reports' ? 'bg-primary text-white' : 'text-white-dark hover:bg-primary-light/40'}`}
                            onClick={() => setTab('reports')}
                        >
                            <BarChart3 size={16} />
                            Consumption & Reports
                        </button>
                    </div>

                    <div className="mb-2 flex items-center gap-2">
                        {tab === 'stock' && (inventory?.materials?.length ?? 0) > 0 && (
                            <button type="button" className="btn btn-outline-secondary btn-sm flex items-center gap-1.5" onClick={handleExportStockCsv}>
                                <Download size={14} />
                                Export Stock CSV
                            </button>
                        )}
                        {tab === 'movements' && (inventory?.movements?.length ?? 0) > 0 && (
                            <button type="button" className="btn btn-outline-secondary btn-sm flex items-center gap-1.5" onClick={handleExportMovementsCsv}>
                                <Download size={14} />
                                Export Ledger CSV
                            </button>
                        )}
                        {tab === 'reports' && reportData && (
                            <>
                                <button type="button" className="btn btn-outline-secondary btn-sm flex items-center gap-1.5" onClick={handleExportConsumptionCsv}>
                                    <FileSpreadsheet size={14} />
                                    Export CSV
                                </button>
                                <button type="button" className="btn btn-outline-primary btn-sm flex items-center gap-1.5" onClick={() => window.print()}>
                                    <Printer size={14} />
                                    Print / Save PDF
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Tab 1: Stock on Hand */}
                {tab === 'stock' && (
                    <>
                        {loading && !inventory ? (
                            <LoadingState />
                        ) : !inventory?.materials.length ? (
                            <EmptyState
                                title="No materials registered yet"
                                description="Add your material items (such as Cement, Steel, Bricks) to the catalog to start tracking construction inventory and site usage."
                                action={
                                    hasPermission('construction_inventory.create') ? (
                                        <Link to="/app/construction/inventory/manage/new" className="btn btn-primary">
                                            Add material product
                                        </Link>
                                    ) : undefined
                                }
                            />
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="table-hover w-full">
                                    <thead>
                                        <tr>
                                            <th>Material</th>
                                            <th>Quantity on Hand</th>
                                            <th>Unit Cost</th>
                                            <th>Total Valuation</th>
                                            <th>Warehouse</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {inventory.materials.map((material) => {
                                            const low = Number(material.quantity) <= Number(material.lowStockThreshold);
                                            const totalVal = Number(material.quantity || 0) * Number(material.unitCost || 0);
                                            return (
                                                <tr key={material.id}>
                                                    <td className="font-semibold text-primary">{material.name}</td>
                                                    <td className="font-semibold">
                                                        {material.quantity} <span className="text-xs text-white-dark">{material.unit}</span>
                                                    </td>
                                                    <td>{currency(material.unitCost)}</td>
                                                    <td className="font-semibold text-success">{currency(totalVal)}</td>
                                                    <td>{material.warehouse || '—'}</td>
                                                    <td>
                                                        <StatusPill value={low ? 'LOW STOCK' : 'AVAILABLE'} />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}

                {/* Tab 2: Movement History */}
                {tab === 'movements' && (
                    <>
                        {loading && !inventory ? (
                            <LoadingState />
                        ) : !inventory?.movements.length ? (
                            <EmptyState title="No movements yet" description="Recorded stock movements will show up here." />
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="table-hover w-full">
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Material</th>
                                            <th>Type</th>
                                            <th>Quantity</th>
                                            <th>Project</th>
                                            <th>Warehouse</th>
                                            <th>Notes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {inventory.movements.map((movement) => (
                                            <tr key={movement.id}>
                                                <td>{shortDate(movement.date)}</td>
                                                <td className="font-medium">{movement.material?.name || '—'}</td>
                                                <td>
                                                    <StatusPill value={movement.type} />
                                                </td>
                                                <td className="font-semibold">
                                                    {movement.type === 'USAGE' ? (
                                                        <span className="text-danger">-{movement.quantity}</span>
                                                    ) : movement.type === 'RESTOCK' ? (
                                                        <span className="text-success">+{movement.quantity}</span>
                                                    ) : (
                                                        <span>{movement.quantity}</span>
                                                    )}{' '}
                                                    <span className="text-xs text-white-dark">{movement.material?.unit}</span>
                                                </td>
                                                <td className="font-medium text-primary">{movement.project?.name || '—'}</td>
                                                <td>{movement.warehouse || '—'}</td>
                                                <td className="text-xs text-white-dark">{movement.notes || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}

                {/* Tab 3: Consumption & Reports */}
                {tab === 'reports' && (
                    <div className="p-4 sm:p-5">
                        {/* Printable Report Header */}
                        <div className="hidden print:block mb-4">
                            <ReportHeader
                                branding={branding}
                                title="Project Material Consumption Report"
                                subtitle={`Generated on ${new Date().toLocaleDateString()}`}
                            />
                        </div>

                        {/* Compact Filter & Summary Bar */}
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white-light bg-[#f9fafb] p-3 dark:border-[#191e3a] dark:bg-[#121e32] print:hidden">
                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    className="form-select form-select-sm w-44"
                                    value={filterProjectId}
                                    onChange={(e) => setFilterProjectId(e.target.value)}
                                >
                                    <option value="">All Projects</option>
                                    {projects.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.name}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    className="form-select form-select-sm w-44"
                                    value={filterMaterialId}
                                    onChange={(e) => setFilterMaterialId(e.target.value)}
                                >
                                    <option value="">All Materials</option>
                                    {inventory?.materials.map((m) => (
                                        <option key={m.id} value={m.id}>
                                            {m.name}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    type="date"
                                    className="form-input form-input-sm w-36"
                                    value={filterStartDate}
                                    onChange={(e) => setFilterStartDate(e.target.value)}
                                    placeholder="Start date"
                                />
                                <input
                                    type="date"
                                    className="form-input form-input-sm w-36"
                                    value={filterEndDate}
                                    onChange={(e) => setFilterEndDate(e.target.value)}
                                    placeholder="End date"
                                />
                                {(filterProjectId || filterMaterialId || filterStartDate || filterEndDate) && (
                                    <button
                                        type="button"
                                        className="btn btn-xs btn-outline-danger flex items-center gap-1"
                                        onClick={() => {
                                            setFilterProjectId('');
                                            setFilterMaterialId('');
                                            setFilterStartDate('');
                                            setFilterEndDate('');
                                        }}
                                    >
                                        <RotateCcw size={12} />
                                        Clear
                                    </button>
                                )}
                            </div>

                            {reportData && (
                                <div className="flex items-center gap-4 text-xs font-semibold">
                                    <div>
                                        <span className="text-white-dark">Total Deployed:</span>{' '}
                                        <span className="text-base font-bold text-primary">{currency(reportData.summary.totalDeployedCost)}</span>
                                    </div>
                                    <div>
                                        <span className="text-white-dark">Entries:</span>{' '}
                                        <span className="text-base font-bold text-dark dark:text-white">{reportData.summary.totalUsages}</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {reportLoading ? (
                            <LoadingState />
                        ) : !reportData || !reportData.movements.length ? (
                            <EmptyState
                                title="No material consumption recorded"
                                description="Record a stock movement with type 'USAGE' and assign it to a project to track consumption."
                            />
                        ) : (
                            <div className="overflow-x-auto rounded-lg border border-white-light dark:border-[#191e3a]">
                                <table className="table-hover w-full">
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Project</th>
                                            <th>Material</th>
                                            <th className="text-right">Quantity</th>
                                            <th className="text-right">Unit Cost</th>
                                            <th className="text-right">Total Cost</th>
                                            <th>Warehouse</th>
                                            <th>Notes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reportData.movements.map((entry) => (
                                            <tr key={entry.id}>
                                                <td>{shortDate(entry.date)}</td>
                                                <td>
                                                    <Link
                                                        to={`/app/construction/projects/${entry.projectId}`}
                                                        className="font-bold text-primary hover:underline"
                                                    >
                                                        {entry.projectName}
                                                    </Link>
                                                </td>
                                                <td className="font-semibold text-secondary dark:text-white">{entry.materialName}</td>
                                                <td className="text-right font-semibold">
                                                    {entry.quantity} <span className="text-xs text-white-dark">{entry.unit}</span>
                                                </td>
                                                <td className="text-right font-mono">{currency(entry.unitCost)}</td>
                                                <td className="text-right font-mono font-bold text-primary">{currency(entry.totalCost)}</td>
                                                <td>{entry.warehouse || '—'}</td>
                                                <td className="text-xs text-white-dark">{entry.notes || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="border-t-2 bg-[#f9fafb] font-bold dark:bg-[#121e32]">
                                            <td colSpan={3} className="text-dark dark:text-white">
                                                Total ({reportData.movements.length} records)
                                            </td>
                                            <td className="text-right font-semibold">
                                                {reportData.movements.reduce((acc, m) => acc + Number(m.quantity || 0), 0)} units
                                            </td>
                                            <td />
                                            <td className="text-right font-mono text-base font-extrabold text-primary">
                                                {currency(reportData.summary.totalDeployedCost)}
                                            </td>
                                            <td colSpan={2} />
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Record Movement Modal */}
            <Modal title="Record stock movement" open={modalOpen} onClose={closeModal}>
                <form className="grid gap-4" onSubmit={submit}>
                    {!inventory?.materials.length && (
                        <div className="flex items-center gap-2 rounded-md bg-warning-light p-3 text-xs font-semibold text-warning">
                            <AlertTriangle size={16} className="flex-shrink-0 text-warning" />
                            <span>
                                No materials exist in your catalog yet.{' '}
                                <Link to="/app/construction/inventory/manage/new" className="font-bold underline">
                                    Click here to add your first material product
                                </Link>
                                .
                            </span>
                        </div>
                    )}
                    <Field label="Material" required>
                        <select
                            className="form-select"
                            required
                            value={form.materialId}
                            onChange={(event) => setForm({ ...form, materialId: event.target.value })}
                        >
                            <option value="">Select material…</option>
                            {inventory?.materials.map((material) => (
                                <option value={material.id} key={material.id}>
                                    {material.name} ({material.quantity} {material.unit})
                                </option>
                            ))}
                        </select>
                    </Field>

                    <Field label="Movement type" required>
                        <select
                            className="form-select"
                            value={form.type}
                            onChange={(event) => setForm({ ...form, type: event.target.value })}
                        >
                            {MOVEMENT_TYPES.map((type) => (
                                <option key={type} value={type}>
                                    {type}
                                </option>
                            ))}
                        </select>
                    </Field>

                    <Field label="Quantity" required>
                        <input
                            className="form-input"
                            type="number"
                            step="0.01"
                            required
                            value={form.quantity}
                            onChange={(event) => setForm({ ...form, quantity: event.target.value })}
                        />
                    </Field>

                    {form.type === 'USAGE' && (
                        <Field label="Project" required>
                            <select
                                className="form-select"
                                required
                                value={form.projectId}
                                onChange={(event) => setForm({ ...form, projectId: event.target.value })}
                            >
                                <option value="">Select project…</option>
                                {projects.map((project) => (
                                    <option value={project.id} key={project.id}>
                                        {project.name}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    )}

                    {form.type === 'ADJUSTMENT' && (
                        <p className="text-xs text-white-dark">
                            Use a positive quantity to add stock, or a negative quantity to write off stock.
                        </p>
                    )}

                    <Field label="Warehouse">
                        <input
                            className="form-input"
                            value={form.warehouse}
                            onChange={(event) => setForm({ ...form, warehouse: event.target.value })}
                        />
                    </Field>

                    <Field label="Notes">
                        <textarea
                            className="form-textarea"
                            rows={3}
                            value={form.notes}
                            onChange={(event) => setForm({ ...form, notes: event.target.value })}
                        />
                    </Field>

                    <FormActions onCancel={closeModal} loading={saving} saveLabel="Record movement" savingLabel="Recording…" />
                </form>
            </Modal>
        </AppShell>
    );
};

export default ConstructionInventoryPage;
