// Harness for drawingImport — item pictures from a drawing, matched by filename.
//
//   node scripts/drawingImport.test.mjs
//
// The whole point of this module is that it does NOT do what 14.5 does: split the filename on its
// last hyphen and read a short tail as a finish code. Four of the seven H1-2TRV arm filenames lose
// against that rule, and three of them land on a real part — so the first block below is the one
// that matters. The rest prove the refusals: a code nobody carries, a code two records carry, the
// same code twice in one batch, and a part that already has a photograph.

import {
    codeFromFilename, buildCodeIndex, planDrawingImport, drawingSummary, drawingPlanText,
    DRAW_READY, DRAW_NO_CODE, DRAW_NO_MATCH, DRAW_AMBIGUOUS, DRAW_DUPLICATE, DRAW_HAS_PHOTO,
} from '../src/components/Shared/drawingImport.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`);
};
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };

// ── THE FILENAME IS THE WHOLE CODE ───────────────────────────────────────────────────────────
// Exactly the seven files cut from "2TRV 5/8 arms", including the four 14.5 would misread.
eq('the extension is dropped and nothing else', codeFromFilename('H1-2TRVBDBL-MA.png'), 'H1-2TRVBDBL-MA');
eq('a short tail is NOT taken as a finish', codeFromFilename('H1-2TRVBADBL-T.png'), 'H1-2TRVBADBL-T');
eq('a six-character tail is NOT taken as a finish', codeFromFilename('H1-2TRVBA.png'), 'H1-2TRVBA');
eq('case and padding do not matter', codeFromFilename('  h1-2trvba6.PNG '), 'H1-2TRVBA6');
eq('other extensions too', codeFromFilename('H1-2TRVFH.jpeg'), 'H1-2TRVFH');
eq('a name with no extension still reads', codeFromFilename('H1-2TRVLA'), 'H1-2TRVLA');
eq('an empty name yields no code', codeFromFilename(''), '');

// ── THE INDEX ────────────────────────────────────────────────────────────────────────────────
{
    const parts = [
        { id: 'a', legacyErpId: 'H1-2TRVBA', itemName: 'Arm 3.995' },
        { id: 'b', itemId: 'H1-2TRVBA6', itemName: 'Arm 6.37' },
        { id: 'c', legacyErpId: 'H1-2TRVBADBL', itemId: 'H1-2TRVBADBL', itemName: 'Arm 6.87' },
    ];
    const ix = buildCodeIndex(parts);
    eq('both identity fields are keys', [ix.get('H1-2TRVBA').length, ix.get('H1-2TRVBA6').length], [1, 1]);
    eq('one record under two identical keys is listed once', ix.get('H1-2TRVBADBL').length, 1);
    ok('an unknown code is absent', !ix.get('H1-2TRVNOPE'));
}

// ── THE PLAN ─────────────────────────────────────────────────────────────────────────────────
{
    const parts = [
        { id: 'p1', legacyErpId: 'H1-2TRVBADBL', itemName: 'Arm 6.87' },
        { id: 'p2', legacyErpId: 'H1-2TRVBDBL-MA', itemName: 'Mount arm 6.465' },
        { id: 'p3', legacyErpId: 'H1-2TRVBDBL-TA', itemName: 'Top arm 5.606' },
        { id: 'p4', legacyErpId: 'H1-2TRVBADBL-T', itemName: 'Arm 4.238' },
        { id: 'p5', legacyErpId: 'H1-2TRVBA', itemName: 'Arm 3.995' },
        // The parts 14.5's split would have hit instead — present, so a mis-target is detectable.
        { id: 'p6', legacyErpId: 'H1-2TRVBDBL', itemName: 'Double bracket, assembled' },
        { id: 'p7', legacyErpId: 'H1', itemName: 'Something else entirely' },
        { id: 'p8', legacyErpId: 'H1-2TRVBAE', itemName: 'Arm 4.994', finalImageUrl: 'photo.jpg' },
    ];
    const files = ['H1-2TRVBADBL.png', 'H1-2TRVBDBL-MA.png', 'H1-2TRVBDBL-TA.png',
        'H1-2TRVBADBL-T.png', 'H1-2TRVBA.png'].map(name => ({ name }));
    const rows = planDrawingImport({ files, parts });

    eq('every file is READY', rows.map(r => r.status), Array(5).fill(DRAW_READY));
    eq('and each lands on its OWN part, not the one a hyphen-split would find',
        rows.map(r => r.part.id), ['p1', 'p2', 'p3', 'p4', 'p5']);
    ok('the assembled double bracket is never targeted', !rows.some(r => r.part.id === 'p6'));
    ok('and neither is H1', !rows.some(r => r.part.id === 'p7'));

    // A part with a photograph is left alone — Stuart 2026-09-21: "2. skip it".
    const withPhoto = planDrawingImport({
        files: [{ name: 'H1-2TRVBAE.png' }], parts,
        hasPhoto: (p) => !!p.finalImageUrl,
    });
    eq('a part that already has a photograph is skipped', withPhoto[0].status, DRAW_HAS_PHOTO);
    ok('…and says why', /photograph/.test(withPhoto[0].why));

    // The refusals.
    eq('a code no item carries is refused by name',
        planDrawingImport({ files: [{ name: 'H1-NOSUCHPART.png' }], parts })[0].status, DRAW_NO_MATCH);
    eq('…naming the code', planDrawingImport({ files: [{ name: 'H1-NOSUCHPART.png' }], parts })[0].why,
        'no item on this brand carries the code H1-NOSUCHPART');
    eq('two records on one code is refused, not resolved',
        planDrawingImport({ files: [{ name: 'DUP.png' }], parts: [{ id: 'x', itemId: 'DUP' }, { id: 'y', itemId: 'DUP' }] })[0].status, DRAW_AMBIGUOUS);
    eq('the same code twice in one batch takes the first only',
        planDrawingImport({ files: [{ name: 'H1-2TRVBA.png' }, { name: 'H1-2TRVBA.PNG' }], parts }).map(r => r.status),
        [DRAW_READY, DRAW_DUPLICATE]);
    eq('a nameless file is refused', planDrawingImport({ files: [{ name: '' }], parts })[0].status, DRAW_NO_CODE);

    // Nothing is ever dropped on the floor: one row out per file in.
    const mixed = planDrawingImport({
        files: [{ name: 'H1-2TRVBA.png' }, { name: 'H1-NOSUCHPART.png' }, { name: '' }], parts,
    });
    eq('one row per file, in order', mixed.length, 3);
    eq('summary counts them', drawingSummary(mixed), { [DRAW_READY]: 1, [DRAW_NO_MATCH]: 1, [DRAW_NO_CODE]: 1 });

    const text = drawingPlanText(mixed);
    ok('the plan text lists what will be written', /1 picture\(s\) will be written/.test(text));
    ok('and every skip with its reason', /2 file\(s\) will be SKIPPED/.test(text) && /H1-NOSUCHPART/.test(text));
    ok('an empty batch says so plainly', /Nothing to write/.test(drawingPlanText([])));
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
