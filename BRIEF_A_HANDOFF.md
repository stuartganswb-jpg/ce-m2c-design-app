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

## 3d. Brief E hand-offs taken

- **`needBy`, the alias window** (E1, `eb5cb6b`): every sales-order door writes `needBy`; the older
  `needByDate` is written equal to it for one release, then stops. Order Entry Needs read the old
  name in five places and would have gone blind — `2325ff3` routes all five through one reader,
  `soNeedBy(so)` (new name first, legacy for older orders). `productionNotes` unchanged. E can close
  the window whenever the other consumers are done; nothing of A's breaks.
- **Available on the header, not yet read here**: `so.recipes[]`, `so.recipe` (when there is exactly
  one), `so.readyDate`, `so.leadWeeks` (painted 4 wk / plated 6 wk; rush 2 / 4). Candidate use: show
  `readyDate` beside need-by on the Needs board, and skip the review's finish lookup when
  `so.recipe` is set. Neither done — ask Stuart first.

## 3e. Q5 and A4 — shipped (Stuart approved in-session 2026-09-02 late)

**Q5 — a pole is cut or waited for, never milled** (`8a361aa`). `poleCut.sourcesForLength(ft)`
reads the saw's own `CUT_OPTIONS` backwards (which sticks yield this length, how many per stick,
what else the cut leaves); `cutPlanFromSource` builds the plan for the stick the operator chose.
The OE review attaches `poleChoice` to a pole/rod job whose pull is short — live stock per
candidate stick, rods needed, whether there are enough — and **withdraws** any SHOP action the
router raised for that pull. Default is BACK ORDER. A cut writes the same `rod_cut_orders` doc and
`awaitingRodCut` gate the Snapshot writes; a back order stamps `backOrdered`/`backOrderReason` and
the job waits at the WMS pick like a bought line. Only the shortfall is cut.

**A4 — the purchase order's whole life** (`ded2917`, `fc9de99`, `fb14248`). `Shared/purchaseOrders.js`
is the one writer; the six vendor helpers moved out of `StockViewTab`, so all three paths get the
subsidiary check, vendor-by-nsId, `source`, and the vendor minimum.
- **Create**: `createDraftPurchaseOrders` groups a press by vendor → one **Draft** PO each. The SO
  number stays **on the line**; the header lists the distinct ones (`soAppIds`/`soRefs`). Two demands
  for one code from one SO merge; from different orders they stay apart.
- **Preview**: every PO, lines, total, subsidiary warning, vendor minimum. "Leave as drafts" is a
  real answer — the Stock View toolbar keeps a live 🧾 draft count that reopens the same preview.
- **Approve**: `approvePurchaseOrder` pushes every line through the existing outbox using
  `buildPoNsPayload` (today's payload exactly; only the memo changed). NetSuite mints the number and
  it stamps back. A line with no NetSuite item id refuses the whole PO.
- **Send / Ack**: on the vendor's card in tab 10 — now ONE list of every PO for that vendor (E asked
  for one list, not a second). Send is refused until the NetSuite number exists. The acknowledgement
  is header-level: vendor's order #, **`vendorReadyDate`** (deliberately not `readyDate` — E's
  sales-order header promises that to the *customer*), note, who and when.
- **Not built, by decision**: the plater PO stays with the WMS weekly shipment (kind `plating` keeps
  its own actions on the same card, no approve/send offered). **Receiving is Brief D's** — the WMS
  Receiving tab reads `items[].received`, `vendorAck`, `soAppIds`.

**Also**: the tier/raw/finished generator alerts no longer name buttons that are gone (Stuart:
"correct") — 8 strings, no logic. The User Guide gains "How a purchase order goes out" (S2).

## 3f. Open design question — the receipt shape (Brief D asked, 2026-09-02)

D will build the WMS **Receiving tab** for vendor POs when Stuart calls it, and asked for two
fields to be settled in `Shared/purchaseOrders.js` (A's file) rather than retrofitted:

1. **per-line `receivedAt` / `receivedBy`** beside `received` — the floor needs to know who took a
   delivery in;
2. **somewhere for a SHORT or OVER receipt.** The plating flow gained `scrapQty` for this, but a
   short on an ordinary PO is usually a **backorder, not scrap**, so D's own view is that it wants a
   different name.

**Not written.** Stuart's instruction was explicit: *"we will need to build the 'receiving tab' to
receive these po's, we can do that after we have finalized the creation and send."* Fields nobody
writes yet are dead schema, and the second one is a real decision (does a short close the line, or
leave it open against the vendor's acknowledged ready date?) that belongs with the tab it serves.
Both requirements are recorded here so whoever builds it starts from them; the writer stays A's.

## 3g. THE WOOD ROUTING FINDING — observed live 2026-09-03, accepted for these orders

**Stuart's rule** (second pass, verbatim): *"wood + miter → Custom, wood + straight → finishing is
perfect. there will never be miter or custom bends/french returns on order entry, those will always
come from cpq. so wood from order entry right to finishing. metal from order entry follows same
rules as cpq."* Metal was already correct and is untouched throughout.

**It does not hold today, and not for the reason first suspected.** Brief D read
`Shared/lineClassification.classifyLine` correctly — `const partLevel = …partHandling; if
(partLevel) return partLevel;` fires BEFORE the per-line flag, so an item tag short-circuits any
line-level escalation. D's hypothesis was that wood rods were tagged Small Parts, blocking miters.
**Checked in the live app instead of guessing** (Master Library cards, two of five opened):

- Wood poles exist ONLY as raw rods — `H1-138WHTOAK` (by foot), `-4`, `-6`, `-8`, `-10`. There is
  **no stained variant item at all** (no `/S04`, no `/S11`), so a stained wood line resolves to the
  RAW rod.
- `H1-138WHTOAK-6` (1-3/8" × 72", the length on tonight's orders) and `H1-138WHTOAK` both read
  **PART HANDLING = Custom**, PROD TYPE POLE, FINISH STREAM POLES. That tag is *correct* per the
  settled rule (a mill code with no suffix is made-to-order) and `handlingForErp` produces it for
  all five identically.

**So every wood pole line goes to the SHOP — straight ones included.** Observed live: H1-138 #1
(NATURAL OAK 72" ×2) and #2 (PURE OAK 72" ×2). The miter half stays hypothetical; the straight half
is real and was seen on these orders.

**Both obvious fixes are wrong**, which is why nothing was changed:
- *Tag the rods Small Parts* → straight wood reaches finishing, but a mitered wood line could then
  NEVER escalate, because any tag short-circuits the line flag.
- *Untag them* → the line decides, but that needs the flow step to stamp handling, and letting a
  line-level Custom beat an item tag is exactly what Stuart banned 2026-07-28 (the flow generator
  stamped every bracket step 'Custom', dragging brackets/backplates to the shop and starving the
  finishing pick list — the comment at `lineClassification` §1 records it).

**The shape that satisfies both rules:** escalate on the CUT itself — the miter signal that already
exists on a CPQ order (`fabMethod` / `qtyMiters` / `qtyMiterReturns`, built by RTG's split from
Vision's `engData.shape === 'MITERED'`) — rather than on a generic handling stamp. A mitered line
goes to the shop because it needs sawing, not because something tagged it. Touches E
(`classifyLine`), B (the split) and C (owns `RodPieceInventory`/`rodPieces`, which already read
`fabMethod`). **A's part is the finding only; the change is not A's to make.**

**STATUS: accepted, not fixed.** Stuart, relayed 2026-09-03: *"enter all 4, shop is fine for this
time, just enter these, the team is actually going to do the work on the floor for them as actual
orders."* These are REAL customer orders — they post to NetSuite and the floor physically builds
them. So: **do NOT retag the wood rods and do NOT ship a handlingForErp/classifyLine change while
these orders are in flight** — rerouting work already on the floor is worse than the fault. If he
later approves the design, ask explicitly whether he means after these four are built.

## 3h. RTG MUST SEE EVERY PO — the defect A4 introduced, and the agreed fix

**Stuart, relayed 2026-09-03, binding on every brief:** *"no matter from cpq or order entry, i want
all orders routed thru RTG then on to where they belong … EVERY ORDER via RTG always hard rule, it
can 'auto send' to the operator they do not need to go to rtg to release any more, but it needs to
go there as master single source control of all."* Auto-release stays OFF until orders stop turning
up on floor tabs RTG never saw.

**The defect, mine, introduced tonight by A4.** The board finds POs with
`RTGDispatchTab :294 -> where("status","==","Approved")` and there is **no live PO mirror** (the
`mk()` snapshots cover hq_sales_orders / hq_work_orders / shop_custom_orders / fin_workorders only,
`:329`). Before A4 a PO was born `Approved`, so it appeared immediately. After A4 it is born
`Draft` and approval sets `Queued to NetSuite` -> `Pushed to NetSuite` -> `Sent to Vendor`: it
**never passes through `Approved` at all**, so a Stock View PO is invisible to RTG for its entire
life. Same failure as the Order Entry sales orders D found, opposite direction - not "never
arrives" but "stops being seen at the moment it becomes real".

A's other writers pass: `parkWorkOrder` and `executeMakeupActions` stamp `Approved`/`Dispatched`
with `brand`, so they hit both the board query and `liveWO`; `issuePlatedDemand` writes a
`plating_demand` that RTG already mirrors (`mkB`), and its core-short order is an ordinary visible WO.

**FIX BELONGS IN THE QUERY, NOT IN WHAT THE WRITERS STAMP.** Draft-vs-Approved is the distinction
Stuart designed ("the po is saved but not yet sent ... after review and approval po is sent");
flattening it to satisfy a reader destroys real information. And the board should not hard-code a
status list at all - three collections with three hand-written predicates is how this drifted, and
a fourth would be the same mistake with a newer date. `Shared/purchaseOrders.js` owns the
vocabulary, so it exports the predicate and the board calls it - the same move B made with
`isReleasable`.

**The verified catalogue** (swept by D, re-verified independently here - every literal written to
`hq_purchase_orders`):

| status | written at | note |
|---|---|---|
| `Draft` | `purchaseOrders` createDraftPurchaseOrders | A4 |
| `Approved` | legacy - pre-A4 POs still carry it; it is what the board queries | **must stay in the vocabulary** |
| `Queued to NetSuite` | `purchaseOrders` approve; `RTGDispatchTab :275` **as a bare literal** | |
| `Pushed to NetSuite` | outbox writeBack; `RTGDispatchTab :273` **as a bare literal** | |
| `Sent to Vendor` | `purchaseOrders` markPoSent | |
| `Sent to Plater` | `PickPackApp :2360` - D's weekly shipment creates AND sends in one act, legitimately skipping Draft/Approved | |
| `Partially Received` | `ExternalCoopTab :1187` | **open - this is the one people chase** |
| `Received` | `ExternalCoopTab :1187` | terminal for the board |
| `Closed` | `ExternalCoopTab :660`, `orderLifecycle :113` | terminal |
| `Deleted` | soft delete, filtered at `ExternalCoopTab :867` | terminal |

(`ExternalCoopTab :936` also writes `Approved` but to **hq_sales_orders** - not a PO status, do not
add it.)

**The work, in order, AFTER the run - nothing tonight (freeze, real orders, B mid-edit in that file):**
1. **A** extends `PO_STATUS` to describe what the collection actually contains (the ten above, not
   the five A4 invented) and exports `isOpenPo(po)` / `PO_OPEN_STATUSES`. Open = everything except
   `Received`, `Closed`, `Deleted` (and `po.deleted`). A sends D and B the hash.
2. **D** maps `'Sent to Plater'` onto the shared vocabulary (their change; visible consequences are
   the External Co-Op card wording and that it applies to future plating POs only).
3. **B** swaps the board: `poQuery` uses `isOpenPo` instead of `status == 'Approved'`, adds a live
   PO mirror beside the other four so a PO appears without pressing Refresh, and replaces the two
   bare literals at `RTGDispatchTab :273/:275` with `PO_STATUS` - same values today, free to drift
   tomorrow.

## 3i. NEW REQUIREMENT — stocked EP routing + the Backorder window (Stuart, 2026-09-03, relayed)

*"EP finishes since they are outsourced we often have them in stock, so the proper address is to
first check stock at time of push from RTG (once it becomes a firm sales order) if the items are in
stock it is routed right to wms pick. if the items are not in stock it needs to be routed to stock
view 12.5 we need to add a new window of Backorder items on the sales snapshot that filters to show
any backordered items that do not yet have work orders or purchase orders to cover the needed qty."*

**It corrects an assumption A3 shipped.** `routeForCode` refuses an EP/MEP/P25 code as a work order
and Order Entry's outsourced branch diverts every such line to a plating demand, unconditionally.
That is right for REPLENISHMENT (short of plated stock at the Snapshot) and WRONG for a SALES line:
a stocked EP item goes straight to WMS pick. Two different moments; A3 conflated them. The fix is a
condition at the sales moment, not a change to `routeForCode`.

**Which reader — SETTLED with D and B, 2026-09-03.** Target: a new `Shared/stockAvailability.js`
consolidating the THREE near-duplicate availability queries that exist today —
`StockViewTab :281` (rich: onhand + available + onorder + committed + backordered, NOT chunked),
`StockViewTab :924` (chunked in 200s by nsId, available ONLY), and
`Shared/oeReviewPlan.fetchAvailabilityUnits` (by code, available + onorder + the stock UNIT, with a
plain-query fallback). One function keyed by code OR nsId, returning available + onHand + committed
+ onOrder + unit, chunked — the three proven parts, **no new SQL**. `fetchAvailabilityUnits`
delegates so no existing caller moves. **A writes it; B calls it.**

*Why onHand and committed beside available:* `available` is net of ALL commitment, so a stale open
SO depresses it (see bucket 3). Without on-hand and committed the window cannot tell "0 available,
0 on hand" (make or buy) from "0 available, 5 on hand, committed to a stale SO" (close that order,
make nothing) — opposite actions.

*Why the unit:* HTAEC35 counts in PAIRS; comparing eaches to pairs is the phantom-168 that caused
the review gate to exist.

**B IS NOT BLOCKED ON THIS.** If B5 part 2 is ordered first, B calls `fetchAvailabilityUnits` as it
stands — `available` already answers the push's question correctly. The extraction is purely
additive; B's call site does not change when it lands.

**Two per-code precisions** (agreed with B, easy to conflate): `unitsKnown === false` is BATCH-level
— `BUILTIN.DF(Item.stockunit)` was refused so units are null for the whole pull → "cannot be
answered *for this pull*", **retry, never a backorder**. The per-CODE test is `!(code in map)` → no
inventory row → data fix. A code present with `unit: null` blocks a confident pick with its own
message. Three different states, three different messages.

**Original note (superseded above, kept for the reasoning):** `Shared/oeReviewPlan.fetchAvailabilityUnits` — Item ⋈
AggregateItemLocation, `quantityavailable` + `quantityonorder` + the stock UNIT, with a plain-query
fallback. It answers *how many can I promise*. D's `fetchLiveBins` (InventoryBalance ⋈ Bin) answers
*which bin holds them* — the pick's question, after the decision. Unit-awareness settles it on its
own: HTAEC35 counts in PAIRS and comparing eaches to pairs is the phantom-168 bug. **Do not write a
third stock reader.**

**Observe, do not reserve** (agreed with D; still Stuart's to confirm). `quantityavailable` is
on-hand MINUS committed, and a posted SO commits its lines, so SO #2 does not see SO #1's stock. Run
the check strictly AFTER the order has its `nsInternalId` — RTG's auto-split already waits for it
(`!o.appCreated || o.nsInternalId`). An app-side reservation would be a fourth source of truth about
committed stock. The short path already exists if an observation goes stale
(`PickPackApp.routeShortToPlating`).

**THE WINDOW HAS THREE BUCKETS, NOT ONE LIST.** "In stock or not" is not two-state:

1. **Uncovered demand** — actionable here, raise the WO or PO.
2. **Cannot be answered** — `Shared/pickOrder.isDataProblem(state)`: `UNKNOWN_LIBRARY` /
   `NO_NETSUITE_LINK` / `NO_STOCK_RECORD`. Actionable by someone else (fix the item), shown by NAME
   not quantity. **Must be visibly separate**: the window's filter is "not covered by a WO or PO", so
   a data fault can never leave it and would read as permanent backlog — the Sandra/HCUSR1-EA bug,
   chasing a stray record as a shortage no amount of making rings could fix.
3. **On the shelf but committed elsewhere** (D's counter-case, found live tonight): available nets
   committed, so a STALE OPEN SO permanently depresses it. Two Fabricut Order Entry orders from
   **2026-08-14** — `QS-1786738589252` (23 pcs traverse components) and `QS-1786734991717` (**0 pcs,
   an empty save**) — are still status `Pending`, which is what the outbox writeBack stamps when
   NetSuite ACCEPTS. So they are real open NetSuite sales orders committing stock for three weeks.
   Under the new rule that makes genuinely stocked items read unavailable and land in this window as
   demand nothing covers, when the truth is an order nobody closed.
   → **the reader must also return `quantityonhand`**, so "0 available but 5 on hand" is
   distinguishable from "0 available and 0 on hand" and can say *committed to SO … since 14 Aug*.
   The honest fix is upstream: close or ship those orders. **Raised to Stuart as its own item**; the
   0-pcs one is an empty order that arguably should never have posted.

**THE ORDER OF THE TEST MATTERS — `codeHealth` DOES NOT DETECT A SHORTAGE** (D's correction to an
earlier phrasing of mine, verified at `Shared/pickOrder.js:103`). It takes **no quantity** and never
compares need to on-hand: its `OK` branch is only for blank/`PENDING`/`N/A` codes, so a healthy code
with 500 on the shelf returns `OUT_OF_STOCK` exactly like a code short by 2 of 5. It classifies
*why there is nothing*, presupposing a shortage — it does not find one. So filtering the window on
`state === 'OUT_OF_STOCK'` would be doubly wrong: it admits every healthy code, and it cannot see a
partially covered line, which is not a distinct state but a positive remainder on a code whose state
reads identically to a total shortage. The composition is, strictly in this order:

1. **Arithmetic decides membership** — `remainder = needed − (on-hand + open WO qty + PO qty not yet
   received)`. `remainder > 0`, or the line is not on the window at all.
2. **`codeHealth` explains it** — on those lines only, as a label.
3. **`isDataProblem(state)` buckets it** — true → bucket 2, everything else short → bucket 1.

Quantity is the membership test; health is only the label.

**Partial coverage is a QUANTITY, not a state:** needed − (on-hand + open WO qty + PO qty **not yet
received**). For a PO the covering figure is `quantity − received`, so a PO for 5 that returned 4
with 1 scrapped leaves 1 uncovered and must reappear — reading header status instead would hide the
scrapped piece forever (D's catch; `receivedQty`/`scrapQty` are per line since their receiving work).

**One shared covering function** for this window AND A5's Stock Build Needs board — same shape, same
traps, and two subtly different versions is how tonight's whole class of bug starts.

**A known fault of mine that must NOT be inherited.** `finishedGoodsRun.stockCheckReport` computes
`have = known ? avail : 0`, so a code with no NetSuite row is treated as a genuine zero and
`planMakeupActions` will plan a SHOP WO or BUY_NOTE for it. It is mitigated, not silent — the row
carries `known:false`, renders "(no NetSuite stock row)", and every caller sits behind the review
gate where a person approves it. The Backorder window has **no such gate**, so it must classify with
`codeHealth` instead. Fixing `stockCheckReport` to stop calling unknown a zero is a behaviour change
to a gated path → goes to Stuart as a proposal, never a silent tidy.

## 3j. Approved-but-unbuilt, agreed across sessions 2026-09-03 (nothing started)

**`awaitingReceipt` — a new gate. A sets and clears it; B reads it; D triggers the clear.**
Stuart approved (relayed): a sales order's bought BOTH raw part parks its work order until the PO
is received. Field names follow the existing pattern (`awaiting<Thing>` / `<thing>Id(s)` /
`<thing>Note`):

    awaitingReceipt: true
    receiptRefs: [{ poId, itemId, qtyNeeded }]     // + a flattened receiptPoIds for array-contains
    receiptGateNote: "12 x H1-75DS on PO-1044 (Dayton Grey)"

Two shape decisions taken deliberately, both cheap now and a migration later:
- **ARRAY, not a scalar `receiptPoId`.** A WO can wait on more than one PO — `planMakeupActions`
  emits a BUY_NOTE per short component, and two bought shorts from two vendors are two POs.
  `awaitingComponents`/`componentShopWoIds` is the plural precedent. A scalar would silently drop
  the second PO and release the order with half its material.
- **IT CARRIES THE QUANTITY.** Clearing on "the PO was received" is wrong: a PO for 12 arriving as 5
  does not make the order runnable. The gate clears only when received covers `qtyNeeded` — the same
  covering arithmetic as the Backorder window, and the same reason we read `quantity − received`
  rather than header status. Partial receipt keeps it closed and says "5 of 12 arrived".

A exports the clearer, D calls it — the WMS must never write `hq_work_orders`, symmetric with the
rule that A never writes from the WMS side:

    clearReceiptGate({ poId, itemId, receivedQty, operatorName }) -> 'released' | 'cleared' | false

B's GATES entry: `open: (wo) => !!wo.awaitingReceipt`, detail from `receiptGateNote`, and `clearedBy`
worded as *"the WMS receiving tab recording enough received quantity to cover the line
(clearReceiptGate)"* — **not** "the PO being received", because those differ and the difference is
the bug.

**Open POs — TWO things, not one, and the RTG half is not optional.** Stuart: *"we can have an open
po button just like the open wo button to review."* The Open WOs button he means is A's
(`StockViewTab :2573`), so:
- **A builds the twin** in Stock View: every PO `isOpenPo` calls open, with vendor, lines, ordered vs
  received, NetSuite PO #, the vendor acknowledgement and ready date, and PO-appropriate repair
  actions. A cleanup/review tool — where you go to find what is STUCK.
- **B swaps the RTG PO panel to `isOpenPo` + adds a live PO mirror.** This is NOT the same
  requirement: it is the fix for §3h, required by *"EVERY ORDER via RTG always … master single
  source control of all"*. **B must not hold it waiting on A's twin** — the defect is live now.
- The distinction: RTG is where an order is SEEN AND CONTROLLED for its whole life, every order every
  door; the Stock View panel shows only what needs attention. Different questions, different
  lifespans, no duplication.
- **Flagged to Stuart** in case he meant only one of them — but neither reading makes the RTG fix
  optional.

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
