// ── AN ITEM KIT IS ONE THING SOLD AND SEVERAL THINGS MADE — ONE RULE, EVERY DOOR (Stuart 2026-09-28) ─────────────────
// "we will never stock these complete … the app kit is fine … for netsuite just push the 3 independent parts for
//  consumption … for the kit first look to /B or /C components for stock, if none then look to the /P and we paint,
//  if none then look for the raw component, so basically same rules as always."  "correct and very important rule for
//  all screens."
//
// A Kit-class record with `kitComponents` (and no `kitAlign` — a traverse SYSTEM kit is not this) is SOLD as one line —
// the kit: its price, the customer's number — and MADE, PICKED and CONSUMED as its PARTS, each wearing the kit's finish:
//   · a paint or plate finish (P06, EP4) — the part is finished like any line of that finish;
//   · the traverse stock colour 4.5 aligns (TCP → /C, TBR → /B) — the part's stocked colour item, from the shelf first;
//   · nothing, for a part tagged Unfinished (the clear acrylic end cap).
// CPQ's engine (Shared/hardwarePricing) and the order doors (tab 7, 10.5's re-read) take the parts and each part's finish
// from THIS module, so no two screens can read a kit differently. Each part is then sourced as any line is (Shared/
// oeGenerate's STOCK_FIRST door, Shared/splitPlan): a stock colour from the shelf, else painted from its /P, else
// converted from raw. The /B, /C, /EPn ASSEMBLY records of a kit are never stocked or built — a finished kit code names
// the kit and its finish (H1-2TRV-WB/C → the H1-2TRV-WB kit in TCP), nothing more. Pure — scripts/itemKit.test.mjs.
import { takesNoFinish } from './finishLabel.js';
import { STOCK_COLOUR_SUFFIX } from './finishVariant.js';
import { finishedCodeOf } from './subFinish.js';
import { isOutsourcedFinishCode } from './finishRouting.js';
import { isPoleCategory } from './poleCut.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const codeOf = (p) => U(p && (p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p.itemId));
// C → TCP, B → TBR: the sub finish a stock-colour suffix is made in (4.5; Shared/finishVariant.STOCK_COLOUR_SUFFIX).
const SUB_OF_SUFFIX = Object.fromEntries(Object.entries(STOCK_COLOUR_SUFFIX).map(([sub, sfx]) => [sfx, sub]));

/** An item kit (not a traverse system kit): Kit class, a component list, no kitAlign. */
export const isItemKit = (part) => !!part && part.partClass === 'Kit'
    && Array.isArray(part.manufacturingSpecs?.kitComponents) && part.manufacturingSpecs.kitComponents.length > 0
    && !part.manufacturingSpecs?.kitAlign;

/** The kit's parts, each with how many go into ONE kit. */
export const kitComponentsOf = (kitPart) => ((kitPart && kitPart.manufacturingSpecs && kitPart.manufacturingSpecs.kitComponents) || [])
    .map(c => ({ partId: c && c.partId, per: N(c && c.qty) > 0 ? N(c.qty) : 1 })).filter(c => c.partId);

// ── A KIT'S ROD IS ONE ROD OF THAT LENGTH, PER KIT (Stuart 2026-10-12, SO60812) ─────────────────────────────────────
// "always one rod of that length x qty on order." HRW-138TRAV12 is a 12 ft track: its part list says 12 × H1-138TRV,
// and H1-138TRV is counted by the FOOT — twelve feet of rod, not twelve rods. Multiplied like every other part, 100
// kits went on the order as "H1-138TRV × 1200" with no length: the automatic start stopped on it ("counts in feet and
// this line carries no cut length"), and the floor read 1200 pieces. A rod counted by the foot is PIECES AT A LENGTH —
// the shape a rod typed by hand in tab 7 has (qty = pieces, perFoot, feetPer, billedFeet): 100 rods × 12 ft, 1200 ft
// billed. NetSuite's quantity is the same 1200 ft either way (pieces × feet).
const FOOT_UOMS = ['FT', 'FOOT', 'FEET'];
const round3 = (n) => Math.round(N(n) * 1000) / 1000;
/** Is this item a rod counted by the FOOT (the Library's unit of measure; NetSuite's stock unit when that is blank)? */
export const isFootCountedRod = (part) => {
    const m = (part && part.manufacturingSpecs) || {};
    return !!part && isPoleCategory(U(m.productType || part.productType)) && FOOT_UOMS.includes(U(m.uom || m.stockUnit));
};
/** How ONE part of a kit goes on the order for `kits` kits: { qty } — or, a rod by the foot, { qty, perFoot, feetPer, billedFeet }. */
export const kitPartCountOf = (part, per, kits) => {
    const p = N(per) > 0 ? N(per) : 1, q = N(kits);
    return isFootCountedRod(part) ? { qty: q, perFoot: true, feetPer: p, billedFeet: round3(p * q) } : { qty: p * q };
};
/** The count fields a kit's rod line carries — a line edit that keeps the line's own quantity keeps these with it. */
export const KIT_PART_COUNT_FIELDS = ['perFoot', 'feetPer', 'billedFeet'];

/**
 * The finish ONE part of a kit wears: the kit's finish, else the kit's stock colour — nothing for a part tagged
 * Unfinished (the item wins, Shared/finishLabel.takesNoFinish), and nothing when the kit names neither.
 * @returns { finishCode, subFinishCode, noFinish }
 */
export const kitPartFinishOf = (part, { finishCode = '', subFinishCode = '' } = {}) => {
    if (!part || takesNoFinish(part)) return { finishCode: '', subFinishCode: '', noFinish: true };
    const f = U(finishCode);
    if (f) return { finishCode: f, subFinishCode: '', noFinish: false };
    const s = U(subFinishCode);
    return s ? { finishCode: '', subFinishCode: s, noFinish: false } : { finishCode: '', subFinishCode: '', noFinish: true };
};

/**
 * THE KIT A CODE NAMES, and the finish the code itself says (Stuart 2026-09-28: "do not worry about the assemblies we are
 * not stocking or building them"). The mill kit (H1-2TRV-WB) is itself; a finished code of it names the mill kit and its
 * finish — /C, /B the stock colour (TCP, TBR), /EPn, /Pn the finish, /P the phosphated parts (H1-2TRV-WB/P is its own
 * kit of /P parts, read as the mill kit primed). null when the code is not a kit.
 * @returns { kit, kitCode, finishCode, subFinishCode, primed } | null
 */
export const itemKitOfCode = (code, findByCode) => {
    const c = U(code);
    if (!c || typeof findByCode !== 'function') return null;
    const i = c.lastIndexOf('/');
    const base = i > 0 ? c.slice(0, i) : '', sfx = i > 0 ? c.slice(i + 1) : '';
    const baseKit = base ? findByCode(base) : null;
    if (sfx && isItemKit(baseKit)) {
        if (SUB_OF_SUFFIX[sfx]) return { kit: baseKit, kitCode: base, finishCode: '', subFinishCode: SUB_OF_SUFFIX[sfx], primed: false };
        if (sfx === 'P') return { kit: baseKit, kitCode: base, finishCode: '', subFinishCode: '', primed: true };
        return { kit: baseKit, kitCode: base, finishCode: sfx, subFinishCode: '', primed: false };
    }
    const self = findByCode(c);
    return isItemKit(self) ? { kit: self, kitCode: c, finishCode: '', subFinishCode: '', primed: false } : null;
};

/**
 * A KIT ON AN ORDER, AS ITS LINES — the order-line shape tab 7 and the 10.5 rows carry (erp / finishCode /
 * toBeFinished …). The kit line stays as it was sold (price, customer number), flagged `isKit` — never made, picked,
 * stocked or pushed as an item; each part rides beneath it:
 *   · a paint / plate finish → erp = the part's code, toBeFinished, finishCode (plated: finishOutsourced);
 *   · a stock colour → erp = its colour item (H1-2TRVBP/C), `subFinishCode` + `stockColour`: the shelf first, else painted;
 *   · primed (/P kit) → erp = the part's /P; no finish → the part's own code, `noFinish`.
 * The line's own finish wins over the finish its code names.
 * @param line        the order line naming the kit ({ erp | legacyErpId, qty, finishCode, subFinishCode, row, memo … })
 * @param findByCode  UPPERCASE code → library record
 * @param findPart    library doc id → library record (the kit's components are stored by id)
 * @returns { kitLine, parts: [line], missing: [partId] } | null when the line is not a kit
 */
export const itemKitOrderLinesOf = ({ line = {}, findByCode, findPart } = {}) => {
    const sold = U(line.erp || line.legacyErpId);
    const hit = itemKitOfCode(sold, findByCode);
    if (!hit) return null;
    const ownFinish = U(line.finishCode);
    const finishCode = ownFinish || hit.finishCode;
    const subFinishCode = finishCode ? '' : (U(line.subFinishCode) || hit.subFinishCode);
    const q = N(line.qty);
    const carry = {};
    ['row', 'memo', 'rowLabel', 'sidemark'].forEach(k => { if (line[k] != null && line[k] !== '') carry[k] = line[k]; });
    const missing = [];
    const parts = [];
    kitComponentsOf(hit.kit).forEach(c => {
        const part = typeof findPart === 'function' ? findPart(c.partId) : null;
        if (!part) { missing.push(String(c.partId)); return; }
        const code = codeOf(part);
        const f = kitPartFinishOf(part, { finishCode, subFinishCode });
        const base = {
            ...carry, name: part.itemName || code, partId: part.id || c.partId, ...kitPartCountOf(part, c.per, q), price: 0,
            inKit: true, kitOf: sold, hidden: true,
        };
        if (f.finishCode) {
            parts.push({ ...base, erp: code, finishCode: f.finishCode, toBeFinished: true, ...(isOutsourcedFinishCode(f.finishCode) ? { finishOutsourced: true } : {}) });
        } else if (f.subFinishCode) {
            parts.push({ ...base, erp: finishedCodeOf(code, f.subFinishCode), subFinishCode: f.subFinishCode, stockColour: true, toBeFinished: false });
        } else if (hit.primed && !takesNoFinish(part)) {
            parts.push({ ...base, erp: `${code}/P`, toBeFinished: false });
        } else {
            parts.push({ ...base, erp: code, noFinish: true, toBeFinished: false });
        }
    });
    const kitLine = { ...line, isKit: true, itemKit: true, kitCode: hit.kitCode, toBeFinished: false };
    return { kitLine, parts, missing };
};

/**
 * A KIT'S ROD SAVED BEFORE THE RULE ABOVE — feet in the quantity, no length (SO60812 line 4: H1-138TRV × 1200 under
 * HRW-138TRAV12). Read by the same rule: the kit says how many feet ONE rod is, so 1200 ft is 100 rods × 12 ft. The patch
 * is written on the line when its work is (re)planned (Shared/oeGenerate.oeLinePlansOf → stampLinePatch). null when the
 * line is not such a line, already carries a length, or its feet do not divide into whole rods (a person looks).
 * @returns { qty, perFoot, feetPer, billedFeet } | null
 */
export const kitRodLinePatchOf = ({ line = null, part = null, findByCode, findPart } = {}) => {
    if (!line || line.inKit !== true || !line.kitOf || line.perFoot || N(line.feetPer) > 0 || N(line.cutLength) > 0) return null;
    if (!isFootCountedRod(part)) return null;
    const hit = itemKitOfCode(line.kitOf, findByCode);
    if (!hit) return null;
    const code = codeOf(part);
    const comp = kitComponentsOf(hit.kit).find(c => { const p = typeof findPart === 'function' ? findPart(c.partId) : null; return (p && codeOf(p) === code) || String(c.partId) === String(part.id || ''); });
    const feet = N(line.qty);
    if (!comp || !(comp.per > 0) || !(feet > 0)) return null;
    const pieces = feet / comp.per;
    if (Math.abs(pieces - Math.round(pieces)) > 1e-9 || pieces < 1) return null;
    return { qty: Math.round(pieces), perFoot: true, feetPer: comp.per, billedFeet: round3(feet) };
};

/** The kit line of an order — sold and billed, never made, picked or stocked. */
export const isKitLine = (l) => !!l && (l.isKit === true || l.itemKit === true);

/**
 * A LINE TAKEN OFF THE ORDER (Stuart 2026-09-29 — SO60551's Base Back 1 end cap, quoted 9/16 as two lines under the kit's
 * code, the clear cap and its EP1 collar, which the kit rule then read as two whole kits). Stamped `offOrder` at quantity 0
 * by 10.5's kit quantity edit (Shared/displayRelease.kitQtyEditOf), KEPT IN ITS PLACE so every line number the floors and
 * the start stamps point at stays true. Nothing is started, picked, gathered or packed for it, and it needs nothing.
 */
export const isOffOrderLine = (l) => !!l && l.offOrder === true;
