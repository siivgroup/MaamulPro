import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { clearOnboardingReference, onboardingStages, onboardingStatusLabels, OnboardingStatus, parseOnboardingStatus } from '../../lib/onboarding';

export default function OnboardingProgress({ id, password, onMissing }: { id: string; password?: string; onMissing?: () => void }) {
    const [setup, setSetup] = useState<OnboardingStatus | null>(null);
    const [statusError, setStatusError] = useState('');
    const [missing, setMissing] = useState(false);
    const [retrying, setRetrying] = useState(false);
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        let abort = new AbortController();
        const poll = async () => {
            abort = new AbortController();
            const requestTimeout = setTimeout(() => abort.abort(), 15000);
            let finished = false;
            try {
                const row = parseOnboardingStatus(await api(`/api/superadmin/onboarding/${id}`, { silent: true, signal: abort.signal }), id);
                if (stopped) return;
                setSetup(row); setStatusError(''); setMissing(false);
                finished = ['SUCCEEDED', 'CANCELLED', 'FAILED', 'NEEDS_REVIEW', 'DELETING'].includes(row.status);
                if (row.status === 'SUCCEEDED') clearOnboardingReference(id);
            } catch (error) {
                if (stopped) return;
                const notFound = error instanceof ApiError && error.status === 404;
                setMissing(notFound);
                setStatusError(notFound ? 'No saved setup was found yet. The request may still be arriving. Resend only with this same reference.' : 'Unable to check setup status. The saved setup may still be running.');
            } finally { clearTimeout(requestTimeout); if (!stopped && !finished) timer = setTimeout(poll, 3000); }
        };
        void poll();
        return () => { stopped = true; abort.abort(); clearTimeout(timer); };
    }, [id, refresh]);
    const retry = async () => {
        setRetrying(true);
        try {
            setSetup(parseOnboardingStatus(await api(`/api/superadmin/onboarding/${id}/retry`, { method: 'POST', silent: true, signal: AbortSignal.timeout(15000) }), id));
            setStatusError(''); setRefresh(value => value + 1);
        } catch (error) { setStatusError(error instanceof Error ? error.message : 'Unable to request a retry.'); }
        finally { setRetrying(false); }
    };
    const result = setup?.result;
    return <section className="panel mb-5 space-y-4" aria-label="Saved company setup">
        <h2 className="text-xl font-bold">{result ? result.accessGranted ? 'Company workspace is active' : 'Workspace created — subscription approval required' : 'Saved company setup'}</h2>
        <p className="break-all text-xs text-white-dark">Reference: {id}</p>
        {statusError && <div role="alert" className="rounded bg-warning-light p-4 text-warning">{statusError}</div>}
        {!result && <div role="status" aria-live="polite"><strong>{onboardingStages[setup?.stage || ''] || 'Checking saved setup'}</strong><p>{onboardingStatusLabels[setup?.status || ''] || 'Checking status'}</p><p className="mt-2 text-sm">You can leave this page. Setup is saved and can be reopened from the company page.</p></div>}
        {!statusError && setup?.error && <div role="alert" className="rounded bg-danger-light p-4 text-danger"><p>{setup.error.message}</p><p className="mt-2">{setup.error.nextAction}</p><p className="mt-2 text-xs">{setup.error.code}</p></div>}
        {setup && ['FAILED', 'NEEDS_REVIEW'].includes(setup.status) && !['DATABASE_OWNERSHIP', 'DATABASE_NOT_EMPTY', 'DATABASE_BRANCH_MISMATCH'].includes(setup.error?.code || '') && <button className="btn btn-primary" disabled={retrying} onClick={retry}>{retrying ? 'Requesting retry…' : 'Retry saved setup'}</button>}
        {missing && onMissing && <button className="btn btn-outline-primary" onClick={onMissing}>Return to form with this reference</button>}
        {result && <><p>{result.name} has been created. {result.accessGranted ? 'The owner can sign in.' : 'Approve its subscription before the owner can access the workspace.'}</p>
            <dl className="space-y-3">{[['Owner email', result.adminEmail], ['Database', result.dbName], ['Login URL', result.loginUrl], ['Modules', result.modulesEnabled.join(', ')], ...(password ? [['Password — copy securely now', password]] : [])].map(([label, value]) => <div key={label}><dt className="text-sm text-white-dark">{label}</dt><dd className="break-all font-semibold">{value}</dd></div>)}</dl>
            {!password && <p className="text-sm text-white-dark">The password is not stored in this browser. Use the password chosen during setup or the existing password reset flow.</p>}</>}
        <div className="flex gap-3">{setup?.companyId && <Link className="btn btn-outline-primary" to={`/superadmin/companies/${setup.companyId}`}>Open company</Link>}<Link className="btn btn-outline-dark" to="/superadmin/companies">Company list</Link></div>
    </section>;
}
