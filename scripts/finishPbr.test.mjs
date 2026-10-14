// Shared/finishPbr — the finish table's registry, moved out of Shared/studioScene.js (the portal rebuild, step 4, 2026-10-14).
//   node scripts/finishPbr.test.mjs
// THE REGISTRY AS IT WAS — ensureFinishPbr and pbrForTexture before the move, word for word but for the two Firestore reads,
// which are handed in — runs against THE REGISTRY AS IT IS: HQ's loader (studioScene.js; its body is repeated below, the
// harness cannot load Firebase) feeding pbrMapOf. Both sides use the module's own table pieces, so a dial tuned later
// moves both alike and only a change to HOW the registry is filled shows here. Then the portal's road: no loader, primed.
import * as current from '../src/components/Shared/finishPbr.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g.slice(0, 400)}\n    want ${w.slice(0, 400)}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const sorted = (m) => Object.fromEntries(Object.entries(m || {}).sort(([a], [b]) => (a < b ? -1 : 1)));
let runs = 0;
const fresh = () => import(`../src/components/Shared/finishPbr.js?run=${++runs}`);   // each run its own registry, as each page load has
const realNow = Date.now;
let now = 1_000_000;
Date.now = () => now;

// ── THE REGISTRY AS IT WAS (studioScene.js 191–235 at 2e2147ff) — a factory, so each run has its own ─────────────────
const oldRegistry = ({ getDoc, getDocs }) => {
    const { resolvePbr, trimPainted, DEFAULT_PBR, DEFAULT_PLATED_PBR, DEFAULT_ENVMAP_INTENSITY } = current;
    const db = null; const doc = (_db, a, b) => `${a}/${b}`; const collection = (_db, a) => a;
    let pbrByUrl = null;
    let pbrLoadPromise = null;
    let pbrLoadedAt = 0;
    const ensureFinishPbr = () => {
        if (!pbrLoadPromise) {
            pbrLoadPromise = (async () => {
                const map = {};
                try {
                    const snap = await getDoc(doc(db, 'system', 'master_finishes'));
                    (snap.exists() ? (snap.data().finishes || []) : []).forEach(f => {
                        if (!(f && f.textureUrl)) return;
                        // Explicit per-finish pbr{} skips the painted trim (the escape hatch).
                        const explicit = f.pbr && typeof f.pbr.metalness === 'number' && typeof f.pbr.roughness === 'number';
                        const base = resolvePbr(f, DEFAULT_PBR);
                        map[f.textureUrl] = (explicit || base.wood) ? base : trimPainted(base);   // wood is not a paint coat
                    });
                } catch (e) { /* keep defaults */ }
                try {
                    const out = await getDocs(collection(db, 'hq_outsource_finishes'));
                    out.docs.forEach(d => {
                        const f = d.data();
                        if (f && f.textureUrl && !map[f.textureUrl]) map[f.textureUrl] = resolvePbr(f, DEFAULT_PLATED_PBR);
                    });
                } catch (e) { /* keep defaults */ }
                pbrByUrl = map;
                pbrLoadedAt = Date.now();
            })();
        }
        return pbrLoadPromise;
    };
    const pbrForTexture = (url) => {
        if (url && pbrByUrl && !pbrByUrl[url] && Date.now() - pbrLoadedAt > 30000) { pbrLoadedAt = Date.now(); pbrLoadPromise = null; ensureFinishPbr(); }
        const pbr = (pbrByUrl && pbrByUrl[url]) || DEFAULT_PBR;
        return { envMapIntensity: DEFAULT_ENVMAP_INTENSITY, ...pbr };
    };
    return { ensureFinishPbr, pbrForTexture, map: () => pbrByUrl };
};
// HQ's loader as studioScene.js registers it, over the same two reads.
const hqLoader = ({ getDoc, getDocs }) => async () => {
    const db = null; const doc = (_db, a, b) => `${a}/${b}`; const collection = (_db, a) => a;
    let master = [];
    let outsourced = [];
    try {
        const snap = await getDoc(doc(db, 'system', 'master_finishes'));
        master = snap.exists() ? (snap.data().finishes || []) : [];
    } catch (e) { /* keep defaults */ }
    try {
        const out = await getDocs(collection(db, 'hq_outsource_finishes'));
        outsourced = out.docs.map(d => d.data());
    } catch (e) { /* keep defaults */ }
    return { master, outsourced };
};

// ── THE READS, AS FIRESTORE WOULD ANSWER THEM ────────────────────────────────────────────────────────────────────────
const reads = ({ master, masterMissing = false, masterThrows = false, outsourced = [], outThrows = false }) => {
    let calls = 0;
    return {
        calls: () => calls,
        getDoc: async (path) => { calls++; if (path !== 'system/master_finishes') throw new Error(`read ${path}`); if (masterThrows) throw new Error('permission-denied'); return { exists: () => !masterMissing, data: () => ({ finishes: master }) }; },
        getDocs: async (name) => { calls++; if (name !== 'hq_outsource_finishes') throw new Error(`read ${name}`); if (outThrows) throw new Error('unavailable'); return { docs: (outsourced || []).map(d => ({ data: () => d })) }; },
    };
};
const MASTER = [
    { code: 'SS', name: 'Satin Silver', material: 'METAL', textureUrl: 'u/ss' },                 // the code table, trimmed as a paint
    { code: 'MB', name: 'Matte Black', textureUrl: 'u/mb' },                                       // a coating in the code table
    { code: 'P14', name: 'Matte Black Powder', textureUrl: 'u/p14' },                              // the name table
    { code: 'EPX', name: 'Polished Chrome', textureUrl: 'u/chrome' },
    { code: 'S03', name: 'S03', material: 'WOOD', textureUrl: 'u/s03' },                           // wood by its material — never trimmed
    { code: 'S11', name: 'Dark Walnut', textureUrl: 'u/s11' },                                     // wood by its words
    { code: 'S20', name: 'S20', bomSuffix: 'OAK', textureUrl: 'u/s20' },                           // wood by its species suffix
    { code: 'MX', name: 'Oak look', material: 'MIXED', textureUrl: 'u/mx' },                       // MIXED falls through to the words
    { code: 'AC', name: 'CLEAR ACRYLIC', material: 'CLEAR', textureUrl: 'u/ac' },                  // tagged, and not wood
    { code: 'XP', name: 'Custom', textureUrl: 'u/xp', pbr: { metalness: 0.4, roughness: 0.6 } },   // its own pbr{} — the escape hatch
    { code: 'NOTEX', name: 'No texture' }, null, undefined, 'junk',
    { code: 'ZZ', name: 'Unknown', textureUrl: 'u/zz' },                                           // the default, trimmed
    { code: 'SS2', name: 'Bright', textureUrl: 'u/ss' },                                           // the same picture twice — the later wins
];
const OUT = [
    { code: 'EP1', name: 'Polished Nickel', textureUrl: 'u/ep1', vendor: 'PLATER' },               // plated, untrimmed
    { code: 'EP9', name: 'Mystery', textureUrl: 'u/ep9' },                                         // the plated default
    { code: 'SSO', name: 'Satin', textureUrl: 'u/ss' },                                            // master already has this picture — it keeps it
    null, { code: 'NOTEX2' },
];
const URLS = ['u/ss', 'u/mb', 'u/p14', 'u/chrome', 'u/s03', 'u/s11', 'u/s20', 'u/mx', 'u/ac', 'u/xp', 'u/zz', 'u/ep1', 'u/ep9', 'u/unknown', '', undefined];
const SCENARIOS = [
    ['both lists', { master: MASTER, outsourced: OUT }],
    ['master read refused', { master: MASTER, masterThrows: true, outsourced: OUT }],
    ['outsourced read refused', { master: MASTER, outsourced: OUT, outThrows: true }],
    ['both refused', { master: MASTER, masterThrows: true, outsourced: OUT, outThrows: true }],
    ['no master document', { master: MASTER, masterMissing: true, outsourced: OUT }],
    ['finishes is not a list', { master: { a: 1 }, outsourced: OUT }],
    ['finishes is null', { master: null, outsourced: OUT }],
    ['nothing outsourced', { master: MASTER, outsourced: [] }],
    ['a junk finish mid-list stops that list where it stands', { master: [MASTER[0], { textureUrl: 'u/bad', get pbr() { throw new Error('bad'); } }, MASTER[1]], outsourced: OUT }],
];

for (const [name, sc] of SCENARIOS) {
    now = 1_000_000;
    const a = reads(sc), b = reads(sc);
    const was = oldRegistry(a);
    const isMod = await fresh();
    isMod.setFinishPbrLoader(hqLoader(b));
    await was.ensureFinishPbr();
    await isMod.ensureFinishPbr();
    eq(`${name}: the registry holds the same map`, sorted(isMod.pbrForTexture && (await (async () => { const m = {}; URLS.forEach(u => { m[String(u)] = isMod.pbrForTexture(u); }); return m; })())),
        sorted((() => { const m = {}; URLS.forEach(u => { m[String(u)] = was.pbrForTexture(u); }); return m; })()));
    eq(`${name}: pbrMapOf over the lists HQ's loader returns = the map the old registry built`, sorted(current.pbrMapOf(...await (async () => { const l = await hqLoader(reads(sc))(); return [l.master, l.outsourced]; })())), sorted(was.map()));
    eq(`${name}: the same reads, made once`, b.calls(), a.calls());
    await was.ensureFinishPbr(); await isMod.ensureFinishPbr();
    eq(`${name}: asked again, nothing is read again`, b.calls(), a.calls());
}

// ── AN UNKNOWN PICTURE ASKS FOR A FRESH REGISTRY, AT MOST EVERY 30 s — on both, alike ────────────────────────────────
{
    now = 5_000_000;
    const listA = { master: [MASTER[0]], outsourced: [] };
    const live = { ...listA };
    const stub = () => ({ getDoc: async () => ({ exists: () => true, data: () => ({ finishes: live.master }) }), getDocs: async () => ({ docs: live.outsourced.map(d => ({ data: () => d })) }) });
    const was = oldRegistry(stub());
    const isMod = await fresh(); isMod.setFinishPbrLoader(hqLoader(stub()));
    await was.ensureFinishPbr(); await isMod.ensureFinishPbr();
    live.master = [MASTER[0], { code: 'S04', name: 'S04', material: 'WOOD', textureUrl: 'u/new-stain' }];   // a stain swatch added in 4.5 a minute ago
    now += 10_000;
    eq('10 s later the new swatch is still unknown on both', isMod.pbrForTexture('u/new-stain'), was.pbrForTexture('u/new-stain'));
    now += 25_000;
    const before = isMod.pbrForTexture('u/new-stain'); was.pbrForTexture('u/new-stain');   // past 30 s: this asks for a fresh registry
    await isMod.ensureFinishPbr(); await was.ensureFinishPbr();
    eq('…past 30 s the fresh registry knows it, on both', isMod.pbrForTexture('u/new-stain'), was.pbrForTexture('u/new-stain'));
    ok('…and it is the wood answer, not the generic metal it was', isMod.pbrForTexture('u/new-stain').wood === true && before.wood !== true);
}

// ── THE PORTAL'S ROAD: no loader; the server's entries are primed in ────────────────────────────────────────────────────
{
    now = 9_000_000;
    const p = await fresh();
    await p.ensureFinishPbr();
    eq('no loader, nothing primed: every picture takes the default, as a failed read did', p.pbrForTexture('u/x'), { envMapIntensity: current.DEFAULT_ENVMAP_INTENSITY, ...current.DEFAULT_PBR });
    const server = current.pbrMapOf(MASTER, OUT);                          // what the portal's server works out (pbrMapOf, the same lists)
    p.primeFinishPbr({ 'u/s03': server['u/s03'], 'u/ep1': server['u/ep1'] });
    eq('primed: the stain answers as HQ answers it', p.pbrForTexture('u/s03'), { envMapIntensity: current.DEFAULT_ENVMAP_INTENSITY, ...server['u/s03'] });
    p.primeFinishPbr({ 'u/ss': server['u/ss'] });
    eq('a second priming adds to the first', [p.pbrForTexture('u/ep1').roughness, p.pbrForTexture('u/ss').roughness], [server['u/ep1'].roughness, server['u/ss'].roughness]);
    now += 60_000;
    p.pbrForTexture('u/never-sent'); await p.ensureFinishPbr();           // an unknown picture asks for a refresh — there is nothing to read
    eq('…and a refresh with nothing to read keeps what was primed', p.pbrForTexture('u/s03'), { envMapIntensity: current.DEFAULT_ENVMAP_INTENSITY, ...server['u/s03'] });
    p.primeFinishPbr(null); p.primeFinishPbr('u/ss');
    eq('junk primed is ignored', p.pbrForTexture('u/ss').roughness, server['u/ss'].roughness);
    const q = await fresh();
    q.primeFinishPbr({ 'u/s03': server['u/s03'] });
    await q.ensureFinishPbr();
    eq('primed before the first ask: the ask does not wipe it', q.pbrForTexture('u/s03'), { envMapIntensity: current.DEFAULT_ENVMAP_INTENSITY, ...server['u/s03'] });
    const r = await fresh();
    r.setFinishPbrLoader(async () => { throw new Error('loader down'); });
    await r.ensureFinishPbr();
    eq('a loader that throws leaves the defaults, as a failed read did', r.pbrForTexture('u/ss'), { envMapIntensity: current.DEFAULT_ENVMAP_INTENSITY, ...current.DEFAULT_PBR });
}

// ── WHAT THE MAP SAYS, in words (the trim, the wood, the escape hatch) ──────────────────────────────────────────────────
{
    const m = current.pbrMapOf(MASTER, OUT);
    ok('a paint is trimmed (no hotter than the painted trim allows)', m['u/zz'].metalness <= current.DEFAULT_PBR.metalness && m['u/zz'].envMapIntensity !== undefined);
    ok('a wood finish is wood and is not trimmed', m['u/s03'].wood === true && m['u/s11'].wood === true && m['u/s20'].wood === true && m['u/mx'].wood === true);
    eq('a finish with its own pbr{} keeps exactly that', m['u/xp'], { metalness: 0.4, roughness: 0.6 });
    ok('an outsourced finish never replaces the master entry for the same picture', JSON.stringify(m['u/ss']) === JSON.stringify(current.pbrMapOf([MASTER[0], MASTER[14]], [])['u/ss']));
    eq('a finish with no picture has no entry', ['u/', 'undefined', 'NOTEX'].filter(k => k in m), []);
    eq('nothing at all → an empty map', current.pbrMapOf(), {});
}

Date.now = realNow;
console.log(`finishPbr: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
