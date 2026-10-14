// A paint-run pull takes the pieces out of the bin NetSuite holds them in — offline.
//   node scripts/jfpPull.test.mjs
// Stuart 2026-10-14: "go ahead on all fixes". Each case below is one of the nine pulls NetSuite refused 10-09…10-13.
import { jfpPullBinOf, jfpAdjustmentOf, jfpSkipText } from '../src/components/Shared/jfpPull.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const live = (bins) => ({ known: true, bins: bins.map(([name, id, qty]) => ({ bin: name.toUpperCase(), name, id, qty })) });

// HTFWP835: scanned "PRODUCTION STOCK"; NetSuite's bin is "Production Stock" (id 12), 137 there.
eq('the scan in capitals finds NetSuite\'s bin and sends its ID', jfpPullBinOf({ scanned: 'PRODUCTION STOCK', qty: 7, live: live([['Production Stock', '12', 137]]) }), { ok: true, bin: { id: '12', name: 'Production Stock' } });
eq('…typed in any case', jfpPullBinOf({ scanned: 'production stock ', qty: 4, live: live([['Production Stock', '12', 137]]) }).bin.id, '12');
// HCUMWND40: "WANDS" × 5 and × 4, NetSuite holds 4 in "Wands".
eq('…the first pull of 5 finds only 4 there: not sent, and says so', jfpPullBinOf({ scanned: 'WANDS', qty: 5, live: live([['Wands', '30', 4]]) }), { ok: false, why: 'NetSuite holds only 4 in Wands, 5 were pulled' });
eq('…a pull of 4 goes', jfpPullBinOf({ scanned: 'WANDS', qty: 4, live: live([['Wands', '30', 4]]) }).ok, true);
// HCUWR138: "UNASSIGND" typed, NetSuite holds none here.
eq('a typo is not a bin, and NetSuite holding none here is said', jfpPullBinOf({ scanned: 'UNASSIGND', qty: 40, live: { known: false, bins: [] } }), { ok: false, why: 'NetSuite shows none of this item in any bin here (it may be an inactive or kit record, or never received)' });
eq('a scanned bin NetSuite does not hold it in names where it is', jfpPullBinOf({ scanned: 'UNASSIGND', qty: 2, live: live([['M E7-N5-R3', '77', 9], ['RAW', '5', 3]]) }), { ok: false, why: 'NetSuite shows none in "UNASSIGND" — it holds M E7-N5-R3 9, RAW 3' });
// HCUMP415: no bin scanned (the line said UNASSIGNED); NetSuite holds 30 in FINISHING-WIP.
eq('no bin scanned: not sent, and says where it is', jfpPullBinOf({ scanned: 'UNASSIGNED', qty: 10, live: live([['FINISHING-WIP', '41', 30]]) }), { ok: false, why: 'no bin was scanned — NetSuite holds it in FINISHING-WIP 30' });
eq('…nor blank', jfpPullBinOf({ scanned: '', qty: 10, live: live([['FINISHING-WIP', '41', 30]]) }).why, 'no bin was scanned — NetSuite holds it in FINISHING-WIP 30');
// HCUSP435/CW31: 3 pulled from M E7-N5-R3, NetSuite holds 2.
eq('fewer in the bin than pulled', jfpPullBinOf({ scanned: 'M E7-N5-R3', qty: 3, live: live([['M E7-N5-R3', '77', 2]]) }).why, 'NetSuite holds only 2 in M E7-N5-R3, 3 were pulled');
// HCUSP635/CW16: an inactive kit — NetSuite returns no stock rows at all.
eq('an item NetSuite holds none of (an inactive kit) is not adjusted', jfpPullBinOf({ scanned: 'M E7-N5-R3', qty: 4, live: { known: false, bins: [] } }).ok, false);
eq('the read failed: not sent', jfpPullBinOf({ scanned: 'RAW', qty: 1, live: null }), { ok: false, why: 'NetSuite\'s bins for this item could not be read just now' });
eq('nothing pulled', jfpPullBinOf({ scanned: 'RAW', qty: 0, live: live([['RAW', '5', 3]]) }).ok, false);
eq('a bin read with no qty left does not count', jfpPullBinOf({ scanned: 'RAW', qty: 1, live: live([['RAW', '5', 0]]) }).ok, false);

// ── the adjustment ──
const adj = jfpAdjustmentOf({ nsId: 21561, qty: 7, bin: { id: '12', name: 'Production Stock' }, subsidiary: '2', location: '17', memo: 'JFP pull' });
eq('out of the bin by its id, at the location, −qty', adj, { account: { id: '254' }, subsidiary: { id: '2' }, memo: 'JFP pull', inventory: { items: [{ item: { id: '21561' }, location: { id: '17' }, adjustQtyBy: -7, inventoryDetail: { quantity: -7, inventoryAssignment: { items: [{ binNumber: { id: '12' }, quantity: -7 }] } } }] } });
eq('no id read: NetSuite\'s own spelling, never the scan', jfpAdjustmentOf({ nsId: 1, qty: 2, bin: { id: '', name: 'Wands' }, subsidiary: '2', location: '17' }).inventory.items[0].inventoryDetail.inventoryAssignment.items[0].binNumber, { refName: 'Wands' });
ok('the picker is told the pick stands and NetSuite was not adjusted', /^Pick recorded — but NetSuite was NOT adjusted for −5 × HCUMWND40 \(WO-JFP-1\): NetSuite holds only 4 in Wands, 5 were pulled\./.test(jfpSkipText({ code: 'HCUMWND40', qty: 5, ref: 'WO-JFP-1', why: 'NetSuite holds only 4 in Wands, 5 were pulled' })));

console.log(`jfpPull: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
