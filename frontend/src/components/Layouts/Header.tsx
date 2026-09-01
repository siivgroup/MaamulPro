import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { IRootState } from '../../store';
import { toggleSidebar, toggleTheme } from '../../store/themeConfigSlice';
import { api, sessionStore } from '../../lib/api';
import Dropdown from '../Dropdown';
import IconBellBing from '../Icon/IconBellBing';
import IconMenu from '../Icon/IconMenu';
import IconMoon from '../Icon/IconMoon';
import IconSun from '../Icon/IconSun';
import IconUser from '../Icon/IconUser';
import IconLogout from '../Icon/IconLogout';
import IconSearch from '../Icon/IconSearch';
import { usePermissions } from '../../hooks/usePermissions';

type PlatformNotification = { id: string; title: string; details: string; createdAt: string; category: string; companyId?: string };
type TenantAlert = { id: string; severity: 'WARNING' | 'CRITICAL'; title: string; details?: string; targetPath?: string; activeAt: string; isUnread: boolean };
type TenantNotificationFeed = { alerts: TenantAlert[]; unreadAlertCount: number };
type RecordSearchResult = { id: string; label: string; description: string; section: string; targetPath: string };
type NavigationDestination = { label: string; section: string; to: string; permissions?: string[]; feature?: 'construction' | 'realEstate' | 'materials' | 'payroll' | 'advancedReports'; workspace?: 'construction' | 'real_estate' | 'material_management'; keywords?: string; platform?: boolean };

const navigationDestinations: NavigationDestination[] = [
    { label: 'Dashboard', section: 'Overview', to: '/app/dashboard', permissions: ['dashboard.executive.read'], keywords: 'home overview' },
    { label: 'Analytics', section: 'Overview', to: '/app/analytics', permissions: ['analytics.read'], keywords: 'metrics insights' },
    { label: 'Staff', section: 'People & finance', to: '/app/staff', permissions: ['users.read'], keywords: 'employees people users' },
    { label: 'Financials', section: 'People & finance', to: '/app/financials', permissions: ['financials.read'], keywords: 'income expense transactions' },
    { label: 'Chart of accounts', section: 'People & finance', to: '/app/financials/accounts', permissions: ['accounting.read'], keywords: 'ledger accounting' },
    { label: 'Journal entries', section: 'People & finance', to: '/app/financials/journals', permissions: ['accounting.read'], keywords: 'ledger accounting' },
    { label: 'Financial reports', section: 'People & finance', to: '/app/financials/financial-reports', permissions: ['accounting.read'], keywords: 'profit loss balance sheet' },
    { label: 'Payroll', section: 'People & finance', to: '/app/payroll', permissions: ['payroll.read'], feature: 'payroll', keywords: 'salary wages employees' },
    { label: 'Payslips', section: 'People & finance', to: '/app/payroll/payslips', permissions: ['payroll.read'], feature: 'payroll', keywords: 'salary wages employees' },
    { label: 'Construction overview', section: 'Construction', to: '/app/construction/overview', permissions: ['workspace.construction.read'], feature: 'construction', workspace: 'construction' },
    { label: 'Projects', section: 'Construction', to: '/app/construction/projects', permissions: ['projects.read'], feature: 'construction', workspace: 'construction' },
    { label: 'Tasks', section: 'Construction', to: '/app/construction/tasks', permissions: ['construction_tasks.read'], feature: 'construction', workspace: 'construction' },
    { label: 'Expenses', section: 'Construction', to: '/app/construction/expenses', permissions: ['construction_expenses.read'], feature: 'construction', workspace: 'construction' },
    { label: 'Manpower', section: 'Construction', to: '/app/construction/manpower', permissions: ['manpower.read'], feature: 'construction', workspace: 'construction', keywords: 'workers labour' },
    { label: 'Worker types', section: 'Construction', to: '/app/construction/worker-types', permissions: ['manpower.read'], feature: 'construction', workspace: 'construction' },
    { label: 'Worker ledger', section: 'Construction', to: '/app/construction/worker-ledger', permissions: ['manpower.read'], feature: 'construction', workspace: 'construction', keywords: 'labour income expense' },
    { label: 'Construction inventory', section: 'Construction', to: '/app/construction/inventory', permissions: ['construction_inventory.read'], feature: 'construction', workspace: 'construction' },
    { label: 'Workforce contracts', section: 'Construction', to: '/app/construction/contracts', permissions: ['workforce_contracts.read'], feature: 'construction', workspace: 'construction', keywords: 'labour workers agreements' },
    { label: 'Construction reports', section: 'Construction', to: '/app/construction/reports', permissions: ['reports.construction.read'], feature: 'construction', workspace: 'construction' },
    { label: 'Real estate overview', section: 'Real estate', to: '/app/real-estate/overview', permissions: ['workspace.real_estate.read'], feature: 'realEstate', workspace: 'real_estate', keywords: 'property' },
    { label: 'Properties', section: 'Real estate', to: '/app/real-estate/properties', permissions: ['properties.read'], feature: 'realEstate', workspace: 'real_estate', keywords: 'buildings listings' },
    { label: 'Clients', section: 'Real estate', to: '/app/real-estate/clients', permissions: ['clients.read', 'rentals.read'], feature: 'realEstate', workspace: 'real_estate', keywords: 'tenants buyers customers' },
    { label: 'Property sales', section: 'Real estate', to: '/app/real-estate/sales', permissions: ['deals.read'], feature: 'realEstate', workspace: 'real_estate', keywords: 'sales deals transactions' },
    { label: 'Rentals', section: 'Real estate', to: '/app/real-estate/rentals', permissions: ['rentals.read'], feature: 'realEstate', workspace: 'real_estate', keywords: 'leases tenants' },
    { label: 'Rental contracts', section: 'Real estate', to: '/app/real-estate/rental-contracts', permissions: ['rentals.read'], feature: 'realEstate', workspace: 'real_estate', keywords: 'leases tenants' },
    { label: 'Rent payments', section: 'Real estate', to: '/app/real-estate/rent-payments', permissions: ['rentals.read'], feature: 'realEstate', workspace: 'real_estate', keywords: 'leases collections' },
    { label: 'Real estate reports', section: 'Real estate', to: '/app/real-estate/reports', permissions: ['reports.real_estate.read'], feature: 'realEstate', workspace: 'real_estate' },
    { label: 'Materials overview', section: 'Materials', to: '/app/materials/overview', permissions: ['workspace.material_management.read'], feature: 'materials', workspace: 'material_management', keywords: 'stock products' },
    { label: 'Material inventory', section: 'Materials', to: '/app/materials/inventory', permissions: ['materials_products.read'], feature: 'materials', workspace: 'material_management', keywords: 'stock products' },
    { label: 'Manage material products', section: 'Materials', to: '/app/materials/inventory/manage', permissions: ['materials_products.read'], feature: 'materials', workspace: 'material_management', keywords: 'stock products' },
    { label: 'Suppliers', section: 'Materials', to: '/app/materials/suppliers', permissions: ['suppliers.read'], feature: 'materials', workspace: 'material_management', keywords: 'vendors procurement' },
    { label: 'Purchases', section: 'Materials', to: '/app/materials/purchases', permissions: ['purchases.read'], feature: 'materials', workspace: 'material_management', keywords: 'orders procurement' },
    { label: 'Material customers', section: 'Materials', to: '/app/materials/customers', permissions: ['material_customers.read'], feature: 'materials', workspace: 'material_management', keywords: 'buyers clients' },
    { label: 'Material sales', section: 'Materials', to: '/app/materials/sales', permissions: ['material_sales.read'], feature: 'materials', workspace: 'material_management', keywords: 'invoices customers' },
    { label: 'Transportation', section: 'Materials', to: '/app/materials/transportation', permissions: ['transportation.read'], feature: 'materials', workspace: 'material_management', keywords: 'deliveries logistics' },
    { label: 'Materials reports', section: 'Materials', to: '/app/materials/reports', permissions: ['reports.material.read'], feature: 'materials', workspace: 'material_management' },
    { label: 'Reports', section: 'Administration', to: '/app/reports', permissions: ['reports.read'], feature: 'advancedReports' },
    { label: 'Report schedules', section: 'Administration', to: '/app/report-schedules', permissions: ['reports.admin'], feature: 'advancedReports', keywords: 'scheduled reports' },
    { label: 'Audit logs', section: 'Administration', to: '/app/audits', permissions: ['activity_logs.read'], keywords: 'activity history' },
    { label: 'Roles', section: 'Administration', to: '/app/roles', permissions: ['roles.read'], keywords: 'permissions access rbac' },
    { label: 'Settings', section: 'Administration', to: '/app/settings', permissions: ['settings.read'], keywords: 'account configuration' },
    { label: 'Notifications', section: 'Administration', to: '/app/notifications', keywords: 'alerts updates' },
    { label: 'Platform dashboard', section: 'Platform', to: '/superadmin/dashboard', platform: true, keywords: 'home overview' },
    { label: 'Companies', section: 'Platform', to: '/superadmin/companies', platform: true, keywords: 'tenants businesses' },
    { label: 'Subscriptions & billing', section: 'Platform', to: '/superadmin/billing', platform: true, keywords: 'plans invoices payments' },
    { label: 'My account', section: 'Platform', to: '/superadmin/account', platform: true, keywords: 'settings profile' },
];

const Header = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const themeConfig = useSelector((state: IRootState) => state.themeConfig);
    const { session, user, hasPermission, hasAnyPermission } = usePermissions();
    const isSuperAdmin = Boolean(user?.isSuperAdmin);
    const [notifications, setNotifications] = useState<PlatformNotification[]>([]);
    const [tenantNotifications, setTenantNotifications] = useState<TenantNotificationFeed>({ alerts: [], unreadAlertCount: 0 });
    const [navigationQuery, setNavigationQuery] = useState('');
    const [navigationOpen, setNavigationOpen] = useState(false);
    const [recordMatches, setRecordMatches] = useState<RecordSearchResult[]>([]);
    const [recordSearchLoading, setRecordSearchLoading] = useState(false);
    const navigationInput = useRef<HTMLInputElement>(null);

    const availableDestinations = useMemo(() => navigationDestinations.filter((destination) => {
        if (Boolean(destination.platform) !== isSuperAdmin) return false;
        if (destination.feature && !user?.entitlements?.features?.[destination.feature]) return false;
        if (destination.workspace && user?.enterpriseConfiguration?.workspaceControls?.[destination.workspace] === false) return false;
        return !destination.permissions || (destination.permissions.length === 1 ? hasPermission(destination.permissions[0]) : hasAnyPermission(destination.permissions));
    }), [hasAnyPermission, hasPermission, isSuperAdmin, user]);
    const navigationMatches = useMemo(() => {
        const query = navigationQuery.trim().toLowerCase();
        if (!query) return [];
        return availableDestinations.filter((destination) => `${destination.label} ${destination.section} ${destination.keywords || ''}`.toLowerCase().includes(query)).slice(0, 8);
    }, [availableDestinations, navigationQuery]);

    useEffect(() => {
        const query = navigationQuery.trim();
        if (isSuperAdmin || query.length < 2) {
            setRecordMatches([]);
            setRecordSearchLoading(false);
            return;
        }
        let active = true;
        setRecordSearchLoading(true);
        const timeout = window.setTimeout(() => {
            api<RecordSearchResult[]>(`/api/settings/search?q=${encodeURIComponent(query)}`)
                .then((rows) => { if (active) setRecordMatches(rows); })
                .catch(() => { if (active) setRecordMatches([]); })
                .finally(() => { if (active) setRecordSearchLoading(false); });
        }, 220);
        return () => { active = false; window.clearTimeout(timeout); };
    }, [isSuperAdmin, navigationQuery]);

    useEffect(() => {
        const focusNavigation = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                navigationInput.current?.focus();
                setNavigationOpen(true);
            }
        };
        window.addEventListener('keydown', focusNavigation);
        return () => window.removeEventListener('keydown', focusNavigation);
    }, []);

    useEffect(() => {
        if (!isSuperAdmin) return;
        let active = true;
        const loadNotifications = () => {
            api<{ notifications: PlatformNotification[] }>('/api/superadmin/notifications')
                .then((result) => { if (active) setNotifications(result.notifications); })
                .catch(() => { if (active) setNotifications([]); });
        };
        loadNotifications();
        window.addEventListener('maamulpro:platform-notifications', loadNotifications);
        return () => {
            active = false;
            window.removeEventListener('maamulpro:platform-notifications', loadNotifications);
        };
    }, [isSuperAdmin]);

    useEffect(() => {
        if (isSuperAdmin) return;
        let active = true;
        const loadNotifications = () => {
            api<TenantNotificationFeed>('/api/settings/notifications')
                .then((result) => { if (active) setTenantNotifications(result); })
                .catch(() => { if (active) setTenantNotifications({ alerts: [], unreadAlertCount: 0 }); });
        };
        loadNotifications();
        const interval = window.setInterval(loadNotifications, 60_000);
        window.addEventListener('maamulpro:tenant-notifications', loadNotifications);
        return () => {
            active = false;
            window.clearInterval(interval);
            window.removeEventListener('maamulpro:tenant-notifications', loadNotifications);
        };
    }, [isSuperAdmin]);

    const logout = async () => {
        try {
            await api('/api/auth/logout', { method: 'POST' });
        } finally {
            sessionStore.clear();
            navigate(isSuperAdmin ? '/superadmin/login' : '/', { replace: true });
        }
    };
    const accountPath = isSuperAdmin ? '/superadmin/account' : '/app/settings';
    const openDestination = (to: string) => {
        navigate(to);
        setNavigationQuery('');
        setNavigationOpen(false);
    };
    const submitNavigation = (event: FormEvent) => {
        event.preventDefault();
        if (navigationMatches[0]) openDestination(navigationMatches[0].to);
        else if (recordMatches[0]) openDestination(recordMatches[0].targetPath);
    };

    return (
        <header className="z-40">
            <div className="shadow-sm">
                <div className="relative flex w-full items-center bg-white px-5 py-2.5 dark:bg-[#121c2c]">
                    <button type="button" className="rounded-full p-2 hover:bg-gray-100 dark:hover:bg-dark-light/10" onClick={() => dispatch(toggleSidebar())} aria-label="Toggle navigation">
                        <IconMenu />
                    </button>
                    <form className="relative ml-3 min-w-0 max-w-xl flex-1" onSubmit={submitNavigation}>
                        <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white-dark" />
                        <input ref={navigationInput} className="form-input h-9 w-full rounded-full py-1 pl-9 pr-12 text-sm" value={navigationQuery} onChange={(event) => { setNavigationQuery(event.target.value); setNavigationOpen(true); }} onFocus={() => setNavigationOpen(true)} onKeyDown={(event) => { if (event.key === 'Escape') { setNavigationOpen(false); event.currentTarget.blur(); } }} placeholder="Search pages…" aria-label="Search pages" />
                        <span className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-white-light px-1 text-[10px] text-white-dark md:inline">Ctrl K</span>
                        {navigationOpen && navigationQuery.trim() && <div className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-[min(32rem,calc(100vw-2.5rem))] overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-black/5 dark:bg-[#1b2e4b]">
                            {navigationMatches.length > 0 && <><p className="border-b border-white-light px-4 py-2 text-xs font-bold uppercase tracking-wide text-white-dark dark:border-[#191e3a]">Pages</p>{navigationMatches.map((destination) => <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-[#152136]" key={destination.to} onMouseDown={(event) => event.preventDefault()} onClick={() => openDestination(destination.to)} type="button"><span className="font-semibold">{destination.label}</span><span className="text-xs text-white-dark">{destination.section}</span></button>)}</>}
                            {!isSuperAdmin && <><p className="border-y border-white-light px-4 py-2 text-xs font-bold uppercase tracking-wide text-white-dark dark:border-[#191e3a]">Records</p>{recordSearchLoading ? <p className="px-4 py-3 text-sm text-white-dark">Searching records…</p> : recordMatches.length ? recordMatches.map((record) => <button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-[#152136]" key={`${record.section}:${record.id}`} onMouseDown={(event) => event.preventDefault()} onClick={() => openDestination(record.targetPath)} type="button"><span><strong className="block">{record.label}</strong><small className="text-white-dark">{record.description}</small></span><span className="text-xs text-white-dark">{record.section}</span></button>) : <p className="px-4 py-3 text-sm text-white-dark">No accessible records match “{navigationQuery}”.</p>}</>}
                            {isSuperAdmin && !navigationMatches.length && <p className="p-4 text-sm text-white-dark">No accessible page matches “{navigationQuery}”.</p>}
                        </div>}
                    </form>
                    <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
                        <button type="button" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-dark-light/10" onClick={() => dispatch(toggleTheme(themeConfig.theme === 'light' ? 'dark' : 'light'))} aria-label="Toggle color theme">
                            {themeConfig.theme === 'light' ? <IconMoon /> : <IconSun />}
                        </button>
                        {!isSuperAdmin && <Dropdown
                            placement="bottom-end"
                            btnClassName="relative flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-dark-light/10"
                            button={<><IconBellBing />{tenantNotifications.unreadAlertCount > 0 && <span className="absolute right-0 top-0 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{tenantNotifications.unreadAlertCount > 9 ? '9+' : tenantNotifications.unreadAlertCount}</span>}</>}
                        >
                            <div className="mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-black/5 dark:bg-[#1b2e4b]">
                                <div className="flex items-center justify-between border-b border-white-light px-4 py-3 dark:border-[#191e3a]"><p className="font-bold">Operational alerts</p><Link className="text-xs font-semibold text-primary" to="/app/notifications">View all</Link></div>
                                <div className="max-h-80 overflow-y-auto">
                                    {tenantNotifications.alerts.length ? tenantNotifications.alerts.slice(0, 5).map((alert) => <Link className={`block border-b border-white-light px-4 py-3 last:border-0 hover:bg-gray-50 dark:border-[#191e3a] dark:hover:bg-[#152136] ${alert.isUnread ? 'bg-primary-light/40' : ''}`} key={alert.id} to={alert.targetPath || '/app/notifications'}>
                                        <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold">{alert.title}</p><span className={`badge ${alert.severity === 'CRITICAL' ? 'bg-danger' : 'bg-warning'}`}>{alert.severity}</span></div>{alert.details && <p className="mt-1 text-xs text-white-dark">{alert.details}</p>}<time className="mt-1 block text-[11px] text-white-dark">{new Date(alert.activeAt).toLocaleString()}</time>
                                    </Link>) : <p className="p-6 text-center text-sm text-white-dark">No active operational alerts.</p>}
                                </div>
                            </div>
                        </Dropdown>}
                        {isSuperAdmin && <Dropdown
                            placement="bottom-end"
                            btnClassName="relative flex h-9 w-9 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-dark-light/10"
                            button={<><IconBellBing />{notifications.length > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" />}</>}
                        >
                            <div className="mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-md bg-white shadow-lg ring-1 ring-black/5 dark:bg-[#1b2e4b]">
                                <div className="flex items-center justify-between border-b border-white-light px-4 py-3 dark:border-[#191e3a]"><p className="font-bold">Platform notifications</p><Link className="text-xs font-semibold text-primary" to="/superadmin/dashboard">Dashboard</Link></div>
                                <div className="max-h-80 overflow-y-auto">
                                    {notifications.length ? notifications.map((item) => <Link className="block border-b border-white-light px-4 py-3 last:border-0 hover:bg-gray-50 dark:border-[#191e3a] dark:hover:bg-[#152136]" key={item.id} to={item.companyId ? `/superadmin/companies/${item.companyId}` : '/superadmin/dashboard'}>
                                        <p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-white-dark">{item.details}</p><time className="mt-1 block text-[11px] text-white-dark">{new Date(item.createdAt).toLocaleString()}</time>
                                    </Link>) : <p className="p-6 text-center text-sm text-white-dark">No platform notifications.</p>}
                                </div>
                            </div>
                        </Dropdown>}
                        <Dropdown
                            placement="bottom-end"
                            btnClassName="flex items-center gap-2 rounded-full p-1 pr-2 hover:bg-gray-100 dark:hover:bg-dark-light/10"
                            button={<><span className="grid h-8 w-8 place-items-center rounded-full bg-primary-light font-bold text-primary">{(session?.user.name || session?.user.email || 'A').charAt(0).toUpperCase()}</span><span className="hidden max-w-32 truncate text-sm font-semibold sm:block">{session?.user.name || session?.user.email}</span></>}
                        >
                            <div className="mt-2 w-56 rounded-md bg-white p-2 shadow-lg ring-1 ring-black/5 dark:bg-[#1b2e4b]">
                                <div className="border-b border-white-light px-3 py-2 dark:border-[#191e3a]"><p className="font-semibold">{session?.user.name || 'Administrator'}</p><p className="truncate text-xs text-white-dark">{session?.user.email}</p></div>
                                <Link className="flex items-center gap-2 rounded px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-[#152136]" to={accountPath}><IconUser className="h-4 w-4" />Account Settings</Link>
                                <button className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-danger hover:bg-danger-light" onClick={logout} type="button"><IconLogout className="h-4 w-4" />Logout</button>
                            </div>
                        </Dropdown>
                    </div>
                </div>
            </div>
        </header>
    );
};

export default Header;
