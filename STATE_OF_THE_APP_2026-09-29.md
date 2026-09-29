# State of the app — 2026-09-29

**For any session starting after this date.** Read in this order: `CLAUDE.md` (the working agreement — plan and WAIT,
requested scope only, no temporary fixes, trace RTG → work orders → finishing → shop → WMS → NetSuite before every
change), `APP_ARCHITECTURE_BRIEF.md` (orientation), `STATE_OF_THE_APP_2026-09-23.md` (the wider picture, still right),
`SESSION_CONTINUATION_2026-09-27.md`, then **this file — it is newer than both where they disagree.**

Written by the session that walked SO60551 (the Fabricut tabletop display, 50 boards) through every floor with Stuart on
2026-09-27 → 09-29. That walk-through is **still running in its own session** (§2); a new session works beside it.
Repo at writing: `main` = origin, last commit `4c35aabe`. Harnesses: **92 green, 6 red** — the same six packaging faults
as 09-17 / 09-23 (`kitCode`, `priceLevels`, `traverseConfigurator`, `traverseExplode`, `traverseFlow`,
`traverseKitImport` import generated `scripts/*.mjs` copies that do not exist), not product. Loops: `rowRoute` 72/72,
`orderEntry` 22/22 (`node --import ./scripts/loops/register.mjs scripts/loops/<name>.loop.mjs`).

---

## 1. The rules that changed 09-27 → 09-29 — every door builds to these now

Stuart's standing objective for all of it (verbatim): *"after this exercise the 3 need to be identical in how they
handle items to be finished … don't make a change here and leave one of those screens with a different logic."* The
three doors are the **CPQ split** (`HQ/RTGDispatchTab.autoSplitSalesOrder`), **tab 7 Order Entry**
(`HQ/QuickShipTab`) and **10.5 display rows** (`HQ/DisplayBuildsPanel` → `Shared/oeGenerate`). Every rule below lives
in ONE shared module that all three read — never a door-local copy.

| # | Rule | Module of record | Commit |
|---|---|---|---|
| 1 | **One classifier.** 10.5 rows and tab 7 decide shop-or-small with CPQ's own `classifyLine`; fees / returns / miters RIDE their pole (the shop's cut list); a custom line quoted with no finish takes its row's rod finish. | `Shared/oeClassify` → `lineClassification.classifyLine` | 916a8c06 |
| 2 | **Traverse rules on every door.** Track and F-clip wear the sub finish 4.5 aligns to the fascia (S04 → TCP → leaves the floor as `H1-2TRVTRK/C`), cut −0.5" / −1" manual, −2" / −3" motorised; the F-clip is sold by the foot with its track; a stained fascia is the species its stain consumes (S04 → `-O`); brackets are the stock colour. | `Shared/subFinish` (`rowRestampOf`, `traverseOrderLinesOf`, `finishedCodeOf`), `traverseExplode` | 1be13e05, 4d74ba5c |
| 3 | **A part that wears nothing.** An item tagged **Unfinished** in the Master Library never takes a finish (the item wins — `finishLabel.takesNoFinish`); a cut piece with no finish is cut by the shop and packed (pick-only finishing doc, no finishing floor); a small one is a shelf pick. | `Shared/subFinish` (`UNFINISHED`, `splitLineFinishOf`) | 1b545ddf |
| 4 | **Each part on its own recipe.** A finishing document COUNTS its poles (the shop's + any pole on its parts list) so the floor runs poles on the `-P` recipe and small parts on `-S` (GL5-S 4 coats vs GL5-P 5). A mixed doc is never `finishStream: POLES`. Docs written before the rule: RTG → Board vs Floor → **🎨 Poles not counted → Count** (done on 5 docs 09-28 incl. WO-SO60676 GL5, WO-SO60712 SL1). | `Shared/rowPairShape.docStreamsOf`, `poleCountRepairOf` | 2e311997, e0dcfca1 |
| 5 | **A painted pole alone** on the CPQ split goes to the finishing floor on the pole stream (it got a pick-only doc and packed unpainted). | `RTGDispatchTab` split | 20282b1f |
| 6 | **A pair with no shop half goes to the pick at once** (only a shop START releases a pair's pick). | `rowPairShape.pairShapeOf` (`sentToPickPack`) | ea1c9297 |
| 7 | **Short work-order ids that scan.** Row / Order Entry pairs: `WO-OE-<SO>-<4 digits of the clock>` (+N/P on a start-now split), 18 chars; the old 43-char id was wider than a 4" label at the shop Zebra's bar width. `WO-OE-` stays (it keeps a row pair from reading as a whole-order doc). The writer steps the clock if an id — even a deleted one's tombstone — exists. The row name now prints on both labels as text. | `rowPairShape.pairIdsOf`, `rowPair.parkRowPair`, `labelPrint`, `ShopFloor` label | 4c742b82 |
| 8 | **A rider is never the item.** A shop job with French return / fee riders is named for its POLE (the first non-rider line with a cut or feet per piece) — card, labels, shop instruction, plating demand, rod-piece panel; a tab-7 / 10.5 pair's shop doc carries `partNum` = its pole, as the CPQ split already did. | `Shared/splitPlan.shopLeadLineOf/shopLeadCodeOf`, `ShopFloor.shopItemCodeOf`, `cpqJobFacts` | 7d800298 |
| 9 | **Gathering into an order works for every code.** The gathered count was a dotted Firestore path `committedQty.<code>`; Firestore refuses `/`, so every finished code failed to gather (plating put-away, arrival alert, pack gather, release). One writer now uses `FieldPath`. | `PickPackApp.updateCommittedQty` | e72e33bd |
| 10 | **Plater PO rate.** A custom pole is priced by the foot by default: ROUND $20/ft, SQUARE / RECTANGULAR (H1-2…, H1-75SR) $25/ft — shape from the item's product line (watchlist); the plating demand carries `feetPerPiece`. No stock plating poles exist (always custom). Typed $/ea still wins. | `Shared/platingRate`, `splitPlan.shopFeetPerPieceOf` | a19be3ed |
| 11 | **Packing station gather.** A nothing-to-pick Order Entry document shows at Packaging Prep once its shop half is Complete and a line it carries is still owed (UNFINISHED cut pieces have no put-away; a failed put-away gather is recovered). | `PickPackApp.oeGatherOwed` | 8ddc6bbe |
| 12 | **Wood rod, choice A.** wood + (miter / bend / splice **or a cut length on the line**) → the shop cuts it, finishing stains it with its row; straight with NO cut (a stocked length sold whole) → finishing pick. | `lineClassification.classifyLine`, `oeClassify` | 61d02426 |
| 13 | **An item kit is one thing sold, several things made — on EVERY door.** A Kit record with `kitComponents` (no `kitAlign`) is SOLD as one line (`isKit`: price + customer number; never made, picked, stocked or pushed as an item) and MADE / PICKED / CONSUMED as its parts ($0, hidden, each wearing the kit's finish or stock colour; an Unfinished part wears nothing). A finished kit code names the mill kit + finish (`H1-2TRV-WB/C` → the H1-2TRV-WB kit in TCP; `/EP1` → EP1); the `/B /C /EPn` ASSEMBLY records are never stocked or built (Stuart will remove them from NetSuite). NetSuite gets the **parts at $0 + the kit's money on the 61502 rollup** (CPQ push shape; tab 7 now the same). Customer quote / SO / invoice show the kit line, not its parts. 10.5 ↻ Re-read explodes an old-snapshot kit line into its parts (appended at the END — no line moves). | `Shared/itemKit` (new), `hardwarePricing` (engine stamp cb57bb2f2eb0), `QuickShipTab`, `displayRelease`, `pickLines`, `lineClassification.customerDocLines` | 0dab6d69 |
| 14 | **A stock colour: the shelf first, else painted, else raw** (Stuart: *"first look to /B or /C components for stock, if none then look to the /P and we paint, if none then look for the raw component"*). Per LINE, all or nothing: the order's view of the /C shelf covers it → shelf pick (oeGen `STOCK`); otherwise the whole line is painted TCP / TBR from its /P, with the convert from raw behind it. A TRUE backorder only when /C, /P and raw are all short. Same on the CPQ split and the Order Entry route. | `oeGenerate` (`STOCK_FIRST` door), `oeReviewPlan`, `splitPlan.planSmallLines`, `backorder.isStockColourLine` | 0dab6d69 |
| 15 | **10.5 ✎ line quantity** — only for a line nothing is raised or gathered for, never a kit or kit part; stamped from / by / at / why; NetSuite changed by hand. A /C part reads NOT STARTED on 10.5 (the start decides shelf-or-paint); a kit line reads "kit — its parts are the lines below". | `displayRelease.lineQtyEditOf`, `lineStateOf` | 4c35aabe |
| 16 | Smaller, same days: SO Pack never picks a fee, labels + Release read the finished piece (bc3bc196); a row's shop doc carries CPQ's cut sheet / notes / drawing, a wood stain is never phosphated at release (f5f1a4b1); tab-7 traverse components reach the order's lines, a to-be-finished line is backorder-checked as its finished piece (4271a66b); a pole's rod is read in NetSuite's unit (pieces × cut = feet), bought rods too (c756d0a4, 553a2ff1); 10.5 closes the retired split's leftover pack card (45cb4e4d). | | |

Memory note with the same list: `so60551-push-through-rules-2026-09-28.md`.

## 2. The display exercise — SO60551 (tabletop × 50), IN PROGRESS in its own session

The goal: walk SO60551 (already built physically) through every step with no failures, then build a **duplicate
feature** to copy this display board order for **100 new tabletops** (must regenerate from the CURRENT CPQ engine, not
copy the 9/16 snapshot). Wall boards SO60585 (35) / SO60586 remain open after that.

Where it stands (09-29 morning):
- **Shop:** every job done. Plated poles went through a real plater round trip: **PO2340** (Dayton Grey, $2,021.00),
  received (item receipt 933012), put away to **PLATING-IN**; gathered into the order's committed bin **ORDERS-COM1**.
- **Gathered in ORDERS-COM1:** H1-1R/EP4 50 (ROW 1), H1-1R/EP2 50 (Base Front 3), H1-2RCTACR 50 (clear acrylic).
- **Lines re-read under the kit rule** (lines 37–46 appended): Row 2's two H1-2TRV-WB/C kits → 2 × 50 each of
  H1-2TRVBP/C, LA/C, BA/C (shelf picks — started, oeGen STOCK); Base Back 1's H1-2RCTAEC kits → H1-2RCTAECC (+ EP1,
  shelf pick) and H1-2RCTACEC (clear). H1-2RCTACEC tagged **Unfinished** in the library 09-28. Nut line 21:
  **50 → 100** (one nut rides each bracket).
- **Finishing floor:** all 8 finishing documents staged; setup running on 4 (Back Base 2 S08, Back Base 3 P14, both
  Base Front 2), 4 not started. Stuart / Grace run the coats (every step takes a chip PIN).
- **Next:** coats → Packaging Prep gathers each finished doc into ORDERS-COM1 → SO Pack shelf picks → pack →
  NetSuite fulfilment. **Stuart owns the NetSuite side of SO60551 by hand:** the kit parts in place of the kit lines
  ($0 + rollup), nuts at 100, stock for the kit parts.

**Files the exercise session is likely still to touch** (coordinate before editing — rebase with autostash, stage only
your own files): `HQ/DisplayBuildsPanel.js`, `Shared/displayRelease.js`, `Shared/oeGenerate.js`, `oeReviewPlan.js`,
`rowPair*.js`, `itemKit.js`, `splitPlan.js`, `PickPack/PickPackApp.js` (pack / plating), `ShopFloor/ShopFloor.js`
(plating demand), `HQ/QuickShipTab.js`.

Other live orders: SO60565 (tabletop, rows); SO60583 / SO60585 / SO60586 (walls — ⟲ Reopen for rows still to press on
60585/86); WO-SO60676 / WO-SO60712 pole counts repaired (rule 4).

## 3. Named during the exercise, NOT fixed — candidates for app improvement / clean-up

Each is its own item (one at a time, plan first). Roughly by value:

1. **Every deploy logs the operator out.** HQ, the WMS and the shop floor keep the login in React memory; a reload
   (the "NEW VERSION IS LIVE" tap, or any push) needs the PIN again. The WMS also logs out after EVERY pick and stage
   (by design). On a busy day this is dozens of PIN entries. Worth a design conversation (session per station, or
   survive a version reload).
2. **Security clean-up: `src/LandingPage.js:46`** — the "HQ Management Hub" button writes a hard-coded admin session
   `{ name: 'Admin', pin: '1234', role: 'admin' }` into `localStorage.hq_session`. HQ does not appear to read that key
   (dead?), but it should not exist.
3. **Traverse SYSTEM kits (isKit without itemKit) vanish from customer documents** — `customerDocLines` drops every
   `isKit` line; item kits are now kept on money documents (rule 13), traverse systems are not. (The packing slips —
   `PickPackApp.js:877`, `ExternalCoopTab.js:1471` — filter `!l.isKit` after it, so a slip lists a kit's PARTS: keep.)
4. **A multi-pole plated shop job** (two different pole codes) makes ONE plating demand named for the lead pole with
   the total qty — needs one demand per pole code (rule 8 made the lead pole explicit; the model is still one-per-job).
5. **Shop card phosphate box on a wood stain** (Row 2's S04 showed it) — the release (`floorRelease`) exempts stains,
   the shop card's own rule may not; verify against f5f1a4b1. Also: does the floor's paint rule phosphate a TCP track?
6. **CPQ F-clip lines are not per-foot** while NetSuite sells the F-clip by the foot (tab 7 now is — rule 2).
7. **CPQ split, single finish group = a stock colour** (all TCP): the doc's recipe falls back to the order recipe
   (`so.recipe`), not TCP — edge case, check before relying on it.
8. **Stock-colour partial coverage** is all-or-nothing by design (40 of 50 on the shelf → paint all 50). Stuart may want
   pick-what-is-there + paint-the-rest.
9. **10.5 board after ▶ Start row** once rendered "Row 2 — NO LINES ON THE SALES ORDER" and another order's rows under
   the tabletop build (the build spans SO60551 + SO60565). Looked transient; verify.
10. **NetSuite data:** kit parts' stock sat under the kit / assembly codes (H1-2RCTAEC/EP1 had 50, the collar
    H1-2RCTAECC/EP1 had 4) — the /B /C /EPn assemblies to be removed from NetSuite (Stuart); the two "Production Stock"
    bins at loc 17 still to merge.
11. **Deploy verification tooling:** keep the live-bundle verify as a repo script (e.g. `scripts/verify-live.sh`) —
    this session's scratchpad copy was blocked by the permission check; it fell back to `/version.json` vs
    `window.__APP_V` + the in-page module registry.
12. Carried, still open (see 09-23 §4 / 09-27 §4): finishing-floor hand-finish step (finishing session's), the
    estimate→SO transform in tab 7, display demand counting whole-order rows, RTG double listing of CPQ-born display
    orders, the review modal's NetSuite wording for pairs, fulfilment one-location-per-fulfilment (next WMS fix), UPS
    functions + `nsOutboxWorker` Cloud Shell deploys, Fulfilment tab TEST → LIVE, count screen cannot adjust OUT of a
    bin with no balance row, payments (NMI pay link proven in sandbox).
13. The six red harnesses (packaging only).

## 4. Ops facts learned this week

- **Deploy check without a verify script:** `fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })` vs
  `window.__APP_V` in the tab tells you whether the tab runs the served build; a build takes ~2.5 min after the push.
  To prove YOUR code is in the tab, search the in-page module registry
  (`window.webpackChunkce_m2c_design_app.push([[Math.random()],{},r=>req=r])`, then scan `req.m`) for a runtime
  pattern — comments are stripped. Module ids change per build (firestore was `565`, `db` in `5042` this week).
- **Browser tool output**: results containing `key=value` pairs are blocked ("cookie/query string data") — replace `=`
  before returning. CDP times out at 45 s: split long scripts.
- **Native dialogs freeze the tab for the browser tool.** To drive a flow: record `alert`, and let `confirm` / `prompt`
  accept ONLY the exact expected message (read it with a declining dry run first); restore natives when done. Never
  auto-accept blindly.
- **Staging without a scanner:** type the text under the barcode into the field. A key must be ≤ ~19 characters to fit
  the shop Zebra label at ^BY3 on 203 dpi (rule 7).
- **Engine stamp:** after editing `hardwareModel / hardwareAdapter / hardwareHandoff / hardwarePricing / kitSeed`, run
  `node scripts/stamp-engine-version.mjs` and commit `Shared/engineVersion.js` with it.
- macOS has no `timeout`; `for f in scripts/*.test.mjs; do node "$f"; done` for the sweep.
- **Uncommitted work of OTHER sessions sits in the tree** (do not stage it): `VENDOR_API_ONBOARDING.md`,
  `ZEBRA_RFID_PLAN.md`, `HQ/FlowItemPopup.js`, `HQ/FlowStockTab.js`, `SpecSheet/SpecSheetModal.js`.
- Unchanged: no scripts against production (App Check) — every data change is an in-app button; never type a PIN (he
  pins you in); `git pull --rebase --autostash` before every push, `git stash list` after; never switch branches;
  one issue at a time.

## 5. How to start a session against this file

1. Read `CLAUDE.md`, `APP_ARCHITECTURE_BRIEF.md`, this file, then your territory's brief.
2. `git pull --rebase --autostash`; run the harnesses you will touch (`node scripts/<name>.test.mjs`) and, for anything
   on the order route, both loops.
3. State the plan with the downstream trace; wait for Stuart's go.
4. Commit only your files; verify the served build before saying "live"; name what you see beside your issue — do not
   fix it in passing.

## 6. Changes since this file (append, newest first)
