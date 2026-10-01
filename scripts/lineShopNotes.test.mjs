// 📝 The step notes reach the shop (Stuart 2026-10-01).   node scripts/lineShopNotes.test.mjs
import { shopNotesOf, clientNotesOf, clientNoteRow } from '../src/components/Shared/lineShopNotes.js';
import { isDisplayOnlyLine, customerDocLines } from '../src/components/Shared/lineClassification.js';
import { noSpliceNote } from '../src/components/Shared/flowExtras.js';
import { isPhysicalLine } from '../src/components/Shared/packingList.js';
import { invoiceDocOf } from '../src/components/Shared/invoiceMath.js';
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

// ── CLIENT VISIBLE? (Stuart 2026-10-01: "if checked then the notes appear on their paperwork, if not checked
//    (default) only pass on internal documents") ─────────────────────────────────────────────────────────────
{
    const notes = { LENGTH: 'cut 1/8 short', 'SLOT:RING': 'rings ship loose in a bag', 'SLOT:LEFT_BRACKET': 'use the long screws' };
    eq('nothing ticked → nothing for the customer', clientNotesOf({ steps, stepNotes: notes }), []);
    eq('the shop still gets every note', shopNotesOf({ steps, stepNotes: notes }).length, 3);
    eq('one ticked → that one, under its step', clientNotesOf({ steps, stepNotes: notes, visible: { 'SLOT:RING': true } }), ['Shared ring: rings ship loose in a bag']);
    eq('two ticked → in walk order', clientNotesOf({ steps, stepNotes: notes, visible: { 'SLOT:RING': true, LENGTH: true } }), ['Pole length: cut 1/8 short', 'Shared ring: rings ship loose in a bag']);
    eq('a tick on an empty note prints nothing', clientNotesOf({ steps, stepNotes: { LENGTH: '  ' }, visible: { LENGTH: true } }), []);
    eq('only a real tick counts (true, not "yes" or 1)', clientNotesOf({ steps, stepNotes: notes, visible: { LENGTH: 'yes', 'SLOT:RING': 1 } }), []);
    eq('empty inputs', [clientNotesOf(), clientNotesOf({ visible: null })], [[], []]);

    // The row on the saved order: words, not work.
    const row = clientNoteRow('Shared ring: rings ship loose in a bag');
    eq('the row', [row.name, row.isNote, row.total, row.partId], ['  Note — Shared ring: rings ship loose in a bag', true, 0, null]);
    ok('it is display-only: no floor, split, pick or NetSuite reader acts on it', isDisplayOnlyLine(row));
    const order = [
        { name: '▶ H1-138 [Living Room 1]', isHeader: true, qty: 1, total: 100 },
        { name: '  - Wood Ring', legacyErpId: 'H1-138WRNG-W', qty: 20, price: 5, total: 100, finishCode: 'S12' },
        row,
    ];
    for (const type of ['QUOTE', 'SALES_ORDER', 'INVOICE']) {
        const out = customerDocLines(order, type, 'Pure Walnut');
        ok(`${type}: the note prints under its configuration`, out.some(l => l.isNote && l.name === row.name));
        ok(`${type}: and no finish is stuck onto it`, !out.some(l => l.isNote && /Finish:/.test(l.name)));
        ok(`${type}: before the configuration's own total`, out.findIndex(l => l.isNote) < out.findIndex(l => l.isNetLine));
    }
    ok('the invoice math never counts a note as goods', !isPhysicalLine(row));
    const inv = invoiceDocOf({ priced: customerDocLines(order, 'INVOICE'), packingList: { lines: [{ code: 'H1-138WRNG-W', qtyShipped: 20 }] }, shippingAmount: 0, orderedTotal: 100 });
    eq('…so a fully shipped order with a note on it is NOT an "adjusted" invoice', [inv.adjusted, inv.total], [false, 100]);
    for (const type of ['PACKING_SLIP', 'FACTORY_ROUTER', '']) ok(`${type || '(no type)'}: never on a contents or shop document`, !customerDocLines(order, type).some(l => l.isNote));
}

console.log(`lineShopNotes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
