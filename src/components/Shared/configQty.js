// "×2" MUST BE SAID OUT LOUD (Stuart 2026-08-03: "when we order a qty of more than one, this needs
// to be explicitly shown, not just double the qty but rather show the per configuration exactly as
// is, then say x 2").
//
// THE CONFUSION THIS FIXES. A CPQ cart line carries a configuration and a MULTIPLIER (`item.qty` —
// how many identical windows). The two screens the floor uses disagreed about which number they
// were showing:
//   the quote / shop card   multiplied      "Pole … 14"
//   the configured-item viewer  did not     "HBR1-1INPOLE ×7"
// Both were right and neither said so, so 7 and 14 looked like a discrepancy in the order.
//
// THE RULE, EVERYWHERE FROM NOW ON: show the PER-CONFIGURATION figure — the thing the operator
// actually builds once — and state the multiplier beside it. Never a bare doubled number.
//
// Dimensions are deliberately NOT multiplied: two 80" poles are still 80" each. Only counts scale.

const int = (v, dflt = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : dflt; };

// The multiplier on a cart line. Absent / 0 / junk all mean "one of these".
export const configQtyOf = (item) => Math.max(1, int(item && (item.qty ?? item.quantity), 1));

// Per-unit count for a breakdown line. Lines saved on the CART are per unit; lines on the MERGED
// quote breakdown were already multiplied, and carry `qtyEach` so the per-unit figure survives.
export function perUnitQty(line, mult) {
    const m = Math.max(1, int(mult, 1));
    if (line && line.qtyEach != null) return int(line.qtyEach);
    const q = int(line && (line.qty ?? line.quantity));
    // A merged line divides cleanly by the multiplier; anything else is left alone rather than
    // guessed at — a wrong per-unit count on a shop card is worse than no per-unit count.
    return (m > 1 && q % m === 0) ? q / m : q;
}

// The one phrasing, used by every screen. `each` is what to build; `total` is what leaves the dock.
//   mult 1 → { text: '×7' }
//   mult 2 → { text: '×7 each · 14 total' }
export function qtyText(each, mult) {
    const e = int(each);
    const m = Math.max(1, int(mult, 1));
    return m > 1
        ? { each: e, total: e * m, mult: m, text: `×${e} each · ${e * m} total`, short: `${m} × ${e}` }
        : { each: e, total: e, mult: 1, text: `×${e}`, short: `${e}` };
}

// The banner sentence for a card or modal header. Null when there is nothing to warn about, so a
// caller can render it unconditionally.
export function multiplierNote(mult, noun = 'unit') {
    const m = Math.max(1, int(mult, 1));
    if (m <= 1) return null;
    return {
        mult: m,
        headline: `BUILD × ${m}`,
        detail: `${m} identical ${noun}s. Every figure shown is for ONE — multiply as you pull and count.`,
    };
}

// ---- EXACT ROD LENGTH ON THE PAPERWORK (Stuart 2026-08-03) ------------------------------------
// "we need to make sure we show exact rod length in these, not just 8ft but the 94.5\" details."
//
// A pole line is QUANTIFIED IN FEET — the rod is bought by the foot, so qty is
// Math.ceil(cutLength / 12) and an 8 on the quote means "eight feet of stock". The number that
// matters to anyone reading the document is the CUT: 94.5". Both are true and only one was shown.
//
// The cut is per unit and never multiplies: three of a configuration is three rods cut to 94.5",
// not one at 283.5". Trailing zeros go, because 94.50" reads like a tolerance.
export function cutText(cutLength) {
    const n = Number(cutLength);
    if (!Number.isFinite(n) || n <= 0) return '';
    return `Cut ${String(n.toFixed(2)).replace(/\.?0+$/, '')}"`;
}
