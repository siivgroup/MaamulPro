import { useEffect, useState } from 'react';
import { api, sessionStore } from '../lib/api';

export type Branding = {
    companyName: string;
    logoUrl: string | null;
    companyAddress: string;
    companyPhone: string;
    companyEmail: string;
};

// ponytail: one cached settings fetch per tenant
const cache = new Map<string, Branding>();
const BRANDING_EVENT = 'maamulpro:branding';

export function updateBranding(companyId: string | undefined, value: Branding) {
    if (!companyId) return;
    cache.set(companyId, value);
    window.dispatchEvent(new CustomEvent(BRANDING_EVENT, { detail: { companyId, value } }));
}

export function useBranding(companyId = sessionStore.get()?.user.companyId): Branding | null {
    const key = companyId || '';
    const [branding, setBranding] = useState<{ key: string; value: Branding | null }>(() => ({ key, value: cache.get(key) || null }));
    useEffect(() => {
        const cached = cache.get(key);
        if (!key || cached) {
            setBranding({ key, value: cached || null });
            return;
        }
        let active = true;
        setBranding({ key, value: null });
        api<any>('/api/settings')
            .then((d) => {
                const value = {
                    companyName: d.companyName || '',
                    logoUrl: d.logoUrl || null,
                    companyAddress: d.companyAddress || '',
                    companyPhone: d.companyPhone || '',
                    companyEmail: d.companyEmail || '',
                };
                cache.set(key, value);
                if (active) setBranding({ key, value });
            })
            .catch(() => {});
        return () => { active = false; };
    }, [key]);
    useEffect(() => {
        const update = (event: Event) => {
            const detail = (event as CustomEvent<{ companyId: string; value: Branding }>).detail;
            if (detail.companyId === key) setBranding({ key, value: detail.value });
        };
        window.addEventListener(BRANDING_EVENT, update);
        return () => window.removeEventListener(BRANDING_EVENT, update);
    }, [key]);
    return branding.key === key ? branding.value : null;
}
