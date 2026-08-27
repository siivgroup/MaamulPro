import { sessionStore } from './api';

type Submission = { requestId: string; payload: Record<string, any> };
const key = (scope: string) => {
    const user = sessionStore.get()?.user;
    return `maamulpro:billing-intent:${user?.id}:${user?.companyId || 'platform'}:${scope}`;
};

// Only cashbook/subscription forms use this draft. Never pass credentials here.
// Session storage survives refresh, is isolated per account, and expires with the tab.
export function pendingBillingSubmission(scope: string): Submission | null {
    const raw = sessionStorage.getItem(key(scope));
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (typeof saved.requestId !== 'string' || !saved.payload || typeof saved.payload !== 'object') {
        throw new Error('Saved submission is unreadable. Check the ledger before starting another submission.');
    }
    return saved;
}

export function reserveBillingSubmission(scope: string, payload: Record<string, any>): Submission {
    const normalized = JSON.parse(JSON.stringify(payload));
    const saved = pendingBillingSubmission(scope);
    if (saved) {
        if (JSON.stringify(saved.payload) !== JSON.stringify(normalized)) {
            throw new Error('A previous submission is awaiting confirmation. Close and reopen this form to recover its original details, then retry safely.');
        }
        return saved;
    }
    const submission = { requestId: crypto.randomUUID(), payload: normalized };
    // If storage is unavailable, stop before sending a write we could not recover.
    sessionStorage.setItem(key(scope), JSON.stringify(submission));
    return submission;
}

export function completeBillingSubmission(scope: string) {
    sessionStorage.removeItem(key(scope));
}
