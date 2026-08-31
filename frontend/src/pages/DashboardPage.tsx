import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import ReactApexChart from 'react-apexcharts';
import { Activity, Boxes, Building2, HardHat, Home, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react';
import AppShell from '../components/maamulpro/AppShell';
import { api } from '../lib/api';
import { EmptyState, ErrorAlert, LoadingState, PageHeader, StatGrid, StatusPill, humanize, money, shortDate } from '../components/maamulpro/PageKit';
import { IRootState } from '../store';

type Trend = { label: string; value: number };
type PlatformMetrics = {
    totalCompanies: number; activeCompanies: number; pendingCompanies: number; suspendedCompanies: number; pendingSubscriptions: number; expiredCompanies: number; trialCompanies: number; totalUsers: number; activeSubscriptions: number; monthlyRevenue: number;
    outstandingInvoices: { count: number; amount: number };
    latestRegistrations: { id: string; name: string; subdomain: string; status: string; subscriptionStatus: string; createdAt: string }[];
    recentTransactions: { id: string; transactionType: string; newStatus: string; amount?: number; createdAt: string; company: { id: string; name: string } }[];
    subscriptionStatusDistribution: { status: string; count: number }[]; companyStatusDistribution: { status: string; count: number }[]; moduleDistribution: { mode: string; count: number }[]; growthTrend: Trend[]; revenueTrend: Trend[]; systemHealth: { database: string; expiringSoon: number };
};

const VristoTrendChart = ({ title, data, type, currency = false }: { title: string; data: Trend[]; type: 'area' | 'bar'; currency?: boolean }) => {
    const isDark = useSelector((state: IRootState) => state.themeConfig.theme === 'dark' || state.themeConfig.isDarkMode);
    const options: any = { chart: { type, fontFamily: 'Montserrat, sans-serif', toolbar: { show: false }, zoom: { enabled: false }, background: 'transparent' }, colors: [currency ? '#00ab55' : '#4361ee'], dataLabels: { enabled: false }, stroke: { curve: 'smooth', width: type === 'area' ? 2 : 0 }, fill: type === 'area' ? { type: 'gradient', gradient: { opacityFrom: .35, opacityTo: .05, stops: [45, 100] } } : { opacity: 1 }, plotOptions: { bar: { borderRadius: 4, columnWidth: '45%' } }, grid: { borderColor: isDark ? '#191e3a' : '#e0e6ed', strokeDashArray: 5 }, xaxis: { categories: data.map((row) => row.label), axisBorder: { show: false }, axisTicks: { show: false }, labels: { style: { colors: '#888ea8' } } }, yaxis: { labels: { formatter: (value: number) => currency ? `$${Math.round(value).toLocaleString()}` : Math.round(value).toLocaleString(), style: { colors: '#888ea8' } } }, tooltip: { y: { formatter: (value: number) => currency ? money(value) : value.toLocaleString() } }, theme: { mode: isDark ? 'dark' : 'light' } };
    return <div className="panel h-full"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-lg font-bold">{title}</h2><p className="text-sm text-white-dark">Last six months</p></div><span className={`badge ${currency ? 'bg-success-light text-success' : 'bg-primary-light text-primary'}`}>{currency ? money(data.reduce((sum, row) => sum + row.value, 0)) : `${data.reduce((sum, row) => sum + row.value, 0)} total`}</span></div>{data.some((row) => row.value) ? <ReactApexChart options={options} series={[{ name: title, data: data.map((row) => row.value) }]} type={type} height={285} className="overflow-hidden" /> : <EmptyState title="No activity in this period" description="Live data will appear as platform activity is recorded." />}</div>;
};

const VristoStatusChart = ({ data, title = 'Company status' }: { data: { status: string; count: number }[]; title?: string }) => {
    const isDark = useSelector((state: IRootState) => state.themeConfig.theme === 'dark' || state.themeConfig.isDarkMode);
    const options: any = { chart: { type: 'donut', fontFamily: 'Montserrat, sans-serif', background: 'transparent' }, labels: data.map((row) => humanize(row.status)), colors: data.map((row) => row.status === 'ACTIVE' ? '#00ab55' : row.status === 'EXPIRED' ? '#e7515a' : row.status === 'SUSPENDED' ? '#805dca' : '#e2a03f'), dataLabels: { enabled: false }, stroke: { show: true, width: 6, colors: [isDark ? '#0e1726' : '#fff'] }, legend: { position: 'bottom', labels: { colors: isDark ? '#bfc9d4' : '#0e1726' } }, plotOptions: { pie: { donut: { size: '68%', labels: { show: true, total: { show: true, label: 'Companies', color: '#888ea8', formatter: (context: any) => context.globals.seriesTotals.reduce((sum: number, value: number) => sum + value, 0) } } } } }, theme: { mode: isDark ? 'dark' : 'light' } };
    return <div className="panel h-full"><h2 className="text-lg font-bold">{title}</h2><p className="mb-2 text-sm text-white-dark">Current company distribution</p>{data.length && data.some((row) => row.count) ? <ReactApexChart options={options} series={data.map((row) => row.count)} type="donut" height={300} className="overflow-hidden" /> : <EmptyState title="No companies yet" description="Distribution will appear after the first company is onboarded." />}</div>;
};

const ModuleDistribution = ({ data }: { data: PlatformMetrics['moduleDistribution'] }) => <div className="panel h-full"><h2 className="text-lg font-bold">Module distribution</h2><p className="mb-5 text-sm text-white-dark">Tenant module modes</p><div className="space-y-3">{data.length ? data.map((row) => <div className="flex items-center justify-between rounded-md bg-gray-50 p-3 dark:bg-dark" key={row.mode}><span className="font-semibold">{humanize(row.mode)}</span><span className="badge bg-primary-light text-primary">{row.count}</span></div>) : <EmptyState title="No module data" />}</div></div>;

const PlatformDashboard = () => {
    const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
    const [error, setError] = useState('');
    const load = () => { setError(''); api<PlatformMetrics>('/api/superadmin/metrics').then(setMetrics).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load platform metrics')); };
    useEffect(() => { load(); }, []);
    return <AppShell><PageHeader eyebrow="Internal Admin" title="Platform overview" description="Company status, module distribution, subscriptions and recent onboarding activity." actions={<><Link className="btn btn-outline-primary" to="/superadmin/billing">Review subscriptions</Link><Link className="btn btn-primary" to="/superadmin/companies/new">New company</Link></>} />
        {error && <ErrorAlert message={error} onRetry={load} />}
        {!metrics ? <div className="panel"><LoadingState label="Loading platform data…" /></div> : <>
            <StatGrid items={[
                { label: 'Total companies', value: metrics.totalCompanies },
                { label: 'Active', value: metrics.activeCompanies },
                { label: 'Pending setup', value: metrics.pendingCompanies },
                { label: 'Suspended', value: metrics.suspendedCompanies },
                { label: 'Pending subscriptions', value: metrics.pendingSubscriptions },
                { label: 'Expiring soon', value: metrics.systemHealth.expiringSoon },
                { label: 'Monthly revenue', value: money(metrics.monthlyRevenue) },
                { label: 'Outstanding invoices', value: money(metrics.outstandingInvoices.amount), hint: `${metrics.outstandingInvoices.count} open invoice${metrics.outstandingInvoices.count === 1 ? '' : 's'}` },
            ]} />
            <div className="mb-6 grid gap-5 xl:grid-cols-3"><VristoStatusChart data={metrics.companyStatusDistribution} /><ModuleDistribution data={metrics.moduleDistribution} /><VristoTrendChart title="Monthly signups" data={metrics.growthTrend} type="bar" /></div>
            <div className="mb-6 grid gap-5 xl:grid-cols-3"><div className="panel xl:col-span-2 overflow-hidden p-0"><div className="flex items-center justify-between border-b border-white-light p-5 dark:border-[#191e3a]"><div><h2 className="font-bold">Recent platform activity</h2><p className="text-sm text-white-dark">Subscription and administrative ledger events.</p></div><Link className="text-sm font-semibold text-primary" to="/superadmin/billing">Manage billing</Link></div>{metrics.recentTransactions.length ? <div className="overflow-x-auto"><table className="table-hover w-full"><thead><tr><th>Activity</th><th>Company</th><th>Status</th><th>Amount</th><th>Recorded</th></tr></thead><tbody>{metrics.recentTransactions.map((row) => <tr key={row.id}><td className="font-semibold">{humanize(row.transactionType)}</td><td><Link className="text-primary hover:underline" to={`/superadmin/companies/${row.company.id}`}>{row.company.name}</Link></td><td><StatusPill value={row.newStatus} /></td><td>{row.amount == null ? '—' : money(row.amount)}</td><td>{shortDate(row.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No platform activity yet" description="Subscription and billing events will appear here." />}</div>
                <div className="panel"><h2 className="font-bold">System health</h2><p className="mb-5 text-sm text-white-dark">Core services requiring attention.</p><div className="space-y-4"><div className="flex items-center justify-between rounded bg-success-light p-3"><span className="font-semibold">Central database</span><span className="badge bg-success text-white">{humanize(metrics.systemHealth.database)}</span></div><div className={`rounded p-3 ${metrics.systemHealth.expiringSoon ? 'bg-warning-light' : 'bg-gray-50 dark:bg-dark'}`}><p className="font-semibold">Subscriptions expiring within 7 days</p><p className="mt-1 text-2xl font-black">{metrics.systemHealth.expiringSoon}</p><Link className="mt-2 inline-block text-sm font-semibold text-primary hover:underline" to="/superadmin/billing">Review subscriptions</Link></div></div></div></div>
            <div className="panel overflow-hidden p-0"><div className="flex items-center justify-between border-b border-white-light p-5 dark:border-[#191e3a]"><div><h2 className="font-bold">Latest registrations</h2><p className="text-sm text-white-dark">Newest tenant organizations in the platform.</p></div><Link className="text-sm font-semibold text-primary" to="/superadmin/companies">View companies</Link></div>{metrics.latestRegistrations.length ? <div className="overflow-x-auto"><table className="table-hover w-full"><thead><tr><th>Company</th><th>Subdomain</th><th>Company status</th><th>Subscription</th><th>Registered</th><th /></tr></thead><tbody>{metrics.latestRegistrations.map((row) => <tr key={row.id}><td className="font-semibold">{row.name}</td><td>{row.subdomain}</td><td><StatusPill value={row.status} /></td><td><StatusPill value={row.subscriptionStatus} /></td><td>{shortDate(row.createdAt)}</td><td><Link className="btn btn-sm btn-outline-primary" to={`/superadmin/companies/${row.id}`}>Open</Link></td></tr>)}</tbody></table></div> : <EmptyState title="No companies registered" description="Onboard a company to begin managing the platform." action={<Link className="btn btn-primary" to="/superadmin/companies/new">Onboard company</Link>} />}</div>
        </>}
    </AppShell>;
};

type TenantTrend = { change: number; label: string; total?: number };
type TenantExecutiveMetrics = {
    totalIncome: number; totalExpense: number; netProfit: number; profitMargin: number; totalStaff: number; transactionCount: number;
    modules: { construction: boolean; realEstate: boolean; material_management: boolean };
    trends: { income: TenantTrend; expense: TenantTrend; staff: TenantTrend; transactions: TenantTrend };
    charts: { revenue: Trend[]; profit: Trend[] };
    constructionSummary: { projectCount: number; ongoingProjects: number; completedProjects: number } | null;
    realEstateSummary: { propertyCount: number; availableProperties: number; activeDealCount: number } | null;
    materialsSummary: { materialCount: number; lowStockCount: number } | null;
    recentActivity: { id: string; action: string; entity: string; details?: string | null; createdAt: string; userName: string }[];
};

const trendHint = (trend: TenantTrend) => `${trend.change > 0 ? '+' : ''}${trend.change}% ${trend.label}`;

const TenantFinancialChart = ({ metrics }: { metrics: TenantExecutiveMetrics }) => {
    const [days, setDays] = useState(7);
    const isDark = useSelector((state: IRootState) => state.themeConfig.theme === 'dark' || state.themeConfig.isDarkMode);
    const revenue = metrics.charts.revenue.slice(-days);
    const profit = metrics.charts.profit.slice(-days);
    const options: any = {
        chart: { type: 'area', fontFamily: 'Montserrat, sans-serif', toolbar: { show: false }, zoom: { enabled: false }, background: 'transparent' },
        colors: ['#00ab55', '#4361ee'], dataLabels: { enabled: false }, stroke: { curve: 'smooth', width: 2 },
        fill: { type: 'gradient', gradient: { opacityFrom: .28, opacityTo: .03, stops: [30, 100] } },
        grid: { borderColor: isDark ? '#191e3a' : '#e0e6ed', strokeDashArray: 5 },
        xaxis: { categories: revenue.map((point) => point.label), axisBorder: { show: false }, axisTicks: { show: false }, labels: { style: { colors: '#888ea8' } } },
        yaxis: { labels: { formatter: (value: number) => `$${Math.round(value).toLocaleString()}`, style: { colors: '#888ea8' } } },
        legend: { position: 'top', horizontalAlign: 'right', labels: { colors: isDark ? '#bfc9d4' : '#0e1726' } },
        tooltip: { y: { formatter: (value: number) => money(value) } }, theme: { mode: isDark ? 'dark' : 'light' },
    };
    return <div className="panel h-full"><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><TrendingUp className="text-success" size={19} /><h2 className="text-lg font-bold">Financial performance</h2></div><p className="mt-1 text-sm text-white-dark">Income and net profit over time</p></div><div className="flex rounded-md bg-gray-100 p-1 dark:bg-dark">{[7, 30, 90].map((value) => <button key={value} className={`btn btn-sm py-1 ${days === value ? 'btn-primary' : 'btn-outline-dark border-0'}`} type="button" onClick={() => setDays(value)}>{value}d</button>)}</div></div><div className="mb-2 flex items-end gap-3"><p className="text-2xl font-black">{money(metrics.netProfit)}</p><span className={`mb-1 text-xs font-bold ${metrics.netProfit >= 0 ? 'text-success' : 'text-danger'}`}>{metrics.netProfit >= 0 ? '+' : ''}{metrics.profitMargin}% margin</span></div>{revenue.some((point) => point.value) || profit.some((point) => point.value) ? <ReactApexChart options={options} series={[{ name: 'Income', data: revenue.map((point) => point.value) }, { name: 'Net profit', data: profit.map((point) => point.value) }]} type="area" height={275} /> : <EmptyState title="No financial activity yet" description="Income and expense trends appear as transactions are recorded." />}</div>;
};

const TenantModuleDistribution = ({ metrics }: { metrics: TenantExecutiveMetrics }) => {
    const isDark = useSelector((state: IRootState) => state.themeConfig.theme === 'dark' || state.themeConfig.isDarkMode);
    const data = [
        { label: 'Construction', value: metrics.constructionSummary?.projectCount || 0, color: '#00ab55' },
        { label: 'Real estate', value: metrics.realEstateSummary?.propertyCount || 0, color: '#4361ee' },
        { label: 'Materials', value: metrics.materialsSummary?.materialCount || 0, color: '#e2a03f' },
    ].filter((item) => metrics.modules[item.label === 'Real estate' ? 'realEstate' : item.label === 'Materials' ? 'material_management' : 'construction']);
    const options: any = { chart: { type: 'donut', fontFamily: 'Montserrat, sans-serif', background: 'transparent' }, labels: data.map((item) => item.label), colors: data.map((item) => item.color), dataLabels: { enabled: false }, stroke: { width: 5, colors: [isDark ? '#0e1726' : '#fff'] }, legend: { position: 'bottom', labels: { colors: isDark ? '#bfc9d4' : '#0e1726' } }, plotOptions: { pie: { donut: { size: '68%', labels: { show: true, total: { show: true, label: 'Records', color: '#888ea8', formatter: (context: any) => context.globals.seriesTotals.reduce((sum: number, value: number) => sum + value, 0) } } } } }, theme: { mode: isDark ? 'dark' : 'light' } };
    return <div className="panel h-full"><h2 className="text-lg font-bold">Module distribution</h2><p className="mt-1 text-sm text-white-dark">Records across enabled workspaces</p>{data.length && data.some((item) => item.value) ? <ReactApexChart options={options} series={data.map((item) => item.value)} type="donut" height={300} /> : <EmptyState title="No module records yet" description="Workspace records appear here as your team starts work." />}</div>;
};

const TenantModuleSummary = ({ metrics }: { metrics: TenantExecutiveMetrics }) => <div className="grid gap-5 xl:grid-cols-3">
    {metrics.constructionSummary && <div className="panel"><div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-md bg-success-light text-success"><HardHat size={20} /></span><div><h2 className="font-bold">Construction</h2><p className="text-xs text-white-dark">Project portfolio</p></div></div><Link className="text-sm font-semibold text-primary hover:underline" to="/app/construction">Open</Link></div><div className="space-y-4"><div><div className="flex justify-between text-sm"><span>Ongoing projects</span><strong>{metrics.constructionSummary.ongoingProjects}</strong></div><div className="mt-2 h-1.5 rounded-full bg-gray-100 dark:bg-dark"><div className="h-full rounded-full bg-success" style={{ width: `${metrics.constructionSummary.projectCount ? metrics.constructionSummary.ongoingProjects / metrics.constructionSummary.projectCount * 100 : 0}%` }} /></div></div><div><div className="flex justify-between text-sm"><span>Completed projects</span><strong>{metrics.constructionSummary.completedProjects}</strong></div><div className="mt-2 h-1.5 rounded-full bg-gray-100 dark:bg-dark"><div className="h-full rounded-full bg-primary" style={{ width: `${metrics.constructionSummary.projectCount ? metrics.constructionSummary.completedProjects / metrics.constructionSummary.projectCount * 100 : 0}%` }} /></div></div></div></div>}
    {metrics.realEstateSummary && <div className="panel"><div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-md bg-primary-light text-primary"><Building2 size={20} /></span><div><h2 className="font-bold">Real estate</h2><p className="text-xs text-white-dark">Property portfolio</p></div></div><Link className="text-sm font-semibold text-primary hover:underline" to="/app/real-estate">Open</Link></div><div className="grid grid-cols-3 gap-3 text-center"><div className="rounded-md bg-gray-50 p-3 dark:bg-dark"><Home className="mx-auto text-primary" size={17} /><strong className="mt-2 block text-lg">{metrics.realEstateSummary.propertyCount}</strong><small className="text-white-dark">Properties</small></div><div className="rounded-md bg-gray-50 p-3 dark:bg-dark"><Activity className="mx-auto text-success" size={17} /><strong className="mt-2 block text-lg">{metrics.realEstateSummary.availableProperties}</strong><small className="text-white-dark">Available</small></div><div className="rounded-md bg-gray-50 p-3 dark:bg-dark"><Wallet className="mx-auto text-warning" size={17} /><strong className="mt-2 block text-lg">{metrics.realEstateSummary.activeDealCount}</strong><small className="text-white-dark">Deals</small></div></div></div>}
    {metrics.materialsSummary && <div className="panel"><div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-md bg-warning-light text-warning"><Boxes size={20} /></span><div><h2 className="font-bold">Materials</h2><p className="text-xs text-white-dark">Stock overview</p></div></div><Link className="text-sm font-semibold text-primary hover:underline" to="/app/materials">Open</Link></div><div className="grid grid-cols-2 gap-4"><div className="rounded-md bg-gray-50 p-4 text-center dark:bg-dark"><Boxes className="mx-auto text-warning" size={18} /><strong className="mt-2 block text-xl">{metrics.materialsSummary.materialCount}</strong><small className="text-white-dark">Materials</small></div><div className="rounded-md bg-danger-light p-4 text-center"><TrendingDown className="mx-auto text-danger" size={18} /><strong className="mt-2 block text-xl text-danger">{metrics.materialsSummary.lowStockCount}</strong><small className="text-danger">Low stock</small></div></div></div>}
</div>;

const TenantActivity = ({ activity }: { activity: TenantExecutiveMetrics['recentActivity'] }) => <div className="panel overflow-hidden p-0"><div className="flex items-center justify-between border-b border-white-light p-5 dark:border-dark"><div><h2 className="font-bold">Recent activity</h2><p className="text-sm text-white-dark">Latest actions recorded across your workspace.</p></div><Activity className="text-white-dark" size={20} /></div>{activity.length ? <div className="overflow-x-auto"><table className="table-hover w-full"><thead><tr><th>Activity</th><th>By</th><th>Action</th><th>Recorded</th></tr></thead><tbody>{activity.map((row) => <tr key={row.id}><td><strong className="block">{row.details || `${humanize(row.action)} ${humanize(row.entity)}`}</strong><small className="text-white-dark">{humanize(row.entity)}</small></td><td>{row.userName}</td><td><span className={`badge ${row.action === 'DELETE' ? 'bg-danger-light text-danger' : row.action === 'CREATE' ? 'bg-success-light text-success' : 'bg-primary-light text-primary'}`}>{humanize(row.action)}</span></td><td>{shortDate(row.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No recent activity" description="Changes made by your team will appear here." />}</div>;

const CompanyDashboard = () => {
    const [metrics, setMetrics] = useState<TenantExecutiveMetrics | null>(null);
    const [error, setError] = useState('');
    const load = () => { setError(''); api<TenantExecutiveMetrics>('/api/dashboard/summary').then(setMetrics).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load executive dashboard')); };
    useEffect(() => { load(); }, []);
    return <AppShell><PageHeader eyebrow="Company overview" title="Overview" description="Live consolidated operational, financial and workspace indicators." />{error && <ErrorAlert message={error} onRetry={load} />}{!metrics ? <div className="panel"><LoadingState /></div> : <><StatGrid items={[{ label: 'Total income', value: money(metrics.totalIncome), hint: trendHint(metrics.trends.income) }, { label: 'Total expenses', value: money(metrics.totalExpense), hint: trendHint(metrics.trends.expense) }, { label: 'Total staff', value: metrics.totalStaff.toLocaleString(), hint: trendHint(metrics.trends.staff) }, { label: 'Transactions', value: metrics.transactionCount.toLocaleString(), hint: trendHint(metrics.trends.transactions) }]} /><div className="mb-6 grid gap-5 xl:grid-cols-3"><div className="xl:col-span-2"><TenantFinancialChart metrics={metrics} /></div><TenantModuleDistribution metrics={metrics} /></div><div className="mb-6"><TenantModuleSummary metrics={metrics} /></div><TenantActivity activity={metrics.recentActivity} /></>}</AppShell>;
};

const DashboardPage = ({ superAdmin = false }: { superAdmin?: boolean }) => superAdmin ? <PlatformDashboard /> : <CompanyDashboard />;
export default DashboardPage;
