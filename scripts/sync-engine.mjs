// ─────────────────────────────────────────────────────────────────────────────────────────────
// ONE ENGINE, THREE RUNTIMES — the server's copy (Stuart 2026-10-12, the portal rebuild)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "ok as long as we can always keep in total alignment."
//
// HQ's CPQ runs the tag engine out of src/components/Shared. The customer portal is being rebuilt on
// that SAME engine, and it has two halves that cannot import src/: the portal app (portal/, its own
// Vercel project) and its server (functions/, deployed from Cloud Shell). The old portal answered
// that with copies kept by hand — functions/portalEngine.js, portal/src/shared/* — and by October
// three of the seven had drifted and the price port was missing four of HQ's pricing fixes. A copy
// somebody has to remember is a copy that falls behind.
//
// So nobody remembers anything:
//   · the PORTAL APP builds straight from src/components/Shared (portal/vite.config.js, '@engine');
//   · the SERVER takes its copy HERE, at the moment of every deploy — firebase.json runs this file as
//     the functions `predeploy` hook, so what Cloud Shell uploads is the engine as main has it.
//
// The copy is functions/engine/ — generated, git-ignored, never edited. Every file is its source
// byte for byte, with one exception made exactly the way HQ's own build makes it: engineVersion.js
// is the hash of the engine files AS COPIED (scripts/_lib/engineVersion.mjs), so a committed stamp
// that is behind the code can never ride to the server.
//
// WHAT COUNTS AS THE ENGINE is not a list kept by hand either. It is whatever the engine's doors
// (ENGINE_DOORS) import, followed to the end — a module the engine starts importing tomorrow is
// copied tomorrow, with no edit here.
//
// THE ONE RULE THIS ENFORCES: an engine file imports only the files beside it, by relative path,
// with the .js extension. No package, no React, no Firebase — the server has none of them for it and
// the browser must never need them. A file that breaks the rule stops the copy by name; and the copy
// is then LOADED once, the way the function will load it, before anything is uploaded.
//
// Run: node scripts/sync-engine.mjs            make the copy (this is the predeploy hook)
//      node scripts/sync-engine.mjs --check    say what would change; write nothing
//      node scripts/sync-engine.mjs --list     the files that are the engine
// Harness: node scripts/syncEngine.test.mjs
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeEngineVersion, stampSource, STAMP_FILE } from './_lib/engineVersion.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Where the engine lives — the one copy anybody edits. */
export const ENGINE_DIR = 'src/components/Shared';
/** The engine's doors: the files everything else is reached from, and the function each must still open with. */
export const ENGINE_DOORS = {
    'hardwareAdapter.js': 'choicesFromAssembly',   // pins → choices
    'hardwareModel.js': 'resolve',                 // choices + answers → slots, riders, the BOM
    'hardwarePricing.js': 'priceConfiguration',    // the money on it
    'hardwareHandoff.js': 'handoffItem',           // the cart line every consumer reads
    'hardwareAutoPicks.js': 'autoPicksOf',         // the picks the configurator makes on its own
    'hardwareSession.js': 'sessionOf',             // the configuration itself, without the screen — what the portal's server calls
};
export const ENGINE_ROOTS = Object.keys(ENGINE_DOORS);
/** The server's copy, relative to the repo. */
export const SERVER_COPY = 'functions/engine';

const STAMP_NAME = posix.relative(ENGINE_DIR, STAMP_FILE);   // engineVersion.js
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
const byName = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);   // code-unit order — the same on every machine

/**
 * The modules a source file imports as STATEMENTS: `import … from`, `import '…'`, `export … from`.
 * A statement starts its line; a line inside a comment or a string does not, so prose that happens
 * to say "import x from 'y'" is never read as code.
 */
export function importsOf(source) {
    const text = String(source);
    const out = [];
    for (const m of text.matchAll(/^import\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) out.push(m[1]);
    for (const m of text.matchAll(/^export\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s+['"]([^'"]+)['"]/gm)) out.push(m[1]);
    return out;
}
/** import('…') calls, wherever they sit. Followed when they name a real engine file; never judged. */
export function dynamicImportsOf(source) {
    return [...String(source).matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
}

/**
 * The engine, as a set of files: everything the doors import, to the end.
 *
 * @returns { files: Map<name, Buffer> in name order, problems: string[] } — `name` is the path
 *          relative to ENGINE_DIR. A problem is a broken rule, said in words a person can act on.
 */
export function engineClosure(repo = REPO, roots = ENGINE_ROOTS) {
    const dir = join(repo, ENGINE_DIR);
    const files = new Map();
    const problems = [];
    const isFile = (abs) => existsSync(abs) && statSync(abs).isFile();
    const visit = (name, via) => {
        if (files.has(name)) return;
        const abs = join(dir, ...name.split('/'));
        if (!isFile(abs)) { problems.push(`${via} imports ${name}, and there is no such file in ${ENGINE_DIR}.`); return; }
        const buf = readFileSync(abs);
        files.set(name, buf);
        const src = buf.toString('utf8');
        const targetOf = (spec) => posix.normalize(posix.join(posix.dirname(name), spec));
        for (const spec of importsOf(src)) {
            if (!spec.startsWith('.')) { problems.push(`${name} imports the package "${spec}". An engine file imports only the files beside it — the portal's server has no package for it, and the browser must not need one.`); continue; }
            if (!spec.endsWith('.js')) { problems.push(`${name} imports "${spec}" without the .js extension. The server loads these files as they are, and Node will not find it — write "${spec}.js".`); continue; }
            const target = targetOf(spec);
            if (target.startsWith('..')) { problems.push(`${name} imports "${spec}", which is outside ${ENGINE_DIR}. The engine is only what lives there.`); continue; }
            visit(target, name);
        }
        for (const spec of dynamicImportsOf(src)) {
            if (!spec.startsWith('.') || !spec.endsWith('.js')) continue;
            const target = targetOf(spec);
            if (!target.startsWith('..') && isFile(join(dir, ...target.split('/')))) visit(target, name);
        }
    };
    roots.forEach(r => visit(r, 'ENGINE_DOORS'));
    return { files: new Map([...files.entries()].sort(byName)), problems };
}

/**
 * What the copy must contain, exactly: every engine file, the stamp recomputed, a package.json that
 * tells Node these are modules, and a manifest that says which engine this is.
 */
export function mirrorPlan(repo = REPO) {
    const { files, problems } = engineClosure(repo);
    let version = '';
    try { version = computeEngineVersion(repo); } catch (e) { problems.push(`The engine stamp could not be computed: ${e.message}`); }
    const plan = new Map();
    for (const [name, buf] of files) plan.set(name, (name === STAMP_NAME && version) ? Buffer.from(stampSource(version)) : buf);
    // The whole engine in one figure. The stamp hashes the five files a saved line is judged by; this
    // hashes every file copied, so two copies with the same figure are the same engine to the byte.
    const h = createHash('sha1');
    for (const [name, buf] of plan) { h.update(name); h.update('\0'); h.update(buf); h.update('\0'); }
    const closureHash = h.digest('hex').slice(0, 16);
    const manifest = {
        engineVersion: version,
        closureHash,
        doors: ENGINE_ROOTS,
        files: Object.fromEntries([...plan.entries()].map(([name, buf]) => [name, sha1(buf)])),
    };
    plan.set('package.json', Buffer.from('{ "type": "module" }\n'));
    plan.set('MANIFEST.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    return { plan, problems, version, closureHash, engineFiles: [...files.keys()] };
}

const walk = (dirAbs, prefix = '') => (existsSync(dirAbs) ? readdirSync(dirAbs, { withFileTypes: true }) : [])
    .flatMap(e => (e.isDirectory() ? walk(join(dirAbs, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`]));

/** How a copy on disk differs from the plan: what is missing, what differs, what does not belong. */
export function mirrorDiff(plan, targetAbs) {
    const missing = [], differs = [], stray = [];
    for (const [name, buf] of plan) {
        const abs = join(targetAbs, ...name.split('/'));
        if (!existsSync(abs)) missing.push(name);
        else if (!readFileSync(abs).equals(buf)) differs.push(name);
    }
    for (const name of walk(targetAbs)) if (!plan.has(name)) stray.push(name);
    return { missing, differs, stray, same: !missing.length && !differs.length && !stray.length };
}

/** Make the copy on disk equal the plan. Writes only what differs, removes what does not belong. */
export function writeMirror(plan, targetAbs, repo = REPO) {
    const t = resolve(targetAbs);
    const src = resolve(repo, ENGINE_DIR);
    // The copy is rewritten wholesale, strays and all — so it may never be pointed at the engine itself, or at the repo.
    if (t === src || t.startsWith(src + sep) || src.startsWith(t + sep) || existsSync(join(t, '.git'))) {
        throw new Error(`refusing to write the engine's copy into ${t}`);
    }
    const d = mirrorDiff(plan, t);
    for (const name of [...d.missing, ...d.differs]) {
        const abs = join(t, ...name.split('/'));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, plan.get(name));
    }
    for (const name of d.stray) rmSync(join(t, ...name.split('/')), { force: true });
    return { written: d.missing.length + d.differs.length, removed: d.stray.length };
}

/**
 * Load the copy the way a Cloud Function will: a CommonJS process, import() of each door. Proves the
 * copy is whole (a file the walk missed fails here, not in production) and that the doors still open.
 */
export function smokeLoad(targetAbs) {
    const script = `
        const doors = ${JSON.stringify(ENGINE_DOORS)};
        Promise.all(Object.keys(doors).map((f) => import('./' + f).then((m) => {
            if (typeof m[doors[f]] !== 'function') throw new Error(f + ' no longer exports ' + doors[f] + '()');
        })))
            .then(() => import('./${STAMP_NAME}'))
            .then((v) => { process.stdout.write(String(v.ENGINE_VERSION || '')); })
            .catch((e) => { process.stderr.write(String((e && e.message) || e)); process.exit(1); });`;
    const r = spawnSync(process.execPath, ['-e', script], { cwd: targetAbs, encoding: 'utf8' });
    return { ok: r.status === 0, version: String(r.stdout || '').trim(), error: String(r.stderr || (r.error && r.error.message) || '').trim() };
}

const REFUSAL_FOOT = [
    '',
    'The portal\'s server runs these files exactly as they are, so nothing was copied and the deploy stops here.',
    'Fix the engine file named above (or ask the session that changed it), then deploy again.',
    'To deploy something unrelated right now:  SKIP_ENGINE_SYNC=1 firebase deploy --only functions:<name> …',
    '  — the portal\'s configurator functions then keep the engine they already have.',
].join('\n');

export function main(argv = [], env = process.env, out = console) {
    const check = argv.includes('--check');
    const list = argv.includes('--list');
    const ti = argv.indexOf('--target');
    const target = resolve(REPO, ti >= 0 && argv[ti + 1] ? argv[ti + 1] : SERVER_COPY);
    const inRepo = relative(REPO, target);
    const shown = (inRepo && !inRepo.startsWith('..')) ? inRepo : target;
    if (env.SKIP_ENGINE_SYNC === '1' && !check && !list) {
        out.log(`engine copy SKIPPED (SKIP_ENGINE_SYNC=1) — ${shown} is left as it was; the portal's configurator functions keep that engine.`);
        return 0;
    }
    const { plan, problems, version, closureHash, engineFiles } = mirrorPlan(REPO);
    if (list) {
        engineFiles.forEach(f => out.log(f));
        out.log(`— ${engineFiles.length} files · engine ${version} · ${closureHash}`);
    }
    if (problems.length) {
        out.error(`✗ THE ENGINE WAS NOT COPIED — ${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
        problems.forEach(p => out.error(`  · ${p}`));
        out.error(REFUSAL_FOOT);
        return 1;
    }
    if (list) return 0;
    if (check) {
        const d = mirrorDiff(plan, target);
        if (d.same) { out.log(`engine copy ${shown} is current — ${engineFiles.length} files · engine ${version} · ${closureHash}`); return 0; }
        out.error(`engine copy ${shown} is NOT current — missing ${d.missing.length}, different ${d.differs.length}, not the engine's ${d.stray.length}`);
        [...d.missing.map(n => `missing    ${n}`), ...d.differs.map(n => `different  ${n}`), ...d.stray.map(n => `stray      ${n}`)].forEach(l => out.error(`  ${l}`));
        return 1;
    }
    const w = writeMirror(plan, target);
    const s = smokeLoad(target);
    if (!s.ok || s.version !== version) {
        out.error('✗ THE ENGINE WAS COPIED BUT DOES NOT LOAD — a Cloud Function could not run it:');
        out.error(`  · ${s.ok ? `the copy says engine ${s.version || '(none)'}, the files say ${version}` : s.error}`);
        out.error(REFUSAL_FOOT);
        return 1;
    }
    out.log(`engine → ${shown}: ${engineFiles.length} files · engine ${version} · ${closureHash} · ${w.written} written, ${w.removed} removed · loads ✓`);
    return 0;
}

// Run only when this file IS the command (the harness imports it). Compared by real path: Cloud Shell
// reaches the checkout through a link, and a hook that quietly decided it was not the command would
// upload a stale engine without a word.
const invoked = (() => { try { return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invoked) process.exit(main(process.argv.slice(2)));
