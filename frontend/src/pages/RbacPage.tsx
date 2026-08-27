import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Edit3, Info, Plus, Search, Shield, ShieldCheck, ShieldX, Trash2, UserCheck, Users, X } from 'lucide-react';
import AppShell from '../components/maamulpro/AppShell';
import { EmptyState, ErrorAlert, LoadingState, Modal, PageHeader } from '../components/maamulpro/PageKit';
import { api, refreshSession } from '../lib/api';
import { toast } from '../lib/toast';
import { usePermissions } from '../hooks/usePermissions';

type Permission = { id: string; key: string; label: string; module: string; workspace?: string };
type Role = { id: string; key: string; name: string; description?: string; isSystem: boolean; isActive: boolean; rolePermissions: { permission: Permission }[]; _count?: { userRoles: number } };
type StaffUser = { id: string; firstName: string; lastName: string; user?: { id: string; email: string } };
type UserAccess = { id: string; name: string; email: string; role?: string; approvalLimit?: number | null; rbacUserRoles: { role: Role }[]; rbacUserPermissions: { effect: string; reason?: string; permission: Permission }[] };

type Tab = 'roles' | 'users';

const RbacPage = () => {
    const { user, hasPermission } = usePermissions();
    const canCreateRole = hasPermission('roles.create');
    const canEditRole = hasPermission('roles.update');
    const canDeleteRole = hasPermission('roles.delete');
    const canAssign = hasPermission('users.update') && hasPermission('roles.update');
    const [permissions, setPermissions] = useState<Permission[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [form, setForm] = useState({ key: '', name: '', description: '' });
    const [error, setError] = useState('');
    const [editingRole, setEditingRole] = useState<Role | null>(null);
    const [showRoleModal, setShowRoleModal] = useState(false);
    const [staff, setStaff] = useState<StaffUser[]>([]);
    const [userId, setUserId] = useState('');
    const [staffId, setStaffId] = useState('');
    const [access, setAccess] = useState<UserAccess | null>(null);
    const [direct, setDirect] = useState({ permissionId: '', effect: 'ALLOW', reason: '' });
    const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
    const [tab, setTab] = useState<Tab>('roles');
    const [roleSearch, setRoleSearch] = useState('');
    const [permSearch, setPermSearch] = useState('');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [viewingRole, setViewingRole] = useState<Role | null>(null);
    const [loading, setLoading] = useState(true);
    const [savingRole, setSavingRole] = useState(false);
    const [loadingUser, setLoadingUser] = useState(false);
    const [savingAccess, setSavingAccess] = useState(false);
    const accessPending = useRef(false);
    const accountRoles = roles.filter(role => role.isSystem && role.isActive);

    const load = () => Promise.all([
        api<Permission[]>('/api/rbac/permissions'),
        api<Role[]>('/api/rbac/roles'),
        api<any>('/api/staff?limit=1000'),
    ]).then(([p, r, s]) => {
        setPermissions(p);
        setRoles(r);
        setStaff((Array.isArray(s) ? s : s.data || []).filter((row: StaffUser) => row.user));
    });

    useEffect(() => {
        setLoading(true);
        setRoles([]); setPermissions([]); setAccess(null); setViewingRole(null); setShowRoleModal(false);
        load().catch((reason) => setError(reason.message)).finally(() => setLoading(false));
    }, [user?.constructionEnabled, user?.realEstateEnabled, user?.materialManagementEnabled]);

    const groups = useMemo(
        () => permissions.reduce<Record<string, Permission[]>>((result, permission) => {
            const group = permission.workspace || permission.module;
            (result[group] ||= []).push(permission);
            return result;
        }, {}),
        [permissions],
    );

    const filteredRoles = useMemo(
        () => roles.filter((r) => !roleSearch || r.name.toLowerCase().includes(roleSearch.toLowerCase()) || r.key.toLowerCase().includes(roleSearch.toLowerCase())),
        [roles, roleSearch],
    );

    const filteredGroups = useMemo(() => {
        if (!permSearch) return groups;
        const q = permSearch.toLowerCase();
        const result: Record<string, Permission[]> = {};
        for (const [group, items] of Object.entries(groups)) {
            const filtered = items.filter((p) => (p.label || p.key).toLowerCase().includes(q) || group.toLowerCase().includes(q));
            if (filtered.length) result[group] = filtered;
        }
        return result;
    }, [groups, permSearch]);

    const openCreateRole = () => {
        setEditingRole(null);
        setForm({ key: '', name: '', description: '' });
        setSelected([]);
        setExpandedGroups(new Set());
        setPermSearch('');
        setShowRoleModal(true);
    };

    const openEditRole = (role: Role) => {
        setEditingRole(role);
        setForm({ key: role.key, name: role.name, description: role.description || '' });
        setSelected(role.rolePermissions.map((item) => item.permission.id));
        setExpandedGroups(new Set(Object.keys(groups)));
        setPermSearch('');
        setShowRoleModal(true);
    };

    const closeRoleModal = () => {
        setShowRoleModal(false);
        setEditingRole(null);
        setForm({ key: '', name: '', description: '' });
        setSelected([]);
    };

    const saveRole = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        setSavingRole(true);
        try {
            const body = editingRole
                ? { name: form.name, description: form.description, permissionIds: selected }
                : { key: form.key.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^[^A-Z]+/, '').replace(/_+$/g, '').slice(0, 49), name: form.name, description: form.description, permissionIds: selected };
            await api(editingRole ? `/api/rbac/roles/${editingRole.id}` : '/api/rbac/roles', {
                method: editingRole ? 'PATCH' : 'POST',
                silent: true,
                body: JSON.stringify(body),
            });
            toast.success(editingRole ? `Role "${form.name}" updated.` : `Role "${form.name}" created.`);
            closeRoleModal();
            await load();
            refreshSession(true).catch(() => undefined);
        } catch (reason) {
            const msg = reason instanceof Error ? reason.message : 'Unable to save role';
            toast.error(msg);
            setError(msg);
        } finally {
            setSavingRole(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setSavingRole(true);
        try {
            await api(`/api/rbac/roles/${deleteTarget.id}`, { method: 'DELETE', silent: true });
            toast.success(`Role "${deleteTarget.name}" deleted.`);
            setDeleteTarget(null);
            await load();
            refreshSession(true).catch(() => undefined);
        } catch (reason) {
            const msg = reason instanceof Error ? reason.message : 'Unable to delete role';
            toast.error(msg);
            setError(msg);
        } finally {
            setSavingRole(false);
        }
    };

    const selectUser = async (id: string) => {
        setUserId(id);
        setStaffId(staff.find((p) => p.user?.id === id)?.id || '');
        if (!id) return setAccess(null);
        setLoadingUser(true);
        try {
            setAccess(await api<UserAccess>(`/api/rbac/users/${id}`));
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to load user access');
        } finally {
            setLoadingUser(false);
        }
    };

    const toggleUserRole = async (roleId: string) => {
        if (!access || accessPending.current) return;
        accessPending.current = true; setSavingAccess(true); setError('');
        const current = access.rbacUserRoles.map((item) => item.role.id);
        const roleIds = current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId];
        try {
            setAccess(await api<UserAccess>(`/api/rbac/users/${access.id}/roles`, { method: 'PATCH', silent: true, body: JSON.stringify({ roleIds }) }));
            toast.success('User roles updated.');
            refreshSession(true).catch(() => undefined);
        } catch (reason) {
            const msg = reason instanceof Error ? reason.message : 'Unable to assign role';
            setError(msg);
        } finally {
            accessPending.current = false; setSavingAccess(false);
        }
    };

    const changeSystemRole = async (role: string) => {
        if (!staffId || !access || accessPending.current || !accountRoles.some(item => item.key === role)) return;
        accessPending.current = true; setSavingAccess(true); setError('');
        try {
            await api(`/api/staff/${staffId}/account/role`, { method: 'PATCH', silent: true, body: JSON.stringify({ role }) });
            setAccess({ ...access, role });
            toast.success('System role updated.');
            refreshSession(true).catch(() => undefined);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to update system role');
        } finally {
            accessPending.current = false; setSavingAccess(false);
        }
    };

    const saveApprovalLimit = async () => {
        if (!access) return;
        try {
            const updated = await api<UserAccess>(`/api/rbac/users/${access.id}/approval-limit`, { method: 'PATCH', body: JSON.stringify({ approvalLimit: Number(access.approvalLimit || 0) }) });
            setAccess(updated); toast.success('Payroll approval limit updated.');
        } catch (reason) { toast.error(reason instanceof Error ? reason.message : 'Unable to update approval limit'); }
    };

    const addDirect = async () => {
        if (!access || !direct.permissionId) return;
        try {
            setAccess(await api<UserAccess>(`/api/rbac/users/${access.id}/permissions`, { method: 'POST', silent: true, body: JSON.stringify(direct) }));
            setDirect({ permissionId: '', effect: 'ALLOW', reason: '' });
            toast.success('Permission override applied.');
            refreshSession(true).catch(() => undefined);
        } catch (reason) {
            const msg = reason instanceof Error ? reason.message : 'Unable to set direct permission';
            toast.error(msg);
        }
    };

    const removeDirect = async (permissionId: string) => {
        if (!access) return;
        try {
            setAccess(await api<UserAccess>(`/api/rbac/users/${access.id}/permissions/${permissionId}`, { method: 'DELETE', silent: true }));
            toast.success('Permission override removed.');
            refreshSession(true).catch(() => undefined);
        } catch (reason) {
            const msg = reason instanceof Error ? reason.message : 'Unable to remove direct permission';
            toast.error(msg);
        }
    };

    const toggleGroup = (group: string) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            next.has(group) ? next.delete(group) : next.add(group);
            return next;
        });
    };

    const toggleGroupAll = (group: string, items: Permission[]) => {
        const ids = items.map((p) => p.id);
        const allSelected = ids.every((id) => selected.includes(id));
        setSelected(allSelected ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
    };

    const tabs: { key: Tab; label: string; icon: typeof Shield }[] = [
        { key: 'roles', label: 'Roles', icon: Shield },
        { key: 'users', label: 'User access', icon: Users },
    ];

    return (
        <AppShell>
            <PageHeader
                title="Roles & Permissions"
                description="Only roles and permissions for your company’s enabled modules are available."
                actions={tab === 'roles' && canCreateRole ? <button className="btn btn-primary flex items-center gap-2" onClick={openCreateRole}><Plus size={16} /> New role</button> : undefined}
            />

            {error && <ErrorAlert message={error} onRetry={() => setError('')} />}

            {/* Tabs */}
            <div className="mb-6 flex gap-1 rounded-lg border border-white-light bg-white p-1 dark:border-[#191e3a] dark:bg-black">
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-all ${tab === t.key ? 'bg-primary text-white shadow-sm' : 'text-white-dark hover:bg-white-light hover:text-dark dark:hover:bg-[#191e3a] dark:hover:text-white-light'}`}
                    >
                        <t.icon size={16} />
                        {t.label}
                    </button>
                ))}
            </div>

            {/* ───── Roles tab ───── */}
            {tab === 'roles' && (
                <div className="space-y-4">
                    {/* Search */}
                    <div className="relative max-w-sm">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white-dark" />
                        <input className="form-input pl-9" placeholder="Search roles..." value={roleSearch} onChange={(e) => setRoleSearch(e.target.value)} />
                    </div>

                    {/* Roles grid */}
                    {loading ? (
                        <div className="panel"><LoadingState label="Loading roles…" /></div>
                    ) : filteredRoles.length === 0 ? (
                        <EmptyState title="No roles found" description={roleSearch ? 'Try a different search term' : 'Create your first role to get started'} action={!roleSearch && canCreateRole ? <button className="btn btn-primary" onClick={openCreateRole}>Create role</button> : undefined} />
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            {filteredRoles.map((role) => (
                                <div key={role.id} className="panel group relative flex flex-col gap-4 p-5 transition-all hover:shadow-md dark:border-dark dark:bg-black">
                                    {/* Header */}
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${role.isActive ? 'bg-primary/10 text-primary dark:bg-primary/20' : 'bg-dark/10 text-dark dark:bg-dark/20'}`}>
                                                <Shield size={18} />
                                            </div>
                                            <div>
                                                <h3 className="font-bold leading-tight">{role.name}</h3>
                                                <span className="text-xs text-white-dark">{role.key}</span>
                                            </div>
                                        </div>
                                        <span className={`badge ${role.isActive ? 'bg-success/10 text-success' : 'bg-dark/10 text-dark'}`}>
                                            {role.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>

                                    {/* Description */}
                                    {role.description && <p className="text-sm text-white-dark line-clamp-2">{role.description}</p>}

                                    {/* Stats */}
                                    <div className="flex gap-4 text-sm">
                                        <span className="flex items-center gap-1.5 text-white-dark">
                                            <ShieldCheck size={14} className="text-primary" />
                                            <strong className="text-dark dark:text-white-light">{role.rolePermissions.length}</strong> permissions
                                        </span>
                                        <span className="flex items-center gap-1.5 text-white-dark">
                                            <Users size={14} className="text-info" />
                                            <strong className="text-dark dark:text-white-light">{role._count?.userRoles || 0}</strong> users
                                        </span>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex gap-2 border-t border-white-light pt-3 dark:border-[#191e3a]">
                                        <button className="btn btn-sm btn-outline-info flex-1 flex items-center justify-center gap-1.5" onClick={() => setViewingRole(role)}>
                                            <Info size={14} /> View
                                        </button>
                                        {canEditRole && (
                                            <button className="btn btn-sm btn-outline-primary flex-1 flex items-center justify-center gap-1.5" onClick={() => openEditRole(role)}>
                                                <Edit3 size={14} /> Edit
                                            </button>
                                        )}
                                        {canDeleteRole && !role.isSystem && (
                                            <button className="btn btn-sm btn-outline-danger flex items-center justify-center gap-1.5" onClick={() => setDeleteTarget(role)}>
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ───── User access tab ───── */}
            {tab === 'users' && (
                <div className="space-y-6">
                    {/* User picker */}
                    <div className="panel p-5 dark:border-dark dark:bg-black">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                            <div className="flex-1">
                                <label className="mb-1.5 block text-sm font-semibold">Select staff member</label>
                                <select className="form-select" value={userId} onChange={(event) => selectUser(event.target.value)}>
                                    <option value="">Choose a staff account...</option>
                                    {staff.map((person) => (
                                        <option key={person.user!.id} value={person.user!.id}>
                                            {person.firstName} {person.lastName} ({person.user!.email})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {loadingUser && (
                        <div className="panel"><LoadingState label="Loading user access…" /></div>
                    )}

                    {!loadingUser && access && (
                        <div className="grid gap-6 xl:grid-cols-5">
                            {/* Assigned roles */}
                            <div className="panel space-y-4 p-5 dark:border-dark dark:bg-black xl:col-span-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <UserCheck size={18} className="text-primary" />
                                    <h3 className="text-base font-bold">Assigned roles</h3>
                                    <span className="badge bg-primary/10 text-primary">{access.rbacUserRoles.length} assigned</span>
                                    {access.role && !canAssign && (
                                        <span className="badge bg-dark/10 text-dark dark:bg-white/10 dark:text-white-light" title="System role set at registration — drives default permissions when no RBAC roles are assigned">
                                            System: {access.role.replace(/_/g, ' ')}
                                        </span>
                                    )}
                                    {access.role && canAssign && (
                                        <select className="form-select h-7 py-0 text-xs" disabled={savingAccess} value={accountRoles.some(role => role.key === access.role) ? access.role : ''} title="System role — drives default permissions when no RBAC roles are assigned" onChange={(e) => changeSystemRole(e.target.value)}>
                                            <option value="" disabled>Select an enabled role</option>
                                            {accountRoles.map((role) => (
                                                <option key={role.key} value={role.key}>{role.name}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                                {savingAccess && <p role="status" className="text-sm text-primary">Saving access…</p>}
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {roles.filter((r) => r.isActive).map((role) => {
                                        const isAssigned = access.rbacUserRoles.some((item) => item.role.id === role.id);
                                        return (
                                            <label
                                                key={role.id}
                                                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-all ${isAssigned ? 'border-primary/30 bg-primary/5 dark:border-primary/20 dark:bg-primary/10' : 'border-white-light hover:border-primary/20 dark:border-[#191e3a] dark:hover:border-primary/20'}`}
                                            >
                                                <input className="form-checkbox text-primary" type="checkbox" checked={isAssigned} disabled={!canAssign || savingAccess} onChange={() => toggleUserRole(role.id)} />
                                                <div className="min-w-0 flex-1">
                                                    <span className="block font-semibold leading-tight">{role.name}</span>
                                                    <span className="block text-xs text-white-dark">{role.rolePermissions.length} permissions</span>
                                                </div>
                                                {isAssigned && <Check size={16} className="shrink-0 text-primary" />}
                                            </label>
                                        );
                                    })}
                                </div>
                                <div className="border-t border-white-light pt-4 dark:border-[#191e3a]"><label className="text-xs font-semibold uppercase tracking-wide text-white-dark">Payroll approval limit</label><div className="mt-2 flex gap-2"><input className="form-input" type="number" min="0" step="0.01" value={access.approvalLimit == null ? '' : Number(access.approvalLimit)} onChange={(event) => setAccess({ ...access, approvalLimit: event.target.value ? Number(event.target.value) : null })} placeholder="Unlimited" disabled={!canAssign} /><button className="btn btn-outline-primary" onClick={saveApprovalLimit} disabled={!canAssign}>Save limit</button></div><p className="mt-1 text-xs text-white-dark">Leave blank or use 0 for unlimited. Company owners are not limited.</p></div>
                            </div>

                            {/* Direct overrides */}
                            <div className="panel space-y-4 p-5 dark:border-dark dark:bg-black xl:col-span-2">
                                <div className="flex items-center gap-2">
                                    <ShieldX size={18} className="text-warning" />
                                    <h3 className="text-base font-bold">Permission overrides</h3>
                                </div>
                                <p className="text-xs text-white-dark">Grant or deny individual permissions beyond what roles provide.</p>

                                <div className="space-y-3">
                                    <select className="form-select" value={direct.permissionId} onChange={(e) => setDirect({ ...direct, permissionId: e.target.value })}>
                                        <option value="">Select permission...</option>
                                        {Object.entries(groups).map(([group, items]) => (
                                            <optgroup key={group} label={group.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}>
                                                {items.map((p) => <option key={p.id} value={p.id}>{p.label || p.key}</option>)}
                                            </optgroup>
                                        ))}
                                    </select>
                                    <div className="flex gap-2">
                                        <select className="form-select flex-1" value={direct.effect} onChange={(e) => setDirect({ ...direct, effect: e.target.value })}>
                                            <option value="ALLOW">Allow</option>
                                            <option value="DENY">Deny</option>
                                        </select>
                                        <input className="form-input flex-1" placeholder="Reason (optional)" value={direct.reason} onChange={(e) => setDirect({ ...direct, reason: e.target.value })} />
                                    </div>
                                    <button className="btn btn-primary w-full" disabled={!direct.permissionId || !canAssign} onClick={addDirect}>Apply override</button>
                                </div>

                                {/* Active overrides */}
                                {access.rbacUserPermissions.length > 0 && (
                                    <div className="space-y-2 border-t border-white-light pt-4 dark:border-[#191e3a]">
                                        <p className="text-xs font-semibold uppercase tracking-wider text-white-dark">Active overrides</p>
                                        {access.rbacUserPermissions.map((item) => (
                                            <div key={item.permission.id} className="flex items-center justify-between gap-3 rounded-lg border border-white-light p-3 dark:border-[#191e3a]">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`inline-flex h-5 items-center rounded px-1.5 text-[10px] font-bold uppercase ${item.effect === 'ALLOW' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                                                            {item.effect}
                                                        </span>
                                                        <span className="truncate text-sm font-medium">{item.permission.label || item.permission.key}</span>
                                                    </div>
                                                    {item.reason && <p className="mt-0.5 truncate text-xs text-white-dark">{item.reason}</p>}
                                                </div>
                                                {canAssign && <button className="btn btn-sm p-1.5 text-danger hover:bg-danger/10" onClick={() => removeDirect(item.permission.id)} title="Remove override">
                                                    <X size={14} />
                                                </button>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {!loadingUser && !access && userId === '' && (
                        <EmptyState title="Select a staff member" description="Choose a staff account above to view and manage their roles and permissions" />
                    )}
                </div>
            )}

            {/* ───── View Role modal ───── */}
            <Modal open={Boolean(viewingRole)} onClose={() => setViewingRole(null)} title={`Role: ${viewingRole?.name || ''}`} wide>
                {viewingRole && (
                    <div className="space-y-5">
                        <div className="grid gap-4 sm:grid-cols-3">
                            <div><p className="text-xs font-bold uppercase tracking-wider text-white-dark">Key</p><p className="mt-1 font-mono text-sm">{viewingRole.key}</p></div>
                            <div><p className="text-xs font-bold uppercase tracking-wider text-white-dark">Status</p><p className="mt-1"><span className={`badge ${viewingRole.isActive ? 'bg-success/10 text-success' : 'bg-dark/10 text-dark'}`}>{viewingRole.isActive ? 'Active' : 'Inactive'}</span></p></div>
                            <div><p className="text-xs font-bold uppercase tracking-wider text-white-dark">Type</p><p className="mt-1 text-sm">{viewingRole.isSystem ? 'System role' : 'Custom role'}</p></div>
                        </div>
                        {viewingRole.description && (
                            <div><p className="text-xs font-bold uppercase tracking-wider text-white-dark">Description</p><p className="mt-1 text-sm">{viewingRole.description}</p></div>
                        )}
                        <div>
                            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-white-dark">Permissions ({viewingRole.rolePermissions.length})</p>
                            <div className="max-h-80 overflow-y-auto rounded-lg border border-white-light dark:border-[#191e3a]">
                                {Object.entries(
                                    viewingRole.rolePermissions.reduce<Record<string, Permission[]>>((acc, rp) => {
                                        const g = rp.permission.workspace || rp.permission.module;
                                        (acc[g] ||= []).push(rp.permission);
                                        return acc;
                                    }, {})
                                ).map(([group, perms]) => (
                                    <div key={group} className="border-b border-white-light last:border-b-0 dark:border-[#191e3a]">
                                        <div className="bg-white-light/50 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white-dark dark:bg-[#191e3a]/50">
                                            {group.replace(/_/g, ' ')}
                                        </div>
                                        <div className="grid gap-1 px-4 py-2 sm:grid-cols-2">
                                            {perms.map((p) => (
                                                <div key={p.id} className="flex items-center gap-2 py-1 text-sm">
                                                    <Check size={14} className="shrink-0 text-success" />
                                                    <span>{p.label || p.key}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 border-t border-white-light pt-4 dark:border-[#191e3a]">
                            <button className="btn btn-outline-dark" onClick={() => setViewingRole(null)}>Close</button>
                            {canEditRole && <button className="btn btn-primary" onClick={() => { setViewingRole(null); openEditRole(viewingRole); }}>Edit role</button>}
                        </div>
                    </div>
                )}
            </Modal>

            {/* ───── Create / Edit Role modal ───── */}
            <Modal open={showRoleModal} onClose={closeRoleModal} title={editingRole ? `Edit role: ${editingRole.name}` : 'Create new role'} wide>
                <form onSubmit={saveRole} className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <label className="mb-1.5 block text-sm font-semibold">Role key</label>
                            <input className="form-input font-mono" placeholder="e.g. SALES_MANAGER" readOnly={!editingRole} disabled={Boolean(editingRole)} value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} required />
                            <span className="mt-1 block text-xs text-white-dark">{editingRole ? 'Cannot change key after creation' : 'Auto-generated from name'}</span>
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-semibold">Display name</label>
                            <input className="form-input" placeholder="e.g. Sales Manager" value={form.name} onChange={(e) => {
                                const name = e.target.value;
                                const autoKey = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^[^A-Z]+/, '').replace(/_+$/g, '').slice(0, 49);
                                setForm({ ...form, name, key: editingRole ? form.key : autoKey });
                            }} required />
                        </div>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-sm font-semibold">Description</label>
                        <textarea className="form-textarea" placeholder="What can this role do?" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                    </div>

                    {/* Permission picker */}
                    <div>
                        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <label className="text-sm font-semibold">Permissions</label>
                                <span className="ml-2 text-xs text-white-dark">{selected.length} selected</span>
                            </div>
                            <div className="relative max-w-xs">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white-dark" />
                                <input className="form-input py-1.5 pl-8 text-sm" placeholder="Filter permissions..." value={permSearch} onChange={(e) => setPermSearch(e.target.value)} />
                            </div>
                        </div>
                        <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-white-light dark:border-[#191e3a]">
                            {Object.entries(filteredGroups).map(([group, items]) => {
                                const expanded = expandedGroups.has(group);
                                const selectedCount = items.filter((p) => selected.includes(p.id)).length;
                                const allSelected = selectedCount === items.length;
                                return (
                                    <div key={group} className="border-b border-white-light last:border-b-0 dark:border-[#191e3a]">
                                        <div
                                            className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-white-light/50 dark:hover:bg-[#191e3a]/50"
                                            onClick={() => toggleGroup(group)}
                                        >
                                            {expanded ? <ChevronDown size={16} className="shrink-0 text-white-dark" /> : <ChevronRight size={16} className="shrink-0 text-white-dark" />}
                                            <span className="flex-1 font-semibold capitalize">{group.replace(/_/g, ' ')}</span>
                                            <span className={`text-xs ${selectedCount > 0 ? 'font-bold text-primary' : 'text-white-dark'}`}>
                                                {selectedCount}/{items.length}
                                            </span>
                                            <button
                                                type="button"
                                                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${allSelected ? 'bg-primary/10 text-primary' : 'bg-white-light text-white-dark hover:bg-primary/10 hover:text-primary dark:bg-[#191e3a]'}`}
                                                onClick={(e) => { e.stopPropagation(); toggleGroupAll(group, items); }}
                                            >
                                                {allSelected ? 'Deselect all' : 'Select all'}
                                            </button>
                                        </div>
                                        {expanded && (
                                            <div className="grid gap-1 px-4 pb-3 sm:grid-cols-2">
                                                {items.map((permission) => (
                                                    <label key={permission.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white-light/50 dark:hover:bg-[#191e3a]/30">
                                                        <input
                                                            className="form-checkbox text-primary"
                                                            type="checkbox"
                                                            checked={selected.includes(permission.id)}
                                                            onChange={(e) => setSelected(e.target.checked ? [...selected, permission.id] : selected.filter((id) => id !== permission.id))}
                                                        />
                                                        <span>{permission.label || permission.key}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center justify-end gap-3 border-t border-white-light pt-4 dark:border-[#191e3a]">
                        <button type="button" className="btn btn-outline-dark" onClick={closeRoleModal}>Cancel</button>
                        <button type="submit" className="btn btn-primary" disabled={savingRole}>{savingRole ? 'Saving…' : editingRole ? 'Save changes' : 'Create role'}</button>
                    </div>
                </form>
            </Modal>

            {/* ───── Delete confirmation ───── */}
            <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="Delete role">
                <div className="space-y-4">
                    <div className="rounded-lg border border-danger/20 bg-danger/5 p-4">
                        <p className="text-sm">Are you sure you want to delete <strong>"{deleteTarget?.name}"</strong>? Users assigned this role will lose its permissions. This action cannot be undone.</p>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button className="btn btn-outline-dark" onClick={() => setDeleteTarget(null)}>Cancel</button>
                        <button className="btn btn-danger" disabled={savingRole} onClick={confirmDelete}>{savingRole ? 'Deleting…' : 'Delete role'}</button>
                    </div>
                </div>
            </Modal>
        </AppShell>
    );
};

export default RbacPage;
