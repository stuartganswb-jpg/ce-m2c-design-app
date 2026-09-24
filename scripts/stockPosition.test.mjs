// The one stock reader (Shared/stockPosition) against a fake NetSuite.   node scripts/stockPosition.test.mjs
// What a screen can never show: the 1000-row split, the latched enddate fallback, best-effort On Ord.
import { runChunked, fetchAvailableById, fetchInboundById, backorderTallyOf, ROW_CAP } from '../src/components/Shared/stockPosition.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const idsIn = (q) => ((q.match(/IN \(([^)]*)\)/) || [])[1] || '').split(',').filter(Boolean);
const origWarn = console.warn; console.warn = () => {};

// ── runChunked: a chunk answering AT the cap is split until every answer fits ─────────────────
{
    const calls = [];
    const got = [];
    // each id yields 3 rows → 400 ids = 1200 rows (over cap) → split to 200 (600) → fits
    await runChunked(Array.from({ length: 400 }, (_, i) => String(i)), 400,
        async (chunk) => { calls.push(chunk.length); return chunk.flatMap(id => [id, id, id]); },
        (rows) => got.push(...rows));
    eq('over-cap chunk is re-run as halves', calls, [400, 200, 200]);
    eq('no row lost or doubled in the split', got.length, 1200);
}
{
    const calls = [];
    await runChunked(['a'], 10, async (c) => { calls.push(c.length); return Array(ROW_CAP).fill('x'); }, () => {});
    eq('a single id at the cap cannot split further (no infinite loop)', calls, [1]);
}
{
    let inFlight = 0, peak = 0;
    await runChunked(Array.from({ length: 50 }, (_, i) => String(i)), 5,
        async (c) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise(r => setTimeout(r, 2)); inFlight--; return c; },
        () => {});
    eq('never more than 4 in flight', peak, 4);
}

// ── Avail: one row per id at the named location; absent ids stay absent ──────────────────────
{
    let sawLoc = null;
    const runSql = async (q) => { sawLoc = (q.match(/location = (\d+)/) || [])[1]; return idsIn(q).filter(id => id !== '3').map(id => ({ internal_id: id, avail: id === '1' ? '4.6' : '0' })); };
    const a = await fetchAvailableById(['1', '2', '3'], '17', runSql);
    eq('rounded available per id', a, { 1: 5, 2: 0 });
    eq('the brand location is the one queried', sawLoc, '17');
}

// ── On Ord: PO open lines + WO mainlines, open = ordered − done, closed-out lines dropped ─────
{
    const runSql = async (q) => {
        if (/PurchOrd/.test(q)) return [
            { internal_id: '1', tranid: 'PO100', duedate: '10/1/2026', statusname: 'Pending Receipt', vendor: 'Acme', ordered: '10', done: '4' },
            { internal_id: '1', tranid: 'PO101', statusname: 'Pending Receipt', vendor: 'Acme', ordered: '5', done: '5' },   // fully received → dropped
        ];
        if (/WorkOrd/.test(q)) return [{ internal_id: '2', tranid: 'WO7', duedate: '9/30/2026', expected: '10/2/2026', statusname: 'Released', ordered: '-8', done: '0' }];
        return [];
    };
    const { byId, error } = await fetchInboundById(['1', '2'], runSql);
    eq('PO open qty = ordered − received', byId['1'].qty, 6);
    eq('fully received PO line is not inbound', byId['1'].lines.map(l => l.tranid), ['PO100']);
    eq('WO quantity is read as a magnitude and carries its end date', [byId['2'].qty, byId['2'].lines[0].kind, byId['2'].lines[0].expected], [8, 'WO', '10/2/2026']);
    eq('no error on a clean read', error, null);
}
const enddateRefused = (woCalls) => async (q) => {
    if (!/WorkOrd/.test(q)) return [];
    woCalls.push(/enddate/.test(q));
    if (/enddate/.test(q)) throw new Error('Unknown field enddate');
    return [];
};
{
    // ONE chunk (≤ 400 ids): enddate not queryable → one failed call, then duedate-only. Works.
    const woCalls = [];
    const { error } = await fetchInboundById(['1', '2'], enddateRefused(woCalls));
    eq('single chunk: enddate tried once, then the duedate-only retry', woCalls, [true, false]);
    eq('single chunk: the fallback is not an error', error, null);
}
{
    // ⚠ KNOWN DEFECT — named 2026-09-24 in the move, NOT fixed (outside the approved scope; moved
    // verbatim from the Snapshot). With several chunks IN FLIGHT TOGETHER, every one of them tries
    // enddate; the first to fail flips the latch and retries, and the others then see the latch
    // already off and RE-THROW — so the whole WO half of On Ord fails (the PO half survives). It
    // bites only when NetSuite refuses t.enddate AND more than 400 ids are asked about. Whoever
    // fixes it flips these two assertions on purpose.
    const woCalls = [];
    const { error } = await fetchInboundById(Array.from({ length: 2000 }, (_, i) => String(i)), enddateRefused(woCalls));
    eq('KNOWN DEFECT: first batch all try enddate, one retry, the rest re-throw', woCalls, [true, true, true, true, false]);
    eq('KNOWN DEFECT: the WO read is reported as failed', error?.message, 'Unknown field enddate');
}
{
    // a failure part-way keeps what was gathered and reports it — never throws
    const runSql = async (q) => {
        if (/PurchOrd/.test(q)) return [{ internal_id: '1', tranid: 'PO1', ordered: '3', done: '0' }];
        throw new Error('proxy 503');
    };
    const { byId, error } = await fetchInboundById(['1'], runSql);
    eq('POs gathered before the failure survive', byId['1']?.qty, 3);
    eq('the failure is reported, not thrown', error?.message, 'proxy 503');
}

// ── BO: OUR backorder lines on open orders, keyed by uppercase code ──────────────────────────
{
    const t = backorderTallyOf([
        { id: 'a', status: 'Pending', nsSoTran: 'SO1', customer: 'Fabricut', backorderLines: [{ code: 'h1-75ds/p', qty: 2 }, { code: 'H1-1BP-R', qty: 0 }] },
        { id: 'b', status: 'Approved', soNumber: 'SO2', backorderLines: [{ code: 'H1-75DS/P', qty: '3' }] },
        { id: 'c', status: 'Closed', backorderLines: [{ code: 'H1-75DS/P', qty: 9 }] },
        { id: 'd', deleted: true, backorderLines: [{ code: 'H1-75DS/P', qty: 9 }] },
        { id: 'e', status: 'Cancelled', backorderLines: [{ code: 'H1-75DS/P', qty: 9 }] },
    ]);
    eq('open orders summed under the uppercase code', t['H1-75DS/P']?.qty, 5);
    eq('closed / deleted / cancelled orders never count', Object.keys(t), ['H1-75DS/P']);
    eq('who is waiting is named', t['H1-75DS/P'].orders, ['2 × SO1 (Fabricut)', '3 × SO2']);
    eq('no orders → empty tally', backorderTallyOf(null), {});
}

console.warn = origWarn;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
