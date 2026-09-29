// A shop order finds its routing by its item CODE too (Stuart 2026-09-29, H2-138-TB3 / TB4).   node scripts/routingMatch.test.mjs
import { routingForOrder } from '../src/components/ShopFloor/routingMatch.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// The six live routings (2026-09-29): filed under the library id, displayed as the item code.
const routings = [
    { partId: 'CE-ASM-64044', displayName: 'H2-138-TB3', ops: [1, 2, 3] },
    { partId: 'CE-ASM-65640', displayName: 'H2-138-TB4', ops: [1, 2, 3, 4] },
    { partId: 'CE-INV-54829', displayName: 'H1-75BP-V', ops: [1] },
    { partId: 'CE-INV-56672', displayName: 'H1-1PS', ops: [1, 2, 3] },
    { partId: 'CE-INV-57731', displayName: 'H1-138STDOFF-14G', ops: [1] },
    { partId: 'M2C-INV-3921', displayName: 'M2C-INV-3921', ops: [1, 2] },
];
const pick = (o) => (routingForOrder(routings, o) || {}).partId || null;

// the two stuck orders, as they sit in shop_custom_orders
eq('H2-138-TB3 (code on the order, description in item) finds CE-ASM-64044', pick({ item: 'Upper Slotted Arm for 1-3/8" Traverse Wall Bracket', partNum: 'H2-138-TB3', itemCode: 'H2-138-TB3' }), 'CE-ASM-64044');
eq('H2-138-TB4 finds CE-ASM-65640', pick({ item: 'Lower L Base for 1-3/8" Traverse 2-Part Wall Bracket', partNum: 'H2-138-TB4', itemCode: 'H2-138-TB4' }), 'CE-ASM-65640');
eq('the code is matched whatever its case or spacing', pick({ item: 'x', itemCode: ' h2-138-tb3 ' }), 'CE-ASM-64044');
eq('an order that already names the routing id still does', pick({ item: 'x', partNum: 'CE-INV-56672' }), 'CE-INV-56672');
// the checks it always made come first, unchanged
eq('item = displayName (the old rule)', pick({ item: 'H1-1PS' }), 'CE-INV-56672');
eq('item = partId (the old rule)', pick({ item: 'M2C-INV-3921' }), 'M2C-INV-3921');
// what has no routing still has none — the 8/18 JTREE / oval disc orders
eq('no routing for JTREE-TOP', pick({ item: 'Jewelry tree top', partNum: 'JTREE-TOP', itemCode: 'JTREE-TOP' }), null);
eq('no routing for 74X31WD/RWN', pick({ item: '74" x 31" x 0.75" Oval Wood Disc - Raw Walnut', partNum: '74X31WD/RWN' }), null);
// never a guess
eq('two routings displaying one code → none', routingForOrder([...routings, { partId: 'CE-ASM-99999', displayName: 'H2-138-TB3' }], { item: 'x', itemCode: 'H2-138-TB3' }), null);
eq('no order / no routings → none', [routingForOrder(routings, null), routingForOrder([], { itemCode: 'H2-138-TB3' })], [null, null]);

console.log(`routingMatch: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
