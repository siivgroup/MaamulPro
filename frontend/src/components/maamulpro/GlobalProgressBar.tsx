import { useEffect, useState } from 'react';
import { LOADING_EVENT } from '../../lib/api';

export const GlobalProgressBar = () => {
    const [active, setActive] = useState(false);

    useEffect(() => {
        const handler = (event: Event) => setActive(((event as CustomEvent<number>).detail ?? 0) > 0);
        window.addEventListener(LOADING_EVENT, handler);
        return () => window.removeEventListener(LOADING_EVENT, handler);
    }, []);

    if (!active) return null;

    return (
        <div className="fixed inset-x-0 top-0 z-[9999] h-1 overflow-hidden bg-primary/10">
            <div className="h-full w-full animate-pulse bg-primary" />
        </div>
    );
};

export default GlobalProgressBar;
