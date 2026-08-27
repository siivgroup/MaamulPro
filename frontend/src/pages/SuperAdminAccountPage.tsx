import { FormEvent, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/maamulpro/AppShell';
import { ErrorAlert, Field, LoadingState, PageHeader, shortDate } from '../components/maamulpro/PageKit';
import { api, sessionStore } from '../lib/api';
import ChangeEmailForm from '../components/maamulpro/ChangeEmailForm';

const SuperAdminAccountPage = () => {
    const navigate = useNavigate();
    const [account, setAccount] = useState<any>(null);
    const [password, setPassword] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [working, setWorking] = useState('');
    const pending = useRef(false);
    const [showPasswords, setShowPasswords] = useState(false);

    const load = () => api<any>('/api/superadmin/account')
        .then((row) => {
            setAccount(row);
        })
        .catch((reason) => setError(reason.message));

    useEffect(() => { load(); }, []);

    const updatePassword = async (event: FormEvent) => {
        event.preventDefault();
        if (pending.current) return;
        setError('');
        setMessage('');
        if (password.newPassword !== password.confirmPassword) {
            setError('Passwords do not match.');
            return;
        }
        pending.current = true;
        setWorking('password');
        try {
            const result = await api<{ message: string }>('/api/superadmin/account/password', {
                method: 'PATCH', silent: true,
                body: JSON.stringify({ currentPassword: password.currentPassword, newPassword: password.newPassword }),
            });
            setPassword({ currentPassword: '', newPassword: '', confirmPassword: '' });
            sessionStore.clear();
            navigate('/superadmin/login', {
                replace: true,
                state: { message: result.message || 'Password updated. Sign in again on this device.' },
            });
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Password update failed.');
        } finally {
            pending.current = false; setWorking('');
        }
    };

    return <AppShell>
        <PageHeader eyebrow="Platform security" title="Administrator account" description="Manage the internal administrator sign-in identity and password." />
        {error && <ErrorAlert message={error} />}
        {message && <div className="mb-5 rounded-md bg-success-light p-4 text-success">{message}</div>}
        {!account ? <div className="panel"><LoadingState /></div> : <div className="grid gap-6 xl:grid-cols-2">
            <section className="panel">
                <h2 className="flex items-center gap-2 text-lg font-bold"><ShieldCheck className="text-primary" size={20} /> Account profile</h2>
                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div><dt className="text-xs uppercase text-white-dark">Name</dt><dd className="font-bold">{account.name}</dd></div>
                    <div><dt className="text-xs uppercase text-white-dark">Role</dt><dd className="font-bold">Super Admin</dd></div>
                    <div><dt className="text-xs uppercase text-white-dark">Email</dt><dd>{account.email}</dd></div>
                    <div><dt className="text-xs uppercase text-white-dark">Created</dt><dd>{shortDate(account.createdAt)}</dd></div>
                    <div><dt className="text-xs uppercase text-white-dark">Last sign in</dt><dd>{shortDate(account.lastLoginAt)}</dd></div>
                    <div><dt className="text-xs uppercase text-white-dark">Password changed</dt><dd>{shortDate(account.passwordResetAt)}</dd></div>
                </dl>
            </section>

            <fieldset disabled={Boolean(working)}><ChangeEmailForm currentEmail={account.email} administrator /></fieldset>

            <form className="panel space-y-4 xl:col-span-2" onSubmit={updatePassword}>
                <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-bold">Change password</h2><p className="mt-1 text-sm text-white-dark">Minimum 6 characters.</p></div><button className="text-white-dark hover:text-primary" type="button" onClick={() => setShowPasswords((value) => !value)}>{showPasswords ? <EyeOff size={19} /> : <Eye size={19} />}</button></div>
                <fieldset disabled={Boolean(working)} className="grid gap-4 md:grid-cols-3">
                    <Field label="Current password" required><input className="form-input mt-1" type={showPasswords ? 'text' : 'password'} required value={password.currentPassword} onChange={(event) => setPassword({ ...password, currentPassword: event.target.value })} /></Field>
                    <Field label="New password" required><input className="form-input mt-1" type={showPasswords ? 'text' : 'password'} minLength={6} required value={password.newPassword} onChange={(event) => setPassword({ ...password, newPassword: event.target.value })} /></Field>
                    <Field label="Confirm password" required><input className="form-input mt-1" type={showPasswords ? 'text' : 'password'} minLength={6} required value={password.confirmPassword} onChange={(event) => setPassword({ ...password, confirmPassword: event.target.value })} /></Field>
                </fieldset>
                <button className="btn btn-primary" disabled={working === 'password'}>{working === 'password' ? 'Updating…' : 'Update password'}</button>
            </form>
        </div>}


    </AppShell>;
};

export default SuperAdminAccountPage;
