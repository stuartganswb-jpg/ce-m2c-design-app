// "WHERE IS IT?" — the lookup (Stuart 2026-08-03: "from any of the screens we need to quickly be
// able to see the status"). Type a WO number, an SO number, an item code or a customer and get the
// stage back, with who touched it last and what happens next.
//
// v2 (Stuart 2026-08-29, the honesty pass): it now answers the OTHER half of the question — the
// PHYSICAL location (sled, oven, hand bench, pick, put-away bin) alongside the stage — matches
// every identity an order is keyed under (NetSuite number, app ids, SO refs, item codes, alias
// codes, order keys), and searches the demands riding beside the orders (convert / plating / rod
// cuts) when the host passes them via `extras`.
//
// It still holds NO data of its own — the host passes what it already subscribes to, so this adds
// no second listener to a floor tablet and can never show something staler than the screen around
// it.
import React, { useState, useMemo } from 'react';
import { orderStatusOf, stageLabel, stageTone } from './orderStatus';
import OrderStatusChips from './OrderStatusChips';
import { woRefOf } from './woRef';

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

// The PHYSICAL answer: which station/sled/bin the pieces are at right now, best-effort from the
// fields the floor already stamps. Empty string when nothing physical is known.
const TASK_PLACE = { spinSetup: 'setup bench', spinSpray: 'spray booth', spinBake: 'OVEN', poleSpray: 'pole rack — spray', poleBake: 'pole rack — bake', hand: 'hand-finish bench' };
export const physicalPlaceOf = (o) => {
    if (!o) return '';
    const bits = [];
    if (o.putawayBin) bits.push(`put away in ${o.putawayBin}`);
    else if (o.packStatus === 'Packed') bits.push(`packed${o.packedBy ? ` by ${o.packedBy}` : ''}`);
    const running = Object.entries(o.tasks || {}).filter(([, t]) => t && t.status === 'Running');
    running.forEach(([k, t]) => bits.push(`${TASK_PLACE[k] || k}${o.machineAssigned && k.startsWith('spin') ? ` (${o.machineAssigned} sled)` : ''}${t.assignedTo ? ` · ${t.assignedTo}` : ''}`));
    if (!running.length && o.machineAssigned) bits.push(`${o.machineAssigned} sled`);
    if (o.pickStatus && o.pickStatus !== 'Pending' && o.pickStatus !== 'Closed') bits.push(`pick: ${String(o.pickStatus).replace(/_/g, ' ').toLowerCase()}`);
    return bits.join(' · ');
};

const ORDER_MATCH_FIELDS = ['nsWoTran', 'nsWoId', 'woNum', 'woDisplayId', 'displayId', 'id', 'soNum', 'soId', 'salesOrderId', 'soAppId', 'orderKey', 'stockErpId', 'type', 'erpId', 'partErpId', 'rootItem', 'variantErpId', 'aliasErp', 'customerName', 'clientName', 'customer'];
const EXTRA_MATCH_FIELDS = ['id', 'woNum', 'finWoId', 'finWoErpId', 'baseErpId', 'targetErpId', 'sourceItemId', 'targetItemId', 'customerName', 'poId', 'vendor'];

const WhereIsIt = ({ orders = [], extras = [], recipeLenOf = () => 0, compact = false }) => {
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);

    const hits = useMemo(() => {
        const term = U(q);
        if (term.length < 2) return [];
        // Match anything a person would actually shout across a room: the NetSuite WO, the app id,
        // the sales order, the item code, an alias, or the customer.
        return orders.filter(o => ORDER_MATCH_FIELDS.some(f => U(o[f]).includes(term))).slice(0, 8);
    }, [orders, q]);

    const extraHits = useMemo(() => {
        const term = U(q);
        if (term.length < 2) return [];
        // A PO answers to its number, its vendor AND every item riding it — "where is my
        // HCUMB410" should surface the inbound PO carrying it (Stuart 2026-08-31).
        return extras.filter(d =>
            EXTRA_MATCH_FIELDS.some(f => U(d[f]).includes(term)) ||
            (Array.isArray(d.items) && d.items.some(it => U(it && it.itemId).includes(term)))
        ).slice(0, 6);
    }, [extras, q]);

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
                        <span>{hits.length + extraHits.length ? `${hits.length + extraHits.length} match${hits.length + extraHits.length === 1 ? '' : 'es'}` : 'no match on this screen'}</span>
                        <button onClick={() => { setQ(''); setOpen(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>close</button>
                    </div>
                    {hits.length === 0 && extraHits.length === 0 && (
                        <div style={{ padding: '16px 14px', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
                            Nothing here matches “{q.trim()}”. This searches the orders THIS screen is showing — a closed or not-yet-released order will not appear.
                        </div>
                    )}
                    {hits.map(o => {
                        const st = orderStatusOf(o, { recipeLen: recipeLenOf(o) });
                        const tone = stageTone(st.slowest);
                        const place = physicalPlaceOf(o);
                        return (
                            <div key={o.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--paper-2)' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                    <b style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--ink)' }}>{woRefOf(o)}</b>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{o.stockErpId || o.type || ''}{o.customerName || o.clientName || o.customer ? ` · ${o.customerName || o.clientName || o.customer}` : ''}</span>
                                    {st.isSplit && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)', textTransform: 'uppercase' }}>split</span>}
                                </div>
                                <OrderStatusChips wo={o} recipeLen={recipeLenOf(o)} />
                                {place && (
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)', marginTop: '7px' }}>
                                        📍 {place}
                                    </div>
                                )}
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: place ? '3px' : '7px', lineHeight: 1.5 }}>
                                    <span style={{ color: tone }}>NEXT</span> · {NEXT_MOVE[st.slowest] || '—'}
                                    {st.isSplit && <span> (that is the {stageLabel(st.slowest).toLowerCase()} half — the other is further along)</span>}
                                </div>
                            </div>
                        );
                    })}
                    {extraHits.map(d => (
                        <div key={(d.__kind || 'X') + d.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--paper-2)', background: 'var(--paper)' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--brass)', border: '1px solid var(--brass)', padding: '2px 6px' }}>{d.__kind || 'DEMAND'}</span>
                                <b style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{d.woNum || d.poId || d.id}</b>
                                <span style={{ fontSize: '0.82rem', color: 'var(--ink-soft)' }}>
                                    {d.__kind === 'PO'
                                        ? `${d.vendor || ''} · ${(d.items || []).slice(0, 3).map(it => `${it.quantity || ''} × ${it.itemId || ''}`).join(', ')}${(d.items || []).length > 3 ? ` +${d.items.length - 3}` : ''}`
                                        : d.__kind === 'RODCUT'
                                        ? `${d.qtySource || ''} × ${d.sourceItemId || ''} → ${d.qtyTarget || ''} × ${d.targetItemId || ''}`
                                        : `${d.qty || ''} × ${d.baseErpId || ''}${d.targetErpId ? ` → ${d.targetErpId}` : ''}`}
                                    {d.finWoErpId || d.finWoId ? ` · for ${d.finWoErpId || d.finWoId}` : ''}
                                    {d.nsWoTran ? ` · NS WO ${d.nsWoTran}` : ''}{d.nsPoTran ? ` · NS PO ${d.nsPoTran}` : ''}
                                    {d.deliveryStatus || d.status ? ` · ${d.deliveryStatus || d.status}` : ''}
                                    {d.eta ? <b style={{ color: 'var(--brass)' }}>{` · ETA ${d.eta}`}</b> : ''}
                                    {d.deliveryNote ? ` · ${d.deliveryNote}` : ''}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default WhereIsIt;
