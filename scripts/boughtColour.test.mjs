// A PART BOUGHT IN ITS COLOUR — M2C's leather rings (Stuart 2026-10-21: "we purchase them we do not finish them in the different
// colors … i can see this happening in the future with other materials for this brand as leather products we would purchase
// finished" · "go, its a sound plan"). The setup is data — a LEATHER material, the colours as outsourced finishes whose codes are the
// item's suffix, the base item FILR — and the engine does the rest; these assertions walk it end to end on a made-up Flat Iron:
// the ring step, the panel's "Leather" row, Add refusing a ring with no colour, the line billing FILR/02 at its price, the save
// marking it bought-in so the floor picks it or back-orders it (never paints it), and the 3D view drawing it matte.
//   node scripts/boughtColour.test.mjs
import { sessionOf, finishGroupLabel, isColourMaterial } from '../src/components/Shared/hardwareSession.js';
import { stampLineFinishRouting } from '../src/components/Shared/salesOrderHeader.js';
import { isPlatedLine } from '../src/components/Shared/backorder.js';
import { resolvePbr, pbrMapOf, DEFAULT_PLATED_PBR, SOFT_PBR } from '../src/components/Shared/finishPbr.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { REFUSAL_WORDS } = require('../functions/portalSession.js');

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// ── a made-up Flat Iron: a rod, and a ring step offering the leather ring (the BASE item FILR, made in LEATHER) or the steel ring ──
const cl = (id, category, position) => ({ id, name: id, category, position, location: 'WALL', nodes: [`${id}_mesh`] });
const ASM = { id: 'ASM-FI2', itemName: 'FLAT IRON 2', nodeClusters: [cl('C-ROD', 'POLE', 'CENTER'), cl('C-RG', 'RING', 'SHARED')] };
let n = 0;
const pin = (clusterId, code, extra = {}) => ({ id: `PIN-${++n}-${code}`, assemblyId: 'ASM-FI2', clusterId, partId: `ID-${code}`, partName: code, legacyErpId: code, targetNode: `${clusterId}_mesh`, defaultQty: 1, choiceSort: n, ...extra });
const PINS = [pin('C-ROD', 'FIR'), pin('C-RG', 'FILR', { materials: 'LEATHER' }), pin('C-RG', 'FIPR')];
const part = (code, base, extra = {}) => ({ id: `ID-${code}`, itemId: `ID-${code}`, legacyErpId: code, itemName: code, partClass: 'Inventory', manufacturingSpecs: base != null ? { basePrice: base } : {}, ...extra });
const PARTS = [part('FIR', 40), part('FIPR', 3), part('FILR', null, { itemName: 'Flat Iron Leather Ring' }),
    part('FILR/01', 6.5, { itemName: 'Flat Iron Leather Ring - Cloud', netSuiteInternalId: '901' }), part('FILR/02', 6.75, { itemName: 'Flat Iron Leather Ring - Mist Grey', netSuiteInternalId: '902' }),
    part('FILR/03', 7, { itemName: 'Flat Iron Leather Ring - Vintage', netSuiteInternalId: '903' }), part('FILR/04', 7.25, { itemName: 'Flat Iron Leather Ring - Charcoal', netSuiteInternalId: '904' })];
const MASTER = [{ id: 'F-P01', code: 'P01', name: 'Black', material: 'METAL' }];
const LEATHER = [['01', 'Cloud'], ['02', 'Mist Grey'], ['03', 'Vintage'], ['04', 'Charcoal']].map(([code, name]) => ({ id: `O-${code}`, code, name, material: 'LEATHER', vendor: 'Leather Co', multiplier: 1, textureUrl: `t://leather-${code}` }));
const DATA = { assembly: ASM, pins: PINS, parts: PARTS, flow: { id: 'FLOW-FI2' }, finishes: [...MASTER, ...LEATHER], flowFinishes: [] };
const S = (state, data = DATA) => sessionOf(data, { lengthInches: 96, ...state });
const probe = S({});
const ringSlot = probe.model.slots.find(sl => sl.kind === 'RING');
const rodSlot = probe.model.slots.find(sl => sl.kind === 'ROD' || sl.kind === 'POLE') || probe.model.slots.find(sl => sl !== ringSlot);
const choiceOf = (code) => ringSlot.options.find(o => probe.ourId(o.partId) === code).id;
const picks = (ring) => ({ [rodSlot.key]: rodSlot.options[0].id, [ringSlot.key]: choiceOf(ring) });

// ── the ring step and the panel ──────────────────────────────────────────────────────────────────────────────────────────────
eq('the ring step offers the leather ring (one choice, the base item) and the steel ring', ringSlot.options.map(o => probe.ourId(o.partId)), ['FILR', 'FIPR']);
const leather = S({ picks: picks('FILR'), globalFinishes: { METAL: 'P01' } });
eq('with the leather ring chosen the panel offers a Leather row — its four colours, named for what they are', leather.finishGroups.map(([m, g]) => [m, g.inHouse.map(f => f.code), g.out.map(f => f.code), finishGroupLabel(m, g.out.length ? 'out' : 'in')]),
    [['METAL', ['P01'], [], 'Painted'], ['LEATHER', [], ['01', '02', '03', '04'], 'Leather']]);
const steel = S({ picks: picks('FIPR'), globalFinishes: { METAL: 'P01' } });
eq('…and the steel ring keeps the metal finishes alone', steel.finishGroups.map(([m]) => m), ['METAL']);

// ── Add: no colour, no line ──────────────────────────────────────────────────────────────────────────────────────────────────
eq('a leather ring with no colour picked is refused — it would leave as the bare base item, no price, no NetSuite item',
    [leather.refusal && leather.refusal.kind, !!leather.item, /^Pick the LEATHER colour first — FILR would leave here with no colour\./.test((leather.refusal && leather.refusal.alert) || ''), /Leather row/.test((leather.refusal && leather.refusal.alert) || '')],
    ['BARE_COLOUR', false, true, true]);
eq('…the steel ring with no paint still goes out mill, as metal always could', [S({ picks: picks('FIPR') }).refusal, !!S({ picks: picks('FIPR') }).item], [null, true]);
const noColours = S({ picks: picks('FILR') }, { ...DATA, flowFinishes: ['P01'] });
eq('…and a flow that offers no leather colour cannot be stuck: the line goes, as the base', [noColours.refusal, noColours.item && noColours.item.pricingBreakdown.find(r => /FILR/.test(r.legacyErpId)).legacyErpId], [null, 'FILR']);
ok('the portal says it too', /colour/i.test(REFUSAL_WORDS.BARE_COLOUR || ''));

// ── a colour picked: the line is the colour item ─────────────────────────────────────────────────────────────────────────────
const grey = S({ picks: picks('FILR'), globalFinishes: { METAL: 'P01', LEATHER: '02' } });
const ringRow = grey.item && grey.item.pricingBreakdown.find(r => /^FILR/.test(r.legacyErpId));
eq('Mist Grey: the ring bills FILR/02 at its own price, named as every finish variant is — the part, then its colour',
    ringRow && [ringRow.legacyErpId, ringRow.name, ringRow.finishLabel, ringRow.price, ringRow.finishCode], ['FILR/02', 'Flat Iron Leather Ring', 'Mist Grey', 6.75, '02']);
eq('…while the rod keeps its paint', grey.item.pricingBreakdown.filter(r => r.legacyErpId === 'FIR').map(r => r.finishCode), ['P01']);

// ── the save marks it bought-in; the floor picks it or back-orders it, never paints it ──────────────────────────────────────
const saved = stampLineFinishRouting(grey.item.pricingBreakdown, LEATHER);
const savedRing = saved.find(r => r.legacyErpId === 'FILR/02'), savedRod = saved.find(r => r.legacyErpId === 'FIR');
eq('at save the leather line is marked bought-in (finishOutsourced) — the rod painted here is not', [savedRing.finishOutsourced, savedRod.finishOutsourced], [true, false]);
eq('…so RTG\'s split treats it as a stocked finished good (pick, or a true backorder to buy) and paints the rod', [isPlatedLine(savedRing, 'P01'), isPlatedLine(savedRod, 'P01')], [true, false]);

// ── the 3D view: leather renders matte, from its swatch ──────────────────────────────────────────────────────────────────────
eq('a leather colour takes the soft-surface path (no metal, the swatch as map and relief) — it was a chrome ring',
    [resolvePbr(LEATHER[0], DEFAULT_PLATED_PBR) === SOFT_PBR, SOFT_PBR.metalness, SOFT_PBR.wood, resolvePbr({ code: 'EP9', name: 'Mystery plate', material: 'METAL', vendor: 'P' }, DEFAULT_PLATED_PBR) === DEFAULT_PLATED_PBR],
    [true, 0, true, true]);
eq('…in the registry the view reads by swatch', [pbrMapOf(MASTER, LEATHER)['t://leather-03'].metalness, pbrMapOf(MASTER, LEATHER)['t://leather-03'].wood], [0, true]);

// ── which materials are bought in their colour: any but metal, wood, brass and clear ────────────────────────────────────────
eq('the materials with their own rules are not; leather (and the next one like it) is', ['LEATHER', 'leather', 'FABRIC', 'METAL', 'WOOD', 'BRASS', 'CLEAR (NO FINISH)', ''].map(isColourMaterial),
    [true, true, true, false, false, false, false, false]);

console.log(fail ? `❌  ${pass} passed, ${fail} failed` : `✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
