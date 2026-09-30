// 🧰 KIT LINES → PARTS — an old finishing document whose pull list carries a KIT (Stuart 2026-09-30, SO60432:
// "this is the kit code from the sale, it should not be looking to pick this" · "build the button").
//
// A kit is sold, never made or picked (Shared/itemKit, 2026-09-28). The writers keep kits off the pull list now —
// the CPQ split since 09-18, tab 7 / 10.5 / Order Entry since 09-28 — and Shared/pickLines.isKitHolderLine keeps any
// that slip through off every pick (efe8bb76). What that belt cannot do is put back the PARTS an old document never
// got: WO-SO60432 (CPQ split 09-14) carries its traverse system kit (H1-2TRV-4M/P-45W, whose parts were written
// beside it) and six H1-2TRV-WB/P item kits — the wall bracket, painted P14 — whose backplate and arms were never
// written, and its backorder hold waits on the kit itself, which never arrives as an item.
//
// The repair, in the same pattern as 10.5's ↻ Re-read of an old kit line (Shared/displayRelease):
//   • every kit line stays IN ITS PLACE, flagged (isKit / itemKit / kitCode) — no line moves, so every lineIndex a
//     backorder or a start stamp points at stays true;
//   • an ITEM kit's parts are appended at the END, one set per kit line, in the kit line's finish by the one kit rule
//     (kitPartFinishOf): a paint finish pulls the part's /P and paints it (this document's own convention), a stock
//     colour pulls its colour item, an Unfinished part pulls itself. A plated kit is NOT guessed — it is named for a
//     person;
//   • a SYSTEM kit's parts are already on the list (the traverse explosion wrote them) — it is only flagged;
//   • the backorders that point at a kit line are dropped; each appended part is classified against live stock by the
//     split's own rule (Shared/backorder.classifyLine) and a short one is recorded; the hold's words are rebuilt by
//     backorderHoldOf — and when no line is left short the hold is cleared the way backorderCover clears it.
// Refused once picking has started: a pull list is never rewritten under somebody's trolley. Pure.

import { parseKitCode } from './kitCode.js';
import { itemKitOfCode, kitComponentsOf, kitPartFinishOf, isKitLine } from './itemKit.js';
import { classifyLine, backorderRecordOf, backorderHoldOf, isBackorderHold, lineCodeOf } from './backorder.js';
import { finishedCodeOf } from './subFinish.js';
import { isOutsourcedFinishCode } from './finishRouting.js';
import { takesNoFinish } from './finishLabel.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const libCodeOf = (p) => U(p && (p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p.itemId));
const binOfRec = (p) => (p && ((p.manufacturingSpecs && p.manufacturingSpecs.binLocation) || p.binLocation)) || 'UNASSIGNED';
const pickStarted = (fin) => { const ps = String((fin && fin.pickStatus) || ''); return !!ps && ps !== 'Pending'; };

/** The kit lines a document carries unmarked. → [{ idx, code, kind: 'SYSTEM'|'ITEM', hit }] */
export function unmarkedKitLinesOf(fin, findByCode) {
    const out = [];
    ((fin && fin.partsList) || []).forEach((l, idx) => {
        if (!l || isKitLine(l) || l.inKit) return;
        const code = lineCodeOf(l);
        if (!code) return;
        if (parseKitCode(code)) { out.push({ idx, code, kind: 'SYSTEM', hit: null }); return; }
        const hit = typeof findByCode === 'function' ? itemKitOfCode(code, findByCode) : null;
        if (hit) out.push({ idx, code, kind: 'ITEM', hit });
    });
    return out;
}

/** The pull line for ONE part of an item kit, in the kit line's finish. → { line } | { review } */
function partPullOf({ kitLine, hit, comp, part, findByCode, idx }) {
    const lineFinish = U(kitLine.finishCode);
    const f = kitPartFinishOf(part, { finishCode: lineFinish || hit.finishCode, subFinishCode: lineFinish ? '' : (U(kitLine.subFinishCode) || hit.subFinishCode) });
    const code = libCodeOf(part);
    const q = comp.per * (N(kitLine.qty != null ? kitLine.qty : kitLine.quantity) || 1);
    let pull = code, extra = {};
    if (f.finishCode) {
        if (isOutsourcedFinishCode(f.finishCode)) return { review: `${code} would be PLATED ${f.finishCode} — a plated kit is not re-written here; split it by hand` };
        pull = `${code}/P`;                                        // painted: the /P shelf is what the floor paints
        extra = { finishCode: f.finishCode, finishLabel: U(kitLine.finishLabel) || f.finishCode };
    } else if (f.subFinishCode) {
        pull = finishedCodeOf(code, f.subFinishCode);              // a stock colour: its colour item, shelf first
        extra = { subFinishCode: f.subFinishCode, stockColour: true, finishCode: '', finishLabel: f.subFinishCode };
    } else if (hit.primed && !takesNoFinish(part)) {
        pull = `${code}/P`;                                        // the /P kit, no paint named: its /P parts
        extra = { finishCode: '', finishLabel: '' };
    } else {
        extra = { noFinish: true, finishCode: '', finishLabel: '' };   // Unfinished — the part itself
    }
    const rec = pull === code ? part : (typeof findByCode === 'function' ? findByCode(pull) : null);
    if (!rec) return { review: `${pull} is not in the Master Library — sync it (11.1) before the kit can be written as its parts` };
    return { line: {
        productType: rec.productType || part.productType || kitLine.productType || '',
        paintSize: null, clientSku: '', qty: q, qtyEach: comp.per, configQty: kitLine.configQty != null ? kitLine.configQty : 1,
        partId: rec.id || pull, legacyErpId: pull, name: rec.itemName || pull, binLocation: binOfRec(rec), assetUrl: null,
        ...extra, inKit: true, kitOf: lineCodeOf(kitLine), kitLineIdx: idx,
    } };
}

/**
 * The whole repair for one document.
 * @param fin              the finishing document
 * @param soBackorderLines the sales order's backorderLines (the same records the split wrote there), or null
 * @param findByCode       UPPERCASE code → library record;  findPart: library doc id → library record
 * @param stockMap         { CODE: { available, onOrder } } for every part's cover codes (a code read as none = 0), or
 *                         null when the stock could not be read — then no backorder is written and the result says so
 * @returns { ok: false, reason } | { ok: true, finPatch, soBackorderLines, flagged, appended, dropped, added, held, stockKnown }
 */
export function kitRepairPlanOf({ fin, soBackorderLines = null, findByCode, findPart, stockMap = null, by = '', now = Date.now() } = {}) {
    if (!fin) return { ok: false, reason: 'no document' };
    if (pickStarted(fin)) return { ok: false, reason: `picking has started (${fin.pickStatus}) — a pull list is never rewritten mid-pick` };
    const kits = unmarkedKitLinesOf(fin, findByCode);
    if (!kits.length) return { ok: false, reason: 'no unmarked kit line on this document' };
    const old = fin.partsList || [];
    const partsList = old.map(l => ({ ...l }));
    const flagged = [], appended = [], review = [];
    kits.forEach(k => {
        partsList[k.idx] = k.kind === 'SYSTEM'
            ? { ...partsList[k.idx], isKit: true, kitCode: k.code }
            : { ...partsList[k.idx], isKit: true, itemKit: true, kitCode: k.hit.kitCode };
        flagged.push(k.idx);
    });
    kits.filter(k => k.kind === 'ITEM').forEach(k => {
        kitComponentsOf(k.hit.kit).forEach(comp => {
            const part = typeof findPart === 'function' ? findPart(comp.partId) : null;
            if (!part) { review.push(`the kit ${k.hit.kitCode} names a part (${comp.partId}) the Master Library does not hold`); return; }
            const r = partPullOf({ kitLine: old[k.idx], hit: k.hit, comp, part, findByCode, idx: k.idx });
            if (r.review) { review.push(r.review); return; }
            appended.push(partsList.length);
            partsList.push(r.line);
        });
    });
    if (review.length) return { ok: false, reason: review.join(' · ') };

    // Backorders: what pointed at a kit line goes; each appended part short on live stock is recorded.
    const flaggedSet = new Set(flagged);
    const kitCodes = new Set(kits.map(k => k.code));
    const pointsAtKit = (b) => b && (flaggedSet.has(Number(b.lineIndex)) || (b.lineIndex == null && kitCodes.has(U(b.code))));
    const kept = (fin.backorderLines || []).filter(b => !pointsAtKit(b));
    const dropped = (fin.backorderLines || []).length - kept.length;
    const added = [];
    if (stockMap) {
        appended.forEach(i => {
            const line = partsList[i];
            const cls = classifyLine(line, fin.recipe, stockMap, N(line.qty));
            if (cls.state === 'backorder') added.push({ ...backorderRecordOf(line, cls, { since: now, lineIndex: i }), source: 'KIT_REPAIR' });
        });
    }
    const backorderLines = [...kept, ...added];
    const finPatch = {
        partsList, backorderLines,
        kitRepairedAt: now, kitRepairedBy: by || '',
        kitRepair: { flagged, appended, dropped, added: added.length, stockKnown: !!stockMap, from: 'RTG 🧰 Kit lines → parts' },
    };
    let held = !!fin.held;
    if (isBackorderHold(fin)) {
        const h = backorderHoldOf({ lines: backorderLines, stage: fin.heldStage || 'FINISHING', by: fin.heldBy || 'split', now });
        if (h) finPatch.heldReason = h.heldReason;
        else if (stockMap) {
            Object.assign(finPatch, { held: false, heldClearedAt: now, heldClearedBy: by || '', heldClearedNote: 'Kit lines written as their parts — no line short' });
            held = false;
        }
    }
    // The sales order carries the same records: drop what pointed at this document's kit lines, add the parts'.
    let soLines = null;
    if (Array.isArray(soBackorderLines)) {
        soLines = [...soBackorderLines.filter(b => !(b && (U(b.code) && kitCodes.has(U(b.code))) && (b.finWoId ? b.finWoId === fin.id : true) && (b.lineIndex == null || flaggedSet.has(Number(b.lineIndex))))),
            ...added.map(b => ({ ...b, finWoId: fin.id }))];
    }
    return { ok: true, finPatch, soBackorderLines: soLines, flagged, appended, dropped, added: added.length, held, stockKnown: !!stockMap };
}

/** Every cover code the appended parts are judged on — what the caller reads live before planning. */
export function kitRepairStockCodesOf(fin, findByCode, findPart) {
    const plan = kitRepairPlanOf({ fin, findByCode, findPart, stockMap: null });
    if (!plan.ok) return [];
    const codes = new Set();
    plan.appended.forEach(i => {
        const line = plan.finPatch.partsList[i];
        const c = lineCodeOf(line);
        const mill = c.includes('/') ? c.slice(0, c.lastIndexOf('/')) : c;
        [c, `${mill}/P`, mill].forEach(x => x && codes.add(x));
    });
    return [...codes];
}
