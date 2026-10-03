// ⚠ A NetSuite build the force-complete skipped (Eric 2026-10-02, WO11639).   node scripts/skippedBuild.test.mjs
import { buildSkippedAtForceComplete, buildQtyOf, typedWoNumber, skippedBuildHint, SKIPPED_BUILD_TEXT, buildRepairOf, buildRepairLabel, buildRepairTexts, buildRepairStamp } from '../src/components/Shared/skippedBuild.js';
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
eq('the hint names RTG\'s one repair, the quantity and the bin', skippedBuildHint(wo), 'If NetSuite does NOT show WO11639 built: RTG → this order → "🔨 post only if NetSuite shows none", type WO11639 — it builds 192 into RTS-CUS.');
ok('the words a screen shows', /SKIPPED at force-complete/.test(SKIPPED_BUILD_TEXT));

// ── the question at force-complete ──────────────────────────────────────────────────────────
eq('typing the WO number skips the build', [typedWoNumber('WO11639', wo), typedWoNumber(' wo11639 ', wo), typedWoNumber('930292', wo)], [true, true, true]);
eq('anything else — blank, OK, a yes, another WO — builds', [typedWoNumber('', wo), typedWoNumber('ok', wo), typedWoNumber('yes', wo), typedWoNumber('WO11638', wo), typedWoNumber(null, wo)], [false, false, false, false, false]);
eq('nothing', [buildSkippedAtForceComplete(null), typedWoNumber('WO1', null)], [false, false]);

// ── RTG's "🔨 post now" ─────────────────────────────────────────────────────────────────────
const r1 = buildRepairOf(wo);
eq('WO11639 is offered — marked already built, so it says so', [r1.ref, r1.qty, r1.bin, r1.sales, r1.markedBuilt], ['WO11639', 192, 'RTS-CUS', false, true]);
eq('…its words', buildRepairLabel(r1), '⚠ Marked ALREADY BUILT at force-complete — 🔨 post only if NetSuite shows none');
const aug = { id: 'WO-STK-62063-1787244566827', orderType: 'stock', nsWoId: '1', nsWoTran: 'WO11461', packStatus: 'Packed', putawayBin: 'U S19', totalParts: 24, forceCompleteNsBuildSkipped: true, nsCompletionQueued: true };
eq('an August job marked built by hand reads as marked — never as "never posted"', buildRepairLabel(buildRepairOf(aug)).startsWith('⚠ Marked ALREADY BUILT'), true);
const plain = { ...aug, forceCompleteNsBuildSkipped: undefined, nsCompletionQueued: undefined };
eq('a job nobody marked keeps today\'s words', buildRepairLabel(buildRepairOf(plain)), '⚠ NS build never posted — 🔨 post now');
// WO11578: an Order Entry sales job, force-completed 10/1 with its build switched off; once packed:
const oe = { id: 'WO-OE-HRW-138TRAVLB-1788201851904-0', orderType: 'sales', nsWoId: '2', nsWoTran: 'WO11578', packStatus: 'Packed', totalParts: 4, completedParts: 4, nsCompletionQueued: true, stockErpId: 'H1-138TRAV' };
const r2 = buildRepairOf(oe);
eq('an Order Entry sales job with an anchor WO is offered (the server builds those too)', [r2.ref, r2.qty, r2.sales, r2.bin, r2.markedBuilt], ['WO11578', 4, true, '', false]);
eq('…not before it is packed', buildRepairOf({ ...oe, packStatus: '' }), null);
eq('…posted as the server posts a sales build', buildRepairTexts(oe, r2), { label: 'Build NS WO WO11578 — H1-138TRAV ×4 · SALES', memo: 'SO build WO-OE-HRW-138TRAVLB-1788201851904-0 packed — posted from RTG (auto build never fired)' });
eq('a FLOW1 sales job builds its base assembly', buildRepairTexts({ ...oe, nsWoOnErp: 'H1-138' }, buildRepairOf({ ...oe, nsWoOnErp: 'H1-138' })).label, 'Build NS WO WO11578 — H1-138 (base assembly) ×4 · SALES');
eq('the stock memo names the bin', buildRepairTexts(wo, r1).memo, 'Stock build WO-STK-49017-1790350164427 put away RTS-CUS — posted from RTG (auto build never fired)');
eq('a custom order with no work order, a posted build, a quick-ship doc: nothing to post', [buildRepairOf({ ...oe, nsWoId: '' }), buildRepairOf({ ...wo, nsWoCompletionPosted: true }), buildRepairOf({ ...wo, orderType: 'quickship' })], [null, null, null]);
eq('posting clears the skip stamp — the SKIPPED labels go', buildRepairStamp(r1, { by: 'Eric', now: 7 }), { nsCompletionQueued: true, forceCompleteNsBuildSkipped: false, nsBuildPostedFromRtgBy: 'Eric', nsBuildPostedFromRtgAt: 7 });
eq('…an unmarked job is only stamped queued', buildRepairStamp(r2, { by: 'Eric', now: 7 }), { nsCompletionQueued: true, nsBuildPostedFromRtgBy: 'Eric', nsBuildPostedFromRtgAt: 7 });

console.log(`skippedBuild: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
