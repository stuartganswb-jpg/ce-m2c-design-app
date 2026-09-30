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
import { soLineCodeOf, soLineIsFee, soLineIsShelfPick, soCodeNeedOf, soPackLineStateOf } from './pickLines.js';
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
        const take = Math.max(0, Math.min(N(x.l.qty), left));
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
        if (!soLineIsShelfPick(so, l, idx)) return;
        seen.add(code);
        const need = soCodeNeedOf(so, code, isFeeCode), have = committedQtyOf(so, code);
        const qty = Math.max(0, need - have);
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
