// THE SEAM THAT FAILED SILENTLY (2026-09-08).
//
// The stock review built each row as `erpId: x.erpId` — a field that does not exist on a `prepped`
// row ({ r, info, qty, pins }) — so erpId was undefined from the day the gate shipped. Harmless for
// eight days, because the action text carried the codes and nobody read erpId. Then the pole panel
// keyed its lookup on it, asked for poles["UNDEFINED"], and rendered nothing: HCUMP410/SG x20
// parked on a material gate with 474 x HCUMP810 on the shelf and a valid cut already computed.
//
// A string key that misses is silent by nature. This is the test that would have caught it.
import assert from 'node:assert';

// stockReviewRows, lifted verbatim from StockViewTab
const stockReviewRows = (prepped = [], preByKey = new Map(), actionText = () => '') =>
    prepped.map((x, key) => {
        const pre = (preByKey.get ? preByKey.get(key) : null) || null;
        const blocked = !!(pre && pre.rawUnknown);
        const code = String((x.r && x.r.itemid) || x.erpId || '').toUpperCase();
        return {
            key, erpId: code, name: (x.info && x.info.part && x.info.part.itemName) || (x.part && x.part.itemName) || '',
            qty: x.qty,
            actions: pre ? pre.actions.map(actionText).filter(Boolean) : ['(pre-check unavailable — WO would be created un-gated)'],
            blocked, include: !blocked,
        };
    });

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log(`  FAIL ${n}: ${e.message}`); } };

// The Snapshot's shape: { r, info, qty, pins }
const snapPrepped = [
    { r: { itemid: 'HCUMP410/SG' }, info: { part: { itemName: '4ft rod' } }, qty: 20, pins: [] },
    { r: { itemid: 'HCUMP610/CP' }, info: { part: { itemName: '6ft rod' } }, qty: 20, pins: [] },
];
// The grid's shape: { part, erpId, qty, pins }
const gridPrepped = [{ part: { itemName: 'grid part' }, erpId: 'HCUMP410/SG', qty: 5, pins: [] }];

t('Snapshot rows carry the real item code', () => {
    const rows = stockReviewRows(snapPrepped);
    assert.deepStrictEqual(rows.map(r => r.erpId), ['HCUMP410/SG', 'HCUMP610/CP']);
});
t('no row has an undefined or empty code — the defect itself', () => {
    stockReviewRows(snapPrepped).forEach(r => {
        assert.ok(r.erpId && r.erpId !== 'UNDEFINED', `row ${r.key} has code "${r.erpId}"`);
    });
});
t('Snapshot rows carry the item name (also undefined before)', () => {
    assert.deepStrictEqual(stockReviewRows(snapPrepped).map(r => r.name), ['4ft rod', '6ft rod']);
});
t('the grid shape still resolves', () => {
    const rows = stockReviewRows(gridPrepped);
    assert.strictEqual(rows[0].erpId, 'HCUMP410/SG');
    assert.strictEqual(rows[0].name, 'grid part');
});

// THE ACTUAL INVARIANT: every pole decision must be reachable from the row that owns it.
t('every filed pole decision is found by its row (the lookup the panel does)', () => {
    const poles = {
        'HCUMP410/SG': { pullErp: 'HCUMP410', short: 20, chosen: null, options: [{ sourceErp: 'HCUMP810', enough: true }] },
        'HCUMP610/CP': { pullErp: 'HCUMP610', short: 0, chosen: null, options: [] },
    };
    const rows = stockReviewRows(snapPrepped);
    rows.forEach(r => {
        assert.ok(poles[String(r.erpId).toUpperCase()], `row ${r.erpId} could not find its pole decision`);
    });
    const short = rows.filter(r => poles[r.erpId].short > 0);
    assert.strictEqual(short.length, 1, 'the 4ft row must be the one asking a question');
    assert.strictEqual(short[0].erpId, 'HCUMP410/SG');
});

t('a blocked pre-check still yields a coded row', () => {
    const pre = new Map([[0, { rawUnknown: true, actions: [] }]]);
    const rows = stockReviewRows(snapPrepped, pre);
    assert.strictEqual(rows[0].blocked, true);
    assert.strictEqual(rows[0].include, false);
    assert.strictEqual(rows[0].erpId, 'HCUMP410/SG');
});

t('an unanswered short pole blocks approval', () => {
    const poles = { 'HCUMP410/SG': { short: 20, chosen: null }, 'HCUMP610/CP': { short: 0, chosen: null } };
    const rows = stockReviewRows(snapPrepped);
    const included = rows.filter(r => r.include && !r.blocked);
    const unanswered = included.filter(r => { const p = poles[r.erpId]; return p && p.short > 0 && p.chosen == null; });
    assert.strictEqual(unanswered.length, 1);
    poles['HCUMP410/SG'].chosen = 'HCUMP810';
    assert.strictEqual(included.filter(r => { const p = poles[r.erpId]; return p && p.short > 0 && p.chosen == null; }).length, 0);
});

t('unticking the short row removes its question', () => {
    const poles = { 'HCUMP410/SG': { short: 20, chosen: null } };
    const rows = stockReviewRows(snapPrepped).map(r => r.erpId === 'HCUMP410/SG' ? { ...r, include: false } : r);
    const included = rows.filter(r => r.include && !r.blocked);
    assert.strictEqual(included.filter(r => { const p = poles[r.erpId]; return p && p.short > 0 && p.chosen == null; }).length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
