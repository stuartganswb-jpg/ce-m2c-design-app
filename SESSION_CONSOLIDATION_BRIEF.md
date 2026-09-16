# CE / M2C — consolidated session handoff (2026-08-03)

Merged from two parallel sessions. Paste this whole file into the new session.

- **Session A** — worktree `claude/musing-haslett-783222`: CPQ plate rules, 4.6 modes, portal, CRM,
  RTG board, WMS labels/short-pick, finish routing.
- **Session B** — `main`: derived order status, the "Where is it?" lookup, pick grouping, the ×N
  multiplier, the finishing-floor gates, the assembly-build timing.

**Attribution is by workstream, not by commit.** The `main` log interleaves several sessions. The
"Completed" list below describes **prod state**, not authorship — if you did a piece of it in a
third session, it is still accurately described here.

---

## 1. Where things live

| | |
|---|---|
| Repo | `github.com/stuartganswb-jpg/ce-m2c-design-app` |
| App | www.4cosworkcenter.com (CRA) |
| Portal | portal.classicalelements.com (Vite, `portal/`) |
| Firebase project | `ce-m2c-design-collab` · NetSuite account `3728153` |
| Vercel dashboard | vercel.com/m2-c-ce-design-app |

### Git state at the moment of writing

```
/Users/stuartgansmba/Projects/ce-m2c-design-app                        3331ae5  [main]        ← session B
  └─ .claude/worktrees/musing-haslett-783222                           ec31751  [claude/…]    ← session A
```

- `origin/main` HEAD = **`ec31751`** ("🏷 a fee is a Fee", 19:27).
- Session A's branch is **level with `origin/main`** — nothing stranded in the worktree.
- The shared checkout's local `main` is **4 behind**. Fast-forward, nothing unpushed.

**Run this first:**
```bash
git -C /Users/stuartgansmba/Projects/ce-m2c-design-app pull --rebase --autostash origin main
```

Session A pushes with `git push origin HEAD:main` (branch tracks work, main is prod).

Uncommitted in the shared tree: **untracked data/reference files only**, no source —
`Assembly_Design_Planner.xlsx`, `BOM_fix_missing_P_assemblies.csv`, the `*_BRIEF.md` set,
`Fabricut/`, `Fabricut GLB/`, `Finishes_Combo/`, `H2/`, `July28/`, `July29/`, `July 30/`,
`Spec Sheets/`, `_deliverables/H1_Spec_Master_Manifests.xlsx`.

---

## 2. Deploy pipeline — THREE things, only one is automatic

1. **Frontend → automatic.** Every push to `main` builds **two** Vercel projects:
   `ce-m2c-design-app` (CRA, ~2 min) and `ce-client-portal` (Vite, ~10 s). Hard-refresh ⌘⇧R after.
2. **Firebase Functions → manual, Cloud Shell only.** Local `firebase login` fails on this Mac.
   Cloud Shell drops you in `~`, **not** in the repo — always lead with the `cd`:
   ```bash
   cd ~/ce-m2c-design-app && git pull origin main && firebase deploy --only functions:<name> --project ce-m2c-design-collab
   ```
   Clone first if the folder isn't there:
   ```bash
   git clone https://github.com/stuartganswb-jpg/ce-m2c-design-app.git ~/ce-m2c-design-app
   ```
3. **NetSuite RESTlet → manual, inside NetSuite.** `netsuite/ce_convert_build_restlet.js` is shipped
   by no deploy. File Cabinet → SuiteScripts → replace the file. Last changed in `6cc2d1f`.

### ✅ DONE 2026-08-03 — the open functions-deploy question, resolved and deployed

Session A's brief asked whether commit `2da7c70` still owed a functions deploy. It did — that commit
is session B's. It moved `onStockBuildDone` off the bake onto `packStatus === 'Packed'` using the
real `putawayBin`.

**Deployed 2026-08-03 from Cloud Shell.** `onStockBuildDone(us-central1)` — "Successful update
operation"; `firestore.rules` compiled and released in the same run (that covers the outstanding
`convert_demand` rule from `0a5fa65`). The pull reported `2da7c70..ec31751`, i.e. Cloud Shell's
checkout already carried `2da7c70`, so the deployed build is the bin-scan version — not a stale one.

⚠ **Deployed ≠ exercised.** Nothing has run through it yet. The first real pack is the test: pack a
stock order, then confirm the build posted to the scanned `putawayBin` and not to a guessed one.

### The command that worked — keep it for next time

Cloud Shell drops you in `~`, so the `cd` is not optional. Functions and rules deploy separately;
one `--only` list does both in a single trip:

```bash
cd ~/ce-m2c-design-app && git pull origin main && firebase deploy --only functions:onStockBuildDone,firestore:rules --project ce-m2c-design-collab
```

Fresh Cloud Shell (the home directory is wiped after ~120 days idle) — clone first:

```bash
git clone https://github.com/stuartganswb-jpg/ce-m2c-design-app.git ~/ce-m2c-design-app
```

**Read the `git pull` output before trusting the deploy.** It must show the commit you care about
arriving. Deploying a stale checkout reports "Successful update operation" while shipping old code.

Functions deployed to date: `portalMyOrders`, `portalDeleteQuote`, `portalBranding`,
`onStockBuildDone`.

---

## 3. Hard constraints

- **Firestore enforces App Check** — no local/Node script can read or write prod data. Bulk data
  changes must be an in-app admin button.
- **Multiple sessions work this repo at once.** Never switch branches in a shared checkout; stage
  only your own files (never `git add -A`); always `git pull --rebase --autostash origin main`
  before pushing. Use a worktree for bigger multi-commit work.
- **NetSuite reads for diagnosis:** the old unauthenticated SuiteQL curl is dead (App Check). Use
  the RTG NetSuite Transmit Log, 11.1 Sync Queue, or ask for a screenshot.
- **Verification here is node tests, not the browser.** The PIN gate + App Check mean the running
  app can't be driven from a test harness — which is why the new logic ships as pure modules with
  tests beside them.

---

## 4. Verifying what prod actually serves — keep this section

A "Ready" deploy with a fresh `version.json` can still serve old code.

```bash
curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js'
```

- **The app is code-split.** Lazy tab code (Library, CPQ, CRM, Stock View, 4.6…) never appears in
  `main.*.js`. Extract every chunk map from main —
  `LC_ALL=C grep -oE '\{[0-9]+:"[a-f0-9]{8}"(,[0-9]+:"[a-f0-9]{8}")*\}'` — **sweep every match, not
  `head -1`** (~33 entries) — then grep each `static/js/<id>.<hash>.chunk.js`.
- **Pick a marker that survives minification.** Local variables and imported function names are
  renamed. Grep **string/JSX literals, property names, Firestore field names**. This cost three
  false negatives in one session (`cand2`, `includesPlate`, and a case-mismatched `no stock`). Grep
  is case-sensitive — check your case. Use plain ASCII; `·` `—` `’` may be unicode-escaped.
- **Confirm the main hash actually CHANGED** from its pre-push value.
- If a shipped change genuinely does nothing: Vercel → Deployments → ⋯ →
  **Redeploy with "Use existing Build Cache" UNCHECKED**.

---

## 5. Completed and live

### Order status & floor visibility *(session B)*
- **One derived status** — `Shared/orderStatus.js`. 11 ranked stages;
  `orderStatusOf(wo, {recipeLen})` → `{streams, fulfilment, isSplit, slowest, done}`. **Derived, not
  stored**: no migration, works on every order in flight, cannot drift. Supersedes as a *concept*
  (all still written as today) `currentPhase`, `pickStatus`, `packStatus`, `customFabStatus`,
  `sentToPickPack`. **Split orders are never collapsed** — poles done + small parts on coat 1 reports
  both, always. `Shared/OrderStatusChips.js` renders it identically everywhere.
- **"Where is it?" lookup** — `Shared/WhereIsIt.js`. Type a WO / SO / item / customer → stage, who
  touched it last, and **what moves it next**. Props-driven: reuses the host's existing
  subscription, so no second listener on a floor tablet and never staler than the page.
  In the finishing-floor nav and the WMS header.
- **Chips everywhere else** — pick queue, packing tiles, Recently Packed, PICKED–AWAITING STAGING,
  RTG live log, shop floor. Shop floor gained a `fin_workorders` subscription keyed on
  `finSiblingId` → a **"Rest of this order"** panel showing the small parts' real stage.

### Finishing floor
- **Outsourced finishes leave the floor** *(A)* — `Shared/finishRouting.js`: EP1–EP6, MEP\*, P25 are
  vendor-plated. Setup Queue excludes them, shows them in a brass strip. Conservative: reroutes only
  on positive outsourced evidence AND no in-house evidence; `/P` phosphate stays in-house. Works on
  already-dispatched orders.
- **Urgent WOs pinned** *(A)* — run-level ⚡ Urgent tick + Need by date on the Sales Snapshot, rides
  inside `finPayload` through the RTG hop. Red strip above the batches; ✓ Acknowledge is a *seen*
  gate only.
- **📅 Run-day pills** *(A)* — MON–FRI per finish strip, shared `system/finish_run_days`, live.
- **One open step per operator** *(B)* — oven exempt, so time data is real.
- **Recipe-aware steps** *(B)* — a step the recipe never calls for greys out N/A. Recipe Edit/Delete
  restored (the role gate wasn't normalizing super admin).
- **Notes pill** *(B)* — author stamp + per-reader read log on the WO card.

### WMS / pick-pack
- **Pick list merges and sorts** *(B)* — `Shared/pickOrder.js`. A custom order's BOM is written *per
  configuration*, so the same code repeats: BRIMAR's 28 lines are ~6 real items. Same-code lines
  merge (summed qty) and sort by bin. Bin keys zero-pad digit runs (plain sort put `N18` before
  `N6`); `UNASSIGNED` last; blank/`PENDING` never merge; a `×5 lines` badge so a shorter list never
  reads as a lost one. Safe because the pick loop records nothing per line but skips and shorts,
  both keyed by item code.
- **Assembly build posts at the BIN SCAN, not the bake** *(B)* — `onStockBuildDone` fires on
  `packStatus === 'Packed'` with the real `putawayBin`. **⚠ NOT DEPLOYED — see §2.**
  Picked-then-packed orders also now leave the pick queue.
- **Label printing unified** *(A)* — `Shared/labelPrint`. **Shop Floor had never actually printed** —
  both its label functions only `console.log`'d ZPL and alerted "Spooled". Two new labels: PUT AWAY ·
  SHOP, and CUSTOM · SHOP COMPLETE / TO PLATING (barcode = `orderKey`, what VERIFY & STAGE scans).
  Default is the print queue; `localStorage.labelPrintMode = 'zebra'` opts a station back to raw ZPL.
- **Short pick → mill cores → OB PLATING** *(A)* — demand summed **per code across the order**.
  `⚗ Mill → OB Plating` covers what the mill can and flags the rest (`coverPlan()`). Short
  quantities are confirmable only after routing.
- **Urgent cores on the Stocked Sales Snapshot** *(A)* — `core_urgent_demand` → red banner, ⚠ URGENT
  rows on Finished and Raw Cores, **NOT IN THIS VIEW** when the core has no snapshot row. ✓ Ordered clears.

### Ordering / dispatch *(A)*
- **RTG keeps dispatched orders visible.** Read widened to `status in [Approved, Dispatched]`;
  dispatch stamps `dispatchedAt`/`dispatchedBy`. Two zones per column: pending cards, then
  "Dispatched this week" rows with FINISHING ✓ / SHOP ✓ chips. >7 days behind a toggle, with a
  **📦 Archive** sweep stamping `rtgArchived` — an RTG-only flag, never the shared status.
  **↻ Re-dispatch** overwrites rather than duplicating (floor docs use fixed ids).
- **The ITEM's Part Handling routes it, not the flow step** — `Shared/lineClassification.js`.
  Display-only quote rows (size/projection echoes) no longer reach the floors.

### CPQ
- **Say the multiplier out loud** *(B)* — `Shared/configQty.js`. A cart line carries a configuration
  **and** a multiplier (`item.qty`); the cart breakdown is per-unit while the quote and shop card
  multiply it, so BRIMAR Formal Living #2 read `×7` in the viewer and `14` on paperwork. Now: merged
  quote lines carry `qtyEach` + `configQty`; the configured-item viewer shows a brass **BUILD × 2**
  banner, `· × 2` in the line dropdown and `×7 ea / 14 total` per row; the shop cut list reads
  `Qty 2 × 7 = 14`. Dimensions never multiply. A merged line without `qtyEach` divides only when it
  divides cleanly.
  **Rollout:** `qtyEach`/`configQty` are stamped at checkout/dispatch, so pre-existing orders keep
  showing today's total; the viewer banner works on every order because it reads `item.qty`.
- **Backplate pool fix** *(A)* — two copies of the same rule disagreed (picker filtered candidates by
  location, the clearing effect didn't), so the right ceiling arm's plate blanked on select.
- **Length-step finish grid** *(A)* — a multi-material Length step no longer offers a second, wrong
  finish; display now agrees with the pricing rule, which reads the finish from the Material step.
  `VISUAL_DIMENSIONS` exempt.
- **Plate association** *(A)* — `Shared/plateRules.js`: `plateRole` INCLUDED/UPGRADE,
  `plateUpgradeOf` (blank = derived from the code), `plateUpcharge` + `plateUpchargePremium`
  (/EP, /P25 tier; blank = painted figure). Base doc's role answers for its finish variants.
  `includesPlate: false` is an override — everything is included by default. Applies at **every**
  price level; inert until a role is declared.
- **Curated checkout add-ons** *(A/B)* — `manufacturingSpecs.checkoutSelectable`. Until something is
  ticked, checkout falls back to today's every-fee list. A ticked **real item** carries `isFee=false`
  so it pushes as its own NetSuite line. Fee rules in `Shared/feeRules.js` (FLAT/PERCENT, 10 units,
  percentage base = configuration subtotal).
- **Record class is declared, not inherited** *(A)* — `handleCreateNewPart` had only
  Inventory/Assembly outcomes, so fees made under the Fees filter came out Assembly with `CE-ASM-`
  ids. Fees filter now creates class `Fee` + `CE-FEE-`; every record has an explicit **Record Class**
  dropdown; save writes `partClass` only when touched.

### 4.6 Customer Collections *(A, with B's tier work)*
Five modes: Collection · 💲 Fees & Add-ons · 🛒 Checkout Items · 🔗 Plate Pricing · 🦾 Arms & Returns.
- Bulk bar in **every** mode: Base $ / Their SKU / Their Net $ / Their Sales $ / Their Retail $ —
  fill any subset, Apply to all shown, blanks left alone, per-customer columns disabled until a
  customer is picked.
- Plate Pricing and Arms & Returns **honour the collection picker** (they were brand-wide, showing
  H2 rows under a FABRICUT H1 selection).
- Bulk presses stage only rows that would actually change; "included" is the default carried by field
  *absence*, so ticking an already-included row writes nothing.
- **PREMIUM means "outsourced finish", not "starts with EP"** — so `/P25` is covered. A targeted
  repair shipped for already-mis-stamped items.

### Portal *(A)*
- **Their part # on order lines** — from `clientPricing`, matched by CRM id *or* customer name, one
  batched lookup; column appears only when numbers exist; match set built from the signed-in claim.
- **Quotes readable after sending** — a `PORTAL_REQUEST` has no priced breakdown, so lines are
  rebuilt from the flow doc in the configurator's own words; badged "Sent — awaiting pricing"; no
  invented money.
- **Delete = withdraw** — `portalDeleteQuote` flags `portalDeleted` / `status: DELETED_BY_CLIENT`;
  CRM shows it red/struck-through with who, when, why. Eligibility enforced server-side.
- **Client logo** — `crm_records.portalLogoUrl`, uploaded in CRM → Portal Access, served by
  `portalBranding`.
- **Presentation combo filter** — images carry `fab.pairedCode` (arm) + `fab.plateCode` (plate). The
  matcher gates on the *selections* (step's main option = arm, `__sub` = plate) rather than the
  quote's item numbers, which at Fabricut levels are bare pattern codes. Falls back to ungated
  rather than blanking the page.
- **Quick Ship empty states** name the actual cause (nothing in collection / none in collection /
  mill finish only / no rod-diameter key / none at this diameter / none in this finish).
- **Render fixes** *(B)* — left/right reversal (broadside yaw), then the centre bracket rendering in
  front of the rod (world vs root-local frame). Portal only; CPQ never showed it.

### CRM *(A)*
- **Quote numbers** — `Shared/quoteDisplay.js`: `netsuiteEstimateId` → `quoteNo` (initials+MMDDYY+seq)
  → internal id. Rejects the `CREATED_CHECK_NETSUITE` sentinel. Applied to active card, archived
  card, global pipeline table and the mailto subject; search matches the displayed number.
- **External Co-op layout** — the page ran off the right edge because every flex item inherits
  `min-width: auto`. `minWidth: 0` at each level, flex-basis so profile/pipeline wraps, 92px basis
  on the card's eight buttons.

### Site-wide *(B)*
- **Smallest font raised to a 10px floor** and pricing text darkened/bolded. The first attempt keyed
  the weight rule on the *clamped* size so it never fired for a 9px source — re-keyed on authored sizes.

---

## 6. OPEN — needs action

### ✅ CLEARED 2026-08-03
- ~~`onStockBuildDone` Cloud Shell deploy (`2da7c70`)~~ — **deployed**, see §2. Awaiting its first
  real pack to confirm the build posts to the scanned bin.
- ~~`convert_demand` Firestore rule (`0a5fa65`)~~ — **released** in the same run.

### 🟡 Decisions needed from Stuart
1. **H1 `codeRx` — the one that blocks other work.** `Shared/sizeMatrix` gives only `H2-RND` a code
   grammar; `H1-RND` has none, deliberately ("every strategy falls through") — that is how the H2
   work guaranteed it changed nothing for H1. So unstamped H1 items have **no rod-diameter key**,
   which is why portal Quick Ship shows Simple Elegance diameters under a FABRICUT H1 collection and
   every slot empties when a diameter is picked. **Left alone on purpose:** Fabricut is being
   reloaded in the H2 format (separate per-diameter assemblies) and will arrive with its own family;
   adding a grammar now would change H1's CPQ size steps, spec sheet and render scale for a
   collection about to be replaced. **Workaround today: leave Rod Diameter on "Any".**
   ⚠ **If the Fabricut reload slips, revisit this** — portal Quick Ship stays broken for H1 otherwise.
2. **Quick Ship add-on picker** — built for CPQ, not wired into Quick Ship. Fees created in 4.6 are
   **app-only with no NetSuite item id**, so they cannot push. Proposal: show them greyed with
   "needs a NetSuite item" rather than let someone quote something that can't transmit. Needs a yes/no.
3. **Miter fee sheet slip** — July 30 sheet rows 4–8 all carry `H1-MRPF` at two different prices;
   likely one should be `H1-MRCPPF`. Not guessed at.
4. **Fee → NetSuite push mapping** — the push maps anything not `Inventory` to `assemblyitem`; a
   `Fee` record would too. No worse than before, but wrong if a fee ever needs pushing.

### 🟢 Stuart's in-app to-dos
5. **Re-class seven mis-classed fees** — Master Library → Record Class → Fee: Custom Finish Multi
   Color, Cover Plate Upgrade, Strike Off, Outdoor Coating, Custom Finish Single Color, Custom Labor,
   Pole Pack Standard.
6. **Set plate roles in 4.6** — 🔗 Plate Pricing: `H1-1BP-*` → Backplate–included; `H1-1CP-*` → Cover
   plate–upgrade with painted + premium figures. Then 🦾 Arms & Returns to confirm the miter/french
   returns are listed.

### ⚪ Carried forward / not started
7. **`$0` pole prices in portal Quick Ship** — visible on `H1-1BPOLE/P`, `H1-2TRV/B`, `H1-138R/P`.
   Separate from the size-key issue, never investigated.
8. **Fabricut aliases** — a search confirmed they are unused; folding the info into the Fabricut
    Pricing & Grouping box was agreed, not done.
9. **H1 Phase B (multi-material)** — second finish seam (collar vs top), render mesh split,
    dual-component BOM push. Needs GLBs with separate collar/top meshes.
10. **Phase 4 ceiling + double** — needs GLBs. EP standard NetSuite prices need team data.
11. **Offers not taken up** — fire the NetSuite bin transfer directly from the pick step instead of
    handing to Pull-to-Plating · auto-drop a WO into RTG from an urgent core flag · move
    `Shared/printForm` off pop-ups so invoices print on tablets · clear a stale backplate when a
    bracket changes location (currently leaves an invalid id while the dropdown reads blank).

---

## 7. Shipped but never exercised against real data

- The **french/miter return** path for included plates (reaches returns via the End Treatment step at
  the same position).
- **Premium tiering on a live `/EP` quote.**
- The **presentation combo filter** depends on batch-processor tags using our part codes — a wrong
  plate means check that asset's `plateCode` in the gallery; a blank one means re-tag, not more code.
- **Re-dispatching the Fabricut order** to confirm the backplate reaches the pick queue with a real
  item number.
- **`qtyEach` / `configQty`** — only stamped from now on; no existing order carries them.
- **The bin-scan assembly build** — deployed 2026-08-03, but no order has packed through it yet.
  First real pack of a stock order is the test: the build must post to the SCANNED `putawayBin`.

---

## 8. Firestore fields introduced

| Where | Field / collection | Meaning |
|---|---|---|
| `hq_sales_orders`, `hq_work_orders` | `dispatchedAt`, `dispatchedBy`, `rtgArchived`, `archivedAt` | RTG board only — status untouched |
| `fin_workorders` | `urgent`, `urgentAck`, `urgentAckBy/At`, `needBy`, `pickShorts`, `pickShortages`, `pickHadShorts` | urgency + short-pick record |
| `fin_workorders` | `putawayBin`, `packedAt/By`, `packMode` | read by the bin-scan assembly build |
| `system/finish_run_days` | `byRecipe.<recipe>.days[]` | planned run day per finish |
| `core_urgent_demand` | doc per backorder-driven core shortfall | red URGENT on the Sales Snapshot |
| `plating_demand` | `source: 'pick-backorder'`, `backorder{}` | raised from a short pick |
| `Approved_Designs.manufacturingSpecs` | `checkoutSelectable`, `plateRole`, `plateUpgradeOf`, `plateUpcharge`, `plateUpchargePremium`, `includesPlate`, `feeRule` | checkout curation, plate association, fee rules |
| `Approved_Designs` | `partClass` explicitly editable (`Inventory`/`Assembly`/`Master Assembly`/`Fee`) | |
| `crm_records` | `portalLogoUrl` | client logo in the portal header |
| `jobs` | `portalDeleted`, `statusBeforeDelete`, `portalDeletedBy/At/Reason` | client-withdrawn quotes |
| `jobs.cpqData.breakdown[]` | `qtyEach`, `configQty` | per-configuration count + multiplier |
| `shop_custom_orders.cutList[]` | `qtyEach`, `configQty` | same, on the shop card |

**No new field for order status** — it is derived from what already exists, on purpose.

---

## 9. Shared modules — reuse these, don't re-derive

| Module | Purpose | Session |
|---|---|---|
| `Shared/orderStatus.js` | The single derived status. 11 stages, split-aware. | B |
| `Shared/OrderStatusChips.js` | Renders it identically on every screen. | B |
| `Shared/WhereIsIt.js` | The lookup box. Props-driven, no own listener. | B |
| `Shared/pickOrder.js` | Merge + bin-sort a pick list. | B |
| `Shared/configQty.js` | Per-configuration figure + "× N" phrasing. | B |
| `Shared/feeRules.js` | Fee modes/units, `computeFee`, checkout catalog. | A/B |
| `Shared/finishRouting.js` | Outsourced finishes, mill cores, shortages, `coverPlan`. | A |
| `Shared/plateRules.js` | Plate roles, tiered upcharge, `includesPlate`. | A |
| `Shared/quoteDisplay.js` | Quote-number precedence. | A |
| `Shared/pickTabs.js` | One tab list for PickPack + the role matrix. | A |
| `Shared/lineClassification.js` | Part Handling routes the line, not the flow step. | A |
| `Shared/labelPrint.js` | All label printing. | A |

---

## 10. Verify before commit

```bash
npx --no-install eslint <path>
CI=false npx --no-install react-scripts build
```
