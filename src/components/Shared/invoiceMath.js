// ── THE INVOICE'S ARITHMETIC ON A SHIPPED-QUANTITY BILL (S1, 2026-09-11) ──────────────────────
//
// S2's Shared/packingList.invoiceLinesOf re-multiplies each PHYSICAL line by what the packing list
// shipped and passes the paper rows (fees, add-ons, discount, net) through untouched — "their
// arithmetic is the money reader's". This is that arithmetic, in one pure place:
//
//   nothing short / over  → the invoice IS the sales order: rows as saved, total = the order's net
//                           total + shipping (the same number the quote and the SO printed).
//   something adjusted    → the item rows carry their shipped amounts; every DISCOUNT row is
//                           pro-rated by shipped-÷-ordered item dollars (a discount was granted on
//                           the goods, so it follows the goods that went); the NET LINE subtotals are
//                           dropped (they were subtotals of the ordered figures); fees and add-ons
//                           bill in full (they were earned on the order, not per piece); total =
//                           items shipped + fees + pro-rated discounts + shipping. The document says
//                           so in one note.
import { invoiceLinesOf, isPhysicalLine } from './packingList.js';

const num = (v) => Number(v) || 0;
const round2 = (n) => Math.round(num(n) * 100) / 100;
const amountOf = (r) => (r.amount != null ? num(r.amount) : num(r.total));

export function invoiceDocOf({ priced = [], packingList = null, shippingAmount = 0, orderedTotal = 0 } = {}) {
    const rows = invoiceLinesOf({ priced, packingList: packingList || { lines: [] } });
    const adjusted = rows.some(r => r && r.invoiceAdjusted);
    const shipping = round2(shippingAmount);
    if (!adjusted) {
        return { rows, total: round2(num(orderedTotal) + shipping), adjusted: false, factor: 1, note: '' };
    }
    const phys = rows.filter(isPhysicalLine);
    const physOrdered = phys.reduce((s, r) => s + num(r.price) * num(r.qtyOrdered ?? r.qty), 0);
    const physShipped = phys.reduce((s, r) => s + amountOf(r), 0);
    const factor = physOrdered > 0 ? physShipped / physOrdered : 0;
    const out = [];
    let total = 0;
    rows.forEach(r => {
        if (!r) return;
        if (r.isNetLine) return;                                   // a subtotal of the ordered figures — gone
        if (r.isDiscount) {
            const a = round2(amountOf(r) * factor);
            out.push({ ...r, amount: a, total: a, invoiceProrated: true });
            total += a;
            return;
        }
        out.push(r);
        total += isPhysicalLine(r) ? amountOf(r) : amountOf(r);   // items at shipped $, paper (fees / add-ons) in full
    });
    return {
        rows: out,
        total: round2(total + shipping),
        adjusted: true,
        factor,
        note: `Billed at shipped quantities: ${phys.filter(r => r.invoiceAdjusted).length} line(s) differ from the order; discounts pro-rated to ${(factor * 100).toFixed(1)}% of the goods; fees in full.`,
    };
}
