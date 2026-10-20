// ── MAY THIS ORDER SHIP? THE CUSTOMER'S TERMS DECIDE (Stuart 2026-10-17) ─────────────────────────────────────────────────
//
// Stuart: "on packing the system must check with netsuite field terms, if the payment terms exist we must follow the rules
// to allow the shipping, the credit card is just payment method and should not decide if an order is clear to ship or not."
// Then: "Net 30, Net 60 … Payment terms id 17 and above as well as 13 (credit card) these need a payment is made check, the
// other codes all for shipping prior to payment in full" — and, asked about the credit terms numbered above 16 (21 Net
// 60+60, 23 1% 10 Net 30, 25 Net 10, 27 .5% 10 Net 30): they ship before payment; an order with NO term: a payment check;
// a manager may release a held order with a reason.
//
// The rule reads the SALES ORDER's own terms in NetSuite — NetSuite copies the customer's default onto the order and staff
// may override it there — never the CRM's imported copy, never a card on file. "Paid" is NetSuite's: the customer deposits
// made from the order, or what its invoices have been paid, whichever is more (each is a floor under the truth, so the
// larger never says paid when it is not). Card payments taken in the app reach NetSuite as deposits (the Payments session's
// posting). CARD MONEY NOT YET POSTED counts too (Stuart 2026-10-18: "go on 1 and the card money"): a captured card payment is
// money in the account, so an order paid at the counter ships although its deposit has not reached NetSuite. It is read from
// the Payments session's callable (PRODUCTION, non-voided, not yet posted), is never counted twice — a card payment matching
// a NetSuite deposit of the same amount is that deposit, posted a moment before the app heard — and the total is capped at the
// order. A read that fails or finds nothing counts no card money; it is never a reason to hold.
//
// Packing never stops on this: the order is packed as always; only its NetSuite fulfilment (and so its UPS label) waits.
// Pure but for fetchShipClearance, which is handed the proxy.

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (n) => Math.round(num(n) * 100) / 100;
const usd = (n) => `$${money(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

// NetSuite term ids (read 2026-10-17). PAY FIRST = paid in full before it ships; CREDIT = ships, the invoice follows.
export const PAY_FIRST_TERMS = Object.freeze(['13', '17', '18', '19', '20', '22', '24', '26']);   // Credit Card · Prepayment · Proforma Invoice · No Terms · Due upon Receipt · Pay Before Shipping · 30% Deposit 70% To Ship · 50% Deposit Balance to Ship
export const CREDIT_TERMS = Object.freeze(['1', '2', '3', '6', '12', '14', '15', '16', '21', '23', '25', '27']);   // Net 15 / 30 / 60 / 45 / 120 / 90 · 2% 10 Net 30 · Net 30 Pay by CC · Net 60+60 · 1% 10 Net 30 · Net 10 · .5% 10 Net 30
export const TERM_RULE = Object.freeze({ PAY_FIRST: 'PAY_FIRST', CREDIT: 'CREDIT' });

/** The rule for a term id. No term = a payment check. A term added in NetSuite later follows Stuart's line: 17 and above checks, below ships. */
export const termRuleOf = (termId) => {
    const id = str(termId);
    if (!id) return TERM_RULE.PAY_FIRST;
    if (PAY_FIRST_TERMS.includes(id)) return TERM_RULE.PAY_FIRST;
    if (CREDIT_TERMS.includes(id)) return TERM_RULE.CREDIT;
    return Number(id) >= 17 ? TERM_RULE.PAY_FIRST : TERM_RULE.CREDIT;
};

const digits = (v) => (/^\d+$/.test(str(v)) ? str(v) : '');

/** The two SuiteQL reads for one sales order: its terms and total; the deposits and invoices made from it. */
export const shipFactsSql = (nsSoId) => {
    const id = digits(nsSoId);
    if (!id) return null;
    return {
        so: `SELECT t.id AS id, t.tranid AS tranid, t.terms AS termid, BUILTIN.DF(t.terms) AS termname, t.foreigntotal AS total FROM transaction t WHERE t.id = ${id}`,
        paid: `SELECT t.id AS id, t.tranid AS tranid, t.type AS ttype, t.voided AS voided, t.foreigntotal AS total, `
            + `NVL(t.foreignamountunpaid, NVL(t.foreigntotal, 0) - NVL(t.foreignamountpaid, 0)) AS unpaid `
            + `FROM transaction t JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T' `
            + `WHERE tl.createdfrom = ${id} AND t.type IN ('CustDep', 'CustInvc')`,
    };
};

/**
 * The card money NetSuite does not hold yet, from the Payments callable's answer (paymentsUnpostedForOrder). A card payment
 * whose amount matches a NetSuite deposit of the order is taken to BE that deposit (posted, its row not yet stamped) — each
 * deposit explains one payment at most. When the two are only alike, the payment waits for its posting: the order is held a
 * moment longer, never shipped unpaid. → { amount, count, error }
 */
export const unpostedCardOf = (answer, depositTotals = []) => {
    if (!answer || answer.found !== true) return { amount: 0, count: 0, error: str(answer && answer.error) };
    const rows = Array.isArray(answer.payments) ? answer.payments : null;
    if (!rows) return { amount: Math.max(0, money(answer.unpostedTotal)), count: num(answer.count), error: '' };
    const left = (depositTotals || []).map(money);
    const kept = rows.filter(p => {
        const i = left.indexOf(money(p && p.amount));
        if (i < 0) return true;
        left.splice(i, 1);
        return false;
    }).filter(p => money(p && p.amount) > 0);
    return { amount: money(kept.reduce((s, p) => s + money(p.amount), 0)), count: kept.length, error: '' };
};

/** The facts, from the two reads' rows — and, when it was read, the Payments callable's answer for the order. */
export const shipFactsOf = ({ soRow = null, paidRows = [], cardAnswer = null } = {}) => {
    const live = (paidRows || []).filter(r => r && str(r.voided).toUpperCase() !== 'T');
    const dep = live.filter(r => str(r.ttype) === 'CustDep');
    const deposits = money(dep.reduce((s, r) => s + num(r.total), 0));
    const invoicePaid = money(live.filter(r => str(r.ttype) === 'CustInvc').reduce((s, r) => s + Math.max(0, num(r.total) - num(r.unpaid)), 0));
    const total = money(soRow && soRow.total), nsPaid = Math.max(deposits, invoicePaid);
    const c = unpostedCardOf(cardAnswer, dep.map(r => num(r.total)));
    // capped at the order: the excess of a payment counted on both sides for a moment is never "more than paid"
    const paid = c.amount > 0 ? Math.max(nsPaid, Math.min(total, money(nsPaid + c.amount))) : nsPaid;
    return {
        nsSoId: str(soRow && soRow.id), tran: str(soRow && soRow.tranid),
        termId: str(soRow && soRow.termid), termName: str(soRow && soRow.termname),
        total, deposits, invoicePaid, nsPaid, card: money(paid - nsPaid), cardCount: c.count, cardError: c.error, paid,
        depositRefs: dep.map(r => str(r.tranid)).filter(Boolean),
    };
};

/**
 * Clear to ship? → { clear, rule, due, why }. `why` is the sentence every screen prints.
 * facts: shipFactsOf(…) · null facts = NetSuite could not be read (not clear: the fulfilment needs NetSuite anyway).
 */
export const shipClearanceOf = (facts) => {
    if (!facts || !facts.nsSoId) return { clear: false, rule: '', due: 0, why: 'NetSuite could not be read — the terms and what has been paid are not known yet' };
    const rule = termRuleOf(facts.termId);
    const term = facts.termName || (facts.termId ? `term ${facts.termId}` : 'No terms on the order');
    if (rule === TERM_RULE.CREDIT) return { clear: true, rule, due: 0, why: `${term} — ships before payment` };
    const due = money(facts.total - facts.paid);
    const card = money(facts.card) > 0 ? `, ${usd(facts.card)} of it by card in the app, not yet posted in NetSuite` : '';
    if (due <= 0.005) return { clear: true, rule, due: 0, why: `${term} — paid in full (${usd(facts.paid)}${card})` };
    return { clear: false, rule, due, why: `${term} — ${usd(due)} still to be paid before it ships (${usd(facts.paid)} of ${usd(facts.total)} paid${card})` };
};

/**
 * PART OF THE ORDER SHIPS FIRST (12.7 Launch phase 2 — Stuart 2026-10-20: "pay first order, as long as the remaining funds
 * from deposit are over 50% the amount of the balance order it is fine to ship first part"). For a pay-first order sending
 * a shipment worth `shippingNow` with the rest (total − shippingNow) still to come:
 *   clear when  paid ≥ shippingNow   AND   paid − shippingNow > 0.5 × (total − shippingNow)
 * — what is paid covers the part going out, and what is left of it is more than half of what stays behind. Credit terms
 * ship as always; an order paid in full is clear; a shipment worth the whole order is the ordinary rule.
 */
export const partialShipClearanceOf = (facts, { shippingNow = 0 } = {}) => {
    const now = money(shippingNow);
    if (!facts || !facts.nsSoId || !(now > 0)) return shipClearanceOf(facts);
    const whole = shipClearanceOf(facts);
    if (whole.clear) return whole;
    const rest = money(facts.total - now);
    if (rest <= 0.005) return whole;
    const left = money(facts.paid - now);
    const need = money(rest / 2);
    const term = facts.termName || (facts.termId ? `term ${facts.termId}` : 'No terms on the order');
    if (facts.paid + 0.005 >= now && left > need) {
        return { clear: true, rule: whole.rule, due: 0, partial: true, why: `${term} — this shipment (${usd(now)}) is covered: ${usd(facts.paid)} paid, ${usd(left)} left against ${usd(rest)} still to ship (more than half)` };
    }
    const short = facts.paid + 0.005 < now ? money(now - facts.paid) : money(need - left + 0.01);
    return { clear: false, rule: whole.rule, due: short, partial: true, why: `${term} — ${usd(facts.paid)} paid of ${usd(facts.total)}; to ship this part (${usd(now)}) first, what is paid must cover it and leave more than half of the ${usd(rest)} balance (${usd(short)} more needed)` };
};

// ── NO NETSUITE SALES ORDER, NO SHIPMENT (Stuart 2026-10-20: "3. yes hold at shipping") ─────────────────────────────────────
// An order NetSuite has not accepted (refused, or still in the queue) is picked, packed and made as usual — the floor keeps
// moving — and is held HERE, at shipping: there is no NetSuite order to fulfil, read terms from or bill. Only NetSuite
// accepting it lifts this hold ("Check again"); no manager may release it, because no fulfilment can post without the order.
export const NO_SO_RULE = 'NO_SO';
/** Is this a NetSuite internal id (digits) — not an app id (QS-…, SO-APP-…) or a transaction number? */
export const hasNsSoId = (id) => /^\d+$/.test(str(id).trim());
export const noSoClearanceOf = () => ({ clear: false, rule: NO_SO_RULE, due: 0, why: 'NetSuite has not accepted this order yet — it ships once NetSuite does (the NetSuite-to-fix list says why)' });
/** May a manager release this hold? Every hold but the missing NetSuite order. */
export const holdMayBeReleased = (hold) => !hold || str(hold.rule) !== NO_SO_RULE;

/**
 * Read NetSuite and decide. → { ok, facts, clearance }; ok false = NetSuite did not answer (the clearance says so).
 * An order with no NetSuite sales order is not asked about: it is held at shipping (NO_SO_RULE).
 * `unpostedOf({ nsSoId })` → the Payments callable's answer; asked only when the terms want payment and NetSuite's own figure
 * falls short. Whatever it does — throws, refuses, finds nothing — the order is decided on NetSuite's figure alone.
 */
export async function fetchShipClearance({ nsProxyFetch, nsSoId, unpostedOf = null, shippingNow = 0 }) {
    if (!hasNsSoId(nsSoId)) return { ok: true, facts: null, clearance: noSoClearanceOf() };
    const sql = shipFactsSql(nsSoId);
    if (!sql || !nsProxyFetch) return { ok: false, facts: null, clearance: shipClearanceOf(null) };
    const url = 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
    try {
        const r1 = await nsProxyFetch({ targetUrl: `${url}?limit=5`, method: 'POST', payload: { q: sql.so } });
        const b1 = await r1.json().catch(() => ({}));
        const r2 = await nsProxyFetch({ targetUrl: `${url}?limit=200`, method: 'POST', payload: { q: sql.paid } });
        const b2 = await r2.json().catch(() => ({}));
        const soRow = (r1.ok && Array.isArray(b1.items) && b1.items[0]) || null;
        if (!soRow || !r2.ok) return { ok: false, facts: null, clearance: shipClearanceOf(null) };
        const paidRows = b2.items || [];
        let facts = shipFactsOf({ soRow, paidRows });
        if (unpostedOf && termRuleOf(facts.termId) === TERM_RULE.PAY_FIRST && facts.total - facts.paid > 0.005) {
            let cardAnswer;
            try { cardAnswer = await unpostedOf({ nsSoId: facts.nsSoId }); }
            catch (e) { cardAnswer = { found: false, error: str((e && e.message) || e) || 'the card payments could not be read' }; }
            facts = shipFactsOf({ soRow, paidRows, cardAnswer });
        }
        return { ok: true, facts, clearance: money(shippingNow) > 0 ? partialShipClearanceOf(facts, { shippingNow }) : shipClearanceOf(facts) };
    } catch (e) {
        return { ok: false, facts: null, clearance: shipClearanceOf(null) };
    }
}

// ── the stamps ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The hold, on every record the fulfilment would have written back to. */
export const shipHoldStampOf = ({ facts = null, clearance }, { at = Date.now(), by = '' } = {}) => ({
    shipHold: {
        why: str(clearance && clearance.why), due: money(clearance && clearance.due), rule: str(clearance && clearance.rule),
        termId: str(facts && facts.termId), termName: str(facts && facts.termName),
        total: money(facts && facts.total), paid: money(facts && facts.paid), card: money(facts && facts.card), at, by: str(by),
    },
});
/** THE ORDER'S OWN TERMS, kept on it whenever the check reads them (Stuart 2026-10-20: the invoice's due date "based on the
 *  terms code") — the sales order's terms in NetSuite, which staff may set apart from the customer's default. {} when unread. */
export const termsStampOf = (facts, { at = Date.now() } = {}) => (facts && (str(facts.termId) || str(facts.termName))
    ? { nsTerms: { id: str(facts.termId), name: str(facts.termName), at } } : {});
/** Cleared — on a fresh read that says it may ship. */
export const shipClearedStampOf = ({ clearance }, { at = Date.now(), by = '' } = {}) => ({ shipHold: null, shipClearedAt: at, shipClearedBy: str(by), shipClearedWhy: str(clearance && clearance.why) });
/** Released by a manager — the hold it lifted kept beside the reason. */
export const shipReleaseStampOf = ({ hold = null, reason = '' }, { at = Date.now(), by = '' } = {}) => ({ shipHold: null, shipRelease: { by: str(by), at, reason: str(reason), was: hold || null } });

export const isShipHeld = (d) => !!(d && d.shipHold);
/** Who may release: admins, executives and any manager role (a PIN login carries the role). */
export const mayReleaseShipHold = (role, superAdmin = false) => {
    const r = str(role).toLowerCase().replace(/[^a-z_]/g, '');
    return superAdmin === true || ['admin', 'superadmin', 'executive'].includes(r) || r === 'manager' || r.endsWith('_manager');
};
/** The line every screen prints for a held order. */
export const shipHoldText = (hold) => (hold ? `⏸ ${str(hold.why) || 'waiting for payment'}` : '');
