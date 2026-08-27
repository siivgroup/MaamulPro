import { FormEvent, useState } from 'react';
import { ArrowLeft, KeyRound, LoaderCircle, Mail } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PasswordInput } from '../../components/maamulpro/PageKit';
import { api } from '../../lib/api';

const PasswordRecoveryPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const superAdmin = location.pathname.startsWith('/superadmin');
    const [step, setStep] = useState<'request' | 'reset'>('request');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [working, setWorking] = useState(false);
    const signInPath = superAdmin ? '/superadmin/login' : '/sign-in';

    const request = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        setWorking(true);
        try {
            await api<{ accepted: boolean }>('/api/auth/password/forgot', {
                method: 'POST', body: JSON.stringify({ email }),
            });
            setMessage('If the address belongs to an active account, a reset code has been sent.');
            setStep('reset');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to request reset');
        } finally {
            setWorking(false);
        }
    };

    const reset = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        setWorking(true);
        try {
            const result = await api<{ message?: string }>('/api/auth/password/reset', { method: 'POST', silent: true, body: JSON.stringify({ email, code, newPassword }) });
            navigate(signInPath, { replace: true, state: { message: result.message || 'Password reset. Sign in with your new password.' } });
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to reset password');
        } finally {
            setWorking(false);
        }
    };

    return <div>
        <div className="absolute inset-0"><img alt="" aria-hidden="true" className="h-full w-full object-cover" src="/assets/images/auth/bg-gradient.png" /></div>
        <div className="relative flex min-h-screen items-center justify-center bg-[url(/assets/images/auth/map.png)] bg-cover bg-center bg-no-repeat px-6 py-10 dark:bg-[#060818] sm:px-16">
            <img alt="" aria-hidden="true" className="absolute left-0 top-1/2 h-full max-h-[893px] -translate-y-1/2" src="/assets/images/auth/coming-soon-object1.png" />
            <img alt="" aria-hidden="true" className="absolute left-24 top-0 h-40 md:left-[30%]" src="/assets/images/auth/coming-soon-object2.png" />
            <img alt="" aria-hidden="true" className="absolute right-0 top-0 h-[300px]" src="/assets/images/auth/coming-soon-object3.png" />
            <img alt="" aria-hidden="true" className="absolute bottom-0 end-[28%]" src="/assets/images/auth/polygon-object.svg" />
            <div className="relative flex w-full max-w-[1502px] flex-col justify-between overflow-hidden rounded-md bg-white/60 backdrop-blur-lg dark:bg-black/50 lg:min-h-[758px] lg:flex-row lg:gap-10 xl:gap-0">
                <div className="relative hidden w-full items-center justify-center bg-[linear-gradient(225deg,#0E8B8B_0%,#2A3442_100%)] p-5 lg:inline-flex lg:max-w-[835px] xl:-ms-28 ltr:xl:skew-x-[14deg] rtl:xl:skew-x-[-14deg]">
                    <div className="ltr:xl:-skew-x-[14deg] rtl:xl:skew-x-[-14deg]">
                        <div className="ms-10 flex items-center gap-3">
                            <img alt="MaamulPro" className="h-12 w-12" src="/assets/images/logo.svg" />
                            <span className="text-4xl font-extrabold tracking-wide text-white lg:w-72">MaamulPro</span>
                        </div>
                        <div className="mt-24 hidden w-full max-w-[430px] lg:block"><img alt="" aria-hidden="true" className="w-full" src="/assets/images/auth/login.svg" /></div>
                    </div>
                </div>
                <div className="relative flex w-full flex-col items-center justify-center px-4 py-12 sm:px-6 lg:max-w-[667px]">
                    <div className="w-full max-w-[440px]">
                        <Link className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline" to={signInPath}><ArrowLeft size={16} /> Back to sign in</Link>
                        <div className="mb-10"><span className="mb-4 grid h-11 w-11 place-items-center rounded-md bg-primary text-white"><KeyRound size={21} /></span><h1 className="text-3xl font-extrabold uppercase !leading-snug text-primary md:text-4xl">{step === 'request' ? 'Reset password' : 'Set new password'}</h1><p className="text-base font-bold leading-normal text-white-dark">{step === 'request' ? 'Enter your email and we will send a reset code.' : 'Enter the code and choose a new password.'}</p></div>
                        {message && <div className="mb-5 rounded border border-success/30 bg-success-light px-3 py-2 text-sm text-success">{message}</div>}
                        {error && <div className="mb-5 rounded border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger" role="alert">{error}</div>}
                        {step === 'request' ? <form className="space-y-5 dark:text-white" onSubmit={request}><div><label htmlFor="recovery-email">Email address</label><div className="relative text-white-dark"><input autoComplete="email" className="form-input ps-10 placeholder:text-white-dark" id="recovery-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Enter email address" /><Mail aria-hidden="true" className="absolute start-4 top-1/2 -translate-y-1/2" size={18} /></div></div><button className="btn btn-primary !mt-6 w-full uppercase" disabled={working}>{working ? <><LoaderCircle className="mr-2 animate-spin" size={16} /> Sending code…</> : 'Send reset code'}</button></form>
                            : <form className="space-y-5 dark:text-white" onSubmit={reset}><div><label htmlFor="recovery-email">Email address</label><div className="relative text-white-dark"><input autoComplete="email" className="form-input ps-10 placeholder:text-white-dark" id="recovery-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Enter email address" /><Mail aria-hidden="true" className="absolute start-4 top-1/2 -translate-y-1/2" size={18} /></div></div><div><label htmlFor="reset-code">Six-digit code</label><input className="form-input mt-1 placeholder:text-white-dark" id="reset-code" inputMode="numeric" minLength={6} maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Enter 6-digit code" /></div><div><label htmlFor="new-password">New password</label><PasswordInput autoComplete="new-password" className="form-input ps-10 placeholder:text-white-dark" id="new-password" minLength={6} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Enter new password" startAdornment={<KeyRound aria-hidden="true" className="absolute start-4 top-1/2 -translate-y-1/2 text-white-dark" size={18} />} /><p className="mt-1 text-xs text-white-dark">Minimum 6 characters.</p></div><button className="btn btn-primary !mt-6 w-full uppercase" disabled={working}>{working ? <><LoaderCircle className="mr-2 animate-spin" size={16} /> Resetting password…</> : 'Reset password'}</button><button type="button" className="btn btn-outline-dark w-full" disabled={working} onClick={() => setStep('request')}>Use another email</button></form>}
                    </div>
                    <p className="absolute bottom-6 w-full text-center text-sm dark:text-white">© {new Date().getFullYear()} MaamulPro. All rights reserved.</p>
                </div>
            </div>
        </div>
    </div>;
};

export default PasswordRecoveryPage;
