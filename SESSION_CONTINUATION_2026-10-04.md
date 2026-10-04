# Session continuation brief — 2026-10-04

**For any session starting after this date.** Supersedes `SESSION_CONTINUATION_2026-09-27.md`. Read in this order:
`CLAUDE.md` (the working agreement — plan and WAIT, requested scope only, no temporary fixes, trace RTG → work orders →
finishing → shop → WMS → NetSuite before every change), `APP_ARCHITECTURE_BRIEF.md`, `STATE_OF_THE_APP_2026-09-29.md`
(the sixteen every-door rules of 09-27 → 09-29, still the law), then **this file — it is the week after, 09-29 → 10-03,
and is newer where they disagree.** The team-facing version of most of this is in the app: HQ → **User Guide**.

Repo at writing: `main` = origin, last commit `e3a6b4d0` (10-03). Harnesses: **126 green, 6 red** — the same six
packaging faults as every state file since 09-17 (`kitCode`, `priceLevels`, `traverseConfigurator`, `traverseExplode`,
`traverseFlow`, `traverseKitImport`), not product. ~62 commits since `STATE_OF_THE_APP_2026-09-29` was written.

---

## 0. Three sessions ran this week — who touched what

| Session | What it did | Its files (coordinate before editing) |
|---|---|---|
| **Order route / displays / WMS** | Finished the SO60551 walk-through: every piece into the order's bin (in NetSuite too), ship one display per $0 sales order, 10.5 line tools, WMS Assembly Build, commitments warning, kit-never-picked lock, mill build → RAW, stock closes short. | `HQ/DisplayBuildsPanel`, `Shared/displayRelease`, `displayShipment`, `orderBinPick`, `oeGenerate`, `oeReviewPlan`, `rowPair*`, `itemKit`, `PickPack/PickPackApp`, `PickPack/DisplayShipModal` |
| **App Imp / CPQ** | Worked the App Imp cards with Stuart: CPQ workspace, flat-rate shipping, collection-name merge, NetSuite import lock, joiner per rod material, finial kits and collars, kit quote rules, client-visible notes, finish scope switch, checkout search; finishing-floor fixes Stuart approved there (hand-coat gate, punch check, spin loads); release claim; RTG Audit Log. | `HQ/CPQTab`, `HardwareConfigurator`, `Shared/hardware*` (engine — restamp), `kitSeed`, `lineClassification`, `flowExtras`, `finishScope`, `FinishingFloor/*`, `Shared/floorActivity`, `floorRelease`, `HQ/AuditLogPanel` |
| **Spec sheets** | H1-2TRV traverse sheets, CPQ-order pickers, edition and kit names on the sheets, the solid layout Stuart approved (live for H1-2TRV, e187d155); the H1 master pricing-and-spec guide draft and the catalog alignment audit (offline, read-only). | `SpecSheet/*`, `scripts/specSheet*.test.mjs` |

**Uncommitted work sits in the shared tree — do not stage it:** `SpecSheet/SpecSheetModal.js`, `specSheetSolid.js`,
`specSheetSolidDraw.js`, `specSheetTraverseDraw.js`, `scripts/specSheetSolid.test.mjs` (the solid-layout roll-out to
H1-138 / H1-75 / H1-1, built locally, drafts with Stuart), plus `VENDOR_API_ONBOARDING.md`, `ZEBRA_RFID_PLAN.md`.

## 1. How to work with Stuart (unchanged, with this week's additions)

- One issue at a time: cause + plan + downstream trace → he says **go** → build → harness / lint / build → push →
  verify in the served bundle → report with the commit. He tests live and replies with a screenshot.
- He pins you in (HQ `/hq`, WMS `/pick-pack`); **never type a PIN**. Every deploy logs the tab out.
- **"Going forward, not old"** (09-30): after a fix, do not offer to audit or chase old quotes and orders. Say what
  changes from now on.
- **Held work never sits as a local commit on `main`** (10-01): another session's push carries it to production. Keep
  it uncommitted, or `git branch hold/<name> <sha>` then `git reset --mixed HEAD~1`. Never `git stash` in this checkout;
  after every push check `git stash list` and `git status --short`.
- **Engine stamp:** any edit to `hardwareModel / hardwareAdapter / hardwareHandoff / hardwarePricing / kitSeed` →
  `node scripts/stamp-engine-version.mjs` and commit `Shared/engineVersion.js` in the same commit (last stamp this week
  `5a61bf9ae4f1`). A new stamp makes every saved quote read STALE at Approve — say so.
- **A new Firestore collection needs a rules deploy from Cloud Shell** (rules list collections explicitly) — the audit
  log writes into `hq_logs` for that reason. Functions deploy from Cloud Shell only.
- Never tell Stuart to tick ✓FEE to stop a pin billing: the tag engine does not read it, and a FEE choice drops the
  Collar tag (it cost him an evening on 10-01).

## 2. What shipped 09-29 → 10-03 (grouped; commit in brackets)

**CPQ and the customer's paper**
- CPQ keeps its workspace (customer, header, flow, line being edited, configuration in progress) across a tab switch
  and a reload [7e25935e]. The engine follows the flow, not the brand [72e198be].
- Finish rail: one grid and an **"A click applies to"** switch — This part / Collar / Whole configuration; default is
  this part once the configuration has a finish [5a6f46ce, 8dbe1cc6]. A return cut into the pole is drawn in the
  pole's finish [865f3025].
- Step notes reach the shop [6074167d]; a tick under each note prints it on the quote / SO / invoice too [6ca2b12f].
- The splice over the one-piece limit can be declined (joiner qty 0, warning, shop note); a traverse takes only its
  own joiner; hand-added tab-11 items can name the rod material they fit [d96c5c23, 37a1f52b].
- Kits: starting from a kit fills its own brackets and plates [433a8fc3]; the allowance is spent across lines and
  brackets above the chart are charged; money documents print the kit line, $0 for what it includes, and totals read
  products → charges → total [4fe68d76]; an item kit's line says its finish and automatic hardware (clips, plugs,
  stoppers) stays off the paper [a85a95c1]; a finial kit brings its own collar in the collar's finish [3e739e90];
  Flow Doctor checks every finial can find its collar [80a6cbc6]; a cover plate follows its bracket's quantity
  [464d6949].
- Checkout: flat-rate shipping counted in boxes → the NetSuite shipping cost, never a line [42352f6f]; the last
  checkout choice is a search for any stocked item [97f1c4b2]. One name per collection (H1 FABRICUT → FABRICUT H1,
  323 records merged) [18dc6e2a]. The Factory Router's BOM prints the item number [ae4ee591].
- **NetSuite never overwrites the sales side** [cdd34c93]: 12.5 reads stock only; 11.1 keeps the app's price, unit,
  category, part handling, outsource action on existing items and files NetSuite's differences in 4.5 for a person
  to take or keep.

**10.5 and display orders**
- SO Pack stages for an order released by rows: WAITING → PICK (⤓ into the order's bin = a NetSuite bin transfer) →
  PACK → SHIPPED [0bac8a34]; the order's bin holds every gathered piece in NetSuite as the item NetSuite knows (paint
  as /P, rods in feet) [ee13657c]; stock already adjusted into the bin is counted, not moved [4aa4ba6f]; one item, one
  need [cb532a3e, 9cd48704].
- **Ship one display**: its own $0 sales order to the customer with the showroom ship-to, fulfilled from the bin,
  UPS on the Fulfillment tab [8cba0944]. Not yet run live when its note was written — display 1 is to be shipped
  with Stuart watching NetSuite.
- 10.5 tools: ✎ qty (0 = off the order, in place) [5aae78b9], ✎ finish / ✎ qty on kits [2ed9841b], ✎ rod (rods,
  feet billed, cut) [975bd614]; long pair ids scan as their short form [91d83e77]; User Guide section [cf0bd1a2].
- From the week before, still the route: ⟲ Reopen for rows, Review → for one row's lines, ↻ Fix line codes BEFORE
  ↻ Re-read lines, a row = one finishing + shop pair by row and finish.

**Every door (CPQ split, tab 7, 10.5)**
- **A kit is sold, never picked** — a kit line is never a pull line anywhere; RTG Board vs Floor has "🧰 Kit lines →
  parts" to repair an old document [efe8bb76, 6b28f51e].
- **A stock order closes short; a custom order does not** — one reading in `Shared/scrapClose`, on the finishing QC,
  the WMS put-away, the shop's last op and RTG [07a81625].
- **The WMS reads who NetSuite holds stock for** before it takes it (warn and go ahead) [ff97a3f1]; an order's own
  hold counts as its own (`fetchStockForOrder`).
- The picks the configurator makes on its own live in `Shared/hardwareAutoPicks` so spec sheets settle a set-up the
  same way [5d4d3afd].

**WMS**
- Material card: after the pick it shows what the pick took, and every card says READY / NOT READY TO PACK with the
  stage it waits on [71c151c2]. Pick Queue: "Waiting on its other half" [5ffa1ace]; Spin | Booth at the pick
  (managers choose, operators read) [da0327d5, 670e0463].
- Staging scans accept the NetSuite work-order number the card shows [cecbb46e].
- Receiving: a numbered PO follows NetSuite's lines when the dock opens it [7ec94ef2]. Plating put-away is checked
  against live stock and the BOM before anything posts [2b226579].
- Convert: started from the item, it asks whether it is for an open to-do [fc9d9565]. ASSEMBLY BUILD tab [9e4a3725].
- The whole page scrolls [f0934d75]. Earlier the same fortnight: the bin lock, per-line receiving bins, live rod cuts.

**Shop and milling**
- Mill builds receive into **RAW** — the server's automatic build and RTG's ⛏ Mill Build retry [971d455c, f47d71a5];
  milling finds a routing by item code [5c256d09]; 12.5 rod stock orders count what open app orders already took
  [c3ea770b].
- A shop job is written once; a row's job is one configuration named for its row [b9b30ea5]. The shop card reads the
  one phosphate rule (a wood stain is exempt) [2c5cffe9].

**Finishing floor** (approved by Stuart in the App Imp session)
- Poles keep their own coat and recipe (-P) beside the small parts (-S) on every screen [adb41623, 9b2f42d5, 2adff552].
- The spin machine runs in loads — all coats per load, the crew types how many are on the machine [df6c0388].
- A hand coat is started and completed only from a hand finisher's or manager's PIN [2adff552]. A punch that does not
  match the work is said, logged and stamped, never blocked; buttons read START · EMPIEZA / COMPLETE · COMPLETADO
  [6d46e83e]. Setup Queue Urgent tick, Work Order Queue urgent count [99585a0d, 41b96c62].

**RTG**
- **One release at a time**: every release door claims the RTG record first (15-minute claim); a stale tab can no
  longer release twice [42fbc858]. A skipped NetSuite build is asked for in words and repaired from RTG's "post now"
  [2c5cffe9]. The stopped-orders banner lists only what can still move [089616b0]. The CRM has **Find a Sales Order**
  by number, and an order awaiting NetSuite is no longer invisible on the customer card [088f06c1].
- **RTG Audit Log** at the bottom of RTG: page, who, item × qty, what the app says, what NetSuite says on
  "✓ Verify with NetSuite"; red = did not go through, orange = may not have [e3a6b4d0].

**Spec sheets**
- Traverse sheets, CPQ-order pickers, edition (H1 / Fabricut / Customer #) names, kit names for traverse brackets,
  solid layout live for H1-2TRV [9b300fa0, f6aa4267, dbc462d7, defaf413, e187d155]; 4.7 item popup opens the sheets
  that carry the part [4e290a57].

## 3. Live orders and open floor actions (from the sessions' notes — check live before acting)

- **SO60551 tabletop × 50**: every row made; pieces gathered into ORDERS-COM1. Five items NetSuite held none of
  (H1-2TRV, H1-2TRVCLP, H1-138TRV, H1-138WGF-O, H1-2RCTAR) were to be adjusted into the bin by Stuart, then ⇄. Next:
  ship display 1 with Stuart watching NetSuite; the bulk order is invoiced in full by Stuart, never fulfilled.
  Then the **duplicate feature** for 100 new tabletops (regenerate from the current CPQ engine, not the 9/16 snapshot).
- **Wall SO60585 / SO60586**: on the row route; all six rows dry-ran clean 09-30. **SO60585 Row 2** was released twice
  on 10-02 before the claim shipped: put away the received poles (WMS Plating receiving), then a manager presses
  "Already done — close" on `SHOP-WO-OE-SO60585-7242-C`. Do not Start or Complete it.
- **WO11639**: nothing to post — built by hand in NetSuite (ASSYB10633) and closed; the app still offers "post now" —
  never press it. **WO11578**: build was switched off at force-complete; once packed RTG offers the post — check
  NetSuite first. Six August stock jobs marked already built: leave.
- **Audit log's first findings, Stuart to decide:** IA27606 (−248 HCUSR15, WO11639) and IA27605 (−44 HCUMLB415,
  WO11602) read POSTED in the app but are not in NetSuite; IA27356 (WO11628 pack scrap) app −76 vs NetSuite −2; seven
  FAILED queue entries including PO2296 receipt catch-ups.
- WO-SO60432 kit lines: the 🧰 repair button is Stuart's to press. SO60676 was held only because its finishing never
  started in the app.

## 4. Waiting on Stuart

- Ship display 1 of SO60551; the duplicate-display feature spec.
- The spec-sheet drafts for H1-138 / H1-75 / H1-1 (uncommitted roll-out), the master guide draft v4, and the catalog
  alignment audit's findings (18 catalog numbers carried by no item, species records with no Fabricut #, others).
- NetSuite: remove the /B /C /EPn kit assemblies; merge the two Production Stock bins at CE; the IA differences above.
- Fabricut fee data: H1-ROF rush fee missing; COLF1 / COLF2 / ODCF have no % rule; H1-TUF and BOWF prices vs the sheet.
- Tags: the 1.6 H1-138 ACRYLIC-POLE-DBL-BACK pin has no material; H1-2TRV acrylic end cap choices S24 / S25 should be
  the kit H1-2RCTAEC requiring collar H1-2RCTAECC; whether a double over 120" needs two joiners.

## 5. Named, not built (merged list — one at a time, plan first)

1. Every deploy logs the operator out (HQ, WMS, shop) — a design conversation.
2. `src/LandingPage.js:46` writes a hard-coded admin session into localStorage — remove.
3. Stock reads that still ignore the order's own hold: tab-7 save, Setup Queue re-make, stock precheck, repaint,
   Library, Snapshot columns (phase 3); Stock View subtracts committed twice (phase 4).
4. Spin loads are not in the finishing scheduler's time model; not yet proven on a real multi-load job.
5. The save merge drops `shopOnly` / `billGroup` (a track row prints on a kit quote); kit money is not pro-rated on a
   short-shipped invoice; tab 7 does not count shipping boxes; the box breakdown is not saved on the quote.
6. RTG's breakdown list shows a client note row as a line (another session's file); RTG stamps `nsRootBuildBy` blank.
7. A multi-pole plated shop job makes one plating demand; custom shop halves are not blocked on scrap; the shop's
   scrapped raw is adjusted out by hand.
8. Traverse SYSTEM kits vanish from customer documents (item kits are kept); CPQ F-clip lines are not per-foot.
9. Spec sheets: client dimension set for all solid sheets, the 1" brass flow has no assembly, the in-app master guide.
10. Carried: estimate → SO transform on tab 7; display demand counting whole-order rows; RTG double listing of CPQ-born
    display orders; review modal wording for pairs; fulfilment one location per fulfilment; UPS functions and
    `nsOutboxWorker` Cloud Shell deploys; Fulfilment tab TEST → LIVE; count screen cannot adjust OUT of a bin with no
    balance row; payments (NMI pay link proven in sandbox); the six red harnesses; a repo `scripts/verify-live.sh`.

## 6. Ops facts added this week

- In-page reads (after Stuart pins you in): the webpack registry
  (`window.webpackChunkce_m2c_design_app.push([[Math.random()],{},r=>req=r])`, scan `req.m`); module ids change per
  build — this week firestore `565`, `db` `5042`, `nsProxyFetch` `7095`. Verify each by `f.toString()` before calling.
- NetSuite stock: `quantityavailable` = on hand − committed to everyone; `AggregateItemLocation` lags — on hand comes
  from the live `InventoryBalance` bin read. SuiteQL `transaction.status` is a bare code (`'A'`).
- Audit read-back: `transaction` / `transactionline` (mainline carries WO / build qty),
  `PreviousTransactionLineLink linktype 'OrdBuild'` finds builds made against a WO outside the app.
- Money-document changes that need new saved fields (`billedFeet`, `coveredQty`, `isNote`, `autoPart`) show only on
  quotes saved after the change.
- Deploy verify, native dialogs, staging without a scanner, the six-red list: `STATE_OF_THE_APP_2026-09-29.md` §4.

## 7. Memory and files to trust

Memory index (`~/.claude/projects/…/memory/MEMORY.md`) carries one line per rule; this week's: `display-ship-model-
2026-09-30`, `kit-never-picked-lock`, `stock-close-short-rule`, `netsuite-commitments-stock-holds`,
`material-card-after-pick`, `mill-build-raw-bin`, `ns-import-lock`, `going-forward-not-old`,
`cpq-checkout-fees-shipping-2026-09-30`, `joiner-per-rod-material`, `finial-kit-collar-rule`,
`kit-quote-rules-2026-10-01`, `cpq-finish-scope`, `hand-coat-gate`, `spin-machine-loads`,
`release-claim-and-build-repair-2026-10-02`, `rtg-audit-log`, `held-work-off-shared-main`, `h1-2trv-spec-sheets`,
`h1-master-guide-draft`, `h1-catalog-alignment-audit`.
