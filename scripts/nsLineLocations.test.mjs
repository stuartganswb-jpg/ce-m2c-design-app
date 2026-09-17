// Every sales order line says where it ships from (Stuart 2026-09-17).   node scripts/nsLineLocations.test.mjs
import { register } from 'node:module';
try { register('./_lib/extless-hook.mjs', import.meta.url); } catch (e) {}
const { withLineLocations } = await import('../src/components/Shared/nsHeader.js');
let pass = 0, fail = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) { pass++; return; } fail++; console.log(`✗ ${n} — got ${JSON.stringify(a)}`); };
const p = { entity: { id: '1' }, location: { id: 17 }, item: { items: [{ item: { id: '61502' }, quantity: 1 }, { item: { id: '51244' }, quantity: 100 }, { item: { id: '9' }, quantity: 2, location: { id: '19' } }] } };
const so = withLineLocations(p, 'salesorder');
eq('every line without one takes the header location', so.item.items.map(l => l.location.id), ['17', '17', '19']);
eq('a line that names its own keeps it', so.item.items[2].location, { id: '19' });
eq('the header is untouched', so.location, { id: 17 });
eq('the input is not mutated', p.item.items[1].location, undefined);
eq('an estimate is left alone', withLineLocations(p, 'estimate'), p);
eq('no header location → nothing invented', withLineLocations({ item: { items: [{ item: { id: '1' } }] } }, 'salesorder').item.items[0].location, undefined);
eq('null is safe', withLineLocations(null, 'salesorder'), null);
console.log(`nsLineLocations: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
