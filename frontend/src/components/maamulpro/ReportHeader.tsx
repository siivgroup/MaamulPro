import type { Branding } from '../../hooks/useBranding';
import { AuthenticatedImage } from './AuthenticatedImage';

type Props = {
    branding: Branding | null;
    title: string;
    subtitle?: string;
};

export function ReportHeader({ branding, title, subtitle }: Props) {
    return (
        <div className="mb-6 flex items-start justify-between gap-6 border-b-2 border-gray-200 pb-5 dark:border-[#1b2e4b] print:border-gray-300">
            <div className="flex min-w-0 items-center gap-4">
                {branding?.logoUrl && (
                    <AuthenticatedImage
                        src={branding.logoUrl}
                        alt={branding.companyName || 'Company logo'}
                        className="h-14 w-auto max-w-[110px] flex-shrink-0 object-contain"
                    />
                )}
                <div className="min-w-0">
                    {branding?.companyName && (
                        <div className="text-lg font-extrabold leading-tight text-secondary dark:text-white">
                            {branding.companyName}
                        </div>
                    )}
                    {branding?.companyAddress && (
                        <div className="mt-0.5 text-xs leading-snug text-white-dark">{branding.companyAddress}</div>
                    )}
                    {(branding?.companyPhone || branding?.companyEmail) && (
                        <div className="text-xs leading-snug text-white-dark">
                            {[branding.companyPhone, branding.companyEmail].filter(Boolean).join(' · ')}
                        </div>
                    )}
                </div>
            </div>
            <div className="flex-shrink-0 text-right">
                <div className="font-bold text-secondary dark:text-white">{title}</div>
                {subtitle && <div className="mt-0.5 text-xs text-white-dark">{subtitle}</div>}
                <div className="mt-0.5 text-xs text-white-dark">
                    {new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
            </div>
        </div>
    );
}
