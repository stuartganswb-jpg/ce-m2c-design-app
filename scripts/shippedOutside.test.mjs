// Shipped outside the app (Stuart 2026-10-21).   node scripts/shippedOutside.test.mjs
// The 26 left on the WMS Fulfillment tab on 10-21, as NetSuite answered for them.
import { soKeyOf, soStatusSqlOf, fulfilmentsSqlOf, statusWordOf, nsDateMs, nsShipStateOf, indexShipChecks, checkFor, sameOrderDocsOf, outsideShipPatchOf, outsideShipConfirmOf, billStateOf, indexSoStatus, soStatusFor } from '../src/components/Shared/shippedOutside.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}${extra ? `\n    ${extra}` : ''}`); };

// ── which order a packed piece belongs to ──
eq('a finishing doc → its SO number', soKeyOf({ id: 'WO-SO60831-EP5', salesOrderId: 'SO60831', orderKey: 'SO60831' }, '938938'), { nsId: '938938', tran: 'SO60831' });
eq('a Quick Ship order → soId', soKeyOf({ id: 'QS-1791469669669', soId: 'SO60993' }, '948449'), { nsId: '948449', tran: 'SO60993' });
eq('no NetSuite id known → the number alone', soKeyOf({ salesOrderId: 'SO60169' }, ''), { nsId: '', tran: 'SO60169' });
eq('a non-number id is ignored', soKeyOf({ salesOrderId: 'SO60169' }, 'PENDING'), { nsId: '', tran: 'SO60169' });
eq('an UNIQ number counts', soKeyOf({ soId: 'SOUNIQ-4016' }).tran, 'SOUNIQ-4016');
eq('a shop key is not an SO number', soKeyOf({ orderKey: 'SHOP-SO60420' }).tran, '');

// ── the reads ──
const sql = soStatusSqlOf([{ nsId: '903782', tran: 'SO60169' }, { nsId: '', tran: 'SO60420' }, { nsId: '903782', tran: 'SO60169' }]);
eq('status read: ids and numbers, once each', sql, "SELECT t.id, t.tranid, BUILTIN.DF(t.status) AS st FROM transaction t WHERE t.type = 'SalesOrd' AND (t.id IN (903782) OR t.tranid IN ('SO60169','SO60420'))");
eq('nothing to ask → no query', soStatusSqlOf([{ nsId: '', tran: '' }]), '');
ok('only ids and numbers reach a query', !/DROP/.test(soStatusSqlOf([{ nsId: '1);DROP', tran: "X'; DROP" }])));
eq('fulfilments read (the shape that ran on 10-21)', fulfilmentsSqlOf(['903782', '912672']), "SELECT t.id, t.tranid, t.trandate, tl.createdfrom AS src FROM transaction t, transactionline tl WHERE tl.transaction = t.id AND tl.mainline = 'T' AND t.type = 'ItemShip' AND tl.createdfrom IN (903782,912672)");
eq('no ids → no query', fulfilmentsSqlOf(['x']), '');

// ── what NetSuite's status says ──
eq('status word', statusWordOf('Sales Order : Pending Billing/Partially Fulfilled'), 'Pending Billing/Partially Fulfilled');
eq('date', new Date(nsDateMs('9/17/2026')).toDateString(), new Date(2026, 8, 17).toDateString());
eq('bad date → 0', nsDateMs('2026-09-17'), 0);
let c = nsShipStateOf({ id: '903782', tranid: 'SO60169', st: 'Sales Order : Billed' }, [{ id: '1', tranid: 'IF73569', trandate: '9/17/2026' }]);
eq('Billed + its fulfilment → SHIPPED', [c.state, c.status, c.tran, c.ifs.map(f => f.tranid), new Date(c.shipDate).getDate()], ['SHIPPED', 'Billed', 'SO60169', ['IF73569'], 17]);
ok('…its line names the IF and the status', /NetSuite shipped this — IF73569 · Sep 17 · Billed/.test(c.line), c.line);
c = nsShipStateOf({ id: '929846', tranid: 'SO60712', st: 'Sales Order : Billed' }, [{ id: '1', tranid: 'IF73891', trandate: '10/1/2026' }, { id: '2', tranid: 'IF74068', trandate: '10/9/2026' }]);
eq('two fulfilments: newest first, the ship date is the last one', [c.ifs.map(f => f.tranid), new Date(c.shipDate).getDate()], [['IF74068', 'IF73891'], 9]);
eq('Pending Billing (all fulfilled, not invoiced) → SHIPPED', nsShipStateOf({ id: '9', tranid: 'SO1', st: 'Sales Order : Pending Billing' }, [{ id: '1', tranid: 'IF1', trandate: '10/20/2026' }]).state, 'SHIPPED');
c = nsShipStateOf({ id: '912672', tranid: 'SO60420', st: 'Sales Order : Closed' }, []);
eq('SO60420 — Closed, nothing shipped → close it on RTG', [c.state, /close it on RTG/.test(c.line)], ['CLOSED_UNSHIPPED', true]);
eq('Closed after a fulfilment → SHIPPED', nsShipStateOf({ id: '9', tranid: 'SO2', st: 'Sales Order : Closed' }, [{ id: '1', tranid: 'IF9', trandate: '10/2/2026' }]).state, 'SHIPPED');
c = nsShipStateOf({ id: '939279', tranid: 'SO60838', st: 'Sales Order : Pending Fulfillment' }, []);
eq('SO60838 — Pending Fulfillment → OPEN, nothing said', [c.state, c.line], ['OPEN', '']);
eq('part shipped → PART, no button', nsShipStateOf({ id: '9', tranid: 'SO3', st: 'Sales Order : Partially Fulfilled' }, [{ id: '1', tranid: 'IF5', trandate: '10/2/2026' }]).state, 'PART');
eq('not read → UNKNOWN', nsShipStateOf(null).state, 'UNKNOWN');

// ── the answers indexed, found by id or by number ──
const idx = indexShipChecks(
    [{ id: '903782', tranid: 'SO60169', st: 'Sales Order : Billed' }, { id: '938938', tranid: 'SO60831', st: 'Sales Order : Billed' }, { id: '939279', tranid: 'SO60838', st: 'Sales Order : Pending Fulfillment' }],
    [{ id: '1', tranid: 'IF73569', trandate: '9/17/2026', src: '903782' }, { id: '2', tranid: 'IF74316', trandate: '10/9/2026', src: 938938 }],
);
eq('by id', checkFor({ nsId: '938938', tran: '' }, idx).ifs.map(f => f.tranid), ['IF74316']);
eq('by number when the id is unknown', checkFor({ nsId: '', tran: 'SO60169' }, idx).state, 'SHIPPED');
eq('not asked → null', checkFor({ nsId: '1', tran: 'SO1' }, idx), null);
eq('not read yet → null', checkFor({ nsId: '903782', tran: '' }, null), null);

// ── an order ships whole ──
const q = [
    { id: 'WO-SO60831-EP5', salesOrderId: 'SO60831' }, { id: 'WO-SO60831-S11', salesOrderId: 'SO60831' }, { id: 'WO-SO60831-UNFINISHED', salesOrderId: 'SO60831' },
    { id: 'WO-SO60833-S04', salesOrderId: 'SO60833' }, { id: 'QS-1', soId: 'SO60993' },
];
eq('SO60831: its three pieces', sameOrderDocsOf(q[0], q).map(d => d.id), ['WO-SO60831-EP5', 'WO-SO60831-S11', 'WO-SO60831-UNFINISHED']);
eq('a Quick Ship order: itself', sameOrderDocsOf(q[4], q).map(d => d.id), ['QS-1']);
eq('by NetSuite id too', sameOrderDocsOf({ id: 'A' }, [{ id: 'A' }, { id: 'B' }, { id: 'C' }], (d) => ({ nsId: d.id === 'C' ? '' : '77', tran: '' })).map(d => d.id), ['A', 'B']);

// ── the stamp ──
const check = checkFor({ nsId: '938938' }, idx);
const now = Date.UTC(2026, 9, 21, 23, 0);
const p = outsideShipPatchOf({ check, by: 'Eric', now });
eq('the ship date is NetSuite\'s, not today', new Date(p.shippedAt).toDateString(), new Date(2026, 9, 9).toDateString());
eq('…the mark keeps when and who', [p.shippedBy, p.shipCarrier, p.shippedOutside.at, p.shippedOutside.by, p.shippedOutside.nsIfTran, p.shippedOutside.soTran, p.shippedOutside.soStatus], ['Eric', 'OUTSIDE', now, 'Eric', 'IF74316', 'SO60831', 'Billed']);
ok('no UPS shipment id, no tracking — the Void button never shows for it', !('shipmentId' in p) && !('trackingNumbers' in p) && !('shipPackages' in p));
ok('nothing undefined (Firestore refuses it)', !JSON.stringify(p).includes('undefined') && Object.values(p).every(v => v !== undefined));
eq('no date from NetSuite → when it was marked', outsideShipPatchOf({ check: { ...check, shipDate: 0, ifs: [] }, by: 'Eric', now }).shippedAt, now);
const words = outsideShipConfirmOf({ check, docs: q.slice(0, 3), refOf: (d) => d.id });
ok('the confirm names the order, NetSuite, every piece and what is not done', /Mark SO60831 shipped outside the app/.test(words) && /NetSuite: Billed · IF74316 — left Oct 9/.test(words) && /3 packed pieces/.test(words) && /• WO-SO60831-S11/.test(words) && /nothing is sent to NetSuite/.test(words), words);

// ── billed, or not (RTG, 2026-10-22: "we do have occasions where they forget to bill") ──
eq('Billed → billed ✓', billStateOf('Sales Order : Billed'), { billed: true, word: 'billed ✓', status: 'Billed' });
eq('Pending Billing → NOT BILLED', billStateOf('Sales Order : Pending Billing').billed, false);
eq('…partly fulfilled too', billStateOf('Sales Order : Pending Billing/Partially Fulfilled').word, 'NOT BILLED');
eq('the app shipped it but NetSuite has no fulfilment (SO60838)', billStateOf('Sales Order : Pending Fulfillment'), { billed: false, word: 'NetSuite: Pending Fulfillment — not fulfilled there', status: 'Pending Fulfillment' });
eq('closed → says nothing about billing', billStateOf('Sales Order : Closed').billed, null);
eq('no status → null', billStateOf(''), null);
const sidx = indexSoStatus([{ id: 903782, tranid: 'SO60169', st: 'Sales Order : Billed' }, { id: '939279', tranid: 'so60838', st: 'Sales Order : Pending Fulfillment' }]);
eq('found by id', soStatusFor({ nsId: '903782', tran: '' }, sidx), 'Sales Order : Billed');
eq('found by number, any case', soStatusFor({ nsId: '', tran: 'SO60838' }, sidx), 'Sales Order : Pending Fulfillment');
eq('not asked → empty', soStatusFor({ nsId: '1', tran: 'SO1' }, sidx), '');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
