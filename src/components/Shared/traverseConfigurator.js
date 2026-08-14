// TRAVERSE COMPONENTS CONFIGURATOR — the logic half (Stuart 2026-08-13: required at checkout for
// BOTH the Quick Ship method and the CPQ method). Pure module, node-tested: what the popup OFFERS
// for a given drive, what the length chart INCLUDES, and what an operator's choices BILL. The UI
// component consumes this; neither surface re-derives a number.
//
// THE MODEL (his spec across 08-12/13):
//  · Carrier STYLE is one choice per order — pinch pleat / 80% RF / 100% RF. The chart quantity
//    for the system's length is INCLUDED in the per-foot price; the operator may raise or lower,
//    and RAISING charges per piece ("default to chart, but allowed to raise/lower if raise charge
//    per price"). Same overage rule for extra brackets and splices.
//  · Master carriers (manual) / drive pulleys (motorized), end stops: included picks, gated by
//    drive, quantity editable under the same overage rule where a chart row exists (end stops
//    have no chart row — they are simple included picks).
//  · The eleven Somfy ACCESSORIES bill outright at the item's customer price (billable: true on
//    the rules doc, seeded from his list, editable by the future rules tab).
//  · "Finish track to match the fascia" is an add-on FEE handled by the caller (it changes finish
//    routing, not components) — not a configurator line.

import { usageAt } from './traverseExplode';

const U = (v) => String(v ?? '').trim().toUpperCase();

// The three carrier styles are the rules rows whose label reads as carriers — data, not hardcode:
// a fourth carrier row in a future sheet simply appears.
export const carrierRows = (rules) => (rules?.usage || []).filter(u => /CARRIER/i.test(String(u.label || '')));

/**
 * What the popup offers. Returns groups the UI renders in order:
 *   carrierStyle — radio: one of the carrier rows, includedQty from the chart at this length
 *   picks       — checkboxes: non-billable configurator items for this drive (master carriers,
 *                 pulleys, end stops…), each qty-editable, included in price
 *   accessories — checkboxes: billable items for this drive, priced by the caller per item
 */
export function configuratorOffer({ rules, drive, feet }) {
    const d = U(drive) || 'MANUAL';
    const ft = Math.max(parseInt(feet) || 4, 2);
    const styles = carrierRows(rules).map(r => ({
        itemId: U(r.itemId), label: r.label || r.itemId, fabSku: r.fabSku || '',
        includedQty: usageAt(r, ft),
    }));
    const gated = (rules?.configurator || []).filter(c => {
        const cd = U(c.drive) || 'BOTH';
        return cd === 'BOTH' || cd === d;
    });
    return {
        carrierStyles: styles,
        picks: gated.filter(c => !c.billable).map(c => ({ itemId: U(c.itemId), fabSku: c.fabSku || '' })),
        accessories: gated.filter(c => !!c.billable).map(c => ({ itemId: U(c.itemId), fabSku: c.fabSku || '' })),
    };
}

/**
 * Selections → lines. `sel` =
 *   { carrierStyle: itemId|null, carrierQty: number|null (null = chart),
 *     picks: { itemId: qty }, accessories: { itemId: qty } }
 * `priceOf(itemId)` = the CUSTOMER's per-piece price (caller resolves clientPricing/levels).
 *
 * Returns [{ code, qty, rate, billable, why }] where included lines carry rate 0 and an OVERAGE
 * above the chart quantity becomes its own billed line — the included count never silently absorbs
 * a paid one, and the SO reads exactly like his rule: chart included, extras charged.
 */
export function configuratorLines({ rules, drive, feet, sel, priceOf }) {
    const offer = configuratorOffer({ rules, drive, feet });
    const price = (id) => { const p = typeof priceOf === 'function' ? parseFloat(priceOf(id)) : 0; return Number.isFinite(p) ? p : 0; };
    const lines = [];
    if (sel?.carrierStyle) {
        const st = offer.carrierStyles.find(s => s.itemId === U(sel.carrierStyle));
        if (st) {
            const want = (sel.carrierQty === null || sel.carrierQty === undefined || sel.carrierQty === '')
                ? st.includedQty : Math.max(0, parseInt(sel.carrierQty) || 0);
            const included = Math.min(want, st.includedQty);
            if (included > 0) lines.push({ code: st.itemId, qty: included, rate: 0, billable: false, why: `${st.label} — included per ${feet}ft chart` });
            const over = want - st.includedQty;
            if (over > 0) lines.push({ code: st.itemId, qty: over, rate: price(st.itemId), billable: true, why: `${st.label} — ${over} above the ${st.includedQty} the chart includes` });
        }
    }
    Object.entries(sel?.picks || {}).forEach(([id, q]) => {
        const qty = Math.max(0, parseInt(q) || 0);
        if (!qty || !offer.picks.some(p => p.itemId === U(id))) return;
        lines.push({ code: U(id), qty, rate: 0, billable: false, why: 'included component' });
    });
    Object.entries(sel?.accessories || {}).forEach(([id, q]) => {
        const qty = Math.max(0, parseInt(q) || 0);
        if (!qty || !offer.accessories.some(a => a.itemId === U(id))) return;
        lines.push({ code: U(id), qty, rate: price(id), billable: true, why: 'accessory' });
    });
    return lines;
}

/** The billable total of a selection — what the configurator ADDS to the order. */
export const configuratorTotal = (lines) => (lines || []).reduce((s, l) => s + (l.billable ? l.rate * l.qty : 0), 0);
