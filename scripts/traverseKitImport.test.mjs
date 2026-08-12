// Kit-sheet parser tests — run against the REAL Fabricut_Traverse.xlsx (extracted to kit_sheet.json
// by run-traverse-tests.sh). Testing on the real data is the point: the sheet carries a pasted-over
// "front and rear" on Single rows, trailing spaces in codes, and a blank-pattern Base Set block —
// the parser has to survive Stuart's actual file, not a sanitized fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseTraverseKitSheets, diffTraverseKits, kitPricingRow, BILLABLE_ACCESSORY_SEED } from './traverseKitImport.mjs';

const HAVE = existsSync('./kit_sheet.json');
const parsed = HAVE ? parseTraverseKitSheets(JSON.parse(readFileSync('./kit_sheet.json', 'utf8'))) : null;
const skip = HAVE ? false : 'Fabricut/Aug12/Fabricut_Traverse.xlsx not present';

test('every Base Set row becomes a kit; Base Plus Motor rows become codes, not kits', { skip }, () => {
    // the sheet has 30 Base Set rows (15 manual, 15 motorized) and 60 Base Plus Motor rows
    // (12 per motorized block × 5 blocks)
    assert.equal(parsed.kits.length, 30);
    const codes = parsed.kits.flatMap(k => k.motorCodes).length;
    assert.equal(codes, 60);
    // no kit record was made for a per-motor code
    assert.ok(parsed.kits.every(k => !/-\d+(W|C)$/.test(k.code)));
});

test('axes read correctly across the grid', { skip }, () => {
    const k = (code) => parsed.kits.find(x => x.code === code);
    assert.deepEqual(k('H1-2TRV-4/P').align, { setup: 'SINGLE', frontRail: 'TRACK', drive: 'MANUAL', mount: 'WALL', material: 'P', minFeet: 4 });
    assert.deepEqual(k('H1-2TRV-4FRT/W').align, { setup: 'DOUBLE', frontRail: 'RING', drive: 'MANUAL', mount: 'WALL', material: 'W', minFeet: 4 });
    assert.deepEqual(k('H1-2TRV-4MDC/EP').align, { setup: 'DOUBLE', frontRail: 'TRACK', drive: 'MOTORIZED', mount: 'CEILING', material: 'EP', minFeet: 4 });
    // the pasted-over "front and rear" on Single rows normalizes to TRACK
    assert.equal(k('H1-2TRV-4MC/P').align.frontRail, 'TRACK');
});

test('per-motor codes fold onto the right base with the right motor', { skip }, () => {
    const base = parsed.kits.find(x => x.code === 'H1-2TRV-4M/P');
    const sixty = base.motorCodes.find(c => c.code === 'H1-2TRV-4M/P-60W');
    assert.equal(sixty.motorItem, 'HSOM-20');       // 60W = Glydea Ultra 60
    assert.equal(sixty.fabSku, 'HMTS7501F');
    // ceiling: the trailing letter is the MOUNT — -35C lands on the ceiling base, not wall
    const ceil = parsed.kits.find(x => x.code === 'H1-2TRV-4MC/P');
    assert.ok(ceil.motorCodes.some(c => c.code === 'H1-2TRV-4M/P-35C' && c.motorItem === 'HSOM-21'));
    // and nothing was orphaned
    assert.ok(!parsed.warnings.some(w => /no Base Set kit matches/.test(w)), parsed.warnings.join('; '));
});

test('the motorized base prices the cheapest motor in — upcharge = motor delta (his math, verified)', { skip }, () => {
    const base = parsed.kits.find(x => x.code === 'H1-2TRV-4M/P');
    const m = Object.fromEntries(parsed.components.filter(c => /^HSOM-2[012]|^HSOM-41/.test(c.code)).map(c => [c.code, c.net]));
    const up = (code) => base.motorCodes.find(c => c.code === code).net - base.net;
    assert.equal(up('H1-2TRV-4M/P-60W'), m['HSOM-20'] - m['HSOM-21']);   // +100
    assert.equal(up('H1-2TRV-4M/P-50W'), m['HSOM-41'] - m['HSOM-21']);   // +25
});

test('the additional-foot triple rides each kit', { skip }, () => {
    const k = parsed.kits.find(x => x.code === 'H1-2TRV-4D/P');
    assert.deepEqual([k.perFootNet, k.perFootSales, k.perFootRetail], [78, 156, 312]);
});

test('components: main-tab rows + Carrier Parts tab, with the trailing-space codes normalized', { skip }, () => {
    const codes = parsed.components.map(c => c.code);
    assert.ok(codes.includes('H1-2TRVSRA/P'));      // return arm (steps 7/8 pricing)
    assert.ok(codes.includes('HTSLNTCAR'));          // carrier from the Carrier Parts tab
    assert.ok(codes.includes('HSOM-41'));            // motor
    assert.ok(codes.every(c => c === c.trim()));
});

test('usage rules: totals per length, splices included, configurator gated by drive + billable seed', { skip }, () => {
    const u = (id) => parsed.rules.usage.find(x => x.itemId === id);
    assert.equal(u('HTSLNTCAR').byFeet[4], 16);      // pinch pleat carriers at 4ft
    assert.equal(u('HTRF100N-500').byFeet[36], 216); // 100% RF at 36ft
    assert.equal(u('H1-2TRV-WB').byFeet[10], 4);     // brackets at 10ft
    assert.equal(u('H1-2TRVSPLC').byFeet[10], 0);    // no splice yet at 10ft…
    assert.equal(u('H1-2TRVSPLC').byFeet[11], 1);    // …one from 11ft
    const cfg = (id) => parsed.rules.configurator.find(x => x.itemId === id);
    assert.equal(cfg('HMTCL/01').drive, 'MANUAL');
    assert.equal(cfg('HSOM-19').drive, 'MOTORIZED');
    assert.equal(cfg('HTTENDSTOP').drive, 'BOTH');
    // billable is a FIELD seeded from Stuart's list, not a hardcode downstream
    assert.equal(cfg('HSOM-40').billable, true);      // Tahoma switch bills
    assert.equal(cfg('HSOM-35').billable, false);     // motor plate is included
    BILLABLE_ACCESSORY_SEED.forEach(id => { const c = cfg(id); if (c) assert.equal(c.billable, true, id); });
});

test('diff: kit New vs Update, component Align vs Missing', { skip }, () => {
    const lib = new Map([['H1-2TRV-4/P', { id: 'KIT-X' }], ['HTSLNTCAR', { id: 'doc1' }]]);
    const { kitEntries, compEntries } = diffTraverseKits(parsed, lib);
    assert.equal(kitEntries.find(k => k.code === 'H1-2TRV-4/P').status, 'UPDATE');
    assert.equal(kitEntries.find(k => k.code === 'H1-2TRV-4/W').status, 'NEW');
    assert.equal(compEntries.find(c => c.code === 'HTSLNTCAR').status, 'ALIGN');
    assert.equal(compEntries.find(c => c.code === 'HSOM-41').status, 'MISSING');
});

test('the pricing row carries the per-foot triple for kits and omits it for components', { skip }, () => {
    const kit = parsed.kits.find(x => x.code === 'H1-2TRV-4/P');
    const row = kitPricingRow(kit, { customerId: 'CUST-1', customerName: 'Fabricut', user: 'test' });
    assert.equal(row.clientSku, 'HTS7504F');
    assert.deepEqual([row.price, row.clientSalesPrice, row.clientRetailPrice], [203, 406, 812]);
    assert.deepEqual([row.perFootPrice, row.perFootSales, row.perFootRetail], [50, 100, 200]);
    const comp = parsed.components.find(c => c.code === 'HTSLNTCAR');
    const crow = kitPricingRow(comp, { customerId: 'CUST-1' });
    assert.equal(crow.perFootPrice, undefined);
    assert.equal(crow.price, 0.5);
});
