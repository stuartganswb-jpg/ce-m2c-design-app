# Fees, Customer Alias & Checkout — session brief, 2026-08-14

For the session focused on **fees + their customer alias/pricing, the 4.6 checkout setup, the
add-on components configurator, and how all of it links into CPQ and Quick Ship**. Written at the
end of the traverse build-out (Session C), which touched every one of these surfaces. Read
`CROSS_SESSION_CONTRACT.md` first — territory map, the product rule, mirror pairs. **CPQTab.js and
the flow generator are Session C's ground; coordinate changes there through Stuart rather than
editing on top.** `CustomerCollectionsTab.js` (4.6), `Shared/feeRules.js` and the checkout data
model are this session's home turf.

---

## 0. Environment — everything needed to work on this

| | |
|---|---|
| Repo | `github.com/stuartganswb-jpg/ce-m2c-design-app` |
| Working checkout | `/Users/stuartgansmba/Projects/ce-m2c-design-app` — **`main`**, fix-forward |
| App | **www.4cosworkcenter.com** (CRA) — HQ tabs live here |
| Portal | portal.classicalelements.com (Vite, `portal/`) — Session A's ground |
| Firebase project | `ce-m2c-design-collab` · NetSuite account `3728153` |
| Vercel | vercel.com/m2-c-ce-design-app — **frontend auto-deploys on push to main** (~2 min), hard-refresh ⌘⇧R after |

**Deploy — three things, only one automatic.**
1. Frontend (`src/`, `portal/`): auto via Vercel on push. Everything in this brief is frontend.
2. Firebase Functions + firestore.rules: **manual, Google Cloud Shell only** (local `firebase login`
   fails on this Mac): `cd ~/ce-m2c-design-app && git pull origin main && firebase deploy --only
   functions:<names>,firestore:rules --project ce-m2c-design-collab` — read the pull output; a stale
   checkout reports success while shipping old code. Fresh shell: `git clone` it first.
3. NetSuite RESTlet: File Cabinet → SuiteScripts, replace the file by hand.

**⚠ firestore.rules is a WHITELIST.** A new top-level collection is denied until a Cloud Shell
rules deploy — the traverse rules doc lives at `system/traverse_rules_H1-2TRV` for exactly this
reason (`system/**` is already open to authed staff). Prefer `system/<doc>` over new collections.

**Multi-session git safety (live rules, not theory):** never `git checkout <branch>` or `git stash`
in the shared checkout; stage ONLY files you changed (never `git add -A`); always
`rm -f .git/index.lock` then `git pull --rebase --autostash` before push. Commit messages end with
the Co-Authored-By line.

**Verify:** `npx --no-install eslint <path>` (0 errors required) ·
`CI=false npx --no-install react-scripts build` (~1–2 min) ·
**`sh scripts/run-traverse-tests.sh`** — 62 node tests incl. the configurator/fee-adjacent logic,
run against the REAL Fabricut sheet when `Fabricut/Aug12/Fabricut_Traverse.xlsx` is present.
**App Check + PIN gate: no scripts against prod data, no browser harness — pure `Shared/*` modules
+ node tests are the only verification path.** Prod bundle checks: the app is CODE-SPLIT; sweep
every chunk map, plain-ASCII markers (see the traverse brief §0).

**Where the tabs are:** 4. Master Library (`LibraryTab.js`) · 4.5 Mass Update incl. BOTH finish
editors (`LibraryMassUpdateTab.js`) · **4.6 Customer Collections (`CustomerCollectionsTab.js`) —
the center of this session** · 7. Quick Ship (`QuickShipTab.js`) · 8. CPQ (`CPQTab.js`) · ERP push
(`ERPPushPullTab.js`) · 11.1 NetSuite Sync (`NetSuiteSyncTab.js`).

---

## 1. The fee system as it stands

**What a fee IS:** `partClass: 'Fee'` — a charge. No stock, no BOM, no NetSuite item; its ERP id
(CE-FEE-…) is a reference. Canonical test = `Shared/feeRules.js` `isFeeItem`: partClass Fee OR
productType FEE OR the `(^|-)FEE-` code convention — the same test 4.6's Fees filter and the
Master Library's "Fees only" use, so a record reads as a fee everywhere or nowhere.

**How a fee charges** — `manufacturingSpecs.feeRule` `{ mode: FLAT|PERCENT, unit, percent,
minAmount, portalSelectable }`:
- FLAT: per unit × qty (unit = returns, feet, bends, strike-offs…).
- PERCENT: of the **configuration subtotal** (parts + labor, before other fees and before
  shipping) — so two percentage fees never compound. `minAmount` is a floor: "10% or $100 min".
- `portalSelectable`: customer may pick it in the portal; off = staff-only.

**How a fee pushes:** it does NOT. `ERPPushPullTab.resolveJobLines` skips Fee-class parts — the
charge rides the **rollup item's** line (each flow's `nsRollupItemId`; shared default 61502). Kit
(`partClass: 'Kit'`) lines are skipped the same way. The estimate's scale-to-quoted rule makes
lines + rollup sum to `cpqData.totalPrice`.

**Return fees precedent** (memory `fabricut-h1-rollout`): CE-FEE-H1FR / CE-FEE-H1MTR are fee ITEMS
with painted vs plated pricing carried on the **P/EP tier editor** — the model for any fee whose
premium finish costs more.

## 2. Customer alias & pricing — the one attachment everything uses

`clientPricing[]` rows on ANY record (item, fee, kit): `{ customerId (the CRM id, not the name),
clientSku ("their SKU" — the association itself), price (their net), clientSalesPrice,
clientRetailPrice, source, updatedAt/By }`. Read through `Shared/clientPricing.js`
(`customerKeys` / `clientPriceFor` / `findClientPriceRow`) — a row counts when its price parses
> 0; CPQ, Quick Ship, 4.6 and the portal BFF all share these semantics.

- **Traverse kits** add per-customer per-foot fields ON the row: `perFootPrice / perFootSales /
  perFootRetail`. Fields, never Fabricut-hardcoded — a second customer is just another row.
- **P/EP tiers** (`manufacturingSpecs.fabricut`): paintedCost/Wholesale/Retail,
  platedCost/…, direct cost/wholesale/retail = "this item's own price" (mill / simple finish), and
  fabCodePainted/Premium/Base. **Tier inheritance (`ad78065`): an unstamped /P //EP variant prices
  from its BASE doc's painted/plated tier; the base's own price never shadows a tier.** Explicit
  null = "$0 · w/ arm" (included in the arm's price), which is NOT a fallback.
- **Alias records** (`partClass: 'Alias'`, `aliasOf` → main; `Shared/aliasIdentity.js`): a
  customer-facing item # that renders as its own node but IS the main item everywhere that
  matters. 4.6 folds aliases onto their main; an alias must NEVER carry a NetSuite id. Distinct
  from clientSku (a field on the main record) — both exist, know which one you're touching.

## 3. 4.6 — the maintenance surface (modes, left to right)

`COLLECTION | FEES | KITS | CHECKOUT | PLATES | ARMS` — one customer + collection picked at top;
the grid edits `clientPricing` rows + item basePrice; ⚙ P/EP opens the tier editor; Import
Control File = the xlsx diff-then-apply for collection pricing.

- **FEES**: the brand's whole fee catalogue (fees are not collection-scoped). ＋New fee creates
  the fee item + feeRule + the customer's association in ONE action. Grid edits the rule columns
  (How charged / Unit / % / Min $ / Portal).
- **CHECKOUT**: **the list IS the CPQ checkout screen.** Tick `isCheckoutSelectable` on fees OR
  real items; a real item stays a real line on push (own NetSuite line, own routing — the
  2026-08-13 Wand fix: `isAddOn` breakdown lines are appended in `resolveJobLines`, otherwise
  their dollars silently landed in the rollup). Anything a flow already charges (french return,
  cover-plate upcharge) stays UNticked or it double-bills. Until one item is ticked, checkout
  falls back to showing every fee.
- **PLATES / ARMS**: which arms/returns carry a free backplate ("$0 · w/ arm"), cover-plate
  upcharges painted vs premium — priced on the plate ITEMS, deliberately NOT fees.
- **KITS**: traverse kit records — kit sheet importer (preview-then-apply), per-row ⚙ contents +
  **finish matrix** (`kitFinishOptions`, bulk "apply to all /X kits shown"). Flow-aligned kits
  carry ZERO contents by design (they explode from rules); only hand-built kits require contents.

## 4. The components configurator (built this week — shared by both doors)

- **Logic:** `Shared/traverseConfigurator.js` — pure, node-tested. `configuratorOffer` (carrier
  styles from the usage chart; picks + accessories gated by drive), `defaultPicks` (end stops 2
  per track; chart-included splice), `configuratorLines` (THE OVERAGE RULE: chart quantity rides
  at $0, raising bills only the difference, a chart of 0 at this length means the whole qty
  bills — the 9ft-splice-charged / 11ft-splice-included case is a literal test), `configuratorTotal`.
- **UI:** `Shared/TraverseConfiguratorModal.js` — one component, mounted behind a guard by each
  surface. Never fork it per surface.
- **Data:** `system/traverse_rules_H1-2TRV` — usage rows (per-length TOTALS), configurator items
  `{ itemId, fabSku, drive: MANUAL|MOTORIZED|BOTH, billable }`. Billable is a FIELD (seeded from
  Stuart's list of 11 Somfy accessories) — the planned **rules tab** edits it, never code.
  Written by the 4.6 kit sheet importer; re-import = update.
- **Quick Ship mount:** opens when a kit lands in the cart; lines become real cart lines
  (included @ $0, billable @ the customer's price, `aliasErp` = their clientSku via pushLine's
  alias override).
- **CPQ mount:** interposes on Add to Quote Cart for traverse flows (Skip = a recorded answer);
  lines ride `cartItems[].trvComponents`, billables raise the item's finalPrice, everything lands
  in `pricingBreakdown` (included @ $0); `resolveJobLines` pushes them as real consumed lines
  beside the checkout add-ons (`trvcfg:` stepIds), sidemark-tagged, × assemblyQty.

## 5. Open work this session will likely own

1. **The "finish track to match the fascia" upgrade — an ADD-ON FEE** (decided, unbuilt). Charged
   as a fee; overrides the sub-finish routing for that order (track pushes in the MAINLINE finish
   instead of the aligned sub color) and that fact must reach the finishing floor. Sub-finish
   machinery it overrides: finishes carry `isSubFinish` / `subFinishCode` (4.5 editors), items
   carry `usesSubFinish` (Master Library checkbox); the Quick Ship push already routes marked
   items to the sub color and warns when a finish has no alignment. CPQ-side routing is NOT wired
   yet.
2. **The traverse rules TAB in 4.6** — edit the usage chart + configurator list + billable flags
   (today: re-import the sheet to change them).
3. **Fee↔alias tie-back sweeps**: fees created by the seeder/importers may lack customer rows;
   4.6 FEES mode is the fix surface. The kit records carry Fabricut's three tiers + per-foot —
   other kit customers get rows the same way.
4. **Checkout curation**: the CHECKOUT tick-list is live but sparsely curated; the traverse
   accessories are configurator-offered (NOT checkout items) — do not double-list them.
5. Percentage-fee + kit interplay: a PERCENT fee computes off the configuration subtotal — confirm
   kit-priced orders (Quick Ship path has no "configuration subtotal") behave as intended before
   enabling percent fees there.

## 6. Landmarks (files this session lives in)

```
src/components/HQ/CustomerCollectionsTab.js   4.6 — all modes, kit importer, finish matrix
src/components/Shared/feeRules.js             fee identity + charge math (pure)
src/components/Shared/clientPricing.js        customerKeys / clientPriceFor / findClientPriceRow (pure)
src/components/Shared/aliasIdentity.js        alias → main folding (pure)
src/components/Shared/priceLevels.js          Fabricut tiers + inheritance (pure; portal mirror NOT swept — see contract)
src/components/Shared/traverseConfigurator.js the configurator logic (pure, tested)
src/components/Shared/TraverseConfiguratorModal.js  the popup (one component, two mounts)
src/components/Shared/traverseKitImport.js    the kit sheet importer (pure, tested vs the real sheet)
src/components/HQ/QuickShipTab.js             kit fast path, shipping, SO/Quote push (⚠ also Session C ground)
src/components/HQ/ERPPushPullTab.js           fee skip, rollup, add-on + trvComponents append (⚠ shared)
scripts/run-traverse-tests.sh                 the test runner (stages Shared/*.js as .mjs)
```

**The habits that kept this codebase honest all month:** pure module + node tests for anything
that computes money or quantities; data over rules (billable flags, finish matrices, charts —
fields an operator edits, not code); one guarded mount for shared UI; and when a number shows in
two places it comes from ONE place. Follow them and the fee work will slot in clean.
