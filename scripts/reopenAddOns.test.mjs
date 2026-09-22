// A reopened quote brings its own checkout add-ons back (Stuart 2026-09-17).   node scripts/reopenAddOns.test.mjs
import { savedAddOnSelOf, quoteDoorOf, wrongDoorReason, approveDoorReason, isOrderEntryOrder } from '../src/components/Shared/reopenQuote.js';
let pass = 0, fail = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) { pass++; return; } fail++; console.log(`✗ ${n} — got ${JSON.stringify(a)}`); };
const job = { cpqData: { breakdown: [
    { name: 'H1-1 [Row 1]', partId: 'CE-ASM-1', qty: 50 },                                   // a configured line — never an add-on
    { name: 'Add-ons & Fees', isHeader: true, partId: null },
    { name: '  - WALNUT TABLE TOP BASE', partId: 'CE-INV-900', qty: 50, isAddOn: true, isFee: false },
    { name: '  - Rush', partId: 'CE-FEE-7', qty: 1, isAddOn: true, isFee: true },              // a % fee saves as qty 1 → ON
] }, portalRequest: { addOns: [{ id: 'CE-INV-111', qty: 2 }] } };
eq('the quote\'s own add-ons come back, by part and quantity', savedAddOnSelOf(job), { 'CE-INV-900': 50, 'CE-FEE-7': 1 });
eq('saved add-ons win over the portal request', 'CE-INV-111' in savedAddOnSelOf(job), false);
eq('a quote with none falls back to the portal picks', savedAddOnSelOf({ cpqData: { breakdown: [] }, portalRequest: { addOns: [{ id: 'A', qty: 3 }, { id: 'B', mode: 'PERCENT' }, { qty: 9 }] } }), { A: 3, B: true });
eq('nothing saved, nothing asked → empty', savedAddOnSelOf({}), {});
eq('null job is safe', savedAddOnSelOf(null), {});
// THE WRONG-DOOR GUARD (Stuart 2026-09-20): a quote says where it was made, and each door reads that first.
{
    const cpq = { quoteNo: 'QUO158', cpqData: { cartItems: [{ id: 1 }, { id: 2 }] } };
    const oe = { quoteNo: 'QUO160', source: 'QUICKSHIP', quickShipCart: [{ erp: 'X' }] };
    const old = { jobId: 'J-OLD' };
    eq('a CPQ quote knows its door', [quoteDoorOf(cpq), quoteDoorOf(oe), quoteDoorOf(old)], ['CPQ', 'ORDER_ENTRY', '']);
    eq('CPQ quote: CPQ and Vision open, Order Entry refuses', [!!wrongDoorReason(cpq, 'CPQ'), !!wrongDoorReason(cpq, 'VISION'), !!wrongDoorReason(cpq, 'ORDER_ENTRY')], [false, false, true]);
    eq('…and says it does NOT need rebuilding', /does NOT need rebuilding/.test(wrongDoorReason(cpq, 'ORDER_ENTRY')) && /QUO158/.test(wrongDoorReason(cpq, 'ORDER_ENTRY')), true);
    eq('Order Entry quote: only Order Entry opens — Vision included (the door that had no guard)', [!!wrongDoorReason(oe, 'CPQ'), !!wrongDoorReason(oe, 'VISION'), !!wrongDoorReason(oe, 'ORDER_ENTRY')], [true, true, false]);
    eq('a quote too old to say is left to each door\'s own words', [wrongDoorReason(old, 'CPQ'), wrongDoorReason(old, 'ORDER_ENTRY')], ['', '']);
    // THE CRM'S APPROVE READS THE DOOR TOO (Stuart 2026-09-23, SO60586: an Order Entry quote approved
    // from the CRM became a CPQ-shaped order that RTG split whole from the printed quote).
    eq('CPQ quote: Approve is its door', approveDoorReason(cpq), '');
    eq('Order Entry quote: Approve refuses and says where to go', /QUO160/.test(approveDoorReason(oe)) && /Reopen Order Entry/.test(approveDoorReason(oe)), true);
    eq('a quote too old to say is not refused', approveDoorReason(old), '');
    // IS THIS SALES ORDER AN ORDER ENTRY ORDER? — the whole-order split's guard, four shapes.
    eq('a tab-7 order (orderClass QUICKSHIP, lines[], no job)', isOrderEntryOrder({ orderClass: 'QUICKSHIP', lines: [{ erp: 'X' }] }), true);
    eq('a CRM-approved Order Entry quote (CPQ-shaped, QSQUOTE job, no lines) — SO60586', isOrderEntryOrder({ source: 'CRM', type: 'Custom', hqJobId: 'QSQUOTE-1789903760164' }), true);
    eq('…and by the job itself when the caller has read it', isOrderEntryOrder({ source: 'CRM', hqJobId: 'J-1' }, oe), true);
    eq('a CPQ order', isOrderEntryOrder({ source: 'CPQ', hqJobId: 'QUO158' }, cpq), false);
    eq('a CPQ order that carries lines (a display released by rows) is still CPQ', isOrderEntryOrder({ source: 'CPQ', hqJobId: 'QUO158', displayRelease: true, lines: [{ erp: 'X' }] }), false);
}
console.log(`reopenAddOns: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
