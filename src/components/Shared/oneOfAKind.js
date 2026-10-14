// ── ONE-OF-A-KIND PILLOWS AND WALL ART, MADE AT THE SHOW — PURE + THE WRITES (S7, 2026-10-14) ──────
//
// Stuart: "i have about 30 pillows that we made custom at the show … import the pictures, read the tag,
// have a form where i can see the pillow image and enter in a sales price and the fabric used and amount
// used … the option to say scrap, bridsml or bridlrg — 3 noninventory items with costs that we have made
// pillows from, in units of 1 per pillow … we do not need to fully make assemblies … wall art, treat it
// exactly the same but use bridwall as the fabric component" · "i will enter the sales price at import,
// i can type in the code from the tag" · the makings exist in NetSuite: BRIDSML, BRIDLRG, SCRAPFAB,
// Bridwallsml, Bridwallmed, Bridwalllrg.
//
// One card per photo → one Uniquity library item (productType PILLOW / WALL ART, stocked, one on the show
// shelf, the photo as its picture, the price, and its MAKING under customData.oneOfAKind). It sells on the
// counter's "One of a kind" tile as ONE line at its price with its making beneath at $0 — the custom
// pillow's own shape, so NetSuite relieves the making (a fabric as yards of itself or a fraction of its
// throw; a non-inventory making × 1) and nothing is built. The pillow line pushes as its own NetSuite item
// when the import created one, else as the CUSTOM PILLOW holder with the tag in the description (the same
// alias rule the fabrics use). Sold once: the save marks the item SOLD and the tile disappears.
// Pure parts proven by scripts/oneOfAKind.test.mjs.

import { fabricNsLineOf } from './pillowCatalog.js';

const str = (v) => String(v == null ? '' : v).trim();
const up = (v) => str(v).toUpperCase();
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const r3 = (n) => Math.round(n * 1000) / 1000;

export const OOAK_KINDS = [{ code: 'PILLOW', label: 'Pillow', productType: 'PILLOW' }, { code: 'WALL', label: 'Wall art', productType: 'WALL ART' }];
/** The non-inventory makings, one unit per piece — NetSuite item names as Stuart gave them (matched any case). */
export const OOAK_MAKINGS = {
    PILLOW: [{ code: 'SCRAPFAB', label: 'Scrap fabric' }, { code: 'BRIDSML', label: 'Bridget small' }, { code: 'BRIDLRG', label: 'Bridget large' }],
    WALL: [{ code: 'BRIDWALLSML', label: 'Bridget wall small' }, { code: 'BRIDWALLMED', label: 'Bridget wall medium' }, { code: 'BRIDWALLLRG', label: 'Bridget wall large' }],
};
export const OOAK_STATUS = { AVAILABLE: 'AVAILABLE', SOLD: 'SOLD' };
export const OOAK_DEFAULT_BIN = 'SHOW';

/** A fresh card for one photo. */
export const oneOfAKindCardOf = ({ id, fileName = '', dataUrl = '', kind = 'PILLOW' } = {}) => ({
    id: id || `card-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    fileName: str(fileName), dataUrl: dataUrl || '',
    kind: up(kind) === 'WALL' ? 'WALL' : 'PILLOW',
    code: '', name: '', price: '', sizeKey: '', bin: OOAK_DEFAULT_BIN, note: '',
    making: { type: '', fabricCode: '', yards: '', noninvCode: '' },   // type: 'FABRIC' | 'NONINV'
    createInNetSuite: true,
    state: 'DRAFT', result: null,
});

/** A library item that is a one-of-a-kind piece, and whether it is still on the shelf. */
export const oneOfAKindOf = (it) => (it && it.manufacturingSpecs && it.manufacturingSpecs.customData && it.manufacturingSpecs.customData.oneOfAKind) || null;
export const isOneOfAKindItem = (it) => !!oneOfAKindOf(it);
export const oneOfAKindAvailableOf = (items = []) => (items || []).filter(it => { const o = oneOfAKindOf(it); return o && up(o.status || OOAK_STATUS.AVAILABLE) === OOAK_STATUS.AVAILABLE && !(it.manufacturingSpecs && it.manufacturingSpecs.isRetired); });

/**
 * What a card still needs. errors stop the create; warnings are said.
 *   findByCode(code) → library item | null · takenCodes = codes already in the library or on other cards
 */
export function cardReadinessOf(card, { findByCode, takenCodes = [] } = {}) {
    const lookup = typeof findByCode === 'function' ? findByCode : () => null;
    const errors = [], warnings = [];
    const code = up(card && card.code);
    if (!code) errors.push({ code: 'NO_CODE', message: 'Type the code from the tag.' });
    else if (!/^[A-Z0-9][A-Z0-9 ._/-]*$/.test(code)) errors.push({ code: 'BAD_CODE', message: `"${code}" has characters an item number cannot carry.` });
    else if ((takenCodes || []).map(up).includes(code)) errors.push({ code: 'DUPLICATE_CODE', message: `${code} is already an item (or on another card) — a one-of-a-kind piece needs its own code.` });
    if (!str(card && card.name)) warnings.push('no name — the code will be the name');
    const price = num(card && card.price);
    if (price === null || price <= 0) errors.push({ code: 'NO_PRICE', message: 'Type the sale price.' });
    if (!(card && card.dataUrl)) warnings.push('no photo on this card');
    const m = (card && card.making) || {};
    const kind = up(card && card.kind) === 'WALL' ? 'WALL' : 'PILLOW';
    if (m.type === 'FABRIC') {
        const f = m.fabricCode ? lookup(m.fabricCode) : null;
        if (!m.fabricCode) errors.push({ code: 'NO_FABRIC', message: 'Pick the fabric it was made from.' });
        else if (!f) errors.push({ code: 'FABRIC_UNKNOWN', message: `${m.fabricCode} is not in the library.` });
        const y = num(m.yards);
        if (y === null || y <= 0) errors.push({ code: 'NO_YARDS', message: 'Type the yards used.' });
    } else if (m.type === 'NONINV') {
        const allowed = OOAK_MAKINGS[kind].map(x => x.code);
        if (!allowed.includes(up(m.noninvCode))) errors.push({ code: 'MAKING_NOT_FOR_KIND', message: `${up(m.noninvCode) || '(none)'} is not a ${kind === 'WALL' ? 'wall art' : 'pillow'} making (${allowed.join(', ')}).` });
        else {
            const it = lookup(m.noninvCode);
            if (!it) errors.push({ code: 'MAKING_UNKNOWN', message: `${up(m.noninvCode)} is not in the Uniquity library — sync it from NetSuite (11.1) first.` });
            else if (!str(it.netSuiteInternalId)) errors.push({ code: 'MAKING_NO_NS_ID', message: `${up(m.noninvCode)} carries no NetSuite id — the sale could not relieve it.` });
        }
    } else errors.push({ code: 'NO_MAKING', message: 'Say what it was made from: a fabric and its yards, or one of the makings.' });
    return { ok: errors.length === 0, errors, warnings };
}

/** The library record — the Item Starter's shape, brand uniquity, stocked ONE on the show shelf. */
export function oneOfAKindDocOf(card, { id, brandId = 'uniquity', by = '', at = 0, nsId = '', photoUrl = '', thumbUrl = '' } = {}) {
    const now = at || Date.now();
    const kind = up(card.kind) === 'WALL' ? 'WALL' : 'PILLOW';
    const kindRow = OOAK_KINDS.find(k => k.code === kind);
    const m = card.making || {};
    const making = m.type === 'FABRIC'
        ? { type: 'FABRIC', fabricCode: up(m.fabricCode), yards: r3(num(m.yards) || 0) }
        : { type: 'NONINV', noninvCode: up(m.noninvCode), each: 1 };
    const code = up(card.code);
    return {
        id, itemId: id, legacyErpId: code, itemName: str(card.name) || code,
        brandId, sharedBrands: [brandId],
        partClass: 'Inventory', routingType: 'UNASSIGNED',
        ...(nsId ? { netSuiteInternalId: str(nsId) } : {}),
        ...(photoUrl ? { finalImageUrl: photoUrl, imageSource: 'GALLERY', componentImageUrl: thumbUrl || photoUrl } : {}),
        manufacturingSpecs: {
            productType: kindRow.productType, category: kindRow.productType, uom: 'EA',
            basePrice: num(card.price), isStocked: true, isInHouse: true, partHandling: 'Small Parts',
            homeBin: up(card.bin) || OOAK_DEFAULT_BIN, binLocation: up(card.bin) || OOAK_DEFAULT_BIN,
            customData: {
                oneOfAKind: { kind, making, status: OOAK_STATUS.AVAILABLE, sizeKey: str(card.sizeKey), note: str(card.note), photoFile: str(card.fileName), importedAt: now, importedBy: by, nsCreated: !!nsId },
            },
        },
        createdAt: now, updatedAt: now, author: by, oneOfAKindAt: now,
    };
}
export const newOneOfAKindId = (brandId = 'uniquity', at = 0, i = 0) => `${String(brandId).toUpperCase()}-OOAK-${at || Date.now()}-${i}`;

/**
 * The NetSuite item to create — a NON-INVENTORY SALE item in the brand's subsidiary, modelled on an existing
 * making (its subsidiary, tax schedule, class and income account are copied from the template the screen
 * read back), named by the tag. Price rides the sales order line, not the item.
 */
export function nsOneOfAKindItemOf(card, { template = null, brand = 'uniquity' } = {}) {
    const t = template || {};
    const pick = (v) => (v && typeof v === 'object' ? (v.id ? { id: String(v.id) } : (Array.isArray(v.items) ? { items: v.items.map(x => ({ id: String(x.id) })) } : null)) : null);
    const body = { itemId: up(card.code), displayName: (str(card.name) || up(card.code)).slice(0, 40), isInactive: false, includeChildren: false };
    const sub = pick(t.subsidiary); if (sub) body.subsidiary = sub;
    const tax = pick(t.taxSchedule); if (tax) body.taxSchedule = tax;
    const cls = pick(t.class); if (cls) body.class = cls;
    const inc = pick(t.incomeAccount); if (inc) body.incomeAccount = inc;
    body.salesDescription = `One of a kind ${up(card.kind) === 'WALL' ? 'wall art' : 'pillow'} made at the show — ${str(card.name) || up(card.code)}`.slice(0, 999);
    return body;
}

/**
 * The cart plan for selling one: the piece as ONE line at its price (as its own NetSuite item, else as the
 * CUSTOM PILLOW holder with the tag in the description) and its making beneath at $0.
 *   item        the library record · findByCode(code) → item · holder = the CUSTOM PILLOW library record (for the alias)
 * → { ok, errors, piece: { item, price, nsId, via }, making: { item, uom: 'YARD'|'EACH', yards|each, note, nsId?, nsQtyFactor?, nsVia? } }
 */
export function oneOfAKindCartPlanOf({ item, findByCode, holder = null } = {}) {
    const lookup = typeof findByCode === 'function' ? findByCode : () => null;
    const errors = [];
    const o = oneOfAKindOf(item);
    if (!item || !o) return { ok: false, errors: [{ code: 'NOT_OOAK', message: 'Not a one-of-a-kind piece.' }], piece: null, making: null };
    if (up(o.status || 'AVAILABLE') !== 'AVAILABLE') errors.push({ code: 'SOLD', message: `${item.legacyErpId} is already sold.` });
    const price = num(item.manufacturingSpecs && item.manufacturingSpecs.basePrice);
    if (price === null || price <= 0) errors.push({ code: 'NO_PRICE', message: `${item.legacyErpId} carries no price.` });
    let piece = null;
    if (str(item.netSuiteInternalId)) piece = { item, price, nsId: str(item.netSuiteInternalId), via: '' };
    else if (holder && str(holder.netSuiteInternalId)) piece = { item, price, nsId: str(holder.netSuiteInternalId), via: `one of a kind ${item.legacyErpId} — sold on ${holder.legacyErpId}` };
    else errors.push({ code: 'NO_NS_IDENTITY', message: `${item.legacyErpId} has no NetSuite item and the CUSTOM PILLOW holder has no NetSuite id — the sale could not be pushed.` });
    let making = null;
    const m = o.making || {};
    if (m.type === 'FABRIC') {
        const f = lookup(m.fabricCode);
        const yards = r3(num(m.yards) || 0);
        if (!f) errors.push({ code: 'FABRIC_UNKNOWN', message: `${m.fabricCode} (its fabric) is not in the library.` });
        else if (!(yards > 0)) errors.push({ code: 'NO_YARDS', message: `${item.legacyErpId}: no yards recorded for its fabric.` });
        else {
            const ns = fabricNsLineOf({ fabric: f, yards, findByCode: lookup });
            if (!ns) errors.push({ code: 'FABRIC_NO_NS', message: `${m.fabricCode} has no NetSuite item and no throw to stand for it.` });
            making = { item: f, uom: 'YARD', yards, note: `${yards} yd · made into ${item.legacyErpId}`, ...(ns && ns.factor ? { nsId: ns.nsId, nsQtyFactor: ns.factor, nsVia: ns.via } : {}) };
        }
    } else if (m.type === 'NONINV') {
        const n = lookup(m.noninvCode);
        if (!n) errors.push({ code: 'MAKING_UNKNOWN', message: `${m.noninvCode} (its making) is not in the library.` });
        else if (!str(n.netSuiteInternalId)) errors.push({ code: 'MAKING_NO_NS_ID', message: `${m.noninvCode} carries no NetSuite id.` });
        else making = { item: n, uom: 'EACH', each: 1, note: `1 ea · made into ${item.legacyErpId}` };
    } else errors.push({ code: 'NO_MAKING', message: `${item.legacyErpId} records no making.` });
    return { ok: errors.length === 0, errors, piece, making };
}

/** The item patch when the piece is sold (the sales order's own id on it). */
export const oneOfAKindSoldPatchOf = ({ soId = '', by = '', at = 0 } = {}) => ({
    'manufacturingSpecs.customData.oneOfAKind.status': OOAK_STATUS.SOLD,
    'manufacturingSpecs.customData.oneOfAKind.soldOn': str(soId),
    'manufacturingSpecs.customData.oneOfAKind.soldAt': at || Date.now(),
    'manufacturingSpecs.customData.oneOfAKind.soldBy': str(by),
    'manufacturingSpecs.isStocked': false,
    updatedAt: at || Date.now(),
});
