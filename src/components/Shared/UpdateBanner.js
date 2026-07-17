import React, { useEffect, useState } from 'react';

// Deploy-refresh banner (Stuart 2026-07-16): Vercel deploys many times a day and the floor
// won't know to hard-refresh — stale bundles read as "it's still broken." The build stamps
// its version into window.__APP_V + /version.json (scripts/stampVersion.js, postbuild);
// this polls version.json (cache-bypassed) every few minutes and when the tab regains
// focus, and offers a ONE-TAP reload when a newer deploy is live. Never auto-reloads
// (an operator may be mid-count). Local dev has no __APP_V → banner stays off.
const CHECK_MS = 4 * 60 * 1000;

const UpdateBanner = () => {
    const [stale, setStale] = useState(false);

    useEffect(() => {
        const mine = window.__APP_V;
        if (!mine) return;
        let dead = false;
        const check = async () => {
            try {
                const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
                if (!r.ok) return;
                const j = await r.json();
                if (!dead && j && j.v && String(j.v) !== String(mine)) setStale(true);
            } catch (e) { /* offline — try again next tick */ }
        };
        const iv = setInterval(check, CHECK_MS);
        const onVis = () => { if (document.visibilityState === 'visible') check(); };
        document.addEventListener('visibilitychange', onVis);
        check();
        return () => { dead = true; clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
    }, []);

    if (!stale) return null;
    return (
        <div onClick={() => window.location.reload()} title="A newer deploy is live — reloads this tab" style={{ position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)', zIndex: 15000, background: '#1c1a16', color: '#fff', padding: '12px 22px', borderRadius: '999px', boxShadow: '0 8px 30px rgba(0,0,0,0.35)', cursor: 'pointer', fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', letterSpacing: '.08em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '14px' }}>⟳</span> New version is live — tap to update
        </div>
    );
};

export default UpdateBanner;
