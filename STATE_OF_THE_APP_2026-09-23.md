# State of the app — 2026-09-23

**For any session starting after this date. Read in this order:** `CLAUDE.md` (the working agreement — plan, wait,
requested scope only, no temporary fixes, trace the RTG spine before every change), `APP_ARCHITECTURE_BRIEF.md`
(orientation, the SSOT register), then this file. `OUTSTANDING_2026-09-17.md` is the previous live list; its items
that are still open are carried into §6 here. Territory briefs (`BRIEF_B_…`, `BRIEF_C_…`, `BRIEF_D_…`, `BRIEF_E_…`,
`BRIEF_F_…`, `BRIEF_S5_…`, `BRIEF_S6_…`) stay as the record of each territory; where this file and a brief disagree,
this file is newer.

Written by the session that worked alone with Stuart from 2026-09-21 to 2026-09-23 (S1–S7 were retired 09-17; "we
will work here and fix what is broken"). Repo at writing: `main` = origin, last commit `0f320f97`. Harnesses: 74 green,
6 red — the same six as on 09-17, all one packaging fault (they import generated `scripts/*.mjs` copies that do not
exist: kitCode, priceLevels, traverse ×4), not product.

---

## 1. The rules that changed this week — every session builds to these now

1. **The floor is the same whatever door the order came through.** CPQ split, Order Entry line, 10.5 row: they all
   arrive on the floor as the same documents. Every gate on the shop, the finishing floor and the WMS reads the
   DOCUMENT's own facts — sales-typed or stock, has a custom sibling or not, staging-matched or not, anything to pick
   or not — never the door. Training is one story. (Stuart, verbatim: "they do not know if the order came from cpq,
   order entry or 10.5 to the floor they are all orders.")
2. **A row is a pair, grouped by row AND finish.** The Order Entry route (`Shared/oeGenerate.executeOeJobs`) groups an
   order's to-be-finished lines by row and finish and writes ONE finishing document (every small part of the group)
   + ONE shop sibling (its custom pole(s), cut list), linked, through `Shared/rowPair` (writer) and
   `Shared/rowPairShape` (pure). An order with no rows is one row. A row with two finishes is two pairs. The CPQ split
   (`RTGDispatchTab.autoSplitSalesOrder`) writes one pair per finish (`rowPairShape.finishGroupsOf`); a single-finish
   order keeps its ids exactly (`WO-<key>` / `SHOP-<key>`); a multi-finish order suffixes each pair (`WO-<key>-P24`).
3. **A pair opens NO NetSuite work order.** Order Entry's to-be-finished field behaves exactly as CPQ: the sales
   order is the NetSuite record. Order Entry's STOCKED-item field is a different door (stock assemblies → NetSuite
   work orders) and is untouched. Older per-line work orders opened by the old route keep their NetSuite anchors.
4. **On a custom pair the pole is the shop's.** The writer keeps the raw pole off the finishing side
   (`stockRun.buildParkedWorkOrder`, `rowPairShape.pairShapeOf`); the one shared reader never picks it
   (`pickLines.pickableLinesOf` → `isOwnCustomPole`) — that reader also cures documents written before the fix. The
   Setup Queue's local copy of the pickable count is gone; the raw-pull synthesis is for stock builds only.
5. **The setup card waits.** A paired pole with nothing else to set up reads *Waiting on shop* (`orderStatus.
   setupWaitsOnShop`); Stage to Floor waits on the WMS staging match for every sales document
   (`orderStatus.stageWaitsOnMatch`); stock builds and stock poles skip the match, as the scheduler always did.
6. **The staging key is the work order.** Both staging labels barcode the FINISHING document's id (the shop half
   carries it as `finSiblingId`) — `Shared/stagingKey`, re-exported by `workOrderContract`. The handshake resolves each
   scan to one document and, on a paired document, requires the small-parts scan and the shop scan to be the same
   document. A document with nothing to pick is matched by the shop label alone. An older label carrying the sales-
   order key is accepted only when it names exactly one open document; on a multi-row order it refuses and asks for a
   reprint. **What to paste without a scanner:** the text under the barcode (`WO-OE-…`), not the shop's big number.
7. **An order released by rows IS an Order Entry order.** `displayRelease.displayAnchorPatch` stamps
   `orderClass = ORDER_ENTRY_CLASS` (+ pending pick, piece count from the lines) at the anchor and the retire. Every
   reader asks ONE function, `pickLines.isQuickShip`; every writer and Firestore query names ONE constant,
   `pickLines.ORDER_ENTRY_CLASS`. The five local copies are gone. `reopenQuote.isOrderEntryOrder` (class, source,
   QSQUOTE job, or the job itself) builds on it — it is RTG's split guard and the CRM's Approve guard.
8. **An Order Entry order is never split whole.** The CRM's Approve refuses an Order Entry quote
   (`reopenQuote.approveDoorReason`; the button greys with the sentence); `autoSplitSalesOrder` refuses at the cause
   (auto-release, ↻ Re-dispatch, supervisor override all pass through it); ↻ Re-dispatch is hidden on such orders.
   Cause: SO60586, a Quick Ship quote approved from the CRM, arrived CPQ-shaped and was split whole from its printed
   breakdown (no part id, no cut length — an 18" pole went to finishing as a small part).
9. **The material grid.** Every document the release writes carries `materialRows` (need · on hand · short · on
   order · covered by), computed once at release by the one writer (`workOrderCreate.parkWorkOrder`,
   `rowPair.parkRowPair`, the split) from the plan's numbers — `Shared/materialGrid` (pure) — and drawn by ONE
   renderer, `Shared/MaterialGridCard`, on the finishing setup card, the shop card and the WMS pick card. RTG
   refreshes the stock columns once a morning (from 6 am local, first RTG session open, recorded in
   `hq_config/floor_stock_refresh[brand]`), only on documents whose parts have not been pulled; the 🌅 button runs it
   any time. No floor tablet reads NetSuite for it.
10. **10.5 is mission control for display orders** (`HQ/DisplayBuildsPanel`, `Shared/displayRelease`): rows are
    started from there through the one route; a build spans several sales orders; a whole-order-split order is read
    only until its split is retired (⟲ Retire → closes `WO-/SHOP-/PKG-<so>` through the closer with `keepRecord`,
    keeps the sales order, cancels open plating demands, writes the lines, stamps the class). A retired document is
    recognised by `closedFrom: '10.5'` and no longer reads as the split.

## 2. Where the live orders stand (2026-09-23 evening)

| Order | What it is | State | Next |
|---|---|---|---|
| SO60551 | Tabletop, CPQ, whole-order split (`WO-SO60551`/`SHOP-SO60551`), nearly built | Finish on its whole-order documents; do NOT retire | Pack with SO60565 |
| SO60565 | Tabletop, Order Entry, rows | Base Front 1 went through the OLD per-line route: pole doc at Painting (never matched — scan its shop label to record it), end-cap doc staged & matched and on the floor at coat 1/3 P24 | Start the next row from 10.5 → the first PAIR from the new route. Send the setup card + shop card. |
| SO60583 | Wall, Order Entry | Anchored, pack card in SO Pack, rows not started | After the tabletop proves the pair |
| SO60585 | Wall, CPQ, split retired 09-23 | Released by rows, class stamped, count fixed, PKG closed | Rows from 10.5 |
| SO60586 | Wall, Order Entry quote approved from the CRM (the bug of rule 8), split retired 09-23 | Lines written from the breakdown, five pole lines to be assigned to Row 1 on 10.5 | Assign Row 1, then rows from 10.5 |

**Not yet proven live:** the first pair through staging (two scans, one document) and Push to Active Floor as one job;
the morning stock refresh on a real morning; the SO Pack card's hold lifting when a row's work orders complete.

## 3. Territories — what each session owns and where it left off

- **RTG / finishing (B)** — `RTGDispatchTab.js`, `FinishingFloor/*`, `Shared/orderStatus`, `floorRelease`,
  `finishingTime`. Live this week: split by finish, guards, morning refresh, setup-card gates. **Open:** the hand-finish
  step of a recipe (P24 has one) is not walked by Manual Floor Control (setup/spray/bake only) — Stuart's next
  finishing-floor session; start from the end caps at coat 1/3. RTG lists a CPQ-born display order twice (sales board +
  Order Entry records) — cosmetic. The review modal's NetSuite plan text still says a work order opens — nothing opens
  for a pair now; wording only.
- **Shop floor (C)** — `ShopFloor/*`. Live: completion label barcodes the pair's spine; `pushToShop` carries a pair's
  `cutList`, `pullLines`, pole counts and row label onto the shop document. **Open:** plating round trip on an /EP
  custom order still not run live.
- **WMS (D)** — `PickPack/PickPackApp.js`, `Shared/pickLines`, `stagingKey`, `packingList`. Live: handshake by work
  order with the nothing-to-pick case, pending queue for stock builds only, material grid on the pick card, SO Pack
  cards for released-by-rows orders. **Open (carried from 09-17):** fulfilment fails on multi-location orders ("one
  location per fulfilment"); UPS functions (`upsRate/upsShip/upsVoid`) never deployed from Cloud Shell; Fulfilment tab
  still TEST mode; the pack station's custom-label match now reads the same resolver.
- **Sales side (E)** — `QuickShipTab`, `ExternalCoopTab` (CRM), `salesOrderHeader`, `reopenQuote`. Live: Approve
  door guard. **Open:** the estimate→sales-order transform belongs in tab 7 so an Order Entry quote approved there
  closes its NetSuite estimate (today: closed by hand); `type: 'Custom'` still written by the CRM approve path.
- **Kits / spec sheets / 1.6 / 4.5 (F, S5, S6)** — Live: 50 app kits seeded from `0903/H1-SimpleKits.xlsx`
  (`Shared/simpleKits`); the NetSuite sync preserves `partClass`; 📐 item pictures from a drawing; 🔩 kit component
  thumbnails; 📷 item pictures from a parts model (`Shared/nodeThumbs.planModelThumbs`: slot-prefix tails, finish-in-
  the-name, finish families → base record; ONE model per run, scene released after — `hardwareThumbs.releaseScene`);
  `docs/FUSION_EXPORT_FOR_PART_PICTURES.md` is the designer's rule. **Open:** the remaining H1-2TRV component codes
  without geometry; the merge truncates component names to 24 characters (no traverse code is near it).
- **10.5 displays (S5)** — see rule 10. **Open:** whole-order rows counted as started for display demand (the tabletop's
  SO60551 still adds to the Snapshot's demand while being built) — one line in `displayBom.displayDemandFrom`.
- **Payments / UPS / portal (S4)** — untouched this week; `PAYMENTS_UPS_INTEGRATION_BRIEF.md`.
- **Functions** — `nsOutboxWorker` deploy from Cloud Shell still pending (memory `netsuite-concurrency`).

## 4. Named this week, not fixed (each is its own item)

1. Hand-finish step on the finishing floor (§3 B).
2. Estimate transform in tab 7 (§3 E).
3. Whole-order rows counted as started for display demand (§3 S5).
4. RTG double listing of a CPQ-born display order (cosmetic).
5. Review modal's NetSuite plan wording for pairs.
6. The CPQ split's custom-only order writes a pick-only finishing document born Complete — a painted custom pole with
   no small parts has no finishing record on the CPQ path (a pole-only ROW pair does carry the pole stream). Pre-
   existing; check before relying on the split for pole-only orders.
7. Staging labels printed before 09-23 carry the sales-order key: fine on one-document orders, refused (reprint) on
   multi-row orders — by design, but the floor should know.

## 5. Ops facts every session needs (new or re-learned this week)

- **Deploy verify:** `asset-manifest.json` does NOT list every chunk. Extract chunk maps from `main.*.js` with
  `\{[0-9]+:"[a-f0-9]{8}"(,[0-9]+:"[a-f0-9]{8}")*\}` (sweep EVERY match), download each `static/js/<id>.<hash>.chunk.js`,
  refetch any under 1000 bytes (a stub), grep plain-ASCII markers. The commit sha is in `main.*.js`
  (`VERCEL_GIT_COMMIT_SHA`). Code imported by RTG, 10.5 AND the Snapshot (e.g. `oeGenerate`, `rowPair`) lands in a
  SHARED chunk (99.* today), not in main and not in the RTG chunk.
- **macOS is case-insensitive:** `materialGrid.js` and `MaterialGrid.js` are the SAME file. The renderer is
  `MaterialGridCard.js` for that reason. Never create a file whose name differs only by case.
- **Harness gating in a `&&` chain:** `node scripts/x.test.mjs | grep … | head` exits 0 through `head` even when the
  harness failed. Gate on the harness's own exit, or grep and check the count.
- **`git pull --rebase --autostash` before every push; stage only your files; never switch branches** (unchanged).
- **Commit attribution:** `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **No scripts against production** (App Check); every data change is an in-app button. The 10.5 self-heal buttons
  (📦 pack card, count, ↩ remove) are the pattern for one-time repairs.

## 6. Carried from OUTSTANDING_2026-09-17 and still open

- A2 fulfilment one-location-per-fulfilment (14 FAILED rows in 11.1) — **next WMS fix.**
- B2 UPS functions not deployed; C4 Fulfilment tab TEST → LIVE.
- C1 UOM on floor lines/labels, C2 backorder hold lifted at receipt, C5 10% over-receipt — acceptance owed.
- A1 PO2205 receipt catch-up — acceptance owed (post the difference, watch 11.1).
- Cloud Shell deploys: `nsOutboxWorker`, `upsRate/upsShip/upsVoid`.

## 7. How to start a session against this file

1. Read `CLAUDE.md`, `APP_ARCHITECTURE_BRIEF.md`, this file, then the brief of your territory.
2. `git pull --rebase --autostash`; run `node scripts/<your territory>.test.mjs` for the harnesses you will touch.
3. Plan, state the downstream trace (work orders → finishing → shop → WMS → NetSuite), wait for Stuart's go.
4. One issue at a time. Commit only your files. Verify the served bundle by marker before saying "live".
5. Name what you see beside your issue; do not fix it in passing.

## 8. Changes since this file (append, newest first)

- **2026-09-24 · S7 (re-engaged by Stuart in its own session) · 92d0eca2 (pushed 08:44 EDT; swept per §5: main.108c4439.js carries VERCEL_GIT_COMMIT_SHA 92d0eca2; 38 chunk entries downloaded, 0 failures, 1 stub refetched; `Pillow price chart` / `Press again to write the table` / `GROUP_DUPLICATE` in `63.a5bd553f.chunk.js` (System Admin), `Pillow Pricing` in main + that chunk; hardware guard literals stand (`a return carries the rod at that end` in main, `Pick a Left bracket OR a return/arm end first` + `Push Config to CPQ` in `104.037c016c.chunk.js`)).** Uniquity pillows, step 2: **11. System Admin → 🧵 Pillow Pricing** (nav button + section shown only on the Uniquity brand; `AdminTab.js` +3 lines) — drop `0903/Pillows Size Price Chart.xlsx` (5 fabric groups A–E × 10 sizes, `20x12` = 20 wide × 12 tall) → preview with a diff against the live table → two-press Apply writes `system/pillow_pricing` whole and sets `system/master_lists.pillowSizes` to the chart's sizes in chart order (an unpriced size can never be quoted; the preview names what leaves the list). Editable blanks the chart does not carry: labour per custom seam, seam allowance, yard rounding, the non-inventory rollup item (`CUSTOM PILLOW`), and a DETAILS list the operator adds to (built-ins FLANGE / WELT each, OUTER_TRIM / FRINGE_SEAM per yard; new kinds EDGE / TRIM / ADDON) — a blank refuses at pricing by design. Pure: `Shared/pillowPriceSheet` (44 assertions against the real chart) over `Shared/pillowPricing` (58, step 1 of 09-13). Nothing reads the document yet — step 3 is the Vision board pricing from it and sending the line to Order Entry. No order, floor or NetSuite write. Named, not touched: `sh scripts/run-traverse-tests.sh` still exits 1 on the packaging faults §0 names. Record: `BRIEF_S7_UNIQUITY_PILLOW_VISION.md` §7.
