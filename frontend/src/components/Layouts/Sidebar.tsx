import { ReactNode, useEffect, useMemo, useState } from 'react';
import PerfectScrollbar from 'react-perfect-scrollbar';
import AnimateHeight from 'react-animate-height';
import { NavLink, useLocation } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { IRootState } from '../../store';
import { toggleSidebar } from '../../store/themeConfigSlice';
import { Session, sessionStore } from '../../lib/api';
import { BarChart3, BookOpen, BookOpenCheck, Building2, Calendar, CheckSquare, CreditCard, DollarSign, FileSignature, FileText, Handshake, KeyRound, LayoutDashboard, Package, Receipt, Settings, Shield, ShieldCheck, ShoppingCart, Tags, TrendingUp, Truck, User, UserCheck, Users, Wallet } from 'lucide-react';
import IconCaretDown from '../Icon/IconCaretDown';
import IconCaretsDown from '../Icon/IconCaretsDown';
import IconMenuDashboard from '../Icon/Menu/IconMenuDashboard';
import IconMenuUsers from '../Icon/Menu/IconMenuUsers';
import IconMenuInvoice from '../Icon/Menu/IconMenuInvoice';
import IconMenuCharts from '../Icon/Menu/IconMenuCharts';
import IconMenuComponents from '../Icon/Menu/IconMenuComponents';
import IconMenuElements from '../Icon/Menu/IconMenuElements';
import IconMenuForms from '../Icon/Menu/IconMenuForms';
import { useBranding } from '../../hooks/useBranding';
import { AuthenticatedImage } from '../maamulpro/AuthenticatedImage';

type Feature = 'construction' | 'realEstate' | 'materials' | 'payroll' | 'advancedReports';
type Item = { label: string; to: string; icon?: ReactNode; feature?: Feature; permission?: string | string[] };
type Group = { label: string; icon: ReactNode; items: Item[]; feature?: Feature; permission?: string | string[] };

const subIconClass = 'shrink-0 text-gray-400 group-hover/sub:!text-primary';
const iconClass = '!text-primary shrink-0';

const companyGroups: Group[] = [
    { label: 'Overview', icon: <IconMenuDashboard className={iconClass} />, items: [
        { label: 'Dashboard', to: '/app/dashboard', icon: <LayoutDashboard size={16} className={subIconClass} />, permission: 'dashboard.executive.read' },
        { label: 'Analytics', to: '/app/analytics', icon: <BarChart3 size={16} className={subIconClass} />, permission: 'analytics.read' },
    ] },
    { label: 'People & finance', icon: <IconMenuUsers className={iconClass} />, items: [
        { label: 'Staff', to: '/app/staff', icon: <Users size={16} className={subIconClass} />, permission: 'users.read' },
        { label: 'Financials', to: '/app/financials', icon: <Wallet size={16} className={subIconClass} />, permission: 'financials.read' },
        { label: 'Chart of accounts', to: '/app/financials/accounts', icon: <BookOpen size={16} className={subIconClass} />, permission: 'accounting.read' },
        { label: 'Journal entries', to: '/app/financials/journals', icon: <BookOpenCheck size={16} className={subIconClass} />, permission: 'accounting.read' },
        { label: 'Financial reports', to: '/app/financials/financial-reports', icon: <TrendingUp size={16} className={subIconClass} />, permission: 'accounting.read' },
        { label: 'Accounting periods', to: '/app/financials/periods', icon: <Calendar size={16} className={subIconClass} />, permission: 'accounting.read' },
        { label: 'Payroll', to: '/app/payroll', feature: 'payroll', icon: <Receipt size={16} className={subIconClass} />, permission: 'payroll.read' },
        { label: 'Payslips', to: '/app/payroll/payslips', feature: 'payroll', icon: <FileText size={16} className={subIconClass} />, permission: 'payroll.read' },
    ] },
    { label: 'Construction', feature: 'construction', icon: <IconMenuComponents className={iconClass} />, permission: 'workspace.construction.read', items: [
        { label: 'Overview', to: '/app/construction/overview', icon: <LayoutDashboard size={16} className={subIconClass} />, permission: 'workspace.construction.read' },
        { label: 'Projects', to: '/app/construction/projects', icon: <Building2 size={16} className={subIconClass} />, permission: 'projects.read' },
        { label: 'Tasks', to: '/app/construction/tasks', icon: <CheckSquare size={16} className={subIconClass} />, permission: 'construction_tasks.read' },
        { label: 'Expenses', to: '/app/construction/expenses', icon: <DollarSign size={16} className={subIconClass} />, permission: 'construction_expenses.read' },
        { label: 'Manpower', to: '/app/construction/manpower', icon: <Users size={16} className={subIconClass} />, permission: 'manpower.read' },
        { label: 'Inventory', to: '/app/construction/inventory', icon: <Package size={16} className={subIconClass} />, permission: 'construction_inventory.read' },
        { label: 'Contracts', to: '/app/construction/contracts', icon: <FileSignature size={16} className={subIconClass} />, permission: 'workforce_contracts.read' },
        { label: 'Reports', to: '/app/construction/reports', icon: <BarChart3 size={16} className={subIconClass} />, permission: 'reports.construction.read' },
    ] },
    { label: 'Real estate', feature: 'realEstate', icon: <IconMenuElements className={iconClass} />, permission: 'workspace.real_estate.read', items: [
        { label: 'Overview', to: '/app/real-estate/overview', icon: <LayoutDashboard size={16} className={subIconClass} />, permission: 'workspace.real_estate.read' },
        { label: 'Properties', to: '/app/real-estate/properties', icon: <Building2 size={16} className={subIconClass} />, permission: 'properties.read' },
        { label: 'Clients', to: '/app/real-estate/clients', icon: <UserCheck size={16} className={subIconClass} />, permission: ['clients.read', 'rentals.read'] },
        { label: 'Deals', to: '/app/real-estate/deals', icon: <Handshake size={16} className={subIconClass} />, permission: 'deals.read' },
        { label: 'Rentals', to: '/app/real-estate/rentals', icon: <KeyRound size={16} className={subIconClass} />, permission: 'rentals.read' },
        { label: 'Rent payments', to: '/app/real-estate/rent-payments', icon: <Wallet size={16} className={subIconClass} />, permission: 'rentals.read' },
        { label: 'Reports', to: '/app/real-estate/reports', icon: <BarChart3 size={16} className={subIconClass} />, permission: 'reports.real_estate.read' },
    ] },
    { label: 'Materials', feature: 'materials', icon: <IconMenuInvoice className={iconClass} />, permission: 'workspace.material_management.read', items: [
        { label: 'Overview', to: '/app/materials/overview', icon: <LayoutDashboard size={16} className={subIconClass} />, permission: 'workspace.material_management.read' },
        { label: 'Inventory', to: '/app/materials/inventory', icon: <Package size={16} className={subIconClass} />, permission: 'materials_products.read' },
        { label: 'Suppliers', to: '/app/materials/suppliers', icon: <Truck size={16} className={subIconClass} />, permission: 'suppliers.read' },
        { label: 'Purchases', to: '/app/materials/purchases', icon: <ShoppingCart size={16} className={subIconClass} />, permission: 'purchases.read' },
        { label: 'Customers', to: '/app/materials/customers', icon: <UserCheck size={16} className={subIconClass} />, permission: 'material_customers.read' },
        { label: 'Sales', to: '/app/materials/sales', icon: <Tags size={16} className={subIconClass} />, permission: 'material_sales.read' },
        { label: 'Transportation', to: '/app/materials/transportation', icon: <Truck size={16} className={subIconClass} />, permission: 'transportation.read' },
        { label: 'Reports', to: '/app/materials/reports', icon: <BarChart3 size={16} className={subIconClass} />, permission: 'reports.material.read' },
    ] },
    { label: 'Administration', icon: <IconMenuCharts className={iconClass} />, items: [
        { label: 'Reports', to: '/app/reports', feature: 'advancedReports', icon: <BarChart3 size={16} className={subIconClass} />, permission: 'reports.read' },
        { label: 'Report schedules', to: '/app/report-schedules', feature: 'advancedReports', icon: <Calendar size={16} className={subIconClass} />, permission: 'reports.admin' },
        { label: 'Audit logs', to: '/app/audits', icon: <Shield size={16} className={subIconClass} />, permission: 'activity_logs.read' },
        { label: 'Roles', to: '/app/roles', icon: <ShieldCheck size={16} className={subIconClass} />, permission: 'roles.read' },
        { label: 'Settings', to: '/app/settings', icon: <Settings size={16} className={subIconClass} />, permission: 'settings.read' },
    ] },
];

const platformGroups: Group[] = [
    { label: 'Platform', icon: <IconMenuDashboard className={iconClass} />, items: [{ label: 'Dashboard', to: '/superadmin/dashboard', icon: <LayoutDashboard size={16} className={subIconClass} /> }, { label: 'Companies', to: '/superadmin/companies', icon: <Building2 size={16} className={subIconClass} /> }, { label: 'Subscriptions & billing', to: '/superadmin/billing', icon: <CreditCard size={16} className={subIconClass} /> }] },
    { label: 'Administration', icon: <IconMenuForms className={iconClass} />, items: [{ label: 'My account', to: '/superadmin/account', icon: <User size={16} className={subIconClass} /> }] },
];

const platformItems: Item[] = [
    { label: 'Dashboard', to: '/superadmin/dashboard', icon: <IconMenuDashboard className={iconClass} /> },
    { label: 'Companies', to: '/superadmin/companies', icon: <IconMenuUsers className={iconClass} /> },
    { label: 'Subscriptions & billing', to: '/superadmin/billing', icon: <IconMenuCharts className={iconClass} /> },
    { label: 'My account', to: '/superadmin/account', icon: <IconMenuForms className={iconClass} /> },
];

const Sidebar = () => {
    const dispatch = useDispatch();
    const location = useLocation();
    const themeConfig = useSelector((state: IRootState) => state.themeConfig);
    const semidark = useSelector((state: IRootState) => state.themeConfig.semidark);
    const [session, setSession] = useState<Session | null>(() => sessionStore.get());
    useEffect(() => {
        const update = (event: Event) => setSession((event as CustomEvent<Session | null>).detail);
        window.addEventListener('maamulpro:session', update);
        return () => window.removeEventListener('maamulpro:session', update);
    }, []);
    const isPlatform = Boolean(session?.user.isSuperAdmin);
    const branding = useBranding(isPlatform ? '' : session?.user.companyId);
    const companyName = isPlatform ? 'MaamulPro' : branding?.companyName || session?.user.companyName || 'Company';
    const userPermissions = useMemo(() => new Set(session?.user.permissions || []), [session]);
    const isOwner = isPlatform || Boolean(session?.user.isImpersonating) || ['COMPANY_OWNER', 'SUPER_ADMIN'].includes(session?.user.role || '');
    const hasPerm = (perm?: string | string[]) => !perm || isOwner || (Array.isArray(perm) ? perm.some((p) => userPermissions.has(p)) : userPermissions.has(perm));

    const groups = useMemo(() => {
        if (isPlatform) return platformGroups;
        const features = session?.user.entitlements?.features;
        const enterprise = session?.user.enterpriseConfiguration;
        const workspaceKey = (label: string) => label === 'Construction'
            ? 'construction'
            : label === 'Real estate'
                ? 'real_estate'
                : label === 'Materials'
                    ? 'material_management'
                    : '';
        const sidebarKey = (item: Item) => {
            if (item.to === '/app/dashboard') return 'dashboard';
            if (item.to === '/app/analytics') return 'analytics';
            if (item.to.startsWith('/app/staff')) return 'staff';
            if (item.to.startsWith('/app/financials') || item.to.startsWith('/app/payroll')) return 'financials';
            if (item.to.startsWith('/app/reports') || item.to.startsWith('/app/report-schedules')) return 'reports';
            if (item.to.startsWith('/app/audits')) return 'audits';
            if (item.to.startsWith('/app/roles') || item.to.startsWith('/app/settings')) return 'workspaces';
            return '';
        };
        return companyGroups
            .filter((group) => !group.feature || Boolean(features?.[group.feature]))
            .filter((group) => hasPerm(group.permission))
            .filter((group) => {
                const workspace = workspaceKey(group.label);
                return !workspace
                    || (enterprise?.workspaceControls?.[workspace] !== false
                        && enterprise?.sidebarVisibility?.[workspace] !== false);
            })
            .map((group) => ({
                ...group,
                items: group.items.filter((item) => {
                    if (item.feature && !features?.[item.feature]) return false;
                    if (!hasPerm(item.permission)) return false;
                    const key = sidebarKey(item);
                    return !key || enterprise?.sidebarVisibility?.[key] !== false;
                }),
            }))
            .filter((group) => group.items.length);
    }, [isPlatform, session, userPermissions, isOwner]);
    // A group whose items all share one URL prefix (e.g. every Construction item starts with
    // /app/construction) stays expanded for ANY sub-route under that prefix, not just the ones
    // literally listed here — otherwise a page reachable only via an in-page link (e.g. Worker
    // Types, linked from Manpower) collapses the whole group when opened directly.
    const groupDomain = (group: Group) => {
        const domains = group.items.map((item) => item.to.split('/').slice(0, 3).join('/'));
        return domains.every((domain) => domain === domains[0]) ? domains[0] : null;
    };
    const activeGroup = groups.find((group) => {
        const domain = groupDomain(group);
        return (domain && location.pathname.startsWith(domain)) || group.items.some((item) => location.pathname.startsWith(item.to));
    })?.label || '';
    const [openGroup, setOpenGroup] = useState(activeGroup);

    useEffect(() => {
        setOpenGroup(activeGroup);
        if (window.innerWidth < 1024 && themeConfig.sidebar) dispatch(toggleSidebar());
    }, [activeGroup, location.pathname]);

    const home = session?.user.isSuperAdmin ? '/superadmin/dashboard' : '/app/dashboard';
    // On mobile (< lg), never collapse so text is always shown
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024);
    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 1024);
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);
    const collapsed = !isMobile && (themeConfig.sidebar === true || themeConfig.sidebar === 'true');

    return (
        <div className={semidark ? 'dark' : ''}>
            <nav className={'sidebar fixed min-h-screen h-full top-0 bottom-0 z-50 shadow-[5px_0_25px_0_rgba(94,92,154,0.1)] transition-all duration-300 ' + (collapsed ? 'w-[72px]' : 'w-[260px]') + ' ' + (semidark ? 'text-white-dark' : '')}>
                <div className="h-full bg-white dark:bg-black">
                    <div className="flex items-center justify-between px-4 py-3">
                        <NavLink className="main-logo flex shrink-0 items-center" to={home}>
                            {isPlatform
                                ? <img alt="MaamulPro" className="ml-[5px] h-8 w-8 flex-none" src="/assets/images/logo.svg" />
                                : branding?.logoUrl
                                    ? <AuthenticatedImage alt={`${companyName} logo`} className="ml-[5px] h-8 w-8 flex-none rounded-md object-contain" src={branding.logoUrl} />
                                    : <span aria-hidden="true" className="ml-[5px] grid h-8 w-8 flex-none place-items-center rounded-md bg-primary-light text-primary"><Building2 size={18} /></span>}
                            {!collapsed && <span className="ml-1.5 truncate text-2xl font-semibold align-middle dark:text-white-light">{companyName}</span>}
                        </NavLink>
                        <button className="collapse-icon flex h-8 w-8 rounded-full transition duration-300 hover:bg-gray-500/10 dark:text-white-light dark:hover:bg-dark-light/10" onClick={() => dispatch(toggleSidebar())} type="button">
                            <IconCaretsDown className="m-auto rotate-90" />
                        </button>
                    </div>
                    <PerfectScrollbar className="relative h-[calc(100vh-80px)]">
                        <ul className={`relative space-y-0.5 py-0 font-semibold ${collapsed ? 'p-2' : 'p-4'}`}>
                            {isPlatform ? platformItems.map((item) => <li className="menu nav-item" key={item.to}><NavLink className="nav-link group" to={item.to} title={collapsed ? item.label : undefined}><div className="flex items-center">{item.icon}{!collapsed && <span className="pl-3 text-black dark:text-[#506690] dark:group-hover:text-white-dark">{item.label}</span>}</div></NavLink></li>) : groups.map((group) => {
                                const expanded = openGroup === group.label;
                                return (
                                    <li className="menu nav-item" key={group.label}>
                                        <button className={'nav-link group w-full ' + (expanded ? 'active' : '')} onClick={() => setOpenGroup(expanded ? '' : group.label)} type="button">
                                            <div className="flex items-center">
                                                {group.icon}
                                                {!collapsed && <span className="pl-3 text-black dark:text-[#506690] dark:group-hover:text-white-dark">{group.label}</span>}
                                            </div>
                                            <div className={expanded ? '' : '-rotate-90'}>
                                                <IconCaretDown />
                                            </div>
                                        </button>
                                        <AnimateHeight duration={250} height={expanded && !collapsed ? 'auto' : 0}>
                                            <ul className="sub-menu text-gray-500">
                                                {group.items.map((item) => <li key={item.to}><NavLink end={item.to === home} to={item.to}><div className="flex items-center gap-2">{item.icon}<span>{item.label}</span></div></NavLink></li>)}
                                            </ul>
                                        </AnimateHeight>
                                    </li>
                                );
                            })}
                        </ul>
                    </PerfectScrollbar>
                </div>
            </nav>
        </div>
    );
};

export default Sidebar;
