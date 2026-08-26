import { toast } from './toast';

export const LOADING_EVENT = 'maamulpro:loading';
let pendingRequests = 0;
const emitLoading = () => window.dispatchEvent(new CustomEvent(LOADING_EVENT, { detail: pendingRequests }));

export type ApiEnvelope<T> = {
    success: boolean;
    data: T;
    message?: string;
    timestamp: string;
};

export type ApiInit = RequestInit & { silent?: boolean };

export type SessionUser = {
    id: string;
    email: string;
    name?: string;
    role: string;
    companyId?: string;
    companyName?: string;
    permissions?: string[];
    isSuperAdmin?: boolean;
    isImpersonating?: boolean;
    impersonatedBy?: string;
    constructionEnabled?: boolean;
    realEstateEnabled?: boolean;
    materialManagementEnabled?: boolean;
    subscriptionStatus?: string;
    subscriptionExpiresAt?: string;
    companyStatus?: string;
    accessGranted?: boolean;
    planKey?: string;
    entitlements?: {
        planId?: string;
        planKey?: string;
        planName?: string;
        features: {
            construction: boolean;
            realEstate: boolean;
            materials: boolean;
            payroll: boolean;
            advancedReports: boolean;
            prioritySupport: boolean;
        };
        limits: {
            users: number;
            constructionProjects: number;
            properties: number;
        };
    };
    enterpriseConfiguration?: {
        workspaceControls: Record<string, boolean>;
        sidebarVisibility: Record<string, boolean>;
        reportVisibility: Record<string, boolean>;
        analyticsVisibility: Record<string, boolean>;
    };
};

export type Session = {
    accessToken: string;
    user: SessionUser;
};

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:4000' : '');
const STORAGE_KEY = 'maamulpro.session';
let volatileSession: Session | null = null;

const requestUrl = (path: string) => {
    if (!API_URL) throw new Error('Application API URL is not configured. Set VITE_API_URL in Vercel and redeploy.');
    return `${API_URL}${path}`;
};

export const sessionStore = {
    get(): Session | null {
        if (volatileSession) return volatileSession;
        try {
            const value = sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
            const stored = JSON.parse(value || 'null') as Session | null;
            if (stored?.user.isImpersonating) {
                sessionStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(STORAGE_KEY);
                return null;
            }
            return stored;
        } catch {
            return null;
        }
    },
    set(session: Session, remember = Boolean(localStorage.getItem(STORAGE_KEY))) {
        if (session.user.isImpersonating) {
            volatileSession = session;
            sessionStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(STORAGE_KEY);
            window.dispatchEvent(new CustomEvent('maamulpro:session', { detail: session }));
            return;
        }
        volatileSession = null;
        const target = remember ? localStorage : sessionStorage;
        const other = remember ? sessionStorage : localStorage;
        other.removeItem(STORAGE_KEY);
        target.setItem(STORAGE_KEY, JSON.stringify(session));
        window.dispatchEvent(new CustomEvent('maamulpro:session', { detail: session }));
    },
    updateUser(user: SessionUser) {
        const session = this.get();
        if (!session) return null;
        const updated = { ...session, user: { ...session.user, ...user } };
        this.set(updated);
        return updated;
    },
    clear() {
        volatileSession = null;
        sessionStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STORAGE_KEY);
        window.dispatchEvent(new CustomEvent('maamulpro:session', { detail: null }));
    },
};

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
    const { silent, ...fetchInit } = init;
    const session = sessionStore.get();
    const headers = new Headers(fetchInit.headers);
    headers.set('Accept', 'application/json');
    if (fetchInit.body && !(fetchInit.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    if (session?.accessToken) headers.set('Authorization', `Bearer ${session.accessToken}`);
    if (session?.user.companyId) headers.set('X-Company-Id', session.user.companyId);

    pendingRequests++; emitLoading();
    let response: Response;
    try {
        response = await fetch(requestUrl(path), { ...fetchInit, headers });
    } finally {
        pendingRequests--; emitLoading();
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        if (response.status === 401) sessionStore.clear();
        const message = payload?.message || payload?.error?.message || `Request failed (${response.status})`;
        const readable = Array.isArray(message) ? message.join(', ') : message;
        const isLockRedirect = response.status === 403 && /subscription|company setup|company account.*suspend/i.test(readable);
        if (isLockRedirect) {
            lastSessionRefreshAt = 0;
            if (!window.location.pathname.startsWith('/locked')) {
                window.location.assign(`/locked?reason=${encodeURIComponent(readable)}`);
            }
        } else if (response.status === 403) {
            if (!silent) toast.error("You don't have permission for this action.");
            refreshSession(true).catch(() => undefined);
        } else if (response.status !== 401 && !silent) {
            toast.error(readable);
        }
        throw new Error(readable);
    }
    return (payload as ApiEnvelope<T>).data;
}

export async function apiBlob(path: string): Promise<Blob> {
    const session = sessionStore.get();
    const headers = new Headers({ Accept: 'image/*' });
    if (session?.accessToken) headers.set('Authorization', `Bearer ${session.accessToken}`);
    if (session?.user.companyId) headers.set('X-Company-Id', session.user.companyId);
    const response = await fetch(requestUrl(path), { headers });
    if (!response.ok) {
        if (response.status === 401) sessionStore.clear();
        throw new Error(`File request failed (${response.status})`);
    }
    return response.blob();
}

let sessionRefreshPromise: Promise<Session | null> | null = null;
let lastSessionRefreshAt = 0;

export function refreshSession(force = false): Promise<Session | null> {
    const stored = sessionStore.get();
    if (!stored) return Promise.resolve(null);
    if (!force && Date.now() - lastSessionRefreshAt < 30_000) return Promise.resolve(stored);
    if (sessionRefreshPromise) return sessionRefreshPromise;
    sessionRefreshPromise = api<SessionUser>('/api/auth/session')
        .then((user) => {
            lastSessionRefreshAt = Date.now();
            return sessionStore.updateUser(user);
        })
        .finally(() => { sessionRefreshPromise = null; });
    return sessionRefreshPromise;
}
