// Harness for simpleKits — the 50 basic app kits read off 0903/H1-SimpleKits.xlsx.
//
//   node scripts/simpleKits.test.mjs
//
// The cases that matter are the refusals. A kit that quietly explodes into the wrong parts is not
// visible on a quote — it shows up as the wrong thing in a box, or a NetSuite line nobody ordered.
// So: a code the library does not carry, a kit listing itself, a rider that the tag engine already
// places, the same row twice, and a component named twice in one row.

import {
    simpleKitRowsOf, buildKitCodeIndex, planSimpleKits, kitPatchOf, simpleKitSummary, simpleKitPlanText,
    KIT_READY, KIT_NO_ITEM, KIT_NO_COMPONENTS, KIT_MISSING, KIT_SELF, KIT_RIDER, KIT_DUPLICATE,
} from '../src/components/Shared/simpleKits.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`);
};
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };

// ── READING THE SHEET ────────────────────────────────────────────────────────────────────────
{
    const table = {
        header: ['Item', 'Kit Comp 1', 'Kit Comp 2', 'Kit Comp3', 'Kit Comp 4', 'Kit Comp 5'],
        cells: [
            ['H1-2TRV-WB', 'H1-2TRVBP', 'H1-2TRVLA', 'H1-2TRVBA', '', ''],
            ['H1-2TRV-DRTWB', 'H1-2TRVBP', 'H1-2TRVLA', 'H1-2TRVFTDA', 'H1-2TRVFH', ''],
            ['', '', '', '', '', ''],
        ],
    };
    const { rows, error } = simpleKitRowsOf(table);
    eq('blank rows are dropped', rows.length, 2);
    eq('the components are the filled Kit Comp columns, in order', rows[1],
        { item: 'H1-2TRV-DRTWB', components: ['H1-2TRVBP', 'H1-2TRVLA', 'H1-2TRVFTDA', 'H1-2TRVFH'] });
    eq('no error on a good sheet', error, '');
    // Header-matched, not position-matched: the columns may move.
    const moved = simpleKitRowsOf({ header: ['Kit Comp 1', 'Item', 'Kit Comp 2'], cells: [['A-COMP', 'A-KIT', 'B-COMP']] });
    eq('a reordered sheet still reads correctly', moved.rows[0], { item: 'A-KIT', components: ['A-COMP', 'B-COMP'] });
    ok('a sheet without the columns is refused, not guessed at',
        !!simpleKitRowsOf({ header: ['Thing', 'Other'], cells: [['x', 'y']] }).error);
}

// ── THE PLAN ─────────────────────────────────────────────────────────────────────────────────
{
    const parts = [
        { id: 'k1', legacyErpId: 'H1-2TRV-WB', itemName: 'Wall bracket kit' },
        { id: 'c1', legacyErpId: 'H1-2TRVBP', itemName: 'Backplate' },
        { id: 'c2', legacyErpId: 'H1-2TRVLA', itemName: 'L arm' },
        { id: 'c3', legacyErpId: 'H1-2TRVBA', itemName: 'Arm 3.995' },
        { id: 'n1', legacyErpId: 'H1-2TRVNUT', itemName: 'Nut' },
        { id: 'k2', legacyErpId: 'H1-138AKF', itemName: 'Acrylic knob finial' },
        { id: 'a1', legacyErpId: 'H1-138FC2', itemName: 'Collar' },
        { id: 'a2', legacyErpId: 'H1-138ACKF', itemName: 'Acrylic knob' },
    ];

    const good = planSimpleKits({ rows: [{ item: 'H1-2TRV-WB', components: ['H1-2TRVBP', 'H1-2TRVLA', 'H1-2TRVBA'] }], parts });
    eq('a good row is READY', good[0].status, KIT_READY);
    eq('components resolve to DOC IDS, which is what kitComponents holds',
        good[0].components.map(c => c.partId), ['c1', 'c2', 'c3']);
    eq('the patch writes exactly three fields and no kitAlign', Object.keys(kitPatchOf(good[0])).sort(),
        ['manufacturingSpecs', 'partClass', 'routingType']);
    eq('…and the patch body is the component list', kitPatchOf(good[0]).manufacturingSpecs,
        { kitComponents: [{ partId: 'c1', qty: 1 }, { partId: 'c2', qty: 1 }, { partId: 'c3', qty: 1 }] });
    eq('routingType is cleared — a kit routes nothing', kitPatchOf(good[0]).routingType, '');
    ok('kitAlign is never written — that would make it a SYSTEM kit',
        !('kitAlign' in kitPatchOf(good[0]).manufacturingSpecs));

    // ⚠ THE NUT. Placed by the tag engine already; in the kit as well it is counted twice.
    const nut = planSimpleKits({ rows: [{ item: 'H1-2TRV-WB', components: ['H1-2TRVBP', 'H1-2TRVNUT'] }], parts });
    eq('a rider component is refused even though the part exists', nut[0].status, KIT_RIDER);
    ok('…and says why', /twice/.test(nut[0].why));

    // A component named twice is a quantity, not two lines — they multiply downstream.
    const twice = planSimpleKits({ rows: [{ item: 'H1-138AKF', components: ['H1-138FC2', 'H1-138FC2', 'H1-138ACKF'] }], parts });
    eq('a repeated component becomes a quantity', twice[0].components, [
        { partId: 'a1', code: 'H1-138FC2', qty: 2 }, { partId: 'a2', code: 'H1-138ACKF', qty: 1 }]);

    // The refusals.
    eq('an unknown kit code is refused by name',
        planSimpleKits({ rows: [{ item: 'H1-NOPE', components: ['H1-2TRVBP'] }], parts })[0].status, KIT_NO_ITEM);
    eq('an unknown COMPONENT refuses the whole row — a half-built kit is worse than none',
        planSimpleKits({ rows: [{ item: 'H1-2TRV-WB', components: ['H1-2TRVBP', 'H1-GHOST'] }], parts })[0].status, KIT_MISSING);
    eq('…naming what was missing',
        planSimpleKits({ rows: [{ item: 'H1-2TRV-WB', components: ['H1-GHOST'] }], parts })[0].missing, ['H1-GHOST']);
    eq('a kit listing ITSELF is refused (the sheet had one)',
        planSimpleKits({ rows: [{ item: 'H1-2TRV-WB', components: ['H1-2TRV-WB'] }], parts })[0].status, KIT_SELF);
    eq('a row with no components is refused',
        planSimpleKits({ rows: [{ item: 'H1-2TRV-WB', components: [] }], parts })[0].status, KIT_NO_COMPONENTS);
    eq('the same kit twice takes the first only',
        planSimpleKits({ rows: [{ item: 'H1-2TRV-WB', components: ['H1-2TRVBP'] }, { item: 'H1-2TRV-WB', components: ['H1-2TRVLA'] }], parts }).map(r => r.status),
        [KIT_READY, KIT_DUPLICATE]);
    eq('two records sharing one code is refused, not resolved',
        planSimpleKits({ rows: [{ item: 'DUP', components: ['H1-2TRVBP'] }], parts: [...parts, { id: 'x', itemId: 'DUP' }, { id: 'y', itemId: 'DUP' }] })[0].status, KIT_NO_ITEM);

    // Nothing is dropped on the floor: one result per row.
    const mixed = planSimpleKits({
        rows: [{ item: 'H1-2TRV-WB', components: ['H1-2TRVBP'] }, { item: 'H1-NOPE', components: ['H1-2TRVBP'] }], parts });
    eq('one row out per row in', mixed.length, 2);
    eq('summary counts them', simpleKitSummary(mixed), { [KIT_READY]: 1, [KIT_NO_ITEM]: 1 });
    const text = simpleKitPlanText(mixed);
    ok('the plan names what will be written', /1 kit\(s\) will be set/.test(text));
    ok('and every skip with its reason', /1 row\(s\) will be SKIPPED/.test(text) && /H1-NOPE/.test(text));
    ok('and promises what it will not touch', /pricing and aliases .* not touched/.test(text));
    ok('an empty batch says so plainly', /Nothing to write/.test(simpleKitPlanText([])));
}

// ── THE INDEX ────────────────────────────────────────────────────────────────────────────────
{
    const ix = buildKitCodeIndex([{ id: 'a', legacyErpId: 'X-1', itemId: 'X-1' }, { id: 'b', itemId: 'X-2' }]);
    eq('one record under two identical keys is listed once', ix.get('X-1').length, 1);
    eq('itemId alone is a key too', ix.get('X-2').length, 1);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
