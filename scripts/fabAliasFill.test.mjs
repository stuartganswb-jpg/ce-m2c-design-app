// 🧪 Fabricut's number and prices into Customer Alias & Pricing (Stuart 2026-10-18).   node scripts/fabAliasFill.test.mjs
import { aliasFillOf, aliasFillPlanOf, isFabricutCustomer, rowOfCustomer, isKitRecord } from '../src/components/Shared/fabAliasFill.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));
const FAB = 'CUST-4720';
const row = (o) => ({ customerId: FAB, customerName: 'FABRICUT', source: 'KIT_IMPORT', ...o });
// HSOM-19 as it stood 10-18: the Fabricut row (H9542F, cost 78, sales 130, retail 260), no box
const hsom19 = { id: 'CE-INV-48949', legacyErpId: 'HSOM-19', itemName: 'Somfy Situo 5 RTS II', clientPricing: [row({ clientSku: 'H9542F', price: 78, clientSalesPrice: 130, clientRetailPrice: 260 })], manufacturingSpecs: {} };
const f = aliasFillOf({ part: hsom19, row: hsom19.clientPricing[0], at: 5, by: 'Stuart' });
eq('HSOM-19: the whole box — pattern #, cost, wholesale, retail', f.patch, { 'manufacturingSpecs.fabricut': { fabCodeBase: 'H9542F', cost: 78, wholesale: 130, retail: 260, source: 'CLIENT_MAPPING', importedAt: 5, importedBy: 'Stuart' } });
eq('…kind NEW', f.kind, 'NEW');
// H1-2TRVSPLC: a box with prices, no number
const splc = { id: 'CE-ASM-58034', legacyErpId: 'H1-2TRVSPLC', clientPricing: [row({ clientSku: 'H9558F', price: 6, clientSalesPrice: 9, clientRetailPrice: 18 })], manufacturingSpecs: { fabricut: { cost: 6, retail: 18 } } };
eq('H1-2TRVSPLC: the number only, the prices left as they are', aliasFillOf({ part: splc, row: splc.clientPricing[0] }).patch, { 'manufacturingSpecs.fabricut.fabCodeBase': 'H9558F' });
// never over a box that has its number
const ok1 = { id: 'X', legacyErpId: 'H1-138WEC-O', clientPricing: [row({ clientSku: 'H5510F', price: 18 })], manufacturingSpecs: { fabricut: { fabCodeBase: 'H5510F', cost: 18 } } };
eq('a box with its number is never touched', aliasFillOf({ part: ok1, row: ok1.clientPricing[0] }), null);
// never a kit
const kit = { id: 'KIT-H1-2TRV-4_P', legacyErpId: 'H1-2TRV-4/P', partClass: 'Kit', clientPricing: [row({ clientSku: 'HTS7504F', price: 203 })] };
ok('a kit record keeps the kit sheet\'s row (Stuart\'s August design)', aliasFillOf({ part: kit, row: kit.clientPricing[0] }) === null && isKitRecord(kit) && isKitRecord({ id: 'KIT-1' }));
const fee = { id: 'FEE-H1-SHIP-L-893438', legacyErpId: 'H1-SHIP-L', partClass: 'Fee', clientPricing: [row({ clientSku: 'H1-SHIP-L', price: 155 })] };
ok('a 4.6 fee keeps its row as its pricing', aliasFillOf({ part: fee, row: fee.clientPricing[0] }) === null && aliasFillOf({ part: { id: 'FEE-X', legacyErpId: 'H1-ROF' }, row: row({ clientSku: 'H1-ROF' }) }) === null);
// a finish variant whose base has tiers inherits them
const arm = { id: 'CE-ASM-64473', legacyErpId: 'H1-2TRVSRA/P', clientPricing: [row({ clientSku: 'H3634F', price: 22 })] };
eq('a variant of a base with tiers is left alone', aliasFillOf({ part: arm, row: arm.clientPricing[0], baseFab: { paintedCost: 22, fabCodePainted: 'H3634F' } }), null);
eq('…but a variant whose base has no box is filled', aliasFillOf({ part: arm, row: arm.clientPricing[0], baseFab: null }).kind, 'NEW');
// a row with nothing on it
eq('a row with no number and no price moves nothing', aliasFillOf({ part: { id: 'T', legacyErpId: 'H1-TTB1', manufacturingSpecs: {} }, row: row({ clientSku: '', price: '' }) }), null);
eq('a price of 0 is a price (an included part)', aliasFillOf({ part: { id: 'Z', legacyErpId: 'HSOM-14' }, row: row({ clientSku: 'H9547F', price: 0 }) }).patch['manufacturingSpecs.fabricut'].cost, 0);
// the plan over a library
const items = [hsom19, splc, ok1, kit, arm, { id: 'B', legacyErpId: 'H1-2TRVSRA', manufacturingSpecs: { fabricut: { paintedCost: 22, fabCodePainted: 'H3634F' } } }, { id: 'O', legacyErpId: 'OTHER', clientPricing: [{ customerId: 'CUST-1', clientSku: 'BR-1', price: 5 }] }];
const plan = aliasFillPlanOf({ items, customerId: FAB, by: 'Stuart', at: 9 });
eq('the plan: HSOM-19 (NEW) and H1-2TRVSPLC (CODE) — not the kit, not the inheriting variant, not another customer\'s row', plan.map(p => [p.code, p.kind]), [['H1-2TRVSPLC', 'CODE'], ['HSOM-19', 'NEW']]);
ok('Fabricut is recognised by name; another customer is not', isFabricutCustomer({ name: 'FABRICUT' }) && isFabricutCustomer({ customerName: 'Fabricut Inc' }) && !isFabricutCustomer({ name: 'Brimar' }));
ok('the customer\'s own row is found by id, whatever the case', rowOfCustomer({ clientPricing: [{ customerId: 'cust-4720', clientSku: 'x' }] }, FAB).clientSku === 'x');
console.log(`fabAliasFill: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
