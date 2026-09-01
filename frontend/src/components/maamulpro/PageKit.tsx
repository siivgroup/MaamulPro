import { AlertTriangle, BarChart3, Building2, CheckCircle2, Clock, CreditCard, Eye, EyeOff, LoaderCircle, Package, TrendingUp, Users, X } from 'lucide-react';
import { Children, cloneElement, InputHTMLAttributes, isValidElement, ReactElement, ReactNode, useState, useSyncExternalStore } from 'react';
import { getRequestActivity, subscribeRequestActivity } from '../../lib/api';
import DotLoader from './DotLoader';

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & { startAdornment?: ReactNode };

export const PasswordInput = ({ className = '', startAdornment, ...props }: PasswordInputProps) => {
    const [visible, setVisible] = useState(false);
    return <div className="relative">
        <input {...props} className={`${className} pe-10`} type={visible ? 'text' : 'password'} />
        {startAdornment}
        <button aria-label={visible ? 'Hide password' : 'Show password'} className="absolute end-3 top-1/2 -translate-y-1/2 text-white-dark hover:text-primary" onClick={() => setVisible((value) => !value)} type="button">
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
    </div>;
};

type CurrencyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const isCurrencyName = (name: string) => /(total|amount|price|cost|balance|budget|rent|salary|bonus|deduction|tax|fee|paid|due)/i.test(name);

export const CurrencyInput = ({ className = '', ...props }: CurrencyInputProps) => <div className="relative">
    <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-white-dark">$</span>
    <input {...props} type="number" className={`${className} ps-7`} />
</div>;

export const humanize = (value: string) => value.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, (letter) => letter.toUpperCase());
export const money = (value: unknown, currency = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value || 0));
export const shortDate = (value: unknown) => value ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(String(value))) : '—';

/** Keys that are internal system identifiers — hide from user-facing tables. */
export const isSystemIdKey = (key: string) =>
    key.startsWith('_')
    || key === 'id'
    || /(?:^|_)id$/i.test(key)
    || /Id$/.test(key)
    || /Ids$/.test(key)
    || ['passwordHash', 'deletedAt', 'updatedAt', 'version', 'resetTokenHash', 'resetTokenExpiresAt', 'resetRequestedAt', 'passwordResetAt'].includes(key);

export const looksLikeSystemId = (value: unknown) =>
    typeof value === 'string'
    && /^c[a-z0-9]{20,}$/i.test(value.trim());

/** Clean display reference for system transaction keys, CUIDs, or formatted refs */
export const formatReference = (value: unknown, fallbackId?: string): string => {
    if (!value && !fallbackId) return '—';
    const str = String(value || fallbackId || '').trim();
    if (!str) return '—';
    if (str.startsWith('rentpayment:')) {
        const parts = str.split(':');
        const cuid = parts[1] || '';
        const tag = parts[2] ? parts[2].toUpperCase() : 'PMT';
        return `RENT-${tag}-${cuid.slice(-6).toUpperCase()}`;
    }
    if (str.startsWith('deal:')) {
        const parts = str.split(':');
        const cuid = parts[1] || '';
        const tag = parts[2] ? parts[2].toUpperCase() : 'SALE';
        return `SALE-${tag}-${cuid.slice(-6).toUpperCase()}`;
    }
    if (str.startsWith('wfcontract:') || str.startsWith('wfpayment:')) {
        const parts = str.split(':');
        const prefix = parts[0] === 'wfcontract' ? 'WFC' : 'WFP';
        return `${prefix}-${(parts[1] || '').slice(-6).toUpperCase()}`;
    }
    if (str.startsWith('sale:')) {
        const parts = str.split(':');
        const tag = parts[2] ? parts[2].toUpperCase() : 'SALE';
        return `SALE-${tag}-${(parts[1] || '').slice(-6).toUpperCase()}`;
    }
    if (/^(transport|purchase|expense|ledger):/.test(str)) {
        const parts = str.split(':');
        const prefix = parts[0].substring(0, 3).toUpperCase();
        return `${prefix}-${(parts[1] || '').slice(-6).toUpperCase()}`;
    }
    if (/^c[a-z0-9]{20,}$/i.test(str)) {
        return `REF-${str.slice(-6).toUpperCase()}`;
    }
    if (/c[a-z0-9]{20,}/i.test(str)) {
        return str.replace(/c[a-z0-9]{20,}/gi, (match) => match.slice(-6).toUpperCase()).toUpperCase();
    }
    return str;
};

/** Sanitize descriptions that contain internal debug CUID strings */
export const formatDescription = (value: unknown): string => {
    if (!value) return '—';
    let str = String(value);
    str = str.replace(/\((?:rent payment|sale|deal|payment|contract)?\s*c[a-z0-9]{20,}\)/gi, '');
    str = str.replace(/\bc[a-z0-9]{20,}\b/gi, '');
    str = str.replace(/\s+/g, ' ').trim();
    return str || 'Transaction';
};

const entityLabel = (value: Record<string, any>) => {
    if (value.name) return value.name;
    if (value.title) return value.title;
    const person = [value.firstName, value.lastName].filter(Boolean).join(' ');
    if (person) return person;
    return value.invoiceNo || value.orderNo || value.deliveryNo || value.email || value.label || null;
};

/** Prefer nested relation objects over raw foreign-key columns when picking table columns. */
export const visibleTableColumns = (row: Record<string, any> | undefined, prefer: string[] = [], limit = 8) => {
    if (!row) return prefer;
    const keys = Object.keys(row);
    const hidden = new Set(keys.filter(isSystemIdKey));
    // If both tenantId and tenant exist, drop tenantId
    for (const key of keys) {
        if (/Id$/.test(key)) {
            const relation = key.replace(/Id$/, '');
            if (relation && row[relation] != null && typeof row[relation] === 'object') hidden.add(key);
        }
    }
    const preferred = prefer.filter((key) => key in row && !hidden.has(key));
    const extras = keys.filter((key) => !hidden.has(key) && !preferred.includes(key) && typeof row[key] !== 'object');
    const relations = keys.filter((key) => !hidden.has(key) && !preferred.includes(key) && row[key] && typeof row[key] === 'object' && !Array.isArray(row[key]));
    return [...preferred, ...relations, ...extras].slice(0, limit);
};

export const formatTableValue = (key: string, value: unknown): string => {
    if (value == null || value === '') return '—';
    if (typeof value === 'object') {
        if (Array.isArray(value)) return value.length ? `${value.length} items` : '—';
        const label = entityLabel(value as Record<string, any>);
        return label || '—';
    }
    if (isSystemIdKey(key) || looksLikeSystemId(value)) return '—';
    if (/date|At$/i.test(key) && !Number.isNaN(Date.parse(String(value)))) return shortDate(value);
    if (typeof value === 'number' || (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value)) && /(amount|price|cost|balance|budget|rent|salary|paid|total|qty|quantity)/i.test(key))) {
        if (/(amount|price|cost|balance|budget|rent|salary|paid|total)/i.test(key)) return money(value);
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string' && /^[A-Z][A-Z0-9_]+$/.test(value)) return humanize(value);
    return String(value);
};

export const StatusPill = ({ value }: { value?: string | null }) => {
    const normalized = String(value || 'UNKNOWN').toUpperCase();
    const positive = ['ACTIVE', 'PAID', 'CLEARED', 'COMPLETED', 'APPROVED', 'DELIVERED', 'RECEIVED', 'AVAILABLE'];
    const negative = ['INACTIVE', 'CANCELLED', 'REJECTED', 'TERMINATED', 'EXPIRED', 'OVERDUE', 'SUSPENDED'];
    const tone = positive.includes(normalized) ? 'success' : negative.includes(normalized) ? 'danger' : 'warning';
    return <span className={`badge bg-${tone}-light text-${tone}`}>{humanize(normalized)}</span>;
};

export const PageHeader = ({ title, actions }: { title: string; description?: string; actions?: ReactNode; eyebrow?: string }) => <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-center"><h1 className="text-2xl font-extrabold text-secondary dark:text-white sm:text-3xl">{title}</h1>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</div>;


const getStatIcon = (label: string, icon?: ReactNode) => {
    if (icon) return icon;
    const l = label.toLowerCase();
    if (l.includes('company') || l.includes('companies') || l.includes('property') || l.includes('properties')) return <Building2 size={18} />;
    if (l.includes('staff') || l.includes('user') || l.includes('tenant') || l.includes('client')) return <Users size={18} />;
    if (l.includes('revenue') || l.includes('income') || l.includes('sale') || l.includes('value')) return <TrendingUp size={18} />;
    if (l.includes('expense') || l.includes('cost') || l.includes('invoice') || l.includes('bill')) return <CreditCard size={18} />;
    if (l.includes('active') || l.includes('paid') || l.includes('cleared')) return <CheckCircle2 size={18} />;
    if (l.includes('pending') || l.includes('due') || l.includes('soon')) return <Clock size={18} />;
    if (l.includes('low stock') || l.includes('expired') || l.includes('suspended') || l.includes('late')) return <AlertTriangle size={18} />;
    if (l.includes('product') || l.includes('sku') || l.includes('inventory') || l.includes('material')) return <Package size={18} />;
    return <BarChart3 size={18} />;
};

export const StatGrid = ({ items }: { items: { label: string; value: ReactNode; hint?: string; tone?: string; icon?: ReactNode; gradient?: string }[]; variant?: 'plain' | 'gradient' }) => (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
            <div className="panel flex flex-col justify-between p-5 transition-all hover:shadow-md dark:border-dark dark:bg-black" key={item.label}>
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-white-dark">{item.label}</p>
                        <p className="mt-2 text-3xl font-extrabold tracking-tight text-secondary dark:text-white">{item.value}</p>
                    </div>
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary">
                        {getStatIcon(item.label, item.icon)}
                    </div>
                </div>
                {item.hint && <p className="mt-2 text-xs text-white-dark">{item.hint}</p>}
            </div>
        ))}
    </div>
);


export const EmptyState = ({ title = 'No records found', description, action }: { title?: string; description?: string; action?: ReactNode }) => <div className="p-10 text-center"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-primary-light text-xl text-primary" aria-hidden="true">○</div><h3 className="font-bold">{title}</h3>{description && <p className="mx-auto mt-1 max-w-md text-sm text-white-dark">{description}</p>}{action && <div className="mt-4 flex justify-center">{action}</div>}</div>;
export const LoadingState = ({ label = 'Loading live data…' }: { label?: string }) => <div className="flex min-h-44 flex-col items-center justify-center gap-4 p-10 text-center text-white-dark"><DotLoader label={label} /><span className="text-sm">{label}</span></div>;
export const ErrorAlert = ({ message, onRetry }: { message: string; onRetry?: () => void }) => <div className="mb-5 flex items-center justify-between gap-4 rounded-md bg-danger-light p-4 text-danger" role="alert"><span>{message}</span>{onRetry && <button className="btn btn-sm btn-outline-danger" onClick={onRetry}>Retry</button>}</div>;
export const SuccessAlert = ({ message, onDismiss }: { message: string; onDismiss?: () => void }) => <div className="mb-5 flex items-center justify-between gap-4 rounded-md bg-success-light p-4 text-success" role="status"><span>{message}</span>{onDismiss && <button className="btn btn-sm btn-outline-success" onClick={onDismiss}>Close</button>}</div>;

export const Modal = ({ title, open, onClose, children, wide = false, busy = false }: { title: string; open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; busy?: boolean }) => {
    const { pendingMutations } = useSyncExternalStore(subscribeRequestActivity, getRequestActivity);
    // ponytail: lock open dialogs during any write; scope activity per dialog if parallel editing is needed.
    const pending = busy || pendingMutations > 0;
    // Read the live count in handlers too: a second click can arrive before React renders.
    const isPending = () => busy || getRequestActivity().pendingMutations > 0;
    const close = () => { if (!isPending()) onClose(); };
    if (!open) return null;
    return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => event.currentTarget === event.target && close()}
        onClickCapture={event => { if (isPending()) { event.preventDefault(); event.stopPropagation(); } }}
        onSubmitCapture={event => { if (isPending()) { event.preventDefault(); event.stopPropagation(); } }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
        <div className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-md bg-white shadow-xl dark:bg-black ${wide ? 'max-w-4xl' : 'max-w-xl'}`} role="dialog" aria-modal="true" aria-label={title} aria-busy={pending}>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white-light px-5 py-4 dark:border-[#191e3a]">
                <h2 className="text-lg font-bold">{title}</h2>
                <div className="flex items-center gap-3">{pending && <span className="flex items-center gap-2 text-sm text-primary"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />Processing…</span>}<button type="button" aria-label="Close" disabled={pending} className="btn btn-sm btn-outline-dark p-1.5" onClick={close}><X size={16} /></button></div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5"><fieldset disabled={pending} className="m-0 min-w-0 border-0 p-0">{children}</fieldset></div>
        </div>
    </div>;
};

const defaultPlaceholder = (label: string) => {
    const normalized = label.toLowerCase();
    if (normalized.includes('email')) return 'tusaale@shirkad.so';
    if (normalized.includes('phone')) return '+252 61 234 5678';
    if (normalized.includes('password')) return 'Geli erayga sirta ah';
    if (normalized.includes('amount')) return '1,500';
    if (normalized.includes('address')) return 'Muqdisho, Soomaaliya';
    if (normalized.includes('first') || normalized.includes('last') || normalized.includes('person') || normalized.includes('name')) return `Enter ${normalized}`;
    return `Geli ${normalized}`;
};

export const somaliExample = (name: string, type?: string, label?: string): string | undefined => {
    const key = name.replace(/[^a-z]/gi, '').toLowerCase();
    if (type === 'date') return undefined;
    if (key.includes('email')) return 'tusaale@shirkad.so';
    if (key.includes('phone')) return '+252 61 234 5678';
    if (key.includes('address') || key.includes('location')) return 'Waddada Maka Al-Mukarama, Muqdisho';
    if (key.includes('nationalid') || key.includes('passport')) return 'SOM-12345678';
    if (key.includes('description')) return 'Sharaxaad kooban oo cad';
    if (key.includes('note')) return 'Faahfaahin dheeraad ah (ikhtiyaari)';
    if (key.includes('name') || key.includes('title')) return `Enter ${(label || name).toLowerCase()}`;
    if (key.includes('code')) return 'XIS-001';
    if (key.includes('receipt')) return 'RCP-0001';
    if (key.includes('invoice')) return 'INV-0001';
    if (key.includes('order')) return 'PO-0001';
    if (key.includes('delivery')) return 'DEL-0001';
    if (key.includes('warehouse')) return 'Bakhaarka Weyn';
    if (key.includes('role')) return 'Kormeere';
    if (key.includes('amount') || key.includes('price') || key.includes('cost') || key.includes('budget') || key.includes('salary') || key.includes('rent') || key.includes('balance')) return '1,500';
    if (key.includes('quantity') || key.includes('progress') || key.includes('area') || key.includes('bedroom') || key.includes('bathroom')) return '10';
    return type === 'textarea' ? 'Ku qor faahfaahin kooban' : undefined;
};

export const fieldHint = (name: string, type?: string, fallback?: string) => {
    if (fallback) return fallback;
    return undefined;
};

const addPlaceholder = (node: ReactNode, placeholder: string): ReactNode => {
    if (!isValidElement(node)) return node;
    const element = node as ReactElement<any>;
    const props = element.props as any;
    if (typeof element.type === 'string' && (element.type === 'input' || element.type === 'textarea')) {
        const type = props.type || 'text';
        if (props.placeholder || ['checkbox', 'radio', 'file', 'hidden', 'date', 'datetime-local', 'time', 'month', 'week', 'color'].includes(type)) return element;
        return cloneElement(element, { placeholder });
    }
    if (props.children !== undefined) return cloneElement(element, undefined, Children.map(props.children, (child) => addPlaceholder(child, placeholder)));
    return element;
};

export const Field = ({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: string }) => <label className="block"><span className="font-semibold">{label}{required && <span className="text-danger"> *</span>}</span>{addPlaceholder(children, defaultPlaceholder(label))}{hint && <span className="mt-1 block text-xs text-white-dark">{hint}</span>}</label>;

export const FormActions = ({ onCancel, loading = false, saveLabel = 'Save', savingLabel = 'Saving…' }: { onCancel?: () => void; loading?: boolean; saveLabel?: string; savingLabel?: string }) => {
    const { pendingMutations } = useSyncExternalStore(subscribeRequestActivity, getRequestActivity);
    const pending = loading || pendingMutations > 0;
    return (
    <div className="col-span-full mt-8 flex items-center justify-end gap-3 border-t border-white-light pt-5 dark:border-[#191e3a]">
        <button className="btn btn-outline-dark" disabled={pending} onClick={() => { if (!loading && !getRequestActivity().pendingMutations) onCancel?.(); }} type="button">Cancel</button>
        <button className="btn btn-primary gap-2" disabled={pending} aria-busy={pending} onClick={event => { if (loading || getRequestActivity().pendingMutations) event.preventDefault(); }} type="submit">{pending && <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{pending ? savingLabel : saveLabel}</button>
    </div>
    );
};

