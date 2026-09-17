// A reopened quote brings its own checkout add-ons back (Stuart 2026-09-17).   node scripts/reopenAddOns.test.mjs
import { savedAddOnSelOf } from '../src/components/Shared/reopenQuote.js';
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
console.log(`reopenAddOns: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
