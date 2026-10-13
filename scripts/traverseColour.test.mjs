// The traverse colour that goes with a finish, said on the recipe — offline.
//   node scripts/traverseColour.test.mjs
// Stuart 2026-10-13: "on the recipe card in finishing add the matching traverse tag for the complimentary bronze or
// champagne colors" · "recipe read only". The pairing is 4.5's (subFinishCode) — the one CPQ, Order Entry and RTG route
// by. If a row here breaks, the change is wrong — unless Stuart changed the rule.
import { traverseColourOf, traverseColourText, finishOfRecipeCode } from '../src/components/Shared/traverseColour.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };

// 4.5 as read on 2026-10-13 (a slice): every P and S finish names TBR or TCP; the stock colours name none.
const F = [
    { code: 'TBR', name: 'TRAVERSE BRONZE', type: 'TRAVERSE TRACK AND PARTS', isSubFinish: true },
    { code: 'TCP', name: 'TRAVERSE CHAMPAGNE', type: 'TRAVERSE TRACK AND PARTS', isSubFinish: true },
    { code: 'S04', name: 'NATURAL OAK', subFinishCode: 'TCP' }, { code: 'P06', name: 'P06', subFinishCode: 'TCP' }, { code: 'P10', name: 'P10', subFinishCode: 'tcp' },
    { code: 'P09', name: 'P09', subFinishCode: 'TBR' }, { code: 'S08', name: 'ESPRESSO', subFinishCode: 'TBR' },
    { code: 'BS', name: 'BRUSHED STEEL' }, { name: 'SG' }, null,
];

eq('S04 → champagne', traverseColourOf('S04', F), { kind: 'WEARS', code: 'TCP', name: 'Traverse Champagne' });
eq('S08 → bronze', traverseColourOf('S08', F), { kind: 'WEARS', code: 'TBR', name: 'Traverse Bronze' });
eq('a pairing typed in lower case still reads', traverseColourOf('P10', F).code, 'TCP');
eq('the -S and -P variants are their master\'s', [traverseColourOf('S04-S', F).code, traverseColourOf('S08-P', F).code], ['TCP', 'TBR']);
eq('the recipe as stamped on a work order ("S04 - Natural Oak")', traverseColourOf('S04 - Natural Oak', F).code, 'TCP');
eq('lower case, spaces', traverseColourOf('  p09 ', F).code, 'TBR');
eq('a stock colour has none', [traverseColourOf('BS', F), traverseColourOf('SG', F), traverseColourOf('N25', F)], [null, null, null]);
eq('no code, no finishes', [traverseColourOf('', F), traverseColourOf(null, F), traverseColourOf('S04', []), traverseColourOf('S04')], [null, null, null, null]);
eq('the champagne recipe says which finishes it goes with, in order', traverseColourOf('TCP', F), { kind: 'IS', code: 'TCP', name: 'Traverse Champagne', goesWith: ['P06', 'P10', 'S04'] });
eq('…and the bronze', traverseColourOf('TBR', F).goesWith, ['P09', 'S08']);
eq('a traverse colour nothing is paired to yet', traverseColourOf('TXX', [{ code: 'TXX', name: 'TXX', isSubFinish: true }]), { kind: 'IS', code: 'TXX', name: '', goesWith: [] });
eq('a pairing to a colour 4.5 no longer lists still shows its code', traverseColourOf('P06', [{ code: 'P06', subFinishCode: 'TCP' }]), { kind: 'WEARS', code: 'TCP', name: '' });
eq('the code a recipe stands for', [finishOfRecipeCode('s03-s'), finishOfRecipeCode('CP-P'), finishOfRecipeCode('P24 - Paint'), finishOfRecipeCode('')], ['S03', 'CP', 'P24', '']);
eq('the line: a finish', traverseColourText(traverseColourOf('S04', F)), 'Traverse parts: TCP · Traverse Champagne');
eq('the line: a traverse colour', traverseColourText(traverseColourOf('TBR', F)), 'Traverse colour TBR · Traverse Bronze — goes with P09, S08');
eq('the line: nothing', traverseColourText(null), '');

console.log(`traverseColour: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
