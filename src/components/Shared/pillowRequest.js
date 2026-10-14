// ── A PILLOW FROM THE BOARD TO ORDER ENTRY — THE REQUEST, PURE (Uniquity · S7, step 3c, 2026-10-11) ──
//
// Stuart 2026-09-13: "i dont think we need to push from there to cpq but rather right to the sales
// order entry … there they can go to sales order entry where we can quickly add standard pillows or
// throws onto the order, charge the credit card". So the board writes a REQUEST and tab 7 loads it
// into its cart — the same hand-off a portal quote request makes (jobs PORTAL_REQUEST → "Load into
// cart"), with the pillow's own shape:
//
//   the HOLDER   one priced line on the non-inventory CUSTOM PILLOW item (the rollup the price table
//                names) — made to order (madeToOrder 'SEW': nothing on the floors until step 5)
//   the PARTS    one $0 line per consumed library item (fabric yards, trim yards, fill, zipper),
//                beneath the holder the way an item kit's parts ride beneath the kit (inKit / kitOf)
//                — NetSuite relieves them, the pick / sewing floor pulls them
//   TO BE SOURCED a photographed fabric is no item: it rides the holder's note (pattern, colour,
//                the photo) and nothing is pushed or pulled for it
//
// The request is a `jobs` document (status PILLOW_REQUEST, brand uniquity) — the CRM's pipeline shows
// it as a priced request beside the portal requests; `cpq_drafts` is NOT used (CPQ's clear-drafts
// deletes those). Pure: no imports past the pricing module. Proven by scripts/pillowRequest.test.mjs.

import { PILLOW_DIVISION, PILLOW_HANDLING } from './pillowPricing.js';
import { treatmentWordsOfDesign } from './pillowTreatments.js';

export const PILLOW_REQUEST_STATUS = 'PILLOW_REQUEST';
export const PILLOW_REQUEST_KIND = 'PILLOW';
export const PILLOW_MADE_TO_ORDER = PILLOW_DIVISION;   // 'SEW'

const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const up = (v) => String(v || '').trim().toUpperCase();
const r3 = (n) => Math.round(n * 1000) / 1000;

export const newPillowRequestId = (at = 0) => `PILLOWREQ-${at || Date.now()}`;

/** The design summary the holder's note and the request title carry. */
export const pillowSummaryOf = ({ priced, geometry, design } = {}) => {
    const parts = [];
    if (priced && priced.sizeKey) parts.push(priced.sizeKey);
    if (priced && priced.group) parts.push(`group ${priced.group}`);
    const n = (geometry && geometry.panels && geometry.panels.length) || 0;
    if (n > 1) parts.push(`${n} panels`);
    const seams = (design && design.seams && design.seams.length) || 0;
    if (seams) parts.push(`${seams} seam${seams === 1 ? '' : 's'}`);
    if (design && design.flange && up(design.flange) !== 'NONE') parts.push(up(design.flange).toLowerCase());
    const tw = treatmentWordsOfDesign(design);   // the stitch / leather words, with the colour — they ride to the sewing document
    if (tw) parts.push(tw);
    if (design && design.fill) parts.push(String(design.fill).toLowerCase());
    return parts.join(' · ');
};

/**
 * The request document. Refuses (ok false) without a customer or a priced design.
 *   session   { customerId, customerName, jobName, quoteId }   (the Vision header)
 *   priced    pricePillow's answer (ok, holder, rows, breakdown, group, sizeKey, warnings)
 *   geometry  panelsOf's answer (panels, warnings)
 *   design    the design priced (size, fill, flange, seams, panels, back, outerTrim)
 *   capturedFabrics  the board's photographed fabrics (id, assetId, code, name, thumbnailUrl, priceGroup, widthIn, railroad, patternId, color)
 *   snapshot  a data URL of the board (PNG / JPEG), or ''
 */
export function pillowRequestOf({ session = {}, priced = null, geometry = null, design = null, capturedFabrics = [], snapshot = '', qty = 1, by = '', brandId = 'uniquity', at = 0 } = {}) {
    const errors = [];
    const customerId = String(session.customerId || '').trim();
    if (!customerId) errors.push({ code: 'NO_CUSTOMER', message: 'Pick a customer in the Vision header first.' });
    if (!priced || !priced.ok || !priced.holder) errors.push({ code: 'NOT_PRICED', message: `The pillow is not priced${priced && priced.errors && priced.errors.length ? `: ${priced.errors.map(e => e.message).join('; ')}` : ''}.` });
    const q = Math.max(1, Math.floor(num(qty) || 1));
    if (errors.length) return { ok: false, errors, doc: null };
    const now = at || Date.now();
    const id = newPillowRequestId(now);
    const summary = pillowSummaryOf({ priced, geometry, design });
    const sourced = (priced.rows || []).filter(r => r.captured).map(r => ({ panel: r.panel, code: r.legacyErpId, patternId: r.patternId || '', color: r.color || '', assetId: r.assetId || '' }));
    const consumed = (priced.rows || []).filter(r => !r.captured).map(r => ({ panel: r.panel || '', legacyErpId: r.legacyErpId, partId: r.partId || '', name: r.name, qty: r.qty, uom: r.uom || 'EACH', perPillow: r.perPillow === undefined ? null : r.perPillow }));
    const line = {
        qty: q,
        holder: { legacyErpId: priced.holder.legacyErpId, partId: priced.holder.partId || '', name: priced.holder.name, price: priced.holder.price, total: Math.round(priced.holder.price * q * 100) / 100, partHandling: PILLOW_HANDLING, madeToOrder: PILLOW_MADE_TO_ORDER },
        consumed, sourced,
        sizeKey: priced.sizeKey, group: priced.group, breakdown: priced.breakdown, summary,
        design: design || null, panels: (geometry && geometry.panels) || [],
        warnings: [...((geometry && geometry.warnings) || []), ...(priced.warnings || [])],
        capturedFabrics: (capturedFabrics || []).map(f => ({ id: f.id, assetId: f.assetId || '', code: f.code || f.legacyErpId || '', name: f.name || f.itemName || '', thumbnailUrl: f.thumbnailUrl || '', priceGroup: f.priceGroup || '', widthIn: f.widthIn || null, railroad: !!f.railroad, patternId: f.patternId || '', color: f.color || '' })),
        snapshot: snapshot || '',
    };
    const doc = {
        jobId: id, id, brandId, status: PILLOW_REQUEST_STATUS, source: 'VISION_PILLOW',
        customer: { id: customerId, name: String(session.customerName || customerId) },
        jobName: String(session.jobName || ''), visionQuoteId: String(session.quoteId || ''),
        title: `Custom pillow · ${summary}`,
        pillowRequest: { kind: PILLOW_REQUEST_KIND, lines: [line], createdAt: now, createdBy: by || '' },
        // the CRM's pipeline card reads these — a PRICED request, unlike an unpriced portal one
        cpqData: {
            totalPrice: line.holder.total,
            breakdown: [
                { name: `${line.holder.legacyErpId} — Custom pillow ${summary}`, qty: q, price: line.holder.price, total: line.holder.total, legacyErpId: line.holder.legacyErpId, partHandling: PILLOW_HANDLING, isRollup: true },
                ...consumed.map(c => ({ name: `   · ${c.legacyErpId} — ${c.name}`, qty: c.qty === null ? 0 : c.qty, price: 0, total: 0, legacyErpId: c.legacyErpId, inKit: true, uom: c.uom })),
                ...sourced.map(s => ({ name: `   · ${s.code} — TO BE SOURCED (photo)`, qty: 0, price: 0, total: 0, legacyErpId: '', inKit: true, captured: true })),
            ],
        },
        createdBy: { name: by || '', via: 'VISION_PILLOW' }, createdAt: now, author: by || '',
    };
    return { ok: true, errors: [], doc };
}

/**
 * Tab 7's load: the request's line → what to push into the cart. Items are resolved by code in the
 * brand's library (findByCode(code) → item | null). Refuses when the holder item is missing or has no
 * NetSuite id (the push would 400), lists every consumed item it cannot find (they go on the note).
 *   { ok, errors[], holder: { item, qty, rate, note }, parts: [{ item, yards | each, uom, note, panel }], missing: [codes], sourced: [...] }
 */
export function pillowCartPlanOf({ line = {}, findByCode } = {}) {
    const lookup = typeof findByCode === 'function' ? findByCode : () => null;
    const errors = [];
    const holderCode = up(line.holder && line.holder.legacyErpId);
    const holderItem = holderCode ? lookup(holderCode) : null;
    if (!holderCode) errors.push({ code: 'NO_HOLDER', message: 'The request names no holder item.' });
    else if (!holderItem) errors.push({ code: 'HOLDER_MISSING', message: `${holderCode} is not in this brand's library — create the non-inventory item (with its NetSuite id) before loading pillows.` });
    else if (!holderItem.netSuiteInternalId) errors.push({ code: 'HOLDER_NO_NS_ID', message: `${holderCode} has no NetSuite internal id — sync it (11.1) first; the sales order would be refused.` });
    const rate = num(line.holder && line.holder.price);
    if (rate === null || rate <= 0) errors.push({ code: 'NO_PRICE', message: 'The request carries no price.' });
    const qty = Math.max(1, Math.floor(num(line.qty) || 1));
    const sourced = Array.isArray(line.sourced) ? line.sourced : [];
    const missing = [];
    const parts = [];
    (Array.isArray(line.consumed) ? line.consumed : []).forEach(c => {
        const code = up(c.legacyErpId);
        const item = code ? lookup(code) : null;
        if (!item) { missing.push(code || '?'); return; }
        const q = num(c.qty);
        if (q === null || q <= 0) { missing.push(`${code} (no quantity)`); return; }
        const isYard = up(c.uom) === 'YARD';
        parts.push({ item, code, uom: isYard ? 'YARD' : 'EACH', yards: isYard ? r3(q) : null, each: isYard ? null : Math.max(1, Math.round(q)), panel: c.panel || '', note: `${c.panel ? `panel ${c.panel} · ` : ''}${isYard ? `${r3(q)} yd` : `${Math.max(1, Math.round(q))} ea`} · for the custom pillow` });
    });
    const noteBits = [`CUSTOM PILLOW · ${line.summary || ''}`.trim()];
    if (sourced.length) noteBits.push(`TO BE SOURCED: ${sourced.map(s => `${s.code}${s.panel ? ` (panel ${s.panel})` : ''}`).join(', ')}`);
    if (missing.length) noteBits.push(`NOT IN LIBRARY: ${missing.join(', ')}`);
    return {
        ok: errors.length === 0, errors,
        holder: holderItem ? { item: holderItem, qty, rate: rate || 0, note: noteBits.join(' · '), madeToOrder: PILLOW_MADE_TO_ORDER } : null,
        parts, missing, sourced,
    };
}
