// Fulfillment lines carry the sales order line's own location.   node scripts/fulfilmentLines.test.mjs
import { soLinesSql, fulfilmentItemsOf, refusalText } from '../src/components/Shared/fulfilmentLines.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

const row = (o) => ({ line: '1', item: 'H1-138/P', itemtype: 'InvtPart', location: '17', locationname: 'CE - HP', qty: 2, shipped: 0, isclosed: 'F', ...o });

// SQL
ok('sql reads the SO lines', soLinesSql('12345').includes('tl.transaction = 12345'));
ok('sql excludes mainline', soLinesSql(12345).includes("tl.mainline = 'F'"));
let threw = false; try { soLinesSql('12 OR 1=1'); } catch (e) { threw = true; }
ok('sql refuses a non-numeric id', threw);

// one location per line, copied
eq('two lines, two locations', fulfilmentItemsOf([row({ line: '1', location: '17' }), row({ line: '3', location: '19', itemtype: 'Assembly' })]).items,
  [{ orderLine: 1, location: { id: '17' }, itemReceive: true }, { orderLine: 3, location: { id: '19' }, itemReceive: true }]);

// skipped lines
eq('service / discount / subtotal lines are not sent', fulfilmentItemsOf([row({}), row({ line: '2', itemtype: 'Service', location: '' }), row({ line: '4', itemtype: 'Discount', location: '' }), row({ line: '5', itemtype: 'Subtotal', location: '' })]).items.map((i) => i.orderLine), [1]);
eq('fully shipped line is not sent', fulfilmentItemsOf([row({}), row({ line: '2', qty: 3, shipped: 3 })]).items.map((i) => i.orderLine), [1]);
eq('closed line is not sent', fulfilmentItemsOf([row({}), row({ line: '2', isclosed: 'T' })]).items.map((i) => i.orderLine), [1]);
eq('non-inventory with a location ships', fulfilmentItemsOf([row({}), row({ line: '6', itemtype: 'NonInvtPart', location: '17' })]).items.map((i) => i.orderLine), [1, 6]);
eq('non-inventory without a location does not block', fulfilmentItemsOf([row({}), row({ line: '6', itemtype: 'NonInvtPart', location: '' })]).ok, true);

// refusals — never a guess
const miss = fulfilmentItemsOf([row({}), row({ line: '2', item: 'HCUMB410/CP', location: '' }), row({ line: '7', itemtype: 'Kit', item: 'KIT-A', location: null })]);
eq('inventory line without location refuses', miss.ok, false);
eq('refusal names every such line', miss.missing, [{ line: '2', item: 'HCUMB410/CP' }, { line: '7', item: 'KIT-A' }]);
ok('refusal text names line 2', refusalText(miss).includes('line 2 — HCUMB410/CP'));
eq('closed line without location does not refuse', fulfilmentItemsOf([row({}), row({ line: '2', location: '', isclosed: 'T' })]).ok, true);
eq('nothing open', fulfilmentItemsOf([row({ shipped: 2 })]).reason, 'NOTHING_OPEN_TO_FULFIL');
eq('no rows', fulfilmentItemsOf([]).reason, 'NO_LINES_READ');
eq('garbage input', fulfilmentItemsOf(undefined).reason, 'NO_LINES_READ');
eq('lines echo for the log', fulfilmentItemsOf([row({ locationname: 'CE - HP' })]).lines, [{ line: '1', item: 'H1-138/P', location: '17', locationName: 'CE - HP' }]);
eq('ok result has no refusal text', refusalText(fulfilmentItemsOf([row({})])), '');

console.log(`fulfilmentLines: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
