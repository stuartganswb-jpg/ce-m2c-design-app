// 🧪 The traverse station — the parts loaded onto the track keep to their own bucket (Stuart 2026-10-07).
//    node scripts/traverseStation.test.mjs
import { isTrackLoadedPart, isTrackLoadedLine, isStationPickLine, trackStampOf, TRAVERSE_GATE, traverseWaitOf, finishingDoneOf, loadedUnitsOf, loadedPatchOf,
    oeTrackCodesOf, oeStationOf, loadRefusal, oeTraverseGateOf, docTrackLinesOf, cpqStationOf, loadedDocStampOf } from '../src/components/Shared/traverseStation.js';
import { pickableLinesOf } from '../src/components/Shared/pickLines.js';
import { pickGateOf, packReadinessOf } from '../src/components/Shared/orderStatus.js';
import { shelfPickPlanOf } from '../src/components/Shared/orderBinPick.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));

// ── which parts: the item's own tick, nothing else ──────────────────────────────────────────────────────────
const item = (trackLoaded) => ({ manufacturingSpecs: { customData: trackLoaded === undefined ? {} : { trackLoaded } } });
eq('only the Library tick makes a part track-loaded — never its name or code', [isTrackLoadedPart(item(true)), isTrackLoadedPart(item(false)), isTrackLoadedPart(item()), isTrackLoadedPart({ itemName: 'Master Carrier', legacyErpId: 'H1-2TRVMC' }), isTrackLoadedPart(null)], [true, false, false, false, false]);
eq('the stamp a parts-list line carries', [trackStampOf(item(true)), trackStampOf(item()), isTrackLoadedLine({ trackLoaded: true }), isTrackLoadedLine({ name: 'Carrier' })], [{ trackLoaded: true }, {}, true, false]);
const TRACK = new Set(['H1-2TRVC', 'H1-2TRVMC', 'H1-2TRVES']);
const isTrackCode = (c) => TRACK.has(String(c).toUpperCase());

// ── ORDER ENTRY, released by count: a 35-display order, Row 5 is the traverse row ───────────────────────────
// Per display: 1 track (made), 8 carriers + 2 master carriers + 2 end stops (shelf — the station's), 2 brackets (shelf — SO Pack's).
const lines = [
    { erp: 'H1-2TRVMTR', name: 'Track', qty: 35, row: 'Row 5', toBeFinished: true, finishCode: 'TCP', trvRole: 'TRACK', cutLength: 47 },
    { erp: 'H1-2TRVC', name: 'Carrier', qty: 280, row: 'Row 5' },
    { erp: 'H1-2TRVMC', name: 'Master carrier', qty: 70, row: 'Row 5' },
    { erp: 'H1-2TRVES', name: 'End stop', qty: 70, row: 'Row 5' },
    { erp: 'H1-2TRV-WB/C', name: 'Wall bracket', qty: 70, row: 'Row 5' },
    { erp: 'FEE-CRATE', name: 'Crating', qty: 1, isFee: true },
];
const so0 = { id: 'S1', soId: 'SO60585', orderClass: 'QUICKSHIP', releaseByCount: true, releaseOf: 35, displayBuildId: 'D1', lines, rowRelease: { ROW_5: { boards: 10, of: 35, log: [{ no: 1, from: 0, to: 10 }] } } };
eq('the order\'s track parts — the bracket and the track itself are not among them', oeTrackCodesOf({ so: so0, isTrackCode }), ['H1-2TRVC', 'H1-2TRVMC', 'H1-2TRVES']);
let st = oeStationOf({ so: so0, isTrackCode, boards: 35 });
eq('10 displays released: the station\'s pick list is what THEY need', st.lines.map(r => `${r.code} ${r.have}/${r.need} pick ${r.toPick} (${r.perUnit}/display)`), ['H1-2TRVC 0/80 pick 80 (8/display)', 'H1-2TRVMC 0/20 pick 20 (2/display)', 'H1-2TRVES 0/20 pick 20 (2/display)']);
eq('nothing picked → nothing can be loaded; 10 displays are in motion', [st.units, st.releasedUnits, st.canLoadTo, st.loaded, st.toPick, st.loadedAll], [35, 10, 0, 0, 120, false]);
eq('the track being loaded, with its cut', st.tracks, [{ code: 'H1-2TRVMTR/C', name: 'Track', qty: 35, cutLength: 47, row: 'Row 5' }]);
ok('…and loading is refused until the parts are in the bin', /Only 0 can be loaded/.test(loadRefusal(st, 1)));

// The station picks: carriers for all 10, master carriers and end stops for only 6.
const so1 = { ...so0, committedBin: 'ORDERS-COM1', committedQty: { 'H1-2TRVC': 80, 'H1-2TRVMC': 12, 'H1-2TRVES': 12 } };
st = oeStationOf({ so: so1, isTrackCode, boards: 35 });
eq('the scarcest track part decides how many displays can be loaded', [st.canLoadTo, st.toPick, st.lines.map(r => r.toPick)], [6, 16, [0, 8, 8]]);
eq('6 may be confirmed, 7 may not, a fraction never', [loadRefusal(st, 6), /Only 6/.test(loadRefusal(st, 7)), /whole number/.test(loadRefusal(st, 2.5)), /35 displays in all/.test(loadRefusal(st, 36))], ['', true, true, true]);
const so2 = { ...so1, traverseStation: loadedPatchOf(so1, 6, { by: 'Sandra', now: 100 }) };
eq('the record on the sales order', [so2.traverseStation.loaded, so2.traverseStation.loadedBy, so2.traverseStation.log, loadedUnitsOf(so2), loadedUnitsOf(so0)], [6, 'Sandra', [{ loaded: 6, at: 100, by: 'Sandra' }], 6, 0]);

// SO Pack: only the LOADED displays may ship; the order is not "ready" while released displays wait on the station.
let gate = oeTraverseGateOf({ so: so2, isTrackCode, boards: 35 });
eq('6 loaded → at most 6 may ship; 4 released displays still wait on the station', [gate.has, gate.shipCap, gate.wait], [true, 6, 'traverse station: its components are not picked and loaded yet']);
gate = oeTraverseGateOf({ so: so0, isTrackCode, boards: 35 });
eq('nothing loaded → nothing may ship', [gate.shipCap, !!gate.wait], [0, true]);
const so3 = { ...so2, committedQty: { 'H1-2TRVC': 80, 'H1-2TRVMC': 20, 'H1-2TRVES': 20 }, traverseStation: loadedPatchOf(so2, 10, { by: 'Sandra', now: 200 }) };
gate = oeTraverseGateOf({ so: so3, isTrackCode, boards: 35 });
eq('all 10 released displays picked and loaded → nothing waits, 10 may ship', [gate.shipCap, gate.wait, gate.station.loadedAll, so3.traverseStation.log.length], [10, '', true, 2]);
// 4 displays ship: their pieces leave the bin; the loaded count stands.
const so4 = { ...so3, displayShipments: [{}, {}, {}, {}], shippedQty: { 'H1-2TRVC': 32, 'H1-2TRVMC': 8, 'H1-2TRVES': 8 }, committedQty: { 'H1-2TRVC': 48, 'H1-2TRVMC': 12, 'H1-2TRVES': 12 } };
st = oeStationOf({ so: so4, isTrackCode, boards: 35 });
eq('after 4 ship: 6 still loaded in the bin, nothing more to pick, the count cannot drop below what shipped', [st.shipped, st.canLoadTo, st.toPick, oeTraverseGateOf({ so: so4, isTrackCode, boards: 35 }).shipCap, /already shipped/.test(loadRefusal(st, 3))], [4, 10, 0, 6, true]);
eq('an order with no track part is not the station\'s: no cap, no wait', [oeTraverseGateOf({ so: so0, isTrackCode: () => false, boards: 35 }).has, oeTraverseGateOf({ so: so0, isTrackCode: () => false, boards: 35 }).shipCap, oeTraverseGateOf({ so: so0, isTrackCode: () => false }).wait], [false, Infinity, '']);

// SO Pack's own pick plan leaves the track parts to the station (`skip`), and the station's takes only them (`onlyCodes`).
const binsOf = () => [{ name: 'A-1', qty: 500 }];
eq('SO Pack picks the bracket, not the carriers', shelfPickPlanOf({ so: so0, binsOf, toBin: 'ORDERS-COM1', skip: isTrackCode }).map(p => `${p.code} ${p.qty}`), ['H1-2TRV-WB/C 20']);
eq('the station picks the carriers, not the bracket', shelfPickPlanOf({ so: so0, binsOf, toBin: 'ORDERS-COM1', onlyCodes: isTrackCode }).map(p => `${p.code} ${p.qty}`), ['H1-2TRVC 80', 'H1-2TRVMC 20', 'H1-2TRVES 20']);
eq('…asked for neither, the plan is what it always was', shelfPickPlanOf({ so: so0, binsOf, toBin: 'ORDERS-COM1' }).length, 4);

// ── ORDER ENTRY, a whole order (tab 7): one unit ────────────────────────────────────────────────────────────
const whole = { id: 'S2', soId: 'SO60812', orderClass: 'QUICKSHIP', lines: [{ erp: 'H1-138TRV', name: 'Traverse rod', qty: 4, toBeFinished: true, finishCode: 'P04', trvRole: 'TRACK' }, { erp: 'H1-2TRVC', name: 'Carrier', qty: 48 }] };
st = oeStationOf({ so: whole, isTrackCode });
eq('one unit: pick 48, then load', [st.units, st.releasedUnits, st.toPick, st.canLoadTo], [1, 1, 48, 0]);
const wholeIn = { ...whole, committedQty: { 'H1-2TRVC': 48 } };
eq('…picked: it can be loaded; loaded: SO Pack waits no more', [oeStationOf({ so: wholeIn, isTrackCode }).canLoadTo, !!oeTraverseGateOf({ so: wholeIn, isTrackCode }).wait, oeTraverseGateOf({ so: { ...wholeIn, traverseStation: { loaded: 1 } }, isTrackCode }).wait], [1, true, '']);

// ── is finishing done? ──────────────────────────────────────────────────────────────────────────────────────
const fin = (o) => ({ id: 'W', currentPhase: 'Setup', ...o });
eq('still on the floor → not yet', [finishingDoneOf([fin({})]).done, finishingDoneOf([fin({ currentPhase: 'Complete' }), fin({ id: 'X', currentPhase: 'Painting' })]).open.map(d => d.id)], [false, ['X']]);
eq('off the floor with the shop half back, pick-only, gathered or packed → done', finishingDoneOf([fin({ currentPhase: 'Complete' }), fin({ pickOnly: true, currentPhase: 'Complete' }), fin({ packStatus: 'Gathered' }), fin({ packStatus: 'Packed' })]).done, true);
eq('finished, but its rod is at the plater → not yet', finishingDoneOf([fin({ currentPhase: 'Complete', hasCustomSibling: true, customFabStatus: 'Sent to Plating' })]).done, false);
eq('a closed document is no one\'s wait; no documents at all is said', [finishingDoneOf([fin({ currentPhase: 'Closed' })]).done, finishingDoneOf([]).none, finishingDoneOf([fin({})]).none], [true, true, false]);

// ── CPQ: the components are on the finishing documents ──────────────────────────────────────────────────────
const cpqA = { id: 'WO-SO1-TCP', currentPhase: 'Setup', sentToPickPack: true, pickStatus: 'Pending', traverseGate: 'WAITING',
    partsList: [{ legacyErpId: 'H1-2TRVC', name: 'Carrier', qty: 8, trackLoaded: true, noFinish: true }, { legacyErpId: 'H1-2TRVC', name: 'Carrier', qty: 8, trackLoaded: true, noFinish: true }, { legacyErpId: 'H1-2TRVMC', name: 'Master carrier', qty: 2, trackLoaded: true, pickOnly: true },
        { legacyErpId: 'H1-2TRVBAT', name: 'Baton (painted)', qty: 1, trackLoaded: true }, { legacyErpId: 'H1-2TRV-WB', name: 'Bracket', qty: 2 }] };
const cpqB = { id: 'WO-SO1-S04', currentPhase: 'Complete', traverseGate: 'WAITING', partsList: [{ legacyErpId: 'H1-2RCTWR-O', name: 'Fascia', qty: 1, cutLength: 48 }] };
eq('the pick BEFORE finishing leaves the stocked track parts on the shelf — a PAINTED one is still pulled, it has to be painted', pickableLinesOf(cpqA).map(l => l.legacyErpId), ['H1-2TRVBAT', 'H1-2TRV-WB']);
ok('a document whose only parts are the station\'s has no pull to wait for', !pickGateOf({ id: 'T', partsList: [{ legacyErpId: 'H1-2TRVC', qty: 8, trackLoaded: true, noFinish: true }] }).blocked);
ok('…a painted track part gates the floor like any part', pickGateOf({ id: 'T', partsList: [{ legacyErpId: 'H1-2TRVBAT', qty: 1, trackLoaded: true }] }).blocked);
eq('which line the station picks', [isStationPickLine({ trackLoaded: true, noFinish: true }), isStationPickLine({ trackLoaded: true, pickOnly: true }), isStationPickLine({ trackLoaded: true }), isStationPickLine({ noFinish: true })], [true, true, false, false]);
ok('…while an ordinary part still gates the floor until its pull is released', pickGateOf({ id: 'T', partsList: [{ legacyErpId: 'H1-2TRV-WB', qty: 2 }] }).blocked);
eq('the station\'s list for the order, one row per item — what it picks, and what reaches it off the floor', docTrackLinesOf([cpqA, cpqB]).map(r => `${r.code} ${r.qty} pick ${r.pick}`), ['H1-2TRVC 16 pick 16', 'H1-2TRVMC 2 pick 2', 'H1-2TRVBAT 1 pick 0']);
let cs = cpqStationOf([cpqA, cpqB]);
eq('both documents of the order wait on the station', [cs.gated.length, cs.waiting.length, cs.loaded], [2, 2, false]);
ok('…and neither may be packed, even the finished one', packReadinessOf(cpqB).ready === false && packReadinessOf(cpqB).waits.includes(traverseWaitOf(cpqB)));
const stamp = loadedDocStampOf({ by: 'Sandra', now: 500 });
eq('the station\'s confirmation', stamp, { traverseGate: TRAVERSE_GATE.LOADED, traverseLoadedAt: 500, traverseLoadedBy: 'Sandra' });
cs = cpqStationOf([{ ...cpqA, ...stamp }, { ...cpqB, ...stamp }]);
ok('…lifts it: the finished document is ready to pack', cs.loaded && packReadinessOf({ ...cpqB, ...stamp }).ready === true && traverseWaitOf({ ...cpqB, ...stamp }) === '');
eq('an order with no track part carries no gate', [cpqStationOf([{ id: 'P', currentPhase: 'Complete', partsList: [] }]).gated.length, traverseWaitOf({ id: 'P' }), packReadinessOf({ id: 'P', currentPhase: 'Complete' }).ready], [0, '', true]);

console.log(`traverseStation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
