// Configurator logic tests — offer gating by drive, chart-included carrier quantities, and the
// overage rule (chart included, extras charged). Runs against the REAL rules parsed from the sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { configuratorOffer, configuratorLines, configuratorTotal } from './traverseConfigurator.mjs';
import { parseTraverseKitSheets } from './traverseKitImport.mjs';

const HAVE = existsSync('./kit_sheet.json');
const skip = HAVE ? false : 'Fabricut/Aug12/Fabricut_Traverse.xlsx not present';
const rules = HAVE ? parseTraverseKitSheets(JSON.parse(readFileSync('./kit_sheet.json', 'utf8'))).rules : null;
const PRICES = { 'HTRF80-500': 0.5, 'HTSLNTCAR': 0.5, 'HSOM-40': 220, 'HSOM-19': 78, 'HMTCL/01': 3.25 };
const priceOf = (id) => PRICES[id] ?? 1;

test('the offer gates by drive — manual sees master carriers, motorized sees pulleys and remotes', { skip }, () => {
    const man = configuratorOffer({ rules, drive: 'MANUAL', feet: 8 });
    assert.ok(man.picks.some(p => p.itemId === 'HMTCL/01'));
    assert.ok(man.picks.some(p => p.itemId === 'HTTENDSTOP'));         // BOTH-gated
    assert.ok(!man.accessories.some(a => a.itemId === 'HSOM-19'));     // motorized-only remote
    const mot = configuratorOffer({ rules, drive: 'MOTORIZED', feet: 8 });
    assert.ok(mot.picks.some(p => p.itemId === 'HSOM-33'));            // drive pulley, included
    assert.ok(mot.accessories.some(a => a.itemId === 'HSOM-40'));      // Tahoma switch bills
    assert.ok(!mot.picks.some(p => p.itemId === 'HMTCL/01'));
});

test('carrier styles come from the chart with the length\'s included quantity', { skip }, () => {
    const o = configuratorOffer({ rules, drive: 'MANUAL', feet: 8 });
    assert.equal(o.carrierStyles.length, 3);
    assert.equal(o.carrierStyles.find(s => s.itemId === 'HTRF80-500').includedQty, 40);   // 80% RF @ 8ft
    assert.equal(o.carrierStyles.find(s => s.itemId === 'HTSLNTCAR').includedQty, 32);    // pinch pleat @ 8ft
});

test('chart quantity rides included at $0; raising it bills ONLY the overage', { skip }, () => {
    const lines = configuratorLines({ rules, drive: 'MANUAL', feet: 8, priceOf,
        sel: { carrierStyle: 'HTRF80-500', carrierQty: 45, picks: {}, accessories: {} } });
    const inc = lines.find(l => l.code === 'HTRF80-500' && !l.billable);
    const over = lines.find(l => l.code === 'HTRF80-500' && l.billable);
    assert.equal(inc.qty, 40); assert.equal(inc.rate, 0);
    assert.equal(over.qty, 5); assert.equal(over.rate, 0.5);
    assert.equal(configuratorTotal(lines), 2.5);
});

test('lowering below the chart consumes fewer and bills nothing', { skip }, () => {
    const lines = configuratorLines({ rules, drive: 'MANUAL', feet: 8, priceOf,
        sel: { carrierStyle: 'HTRF80-500', carrierQty: 30, picks: {}, accessories: {} } });
    assert.equal(lines.length, 1);
    assert.deepEqual([lines[0].qty, lines[0].rate], [30, 0]);
});

test('blank qty = exactly the chart; accessories bill at the customer price; picks ride included', { skip }, () => {
    const lines = configuratorLines({ rules, drive: 'MOTORIZED', feet: 12, priceOf,
        sel: { carrierStyle: 'HTSLNTCAR', carrierQty: null, picks: { 'HSOM-33': 2, 'HTTENDSTOP': 4 }, accessories: { 'HSOM-40': 1, 'HSOM-19': 2 } } });
    assert.equal(lines.find(l => l.code === 'HTSLNTCAR').qty, 48);     // pinch pleat @ 12ft
    assert.equal(lines.find(l => l.code === 'HSOM-33').rate, 0);
    assert.equal(configuratorTotal(lines), 220 + 156);
    // a drive-gated item smuggled into the wrong drive's selection is refused, not billed
    const wrong = configuratorLines({ rules, drive: 'MANUAL', feet: 12, priceOf,
        sel: { picks: {}, accessories: { 'HSOM-19': 1 } } });
    assert.equal(wrong.length, 0);
});
