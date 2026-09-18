// A joiner is offered at every length and included only where the chart begins (Stuart 2026-09-18).
//   node scripts/traverseSplice.test.mjs
import { register } from 'node:module';
register('./_lib/extless-hook.mjs', import.meta.url);
const { usageAt, usageFromFirst } = await import('../src/components/Shared/traverseExplode.js');
const { configuratorOffer, defaultPicks, configuratorLines } = await import('../src/components/Shared/traverseConfigurator.js');
let pass = 0, fail = 0;
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) { pass++; return; } fail++; console.log(`✗ ${n} — got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };

// the live chart rows, as read from system/traverse_rules_H1-138TRV and _H1-2TRV on 2026-09-18
const byFeet = {}; for (let f = 11; f <= 36; f++) byFeet[f] = f <= 20 ? 1 : f <= 30 ? 2 : 3;
const bracket = { itemId: 'H1-138TRVSBA', byFeet: { 2: 2, 4: 2, 6: 3, 8: 3, 10: 4 } };
const rulesFor = (splice) => ({ usage: [{ itemId: 'HTSLNTCAR', label: 'Silent carrier', byFeet: { 2: 5, 4: 9 } }, bracket, { itemId: splice, label: 'Splices', byFeet }],
    configurator: [{ itemId: splice, drive: 'BOTH', billable: false }, { itemId: 'HTENDSTOP', drive: 'BOTH', billable: false }] });

eq('reading UP is still right for a row that exists at every length', usageAt(bracket, 5), 3);
eq('…and unchanged by the new helper once inside the chart', usageFromFirst(bracket, 5), 3);
eq('below the splice chart\'s first entry: zero', usageFromFirst({ byFeet }, 4), 0);
eq('10 ft is still zero', usageFromFirst({ byFeet }, 10), 0);
eq('11 ft is where it begins', usageFromFirst({ byFeet }, 11), 1);
eq('21 ft takes two', usageFromFirst({ byFeet }, 21), 2);
eq('an empty row is zero, never a crash', usageFromFirst({}, 12), 0);

for (const splice of ['H1-138TRVJNR', 'H1-2TRVSPLC']) {
    const rules = rulesFor(splice);
    const at = (feet) => configuratorOffer({ rules, drive: 'MANUAL', feet }).picks.find(p => p.itemId === splice);
    eq(`${splice}: still OFFERED at 4 ft`, !!at(4), true);
    eq(`${splice}: but nothing is included at 4 ft`, at(4).includedQty, 0);
    eq(`${splice}: the step opens with NO joiner at 4 ft`, defaultPicks({ rules, drive: 'MANUAL', feet: 4 })[splice], undefined);
    eq(`${splice}: …nor at 10 ft`, defaultPicks({ rules, drive: 'MANUAL', feet: 10 })[splice], undefined);
    eq(`${splice}: defaults to 1 over 10 ft`, defaultPicks({ rules, drive: 'MANUAL', feet: 11 })[splice], 1);
    eq(`${splice}: the end stops default is untouched`, defaultPicks({ rules, drive: 'MANUAL', feet: 4 }).HTENDSTOP, 2);
    const lines = configuratorLines({ rules, drive: 'MANUAL', feet: 4, sel: { picks: { [splice]: 1 } }, priceOf: () => 6 });
    eq(`${splice}: one ADDED at 4 ft bills — it is not "included"`, lines.map(l => [l.qty, l.rate, l.billable]), [[1, 6, true]]);
    const long = configuratorLines({ rules, drive: 'MANUAL', feet: 12, sel: { picks: { [splice]: 1 } }, priceOf: () => 6 });
    eq(`${splice}: the one a 12 ft system needs is included at $0`, long.map(l => [l.qty, l.rate, l.billable]), [[1, 0, false]]);
}
console.log(`traverseSplice: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
