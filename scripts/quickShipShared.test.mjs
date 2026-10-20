// Tab 7's Quick Ship readings, price and traverse-kit sale, moved into Shared (quickShipItems / quickShipPricing / traverseKitSale) on
// 2026-10-20 so the customer portal's Quick Ship reads, prices and sells exactly as Order Entry does.   node scripts/quickShipShared.test.mjs
//
// Tab 7's OWN code as it stood before the move (HQ/QuickShipTab.js) is kept below verbatim as the reference; every function is held to it.
import { classifyCat, catOf, erpOf, nsIdOf, collectionsOf, isInsideMount, finishCodeOf, isFinished, diaCellLabel } from '../src/components/Shared/quickShipItems.js';
import { quickShipPriceCtxOf, quickShipPriceOf, quickShipRateOf } from '../src/components/Shared/quickShipPricing.js';
import { traverseKitsOf, traverseKitByCode, traverseKitFinishesOf, traverseKitIsSingle, traverseKitProjectionsOf, traverseKitLinesOf, traverseComponentLinesOf, traverseKitOrderOf, traverseKitFamilyOf } from '../src/components/Shared/traverseKitSale.js';
import { isPoleCategory } from '../src/components/Shared/poleCut.js';
import { SIZE_FAMILIES } from '../src/components/Shared/sizeMatrix.js';
import { priceChoice } from '../src/components/Shared/hardwarePricing.js';
import { customerPriceLevel } from '../src/components/Shared/priceLevels.js';
import { findClientPriceRow, customerKeys } from '../src/components/Shared/clientPricing.js';
import { resolveKitCode } from '../src/components/Shared/kitCode.js';
import { singleProjections, projLabel } from '../src/components/Shared/traverseExplode.js';
import { configuratorLines, defaultPicks } from '../src/components/Shared/traverseConfigurator.js';

let pass = 0, fail = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${JSON.stringify(a).slice(0, 300)}\n    want ${JSON.stringify(b).slice(0, 300)}`); };

// ── THE REFERENCE: tab 7 before the move (verbatim) ──
const R = {};
R.classifyCat = (pt) => { const t = String(pt || '').toUpperCase(); if (t.includes('BACKPLATE') || t.includes('BACK PLATE')) return 'BACKPLATE'; if (t.includes('BRACKET')) return 'BRACKET'; if (t.includes('FINIAL')) return 'FINIAL'; if (t.includes('RING')) return 'RING'; if (isPoleCategory(t)) return 'POLE'; return ''; };
R.erpOf = (it) => String(it.legacyErpId || it.itemId || '').toUpperCase();
R.nsIdOf = (it) => it.netSuiteInternalId || it.legacyErpId || it.itemId || '';
R.collectionsOf = (it) => (it.manufacturingSpecs?.collections || (it.manufacturingSpecs?.customData?.collection ? [it.manufacturingSpecs.customData.collection] : [])).map(c => String(c || '').trim().toUpperCase()).filter(Boolean);
R.diaCellLabel = (cell) => { const [fam, dia] = String(cell || '').split('|'); const opt = SIZE_FAMILIES[fam]?.dia?.options?.find(o => o.value === dia); return opt ? `${SIZE_FAMILIES[fam].label} · ${opt.label}` : cell; };
R.isInsideMount = (it) => /INSIDE/.test(String(it?.manufacturingSpecs?.customData?.bracketType || it?.manufacturingSpecs?.customData?.bracketMount || '').toUpperCase());
R.finishCodeOf = (it) => R.erpOf(it).split('/')[1] || '';
R.isFinished = (it) => R.erpOf(it).includes('/');
R.catOf = (it) => R.classifyCat(it.manufacturingSpecs?.productType || it.productType || it.customData?.category);
// the portal page's OWN mirror before the move (portal/src/QuickShip.jsx) — the drift this ends
const PORTAL_OLD_classifyCat = (pt) => { const t = String(pt || '').toUpperCase(); if (t.includes('BACKPLATE') || t.includes('BACK PLATE')) return 'BACKPLATE'; if (t.includes('BRACKET')) return 'BRACKET'; if (t.includes('FINIAL')) return 'FINIAL'; if (t.includes('RING')) return 'RING'; if (t.includes('POLE') || t.includes('ROD')) return 'POLE'; return ''; };
const PORTAL_OLD_catOf = (it) => PORTAL_OLD_classifyCat(it.manufacturingSpecs?.productType || it.productType);

// ── 1. WHAT AN ITEM IS ──
const items = [
    { id: 'A', legacyErpId: 'h2-75fb/cc', manufacturingSpecs: { productType: 'Finial', collections: ['simple elegance'] } },
    { id: 'B', itemId: 'H1-138R/P14', manufacturingSpecs: { productType: 'Pole / Rod' } },
    { id: 'C', legacyErpId: 'H1-138BS', manufacturingSpecs: { productType: 'Bracket', customData: { bracketType: 'inside mount', collection: 'H1' } } },
    { id: 'D', legacyErpId: 'H1-138BP-R', productType: 'Back Plate', netSuiteInternalId: '901' },
    { id: 'E', legacyErpId: 'H1-RNG/P', customData: { category: 'Ring' } },
    { id: 'F', legacyErpId: 'H1-RODENT-1', manufacturingSpecs: { productType: 'Rodent guard' } },
    { id: 'G', legacyErpId: 'H1-POLES-SET', manufacturingSpecs: { productType: 'Display poles' } },
    { id: 'H', legacyErpId: 'H1-CUT', manufacturingSpecs: { productType: 'Fee', customData: { bracketMount: 'Inside' } } },
    { id: 'I', legacyErpId: '', itemId: '', manufacturingSpecs: {} },
    { id: 'J', legacyErpId: 'H1-2TRV', manufacturingSpecs: { productType: 'Traverse Rod' } },
];
items.forEach((it) => eq(`what item ${it.id} is: tab 7's reading, field for field`,
    [catOf(it), erpOf(it), nsIdOf(it), collectionsOf(it), isInsideMount(it), finishCodeOf(it), isFinished(it)],
    [R.catOf(it), R.erpOf(it), R.nsIdOf(it), R.collectionsOf(it), R.isInsideMount(it), R.finishCodeOf(it), R.isFinished(it)]));
['', 'Pole', 'POLE / ROD', 'Rods', 'curtain rod', 'Bracket', 'BACK PLATE', 'Finial', 'Ring', 'Rodent', 'Polestar', null].forEach((pt) => eq(`classifyCat("${pt}") is tab 7's`, classifyCat(pt), R.classifyCat(pt)));
['ROUND|1.375', 'ROUND|NOPE', '', 'X|Y'].forEach((c) => eq(`diaCellLabel("${c}") is tab 7's`, diaCellLabel(c), R.diaCellLabel(c)));
const drifted = items.filter((it) => R.catOf(it) !== PORTAL_OLD_catOf(it)).map((it) => it.id);
eq('…and the portal\'s old mirror drifted on exactly these (an item categorised by customData.category; a "contains ROD" pole that is no pole)', drifted, ['E', 'F']);

// ── 2. ONE PRICE ──
const finishes = [{ code: 'P14', name: 'Aged Champagne' }, { code: 'EP3', name: 'Satin Nickel', outsourced: true, vendor: 'PLATER' }, { code: 'S04', name: 'Natural' }];
const outsourced = finishes.filter((f) => f.outsourced);
const lib = [
    { id: 'P1', legacyErpId: 'H1-138R/P14', partClass: 'Inventory', manufacturingSpecs: { basePrice: 12, fabricut: { cost: 8, wholesale: 16, retail: 24, paintedCost: 9, platedCost: 11 } }, clientPricing: [{ customerId: 'FABRICUT', price: 7.5, clientSku: 'F100' }] },
    { id: 'P2', legacyErpId: 'H1-138BS/P14', partClass: 'Inventory', manufacturingSpecs: { basePrice: 20 } },
    { id: 'P3', legacyErpId: 'H1-138BS', partClass: 'Inventory', manufacturingSpecs: { basePrice: 18, fabricut: { cost: 10, platedCost: 14 } } },
    { id: 'P4', legacyErpId: 'H1-138BS/EP3', partClass: 'Inventory', manufacturingSpecs: {} },
    { id: 'P5', legacyErpId: 'HTSLNTCAR', partClass: 'Inventory', manufacturingSpecs: { basePrice: 3.75, fabricut: { cost: 0.5 } }, clientPricing: [{ customerId: 'CUST-OTHER', price: 2 }] },
];
const findByCode = (c) => lib.find((x) => R.erpOf(x) === String(c || '').trim().toUpperCase()) || null;
const customers = [null, { id: 'CUST-4720', name: 'FABRICUT' }, { id: 'CUST-OTHER', name: 'Other Co' }, { id: 'CUST-W', name: 'Wholesale Co', defaultPriceLevel: 'fab_wholesale' }];
customers.forEach((customer, ci) => {
    const customerId = customer ? customer.id : '';
    // tab 7's priceCtx / priceOf / rateFor, verbatim
    const lvl = customerPriceLevel(customer, 'STANDARD');
    const refCtx = { customerId, customer: customer || null, priceLevel: lvl.level, levelIsDefault: lvl.isDefault, outsourceCodes: outsourced, findByCode };
    const refPriceOf = (it, finishCode = '') => (it ? priceChoice({ partId: it.id }, it, finishCode ? { ...refCtx, finishCode } : refCtx) : null);
    const refRateFor = (it, finishCode = '') => (it ? (refPriceOf(it, finishCode).price || 0) : 0);
    const ctx = quickShipPriceCtxOf({ customerId, customer, outsourceCodes: outsourced, findByCode });
    eq(`customer #${ci}: the price context is tab 7's`, JSON.stringify({ ...ctx, findByCode: null }), JSON.stringify({ ...refCtx, findByCode: null }));
    lib.forEach((it) => ['', 'P14', 'EP3'].forEach((fin) => eq(`customer #${ci} · ${it.legacyErpId}${fin ? ` in ${fin}` : ''}: the same price, source and alias as tab 7`,
        [quickShipRateOf(ctx, it, fin), JSON.stringify(quickShipPriceOf(ctx, it, fin))], [refRateFor(it, fin), JSON.stringify(refPriceOf(it, fin))])));
});
eq('nothing priced is no price', [quickShipRateOf({}, null), quickShipPriceOf({}, null)], [0, null]);

// ── 3. THE TRAVERSE KIT SALE ──
const kit = (id, code, align, more = {}) => ({ id, legacyErpId: code, itemName: `System ${code}`, partClass: 'Kit',
    manufacturingSpecs: { kitFamily: more.family || 'H1-2TRV', kitAlign: { frontRail: 'TRACK', material: 'P', minFeet: 4, ...align }, ...(more.specs || {}) },
    clientPricing: more.rows || [{ customerId: 'FABRICUT', clientSku: `HTS${code.length}${code.charCodeAt(code.length - 1)}`, price: 150, perFootPrice: 22 }] });
const KITS = [
    kit('K1', 'H1-2TRV-4M/P', { setup: 'SINGLE', drive: 'MOTORIZED', mount: 'WALL' }, { specs: { kitMotorCodes: [{ code: 'H1-2TRV-4M/P-35W', fabSku: 'HM35W', motorItem: 'HSOM-21', net: '1050' }, { code: 'H1-2TRV-4M/P-60W', fabSku: '', motorItem: 'HSOM-20', net: 'x' }] } }),
    kit('K2', 'H1-2TRV-4D/EP', { setup: 'DOUBLE', drive: 'MANUAL', mount: 'WALL', material: 'EP' }),
    kit('K3', 'H1-2TRV-4/P', { setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL' }, { specs: { kitFinishOptions: ['p14', 'S04'] } }),
    kit('K4', 'H1-2TRV-4C/W', { setup: 'SINGLE', drive: 'MANUAL', mount: 'CEILING', material: 'W' }),
    kit('K5', 'H1-2TRV-4DR/P', { setup: 'DOUBLE', drive: 'MANUAL', mount: 'WALL', frontRail: 'RING' }),
    kit('K6', 'H1-138TRV-4V/P', { setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', bracketStyle: 'V', rodKind: 'TRAVERSE', minFeet: 6 }, { family: 'H1-138TRV' }),
    kit('K7', 'H1-2TRV-4X/P', { setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL' }, { rows: [{ customerId: 'CUST-OTHER', price: 1 }] }),
    { id: 'K8', legacyErpId: 'H1-2TRV-NOALIGN', partClass: 'Kit', manufacturingSpecs: {}, clientPricing: [{ customerId: 'FABRICUT', price: 1 }] },
    { id: 'K9', legacyErpId: 'H1-2TRV-INV', partClass: 'Inventory', manufacturingSpecs: { kitAlign: { setup: 'SINGLE' } }, clientPricing: [{ customerId: 'FABRICUT', price: 1 }] },
];
const fab = { id: 'CUST-4720', name: 'FABRICUT' };
const custKeys = customerKeys(fab.id, fab);
const rowOf = (it) => findClientPriceRow(it?.clientPricing, custKeys) || null;
// tab 7's trvKits / trvResolve / trvFinishOptions / trvIsSingle / trvProjOptions / addTraverse / applyTrvComponents, verbatim
const refKits = (allItems) => { const rank = (k) => { const a = k.manufacturingSpecs.kitAlign; const drive = String(a.drive).toUpperCase() === 'MOTORIZED' ? 1 : 0; const mount = String(a.mount).toUpperCase() === 'CEILING' ? 1 : 0; const setup = String(a.setup).toUpperCase() !== 'DOUBLE' ? 0 : (String(a.frontRail).toUpperCase() === 'RING' ? 2 : 1); const mat = { P: 0, EP: 1, W: 2 }[String(a.material).toUpperCase()] ?? 3; return drive * 1000 + mount * 100 + setup * 10 + mat; }; return allItems.filter(p => p.partClass === 'Kit' && p.manufacturingSpecs?.kitAlign && rowOf(p)).sort((x, y) => rank(x) - rank(y)); };
const refResolve = (trvKits, code) => { const c = String(code || '').trim().toUpperCase(); const bySku = trvKits.find(k => { const r = rowOf(k); return r && String(r.clientSku || '').trim().toUpperCase() === c; }) || trvKits.find(k => (k.manufacturingSpecs.kitMotorCodes || []).some(x => String(x.fabSku || '').trim().toUpperCase() === c)); if (bySku) { const mc = (bySku.manufacturingSpecs.kitMotorCodes || []).find(x => String(x.fabSku || '').trim().toUpperCase() === c); return { kitId: bySku.id, motor: mc?.motorItem || '' }; } const r = resolveKitCode(trvKits, c); return r ? { kitId: r.kit.id, motor: r.motorItem || '' } : null; };
const refFinishes = (trvKit, finishList) => { const allowed = (trvKit?.manufacturingSpecs?.kitFinishOptions || []).map(c => String(c).toUpperCase()); if (allowed.length) return finishList.filter(f => allowed.includes(f.code)); const mat = String(trvKit?.manufacturingSpecs?.kitAlign?.material || '').toUpperCase(); if (!mat) return []; if (mat === 'EP') return finishList.filter(f => f.outsourced); if (mat === 'W') return finishList.filter(f => /^S/.test(f.code)); return finishList.filter(f => !f.outsourced && /^P/.test(f.code)); };
const refIsSingle = (trvKit) => !!trvKit && String(trvKit.manufacturingSpecs?.kitAlign?.setup || '').toUpperCase() !== 'DOUBLE';
const refProj = (trvKit) => (refIsSingle(trvKit) ? singleProjections(trvKit?.manufacturingSpecs?.kitFamily || 'H1-2TRV', trvKit?.manufacturingSpecs?.kitAlign?.bracketStyle || '') : []);
const refAdd = ({ trvKit, trvFinish, trvProj, trvMotor, trvFeet }) => {
    if (!trvKit) return { alert: "Pick a kit (or paste one of the customer's kit codes)." };
    if (!trvFinish) return { alert: 'Pick the finish — the shop cannot build "painted" without knowing WHICH paint.' };
    const trvIsSingle = refIsSingle(trvKit);
    if (trvIsSingle && !trvProj) return { alert: 'Pick the projection — a single sells at three depths and each one is a different bracket.' };
    const row = rowOf(trvKit); const align = trvKit.manufacturingSpecs.kitAlign; const feet = Math.max(parseInt(trvFeet) || 4, 1); const billFeet = Math.max(feet, align.minFeet || 4);
    const mc = String(align.drive).toUpperCase() === 'MOTORIZED' && trvMotor ? (trvKit.manufacturingSpecs.kitMotorCodes || []).find(x => String(x.motorItem).toUpperCase() === trvMotor.toUpperCase()) : null;
    const theirSku = mc?.fabSku || row?.clientSku || ''; const mcNet = mc && Number.isFinite(parseFloat(mc.net)) ? parseFloat(mc.net) : null;
    const cart = [{ itemId: trvKit.id, erp: mc?.code || trvKit.legacyErpId, nsId: '', name: trvKit.itemName || trvKit.legacyErpId, aliasErp: theirSku, aliasItemId: null,
        qty: 1, note: `${feet}ft system — 4ft set${feet < billFeet ? ' (min charge)' : ''} · ${trvFinish}${trvProj ? ` · ${projLabel(trvProj)}` : ''}${mc ? ` · ${trvMotor}` : ''}`, bin: '', packUom: '', packSize: 1,
        rateOverride: mcNet, kitKey: null, kitName: null, kitBrand: null, kitFinish: '', trvFinish, trvProj, trvMotor: mc ? trvMotor : '', trvFeet: billFeet, trvKitCode: mc?.code || trvKit.legacyErpId }];
    const extra = billFeet - (align.minFeet || 4); const perFoot = parseFloat(row?.perFootPrice);
    if (extra > 0) cart.push({ itemId: trvKit.id, erp: mc?.code || trvKit.legacyErpId, nsId: '', name: trvKit.itemName || trvKit.legacyErpId, aliasErp: theirSku, aliasItemId: null, qty: extra, note: `Additional foot · ${trvFinish}`, bin: '', packUom: '', packSize: 1,
        rateOverride: Number.isFinite(perFoot) ? perFoot : 0, kitKey: null, kitName: null, kitBrand: null, kitFinish: '', trvFinish, trvProj, trvKitCode: mc?.code || trvKit.legacyErpId, trvIsFeet: true });
    const cfg = { drive: String(align.drive).toUpperCase(), feet: billFeet, kitCode: mc?.code || trvKit.legacyErpId, finish: trvFinish, trackCount: String(align.setup).toUpperCase() === 'DOUBLE' && String(align.frontRail).toUpperCase() !== 'RING' ? 2 : 1 };
    return { cart, cfg };
};
const refApply = (cfgLines, trvCfg, allItems) => { const byCode = (c) => allItems.find(x => String(x.legacyErpId || x.itemId || '').toUpperCase() === String(c).toUpperCase()); let missing = 0; const out = []; cfgLines.forEach(cl => { const it = byCode(cl.code); if (!it) { missing++; return; } const row = findClientPriceRow(it.clientPricing, custKeys); out.push([it.id, cl.qty, `${cl.why}${trvCfg?.finish ? ` · ${trvCfg.finish}` : ''} [${trvCfg?.kitCode || 'traverse'}]`, null, { noPack: true, rateOverride: cl.billable ? cl.rate : 0, aliasErp: row?.clientSku || '', trvOfKit: trvCfg?.kitCode || 'traverse' }]); }); return { out, missing }; };

eq('the kits a customer may buy are tab 7\'s list, in tab 7\'s order', traverseKitsOf(KITS, rowOf).map((k) => k.id), refKits(KITS).map((k) => k.id));
eq('…aligned kits priced for this customer only (no other customer\'s, no unaligned, no non-kit): manual singles, doubles, ceiling, then motorised', traverseKitsOf(KITS, rowOf).map((k) => k.id), ['K3', 'K6', 'K2', 'K5', 'K4', 'K1']);
const kits = traverseKitsOf(KITS, rowOf);
['h1-2trv-4m/p', 'H1-2TRV-4M/P-35W', 'HM35W', 'h1-2trv-4m/p-60w', rowOf(KITS[2]).clientSku, 'H1-2TRV-4D/EP', 'NOPE', '', 'H1-2TRV-4C/W'].forEach((code) => {
    const got = traverseKitByCode(kits, code, rowOf);
    eq(`the code "${code}" finds tab 7's kit and motor`, got ? { kitId: got.kit.id, motor: got.motorItem } : null, refResolve(kits, code));
});
KITS.forEach((k) => eq(`${k.legacyErpId}: its finishes, single-or-not, projections and chart are tab 7's`, [traverseKitFinishesOf(k, finishes).map((f) => f.code), traverseKitIsSingle(k), traverseKitProjectionsOf(k)], [refFinishes(k, finishes).map((f) => f.code), refIsSingle(k), refProj(k)]));
eq('a kit\'s chart family (H1-2TRV where none is named)', [traverseKitFamilyOf(KITS[5]), traverseKitFamilyOf({ manufacturingSpecs: {} })], ['H1-138TRV', 'H1-2TRV']);
let lines = 0;
[null, ...kits].forEach((k) => ['', 'P14', 'EP3'].forEach((fin) => ['', '3.625', '4.625', '6'].forEach((proj) => ['', 'HSOM-21', 'HSOM-20', 'hsom-21'].forEach((motor) => ['', '2', '4', '9', '13'].forEach((feet) => {
    const ref = refAdd({ trvKit: k, trvFinish: fin, trvProj: proj, trvMotor: motor, trvFeet: feet });
    const got = traverseKitLinesOf({ kit: k, row: rowOf(k), finish: fin, proj, motorItem: motor, feet });
    if (ref.alert) { eq('…refused with tab 7\'s words', got.error, ref.alert); return; }
    lines++;
    eq(`${k.legacyErpId} ${fin} ${proj || '—'} ${motor || '—'} ${feet || '—'} ft: tab 7's kit line, feet line and components set-up`, [got.kitLine, got.feetLine, got.cfg], [ref.cart[0], ref.cart[1] || null, ref.cfg]);
})))));
eq(`…${lines} sales compared (not vacuous)`, lines > 200, true);
// the components, as tab 7 writes them
const comps = [{ id: 'C1', legacyErpId: 'HTSLNTCAR', clientPricing: [{ customerId: 'FABRICUT', clientSku: 'H9559F', price: 0.5 }] }, { id: 'C2', legacyErpId: 'HTTENDSTOP' }, { id: 'C3', legacyErpId: 'WAND-36', clientPricing: [{ customerId: 'CUST-OTHER', clientSku: 'X' }] }];
const RULES = { usage: [{ label: 'Pinch Pleat Carriers', itemId: 'HTSLNTCAR', byFeet: { 4: 16, 8: 32, 12: 48 } }, { label: 'Splice', itemId: 'H1-2TRVSPL', byFeet: { 12: 1 } }],
    configurator: [{ itemId: 'HTTENDSTOP', drive: 'BOTH', billable: false }, { itemId: 'H1-2TRVSPL', drive: 'BOTH', billable: false }, { itemId: 'WAND-36', drive: 'MANUAL', billable: true }, { itemId: 'MISSING-1', drive: 'BOTH', billable: true }] };
const priceOf = (id) => ({ HTSLNTCAR: 0.5, 'WAND-36': 11, 'H1-2TRVSPL': 18, 'MISSING-1': 4 }[id] || 0);
[{ carrierStyle: 'HTSLNTCAR', carrierQty: '', picks: { HTTENDSTOP: 2 }, accessories: {} }, { carrierStyle: 'HTSLNTCAR', carrierQty: '40', picks: { HTTENDSTOP: 4, 'H1-2TRVSPL': 2 }, accessories: { 'WAND-36': 2, 'MISSING-1': 1 } }].forEach((sel, si) => {
    const add = refAdd({ trvKit: kits.find((k) => k.id === 'K3'), trvFinish: 'P14', trvProj: '4.625', trvMotor: '', trvFeet: '8' });
    const cfgLines = configuratorLines({ rules: RULES, drive: add.cfg.drive, feet: add.cfg.feet, sel, priceOf });
    const ref = refApply(cfgLines, add.cfg, comps);
    const got = traverseComponentLinesOf({ cfgLines, findItem: (c) => comps.find((x) => String(x.legacyErpId || x.itemId || '').toUpperCase() === String(c).toUpperCase()), rowOf, cfg: add.cfg });
    eq(`components #${si}: tab 7's lines (item, qty, note, push options) and the codes the library does not hold`, [got.lines.map((l) => [l.item.id, l.qty, l.note, null, l.opts]), got.missing], [ref.out, ref.missing]);
});
// a portal kit order rebuilt: the same lines, refused only for what tab 7 would not sell
{
    const opts = { kits, rowOf, finishList: finishes, rulesOf: (fam) => (fam === 'H1-2TRV' ? RULES : null), findItem: (c) => comps.find((x) => String(x.legacyErpId || x.itemId || '').toUpperCase() === String(c).toUpperCase()), priceOf };
    const sel = { carrierStyle: 'HTSLNTCAR', carrierQty: '', draw: 'CENTER', motorSide: '', picks: defaultPicks({ rules: RULES, drive: 'MANUAL', feet: 8, trackCount: 1 }), accessories: { 'WAND-36': 1 } };
    const o = traverseKitOrderOf({ kitId: 'K3', finish: 'p14', proj: 4.625, motorItem: '', feet: '8', sel }, opts);
    const ref = refAdd({ trvKit: kits.find((k) => k.id === 'K3'), trvFinish: 'P14', trvProj: '4.625', trvMotor: '', trvFeet: '8' });
    eq('a portal kit order rebuilds tab 7\'s kit line, feet line and set-up (the finish and depth as tab 7\'s own selects hold them)', [o.kitLine, o.feetLine, o.cfg], [ref.cart[0], ref.cart[1], ref.cfg]);
    eq('…and its components through the kit\'s own chart', [o.cfgLines, o.components.length], [configuratorLines({ rules: RULES, drive: 'MANUAL', feet: 8, sel, priceOf }), o.cfgLines.length - o.missing]);
    const m = traverseKitOrderOf({ kitId: 'K1', finish: 'P14', proj: '6', motorItem: 'hsom-21', feet: '4' }, opts);
    eq('a motorised kit takes its motor in the kit\'s own spelling — the line is their per-motor code at its net', [m.kitLine.erp, m.kitLine.aliasErp, m.kitLine.rateOverride, m.kitLine.trvMotor, m.cfgLines], ['H1-2TRV-4M/P-35W', 'HM35W', 1050, 'HSOM-21', []]);
    const bad = [{ kitId: 'K7', finish: 'P14', proj: '6' }, { kitId: 'K3', finish: 'EP3', proj: '6' }, { kitId: 'K3', finish: 'P14', proj: '5' }, { kitId: 'K1', finish: 'P14', proj: '6', motorItem: 'HSOM-99' }].map((e) => traverseKitOrderOf(e, opts).error || '');
    eq('…refused, in words, for a kit this account cannot order, a finish it is not sold in, a depth nobody sells and a motor it does not take', bad.map((b) => !!b), [true, true, true, true]);
    eq('…a double needs no projection; its chart is two tracks', [traverseKitOrderOf({ kitId: 'K2', finish: 'EP3', feet: '6' }, opts).cfg, traverseKitOrderOf({ kitId: 'K5', finish: 'P14', feet: '6' }, opts).cfg.trackCount], [{ drive: 'MANUAL', feet: 6, kitCode: 'H1-2TRV-4D/EP', finish: 'EP3', trackCount: 2 }, 1]);
}

console.log(`quickShipShared: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
