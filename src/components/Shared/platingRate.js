// ── THE PLATER'S RATE FOR ONE STAGED LINE (Stuart 2026-09-28) ─────────────────────────────────────────────────────────
// "poles are always set at our cost of $20.00 per foot … $25 for the H1-2 poles … H1-75SR ok at $25 as well … there are
//  no stock plating poles, always custom."
//
// The ship modal's default $/ea read the Plating Fees rule for the line's product type — and a CUSTOM pole's line carried
// no item id and no length, while every pole in the library is typed just "Pole" (the rules are POLE ROUND / POLE
// SQUARE), so SO60551's two plated pole lines shipped with a blank rate (PO2340, typed by hand). Now:
//   · a pole's rule comes from its SHAPE — its product line says it ("1\" ROUND", "3/4\" SQUARE", "2\" RECTANGULAR"):
//     ROUND → POLE ROUND ($20/ft); SQUARE or RECTANGULAR → POLE SQUARE ($25/ft); anything else by its product type;
//   · a custom pole's qty is PIECES, so a per-foot rule is fee × the piece's feet (feetPerPiece, carried from the shop
//     job through the plating demand); a stock pull's pole qty is already in feet, so its rule applies to qty as before.
// The operator can still type a $/ea; that wins. Pure — scripts/platingRate.test.mjs asserts it.
import { isPoleCategory } from './poleCut.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** The item's product line ("1\" ROUND"), where the library keeps it. */
const productLineOf = (part) => {
    const ms = (part && part.manufacturingSpecs) || {};
    const cd = ms.customData || {};
    const wl = ms.watchList || (cd.watchlist && cd.watchlist !== 'N/A' ? cd.watchlist : '');
    return U(wl);
};

/** A pole's plating class by its shape: 'POLE ROUND' | 'POLE SQUARE' | '' (shape unknown). */
export const polePlatingClassOf = (part) => {
    const said = `${productLineOf(part)} ${U(part && part.itemName)}`;
    if (/\b(SQUARE|RECTANGULAR)\b/.test(said)) return 'POLE SQUARE';
    if (/\bROUND\b/.test(said)) return 'POLE ROUND';
    return '';
};

/** The Plating Fees rule for an item: a pole by its shape, anything else by its product type. null when none. */
export const platingRuleOf = (part, rules = {}) => {
    const pt = U(part && part.manufacturingSpecs && part.manufacturingSpecs.productType);
    if (isPoleCategory(pt)) {
        const k = polePlatingClassOf(part);
        if (k && rules[k]) return { key: k, ...rules[k] };
    }
    return pt && rules[pt] ? { key: pt, ...rules[pt] } : null;
};

const perFoot = (unit) => /^(FT|FOOT|FEET)$/.test(U(unit));

/**
 * The default rate for one staged plating line, per unit of its qty (the modal's $/ea).
 * @param line   the plating_shipments line ({ custom, feetPerPiece, qty })
 * @param part   its library item (a custom line: the base item by code)
 * @param rules  system/plating_fees.rules — { TYPE: { fee, unit } }
 */
export const platingLineRateOf = ({ line = {}, part = null, rules = {} } = {}) => {
    const r = platingRuleOf(part, rules);
    if (!r) return 0;
    const fee = N(r.fee);
    if (line && line.custom === true && perFoot(r.unit)) {
        const ft = N(line.feetPerPiece);
        return ft > 0 ? Math.round(fee * ft * 100) / 100 : 0;
    }
    return fee;
};
