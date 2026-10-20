// functions/portalSession — the portal's server runs the engine HQ runs (PORTAL, step 3, 2026-10-13).
//   node scripts/portalSession.test.mjs
//
// The copy of the engine is made here the way the deploy makes it (scripts/sync-engine.mjs), the server module is
// loaded the way a Cloud Function loads it (CommonJS, importing the copy), and what it answers is held against
// HQ's own module read straight from src/: the walk it draws, the money it shows, the cart line it sends to HQ.
// And the wall: nothing of a part record, a pin, a cost or another customer's row is in anything a customer gets.
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mirrorPlan, writeMirror } from './sync-engine.mjs';
import { sessionOf } from '../src/components/Shared/hardwareSession.js';
import { customerPriceLevel } from '../src/components/Shared/priceLevels.js';
import { scopeTargetsOf, scopeInForce, swatchActionOf, highlightOf } from '../src/components/Shared/finishScope.js';
import { companionsFor } from '../src/components/Shared/hardwareModel.js';
import { pbrMapOf } from '../src/components/Shared/finishPbr.js';
import { FABRIC_CLASSES } from '../src/components/Shared/bracketSpan.js';
import { ASSEMBLY, PINS } from './hardwareAutoPicks.fixture.mjs';

const require = createRequire(import.meta.url);
const P = require(process.env.PORTAL_SESSION || '../functions/portalSession.js');

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${String(g).slice(0, 320)}\n    want ${String(w).slice(0, 320)}`); };
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n} ${extra}`); };

const tmp = mkdtempSync(join(tmpdir(), 'portal-session-'));
const copy = join(tmp, 'engine');
const { plan, version, closureHash } = mirrorPlan();
writeMirror(plan, copy);
const engine = await P.loadEngine(copy);

// ── the records, as the function reads them: one brand's library with the traverse assembly of the fixture ──
const hh = (t) => { let x = 2166136261; for (const c of String(t)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
const price = (code, lo, hi) => lo + (hh(code) % ((hi - lo) * 4)) / 4;
const codes = [...new Map(PINS.map(pn => [pn.partId, pn.legacyErpId || pn.partName])).entries()];
const tiers = (code) => ({ cost: price(`${code}|c`, 5, 30), wholesale: price(`${code}|w`, 30, 60), retail: price(`${code}|r`, 60, 120), paintedCost: price(`${code}|pc`, 6, 32), paintedWholesale: price(`${code}|pw`, 32, 64), paintedRetail: price(`${code}|pr`, 64, 128) });
const SECRET = { averagecost: 3.33, vendor: 'ACME FOUNDRY', vendorCost: 2.1, internalNotes: 'never show a customer' };
const library = codes.map(([id, code], i) => ({ id, itemId: id, legacyErpId: code, itemName: `Item ${code}`, partClass: 'Inventory', brandId: 'ce', ...SECRET,
    // (one part in seven has no price under any rule — no tier, no row of this customer's, no base price: it is "priced on review")
    manufacturingSpecs: { ...(i % 5 !== 4 && i % 7 !== 3 ? { basePrice: price(code, 4, 40) } : {}), ...(i % 7 !== 3 ? { fabricut: tiers(code) } : {}), partHandling: 'INTERNAL-ROUTE', cost: 1.11, ...(i === 0 ? { customData: { materialTwins: [{ material: 'BRASS', code: 'TWIN-BRASS' }] } } : {}) },
    clientPricing: [...(i % 7 !== 3 ? [{ customerId: 'FABRICUT', clientSku: `F${hh(code) % 9000 + 1000}`, price: price(`${code}|row`, 3, 35) }] : []), { customerId: 'CUST-OTHER', clientSku: `OTHER-${hh(code) % 900}`, price: 1 }] }));
const extra = (code, base, more = {}) => ({ id: `X-${code}`, itemId: `X-${code}`, legacyErpId: code, itemName: `Item ${code}`, partClass: 'Inventory', brandId: 'ce', manufacturingSpecs: { basePrice: base }, ...more });
const records = [...library, extra('SCREW-PACK', 3.5, { manufacturingSpecs: { basePrice: 3.5, fabricut: { cost: 2, wholesale: 4, retail: 8 } } }), { id: 'X-NOPRICE-BRK', itemId: 'X-NOPRICE-BRK', legacyErpId: 'NOPRICE-BRK', itemName: 'Bracket hardware', partClass: 'Inventory', brandId: 'ce', manufacturingSpecs: {} }, extra('TWIN-BRASS', 99), extra('H1-2JNR', 20, { manufacturingSpecs: { basePrice: 20, customData: { unfinished: true } } }), extra('FEE-PAINT', 45, { partClass: 'Fee' }),
    { ...ASSEMBLY, id: 'ASM-TRV', itemId: 'ASM-TRV', itemName: 'H1 2" Traverse', partClass: 'Assembly', brandId: 'ce', manufacturingSpecs: { ...(ASSEMBLY.manufacturingSpecs || {}), cadUrl: 'https://models.test/trv.glb' } },
    { id: 'KIT-SYS', legacyErpId: 'H1-2TRV-4/P', itemName: 'System kit', partClass: 'Kit', brandId: 'ce', manufacturingSpecs: { kitAlign: { setup: 'SINGLE' } } },
    { id: 'KIT-ITEM', legacyErpId: 'H1-2TRV-CB', itemName: 'Bracket kit', partClass: 'Kit', brandId: 'ce', manufacturingSpecs: { basePrice: 61, kitComponents: [{ partId: library[1].id, qty: 1 }] } },
    { id: 'OTHER-BRAND', legacyErpId: 'M2C-LAMP', itemName: 'Another brand', partClass: 'Inventory', brandId: 'm2c', manufacturingSpecs: { basePrice: 5 } },
    { id: 'SHARED', legacyErpId: 'SHARED-1', itemName: 'Shared with ce', partClass: 'Inventory', brandId: 'm2c', sharedBrands: ['ce'], manufacturingSpecs: { basePrice: 5 } }];
// …and one part that is billed but never shown — a hidden pin (the screws): in the engine's total, off the customer's lines
// …and a hidden part with no price of its own that the flow's default prices as a bracket ($11): billed, not shown — and a
// placeholder, so the portal's price must say something is priced on review
const bracketPin = PINS.find(pn => /BRACKET/i.test(String(pn.catOverride || pn.category || ''))) || PINS[0];
const pins = [...PINS.map(pn => ({ ...pn, assemblyId: 'ASM-TRV' })), { ...PINS[0], id: 'PIN-HIDDEN-SCREWS', assemblyId: 'ASM-TRV', partId: 'X-SCREW-PACK', partName: 'Screw pack', isHiddenPart: true, targetNode: '', choiceNode: '' },
    { ...bracketPin, id: 'PIN-HIDDEN-NOPRICE', assemblyId: 'ASM-TRV', partId: 'X-NOPRICE-BRK', partName: 'Bracket hardware', legacyErpId: 'NOPRICE-BRK', isHiddenPart: true, targetNode: '', choiceNode: '' }];
const FIN = [
    { id: 'F-P14', code: 'P14', name: 'Matte Black', material: 'METAL', textureUrl: 't://p14', subFinishCode: 'TBR', clientMapping: [{ customerId: 'FABRICUT', clientFinishName: 'Black' }, { customerId: 'CUST-OTHER', clientFinishName: 'Their black' }] },
    { id: 'F-P25', code: 'P25', name: 'Warm White', material: 'METAL', textureUrl: 't://p25' },
    { id: 'F-S04', code: 'S04', name: 'Natural Oak', material: 'WOOD', textureUrl: 't://s04' },
    { id: 'F-LBR', code: 'LBR', name: 'Live Solid Brass', material: 'BRASS', textureUrl: 't://lbr', questions: [{ label: 'Surface', choices: ['Brushed', 'Polished'] }] }];
const OUT = [{ id: 'O-EP4', code: 'EP4', name: 'Polished Nickel', material: 'METAL', vendor: 'PLATER CO', multiplier: 2.4, textureUrl: 't://ep4' }];
const flow = { id: 'FLOW-TRV', name: 'H1 2" Traverse', brandId: 'ce', linkedAssemblyId: 'ASM-TRV', kitFamily: 'h1-2trv', spliceOverInches: 96, fallbackPrices: { BRACKET: 11 },
    extraItems: [{ code: 'H1-2JNR', label: 'Joiner' }, { code: '', label: 'blank' }, { code: 'FEE-PAINT', label: 'Paint the track to match', step: 'track' }], flowFinishes: [] };
const fabricut = { id: 'CUST-FAB', name: 'FABRICUT', companyName: 'Fabricut Inc', brandId: 'ce', portalPriceLevel: 'FAB_RETAIL', portalFlowIds: ['FLOW-TRV'] };
const world = (customer = fabricut, over = {}) => P.worldFor(engine, { flow, records, pins, finishes: FIN, outsourceFinishes: OUT, spanDoc: { map: { 'H1-ALU2': 'H1-2RCTAR' }, caps: {} }, trvRules: null, customer, customerId: customer ? customer.id : '', ...over });

// ── the engine copy ──
eq('the server runs the engine the deploy copied: its version and the hash of every file in the copy', [engine.stamp.engineVersion, engine.stamp.closureHash, engine.stamp.files > 30], [version, closureHash, true]);
ok('…loaded once per instance', (await P.loadEngine(copy)) === engine);

// ── the world: what CPQ hands the engine, from the same records ──
{
    const w = world();
    eq('the brand\'s library, its assemblies and the kits made of parts — never another brand\'s, never a system kit', [w.parts.some(p => p.id === 'OTHER-BRAND'), w.parts.some(p => p.id === 'SHARED'), w.parts.some(p => p.id === 'ASM-TRV'), w.parts.some(p => p.id === 'KIT-ITEM'), w.parts.some(p => p.id === 'KIT-SYS'), w.kits], [false, true, true, true, false, []]);
    eq('the flow\'s assembly, its pins, its own add-by-hand list (blank rows out) and finish list, the span map, the customer', [w.assembly.id, w.pins.length === pins.length, w.extraItems.map(x => x.code), w.flowFinishes, Object.keys(w.spanMap), w.customerId, w.finishes.length, w.outsourceCodes.length], ['ASM-TRV', true, ['H1-2JNR', 'FEE-PAINT'], [], ['H1-ALU2'], 'CUST-FAB', 5, 1]);
    eq('the traverse chart is the flow family\'s; H1-2TRV where it names none', [P.trvFamilyOf(flow), P.trvFamilyOf({}), P.trvFamilyOf(null)], ['H1-2TRV', 'H1-2TRV', 'H1-2TRV']);
}

// ── the two levels ──
{
    const lv = (c) => { const x = P.levelsFor(engine, c); return [x.shown, x.own, x.money]; };
    eq('Fabricut: the portal SHOWS what Portal Access set (Retail), the request is at their own level (cost)', lv(fabricut), ['FAB_RETAIL', 'FAB_COST', true]);
    eq('…Wholesale shown the same way; with no shown level set, their own level is cost — and the portal shows NO money', [lv({ ...fabricut, portalPriceLevel: 'fab_wholesale' }), lv({ ...fabricut, portalPriceLevel: '' }), lv({ ...fabricut, portalPriceLevel: 'STANDARD' })], [['FAB_WHOLESALE', 'FAB_COST', true], ['FAB_COST', 'FAB_COST', false], ['FAB_COST', 'FAB_COST', false]]);
    eq('a cost level is never one the portal may be set to show', [lv({ ...fabricut, portalPriceLevel: 'FAB_COST' }), P.SHOWABLE], [['FAB_COST', 'FAB_COST', false], ['FAB_RETAIL', 'FAB_WHOLESALE']]);
    eq('another customer: their own pricing both ways', lv({ id: 'CUST-B', name: 'Brimar', brandId: 'ce' }), ['STANDARD', 'STANDARD', true]);
    ok('the own level is the one CPQ itself uses for them', P.levelsFor(engine, fabricut).own === customerPriceLevel(fabricut, 'STANDARD').level);
}

// ── solid brass is CPQ-only ──
{
    const offered = P.portalFinishesOf(engine, world()).map(f => f.code);
    eq('solid brass is not offered on the portal', offered, ['P14', 'P25', 'S04', 'EP4']);
    // ⚠ CHANGED 2026-10-14 (step 4, piece B): until then a brass finish was held back only where a part the assembly pins
    // would swap to its brass item, and LBR showed on H1-75 / H1-138 / H1-2TRV before anything was picked. Now: everywhere.
    eq('…nor on a flow where no pinned part has a brass twin', P.portalFinishesOf(engine, world(fabricut, { records: records.filter(r => r.id !== 'X-TWIN-BRASS') })).map(f => f.code), ['P14', 'P25', 'S04', 'EP4']);
    const opening = P.viewOf(engine, world(), P.stateFromClient({}), { level: 'FAB_RETAIL', money: true });
    ok('…nor on the opening screen, before anything is picked (when CPQ lists the flow\'s whole list)', opening.finishes.groups.length > 0 && opening.finishes.groups.every(g => g.material !== 'BRASS' && g.lists.every(l => l.swatches.every(f => f.code !== 'LBR'))));
    const withClear = P.viewOf(engine, world(fabricut, { finishes: [...FIN, { id: 'F-AC', code: 'AC', name: 'Clear Acrylic', material: 'CLEAR', textureUrl: 't://ac' }] }), P.stateFromClient({}), { level: 'FAB_RETAIL', money: true });
    eq('a material CPQ has no word for is called by its own name — never "In house"', withClear.finishes.groups.filter(g => g.material === 'CLEAR').map(g => [g.heading, g.lists.map(l => l.label)]), [['Clear', ['Clear']]]);
    eq('the flow\'s own finish list narrows it first', P.portalFinishesOf(engine, { ...world(), flowFinishes: ['P14', 'LBR'] }).map(f => f.code), ['P14']);
}

// ── what the browser may say ──
const allowed = new Set(['P14', 'P25', 'S04', 'EP4']);
{
    const st = P.stateFromClient({ answers: { setup: 'SINGLE', n: 6, bad: { x: 1 } }, picks: { 'ROD||': 'PIN-1', x: 5 }, lengthInches: '96.5', stepQty: { a: '12', b: '0', c: 'x', d: 99999 }, fabricId: 'blackout', globalFinishes: { METAL: 'p14' }, partFinish: { 'PIN-1': 'EP4' },
        finishAnswers: { P14: { Sheen: 'Flat' }, NOPE: { a: 'b' } }, memo: '  Living   room ', qty: '3', drops: [{ key: 'A|B', acked: true, reason: 'x' }, { key: 'C|D', acked: false }, 'junk'],
        extras: [{ code: 'FEE-PAINT', qty: '4' }], spliceWaived: true, kitPick: 'KIT-SYS', trvSel: { carrierQty: 900 }, stepNotes: { length: 'cut it short' }, priceLevel: 'FAB_COST', customerId: 'CUST-OTHER' }, { finishCodes: allowed });
    eq('the customer\'s own answers are kept, typed as they must be', [st.answers, st.picks, st.lengthInches, st.stepQty, st.fabricId, st.globalFinishes, st.partFinish, st.finishAnswers, st.memo, st.qty, st.drops], [{ setup: 'SINGLE', n: 6 }, { 'ROD||': 'PIN-1' }, 96.5, { a: '12' }, 'BLACKOUT', { METAL: 'P14' }, { 'PIN-1': 'EP4' }, { P14: { Sheen: 'Flat' } }, 'Living room', 3, [{ key: 'A|B', acked: true }]]);
    eq('NOT taken from a customer: items added by hand, a declined splice, a kit, the track\'s components, shop notes — and no level or customer at all', [st.extras, st.spliceWaived, st.kitPick, st.trvSel, st.stepNotes, 'priceLevel' in st, 'customerId' in st], [[], false, '', null, {}, false, false]);
    let refused = null; try { P.stateFromClient({ globalFinishes: { BRASS: 'LBR' } }, { finishCodes: allowed }); } catch (e) { refused = [e instanceof P.Refused, e.code]; }
    eq('a finish the portal does not offer is refused by name — as a default', refused, [true, 'FINISH_NOT_OFFERED']);
    refused = null; try { P.stateFromClient({ partFinish: { x: 'lbr' } }, { finishCodes: allowed }); } catch (e) { refused = e.code; }
    eq('…and on one part', refused, 'FINISH_NOT_OFFERED');
    eq('nothing sent, nothing assumed; a count or a length past any order is not taken', [P.stateFromClient(null).answers, P.stateFromClient(undefined).qty, P.stateFromClient({ lengthInches: 99999 }).lengthInches, P.stateFromClient({ qty: 0 }).qty, P.stateFromClient({ qty: 5000 }).qty, P.stateFromClient({ qty: '999' }).qty, P.stateFromClient({ fabricId: 'velvet' }).fabricId], [{}, 1, null, 1, 1, 999, 'PRINT']);
}

// ── every framing of the assembly, several ways through the parts: the view and the request, against HQ's own module ──
const w0 = world();
const direct = (level, state, data = w0) => sessionOf({ ...data, priceLevel: level }, state);
const framings = [];
(function walk(answers) { const open = direct('STANDARD', { answers, picks: {} }).model.axes.find(a => !a.implied && a.values.length > 1 && answers[a.key] == null); if (!open) { framings.push(answers); return; } open.values.forEach(v => walk({ ...answers, [open.key]: v })); })({});
const rng = (seed) => { let h = hh(seed); return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; }; };
const picksFor = (answers, seed) => { const rand = rng(seed); let picks = {}; for (let g = 0; g < 40; g++) { const s = direct('STANDARD', { answers, picks }); const slot = s.model.slots.find(x => !s.livePicks[x.key] && !picks[x.key] && x.options.length && !x.suppressedBy); if (!slot) break; picks[slot.key] = slot.options[Math.floor(rand() * slot.options.length)].id; } return picks; };
const FORBIDDEN = /^(cost|averagecost|vendor|vendorCost|internalNotes|basePrice|clientPricing|fabricut|manufacturingSpecs|partHandling|multiplier|fallbackPrices|customData|sharedBrands|brandId|pins|parts|records|customer|customerId|priceCtx|pricingCtx)$/i;
const keysOf = (v, out = new Set()) => { if (Array.isArray(v)) v.forEach(x => keysOf(x, out)); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { out.add(k); keysOf(x, out); }); return out; };
const t = { views: 0, walkDiffer: 0, moneyDiffer: 0, leaks: 0, requestDiffer: 0, lines: 0, refused: {}, onReview: 0, splice: 0, removals: 0, noMoney: 0, shownIsNotOwn: 0, hiddenBilled: 0 };
const first = [];
const levels = P.levelsFor(engine, fabricut);
framings.forEach((answers, fi) => {
    for (let v = 0; v < 6; v++) {
        const picks = v === 5 ? picksFor(framings[(fi + 1) % framings.length], `p|${fi}|${v}`) : picksFor(answers, `p|${fi}|${v}`);
        const raw = { answers, picks, lengthInches: [36, 96, 150.5, 60, null, 120][(fi + v) % 6], globalFinishes: [{ METAL: 'P14', WOOD: 'S04' }, { METAL: 'EP4', WOOD: 'S04' }, { METAL: 'P25' }, {}][(fi + v) % 4], qty: 1 + (v % 3), memo: v % 2 ? `Room ${fi}` : '',
            fabricId: ['SHEER', 'PRINT', 'BLACKOUT'][v % 3], extras: [{ code: 'FEE-PAINT', qty: '2' }], kitPick: 'KIT-SYS', spliceWaived: true };
        const state = P.stateFromClient(raw, { finishCodes: allowed });
        let view = P.viewOf(engine, w0, state, { level: levels.chosenForShown, money: levels.money });
        if (view.removals.some(r => !r.acked)) { t.removals++; const acks = { ...raw, drops: view.removals.map(r => ({ key: r.key, acked: true })) }; Object.assign(state, P.stateFromClient(acks, { finishCodes: allowed })); view = P.viewOf(engine, w0, state, { level: levels.chosenForShown, money: levels.money }); }
        const hq = direct(levels.chosenForShown, state);
        t.views++;
        // the walk: every step, its heading, the answer under it, what it offers — HQ's module says the same
        const want = hq.steps.map(st => [st.key, st.kind, st.label, hq.answerOf(st) || '', st.kind === 'SLOT' ? [(st.slot.options || []).map(o => [o.id, hq.ourId(o.partId), hq.livePicks[st.slot.key] === o.id]), st.sub ? (st.sub.options || []).map(o => o.id) : null] : null]);
        const got = view.steps.map(st => [st.key, st.kind, st.label, st.answer, st.kind === 'SLOT' ? [(st.options || []).map(o => [o.id, o.code, o.on]), st.sub ? st.sub.options.map(o => o.id) : null] : null]);
        if (JSON.stringify(want) !== JSON.stringify(got)) { t.walkDiffer++; if (first.length < 3) first.push(`walk #${fi}.${v}`); }
        // the money shown: the customer's lines at the level the portal shows, to the cent; the total is the engine's
        const shownLines = hq.priced.lines.filter(l => !l.hidden).map(l => [String(l.billedId || hq.ourId(l.partId)), l.qty, Math.round(l.unit * 100) / 100, Math.round(l.total * 100) / 100, l.source]);
        const viewLines = view.price.lines.filter(l => !l.added).slice(0, shownLines.length);
        const review = (src) => src === engine.PRICE_SOURCES.NONE || src === engine.PRICE_SOURCES.FALLBACK;
        const linesOk = shownLines.every(([code, qty, unit, total, src], i) => { const l = viewLines[i]; return l && l.code === code && l.qty === qty && (review(src) ? (l.onReview === true && !('unit' in l) && !('total' in l)) : (l.unit === unit && l.total === total)); });
        const firm = Math.round((hq.grandTotal - [...hq.priced.lines, ...hq.extraLines, ...hq.trvLines].filter(l => review(l.source)).reduce((n, l) => n + l.total, 0)) * 100) / 100;
        if (!linesOk || view.price.total !== firm || view.price.level !== 'FAB_RETAIL' || view.price.totalForAll !== Math.round(firm * state.qty * 100) / 100) { t.moneyDiffer++; if (first.length < 3) first.push(`money #${fi}.${v}`); }
        if (view.price.hasReview) t.onReview++;
        // the "priced on review" mark: a line the customer sees with no firm price, or a hidden part with money on it — never a hidden $0 part
        const wantReview = [...hq.priced.lines, ...hq.extraLines.filter((l) => Number((hq.extras.find((x) => x.code === l.partId && (x.slot || '') === (l.slot || '')) || {}).qty) > 0), ...hq.trvLines].some((l) => review(l.source) && (!l.hidden || Number(l.total) !== 0));
        if (view.price.hasReview !== wantReview) { t.moneyDiffer++; if (first.length < 3) first.push(`review mark #${fi}.${v}`); }
        if (hq.priced.lines.some((l) => l.hidden && review(l.source) && Number(l.total) === 0)) t.hiddenNoPrice = (t.hiddenNoPrice || 0) + 1;
        if (hq.priced.lines.some((l) => l.hidden && review(l.source) && Number(l.total) !== 0)) t.hiddenPlaceholder = (t.hiddenPlaceholder || 0) + 1;
        if (hq.priced.lines.some(l => l.hidden && l.total > 0)) { t.hiddenBilled++; if (view.price.lines.some(l => l.code === 'SCREW-PACK')) { t.moneyDiffer++; first.push(`hidden shown #${fi}.${v}`); } }
        if (view.price.lines.some(l => l.added)) t.splice++;
        // the wall: nothing of a record, a pin, a cost or another customer's row
        const text = JSON.stringify(view);
        if ([...keysOf(view)].some(k => FORBIDDEN.test(k)) || /ACME FOUNDRY|INTERNAL-ROUTE|never show a customer|OTHER-\d|Their black|PLATER CO|3\.33/.test(text)) { t.leaks++; if (first.length < 3) first.push(`leak #${fi}.${v}`); }
        // the request: the cart line HQ's own module builds for this customer at THEIR level — every field
        const req = P.requestLineOf(engine, w0, state, { level: 'STANDARD' });
        const own = direct('STANDARD', state);
        const bare = (it) => { if (!it) return null; const c = JSON.parse(JSON.stringify(it)); delete c.id; return c; };
        if (JSON.stringify(bare(req.item)) !== JSON.stringify(bare(own.item)) || !!req.refusal !== !!own.refusal || (req.refusal && req.refusal.kind !== own.refusal.kind)) { t.requestDiffer++; if (first.length < 3) first.push(`request #${fi}.${v}`); }
        if (req.item) { t.lines++; if (req.item.priceLevel !== 'FAB_COST' || req.item.engine !== 'TAGS' || (req.item.engineConfig.extras || []).some(x => x.code === 'FEE-PAINT') || req.item.engineConfig.kitPick) { t.requestDiffer++; first.push(`request level/extras #${fi}.${v}`); }
            if (view.price.total !== undefined && req.total !== view.price.totalForAll) t.shownIsNotOwn++; }
        if (req.refusal) { t.refused[req.refusal.kind] = (t.refused[req.refusal.kind] || 0) + 1; if (req.refusal.message !== P.REFUSAL_WORDS[req.refusal.kind] || (view.refusal || {}).kind !== req.refusal.kind) { t.requestDiffer++; first.push(`refusal words #${fi}.${v}`); } }
        // no shown level set → no money anywhere in the view
        const dark = P.viewOf(engine, world({ ...fabricut, portalPriceLevel: '' }), state, { level: 'STANDARD', money: false });
        if (dark.price.lines.some(l => 'unit' in l || 'total' in l) || 'total' in dark.price || dark.price.level !== '' || !dark.price.hasReview) { t.moneyDiffer++; first.push(`dark #${fi}.${v}`); } else t.noMoney++;
    }
});
if (process.env.PS_VERBOSE) console.log(JSON.stringify(t));
eq(`the walk the portal draws is HQ's: every step, its heading, its answer, the parts it offers and which is chosen (${t.views} views)${first.length ? ` — first: ${first.join(', ')}` : ''}`, t.walkDiffer, 0);
eq('the money shown is the engine\'s at the level the portal shows — every line to the cent, a placeholder price never shown as firm, the total the engine\'s own less what is on review', t.moneyDiffer, 0);
eq('THE WALL: no key and no value of a part record, a pin, a cost, a vendor or another customer\'s row is in any view', t.leaks, 0);
eq('the request is the cart line HQ\'s own module builds for this customer at THEIR level, field for field — with nothing a customer may not add, and refused for HQ\'s reasons in the portal\'s words', t.requestDiffer, 0);
ok(`the set-ups take each road — lines ${t.lines}, refused ${JSON.stringify(t.refused)}, a line on review ${t.onReview}, the splice a long pole needs added by the engine ${t.splice}, removals named then acknowledged ${t.removals}, no money shown ${t.noMoney}, what was shown is not what lands ${t.shownIsNotOwn}, a part billed and not shown ${t.hiddenBilled}`,
    t.lines > 20 && t.refused.BARE_WOOD > 0 && t.onReview > 5 && t.splice > 3 && t.removals > 0 && t.noMoney === t.views && t.shownIsNotOwn > 10 && t.hiddenBilled > 5);
{
    const state = P.stateFromClient({ answers: framings[0], picks: picksFor(framings[0], 'one'), lengthInches: 96, globalFinishes: { METAL: 'P14', WOOD: 'S04' } }, { finishCodes: allowed });
    const view = P.viewOf(engine, w0, state, { level: 'FAB_RETAIL', money: true });
    eq('the view says which engine drew it, which flow, and where the model is', [view.engine, view.flow, view.assembly], [engine.stamp, { id: 'FLOW-TRV', name: 'H1 2" Traverse' }, { name: 'H1 2" Traverse', cadUrl: 'https://models.test/trv.glb' }]);
    ok('a part is offered by OUR number with THEIR number beside it — theirs, nobody else\'s', view.steps.filter(st => st.kind === 'SLOT').every(st => st.options.every(o => o.code && !/^OTHER-/.test(o.sku) && (o.sku === '' || /^F\d{4}$/.test(o.sku)))) && view.steps.some(st => st.kind === 'SLOT' && st.options.some(o => /^F\d{4}$/.test(o.sku))));
    const twinPart = library[0].id;
    const withTwin = (() => { for (const answers of framings) { const s0 = direct('FAB_RETAIL', { answers, picks: {} }); const slot = s0.model.slots.find(x => x.options.some(o => o.partId === twinPart)); if (slot) return { answers, picks: { [slot.key]: slot.options.find(o => o.partId === twinPart).id } }; } return null; })();
    const twinState = P.stateFromClient({ ...withTwin, lengthInches: 96 }, { finishCodes: allowed });
    const hqGroups = direct('FAB_RETAIL', twinState).finishGroups.flatMap(([, g]) => [...g.inHouse, ...g.out]).map(f => f.code);
    const portalGroups = P.viewOf(engine, w0, twinState, { level: 'FAB_RETAIL', money: true }).finishes.groups.flatMap(g => g.lists.flatMap(l => l.swatches)).map(f => f.code);
    eq('with the part that has a brass twin chosen, CPQ itself offers the brass — the portal\'s view does not', [hqGroups.includes('LBR'), portalGroups.includes('LBR'), portalGroups.includes('P14')], [true, false, true]);
    ok('the finishes offered are grouped as CPQ groups them, in the customer\'s own words where they have one, and never the brass', view.finishes.groups.length > 0 && view.finishes.groups.every(g => g.lists.every(l => l.swatches.every(f => f.code !== 'LBR'))) && view.finishes.groups.some(g => g.lists.some(l => l.swatches.some(f => f.code === 'P14' && f.theirs === 'Black'))) && JSON.stringify(view.finishes.chosen) === JSON.stringify({ METAL: 'P14', WOOD: 'S04' }));
    ok('a group is headed by its material and its lists by CPQ\'s words — never "In house" / "Outsourced"', view.finishes.groups.every(g => g.heading && g.lists.every(l => l.label && !/in house|outsourced/i.test(l.label))) && view.finishes.groups.some(g => g.lists.some(l => l.label === 'Painted')) && view.finishes.groups.some(g => g.lists.some(l => l.label === 'Plated')));
    ok('what is drawn is the engine\'s additive render: the nodes of what was chosen, by name', !!view.render && view.render.visible.length > 0 && view.render.visible.every(n => typeof n === 'string'));
}
// ── STEP 4 (2026-10-14): what the portal's screen needs to be CPQ's walk, each held against HQ's own modules ──
{
    // the length as typed — whole inches and a fraction — worked out by the engine's own rule
    const L = (raw) => P.stateFromClient(raw, { finishCodes: allowed, lengthOf: engine.lengthInchesOf }).lengthInches;
    eq('a length typed as inches and a fraction is the engine\'s inches; a number still works; nonsense is no length', [L({ poleIn: '96', poleFrac: '1/2' }), L({ poleIn: '96', poleFrac: '' }), L({ poleIn: 120 }), L({ lengthInches: 84 }), L({ poleIn: 'x', poleFrac: 'y' }), L({ poleIn: '9000' }), L({ poleIn: '96', poleFrac: '3/16', lengthInches: 10 })], [96.5, 96, 120, 84, null, null, 96.1875]);
    eq('where the customer is: the step and what a click applies to, nothing else', [P.uiFromClient({ step: 'ROD||', scope: 'part', x: 1 }), P.uiFromClient({ scope: 'EVERYTHING' }), P.uiFromClient(null)], [{ step: 'ROD||', scope: 'PART' }, { step: '', scope: '' }, { step: '', scope: '' }]);
    // which products a login may open: live, and preview for the logins ticked for previews
    const crm = { portalFlowIds: ['A', 'B', 7], portalPreviewFlowIds: ['B', 'C', ''], portalPreviewUids: ['uid-stuart'] };
    eq('a login sees the LIVE products; one ticked for previews also sees the PREVIEW ones (once, live winning)', [P.flowIdsFor(crm, 'uid-other'), P.flowIdsFor(crm, 'uid-stuart'), P.flowIdsFor(crm, ''), P.flowIdsFor(null, 'uid-stuart')],
        [{ live: ['A', 'B'], preview: [], all: ['A', 'B'] }, { live: ['A', 'B'], preview: ['C'], all: ['A', 'B', 'C'] }, { live: ['A', 'B'], preview: [], all: ['A', 'B'] }, { live: [], preview: [], all: [] }]);

    // Two assemblies: the H1-2TRV pins above, and a small made-up one with what they lack — finials (wood and clear, each with
    // a collar), a miter return that is a fee, a cast return, an inside mount and a plate behind every arm (the same assembly
    // scripts/hardwareSession.test.mjs walks), so a return that collapses its step, a collar and a removal are all reached.
    const fcl = (id, category, position, extra = {}) => ({ id, name: id, category, position, location: 'WALL', nodes: [`${id}_mesh`], ...extra });
    const FIN_ASM = { id: 'ASM-FIN', itemId: 'ASM-FIN', itemName: 'Ends and plates', partClass: 'Assembly', brandId: 'ce', manufacturingSpecs: { cadUrl: 'https://models.test/fin.glb' },
        nodeClusters: [fcl('F-ROD', 'POLE', 'CENTER'), fcl('F-EL', 'FINIAL', 'LEFT'), fcl('F-ER', 'FINIAL', 'RIGHT'), fcl('F-BL', 'BRACKET', 'LEFT'), fcl('F-BC', 'BRACKET', 'CENTER'), fcl('F-BR', 'BRACKET', 'RIGHT'),
            fcl('F-PL', 'BACKPLATE', 'LEFT'), fcl('F-PC', 'BACKPLATE', 'CENTER'), fcl('F-PR', 'BACKPLATE', 'RIGHT'), fcl('F-RG', 'RING', 'SHARED')] };
    let fp = 0;
    const fpin = (clusterId, code, extra = {}) => ({ id: `FPIN-${String(++fp).padStart(2, '0')}-${code}`, assemblyId: 'ASM-FIN', clusterId, partId: `FD-${code}`, partName: code, legacyErpId: code, targetNode: `${clusterId}_mesh`, defaultQty: 1, choiceSort: fp, ...extra });
    const endPins = (c) => [fpin(c, 'MF', { endTreatment: 'FINIAL' }), fpin(c, 'WF', { endTreatment: 'FINIAL', materials: 'WOOD', requiresCollar: 'COL' }), fpin(c, 'AF', { endTreatment: 'FINIAL', materials: 'CLEAR (NO FINISH)', requiresCollar: 'COL' }),
        fpin(c, 'COL', { endTreatment: 'FINIAL', isCollar: true }), fpin(c, 'MRF', { endTreatment: 'MITER_RETURN' }), fpin(c, 'CR', { endTreatment: 'FRENCH_RETURN' }), fpin(c, 'IM', { endTreatment: 'INSIDE_MOUNT' })];
    const FIN_PINS = [fpin('F-ROD', 'MR'), fpin('F-ROD', 'WR', { materials: 'WOOD' }), ...endPins('F-EL'), ...endPins('F-ER'),
        ...['F-BL', 'F-BC', 'F-BR'].flatMap(c => [fpin(c, 'BS'), fpin(c, 'BE')]), ...['F-PL', 'F-PC', 'F-PR'].flatMap(c => [fpin(c, 'BP'), fpin(c, 'BP2')]), fpin('F-RG', 'RG'), fpin('F-RG', 'WRG', { materials: 'WOOD' })];
    const fpart = (code, extra = {}) => ({ id: `FD-${code}`, itemId: `FD-${code}`, legacyErpId: code, itemName: `Item ${code}`, partClass: 'Inventory', brandId: 'ce', manufacturingSpecs: { basePrice: 10 + code.length }, ...extra });
    const FIN_PARTS = ['MR', 'WR', 'MF', 'WF', 'AF', 'COL', 'CR', 'IM', 'BE', 'BP', 'BP2', 'RG', 'WRG', 'BS'].map(c => fpart(c)).concat([fpart('MRF', { partClass: 'Fee' })]);
    const FIN_FLOW = { id: 'FLOW-FIN', name: 'Ends and plates', brandId: 'ce', linkedAssemblyId: 'ASM-FIN', extraItems: [], flowFinishes: [] };
    const TBR = { id: 'F-TBR', code: 'TBR', name: 'Track Bronze', material: 'METAL', textureUrl: 't://tbr', clientMapping: [{ customerId: 'FABRICUT', clientFinishName: 'Bronze' }] };
    const S11 = { id: 'F-S11', code: 'S11', name: 'Dark Walnut', material: 'WOOD', textureUrl: 't://s11' };
    const WORLDS = [
        { name: 'H1-2TRV', data: world(fabricut, { finishes: [...FIN, TBR] }), finishes: [...FIN, TBR] },
        { name: 'ends and plates', data: P.worldFor(engine, { flow: FIN_FLOW, records: [...FIN_PARTS, FIN_ASM], pins: FIN_PINS, finishes: [...FIN, TBR, S11], outsourceFinishes: OUT, spanDoc: null, trvRules: null, customer: fabricut, customerId: fabricut.id }), finishes: [...FIN, TBR, S11] },
    ];
    const allowedHere = new Set([...allowed, 'TBR', 'S11']);
    const tt = { views: 0, nodes: 0, collapse: 0, collapsed: 0, length: 0, pbr: 0, scale: 0, scope: 0, collarScope: 0, clicks: 0, words: 0, removals: 0, stock: 0 };
    const bad = [];
    for (const W of WORLDS) {
        const dOf = (level, state) => sessionOf({ ...W.data, priceLevel: level }, state);
        const frs = [];
        (function walk(answers) { const open = dOf('STANDARD', { answers, picks: {} }).model.axes.find(a => !a.implied && a.values.length > 1 && answers[a.key] == null); if (!open) { frs.push(answers); return; } open.values.forEach(v => walk({ ...answers, [open.key]: v })); })({});
        const pickIn = (answers, seed) => { const rand = rng(seed); let picks = {}; for (let g = 0; g < 40; g++) { const s0 = dOf('STANDARD', { answers, picks }); const slot = s0.model.slots.find(x => !s0.livePicks[x.key] && !picks[x.key] && x.options.length && !x.suppressedBy); if (!slot) break; picks[slot.key] = slot.options[Math.floor(rand() * slot.options.length)].id; } return picks; };
        const runs = W.name === 'H1-2TRV' ? 4 : 24;
        frs.forEach((answers, fi) => {
            for (let v = 0; v < runs; v++) {
                let picks = pickIn(answers, `s4|${W.name}|${fi}|${v}`);
                if (v % 4 === 3) {
                    // a later choice that takes something off: another framing's picks (the traverse pins), or an end turned into a
                    // return while its bracket stays picked (the made-up assembly)
                    if (W.name === 'H1-2TRV') picks = pickIn(frs[(fi + 1) % frs.length], `s4x|${fi}|${v}`);
                    else { const m0 = dOf('STANDARD', { answers, picks }).model; m0.slots.filter(sl => sl.kind === 'END').forEach(sl => { const ret = sl.options.find(o => o.role === 'RETURN'); if (ret) picks[sl.key] = ret.id; }); }
                }
                const raw = { answers, picks, poleIn: String([36, 96, 150, 60][(fi + v) % 4]), poleFrac: ['', '1/2', '3/8', ''][v % 4], globalFinishes: [{ METAL: 'P14', WOOD: 'S04' }, { METAL: 'EP4' }, {}, { METAL: 'P25', WOOD: 'S11' }][(fi + v) % 4].WOOD === 'S11' && W.name === 'H1-2TRV' ? { METAL: 'P25' } : [{ METAL: 'P14', WOOD: 'S04' }, { METAL: 'EP4' }, {}, { METAL: 'P25', WOOD: 'S11' }][(fi + v) % 4],
                    partFinish: v % 4 === 2 ? { [Object.values(picks)[0]]: 'EP4' } : {} };
                const state = P.stateFromClient(raw, { finishCodes: allowedHere, lengthOf: engine.lengthInchesOf });
                const hq = dOf('FAB_RETAIL', state);
                const offeredHere = P.portalFinishesOf(engine, W.data);
                hq.steps.forEach((st, si) => {
                    for (const pickedScope of [null, 'WHOLE', 'PART', 'COLLAR']) {
                        const ui = { step: st.key, scope: pickedScope || '' };
                        const view = P.viewOf(engine, W.data, state, { level: 'FAB_RETAIL', money: true, ui });
                        tt.views++;
                        if (pickedScope === null) {
                            // option nodes = the choice's own nodes; the collapse = CPQ's rule; the length step = the engine's figures
                            const vs = view.steps[si];
                            if (st.kind === 'SLOT') {
                                const wantNodes = (st.slot.options || []).map(o => (o.nodes || []).slice(0, 60));
                                if (JSON.stringify(wantNodes) !== JSON.stringify(vs.options.map(o => o.nodes))) bad.push(`nodes ${W.name} ${fi}.${v}.${si}`); else tt.nodes++;
                                const picked = (st.slot.options || []).find(o => o.id === hq.livePicks[st.slot.key]);
                                const want = !!(picked && picked.role === 'RETURN' && st.sub);
                                if (vs.collapse !== want) bad.push(`collapse ${W.name} ${fi}.${v}.${si}`); else { tt.collapse++; if (want) tt.collapsed++; }
                            }
                            if (st.kind === 'LENGTH') {
                                if (vs.lengthInches !== (hq.lengthInches || null) || vs.exactFeet !== (hq.lengthFeetExact || null) || vs.feetBilled !== (hq.lengthFeet || null) || JSON.stringify(vs.fabrics) !== JSON.stringify(FABRIC_CLASSES.map(f => ({ id: f.id, label: f.label })))) bad.push(`length ${W.name} ${fi}.${v}`); else tt.length++;
                            }
                            if (si === 0) {
                                // the drawing's light: the very numbers HQ's registry holds for each texture on screen; the scale
                                const all = pbrMapOf(W.finishes, OUT);
                                const want = {}; (hq.renderState ? hq.renderState.textureEntries : []).forEach(e => { if (all[e.url]) want[e.url] = all[e.url]; });
                                if (view.render && JSON.stringify(view.render.pbr) === JSON.stringify(want)) tt.pbr++; else bad.push(`pbr ${W.name} ${fi}.${v}`);
                                if (view.render && view.render.scale === 1) tt.scale++; else bad.push(`scale ${W.name} ${fi}.${v}`);
                                // a removed part is said in the customer's words, by our number; a stock colour by its name
                                tt.removals += view.removals.length;
                                if (view.removals.every(r => ['it is not made in the size now chosen', 'it is no longer offered on this step', 'it does not go with a choice made after it'].includes(r.why) && !/tagged|1\.6|carries the rod/i.test(JSON.stringify(r))
                                    && r.code === hq.ourId((hq.drops.find(d => d.key === r.key) || {}).partCode))) tt.words++; else bad.push(`words ${W.name} ${fi}.${v}`);   // by OUR number (a pin that names its item by number reads the same)
                                view.price.lines.filter(l => l.stock).forEach(l => { if (l.finish === 'Bronze') tt.stock++; else bad.push(`stock ${W.name} ${fi}.${v} ${l.finish}`); });
                            }
                        }
                        // WHAT A SWATCH CLICK APPLIES TO — the scope CPQ's own module works out for this step and this choice
                        const stepOption = (st.kind === 'SLOT' && hq.livePicks[st.slot.key]) ? ((st.slot.options || []).find(x => x.id === hq.livePicks[st.slot.key]) || null) : null;
                        const stepCollar = (stepOption && stepOption.requiresCollar) ? (companionsFor(hq.model.choices, [stepOption.id])[0] || null) : null;
                        const targets = scopeTargetsOf({ option: stepOption, collar: stepCollar, wears: (c) => offeredHere.some(f => hq.wearsFinish(c, f)) });
                        const now = scopeInForce({ targets, picked: pickedScope ? { step: st.key, scope: pickedScope } : null, stepKey: st.key, configFinishOf: hq.globalFinishFor });
                        const target = targets.find(x => x.scope === now) || targets[targets.length - 1];
                        const wearsMaterial = (c, mat) => hq.wearsFinish(c, { material: mat });
                        const wantGroups = view.finishes.groups.map(g => [g.material, highlightOf({ target, material: g.material, partFinish: hq.partFinish, configFinishOf: hq.globalFinishFor, globalFinishes: hq.globalFinishes, wearsMaterial }), (x => (x.kind === 'PART' ? { part: x.id } : { whole: true }))(swatchActionOf({ target, material: g.material, code: '', wearsMaterial }))]);
                        const gotGroups = view.finishes.groups.map(g => [g.material, g.sel, g.applies]);
                        if (view.finishes.scope.now !== now || JSON.stringify(view.finishes.scope.targets.map(x => x.scope)) !== JSON.stringify(targets.map(x => x.scope)) || JSON.stringify(gotGroups) !== JSON.stringify(wantGroups)) { if (bad.length < 12) bad.push(`scope ${W.name} ${fi}.${v}.${si}.${pickedScope}`); }
                        else { tt.scope++; if (targets.some(x => x.scope === 'COLLAR')) tt.collarScope++; }
                        // …and a click on each group's first swatch, applied the way the portal's screen applies it, sets what CPQ's own click sets
                        view.finishes.groups.forEach((g) => {
                            const code = g.lists[0].swatches[0].code;
                            const next = g.sel === code ? '' : code;
                            const pf = { ...state.partFinish }, gf = { ...state.globalFinishes };
                            if (g.applies.part) { if (next) pf[g.applies.part] = next; else delete pf[g.applies.part]; } else { if (next) gf[g.material] = next; else delete gf[g.material]; }
                            const x = swatchActionOf({ target, material: g.material, code: next, wearsMaterial });
                            const pf2 = { ...state.partFinish }, gf2 = { ...state.globalFinishes };
                            if (x.kind === 'PART') { if (x.code) pf2[x.id] = x.code; else delete pf2[x.id]; } else { if (x.code) gf2[g.material] = x.code; else delete gf2[g.material]; }
                            if (JSON.stringify([pf, gf]) !== JSON.stringify([pf2, gf2])) { if (bad.length < 12) bad.push(`click ${W.name} ${fi}.${v}.${si}.${g.material}`); } else tt.clicks++;
                        });
                    }
                });
            }
        });
    }
    if (process.env.PS_VERBOSE) console.log(JSON.stringify(tt));
    eq(`step 4: option nodes, the collapse, the length step, the light, the scale, the words, a stock colour by name, the finish switch and its clicks — all CPQ's (${tt.views} views)${bad.length ? ` — first: ${bad.slice(0, 6).join(', ')}` : ''}`, bad.length, 0);
    ok(`…and each road was taken — nodes ${tt.nodes}, collapse ${tt.collapse} (a return collapsing ${tt.collapsed}), length ${tt.length}, light ${tt.pbr}, scale ${tt.scale}, removals ${tt.removals} in words ${tt.words}, stock colours ${tt.stock}, scope ${tt.scope} (a collar among the targets ${tt.collarScope}), clicks ${tt.clicks}`,
        tt.nodes > 50 && tt.collapsed > 5 && tt.length > 10 && tt.pbr > 10 && tt.scale > 10 && tt.removals > 5 && tt.words > 10 && tt.stock > 0 && tt.scope > 200 && tt.collarScope > 10 && tt.clicks > 200);
}
// ── THE RECOMMENDATIONS (2026-10-19): what the span is worked from, the advice in the column that applies, the rods compared,
// a count short of the recommendation — each held against HQ's own module, and said on the request in the same words ──
{
    const S = (raw) => P.stateFromClient(raw, { finishCodes: allowed });
    eq('the curtain length is a number or nothing; the stud answer is no only when the screen says no', [S({ dropFt: '12' }).dropFt, S({ dropFt: 12.5 }).dropFt, S({ dropFt: 'tall' }).dropFt, S({ dropFt: '' }).dropFt, S({ dropFt: -3 }).dropFt, S({}).dropFt,
        S({ onStud: false }).onStud, S({}).onStud, S({ onStud: 'false' }).onStud, S({ onStud: 0 }).onStud], [12, 12.5, null, null, null, null, false, true, true, true]);
    // two rods of different engineering, so one would need fewer supports than the other (the acrylic and — for this test's
    // sake — the wood rod under the acrylic family's 36", the aluminium under its 72"); every framing offers one or the other
    const WEAK = ['H1-2RCTACR', 'H1-2RCTWR'];
    const W2 = world(fabricut, { spanDoc: { map: { 'H1-ALU2': 'H1-2RCTAR', 'H1-ACR-1.375': WEAK.join(', ') }, caps: {} } });
    const tr = { views: 0, support: 0, offStud: 0, rods: 0, better: 0, short: 0, notes: 0 };
    const bad2 = [];
    framings.forEach((answers, fi) => {
        for (let v = 0; v < 6; v++) {
            const picks = picksFor(answers, `rec|${fi}|${v % 4}`);
            // (the last two walks choose the weaker rod — the one the aluminium would beat — on the first rod step that offers it, then
            // on every rod step that does, where changing one cannot help while the other is weak too)
            if (v >= 4) { const m = direct('STANDARD', S({ answers, picks }), W2); m.model.slots.filter(sl => ['ROD', 'FASCIA', 'TRACK'].includes(sl.kind) && sl.options.some(o => WEAK.includes(m.ourId(o.partId)))).slice(0, v === 4 ? 1 : 9).forEach(sl => { picks[sl.key] = sl.options.find(o => WEAK.includes(m.ourId(o.partId))).id; }); }
            const span = [{}, { onStud: false }, { dropFt: '14', fabricId: 'BLACKOUT' }, { onStud: false, dropFt: 20 }, {}, { onStud: false }][v];
            const base = { answers, picks, lengthInches: [144, 180, 120.5, 216][(fi + v) % 4], globalFinishes: { METAL: 'P14', WOOD: 'S04' }, ...span };
            const hq0 = direct('STANDARD', S(base), W2);
            // a typed centre count below the recommendation, on every other walk
            const centre = hq0.model.slots.find(sl => sl.kind === 'BRACKET' && String(sl.position || '').toUpperCase() === 'CENTER' && hq0.livePicks[sl.key]);
            const raw = (centre && fi % 2 === 0 && (hq0.quantities[hq0.livePicks[centre.key]] || 0) > 1) ? { ...base, stepQty: { [centre.key]: '1' } } : base;
            const state = S(raw);
            const view = P.viewOf(engine, W2, state, { level: 'FAB_RETAIL', money: true });
            const hq = direct('FAB_RETAIL', state, W2);
            tr.views++;
            const len = view.steps.find(st => st.kind === 'LENGTH');
            if (len) {
                if (len.dropFt !== hq.span.dropFt || len.onStud !== hq.span.onStud || len.fabricId !== hq.span.fabricId) bad2.push(`span echo ${fi}.${v}`);
                const wantSupport = hq.advice ? { everyInches: hq.advice.everyInches, supports: hq.advice.supports, why: hq.advice.whyApplies, onStud: hq.advice.onStud, other: hq.advice.otherSupports || null,
                    ...(hq.advice.unlisted.length ? { unlisted: true } : {}) } : null;
                if (len.support && len.support.unlisted) tr.unlisted = (tr.unlisted || 0) + 1;
                if (JSON.stringify(len.support) !== JSON.stringify(wantSupport)) bad2.push(`support ${fi}.${v}`);
                if (len.support) { tr.support++; if (!len.support.onStud && len.support.supports === hq.advice.bracketsNoStud) tr.offStud++; }
                const wantRods = hq.rodOptions.map(r => [r.slotKey, r.options.map(o => [o.id, hq.ourId(o.partId), o.supports, o.picked]), r.better ? r.better.id : null]);
                const gotRods = (len.rods || []).map(r => [r.key, r.options.map(o => [o.id, o.code, o.supports, o.picked]), r.better ? r.better.id : null]);
                if (JSON.stringify(wantRods) !== JSON.stringify(gotRods)) bad2.push(`rods ${fi}.${v}`);
                if (gotRods.length) tr.rods++;
                if (gotRods.some(r => r[2])) tr.better++;
            }
            // the short count: on the centre's step, in the bar before Add, and on the request — the same words
            const wantShort = hq.supportShort.map(x => [x.slotKey, x.chosen, x.recommended]);
            const gotShort = view.steps.filter(st => st.short).map(st => [st.key.replace(/^.*?(BRACKET)/, '$1'), st.short.chosen, st.short.recommended]);
            if (JSON.stringify(wantShort.map(x => [x[1], x[2]])) !== JSON.stringify(gotShort.map(x => [x[1], x[2]])) || view.supportShort.length !== wantShort.length) bad2.push(`short ${fi}.${v}`);
            if (wantShort.length) tr.short++;
            const req = P.requestLineOf(engine, W2, state, { level: 'STANDARD' });
            if (req.item) {
                const own = direct('STANDARD', state, W2);
                const bare = (it) => { const c = JSON.parse(JSON.stringify(it)); delete c.id; return c; };
                if (JSON.stringify(bare(req.item)) !== JSON.stringify(bare(own.item))) bad2.push(`request ${fi}.${v}`);
                if (JSON.stringify(req.notes) !== JSON.stringify(view.supportShort)) bad2.push(`notes ${fi}.${v}`);
                if (req.notes.length) { tr.notes++; if (!/^Fewer centre brackets than recommended: (\d+|none) chosen, \d+ recommended for this [\d.]+″ pole (in a stud|on drywall with toggles)\.( The customer confirmed the risk\.)?$/.test(req.notes[0])
                    || / in a stud\./.test(req.notes[0]) !== (state.onStud !== false) || !req.notes[0].includes(`${hq.lengthInches}″`) || / confirmed /.test(req.notes[0])) bad2.push(`note words ${fi}.${v}: ${req.notes[0]}`); }
                // the answers that differ from the default ride the saved line, so a reopen recommends what was recommended
                const ec = req.item.engineConfig;
                if ((state.onStud === false) !== (ec.onStud === false) || (hq.span.dropFt !== 8) !== (ec.dropFt === hq.span.dropFt)) bad2.push(`saved span ${fi}.${v}`);
            }
            const text = JSON.stringify(view);
            if ([...keysOf(view)].some(k => FORBIDDEN.test(k)) || /ACME FOUNDRY|INTERNAL-ROUTE|never show a customer|OTHER-\d|Their black|PLATER CO|3\.33/.test(text)) bad2.push(`leak ${fi}.${v}`);
        }
    });
    if (process.env.PS_VERBOSE) console.log(JSON.stringify(tr));
    eq(`the recommendations the portal draws are HQ's: the span answers, the advice in the column that applies, the rods compared, the short count and its words — on the view and the request (${tr.views} views)${bad2.length ? ` — first: ${bad2.slice(0, 6).join(', ')}` : ''}`, bad2.length, 0);
    ok(`…and each road was taken — advice ${tr.support} (off-stud ${tr.offStud}), rods compared ${tr.rods} (a fewer-supports rod ${tr.better}), a short count ${tr.short}, said on the request ${tr.notes}`,
        tr.support > 20 && tr.offStud > 5 && tr.rods > 5 && tr.better > 2 && tr.short > 3 && tr.notes > 3);
}

// ── THE SPLICE AND THE RISK WINDOW ON THE PORTAL (2026-10-19): the count rounded up at a splice, the gate's words, the risk numbers
//    with the key a Confirm answers, and "the customer confirmed the risk" only for the count confirmed ──
{
    const S2 = (raw) => P.stateFromClient(raw, { finishCodes: allowed });
    const W3 = world(fabricut, { spanDoc: { map: { 'H1-ALU2': 'H1-2RCTAR, H1-2RCTWR, H1-2RCTACR' }, caps: {} } });
    const t3 = { rounded: 0, gate: 0, risk: 0, confirmed: 0, unconfirmed: 0 };
    const bad3 = [];
    framings.forEach((answers, fi) => {
        const picks = picksFor(answers, `splice|${fi}`);
        const base = { answers, picks, lengthInches: 150, globalFinishes: { METAL: 'P14', WOOD: 'S04' }, onStud: false };
        const hq0 = direct('STANDARD', S2(base), W3);
        const centre = hq0.model.slots.find(sl => sl.kind === 'BRACKET' && String(sl.position || '').toUpperCase() === 'CENTER' && hq0.livePicks[sl.key]);
        if (hq0.splice.count && centre) {
            const state = S2({ ...base, stepQty: { [centre.key]: '2' } });
            const view = P.viewOf(engine, W3, state, { level: 'FAB_RETAIL', money: true });
            const st = view.steps.find(x => x.key === centre.key);
            const want = direct('FAB_RETAIL', state, W3).quantities[hq0.livePicks[centre.key]];
            if (!st || !st.qty || st.qty.rounded !== want || want % 2 !== 1 || st.qty.splices !== hq0.splice.count) bad3.push(`rounded #${fi}: ${JSON.stringify(st && st.qty)} vs ${want}`); else t3.rounded++;
            // the risk numbers and their key, as the engine keys them; the note says "confirmed" only for that key
            const hq = direct('FAB_RETAIL', S2({ ...base, stepQty: { [centre.key]: '1' } }), W3);
            const v1 = P.viewOf(engine, W3, S2({ ...base, stepQty: { [centre.key]: '1' } }), { level: 'FAB_RETAIL', money: true });
            const wantRisk = hq.supportShort.map(x => ({ chosen: x.chosen, recommended: x.recommended, onStud: false, lengthInches: hq.lengthInches, everyInches: hq.advice ? hq.advice.everyInches : null,
                key: engine.spanRiskKeyOf({ chosen: x.chosen, recommended: x.recommended, onStud: false, lengthInches: hq.lengthInches }) }));
            if (JSON.stringify(v1.risk) !== JSON.stringify(wantRisk)) bad3.push(`risk #${fi}`);
            if (wantRisk.length) {
                t3.risk++;
                const yes = P.requestLineOf(engine, W3, S2({ ...base, stepQty: { [centre.key]: '1' }, riskConfirmed: wantRisk[0].key }), { level: 'STANDARD' });
                const no = P.requestLineOf(engine, W3, S2({ ...base, stepQty: { [centre.key]: '1' }, riskConfirmed: '9|9|STUD|1' }), { level: 'STANDARD' });
                if (yes.item && /The customer confirmed the risk\.$/.test(yes.notes[0])) t3.confirmed++; else if (yes.item) bad3.push(`confirmed #${fi}: ${yes.notes[0]}`);
                if (no.item && !/confirmed/.test(no.notes[0])) t3.unconfirmed++; else if (no.item) bad3.push(`unconfirmed #${fi}: ${no.notes[0]}`);
            }
        }
        // the gate: a spliced pole with its centre bracket left unchosen — refused for HQ's reason, in the portal's words
        if (hq0.splice.count && centre) {
            const noCentre = { ...picks }; delete noCentre[centre.key];
            const st = S2({ ...base, picks: noCentre });
            const hqN = direct('STANDARD', st, W3);
            if (hqN.refusal && hqN.refusal.kind === 'SPLICE_CENTRE') {
                const v = P.viewOf(engine, W3, st, { level: 'FAB_RETAIL', money: true });
                if (!v.refusal || v.refusal.kind !== 'SPLICE_CENTRE' || v.refusal.message !== P.REFUSAL_WORDS.SPLICE_CENTRE || !/two pieces/.test(v.refusal.message)) bad3.push(`gate words #${fi}`); else t3.gate++;
            }
        }
    });
    if (process.env.PS_VERBOSE) console.log(JSON.stringify(t3));
    eq(`the portal at a splice: the typed count rounded up as the bill holds it, the risk numbers and their key as the engine keys them, "confirmed" only for the count confirmed, the gate in the portal's words${bad3.length ? ` — first: ${bad3.slice(0, 4).join('; ')}` : ''}`, bad3.length, 0);
    ok(`…reached: rounded ${t3.rounded}, a short count with its key ${t3.risk} (confirmed ${t3.confirmed}, not ${t3.unconfirmed}), the gate ${t3.gate}`, t3.rounded > 5 && t3.risk > 3 && t3.confirmed === t3.risk && t3.unconfirmed === t3.risk && t3.gate > 3);
}

// THE CUSTOMER'S PICTURE OF A LINE (step 5, Stuart 2026-10-20): kept only as what it claims to be, a JPEG this size or smaller;
// kept in line order while the one request document fits — never a refusal.
{
    const jpegOf = (n = 64) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(n, 7), Buffer.from([0xFF, 0xD9])]).toString('base64')}`;
    const J = jpegOf();
    eq('a picture: a JPEG data URL is kept exactly as sent', P.pictureOf(J), J);
    eq('…a PNG, a JPEG label on other bytes, a JPEG cut short, other bytes ending as a JPEG ends, text, a number and nothing are left off', [
        P.pictureOf(`data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 0xFF, 0xD9]).toString('base64')}`),
        P.pictureOf(`data:image/jpeg;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`),
        P.pictureOf(J.slice(0, -8)),
        P.pictureOf(`data:image/jpeg;base64,${Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16, 7), Buffer.from([0xFF, 0xD9])]).toString('base64')}`),
        P.pictureOf('hello'), P.pictureOf(42), P.pictureOf(null),
    ], [null, null, null, null, null, null, null]);
    eq('…anything after the picture (markup, a second URL) leaves it off', [P.pictureOf(`${J}"><script>alert(1)</script>`), P.pictureOf(`${J} data:image/jpeg;base64,AAAA`)], [null, null]);
    eq('…and one past the size limit is left off', [P.pictureOf(jpegOf(Math.floor(P.PICTURE_MAX * 0.74))), P.pictureOf(jpegOf(Math.floor(P.PICTURE_MAX * 0.76)))].map((x) => !!x), [true, false]);
    const a = 'a'.repeat(100), b = 'b'.repeat(300), c = 'c'.repeat(50);
    eq('the request fits one document: pictures kept in line order while it fits — a later, smaller one still goes in', P.picturesThatFit([a, b, null, c], 0, 250), [a, null, null, c]);
    eq('…a document already full keeps none, and nothing is never a picture', [P.picturesThatFit([a], 300, 250), P.picturesThatFit(null, 0)], [[null], []]);
    eq('…the default limit sits under Firestore\'s 1 MiB', P.REQUEST_DOC_LIMIT < 1048576 && P.REQUEST_DOC_LIMIT > 500000, true);
}

eq('in line: the server\'s copy and the site\'s bundle carry the same engine and the same files — anything else is behind', [P.inLine(engine.stamp, { ...engine.stamp }), P.inLine(engine.stamp, { ...engine.stamp, closureHash: 'x' }), P.inLine(engine.stamp, { ...engine.stamp, engineVersion: 'y' }), P.inLine(engine.stamp, null), P.inLine(null, engine.stamp), P.inLine({ engineVersion: '', closureHash: '' }, { engineVersion: '', closureHash: '' })], [true, false, false, false, false, false]);

rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
