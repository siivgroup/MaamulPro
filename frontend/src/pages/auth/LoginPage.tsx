import { FormEvent, useState } from 'react';
import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, Session, sessionStore } from '../../lib/api';
import { hostKind } from '../../lib/tenant-domain';

const LANDING_BY_PERMISSION: { permission: string; route: string }[] = [
    { permission: 'dashboard.executive.read', route: '/app/dashboard' },
    { permission: 'workspace.construction.read', route: '/app/construction/overview' },
    { permission: 'workspace.real_estate.read', route: '/app/real-estate/overview' },
    { permission: 'workspace.material_management.read', route: '/app/materials/overview' },
    { permission: 'financials.read', route: '/app/financials' },
    { permission: 'payroll.read', route: '/app/payroll' },
];

function resolveLanding(session: Session): string {
    const user = session.user;
    if (user.isSuperAdmin) return '/superadmin/dashboard';
    if (['SUPER_ADMIN', 'COMPANY_OWNER'].includes(user.role)) return '/app/dashboard';
    const granted = new Set(user.permissions || []);
    const match = LANDING_BY_PERMISSION.find((entry) => granted.has(entry.permission));
    return match?.route || '/app/no-access';
}

const LoginPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const kind = hostKind(window.location.hostname);
    const pathIsSuperAdmin = location.pathname.startsWith('/superadmin');
    const superAdmin = kind === 'platform' || (kind === 'dev' && pathIsSuperAdmin);
    const successMessage = (location.state as { message?: string } | null)?.message;
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    if (kind === 'tenant' && pathIsSuperAdmin) return <Navigate to="/sign-in" replace />;

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        setLoading(true);
        try {
            const session = await api<Session>(superAdmin ? '/api/auth/superadmin/login' : '/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
            sessionStore.set(session, rememberMe);
            navigate(superAdmin ? '/superadmin/dashboard' : resolveLanding(session), { replace: true });
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Sign in failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div>
            <div className="absolute inset-0"><img alt="" aria-hidden="true" className="h-full w-full object-cover" src="/assets/images/auth/bg-gradient.png" /></div>
            <div className="relative flex min-h-screen items-center justify-center bg-[url(/assets/images/auth/map.png)] bg-cover bg-center bg-no-repeat px-6 py-10 dark:bg-[#060818] sm:px-16">
                <img alt="" aria-hidden="true" className="absolute left-0 top-1/2 h-full max-h-[893px] -translate-y-1/2" src="/assets/images/auth/coming-soon-object1.png" style={{ filter: 'sepia(1) hue-rotate(150deg) saturate(3) brightness(0.65)' }} />
                <img alt="" aria-hidden="true" className="absolute left-24 top-0 h-40 md:left-[30%]" src="/assets/images/auth/coming-soon-object2.png" style={{ filter: 'sepia(1) hue-rotate(150deg) saturate(3) brightness(0.65)' }} />
                <img alt="" aria-hidden="true" className="absolute right-0 top-0 h-[300px]" src="/assets/images/auth/coming-soon-object3.png" style={{ filter: 'sepia(1) hue-rotate(150deg) saturate(3) brightness(0.65)' }} />
                <img alt="" aria-hidden="true" className="absolute bottom-0 end-[28%]" src="/assets/images/auth/polygon-object.svg" />
                <div className="relative flex w-full max-w-[1502px] flex-col justify-between overflow-hidden rounded-md bg-white/60 backdrop-blur-lg dark:bg-black/50 lg:min-h-[758px] lg:flex-row lg:gap-10 xl:gap-0">
                    <div className="relative hidden w-full items-center justify-center bg-[linear-gradient(225deg,#0E8B8B_0%,#2A3442_100%)] p-5 lg:inline-flex lg:max-w-[835px] xl:-ms-28 ltr:xl:skew-x-[14deg] rtl:xl:skew-x-[-14deg]">
                        <div className="absolute inset-y-0 w-8 from-primary/10 via-transparent to-transparent ltr:-right-10 ltr:bg-gradient-to-r rtl:-left-10 rtl:bg-gradient-to-l xl:w-16 ltr:xl:-right-20 rtl:xl:-left-20" />
                        <div className="ltr:xl:-skew-x-[14deg] rtl:xl:skew-x-[14deg]">
                            <div className="ms-10 inline-flex items-center gap-3 rounded-2xl bg-white px-5 py-3">
                                <img alt="MaamulPro" className="h-12 w-12" src="/assets/images/logo.svg" />
                                <span className="text-4xl font-extrabold tracking-wide text-primary lg:w-72">MaamulPro</span>
                            </div>
                            <div className="mt-24 hidden w-full max-w-[430px] lg:block"><img alt="" aria-hidden="true" className="w-full" src="/assets/images/auth/login.svg" /></div>
                        </div>
                    </div>
                    <div className="relative flex w-full flex-col items-center justify-center gap-6 px-4 pb-16 pt-6 sm:px-6 lg:max-w-[667px]">
                        <div className="flex w-full max-w-[440px] items-center gap-2 lg:absolute lg:end-6 lg:top-6 lg:max-w-full">
                            <img alt="MaamulPro" className="h-8 w-8 lg:hidden" src="/assets/images/logo.svg" />
                            <span className="block text-2xl font-extrabold tracking-wide text-primary lg:hidden">MaamulPro</span>
                        </div>
                        <div className="w-full max-w-[440px] lg:mt-16">
                            <div className="mb-10">
                                <h1 className="text-3xl font-extrabold uppercase !leading-snug text-primary md:text-4xl">{superAdmin ? 'Platform sign in' : 'Sign in'}</h1>
                                <p className="text-base font-bold leading-normal text-white-dark">Enter your email and password to login</p>
                            </div>
                            <form className="space-y-5 dark:text-white" onSubmit={submit}>
                                <div>
                                    <label htmlFor="email">Email</label>
                                    <div className="relative text-white-dark">
                                        <input autoComplete="email" className="form-input ps-10 placeholder:text-white-dark" id="email" onChange={(event) => setEmail(event.target.value)} placeholder="Enter Email" required type="email" value={email} />
                                        <Mail aria-hidden="true" className="absolute start-4 top-1/2 -translate-y-1/2" size={18} strokeWidth={2} />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between gap-3"><label htmlFor="password">Password</label><Link className="text-xs font-semibold text-primary hover:underline" to={superAdmin ? '/superadmin/forgot-password' : '/forgot-password'}>Forgot password?</Link></div>
                                    <div className="relative text-white-dark">
                                        <input autoComplete="current-password" className="form-input ps-10 placeholder:text-white-dark" id="password" onChange={(event) => setPassword(event.target.value)} placeholder="Enter Password" required type={showPassword ? 'text' : 'password'} value={password} />
                                        <LockKeyhole aria-hidden="true" className="absolute start-4 top-1/2 -translate-y-1/2" size={18} strokeWidth={2} />
                                        <button aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute end-4 top-1/2 -translate-y-1/2 transition hover:text-primary" onClick={() => setShowPassword((visible) => !visible)} type="button">{showPassword ? <EyeOff size={18} strokeWidth={2} /> : <Eye size={18} strokeWidth={2} />}</button>
                                    </div>
                                </div>
                                {successMessage && <div className="rounded border border-success/30 bg-success-light px-3 py-2 text-sm text-success" role="status">{successMessage}</div>}
                                {error && <div className="rounded border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger" role="alert">{error}</div>}
                                <div><label className="flex cursor-pointer items-center"><input checked={rememberMe} className="form-checkbox bg-white dark:bg-black" onChange={(event) => setRememberMe(event.target.checked)} type="checkbox" /><span className="text-white-dark">Remember me on this device</span></label></div>
                                <button className="btn btn-primary !mt-6 w-full uppercase" disabled={loading} type="submit">{loading ? 'Signing in…' : 'Sign in'}</button>
                            </form>
                        </div>
                        <p className="absolute bottom-6 w-full text-center dark:text-white">© {new Date().getFullYear()} MaamulPro. All rights reserved.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
