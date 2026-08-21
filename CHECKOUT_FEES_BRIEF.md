# Checkout & fees on the new engine — session brief

Paste this into a fresh session. It is written to be read cold.

## Where things stand (2026-08-21)

The tag-driven engine (`src/components/Shared/HardwareConfigurator.js` + `hardwareModel.js`)
is now the DEFAULT for the Classical brand and available to every user on every brand
(`CPQTab.js`, `newEngine` / `engineOn`). A flow that is a 2D tear sheet, a pillow flow, or has no
linked assembly still opens the OLD configurator — that routing is `flowNeedsOldEngine` in
CPQTab.js, and it must stay true.

What already works end to end through the new engine: the walk, per-part finishes, traverse
components, the NetSuite push, the frozen render for the floors, the Vision drawing handoff, and
the H2 combined (multi-diameter) flow.

## What this session is for

**Checkout add-ons and fees, rebuilt for an engine that has no flow steps.**

The old path collected fees and add-ons in the checkout modal (`showCheckoutModal` in CPQTab.js)
from a catalogue curated in 4.6 → Checkout Items (`buildCheckoutCatalog`), and appended them to
`cpqData.breakdown` as rows flagged `isAddOn` / `isFee`. That modal still opens from the new
engine — the configurator's strip has a `Checkout (N)` button wired to `onCheckout` — so add-ons
are NOT broken. What is unresolved is whether the fee model still fits.

### Read these first

- `src/components/HQ/CPQTab.js` — `buildCheckoutCatalog`, `buildAddOnLines`, `addOnsTotal`, the
  `showCheckoutModal` block, and the finalize payload (`mergedBreakdown`, `addOnLines`).
- `src/components/Shared/hardwareHandoff.js` — `handoffItem`. This is the cart item the new
  engine writes. Fees the ENGINE produces already ride here as normal lines flagged `isFee`.
- `src/components/HQ/ERPPushPullTab.js` — `resolveJobLines`. Note the `cart.engine === 'TAGS'`
  branch: a fee line is skipped there deliberately, because a fee prices the quote and rides the
  ROLLUP item rather than becoming its own NetSuite component.
- `src/components/Shared/hardwarePricing.js` — the price chain, including the new per-kind
  fallback (`PRICE_SOURCES.FALLBACK`).

### The questions to answer with Stuart

1. **Where does a fee belong now?** The engine already models fee ITEMS as parts (a return is a
   fee item pinned on the assembly — `CE-FEE-H1FR` and friends). Checkout fees are a second
   mechanism. Decide which fees are engine fees (tagged on the assembly, chosen in the walk) and
   which stay checkout fees (rush, freight, trade discount, per-order charges).
2. **Percentage fees** are worked out from `grandTotal` at the moment add-ons are appended, so
   two percentage fees never compound. Confirm that still holds when the configuration total comes
   from `handoffItem` rather than the old engine's `pricing.finalPrice`.
3. **The rollup.** Physical lines push at standard rates and the rollup absorbs the balance
   (`nsRollupItemId` per flow). Check a discounted TAGS quote end to end: quoted total in, estimate
   total out, rollup never negative.
4. **Print / PDF / email.** These were listed as outstanding in the original checkout brief and are
   still outstanding. They read `pricingBreakdown`, which the new engine writes — verify rather
   than assume.

### Non-negotiables

- **Never push a fee as a NetSuite item line.** Fees ride the rollup. `ERPPushPullTab` already
  skips `partClass === 'Fee'` and `productType === 'FEE'`; keep it that way.
- **A traverse component must be pushed once.** It is on the breakdown (flagged `trvComponent`)
  AND on `item.trvComponents`, and the push reads the latter. Do not remove the flag.
- **Hidden lines are BOM-only.** `customerLines()` filters them; production consumers take
  everything. One list, two audiences.
- **The old engine still runs** for lighting and pillow flows. Do not delete its checkout path.

### Verification

- `node scripts/hardwarePricing.test.mjs`, `node scripts/hardwareHandoff.test.mjs` — both must stay
  green; add to them rather than testing by clicking.
- `npx --no-install eslint <file>` — 0 errors before committing.
- `CI=false npx --no-install react-scripts build` — the real compile check.
- A push cannot be tested locally (`resolveJobLines` lives inside the component and App Check blocks
  scripted Firestore access). The proof is one real quote through the RTG NetSuite Transmit Log.

### House rules that will save you a day

- Fix forward on `main`; never switch branches in this checkout (other sessions share it).
  `git pull --rebase --autostash origin main` before every push. Stage only your own files.
- A `const` is not hoisted: a hook whose dependency array names something declared further down
  throws "Cannot access X before initialization" and takes the whole engine out. It has happened
  once. Scan declaration order after moving anything.
- After a deploy, hard-refresh, and if a change "does nothing" grep the live bundle for a marker
  BEFORE debugging the feature. The app is code-split: tab code never appears in `main.*.js`.
