// ── "FINISH AS AVAILABLE", FLIPPED ON AN ORDER WHOSE WORK IS ALREADY PARKED (Stuart 2026-10-12, SO60812) ────────────────
// "No, let's fix it for real … so that the multiple workorders can release and be tied together."
// An order that is as-available from the start is written that way (Shared/rowPairShape.asAvailableWavesOf: the ready
// lines one pair, the waiting lines another). An order that was written "finish complete" and is switched LATER — from
// its RTG card or its SO Pack card — has a pair already parked in RTG holding both kinds: WO-OE-SO60812-5757 carried
// 100 end caps and 100 rods behind a bracket whose two arms were at the mill. This is the rule for that pair:
//   · which of its sales-order lines an OPEN gate is waiting on (the gate names an item; the pair's pull lines say which
//     line asks for it) — those STAY, with their milling orders, converts, cut and receipt exactly as they are;
//   · every other finishing-side line is READY — it leaves the pair and is started again by the ONE generator
//     (Shared/oeGenerate.runOeAuto), which writes it as its own pair and releases it;
//   · what the pair is once they have left (its pull lines, its count, its tracks, its facts).
// Nothing here guesses: a pair whose open gate names no line of it is left whole, and so is a pair with a shop job (a
// pole and what rides it stay with their pair). Pure — scripts/asAvailableSplit.test.mjs; the writer is Shared/oeAsAvailable.
import { docStreamsOf, pairItemNameOf } from './rowPairShape.js';
import { pairFactsOf } from './partFacts.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const baseOf = (code) => { const c = U(code); const i = c.lastIndexOf('/'); return i > 0 ? c.slice(0, i) : c; };
const DONE = ['DONE', 'COMPLETE', 'COMPLETED', 'CLOSED', 'CANCELLED', 'DELETED', 'BUILT'];
const isDone = (status) => DONE.includes(U(status));

/** Is this RTG record a pair parked on a gate that could be holding ready lines? (Order Entry, finishing side, never released.) */
export const isParkedPair = (r) => !!r && !r.deleted && r.status === 'Approved' && r.source === 'ORDER_ENTRY' && r.routeTo === 'FINISHING'
    && /^WO-OE-/i.test(String(r.id || '')) && !/-C$/i.test(String(r.id || '')) && !r.pushedToFinishing;

/**
 * The items a parked pair's OPEN gates are waiting on.
 * @param record        the pair's RTG record (its awaiting… flags and receiptRefs)
 * @param demands       its convert demands (convert_demand docs named in convertDemandIds)
 * @param componentWos  its component milling orders (hq_work_orders named in componentShopWoIds)
 * @param rodCuts       its rod cut order(s) (rod_cut_orders)
 * @returns { codes: Set<string>, open: string[] } — every code with and without its finish suffix; `open` names the gates
 */
export function openGateCodesOf({ record = {}, demands = [], componentWos = [], rodCuts = [] } = {}) {
    const codes = new Set(), open = [];
    const add = (c) => { const u = U(c); if (u) { codes.add(u); codes.add(baseOf(u)); } };
    if (record.awaitingConvert) {
        const live = (demands || []).filter(d => d && !isDone(d.status));
        live.forEach(d => { add(d.targetErpId || d.targetItemId); add(d.baseErpId || d.baseItemId); });
        open.push('convert');
    }
    if (record.awaitingComponents) {
        (componentWos || []).filter(w => w && !w.deleted && !isDone(w.status) && U(w.floorPhase) !== 'COMPLETE')
            .forEach(w => add(w.partErpId || w.erpId || w.rootItem || w.type));
        open.push('components');
    }
    if (record.awaitingReceipt) {
        (record.receiptRefs || []).filter(r => r && N(r.receivedSoFar) < N(r.qtyNeeded)).forEach(r => add(r.itemId));
        open.push('receipt');
    }
    if (record.awaitingRodCut) {
        (rodCuts || []).filter(c => c && !isDone(c.status)).forEach(c => { add(c.targetItemId); add(c.sourceItemId); add(c.finWoErpId); });
        open.push('rod cut');
    }
    return { codes, open };
}

/**
 * WHICH LINES OF A PARKED PAIR WAIT, AND WHICH ARE READY.
 * A line waits when one of its pull lines is an item an open gate names (H2-138-TB3/P ← the convert of H2-138-TB3).
 * A line with no pull line on the document at all (nothing to pull was planned for it) is not held by any gate.
 * @returns { ready: number[], waiting: number[], why: string } — `why` says why nothing is split, '' when something is
 */
export function parkedSplitOf({ record = {}, gate = { codes: new Set(), open: [] } } = {}) {
    const idxs = [...new Set((record.soLineIdxs || []).filter(Number.isInteger))].sort((a, b) => a - b);
    const all = { ready: [], waiting: idxs };
    if (idxs.length < 2) return { ...all, why: 'it carries one line' };
    if (record.hasCustomSibling || record.shopSiblingId) return { ...all, why: 'it has a shop job — a pole and what rides it stay with their work order' };
    if (!gate.open.length) return { ...all, why: 'it is not waiting on anything — it releases as it is' };
    const parts = Array.isArray(record.partsList) ? record.partsList : [];
    const waits = new Set(parts.filter(p => p && (gate.codes.has(U(p.legacyErpId || p.partId)) || gate.codes.has(baseOf(p.legacyErpId || p.partId)))).map(p => p.soLineIdx).filter(Number.isInteger));
    if (!waits.size) return { ...all, why: `its open gate (${gate.open.join(' + ')}) names none of its lines — it is left whole for a person` };
    const ready = idxs.filter(i => !waits.has(i));
    if (!ready.length) return { ...all, why: 'every line of it is waiting' };
    return { ready, waiting: idxs.filter(i => waits.has(i)), why: '' };
}

/**
 * THE PAIR ONCE ITS READY LINES HAVE LEFT — the fields to write on its RTG record (`patch`, top-level fields replaced
 * whole) with its finishing payload rebuilt (`patch.finPayload`). Its gates, its links and its id are untouched.
 * @returns { patch } | { refuse: string }
 */
export function pairWithoutLinesOf({ record = {}, moved = [], lineCount = 0, now = Date.now() } = {}) {
    const gone = new Set((moved || []).filter(Number.isInteger));
    const fin = record.finPayload || {};
    const parts = (Array.isArray(record.partsList) ? record.partsList : (fin.partsList || []));
    const kept = parts.filter(p => p && !gone.has(p.soLineIdx));
    if (!kept.length) return { refuse: 'nothing would be left on it' };
    const soLineIdxs = (record.soLineIdxs || []).filter(i => !gone.has(i));
    const inHouse = kept.filter(p => !p.pickOnly);
    if (!fin.pickOnly && !inHouse.length) return { refuse: 'what is left is only picked, not finished — it needs a person' };
    const streams = docStreamsOf({ parts: inHouse, shopPoles: 0 });
    const totalParts = fin.pickOnly ? kept.reduce((t, p) => t + (N(p.pcs) || N(p.quantity) || N(p.qty)), 0) : (streams.totalParts || 1);
    const facts = pairFactsOf({ partsList: kept, cutList: [], lineCount: N(lineCount) || N(record.lineCount) });
    const itemName = pairItemNameOf({ rowLabel: record.rowLabel || '', soRef: record.soId || '', finish: record.finishGroup || record.recipe || '', relLabel: record.releaseLabel || '', small: soLineIdxs.length, custom: 0 });
    // A material row is kept while an item still on the document asks for it.
    const keptCodes = new Set(kept.flatMap(p => [U(p.legacyErpId || p.partId), baseOf(p.legacyErpId || p.partId)]));
    const rowsOf = (rows) => (Array.isArray(rows) ? rows.filter(r => r && (keptCodes.has(U(r.code)) || keptCodes.has(baseOf(r.code)))) : rows);
    // The finishing payload, rebuilt: the tracks it no longer runs are gone, not left behind.
    const finNext = { ...fin };
    ['poles', 'totalPoles', 'poleStepIndex', 'finishStream', 'paintSize', 'paintSizes'].forEach(k => { delete finNext[k]; });
    Object.assign(finNext, {
        partsList: kept, soLineIdxs, totalParts, itemName, updatedAt: now,
        ...(fin.pickOnly ? { paintSize: null, paintSizes: null } : streams.fields),
        ...facts,
        ...(fin.materialRows !== undefined ? { materialRows: rowsOf(fin.materialRows) } : {}),
    });
    const patch = {
        partsList: kept, soLineIdxs, totalParts, qty: totalParts, itemName,
        ...facts,
        ...(record.materialRows !== undefined ? { materialRows: rowsOf(record.materialRows) } : {}),
        finPayload: finNext,
        asAvailableSplitAt: now, asAvailableMovedLines: [...gone].sort((a, b) => a - b),
    };
    return { patch };
}

/** One sentence for the log and the card: what was moved off a pair and what stayed. */
export const splitSentence = ({ ref = '', ready = [], waiting = [], lines = [] } = {}) => {
    const name = (i) => `line ${i + 1}${lines[i] && lines[i].erp ? ` (${U(lines[i].erp)})` : ''}`;
    return `${ref}: ${ready.map(name).join(', ')} ${ready.length === 1 ? 'is' : 'are'} ready and start${ready.length === 1 ? 's' : ''} as ${ready.length === 1 ? 'its' : 'their'} own work order; ${waiting.map(name).join(', ')} stay${waiting.length === 1 ? 's' : ''} on ${ref} until ${waiting.length === 1 ? 'its' : 'their'} gates clear`;
};
