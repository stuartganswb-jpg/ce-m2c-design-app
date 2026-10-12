// scripts/sync-engine — the engine's copy for the portal's server, and the wiring that makes it (PORTAL, 2026-10-12).
// Run: node scripts/syncEngine.test.mjs
// Everything is done in a temp folder; functions/engine/ is never read or written here (a deploy makes that one).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_DIR, ENGINE_DOORS, ENGINE_ROOTS, SERVER_COPY, importsOf, dynamicImportsOf, engineClosure, mirrorPlan, mirrorDiff, writeMirror, smokeLoad, main } from './sync-engine.mjs';
import { computeEngineVersion, stampSource } from './_lib/engineVersion.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('  ✗', name); } };
const tmp = mkdtempSync(join(tmpdir(), 'sync-engine-'));
const quiet = () => { const lines = []; return { log: (s) => lines.push(String(s)), error: (s) => lines.push(String(s)), lines }; };

try {
    // ── importsOf: statements only ───────────────────────────────────────────────────────────
    const sample = [
        "import { a } from './a.js';",
        "import b, { c as d } from './b.js';",
        "import {",
        "    e,",
        "    f,",
        "} from './multi.js';",
        "import './side.js';",
        "export { g } from './g.js';",
        "export * from './star.js';",
        "export * as ns from './ns.js';",
        "// import x from './commented.js';",
        " * import y from './jsdoc.js';",
        "const s = \"import z from './string.js'\";",
        "    import q from './indented.js';",
        "const lazy = () => import('./lazy.js');",
        "export { local };",
    ].join('\n');
    const got = importsOf(sample);
    ok('importsOf reads import / import-with-default / multi-line / side-effect', ['./a.js', './b.js', './multi.js', './side.js'].every(x => got.includes(x)));
    ok('importsOf reads export … from, export *, export * as', ['./g.js', './star.js', './ns.js'].every(x => got.includes(x)));
    ok('importsOf ignores a commented line, a JSDoc line, a string and an indented line', !['./commented.js', './jsdoc.js', './string.js', './indented.js'].some(x => got.includes(x)));
    ok('importsOf leaves import() to dynamicImportsOf', !got.includes('./lazy.js') && dynamicImportsOf(sample).includes('./lazy.js'));
    ok('a plain `export { local }` is not an import', got.length === 7);

    // ── the closure, on the real engine ──────────────────────────────────────────────────────
    const real = engineClosure(REPO);
    const names = [...real.files.keys()];
    ok(`the real engine breaks no rule (${real.problems.join(' | ') || 'none'})`, real.problems.length === 0);
    ok('every door is in it', ENGINE_ROOTS.every(r => names.includes(r)));
    ok('what the doors reach is in it without being listed (the stamp, the tiers, the sizes, the twin, the questions)',
        ['engineVersion.js', 'priceLevels.js', 'sizeMatrix.js', 'materialTwin.js', 'finishQuestions.js', 'kitSeed.js'].every(n => names.includes(n)));
    ok(`it is the engine and not the app (${names.length} files)`, names.length >= 20 && names.length < 60);
    ok('it is in name order, the same on every machine', names.join('|') === [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('|'));
    ok('nothing with a screen in it (no React shell, no CPQ tab)', !names.some(n => /HardwareConfigurator|CPQTab|studioScene/.test(n)));

    // ── the rule, on engines built to break it ───────────────────────────────────────────────
    const fake = (files) => {
        const repo = mkdtempSync(join(tmp, 'repo-'));
        const dir = join(repo, ...ENGINE_DIR.split('/'));
        mkdirSync(dir, { recursive: true });
        Object.entries(files).forEach(([n, src]) => { mkdirSync(dirname(join(dir, n)), { recursive: true }); writeFileSync(join(dir, n), src); });
        return repo;
    };
    const clean = engineClosure(fake({ 'door.js': "import { x } from './x.js';\nexport const d = x;", 'x.js': "import './sub/y.js';\nexport const x = 1;", 'sub/y.js': "import '../z.js';", 'z.js': 'export const z = 1;', 'unused.js': '' }), ['door.js']);
    ok('a clean engine: no problem, every file reached, nothing unreached', clean.problems.length === 0 && [...clean.files.keys()].join(',') === 'door.js,sub/y.js,x.js,z.js');
    const pkg = engineClosure(fake({ 'door.js': "import React from 'react';\nimport { x } from './x.js';", 'x.js': '' }), ['door.js']);
    ok('a package import is refused, by file and by package', pkg.problems.length === 1 && /door\.js imports the package "react"/.test(pkg.problems[0]));
    ok('…and the rest of the engine is still walked', pkg.files.has('x.js'));
    const noExt = engineClosure(fake({ 'door.js': "import { x } from './x';", 'x.js': '' }), ['door.js']);
    ok('an import without .js is refused, and says what to write', noExt.problems.length === 1 && /without the \.js extension/.test(noExt.problems[0]) && /"\.\/x\.js"/.test(noExt.problems[0]));
    const outside = engineClosure(fake({ 'door.js': "import { C } from '../HQ/CPQTab.js';" }), ['door.js']);
    ok('an import from outside the engine folder is refused', outside.problems.length === 1 && /outside src\/components\/Shared/.test(outside.problems[0]));
    const gone = engineClosure(fake({ 'door.js': "import { x } from './gone.js';" }), ['door.js']);
    ok('an import of a file that is not there is refused, naming who asked', gone.problems.length === 1 && /door\.js imports gone\.js/.test(gone.problems[0]));
    const noDoor = engineClosure(fake({ 'x.js': '' }), ['door.js']);
    ok('a door that is not there is refused', noDoor.problems.length === 1 && /ENGINE_DOORS imports door\.js/.test(noDoor.problems[0]));
    const dyn = engineClosure(fake({ 'door.js': "const a = () => import('./lazy.js');\nconst b = () => import('three');\n// see import('./prose.js')", 'lazy.js': '' }), ['door.js']);
    ok('import() of a real engine file is followed; of a package or of prose, never judged', dyn.problems.length === 0 && dyn.files.has('lazy.js') && dyn.files.size === 2);

    // ── the copy ─────────────────────────────────────────────────────────────────────────────
    const { plan, problems, version, closureHash, engineFiles } = mirrorPlan(REPO);
    const fn = join(tmp, 'functions');               // laid out as functions/ is: index beside engine/
    const copy = join(fn, 'engine');
    mkdirSync(fn, { recursive: true });
    ok('the plan has no problems and names the engine', problems.length === 0 && version === computeEngineVersion(REPO) && /^[0-9a-f]{16}$/.test(closureHash));
    const first = writeMirror(plan, copy);
    ok(`the first copy writes everything (${first.written})`, first.written === engineFiles.length + 2 && first.removed === 0);
    ok('…and then nothing differs', mirrorDiff(plan, copy).same);
    const src = (n) => readFileSync(join(REPO, ...ENGINE_DIR.split('/'), ...n.split('/')));
    ok('every engine file is its source byte for byte — except the stamp', engineFiles.filter(n => n !== 'engineVersion.js').every(n => readFileSync(join(copy, n)).equals(src(n))));
    ok('the stamp is the hash of the files as copied — what HQ\'s own build writes', readFileSync(join(copy, 'engineVersion.js'), 'utf8') === stampSource(computeEngineVersion(REPO)));
    ok('package.json tells Node these are modules', JSON.parse(readFileSync(join(copy, 'package.json'), 'utf8')).type === 'module');
    const manifest = JSON.parse(readFileSync(join(copy, 'MANIFEST.json'), 'utf8'));
    ok('the manifest names the engine, its doors and every file', manifest.engineVersion === version && manifest.closureHash === closureHash
        && manifest.doors.join() === ENGINE_ROOTS.join() && Object.keys(manifest.files).join() === engineFiles.join());
    ok('nothing else is in the copy', readdirSync(copy).length === engineFiles.length + 2);
    ok('a second copy writes nothing', writeMirror(plan, copy).written === 0);

    // ── a copy that has drifted is seen, and put right ───────────────────────────────────────
    writeFileSync(join(copy, 'priceLevels.js'), `${readFileSync(join(copy, 'priceLevels.js'), 'utf8')}\n// edited by hand`);
    writeFileSync(join(copy, 'leftover.js'), 'export const old = 1;');
    rmSync(join(copy, 'nodeList.js'));
    const drift = mirrorDiff(plan, copy);
    ok('a hand edit, a leftover and a missing file are each named', !drift.same && drift.differs.join() === 'priceLevels.js' && drift.stray.join() === 'leftover.js' && drift.missing.join() === 'nodeList.js');
    const repair = writeMirror(plan, copy);
    ok('…and the next copy repairs all three', repair.written === 2 && repair.removed === 1 && mirrorDiff(plan, copy).same && !existsSync(join(copy, 'leftover.js')));
    let refused = false;
    try { writeMirror(plan, join(REPO, ...ENGINE_DIR.split('/'))); } catch { refused = true; }
    ok('the copy can never be pointed at the engine itself', refused);

    // ── it loads the way a Cloud Function loads it ───────────────────────────────────────────
    const smoke = smokeLoad(copy);
    ok(`every door opens from the copy (${smoke.error || 'ok'})`, smoke.ok && smoke.version === version);
    writeFileSync(join(copy, 'nodeList.js'), 'export const nothing = 1;');
    ok('a copy that is not whole does NOT load — it fails here, not in production', !smokeLoad(copy).ok);
    writeMirror(plan, copy);

    // A function is CommonJS (functions/index.js). This is one: it imports the copy beside it and takes
    // two pins all the way to a cart line — choices, the model, the price, the handoff.
    writeFileSync(join(fn, 'index.cjs'), `
        (async () => {
            const { choicesFromAssembly, modelNodesOf } = await import('./engine/hardwareAdapter.js');
            const { resolve } = await import('./engine/hardwareModel.js');
            const { handoffItem } = await import('./engine/hardwareHandoff.js');
            const assembly = { id: 'ASM', itemName: 'Probe', nodeClusters: [
                { id: 'c1', category: 'POLE', position: 'CENTER', nodes: ['rod_c'] },
                { id: 'c2', category: 'FINIAL', position: 'LEFT', nodes: ['fin_l'] }] };
            const pins = [
                { id: 'p1', assemblyId: 'ASM', clusterId: 'c1', partId: 'ROD', partName: 'Rod', targetNode: 'rod_c' },
                { id: 'p2', assemblyId: 'ASM', clusterId: 'c2', partId: 'FIN', partName: 'Finial', targetNode: 'fin_l', endTreatment: 'FINIAL' }];
            const parts = { ROD: { id: 'ROD', itemId: 'ROD', itemName: 'Rod', manufacturingSpecs: { basePrice: 10 } }, FIN: { id: 'FIN', itemId: 'FIN', itemName: 'Finial', manufacturingSpecs: { basePrice: 25 } } };
            const choices = choicesFromAssembly(assembly, pins);
            const modelNodes = modelNodesOf(assembly);
            const open = resolve({ choices, answers: {}, selectedIds: [], modelNodes });
            const picks = {};
            open.slots.forEach((s) => { if (s.options[0]) picks[s.key] = s.options[0].id; });
            const resolved = resolve({ choices, answers: {}, selectedIds: Object.values(picks), modelNodes });
            const item = handoffItem(resolved, { assembly, flow: { id: 'FLOW', name: 'Probe' }, findPart: (id) => parts[String(id)] || null, pins, answers: {}, picks });
            process.stdout.write(JSON.stringify({ engine: item.engine, total: item.pricing.finalPrice, lines: item.pricingBreakdown.length,
                engineVersion: item.engineVersion, fingerprint: item.pinsFingerprint, picks: Object.keys(item.engineConfig.picks).length, visible: [...resolved.visible].sort() }));
        })().catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });`);
    const run = spawnSync(process.execPath, ['index.cjs'], { cwd: fn, encoding: 'utf8' });
    let line = null;
    try { line = JSON.parse(run.stdout); } catch { line = null; }
    ok(`a CommonJS function runs a configuration through the copy (${run.status === 0 ? 'ok' : String(run.stderr).split('\n')[0]})`, run.status === 0 && !!line);
    ok('…and it is the engine\'s own cart line: TAGS, both parts, the money', !!line && line.engine === 'TAGS' && line.lines === 2 && line.total === 35 && line.picks === 2);
    ok('…stamped with this engine and the pins it read', !!line && line.engineVersion === version && /^[0-9a-f]{16}$/.test(line.fingerprint || ''));
    ok('…and the render is additive: exactly the two chosen parts show', !!line && line.visible.join() === 'fin_l,rod_c');

    // ── the command, as the deploy runs it ───────────────────────────────────────────────────
    const hook = join(tmp, 'hook', 'engine');
    const o1 = quiet();
    ok('the command makes the copy, loads it and says so in one line', main(['--target', hook], {}, o1) === 0 && o1.lines.length === 1 && /loads ✓/.test(o1.lines[0]) && o1.lines[0].includes(version));
    ok('--check on a current copy passes', main(['--check', '--target', hook], {}, quiet()) === 0);
    writeFileSync(join(hook, 'hardwareModel.js'), '// emptied');
    const o2 = quiet();
    ok('--check on a changed copy fails and names the file — and writes nothing', main(['--check', '--target', hook], {}, o2) === 1 && o2.lines.some(l => /different\s+hardwareModel\.js/.test(l)) && readFileSync(join(hook, 'hardwareModel.js'), 'utf8') === '// emptied');
    const o3 = quiet();
    ok('SKIP_ENGINE_SYNC=1 leaves the copy as it was, and says whose engine that keeps', main(['--target', hook], { SKIP_ENGINE_SYNC: '1' }, o3) === 0 && /SKIPPED/.test(o3.lines[0]) && readFileSync(join(hook, 'hardwareModel.js'), 'utf8') === '// emptied');
    ok('…and the next real run repairs it', main(['--target', hook], {}, quiet()) === 0 && mirrorDiff(plan, hook).same);
    const cli = spawnSync(process.execPath, [join(REPO, 'scripts', 'sync-engine.mjs'), '--check', '--target', hook], { cwd: REPO, encoding: 'utf8' });
    ok('run as a command (not imported) it really runs', cli.status === 0 && /is current/.test(cli.stdout));

    // ── the wiring that makes "nobody has to remember" true ──────────────────────────────────
    const firebase = JSON.parse(readFileSync(join(REPO, 'firebase.json'), 'utf8'));
    const fnCfg = (Array.isArray(firebase.functions) ? firebase.functions : [firebase.functions]).find(c => c && c.source === 'functions') || {};
    const pre = [].concat(fnCfg.predeploy || []);
    ok('firebase.json runs the copy before every functions deploy', pre.some(c => /node\s+scripts\/sync-engine\.mjs\s*$/.test(c)));
    ok('…with no "=" in the command (the Firebase CLI warns it may not run one)', pre.every(c => !c.includes('=')));
    ok('…and does not leave the copy out of the upload', !(fnCfg.ignore || []).some(i => /engine/.test(i)));
    ok('the copy is git-ignored — it is made, never committed', readFileSync(join(REPO, 'functions', '.gitignore'), 'utf8').split('\n').map(l => l.trim()).includes('engine/'));
    ok('the copy lives where the hook writes it', SERVER_COPY === 'functions/engine' && Object.keys(ENGINE_DOORS).length === ENGINE_ROOTS.length);
    const vite = readFileSync(join(REPO, 'portal', 'vite.config.js'), 'utf8');
    ok('the portal builds from the engine itself, not from a copy', vite.includes("'@engine'") && vite.includes(`../${ENGINE_DIR}`) && !existsSync(join(REPO, 'portal', 'src', 'engine')));
    ok('…and stamps its bundle the way HQ\'s build does', vite.includes('computeEngineVersion') && vite.includes('stampSource'));
} finally {
    rmSync(tmp, { recursive: true, force: true });
}

console.log(`syncEngine: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
