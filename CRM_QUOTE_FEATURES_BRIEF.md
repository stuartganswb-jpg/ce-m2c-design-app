# CRM QUOTE FEATURES — kickoff brief (trade discounts · shipping · reopen quotes)

> For a NEW session. Three features requested by the team after CPQ testing, centered on the CRM
> (tab 10 External Co-op) and its handoff to CPQ (tab 8) and the NetSuite push (tab 12). Read
> CLAUDE.md first (ship rules, multi-session git safety). Two other sessions work this repo:
> CPQ/spec-sheets (owns CPQTab evolution, Shared/sizeMatrix, Shared/priceLevels, fabricutImport)
> and Spec Sheets (owns src/components/SpecSheet/* + the BOMTab mount). Commit small, fix-forward
> on main, `git pull --rebase --autostash` before push, stage only your files.

## THE THREE FEATURES (Stuart's spec)

1. **Trade discount codes** — a per-customer discount code (e.g. `D20` = less 20%). Assigned on
   the customer's CRM record; whenever CPQ generates a quote for that customer, apply a
   line-level discount and DISPLAY it exactly like:
   ```
   <configured line>                      $200.00
   Trade Discount - (20%)                 -$40.00
   Net Line Total                          $160.00
   ```
2. **Shipping charge** — a charge enterable on the quote; ideally populates NetSuite's shipping
   field on the pushed estimate (header-level `shippingCost`, NOT a line item — keeps the rollup
   balance math intact).
3. **Reopen / modify a quote** — from the CRM, reopen a finalized quote's configuration back in
   CPQ so small details can change without starting over.

## VERIFIED SYSTEM MAP (checked against the code 2026-07-11)

- **Customers** = `crm_records` collection, docs `CUST-<nsInternalId>`, `type: 'CUSTOMER'`. The
  doc shape ALREADY includes `discountCode: ''` (unused so far). UI = `ExternalCoopTab.js`
  (tab 10). ⚠ **LANDMINE**: the customer sync (`NetSuiteSyncTab.js`, writeBatch `wb.set(...)`
  around the `CUST-` writes) is a FULL OVERWRITE — a re-sync resets `discountCode` to `''`.
  Fix first: make the sync preserve app-owned fields (merge, or read-modify carving out
  `discountCode` + any other app-side fields like notes/salesRep).
- **Discount dictionary ALREADY EXISTS**: `system/crm_discounts` doc, `{ list: [{ code, percent,
  description }] }`, managed in AdminTab → CRM & Sales Configuration → Discount Codes. Reuse it —
  the CRM customer field should be a picker over this list, not free text.
- **CPQ pricing** (`CPQTab.js`): one big pricing `useEffect` builds `pricingBreakdown` lines +
  `pricing.finalPrice`. It already runs a resolution chain (size → species → finish) and a
  PRICE LEVEL override (`Shared/priceLevels.js`: STANDARD / FAB_COST / FAB_WHOLESALE /
  FAB_RETAIL), plus per-customer `clientPricing` when `jobData.customerId` is set. Customers
  reach CPQ via `combinedCustomers` / `jobData.customerId`. Cart items snapshot
  `{ dynamicConfigParams, stepQuantities, dimensionInputs, pricing, pricingBreakdown,
  priceLevel, qty, masterQuoteId }`.
- **Finalize** (`handleFinalizeQuote`): writes `jobs/<QUOTE-id>` with `setDoc(..., {merge:true})`
  — re-finalizing the SAME job id updates it in place (this is the natural "revision" mechanism
  for feature 3). Payload carries `cpqData.cartItems` + merged configuration/quantities/
  dimensions + `priceLevel` + `shippingMethod/shippingAddressId/customShippingAddress` (method
  and address exist — an AMOUNT does not yet).
- **Push** (`ERPPushPullTab.js`): resolveJobLines → physical lines at standard rates; the ROLLUP
  line absorbs `quoted total − physical lines total` so the estimate lands at the quote total.
  Two implications: (a) a discounted quote total flows to NetSuite correctly with ZERO push
  changes (rollup absorbs the discount) — but check the rollup can't go negative on heavily
  discounted quotes; (b) shipping must be added OUTSIDE that balance (NetSuite estimate header
  `shippingCost` field) or it would be double-counted.
- **Reopen machinery that already exists**: CPQ cart Edit (`handleEditCartItem`) restores a cart
  item's full configuration into the configurator; `localStorage.hq_global_cart` persists the
  cart (HQ.js); `localStorage.hq_active_quote_session` + `activeMasterQuoteId` lock the job
  context (Clear All clears both). Feature 3 ≈ a "Reopen in CPQ" action on a job: load
  `jobs/<id>.cpqData.cartItems` into the global cart + set the session key + switch to tab 8 —
  then existing Edit/re-finalize does the rest. Guard: jobs already pushed
  (`netsuiteEstimateId` / `dispatchStatus.nsSalesOrder`) need a decision (block, or allow with a
  "re-push creates a NEW estimate" warning).

## DECISIONS TO ASK STUART BEFORE CODING

1. Discount granularity: per CART ITEM (the configured assembly line — his example reads this
   way) or per component breakdown line?
2. Stacking: does the trade discount apply ON TOP of client-specific pricing? On top of fees?
3. Price levels: discount at STANDARD only, or also at Fabricut levels (FAB levels are already
   negotiated prices — discounting them again seems wrong, but confirm)?
4. NetSuite representation: keep "rollup absorbs the discount" (zero push changes), or an explicit
   discount item line on the estimate for visibility?
5. Shipping: manual dollar amount only (v1), or method-based calc? Which NetSuite fields —
   `shippingCost` alone, or also `shipMethod`?
6. Reopen semantics for already-pushed quotes: block, or revise-and-re-push?

## GUARDRAILS

- Don't touch: `src/components/SpecSheet/*`, the BOMTab 📐 mount, `Shared/sizeMatrix.js`,
  `Shared/fabricutImport.js`, `Shared/priceLevels.js` internals (READ them; extend around them).
  CPQTab edits: surgical and small — the pricing effect is the most-evolved code in the app;
  respect the existing chain order (item → author → client → PRICE LEVEL → your discount last,
  display-side).
- The quote is the source of truth for totals; the push balances to it via the rollup. Never
  change push line rates.
- App Check: no local scripts against prod Firestore — bulk anything = in-app admin buttons.
- Lint 0 errors per file; `CI=false npx --no-install react-scripts build` before shipping
  multi-file changes; Vercel deploys on push to main; hard-refresh after deploy.
- Memory: this project dir's MEMORY.md is shared across sessions — read `fabricut-h1-rollout`,
  `spec-sheet-cpq-contract`, `cpq-netsuite-push-model` before starting; record your own
  decisions when done.

## SUGGESTED ORDER

1. Fix the customer-sync overwrite (preserve `discountCode` and other app-owned fields).
2. CRM: discount-code picker on the customer record (ExternalCoopTab) reading
   `system/crm_discounts`.
3. CPQ: discount display lines + net totals (after the price-level override; per Stuart's
   granularity answer) + stamp `discountCode/percent` on cart items + finalize payload.
4. Shipping amount field (quote panel) → payload → push `shippingCost` header.
5. "Reopen in CPQ" on the job (CRM and/or ERP hub) via the existing cart/session machinery.
6. Verify: quote with D20 shows the three-line display; push lands estimate at net total +
   shipping in the header; reopen → tweak one option → re-finalize updates the same job.
