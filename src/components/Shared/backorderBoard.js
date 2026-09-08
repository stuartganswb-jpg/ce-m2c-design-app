// ── THE BACKORDER BOARD — READING THE RECORD, WHATEVER SHAPE IT IS IN ─────────────────────────
//
// Stuart 2026-09-08: "any of these orders that if plated not on hand and/or if painted and there
// is no /P stock and no raw mill item stock these should be considered true backorders. we need
// clear button that can open these to view in order by oldest order … everything that we need to
// keep an eye out to make sure they get completed and nothing is not ordered or put in the correct
// place when it arrives."
//
// B OWNS THE DEFINITION (Shared/backorder.js, extracted from splitPlan) and B writes the record on
// hq_sales_orders.backorderLines[]. This file is A's half: turning that record into the board —
// what covers each line, whether it has arrived, and what still nobody has ordered.
//
// WHY IT READS TWO SHAPES. The record already exists in the field today, written by splitPlan for
// PLATED lines only: { code, name, qty, wanted, available: <number>, onOrder, unit }. B's next
// commit adds painted classification and widens it: `kind`, `coverCodes`, `available` as a MAP per
// cover code, `since`, `lineIndex`. Building against only the new shape would mean the board shows
// nothing until B lands, and worse, shows nothing WITHOUT SAYING SO. Building against only the old
// shape would break the day B lands.
//
// So it normalises both, and derives what is missing from facts A already holds — `kind` from the
// finish suffix, `coverCodes` from the mill base, `since` from the sales order's own createdAt.
// Every one of those is a derivation the board would have to be able to do anyway for a line
// written before the field existed.

import { millBaseOf, isOutsourcedFinishCode, finishSuffixOf } from './finishRouting.js';

const up = (v) => String(v || '').trim().toUpperCase();
const num = (v) => Math.max(0, Number(v) || 0);

/**
 * plated or painted, from the line if B said so, else from the code.
 * A plated line is one whose finish is done outside; anything else our own paint line can make.
 */
export const kindOf = (line) => {
    const k = String(line && line.kind || '').toLowerCase();
    if (k === 'plated' || k === 'painted') return k;
    return isOutsourcedFinishCode(finishSuffixOf(up(line && line.code))) ? 'plated' : 'painted';
};

/**
 * What could cover this line — the codes whose arrival would let it run.
 *
 * A PLATED line can only be covered by itself: we do not make the finish, so a mill part on the
 * shelf is not a cover. A PAINTED line has three, in the order the floor would reach for them:
 * the finished code, its phosphated core, then the raw mill base — which is exactly the "no /P
 * stock and no raw mill item stock" test that makes it a backorder in the first place.
 */
export const coverCodesOf = (line) => {
    if (Array.isArray(line && line.coverCodes) && line.coverCodes.length) return line.coverCodes.map(up).filter(Boolean);
    const code = up(line && line.code);
    if (!code) return [];
    if (kindOf(line) === 'plated') return [code];
    const mill = up(millBaseOf(code));
    return [...new Set([code, mill && mill !== code ? `${mill}/P` : '', mill].filter(Boolean))];
};

/** `available` is a number on the old record and a map on the new one. Always answer a map. */
export const availabilityOf = (line, coverCodes) => {
    const a = line && line.available;
    if (a && typeof a === 'object') { const out = {}; Object.entries(a).forEach(([k, v]) => { out[up(k)] = num(v); }); return out; }
    // Old shape: the single number was the FINISHED code's availability.
    const out = {};
    coverCodes.forEach(c => { out[c] = 0; });
    if (typeof a === 'number') out[up(line.code)] = num(a);
    return out;
};

/**
 * One board row per backorder line.
 *
 * STATE IS ABOUT WHAT SOMEBODY MUST DO NEXT, which is why ARRIVED outranks COVERED: stock that has
 * landed needs a person to send it, and saying "covered by PO2296" about material already on the
 * shelf would hide the only row on the board that is ready to move.
 *
 *   ARRIVED    live availability on any cover code now meets the shortfall → release / pick it
 *   COVERED    an open PO or WO names a cover code → nothing to do but watch the date
 *   UNCOVERED  nothing open, nothing on the shelf → NOBODY HAS ORDERED THIS. The reason the board
 *              exists, and the only state the button counts.
 */
export const rowsFor = ({ orders = [], poByCode = {}, openWos = [], availByCode = {}, packByOrderKey = {} }) => {
    const woIdx = {};
    (openWos || []).forEach(w => {
        const c = up(w.itemCode || w.partErpId || w.rootItem);
        if (c) (woIdx[c] = woIdx[c] || []).push(w);
    });
    const rows = [];
    (orders || []).forEach(so => {
        (so.backorderLines || []).forEach((line, i) => {
            const code = up(line.code);
            if (!code) return;
            const covers = coverCodesOf(line);
            const short = num(line.qty);
            const recorded = availabilityOf(line, covers);
            // Live availability beats what was recorded at split time — the whole question the
            // board answers is "has it turned up since?".
            const liveBest = covers.reduce((best, c) => Math.max(best, num(availByCode[c])), 0);
            const openPo = covers.flatMap(c => (poByCode[c] || []).map(l => ({ ...l, forCode: c, kind: 'PO' })));
            const openWo = covers.flatMap(c => (woIdx[c] || []).map(w => ({
                kind: 'WO', forCode: c, poNumber: w.woDisplayId || w.nsWoTran || w.id,
                open: num(w.totalParts || w.qty), due: w.needBy || w.reqDate || '', status: w.status || '',
            })));
            const cover = [...openPo, ...openWo];
            const state = liveBest >= short && short > 0 ? 'ARRIVED' : (cover.length ? 'COVERED' : 'UNCOVERED');
            rows.push({
                key: `${so.id}:${line.lineIndex != null ? line.lineIndex : i}`,
                soId: so.id, soNumber: so.nsSoTran || so.soNumber || so.orderKey || so.id,
                orderKey: so.orderKey || so.id,
                customer: so.customer || so.customerName || '',
                since: num(line.since) || num(so.createdAt) || 0,
                code, name: line.name || '', kind: kindOf(line),
                short, wanted: num(line.wanted) || short,
                covers, recorded, liveAvailable: liveBest, unit: line.unit || null,
                cover, state,
                // Where it lands when it turns up — the order's own pack document.
                pack: packByOrderKey[up(so.orderKey || so.id)] || null,
            });
        });
    });
    // OLDEST FIRST — Stuart's words, and the only order that makes the board answer "what has been
    // waiting longest". A line with no date sorts last rather than first: an unknown age must never
    // outrank a genuinely old order.
    return rows.sort((a, b) => (a.since || Infinity) - (b.since || Infinity) || a.code.localeCompare(b.code));
};

/** The number on the button: lines nobody has ordered. */
export const uncoveredCount = (rows = []) => rows.filter(r => r.state === 'UNCOVERED').length;

export const STATE_STYLE = {
    UNCOVERED: { color: '#d9534f', label: 'UNCOVERED', hint: 'Nothing open for any covering item — this has not been ordered' },
    COVERED: { color: 'var(--ink)', label: 'COVERED', hint: 'An open PO or work order will cover it' },
    ARRIVED: { color: '#3a7d44', label: 'ARRIVED', hint: 'Stock is on the shelf now — release or pick it' },
};
