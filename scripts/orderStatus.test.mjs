// The gate list + the custom-half states, offline.
//   node scripts/orderStatus.test.mjs
//
// Brief B2 / B5 (2026-09-02). The six gates used to be hand-written in three places; this pins
// the ONE list's answers so a reader swap cannot change what releases. If a rule change breaks a
// row here, the change is wrong, not the test — unless Stuart changed the rule.

import {
    GATES, gatesOf, openGatesOf, isReleasable, gateSummary,
    customPartsReady, customFabLabel, orderStatusOf, STAGES, stageTone, quickShipStatusOf,
} from '../src/components/Shared/orderStatus.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// ── the six gates, in flow order ──
eq('gate keys in flow order', GATES.map(g => g.key), ['soAccept', 'nsWo', 'components', 'convert', 'rodCut', 'dispatched']);
eq('only dispatched is a done-gate', GATES.filter(g => g.kind === 'done').map(g => g.key), ['dispatched']);

// ── a clean parked order releases ──
const clean = { id: 'WO-1', status: 'Approved' };
ok('clean order is releasable', isReleasable(clean));
eq('clean order has no open gates', openGatesOf(clean), []);
eq('clean order summary is empty', gateSummary(clean), '');
eq('gatesOf still lists all six for a clean order', gatesOf(clean).length, 6);
ok('missing record is never releasable', !isReleasable(null) && !isReleasable(undefined));
eq('gatesOf(null) is empty', gatesOf(null), []);

// ── each gate, exactly as the three hand-written lists tested it ──
ok('awaitingSoAccept parks', !isReleasable({ ...clean, awaitingSoAccept: true }));
ok('awaitingNsWo without nsWoId parks', !isReleasable({ ...clean, awaitingNsWo: true }));
ok('awaitingNsWo WITH nsWoId releases (writeBack landed)', isReleasable({ ...clean, awaitingNsWo: true, nsWoId: '123' }));
ok('awaitingComponents without componentsDone parks', !isReleasable({ ...clean, awaitingComponents: true }));
ok('awaitingComponents WITH componentsDone releases', isReleasable({ ...clean, awaitingComponents: true, componentsDone: true }));
ok('awaitingConvert parks', !isReleasable({ ...clean, awaitingConvert: true }));
ok('awaitingConvert:false (cleared) releases', isReleasable({ ...clean, awaitingConvert: false }));
ok('awaitingRodCut parks', !isReleasable({ ...clean, awaitingRodCut: true }));
ok('pushedToFinishing parks (released once)', !isReleasable({ ...clean, pushedToFinishing: true }));

// ── the words ──
eq('two open gates, flow order, one wording',
    gateSummary({ ...clean, awaitingRodCut: true, rodCutNote: '2 × 8ft', awaitingSoAccept: true, soAppId: 'SO-9' }),
    'awaiting SO accept · SO-9 · awaiting rod cut · 2 × 8ft');
eq('component gate counts its shop WOs', gateSummary({ ...clean, awaitingComponents: true, componentShopWoIds: ['a', 'b'] }), 'awaiting component milling · 2 shop WO(s)');
eq('convert gate carries its note', gateSummary({ ...clean, awaitingConvert: true, convertGateNote: 'H1-1/P short 4' }), 'awaiting phosphate convert · H1-1/P short 4');
ok('every gate has help text and a clearer', gatesOf({ ...clean, id: 'WO-2' }).every(g => g.help && g.clearedBy && g.icon));
ok('help names the order', gatesOf({ ...clean, id: 'WO-2', awaitingRodCut: true }).find(g => g.key === 'rodCut').help.startsWith('WO-2 '));
ok('help names the item when the record carries one', gatesOf({ ...clean, itemCode: 'HCUMP810/BS', awaitingConvert: true }).find(g => g.key === 'convert').help.includes('HCUMP810/BS'));

// ── the custom half ──
ok('no custom sibling → ready', customPartsReady({ hasCustomSibling: false }));
ok('legacy doc without the flag → ready', customPartsReady({}));
ok('Pending → not ready', !customPartsReady({ hasCustomSibling: true, customFabStatus: 'Pending' }));
ok('In Process → not ready', !customPartsReady({ hasCustomSibling: true, customFabStatus: 'In Process' }));
ok('Sent to Plating → NOT ready (the P0 #3 fix)', !customPartsReady({ hasCustomSibling: true, customFabStatus: 'Sent to Plating' }));
ok('Complete → ready', customPartsReady({ hasCustomSibling: true, customFabStatus: 'Complete' }));

const sep2 = new Date(2026, 8, 2, 12).getTime();
const expectDate = new Date(sep2).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
eq('label: at the plater since <date>', customFabLabel({ customFabStatus: 'Sent to Plating', customFabAt: sep2 }), `At the plater since ${expectDate}`);
eq('label: at the plater, no date stamped', customFabLabel({ customFabStatus: 'Sent to Plating' }), 'At the plater');
eq('label: other states pass through', ['Pending', 'In Process', 'Complete'].map(s => customFabLabel({ customFabStatus: s })), ['Pending', 'In Process', 'Complete']);
eq('label: missing = Pending', customFabLabel({}), 'Pending');

// ── the derived status shows the plater ──
ok('PLATING stage exists between SHOP and FINISHED', STAGES.PLATING && STAGES.PLATING.rank > STAGES.SHOP.rank && STAGES.PLATING.rank < STAGES.FINISHED.rank);
ok('PLATING is in-progress brass', stageTone('PLATING') === stageTone('SHOP'));
const plated = orderStatusOf({ hasCustomSibling: true, customFabStatus: 'Sent to Plating', customFabAt: sep2, currentPhase: 'Complete' }, { recipeLen: 2 });
eq('custom stream reads PLATING', plated.streams.find(s => s.key === 'CUSTOM').stage, 'PLATING');
eq('custom stream detail is since <date>', plated.streams.find(s => s.key === 'CUSTOM').detail, `since ${expectDate}`);
eq('slowest is the plater, not the finished small parts', plated.slowest, 'PLATING');
ok('not done while at the plater', !plated.done);
const inShop = orderStatusOf({ hasCustomSibling: true, customFabStatus: 'In Process', currentPhase: 'Setup' }, { recipeLen: 2 });
eq('In Process still reads SHOP (unchanged)', inShop.streams.find(s => s.key === 'CUSTOM').stage, 'SHOP');
const doneShop = orderStatusOf({ hasCustomSibling: true, customFabStatus: 'Complete', currentPhase: 'Setup' }, { recipeLen: 2 });
eq('Complete still reads FINISHED (unchanged)', doneShop.streams.find(s => s.key === 'CUSTOM').stage, 'FINISHED');

// ── a stocked (Order Entry / Quick Ship) sales order's stage, from the SO doc the WMS stamps ──
// The QUICKSHIP vocabulary is status === pickStatus in {'Pending','Picked','Shipped'} (D's
// setQSStatus writes both together) — never the finishing job's pickStatus values.
eq('QS: NS_QUEUED = awaiting NetSuite', quickShipStatusOf({ status: 'NS_QUEUED' }).stage, 'AWAITING_NS');
eq('QS: Pending = in the pick queue', quickShipStatusOf({ status: 'Pending', pickStatus: 'Pending' }).stage, 'PICKING');
eq('QS: a pick CLAIM names who has it open', quickShipStatusOf({ status: 'Pending', pickInProgress: { by: 'Andrea', startedAt: 1 } }).by, 'Andrea');
eq('QS: a pick claim is "open on a tablet", not progress', quickShipStatusOf({ status: 'Pending', pickInProgress: { by: 'Andrea', startedAt: 1 } }).detail, 'open on a pick tablet');
eq('QS: Picked (both fields) = awaiting pack', quickShipStatusOf({ status: 'Picked', pickStatus: 'Picked' }).stage, 'PICKED');
eq('QS: the finishing vocabulary is NOT read as picked', quickShipStatusOf({ status: 'Pending', pickStatus: 'Picked_Awaiting_Staging' }).stage, 'PICKING');
eq('QS: packed, no fulfilment yet', quickShipStatusOf({ status: 'Picked', packStatus: 'Packed' }).stage, 'PACKED');
eq('QS: Shipped', quickShipStatusOf({ status: 'Shipped', pickStatus: 'Shipped', nsIfTran: 'IF123' }).stage, 'SHIPPED');
eq('QS: fulfilment present but not marked shipped = packed, fulfilment posted', quickShipStatusOf({ status: 'Picked', packStatus: 'Packed', nsIfTran: 'IF123' }).detail, 'fulfilment IF123 posted');
eq('QS: closed', quickShipStatusOf({ status: 'Closed' }).stage, 'CLOSED');
eq('QS: null in, null out', quickShipStatusOf(null), null);
ok('AWAITING_NS ranks below everything started', STAGES.AWAITING_NS.rank < STAGES.RELEASED.rank);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
