// 📦 FLAT-RATE SHIPPING, COUNTED IN BOXES (Eric 2026-09-29, App Imp: "Missing the Flat Rate shipping charges …
// Order requires the H1-SHIP-XL fee" · Stuart 2026-09-30: "push to the shipping cost field (NetSuite id:
// shippingcost)", and the rule).
//
// Fabricut's fee sheet (July 30) prices shipping by the BOX, not by the order:
//   H1-SHIP-S   small box — up to 2 windows, all components, ground ............ $22.50
//   H1-SHIP-M   poles 48"–94"   — up to 4 poles a box, or two poles with returns .. $45
//   H1-SHIP-L   poles 95"–104"  — up to 4 poles a box, or two poles with returns .. $155
//   H1-SHIP-XL  LTL freight 105"–120" — up to 10 poles, or 6 poles with returns .... $300
// Stuart's rule for counting them:
//   • the small box is for the small parts: one per two windows, and a window is a configuration — one line
//     × qty 3 is three windows; a pole under 48" rides in a small box;
//   • every other pole goes in a pole box, at its CUT length — a spliced pole ships as its pieces, which is
//     what splicing saves; shorter poles ride with longer ones, and a box is billed by its LONGEST pole;
//   • a traverse ships in a box by its length like any other pole (its track and clips are cut shorter and
//     ride with it), and a traverse pole takes the larger-systems packaging fee (H1-PCKF2) automatically.
// A box's price is the box ITEM's price for the customer (the one price chain); the total goes to the quote's
// shipping charge, which the push writes to NetSuite's shippingcost — never a line, never a fee. So a box item
// is SHIPPING wherever lists are built (isShippingItem): no checkout, fee or order-entry list offers it as a
// line. A customer ships flat rate when the box items are assigned to their checkout in 4.6.
//
// What a line tells us (the cart item the configurator writes): engineConfig.lengthInches = the sold length;
// answers.setup DOUBLE = two rod runs; answers.rodKind TRAVERSE = a traverse; the hand-added joiner rows
// (SPLICE / JOINER / JNR / SPLC) = its splices, their note = where; fee rows saying RETURN = its returns.
// A line with nothing cut by the foot has no pole — its parts ride in the small boxes. Pure.

import { configQtyOf } from './configQty.js';

export const FLAT_RATE_BOXES = Object.freeze([
    { key: 'S', code: 'H1-SHIP-S', label: 'Small box — up to 2 windows' },
    { key: 'M', code: 'H1-SHIP-M', label: 'Poles 48"–94"', fromIn: 48, cap: { plain: 4, returns: 2 } },
    { key: 'L', code: 'H1-SHIP-L', label: 'Poles 95"–104"', fromIn: 95, cap: { plain: 4, returns: 2 } },
    { key: 'XL', code: 'H1-SHIP-XL', label: 'LTL freight 105"–120"', fromIn: 105, cap: { plain: 10, returns: 6 } },
]);
export const WINDOWS_PER_SMALL_BOX = 2;
export const POLE_BOX_FROM_IN = 48;       // shorter rides in a small box
export const LONGEST_SHIPPABLE_IN = 120;  // longer must be spliced (the length step already insists)
export const TRAVERSE_PACK_FEE_CODE = 'H1-PCKF2';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const BOX_CODES = new Set(FLAT_RATE_BOXES.map(b => b.code));
const codeOfPart = (p) => U(p && (p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p.itemId));

/** A flat-rate box item is shipping: it goes to the shipping charge, never onto the order as a line. */
export const isShippingItem = (part) => BOX_CODES.has(codeOfPart(part));

/** Which box a pole of this length goes in ('S' under 48"). Bands meet: 94.5" is M, 95" is L, 104.9" is L. */
export function boxKeyFor(lengthIn) {
    const n = N(lengthIn);
    if (n < POLE_BOX_FROM_IN) return 'S';
    if (n < 95) return 'M';
    if (n < 105) return 'L';
    return 'XL';
}
const boxOf = (key) => FLAT_RATE_BOXES.find(b => b.key === key);

const SPLICE_RE = /SPLICE|JOINER|JNR|SPLC/;
const isSpliceRow = (l) => !!l && !l.isFee && SPLICE_RE.test(U(`${l.legacyErpId || ''} ${l.name || ''}`));
const isReturnFeeRow = (l) => !!l && !!l.isFee && !l.isKit && /RETURN/.test(U(l.name));
const isLinearRow = (l) => !!l && !l.isFee && (l.perFoot === true || N(l.cutLength) > 0);
export const isTraverseLine = (item) => {
    const ec = (item && item.engineConfig) || {};
    return U((ec.answers || {}).rodKind) === 'TRAVERSE' || !!(item && (item.traverseDraw || (Array.isArray(item.trvComponents) && item.trvComponents.length)));
};

/** Where the splices fall, from their note ('36" from left edge · 30" from right edge', 'center'); null = unread. */
export function splicePositionsOf(note, lengthIn) {
    const L = N(lengthIn), t = String(note || '');
    if (!(L > 0) || !t.trim()) return null;
    const out = [];
    const re = /(\d+(?:\.\d+)?)\s*(?:"|in(?:ch(?:es)?)?\b|'')?\s*from\s*(?:the\s*)?(left|right)/gi;
    let m;
    while ((m = re.exec(t))) { const d = N(m[1]); out.push(/right/i.test(m[2]) ? L - d : d); }
    const centres = (t.match(/\bcent(?:er|re)\b/gi) || []).length;
    for (let i = 0; i < centres; i++) out.push(L / 2);
    const inside = out.filter(p => p > 0 && p < L).sort((a, b) => a - b);
    return inside.length ? inside : null;
}

/** The pieces one run of length L is cut into by n splices: at the noted spots when the note names them all, else evenly. */
export function cutPiecesOf(lengthIn, splices, note = '') {
    const L = N(lengthIn), n = Math.max(0, Math.floor(N(splices)));
    if (!(L > 0)) return [];
    if (!n) return [L];
    const at = splicePositionsOf(note, L);
    if (at && at.length === n) {
        const edges = [0, ...at, L];
        return edges.slice(1).map((e, i) => Math.round((e - edges[i]) * 100) / 100);
    }
    const piece = Math.round((L / (n + 1)) * 100) / 100;
    return Array.from({ length: n + 1 }, () => piece);
}

/**
 * The poles ONE configuration of a line ships as. → [{ lengthIn, withReturn, traverse }]
 * Runs: two for a double. Splices are shared out across the runs (the first runs take any odd one); returns go
 * two to a run, on its end pieces. The line's qty is NOT applied here (shippingPlanOf does that).
 */
export function polePiecesOf(item) {
    const pb = (item && Array.isArray(item.pricingBreakdown)) ? item.pricingBreakdown : [];
    const linear = pb.filter(isLinearRow);
    if (!linear.length) return [];
    const ec = (item && item.engineConfig) || {};
    const L = N(ec.lengthInches) > 0 ? N(ec.lengthInches) : Math.max(...linear.map(l => N(l.cutLength)));
    if (!(L > 0)) return [];
    const runs = U((ec.answers || {}).setup) === 'DOUBLE' ? 2 : 1;
    const spliceRows = pb.filter(isSpliceRow);
    const splices = spliceRows.reduce((s, l) => s + (N(l.qty) || 1), 0);
    const note = runs === 1 ? spliceRows.map(l => l.customNote || '').filter(Boolean).join(' · ') : '';
    const returns = pb.filter(isReturnFeeRow).reduce((s, l) => s + (N(l.qty) || 1), 0);
    const traverse = isTraverseLine(item);
    const out = [];
    for (let r = 0; r < runs; r++) {
        const s = Math.floor(splices / runs) + (r < splices % runs ? 1 : 0);
        const ret = Math.min(2, Math.max(0, returns - 2 * r));
        const cuts = cutPiecesOf(L, s, note);
        cuts.forEach((lengthIn, i) => out.push({
            lengthIn,
            withReturn: ret > 0 && (cuts.length === 1 || i === 0 || (ret >= 2 && i === cuts.length - 1)),
            traverse,
        }));
    }
    return out;
}

/**
 * The boxes a cart ships in. → { windows, counts: { S, M, L, XL }, boxes, shortPoles, tooLong, traverseConfigs }
 * boxes = the pole boxes, each { key, code, pieces: [lengthIn…], plain, returns } — packed longest first, each
 * pole into the first box with room (a shorter pole rides in a longer box; the box is billed as its longest).
 */
export function shippingPlanOf(items) {
    const lines = (Array.isArray(items) ? items : []).filter(it => it && !it.isFee && !it.isAddOn);
    const windows = lines.reduce((s, it) => s + configQtyOf(it), 0);
    const all = [];
    let traverseConfigs = 0;
    lines.forEach(it => {
        const q = configQtyOf(it);
        const pieces = polePiecesOf(it);
        if (isTraverseLine(it) && pieces.length) traverseConfigs += q;
        for (let k = 0; k < q; k++) pieces.forEach(p => all.push(p));
    });
    const shortPoles = all.filter(p => p.lengthIn < POLE_BOX_FROM_IN).length;
    const poles = all.filter(p => p.lengthIn >= POLE_BOX_FROM_IN)
        .sort((a, b) => b.lengthIn - a.lengthIn || Number(b.withReturn) - Number(a.withReturn));
    const boxes = [];
    // A box holds plain/cap.plain + returns/cap.returns ≤ 1 — kept in whole numbers so 6 × ⅙ is exactly full.
    const fits = (b, p) => {
        const { plain: cp, returns: cr } = boxOf(b.key).cap;
        const plain = b.plain + (p.withReturn ? 0 : 1), ret = b.returns + (p.withReturn ? 1 : 0);
        return plain * cr + ret * cp <= cp * cr;
    };
    poles.forEach(p => {
        let b = boxes.find(x => fits(x, p));
        if (!b) { const key = boxKeyFor(p.lengthIn); b = { key, code: boxOf(key).code, pieces: [], plain: 0, returns: 0 }; boxes.push(b); }
        b.pieces.push(p.lengthIn);
        if (p.withReturn) b.returns += 1; else b.plain += 1;
    });
    const counts = { S: windows > 0 ? Math.ceil(windows / WINDOWS_PER_SMALL_BOX) : 0, M: 0, L: 0, XL: 0 };
    boxes.forEach(b => { counts[b.key] += 1; });
    return { windows, counts, boxes, shortPoles, tooLong: poles.filter(p => p.lengthIn > LONGEST_SHIPPABLE_IN).length, traverseConfigs };
}

/**
 * The money: each box count × that box's price for this customer. → { rows: [{ key, code, label, qty, unit, total }], total, missing }
 * `priceOf(code)` → the box item's price, or null when the customer has no such box (then it is named in `missing`).
 */
export function shippingChargeOf(plan, priceOf) {
    const rows = [], missing = [];
    FLAT_RATE_BOXES.forEach(b => {
        const qty = (plan && plan.counts && plan.counts[b.key]) || 0;
        if (!qty) return;
        const unit = typeof priceOf === 'function' ? priceOf(b.code) : null;
        if (unit == null) { missing.push(b.code); return; }
        rows.push({ key: b.key, code: b.code, label: b.label, qty, unit: N(unit), total: Math.round(qty * N(unit) * 100) / 100 });
    });
    return { rows, total: Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100, missing };
}
