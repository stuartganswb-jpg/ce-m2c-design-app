// THE STATUS, RENDERED THE SAME EVERYWHERE (Stuart 2026-08-03). One component so a job reads
// identically on the finishing floor, the pick queue, the packing station and HQ — the point of the
// exercise is that nobody has to translate between screens.
//
// Split orders show BOTH halves side by side, always (his call): an order whose poles are done
// while its small parts are on coat 1 is not one status, and collapsing it would have to lie about
// one half. Each chip is <label> <STAGE> <detail>, so the eye gets the stage and the detail follows.
import React from 'react';
import { orderStatusOf, stageLabel, stageTone } from './orderStatus';

const ago = (ms) => {
    if (!ms) return '';
    const t = typeof ms === 'object' && ms.toMillis ? ms.toMillis() : Number(ms);
    if (!Number.isFinite(t) || t <= 0) return '';
    const m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
};

// size: 'sm' for dense lists, 'md' for a detail panel.
const OrderStatusChips = ({ wo, recipeLen = 0, size = 'sm', showWho = true, style = {} }) => {
    const st = orderStatusOf(wo, { recipeLen });
    const all = [...st.streams, ...(st.fulfilment ? [st.fulfilment] : [])];
    if (!all.length) return null;
    const fs = size === 'md' ? '11px' : '10px';

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', ...style }}>
            {all.map((s, i) => {
                const tone = stageTone(s.stage);
                const when = ago(s.since);
                return (
                    <span key={s.key + i}
                        title={`${s.label} — ${stageLabel(s.stage)}${s.detail ? ` · ${s.detail}` : ''}${s.by ? ` · ${s.by}` : ''}${when ? ` · ${when} ago` : ''}`}
                        style={{ display: 'inline-flex', alignItems: 'baseline', gap: '6px', border: `1px solid ${tone}`, borderLeft: `3px solid ${tone}`, background: '#fff', padding: size === 'md' ? '4px 9px' : '3px 7px', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-soft)' }}>{s.label}</span>
                        <b style={{ fontFamily: 'var(--mono)', fontSize: fs, textTransform: 'uppercase', letterSpacing: '.04em', color: tone }}>{stageLabel(s.stage)}</b>
                        {s.detail && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.detail}</span>}
                        {showWho && s.by && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: tone }}>· {s.by}</span>}
                        {showWho && when && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--line)' }}>{when}</span>}
                    </span>
                );
            })}
        </div>
    );
};

export default OrderStatusChips;
