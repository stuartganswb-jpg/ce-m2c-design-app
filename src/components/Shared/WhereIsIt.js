// "WHERE IS IT?" — the lookup (Stuart 2026-08-03: "from any of the screens we need to quickly be
// able to see the status"). Type a WO number, an SO number, an item code or a customer and get the
// stage back, with who touched it last and what happens next.
//
// It holds NO data of its own — the host passes the orders it already subscribes to, so this adds
// no second listener to a floor tablet and can never show something staler than the screen around
// it. Dropped into the finishing app and the WMS, it answers the question people currently ask each
// other across the room.
import React, { useState, useMemo } from 'react';
import { orderStatusOf, stageLabel, stageTone } from './orderStatus';
import OrderStatusChips from './OrderStatusChips';

const U = (v) => String(v ?? '').trim().toUpperCase();

// What each stage is waiting on. The status says where it IS; this says what moves it.
const NEXT_MOVE = {
    RELEASED: 'Stage it to the floor (Setup Queue).',
    SHOP: 'The custom shop finishes fabrication.',
    SETUP: 'Stage it to the floor and start the first coat.',
    PAINTING: 'Finish the coat, then press the coat advance — that is what moves it on.',
    OVEN: 'The bake finishes, then stop the step and advance the coat.',
    FINISHED: 'WMS picks it.',
    PICKING: 'Pick the lines, then scan the labels to stage it.',
    PICKED: 'Scan both labels at the Staging Handshake.',
    STAGED: 'Pack it (or put it away, for stock).',
    PACKED: 'Ship it — the NetSuite fulfilment posts from packing.',
    SHELVED: 'Nothing — it is on the shelf and the assembly build has posted.',
    SHIPPED: 'Nothing — it has shipped.',
    CLOSED: 'Nothing — this order is closed.',
};

const WhereIsIt = ({ orders = [], recipeLenOf = () => 0, compact = false }) => {
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);

    const hits = useMemo(() => {
        const term = U(q);
        if (term.length < 2) return [];
        // Match anything a person would actually shout across a room: the NetSuite WO, the app id,
        // the sales order, the item code, or the customer.
        return orders.filter(o => [o.nsWoTran, o.nsWoId, o.woNum, o.displayId, o.id, o.soNum, o.soId, o.salesOrderId, o.stockErpId, o.type, o.customerName, o.clientName, o.customer]
            .some(v => U(v).includes(term))).slice(0, 8);
    }, [orders, q]);

    return (
        <div style={{ position: 'relative', minWidth: compact ? '220px' : '300px' }}>
            <input
                value={q}
                onChange={e => { setQ(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                placeholder="🧭 Where is it? WO / SO / item…"
                style={{ width: '100%', boxSizing: 'border-box', padding: compact ? '8px 10px' : '10px 12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--mono)', fontSize: '11px', background: '#fff' }}
            />
            {open && q.trim().length >= 2 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 900, width: 'min(560px, 92vw)', background: '#fff', border: '1px solid var(--line)', boxShadow: '0 10px 40px rgba(0,0,0,.18)', maxHeight: '60vh', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>
                        <span>{hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'no match on this screen'}</span>
                        <button onClick={() => { setQ(''); setOpen(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>close</button>
                    </div>
                    {hits.length === 0 && (
                        <div style={{ padding: '16px 14px', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
                            Nothing here matches “{q.trim()}”. This searches the orders THIS screen is showing — a closed or not-yet-released order will not appear.
                        </div>
                    )}
                    {hits.map(o => {
                        const st = orderStatusOf(o, { recipeLen: recipeLenOf(o) });
                        const tone = stageTone(st.slowest);
                        return (
                            <div key={o.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--paper-2)' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                    <b style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--ink)' }}>{o.nsWoTran || o.woNum || o.displayId || o.id}</b>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{o.stockErpId || o.type || ''}{o.customerName || o.clientName || o.customer ? ` · ${o.customerName || o.clientName || o.customer}` : ''}</span>
                                    {st.isSplit && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)', textTransform: 'uppercase' }}>split</span>}
                                </div>
                                <OrderStatusChips wo={o} recipeLen={recipeLenOf(o)} />
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '7px', lineHeight: 1.5 }}>
                                    <span style={{ color: tone }}>NEXT</span> · {NEXT_MOVE[st.slowest] || '—'}
                                    {st.isSplit && <span> (that is the {stageLabel(st.slowest).toLowerCase()} half — the other is further along)</span>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default WhereIsIt;
