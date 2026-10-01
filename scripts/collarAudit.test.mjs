// 🩺 Every finial that names a collar must be able to find it (Stuart 2026-10-01).   node scripts/collarAudit.test.mjs
import { collarAudit } from '../src/components/Shared/collarAudit.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

const clusters = [
    { id: 'L', name: 'NEW-SLOT', position: 'LEFT', category: 'FINIAL' },
    { id: 'R', name: 'NEW-SLOT', position: 'RIGHT', category: 'FINIAL' },
    { id: 'DL', name: 'FINIALS-DBL-BACK-LEFT-BASIC', position: 'LEFT', category: 'FINIAL' },
];
const finial = (cl, n, code, req) => ({ id: `F-${cl}-${n}`, clusterId: cl, partId: `DOC-${code}`, partName: code, legacyErpId: code, requiresCollar: req, choiceNode: `S${cl === 'L' ? 59 : cl === 'R' ? 60 : 92}-X__${n}_${code}` });
// As H1-138 was on 09-30: the collar's own pin, tagged Collar, named by its code.
const collar = (cl, n, code, docId) => ({ id: `C-${cl}-${n}`, clusterId: cl, partId: docId, partName: code, legacyErpId: code, isCollar: true, materials: 'METAL', choiceNode: `S${cl === 'L' ? 59 : cl === 'R' ? 60 : 92}-X__${n}_${code}` });
// …and as 1.6 saved it once ✓FEE was ticked: the code as the part id, no ERP id, no collar tag.
const feeCollar = (cl, n, code) => ({ id: `C-${cl}-${n}`, clusterId: cl, partId: code, partName: code.replace(/-/g, ''), feeItemNo: code, isFee: true, materials: 'METAL', choiceNode: `S${cl === 'L' ? 59 : cl === 'R' ? 60 : 92}-X__${n}_${code}` });
const kinds = (f) => f.map(x => `${x.sev}:${x.kind}`);

// ── healthy ────────────────────────────────────────────────────────────────────────────────
let pins = [finial('L', 8, 'H1-138AKF', 'H1-138FC2'), collar('L', 7, 'H1-138FC2', 'CE-INV-60132'), finial('R', 8, 'H1-138AKF', 'H1-138FC2'), collar('R', 7, 'H1-138FC2', 'CE-INV-60132')];
eq('each end\'s finial finds the collar tagged at its own end → nothing to say', collarAudit(pins, clusters), []);
eq('an assembly with no two-part finials is never audited', collarAudit([{ id: 'x', clusterId: 'L', partName: 'H1-138GF' }], clusters), []);
eq('a collar matched by its doc id alone still counts (requires = the doc id)', collarAudit([{ ...finial('L', 8, 'A', 'CE-INV-60132') }, collar('L', 7, 'H1-138FC2', 'CE-INV-60132')], clusters), []);

// ── 2026-10-01: every collar ticked ✓FEE ────────────────────────────────────────────────────
pins = [finial('L', 8, 'H1-138AKF', 'H1-138FC2'), feeCollar('L', 7, 'H1-138FC2'), finial('R', 8, 'H1-138AKF', 'H1-138FC2'), feeCollar('R', 7, 'H1-138FC2')];
let f = collarAudit(pins, clusters);
eq('the collars are named as untagged, and the finials as having none', kinds(f), ['red:COLLAR NOT TAGGED', 'red:NO COLLAR']);
ok('it says they are ticked FEE', /2 ticked ✓FEE/.test(f[0].msg) && /untick ✓FEE, tick Collar/.test(f[0].msg));
ok('it names the slots as 1.6 does', /S59 · NEW-SLOT · LEFT/.test(f[0].msg) && /S60 · NEW-SLOT · RIGHT/.test(f[0].msg));
ok('and says what it costs', /will not render with its finial/.test(f[1].msg) && /loses its own finish/.test(f[1].msg));

// ── one end fixed, the other not ────────────────────────────────────────────────────────────
pins = [finial('L', 8, 'H1-138AKF', 'H1-138FC2'), collar('L', 7, 'H1-138FC2', 'CE-INV-60132'), finial('R', 8, 'H1-138AKF', 'H1-138FC2'), feeCollar('R', 7, 'H1-138FC2')];
f = collarAudit(pins, clusters);
eq('the untagged one is red, and the right finial is borrowing the left collar', kinds(f), ['red:COLLAR NOT TAGGED', 'amber:COLLAR AT ANOTHER END']);
ok('the borrow names the stranded end and where the collar is', /S60 · NEW-SLOT · RIGHT/.test(f[1].msg) && /pinned at LEFT/.test(f[1].msg));

// ── a collar that was never pinned at all ───────────────────────────────────────────────────
f = collarAudit([finial('DL', 12, 'H1-138WCGF', 'H1-138WFCON2')], clusters);
eq('requires a collar no choice names → NO COLLAR', kinds(f), ['red:NO COLLAR']);
ok('…naming the double slot', /S92 · FINIALS-DBL-BACK-LEFT-BASIC · LEFT/.test(f[0].msg));

// ── two collar codes are judged separately; a collar with no position serves every end ─────
pins = [finial('L', 8, 'H1-138AKF', 'H1-138FC2'), finial('L', 12, 'H1-138WCGF', 'H1-138WFCON2'), collar('L', 7, 'H1-138FC2', 'CE-INV-60132'), feeCollar('L', 5, 'H1-138WFCON2')];
f = collarAudit(pins, clusters);
eq('the acrylic collar is fine, the wood one is not', [kinds(f), f.every(x => /H1-138WFCON2/.test(x.msg) && !/H1-138FC2/.test(x.msg))], [['red:COLLAR NOT TAGGED', 'red:NO COLLAR'], true]);
pins = [finial('L', 8, 'A', 'COL'), finial('R', 8, 'A', 'COL'), { id: 'c', clusterId: 'SHARED', partName: 'COL', isCollar: true }];
eq('one collar on a slot with no position serves both ends', collarAudit(pins, [...clusters, { id: 'SHARED', name: 'COLLAR' }]), []);

// ── parked pins are not on the order, so they are not judged ───────────────────────────────
eq('a parked finial asks for nothing', collarAudit([{ ...finial('L', 8, 'A', 'H1-138FC2'), parked: true }], clusters), []);
eq('a parked collar is not a collar', kinds(collarAudit([finial('L', 8, 'A', 'H1-138FC2'), { ...collar('L', 7, 'H1-138FC2', 'D'), parked: true }], clusters)), ['red:NO COLLAR']);
eq('empty inputs', [collarAudit(), collarAudit(null, null)], [[], []]);

console.log(`collarAudit: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
