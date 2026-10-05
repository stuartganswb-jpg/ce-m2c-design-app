// ── A CUSTOMER ROW FROM THE TIERS — ONE READER, ONE SOURCE PER ROW (Stuart 2026-10-04, 4.6 · H1-138BST) ──────────
// "i am trying to hit the button seed fabricut row from tiers, which i thought would copy the same information i
//  have on the base item onto all the stocked /ep finishes, but its behavior is weird."
// Three things were wrong, all in 4.6's own copy of the rule:
//   · the reader did not know what the price engine knows — a finish variant with no tier box of its own INHERITS
//     the base item's tiers (Shared/priceLevels.fabricutPriceOf, 2026-08-12). So CPQ quoted H1-138BST/EP1 at the
//     plated tier while 4.6 showed the variant blank and its seed said "No sellable tier price on this item";
//   · it filled a row field by field: the base's own cost ($13) beside the PAINTED wholesale and retail (24 / 48)
//     — one row, two sources;
//   · the button wrote the one item whose editor was open, never its finishes.
// The rule, here and nowhere else:
//   · ONE SOURCE PER ROW. An item with a price of its own (cost / wholesale / retail on its own box) → those, and
//     only those. Else the tier its finish suffix names: /EPn and the outsourced codes (/P25) → PLATED, anything
//     else → PAINTED. A blank stays blank; nothing is borrowed from another tier. (Wholesale alone falls back to
//     retail ÷ 2 of the SAME source — the Traversing sheet has no wholesale column.)
//   · A VARIANT WITH NO BOX OF ITS OWN reads the base's tier for its suffix — never the base's own price (that
//     is the mill item's rate), exactly as the engine prices it.
//   · their part # is the engine's (fabricutCodeOf): premium for a plated suffix, painted otherwise.
//   · SEEDING FROM A BASE writes the base's row and a row on every STOCKED, live finish under it; from a variant,
//     that variant alone. Each write is listed before it happens, and a row it would replace is named.
// Pure. Harness: scripts/tierRows.test.mjs.

import { fabricutCodeOf, isPlatedSuffix } from './priceLevels.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
export const tierCodeOf = (p) => U((p && p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : (p && p.itemId)) || '');
const has = (v) => v !== undefined;
const cell = (v) => (v === null || v === undefined ? '' : v);
const TIER_KEYS = {
    OWN: ['cost', 'wholesale', 'retail'],
    PAINTED: ['paintedCost', 'paintedWholesale', 'paintedRetail'],
    PLATED: ['platedCost', 'platedWholesale', 'platedRetail'],
};
export const TIER_LABEL = { OWN: "the item's own price", PAINTED: 'painted tier', PLATED: 'plated tier' };

/**
 * The customer row an item's tiers give — or null (no price at that source; a group-priced $0 plate).
 * @returns {null | { clientSku, price, clientSalesPrice, clientRetailPrice, plated, tier: 'OWN'|'PAINTED'|'PLATED', inherited }}
 */
export function tierRowOf(part, findByCode, outsourceCodes) {
    if (!part) return null;
    const code = tierCodeOf(part);
    const [base, sfx = ''] = code.split('/');
    const plated = isPlatedSuffix(sfx, outsourceCodes);
    let fab = part.manufacturingSpecs && part.manufacturingSpecs.fabricut;
    let inherited = false;
    if (!fab && sfx && typeof findByCode === 'function') {
        const baseDoc = findByCode(base);
        fab = (baseDoc && baseDoc.manufacturingSpecs && baseDoc.manufacturingSpecs.fabricut) || null;
        inherited = !!fab;
    }
    if (!fab) return null;
    const own = !inherited && (has(fab.cost) || has(fab.wholesale) || has(fab.retail));
    const tier = own ? 'OWN' : (plated ? 'PLATED' : 'PAINTED');
    const [kCost, kWs, kRetail] = TIER_KEYS[tier];
    const cost = fab[kCost], retail = fab[kRetail];
    let ws = fab[kWs];
    if (ws === undefined || ws === null) ws = Number.isFinite(parseFloat(retail)) ? parseFloat(retail) / 2 : null;
    if (cost === undefined && retail === undefined) return null;   // nothing at this source
    if (cost === null && retail === null) return null;             // group-priced ($0 with the arm) — stays out of Client Pricing
    return {
        clientSku: fabricutCodeOf(part, findByCode, outsourceCodes) || '',
        price: cell(cost), clientSalesPrice: cell(ws), clientRetailPrice: cell(retail),
        plated, tier, inherited,
    };
}

/** The live, stocked finish variants of a base item (CODE/…): not retired, not an alias record. */
export function stockedVariantsOf(basePart, inventory = []) {
    const base = tierCodeOf(basePart);
    if (!base || base.includes('/')) return [];
    return (inventory || [])
        .filter(p => p && p.id !== basePart.id && tierCodeOf(p).startsWith(`${base}/`))
        .filter(p => { const ms = p.manufacturingSpecs || {}; return ms.isStocked === true && ms.isRetired !== true && !ms.aliasOf; })
        .sort((a, b) => tierCodeOf(a).localeCompare(tierCodeOf(b)));
}

const same = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b);
const HAND = (r) => !r.source || !/^(TIER_SEED|ADOPTED_)/.test(String(r.source));

/**
 * What a seed would write. From a base: the base and its stocked variants; from a variant: itself.
 * @param customerKeys  a Set of the customer's ids / names, UPPERCASE (the page's custKeys)
 * @returns {{ rows: Array<{ part, code, row, existing, change: 'NEW'|'REPLACE'|'SAME', hand }>, skipped: Array<{ code, why }> }}
 */
export function seedPlanOf({ part, inventory = [], findByCode, outsourceCodes, customerKeys }) {
    const keys = customerKeys || new Set();
    const targets = [part, ...stockedVariantsOf(part, inventory)];
    const rows = [], skipped = [];
    targets.forEach(p => {
        const code = tierCodeOf(p);
        const row = tierRowOf(p, findByCode, outsourceCodes);
        if (!row) { skipped.push({ code, why: p === part && !code.includes('/') ? 'no price of its own on the base item' : 'no price at its tier' }); return; }
        const existing = (p.clientPricing || []).find(r => keys.has(U(r && r.customerId))) || null;
        const change = !existing ? 'NEW'
            : (same(existing.clientSku, row.clientSku) && same(existing.price, row.price) && same(existing.clientSalesPrice, row.clientSalesPrice) && same(existing.clientRetailPrice, row.clientRetailPrice) ? 'SAME' : 'REPLACE');
        rows.push({ part: p, code, row, existing, change, hand: !!existing && HAND(existing) });
    });
    return { rows, skipped };
}

const money = (v) => (v === '' || v === null || v === undefined ? '—' : `$${v}`);
const line = (r) => `${r.clientSku || 'no part #'} · net ${money(r.price)} · sales ${money(r.clientSalesPrice)} · retail ${money(r.clientRetailPrice)}`;

/** The words the confirm shows — every row it will write, and what each one replaces. */
export function seedConfirmText(plan, customerName = 'the customer') {
    const writes = plan.rows.filter(x => x.change !== 'SAME');
    const out = [`Write ${writes.length} ${customerName} price row${writes.length === 1 ? '' : 's'} from the saved tiers?`, ''];
    writes.forEach(x => {
        out.push(`${x.code}  →  ${line(x.row)}  (${TIER_LABEL[x.row.tier]}${x.row.inherited ? ', from the base item' : ''})`);
        if (x.change === 'REPLACE') out.push(`      replaces ${x.hand ? 'a HAND-ENTERED row' : 'the row'}: ${line(x.existing)}`);
    });
    const sameN = plan.rows.length - writes.length;
    if (sameN) out.push('', `${sameN} row${sameN === 1 ? '' : 's'} already match${sameN === 1 ? 'es' : ''} — left as ${sameN === 1 ? 'it is' : 'they are'}.`);
    if (plan.skipped.length) out.push('', `Not written: ${plan.skipped.map(s => `${s.code} (${s.why})`).join(', ')}.`);
    return out.join('\n');
}

/** The stored row. */
export const seedRowDoc = (row, { customerId, customerName = '', by = '', now = Date.now() }) => ({
    customerId, customerName, clientSku: row.clientSku || '', price: row.price, clientSalesPrice: row.clientSalesPrice,
    clientRetailPrice: row.clientRetailPrice, source: 'TIER_SEED', updatedAt: now, updatedBy: String(by || ''),
});

// ── SAVE TIERS WRITES ITS OWN FIELDS — NEVER THE WHOLE BOX (2026-10-04) ─────────────────────────────────────
// 4.6's Save tiers began with `setDoc({ manufacturingSpecs: { fabricut: {} } }, { merge: true })` — "ensure the map
// exists". In Firestore an EMPTY map in a merge write is put on the update mask, so that line REPLACED the box with
// {} and the save then wrote back only the fields the editor knows. Everything else an item's box carried went on
// every save: the second pattern numbers (altCodes, 2026-10-04), the per-finish exact numbers the spec sheet
// falls back to (exact_*), the import and repair stamps. An update by dotted path creates the box when it is
// missing — the line was never needed. The patch below is the WHOLE write: dotted paths under the box, one per
// field the editor owns, and nothing that names the box itself.
//   · blank            → the field is deleted (no data at that tier → standard pricing)
//   · "$0 · w/ arm"    → the tier's three fields are written null (the level quotes $0)
//   · anything else    → the number / the trimmed text
export const TIER_BOX = 'manufacturingSpecs.fabricut';
export const TIER_SAVE_GROUPS = [
    { key: 'painted', fields: ['paintedCost', 'paintedWholesale', 'paintedRetail'] },
    { key: 'plated', fields: ['platedCost', 'platedWholesale', 'platedRetail'] },
    { key: 'direct', fields: ['cost', 'wholesale', 'retail'] },
];
export const TIER_SAVE_CODES = ['fabCodePainted', 'fabCodePremium', 'fabCodeBase'];
/** Every field Save tiers may write — and so the only fields it can change. */
export const TIER_SAVE_FIELDS = [...TIER_SAVE_GROUPS.flatMap(g => g.fields), ...TIER_SAVE_CODES, 'pricedWith', 'source', 'updatedAt'];
const numOrBlank = (v) => ((v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? '' : parseFloat(v));

/**
 * The update Save tiers sends. `del` is Firestore's deleteField (passed in so this stays pure).
 * @param edit  the editor's state: one value per field, `incl_<group>` for "$0 · w/ arm", `pricedWith`
 */
export function tierSavePatchOf(edit = {}, { del, now = Date.now() } = {}) {
    const gone = () => (typeof del === 'function' ? del() : del);
    const patch = {};
    TIER_SAVE_GROUPS.forEach(g => {
        const incl = !!edit[`incl_${g.key}`];
        g.fields.forEach(key => { const v = edit[key]; patch[`${TIER_BOX}.${key}`] = incl ? null : (v === '' || v === undefined || v === null ? gone() : numOrBlank(v)); });
    });
    TIER_SAVE_CODES.forEach(key => { const v = String(edit[key] || '').trim(); patch[`${TIER_BOX}.${key}`] = v === '' ? gone() : v; });
    const pw = String(edit.pricedWith || '').trim();
    patch[`${TIER_BOX}.pricedWith`] = pw === '' ? gone() : pw;
    patch[`${TIER_BOX}.source`] = 'COLLECTION_PAGE';
    patch[`${TIER_BOX}.updatedAt`] = now;
    return patch;
}
/** Does a patch touch only fields INSIDE the box — never the box (or its parent) as a whole? */
export const isFieldOnlyPatch = (patch) => Object.keys(patch || {}).every(k => k.startsWith(`${TIER_BOX}.`) && TIER_SAVE_FIELDS.includes(k.slice(TIER_BOX.length + 1)));
