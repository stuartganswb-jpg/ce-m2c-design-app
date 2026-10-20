// 🧪 May this order ship? The customer's terms decide (Stuart 2026-10-17).   node scripts/shipClearance.test.mjs
import { termRuleOf, TERM_RULE, PAY_FIRST_TERMS, CREDIT_TERMS, shipFactsSql, shipFactsOf, shipClearanceOf, fetchShipClearance,
    shipHoldStampOf, shipClearedStampOf, shipReleaseStampOf, isShipHeld, mayReleaseShipHold, shipHoldText, unpostedCardOf, partialShipClearanceOf, termsStampOf,
    NO_SO_RULE, hasNsSoId, noSoClearanceOf, holdMayBeReleased } from '../src/components/Shared/shipClearance.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));

// Stuart's lists, as he gave them: 13 and 17-and-up check, except the four credit terms above 16; no term checks.
eq('13 Credit Card and every pay-first term check', PAY_FIRST_TERMS.map(termRuleOf), PAY_FIRST_TERMS.map(() => TERM_RULE.PAY_FIRST));
eq('the credit terms ship — Net 30 / 60 and 21, 23, 25, 27 among them', CREDIT_TERMS.map(termRuleOf), CREDIT_TERMS.map(() => TERM_RULE.CREDIT));
eq('no term on the order = a payment check', [termRuleOf(''), termRuleOf(null)], ['PAY_FIRST', 'PAY_FIRST']);
eq('a term NetSuite adds later follows the line: 28 checks, 9 ships', [termRuleOf('28'), termRuleOf(9)], ['PAY_FIRST', 'CREDIT']);
ok('the two lists never overlap', !PAY_FIRST_TERMS.some(t => CREDIT_TERMS.includes(t)));

const q = shipFactsSql('960034');
ok('the order read: its terms (id and name) and total', /t\.terms AS termid/.test(q.so) && /BUILTIN\.DF\(t\.terms\)/.test(q.so) && /WHERE t\.id = 960034$/.test(q.so));
ok('the paid read: deposits and invoices MADE FROM the order, mainline', /tl\.createdfrom = 960034/.test(q.paid) && /tl\.mainline = 'T'/.test(q.paid) && /'CustDep', 'CustInvc'/.test(q.paid));
ok('no read without a NetSuite id (no injection either)', shipFactsSql('') === null && shipFactsSql('1 OR 1=1') === null);

// SOUNIQ-4005 as NetSuite had it on 2026-10-17: Pay Before Shipping, $1,859, one deposit of $1,690.
const so4005 = { id: '960034', tranid: 'SOUNIQ-4005', termid: '22', termname: 'Pay Before Shipping', total: '1859' };
const f = shipFactsOf({ soRow: so4005, paidRows: [{ id: '960035', tranid: 'CDUNIQ-2978', ttype: 'CustDep', voided: 'F', total: '1690', unpaid: '0' }] });
eq('the facts', [f.termId, f.termName, f.total, f.deposits, f.paid, f.depositRefs], ['22', 'Pay Before Shipping', 1859, 1690, 1690, ['CDUNIQ-2978']]);
const c = shipClearanceOf(f);
eq('SOUNIQ-4005 waits: $169 still to be paid', [c.clear, c.due, c.why], [false, 169, 'Pay Before Shipping — $169.00 still to be paid before it ships ($1,690.00 of $1,859.00 paid)']);
eq('paid in full → clear', shipClearanceOf({ ...f, paid: 1859 }).clear, true);
eq('a cent short of the cent is paid (rounding)', shipClearanceOf({ ...f, total: 100.004, paid: 100 }).clear, true);
eq('Net 30 ships unpaid — the card on file decides nothing', shipClearanceOf({ ...f, termId: '2', termName: 'Net 30', paid: 0 }).why, 'Net 30 — ships before payment');
eq('Credit Card (13) checks — the card is how they pay', shipClearanceOf({ ...f, termId: '13', termName: 'Credit Card', paid: 0 }).clear, false);
eq('no term on the order checks, and says so', shipClearanceOf({ ...f, termId: '', termName: '', paid: 0 }).why, 'No terms on the order — $1,859.00 still to be paid before it ships ($0.00 of $1,859.00 paid)');
eq('NetSuite not read → not clear, said', [shipClearanceOf(null).clear, shipClearanceOf(null).why], [false, 'NetSuite could not be read — the terms and what has been paid are not known yet']);
// paid = the larger of deposits and what invoices have been paid — never more than the truth
const g = shipFactsOf({ soRow: so4005, paidRows: [
    { ttype: 'CustDep', voided: 'F', total: '500' }, { ttype: 'CustDep', voided: 'T', total: '900' },
    { ttype: 'CustInvc', voided: 'F', total: '1859', unpaid: '859' } ] });
eq('a voided deposit counts nothing; paid = max(deposits 500, invoice paid 1000)', [g.deposits, g.invoicePaid, g.paid], [500, 1000, 1000]);
const h = shipFactsOf({ soRow: so4005, paidRows: [{ ttype: 'CustDep', voided: 'F', total: '1859' }, { ttype: 'CustInvc', voided: 'F', total: '1859', unpaid: '0' }] });
eq('a deposit applied to the invoice is not counted twice', h.paid, 1859);

// the read, with a stand-in proxy
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const seq = (answers) => { const calls = []; const fn = async (r) => { calls.push(r); const a = answers.shift(); if (a instanceof Error) throw a; return a; }; fn.calls = calls; return fn; };
{
    const fx = seq([res(200, { items: [so4005] }), res(200, { items: [{ ttype: 'CustDep', voided: 'F', total: '1690' }] })]);
    const r = await fetchShipClearance({ nsProxyFetch: fx, nsSoId: '960034' });
    eq('fetch: two SuiteQL reads, decided', [r.ok, r.clearance.clear, r.clearance.due, fx.calls.length, fx.calls.every(x => /suiteql/.test(x.targetUrl) && x.method === 'POST')], [true, false, 169, 2, true]);
    const r2 = await fetchShipClearance({ nsProxyFetch: seq([new Error('503')]), nsSoId: '960034' });
    eq('fetch: NetSuite down → not ok, not clear', [r2.ok, r2.clearance.clear], [false, false]);
    const r3 = await fetchShipClearance({ nsProxyFetch: seq([res(200, { items: [] }), res(200, { items: [] })]), nsSoId: '960034' });
    eq('fetch: no such order → not ok', r3.ok, false);
}

// ── card money taken in the app that NetSuite has not posted yet (Stuart 2026-10-18: "go on 1 and the card money") ──
const ans = (payments) => ({ found: true, unpostedTotal: payments.reduce((t, p) => t + p.amount, 0), count: payments.length, payments });
{
    // QS counter sale, Pay Before Shipping, $568, paid by card at the counter — nothing in NetSuite yet
    const so = { id: '970001', tranid: 'SOUNIQ-4100', termid: '22', termname: 'Pay Before Shipping', total: '568' };
    const a = shipFactsOf({ soRow: so, paidRows: [], cardAnswer: ans([{ id: 'P1', amount: 568 }]) });
    eq('card money not in NetSuite counts as paid', [a.nsPaid, a.card, a.paid, shipClearanceOf(a).clear], [0, 568, 568, true]);
    eq('…and the sentence says so', shipClearanceOf(a).why, 'Pay Before Shipping — paid in full ($568.00, $568.00 of it by card in the app, not yet posted in NetSuite)');
    // the moment between the deposit posting and its row being stamped: the same $568 on both sides — counted once
    const b = shipFactsOf({ soRow: so, paidRows: [{ ttype: 'CustDep', voided: 'F', total: '568', tranid: 'CDUNIQ-3000' }], cardAnswer: ans([{ id: 'P1', amount: 568 }]) });
    eq('a card payment matching a NetSuite deposit IS that deposit', [b.nsPaid, b.card, b.paid], [568, 0, 568]);
    // 50% Deposit Balance to Ship, $1,000: $500 deposit posted; the $500 balance by card, posting — counted once, NOT cleared
    const so26 = { ...so, termid: '26', termname: '50% Deposit Balance to Ship', total: '1000' };
    const c2 = shipFactsOf({ soRow: so26, paidRows: [{ ttype: 'CustDep', voided: 'F', total: '500' }], cardAnswer: ans([{ id: 'P2', amount: 500 }]) });
    eq('a part-paid order is never cleared by one payment counted twice', [c2.paid, shipClearanceOf(c2).clear, shipClearanceOf(c2).due], [500, false, 500]);
    const c3 = shipFactsOf({ soRow: so26, paidRows: [{ ttype: 'CustDep', voided: 'F', total: '500' }], cardAnswer: ans([{ id: 'P2', amount: 500 }, { id: 'P3', amount: 500 }]) });
    eq('…a second payment of the balance does count', [c3.card, c3.paid, shipClearanceOf(c3).clear], [500, 1000, true]);
    const c4 = shipFactsOf({ soRow: so26, paidRows: [{ ttype: 'CustDep', voided: 'F', total: '300' }], cardAnswer: ans([{ id: 'P4', amount: 400 }]) });
    eq('part paid with card money: held, the sentence names both', [c4.paid, shipClearanceOf(c4).why], [700, '50% Deposit Balance to Ship — $300.00 still to be paid before it ships ($700.00 of $1,000.00 paid, $400.00 of it by card in the app, not yet posted in NetSuite)']);
    const c5 = shipFactsOf({ soRow: so, paidRows: [{ ttype: 'CustDep', voided: 'F', total: '100' }], cardAnswer: ans([{ id: 'P5', amount: 600 }]) });
    eq('capped at the order total', [c5.paid, c5.card], [568, 468]);
    eq('nothing found / refused = no card money, never a hold reason', [unpostedCardOf({ found: false }).amount, unpostedCardOf(null).amount, unpostedCardOf({ found: false, error: 'permission-denied' }).error], [0, 0, 'permission-denied']);
    eq('an answer without its payment rows falls back to its total', unpostedCardOf({ found: true, unpostedTotal: 25.5, count: 1 }), { amount: 25.5, count: 1, error: '' });

    // the read: asked only when the terms want payment and NetSuite falls short
    const asked = [];
    const card = (answer) => async (x) => { asked.push(x); if (answer instanceof Error) throw answer; return answer; };
    const r1 = await fetchShipClearance({ nsProxyFetch: seq([res(200, { items: [so] }), res(200, { items: [] })]), nsSoId: '970001', unpostedOf: card(ans([{ id: 'P1', amount: 568 }])) });
    eq('fetch: card money clears it', [r1.ok, r1.clearance.clear, r1.facts.card, asked.length, asked[0]], [true, true, 568, 1, { nsSoId: '970001' }]);
    const r2 = await fetchShipClearance({ nsProxyFetch: seq([res(200, { items: [so] }), res(200, { items: [] })]), nsSoId: '970001', unpostedOf: card(new Error('permission-denied')) });
    eq('fetch: a failed card read → decided on NetSuite alone, the error kept', [r2.ok, r2.clearance.clear, r2.facts.card, r2.facts.cardError], [true, false, 0, 'permission-denied']);
    asked.length = 0;
    await fetchShipClearance({ nsProxyFetch: seq([res(200, { items: [{ ...so, termid: '2', termname: 'Net 30' }] }), res(200, { items: [] })]), nsSoId: '970001', unpostedOf: card(ans([])) });
    await fetchShipClearance({ nsProxyFetch: seq([res(200, { items: [so] }), res(200, { items: [{ ttype: 'CustDep', voided: 'F', total: '568' }] })]), nsSoId: '970001', unpostedOf: card(ans([])) });
    eq('fetch: not asked for credit terms, nor when NetSuite already says paid', asked.length, 0);
    const held = shipHoldStampOf({ facts: c4, clearance: shipClearanceOf(c4) }, { at: 1, by: 'x' }).shipHold;
    eq('the hold keeps the card money it counted', [held.paid, held.card], [700, 400]);
}

// the stamps
const hold = shipHoldStampOf({ facts: f, clearance: c }, { at: 7, by: 'Eric' });
eq('the hold', hold, { shipHold: { why: c.why, due: 169, rule: 'PAY_FIRST', termId: '22', termName: 'Pay Before Shipping', total: 1859, paid: 1690, card: 0, at: 7, by: 'Eric' } });
ok('held reads held; cleared and released do not', isShipHeld(hold) && !isShipHeld(shipClearedStampOf({ clearance: { why: 'paid' } })) && !isShipHeld(shipReleaseStampOf({ hold: hold.shipHold, reason: 'x' })));
eq('a release keeps what it lifted and why', shipReleaseStampOf({ hold: hold.shipHold, reason: 'credit approved by phone' }, { at: 9, by: 'Stuart' }).shipRelease, { by: 'Stuart', at: 9, reason: 'credit approved by phone', was: hold.shipHold });
eq('the words', shipHoldText(hold.shipHold), `⏸ ${c.why}`);
eq('who may release', ['admin', 'superadmin', 'executive', 'manager', 'warehouse_manager', 'Paint_Manager', 'operator', 'painter', 'csr'].map(r => mayReleaseShipHold(r)), [true, true, true, true, true, true, false, false, false]);
ok('a super admin flag releases whatever the role', mayReleaseShipHold('operator', true));


// PART OF THE ORDER SHIPS FIRST (12.7 Launch phase 2, Stuart 2026-10-20): paid ≥ shippingNow AND paid − shippingNow > ½ × (total − shippingNow).
const pf = { nsSoId: '1', termId: '22', termName: 'Pay Before Shipping', total: 1000, paid: 650, card: 0 };
eq('throws worth $200 ship first on $650 paid of $1,000: $450 left > half of the $800 balance', [partialShipClearanceOf(pf, { shippingNow: 200 }).clear, partialShipClearanceOf(pf, { shippingNow: 200 }).partial], [true, true]);
eq('throws worth $400: $250 left is not more than half of $600 → waits, and says what is short', [partialShipClearanceOf(pf, { shippingNow: 400 }).clear, partialShipClearanceOf(pf, { shippingNow: 400 }).due], [false, 50.01]);
eq('a part worth more than is paid waits', partialShipClearanceOf(pf, { shippingNow: 700 }).clear, false);
eq('exactly half is not over half ($600 paid, $200 out, $400 left against $800)', partialShipClearanceOf({ ...pf, paid: 600 }, { shippingNow: 200 }).clear, false);
eq('paid in full → clear whatever the part', partialShipClearanceOf({ ...pf, paid: 1000 }, { shippingNow: 900 }).clear, true);
eq('credit terms ship the part as always', partialShipClearanceOf({ ...pf, termId: '2', termName: 'Net 30', paid: 0 }, { shippingNow: 200 }).clear, true);
eq('no part named = the ordinary rule', partialShipClearanceOf(pf, {}).clear, false);
eq('a part worth the whole order = the ordinary rule (not paid in full → waits)', partialShipClearanceOf(pf, { shippingNow: 1000 }).why, 'Pay Before Shipping — $350.00 still to be paid before it ships ($650.00 of $1,000.00 paid)');
ok('the sentence names the part, what is paid, what is left and the balance', /\$200\.00.*\$650\.00 paid, \$450\.00 left against \$800\.00/.test(partialShipClearanceOf(pf, { shippingNow: 200 }).why));
ok('NetSuite unread → not clear, as the whole rule says', partialShipClearanceOf(null, { shippingNow: 200 }).clear === false);

// ── the order's own terms ride on it, read or held (2026-10-20 — the invoice's due date) ──
eq('the terms stamp', termsStampOf({ termId: '22', termName: 'Pay Before Shipping' }, { at: 5 }), { nsTerms: { id: '22', name: 'Pay Before Shipping', at: 5 } });
eq('nothing read → nothing stamped', [termsStampOf(null), termsStampOf({ termId: '', termName: '' })], [{}, {}]);

// ── no NetSuite sales order → held at shipping, and no manager may release it (Stuart 2026-10-20: "hold at shipping") ──
ok('a NetSuite internal id', hasNsSoId('960034') && hasNsSoId(' 961171 '));
ok('an app id / a transaction number / nothing is not', !hasNsSoId('QS-1792251032425') && !hasNsSoId('SO-APP-ST091826-01') && !hasNsSoId('SO61091') && !hasNsSoId('') && !hasNsSoId(null));
{
    const fx = seq([]);
    const r = await fetchShipClearance({ nsProxyFetch: fx, nsSoId: 'QS-1792251032425' });
    eq('no NetSuite order: NetSuite is not asked, held as NO_SO', [r.ok, r.clearance.clear, r.clearance.rule, fx.calls.length, /NetSuite has not accepted this order yet/.test(r.clearance.why)], [true, false, NO_SO_RULE, 0, true]);
    const r2 = await fetchShipClearance({ nsProxyFetch: fx, nsSoId: '' });
    eq('no id at all: the same hold', r2.clearance.rule, NO_SO_RULE);
    const stamp = shipHoldStampOf(r, { at: 7, by: 'Andrea' });
    eq('the hold stamp keeps the rule', [stamp.shipHold.rule, stamp.shipHold.by], [NO_SO_RULE, 'Andrea']);
    ok('…and no manager may release it', !holdMayBeReleased(stamp.shipHold));
    ok('a payment hold may still be released', holdMayBeReleased({ rule: TERM_RULE.PAY_FIRST }) && holdMayBeReleased(null));
    eq('the words', noSoClearanceOf().why, 'NetSuite has not accepted this order yet — it ships once NetSuite does (the NetSuite-to-fix list says why)');
}

console.log(`shipClearance: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
