// Harness for Shared/materialTwin.js — the same part made in another material (the 1" brass, Stuart 2026-10-06),
// through the pricing engine and the cart-line handoff that every floor, pick and NetSuite push reads.
//   node scripts/materialTwin.test.mjs
import { readFileSync } from 'fs';
import { materialTwinsOf, twinCodeOf, materialTwinOf, wearsAsTwin, withTwin, twinRefusal, finishMaterialOf } from '../src/components/Shared/materialTwin.js';
import { priceChoice, priceConfiguration, PRICE_SOURCES } from '../src/components/Shared/hardwarePricing.js';

const src = (f) => readFileSync(new URL(`../src/components/Shared/${f}`, import.meta.url), 'utf8');
const mod = async (f) => import(`data:text/javascript;base64,${Buffer.from(
    src(f).replace(/from '\.\/([\w.]+)\.js'/g, (m, n) => `from '${new URL(`../src/components/Shared/${n}.js`, import.meta.url)}'`)
).toString('base64')}`);
const { handoffItem } = await mod('hardwareHandoff.js');

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// ── The library, as it stands live (2026-10-06) ──────────────────────────────────────────────────
const twinsOn = (code) => ({ customData: { materialTwins: [{ material: 'BRASS', code }] } });
const STEEL_BS = { id: 'CE-INV-56675', legacyErpId: 'H1-1BS', itemName: 'Basic Bracket (3-5/8" P)',
    manufacturingSpecs: { basePrice: 12, partHandling: 'Small Parts', ...twinsOn('H1-1BBS'),
        fabricut: { fabCodePainted: 'H3568F', fabCodePremium: 'H3568F PREMIUM', paintedCost: 12, paintedWholesale: 24, paintedRetail: 48, platedCost: 24, platedWholesale: 44, platedRetail: 88 } } };
const STEEL_BS_P = { id: 'CE-INV-56600', legacyErpId: 'H1-1BS/P', itemName: 'Basic Bracket (3-5/8" P) - Painted', manufacturingSpecs: {} };
// the brass bracket with its price as THIS ITEM'S OWN (what 4.6 must hold for it to read under any finish)…
const BRASS_BS = { id: 'CE-INV-62563', legacyErpId: 'H1-1BBS', itemName: '1" Brushed Brass Basic Bracket (3-5/8" P)',
    manufacturingSpecs: { partHandling: 'Small Parts', fabricut: { fabCodePainted: 'H3654F', cost: 35, wholesale: 64, retail: 128 } } };
// …and as the six brackets were stored on 10-06: the price in the PAINTED tier only.
const BRASS_BS_PAINTED_ONLY = { ...BRASS_BS, manufacturingSpecs: { partHandling: 'Small Parts', fabricut: { fabCodePainted: 'H3654F', paintedCost: 35, paintedWholesale: 64, paintedRetail: 128 } } };
const BRASS_BS_POLISHED = { id: 'CE-INV-62566', legacyErpId: 'H1-1BBS/P', itemName: '1" Polished Brass Basic Bracket (3-5/8" P) - Unlacquered', manufacturingSpecs: { fabricut: { cost: 35 } } };
const STEEL_ROD = { id: 'CE-INV-51244', legacyErpId: 'H1-1R', itemName: '1" Round Hollow Rod Stock (14 GA)',
    manufacturingSpecs: { basePrice: 10, partHandling: 'Custom', ...twinsOn('H1-1BPOLE'), fabricut: { fabCodePainted: 'H2579F', paintedCost: 10, platedCost: 30 } } };
const BRASS_ROD = { id: 'CE-INV-62384', legacyErpId: 'H1-1BPOLE', itemName: '1" Round Brass Rod',
    manufacturingSpecs: { basePrice: 10, partHandling: 'Custom', fabricut: { fabCodeBase: 'H2586F', cost: 50, wholesale: 91, retail: 182 } } };
const STEEL_DS = { id: 'CE-INV-70001', legacyErpId: 'H1-1DS', itemName: 'Decorative Bracket (3-5/8" P)',   // no brass twin
    manufacturingSpecs: { fabricut: { fabCodePainted: 'H3579F', fabCodePremium: 'H3579F PREMIUM', paintedCost: 30, platedCost: 46 } } };
const LIB = [STEEL_BS, STEEL_BS_P, BRASS_BS, BRASS_BS_POLISHED, STEEL_ROD, BRASS_ROD, STEEL_DS];
const libOf = (list) => (key) => { const k = String(key || '').toUpperCase(); return list.find(p => p.id.toUpperCase() === k || p.legacyErpId.toUpperCase() === k) || null; };
const find = libOf(LIB);

const LBR = { id: 'FIN-UBP', code: 'LBR', name: 'LIVE SOLID BRASS', material: 'BRASS', multiplier: 1 };
const LBR_UNSET = { ...LBR, material: '' };                       // as it stood before its material was set
const P06 = { id: 'F-P06', code: 'P06', name: 'BLACK', material: 'METAL' };
const EP2 = { id: 'F-EP2', code: 'EP2', name: 'EP2', material: 'METAL', multiplier: 1 };
const FIN = { LBR, P06, EP2 };
const CUST = { id: 'FABRICUT', name: 'Fabricut' };
const ctx = (over = {}) => ({ customerId: CUST.id, customer: CUST, priceLevel: 'FAB_COST', outsourceCodes: ['LBR', 'EP2'],
    findPart: find, findByCode: find, finishObjOf: (c) => FIN[String(c || '').toUpperCase()] || null, ...over });

// ── THE TAG ──────────────────────────────────────────────────────────────────────────────────────
{
    eq('a part names its twins, cleaned and uppercased', materialTwinsOf({ manufacturingSpecs: { customData: { materialTwins: [{ material: ' brass ', code: 'h1-1bbs' }, { material: '', code: 'X' }, { material: 'BRASS', code: 'SECOND' }, null] } } }),
        [{ material: 'BRASS', code: 'H1-1BBS' }]);
    eq('no tag, no twins', materialTwinsOf(STEEL_DS), []);
    eq('the twin code in a material', [twinCodeOf(STEEL_BS, 'brass'), twinCodeOf(STEEL_BS, 'WOOD'), twinCodeOf(STEEL_BS, '')], ['H1-1BBS', '', '']);
    eq('a finish belongs to its material; an unset one to none', [finishMaterialOf(LBR), finishMaterialOf(LBR_UNSET), finishMaterialOf(null)], ['BRASS', '', '']);
    ok('LBR on the basic bracket is the brass bracket', materialTwinOf(STEEL_BS, LBR, find) === BRASS_BS);
    ok('a metal finish swaps nothing', materialTwinOf(STEEL_BS, P06, find) === null);
    ok('a part with no brass twin swaps nothing', materialTwinOf(STEEL_DS, LBR, find) === null);
    ok('a finish with no material swaps nothing', materialTwinOf(STEEL_BS, LBR_UNSET, find) === null);
    ok('a twin that is not in the library swaps nothing', materialTwinOf({ ...STEEL_BS, manufacturingSpecs: twinsOn('NOT-THERE') }, LBR, find) === null);
    ok('a finished variant is never swapped', materialTwinOf({ ...STEEL_BS_P, manufacturingSpecs: twinsOn('H1-1BBS') }, LBR, find) === null);
    ok('the brass item itself has no twin to go to', materialTwinOf(BRASS_BS, LBR, find) === null);
    eq('worn as a twin: only the parts that name one', [wearsAsTwin(STEEL_BS, LBR, find), wearsAsTwin(STEEL_DS, LBR, find), wearsAsTwin(STEEL_BS, P06, find)], [true, false, false]);
}
// ── THE DRAWER ───────────────────────────────────────────────────────────────────────────────────
{
    eq('add', withTwin([], 'brass', 'h1-1bbs'), [{ material: 'BRASS', code: 'H1-1BBS' }]);
    eq('replace the same material, keep the others', withTwin([{ material: 'BRASS', code: 'OLD' }, { material: 'WOOD', code: 'W1' }], 'BRASS', 'H1-1BBS'),
        [{ material: 'WOOD', code: 'W1' }, { material: 'BRASS', code: 'H1-1BBS' }]);
    eq('a blank code removes it', withTwin([{ material: 'BRASS', code: 'H1-1BBS' }], 'BRASS', ''), []);
    eq('nothing typed is not an error', twinRefusal(STEEL_BS, '', '', find), '');
    ok('a code needs its material', /material/i.test(twinRefusal(STEEL_BS, '', 'H1-1BBS', find)));
    ok('a material needs its code', /item number/i.test(twinRefusal(STEEL_BS, 'BRASS', '', find)));
    ok('a finished item is refused — the finish picks its own variant', /finished item/.test(twinRefusal(STEEL_BS, 'BRASS', 'H1-1BBS/P', find)));
    ok('a part is not its own twin', /own twin/.test(twinRefusal(STEEL_BS, 'BRASS', 'h1-1bs', find)));
    ok('the twin must be in the library', /not in the Master Library/.test(twinRefusal(STEEL_BS, 'BRASS', 'NOPE', find)));
    eq('a good twin saves', twinRefusal(STEEL_BS, 'BRASS', 'H1-1BBS', find), '');
}
// ── THE PRICE AND THE IDENTITY ───────────────────────────────────────────────────────────────────
{
    const p = priceChoice({}, STEEL_BS, ctx({ finishCode: 'LBR' }));
    eq('LBR on H1-1BS: billed as the brass bracket, at the brass price, under the brass pattern number',
        [p.billedId, p.price, p.source, p.aliasCode, p.soldPartId, p.twinOf], ['H1-1BBS', 35, PRICE_SOURCES.LEVEL, 'H3654F', 'CE-INV-62563', 'H1-1BS']);
    eq('…wholesale and retail are the brass item\'s too', [priceChoice({}, STEEL_BS, ctx({ finishCode: 'LBR', priceLevel: 'FAB_WHOLESALE' })).price, priceChoice({}, STEEL_BS, ctx({ finishCode: 'LBR', priceLevel: 'FAB_RETAIL' })).price], [64, 128]);
    const rod = priceChoice({}, STEEL_ROD, ctx({ finishCode: 'LBR' }));
    eq('the pole: the brass rod, by the foot at its own price', [rod.billedId, rod.price, rod.aliasCode, rod.twinOf], ['H1-1BPOLE', 50, 'H2586F', 'H1-1R']);
    // the brass /P is POLISHED, not the paint rollup — LBR never lands on it
    eq('LBR does not wander onto the polished variant', priceChoice({}, STEEL_BS, ctx({ finishCode: 'LBR' })).billedId, 'H1-1BBS');

    const paint = priceChoice({}, STEEL_BS, ctx({ finishCode: 'P06' }));
    eq('a paint on the same part is the standard part\'s /P, as before', [paint.billedId, paint.soldPartId, paint.twinOf], ['H1-1BS/P', undefined, undefined]);
    const plain = priceChoice({}, STEEL_BS, ctx({}));
    eq('no finish: the standard part, untouched', [plain.billedId, plain.twinOf], ['H1-1BS', undefined]);
    const noTwin = priceChoice({}, STEEL_DS, ctx({ finishCode: 'LBR' }));
    eq('a part with no brass twin stays itself under LBR (the configurator never lets LBR land on it)', [noTwin.billedId, noTwin.twinOf], ['H1-1DS', undefined]);
    const unset = priceChoice({}, STEEL_BS, ctx({ finishCode: 'LBR', finishObjOf: () => LBR_UNSET }));
    eq('until LBR is given its material nothing swaps', [unset.billedId, unset.twinOf], ['H1-1BS', undefined]);
    const noLookup = priceChoice({}, STEEL_BS, ctx({ finishCode: 'LBR', finishObjOf: undefined }));
    eq('a caller with no finish lookup is exactly as before', [noLookup.billedId, noLookup.twinOf], ['H1-1BS', undefined]);

    // WHY THE SIX BRACKET PRICES MUST BE THE ITEM'S OWN: LBR is on the outsource registry, which reads the plated tier.
    const lib2 = libOf([STEEL_BS, BRASS_BS_PAINTED_ONLY]);
    const short = priceChoice({}, STEEL_BS, ctx({ finishCode: 'LBR', findPart: lib2, findByCode: lib2 }));
    eq('a brass bracket priced only in the painted tier has no price under LBR — and says so', [short.billedId, short.price, short.source], ['H1-1BBS', 0, PRICE_SOURCES.NONE]);
}
// ── THE LINE EVERY CONSUMER READS ────────────────────────────────────────────────────────────────
{
    const model = { choices: [], bom: [
        { id: 'c-bkt', partId: 'CE-INV-56675', name: 'H21BS', qty: 3, role: 'BRACKET', position: 'CENTER' },
        { id: 'c-rod', partId: 'CE-INV-51244', name: 'H21R', qty: 1, role: 'ROD' },
        { id: 'c-dec', partId: 'CE-INV-70001', name: 'H21DS', qty: 2, role: 'BRACKET', position: 'LEFT' },
    ] };
    // what the configurator answers per part: LBR on the two brass-made parts, the metal finish on the rest
    const finishFor = (c) => (c.id === 'c-dec' ? 'EP2' : 'LBR');
    const priced = priceConfiguration(model, ctx({ finishCode: 'EP2', finishFor, billedFeet: 8, lengthInches: 92 }));
    const [bkt, rod, dec] = priced.lines;
    eq('the bracket line: the pin\'s part stays the join, the brass item is what is sold', [bkt.partId, bkt.soldPartId, bkt.billedId, bkt.twinOf, bkt.finishCode, bkt.unit, bkt.total, bkt.aliasCode],
        ['CE-INV-56675', 'CE-INV-62563', 'H1-1BBS', 'H1-1BS', 'LBR', 35, 105, 'H3654F']);
    eq('the pole line: brass rod, 8 ft at $50', [rod.billedId, rod.perFoot, rod.feet, rod.unit, rod.total, rod.cutLength], ['H1-1BPOLE', true, 8, 50, 400, 92]);
    eq('the decorative bracket keeps its own number in its own finish', [dec.billedId, dec.twinOf, dec.finishCode], ['H1-1DS', undefined, 'EP2']);

    const item = handoffItem(model, { ...ctx({ finishCode: 'EP2', finishFor, billedFeet: 8, lengthInches: 92 }), lengthFeet: 8,
        assembly: { id: 'A1', itemName: 'H1-1' }, flow: { id: 'F1', name: 'H1-1' }, finishes: [LBR, EP2, P06],
        globalFinish: 'EP2', globalFinishes: { METAL: 'EP2', BRASS: 'LBR' } });
    const lines = item.pricingBreakdown || item.lines || [];
    const b = lines.find(l => l.legacyErpId === 'H1-1BBS'), r = lines.find(l => l.legacyErpId === 'H1-1BPOLE'), d = lines.find(l => l.legacyErpId === 'H1-1DS');
    ok('the cart carries a brass bracket line', !!b);
    eq('…named, joined and handled as the brass item, finished in LBR', b && [b.name, b.partId, b.legacyErpId, b.clientSku, b.finishCode, b.finishLabel, b.partHandling, b.twinOf, b.qty, b.price],
        ['1" Brushed Brass Basic Bracket (3-5/8" P)', 'CE-INV-62563', 'H1-1BBS', 'H3654F', 'LBR', 'LIVE SOLID BRASS', 'Small Parts', 'H1-1BS', 3, 35]);
    eq('the brass pole line: its own record, by the foot, with the cut', r && [r.name, r.partId, r.partHandling, r.perFoot, r.feet, r.cutLength], ['1" Round Brass Rod', 'CE-INV-62384', 'Custom', true, 8, 92]);
    eq('a part with no twin is the line it always was', d && [d.name, d.partId, d.twinOf], ['Decorative Bracket (3-5/8" P)', 'CE-INV-70001', undefined]);
    ok('both material slots survive for reopen', item.engineConfig.globalFinishes.BRASS === 'LBR' && item.engineConfig.globalFinishes.METAL === 'EP2');
}

console.log(`${fail ? '✗' : '✓'} materialTwin: ${pass} passed${fail ? `, ${fail} FAILED` : ''}`);
process.exit(fail ? 1 : 0);
