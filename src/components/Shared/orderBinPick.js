// ── EVERY PIECE INTO THE ORDER'S BIN BEFORE IT PACKS (Stuart 2026-09-30, SO60551 at SO Pack) ──────────────────────────
// "if all these items are truly ready to take from their committed ready bin and actually be packed then on this
//  screen, it should show the qty of each line in the bin ORDERS-COM1 line by line … this order at this point should
//  be showing 100% ready to pack" — and: "once it is all picked to the Orders-Com1 bin you do a bin transfer and put
//  it there even in netsuite, otherwise Bin count and stock view will fail."
//
// An order moves through three stages at SO Pack:
//   WAITING  something is still coming (a floor document not gathered, or the shelf cannot cover a line);
//   PICK     every floor piece is in the order's bin and the shelf covers the rest — pick the shelf lines INTO the bin
//            (a NetSuite bin transfer, shelf bin → the order's bin, and the order's count);
//   PACK     every piece of every line is in the order's bin — the card shows only what is in it, line by line.
// The rules are here; PickPackApp posts the transfers. Pure. scripts/orderBinPick.test.mjs.
import { soLineCodeOf, soLineIsFee, soLineIsShelfPick, soCodeNeedOf, soPackLineStateOf, soLineReleasedOf, soCodeReleasedOf, soCodeReleasedNeedOf, soShelfToPickOf } from './pickLines.js';
import { isReleaseByCount } from './rowRelease.js';
import { committedQtyOf } from './committedBins.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** The lines that carry pieces (no fee, kit line or line taken off the order), with their index. */
export const pieceLinesOf = (so, isFeeCode = null) => ((so && so.lines) || [])
    .map((l, idx) => ({ l, idx }))
    .filter(x => x.l && soLineCodeOf(x.l) && !soLineIsFee(so, x.l, x.idx, isFeeCode));

/** What of an item this line holds in the order's bin: the item's gathered count, handed to its lines in order. */
export const lineBinShareOf = (so, idx, isFeeCode = null) => {
    const lines = pieceLinesOf(so, isFeeCode);
    const me = lines.find(x => x.idx === idx);
    if (!me) return 0;
    const code = soLineCodeOf(me.l);
    let left = committedQtyOf(so, code);
    for (const x of lines) {
        if (soLineCodeOf(x.l) !== code) continue;
        // A line of an order released by count holds no more than has been released of it (Shared/rowRelease).
        const cap = isReleaseByCount(so) ? soLineReleasedOf(so, x.l, x.idx, isFeeCode).total : N(x.l.qty);
        const take = Math.max(0, Math.min(cap, left));
        if (x.idx === idx) return take;
        left -= take;
    }
    return 0;
};

/**
 * Where the order stands. `statOf(code)` is SO Pack's stock read for a shelf line ({ avail, held, prod }).
 * @returns { stage: 'WAITING' | 'PICK' | 'PACK', waiting: [code], toPick: [code] }
 */
export const soGatherStageOf = ({ so, statOf = () => null, isFeeCode = null } = {}) => {
    const lines = pieceLinesOf(so, isFeeCode);
    if (!lines.length) return { stage: 'WAITING', waiting: [], toPick: [] };
    // EVERYTHING HAS SHIPPED (a display order's last display gone): nothing is needed in the bin any more.
    if (lines.every(({ l }) => soCodeNeedOf(so, soLineCodeOf(l), isFeeCode) === 0) && Object.keys((so && so.shippedQty) || {}).length) return { stage: 'SHIPPED', waiting: [], toPick: [] };
    if (isReleaseByCount(so)) return releasedStageOf({ so, statOf, isFeeCode, lines });
    const waiting = new Set(), toPick = new Set();
    lines.forEach(({ l, idx }) => {
        const code = soLineCodeOf(l);
        if (committedQtyOf(so, code) >= soCodeNeedOf(so, code, isFeeCode)) return;
        const st = soPackLineStateOf({ so, line: l, idx, stat: statOf(code), isFeeCode });
        if (!st.fromFloor && st.state === 'READY') toPick.add(code);
        else waiting.add(code);
    });
    const stage = waiting.size ? 'WAITING' : (toPick.size ? 'PICK' : 'PACK');
    return { stage, waiting: [...waiting], toPick: [...toPick] };
};

// ── THE SAME THREE STAGES, AGAINST WHAT IS RELEASED (Stuart 2026-10-05, Shared/rowRelease) ───────────────────────────
// An order released by count is asked only for the displays in motion: an item nothing has been released of is neither
// waited for nor picked. WAITING = a released piece is still coming (a floor document not gathered, or the shelf cannot
// cover a released pick); PICK = the shelf covers what is released and not yet in the bin; PACK = every released piece
// is in the bin. `partial` says more of the order is still to release; `anyReleased` false = nothing is in motion yet.
const releasedStageOf = ({ so, statOf, isFeeCode, lines }) => {
    const waiting = new Set(), toPick = new Set();
    let anyReleased = false, partial = false;
    [...new Set(lines.map(({ l }) => soLineCodeOf(l)))].forEach(code => {
        const rel = soCodeReleasedOf(so, code, isFeeCode);
        const whole = lines.filter(({ l }) => soLineCodeOf(l) === code).reduce((a, { l }) => a + N(l.qty), 0);
        if (rel.total < whole) partial = true;
        if (!(rel.total > 0)) return;
        anyReleased = true;
        const have = committedQtyOf(so, code), need = soCodeReleasedNeedOf(so, code, isFeeCode);
        const out = Math.max(0, need - have);
        if (!out) return;
        const pick = Math.min(soShelfToPickOf(so, code, isFeeCode), out);
        if (out - pick > 0) waiting.add(code);          // the rest comes off a floor
        if (pick > 0) {
            const st = statOf(code);
            const free = st && st.avail != null ? Math.max(0, N(st.avail)) : null;
            const covered = Math.max(have, st ? N(st.held) : 0) + (free != null ? free : 0);   // the order's view, as soPackLineStateOf reads it
            if (free != null && covered >= have + pick) toPick.add(code); else waiting.add(code);
        }
    });
    const stage = (!anyReleased || waiting.size) ? 'WAITING' : (toPick.size ? 'PICK' : 'PACK');
    return { stage, waiting: [...waiting], toPick: [...toPick], byCount: true, anyReleased, partial };
};

/**
 * ONE DISPLAY SHIPS WHEN A DISPLAY'S WORTH OF EVERY ROW IS IN THE BIN (Stuart 2026-10-05: "if we make 10pcs of row 1 and 25
 * of row 2 and 7pc of row 3, the maximum that could be shipped would be 7"). How many whole displays the order's bin holds
 * right now: the scarcest item decides. 0 when a line does not divide by the display, or anything is missing.
 */
export const shippableDisplaysOf = ({ so, boards, isFeeCode = null } = {}) => {
    const b = Math.floor(N(boards));
    if (!(b > 0)) return 0;
    const per = new Map();
    let bad = false;
    pieceLinesOf(so, isFeeCode).forEach(({ l }) => {
        const p = N(l.qty) / b;
        if (!Number.isInteger(p)) { bad = true; return; }
        if (p > 0) per.set(soLineCodeOf(l), (per.get(soLineCodeOf(l)) || 0) + p);
    });
    if (bad || !per.size) return 0;
    let n = Infinity;
    per.forEach((need, code) => { n = Math.min(n, Math.floor(committedQtyOf(so, code) / need)); });
    const left = b - ((so && so.displayShipments) || []).length;
    return Math.max(0, Math.min(Number.isFinite(n) ? n : 0, left));
};

/**
 * THE SHELF PICKS STILL TO MAKE, each from real bins: per item, what the order still needs in its bin, taken from the
 * item's live bins largest first (the order's own bin is never a source). A need no bins cover is named, not picked.
 * @param binsOf  code → [{ bin, name, qty }] (the WMS live read)
 * @param only    one code, or all
 * @returns [{ code, need, have, qty, from: [{ bin, qty }], ok, why }]
 */
export const shelfPickPlanOf = ({ so, binsOf = () => [], toBin = '', only = null, isFeeCode = null } = {}) => {
    const seen = new Set();
    const out = [];
    pieceLinesOf(so, isFeeCode).forEach(({ l, idx }) => {
        const code = soLineCodeOf(l);
        if (seen.has(code) || (only && U(only) !== code)) return;
        // Released by count: every item with a shelf share released and not yet picked — whichever of its lines says so.
        const byCount = isReleaseByCount(so);
        if (!byCount && !soLineIsShelfPick(so, l, idx)) return;
        if (byCount && !(soCodeReleasedOf(so, code, isFeeCode).shelf > 0)) return;
        seen.add(code);
        const need = byCount ? soCodeReleasedNeedOf(so, code, isFeeCode) : soCodeNeedOf(so, code, isFeeCode), have = committedQtyOf(so, code);
        const qty = byCount ? Math.min(soShelfToPickOf(so, code, isFeeCode), Math.max(0, need - have)) : Math.max(0, need - have);
        if (!qty) return;
        const bins = (binsOf(code) || []).filter(b => b && (b.name || b.bin) && N(b.qty) > 0 && U(b.name || b.bin) !== U(toBin))
            .sort((a, b) => N(b.qty) - N(a.qty));
        const from = [];
        let left = qty;
        for (const b of bins) {
            if (left <= 0) break;
            const take = Math.min(left, N(b.qty));
            from.push({ bin: b.name || b.bin, qty: take });
            left -= take;
        }
        out.push({ code, need, have, qty, from, ok: left <= 0, why: left > 0 ? `only ${qty - left} of ${qty} on the shelf${bins.length ? '' : ' (no bin holds it)'}` : '' });
    });
    return out;
};

// ── THE ORDER'S BIN IN NETSUITE (Stuart 2026-09-30: "once all 50 are shipped there should be 0 of anything on hand in
// the orders-com1 bin") ─────────────────────────────────────────────────────────────────────────────────────────────
// NetSuite never holds an in-house finish: "there are no assemblies for the /P09 finished items … you are committing the
// /P stock item and the app is handling the finish." So each piece line stands in NetSuite for ONE item:
//   · a shelf pick — the stock item the pick moved (the plated /EPn, the stock colour /C, the stocked part);
//   · a floor line — the item the order BILLS (billedErp: the shared /P of a painted part), else its base item;
//     a rod sold by the foot moves in FEET (pieces × feet per piece), as NetSuite stocks it.
// ORDERS-COM1 must hold, in NetSuite, every gathered piece as that item — each showroom shipment then fulfils 1/boards
// of every line from it, and the bin ends at 0.

/** The NetSuite item a piece line stands for. */
export const nsItemOf = (so, line, idx) => U(soLineIsShelfPick(so, line, idx) ? soLineCodeOf(line) : (line && (line.billedErp || line.erp)));
/** Pieces of a line → NetSuite's quantity of its item (feet for a rod sold by the foot). */
export const nsQtyOf = (line, pieces) => (line && line.perFoot && N(line.feetPer) > 0) ? Math.round(N(pieces) * N(line.feetPer) * 1000) / 1000 : N(pieces);

/**
 * WHAT THE ORDER'S BIN SHOULD HOLD IN NETSUITE, against what has been moved there (so.nsBinQty, per NetSuite item):
 * every piece line's gathered share, as its NetSuite item and quantity. `qty` > 0 is still to move in.
 * @returns [{ code, want, have, qty, lines: [idx] }]
 */
export const nsBinPlanOf = ({ so, isFeeCode = null } = {}) => {
    const by = new Map();
    pieceLinesOf(so, isFeeCode).forEach(({ l, idx }) => {
        const code = nsItemOf(so, l, idx);
        if (!code) return;
        const cur = by.get(code) || { code, want: 0, lines: [] };
        cur.want = Math.round((cur.want + nsQtyOf(l, lineBinShareOf(so, idx, isFeeCode))) * 1000) / 1000;
        cur.lines.push(idx);
        by.set(code, cur);
    });
    const held = (so && so.nsBinQty) || {};
    return [...by.values()].map(r => {
        const have = N(held[r.code]);
        return { ...r, have, qty: Math.max(0, Math.round((r.want - have) * 1000) / 1000) };
    });
};

/** Sources for moving `qty` of an item into the order's bin: its live bins, largest first, never the order's own bin. */
export const binSourcesOf = (bins = [], qty, toBin = '') => {
    const from = [];
    let left = N(qty);
    [...(bins || [])].filter(b => b && (b.name || b.bin) && N(b.qty) > 0 && U(b.name || b.bin) !== U(toBin))
        .sort((a, b) => N(b.qty) - N(a.qty))
        .forEach(b => { if (left <= 0) return; const take = Math.min(left, N(b.qty)); from.push({ bin: b.name || b.bin, qty: Math.round(take * 1000) / 1000 }); left = Math.round((left - take) * 1000) / 1000; });
    return { from, short: Math.max(0, left) };
};

/**
 * ONE DISPLAY OF AN ORDER (Stuart 2026-09-30: "we fulfill one at a time (1/50 logic works) at $0.00 on new sales orders
 * to the showrooms"): every piece line's quantity ÷ boards, as the pieces the box gets and the NetSuite item and quantity
 * the showroom's order carries. Refused when a line does not divide evenly or its bin does not hold a display's worth.
 * @returns { ok, why, lines: [{ idx, code, name, row, pieces, nsCode, nsQty }] }
 */
export const displayShareOf = ({ so, boards, isFeeCode = null } = {}) => {
    const b = Math.floor(N(boards));
    if (!(b > 0)) return { ok: false, why: 'the order does not say how many displays it is', lines: [] };
    const lines = [], bad = [];
    pieceLinesOf(so, isFeeCode).forEach(({ l, idx }) => {
        const q = N(l.qty), per = q / b;
        if (!Number.isInteger(per)) { bad.push(`${soLineCodeOf(l)}: ${q} does not divide into ${b} displays`); return; }
        lines.push({ idx, code: soLineCodeOf(l), name: String(l.name || ''), row: String(l.row || ''), pieces: per, nsCode: nsItemOf(so, l, idx), nsQty: nsQtyOf(l, per) });
    });
    // The bin is counted per ITEM (an item on two lines shares one count), so a display is checked per item too.
    const perCode = new Map();
    lines.forEach(x => perCode.set(x.code, (perCode.get(x.code) || 0) + x.pieces));
    perCode.forEach((need, code) => { const have = committedQtyOf(so, code); if (have < need) bad.push(`${code}: the bin holds ${have}, a display needs ${need}`); });
    return { ok: !bad.length, why: bad.join('; '), lines };
};

/**
 * THE MOVES THAT PUT AN ORDER'S BIN RIGHT IN NETSUITE: per item still to go in (nsBinPlanOf), first what NetSuite ALREADY
 * shows in the order's bin beyond what the app moved there — stock put straight into that bin by hand (an adjustment of
 * pieces NetSuite never held); a committed bin belongs to one order, so it is this order's — counted, not moved; then the
 * rest from the item's live bins. What neither covers is `short`.
 * @param plan    nsBinPlanOf(...) rows with qty > 0
 * @param binsOf  code → [{ bin, name, qty }] (the WMS live read, the order's bin included)
 * @returns [{ code, qty, credit, from: [{ bin, qty }], short }]
 */
export const nsBinMovesOf = ({ plan = [], binsOf = () => [], toBin = '' } = {}) => plan.map(r => {
    const bins = binsOf(r.code) || [];
    const inBin = bins.filter(b => U((b && (b.name || b.bin)) || '') === U(toBin)).reduce((a, b) => a + N(b.qty), 0);
    const credit = Math.round(Math.min(N(r.qty), Math.max(0, inBin - N(r.have))) * 1000) / 1000;
    const src = binSourcesOf(bins, Math.round((N(r.qty) - credit) * 1000) / 1000, toBin);
    return { code: r.code, qty: N(r.qty), credit, from: src.from, short: src.short };
});
