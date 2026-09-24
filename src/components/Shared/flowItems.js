// FLOW ITEMS — every SKU a CPQ flow can sell, laid out as FAMILY BLOCKS and priced exactly the way a
// Fabricut quote prices it. The rows of HQ 4.7 Flow Stock (Stuart 2026-09-24: "a view that shows our
// item#, fabricut id#, our sales price, their sales price, then our stock situation … organize it via
// tabs by the cpq flows so H1-75, H1-1, H1-138").
//
// ⚠ THIS MODULE DECIDES NOTHING. It is a view over answers that already have owners:
//   • which parts a flow carries   → partLookup.buildLookupIndex — the SAME pin index the CPQ part
//                                    lookup reads (one row per pin; parked pins dropped here).
//   • which finishes a part wears  → the flow's offered finishes (HardwareConfigurator's rule) ×
//                                    hardwareModel.finishesFor (the material gate) × finishLabel.
//                                    takesNoFinish (the item tag).
//   • which SKU a finish is sold as, what it costs Fabricut, what Fabricut sells it at, and their
//     pattern number → hardwarePricing.priceChoice, the function the quote itself calls. A board
//     that re-derived any of these would be a second source of truth about what the quote says.
//
// Pure: no Firestore, no React. The caller owns the reads (flows, library, pins, finishes, the
// Fabricut customer) and hands them in. Harness: scripts/flowItems.test.mjs.

import { buildLookupIndex, ourCodeOf } from './partLookup.js';
import { priceChoice, PRICE_SOURCES, isItemKit } from './hardwarePricing.js';
import { finishesFor } from './hardwareModel.js';
import { takesNoFinish } from './finishLabel.js';

const clean = (v) => String(v ?? '').trim();
const U = (v) => clean(v).toUpperCase();

// ── THE PARTS THE ENGINE IS GIVEN, AND HOW IT FINDS ONE ──────────────────────────────────────
// A variant the engine cannot find bills the mill code, so the board must search exactly the set the
// engine searches, exactly the way it searches it — or it would show /EP3 rows the quote never bills.
//   set:    CPQTab → <HardwareConfigurator parts={[...libraryParts, ...liveAssemblies, ...itemKits]}>,
//           where libraryParts = Inventory / Fee / Alias or checkout-ticked, liveAssemblies =
//           Assembly / Master Assembly (the ~2,600 /P /EP variants live here), itemKits = isItemKit.
//   lookup: HardwareConfigurator.partIndex — id, itemId, legacyErpId, UPPERCASED, first one wins.
// Both copied, not re-thought; if either changes there, it changes here.
export function enginePartsOf(brandDocs = []) {
    const docs = brandDocs || [];
    const libraryParts = docs.filter(d => ['Inventory', 'Fee', 'Alias'].includes(d.partClass) || d.manufacturingSpecs?.checkoutSelectable === true);
    const liveAssemblies = docs.filter(d => d.partClass === 'Assembly' || d.partClass === 'Master Assembly');
    const itemKits = docs.filter(d => d.partClass === 'Kit').filter(isItemKit);
    return [...libraryParts, ...liveAssemblies, ...itemKits];
}
export function partFinderOf(parts = []) {
    const m = new Map();
    (parts || []).forEach(pt => [pt.id, pt.itemId, pt.legacyErpId].forEach(k => {
        const kk = String(k || '').trim().toUpperCase();
        if (kk && kk !== 'PENDING' && !m.has(kk)) m.set(kk, pt);
    }));
    return (id) => m.get(String(id || '').trim().toUpperCase()) || null;
}

/** The tab label: the flow's own name without the generator's " — GENERATED" tail ("H1-138"). */
export const flowLabelOf = (flow) =>
    clean(flow?.name).replace(/\s*[—–-]+\s*GENERATED\s*$/i, '').trim() || clean(flow?.id);

/**
 * The tabs: every flow with a linked assembly, in the CPQ picker's order — size groups first (by
 * group label, members by sizeGroupSort: Fabricut H1 → 3/4", 1", 1-3/8"), then the ungrouped flows
 * by name. A flow with no assembly (pillows, legacy manual flows) has no pins to list and is left out.
 */
export function flowTabsOf(flows = [], assemblyFor) {
    const linked = (flows || []).filter(f => f && typeof assemblyFor === 'function' && assemblyFor(f));
    const byName = (a, b) => flowLabelOf(a).localeCompare(flowLabelOf(b), undefined, { numeric: true, sensitivity: 'base' });
    const grouped = linked.filter(f => clean(f.sizeGroupLabel)).sort((a, b) =>
        clean(a.sizeGroupLabel).localeCompare(clean(b.sizeGroupLabel))
        || (Number(a.sizeGroupSort) || 0) - (Number(b.sizeGroupSort) || 0)
        || byName(a, b));
    const loose = linked.filter(f => !clean(f.sizeGroupLabel)).sort(byName);
    return [...grouped, ...loose].map(f => ({ flowId: f.id, label: flowLabelOf(f), group: clean(f.sizeGroupLabel), flow: f }));
}

/** A finish record's code, read the way the configurator reads it. */
export const finishCodeOf = (f) => clean(f?.code || f?.finishCode || f?.name || f?.id);

// The finishes the flow offers — HardwareConfigurator's `offeredFinishes` rule, word for word
// (HardwareConfigurator.js, "offeredFinishes"): the flow's own list when it has one, else all.
// Kept identical on purpose; if that rule changes, this line changes with it.
export function offeredFinishesOf(flow, finishes = []) {
    const flowFinishes = Array.isArray(flow?.flowFinishes) ? flow.flowFinishes : [];
    return flowFinishes.length
        ? finishes.filter(f => flowFinishes.includes(f.code || f.finishCode || f.name || f.id))
        : finishes;
}

// Section order and names on the board. Roles are the tag engine's vocabulary (hardwareModel.ROLES);
// EXTRA is the flow's own add-ons (flow.extraItems — joiners, splices, track fees).
export const ROLE_SECTIONS = [
    ['ROD', 'Rods & poles'], ['FASCIA', 'Fascia'], ['TRACK', 'Track'], ['TRV_END', 'Traverse ends'],
    ['BRACKET', 'Brackets & arms'], ['BACKPLATE', 'Plates'], ['RING', 'Rings'], ['FINIAL', 'Finials'],
    ['INSIDE_MOUNT', 'Inside mounts'], ['RETURN', 'Returns'], ['CARRIER', 'Carriers'], ['FCLIP', 'F-clips'],
    ['ACCESSORY', 'Accessories'], ['EXTRA', 'Extras (flow add-ons)'],
];
const ROLE_RANK = new Map(ROLE_SECTIONS.map(([r], i) => [r, i]));
const ROLE_LABEL = new Map(ROLE_SECTIONS);

// Variant order inside a family: the paint rollup, then other paint-family codes, then plated,
// then anything else — the order the finishing floor thinks in.
const suffixRank = (code) => {
    const s = U(code).split('/')[1] || '';
    if (s === 'P') return 0;
    if (/^P\d+$/.test(s)) return 1;
    if (/^EP\d*$/.test(s)) return 2;
    return 3;
};
const byVariant = (a, b) => suffixRank(a.code) - suffixRank(b.code)
    || a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' });

// Classes that NetSuite holds no stock for — a fee is a charge, a kit is sold as its components.
const NON_STOCK_CLASSES = new Set(['Fee', 'Kit']);

/**
 * The flow's items as family blocks.
 *
 * @param flow      the cpq_flows doc
 * @param assembly  its linked Approved_Designs doc
 * @param pins      that assembly's assembly_pins
 * @param findPart  (key) → library doc by doc id / itemId / our code (the CPQ lookup's resolver)
 * @param finishes  the finish records the engine is given ([...master_finishes, ...hq_outsource_finishes])
 * @param priceCtx  { customerId, customer, outsourceCodes, findByCode, finishObjOf } — the Fabricut
 *                  customer's context; the level is set per column here and is always CHOSEN (a
 *                  Fabricut quote at that level), never the defaulted kind.
 * @returns {{ sections: Array<{role, label, families}>, skus: Array<row> }}
 *          family = { key, role, name, hidden, rows: [row] }
 *          row    = { key, code, name, part, kind: 'MILL'|'VARIANT'|'SOLE'|'MISSING', finishes: [codes],
 *                     fabCode, ourPrice: {value, source}|null, theirPrice: number|null,
 *                     internalId, stockable }
 */
export function flowFamilies({ flow, assembly, pins = [], findPart, finishes = [], priceCtx = {} } = {}) {
    const rows = buildLookupIndex({
        flows: flow ? [flow] : [], assemblyFor: () => assembly || null, pinsFor: () => pins || [],
        findPart, aliasCtx: priceCtx,
    });

    // ONE FAMILY PER PART. The index is one row per PIN — a rod pinned per side, a plate pinned plain
    // and in-line — which is the truth about the assembly, but the board lists what is SOLD.
    const families = new Map();
    const add = (key, part, choice, role, name, hidden) => {
        let fam = families.get(key);
        if (!fam) { fam = { key, part, choice, role: U(role) || 'ACCESSORY', name, hidden: !!hidden }; families.set(key, fam); }
        else if (!hidden) fam.hidden = false;           // visible on any pin = visible
        return fam;
    };
    rows.forEach(r => {
        if (r.choice?.parked) return;                   // parked pins are not offered to anyone
        add(r.part?.id || `code:${U(r.ours)}`, r.part, r.choice, r.role, r.name, r.hidden);
    });
    // The flow's add-ons are sellable items of the flow too (tab 11 → extraItems).
    (Array.isArray(flow?.extraItems) ? flow.extraItems : []).forEach(x => {
        const code = clean(x?.code);
        if (!code) return;
        const part = typeof findPart === 'function' ? findPart(code) : null;
        const key = part?.id || `code:${U(code)}`;
        if (families.has(key)) return;
        add(key, part, { id: `extra:${code}`, partId: part?.id || code, role: 'EXTRA' }, 'EXTRA', clean(x.label) || part?.itemName || code, false);
    });

    const offered = offeredFinishesOf(flow, finishes);
    const skus = new Map();
    const rowFor = (part, code, kind, finishCodes, priced) => {
        const row = {
            key: `${kind}:${U(code)}`, code, name: clean(part?.itemName), part: part || null, kind,
            finishes: finishCodes, fabCode: '', ourPrice: null, theirPrice: null,
            internalId: clean(part?.netSuiteInternalId),
            stockable: !!part && !NON_STOCK_CLASSES.has(part.partClass),
        };
        if (priced) Object.assign(row, priced);
        if (!skus.has(U(code))) skus.set(U(code), row);
        return row;
    };

    const out = [];
    families.forEach(fam => {
        const base = fam.part;
        const baseCode = base ? ourCodeOf(base) : clean(fam.choice?.partId);
        if (!base) {
            out.push({ ...fam, rows: [rowFor(null, baseCode, 'MISSING', [], null)] });
            return;
        }
        // One call per column, through the quote's own function. ourPrice keeps its source so the
        // board can say WHY (tier / their row / base price / flow default); theirPrice is only ever
        // the Fabricut tier — anything else in that column would be our number wearing their label.
        const price = (finishCode) => {
            const ctx = { ...priceCtx, finishCode, levelIsDefault: false, fallbackPrices: flow?.fallbackPrices || null };
            const cost = priceChoice(fam.choice, base, { ...ctx, priceLevel: 'FAB_COST' });
            const sell = priceChoice(fam.choice, base, { ...ctx, priceLevel: 'FAB_WHOLESALE' });
            return {
                billedId: clean(cost.billedId) || baseCode,
                fabCode: clean(cost.sku || cost.aliasCode),
                ourPrice: cost.source === PRICE_SOURCES.NONE ? null : { value: cost.price, source: cost.source },
                theirPrice: sell.source === PRICE_SOURCES.LEVEL ? sell.price : null,
            };
        };
        const wears = (takesNoFinish(base) || fam.choice?.noFinish) ? [] : finishesFor(fam.choice || {}, offered);
        if (!wears.length) {
            // Sold as itself: no finish to resolve (joiner, clear acrylic, a part tagged unfinished).
            const p = price('');
            out.push({ ...fam, rows: [rowFor(base, baseCode, 'SOLE', [], { fabCode: p.fabCode, ourPrice: p.ourPrice, theirPrice: p.theirPrice })] });
            return;
        }
        // Each offered finish → the SKU the quote bills. Every paint collapses onto /P, each plating is
        // its own /EPn; a finish with no variant record bills the mill code, which the mill row shows.
        const sold = new Map();
        wears.forEach(f => {
            const fc = finishCodeOf(f);
            if (!fc) return;
            const p = price(fc);
            const id = U(p.billedId);
            const s = sold.get(id) || { code: p.billedId, finishes: [], priced: p };
            s.finishes.push(fc);
            sold.set(id, s);
        });
        const millSold = sold.get(U(baseCode));
        const mill = rowFor(base, baseCode, 'MILL', millSold ? millSold.finishes : [],
            millSold ? { fabCode: millSold.priced.fabCode, ourPrice: millSold.priced.ourPrice, theirPrice: millSold.priced.theirPrice } : null);
        const variants = [...sold.values()]
            .filter(s => U(s.code) !== U(baseCode))
            .map(s => rowFor(typeof findPart === 'function' ? findPart(s.code) : null, s.code, 'VARIANT', s.finishes,
                { fabCode: s.priced.fabCode, ourPrice: s.priced.ourPrice, theirPrice: s.priced.theirPrice }))
            .sort(byVariant);
        out.push({ ...fam, rows: [mill, ...variants] });
    });

    const sections = [];
    out.sort((a, b) => a.rows[0].code.localeCompare(b.rows[0].code, undefined, { numeric: true, sensitivity: 'base' }))
        .forEach(fam => {
            let sec = sections.find(s => s.role === fam.role);
            if (!sec) { sec = { role: fam.role, label: ROLE_LABEL.get(fam.role) || fam.role, families: [] }; sections.push(sec); }
            sec.families.push({ key: fam.key, role: fam.role, name: fam.name, hidden: fam.hidden, rows: fam.rows });
        });
    sections.sort((a, b) => (ROLE_RANK.has(a.role) ? ROLE_RANK.get(a.role) : 99) - (ROLE_RANK.has(b.role) ? ROLE_RANK.get(b.role) : 99));
    return { sections, skus: [...skus.values()] };
}

/**
 * Not yet ordered or put into production: nothing available and nothing on order. Only a stockable
 * row that NetSuite knows (an internal id) can be judged — a row with no stock reading is UNKNOWN,
 * never "not covered", so an unread row can never masquerade as a gap (validator-refusal rule).
 *
 * @param row    a flowFamilies row
 * @param stock  { avail, onOrd } for that row, or undefined when not read
 */
export function notCovered(row, stock) {
    if (!row?.stockable || !row.internalId || !stock) return false;
    return (Number(stock.avail) || 0) <= 0 && (Number(stock.onOrd) || 0) <= 0;
}
