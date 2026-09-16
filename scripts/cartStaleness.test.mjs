// Shared/cartStaleness + the engine stamp (S1, 2026-09-15). Run: node scripts/cartStaleness.test.mjs
import { stableJson, hashText, pinsFingerprint, lineStaleness, staleLinesOf, staleApprovalText, STALE, CURRENT, UNSTAMPED, NOT_ENGINE } from '../src/components/Shared/cartStaleness.js';
import { computeEngineVersion, committedEngineVersion, ENGINE_FILES } from './_lib/engineVersion.mjs';
import { ENGINE_VERSION } from '../src/components/Shared/engineVersion.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.error('  ✗', name); } };

// ── stableJson / hashText ─────────────────────────────────────────────────────────────────────
ok('stableJson sorts keys at every level', stableJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } }) === '{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
ok('stableJson: undefined reads as null', stableJson(undefined) === 'null');
ok('hashText is 16 hex chars', /^[0-9a-f]{16}$/.test(hashText('abc')));
ok('hashText differs on one char', hashText('abc') !== hashText('abd'));
ok('hashText is stable', hashText('the same') === hashText('the same'));

// ── pinsFingerprint ───────────────────────────────────────────────────────────────────────────
const p1 = { id: 'PIN-A', assemblyId: 'CE-ASM-1', partId: 'CE-INV-57731', ridesWith: 'RETURN', tier: 'FRONT' };
const p2 = { id: 'PIN-B', assemblyId: 'CE-ASM-1', partId: 'CE-INV-1', role: 'BRACKET' };
const fp = pinsFingerprint([p1, p2]);
ok('fingerprint ignores order', pinsFingerprint([p2, p1]) === fp);
ok('fingerprint ignores key order', pinsFingerprint([{ tier: 'FRONT', ridesWith: 'RETURN', partId: 'CE-INV-57731', assemblyId: 'CE-ASM-1', id: 'PIN-A' }, p2]) === fp);
ok('a re-tag changes the fingerprint (the SO60429 standoff: ridesWith blank → RETURN)', pinsFingerprint([{ ...p1, ridesWith: '' }, p2]) !== fp);
ok('a new pin changes the fingerprint', pinsFingerprint([p1, p2, { id: 'PIN-C' }]) !== fp);
ok('no pins → empty fingerprint', pinsFingerprint([]) === '' && pinsFingerprint(null) === '');
ok('a Timestamp-like object hashes by value', pinsFingerprint([{ id: 'x', createdAt: { seconds: 1, nanoseconds: 2 } }]) === pinsFingerprint([{ id: 'x', createdAt: { nanoseconds: 2, seconds: 1 } }]));

// ── lineStaleness ─────────────────────────────────────────────────────────────────────────────
const now = { engineVersion: 'v2', pinsFingerprint: fp };
ok('old-engine line is not judged', lineStaleness({ engine: 'BOM' }, now).status === NOT_ENGINE);
ok('missing item is not judged', lineStaleness(null, now).status === NOT_ENGINE);
ok('a 09-10 line (no stamp) is UNSTAMPED', lineStaleness({ engine: 'TAGS', assemblyId: 'CE-ASM-1' }, now).status === UNSTAMPED);
ok('same engine, same pins → CURRENT', lineStaleness({ engine: 'TAGS', engineVersion: 'v2', pinsFingerprint: fp }, now).status === CURRENT);
const eng = lineStaleness({ engine: 'TAGS', engineVersion: 'v1', pinsFingerprint: fp }, now);
ok('engine changed → STALE, says so', eng.status === STALE && /engine changed \(v1 → v2\)/.test(eng.reasons[0]));
const tags = lineStaleness({ engine: 'TAGS', engineVersion: 'v2', pinsFingerprint: 'deadbeefdeadbeef' }, now);
ok('tags changed → STALE, says so', tags.status === STALE && /tags changed/.test(tags.reasons[0]));
const both = lineStaleness({ engine: 'TAGS', engineVersion: 'v1', pinsFingerprint: 'deadbeefdeadbeef' }, now);
ok('both changed → two reasons', both.status === STALE && both.reasons.length === 2);
ok('pins unreadable now → judged on the engine only', lineStaleness({ engine: 'TAGS', engineVersion: 'v2', pinsFingerprint: fp }, { engineVersion: 'v2', pinsFingerprint: '' }).status === CURRENT);
ok('line saved without pins → judged on the engine only', lineStaleness({ engine: 'TAGS', engineVersion: 'v2', pinsFingerprint: '' }, now).status === CURRENT);
ok('no current engine version → judged on the pins only', lineStaleness({ engine: 'TAGS', engineVersion: 'v1', pinsFingerprint: fp }, { engineVersion: '', pinsFingerprint: fp }).status === CURRENT);

// ── staleLinesOf / staleApprovalText ──────────────────────────────────────────────────────────
const cart = [
    { engine: 'TAGS', assemblyName: 'H1-138', assemblyId: 'CE-ASM-1', engineVersion: 'v2', pinsFingerprint: fp },      // current
    { engine: 'TAGS', assemblyName: 'H1-75', assemblyId: 'CE-ASM-2', engineVersion: 'v1', pinsFingerprint: 'x' },       // engine changed; pins of ASM-2 unknown
    { engine: 'TAGS', assemblyName: 'H1-1', assemblyId: 'CE-ASM-1' },                                                     // unstamped
    { engine: 'BOM', assemblyName: 'OLD' },
];
const st = staleLinesOf(cart, { engineVersion: 'v2', pinsByAssembly: { 'CE-ASM-1': [p1, p2] } });
ok('two lines flagged, the current and the old-engine ones not', st.length === 2 && st[0].index === 1 && st[1].index === 2);
ok('flagged line carries its name and status', st[0].name === 'H1-75' && st[0].status === STALE && st[1].status === UNSTAMPED);
ok('a line whose assembly pins were not fetched is judged on the engine only', st[0].reasons.length === 1);
ok('empty cart → nothing', staleLinesOf([], { engineVersion: 'v2' }).length === 0 && staleLinesOf(null).length === 0);
const txt = staleApprovalText(st, { quoteNo: 'QUO145' });
ok('text names the quote, the lines and the way out', /QUO145: 2 lines/.test(txt) && /line 2 H1-75: engine changed/.test(txt) && /line 3 H1-1: saved before/.test(txt) && /reopen this quote in CPQ and re-save/.test(txt) && /Approve anyway/.test(txt));
ok('no stale lines → no text', staleApprovalText([]) === '');

// ── the stamp: the committed engineVersion.js must equal the engine files' hash ───────────────
const live = computeEngineVersion();
ok(`ENGINE_FILES all exist and hash (${live})`, /^[0-9a-f]{12}$/.test(live) && ENGINE_FILES.length === 5);
ok(`committed stamp equals the engine files' hash — else run: node scripts/stamp-engine-version.mjs (committed ${committedEngineVersion() || '(none)'}, files ${live})`, committedEngineVersion() === live);
ok('the app imports the same value the file declares', ENGINE_VERSION === committedEngineVersion());

console.log(`cartStaleness: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
