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

// ── THE SECOND FAMILY: tab H1-138TRV (Stuart 2026-09-10) ───────────────────────────────────────
const f138 = HAVE ? parsed.families.find(f => f.family === 'H1-138TRV') : null;

test('H1-138TRV rides the same workbook — 8 kits, 19 components — and the H1-2TRV result does not move', { skip }, () => {
    assert.equal(parsed.families.length, 2);
    assert.equal(parsed.families[0].family, 'H1-2TRV');
    assert.equal(parsed.kits.length, 30);                       // the top level is still H1-2TRV's
    assert.ok(parsed.kits.every(k => !/138TRV/.test(k.code)));   // no 1-3/8" kit leaked into it
    assert.ok(f138, 'no H1-138TRV family parsed');
    assert.equal(f138.kits.length, 8);
    assert.ok(f138.kits.every(k => k.motorCodes.length === 0)); // hand-drawn only — no per-motor codes
    assert.ok(f138.components.some(c => c.code === 'H1-138TRVJNR'));
    assert.ok(!f138.components.some(c => /^H1-138TRV-4/.test(c.code)), 'a kit code landed among the components');
    // FABRICUT'S BRACKET IS TWO OF OUR ITEMS: the 18 combo codes become 10 arm rows (5 arms × P/EP)
    // and 6 plate rows (3 plates × P/EP) — no combo code survives as a component of its own
    assert.equal(f138.mapped.length, 18);
    assert.ok(!f138.components.some(c => /^H1-138TRV-[HVC]/.test(c.code)), 'a combo code survived as a component');
    const arms = f138.components.filter(c => /BA$/.test(c.code)); const plates = f138.components.filter(c => /BP-/.test(c.code));
    assert.equal(arms.length, 10); assert.equal(plates.length, 6);
    assert.equal(f138.components.length, 17);                   // 10 arms + 6 plates + the splice
});

test('H1-138TRV: the arm carries the combo price with the H pattern; the plates carry $0 and their own patterns', { skip }, () => {
    const c = (code, tier) => f138.components.find(x => x.code === code && x.finishTier === tier);
    assert.deepEqual([c('H1-138TRVSBA', 'P').net, c('H1-138TRVSBA', 'P').fabSku, c('H1-138TRVSBA', 'P').derivedFrom], [30, 'H3628F', 'H1-138TRV-H/P']);
    assert.deepEqual([c('H1-138TRVSBA', 'EP').net, c('H1-138TRVSBA', 'EP').fabSku], [40, 'H3628F PREMIUM']);
    assert.deepEqual([c('H1-138TRVEBA', 'P').net, c('H1-138TRV6BA', 'P').net, c('H1-138TRVDBA', 'P').net, c('H1-138TRVCBA', 'P').net], [32, 34, 36, 32]);
    assert.deepEqual([c('H1-138TRVDBA', 'P').fabSku, c('H1-138TRVCBA', 'EP').fabSku], ['H3632F', 'H3633F PREMIUM']);
    // the plates: $0, the standard-depth pattern of their own orientation
    assert.deepEqual([c('H1-138TRVBP-V', 'P').net, c('H1-138TRVBP-V', 'P').fabSku, c('H1-138TRVBP-V', 'P').derivedFrom], [0, 'H3625F', 'H1-138TRV-V/P']);
    assert.deepEqual([c('H1-138TRVBP-H', 'EP').net, c('H1-138TRVBP-H', 'EP').fabSku], [0, 'H3628F PREMIUM']);
    assert.deepEqual([c('H1-138TRVBP-C', 'P').net, c('H1-138TRVBP-C', 'P').fabSku], [0, 'H3633F']);
    // H and V price alike on the sheet, so no disagreement warning
    assert.ok(!f138.warnings.some(w => /prices differently/.test(w)), f138.warnings.join('; '));
    // the splice is a plain component, no tier
    assert.equal(f138.components.find(x => x.code === 'H1-138TRVJNR').finishTier, undefined);
});

test('H1-138TRV axes come off the code: style, double, finish, and the two fields this family adds', { skip }, () => {
    const k = (code) => f138.kits.find(x => x.code === code);
    assert.deepEqual(k('H1-138TRV-4H/P').align,
        { setup: 'SINGLE', frontRail: 'TRACK', drive: 'MANUAL', mount: 'WALL', material: 'P', minFeet: 4, rodKind: 'TRAVERSE', bracketStyle: 'H' });
    assert.deepEqual(k('H1-138TRV-4VD/EP').align,
        { setup: 'DOUBLE', frontRail: 'TRACK', drive: 'MANUAL', mount: 'WALL', material: 'EP', minFeet: 4, rodKind: 'TRAVERSE', bracketStyle: 'V' });
    assert.equal(k('H1-138TRV-4H/P').fabSku, 'HTS7500F');
    assert.equal(k('H1-138TRV-4H/EP').fabSku, 'HTS7500F PREMIUM');
    assert.deepEqual([k('H1-138TRV-4H/P').net, k('H1-138TRV-4H/P').sales, k('H1-138TRV-4H/P').retail], [136, 272, 544]);
    assert.deepEqual([k('H1-138TRV-4H/P').perFootNet, k('H1-138TRV-4H/P').perFootSales, k('H1-138TRV-4H/P').perFootRetail], [30, 60, 120]);
    assert.deepEqual([k('H1-138TRV-4HD/EP').perFootNet, k('H1-138TRV-4HD/EP').perFootSales, k('H1-138TRV-4HD/EP').perFootRetail], [102.5, 187, 374]);
    // components carry their price and no per-foot triple (the arm row stands for the combo)
    const v = f138.components.find(c => c.code === 'H1-138TRVSBA' && c.finishTier === 'P');
    assert.deepEqual([v.net, v.sales, v.retail, v.perFootNet], [30, 60, 120, undefined]);
    assert.equal(f138.components.find(c => c.code === 'H1-138TRVJNR').net, 6);
});

test('H1-138TRV rules are DERIVED from the H1-2TRV usage table: carriers verbatim, brackets re-keyed per style, the joiner as the splice', { skip }, () => {
    const u = (id) => f138.rules.usage.find(x => x.itemId === id);
    assert.equal(f138.rules.family, 'H1-138TRV');
    assert.ok(/H1-2TRV/.test(f138.rules.derivedFrom));
    // carriers: the same three rows, the same counts
    assert.equal(u('HTSLNTCAR').byFeet[4], 16);
    assert.equal(u('HTRF100N-500').byFeet[36], 216);
    // brackets: the ARM rows by depth with H1-2TRV's counts, and a PLATE row per orientation
    assert.equal(u('H1-138TRVSBA').byFeet[10], 4);
    assert.equal(u('H1-138TRVEBA').byFeet[4], 2);
    assert.equal(u('H1-138TRV6BA').byFeet[36], parsed.rules.usage.find(x => x.itemId === 'H1-2TRV-6WB').byFeet[36]);
    assert.equal(u('H1-138TRVDBA').derivedFrom, 'H1-2TRV-DWB');
    assert.equal(u('H1-138TRVBP-H').byFeet[10], 4);
    assert.equal(u('H1-138TRVBP-V').byFeet[10], 4);
    assert.ok(/one per bracket/.test(u('H1-138TRVBP-V').label));
    assert.equal(u('H1-138TRV-H'), undefined, 'a combo code is not a usage row');
    // no H1-2TRV code survives in this family's doc, and the ring-front double has no equivalent
    assert.ok(f138.rules.usage.every(x => !/^H1-2TRV/.test(x.itemId)), 'an H1-2TRV bracket code leaked into the H1-138TRV rules');
    assert.ok(!f138.rules.usage.some(x => x.derivedFrom === 'H1-2TRV-DRTWB'));
    assert.ok(f138.warnings.some(w => /DRTWB/.test(w)), 'the dropped row is not named');
    // the splice: the joiner, same threshold
    assert.equal(u('H1-138TRVJNR').byFeet[10], 0);
    assert.equal(u('H1-138TRVJNR').byFeet[11], 1);
    assert.equal(u('H1-2TRVSPLC'), undefined);
    // configurator: the same picks and accessories, the splice pick re-keyed
    const cfg = (id) => f138.rules.configurator.find(x => x.itemId === id);
    assert.equal(cfg('HMTCL/01').drive, 'MANUAL');
    assert.equal(cfg('HTTENDSTOP').drive, 'BOTH');
    assert.equal(cfg('HSOM-40').billable, true);
    assert.equal(cfg('H1-138TRVJNR').drive, 'BOTH');
    assert.equal(cfg('H1-2TRVSPLC'), undefined);
    assert.equal(f138.rules.configurator.length, parsed.rules.configurator.length);
});

test('diff and pricing rows carry the family, so the apply writes the right kitFamily and rules doc', { skip }, () => {
    // the library as it stands: arms and plates in /P, /EP1…/EP6, /P25 (read live 2026-09-10) — a
    // slice of it here, with the ceiling plate deliberately absent
    const lib = new Map([['H1-138TRV-4H/P', { id: 'KIT-138' }],
        ['H1-138TRVSBA/P', { id: 'sba-p' }], ['H1-138TRVSBA/EP1', { id: 'sba-ep1' }], ['H1-138TRVSBA/EP2', { id: 'sba-ep2' }], ['H1-138TRVSBA/P25', { id: 'sba-p25' }], ['H1-138TRVSBA', { id: 'sba' }],
        ['H1-138TRVBP-V/P', { id: 'bpv-p' }], ['H1-138TRVBP-V/EP1', { id: 'bpv-ep1' }], ['H1-138TRVJNR', { id: 'jnr' }]]);
    const { kitEntries, compEntries } = diffTraverseKits(parsed, lib);
    assert.equal(kitEntries.length, 38);                                    // 30 + 8
    assert.equal(kitEntries.find(k => k.code === 'H1-138TRV-4H/P').status, 'UPDATE');
    assert.equal(kitEntries.find(k => k.code === 'H1-138TRV-4H/P').family, 'H1-138TRV');
    assert.equal(kitEntries.find(k => k.code === 'H1-138TRV-4V/P').status, 'NEW');
    assert.equal(kitEntries.find(k => k.code === 'H1-2TRV-4/P').family, 'H1-2TRV');
    // /P → the one paint item; EP → every plated variant that exists, P25 included, the base never
    const sba = compEntries.filter(c => /^H1-138TRVSBA/.test(c.code));
    assert.deepEqual(sba.map(c => [c.code, c.status, c.net]).sort(), [['H1-138TRVSBA/EP1', 'ALIGN', 40], ['H1-138TRVSBA/EP2', 'ALIGN', 40], ['H1-138TRVSBA/P', 'ALIGN', 30], ['H1-138TRVSBA/P25', 'ALIGN', 40]]);
    assert.equal(compEntries.find(c => c.code === 'H1-138TRVBP-V/P').net, 0);
    assert.equal(compEntries.find(c => c.code === 'H1-138TRVBP-V/EP1').status, 'ALIGN');
    // nothing to land on → MISSING, named by FABRICUT's code so the operator recognises it
    assert.equal(compEntries.find(c => c.code === 'H1-138TRV-C/EP').status, 'MISSING');
    assert.equal(compEntries.find(c => c.code === 'H1-138TRV-HE/P').status, 'MISSING');
    assert.ok(!compEntries.some(c => c.code === 'H1-138TRVBP-C/P'));
    assert.equal(compEntries.find(c => c.code === 'H1-138TRVJNR').status, 'ALIGN');
    // and the H1-2TRV components diff exactly as before
    assert.equal(compEntries.find(c => c.code === 'HSOM-41').status, 'MISSING');
    const row = kitPricingRow(f138.kits.find(k => k.code === 'H1-138TRV-4H/P'), { customerId: 'CUST-1', customerName: 'Fabricut', user: 'test' });
    assert.equal(row.clientSku, 'HTS7500F');
    assert.deepEqual([row.price, row.clientSalesPrice, row.clientRetailPrice], [136, 272, 544]);
    assert.deepEqual([row.perFootPrice, row.perFootSales, row.perFootRetail], [30, 60, 120]);
});

test('a workbook without the H1-138TRV tab parses exactly as before — one family', { skip }, () => {
    const one = parseTraverseKitSheets(JSON.parse(readFileSync('./kit_sheet.json', 'utf8')).filter(s => s.name !== 'H1-138TRV'));
    assert.equal(one.families.length, 1);
    assert.equal(one.kits.length, 30);
    assert.ok(!one.warnings.some(w => /138TRV/.test(w)));
});
