// Before a plated line is put away, NetSuite must hold what it posts against (Mark, App Imp 2026-09-28).   node scripts/platingPutAway.test.mjs
import { platingBalancesSql, assemblyBomSql, balancesOf, bomOf, platingPutAwayCheck, SUITEQL_PAGE } from '../src/components/Shared/platingPutAway.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// ── the queries ─────────────────────────────────────────────────────────────────────────────
ok('balances: one item, one location', platingBalancesSql('54831', 17).includes('ib.item = 54831 AND ib.location = 17'));
ok('bom: the assembly by id, active revisions only', /aib\.assembly = 56167 AND NVL\(br\.isinactive, 'F'\) = 'F'/.test(assemblyBomSql('56167')));
let threw = 0;
try { platingBalancesSql('54831; DROP', 17); } catch (e) { threw++; }
try { assemblyBomSql(''); } catch (e) { threw++; }
ok('anything that is not an id is refused', threw === 2);

// ── rows → facts; a full page is not knowledge ──────────────────────────────────────────────
eq('balance rows normalised', balancesOf([{ bin: 'plating', status: 13, statusname: 'WIP-Plating', qty: '6' }]), [{ bin: 'PLATING', status: '13', statusName: 'WIP-Plating', qty: 6 }]);
ok('no rows read = unknown', balancesOf(null) === null && bomOf(undefined) === null);
ok('a page of 1000 may be cut off = unknown', balancesOf(new Array(SUITEQL_PAGE).fill({ bin: 'X', status: 1, qty: 1 })) === null);
eq('an empty read is knowledge: nothing there', balancesOf([]), []);

const asm = { id: '56191', type: 'Assembly' };
const base = { erpId: 'H1-75BP-H', netSuiteInternalId: '54831', platingBin: 'PLATING', fromBin: 'PRD-008' };

// ── 1 · the return: the pieces must be in the plating bin as WIP-Plating ─────────────────────
// H1-75BP-H/EP3, the 9:14 / 9:20 / 9:28 cards: nothing in PLATING, 195 Good back in PRD-008.
let r = platingPutAwayCheck({ line: base, got: 12, target: 'H1-75BP-H/EP3', assembly: asm, pulledOn: '6/22',
    balances: balancesOf([{ bin: 'PRD-008', status: 1, statusname: 'Good', qty: 195 }]), bom: bomOf([{ id: 54831, code: 'H1-75BP-H' }]) });
eq('not in the plating bin → refused before anything posts', [r.ok, r.reason], [false, 'NOT_IN_PLATING_BIN']);
ok('…in words: what it needs, what NetSuite holds, where, who fixes it', /must hold 12 × H1-75BP-H in PLATING as WIP-Plating — it holds 0 there/.test(r.msg) && /195 · PRD-008 · Good/.test(r.msg) && /Stuart \/ Eric/.test(r.msg) && /on 6\/22/.test(r.msg) && /Nothing was posted/.test(r.msg));
// H1-138BP-S: nothing at the location at all
r = platingPutAwayCheck({ line: { ...base, erpId: 'H1-138BP-S', netSuiteInternalId: '56962', fromBin: 'PRD-001' }, got: 12, target: 'H1-138BP-S/EP3', assembly: asm, balances: balancesOf([]), bom: null });
ok('nothing at the location → said so', !r.ok && /none at this location/.test(r.msg));
// H1-75CP-H: 6 in WIP-Plating, one line of 12
r = platingPutAwayCheck({ line: { ...base, erpId: 'H1-75CP-H', netSuiteInternalId: '54837', fromBin: 'PRD-001' }, got: 12, target: 'H1-75CP-H/EP3', assembly: asm,
    balances: balancesOf([{ bin: 'PRD-015', status: 1, statusname: 'Good', qty: 10 }, { bin: 'PLATING', status: 13, statusname: 'WIP-Plating', qty: 6 }]), bom: null });
ok('fewer in WIP-Plating than came back → refused, the 6 named', !r.ok && /it holds 6 there/.test(r.msg));
// a short return scraps out of WIP-Plating too: 11 back + 1 scrapped needs 12
r = platingPutAwayCheck({ line: base, got: 11, scrap: 1, target: 'X/EP3', assembly: asm, balances: balancesOf([{ bin: 'PLATING', status: 13, qty: 11 }]), bom: null });
ok('the scrap counts against WIP-Plating too', !r.ok && /must hold 12 ×/.test(r.msg));
// H1-138BR: 400 in WIP-Plating, four lines of 100 — goes ahead
r = platingPutAwayCheck({ line: { ...base, erpId: 'H1-138BR', netSuiteInternalId: '56989', fromBin: 'PRD-002' }, got: 100, target: 'H1-138BR/EP1', assembly: asm,
    balances: balancesOf([{ bin: 'PLATING', status: 13, qty: 400 }, { bin: 'PRD-129', status: 1, qty: 176 }]), bom: bomOf([{ id: 56989, code: 'H1-138BR' }]) });
ok('NetSuite holds it → goes ahead', r.ok === true);
ok('the bin is matched whatever its case', platingPutAwayCheck({ line: { ...base, platingBin: 'plating' }, got: 5, target: 'X', assembly: asm, balances: balancesOf([{ bin: 'Plating', status: 13, qty: 5 }]), bom: null }).ok);
ok('Good stock in the plating bin is not WIP-Plating', !platingPutAwayCheck({ line: base, got: 5, target: 'X', assembly: asm, balances: balancesOf([{ bin: 'PLATING', status: 1, qty: 50 }]), bom: null }).ok);
ok('balances unknown → never refused on them', platingPutAwayCheck({ line: base, got: 12, target: 'X', assembly: asm, balances: null, bom: null }).ok);
ok('return already posted → the plating bin is not asked again', platingPutAwayCheck({ line: { ...base, wipReversed: true, scrapPosted: true }, got: 12, target: 'X', assembly: asm, balances: balancesOf([{ bin: 'PRD-008', status: 1, qty: 12 }]), bom: null }).ok);

// ── 2 · the build: the part that went to plating must be on the assembly's BOM ───────────────
// H1-75RCP-H/EP3, the 9:25 card: its BOM consumes H1-75CP-H; the return had already posted.
const rcp = { ...base, erpId: 'H1-75RCP-H', netSuiteInternalId: '54841', fromBin: 'PRD-014', wipReversed: true };
r = platingPutAwayCheck({ line: rcp, got: 12, target: 'H1-75RCP-H/EP3', assembly: { id: '56167', type: 'Assembly' },
    balances: balancesOf([{ bin: 'PRD-014', status: 1, statusname: 'Good', qty: 95 }]), bom: bomOf([{ id: 54837, code: 'H1-75CP-H' }, { id: 55989, code: 'SVC-FIN-BPLT/EP3' }]) });
eq('not on the BOM → refused', [r.ok, r.reason], [false, 'NOT_ON_BOM']);
ok('…naming what the BOM does consume, who fixes it, and that the return will not repeat', /consumes: H1-75CP-H, SVC-FIN-BPLT\/EP3/.test(r.msg) && /\(Eric\)/.test(r.msg) && /will not post again/.test(r.msg));
ok('on the BOM by internal id even if the code were renamed', platingPutAwayCheck({ line: rcp, got: 12, target: 'X', assembly: asm, balances: null, bom: bomOf([{ id: 54841, code: 'H1-75RCP-H-OLD' }]) }).ok);
ok('no BOM read → never refused on it', platingPutAwayCheck({ line: rcp, got: 12, target: 'X', assembly: asm, balances: null, bom: null }).ok);

// ── 3 · after the return: the build takes the pieces as Good from where they came back ───────
r = platingPutAwayCheck({ line: rcp, got: 12, target: 'X', assembly: asm, balances: balancesOf([{ bin: 'PRD-014', status: 1, qty: 5 }]), bom: null });
ok('returned, but not enough Good in the from-bin → refused', !r.ok && r.reason === 'NOT_GOOD_IN_FROM_BIN' && /12 × H1-75RCP-H as Good from PRD-014, and NetSuite holds 5/.test(r.msg));
ok('bins already built are not asked for again', platingPutAwayCheck({ line: { ...rcp, builtPlacements: [{ bin: 'A', qty: 8 }] }, got: 12, target: 'X', assembly: asm, balances: balancesOf([{ bin: 'PRD-014', status: 1, qty: 4 }]), bom: null }).ok);

// ── the assembly itself ─────────────────────────────────────────────────────────────────────
eq('no assembly in NetSuite → refused before the return posts', platingPutAwayCheck({ line: base, got: 1, target: 'H1-75BP-H/EP9', assembly: null, balances: null, bom: null }).reason, 'NO_ASSEMBLY');
eq('not an assembly → refused', platingPutAwayCheck({ line: base, got: 1, target: 'X', assembly: { id: '1', type: 'InvtPart' }, balances: null, bom: null }).reason, 'NOT_AN_ASSEMBLY');

console.log(`platingPutAway: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
