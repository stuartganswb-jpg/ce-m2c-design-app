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
