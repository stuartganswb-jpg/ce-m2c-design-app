// A display order is BORN parked for 10.5, whichever door (Stuart 2026-10-07).   node scripts/displayPark.test.mjs
//
// "auto release on RTG was turned off while we worked on this 10.5 … while these display orders stay parked and await us
//  releasing from 10.5 … i really would like to put the auto release back on to cover the day to day orders."
// The contract: the mark rides the quote (CPQ / CRM doors) or the tab-7 header (Order Entry door); the ONE header stamps
// the sales order with the field RTG's split, RTG's Order Entry start and Stock View's review already stand down for,
// and with release-by-count so the WMS offers nothing until a row is released; the 10.5 anchor then only adds the count.
import { soHeaderOf, displayOrderOf, displayParkOf } from '../src/components/Shared/salesOrderHeader.js';
import { anchorCountPatchOf, isReleaseByCount, lineTargetOf, rowTargetOf } from '../src/components/Shared/rowRelease.js';
import { soLineReleasedOf } from '../src/components/Shared/pickLines.js';
import { orderDemandLines, displayDemandFrom } from '../src/components/Shared/displayBom.js';
import { isOrderEntryOrder } from '../src/components/Shared/reopenQuote.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond) => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name}`); };

// ── the mark, read one way ───────────────────────────────────────────────────────────────────────────
eq('a build and a count', displayOrderOf({ buildId: 'BUILD-TT-100', displays: 100 }), { buildId: 'BUILD-TT-100', displays: 100 });
eq('a tick alone (tab 7, or CPQ by hand) is still a display order', displayOrderOf(true), { buildId: '', displays: 0 });
eq('a count typed as text, a stray fraction', [displayOrderOf({ displays: '35' }).displays, displayOrderOf({ displays: 12.9 }).displays, displayOrderOf({ displays: -4 }).displays], [35, 12, 0]);
eq('nothing ticked is nothing', [displayOrderOf(null), displayOrderOf(undefined), displayOrderOf(false), displayOrderOf(0), displayOrderOf('')], [null, null, null, null, null]);
eq('the park says exactly three things', displayParkOf({ buildId: 'B1', displays: 100 }), { displayOrder: { buildId: 'B1', displays: 100 }, displayRelease: true, releaseByCount: true });
eq('…and nothing at all for an ordinary order', displayParkOf(null), {});
ok('it never carries the fields the ANCHOR owns (a rebuilt header must not move an anchored order)', !('displayBuildId' in displayParkOf({ buildId: 'B1', displays: 100 })) && !('releaseOf' in displayParkOf({ buildId: 'B1', displays: 100 })) && !('orderClass' in displayParkOf(true)) && !('lines' in displayParkOf(true)));

// ── the one header, three doors ──────────────────────────────────────────────────────────────────────
const job = (extra = {}) => ({ id: 'QUOTE-1', jobId: 'QUOTE-1', customer: { id: 'CUST-4720', name: 'FABRICUT' }, jobName: 'TABLE TOP DISPLAY', poNumber: 'PO-9', cpqData: { breakdown: [] }, ...extra });
{
    const plain = soHeaderOf({ door: 'CPQ', job: job() });
    ok('CPQ, not a display: no mark — RTG splits it as it always has', !('displayRelease' in plain) && !('releaseByCount' in plain) && !('displayOrder' in plain));
    const cpq = soHeaderOf({ door: 'CPQ', job: job({ displayOrder: { buildId: 'BUILD-TT-100', displays: 100 } }) });
    eq('CPQ save-as-sales-order: born parked', [cpq.displayRelease, cpq.releaseByCount, cpq.displayOrder], [true, true, { buildId: 'BUILD-TT-100', displays: 100 }]);
    const crm = soHeaderOf({ door: 'CRM', job: job({ displayOrder: { buildId: 'BUILD-TT-100', displays: 100 } }) });
    eq('CRM Approve: born parked, the same three', [crm.displayRelease, crm.releaseByCount, crm.displayOrder, crm.source], [true, true, { buildId: 'BUILD-TT-100', displays: 100 }, 'CRM']);
    ok('the rest of the header is untouched', crm.customer === 'FABRICUT' && crm.customerPo === 'PO-9' && crm.hqJobId === 'QUOTE-1' && crm.appCreated === true);
    const oe = soHeaderOf({ door: 'QUICKSHIP', form: { soExtras: { po: 'PO-7', displayOrder: true }, ship: {}, jobName: 'Wall Displays', lines: [{ erp: 'H1-75SR', toBeFinished: true, finishCode: 'P06' }], customerName: 'FABRICUT', customerId: 'CUST-4720' } });
    eq('Order Entry (tab 7): the same tick, the same park', [oe.displayRelease, oe.releaseByCount, oe.displayOrder, oe.source], [true, true, { buildId: '', displays: 0 }, 'QUICKSHIP']);
    const oePlain = soHeaderOf({ door: 'QUICKSHIP', form: { soExtras: { po: 'PO-7' }, ship: {}, jobName: 'x', lines: [] } });
    ok('Order Entry, not ticked: no mark — its lines start by themselves as before', !('displayRelease' in oePlain) && !('releaseByCount' in oePlain));
    ok('an unticked box saved on the quote is no mark', !('displayRelease' in soHeaderOf({ door: 'CRM', job: job({ displayOrder: null }) })));
}

// ── what RTG and the WMS then read on the newborn order ──────────────────────────────────────────────
{
    // CPQ door: the order as CRM Approve writes it — Approved, a job, no lines yet.
    const born = { id: 'SO-APP-ST100726-01', soId: 'SO-APP-ST100726-01', status: 'Approved', createdAt: Date.now(), ...soHeaderOf({ door: 'CRM', job: job({ displayOrder: { buildId: 'BUILD-TT-100', displays: 100 } }) }), nsInternalId: '930001' };
    // RTG's split picks: status Approved && hqJobId && (!appCreated || nsInternalId) && !displayRelease && !isOrderEntryOrder
    const rtgWouldSplit = (o) => o.status === 'Approved' && !!o.hqJobId && (!o.appCreated || !!o.nsInternalId) && !o.displayRelease && !isOrderEntryOrder(o);
    ok('RTG\'s whole-order split stands down for it, NetSuite id or not', rtgWouldSplit(born) === false);
    ok('…and would have taken the same order without the mark (the trap that split SO60551 and SO60585)', rtgWouldSplit({ ...born, displayRelease: undefined }) === true);
    ok('it is released by count from its first second', isReleaseByCount(born));
    // Order Entry door: lines exist at birth, and the WMS card with them.
    const oeBorn = { id: 'QS-1', status: 'Pending', orderClass: 'QUICKSHIP', ...displayParkOf(true), nsInternalId: '930002',
        lines: [{ erp: 'HTTENDSTOP', qty: 200, row: 'Row 4', toBeFinished: false }, { erp: 'H1-75SPF', qty: 200, row: 'Row 1', toBeFinished: true, finishCode: 'P06' }] };
    // RTG's Order Entry start skips: … || o.displayRelease
    ok('RTG\'s Order Entry start stands down for it', !!oeBorn.displayRelease);
    eq('the warehouse is offered NOTHING of a stocked line until its row is released', soLineReleasedOf(oeBorn, oeBorn.lines[0], 0), { shelf: 0, floor: 0, total: 0 });
    eq('…nor of a made line', soLineReleasedOf(oeBorn, oeBorn.lines[1], 1).total, 0);
    eq('no count yet, nothing released, and no error raised about it', [rowTargetOf(oeBorn, 'ROW_4'), lineTargetOf(oeBorn, oeBorn.lines[0]).qty, lineTargetOf(oeBorn, oeBorn.lines[0]).ok], [0, 0, true]);
    ok('the SAME order without the mark is released whole (every order before today)', soLineReleasedOf({ ...oeBorn, releaseByCount: false }, oeBorn.lines[0], 0).total === 200);
    // Its demand: not anchored → its build order still publishes the bill; anchored → its own lines.
    eq('once anchored (by count) every piece of it is still to be covered', orderDemandLines({ ...oeBorn, releaseOf: 100 }).map(l => [l.seed.code, l.qty]), [['HTTENDSTOP', 200], ['H1-75SPF', 200]]);
    const build = { id: 'B1', name: 'TT × 100', qty: 100, built: 0, status: 'PLANNED', lines: { parts: [{ code: 'H1-75SPF/P', finishCode: 'P06', qtyPerBoard: 2 }], chips: [] } };
    ok('before the anchor the build order publishes its bill (the order is not on the build yet)', displayDemandFrom([build], { ordersByBuild: {} }).byItem['H1-75SPF/P|P06'].qty === 200);
}

// ── the anchor adds the count ────────────────────────────────────────────────────────────────────────
{
    const born = { id: 'SO-1', ...displayParkOf({ buildId: 'B1', displays: 100 }) };
    eq('an order born parked only lacks how many displays it is — the build says', anchorCountPatchOf(born, 100), { releaseByCount: true, releaseOf: 100 });
    eq('…and once it has its count the anchor adds nothing', anchorCountPatchOf({ ...born, releaseOf: 100 }, 120), {});
    eq('an ordinary order nothing has started goes onto counts, as before', anchorCountPatchOf({ id: 'SO-2', lines: [] }, 35), { releaseByCount: true, releaseOf: 35 });
    eq('one already started keeps the whole-row rules it began under', anchorCountPatchOf({ id: 'SO-3', oeGen: { 0: { kind: 'WO', ids: ['W'] } } }, 35), {});
    eq('one with pieces already gathered likewise', anchorCountPatchOf({ id: 'SO-4', committedQty: { 'H1-1R/EP4': 50 } }, 50), {});
    eq('a build that names no count adds none', anchorCountPatchOf({ id: 'SO-5' }, 0), {});
    eq('no order, nothing', anchorCountPatchOf(null, 100), {});
    const anchored = { ...born, ...anchorCountPatchOf(born, 100), rowRelease: { ROW_4: { boards: 10, of: 100 } }, lines: [{ erp: 'HTTENDSTOP', qty: 200, row: 'Row 4', toBeFinished: false }] };
    eq('then 10 of 100 released offers 20 of 200', soLineReleasedOf(anchored, anchored.lines[0], 0).total, 20);
}

console.log(`\ndisplayPark: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
