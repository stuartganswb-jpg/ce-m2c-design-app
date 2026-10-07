// ── THE TRAVERSE STATION — the parts loaded ONTO the track keep to their own bucket (Stuart 2026-10-07) ──────────
// "the traverse components should be kept in their own bucket and once finishing is complete then we can alert the
//  traverse station that the order is ready and give them the pick list so they can check and confirm, and actually
//  load the tracks with the components and confirm the tracks/rods are loaded then the order can be packed."
// His calls: the bucket is ONLY what gets loaded onto the track (carriers, master carriers, end stops, pulleys,
// batons — not brackets) · the STATION picks them from the shelf, AFTER finishing · on an order released by count it
// confirms the displays released · its pick makes the NetSuite bin transfer into the order's bin, in place of SO
// Pack's · a CPQ order gets the same tick and the same gate ("now") · the station is a WMS tab, granted per role.
//
// WHICH PARTS: the ITEM says so — a tick in the Library ("Loaded onto the track", customData.trackLoaded). Nothing is
// read from a name or a code, and until an item is ticked nothing here changes anything.
//
// TWO DOORS, ONE RULE. Every traverse order of the 45 days before this was an Order Entry order (the display rows, tab
// 7), where the components are lines of the SALES ORDER, picked from the shelf into the order's bin by a NetSuite bin
// transfer; a CPQ order carries them on its finishing documents' parts lists. So:
//   ORDER ENTRY   a line whose item is ticked is not offered to SO Pack's pick — the station picks it (the same bin
//                 transfer), then confirms how many displays are LOADED; SO Pack counts a display complete, and the
//                 order ready, only as far as that count.
//   CPQ           a parts-list line stamped `trackLoaded` is kept off the pick BEFORE finishing; every finishing
//                 document of the order carries `traverseGate: 'WAITING'` and cannot be packed until the station
//                 confirms, which stamps them LOADED.
// The station's record lives on the sales order (`traverseStation`). Pure — scripts/traverseStation.test.mjs.
import { soLineCodeOf, soLineIsFee, soCodeNeedOf, soCodeReleasedNeedOf, soShelfToPickOf } from './pickLines.js';
import { isReleaseByCount } from './rowRelease.js';
import { committedQtyOf } from './committedBins.js';
import { customPartsReady } from './orderStatus.js';
import { isTrackLoadedPart, isTrackLoadedLine, isStationPickLine, trackStampOf, TRAVERSE_GATE, traverseWaitOf } from './trackLoaded.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── which parts, and the document gate — the leaf facts (Shared/trackLoaded), re-exported for the station's callers ──
export { isTrackLoadedPart, isTrackLoadedLine, isStationPickLine, trackStampOf, TRAVERSE_GATE, traverseWaitOf };

// ── is finishing done? ────────────────────────────────────────────────────────────────────────────────────────
/**
 * The station is alerted once FINISHING IS COMPLETE for what is in motion: every open floor document of the order
 * is off the finishing floor (or needs no finishing) with its shop half back — or already gathered / packed.
 * @returns {{ done: boolean, open: Array<doc>, none: boolean }}
 */
export function finishingDoneOf(docs = []) {
    const live = (docs || []).filter(d => d && !d.deleted && d.currentPhase !== 'Closed');
    const finished = (d) => ['Packed', 'Gathered'].includes(String(d.packStatus || '')) || ((d.currentPhase === 'Complete' || d.pickOnly === true) && customPartsReady(d));
    const open = live.filter(d => !finished(d));
    return { done: open.length === 0, open, none: live.length === 0 };
}

// ── the record on the sales order ─────────────────────────────────────────────────────────────────────────────
/** How many displays (1 = the whole order, when it is not a display order) the station has confirmed LOADED. */
export const loadedUnitsOf = (so) => Math.max(0, Math.floor(N(so && so.traverseStation && so.traverseStation.loaded)));
/** The record after a confirmation: the count, who and when, and the history. */
export const loadedPatchOf = (so, units, { by = '', now = Date.now() } = {}) => {
    const prev = (so && so.traverseStation) || {};
    return { ...prev, loaded: Math.max(0, Math.floor(N(units))), loadedAt: now, loadedBy: String(by || ''),
        log: [...(Array.isArray(prev.log) ? prev.log : []), { loaded: Math.max(0, Math.floor(N(units))), at: now, by: String(by || '') }].slice(-40) };
};

// ── ORDER ENTRY: the components are lines of the sales order ──────────────────────────────────────────────────
const pieceLines = (so, isFeeCode) => ((so && so.lines) || []).map((l, idx) => ({ l, idx })).filter(x => x.l && soLineCodeOf(x.l) && !soLineIsFee(so, x.l, x.idx, isFeeCode));
/** The item codes of the order that are loaded onto the track. */
export const oeTrackCodesOf = ({ so, isTrackCode = () => false, isFeeCode = null } = {}) =>
    [...new Set(pieceLines(so, isFeeCode).map(x => soLineCodeOf(x.l)).filter(c => isTrackCode(c)))];

/**
 * THE STATION'S VIEW OF AN ORDER ENTRY ORDER.
 * @param boards  the displays the order makes (a display order) — else it is one unit
 * @returns {{
 *   codes, lines: Array<{ code, name, ordered, need, have, toPick, perUnit }>, units, shipped, loaded,
 *   canLoadTo,     // the most that can be confirmed loaded now: displays shipped + whole displays of EVERY track part in the bin
 *   toPick,        // pieces still to pick from the shelf, in all
 *   loadedAll,     // every unit in motion is loaded
 *   tracks: Array<{ code, name, qty, cutLength }>   // the tracks / rods being loaded (lines the order marks as the track)
 * }}
 */
export function oeStationOf({ so, isTrackCode = () => false, isFeeCode = null, boards = 0 } = {}) {
    const codes = oeTrackCodesOf({ so, isTrackCode, isFeeCode });
    const b = Math.floor(N(boards)) > 0 ? Math.floor(N(boards)) : 1;
    const byCount = isReleaseByCount(so);
    const shippedUnits = b > 1 ? ((so && so.displayShipments) || []).length : 0;
    const lines = codes.map(code => {
        const mine = pieceLines(so, isFeeCode).filter(x => soLineCodeOf(x.l) === code);
        const ordered = mine.reduce((a, x) => a + N(x.l.qty), 0);
        const need = soCodeReleasedNeedOf(so, code, isFeeCode);        // what the bin should hold now (released, less shipped)
        const have = committedQtyOf(so, code);
        const toPick = byCount ? Math.min(soShelfToPickOf(so, code, isFeeCode), Math.max(0, need - have)) : Math.max(0, soCodeNeedOf(so, code, isFeeCode) - have);
        return { code, name: String((mine[0] && mine[0].l.name) || ''), ordered, need, have, toPick, perUnit: ordered / b };
    });
    // Whole units the bin covers for EVERY track part (the scarcest decides) — on top of what has already shipped.
    const inBinUnits = lines.length
        ? lines.reduce((m, r) => Math.min(m, r.perUnit > 0 ? Math.floor(r.have / r.perUnit + 1e-9) : Infinity), Infinity) : 0;
    const canLoadTo = lines.length ? Math.min(b, shippedUnits + (Number.isFinite(inBinUnits) ? inBinUnits : 0)) : 0;
    const loaded = Math.min(loadedUnitsOf(so), b);
    // The units in motion: every display released of the track parts (the scarcest part), the whole order otherwise.
    const releasedUnits = lines.length
        ? Math.min(b, lines.reduce((m, r) => Math.min(m, r.perUnit > 0 ? Math.floor((r.need + (N(((so && so.shippedQty) || {})[r.code]))) / r.perUnit + 1e-9) : Infinity), Infinity))
        : 0;
    const tracks = pieceLines(so, isFeeCode).filter(x => U(x.l.trvRole) === 'TRACK')
        .map(x => ({ code: soLineCodeOf(x.l), name: String(x.l.name || ''), qty: N(x.l.qty), cutLength: x.l.cutLength != null ? x.l.cutLength : null, row: String(x.l.row || x.l.memo || '') }));
    return {
        codes, lines, units: b, shipped: shippedUnits, loaded, canLoadTo,
        releasedUnits: Number.isFinite(releasedUnits) ? releasedUnits : 0,
        toPick: lines.reduce((a, r) => a + r.toPick, 0),
        loadedAll: lines.length > 0 && loaded >= (Number.isFinite(releasedUnits) ? releasedUnits : 0) && (Number.isFinite(releasedUnits) ? releasedUnits : 0) > 0,
        tracks,
    };
}

/** Why a number of displays may not be confirmed loaded, or ''. */
export const loadRefusal = (station, units) => {
    const n = Math.floor(N(units));
    if (!station || !station.lines.length) return 'This order has no part that is loaded onto a track.';
    if (!(n >= 0) || n !== N(units)) return 'Enter a whole number.';
    if (n > station.units) return `The order is ${station.units} ${station.units === 1 ? 'unit' : 'displays'} in all.`;
    if (n < station.shipped) return `${station.shipped} ${station.shipped === 1 ? 'display has' : 'displays have'} already shipped — the count cannot go below that.`;
    if (n > station.canLoadTo) return `Only ${station.canLoadTo} can be loaded: the bin holds the track parts for ${Math.max(0, station.canLoadTo - station.shipped)} more than have shipped. Pick the rest first.`;
    return '';
};

/**
 * WHAT SO PACK MAY DO WITH AN ORDER ENTRY ORDER THAT HAS TRACK PARTS.
 *   shipCap  the most displays that may ship now: those LOADED, less those already shipped (Infinity = no track parts)
 *   wait     the sentence for the card when the order is not ready to pack for want of the station, or ''
 */
export function oeTraverseGateOf({ so, isTrackCode = () => false, isFeeCode = null, boards = 0 } = {}) {
    const st = oeStationOf({ so, isTrackCode, isFeeCode, boards });
    if (!st.lines.length) return { has: false, shipCap: Infinity, wait: '', station: st };
    const shipCap = Math.max(0, st.loaded - st.shipped);
    const wait = st.loaded >= st.releasedUnits && st.releasedUnits > 0 ? ''
        : (st.toPick > 0 ? 'traverse station: its components are not picked and loaded yet' : 'traverse station: the tracks are not confirmed loaded yet');
    return { has: true, shipCap, wait, station: st };
}

// ── CPQ: the components are on the finishing documents ────────────────────────────────────────────────────────
/**
 * The track-loaded parts of an order's finishing documents, one row per item: [{ code, name, qty, pick, docs: [id] }].
 * `pick` = the pieces the STATION takes off the shelf; the rest of `qty` reaches it off the finishing floor (painted).
 */
export function docTrackLinesOf(docs = []) {
    const by = new Map();
    (docs || []).filter(d => d && !d.deleted && d.currentPhase !== 'Closed').forEach(d => (d.partsList || []).filter(isTrackLoadedLine).forEach(l => {
        const code = U(l.legacyErpId || l.partId);
        if (!by.has(code)) by.set(code, { code, name: String(l.name || l.partName || ''), qty: 0, pick: 0, docs: [] });
        const r = by.get(code);
        const q = N(l.pcs) || N(l.quantity != null ? l.quantity : l.qty);
        r.qty += q;
        if (isStationPickLine(l)) r.pick += q;
        if (!r.docs.includes(d.id)) r.docs.push(d.id);
    }));
    return [...by.values()];
}
/** A CPQ order's finishing documents that the station's gate holds, and whether it is lifted. */
export function cpqStationOf(docs = []) {
    const live = (docs || []).filter(d => d && !d.deleted && d.currentPhase !== 'Closed');
    const gated = live.filter(d => d.traverseGate === TRAVERSE_GATE.WAITING || d.traverseGate === TRAVERSE_GATE.LOADED);
    return { lines: docTrackLinesOf(live), gated, waiting: gated.filter(d => d.traverseGate === TRAVERSE_GATE.WAITING), loaded: gated.length > 0 && gated.every(d => d.traverseGate === TRAVERSE_GATE.LOADED) };
}
/** The stamp every gated finishing document takes when the station confirms the tracks loaded. */
export const loadedDocStampOf = ({ by = '', now = Date.now() } = {}) => ({ traverseGate: TRAVERSE_GATE.LOADED, traverseLoadedAt: now, traverseLoadedBy: String(by || '') });
