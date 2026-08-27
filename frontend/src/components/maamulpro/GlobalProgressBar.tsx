import { useSyncExternalStore } from 'react';
import { LoaderCircle } from 'lucide-react';
import { getRequestActivity, subscribeRequestActivity } from '../../lib/api';

export const GlobalProgressBar = () => {
    const { pendingRequests, pendingMutations } = useSyncExternalStore(subscribeRequestActivity, getRequestActivity);
    if (!pendingRequests) return null;

    return (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999]" role="status" aria-live="polite">
            <div className="h-1 overflow-hidden bg-primary/10" aria-hidden="true"><div className="h-full w-full animate-pulse bg-primary motion-reduce:animate-none" /></div>
            {pendingMutations > 0 ? <div className="mx-auto mt-3 flex w-fit items-center gap-2 rounded-md border border-primary/20 bg-white px-4 py-2 text-sm font-semibold text-primary shadow-lg dark:bg-black"><LoaderCircle className="animate-spin motion-reduce:animate-none" size={18} aria-hidden="true" />Processing action… Please wait.</div> : <span className="sr-only">Loading data…</span>}
        </div>
    );
};

export default GlobalProgressBar;
