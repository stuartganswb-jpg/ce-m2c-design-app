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
| (next) | `UserGuideTab.js` Work Orders section updated (S2) — see §6. | — |

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
| 5 | Order Entry Needs | **not started** — `intent ORDER_ENTRY` with the `sales` block, FLOW1/FLOW2 anchors, the Custom sibling pair. `buildParkedWorkOrder` is stock-only today; the sales block (customer, soAppId, orderClass, awaitingNsWo, awaitingSoAccept, the `-C` shop sibling with `finSiblingId`) is the next extension |
| 7 | Library `releaseRunToFloor` | **waiting on B's `buildFinDoc`** (B1). Do not build around it |
| 9 | pre-check component shop WO | **not started** — `COMPONENT_MILL`; needs a cycle-free shape (`finishedRunPrecheck` ↔ `workOrderCreate` import both ways); cleanest is `executeMakeupActions` calling `buildParkedWorkOrder` (pure, from `stockRun`) rather than `parkWorkOrder` |
| 8 | Setup Queue re-make | retired for stock (B6) — B's |
| 10 | RTG re-issue | B's — spec in `BRIEF_B` §B6; `INTENT.REISSUE` live |

## 3. Decisions taken this session (Stuart, via the integration session — "approvals count")

- **§8 Q1** the "plated items without a BOM core" report → **11.1** beside 🪝 (`NetSuiteSyncTab.js`, nobody's file; announce before editing). Not built yet.
- **§8 Q2** `finishOf` → the shared `finishCodeFromErp` already strips `-N` / `-10` identically; a /P row shows no finish chip and sorts with raw rows (**"yes /P is a core"**). Not swapped yet (A6). The `-N` sub-question was not understood; it only affects a comment — drop it.
- **§8 Q3** Stock Build Needs / every PO writer: **one open PO per vendor per brand, every screen appends; the SO number stays on the LINE** (per-line `soAppId`; a header `soAppIds[]` list is fine as the index). Consequence: the OE Needs coverage lookup (`loadOeNeeds`, PO header `soAppId`) moves to the line/index when A4 lands.
- **A3** the plater PO **stays with the WMS shipment** (the S5 exception, `BRIEF_D` line 30). `issuePlatedDemand` = plating demand + core-short shop WO, **no PO**. Brief and audit updated on main (`b17d772`).
- **A1** approved with the three deviations: pre-check RESULT passed in; /P and outsourced both refused; `clearConvertGate` self-release sales-only.

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
2. Writer 5 (Order Entry Needs): extend `buildParkedWorkOrder` with the sales block; convert;
   regression row in §6 (`HCUMP810 + /N90` and `/P01`, the pair as b531f53).
3. Writer 9 (`COMPONENT_MILL`, pure builder to avoid the import cycle).
4. A4 `Shared/purchaseOrders.js` + `addToOpenPurchaseOrder` (S5, per-line `soAppId`), then A5
   Stock Build Needs, then A3 `Shared/platingDemand.js` (no PO), then the 11.1 BOM-core report.
5. A6 sweep (finishOf → finishCodeFromErp; one `tierOfErp`; the four routing sites).
6. Writer 7 when B1 lands.
