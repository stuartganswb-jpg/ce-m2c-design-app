// Shared/engineSnapshot — the engine's inputs as one file (PORTAL, 2026-10-13).
//   node scripts/engineSnapshot.test.mjs
//
// What the file must hold (what CPQ hands the engine, flow by flow), and what it must NOT (our cost, our vendor, a
// customer's details, anything typed on a quoted line). The module is pure, so every rule is checked on plain data.

import { SNAPSHOT_KIND, SNAPSHOT_VERSION, plain, recordForSnapshot, customerForSnapshot, taggedFlowsOf, trvFamilyOf, trvFamiliesOf,
    engineLineOf, quotedLinesOf, cartLinesOf, quotesSinceDay, SNAPSHOT_QUOTE_DAYS, buildEngineSnapshot, snapshotFileName, snapshotSummary } from '../src/components/Shared/engineSnapshot.js';
import { ENGINE_VERSION } from '../src/components/Shared/engineVersion.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${String(g).slice(0, 320)}\n    want ${String(w).slice(0, 320)}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// ── a copy JSON can hold ───────────────────────────────────────────────────────────────────────────────────────
class Ref { constructor() { this.firestore = this; } }      // a document reference: it points back at itself
const stamp = { seconds: 1791000000, nanoseconds: 0, toMillis: () => 1791000000000 };
{
    eq('a timestamp is its milliseconds, a date too', plain({ a: stamp, b: new Date(5) }), { a: 1791000000000, b: 5 });
    eq('a function, an undefined and a thing that is not data are dropped', plain({ f: () => 1, u: undefined, r: new Ref(), n: null, z: 0, s: '' }), { n: null, z: 0, s: '' });
    eq('a list keeps its length: a dropped entry is null', plain([1, undefined, new Ref(), () => 1, [2, undefined]]), [1, null, null, null, [2, null]]);
    eq('a number JSON cannot write is null', plain({ a: NaN, b: Infinity, c: -1.5 }), { a: null, b: null, c: -1.5 });
    const deep = { x: { y: [{ z: stamp }] } };
    const copy = plain(deep);
    ok('it is a copy, all the way down', copy !== deep && copy.x !== deep.x && copy.x.y[0] !== deep.x.y[0] && typeof deep.x.y[0].z === 'object');
    ok('whatever comes out can be written and read back unchanged', JSON.stringify(JSON.parse(JSON.stringify(plain({ a: stamp, b: [new Ref(), 1], c: { d: undefined } })))) === JSON.stringify({ a: 1791000000000, b: [null, 1], c: {} }));
    const loop = {}; loop.self = loop;
    ok('a thing that contains itself does not hang it', (() => { try { JSON.stringify(plain(loop)); return true; } catch { return false; } })());
}

// ── a library record ─────────────────────────────────────────────────────────────────────────────────────────
const bracket = { id: 'CE-INV-1', itemId: 'CE-INV-1', legacyErpId: 'H1-1BS', itemName: 'Bracket', partClass: 'Inventory', brandId: 'ce', updatedAt: stamp,
    revisions: [{ big: 1 }], approvals: { a: 1 }, builtFromLayers: [1], nodeClusters: [{ id: 'c1' }], vendorNote: 'call Bob',
    clientPricing: [{ customerId: 'FABRICUT', clientSku: 'H3661F', price: 11 }],
    manufacturingSpecs: { basePrice: 22, cost: 7.25, vendorName: 'Acme Castings', vendorId: '991', averageCost: 7, lastPurchasePrice: 7.4, usesSubFinish: true, productType: 'Bracket',
        fabricut: { cost: 12, paintedCost: 12, platedCost: 24, wholesale: 24, retail: 48, fabCodeBase: 'H3663F' },
        customData: { projection: '3.625', unfinished: false, materialTwins: [{ material: 'BRASS', code: 'H1-1BBS' }] }, kitComponents: [{ partId: 'X', qty: 2 }] } };
{
    const r = recordForSnapshot(bracket);
    eq('our own cost and vendor are not in the file', [r.manufacturingSpecs.cost, r.manufacturingSpecs.vendorName, r.manufacturingSpecs.vendorId, r.manufacturingSpecs.averageCost, r.manufacturingSpecs.lastPurchasePrice, r.vendorNote], [undefined, undefined, undefined, undefined, undefined, undefined]);
    ok('…anywhere in it', !/Acme|7\.25|call Bob|"vendor/i.test(JSON.stringify(r)));
    eq('the customer\'s own tiers are — what the customer pays us is the price', r.manufacturingSpecs.fabricut, { cost: 12, paintedCost: 12, platedCost: 24, wholesale: 24, retail: 48, fabCodeBase: 'H3663F' });
    eq('…and everything the engine prices and tags by', [r.id, r.legacyErpId, r.partClass, r.manufacturingSpecs.basePrice, r.manufacturingSpecs.usesSubFinish, r.manufacturingSpecs.productType, r.manufacturingSpecs.customData, r.manufacturingSpecs.kitComponents, r.clientPricing],
        ['CE-INV-1', 'H1-1BS', 'Inventory', 22, true, 'Bracket', { projection: '3.625', unfinished: false, materialTwins: [{ material: 'BRASS', code: 'H1-1BBS' }] }, [{ partId: 'X', qty: 2 }], [{ customerId: 'FABRICUT', clientSku: 'H3661F', price: 11 }]]);
    eq('history, approvals and layers are not carried; nor the node tags of a record that is only a part', [r.revisions, r.approvals, r.builtFromLayers, r.nodeClusters, r.updatedAt], [undefined, undefined, undefined, undefined, 1791000000000]);
    eq('the assembly a flow is linked to keeps its node tags', recordForSnapshot(bracket, { geometry: true }).nodeClusters, [{ id: 'c1' }]);
    ok('the record handed in is not touched', bracket.manufacturingSpecs.cost === 7.25 && bracket.revisions.length === 1 && bracket.manufacturingSpecs.vendorName === 'Acme Castings');
    eq('nothing in, nothing out; a record with no specs is still a record', [recordForSnapshot(null), recordForSnapshot('x'), recordForSnapshot({ id: 'A', cost: 3 })], [null, null, { id: 'A' }]);
}

// ── a customer ───────────────────────────────────────────────────────────────────────────────────────────────
{
    const c = { id: 'CUST-4720', type: 'CUSTOMER', name: 'FABRICUT', companyName: 'Fabricut Inc', brandId: 'ce', defaultPriceLevel: 'FAB_COST', portalPriceLevel: 'FAB_RETAIL', portalFlowIds: ['FLOW-1'], portalCollections: ['H1'],
        email: 'buyer@example.com', phone: '555', addresses: [{ line1: '1 Main' }], terms: 'Net 30', discountCode: 'D20', notes: 'likes calls', netsuiteId: '4720' };
    eq('a customer is who it is and at which level — nothing else', customerForSnapshot(c), { id: 'CUST-4720', name: 'FABRICUT', companyName: 'Fabricut Inc', brandId: 'ce', defaultPriceLevel: 'FAB_COST', portalPriceLevel: 'FAB_RETAIL', portalFlowIds: ['FLOW-1'], portalCollections: ['H1'] });
    eq('levels and portal access only where set', customerForSnapshot({ id: 'C2', name: 'Brimar' }), { id: 'C2', name: 'Brimar', companyName: '', brandId: '' });
    eq('nobody is nobody', [customerForSnapshot(null), customerForSnapshot({ name: 'no id' })], [null, null]);
}

// ── which flows, which chart ───────────────────────────────────────────────────────────────────────────────────
const FLOWS = [{ id: 'F1', name: 'H1-1', linkedAssemblyId: 'ASM-1', customerId: 'CUST-4720', brandId: 'ce', steps: [{ id: 's' }], flowFinishes: ['P14'], extraItems: [{ code: 'JNR' }] },
    { id: 'F2', name: 'H1-2TRV', linkedAssemblyId: 'ASM-2', kitFamily: ' h1-2trv ' }, { id: 'F3', name: 'H1-138', linkedAssemblyId: 'ASM-3', kitFamily: 'H1-138TRV' },
    { id: 'F4', name: 'M2C DAWN', linkedAssemblyId: 'ASM-4', sheet2d: { url: 'https://x/sheet.png' } }, { id: 'F5', name: 'Custom Pillow', linkedAssemblyId: 'ASM-5' }, { id: 'F6', name: 'OLD HARDWARE' }, null];
eq('the flows the tag engine can run: a linked assembly, not a tear sheet, not the pillow questions', taggedFlowsOf(FLOWS).map(f => f.id), ['F1', 'F2', 'F3']);
eq('the traverse chart a flow reads: its kit family, H1-2TRV where it names none', [trvFamilyOf(FLOWS[0]), trvFamilyOf(FLOWS[1]), trvFamilyOf(FLOWS[2]), trvFamilyOf(null)], ['H1-2TRV', 'H1-2TRV', 'H1-138TRV', 'H1-2TRV']);
eq('…each chart once', trvFamiliesOf(FLOWS), ['H1-138TRV', 'H1-2TRV']);

// ── a quoted line ────────────────────────────────────────────────────────────────────────────────────────────
const line = (over = {}) => ({ engine: 'TAGS', engineVersion: '364bdaaf15e7', pinsFingerprint: 'abc', assemblyId: 'ASM-1', assemblyName: 'H1-1', flowId: 'F1', qty: 2, priceLevel: 'FAB_COST', sidemark: 'Smith — master bedroom',
    renderSnapshot: 'data:image/jpeg;base64,AAAA', capturedViews: { front: 'data:…' }, generalNotes: ['Pole length: call Mrs Smith before cutting'], finishLabel: '',
    engineConfig: { answers: { setup: 'SINGLE' }, picks: { 'ROD||CENTER': 'PIN-1' }, partFinish: {}, globalFinish: 'P14', globalFinishes: { METAL: 'P14' }, stepQty: {}, lengthInches: 96, lengthFeet: 8,
        memo: 'Smith — master bedroom', stepNotes: { length: 'call Mrs Smith before cutting', 'RING|FRONT|SHARED': '  ' }, extras: [{ code: 'JNR', qty: '1', note: '18 in from the left, per Mr Smith' }, { code: 'RG', qty: '2', note: '' }], kitPick: 'KIT-1' },
    pricing: { finalPrice: 500 }, pricingBreakdown: [{ name: 'Rod', qty: 1, price: 26.75, total: 214, legacyErpId: 'H1-1R/P', finishCode: 'P14' }, { name: 'Joiner', qty: 1, price: 20, total: 20, addedByHand: true, customNote: '18 in from the left, per Mr Smith' }],
    trvComponents: [{ code: 'HTSLNTCAR', qty: 32, rate: 0, billable: false }], ...over });
{
    const l = engineLineOf(line(), { source: 'quote', jobId: 'QUO200', line: 0, customerId: 'CUST-4720', status: 'QUOTE', savedAt: 1791000000000 });
    eq('the engine\'s own record of the line: what was answered and picked, the kit, the length', [l.engineConfig.answers, l.engineConfig.picks, l.engineConfig.kitPick, l.engineConfig.lengthInches, l.engineConfig.globalFinishes], [{ setup: 'SINGLE' }, { 'ROD||CENTER': 'PIN-1' }, 'KIT-1', 96, { METAL: 'P14' }]);
    eq('…the bill it saved, the components, the level, the engine it was built by', [l.pricing, l.pricingBreakdown.map(r => [r.legacyErpId || r.name, r.qty, r.price, r.total]), l.trvComponents.length, l.priceLevel, l.engineVersion, l.pinsFingerprint, l.qty], [{ finalPrice: 500 }, [['H1-1R/P', 1, 26.75, 214], ['Joiner', 1, 20, 20]], 1, 'FAB_COST', '364bdaaf15e7', 'abc', 2]);
    eq('…and where it was found', [l.source, l.jobId, l.line, l.customerId, l.status, l.savedAt], ['quote', 'QUO200', 0, 'CUST-4720', 'QUOTE', 1791000000000]);
    eq('what was typed on it is not carried — only that something was', [l.engineConfig.memo, l.engineConfig.stepNotes, l.engineConfig.extras.map(x => x.note), l.pricingBreakdown[1].customNote, l.shopNotes, l.hadPicture], ['(memo)', { length: '(note)' }, ['(note)', ''], '(note)', 1, true]);
    ok('…not the name on it, not the picture, anywhere in the line', !/Smith|base64|capturedViews|sidemark|renderSnapshot/.test(JSON.stringify(l)));
    eq('a line with nothing typed says nothing was', [engineLineOf(line({ engineConfig: { answers: {}, memo: '', extras: [] }, generalNotes: [], renderSnapshot: null })).engineConfig, engineLineOf(line({ engineConfig: { answers: {} }, generalNotes: undefined, renderSnapshot: '' })).shopNotes], [{ answers: {}, memo: '', extras: [], stepNotes: {} }, 0]);
    eq('a line the tag engine did not build is not one of its lines', [engineLineOf({ engine: 'STEPS', engineConfig: {} }), engineLineOf({ engine: 'TAGS' }), engineLineOf({ erp: 'H1-1R', qty: 1 }), engineLineOf(null)], [null, null, null, null]);
    ok('the line handed in is not touched', (() => { const src = line(); engineLineOf(src); return src.engineConfig.memo === 'Smith — master bedroom' && src.engineConfig.extras[0].note.startsWith('18 in') && src.pricingBreakdown[1].customNote.startsWith('18 in'); })());
}

// ── the newest quotes that carry an engine line ──────────────────────────────────────────────────────────────────
const JOBS = [
    { id: 'QUO100', customer: { id: 'CUST-4720', name: 'FABRICUT' }, status: 'QUOTE', dateSaved: '2026-09-01', cpqData: { cartItems: [line({ qty: 1 })] } },                 // as CPQ saves a quote: customer: { id, name }
    { id: 'QUO300', customer: { id: 'CUST-9', name: 'Walk-in Trade' }, customerId: 'IGNORED-WHEN-BOTH', status: 'SALES_ORDER', createdAt: { seconds: 1791500000 }, cpqData: { cartItems: [{ erp: 'STOCK-1', qty: 4 }, line({ qty: 3 }), line({ qty: 4 })] } },
    { id: 'QUO200', customerId: 'CUST-4720', status: 'QUOTE', createdAt: stamp, cpqData: { cartItems: [line({ qty: 2 })] } },
    { id: 'SO-OE-1', customerId: 'CUST-4720', status: 'SALES_ORDER', createdAt: { seconds: 1792000000 }, items: [{ erp: 'H1-1R', qty: 1 }] },        // Order Entry: no cart at all
    { id: 'QUO080', customerId: 'CUST-4720', createdAt: { seconds: 1780000000 }, cpqData: { cartItems: [line({ qty: 8 })] } },                         // stamped in May: older than the one that names only its day (September)
    { id: 'QUO050', customerId: 'CUST-4720', cpqData: { cartItems: [line({ qty: 9 })] } },                                                        // no date at all: oldest
    { id: 'QUO400', customerId: 'CUST-4720', createdAt: { seconds: 1793000000 }, cpqData: { cartItems: [{ engine: 'STEPS', engineConfig: {} }] } }, null,
];
eq('newest first, by the day it was saved; only quotes that carry an engine line; each of its engine lines, in the cart\'s own position', quotedLinesOf(JOBS).map(l => [l.jobId, l.line, l.qty]), [['QUO300', 1, 3], ['QUO300', 2, 4], ['QUO200', 0, 2], ['QUO100', 0, 1], ['QUO080', 0, 8], ['QUO050', 0, 9]]);
eq('the newest N quotes — counted in quotes, not lines', quotedLinesOf(JOBS, { limit: 2 }).map(l => l.jobId), ['QUO300', 'QUO300', 'QUO200']);
eq('no quotes, no lines', [quotedLinesOf([]), quotedLinesOf(undefined), quotedLinesOf(JOBS, { limit: 0 })], [[], [], []]);
eq('each line knows WHO its quote was for — the id CPQ saves under customer, an older top-level id, or nobody; never the name', [...new Set(quotedLinesOf(JOBS).map(l => `${l.jobId}:${l.customerId}`))], ['QUO300:CUST-9', 'QUO200:CUST-4720', 'QUO100:CUST-4720', 'QUO080:CUST-4720', 'QUO050:CUST-4720']);
ok('…the name on the quote is not carried', !/Walk-in Trade/.test(JSON.stringify(quotedLinesOf(JOBS))) && quotedLinesOf([{ id: 'Q', cpqData: { cartItems: [line()] } }])[0].customerId === '');
eq('the cart: its engine lines, where they stand', cartLinesOf([{ erp: 'STOCK', qty: 1 }, line({ qty: 5 })]).map(l => [l.source, l.line, l.qty, l.jobId]), [['cart', 1, 5, undefined]]);
eq('no cart is an empty cart', [cartLinesOf(null), cartLinesOf(undefined), cartLinesOf('x')], [[], [], []]);
eq('saved quotes are read back sixty days, to the day a quote stamps on itself', [SNAPSHOT_QUOTE_DAYS, quotesSinceDay(Date.UTC(2026, 9, 13, 14, 0)), quotesSinceDay(Date.UTC(2026, 0, 5), 10)], [60, '2026-08-14', '2025-12-26']);

// ── the file ─────────────────────────────────────────────────────────────────────────────────────────────────
{
    const assemblies = [{ id: 'ASM-1', itemName: 'H1-1', partClass: 'Assembly', nodeClusters: [{ id: 'c1', category: 'POLE' }], manufacturingSpecs: { cadUrl: 'https://x/a.glb', cost: 1 }, revisions: [1] },
        { id: 'ASM-2', itemName: 'H1-2TRV', partClass: 'Assembly', nodeClusters: [{ id: 'c2' }], manufacturingSpecs: {} }, { id: 'ASM-9', itemName: 'UNLINKED', partClass: 'Assembly', nodeClusters: [{ id: 'c9' }], manufacturingSpecs: {} }];
    const customers = [{ id: 'CUST-4720', name: 'FABRICUT', email: 'a@b.c', portalFlowIds: ['F1'] }, { id: 'CUST-9', name: 'Walk-in', phone: '555' }, { id: 'CUST-77', name: 'Nobody here', email: 'n@b.c' },
        { id: 'CUST-4572', name: 'BRIMAR', portalPriceLevel: 'STANDARD' }, { id: 'CUST-12', name: 'Listed but closed', portalFlowIds: [] }];
    const snap = buildEngineSnapshot({ brand: 'ce', at: '2026-10-13T09:15:00.000Z', flows: FLOWS, assemblies, parts: [bracket, { id: 'FEE-1', partClass: 'Fee', manufacturingSpecs: { basePrice: 45, vendorId: 'v' } }],
        kits: [{ id: 'KIT-1', partClass: 'Kit', legacyErpId: 'H1-2TRV-4/P', manufacturingSpecs: { kitAlign: { mount: 'WALL' }, cost: 80 }, clientPricing: [{ customerId: 'FABRICUT', price: 195, perFootPrice: 22 }] }],
        finishes: [{ code: 'P14', material: 'METAL', updatedAt: stamp }], outsourceFinishes: [{ id: 'EP4', code: 'EP4' }], customers, spanMap: { 'H1-1': 'H1-1R' }, spanCaps: { 'H1-1': { maxSpan: 48 } },
        pinsByAssembly: { 'ASM-1': [{ id: 'PIN-1', assemblyId: 'ASM-1', partId: 'CE-INV-1', createdAt: stamp }], 'ASM-9': [{ id: 'PIN-9' }] },
        trvRulesByFamily: { 'H1-2TRV': { usage: [{ itemId: 'HTSLNTCAR', byFeet: { 4: 16 } }] }, 'H1-99': { usage: [] } }, jobs: JOBS, cart: [line({ qty: 7 })] });
    eq('it says what it is, when, for which brand, and which engine read it', [snap.kind, snap.version, snap.at, snap.brand, snap.engineVersion], [SNAPSHOT_KIND, SNAPSHOT_VERSION, '2026-10-13T09:15:00.000Z', 'ce', ENGINE_VERSION]);
    eq('one entry per tagged flow: the flow as tab 11 holds it, its chart, its assembly WITH its node tags, its pins', snap.flows.map(f => [f.flow.id, f.trvFamily, f.assembly ? f.assembly.id : null, f.assembly ? (f.assembly.nodeClusters || []).length : 0, f.pins.map(p => p.id)]),
        [['F1', 'H1-2TRV', 'ASM-1', 1, ['PIN-1']], ['F2', 'H1-2TRV', 'ASM-2', 1, []], ['F3', 'H1-138TRV', null, 0, []]]);
    eq('…the flow\'s own settings ride on it (its finishes, its add-by-hand items, its steps)', [snap.flows[0].flow.flowFinishes, snap.flows[0].flow.extraItems, snap.flows[0].flow.steps, snap.flows[0].pins[0].createdAt], [['P14'], [{ code: 'JNR' }], [{ id: 's' }], 1791000000000]);
    eq('the parts are the library records and the assemblies, as the engine is handed them — no node tags, no cost', [snap.parts.map(p => p.id), snap.parts.some(p => p.nodeClusters), /"cost":1\b|"cost":7|vendor/i.test(JSON.stringify(snap.parts))], [['CE-INV-1', 'FEE-1', 'ASM-1', 'ASM-2', 'ASM-9'], false, false]);
    eq('the kits ride in their own list, with their alignment and the customer\'s row — not our cost', [snap.kits.map(k => [k.id, k.manufacturingSpecs.kitAlign, k.clientPricing[0].perFootPrice]), JSON.stringify(snap.kits).includes('"cost"')], [[['KIT-1', { mount: 'WALL' }, 22]], false]);
    eq('the finishes, the outsourced ones, the 6.5 span map', [snap.finishes, snap.outsourceFinishes, snap.spanMap, snap.spanCaps], [[{ code: 'P14', material: 'METAL', updatedAt: 1791000000000 }], [{ id: 'EP4', code: 'EP4' }], { 'H1-1': 'H1-1R' }, { 'H1-1': { maxSpan: 48 } }]);
    eq('only the charts a tagged flow reads', Object.keys(snap.trvRules), ['H1-2TRV']);
    eq('the lines: the quoted ones, newest first, then the cart\'s', snap.lines.map(l => `${l.source}:${l.jobId || ''}:${l.qty}`), ['quote:QUO300:3', 'quote:QUO300:4', 'quote:QUO200:2', 'quote:QUO100:1', 'quote:QUO080:8', 'quote:QUO050:9', 'cart::7']);
    eq('the customers: the ones a flow is set up for, a line belongs to, or the portal is opened to — nobody else, and no details', snap.customers, [{ id: 'CUST-4720', name: 'FABRICUT', companyName: '', brandId: '', portalFlowIds: ['F1'] }, { id: 'CUST-9', name: 'Walk-in', companyName: '', brandId: '' }, { id: 'CUST-4572', name: 'BRIMAR', companyName: '', brandId: '', portalPriceLevel: 'STANDARD' }]);
    eq('it counts what it holds — and says which flows came up short', snap.counts, { flows: 3, flowsWithoutAssembly: 1, flowsWithoutPins: 2, pins: 1, parts: 5, kits: 1, finishes: 1, outsourceFinishes: 1, customers: 3, trvRules: 1, quotedLines: 6, cartLines: 1 });
    const text = JSON.stringify(snap);
    ok('the whole file can be written and read back', JSON.stringify(JSON.parse(text)) === text);
    ok('nowhere in it: an email, a phone, a name typed on a line, a picture, our cost, our vendor', !/@|555|Smith|base64|Acme|call Bob|"vendor|"cost":(1|7|80)\b/i.test(text));
    eq('in one sentence', snapshotSummary(snap), '3 flows (1 with no assembly on file, 2 with no pins) · 1 pins · 5 library records · 1 kits · 1 finishes · 3 customers · 6 quoted lines · 1 in the cart');
    const empty = buildEngineSnapshot();
    eq('built from nothing it is an empty file, not a crash', [empty.kind, empty.flows, empty.parts, empty.lines, empty.counts.flows, snapshotSummary(empty), snapshotSummary(null)], [SNAPSHOT_KIND, [], [], [], 0,
        '0 flows · 0 pins · 0 library records · 0 kits · 0 finishes · 0 customers · 0 quoted lines · 0 in the cart', '0 flows · 0 pins · 0 library records · 0 kits · 0 finishes · 0 customers · 0 quoted lines · 0 in the cart']);
}

// ── its name ───────────────────────────────────────────────────────────────────────────────────────────────────
eq('named for the brand and the minute it was taken', snapshotFileName('ce', new Date(2026, 9, 13, 9, 5)), 'engine-snapshot-ce-2026-10-13-0905.json');
eq('a brand with odd characters, no brand, no date', [snapshotFileName('M2C Studio!', new Date(2026, 0, 2, 23, 59)), snapshotFileName('', new Date(2026, 0, 2, 0, 0)), snapshotFileName('ce', 'not a date')], ['engine-snapshot-m2c-studio--2026-01-02-2359.json', 'engine-snapshot-brand-2026-01-02-0000.json', 'engine-snapshot-ce-undated.json']);

// ── it stays out of the engine ───────────────────────────────────────────────────────────────────────────────────
{
    const src = readFileSync(new URL('../src/components/Shared/engineSnapshot.js', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map(m => m[1]);
    eq('pure: it reads one neighbour (the engine stamp) and nothing else — no React, no Firebase', imports, ['./engineVersion.js']);
    ok('…and it writes nothing: no setDoc / updateDoc / deleteDoc / fetch in it', !/\b(setDoc|updateDoc|deleteDoc|addDoc|writeBatch|fetch)\s*\(/.test(src));
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
