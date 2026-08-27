import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    AlertTriangle,
    ArrowLeft,
    Boxes,
    Building2,
    CheckCircle2,
    Eye,
    EyeOff,
    Hammer,
    Home,
    KeyRound,
    LoaderCircle,
    Mail,
    User,
} from 'lucide-react';
import AppShell from '../components/maamulpro/AppShell';
import { ErrorAlert, Field, Modal, PasswordInput } from '../components/maamulpro/PageKit';
import { api, ApiError } from '../lib/api';
import OnboardingProgress from '../components/maamulpro/OnboardingProgress';
import { clearOnboardingReference, loadOnboardingReference, saveOnboardingReference } from '../lib/onboarding';

type NeonStatus = { automaticProvisioning: boolean; configurationError?: string };
type CompanyType = 'general' | 'construction' | 'real_estate' | 'material_management';
type ModuleKey = 'constructionEnabled' | 'realEstateEnabled' | 'materialManagementEnabled';

type FormState = {
    companyName: string;
    companySlug: string;
    companyType: CompanyType;
    adminName: string;
    adminEmail: string;
    adminPassword: string;
    dbUrl: string;
};

type ModuleState = Record<ModuleKey, boolean>;

const initialForm: FormState = {
    companyName: '',
    companySlug: '',
    companyType: 'general',
    adminName: '',
    adminEmail: '',
    adminPassword: '',
    dbUrl: '',
};

const initialModules: ModuleState = {
    constructionEnabled: false,
    realEstateEnabled: false,
    materialManagementEnabled: false,
};

const companyTypes: Array<{ value: CompanyType; label: string }> = [
    { value: 'general', label: 'General' },
    { value: 'construction', label: 'Construction' },
    { value: 'real_estate', label: 'Real estate' },
    { value: 'material_management', label: 'Material management' },
];

const moduleChoices: Array<{
    key: ModuleKey;
    title: string;
    description: string;
    icon: typeof Building2;
}> = [
    {
        key: 'constructionEnabled',
        title: 'Construction',
        description: 'Projects, contracts and site operations',
        icon: Hammer,
    },
    {
        key: 'realEstateEnabled',
        title: 'Real estate',
        description: 'Properties, rentals and sales',
        icon: Home,
    },
    {
        key: 'materialManagementEnabled',
        title: 'Materials',
        description: 'Inventory, suppliers and purchases',
        icon: Boxes,
    },
];

const slugify = (value: string) => value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

const validate = (form: FormState, modules: ModuleState, requiresDatabaseUrl: boolean) => {
    const errors: Record<string, string> = {};
    if (form.companyName.trim().length < 2) errors.companyName = 'Enter the company name.';
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(form.companySlug.trim())) {
        errors.companySlug = 'Use 2–63 lowercase letters, numbers and hyphens.';
    }
    if (!Object.values(modules).some(Boolean)) errors.modules = 'Select at least one module.';
    if (form.adminName.trim().length < 2) errors.adminName = 'Enter the owner’s full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail.trim())) errors.adminEmail = 'Enter a valid email address.';
    if (form.adminPassword.length < 6) {
        errors.adminPassword = 'Must be at least 6 characters.';
    }
    if (requiresDatabaseUrl && !/^postgres(?:ql)?:\/\//.test(form.dbUrl.trim())) {
        errors.dbUrl = 'Enter a valid PostgreSQL database URL.';
    }
    return errors;
};

const SectionHeading = ({ number, title, description }: { number: string; title: string; description: string }) => (
    <div>
        <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-light text-sm font-bold text-primary">
                {number}
            </span>
            <h2 className="text-lg font-bold text-black dark:text-white-light">{title}</h2>
        </div>
        <p className="mt-2 max-w-xs text-sm leading-6 text-white-dark">{description}</p>
    </div>
);

const CompanyOnboardingPage = () => {
    const navigate = useNavigate();
    const [form, setForm] = useState<FormState>(initialForm);
    const [modules, setModules] = useState<ModuleState>(initialModules);
    const [slugTouched, setSlugTouched] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [submitError, setSubmitError] = useState('');
    const [saving, setSaving] = useState(false);
    const requestId = useRef(loadOnboardingReference() || crypto.randomUUID());
    const [attemptId, setAttemptId] = useState(loadOnboardingReference);
    const submitting = useRef(false);
    useEffect(() => {
        if (attemptId) navigate(`?onboarding=${attemptId}`, { replace: true });
    }, [attemptId, navigate]);
    const [showPassword, setShowPassword] = useState(false);
    const [neonStatus, setNeonStatus] = useState<NeonStatus | null>(null);
    const [neonChecked, setNeonChecked] = useState(false);
    const [verifiedEmail, setVerifiedEmail] = useState('');
    const [verificationOpen, setVerificationOpen] = useState(false);
    const [verificationCode, setVerificationCode] = useState('');
    const [verificationError, setVerificationError] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [sendingVerification, setSendingVerification] = useState(false);
    useEffect(() => {
        api<NeonStatus>('/api/superadmin/neon/status', { silent: true })
            .then((status) => { setNeonStatus(status); setNeonChecked(true); })
            .catch(() => setSubmitError('Unable to check database setup configuration. Reload this page before submitting.'));
    }, []);

    const automaticNeon = neonStatus?.automaticProvisioning === true;
    const requiresDatabaseUrl = neonChecked && !automaticNeon;

    const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((current) => {
            const next = { ...current, [key]: value };
            if (key === 'companyName' && !slugTouched) next.companySlug = slugify(String(value));
            return next;
        });
        setErrors((current) => {
            const next = { ...current };
            delete next[key];
            return next;
        });
        setSubmitError('');
        if (key === 'adminEmail') setVerifiedEmail('');
    };

    const toggleModule = (key: ModuleKey) => {
        setModules((current) => ({ ...current, [key]: !current[key] }));
        setErrors((current) => {
            const next = { ...current };
            delete next.modules;
            return next;
        });
    };

    const checkEmail = async () => {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail.trim())) return;
        try {
            const result = await api<{ available: boolean; error?: string }>(
                `/api/superadmin/companies/email-availability?email=${encodeURIComponent(form.adminEmail.trim())}`, { silent: true },
            );
            if (!result.available) {
                setErrors((current) => ({
                    ...current,
                    adminEmail: result.error || 'Email is already in use.',
                }));
            }
        } catch (reason) {
            setErrors((current) => ({
                ...current,
                adminEmail: reason instanceof Error ? reason.message : 'Unable to check email.',
            }));
        }
    };

    const requestVerification = async () => {
        setSendingVerification(true);
        try {
            await api<{ sent: boolean }>(
                '/api/superadmin/companies/email-verification/send',
                { method: 'POST', body: JSON.stringify({ email: form.adminEmail.trim() }), silent: true },
            );
            setVerificationCode('');
            setVerificationError('');
            setVerificationOpen(true);
        } finally {
            setSendingVerification(false);
        }
    };

    const verifyEmail = async () => {
        if (!/^\d{6}$/.test(verificationCode)) return;
        setVerifying(true);
        setVerificationError('');
        try {
            await api('/api/superadmin/companies/email-verification/verify', { silent: true,
                method: 'POST',
                body: JSON.stringify({ email: form.adminEmail.trim(), code: verificationCode }),
            });
            setVerifiedEmail(form.adminEmail.trim().toLowerCase());
            setVerificationOpen(false);
        } catch (reason) {
            setVerificationError(reason instanceof Error ? reason.message : 'Verification failed.');
        } finally {
            setVerifying(false);
        }
    };

    const provision = async () => {
        if (submitting.current) return;
        submitting.current = true;
        setSaving(true);
        saveOnboardingReference(requestId.current);
        try {
            const payload = {
                onboardingRequestId: requestId.current,
                name: form.companyName.trim(), subdomain: form.companySlug.trim(), companyType: form.companyType,
                adminName: form.adminName.trim(), adminEmail: form.adminEmail.trim(), adminPassword: form.adminPassword,
                ...(form.dbUrl.trim() ? { dbUrl: form.dbUrl.trim() } : {}), ...modules,
            };
            await api('/api/superadmin/companies', { method: 'POST', body: JSON.stringify(payload), silent: true, signal: AbortSignal.timeout(15000) });
            setAttemptId(requestId.current);
        } catch (reason) {
            if (reason instanceof ApiError && reason.onboardingId) {
                setForm(current => ({ ...current, adminPassword: '' }));
                requestId.current = reason.onboardingId;
                saveOnboardingReference(reason.onboardingId);
                setAttemptId(reason.onboardingId);
            } else if (reason instanceof ApiError && [400, 409, 401, 403].includes(reason.status)) {
                setSubmitError([reason.message, reason.nextAction, reason.requestId && ('Reference: ' + reason.requestId)].filter(Boolean).join(' '));
                clearOnboardingReference(requestId.current);
                requestId.current = crypto.randomUUID();
            } else {
                // An unreadable/lost response is not proof that creation failed.
                setAttemptId(requestId.current);
            }
        } finally { setSaving(false); submitting.current = false; }
    };

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (saving || attemptId || !neonChecked || neonStatus?.configurationError) return;
        const nextErrors = validate(form, modules, requiresDatabaseUrl);
        setErrors(nextErrors);
        setSubmitError('');
        if (Object.keys(nextErrors).length) return;
        if (verifiedEmail !== form.adminEmail.trim().toLowerCase()) {
            try {
                await requestVerification();
            } catch (reason) {
                setErrors((current) => ({
                    ...current,
                    adminEmail: reason instanceof Error ? reason.message : 'Unable to send verification code.',
                }));
            }
            return;
        }
        await provision();
    };

    if (attemptId) return <AppShell><OnboardingProgress id={attemptId} password={form.adminPassword} onMissing={() => setAttemptId('')} /></AppShell>;

    return <AppShell>
        <div className="mx-auto max-w-5xl">
            <Link
                className="mb-4 inline-flex items-center gap-2 text-sm text-white-dark transition hover:text-primary"
                to="/superadmin/companies"
            >
                <ArrowLeft size={16} /> Companies
            </Link>

            <div className="mb-6">
                <h1 className="text-2xl font-bold text-black dark:text-white-light sm:text-3xl">Onboard company</h1>
                <p className="mt-2 text-sm text-white-dark">Create the tenant, choose its modules and add the company owner.</p>
            </div>

            {neonStatus?.configurationError && <div className="mb-5"><ErrorAlert message={neonStatus.configurationError} /></div>}
            {submitError && <div className="mb-5"><ErrorAlert message={submitError} /></div>}

            <form
                className={`panel overflow-hidden p-0 ${saving ? 'pointer-events-none opacity-60' : ''}`}
                onSubmit={submit}
            >
                <section className="grid gap-6 border-b border-white-light p-5 dark:border-dark sm:p-7 lg:grid-cols-[220px_1fr] lg:gap-10">
                    <SectionHeading
                        number="1"
                        title="Company"
                        description="The identity used across the tenant workspace."
                    />
                    <div className="grid gap-5 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <Field label="Company name" required>
                                <div className="relative mt-1">
                                    <Building2 className="absolute left-3 top-3 text-white-dark" size={17} />
                                    <input
                                        className={`form-input pl-10 ${errors.companyName ? 'border-danger' : ''}`}
                                        value={form.companyName}
                                        onChange={(event) => setField('companyName', event.target.value)}
                                        autoFocus
                                    />
                                </div>
                                {errors.companyName && <p className="mt-1 text-xs text-danger">{errors.companyName}</p>}
                            </Field>
                        </div>
                        <Field label="Company type" required>
                            <select
                                className="form-select mt-1"
                                value={form.companyType}
                                onChange={(event) => setField('companyType', event.target.value as CompanyType)}
                            >
                                {companyTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                            </select>
                        </Field>
                        <Field label="Workspace slug" required hint="Generated from the company name.">
                            <input
                                className={`form-input mt-1 ${errors.companySlug ? 'border-danger' : ''}`}
                                value={form.companySlug}
                                onChange={(event) => {
                                    setSlugTouched(true);
                                    setField('companySlug', event.target.value.toLowerCase());
                                }}
                            />
                            {errors.companySlug && <p className="mt-1 text-xs text-danger">{errors.companySlug}</p>}
                        </Field>
                    </div>
                </section>

                <section className="grid gap-6 border-b border-white-light p-5 dark:border-dark sm:p-7 lg:grid-cols-[220px_1fr] lg:gap-10">
                    <SectionHeading
                        number="2"
                        title="Modules"
                        description="Enable only the workspaces this company needs."
                    />
                    <div>
                        <div className="grid gap-3 md:grid-cols-3">
                            {moduleChoices.map(({ key, title, description, icon: Icon }) => {
                                const selected = modules[key];
                                return <button
                                    key={key}
                                    className={`relative rounded-lg border p-4 text-left transition ${
                                        selected
                                            ? 'border-primary bg-primary-light shadow-sm'
                                            : 'border-white-light hover:border-primary/50 dark:border-dark'
                                    }`}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => toggleModule(key)}
                                >
                                    <span className={`mb-3 grid h-9 w-9 place-items-center rounded-md ${
                                        selected ? 'bg-primary text-white' : 'bg-gray-100 text-white-dark dark:bg-dark'
                                    }`}>
                                        <Icon size={18} />
                                    </span>
                                    <strong className={`block text-sm ${selected ? 'text-primary' : 'text-black dark:text-white-light'}`}>
                                        {title}
                                    </strong>
                                    <span className="mt-1 block text-xs leading-5 text-white-dark">{description}</span>
                                    <span className={`absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-full border ${
                                        selected ? 'border-primary bg-primary text-white' : 'border-white-light dark:border-dark'
                                    }`}>
                                        {selected && <CheckCircle2 size={14} />}
                                    </span>
                                </button>;
                            })}
                        </div>
                        {errors.modules && <p className="mt-2 text-xs text-danger">{errors.modules}</p>}
                    </div>
                </section>

                <section className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[220px_1fr] lg:gap-10">
                    <SectionHeading
                        number="3"
                        title="Company owner"
                        description="The first account with full access to the tenant."
                    />
                    <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Full name" required>
                            <div className="relative mt-1">
                                <User className="absolute left-3 top-3 text-white-dark" size={17} />
                                <input
                                    className={`form-input pl-10 ${errors.adminName ? 'border-danger' : ''}`}
                                    value={form.adminName}
                                    onChange={(event) => setField('adminName', event.target.value)}
                                />
                            </div>
                            {errors.adminName && <p className="mt-1 text-xs text-danger">{errors.adminName}</p>}
                        </Field>
                        <Field label="Work email" required>
                            <div className="relative mt-1">
                                <Mail className="absolute left-3 top-3 text-white-dark" size={17} />
                                <input
                                    className={`form-input pl-10 ${errors.adminEmail ? 'border-danger' : ''}`}
                                    type="email"
                                    value={form.adminEmail}
                                    onBlur={checkEmail}
                                    onChange={(event) => setField('adminEmail', event.target.value)}
                                />
                                {verifiedEmail && <CheckCircle2 className="absolute right-3 top-3 text-success" size={17} />}
                            </div>
                            {errors.adminEmail && <p className="mt-1 text-xs text-danger">{errors.adminEmail}</p>}
                            {verifiedEmail && <p className="mt-1 text-xs text-success">Email verified</p>}
                        </Field>
                        <div className="sm:col-span-2">
                            <Field label="Temporary password" required hint="Minimum 6 characters.">
                                <div className="relative mt-1">
                                    <KeyRound className="absolute left-3 top-3 text-white-dark" size={17} />
                                    <input
                                        className={`form-input px-10 ${errors.adminPassword ? 'border-danger' : ''}`}
                                        minLength={6}
                                        type={showPassword ? 'text' : 'password'}
                                        value={form.adminPassword}
                                        onChange={(event) => setField('adminPassword', event.target.value)}
                                    />
                                    <button
                                        className="absolute right-3 top-2.5 text-white-dark hover:text-primary"
                                        type="button"
                                        onClick={() => setShowPassword((value) => !value)}
                                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                                {errors.adminPassword && <p className="mt-1 text-xs text-danger">{errors.adminPassword}</p>}
                            </Field>
                        </div>

                        {requiresDatabaseUrl && <div className="sm:col-span-2">
                            <div className="rounded-lg border border-warning/30 bg-warning-light p-4">
                                <p className="font-semibold text-warning">Manual database connection required</p>
                                <p className="mt-1 text-xs leading-5 text-warning">Automatic Neon provisioning is unavailable. Enter the tenant PostgreSQL URL.</p>
                                <PasswordInput
                                    className={`form-input mt-3 ${errors.dbUrl ? 'border-danger' : ''}`}
                                    value={form.dbUrl}
                                    onChange={(event) => setField('dbUrl', event.target.value)}
                                    autoComplete="off"
                                    aria-label="Tenant PostgreSQL URL"
                                />
                                {errors.dbUrl && <p className="mt-1 text-xs text-danger">{errors.dbUrl}</p>}
                            </div>
                        </div>}
                    </div>
                </section>

                <footer className="flex flex-col gap-4 border-t border-white-light bg-gray-50 px-5 py-4 dark:border-dark dark:bg-black/10 sm:flex-row sm:items-center sm:justify-between sm:px-7">
                    <p className="text-xs text-white-dark">
                        {automaticNeon ? 'The tenant database will be provisioned automatically.' : 'Company details and billing can be added after onboarding.'}
                    </p>
                    <div className="flex items-center gap-3">
                        <Link className="btn btn-outline-dark" to="/superadmin/companies">Cancel</Link>
                        <button className="btn btn-primary min-w-40" disabled={saving || sendingVerification || !neonChecked || Boolean(neonStatus?.configurationError)}>
                            {saving ? 'Creating company…' : sendingVerification ? <><LoaderCircle className="mr-2 animate-spin" size={16} /> Sending verification…</> : verifiedEmail ? 'Create company' : 'Verify & create'}
                        </button>
                    </div>
                </footer>
            </form>
        </div>

        <Modal title="Verify company owner email" open={verificationOpen} onClose={() => setVerificationOpen(false)}>
            <p className="text-sm text-white-dark">Enter the 6-digit code sent to <strong>{form.adminEmail}</strong>.</p>
            {verificationError && <div className="mt-4 rounded-md bg-danger-light p-3 text-sm text-danger">{verificationError}</div>}
            <input
                className="form-input mx-auto mt-5 max-w-xs text-center text-xl font-bold tracking-[0.35em]"
                inputMode="numeric"
                maxLength={6}
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(event) => event.key === 'Enter' && verifyEmail()}
                placeholder="6-digit code"
            />
            <div className="mt-5 flex justify-end gap-2">
                <button className="btn btn-outline-dark" type="button" onClick={() => setVerificationOpen(false)}>Cancel</button>
                <button
                    className="btn btn-primary"
                    type="button"
                    disabled={verifying || verificationCode.length !== 6}
                    onClick={verifyEmail}
                >
                    {verifying ? 'Verifying…' : 'Verify email'}
                </button>
            </div>
        </Modal>


    </AppShell>;
};

export default CompanyOnboardingPage;
