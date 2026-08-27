import { FormEvent, useEffect, useRef, useState } from 'react';
import { BookOpen, Building2, CreditCard, KeyRound, LoaderCircle, Palette, Tags, UserRound } from 'lucide-react';
import ChangeEmailForm from '../components/maamulpro/ChangeEmailForm';
import AppShell from '../components/maamulpro/AppShell';
import { AuthenticatedImage } from '../components/maamulpro/AuthenticatedImage';
import { api, sessionStore } from '../lib/api';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorAlert, Field, LoadingState, PageHeader, PasswordInput, SuccessAlert } from '../components/maamulpro/PageKit';
import AccountMappingsSection from '../components/accounting/AccountMappingsSection';

type Settings = { companyName: string; logoUrl?: string; companyEmail: string; companyPhone: string; companyAddress: string; companyDescription: string; automaticRentInvoices: boolean; automaticPayrollDrafts: boolean; subdomain?: string; constructionEnabled: boolean; realEstateEnabled: boolean; materialManagementEnabled: boolean; entitlements?: { features: Record<string, boolean>; limits: Record<string, number> }; usage?: Record<string, number> };
type Profile = { name: string; email: string; avatarUrl?: string; language: string; role: string };

const OWNER_ROLES = ['SUPER_ADMIN', 'COMPANY_OWNER'];
const OWNER_SECTIONS = new Set(['company', 'categories', 'accounting', 'billing']);

const settingSections = [
    { id: 'company', label: 'Company', icon: Building2 },
    { id: 'account', label: 'My account', icon: UserRound },
    { id: 'security', label: 'Security', icon: KeyRound },
    { id: 'preferences', label: 'Preferences', icon: Palette },
    { id: 'categories', label: 'Categories', icon: Tags },
    { id: 'accounting', label: 'Account mappings', icon: BookOpen },
    { id: 'billing', label: 'Subscription', icon: CreditCard },
] as const;
type Section = (typeof settingSections)[number]['id'];

const SettingsPage = () => {
    const navigate = useNavigate();
    const session = sessionStore.get();
    const isOwner = Boolean(session?.user.isSuperAdmin || OWNER_ROLES.includes(session?.user.role || ''));
    const visibleSections = settingSections.filter((s) => isOwner || !OWNER_SECTIONS.has(s.id));
    const [settings, setSettings] = useState<Settings | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [activeSection, setActiveSection] = useState<Section>(isOwner ? 'company' : 'account');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [uploading, setUploading] = useState('');
    const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [preferences, setPreferences] = useState(() => {
        try { return JSON.parse(localStorage.getItem('maamulpro.preferences') || '{"emailNotifications":true,"reportNotifications":true,"compactTables":false}'); } catch { return { emailNotifications: true, reportNotifications: true, compactTables: false }; }
    });

    const load = () => Promise.all([api<Settings>('/api/settings'), api<Profile>('/api/settings/profile')]).then(([company, user]) => {
        setSettings(company);
        setProfile(user);
    }).catch((reason) => setError(reason.message));
    useEffect(() => { load(); }, []);

    const uploadImage = async (file: File | undefined, folder: 'branding' | 'avatars', target: 'logoUrl' | 'avatarUrl') => {
        if (!file) return;
        setUploading(target); setError('');
        try { const data = new FormData(); data.append('file', file); const result = await api<{ url: string }>(`/api/uploads/images?folder=${folder}`, { method: 'POST', body: data }); if (target === 'logoUrl') setSettings((current) => current ? { ...current, logoUrl: result.url } : current); else setProfile((current) => current ? { ...current, avatarUrl: result.url } : current); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to upload image'); }
        finally { setUploading(''); }
    };
    const save = async (event: FormEvent, type: 'company' | 'profile' | 'password') => {
        event.preventDefault(); setMessage(''); setError('');
        if (savingRef.current) return;
        savingRef.current = true; setSaving(true);
        try {
            if (type === 'company' && settings) { const { companyName, logoUrl, companyEmail, companyPhone, companyAddress, companyDescription, automaticRentInvoices, automaticPayrollDrafts } = settings; await api('/api/settings', { method: 'PATCH', silent: true, body: JSON.stringify({ companyName, logoUrl, companyEmail, companyPhone, companyAddress, companyDescription, automaticRentInvoices, automaticPayrollDrafts }) }); }
            else if (type === 'profile' && profile) { await api('/api/settings/profile', { method: 'PATCH', silent: true, body: JSON.stringify({ name: profile.name, avatarUrl: profile.avatarUrl }) }); await api('/api/settings/language', { method: 'PATCH', silent: true, body: JSON.stringify({ language: profile.language }) }); }
            else {
                const result = await api<{ message: string }>('/api/settings/password', { method: 'PATCH', silent: true, body: JSON.stringify(passwords) });
                setPasswords({ currentPassword: '', newPassword: '' });
                sessionStore.clear();
                navigate('/sign-in', {
                    replace: true,
                    state: { message: result.message || 'Password updated. Sign in again on this device.' },
                });
                return;
            }
            setMessage('Changes saved successfully.');
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save changes'); }
        finally { savingRef.current = false; setSaving(false); }
    };
    const savePreferences = () => { localStorage.setItem('maamulpro.preferences', JSON.stringify(preferences)); setMessage('Preferences saved successfully.'); };

    return <AppShell>
        <PageHeader eyebrow="Configuration" title="Company & Account Settings" description="Manage company branding, account details, preferences, and workspace access." />
        {message && <SuccessAlert message={message} onDismiss={() => setMessage('')} />}{error && <ErrorAlert message={error} onRetry={load} />}
        <div className="panel overflow-hidden p-0">
            <div className="flex min-h-[620px] items-stretch">
                <aside className="w-64 shrink-0 border-r border-white-light bg-gray-50/50 p-4 dark:border-dark dark:bg-[#0e1726]"><div className="mb-5 px-3"><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Settings</p><p className="mt-1 text-sm text-white-dark">Company and personal controls</p></div><nav className="flex flex-col gap-1" aria-label="Settings navigation">{visibleSections.map((section) => { const Icon = section.icon; return <button key={section.id} disabled={saving} type="button" onClick={() => setActiveSection(section.id)} className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-semibold transition ${activeSection === section.id ? 'bg-primary-light text-primary' : 'text-white-dark hover:bg-white dark:hover:bg-black'}`} aria-current={activeSection === section.id ? 'page' : undefined}><Icon size={18} />{section.label}</button>; })}</nav></aside>
                <main className="min-w-0 flex-1 p-5 sm:p-7"><fieldset disabled={saving} aria-busy={saving}>
                    {saving && <p role="status" className="mb-4 flex items-center gap-2"><LoaderCircle className="animate-spin" size={16} />Saving changes…</p>}
                    {activeSection === 'company' && isOwner && <form className="max-w-3xl space-y-5" onSubmit={(event) => save(event, 'company')}><div><h2 className="text-2xl font-extrabold">Company profile</h2><p className="mt-1 text-sm text-white-dark">Set the public company identity and contact information used across the workspace.</p></div>{!settings ? <LoadingState /> : <><Field label="Company logo"><div className="mt-2 flex items-center gap-3">{settings.logoUrl && <img src={settings.logoUrl} className="h-20 w-20 rounded-lg border border-white-light object-contain p-1 dark:border-dark" alt="Company logo" />}<input className="form-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading === 'logoUrl'} onChange={(event) => uploadImage(event.target.files?.[0], 'branding', 'logoUrl')} /></div></Field>{uploading === 'logoUrl' && <p className="text-xs text-primary">Uploading…</p>}<div className="grid gap-5 sm:grid-cols-2"><Field label="Company name" required><input className="form-input mt-1" required value={settings.companyName || ''} onChange={(event) => setSettings({ ...settings, companyName: event.target.value })} /></Field><Field label="Company email"><input className="form-input mt-1" type="email" value={settings.companyEmail || ''} onChange={(event) => setSettings({ ...settings, companyEmail: event.target.value })} /></Field><Field label="Company phone"><input className="form-input mt-1" value={settings.companyPhone || ''} onChange={(event) => setSettings({ ...settings, companyPhone: event.target.value })} /></Field><Field label="Company address"><input className="form-input mt-1" value={settings.companyAddress || ''} onChange={(event) => setSettings({ ...settings, companyAddress: event.target.value })} /></Field></div><Field label="Description"><textarea className="form-textarea mt-1" value={settings.companyDescription || ''} onChange={(event) => setSettings({ ...settings, companyDescription: event.target.value })} /></Field><div className="grid gap-3 sm:grid-cols-2"><label className="flex items-center justify-between gap-3 rounded-md bg-gray-50 p-4 dark:bg-dark"><span><strong className="block">Automatic rent invoices</strong><small className="text-white-dark">Create missing monthly invoices safely.</small></span><input className="form-checkbox" type="checkbox" checked={settings.automaticRentInvoices} onChange={(event) => setSettings({ ...settings, automaticRentInvoices: event.target.checked })} /></label><label className="flex items-center justify-between gap-3 rounded-md bg-gray-50 p-4 dark:bg-dark"><span><strong className="block">Automatic payroll drafts</strong><small className="text-white-dark">Prepare one draft per month from active staff.</small></span><input className="form-checkbox" type="checkbox" checked={settings.automaticPayrollDrafts} onChange={(event) => setSettings({ ...settings, automaticPayrollDrafts: event.target.checked })} /></label></div><div className="flex flex-wrap gap-2">{(['constructionEnabled', 'realEstateEnabled', 'materialManagementEnabled'] as const).map((field) => <span className={`badge ${settings[field] ? 'bg-success' : 'bg-dark'} text-white`} key={field}>{field.replace('Enabled', '')}: {settings[field] ? 'Enabled' : 'Disabled'}</span>)}</div><button className="btn btn-primary">Save company settings</button></>}</form>}
                    {activeSection === 'account' && <form className="max-w-3xl space-y-5" onSubmit={(event) => save(event, 'profile')}><div><h2 className="text-2xl font-extrabold">My account</h2><p className="mt-1 text-sm text-white-dark">Update your profile, avatar, and language. Change your login email separately below.</p></div>{!profile ? <LoadingState /> : <><Field label="Profile photo"><div className="mt-2 flex items-center gap-3">{profile.avatarUrl && <AuthenticatedImage src={profile.avatarUrl} className="h-20 w-20 rounded-full border border-white-light object-cover dark:border-dark" alt="Profile" />}<input className="form-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading === 'avatarUrl'} onChange={(event) => uploadImage(event.target.files?.[0], 'avatars', 'avatarUrl')} /></div></Field>{uploading === 'avatarUrl' && <p className="text-xs text-primary">Uploading…</p>}<div className="grid gap-5 sm:grid-cols-2"><Field label="Name" required><input className="form-input mt-1" required value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></Field><Field label="Login email"><input className="form-input mt-1" type="email" readOnly value={profile.email} /></Field><Field label="Language"><select className="form-select mt-1" value={profile.language} onChange={(event) => setProfile({ ...profile, language: event.target.value })}><option value="en">English</option><option value="so">Somali</option></select></Field></div><button className="btn btn-primary">Save profile</button></>}</form>}
                    {activeSection === 'account' && profile && !session?.user.isImpersonating && <div className="mt-6 max-w-3xl"><ChangeEmailForm currentEmail={profile.email} /></div>}
                    {activeSection === 'security' && !session?.user.isImpersonating && <form className="max-w-xl space-y-5" onSubmit={(event) => save(event, 'password')}><div><h2 className="text-2xl font-extrabold">Security</h2><p className="mt-1 text-sm text-white-dark">Set a new password for your account.</p></div><Field label="Current password" required><PasswordInput autoComplete="current-password" className="form-input mt-1" required value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} /></Field><Field label="New password" required hint="Minimum 6 characters."><PasswordInput autoComplete="new-password" className="form-input mt-1" minLength={6} required value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} /></Field><button className="btn btn-danger">Update password</button></form>}
                    {activeSection === 'preferences' && <div className="max-w-2xl space-y-5"><div><h2 className="text-2xl font-extrabold">Appearance & notifications</h2><p className="mt-1 text-sm text-white-dark">Display preferences are stored for this browser. Security emails are always sent; report delivery is controlled by report schedules.</p></div><div className="space-y-3">{([['compactTables', 'Compact data tables']] as const).map(([key, label]) => <label className="flex items-center justify-between gap-3 rounded-md bg-gray-50 p-4 dark:bg-dark" key={key}><span>{label}</span><input className="form-checkbox" type="checkbox" checked={Boolean(preferences[key])} onChange={(event) => setPreferences({ ...preferences, [key]: event.target.checked })} /></label>)}</div><button className="btn btn-primary" onClick={savePreferences}>Save preferences</button></div>}
                    {activeSection === 'categories' && isOwner && <div className="max-w-2xl"><h2 className="text-2xl font-extrabold">Transaction categories</h2><p className="mt-1 text-sm text-white-dark">Manage the classifications available on income and expense forms.</p><Link className="btn btn-outline-primary mt-5" to="/app/financials/categories">Manage categories</Link></div>}
                    {activeSection === 'accounting' && isOwner && <AccountMappingsSection />}
                    {activeSection === 'billing' && isOwner && <div className="max-w-3xl"><h2 className="text-2xl font-extrabold">Workspace subscription</h2><p className="mt-1 text-sm text-white-dark">Modules and capacity are controlled by your MaamulPro plan.</p>{!settings ? <LoadingState /> : <div className="mt-6 space-y-4"><div className="grid gap-3 sm:grid-cols-2">{Object.entries(settings.entitlements?.features || {}).map(([key, enabled]) => <div className="flex items-center justify-between rounded-md bg-gray-50 p-4 dark:bg-dark" key={key}><span>{key.replace(/([A-Z])/g, ' $1')}</span><span className={`badge ${enabled ? 'bg-success' : 'bg-dark'} text-white`}>{enabled ? 'Enabled' : 'Not included'}</span></div>)}</div><h3 className="pt-3 text-lg font-bold">Capacity usage</h3>{Object.entries(settings.entitlements?.limits || {}).map(([key, limit]) => <div className="rounded-md bg-gray-50 p-4 dark:bg-dark" key={key}><div className="flex justify-between gap-4"><span>{key.replace(/([A-Z])/g, ' $1')}</span><strong>{settings.usage?.[key] || 0} / {Number(limit) === 0 ? 'Unlimited' : limit}</strong></div>{Number(limit) > 0 && <div className="mt-3 h-2 rounded-full bg-gray-200 dark:bg-black"><div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, ((settings.usage?.[key] || 0) / Number(limit)) * 100)}%` }} /></div>}</div>)}</div>}</div>}
                </fieldset></main>
            </div>
        </div>
    </AppShell>;
};

export default SettingsPage;
