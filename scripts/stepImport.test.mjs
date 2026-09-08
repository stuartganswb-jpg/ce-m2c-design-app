// Shared/stepImport — the STEP review path. The pure parts are tested on fixtures; the real
// reader (the same occt-import-js version vendored under public/occt/, pinned as a devDependency)
// is run against Stuart's two 0903 motor-mount halves WHEN they are present — the offline proof
// that a STEP converts before anyone looks at a screen. Absent files or reader = those tests skip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isStepFile, codeFromFileName, stepUnitOf, meshToArrays, summarize, READ_PARAMS } from '../src/components/Shared/stepImport.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a STEP file is recognised by either spelling', () => {
    assert.equal(isStepFile('part.stp'), true);
    assert.equal(isStepFile('PART.STEP'), true);
    assert.equal(isStepFile('part.glb'), false);
    assert.equal(isStepFile(''), false);
});

test('the code and the description come from the designer\'s file name', () => {
    assert.deepEqual(codeFromFileName('MO-26001-01, Curtain Motor Mount, Top Half.stp'), { code: 'MO-26001-01', description: 'Curtain Motor Mount, Top Half' });
    assert.deepEqual(codeFromFileName('h1-138bp.STEP'), { code: 'H1-138BP', description: '' });
    assert.deepEqual(codeFromFileName('MO-26001-02 bottom.stp'), { code: 'MO-26001-02', description: '' });
});

test('the file\'s declared unit is read for display only', () => {
    assert.equal(stepUnitOf("#25 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.CENTI.,.METRE.) );"), 'cm');
    assert.equal(stepUnitOf("SI_UNIT(.MILLI.,.METRE.)"), 'mm');
    assert.equal(stepUnitOf("SI_UNIT($,.METRE.)"), 'm');
    assert.equal(stepUnitOf("CONVERSION_BASED_UNIT('INCH',#12)"), 'in');
    assert.equal(stepUnitOf("SI_UNIT($,.RADIAN.)"), '');
});

test('a reader mesh becomes typed arrays with its size; a mesh with no positions is dropped', () => {
    const mesh = { name: 'Document', attributes: { position: { array: [0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0.5] }, normal: { array: new Array(12).fill(0) } }, index: { array: [0, 1, 2, 0, 2, 3] } };
    const m = meshToArrays(mesh);
    assert.equal(m.tris, 2);
    assert.deepEqual(m.size, [2, 1, 0.5]);
    assert.ok(m.position instanceof Float32Array && m.index instanceof Uint32Array);
    assert.equal(meshToArrays({ attributes: { position: { array: [] } } }), null);
    const s = summarize({ meshes: [mesh, { attributes: { position: { array: [5, 5, 5, 6, 5, 5, 6, 6, 5] } }, index: { array: [0, 1, 2] } }] });
    assert.deepEqual([s.count, s.tris], [2, 3]);
    assert.deepEqual(s.size, [6, 6, 5], 'the whole model\'s size is the union of its meshes');
});

// ── the real thing: Stuart's two 0903 files through the real reader ──────────────────────────
const samples = ['0903/MO-26001-01, Curtain Motor Mount, Top Half.stp', '0903/MO-26001-02, Curtain Motor Mount, Bottom Half.stp']
    .map(p => path.join(ROOT, p)).filter(p => fs.existsSync(p));
let occtFactory = null;
try { occtFactory = require('occt-import-js'); } catch (e) { occtFactory = null; }

test('the two motor-mount halves convert in node, in inches, at a plausible size', { skip: !samples.length || !occtFactory ? 'no 0903 samples or reader installed' : false }, async () => {
    const occt = await occtFactory();
    for (const f of samples) {
        const r = occt.ReadStepFile(new Uint8Array(fs.readFileSync(f)), READ_PARAMS);
        assert.equal(r.success, true, path.basename(f));
        const s = summarize(r);
        assert.ok(s.count >= 1 && s.tris > 1000, `${path.basename(f)}: ${s.count} mesh(es), ${s.tris} tris`);
        const [x, y, z] = s.size;
        assert.ok(Math.max(x, y, z) > 4 && Math.max(x, y, z) < 7 && Math.min(x, y, z) > 0.5, `size in inches ${s.size.map(v => v.toFixed(2)).join(' × ')}`);
        console.log(`  ${path.basename(f)}: ${s.count} mesh, ${s.tris} tris, ${s.size.map(v => v.toFixed(2)).join(' × ')} in`);
    }
});
