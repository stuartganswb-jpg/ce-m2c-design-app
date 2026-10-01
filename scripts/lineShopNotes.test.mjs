// 📝 The step notes reach the shop (Stuart 2026-10-01).   node scripts/lineShopNotes.test.mjs
import { shopNotesOf } from '../src/components/Shared/lineShopNotes.js';
import { noSpliceNote } from '../src/components/Shared/flowExtras.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

const steps = [
    { key: 'AXIS:rodKind', label: 'Rod setup' },
    { key: 'LENGTH', label: 'Pole length' },
    { key: 'SLOT:LEFT_BRACKET', label: 'Left bracket' },
    { key: 'SLOT:RING', label: 'Shared ring' },
];

eq('nothing typed → nothing on the line', shopNotesOf({ steps, stepNotes: {} }), []);
eq('one note, under the step it was typed on', shopNotesOf({ steps, stepNotes: { LENGTH: 'cut 1/8 short' } }), ['Pole length: cut 1/8 short']);
eq('in the order the steps are walked, not the order they were typed',
    shopNotesOf({ steps, stepNotes: { 'SLOT:RING': 'clip rings', LENGTH: 'cut 1/8 short', 'AXIS:rodKind': 'double' } }),
    ['Rod setup: double', 'Pole length: cut 1/8 short', 'Shared ring: clip rings']);
eq('blank and whitespace notes are not notes', shopNotesOf({ steps, stepNotes: { LENGTH: '   ', 'SLOT:RING': '' } }), []);
eq('line breaks and runs of spaces collapse to one line', shopNotesOf({ steps, stepNotes: { LENGTH: 'cut  short\n  see drawing' } }), ['Pole length: cut short see drawing']);
eq('a note on a step no longer in the walk still prints, under its key',
    shopNotesOf({ steps, stepNotes: { LENGTH: 'a', 'SLOT:FINIAL': 'acrylic — handle with gloves' } }),
    ['Pole length: a', 'SLOT:FINIAL: acrylic — handle with gloves']);
eq('a declined splice leads the list',
    shopNotesOf({ steps, stepNotes: { LENGTH: 'customer wants one piece' }, lead: [noSpliceNote(144, 120)] }),
    ['NO SPLICE — 144" pole ships in ONE PIECE (over the 120" one-piece limit; no joiner on this line)', 'Pole length: customer wants one piece']);
eq('the lead alone', shopNotesOf({ steps, lead: ['A', ' '] }), ['A']);
eq('a step listed twice prints once', shopNotesOf({ steps: [...steps, steps[1]], stepNotes: { LENGTH: 'x' } }), ['Pole length: x']);
eq('a step with no label prints under its key', shopNotesOf({ steps: [{ key: 'K' }], stepNotes: { K: 'x' } }), ['K: x']);
eq('empty inputs', [shopNotesOf(), shopNotesOf({ stepNotes: null })], [[], []]);

console.log(`lineShopNotes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
