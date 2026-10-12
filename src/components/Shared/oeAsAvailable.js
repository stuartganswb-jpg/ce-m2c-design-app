// ── "FINISH AS AVAILABLE" SWITCHED ON — THE READY LINES OF A PARKED PAIR START (Stuart 2026-10-12) ───────────────────
// The rule is pure (Shared/asAvailableSplit — which lines an open gate holds, what the pair is without the rest); this
// is its one writer, called by BOTH switches (the RTG card and the WMS SO Pack card) after they write the flag:
//   1. the order and its work orders are read fresh;
//   2. each pair parked on a gate gives up its READY lines — the pair is rewritten without them (its gates, milling
//      orders and converts untouched) and those lines' start stamps come off the sales order;
//   3. the ONE generator starts those lines again (Shared/oeGenerate.runOeAuto): a clean line is written as its own
//      pair and released; a line that now needs a person is named on the RTG card, exactly as at order entry.
// The order of the writes is the safe one: a failure after step 2 leaves a line NOT STARTED AND NAMED (the automatic
// start retries it, the review can start it) — never a line on two work orders. A line is only taken off a pair when
// nothing else would read as covering it afterwards (a purchase order raised for it, an older work order).
import { db } from '../../firebase';
import { doc, getDoc, getDocs, query, collection, where, updateDoc, deleteField } from 'firebase/firestore';
import { splitsAsAvailable } from './rowPairShape.js';
import { isReleasable } from './orderStatus';
import { isParkedPair, openGateCodesOf, parkedSplitOf, pairWithoutLinesOf, splitSentence } from './asAvailableSplit.js';
import { runOeAuto, loadOeLinks, oeCoverageOf } from './oeGenerate';
import { releaseFinWoToFloor } from './finishedRunPrecheck';

const readDoc = async (coll, id) => { try { const s = await getDoc(doc(db, coll, String(id))); return s.exists() ? { id: s.id, ...s.data() } : null; } catch (e) { return null; } };

/**
 * @param so         the sales order (its id is what matters — it is read fresh)
 * @param inventory  the library for the brand (Shared/oeGenerate.oeInventoryOf)
 * @returns { moved: number[], released: string[], ran, review, notes: string[] } — `notes` say why a parked pair was left whole
 */
export const startReadyLinesOf = async ({ so, brand, user = '', inventory = [], log = () => {} }) => {
    const out = { moved: [], released: [], ran: 0, review: [], notes: [] };
    if (!so || !so.id) return out;
    const fresh = await readDoc('hq_sales_orders', so.id);
    if (!fresh || !splitsAsAvailable(fresh)) return out;
    const wSnap = await getDocs(query(collection(db, 'hq_work_orders'), where('soAppId', '==', fresh.id)));
    const recs = wSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // A pair that was ready and only waiting for the rest of its order goes now — the order no longer finishes complete.
    for (const r of recs.filter(x => isParkedPair(x) && isReleasable(x) && x.finPayload)) {
        try { if (await releaseFinWoToFloor(r, user || 'finish-as-available')) { out.released.push(r.id); log(`✅ ${r.id} (SO ${fresh.soId || fresh.id}) — ready, and no longer waiting for the rest of the order → RELEASED to the finishing floor.`, 'success'); } }
        catch (e) { out.notes.push(`${r.id}: ready, but could not be released (${e.message || e}) — release it from its RTG card`); }
    }
    const parked = recs.filter(r => isParkedPair(r) && !isReleasable(r));
    if (!parked.length) return out;
    const links = (await loadOeLinks([fresh.id], { all: true }))[fresh.id] || { wos: [], pos: [], demands: [] };
    const lines = fresh.lines || [];
    for (const r of parked) {
        // Nothing of it may be on the floor: a parked pair has no finishing document yet.
        if (await readDoc('fin_workorders', r.id)) { out.notes.push(`${r.id}: already on the finishing floor — left as it is`); continue; }
        const demands = (await Promise.all((r.convertDemandIds || []).map(id => readDoc('convert_demand', id)))).filter(Boolean);
        const componentWos = (await Promise.all((r.componentShopWoIds || []).map(id => readDoc('hq_work_orders', id)))).filter(Boolean);
        let rodCuts = [];
        if (r.awaitingRodCut) {
            try { rodCuts = (await getDocs(query(collection(db, 'rod_cut_orders'), where('finWoId', '==', r.id)))).docs.map(d => ({ id: d.id, ...d.data() })); }
            catch (e) { out.notes.push(`${r.id}: its rod cut could not be read — left as it is`); continue; }
        }
        const gate = openGateCodesOf({ record: r, demands, componentWos, rodCuts });
        const split = parkedSplitOf({ record: r, gate });
        if (!split.ready.length) { out.notes.push(`${r.id}: ${split.why}`); continue; }
        // Only a line that reads UNCOVERED once it is off this pair is moved — the generator would not start any other.
        const simSo = { ...fresh, oeGen: Object.fromEntries(Object.entries(fresh.oeGen || {}).filter(([k]) => !split.ready.includes(Number(k)))) };
        const simWos = (links.wos || []).map(w => (w.id === r.id ? { ...w, soLineIdxs: (w.soLineIdxs || []).filter(i => !split.ready.includes(i)) } : w));
        const movable = split.ready.filter(i => !oeCoverageOf({ so: simSo, line: lines[i], lineIdx: i, wos: simWos, pos: links.pos || [], demands: links.demands || [], any: true }));
        const stuck = split.ready.filter(i => !movable.includes(i));
        if (stuck.length) out.notes.push(`${r.id}: line ${stuck.map(i => i + 1).join(', ')} is ready but something else already covers it (a purchase order or an older work order) — it stays on ${r.id}`);
        if (!movable.length) continue;
        const after = pairWithoutLinesOf({ record: r, moved: movable, lineCount: lines.length });
        if (after.refuse) { out.notes.push(`${r.id}: ${after.refuse}`); continue; }
        await updateDoc(doc(db, 'hq_work_orders', r.id), { ...after.patch, asAvailableSplitBy: user || '' });
        await updateDoc(doc(db, 'hq_sales_orders', fresh.id), Object.fromEntries(movable.map(i => [`oeGen.${i}`, deleteField()])));
        out.moved.push(...movable);
        log(`⚡ ${splitSentence({ ref: r.id, ready: movable, waiting: [...split.waiting, ...stuck].sort((a, b) => a - b), lines })}.`, 'success');
    }
    if (!out.moved.length) return out;
    const movedSet = new Set(out.moved);
    try {
        const soNow = (await readDoc('hq_sales_orders', fresh.id)) || fresh;
        const res = await runOeAuto({ so: soNow, brand, user: user || 'finish-as-available', inventory, log, only: (line, lineIdx) => movedSet.has(lineIdx), force: true });
        out.ran = res.ran || 0; out.review = res.review || []; out.state = res.state;
        if (res.state === 'SKIPPED') log(`⚠ SO ${fresh.soId || fresh.id}: another screen is starting this order right now — line ${out.moved.map(i => i + 1).join(', ')} will be started by the automatic start, or start it from Order Entry Needs.`, 'warn');
        else if (out.review.length) log(`⚠ SO ${fresh.soId || fresh.id}: ${out.review.length} line(s) need a person before they start — ${out.review.map(x => `line ${x.lineIdx + 1} (${x.erp}): ${(x.reasons || [])[0] || ''}`).join(' · ')}. They are on the RTG card: Review & start.`, 'warn');
    } catch (e) {
        log(`⛔ SO ${fresh.soId || fresh.id}: line ${out.moved.map(i => i + 1).join(', ')} came off the parked work order but could not be started (${e.message || e}) — nothing is lost: start ${out.moved.length === 1 ? 'it' : 'them'} from the RTG card (Review & start).`, 'error');
        out.error = String(e.message || e);
    }
    return out;
};

/** What the switch tells the person who flipped it. '' when there was nothing parked to look at. */
export const startReadyLinesText = (res) => {
    if (!res) return '';
    const parts = [];
    if ((res.released || []).length) parts.push(`${res.released.length} work order${res.released.length === 1 ? '' : 's'} that ${res.released.length === 1 ? 'was' : 'were'} ready and waiting for the rest of the order ${res.released.length === 1 ? 'was' : 'were'} released (${res.released.join(', ')}).`);
    if (res.moved.length) parts.push(`${res.moved.length} ready line${res.moved.length === 1 ? '' : 's'} (line ${res.moved.map(i => i + 1).join(', ')}) came off the parked work order${res.ran ? ` and ${res.ran === res.moved.length ? (res.ran === 1 ? 'was' : 'were') : `${res.ran} of them were`} started as ${res.ran === 1 ? 'its' : 'their'} own work order` : ''}.`);
    if (res.review && res.review.length) parts.push(`${res.review.length} line${res.review.length === 1 ? ' needs' : 's need'} a person first — see the RTG card (Review & start).`);
    if (res.error) parts.push(`⚠ The start did not finish (${res.error}) — start the line${res.moved.length === 1 ? '' : 's'} from the RTG card.`);
    (res.notes || []).forEach(n => parts.push(`• ${n}`));
    return parts.join('\n');
};
