// A line whose ITEM takes no finish carries none onto the job (Stuart 2026-09-17).   node scripts/dropFinishUnfinished.test.mjs
import { dropFinishWhereItemTakesNone } from '../src/components/Shared/finishLabel.js';
let pass = 0, fail = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) { pass++; return; } fail++; console.log(`✗ ${n} — got ${JSON.stringify(a)}`); };
const lib = {
    'CE-INV-1': { id: 'CE-INV-1', legacyErpId: 'H1-2TRVNUT', manufacturingSpecs: { customData: { unfinished: true } } },
    'CE-INV-2': { id: 'CE-INV-2', legacyErpId: 'H1-1R', manufacturingSpecs: { customData: {} } },
    'H1-2TRVPLUG': { id: 'CE-INV-3', legacyErpId: 'H1-2TRVPLUG', manufacturingSpecs: { customData: { unfinished: 'TRUE' } } },
};
const find = (k) => lib[String(k || '').toUpperCase()] || null;
const out = dropFinishWhereItemTakesNone([
    { name: 'nut', partId: 'CE-INV-1', finishCode: 'EP4', finishLabel: 'EP4 – Aged Brass', finishOutsourced: true, qty: 2 },
    { name: 'rod', partId: 'CE-INV-2', finishCode: 'EP4', finishLabel: 'EP4 – Aged Brass', finishOutsourced: true, qty: 1 },
    { name: 'plug', partId: 'GONE', legacyErpId: 'H1-2TRVPLUG', finishCode: 'EP4', qty: 2 },
    { name: 'header', isHeader: true },
    { name: 'unknown', partId: 'NOPE', finishCode: 'P06' },
], find);
eq('an unfinished item loses the code, the label and the routing stamp', out[0], { name: 'nut', partId: 'CE-INV-1', qty: 2, noFinish: true });
eq('a finished item is untouched', out[1].finishCode + '|' + out[1].finishOutsourced, 'EP4|true');
eq('found by our number when the doc id is stale; the text tag TRUE counts', out[2], { name: 'plug', partId: 'GONE', legacyErpId: 'H1-2TRVPLUG', qty: 2, noFinish: true });
eq('a line with no finish is passed through', out[3], { name: 'header', isHeader: true });
eq('an item the library cannot find keeps what it was stamped with', out[4].finishCode, 'P06');
eq('no lookup → nothing changes', dropFinishWhereItemTakesNone([{ partId: 'CE-INV-1', finishCode: 'EP4' }])[0].finishCode, 'EP4');
eq('null lines are safe', dropFinishWhereItemTakesNone(null, find), []);
console.log(`dropFinishUnfinished: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
