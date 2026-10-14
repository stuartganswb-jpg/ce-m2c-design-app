// ── THE QUICK SELL — A STANDARD PILLOW OR THROW IN THREE CLICKS, PURE (S7 step 2, 2026-10-12) ──────
//
// Stuart 2026-10-12: "an icon for pillow, then icons for the size shape, click, click, choose fabric,
// add to cart". The catalog (Shared/pillowCatalog) gives the colourways; the chart (system/pillow_pricing)
// gives the price; this module decides WHAT the cart line is:
//
//   SKU   a plain pillow (no edge, no trim) whose finished item exists in the library for that size
//         and has stock → the real item, at the CHART price (D1: the chart wins; the SKU's own price
//         is shown beside it when it differs, never silently chosen).
//   MTO   anything else — an edge / trim, a size with no SKU, or a SKU short of stock (D2 b) → the
//         made-to-order shape the custom program proved: the CUSTOM PILLOW holder at the chart price
//         + the option charge, the fabric yardage beneath it at $0 (two one-side cuts), the insert
//         and zipper, division SEW. The SKU, when one exists, is NAMED in the summary.
//   THROW the throw item at its own price.
//
// Refusals by name (never a $0 line): no group on the colourway (tag the catalog on 6.5), no chart
// price for the size, no fabric yardage item or no width on it (the pull would be 0 yards — the cost
// path Stuart described needs the yard). Pure: no Firestore, no Date. Proven by scripts/pillowQuickSell.test.mjs.

import { sizeKeyOf, dimsOf, sizePriceOf, pricePillow } from './pillowPricing.js';
import { sizeKeysOf, fabricWidthOf } from './pillowCuts.js';
import { codeOf, basePriceOf } from './pillowCatalog.js';
import { treatmentsOffered, treatmentOf, placementOf, colourOf, treatmentWordsOf } from './pillowTreatments.js';

export const EDGES = [{ code: 'NONE', label: 'Knife edge' }, { code: 'FLANGE', label: 'Flange' }, { code: 'WELT', label: 'Welt' }];
export const QUICK_SELL_REQUEST_ID = 'QUICKSELL';

const str = (v) => String(v == null ? '' : v).trim();
const up = (v) => str(v).toUpperCase();
const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const cents = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** The size tiles: the chart's sizes in chart order, each saying whether the catalog carries SKUs at it. */
export const quickSellSizesOf = (config, catalog) => {
    const seen = new Set(((catalog && catalog.sizesSeen) || []).map(sizeKeyOf));
    return sizeKeysOf(config).map(key => {
        const d = dimsOf(key) || { w: 0, h: 0 };
        return { key, w: d.w, h: d.h, square: d.w === d.h, inCatalog: seen.has(key) };
    });
};

/** The edge choices the price table offers (a built-in edge with no price is not offered). */
export const quickSellEdgesOf = (config) => EDGES.filter(e => e.code === 'NONE' || (config && config.details && config.details[e.code] && num(config.details[e.code].price) !== null));

/** The stitch / leather upgrades the price table offers (Shared/pillowTreatments; a blank price = not offered). */
export const quickSellTreatmentsOf = (config) => treatmentsOffered(config);

/**
 * The design pricePillow prices for a standard pillow: one fabric both sides, no seams, the edge, trim all
 * round — and the show upgrade (Stuart 2026-10-14): a stitch or leather welt round the FOUR SIDES
 * (design.edgeTreatment), or DOWN THE MIDDLE = one real seam, two half-width face panels of the same
 * fabric, the back whole; that seam is `included` (the upcharge is its price, no seam labour).
 */
export const quickSellDesignOf = ({ cw, sizeKey, edge = 'NONE', trimId = '', fill = '', treatment = '', placement = 'FOUR_SIDES', colour = '' } = {}) => {
    const d = dimsOf(sizeKey);
    const fabricId = cw && cw.fabric ? cw.fabric.id : '';
    const e = up(edge) || 'NONE';
    const t = treatmentOf(treatment);
    const middle = !!t && up(placement) === 'MIDDLE';
    const half = d ? Math.round((d.w / 2) * 100) / 100 : null;
    return {
        size: sizeKey, fill: str(fill), flange: e, flangeSize: 0, stitch: 'STANDARD',
        edgeTreatment: t && !middle ? { code: t.code, colour: str(colour) } : null,
        panels: middle
            ? [{ label: 'A', fabricId, widthIn: half, heightIn: d ? d.h : null }, { label: 'B', fabricId, widthIn: half, heightIn: d ? d.h : null }]
            : [{ label: 'A', fabricId, widthIn: d ? d.w : null, heightIn: d ? d.h : null }],
        back: fabricId ? { fabricId } : null,
        seams: middle ? [{ id: 'MIDDLE', treatment: t.code, trimId: '', colour: str(colour), lengthIn: d ? d.h : null, middle: true, included: true }] : [],
        outerTrim: { trimId: str(trimId), top: !!trimId, bottom: !!trimId, left: !!trimId, right: !!trimId },
    };
};

const summaryOf = ({ cw, sizeKey, edge, trimItem, fill, skuCode, treatment = '', placement = '', colour = '' }) => [
    sizeKey, cw && cw.label, cw && cw.group ? `group ${cw.group}` : '',
    up(edge) && up(edge) !== 'NONE' ? up(edge).toLowerCase() : '', trimItem ? `trim ${codeOf(trimItem)}` : '',
    treatment ? treatmentWordsOf({ code: treatment, placement, colour }) : '', fill ? str(fill).toLowerCase() : '',
    skuCode ? `as ${skuCode}` : '',
].filter(Boolean).join(' · ');

/**
 * What the cart line is.
 *   cw         the colourway (Shared/pillowCatalog)
 *   mode       'PILLOW' | 'THROW'
 *   sizeKey    the size tile (pillow)
 *   variant    'STD' | 'XL' | 'XXL' (throw)
 *   edge       'NONE' | 'FLANGE' | 'WELT'
 *   trimId     a trim item's id, or ''
 *   treatment  '' | a Shared/pillowTreatments code (STITCH_RAILROAD, STITCH_BLANKET, LEATHER_WELT, LEATHER_MINI_WELT)
 *   placement  'FOUR_SIDES' | 'MIDDLE' (with a treatment) · colour: the yarn / leather colour name (required with one)
 *   fill       the fill word (master list), informational
 *   qty        pillows / throws
 *   available  the SKU's available quantity from NetSuite, or null when not read (an unread shelf is said, not assumed)
 *   config     system/pillow_pricing
 *   findPart   id → library item
 * Returns { ok, errors[{code,message}], warnings[], kind: 'SKU'|'MTO'|'THROW', why, qty, summary, note, sku?, mto?, throwItem?, chartPrice }
 *   sku  { item, code, chartPrice, skuPrice, mismatch, available }
 *   mto  { priced, line }   — line is the shape pillowCartPlanOf loads (holder, consumed, summary, …)
 */
export function quickSellPlanOf({ cw, mode = 'PILLOW', sizeKey = '', variant = 'STD', edge = 'NONE', trimId = '', fill = '', treatment = '', placement = 'FOUR_SIDES', colour = '', qty = 1, available = null, config = {}, findPart } = {}) {
    const errors = [], warnings = [];
    const lookup = typeof findPart === 'function' ? findPart : () => null;
    const q = Math.max(1, Math.floor(num(qty) || 1));
    if (!cw) return { ok: false, errors: [{ code: 'NO_COLOURWAY', message: 'Pick a fabric.' }], warnings, kind: '', why: '', qty: q, summary: '', note: '', chartPrice: null };

    if (up(mode) === 'SAMPLE') {
        // a swatch: the small sample (SWA/) or the large one (SWAL/), at its own price — stock, never sewn
        const v = up(variant) === 'L' || up(variant) === 'XL' ? 'L' : 'S';
        const item = (cw.samples || {})[v] || null;
        if (!item) return { ok: false, errors: [{ code: 'NO_SAMPLE', message: `${cw.label} has no ${v === 'L' ? 'large' : 'small'} sample in the library.` }], warnings, kind: 'SAMPLE', why: '', qty: q, summary: '', note: '', chartPrice: null };
        return { ok: true, errors, warnings, kind: 'SAMPLE', why: 'SAMPLE', qty: q, summary: `${cw.label} · ${v === 'L' ? 'large' : 'small'} sample`, note: '', sampleItem: item, chartPrice: null };
    }
    if (up(mode) === 'THROW') {
        const v = up(variant) || 'STD';
        const item = (cw.throws || {})[v] || null;
        if (!item) return { ok: false, errors: [{ code: 'NO_THROW', message: `${cw.label} has no ${v === 'STD' ? 'standard' : v} throw in the library.` }], warnings, kind: 'THROW', why: '', qty: q, summary: '', note: '', chartPrice: null };
        // the honest shelf (whole throws: NetSuite minus the cut ledger's pieces, rounded down) — short is said, never refused
        const whole = num(available);
        if (whole !== null && whole < q) warnings.push(`${codeOf(item)}: ${whole} whole throw${whole === 1 ? '' : 's'} on the shelf for ${q} — sold short; NetSuite backorders the rest`);
        return { ok: true, errors, warnings, kind: 'THROW', why: whole === null ? 'STOCK_UNKNOWN' : (whole >= q ? 'IN_STOCK' : 'SHORT'), qty: q, summary: `${cw.label}${v === 'STD' ? '' : ` ${v}`}`, note: '', throwItem: item, chartPrice: null, shelf: whole };
    }

    const key = sizeKeyOf(sizeKey);
    if (!key) errors.push({ code: 'NO_SIZE', message: 'Pick a size.' });
    const group = up(cw.group);
    if (!group) errors.push({ code: 'NO_GROUP', message: `${cw.label} carries no fabric group — tag the catalog on 6.5 Tools → Pillow Pricing (or set it on the fabric sheet).` });
    const chartPrice = key && group ? sizePriceOf(config, key, group) : null;
    if (key && group && chartPrice === null) errors.push({ code: 'NO_SIZE_PRICE', message: `The price chart has no ${key} price at group ${group}.` });
    const e = up(edge) || 'NONE';
    const trimItem = trimId ? lookup(trimId) : null;
    if (trimId && !trimItem) errors.push({ code: 'TRIM_UNKNOWN', message: 'The trim chosen is not in the library.' });
    const tr = str(treatment) ? treatmentOf(treatment) : null;
    if (str(treatment) && !tr) errors.push({ code: 'TREATMENT_UNKNOWN', message: `"${treatment}" is not a stitch or leather treatment.` });
    if (tr && !placementOf(placement)) errors.push({ code: 'PLACEMENT_UNKNOWN', message: 'Pick 4 sides or down the middle.' });
    if (tr && !colourOf(tr.code, colour)) errors.push({ code: 'TREATMENT_NO_COLOUR', message: `${tr.label}: pick the colour — it goes on the sewing document.` });
    if (errors.length) return { ok: false, errors, warnings, kind: '', why: '', qty: q, summary: '', note: '', chartPrice };
    const tw = tr ? { treatment: tr.code, placement: up(placement), colour: str(colour) } : {};

    const plain = e === 'NONE' && !trimId && !tr;
    const skuItem = (cw.pillows || {})[key] || null;
    const skuCode = skuItem ? codeOf(skuItem) : '';
    const skuPrice = skuItem ? basePriceOf(skuItem) : null;
    const mismatch = skuItem && skuPrice !== null && cents(skuPrice) !== cents(chartPrice);
    const mismatchNote = mismatch ? `chart $${chartPrice} · item $${skuPrice}` : '';

    // ── the SKU, when a plain pillow exists and the shelf has it ────────────────────────────────
    const stockKnown = num(available) !== null;
    const inStock = stockKnown && num(available) >= q;
    if (plain && skuItem && (inStock || !stockKnown)) {
        if (!stockKnown) warnings.push(`stock for ${skuCode} not read — sold as the item; the shelf decides at Order Entry review`);
        if (mismatch) warnings.push(`${skuCode} is priced $${skuPrice} on the item and $${chartPrice} on the chart — the chart wins`);
        return {
            ok: true, errors, warnings, kind: 'SKU', why: inStock ? 'IN_STOCK' : 'STOCK_UNKNOWN', qty: q,
            summary: summaryOf({ cw, sizeKey: key, edge: 'NONE', trimItem: null, fill, skuCode: '' }),
            note: mismatchNote, chartPrice,
            sku: { item: skuItem, code: skuCode, chartPrice, skuPrice, mismatch: !!mismatch, available: stockKnown ? num(available) : null },
        };
    }

    // ── made to order ───────────────────────────────────────────────────────────────────────────
    const why = !skuItem ? 'NO_SKU' : (!plain ? 'OPTIONS' : 'SHORT');
    if (!cw.fabric) {
        if (skuItem && plain) {
            // the SKU exists but the shelf is short and there is nothing to cut: sell the item short, said plainly
            warnings.push(`${skuCode}: ${num(available)} available for ${q} — and ${cw.label} has no fabric yardage item to sew from. Sold as the item; NetSuite backorders the rest.`);
            if (mismatch) warnings.push(`${skuCode} is priced $${skuPrice} on the item and $${chartPrice} on the chart — the chart wins`);
            return { ok: true, errors, warnings, kind: 'SKU', why: 'SHORT_NO_FABRIC', qty: q, summary: summaryOf({ cw, sizeKey: key, edge: 'NONE', trimItem: null, fill, skuCode: '' }), note: mismatchNote, chartPrice, sku: { item: skuItem, code: skuCode, chartPrice, skuPrice, mismatch: !!mismatch, available: num(available) } };
        }
        errors.push({ code: 'NO_FABRIC_ITEM', message: `${cw.label} has no fabric yardage item (${cw.patternRaw || cw.pattern}/${cw.colour}F) — it cannot be sewn to order until the yardage item exists (fabric sheet → Yardage to create).` });
        return { ok: false, errors, warnings, kind: 'MTO', why, qty: q, summary: '', note: '', chartPrice };
    }
    if (!fabricWidthOf(cw.fabric)) {
        errors.push({ code: 'FABRIC_NO_WIDTH', message: `${codeOf(cw.fabric)} has no width — the yards to pull cannot be computed. Set it on the fabric sheet (6.5 Tools → Pillow Pricing).` });
        return { ok: false, errors, warnings, kind: 'MTO', why, qty: q, summary: '', note: '', chartPrice };
    }
    const design = quickSellDesignOf({ cw, sizeKey: key, edge: e, trimId, fill, ...tw });
    const priced = pricePillow({ design, findPart: lookup, config, qty: q });
    if (!priced.ok) return { ok: false, errors: priced.errors, warnings: [...warnings, ...priced.warnings], kind: 'MTO', why, qty: q, summary: '', note: '', chartPrice };
    priced.warnings.forEach(w => warnings.push(w));
    if (why === 'SHORT') warnings.push(`${skuCode}: ${num(available)} available for ${q} — made to order instead (the custom pillow shape, 3 weeks)`);
    const summary = summaryOf({ cw, sizeKey: key, edge: e, trimItem, fill, skuCode, ...tw });
    const consumed = priced.rows.filter(r => !r.captured).map(r => ({ panel: r.panel || '', legacyErpId: r.legacyErpId, partId: r.partId || '', name: r.name, qty: r.qty, uom: r.uom || 'EACH', perPillow: r.perPillow === undefined ? null : r.perPillow }));
    const line = {
        qty: q,
        holder: { legacyErpId: priced.holder.legacyErpId, partId: priced.holder.partId || '', name: priced.holder.name, price: priced.holder.price, total: priced.holder.total, partHandling: priced.holder.partHandling, madeToOrder: priced.holder.division },
        consumed, sourced: [],
        sizeKey: key, group: priced.group, breakdown: priced.breakdown, summary,
        design, panels: design.panels.map(p => ({ label: p.label, widthIn: p.widthIn, heightIn: p.heightIn, fabricId: p.fabricId })),
        warnings: priced.warnings, capturedFabrics: [], snapshot: '',
        standardSku: skuCode,
    };
    return { ok: true, errors, warnings, kind: 'MTO', why, qty: q, summary, note: skuCode ? `standard ${skuCode}` : '', chartPrice, mto: { priced, line, unitPrice: priced.unitPrice } };
}

/** The colourway tiles: searched by pattern, colour name or number, and narrowed to a group; sorted by pattern then colour. */
export const quickSellTilesOf = (catalog, { q = '', group = '', mode = 'PILLOW' } = {}) => {
    const t = up(q);
    const g = up(group);
    return ((catalog && catalog.list) || [])
        .filter(cw => (up(mode) === 'THROW' ? !!(cw.throws && (cw.throws.STD || cw.throws.XL || cw.throws.XXL)) : up(mode) === 'SAMPLE' ? !!(cw.samples && (cw.samples.S || cw.samples.L)) : (Object.keys(cw.pillows || {}).length > 0 || !!cw.fabric)))
        .filter(cw => !g || up(cw.group) === g)
        .filter(cw => !t || [cw.key, cw.patternRaw, cw.label, cw.colourName, cw.colour].some(v => up(v).includes(t)))
        .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
};

/**
 * A throw's HONEST shelf: NetSuite's available minus the cut ledger's live pieces of its fabric (yards ÷
 * yards-per-throw), rounded DOWN — two half throws are never one throw (Stuart 2026-10-12).
 *   { whole, available, pieceYards, pieceThrows }   available null → whole null (unread is unread)
 */
export const honestThrowsOf = ({ available = null, pieces = [], yardsPerThrow = 2 } = {}) => {
    const live = (pieces || []).filter(p => p && String(p.status || 'CUT').toUpperCase() === 'CUT');
    const pieceYards = Math.round(live.reduce((s, p) => s + (num(p.lengthIn) || 0), 0) / 36 * 1000) / 1000;
    const ypt = num(yardsPerThrow) || 2;
    const pieceThrows = Math.round(pieceYards / ypt * 10000) / 10000;
    const a = num(available);
    return { whole: a === null ? null : Math.max(0, Math.floor(a - pieceThrows + 1e-9)), available: a, pieceYards, pieceThrows };
};
