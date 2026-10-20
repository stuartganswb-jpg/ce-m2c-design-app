// WHAT A STOCKED ITEM IS, ON EVERY QUICK SHIP DOOR — tab 7's counter, the customer portal's Quick Ship page and its server. Tab 7's own
// helpers (HQ/QuickShipTab.js), moved word for word on 2026-10-20 (Stuart: "add and align") so the three read one rule. The portal page and
// its server had kept mirrors that drifted: a pole was any name CONTAINING "POLE" or "ROD" (tab 7 asks poleCut.isPoleCategory, a whole word,
// since 2026-09-01), and an item categorised only by its customData.category was invisible there and accepted on submit. Pure.
import { isPoleCategory } from './poleCut.js';
import { SIZE_FAMILIES } from './sizeMatrix.js';

// Map a part's productType/name to one of our slot categories.
export const classifyCat = (pt) => {
    const t = String(pt || '').toUpperCase();
    if (t.includes('BACKPLATE') || t.includes('BACK PLATE')) return 'BACKPLATE';
    if (t.includes('BRACKET')) return 'BRACKET';
    if (t.includes('FINIAL')) return 'FINIAL';
    if (t.includes('RING')) return 'RING';
    if (isPoleCategory(t)) return 'POLE';
    return '';
};
/** The slot category of an item: its product type, else its category. */
export const catOf = (it) => classifyCat(it.manufacturingSpecs?.productType || it.productType || it.customData?.category);
export const erpOf = (it) => String(it.legacyErpId || it.itemId || '').toUpperCase();
export const nsIdOf = (it) => it.netSuiteInternalId || it.legacyErpId || it.itemId || '';

// Collection tags on an item, uppercased — the SAME shape CPQ/Vision scope by
// (manufacturingSpecs.collections, legacy single customData.collection).
export const collectionsOf = (it) => (it.manufacturingSpecs?.collections
    || (it.manufacturingSpecs?.customData?.collection ? [it.manufacturingSpecs.customData.collection] : []))
    .map(c => String(c || '').trim().toUpperCase()).filter(Boolean);

// A diameter cell's words ("Round · 1-3/8"").
export const diaCellLabel = (cell) => {
    const [fam, dia] = String(cell || '').split('|');
    const opt = SIZE_FAMILIES[fam]?.dia?.options?.find(o => o.value === dia);
    return opt ? `${SIZE_FAMILIES[fam].label} · ${opt.label}` : cell;
};

// An inside-mount bracket takes the customer's Inside Mount pack; every other bracket sells each.
export const isInsideMount = (it) => /INSIDE/.test(String(it?.manufacturingSpecs?.customData?.bracketType || it?.manufacturingSpecs?.customData?.bracketMount || '').toUpperCase());

// The finish code, i.e. everything after the suffix separator. "H2-75FB/CC" → "CC".
export const finishCodeOf = (it) => erpOf(it).split('/')[1] || '';

// SELLABLE vs MILL (Stuart 2026-07-25): a code with no "/FINISH" suffix is the raw base part we buy and paint — it never goes to an end
// customer. Only finished variants (/CC, /WC, …) are offered in the kit builder.
export const isFinished = (it) => erpOf(it).includes('/');

// A finish as the Quick Ship screens hold it (tab 7's finish list): in-house from system/master_finishes (with the species a stain consumes),
// outsourced from hq_outsource_finishes — whose code falls back to its NAME (EP3–EP6 are stored name-only).
export const quickShipFinishOf = (f, outsourced = false) => (outsourced
    ? { code: String(f.code || f.name).trim().toUpperCase(), name: f.name || f.code, outsourced: true, subFinishCode: String(f.subFinishCode || '').toUpperCase(), material: String(f.material || '').toUpperCase() }
    : { code: String(f.code || f.name).trim().toUpperCase(), name: f.name || f.code, outsourced: false, subFinishCode: String(f.subFinishCode || '').toUpperCase(), bomSuffix: String(f.bomSuffix || '').trim(), material: String(f.material || '').toUpperCase() });
