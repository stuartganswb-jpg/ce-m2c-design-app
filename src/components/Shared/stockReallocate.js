// ── STOCK TO REALLOCATE — WHO WANTS IT, WHO NETSUITE HOLDS IT FOR (Stuart 2026-10-13) ───────────────────────────────
// "add the warning/scenario to end of day summary so we can reallocate stock if necessary prior to any build, but this
//  does not need to stop production." The material box on the floor says it per order and stops nothing; this is the
// same picture for management, every open order at once, read from NetSuite when the Day summary is opened:
//   SHORT  — the shelf does not physically hold what an order needs
//   HELD   — it does, but NetSuite has committed enough of it to OTHER orders that what is free does not cover this one
//   SHARED — each order is covered on its own, but together they want more than is free (orders NetSuite commits
//            nothing for yet each see the same free stock)
// One claim per release: the RTG record, its finishing document and its shop sibling carry the SAME material rows
// (Shared/materialGrid) and count once. A hold is an order's own by its sales-order / work-order number or id
// (Shared/stockHolds.ownRefsOf — the WMS warnings' rule). An item the read brought no figure for is left out: never a
// guess. Pure. scripts/stockReallocate.test.mjs asserts it.
import { ownRefsOf, holdsView } from './stockHolds.js';

const S = (v) => String(v == null ? '' : v).trim();
const U = (v) => S(v).toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const REALLOCATE = Object.freeze({ SHORT: 'SHORT', HELD: 'HELD', SHARED: 'SHARED' });
const RANK = { SHORT: 0, HELD: 1, SHARED: 2 };

const groupKeyOf = (coll, d) => (coll === 'shop_custom_orders' ? S(d.finSiblingId || d.id) : coll === 'hq_work_orders' ? S(d.finWoId || d.id) : S(d.id));
const codesOfRow = (r) => ((r.coverCodes && r.coverCodes.length) ? r.coverCodes.map(U) : [U(r.code)]).filter(Boolean);

/**
 * @param docs     [{ coll, d }] the open documents whose parts are not pulled yet (materialGrid.materialRefreshable)
 * @param figures  { CODE: { nsOnHand, nsCommitted } } (Shared/shelfFigures)
 * @param holds    { CODE: { committed, holds: [{ tid, tran, type, qty }] } } (Shared/stockHolds) — null when not read
 * @param refOf    (d) → the number people know the document by
 * @param soOf     (d) → its sales order record, when it has one (its NetSuite number / id make a hold the order's own)
 * @returns [{ code, name, kind, onHand, committed, free, wanted, orders: [{ id, ref, need, ownHeld, free, state, coveredBy }], heldFor: [{ tran, qty, ours }], holdersKnown }]
 *          free = on hand less what is held for anyone who is NOT one of the orders listed
 */
export function stockToReallocateOf({ docs = [], figures = {}, holds = null, refOf = (d) => (d && d.id) || '', soOf = () => null } = {}) {
    // 1. one claim per release
    const groups = new Map();
    (docs || []).forEach(({ coll, d }) => {
        if (!d) return;
        const key = groupKeyOf(coll, d);
        const g = groups.get(key) || { key, docs: [], lead: null, rows: new Map() };
        g.docs.push(d);
        if (coll === 'fin_workorders' || !g.lead) g.lead = d;
        (d.materialRows || []).forEach(r => {
            const code = U(r && r.code);
            const need = N(r && r.need);
            if (!code || !(need > 0)) return;
            const cur = g.rows.get(code);
            if (!cur || need > cur.need) g.rows.set(code, { code, name: S(r.name) || (cur && cur.name) || '', need, codes: codesOfRow(r), coveredBy: S(r.coveredBy) });
        });
        groups.set(key, g);
    });
    // 2. each order's own view of each item it wants
    const byCode = new Map();
    for (const g of groups.values()) {
        const own = ownRefsOf(...g.docs, ...g.docs.map(soOf).filter(Boolean));
        for (const r of g.rows.values()) {
            const known = r.codes.filter(c => figures && figures[c] && figures[c].nsOnHand != null);
            if (!known.length) continue;
            const onHand = known.reduce((a, c) => a + N(figures[c].nsOnHand), 0);
            const entries = holds ? r.codes.map(c => holds[c]).filter(Boolean) : [];
            const holdersKnown = !!holds;
            const merged = holdersKnown
                ? { committed: entries.reduce((a, e) => a + N(e.committed), 0), holds: entries.flatMap(e => e.holds || []) }
                : { committed: known.reduce((a, c) => a + N(figures[c].nsCommitted), 0), holds: [] };
            const view = holdsView(onHand, merged, own);
            // Without the holders, the whole commitment counts against the order (its own share cannot be told apart).
            const free = holdersKnown ? view.free : Math.max(0, onHand - merged.committed);
            const state = free >= r.need ? 'OK' : (onHand >= r.need ? REALLOCATE.HELD : REALLOCATE.SHORT);
            const e = byCode.get(r.code) || { code: r.code, name: r.name, onHand, committed: merged.committed, holds: merged.holds, holdersKnown, orders: [], ownRefs: new Set() };
            if (!e.name && r.name) e.name = r.name;
            own.forEach(v => e.ownRefs.add(v));
            e.orders.push({ id: g.key, ref: S(refOf(g.lead)) || g.key, need: r.need, ownHeld: holdersKnown ? view.ownHeld : null, free, state, coveredBy: r.coveredBy });
            byCode.set(r.code, e);
        }
    }
    // 3. the item, every order that wants it counted together
    const out = [];
    for (const e of byCode.values()) {
        const ours = (h) => e.ownRefs.has(U(h.tran)) || e.ownRefs.has(U(h.tid));
        const heldFor = e.holds.map(h => ({ tran: S(h.tran) || S(h.tid), qty: N(h.qty), ours: ours(h) })).sort((a, b) => b.qty - a.qty);
        const heldForOthers = e.holdersKnown ? heldFor.filter(h => !h.ours).reduce((a, h) => a + h.qty, 0) : N(e.committed);
        const free = Math.max(0, e.onHand - heldForOthers);
        const wanted = e.orders.reduce((a, o) => a + o.need, 0);
        const kind = e.orders.some(o => o.state === REALLOCATE.SHORT) ? REALLOCATE.SHORT
            : e.orders.some(o => o.state === REALLOCATE.HELD) ? REALLOCATE.HELD
                : (wanted > free ? REALLOCATE.SHARED : null);
        if (!kind) continue;
        e.orders.sort((a, b) => (a.state === 'OK') - (b.state === 'OK') || String(a.ref).localeCompare(String(b.ref), undefined, { numeric: true }));
        out.push({ code: e.code, name: e.name, kind, onHand: e.onHand, committed: N(e.committed), free, wanted, orders: e.orders, heldFor, holdersKnown: e.holdersKnown });
    }
    return out.sort((a, b) => (RANK[a.kind] - RANK[b.kind]) || a.code.localeCompare(b.code));
}

export const REALLOCATE_WORD = Object.freeze({
    [REALLOCATE.SHORT]: 'NOT ON THE SHELF',
    [REALLOCATE.HELD]: 'ON THE SHELF — COMMITTED TO OTHER ORDERS',
    [REALLOCATE.SHARED]: 'MORE WANTED THAN IS FREE',
});
const holdersLine = (item, max = 6) => {
    if (!item.holdersKnown) return 'who it is held for could not be read';
    if (!item.heldFor.length) return 'nothing committed';
    const shown = item.heldFor.slice(0, max).map(h => `${h.tran} ${h.qty}`);
    return shown.join(', ') + (item.heldFor.length > max ? ` +${item.heldFor.length - max} more` : '');
};
/** One order's line: what it needs against what is free for it. */
export const orderLine = (o) => `${o.ref} needs ${o.need}${o.ownHeld ? ` (${o.ownHeld} held for it)` : ''} — ${o.state === 'OK' ? `covered, ${o.free} free for it` : o.state === REALLOCATE.HELD ? `${o.free} free for it, the rest is committed to other orders` : `${o.free} free for it — short ${Math.max(0, o.need - o.free)}`}`;
export const holdersText = holdersLine;

/** The section as plain text, to paste or print. '' when there is nothing to reallocate. */
export function stockToReallocateText(items = []) {
    if (!items || !items.length) return '';
    const lines = ['STOCK TO REALLOCATE — every open order, as NetSuite reads now (nothing here stops the floor)'];
    items.forEach(it => {
        lines.push(`• ${it.code}${it.name ? ` — ${it.name}` : ''}: ${REALLOCATE_WORD[it.kind]} · on hand ${it.onHand} · committed ${it.committed} · wanted ${it.wanted} by ${it.orders.length} order${it.orders.length === 1 ? '' : 's'}`);
        it.orders.forEach(o => lines.push(`    ${orderLine(o)}`));
        lines.push(`    NetSuite holds it for: ${holdersLine(it, 12)}`);
    });
    return lines.join('\n');
}
