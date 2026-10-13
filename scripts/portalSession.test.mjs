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
const records = [...library, extra('SCREW-PACK', 3.5, { manufacturingSpecs: { basePrice: 3.5, fabricut: { cost: 2, wholesale: 4, retail: 8 } } }), extra('TWIN-BRASS', 99), extra('H1-2JNR', 20, { manufacturingSpecs: { basePrice: 20, customData: { unfinished: true } } }), extra('FEE-PAINT', 45, { partClass: 'Fee' }),
    { ...ASSEMBLY, id: 'ASM-TRV', itemId: 'ASM-TRV', itemName: 'H1 2" Traverse', partClass: 'Assembly', brandId: 'ce', manufacturingSpecs: { ...(ASSEMBLY.manufacturingSpecs || {}), cadUrl: 'https://models.test/trv.glb' } },
    { id: 'KIT-SYS', legacyErpId: 'H1-2TRV-4/P', itemName: 'System kit', partClass: 'Kit', brandId: 'ce', manufacturingSpecs: { kitAlign: { setup: 'SINGLE' } } },
    { id: 'KIT-ITEM', legacyErpId: 'H1-2TRV-CB', itemName: 'Bracket kit', partClass: 'Kit', brandId: 'ce', manufacturingSpecs: { basePrice: 61, kitComponents: [{ partId: library[1].id, qty: 1 }] } },
    { id: 'OTHER-BRAND', legacyErpId: 'M2C-LAMP', itemName: 'Another brand', partClass: 'Inventory', brandId: 'm2c', manufacturingSpecs: { basePrice: 5 } },
    { id: 'SHARED', legacyErpId: 'SHARED-1', itemName: 'Shared with ce', partClass: 'Inventory', brandId: 'm2c', sharedBrands: ['ce'], manufacturingSpecs: { basePrice: 5 } }];
// …and one part that is billed but never shown — a hidden pin (the screws): in the engine's total, off the customer's lines
const pins = [...PINS.map(pn => ({ ...pn, assemblyId: 'ASM-TRV' })), { ...PINS[0], id: 'PIN-HIDDEN-SCREWS', assemblyId: 'ASM-TRV', partId: 'X-SCREW-PACK', partName: 'Screw pack', isHiddenPart: true, targetNode: '', choiceNode: '' }];
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
    eq('a finish that turns a pinned part into its other-material item is not offered on the portal', offered, ['P14', 'P25', 'S04', 'EP4']);
    eq('…it is, on a flow where no pinned part has such a twin', P.portalFinishesOf(engine, world(fabricut, { records: records.filter(r => r.id !== 'X-TWIN-BRASS') })).map(f => f.code), ['P14', 'P25', 'S04', 'LBR', 'EP4']);
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
    const portalGroups = P.viewOf(engine, w0, twinState, { level: 'FAB_RETAIL', money: true }).finishes.groups.flatMap(g => [...g.inHouse, ...g.out]).map(f => f.code);
    eq('with the part that has a brass twin chosen, CPQ itself offers the brass — the portal\'s view does not', [hqGroups.includes('LBR'), portalGroups.includes('LBR'), portalGroups.includes('P14')], [true, false, true]);
    ok('the finishes offered are grouped as CPQ groups them, in the customer\'s own words where they have one, and never the brass', view.finishes.groups.length > 0 && view.finishes.groups.every(g => [...g.inHouse, ...g.out].every(f => f.code !== 'LBR')) && view.finishes.groups.some(g => g.inHouse.some(f => f.code === 'P14' && f.theirs === 'Black')) && JSON.stringify(view.finishes.chosen) === JSON.stringify({ METAL: 'P14', WOOD: 'S04' }));
    ok('what is drawn is the engine\'s additive render: the nodes of what was chosen, by name', !!view.render && view.render.visible.length > 0 && view.render.visible.every(n => typeof n === 'string'));
}
eq('in line: the server\'s copy and the site\'s bundle carry the same engine and the same files — anything else is behind', [P.inLine(engine.stamp, { ...engine.stamp }), P.inLine(engine.stamp, { ...engine.stamp, closureHash: 'x' }), P.inLine(engine.stamp, { ...engine.stamp, engineVersion: 'y' }), P.inLine(engine.stamp, null), P.inLine(null, engine.stamp), P.inLine({ engineVersion: '', closureHash: '' }, { engineVersion: '', closureHash: '' })], [true, false, false, false, false, false]);

rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
