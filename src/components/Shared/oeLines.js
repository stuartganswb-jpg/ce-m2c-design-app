// ORDER ENTRY LINES — the pure half of Shared/oeGenerate: what a to-be-finished line is, whether live
// work already covers it, and whether its plan is safe to run without a person. No Firestore, so the
// rules that decide "does this order start by itself" are node-tested (scripts/oeLines.test.mjs).

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

// A made-to-order line. Lines saved before `toBeFinished` existed are recovered from the note.
export const oeIsTbf = (l) => !!(l && (l.toBeFinished || /TO BE FINISHED/i.test(String(l.note || ''))));
export const oeLineFinish = (l) => (l && (l.finishCode || (String(l.note || '').match(/TO BE FINISHED\s*·\s*([A-Z0-9-]+)/i) || [])[1])) || '';
// The need-by a sales order states, whichever door wrote it (Brief E's alias window, eb5cb6b).
export const soNeedBy = (so) => String((so && (so.needBy || so.needByDate)) || '');

// A job is blocked while a shortage sits behind an unresolved hold (unit mismatch, missing vendor,
// missing library part) the operator has neither fixed nor overridden.
export const oeJobBlocked = (j) => ((j && j.components) || []).some(c =>
    (c.held && !c.overrideProceed && c.short > 0) ||
    ((!c.held || c.overrideProceed) && (c.actions || []).some(a => a.kind === 'HOLD')));

/**
 * What already covers ONE line of a sales order, or null.
 *
 * TWO READINGS, because two different questions are asked of it:
 *
 *  · the BOARD a person works (Stock View → Order Entry Needs) asks "is live work behind this line?" —
 *    a closed or deleted work order does not cover it, so the line can be generated again by the
 *    person looking at it (2026-08-29: after a failed-test cleanup the closed WOs hid ⚙ Generate);
 *
 *  · the AUTOMATIC start (RTG, `any: true`) asks "has ANYTHING ever been raised for this line?" — and
 *    must never raise it twice on its own. A FINISHED work order is Closed too, so "no live work" is
 *    exactly what a completed line looks like; read the lenient way, the run would re-make every
 *    finished line of an order still waiting on its others. Here the line's own record on the sales
 *    order (`oeGen[idx]`) or any work order at all covers it; work that was deleted or cancelled is
 *    flagged `dead` so the card can say so in red and a PERSON restarts it from the review.
 *
 * In order: a work order stamped with this line; the line's record on the sales order; then the old
 * reverse lookup by item + finish for orders raised before lines were stamped — never borrowing a
 * work order that is stamped for a DIFFERENT line.
 */
const DEAD = (d) => !!d && (d.deleted === true || ['Deleted', 'CANCELLED'].includes(String(d.status || '')));
const LIVE = (d) => !!d && !DEAD(d) && String(d.status || '') !== 'Closed';
export const oeCoverageOf = ({ so, line, lineIdx, wos = [], pos = [], demands = [], any = false }) => {
    const erp = U(line && line.erp);
    const fin = U(oeLineFinish(line));
    const usable = (d) => (any ? true : LIVE(d));
    // Prefer the live one where a line has had several (a deleted first try, then its replacement).
    const best = (list) => list.find(LIVE) || list.find(d => !DEAD(d)) || list[0] || null;
    const wrap = (kind, d, extra = {}) => ({ kind, doc: d, ...(any && d && DEAD(d) ? { dead: true } : {}), ...extra });
    const exact = best(wos.filter(w => Number.isInteger(w.soLineIdx) && w.soLineIdx === lineIdx && usable(w)));
    if (exact) return wrap('WO', exact);
    const gen = so && so.oeGen && so.oeGen[lineIdx];
    if (gen && gen.kind === 'PLATING') {
        const live = demands.find(d => (gen.ids || []).includes(d.id)) || null;
        return { kind: 'PLATING', doc: live, stamp: gen };
    }
    if (gen && gen.kind === 'WO') {
        const mine = best(wos.filter(w => (gen.ids || []).includes(w.id) && usable(w)));
        if (mine) return wrap('WO', mine, { stamp: gen });
        if (any) return { kind: 'WO', doc: null, stamp: gen, dead: true };   // raised once, and its work orders are gone
    }
    const demand = demands.find(d => U(d.baseErpId) === erp && (!fin || U(d.finishCode) === fin));
    if (demand) return { kind: 'PLATING', doc: demand };
    const wo = best(wos.filter(w => !Number.isInteger(w.soLineIdx) && usable(w)
        && (U(w.rootItem) === erp || U(w.aliasErp) === erp)
        && (!fin || U(w.recipe) === fin)));
    if (wo) return wrap('WO', wo);
    const po = best(pos.filter(p => usable(p) && (p.items || []).some(it => U(it.itemId) === erp)));
    return po ? wrap('PO', po) : null;
};

// Every to-be-finished line of a sales order that nothing covers yet: [{ line, lineIdx }].
export const uncoveredTbfOf = (so, links = {}, opts = {}) => ((so && so.lines) || [])
    .map((line, lineIdx) => ({ line, lineIdx }))
    .filter(x => oeIsTbf(x.line))
    .filter(x => !oeCoverageOf({ so, line: x.line, lineIdx: x.lineIdx, ...links, ...opts }));

// The signature of "these lines, at these quantities" — an answer already given for a signature is
// not asked again; a changed order (a line added, a work order deleted) is a new question.
export const oeAutoSig = (open = []) => open.map(x => `${x.lineIdx}:${U(x.line.erp)}:${U(oeLineFinish(x.line))}:${Number(x.line.qty) || 0}`).join('|');

/**
 * May this planned job run with NO person looking at it?
 *
 * Stuart 2026-09-20: a clean plan runs by itself; anything that needs a decision waits, loudly, on
 * RTG. "Clean" is deliberately narrow — made in-house, everything it pulls is on the shelf, and the
 * units agree. The one make-up step allowed is the routine phosphate convert whose RAW is on the
 * shelf: that is how every painted part is made, and it asks nobody anything.
 */
export const autoRunnable = (job, { unitsKnown = true } = {}) => {
    const reasons = [];
    if (!job) return { ok: false, reasons: ['no plan'] };
    // A BOUGHT LINE THAT IS SHORT is a purchase to decide; one the shelf covers is not (Stuart
    // 2026-09-22). The plan puts the bought item itself in components[] with its `short`, and a
    // covered line gets NO action — no PO is drafted, the work order releases and picks from stock —
    // so there is nothing for a person to decide. Only a shortfall is a decision.
    if (job.buy && (job.components || []).some(c => Number(c.short) > 0)) reasons.push('a bought line that is short — the purchase is reviewed before anything is ordered');
    if (!unitsKnown) reasons.push('NetSuite could not tell us the stock units on this read');
    (job.holds || []).forEach(h => reasons.push(h));
    if (job.poleChoice) reasons.push(`${job.poleChoice.pullErp}: ${job.poleChoice.short} short of the ${job.poleChoice.pullFt} ft length — cut a longer stick or wait (a person chooses)`);
    (job.components || []).forEach(c => {
        if (c.unitMismatch || c.held) { reasons.push(c.holdReason || `${c.code}: units disagree between NetSuite and the app`); return; }
        if (!(c.short > 0)) return;
        const acts = (c.actions || []);
        const routine = acts.length > 0 && acts.every(a => a.kind === 'CONVERT' && (Number(a.rawHave) || 0) >= (Number(a.qty) || 0));
        if (!routine) reasons.push(`${c.code}: ${c.short} short (have ${c.have} of ${c.need}) — sourcing it is a decision`);
    });
    return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
};

// ── WHAT THE RTG CARD SAYS ABOUT ONE LINE ────────────────────────────────────────────────────────
// not started · parked (and why) · on the floor · done — from the work that covers it.
export const oeLineStateOf = ({ coverage, review = null }) => {
    if (coverage && coverage.dead) return { key: 'DEAD', text: `${coverage.doc ? coverage.doc.id : 'its work order'} was deleted or cancelled — NOT in production; restart it from the review`, tone: 'red' };
    if (!coverage) return review ? { key: 'REVIEW', text: `needs a decision — ${(review.reasons || []).join('; ')}`, tone: 'red' } : { key: 'NONE', text: 'not started', tone: 'red' };
    if (coverage.kind === 'PLATING') return coverage.doc ? { key: 'PLATING', text: `plating demand ${coverage.doc.woNum || ''} open — WMS Plating`, tone: 'brass' } : { key: 'PLATING_SENT', text: `plating issued${coverage.stamp && coverage.stamp.ref ? ` (${coverage.stamp.ref})` : ''} — with the plater or received`, tone: 'green' };
    if (coverage.kind === 'PO') return { key: 'PO', text: `on purchase order ${coverage.doc.poId || coverage.doc.id}`, tone: 'brass' };
    const w = coverage.doc || {};
    const st = String(w.status || '');
    if (/complete|done|closed/i.test(st)) return { key: 'DONE', text: `${w.id} — ${st}`, tone: 'green' };
    if (st === 'Dispatched') return { key: 'FLOOR', text: `${w.id} — on the floor`, tone: 'green' };
    const waits = [w.awaitingNsWo && 'NetSuite work-order #', w.awaitingConvert && 'phosphate convert', w.awaitingComponents && 'component work orders', w.awaitingReceipt && 'material receipt', w.awaitingRodCut && 'rod cut'].filter(Boolean);
    return { key: 'PARKED', text: `${w.id} — parked${waits.length ? `: waiting on ${waits.join(' + ')}` : ' — releases on the next RTG pass'}`, tone: 'brass' };
};
