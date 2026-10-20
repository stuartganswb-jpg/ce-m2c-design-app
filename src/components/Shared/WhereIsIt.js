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
//
// v3 (Stuart 2026-10-20, WO11579): "each stamp should be a link we can click for the details so we could see right there
// that Grace had performed all those steps, we need an easy way to see whom did what, when". Every stamp is a button: it
// opens WHO DID WHAT, WHEN under the order (Shared/stampHistory) — read ONCE, at the click (the floor log, the NetSuite
// queue, the shop job), never a listener. And the popup's first action: a manager may send a finished, unpacked document
// back to the floor (Shared/orderLifecycle.sendBackToFloor — the same reset as the WMS Packing Station and HQ Stock View),
// on the screens that hand the search their signed-in `operator` (the finishing floor and the WMS). Everything else in the
// popup stays read-only; the 🔨 build repair still lives on the RTG card.
import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { db } from '../../firebase';
import { collection, query, where, getDocs, getDoc, doc, updateDoc, deleteField, addDoc, serverTimestamp } from 'firebase/firestore';
import { orderStatusOf, stageLabel, stageTone, gateSummary } from './orderStatus';
import OrderStatusChips from './OrderStatusChips';
import { woRefOf } from './woRef';
import { openForSearch, openExtraForSearch, sendBackToFloor, floorResetRefusalOf, floorResetPromptOf, pickHappened } from './orderLifecycle';
import { stampHistoryOf, rowsForStamp, STAMP_HEADING } from './stampHistory';
import { makeFullTasks } from './workOrderContract';
import { isFloorSupervisor, normRole } from './finishingRoles';

const U = (v) => String(v ?? '').trim().toUpperCase();

// What each stage is waiting on. The status says where it IS; this says what moves it.
const NEXT_MOVE = {
    RELEASED: 'Stage it to the floor (Setup Queue).',
    SHOP: 'The custom shop finishes fabrication.',
    SETUP: 'Stage it to the floor and start the first coat.',
    PAINTING: 'Finish the coat, then press the coat advance — that is what moves it on.',
    OVEN: 'The bake finishes, then stop the step and advance the coat.',
    PLATING: 'The plater returns the parts — the WMS Plating receipt marks them complete, then pack.',
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

const whenOf = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const ranOf = (mins) => {
    if (mins == null) return '';
    if (mins < 1) return `ran ${mins.toFixed(1)} min`;
    if (mins < 60) return `ran ${Math.round(mins)} min`;
    return `ran ${Math.floor(mins / 60)} h ${Math.round(mins % 60)} min`;
};
const FLAG_COLOR = { stop: '#d9534f', warn: '#c77d1a' };
// A finishing document (a shop job carries finSiblingId and no floor phase of its own).
const isFinishingDoc = (o) => !!o && !!o.currentPhase && !(o.finSiblingId && !o.tasks);

// `poleRecipeLenOf` — the pole stream's own coat count (its -P recipe). Omitted, a pole reads against recipeLenOf, as before.
// `operator` / `users` / `from` / `writeLog` — a host that passes its signed-in person lets a manager send a finished document
// back to the floor from the history (`from` names the screen on the record). Omitted, the popup offers no action.
const WhereIsIt = ({ orders = [], extras = [], recipeLenOf = () => 0, poleRecipeLenOf = null, compact = false, operator = null, users = null, from = '', writeLog = null }) => {
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    // WHO DID WHAT, WHEN — one stamp open at a time: { id, key, keys }, its history read once at the click.
    const [openStamp, setOpenStamp] = useState(null);
    const [hist, setHist] = useState(null);           // { id, loading, rows, errors }
    const [showAll, setShowAll] = useState(false);
    const [busy, setBusy] = useState(false);
    const loadSeq = useRef(0);
    // THE CARD STAYS ON SCREEN (Stuart 2026-10-20: "when opens the details go off far to right, can you have menu move over to
    // left so we can still see all of it on screen"). It opens from the search box's left edge; a search sitting near the
    // right of the page (the finishing floor, the WMS header) pushed the 560px card past the window. Measured when it opens
    // and on resize: slid left by exactly the overflow, never past the left edge. Where it fits, it opens where it always did.
    const wrapRef = useRef(null);
    const [shiftX, setShiftX] = useState(0);
    const measure = useCallback(() => {
        const el = wrapRef.current;
        if (!el || typeof window === 'undefined') return;
        const r = el.getBoundingClientRect();
        const vw = (document.documentElement && document.documentElement.clientWidth) || window.innerWidth || 0;
        const over = r.left + Math.min(560, vw * 0.92) - (vw - 8);
        setShiftX(over > 0 ? -Math.min(over, Math.max(0, r.left - 8)) : 0);
    }, []);
    useEffect(() => {
        if (!open) return undefined;
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [open, measure]);
    const canReset = !!operator && (isFloorSupervisor(operator, users) || normRole(operator.role) === 'executive');
    const poleLenOf = (o) => (typeof poleRecipeLenOf === 'function' ? poleRecipeLenOf(o) : undefined);

    const loadHistory = async (o) => {
        const seq = ++loadSeq.current;
        setHist({ id: o.id, loading: true, rows: [], errors: [] });
        const errors = [];
        const safe = async (label, fn, dflt) => { try { return await fn(); } catch (e) { errors.push(`${label}: ${e.message || e}`); return dflt; } };
        // A shop job's floor punches are its finishing sibling's.
        const logIds = [...new Set([o.id, o.finSiblingId].filter(Boolean).map(String))];
        const [finLogs, outbox, shop] = await Promise.all([
            safe('floor log', async () => (await getDocs(query(collection(db, 'fin_logs'), where('woId', 'in', logIds)))).docs.map(d => ({ id: d.id, ...d.data() })), []),
            safe('NetSuite queue', async () => (await getDocs(query(collection(db, 'ns_outbox'), where('writeBack.docId', '==', String(o.id))))).docs.map(d => ({ id: d.id, ...d.data() })), []),
            o.shopSiblingId
                ? safe('shop job', async () => { const sn = await getDoc(doc(db, 'shop_custom_orders', String(o.shopSiblingId))); return sn.exists() ? { id: sn.id, ...sn.data() } : null; }, null)
                : Promise.resolve(o.finSiblingId && !o.tasks ? o : null),
        ]);
        if (seq !== loadSeq.current) return;           // another stamp was opened meanwhile
        setHist({ id: o.id, loading: false, rows: stampHistoryOf({ wo: o, finLogs, outbox, shop, recipeLen: recipeLenOf(o), poleRecipeLen: poleLenOf(o) }), errors });
    };
    const onStampOf = (o) => (stamp, keys) => {
        if (openStamp && openStamp.id === o.id && openStamp.key === stamp.key) { setOpenStamp(null); return; }
        setOpenStamp({ id: o.id, key: stamp.key, keys });
        setShowAll(false);
        if (!hist || hist.id !== o.id) loadHistory(o);
    };

    // ↩ NOT FINISHED — BACK TO THE FLOOR (WO11579): the one reset, from the history of a finished document.
    const resetToFloor = async (o) => {
        const ref = woRefOf(o);
        const refused = floorResetRefusalOf(o);
        if (refused) return alert(`${ref} cannot go back to the floor — ${refused}.`);
        const why = window.prompt(floorResetPromptOf(o, ref), '');
        if (why === null) return;
        if (!String(why).trim()) return alert('A reason is needed — it is what makes the rewind accountable. Nothing was changed.');
        setBusy(true);
        try {
            const r = await sendBackToFloor({ db, doc, getDoc, getDocs, query, collection, where, updateDoc, deleteField, addDoc, serverTimestamp, makeFullTasks },
                { finWo: o, by: (operator && operator.name) || '', why, from, ref });
            if (!r.ok) { alert(`${ref} cannot go back to the floor — ${r.refused}.`); return; }
            if (typeof writeLog === 'function') writeLog(`↩ ${ref} sent back to the floor — "${String(why).trim()}" · ${r.summary}`, 'production');
            alert(`↩ ${ref} is back in the Setup Queue.\n\n${r.summary}.`);
            loadHistory({ ...o, currentPhase: 'Setup' });
        } catch (e) {
            alert(`Could not send ${ref} back: ${e.message || e}`);
        } finally { setBusy(false); }
    };

    // OPEN WORK ONLY (Stuart 2026-09-16). The screens hand this whole collections, so without the
    // filter every job ever run answered the search. The rule is Shared/orderLifecycle.openForSearch
    // — the same "is this finished" the closer uses, so Complete is still open (the WMS has it) and
    // packed / put away / shipped / closed are not. Filtered BEFORE the slice, or eight finished
    // rows would crowd out the live one. What was hidden is COUNTED, never silently dropped.
    const hits = useMemo(() => {
        const term = U(q);
        if (term.length < 2) return { rows: [], hidden: 0 };
        // Match anything a person would actually shout across a room: the NetSuite WO, the app id,
        // the sales order, the item code, an alias, or the customer.
        const matched = orders.filter(o => ORDER_MATCH_FIELDS.some(f => U(o[f]).includes(term)));
        const live = matched.filter(openForSearch);
        return { rows: live.slice(0, 8), hidden: matched.length - live.length };
    }, [orders, q]);

    const extraHits = useMemo(() => {
        const term = U(q);
        if (term.length < 2) return { rows: [], hidden: 0 };
        // A PO answers to its number, its vendor AND every item riding it — "where is my
        // HCUMB410" should surface the inbound PO carrying it (Stuart 2026-08-31) — but only while
        // it is still coming: received, closed and deleted POs drop out, as do cut and cancelled
        // rod cuts (Shared/orderLifecycle.openExtraForSearch).
        const matched = extras.filter(d =>
            EXTRA_MATCH_FIELDS.some(f => U(d[f]).includes(term)) ||
            (Array.isArray(d.items) && d.items.some(it => U(it && it.itemId).includes(term)))
        );
        const live = matched.filter(openExtraForSearch);
        return { rows: live.slice(0, 6), hidden: matched.length - live.length };
    }, [extras, q]);

    // WHO DID WHAT, WHEN — the open stamp's history, under its order.
    const historyPanel = (o) => {
        const loaded = hist && hist.id === o.id ? hist : null;
        const rows = loaded ? (showAll ? loaded.rows : rowsForStamp(loaded.rows, openStamp.key, openStamp.keys)) : [];
        const allCount = loaded ? loaded.rows.length : 0;
        const finished = isFinishingDoc(o) && o.currentPhase === 'Complete';
        const refusal = finished && canReset ? floorResetRefusalOf(o) : null;
        const mono = { fontFamily: 'var(--mono)', fontSize: '10px' };
        return (
            <div style={{ marginTop: '8px', border: '1px solid var(--line)', background: 'var(--paper)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', padding: '7px 10px', borderBottom: '1px solid var(--line)', ...mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)' }}>
                    <span style={{ color: 'var(--ink)' }}>Who did what, when · {showAll ? STAMP_HEADING.ORDER : (STAMP_HEADING[openStamp.key] || openStamp.key)}</span>
                    {loaded && !loaded.loading && (
                        <button onClick={() => setShowAll(v => !v)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', ...mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--brass)', textDecoration: 'underline' }}>
                            {showAll ? 'just this stamp' : `all of this order (${allCount})`}
                        </button>
                    )}
                    <button onClick={() => setOpenStamp(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', padding: 0, cursor: 'pointer', ...mono, fontSize: '9px', color: 'var(--ink-soft)' }}>✕</button>
                </div>
                <div style={{ maxHeight: '300px', overflowY: 'auto', padding: '4px 0' }}>
                    {(!loaded || loaded.loading) && <div style={{ padding: '8px 10px', ...mono, color: 'var(--ink-soft)' }}>Reading the history…</div>}
                    {loaded && !loaded.loading && rows.length === 0 && (
                        <div style={{ padding: '8px 10px', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                            Nothing is recorded for this stamp yet{allCount ? ` — ${allCount} line${allCount === 1 ? '' : 's'} under the whole order` : ''}.
                        </div>
                    )}
                    {loaded && !loaded.loading && rows.map(r => (
                        <div key={r.key} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', padding: '3px 10px', ...mono, color: FLAG_COLOR[r.flag] || 'var(--ink)' }}>
                            <span style={{ color: 'var(--ink-soft)', minWidth: '96px' }}>{whenOf(r.at)}</span>
                            <b style={{ minWidth: '70px' }}>{r.who || '—'}</b>
                            <span style={{ flex: '1 1 220px' }}>
                                {r.what}
                                {r.coat ? <span style={{ color: 'var(--ink-soft)' }}>{` · coat ${r.coat}`}</span> : null}
                                {r.ran != null ? <span style={{ color: r.flag ? 'inherit' : 'var(--ink-soft)' }}>{` · ${ranOf(r.ran)}`}</span> : null}
                                {r.where ? <span style={{ color: 'var(--ink-soft)' }}>{` · ${r.where}`}</span> : null}
                                {r.note ? <i style={{ color: 'var(--ink-soft)' }}>{` (${r.note})`}</i> : null}
                            </span>
                        </div>
                    ))}
                    {loaded && loaded.errors && loaded.errors.length > 0 && (
                        <div style={{ padding: '6px 10px', ...mono, color: '#d9534f' }}>Could not read — {loaded.errors.join(' · ')}. What is shown is what could be read.</div>
                    )}
                </div>
                {finished && canReset && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '8px 10px', borderTop: '1px solid var(--line)', background: '#fff' }}>
                        {refusal
                            ? <span style={{ ...mono, color: 'var(--ink-soft)' }}>↩ Back to the floor is not available — {refusal}.</span>
                            : (<>
                                <button disabled={busy} onClick={() => resetToFloor(o)} style={{ padding: '7px 12px', background: 'transparent', border: '1px solid #c77d1a', color: '#c77d1a', cursor: busy ? 'wait' : 'pointer', ...mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em' }}>↩ Not finished — back to the floor</button>
                                <span style={{ ...mono, fontSize: '9px', color: 'var(--ink-soft)' }}>managers · back to Setup, coat 1 · {pickHappened(o) ? 'the pick stays' : 'the pick reopens'} · NetSuite untouched</span>
                            </>)}
                    </div>
                )}
            </div>
        );
    };

    const shown = hits.rows.length + extraHits.rows.length;
    const hidden = hits.hidden + extraHits.hidden;

    return (
        <div ref={wrapRef} style={{ position: 'relative', minWidth: compact ? '220px' : '300px' }}>
            <input
                value={q}
                onChange={e => { setQ(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                placeholder="🧭 Where is it? WO / SO / item…"
                style={{ width: '100%', boxSizing: 'border-box', padding: compact ? '8px 10px' : '10px 12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--mono)', fontSize: '11px', background: '#fff' }}
            />
            {open && q.trim().length >= 2 && (
                <div style={{ position: 'absolute', top: '100%', left: shiftX, zIndex: 900, width: 'min(560px, 92vw)', background: '#fff', border: '1px solid var(--line)', boxShadow: '0 10px 40px rgba(0,0,0,.18)', maxHeight: '60vh', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>
                        <span>{shown ? `${shown} open match${shown === 1 ? '' : 'es'}` : 'no open match on this screen'}</span>
                        <button onClick={() => { setQ(''); setOpen(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>close</button>
                    </div>
                    {shown === 0 && (
                        <div style={{ padding: '16px 14px', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
                            {hidden > 0
                                ? <>Nothing OPEN matches “{q.trim()}”. {hidden} finished or closed {hidden === 1 ? 'order matches' : 'orders match'} it — this search shows work that is still in production, on a purchase order or on a rod cut.</>
                                : <>Nothing here matches “{q.trim()}”. This searches the orders THIS screen is showing — a closed or not-yet-released order will not appear.</>}
                        </div>
                    )}
                    {hits.rows.map(o => {
                        const poleLen = typeof poleRecipeLenOf === 'function' ? poleRecipeLenOf(o) : undefined;
                        const st = orderStatusOf(o, { recipeLen: recipeLenOf(o), poleRecipeLen: poleLen });
                        const tone = stageTone(st.slowest);
                        const place = physicalPlaceOf(o);
                        return (
                            <div key={o.id} style={{ padding: '12px 14px', borderBottom: '1px solid var(--paper-2)' }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                    <b style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--ink)' }}>{woRefOf(o)}</b>
                                    <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{o.stockErpId || o.type || ''}{o.customerName || o.clientName || o.customer ? ` · ${o.customerName || o.clientName || o.customer}` : ''}</span>
                                    {st.isSplit && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)', textTransform: 'uppercase' }}>split</span>}
                                </div>
                                <OrderStatusChips wo={o} recipeLen={recipeLenOf(o)} poleRecipeLen={poleLen} onStamp={onStampOf(o)} activeKey={openStamp && openStamp.id === o.id ? openStamp.key : ''} />
                                {openStamp && openStamp.id === o.id && historyPanel(o)}
                                {/* A parked RTG record says what it is waiting on, in the gate list's words. */}
                                {gateSummary(o) && (
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--brass)', marginTop: '7px' }}>
                                        ⏳ parked · {gateSummary(o)}
                                    </div>
                                )}
                                {place && (
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)', marginTop: '7px' }}>
                                        📍 {place}
                                    </div>
                                )}
                                {/* The WO11453 class (2026-08-31): on the shelf, NetSuite never got the
                                    build. The 🔨 lives on the RTG card — this popup's one action is the back-to-the-floor reset. */}
                                {o.orderType === 'stock' && o.packStatus === 'Packed' && o.nsWoId && !o.nsWoCompletionPosted && (
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: '#d9534f', marginTop: '5px' }}>
                                        ⚠ NS build never posted — the shelf has the pieces, NetSuite shows none. Post it from this WO's card on RTG (🔨).
                                    </div>
                                )}
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: place ? '3px' : '7px', lineHeight: 1.5 }}>
                                    <span style={{ color: tone }}>NEXT</span> · {NEXT_MOVE[st.slowest] || '—'}
                                    {st.isSplit && <span> (that is the {stageLabel(st.slowest).toLowerCase()} half — the other is further along)</span>}
                                </div>
                            </div>
                        );
                    })}
                    {extraHits.rows.map(d => (
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
                    {/* Counted, not silently dropped (Stuart 2026-09-16: hidden count). Somebody
                        searching a shipped order gets told it exists and is finished, rather than
                        being left to think the tool is broken. There is deliberately no way to
                        expand it — the list itself stays open work only. */}
                    {shown > 0 && hidden > 0 && (
                        <div style={{ padding: '8px 14px', background: 'var(--paper-2)', borderTop: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.06em', color: 'var(--ink-soft)' }}>
                            {hidden} finished or closed match{hidden === 1 ? '' : 'es'} hidden — this search shows open work only.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default WhereIsIt;
