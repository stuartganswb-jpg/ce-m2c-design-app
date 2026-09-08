import assert from 'node:assert';
import { splitFinish, siblingsQuery, oneItemQuery, shapeSources, validateRepaint, repaintDescription } from '../src/components/Shared/repaintSource.js';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log(`  FAIL ${n}: ${e.message}`); } };

t('splits a finish suffix', () => {
    assert.deepStrictEqual(splitFinish('HHRMBF75/M3'), { base: 'HHRMBF75', finish: 'M3' });
    assert.deepStrictEqual(splitFinish('HCUMSBF15/N25'), { base: 'HCUMSBF15', finish: 'N25' });
    assert.deepStrictEqual(splitFinish('HHRMBF75'), { base: 'HHRMBF75', finish: '' });
});

t('the sibling query cannot drag in a longer base', () => {
    const q = siblingsQuery('HHRMBF75');
    assert.ok(q.includes("LIKE 'HHRMBF75/%'"), 'must anchor on the slash');
    assert.ok(!q.includes("LIKE 'HHRMBF75%'"), "a bare prefix would match HHRMBF750");
    assert.ok(q.includes("= 'HHRMBF75'"), 'the mill item itself is paintable');
});
t('quotes are escaped in both queries', () => {
    assert.ok(siblingsQuery("A'B").includes("A''B"));
    assert.ok(oneItemQuery("A'B").includes("A''B"));
});

const rows = [
    { id: '1', itemid: 'HHRMBF75/M1', displayname: 'Matte 1' },
    { id: '2', itemid: 'HHRMBF75/M3', displayname: 'Matte 3' },   // the target itself
    { id: '3', itemid: 'HHRMBF75/P',  displayname: 'Phos' },
    { id: '4', itemid: 'HHRMBF75',    displayname: 'Mill' },
    { id: '5', itemid: 'HHRMBF75/OLD', displayname: 'Dead', inactive: 'T' },
];
const avail = { 'HHRMBF75/M1': 40, 'HHRMBF75/P': 3, HHRMBF75: 0 };

t('the target is never offered as its own source', () => {
    assert.ok(!shapeSources({ rows, targetCode: 'HHRMBF75/M3', availByCode: avail, need: 8 }).some(r => r.code === 'HHRMBF75/M3'));
});
t('inactive items are dropped', () => {
    assert.ok(!shapeSources({ rows, targetCode: 'HHRMBF75/M3', availByCode: avail, need: 8 }).some(r => r.code === 'HHRMBF75/OLD'));
});
t('colours that can cover the order sort first', () => {
    const out = shapeSources({ rows, targetCode: 'HHRMBF75/M3', availByCode: avail, need: 8 });
    assert.strictEqual(out[0].code, 'HHRMBF75/M1');
    assert.strictEqual(out[0].enough, true);
    assert.strictEqual(out.find(r => r.code === 'HHRMBF75/P').enough, false, '3 available cannot cover 8');
});
t('an empty colour is shown, not hidden', () => {
    const out = shapeSources({ rows, targetCode: 'HHRMBF75/M3', availByCode: avail, need: 8 });
    assert.ok(out.some(r => r.code === 'HHRMBF75' && r.available === 0));
});
t('a code with no availability row reads as zero, never undefined', () => {
    const out = shapeSources({ rows, targetCode: 'HHRMBF75/M3', availByCode: {}, need: 1 });
    out.forEach(r => assert.strictEqual(typeof r.available, 'number'));
});

// ── STOCK IS A REFUSAL ────────────────────────────────────────────────────────────────
t('enough stock passes', () => {
    assert.strictEqual(validateRepaint({ sourceCode: 'HHRMBF75/M1', targetCode: 'HHRMBF75/M3', qty: 8, available: 40 }).ok, true);
});
t('short stock is REFUSED, not warned', () => {
    const v = validateRepaint({ sourceCode: 'HHRMBF75/P', targetCode: 'HHRMBF75/M3', qty: 8, available: 3 });
    assert.strictEqual(v.ok, false);
    assert.ok(/3 available/.test(v.error) && /not enough for 8/.test(v.error));
});
t('exactly enough is enough', () => {
    assert.strictEqual(validateRepaint({ sourceCode: 'A', targetCode: 'B', qty: 8, available: 8 }).ok, true);
});
t('an item NetSuite does not know is refused', () => {
    const v = validateRepaint({ sourceCode: 'NOPE', targetCode: 'B', qty: 1, available: 99, sourceKnown: false });
    assert.strictEqual(v.ok, false);
    assert.ok(/no item called "NOPE"/.test(v.error));
});
t('painting an item from itself is refused', () => {
    assert.strictEqual(validateRepaint({ sourceCode: 'A', targetCode: 'a', qty: 1, available: 9 }).ok, false);
});
t('fractional and zero quantities are refused', () => {
    assert.strictEqual(validateRepaint({ sourceCode: 'A', targetCode: 'B', qty: 2.5, available: 9 }).ok, false);
    assert.strictEqual(validateRepaint({ sourceCode: 'A', targetCode: 'B', qty: 0, available: 9 }).ok, false);
});
t('no source chosen is refused', () => {
    assert.strictEqual(validateRepaint({ sourceCode: '', targetCode: 'B', qty: 1, available: 9 }).ok, false);
});

t('the description reads as the move it is', () => {
    assert.strictEqual(
        repaintDescription({ sourceCode: 'HHRMBF75/M1', targetCode: 'HHRMBF75/M3', finishLabel: 'M3 - Matte Gold', qty: 8 }),
        '8 × HHRMBF75/M1 → HHRMBF75/M3 · M3 - Matte Gold');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
