// ── SMALL PARTS OR POLES? — ASKED AT EVERY DOOR THAT RAISES A PAINT RUN (Stuart 2026-09-23) ─────
// "at the time order is created it pops up and asks if it is to be routed as small parts or poles,
// the JFP work orders are created on the master library and on stock view … the features need to be
// aligned on both areas." One prompt, called by all three doors (Master Library Just For Paint,
// Master Library ♻ Repaint, the Snapshot's ♻ Repaint), so they cannot drift. Shared/repaintRun
// refuses a run without the answer.
//
// Promise-shaped so each door asks with one line, the way it already asks window.confirm:
//     const handling = await askRunHandling({ code, qty, hint });   // 'SMALL' | 'POLES' | null
// null = cancelled; nothing is created. The hint (what the library lists the item as, when it knows
// it) is shown, never chosen for the person — a JFP item is usually one the library was never taught.
import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RUN_HANDLING } from './stockRun';

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' };

function RunHandlingDialog({ code, qty, hint, onPick }) {
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onPick(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onPick]);
    const choice = (value, title, detail) => (
        <button onClick={() => onPick(value)} style={{ flex: 1, minWidth: '200px', padding: '18px 16px', background: '#fff', border: '1px solid var(--ink)', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', color: 'var(--ink)' }}>{title}</div>
            <div style={{ ...mono, fontSize: '9px', color: 'var(--ink-soft)', marginTop: '6px', lineHeight: 1.6 }}>{detail}</div>
        </button>
    );
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,.8)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
            <div role="dialog" aria-modal="true" style={{ background: '#fff', width: '560px', maxWidth: '96vw', border: '1px solid var(--line)' }}>
                <div style={{ padding: '18px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)' }}>Route this paint run as…</div>
                    <div style={{ ...mono, color: 'var(--ink-soft)', marginTop: '4px' }}>{qty ? `${qty} × ` : ''}{code}</div>
                </div>
                <div style={{ padding: '18px 24px' }}>
                    {hint && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '12px' }}>The library lists {code} as <b>{hint}</b>.</div>}
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        {choice(RUN_HANDLING.SMALL, 'Small parts', 'on a sled — spin machine or booth, chosen at Start Setup')}
                        {choice(RUN_HANDLING.POLES, 'Poles', 'the pole track — large booth, racked 8 to a rack')}
                    </div>
                    <button onClick={() => onPick(null)} style={{ ...mono, marginTop: '14px', width: '100%', padding: '10px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', cursor: 'pointer' }}>Cancel — create nothing</button>
                </div>
            </div>
        </div>
    );
}

export function askRunHandling({ code = '', qty = 0, hint = '' } = {}) {
    return new Promise((resolve) => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        let settled = false;
        const onPick = (value) => {
            if (settled) return;
            settled = true;
            // Unmount after this click finishes, so React is not torn down inside its own handler.
            setTimeout(() => { root.unmount(); host.remove(); }, 0);
            resolve(value);
        };
        root.render(<RunHandlingDialog code={code} qty={qty} hint={hint} onPick={onPick} />);
    });
}

/** How a routed-as answer reads in the confirm text each door already shows. */
export const runHandlingLabel = (handling) =>
    handling === RUN_HANDLING.POLES ? 'POLES — the pole track (large booth)' : 'SMALL PARTS — on a sled';
