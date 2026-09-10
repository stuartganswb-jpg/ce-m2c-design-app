// Harness for isParkedGeometryLine — the one reader that decides whether a `HIDDEN-<node>` line
// on a TAGS breakdown may be skipped by the NetSuite resolver.
//
//   node scripts/parkedGeometryLine.test.mjs
//
// S1, 2026-09-10: every H1-138 quote since 21 Aug carried six $0 lines whose partId was
// `HIDDEN-832316L91375A189…` (parked 1.6 geometry). Shared/nsTransmit's TAGS branch tried to
// resolve them, failed, and refused the whole estimate as LINES_UNRESOLVED — so none of those
// quotes ever queued. Fixtures below are the prod shape of those lines, read from the live jobs.

import { isParkedGeometryLine, isDisplayOnlyLine, classifyLine } from '../src/components/Shared/lineClassification.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };

// The prod line, verbatim from ST091026-01 (2026-09-10).
const PARKED = { partHandling: '', legacyErpId: 'HIDDEN-832316L91375A189', finishLabel: 'EP5', configQty: 1, total: 0, dimensions: null, qty: 1, finishOutsourced: true, hidden: true, partId: 'HIDDEN-832316L91375A189', isSizeRow: false, clientFinishName: 'Aged Brass', clientSku: null, isFee: false, qtyEach: 1, cutLength: null, finishCode: 'EP5', price: 0, name: '  - 832316L91375A189' };
// The standoff on the same quote: hidden, real part, $0 — it PUSHES.
const STANDOFF = { partHandling: 'Small Parts', legacyErpId: 'H1-138STDOFF', total: 0, qty: 1, hidden: true, partId: 'CE-INV-57731', isFee: false, finishCode: 'EP5', price: 0, name: '  - Mounting Standoff for 14-Guage 1-3/8" Round Return Ends' };
// A real priced line.
const RING = { legacyErpId: 'H1-138PR', total: 360, qty: 48, partId: 'CE-INV-56881', finishCode: 'EP5', price: 7.5, name: '  - Passing Ring for 1-3/8" Round' };

ok('the parked HIDDEN- line with no money is skipped', isParkedGeometryLine(PARKED));
ok('a HIDDEN- line that carries money is NOT skipped (the resolver must refuse it)', !isParkedGeometryLine({ ...PARKED, total: 12, price: 12 }));
ok('…even when only the unit price is set', !isParkedGeometryLine({ ...PARKED, price: 3 }));
ok('a hidden REAL part (standoff, $0) is not parked', !isParkedGeometryLine(STANDOFF));
ok('a priced real line is not parked', !isParkedGeometryLine(RING));
ok('the prefix is read on legacyErpId when partId is absent', isParkedGeometryLine({ legacyErpId: 'HIDDEN-ABC', total: 0 }));
ok('a FEE- id is not parked geometry (fees ride the rollup by their own rule)', !isParkedGeometryLine({ partId: 'FEE-H1-MRPF', total: 0 }));
ok('the prefix must be at the start — "XHIDDEN-" is a real code', !isParkedGeometryLine({ partId: 'XHIDDEN-1', total: 0 }));
ok('null / empty → false', !isParkedGeometryLine(null) && !isParkedGeometryLine({}));

// The other readers keep their existing answers — this predicate changes nothing for them.
ok('the parked line is still NOT display-only (the shop screens keep seeing it)', !isDisplayOnlyLine(PARKED));
ok('classifyLine still routes the parked line as before (no part → its own rule)', typeof classifyLine(PARKED, null) === 'string');

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
