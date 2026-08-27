import { FormEvent, useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, sessionStore } from '../../lib/api';
import { ErrorAlert, PasswordInput } from './PageKit';

export default function ChangeEmailForm({ currentEmail, administrator = false }: { currentEmail: string; administrator?: boolean }) {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [expiresAt, setExpiresAt] = useState('');
    const [resendAt, setResendAt] = useState(0);
    const [now, setNow] = useState(Date.now());
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const [error, setError] = useState('');
    useEffect(() => {
        if (!expiresAt) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [expiresAt]);
    const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
    const expired = Boolean(expiresAt && new Date(expiresAt).getTime() <= now);
    const prefix = administrator ? '/api/superadmin/account' : '/api/settings';
    const send = async () => {
        if (pending.current || remaining) return;
        pending.current = true; setBusy(true); setError('');
        try {
            const result = await api<{ sent: boolean; expiresAt: string; cooldownSeconds: number }>(`${prefix}/${administrator ? 'email-verification/send' : 'email/verification'}`, {
                method: 'POST', silent: true, body: JSON.stringify({ email, currentPassword: password }),
            });
            if (!result?.sent || !Number.isFinite(Date.parse(result.expiresAt)) || !Number.isFinite(result.cooldownSeconds)) throw new Error('Unable to confirm the verification request. Please try again.');
            setExpiresAt(result.expiresAt); setResendAt(Date.now() + result.cooldownSeconds * 1000); setNow(Date.now()); setCode('');
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to send verification code.'); }
        finally { pending.current = false; setBusy(false); }
    };
    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!expiresAt) return send();
        if (pending.current || expired) return;
        pending.current = true; setBusy(true); setError('');
        try {
            const result = await api<{ updated: boolean; message: string }>(`${prefix}/email`, { method: 'PATCH', silent: true, body: JSON.stringify({ email, currentPassword: password, verificationCode: code }) });
            if (!result?.updated) throw new Error('Unable to confirm the email change. Sign in again to check your account.');
            setPassword(''); setCode(''); sessionStore.clear();
            navigate(administrator ? '/superadmin/login' : '/sign-in', { replace: true, state: { message: result.message || 'Login email updated. Sign in again.' } });
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to change email.'); }
        finally { pending.current = false; setBusy(false); }
    };
    return <form className="panel space-y-4" onSubmit={submit} aria-busy={busy}>
        <h2 className="text-lg font-bold">Change login email</h2>
        <p className="text-sm text-white-dark">Your current address is <strong>{currentEmail}</strong>. The new address must be verified before it can be used to sign in.</p>
        {error && <ErrorAlert message={error} />}
        <label className="block">New email<input className="form-input mt-1" type="email" autoComplete="email" maxLength={254} required disabled={busy || Boolean(expiresAt)} value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="block">Current password<PasswordInput className="form-input mt-1" autoComplete="current-password" maxLength={200} required disabled={busy || Boolean(expiresAt)} value={password} onChange={event => setPassword(event.target.value)} /></label>
        {expiresAt && <>
            <p role="status" className="text-sm">{expired ? 'This code has expired. Request another code.' : `Code sent to ${email}. Expires ${new Date(expiresAt).toLocaleTimeString()}.`}</p>
            <label className="block">Six-digit verification code<input className="form-input mt-1 tracking-widest" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required disabled={busy || expired} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
        </>}
        <div className="flex flex-wrap gap-3">
            <button className="btn btn-primary" disabled={busy || (expiresAt ? expired || code.length !== 6 : !email || email.trim().toLowerCase() === currentEmail.toLowerCase())}>
                {busy && <LoaderCircle aria-hidden="true" className="mr-2 animate-spin" size={16} />}{busy ? 'Working…' : expiresAt ? 'Verify and update email' : 'Send verification code'}
            </button>
            {expiresAt && <><button type="button" className="btn btn-outline-primary" disabled={busy || remaining > 0} onClick={send}>{remaining ? `Resend in ${remaining}s` : 'Resend code'}</button><button type="button" className="btn btn-outline-dark" disabled={busy} onClick={() => { setExpiresAt(''); setCode(''); setPassword(''); setResendAt(0); setError(''); }}>Use another email</button></>}
        </div>
    </form>;
}
