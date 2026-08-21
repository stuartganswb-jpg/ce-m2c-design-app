import React from 'react';
import { HOLD_STAGES } from './orderHold';

// ONE BANNER, EVERY SCREEN. A stopped order has to look the same in finishing, at the packing
// bench and on the dispatch board — the whole point is that nobody can be looking at the order and
// not know it is stopped (Stuart 2026-08-21). Rendered above everything, in red, with the reason
// where the eye lands rather than behind a click.
const HeldOrdersBanner = ({ orders = [], onRelease, refOf, style }) => {
    const held = orders.filter(o => o && o.held === true)
        .sort((a, b) => (a.heldAt || 0) - (b.heldAt || 0));
    if (!held.length) return null;
    const ago = (t) => {
        if (!t) return '';
        const m = Math.floor((Date.now() - t) / 60000);
        if (m < 60) return `${m}m`;
        const h = Math.floor(m / 60);
        return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
    };
    return (
        <div style={{ background: '#fdf3f3', border: '2px solid #d9534f', padding: '16px 20px', marginBottom: '24px', ...style }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.12em', color: '#d9534f', fontWeight: 700, marginBottom: '12px' }}>
                🛑 {held.length} order{held.length === 1 ? '' : 's'} STOPPED — nothing moves until resolved
            </div>
            {held.map(o => (
                <div key={o.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flexWrap: 'wrap', padding: '10px 0', borderTop: '1px solid rgba(217,83,79,.25)' }}>
                    <div style={{ minWidth: '160px' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.95rem', fontWeight: 700, color: '#d9534f' }}>{refOf ? refOf(o) : (o.nsWoTran || o.displayId || o.id)}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)', marginTop: '3px' }}>
                            stopped at {HOLD_STAGES[o.heldStage] || o.heldStage || '—'}{o.heldAt ? ` · ${ago(o.heldAt)} ago` : ''}{o.heldBy ? ` · ${o.heldBy}` : ''}
                        </div>
                    </div>
                    <div style={{ flex: 1, minWidth: '220px' }}>
                        <div style={{ fontSize: '0.95rem', color: 'var(--ink)', fontWeight: 500 }}>{o.heldReason}</div>
                        {o.heldDetail && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '3px', whiteSpace: 'pre-wrap' }}>{o.heldDetail}</div>}
                    </div>
                    {onRelease && (
                        <button onClick={() => onRelease(o)}
                            title="Only once the problem is actually fixed — you'll be asked what was done, and it is recorded."
                            style={{ background: 'transparent', border: '1px solid #3a7d44', color: '#3a7d44', padding: '8px 14px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', whiteSpace: 'nowrap' }}>
                            ▶ Resolved — resume
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
};

export default HeldOrdersBanner;
