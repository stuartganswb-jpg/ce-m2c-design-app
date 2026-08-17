# Pricing for the tag-driven hardware engine — parked, to come back to

Written 2026-08-17. Module shipped and tested (`Shared/hardwarePricing.js`, 17 assertions) but
**imported by nothing** — the new configurator does not price yet. This is the state of the
thinking so none of it has to be reconstructed.

## The principle that matters most

**No pricing rule is re-derived here.** Every rule already exists and is already trusted:
`Shared/priceLevels` (cost/wholesale/retail tiers, painted-vs-plated suffixes, variant-inherits-base
fallback) and `Shared/clientPricing` (per-customer rows, matched by CRM id *or* name). Stuart:
*"there is a massive amount of work in this build out."*

A second pricing implementation that drifts from the first is the exact mistake that cost the week
of 2026-08-15 in the geometry engine — and it costs more here, because a wrong price ships on an
invoice rather than merely looking wrong on a screen. `hardwarePricing.js` composes; it does not
decide.

## The order, most specific wins

| # | Rule | Where it lives |
|---|------|----------------|
| 1 | **Override** — explicit price authored on the pin | the pin (was `step.priceOverride`) |
| 2 | **Price level** — cost / wholesale / retail, when a level ≠ Standard is chosen AND the item carries tier data. Painted vs plated follows the chosen finish. | 4.6 Customer Alias & Pricing box → `manufacturingSpecs.fabricut` |
| 3 | **Client row** — this customer's negotiated price | 4.6 → `clientPricing[]` |
| 4 | **Base price** — the item's own price | `manufacturingSpecs.basePrice` |

Stuart's words for #4: *"if this does not exist it falls back to base price on item."*

## Rules kept deliberately

- **A 0 or blank customer row means "no special price", not free.** Long-standing; kept.
- **An item with no price under any rule returns $0 with source `NONE` and raises a warning.** A
  part that silently prices at nothing is how a quote goes out under cost.
- **Their part number travels with the price.** The same 4.6 box carries the customer's own SKU, so
  `priceChoice` returns it alongside — not a separate lookup somewhere that might forget it. The
  pattern code (`fabCodePainted` / `fabCodePremium` / `fabCodeBase`) resolves in the same call.
- **Every result names the rule that decided it** (`source`), so a quote line can answer "why does
  it cost that" without reading code.

## THE OPEN QUESTION — answer before wiring

**Should a price level beat a customer's negotiated row?**

Currently yes: #2 above #3, which is what CPQTab does today and what *"when there is information
there and the collection is chosen, this is the pricing rules"* reads as. But it is the one place
two *real* prices compete — a customer with a negotiated row who is quoted at Retail gets the tier
and their negotiated price is ignored. Worth confirming explicitly before this goes near an invoice.

## Still unmodelled

- **Quantity.** Centre brackets multiply along the pole by length; the engine has no rule for it yet.
- **Fees / labour rollup.** The NetSuite push model (rollup line absorbing labour + fees, physical
  lines at standard rates) is untouched and will need connecting.
- **Discounts.** Trade discount codes apply after the chain, display-side, STANDARD level only.
