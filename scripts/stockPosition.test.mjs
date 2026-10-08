// The one stock reader (Shared/stockPosition) against a fake NetSuite.   node scripts/stockPosition.test.mjs
// What a screen can never show: the 1000-row split, the latched enddate fallback, best-effort On Ord.
import { runChunked, fetchAvailableById, fetchInboundById, backorderTallyOf, ROW_CAP } from '../src/components/Shared/stockPosition.js';
import { fetchPositionById, uncoveredOf, variantsUncoveredOf, suggestedOf, shortfallToFloorOf, uncoveredWords } from '../src/components/Shared/stockPosition.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, cond) => { if (cond) { pass++; return; } fail++; console.log(`✗ ${n}`); };
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

// ── Position: Available AND NetSuite's Backordered, one query, the brand's location ─────────────────────
{
    let q0 = '';
    const runSql = async (q) => { q0 = q; return idsIn(q).filter(id => id !== '3').map(id => ({ internal_id: id, avail: id === '1' ? '4.6' : '0', backordered: id === '2' ? '100' : (id === '1' ? '-3' : null) })); };
    const p = await fetchPositionById(['1', '2', '3'], '17', runSql);
    eq('available as before', p.availById, { 1: 5, 2: 0 });
    eq('backordered beside it — never negative, absent ids stay absent', p.backorderedById, { 1: 0, 2: 100 });
    ok('both in ONE query, at the brand location', /quantityavailable/.test(q0) && /quantitybackordered/.test(q0) && /location = 17/.test(q0));
}

// ── WHAT IS STILL UNCOVERED — the one rule (Stuart 2026-10-08), on the numbers read live 10-07 ───────────
{
    // H1-138TRVSBA/P: 118 on hand, 70 committed to the wall → 48 available, nothing backordered. The old grid
    // rule (committed + backorder + display − available − on order) asked for 22, and 88 with the display added.
    eq('committed is already inside Available — a fully covered item lacks nothing', uncoveredOf({ backorder: 0, available: 48, onOrder: 0 }), 0);
    eq('…and the grid suggests nothing while it sits above its reorder point', suggestedOf({ rop: 36, available: 48, backorder: 0 }), 0);
    // H1-TTB1: 50 on hand all committed to the first order, 100 backordered for SO60992.
    eq('what NetSuite could not commit is what is short', uncoveredOf({ backorder: 100, available: 0, onOrder: 0 }), 100);
    eq('stock on its way covers it', uncoveredOf({ backorder: 100, available: 0, onOrder: 60 }), 40);
    eq('…and so does stock at another location', uncoveredOf({ backorder: 100, available: 30, onOrder: 60 }), 10);
    eq('never negative', uncoveredOf({ backorder: 5, available: 500, onOrder: 0 }), 0);
    eq('a display still at quote stage is in nobody\'s numbers — it is added', uncoveredOf({ backorder: 0, displayNew: 100, available: 30 }), 70);
    eq('nothing known, nothing asked', [uncoveredOf(), uncoveredOf({}), uncoveredOf({ backorder: 'x', available: null })], [0, 0, 0]);

    // A RAW item's row: its finished variants are netted against THEIR OWN stock first.
    const variants = [
        { backorder: 0, available: 48, onOrder: 0 },            // /P: 70 committed, all on the shelf → needs no raw
        { backorder: 200, available: 0, onOrder: 0 },           // /EP4: 200 short → 200 to make
        { backorder: 70, available: 0, onOrder: 70 },           // /EP2: short, but a work order for all 70 is open
        { backorder: 0, displayNew: 100, available: 20 },       // /EP1: a quote-stage display, 20 on the shelf → 80
    ];
    eq('variants: each against its own stock and inbound', variantsUncoveredOf(variants), 280);
    eq('the raw item must cover that, less its own stock and what is on order', uncoveredOf({ backorder: 0, fromVariants: 280, available: 150, onOrder: 50 }), 80);
    eq('no variants, nothing rolled up', [variantsUncoveredOf([]), variantsUncoveredOf(null), variantsUncoveredOf([null])], [0, 0, 0]);

    // THE GRID: greater of the top-up and the cover.
    eq('below the reorder point with nothing short → the top-up', suggestedOf({ rop: 36, available: 10, backorder: 0 }), 26);
    eq('short by more than the top-up → the cover', suggestedOf({ rop: 36, available: 0, backorder: 100 }), 100);
    eq('the top-up when it is the greater', suggestedOf({ rop: 150, available: 0, backorder: 100 }), 150);
    eq('raw: variants\' need counts in the cover', suggestedOf({ rop: 0, available: 150, onOrder: 50, fromVariants: 280 }), 80);

    // THE SNAPSHOT: the minimum on hand ON TOP of the open demand. H1-1BF/EP2: min 17, 0 available, 100 backordered
    // for SO60992 — it read 17 (rounded to a batch of 35).
    eq('the old Snapshot number, when nothing is backordered', shortfallToFloorOf({ floor: 17, available: 0, onOrder: 0 }), 17);
    eq('backordered pieces are owed BEFORE the shelf is refilled', shortfallToFloorOf({ floor: 17, backorder: 100, available: 0, onOrder: 0 }), 117);
    eq('on order counts once', shortfallToFloorOf({ floor: 17, backorder: 100, available: 0, onOrder: 60 }), 57);
    eq('a shelf above the floor with nothing short asks for nothing', shortfallToFloorOf({ floor: 17, available: 30 }), 0);
    eq('HTSLNTCAR: 11,664 available, the displays already committed inside it', shortfallToFloorOf({ floor: 2000, backorder: 0, available: 11664 }), 0);
    eq('a quote-stage display on a stocked item', shortfallToFloorOf({ floor: 17, displayNew: 100, available: 40 }), 77);
    eq('raw core: its variants\' need on top of its own floor', shortfallToFloorOf({ floor: 300, backorder: 0, fromVariants: 280, available: 150, onOrder: 50 }), 380);

    ok('the words name only what is there', uncoveredWords({ backorder: 100, available: 0 }) === '100 backordered in NetSuite · less 0 available');
    ok('…every part when every part is there', /100 backordered in NetSuite · 40 for a display not in NetSuite yet · 280 its finished variants still lack · less 150 available · less 50 on order/.test(uncoveredWords({ backorder: 100, displayNew: 40, fromVariants: 280, available: 150, onOrder: 50 })));
}

console.warn = origWarn;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
