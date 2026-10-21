// Shared/trackFacts — a traverse's draw, motor side and carriers, from the order to the traverse station and the shop's cut sheet header
// (Stuart 2026-10-21: "that data ultimately needs to flow to the traverse station" · "it should present them with example 'Left Draw, 72
// carriers needed'" · "the traverse cut sheet header as well").
//   node scripts/trackFacts.test.mjs
// TRACKFACTS_MODULE=<path> runs the same assertions against a mutated copy (mutation check).
import { withCartLines, lineFactsOf } from '../src/components/Shared/partFacts.js';
import { configuratorLines } from '../src/components/Shared/traverseConfigurator.js';
import { sessionOf } from '../src/components/Shared/hardwareSession.js';
import { ASSEMBLY, PINS } from './hardwareAutoPicks.fixture.mjs';
import { floorGroupsOf, pairShapeOf, pairIdsOf } from '../src/components/Shared/rowPairShape.js';

const T = await import(process.env.TRACKFACTS_MODULE || new URL('../src/components/Shared/trackFacts.js', import.meta.url).href);
const { carriersOnTrackOf, trackFactsOf, trackFactsFrom, trackFactsWords, traversesOf, cpqTrackFactsOf, kitTrackFactsOf, TRACK_FACT_FIELDS } = T;

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };

// ── the carriers on the track: the carrier style's lines of the components step ─────────────────────────────────────────────────
const RULES = { usage: [{ label: 'Pinch Pleat Carriers', itemId: 'HTSLNTCAR', byFeet: { 2: 8, 4: 16, 8: 32, 12: 48, 18: 72 } }, { label: 'Ripplefold Carriers', itemId: 'HTSRIPCAR', byFeet: { 4: 12, 18: 54 } }],
    configurator: [{ itemId: 'HTTENDSTOP', drive: 'BOTH', billable: false }] };
const lines18 = configuratorLines({ rules: RULES, drive: 'MANUAL', feet: 18, sel: { carrierStyle: 'HTSLNTCAR', carrierQty: '', picks: { HTTENDSTOP: 2 } }, priceOf: () => 1 });
const lines80 = configuratorLines({ rules: RULES, drive: 'MANUAL', feet: 18, sel: { carrierStyle: 'htslntcar', carrierQty: '80', picks: {} }, priceOf: () => 1 });
eq('the chart\'s carriers at the length — and a count typed above the chart (included + charged) — never the end stops',
    [carriersOnTrackOf({ sel: { carrierStyle: 'HTSLNTCAR' }, lines: lines18 }), carriersOnTrackOf({ sel: { carrierStyle: 'htslntcar' }, lines: lines80 })], [72, 80]);
eq('no carrier style chosen → nothing to say; no lines → none on the order', [carriersOnTrackOf({ sel: { carrierStyle: '' }, lines: lines18 }), carriersOnTrackOf({ sel: null, lines: lines18 }), carriersOnTrackOf({ sel: { carrierStyle: 'HTSRIPCAR' }, lines: lines18 })], [null, null, 0]);

// ── the stamp and the words ───────────────────────────────────────────────────────────────────────────────────────────────────
eq('the stamp: the traverse it belongs to, then only what was answered', [trackFactsOf({ id: 'K1', name: 'H1-2TRV-4/P · 18 ft', draw: 'left', carriers: 72 }), trackFactsOf({ id: 'L', motorSide: 'RIGHT', carriers: '' }), trackFactsOf({})],
    [{ traverseLine: 'K1', traverseName: 'H1-2TRV-4/P · 18 ft', traverseDraw: 'LEFT', traverseCarriers: 72 }, { traverseLine: 'L', traverseMotorSide: 'RIGHT' }, { traverseLine: 'TRAVERSE' }]);
eq('the words the station and the cut sheet say — the draw in the order\'s own words, then the motor, then the carriers', [
    trackFactsWords(trackFactsOf({ id: 'a', draw: 'LEFT', carriers: 72 })),
    trackFactsWords(trackFactsOf({ id: 'a', draw: 'CENTER', motorSide: 'RIGHT', carriers: 64 })),
    trackFactsWords(trackFactsOf({ id: 'a', carriers: 72 })),
    trackFactsWords(trackFactsOf({ id: 'a', draw: 'RIGHT', carriers: 1 })),
    trackFactsWords(trackFactsOf({ id: 'a', draw: 'RIGHT', carriers: 0 })),
    trackFactsWords(trackFactsOf({ id: 'a' })),
], ['One way left, 72 carriers needed', 'Center draw, Motor right, 64 carriers needed', 'Draw not recorded — ask the office, 72 carriers needed',
    'One way right, 1 carrier needed', 'One way right, no carriers on the order', 'Draw not recorded — ask the office']);
eq('a line\'s stamp is copied as it is — nothing else of the line, nothing when it has none', [trackFactsFrom({ name: 'Track', qty: 2, traverseLine: 'K1', traverseDraw: 'LEFT', traverseName: '' }), trackFactsFrom({ name: 'Rod' }), trackFactsFrom(null)],
    [{ traverseLine: 'K1', traverseDraw: 'LEFT' }, {}, {}]);
eq('the stamp\'s fields, the one list', TRACK_FACT_FIELDS, ['traverseLine', 'traverseName', 'traverseDraw', 'traverseMotorSide', 'traverseCarriers']);

// ── TAB 7: the kit's cart line → its part lines on the sales order → the station ──────────────────────────────────────────────
const kitLine = { key: 'KIT-1-1730', erp: 'H1-2TRV-4/P', aliasErp: 'HTS7501F', trvKitCode: 'H1-2TRV-4/P', trvFeet: 18, traverseDraw: 'LEFT', trvSel: { draw: 'LEFT', carrierStyle: 'HTSLNTCAR' }, traverseCarriers: 72 };
const kitFacts = kitTrackFactsOf(kitLine);
eq('a tab 7 kit\'s stamp: named by OUR kit code and its feet, its draw and the carriers counted at the popup', kitFacts,
    { traverseLine: 'KIT-1-1730', traverseName: 'H1-2TRV-4/P · 18 ft', traverseDraw: 'LEFT', traverseCarriers: 72 });
eq('…the draw read off the answers when the line has only those; a kit nobody configured says so', [kitTrackFactsOf({ key: 'K2', erp: 'H1-2TRV-4D/P', trvSel: { draw: 'center', motorSide: 'left' } }), kitTrackFactsOf({ key: 'K3', erp: 'H1-2TRV-4/P' })],
    [{ traverseLine: 'K2', traverseName: 'H1-2TRV-4D/P', traverseDraw: 'CENTER', traverseMotorSide: 'LEFT' }, { traverseLine: 'K3', traverseName: 'H1-2TRV-4/P' }]);
// the sales order's lines as tab 7 writes them: the loose lines, then each kit's part lines carrying its stamp (QuickShipTab's save)
const soLines = [
    { erp: 'H1-138R/P01', name: 'Rod', qty: 2 },
    { erp: 'H1-2TRVTRK/C', name: 'Track', qty: 1, trvComponent: true, trvOfKit: 'KIT-1-1730', trvRole: 'TRACK', ...kitFacts },
    { erp: 'H1-2TRV-WB/C', name: 'Bracket', qty: 7, trvComponent: true, trvOfKit: 'KIT-1-1730', ...kitFacts },
    { erp: 'H1-2TRVTRK/C', name: 'Track', qty: 2, trvComponent: true, trvOfKit: 'K3', trvRole: 'TRACK', ...kitTrackFactsOf({ key: 'K3', erp: 'H1-2TRV-4D/P', trvFeet: 10 }) },
];
eq('the station: one entry per kit on the order, its words — a kit with no draw recorded is said, in red', traversesOf(soLines).map(v => [v.label, trackFactsWords(v.facts), v.drawn]),
    [['H1-2TRV-4/P · 18 ft', 'One way left, 72 carriers needed', true], ['H1-2TRV-4D/P · 10 ft', 'Draw not recorded — ask the office', false]]);

// …and the Order Entry row's shop half: its cut list carries the stamp, for the shop's cut sheet header (Shared/rowPairShape)
{
    const trk = { id: 'p9', legacyErpId: 'H1-2TRVTRK', itemName: '2" Traverse Track', manufacturingSpecs: { productType: 'POLE' } };
    const so = { id: 'SO-X', soId: 'SO61000', customer: 'Fabricut' };
    const line = { idx: 1, erp: 'H1-2TRVTRK', qty: 1, cutLength: 214, trvRole: 'TRACK', trvComponent: true, trvOfKit: 'KIT-1-1730', ...kitFacts };
    const jobs = [{ so: null, part: trk, finish: 'TCP', qty: 1, line, lineIdx: 1, key: 1, custom: true, __planLines: [{ legacyErpId: 'H1-2TRVTRK', partName: trk.itemName, quantity: 1 }] }];
    const groups = floorGroupsOf(jobs, so);
    const { woId, shopWoId } = pairIdsOf(so, groups[0], 1);
    const shape = pairShapeOf({ group: groups[0], so, brand: 'ce', now: 1, inventory: [trk], woId, shopWoId });
    eq('an Order Entry row\'s shop cut list carries the kit\'s stamp — the cut sheet header reads it', traversesOf((shape.shopSibling && shape.shopSibling.cutList) || []).map(v => [v.label, trackFactsWords(v.facts)]),
        [['H1-2TRV-4/P · 18 ft', 'One way left, 72 carriers needed']]);
}

// ── CPQ: the cart line → its ▶ header at save → every row of the line (partFacts) → the documents → the station / the cut sheet ──
const cpqItem = { id: 'CPQ-7', sidemark: 'Living Room', engineConfig: { trvSel: { draw: 'CENTER', motorSide: 'LEFT', carrierStyle: 'HTSLNTCAR', carrierQty: '' } }, trvComponents: lines18, traverseDraw: 'CENTER', traverseMotorSide: 'LEFT' };
eq('a CPQ traverse line\'s header stamp: its draw, motor side and the carriers its components carry', cpqTrackFactsOf(cpqItem),
    { traverseLine: 'CPQ-7', traverseDraw: 'CENTER', traverseMotorSide: 'LEFT', traverseCarriers: 72 });
eq('…a solid pole has none; a traverse whose components step was never opened still says it is one', [cpqTrackFactsOf({ id: 'S', engineConfig: {}, pricingBreakdown: [] }), cpqTrackFactsOf({ id: 'T', trvComponents: [{ code: 'HTTENDSTOP', qty: 2 }] }), cpqTrackFactsOf(null)],
    [{}, { traverseLine: 'T' }, {}]);
const breakdown = [
    { name: '▶ H1-2TRV [Living Room]', sidemark: 'Living Room', isHeader: true, ...cpqTrackFactsOf(cpqItem) },
    { name: '  - Track', partId: 'TRK', qty: 1, cutLength: 214 },
    { name: '  - Carrier', partId: 'HTSLNTCAR', qty: 72 },
    { name: '▶ H1-138 [Den]', sidemark: 'Den', isHeader: true, ...cpqTrackFactsOf({ id: 'S', engineConfig: {} }) },
    { name: '  - Rod', partId: 'ROD', qty: 1 },
    { name: 'Add-ons & Fees', isHeader: true },   // (CPQ's own add-ons header — no ▶, no line)
    { name: '  - Rush', partId: 'FEE', qty: 1 },
];
const stamped = withCartLines(breakdown).rows;
eq('every row of the traverse\'s line carries its stamp — the next line and the add-ons do not', stamped.filter(r => !r.isHeader).map(r => [r.name.trim(), r.lineNo || 0, r.traverseDraw || '', r.traverseCarriers ?? '']),
    [['- Track', 1, 'CENTER', 72], ['- Carrier', 1, 'CENTER', 72], ['- Rod', 2, '', ''], ['- Rush', 0, '', '']]);
eq('…nor does a fee under the add-ons header that follows a traverse line straight away', withCartLines([breakdown[0], breakdown[1], breakdown[5], breakdown[6]]).rows.map(r => r.traverseLine || '-'),
    ['CPQ-7', 'CPQ-7', '-', '-']);   // (the ▶ header itself, its row, the add-ons header, the fee)
const docRows = stamped.filter(r => !r.isHeader).map(r => ({ name: r.name, ...lineFactsOf(r, null) }));   // what RTG's split spreads onto a parts list / cut list
eq('RTG\'s documents carry it through the line facts it already spreads', docRows.map(r => r.traverseLine || '-'), ['CPQ-7', 'CPQ-7', '-', '-']);
eq('the station and the cut sheet: named by its line and room', traversesOf(docRows).map(v => [v.label, trackFactsWords(v.facts)]), [['Line 1 · Living Room', 'Center draw, Motor left, 72 carriers needed']]);
eq('a quote saved before this carries nothing — the lines as they were', withCartLines(breakdown.map(r => (r.isHeader ? { name: r.name, sidemark: r.sidemark, isHeader: true } : r))).rows.filter(r => !r.isHeader).map(r => Object.keys(r).filter(k => k.startsWith('traverse'))),
    [[], [], [], []]);

// ── THE ENGINE'S OWN LINE: a real H1-2TRV traverse configured with carriers → the stamp CPQ's save writes ─────────────────────
{
    const parts = [...new Map(PINS.map(p => [p.partId, { id: p.partId, itemId: p.partId, legacyErpId: p.legacyErpId || p.partName, itemName: p.partName }])).values()];
    const s = sessionOf({ assembly: ASSEMBLY, pins: PINS, parts, flow: { kitFamily: 'H1-2TRV' }, trvRules: RULES },
        { answers: { rodKind: 'TRAVERSE', setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', proj: 3.625 }, picks: {}, lengthInches: 216, trvSel: { draw: 'LEFT', motorSide: '', carrierStyle: 'HTSLNTCAR', carrierQty: '', picks: {}, accessories: {} } });
    const item = s.item;
    eq('the engine\'s cart line → "One way left, 72 carriers needed" (18 ft of pinch pleat on the chart)', item ? trackFactsWords(cpqTrackFactsOf(item)) : 'no line', 'One way left, 72 carriers needed');
}

console.log(fail ? `❌  ${pass} passed, ${fail} failed` : `✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
