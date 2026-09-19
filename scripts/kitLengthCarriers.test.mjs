// node scripts/kitLengthCarriers.test.mjs — a kit is BILLED at its size and BUILT at the length ordered
// (Stuart 2026-09-19, QUO155 row 6: an 18" display on the 4 ft kit), and the carriers come from one place.
import { register } from 'node:module';
register('./_lib/extless-hook.mjs', import.meta.url);
const { configuratorOffer, configuratorLines } = await import('../src/components/Shared/traverseConfigurator.js');
const { priceConfiguration } = await import('../src/components/Shared/hardwarePricing.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
// The live chart row, as read from the app: four pinch-pleat carriers a foot.
const byFeet = Object.fromEntries(Array.from({ length: 35 }, (_, i) => [String(i + 2), (i + 2) * 4]));
const rules = { usage: [{ label: 'Pinch Pleat Carriers', itemId: 'HTSLNTCAR', byFeet, fabSku: 'H9559F' }], configurator: [] };
const style = (o) => o.carrierStyles.find(s => s.itemId === 'HTSLNTCAR');
const lines = (realFeet, carrierQty = '') => configuratorLines({ rules, drive: 'MANUAL', feet: Math.max(realFeet || 4, 4), realFeet, sel: { carrierStyle: 'HTSLNTCAR', carrierQty, picks: {}, accessories: {} }, priceOf: () => 0.5 })
    .map(l => [l.qty, l.billable ? l.rate : 0]);

eq('18" on the 4 ft kit: built with the 2 ft count, the 4 ft count is what the price covers',
    [style(configuratorOffer({ rules, drive: 'MANUAL', feet: 4, realFeet: 2 })).defaultQty, style(configuratorOffer({ rules, drive: 'MANUAL', feet: 4, realFeet: 2 })).includedQty], [8, 16]);
eq('…so an untouched 18" order carries 8 carriers at $0', lines(2), [[8, 0]]);
eq('36": 12 carriers at $0', lines(3), [[12, 0]]);
eq('typing up to the kit\'s 16 still bills nothing', lines(2, '16'), [[16, 0]]);
eq('…and only what is above the kit\'s 16 bills', lines(2, '20'), [[16, 0], [4, 0.5]]);
eq('60": billed and built at 5 ft — 20 included', lines(5), [[20, 0]]);
eq('no real length given (tab 7, 4.6): the chart count, as before', style(configuratorOffer({ rules, drive: 'MANUAL', feet: 8 })).defaultQty, 32);

// ONE SOURCE OF CARRIERS: the pinned rider leaves the bill once the components step names the carriers.
const model = { choices: [], bom: [
    { id: 'T', partId: 'TRK', name: 'Track', role: 'TRACK', qty: 1 },
    { id: 'C', partId: 'CAR', name: 'Pinned carrier', role: 'CARRIER', qty: 10 },
] };
const parts = { TRK: { id: 'TRK', legacyErpId: 'H1-2TRV', manufacturingSpecs: {} }, CAR: { id: 'CAR', legacyErpId: 'HTSLNTCAR', manufacturingSpecs: { basePrice: 0.5 } } };
const roles = (ctx) => priceConfiguration(model, { findPart: (id) => parts[id] || null, findByCode: () => null, ...ctx }).lines.map(l => l.role);
eq('no carrier style chosen: the pinned carrier stays on the bill', roles({}), ['TRACK', 'CARRIER']);
eq('a carrier style chosen: the pinned carrier is off the bill', roles({ skipRoles: ['CARRIER'] }), ['TRACK']);

// THE TRACK AND THE F-CLIP ARE CUT SHORTER THAN THE FASCIA (his 08-04 table); the fascia/rod is cut as sold.
{
    const { applyKitPricing } = await import('../src/components/Shared/kitSeed.js');
    const m2 = { choices: [{ id: 'NUT', role: 'FCLIP', ridesWith: 'BRACKET' }], bom: [
        { id: 'F', partId: 'FAS', name: 'Fascia', role: 'FASCIA', qty: 1 },
        { id: 'T', partId: 'TRK', name: 'Track', role: 'TRACK', qty: 1 },
        { id: 'CL', partId: 'CLP', name: 'F-clip', role: 'FCLIP', qty: 1 },
        { id: 'NUT', partId: 'NUT', name: 'Nut', role: 'FCLIP', qty: 2, hidden: true },
        { id: 'C', partId: 'CAR', name: 'Pinned carrier', role: 'CARRIER', qty: 8 },
    ] };
    const p2 = { ...parts, FAS: { id: 'FAS', legacyErpId: 'H1-2RCTWR', manufacturingSpecs: { basePrice: 15 } }, CLP: { id: 'CLP', legacyErpId: 'H1-2TRVCLP', manufacturingSpecs: {} }, NUT: { id: 'NUT', legacyErpId: 'H1-2TRVNUT', manufacturingSpecs: {} } };
    const cuts = (drive) => Object.fromEntries(priceConfiguration(m2, { findPart: (id) => p2[id] || null, findByCode: () => null, billedFeet: 2, lengthInches: 18, drive }).lines.map(l => [l.partId, l.cutLength ?? null]));
    eq('manual: fascia as sold, track −0.5", F-clip −1", the nut and the carrier never cut', cuts('MANUAL'), { FAS: 18, TRK: 17.5, CLP: 17, NUT: null, CAR: null });
    eq('motorised: track −2", F-clip −3"', cuts('MOTORIZED'), { FAS: 18, TRK: 16, CLP: 15, NUT: null, CAR: null });
    eq('no drive answered reads as manual', cuts(undefined).TRK, 17.5);
    const feetOf = priceConfiguration(m2, { findPart: (id) => p2[id] || null, findByCode: () => null, billedFeet: 2, lengthInches: 18, drive: 'MANUAL' }).lines.find(l => l.partId === 'TRK').feet;
    eq('the billed feet do not move with the cut', feetOf, 2);

    // THE KIT COVERS ITS CARRIERS at the chart count for the length billed.
    const priced = priceConfiguration(m2, { findPart: (id) => p2[id] || null, findByCode: () => null, billedFeet: 2, lengthInches: 18 });
    const carrierLine = (cover, qty) => applyKitPricing({ ...priced, lines: priced.lines.map(l => (l.partId === 'CAR' ? { ...l, qty, total: 0.5 * qty } : l)) },
        { kitCode: 'KIT', kitPrice: 195, baseFeet: 4, included: [{ code: 'HTSLNTCAR', partId: 'CAR', qty: cover }] }).lines.find(l => l.partId === 'CAR');
    eq('8 carriers on the 4 ft kit (covers 16): included, $0', [carrierLine(16, 8).total, carrierLine(16, 8).inKit], [0, true]);
    eq('20 carriers on the 4 ft kit: 4 above the 16 bill', carrierLine(16, 20).total, 2);
}
console.log(`kitLengthCarriers: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
