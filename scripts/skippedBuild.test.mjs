// ⚠ A NetSuite build the force-complete skipped (Eric 2026-10-02, WO11639).   node scripts/skippedBuild.test.mjs
import { buildSkippedAtForceComplete, buildQtyOf, typedAlreadyBuilt, skippedBuildHint, SKIPPED_BUILD_TEXT } from '../src/components/Shared/skippedBuild.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// WO11639 as it stands (read live 2026-10-02): force-completed "already built", put away 192 of 440 into RTS-CUS.
const wo = { id: 'WO-STK-49017-1790350164427', orderType: 'stock', nsWoId: '930292', nsWoTran: 'WO11639', forceCompleteNsBuildSkipped: true, nsCompletionQueued: true, packStatus: 'Packed', putawayBin: 'RTS-CUS', totalParts: 440, completedParts: 192 };

eq('WO11639: skipped, never posted', buildSkippedAtForceComplete(wo), true);
eq('the build posts the GOOD quantity', buildQtyOf(wo), 192);
eq('no good count recorded: the order quantity', buildQtyOf({ totalParts: 50 }), 50);
eq('a build that DID post is not a skipped build', [buildSkippedAtForceComplete({ ...wo, nsWoCompletionPosted: true }), buildSkippedAtForceComplete({ ...wo, nsWoCompletionTran: 'BUILD123' })], [false, false]);
eq('force-completed with the build left to the app: not skipped', buildSkippedAtForceComplete({ ...wo, forceCompleteNsBuildSkipped: false, nsCompletionQueued: false }), false);
eq('no NetSuite work order: nothing to build', buildSkippedAtForceComplete({ ...wo, nsWoId: '' }), false);
eq('the hint names RTG\'s one repair, the quantity and the bin', skippedBuildHint(wo), 'If NetSuite does NOT show WO11639 built: RTG → this order → "🔨 post now" builds 192 into RTS-CUS.');
ok('the words a screen shows', /SKIPPED at force-complete/.test(SKIPPED_BUILD_TEXT));

// ── the question at force-complete ──────────────────────────────────────────────────────────
eq('typing the WO number skips the build', [typedAlreadyBuilt('WO11639', wo), typedAlreadyBuilt(' wo11639 ', wo), typedAlreadyBuilt('930292', wo)], [true, true, true]);
eq('anything else — blank, OK, a yes, another WO — builds', [typedAlreadyBuilt('', wo), typedAlreadyBuilt('ok', wo), typedAlreadyBuilt('yes', wo), typedAlreadyBuilt('WO11638', wo), typedAlreadyBuilt(null, wo)], [false, false, false, false, false]);
eq('nothing', [buildSkippedAtForceComplete(null), typedAlreadyBuilt('WO1', null)], [false, false]);

console.log(`skippedBuild: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
