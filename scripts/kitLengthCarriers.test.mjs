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
console.log(`kitLengthCarriers: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
