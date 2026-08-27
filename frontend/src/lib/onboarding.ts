export const onboardingStorageKey = 'maamulpro.onboarding';
export const onboardingStatusLabels: Record<string, string> = { QUEUED: 'Waiting to continue', RUNNING: 'Setup in progress', FAILED: 'Setup paused', NEEDS_REVIEW: 'Administrator review required', SUCCEEDED: 'Setup complete', DELETING: 'Deletion awaiting confirmation', CANCELLED: 'Company removed' };
export const onboardingStages: Record<string, string> = {
    DATABASE: 'Creating or checking the saved database', READINESS: 'Connecting to the database', SCHEMA: 'Installing the company schema',
    PERMISSIONS: 'Configuring permissions', OWNER_DEFAULTS: 'Creating the owner and company defaults', FINALIZATION: 'Finalizing company setup',
};
export type OnboardingStatus = {
    onboardingId: string; companyId: string | null; status: string; stage: string;
    error?: { code: string; message: string; nextAction: string; retryable: boolean };
    result?: { id: string; name: string; adminEmail: string; dbName: string; loginUrl: string; accessGranted: boolean; modulesEnabled: string[] };
};
export const parseOnboardingStatus = (value: unknown, id: string): OnboardingStatus => {
    const row = value as OnboardingStatus | null;
    const result = row?.result;
    if (!row || row.onboardingId !== id || !Object.hasOwn(onboardingStatusLabels, row.status) || !Object.hasOwn(onboardingStages, row.stage)
        || (row.companyId !== null && typeof row.companyId !== 'string')
        || (row.error && (typeof row.error.message !== 'string' || typeof row.error.code !== 'string' || typeof row.error.nextAction !== 'string' || typeof row.error.retryable !== 'boolean'))
        || (row.status === 'SUCCEEDED' && !result)
        || (result && (row.status !== 'SUCCEEDED' || !['id', 'name', 'adminEmail', 'dbName', 'loginUrl'].every(key => typeof result[key as keyof typeof result] === 'string')
            || typeof result.accessGranted !== 'boolean' || !Array.isArray(result.modulesEnabled) || !result.modulesEnabled.every(module => typeof module === 'string')))) {
        throw new Error('Unable to check setup status: the server response was unreadable. Your setup reference is saved.');
    }
    return row;
};
export const loadOnboardingReference = () => {
    const query = new URLSearchParams(window.location.search).get('onboarding');
    let stored: string | null = null;
    try { stored = sessionStorage.getItem(onboardingStorageKey); } catch { /* Storage may be disabled. */ }
    const id = query || stored || '';
    return /^[0-9a-f-]{36}$/i.test(id) ? id : '';
};
export const saveOnboardingReference = (id: string) => {
    try { sessionStorage.setItem(onboardingStorageKey, id); } catch { /* The URL/company page also retains the reference. */ }
};
export const clearOnboardingReference = (id: string) => {
    try { if (sessionStorage.getItem(onboardingStorageKey) === id) sessionStorage.removeItem(onboardingStorageKey); } catch { /* No sensitive input is stored. */ }
};
