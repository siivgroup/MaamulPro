import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export type Branding = {
    companyName: string;
    logoUrl: string | null;
    companyAddress: string;
    companyPhone: string;
    companyEmail: string;
};

// ponytail: module-level cache — all report pages share one fetch per session
let _cache: Branding | null = null;

export function useBranding(): Branding | null {
    const [branding, setBranding] = useState<Branding | null>(_cache);
    useEffect(() => {
        if (_cache) return;
        api<any>('/api/settings')
            .then((d) => {
                _cache = {
                    companyName: d.companyName || '',
                    logoUrl: d.logoUrl || null,
                    companyAddress: d.companyAddress || '',
                    companyPhone: d.companyPhone || '',
                    companyEmail: d.companyEmail || '',
                };
                setBranding(_cache);
            })
            .catch(() => {});
    }, []);
    return branding;
}
