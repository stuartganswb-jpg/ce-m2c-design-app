// node scripts/nsItemLookup.test.mjs — a stick is read live from NetSuite: id, type, product type (Stuart 2026-09-26).
import { activeItemByNameQuery, activeItemByNameQueryLite, cutRecordOf, isStockItemType } from '../src/components/Shared/nsItemLookup.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };

const q = activeItemByNameQuery(" hwmmp635/bl ");
eq('the query asks NetSuite for the id, the item type and the Product Type droplist, by upper-cased name', [q.includes('item.id AS id'), q.includes('item.itemtype AS itemtype'), q.includes("BUILTIN.DF(item.custitem_bit_product_type) AS product_type"), q.includes("UPPER(item.itemid) = 'HWMMP635/BL'")], [true, true, true, true]);
eq('…active items only, oldest first', [q.includes("NVL(item.isinactive, 'F') = 'F'"), q.endsWith('ORDER BY item.id')], [true, true]);
eq("a quote in the name is escaped, never injected", activeItemByNameQuery("H1-1R'X").includes("'H1-1R''X'"), true);
eq('the lite query drops only the product-type column', [activeItemByNameQueryLite('X').includes('product_type'), activeItemByNameQueryLite('X').includes("isinactive, 'F') = 'F'")], [false, true]);
eq('a row shapes into the cut record both benches plan with', cutRecordOf({ id: 58248, itemtype: 'InvtPart', product_type: 'Poles' }, ' hwmmp635/bl '), { code: 'HWMMP635/BL', internalId: '58248', type: 'InvtPart', productType: 'Poles', live: true });
eq('a row without an id is nothing', [cutRecordOf(null, 'X'), cutRecordOf({}, 'X'), cutRecordOf({ id: '' }, 'X')], [null, null, null]);
eq('a missing product type reads as empty, not undefined', cutRecordOf({ id: 1 }, 'X').productType, '');
eq('stock-holding item types', [isStockItemType('InvtPart'), isStockItemType('Assembly'), isStockItemType('Service'), isStockItemType('Description'), isStockItemType('')], [true, true, false, false, false]);

console.log(`nsItemLookup: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
