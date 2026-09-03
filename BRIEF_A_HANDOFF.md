# Brief A handoff — WO & PO creation (Stock View · Sales Snapshot · Master Library)

*Brief A session, 2026-09-02 evening. Read `BRIEF_A_WO_PO_CREATION.md` first; this is the state
of its §4 work. Decisions that changed the brief during the session are recorded in §3 below.*

## 1. What shipped (all on `main`, build compiled, `node scripts/stockRun.test.mjs` 5/5)

| commit | what | live-run proof |
|---|---|---|
| `4ae891e` | Brief C's hand-off: `manufacturingSpecs.shopInstruction` editor — Library card text box (made-here block) + 4.5 Mass Update "Overwrite Shop Instruction" panel. Plain string, nothing else. | not yet |
| `b6d0e36` | **A1 step 1.** `Shared/workOrderCreate.js` (`parkWorkOrder`, `INTENT`, `ANCHOR`, `ParkRefusal`); `Shared/stockRun.js` gains `routeForCode`, `floorFieldsOf`, `buildParkedWorkOrder` and the parked-payload params on `buildStockFinPayload` (Library run's output asserted unchanged); **Sales Snapshot (writer 3) converted**; `clearConvertGate` self-release narrowed to sales orders; `scripts/stockRun.test.mjs`. | not yet |
| `7c70a8d` | **A1 step 2.** Stock View grid (writer 1) converted. | not yet |
| `4151c37` | `BRIEF_B_RTG_FINISHING.md` §B6: patch specs for writer 10 (`INTENT.REISSUE`) and the PO memo. | — |
| `646972d` | **A1 step 3.** Raw Cores (writer 4) + PO builder core-short (writer 2) converted; `INTENT.REISSUE` added; outsourced refusal names where to raise the item. | not yet |
| `908a743` | Library card `createStockBuildWO` (writer 6) converted. | not yet |
| `4364916` | `SYSTEM_FLOW_AUDIT.md` §2 table updated to the converted state. | — |
| `73ab028` | `UserGuideTab.js` Work Orders section updated (S2) — see §6. | — |
| `984b8fe` | **A1 step 4.** Order Entry Needs (writer 5) converted; builders gain the sales block + custom pair; test case added (6/6). | not yet — regression row §6 (`HCUMP810 + /N90` one WO; `+ /P01` the pair) |
| `64edab5` | **A1 step 5.** Pre-check component shop WO (writer 9) on the shared shape. | not yet — §6 row "Grid: /P short, raw short" |
| `fa425f1` | **A6.** Snapshot's `finishOf` → `finishCodeFromErp` (Q2). | — |
| `9337ac7` | **A6.** One `tierOfErp` (Stock View + 4.5), the five routing-grade suffix reads → shared vocabulary; grep proof clean. | not yet — tier view + PO builder plated split |
| `01cc2bb` | **A3.** `Shared/platingDemand.issuePlatedDemand` — demand + core-short milling order, NO PO; five callers (PO builder, Snapshot FIN view with a live core read, tier view with its coverage remainder, OE outsourced line, Library card outsourced path). | not yet — §6 "Plated item short" row, all screens |
| `d69b75e` | **Report.** 11.1 "🔍 Plated Items Without a BOM Core" beside 🪝 — report only. Guide (S2) for A3. | not yet — press it once |

**No live run has happened yet.** Every conversion is build- and test-proven only. The acceptance
rows in the brief's §6 that these commits cover (Snapshot finished item, Snapshot 4 ft pole, grid
identical-doc diff, grid /P short cases, Library raw make-up, Raw Cores short) need Stuart pinned
in. Watch for: the RTG board taking each parked order on its own (auto-release toggle ON), the
Setup Queue showing the recipe group with pulls, and no Push to Shop offered on a finishing order.

## 2. State of the ten writers (brief §4 table)

| # | writer | state |
|---|---|---|
| 3 | Sales Snapshot | **converted** (`b6d0e36`) — raw rows now `routeTo SHOP` + root anchor at creation; outsourced rows refused with a message until A3 |
| 1 | Stock View grid | **converted** (`7c70a8d`) — gains finPayload + `source`; /P rows → Convert to-do; outsourced refused; rod cut now raised from the grid; `awaitingComponents` gates stock too |
| 4 | Raw Cores | **converted** (`646972d`) — unchanged behaviour + `memo` + `autoFlow` |
| 2 | PO builder core-short | **converted** (`646972d`) — `source STOCKVIEW_PO_BUILDER`, `routeTo SHOP`, `forPlating`, root anchor at creation |
| 6 | Library card make-up | **converted** (`908a743`) — always `STOCK_MILL` in practice; route-open parking ended |
| 5 | Order Entry Needs | **converted** (A1 step 4) — `intent ORDER_ENTRY` + `sales` block; the FLOW1/FLOW2 anchors and the direct `releaseFinWoToFloor` stay in the executor exactly as b531f53 built them (anchor policy NONE in the writer). **No rod cut on a sales line** (as before) — whether a customer's stocked-length pole is cut here or by the shop pair is a question for Stuart, not derived. The finishing half now carries `orderType 'sales'` (it had none), which is what D's `onStockBuildDone` seam and RTG's `kind` guards read |
| 7 | Library `releaseRunToFloor` | **waiting on B's `buildFinDoc`** (B1). Do not build around it |
| 9 | pre-check component shop WO | **converted** (A1 step 5) — `executeMakeupActions` builds the doc with `buildParkedWorkOrder` (pure, from `stockRun`; `parkWorkOrder` cannot be imported back) as `intent COMPONENT_MILL`, `source PRECHECK_MAKEUP`, `routeTo SHOP`; the auto-flow's straight-to-shop stamps and the root anchor unchanged. `type` is now the code (was the label 'Stock') |
| 8 | Setup Queue re-make | retired for stock (B6) — B's |
| 10 | RTG re-issue | B's — spec in `BRIEF_B` §B6; `INTENT.REISSUE` live |

## 3. Decisions taken this session (Stuart, via the integration session — "approvals count")

- **§8 Q1** the "plated items without a BOM core" report → **11.1** beside 🪝 (`NetSuiteSyncTab.js`, nobody's file; announce before editing). Not built yet.
- **§8 Q2** `finishOf` → the shared `finishCodeFromErp` already strips `-N` / `-10` identically; a /P row shows no finish chip and sorts with raw rows (**"yes /P is a core"**). Not swapped yet (A6). The `-N` sub-question was not understood; it only affects a comment — drop it.
- **§8 Q3** Stock Build Needs / every PO writer: **one open PO per vendor per brand, every screen appends; the SO number stays on the LINE** (per-line `soAppId`; a header `soAppIds[]` list is fine as the index). Consequence: the OE Needs coverage lookup (`loadOeNeeds`, PO header `soAppId`) moves to the line/index when A4 lands.
- **A3** the plater PO **stays with the WMS shipment** (the S5 exception, `BRIEF_D` line 30). `issuePlatedDemand` = plating demand + core-short shop WO, **no PO**. Brief and audit updated on main (`b17d772`).
- **A1** approved with the three deviations: pre-check RESULT passed in; /P and outsourced both refused; `clearConvertGate` self-release sales-only.

## 3b. Stuart's answers in this session (2026-09-02 late)

1. **Live runs**: problems get fixed on NEW orders only; the few still on the floor run through as
   they are.
2. **Q5, Order Entry stocked-length pole** (answered as a design, plan not yet approved): if the
   stocked length is in stock → straight to the floor; if not, check the longer stock the saw can
   cut it from (6 ft from 8 ft), show the recommendation in the review pop-up, and the operator
   chooses **back order** (wait for the length to arrive) or **cut the 8 ft down**. Plan sent: a
   pole choice on the review row → rod cut + `awaitingRodCut` (Snapshot mechanism) or `backOrdered`
   (waits at the pick like a bought line). Never milled.
3. **A3 approved** (no PO). **A6 approved.**
4. **A4, as Stuart wants it** (supersedes the brief's "open PO accumulates over time"):
   - per Generate press, lines group by vendor → one PO per vendor, saved **not sent** (Draft);
   - a **preview** of the whole set (5 vendors, 50 items, each PO only its vendor's lines);
   - **Approve** → push line-for-line to NetSuite (only NetSuite mints the PO#) → PO# stamps back;
   - **then** the PO can be opened and **sent to the vendor** (email, the mailto-plus-printed-doc
     the sales order uses); the record lives on **tab 10** (External Co-Op) vendor profile;
   - PO header gains a **vendor acknowledgement** (date, updated ready date, note), entered days later;
   - finishing and shop never see a PO; **the WMS will** — a **Receiving tab** is built after
     creation + send are settled (D's territory; hand-off, not built here);
   - the tier/raw generator alerts that still say "Push to Shop there" are corrected when A4
     touches those functions (Stuart: "correct").

## 3c. Alignment check with Brief B (Stuart's request, 2026-09-02 late) — all six YES

1. **Stamps**: B's `buildFinDoc` reads the parked `finPayload` verbatim (+ the board's urgent, `nsWoId`,
   holds); `buildShopDoc` reads `intent/routeTo/memo/finSiblingId/orderType`; nothing re-derived.
   B adds on the shop side: a caller-supplied shop id (the OE pair's `<woId>-C`) and the item's
   `manufacturingSpecs.shopInstruction` copied onto the shop doc (instruction text, not routing);
   `isOutsourced` from `isOutsourcedFinishCode(recipe)`, not the finish-name match.
2. **Writer 7**: Library run keeps its direct write until B sends the `buildFinDoc` hash; A converts
   the commit after.
3. **Writer 10 + PO memo**: B's to land (BRIEF_B §B6), A's to not touch.
4. **Gates**: `clearConvertGate` keeps its signature; A swaps to `isReleasable(wo)` the commit after
   B2 lands. `awaitingComponents` on stock orders: no change on B's side.
5. **A4 Approve = RTG's push**: A exports `buildPoNsPayload(po, brand)` from `Shared/purchaseOrders.js`
   producing today's payload identically except the memo (subsidiary before location, dueDate, item
   lines; the OAuth `!` path untouched — it lives in the proxy, not the payload). B's panel adopts it
   in B's own commit; `enqueueNsWrite kind:'purchaseorder'` stays RTG's.
6. **Plated work**: no A writer parks a finishing WO for an outsourced finish; B deletes the Setup
   Queue's outsourced group only after watching it stay empty. `'Sent to Plating'` /
   `customPartsReady` are B's contract, read by C and D; A reads nothing of it.

B has edited nothing yet (B5 part 1 + B2 drafted and node-tested in scratch); waiting on Stuart's
line in B's session. Session keys as of now: A = -11, B = -d6, D = -5a, E = -3e, F = -15,
integration = -46 (they re-key on restart — ListAgents before messaging).

## 4. Blocked / waiting on others

- Writer 7 on B's B1 (`buildFinDoc`). B will send the hash.
- B's B2 `isReleasable(wo)` (Shared/orderStatus): when it lands, `clearConvertGate` swaps its hand-written gate list for it (B asked; one-line change in my file).
- Live runs on Stuart.

## 5. Adjacent things named, not fixed (rule 2)

- `StockViewTab.js` `executeTierOrders` / `executeRawOrders` / `executeOrders` result alerts still say "Push to Shop there" / "release to Finishing there" — wording only; true is "RTG releases on its own". Fix when those functions are next touched (A4 touches all three).
- `StockViewTab.js` imports `enqueueNsWrite` unused (pre-existing).
- `RTGDispatchTab.js` auto-release requires its toggle ON and `createdAt >= sinceAt`; with it OFF every parked order waits for a human — B's S3 work makes it universal.
- `LibraryTab.js` `releaseRunToFloor` still writes `type: "Stock Build"` on the hq ledger doc (writer 7, waits on B).
- The OE Needs board reads PO coverage by header `soAppId` — changes with A4 (decision Q3).
- `finishedRunPrecheck.js` line 141 `no-loop-func` warning (pre-existing).

## 6. Guide (S2)

In-app `UserGuideTab.js` → Work Orders: Master Library "Raw build" path; Stock View "WO builder
(grid)", "PO builder", "RAW view"; Sales Snapshot "Made items"; "⚡ Auto-Release" paragraph; first
"Edges to know" bullet. **No repo mirror of the Work Orders guide exists** (searched; the briefs
and `Operations_Playbook.html` are not it) — the in-app JSX is the source. Say so to Stuart if a
mirror is wanted.

## 7. Next, in order

1. Live runs with Stuart (§1 rows) — before anything else lands on these writers.
2. Ask Stuart: should an Order Entry stocked-length pole line (4/6 ft, Small Parts finish) raise
   the rod cut the way the Snapshot does? Today (and before) it does not.
3. A4 `Shared/purchaseOrders.js` + `addToOpenPurchaseOrder` (S5, per-line `soAppId`), then A5
   Stock Build Needs, then A3 `Shared/platingDemand.js` (no PO), then the 11.1 BOM-core report.
4. A6 sweep (finishOf → finishCodeFromErp; one `tierOfErp`; the four routing sites).
5. Writer 7 when B1 lands.
