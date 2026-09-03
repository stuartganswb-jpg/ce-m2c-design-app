# System flow audit — lead-integration pass, 2026-09-01

*Read-only. Nothing changed. Every claim below carries a `file:line`; where I could not verify
something from the code (deploy state, live data, NetSuite), it is written as a question, not a
fact. Written to be the base document the six specialist briefs are cut from.*

**Method.** Enumerated every writer of every order collection, every release path to a floor,
every gate that parks an order and every code path that clears it, every NetSuite write and every
NetSuite close, and what each floor screen filters on. Then read each writer's *shape* and compared.
165 commits landed since 08-25 across four sessions; the churn map is in §12.

---

## 1. The spine, as it actually exists

```
                 SALES ENTRY                                    STOCK ENTRY
   CPQ ──► jobs ──► hq_sales_orders (appCreated)      Stock View grid ─┐
   Vision ─► cpq_drafts ─► CPQ (same path)             Sales Snapshot ──┤
   Portal ─► jobs PORTAL_REQUEST ─► CPQ (same path)    Raw Cores ───────┼─► hq_work_orders
   Order Entry (tab 7) ─► hq_sales_orders QUICKSHIP    Master Library ──┤      (parked, gated)
        └─ to-be-finished lines ─► Order Entry Needs ──┘  Scrap re-make ─┤
                                                        Pre-check make-up┘
                                    │                          │
                                    ▼                          ▼
                              ┌─────────── RTG DISPATCH (13) ───────────┐
                              │  autoSplitSalesOrder   pushToFinishing  │
                              │  (sales → both floors) pushToShop       │
                              │  + 4 gates + auto-release effect        │
                              └────────┬───────────────────┬────────────┘
                                       ▼                   ▼
                              fin_workorders       shop_custom_orders
                              (Setup Queue →       (Custom Fab / Milling)
                               Active Floor)              │ START releases sibling pick
                                       │                   │ COMPLETE mirrors customFabStatus
                                       ▼                   ▼
                              WMS pick ◄── sentToPickPack ──┘   WMS convert / rod cuts / plating
                                       │                        clear their gates back on hq_work_orders
                                       ▼
                              WMS pack ─► putawayBin ─► onStockBuildDone (server) ─► ns_outbox
                                                                                        │
   EVERY NetSuite write ───────────────────────────────────────────────────────────► ns_outbox
   (SO, estimate, PO, WO, build, fulfilment, adjustment)          worker every 1 min, idempotent,
                                                                   writeBack of ids onto the source doc
```

Three things are genuinely singular and should be defended as such:

| singular | where | note |
|---|---|---|
| NetSuite write path | `Shared/nsOutbox.enqueueNsWrite` → `functions/index.js:429 nsOutboxWorker` | idempotent by memo marker, retried, ids write back. Good. |
| Finishing → NetSuite inventory post | `functions/index.js:564 onStockBuildDone` | fires at **pack putaway**, requires `orderType === 'stock'` **and** `nsWoId`. See §8 — the sales-typed exclusion is a hole. |
| Order close | `Shared/orderLifecycle.closeEverywhere` | called from RTG, Setup Queue, Stock View, Shop, CRM. Good. |

Everything else that *should* be singular is not. That is the rest of this document.

---

## 2. Work-order creation — ten writers, ten shapes

Every `setDoc` to `hq_work_orders` that creates a new order. Read across the row and the "varying
process" is visible: the same intent — *make N of item X* — is expressed ten ways.

| # | screen / path | file:line | `source` | `routeTo` | finPayload | gates | NS anchor | orderType | recipe |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Stock View WO grid** | `StockViewTab.js` `pushWOsToDispatch` → **`parkWorkOrder`** (7c70a8d) | `STOCKVIEW_GRID` | stated: FINISHING / SHOP; /P → convert to-do; outsourced → refused | **yes** (builder) | pre-check + rod cut + components | at release (Route A) / SHOP at creation | stock | from the code |
| 2 | Stock View plating base-short milling | `StockViewTab.js` PO builder (b) → **`parkWorkOrder`** (A1 step 3) | `STOCKVIEW_PO_BUILDER` | `SHOP` + `forPlating` | n/a | none | at creation (root) | stock | none |
| 3 | **Sales Snapshot** | `StockViewTab.js` `createStockFinWOs` → **`parkWorkOrder`** (b6d0e36) | `SALES_SNAPSHOT` | stated: FINISHING / SHOP (raw rows no longer route-open); outsourced → refused | **yes** (builder) | rod cut + pre-check + components | at release (Route A) / SHOP at creation | stock | from the code |
| 4 | Raw Cores | `StockViewTab.js` `createStockShopWOs` → **`parkWorkOrder`** (A1 step 3) | `RAW_CORES` | `SHOP` | n/a | none | at creation (root) | stock | none |
| 5 | **Order Entry Needs** (live OE) | `StockViewTab.js` `executeOeReview` → **`parkWorkOrder`** (A1 step 4; anchors + direct release stay in the executor) | `ORDER_ENTRY` | `FINISHING` (+`SHOP` sibling when Custom) | **yes** (builder) | soAccept · nsWo · convert · components | at creation: FLOW2 on the variant, FLOW1 on the base assembly (executor) | **sales** (now on both halves) | `finish` |
| 6 | **Master Library** card `createStockBuildWO` | `LibraryTab.js` → **`parkWorkOrder`** (A1 step 3) | `LIBRARY_MAKEUP` | `SHOP` (always raw here; finished codes are refused) | n/a | none | at creation (root) | stock | none |
| 7 | Master Library `releaseRunToFloor` | `LibraryTab.js:1122` | — | writes hq **already Dispatched** + fin **directly** | n/a | own pre-check | own `enqueueNsWrite` (`:1300`) | stock | `recipe \|\| finishLabel \|\| PENDING` |
| 8 | Setup Queue scrap re-make | `SetupQueue.js:508` | `SETUP_QUEUE_REMAKE` | `FINISHING` | yes | pre-check | at release | stock | `finishCodeFromErp` |
| 9 | Pre-check make-up (component shop WO) | `finishedRunPrecheck.js` `executeMakeupActions` → **`buildParkedWorkOrder`** (A1 step 5) | `PRECHECK_MAKEUP` | `SHOP` | n/a | — | at creation (root WO) | stock | none |
| 10 | RTG balance re-issue | `RTGDispatchTab.js:1958` | `RTG_REISSUE` | **none (route-open)** | no | none | none | — | parent's |
| ✗ | tab 7's own generator | `QuickShipTab.js:1680` | — | — | — | — | — | — | **dead** (`OE_SAVE_AUTOFIRE_RETIRED = true`, `:1541`) |

> **State 2026-09-02 evening (Brief A, A1 in flight):** writers 1, 2, 3, 4 and 6 now call the one
> writer, `Shared/workOrderCreate.parkWorkOrder` (shape: `Shared/stockRun.buildParkedWorkOrder`,
> node-tested). Every doc they write carries `source`, a stated `routeTo`, `orderType 'stock'`,
> `autoFlow true`, `type` = the item code, and a complete `finPayload` on a finishing route.
> Route-open parking is gone from those five. Also 5 (A1 step 4) and 9 (A1 step 5). Still to convert: 7 (the Library run — waits on B's
> builder). 8 is retired for stock (B6); 10 is B's, spec'd in BRIEF_B §B6 (INTENT.REISSUE).

What the table says:

- **Two models of release coexist.** "Pre-build the complete finishing doc and park it" (3, 5, 8 —
  `finPayload`, copied verbatim at release) versus "park a thin record and enrich at release" (1, 6,
  10 — RTG's `fetchEnrichedJobData` + library lookups). Both work; they diverge every time a field
  is added to one. The pole-count bug, the PENDING-RECIPE bug and the missing-`type` bug were each
  a field present in one model and absent in the other.
- **Three writers park route-open with a finished item** (2, 6, 10): no `routeTo`, no `finPayload`.
  RTG's auto-release (`RTGDispatchTab.js:352`) only fires on `finPayload || routeTo`, so these always
  wait for a human — *and* RTG offers **Push to Shop** on them (`:2612`, `wo.routeTo !== 'FINISHING'`).
  Eric's "erroneous Push to Shop button" (08-25) was fixed on the grid (`:753`) and nowhere else.
  A Master Library make-up of `H1-138BF/EP1` still advertises a route into milling today.
- **Writers 1 and 2 stamp no `source`.** The board, the deletion ledger and the transmit log
  cannot say where those orders came from.
- **Writer 7 is a second release implementation** living outside RTG (deliberate, Stuart 08-03,
  "skip the extra step") — see §4.
- **The NetSuite anchor happens at four different moments**: at creation (4, 6, 9, 5), at release
  (1, 3, 8), by its own outbox call (7), never (2, 10). §8.

---

## 3. Purchase-order creation — three writers, one push

| writer | file:line | vendor resolution | `source` | subsidiary check | SO link |
|---|---|---|---|---|---|
| Stock View PO builder | `StockViewTab.js:609` | name → `crm_records` | **none** | **no** | no |
| Sales Snapshot | `StockViewTab.js:1681` | name → `crm_records` | `SALES_SNAPSHOT` | **yes** (`vendorSubsidiaryGap`) | no |
| Order Entry review | `StockViewTab.js:2511` | name **or** `consensusVendorNsId` | **none** | **no** | `soAppId`, `soRef` |

One push path — good: `RTGDispatchTab.js:244` via `enqueueNsWrite kind:'purchaseorder'`, subsidiary
before location (Eric's rule), dueDate from reqDate. Two hygiene faults: the memo is hard-coded
`"Stock replenishment … (Sales Snapshot)"` for every PO including Order Entry component buys
(`:268`); and only the Snapshot path warns about a vendor not assigned to the buying subsidiary — the
other two will push and get NetSuite's misleading "Invalid Field Value … location" refusal.

`finishedRunPrecheck` deliberately never invents a PO (`BUY_NOTE`, `:233`). Correct — the PO decision
belongs to a person. But it means a bought component short on a Stock View grid order produces a
*note in a log line* and nothing else; there is no "needs a PO" board for stock builds the way Order
Entry Needs is for sales.

---

## 4. Release to the floors — six implementations of two operations

This is the mechanism behind "the fix has been breaking elsewhere." A field added to one release
path has to be added to the others by hand, and there is no test or shared builder that says so.

**Finishing release (`hq_* → fin_workorders`) — four:**

| path | file:line | copies finPayload | merges `urgent` | stamps `nsWoId` on fin | queues NS WO | honours holds |
|---|---|---|---|---|---|---|
| `pushToFinishing` verbatim branch | `RTGDispatchTab.js:1381` | yes | **yes** | via outbox writeBack later | yes (Route A) | via gates |
| `pushToFinishing` enrich branch | `RTGDispatchTab.js:1408` | builds it | yes | via writeBack | yes (stock only) | via gates |
| `releaseFinWoToFloor` (OE auto-flow, convert-complete) | `finishedRunPrecheck.js:310` | yes | **no** | **yes, directly** | no (sales-typed by design) | checks 4 gates itself (`:341`) |
| `releaseRunToFloor` (Master Library) | `LibraryTab.js:1119` | builds it | ? | own outbox call | own | own pre-check |

**Shop release (`hq_* → shop_custom_orders`) — two:**

| path | file:line | category | siblings |
|---|---|---|---|
| `pushToShop` | `RTGDispatchTab.js:1567` | `CUSTOM_FAB` or `MILLING` by `orderType` (fixed 3f6a953) | passed through (fixed 3f6a953) |
| `executeMakeupActions` `dispatchShop` | `finishedRunPrecheck.js:259` | always `MILLING` | always null (correct for component WOs) |

Plus `autoSplitSalesOrder` (`RTGDispatchTab.js:1000`), which writes *both* floor docs directly for a
CPQ sales order — the reference shape everything else copies by hand.

The four finishing copiers already disagree: the two verbatim ones each carry one field the other
does not (`urgent` vs `nsWoId`). Nothing is broken by that *today*; it is the shape of the next
bug.

---

## 5. The gates — what parks an order, and who lifts it

| gate on `hq_work_orders` | set by | cleared by | auto-releases after? |
|---|---|---|---|
| `awaitingRodCut` | Snapshot `:1493` | WMS rod cut complete `PickPackApp.js:1848` | no — human release (label prints at the saw) |
| `awaitingConvert` | pre-check `gateFields` | WMS convert complete → `clearConvertGate` `finishedRunPrecheck.js:330`; or demand deleted `PickPackApp.js:2825` | **yes if `autoFlow`/ORDER_ENTRY**, else human |
| `awaitingComponents` | pre-check (`componentShopWoIds`) | RTG live effect `RTGDispatchTab.js:402` when every component shop WO is done | yes via auto-release effect |
| `awaitingSoAccept` | Order Entry | outbox writeBack when NetSuite accepts the SO | yes |
| `awaitingNsWo && !nsWoId` | Order Entry FLOW2 | outbox writeBack stamps `nsWoId` | yes |
| route-open (no `routeTo`, no `finPayload`) | writers 2, 6, 10 | a human pressing a button | **never** |

The auto-release effect (`:345-375`) evaluates all of these on every live snapshot. It is sound. The
gap is that three writers never enter it (route-open), and that the gate set is checked in **three
places** with three hand-written condition lists: the effect (`:350`), `pushToFinishing`'s auto
branch (`:1350`), and `clearConvertGate` (`:341`). They agree today.

---

## 6. Sales entry — four doors, two shapes

| door | writes | line dialect | reaches the floor via |
|---|---|---|---|
| **CPQ** (8) | `jobs` (`cpqData.breakdown[]`, `cartItems[]`, `engineeringNotes`) → `hq_sales_orders` `appCreated` (`CPQTab.js:3010`) | breakdown: `name qty price total partHandling partId legacyErpId cutLength dimensions finishCode isFee hidden` | outbox SO → `nsInternalId` writeBack → `autoSplitSalesOrder` |
| **Vision** (9) | `cpq_drafts` with `specs.engineeringNotes` (full cut sheet) | — | CPQ reads the draft (`visionBridge.js:87`, `CPQTab.js:862`) → same as CPQ |
| **Portal** | `jobs` `PORTAL_REQUEST` (no breakdown, by design) → staff price in CPQ → approve `ExternalCoopTab.js:903` | same as CPQ once priced | same as CPQ |
| **Order Entry** (7) | `hq_sales_orders` `orderClass:'QUICKSHIP'` with `lines[]` (`QuickShipTab.js:1446`) | `erp aliasErp qty eachQty packs packUom finishCode toBeFinished perFoot feetPer note memo kit` | stocked lines → **WMS pick directly** (`PickPackApp.js:286`); to-be-finished lines → **Order Entry Needs** → writer #5 |

So CPQ / Vision / Portal converge on one spine — that part is right. **Order Entry is a second
spine**: its own SO shape, its own line dialect, its own release path, and it never passes through
`autoSplitSalesOrder` or `classifyLine`. The WMS reads both dialects (`c435d6d`, "Pull lines read
both partsList dialects"). The customer documents were aligned at print time (`61a62b1`), but the
stored header fields differ: CPQ `poNumber / shippingAddressId / customShippingAddress /
shippingAmount / orderSidemark`; Order Entry `customerPo / shipTo[] / needByDate / productionNotes /
sidemark`. RTG reads `so.reqDate` for a CPQ order and `so.needByDate` for an OE order.

> **Correction (2026-09-02):** an earlier draft said RTG had no card for a stocked-only Order Entry sale. Wrong — `liveSO` subscribes to every `hq_sales_orders` doc with no class filter (`RTGDispatchTab.js:327`) and the board keys each one in (`:557`). A Quick Ship sale has its RTG record; it simply never *splits*, because auto-release requires `hqJobId` (`:349`). That is exactly the behaviour Stuart wants (Q6).

The recipe for a CPQ sales order is **not stored on the SO** — it is written as `PENDING-RECIPE`
(`CPQTab.js:3014`) and resolved at release by `fetchEnrichedJobData` (`RTGDispatchTab.js:696`),
which scans `cartItems[].finishLabel`, `finishes[]`, `config` keys, `engineConfig.globalFinish` and
`breakdown[].finishCode` against `master_finishes`. Five sources, one resolver, still reachable to
`PENDING-RECIPE` if a quote carries none of them.

> **State 2026-09-03 (Brief E shipped E1+E2, `c73263e` / `eb5cb6b` / `efb4fd9`):** both sales
> shapes now write **one header** from `Shared/salesOrderHeader.soHeaderOf` — `customerPo,
> sidemark, jobName, memo, needBy ('' when none; the +14-day `reqDate` fiction is gone),
> readyDate/leadWeeks (painted 4 wk, plated 6, Rush → 2/4), shipTo[], productionNotes, recipe
> (a CODE) / recipeLabel / recipeSource / recipes[], source` — and `finishOutsourced` rides
> every CPQ breakdown line that carries a finish. The five-source recipe scan runs once at save
> (`resolveJobRecipe`); RTG's copy becomes the fallback for older docs (B4). `reqDate` and
> `needByDate` are written as aliases of `needBy` for one release while RTG (B), the WMS (D),
> Order Entry Needs (A) and the portal function switch readers. Order Entry's line dialect and
> direct-to-WMS path are unchanged (Q6). P2 #14 closes on the header; the line dialects stay.
> The retired tab-7 generator (P2 #12) is deleted (`961de69`). Handoff: `BRIEF_E_HANDOFF.md`.

---

## 7. The floors — what each consumes, and the hang-up catalogue

**Finishing Setup Queue** reads `fin_workorders` `currentPhase === 'Setup'`. Groups by `recipe`.
Segregates outsourced via `finishRouteOf` (`:50`). Start Setup releases the pick
(`releasePickPatch`, `:133`) — synthesising a single raw-base pull line when the order has no
`partsList` but has a `stockErpId` (`:144-165`). An order with neither is "not sent to WMS" (`:166`).

**Active Floor** reads `currentPhase === 'Painting'`, renders `tasks.{spinSetup,spinSpray,spinBake,
poleSpray,poleBake,hand,poleHand}`. Every writer now uses `makeFullTasks()` — the 2026-06 audit's
"no task cards" P0 is resolved. Pole vs sled stream is decided by `poles/totalPoles` on the doc
(00b26f3 put that on every writer).

**Shop Floor** reads `shop_custom_orders`; Custom tab excludes `MILLING`/`isStock`. START mirrors
`customFabStatus` and releases the sibling pick; COMPLETE mirrors `'Complete'` and, for an
outsourced recipe, writes a `plating_demand` (`ShopFloor.js:1254-1271`).

**WMS** reads `fin_workorders where sentToPickPack` **and** `hq_sales_orders QUICKSHIP`. Pack gate
refuses while `hasCustomSibling && customFabStatus !== 'Complete'` (`PickPackApp.js:2658`).

**Where an order stops, and why it says so (or doesn't):**

| symptom on the floor | cause | says so? |
|---|---|---|
| RTG: parked, no auto-release, both Push buttons | route-open writer (§2 #2, #6, #10) | no — looks like a choice |
| RTG: parked | one of five gates | yes (`⏳` notes) |
| Setup Queue: PENDING-RECIPE group | CPQ quote with no resolvable finish; library run with a label not a code | grouped, not explained |
| Setup Queue: "not sent to WMS" | no `partsList`, no `stockErpId` | yes |
| Setup Queue: sled steps pending forever | pole stamped without `poles` (fixed 00b26f3) | fixed |
| WMS pending window | `awaitingRodCut` / custom sibling not complete / not released | yes (`pendingReasonOf` `:787`) |
| WMS pack refused | custom sibling not Complete | yes |
| WMS convert: row refused | raw read failed (`rawUnknown`) | yes |
| NetSuite: WO open forever | see §8 | **no** |
| Plated custom parts: packed before they return | see §8 | **no** |

---

## 8. NetSuite — every write, every close, and the ones nobody closes

**Writes** all go through `ns_outbox`. Kinds seen: `estimate`, `salesorder`, `purchaseorder`,
`workorder` (assembly WO), `workordercompletion` (WO-linked assembly build), `itemfulfillment`,
`inventoryadjustment`, `bintransfer`, `workorderclose`. Good.

**Anchors (NetSuite work orders opened by the app):**

| opened by | on | closed by |
|---|---|---|
| Route A at finishing release (stock) | the finished variant | `onStockBuildDone` at pack putaway (`functions:564`) — requires `orderType 'stock'` + `nsWoId` |
| root WO at creation (Raw Cores, Library make-up, pre-check make-up) | the milled root | RTG **⛏ Mill Build** button, manual (`RTGDispatchTab.js:1862`); guard `kind !== 'sales'` (`:2218`) |
| /P convert anchor | the /P assembly | WMS convert posts the build against it (`PickPackApp.js:1718`) |
| **Order Entry FLOW2** | the finished variant, `orderType 'sales'` fin doc | **nothing I can find.** `onStockBuildDone` returns on `orderType !== 'stock'` (`functions:567`); the 🔨 heal requires `orderType === 'stock'` (`:2180`); ⛏ requires `kind !== 'sales'`. |
| **Order Entry FLOW1** top-level anchor | the base assembly, "closes on the final assembly build" (`StockViewTab.js:2484`) | **nothing I can find** posts that final build for a sales-typed order. |

If that reading is right, every Order Entry to-be-finished line since 08-29 has left an open
NetSuite work order with committed components. That is either being closed by hand in NetSuite, or
accumulating. **Question 1, §10.**

**Fulfilment**: WMS pack → `!transform/itemFulfillment` (`PickPackApp.js` ~1290). The 11.1 queue
holds 9 failures in three classes (multi-location, already-closed, missing Class) — documented in
`POLE_ROUTING_HANDOFF_BRIEF.md §4`, unchanged, two of the three need Eric.

**Plating is fire-and-forget.** `plating_demand` is written by six places, deleted by the WMS when
the pull to OB PLATING posts (`PickPackApp.js:2133`). Nothing gates on it (`grep awaitingPlating` →
nothing). And the shop's COMPLETE mirrors `customFabStatus: 'Complete'` onto the finishing sibling
**whether or not it went to plating** (`ShopFloor.js:1256`, before the `toPlating` branch). The pack
gate reads exactly that field. So a plated custom order's small parts can be packed as complete while
the custom parts are at the plater. **Question 2, §10.**

---

## 9. Findings, ranked

**P0 — ghosts and dead ends (work disappears or stalls without saying so)**

1. ~~Route-open parking of finished items~~ — **CLOSED 09-02 evening by Brief A:** writers #2
   (`646972d`) and #6 (`908a743`) now park through `parkWorkOrder` with a stated route; writer #10
   (RTG re-issue) has `INTENT.REISSUE` ready and is B's patch spec. Push to Shop on a finishing job
   is gone with it.
2. **Order Entry anchor WOs have no closer** (§8). *Needs Eric's answer before any code.*
3. **Plated custom parts read as complete on pack** (§8). *Fix shape:* mirror `'Sent to Plating'`
   not `'Complete'`, and let the WMS plating receipt mirror `'Complete'` — the field and the
   contract already exist.
4. ~~firestore.rules deploy state unknown.~~ **Closed 09-02 — Stuart confirms deployed (Q3).**
   Code and rules agree (0 collections referenced without a match block). The three briefs that
   say "pending" are stale on this point.

**P1 — the same rule in several places (the "fix breaks elsewhere" class)**

5. **Six release implementations** (§4). *Fix shape:* one `buildFinDoc(hqOrder, ctx)` and one
   `buildShopDoc(...)` in `Shared/`, called by every path; each path keeps its own gates and
   confirms, none keeps its own field list.
6. **Ten WO writer shapes** (§2). *Fix shape:* one `parkWorkOrder({intent})` in `Shared/` that
   stamps `source`, `routeTo` (by suffix rule), `orderType`, `itemCode`, `recipe`, and the anchor
   policy — the writers pass intent, not fields. The `finPayload`-vs-enrich split collapses to
   "always pre-build."
7. **Twenty hand-rolled finish-suffix readers outside `Shared/`** (14 in StockView, 2 QuickShip,
   2 Library, 1 Mass Update, 1 Customer Collections); `finishCodeFromErp` is imported by four
   files. The pole bug was exactly this class — a local copy that could not see a ROD. Not every
   one is a routing decision, but every one is a place the rule can drift.
8. **Recipe resolved in four places** (§6): `fetchEnrichedJobData`, `woRecipeCode`, each finPayload
   writer, `releaseRunToFloor`. Plus `finishRouteOf` reading suffixes off `partsList` as a fallback.
9. **Three PO shapes, one push, wrong memo, subsidiary check on one path only** (§3).
10. **Gate list hand-written in three places** (§5). Agree today.

**P1 — added 2026-09-02 while cutting Brief E**

15. **CPQ's sales-order date is fiction.** `hq_sales_orders.reqDate` on a CPQ save-as-SO and on a
    portal approve is `Date.now() + 14 days` (`CPQTab.js:3015`, `ExternalCoopTab.js:908`); a CPQ
    job carries no need-by at all. RTG, the split and both floors schedule every CPQ order on a
    date nobody chose. *Brief E1.*
16. **Two NetSuite header builders.** `nsTransmit.buildNsTransaction` (`:592-610`, CPQ/portal) and
    Quick Ship's inline copy (`QuickShipTab.js:1323-1331`) each hard-code `brand === 'ce' →
    customForm 177/299 + class 2` and each resolve the ship method on their own. Sinaya's "Class"
    failure is one symptom. *Brief E3.*

**P2 — hygiene**

11. `source` missing on the grid writer and the plating-base-short writer.
12. Dead code carried live: tab 7's retired generator (`QuickShipTab.js:1541-1700`), `Management.js`
    demo seeder. `DATA_FLOW_AUDIT.md` and `WORK_ORDER_CONTRACT.md` date from 06-10 and are cited by
    newer docs as current.
13. `BRAND_NETSUITE_MAP`: 3 copies, in sync today (`brandNetsuite.js`, StockView, Library).
    CLAUDE.md says four — the doc is behind the code.
14. Two sales-order shapes and two pick-line dialects (§6) — working, but every WMS/document/CRM
    feature is written twice.

---

## 10. Decisions — Stuart, 2026-09-02 morning

Every question answered. Recorded verbatim in intent; the code consequence follows each.

| # | question | decision | consequence |
|---|---|---|---|
| 1 | OE anchor WOs — who closes them? | **Closed by hand today. The app must build them.** Prevention is the goal so the hand-closes disappear. | Brief D: every NetSuite WO the app opens, the app posts the build against — sales-typed included. `onStockBuildDone`'s `orderType === 'stock'` guard is the seam. FLOW1's *final* assembly build needs a defined trigger. |
| 2 | Plated custom orders | **The plating process on the WMS tab is exactly what we want** — PO to the plater, out-to-plating bin status, receipts just starting. The job is to prove it works without bugs. | Briefs C + D: validate the round trip end-to-end. P0 #3 (shop mirrors Complete before the plater) is a bug *in* that process, fixed as part of validating it; receipt should open the pack gate. |
| 3 | Rules deployed? | **Yes.** | P0 #4 closed. |
| 4 | Route-open parking | **Everything routes to where it belongs, always.** Stocked poles → finishing with the POLES scheme (done). Custom → shop. Small parts → floor. **Plated items** (second pass, 09-02): all are set up as **complete assemblies with an outsourced finish**. When the ROP load or the Sales Snapshot shows one short, **issue the PO** (to the plater) from there; the **demand for the BOM component** (the root / mill core) goes to the **WMS plating demand**, whose tab pulls the core from stock, switches its bin to plating and stages it in the plating dispatch area — shipped out **once a week**. The plating tab is the connection between the PO for the outsourced finish and the actual component. **If the root has no stock**, a work order is created (again at the Snapshot) and hits the shop floor to produce it, then it goes to plating. | Brief A: the route rule at every writer; route-open parking abolished. Plating is **not** a new `routeTo` — it is PO + `plating_demand` + (core short → shop WO), issued together from the Snapshot. §13 a rewritten to this design. |
| 5 | finPayload vs enrich | **Snapshot model** — always pre-build. | Brief A: `parkWorkOrder` always writes the complete floor doc. |
| 6 | Order Entry as a second spine | **Stocked lines go straight to WMS, and the record goes to RTG.** All processes go direct and record to RTG — no manual push; RTG is the master record and the close. | Already true for the record (see §6 correction). Brief E keeps the direct WMS path; Brief B makes "no manual push" universal. |
| 7 | The OE Custom pair / stocked poles | **Leave it.** *(Reversed 09-02 second pass — the "Stocked at Finished Length" tag is dropped.)* Control is the **finish**: `/P` is the control for finishes we always apply custom; any other letters qualify as small parts, finished like poles. | The suffix rule shipped in 0615687 (`handlingForErp`: mill code, `/P`, `/P##`, `/P25`, `/EP*`, `/MEP*` → Custom; `/BS`, `/N90`, `/CP`… → Small Parts; stream POLES) **stands as is.** The OE pair (b531f53) stands as built. No new library field. |
| 8 | Stock-build "needs a PO" board | **Yes.** | Brief A. |
| 9 | One SO header shape regardless of door | **Yes, 100%.** | Brief E. |
| 10 | Recipe stamped at save | **Yes, 100% — Order Entry custom finished items too.** | Brief E (CPQ + tab 7), Brief B stops re-deriving at release. |
| 11 | Master Library direct release | **Through RTG everywhere.** Releases directly — no second button press by a person — but through RTG as the process and control. | Brief A/B: `releaseRunToFloor` goes through the shared builder + RTG's auto path. |
| 12 | Delete the retired tab-7 generator? | Asked for detail. **The dead code is `QuickShipTab.js:1545–1701` only** — the `if (tbfLines.length && !OE_SAVE_AUTOFIRE_RETIRED) { … }` block (157 lines), unreachable since the flag went `true` on 08-29. The tab, the cart, SO save, the outbox push, the documents, kits, aliases, the review-gate hand-off message at `:1542` — all stay. `tbfMade` / `woWriteBacks` are still referenced at `:1707-1709` and survive as empty arrays. | Brief E, one commit, `git diff -w` proves nothing else moved. |
| 13 | Which suffix readers are routing decisions? | Asked for detail — classified below. | Brief A sweeps the eight routing-grade ones; the rest can wait. |
| 14 | The open CPQ/OE session | **OK** — let it finish its handoff, retire it, start Brief E fresh. | — |
| 15 | Order of work | No objection. | §12 stands. |

### Brief B's four questions — answered 2026-09-02

| # | question | decision |
|---|---|---|
| B1 | supervisor "release now" under S3 | **keep one**, behind the scary confirm, in the detail view |
| B2 | the plating state on the finishing floor | **outsourced finishes never enter the finishing floor** — only plating and/or WMS pick/pack when available. The Setup Queue's outsourced group becomes empty by construction, then is deleted. `'Sent to Plating'` is a pack-gate state read by WMS/RTG, not a finishing state |
| B3 | floor-originated scrap re-make | **retired for stock** — the Snapshot addresses the shortfall on future orders; custom orders keep the hard-red-letter flag on the flow and re-issue from RTG |
| B4 | the legacy enrich fallback | **clean up after a week** of zero |

### Q13 — the twenty local suffix readers, classified

**Routing-grade (8) — a decision about where work goes or what recipe runs; each is a place the rule can drift, and two are outright duplicates of a `Shared/` rule:**

| site | what it decides | note |
|---|---|---|
| `StockViewTab.js:1121` `finishOf` | the Snapshot's finish/recipe from the code | **duplicate of `finishCodeFromErp`** with different semantics (strips a `-N` marker and `-10/-12` sizes). Two answers to "what finish is this". |
| `StockViewTab.js:1875` `tierOfItem` | raw / /P / plated tier → which screen orders it | **duplicate of `LibraryMassUpdateTab.js:745` `tierOfErp`** |
| `LibraryMassUpdateTab.js:745` `tierOfErp` | same | the other copy |
| `StockViewTab.js:535` | PO builder: plating demand vs milling from the suffix | routing |
| `StockViewTab.js:1893` (+`1778`, same loop) | 3-tier grouping | routing-adjacent |
| `StockViewTab.js:1947` | suffix → outsource finish match → plating demand | routing |
| `StockViewTab.js:2060` | `/P` → convert vs shop | routing |
| `LibraryTab.js:1418` | plater vs in-house on the Library run | routing |

**Identity / base-code derivation (5) — "which item is this", not "where does it go":** `StockViewTab.js:1241, 1397, 3221, 3224`; `QuickShipTab.js:63`. These want `millBaseOf` / `finishSuffixOf` from `Shared/finishRouting` for hygiene, not urgency.

**Display only (2):** `StockViewTab.js:2975, 3194`.

**Dead or false positive (3):** `StockViewTab.js:3241` (a JSX style string), `LibraryTab.js:932` (URL parsing), `QuickShipTab.js:1606` (inside the retired block).

**Not local (1):** `CustomerCollectionsTab.js:65` already calls the shared `isPlatedSuffix`; only the split is inline.

---

## 11. Specialist territories — the six briefs

| brief | owns | inherits from this audit | must not touch |
|---|---|---|---|
| **A. Stock View + Sales Snapshot + Master Library — WO & PO creation** | `StockViewTab.js`, `LibraryTab.js` (WO/PO parts), `Shared/finishedRunPrecheck.js`, `finishedGoodsRun.js`, `oeReviewPlan.js`, `poleCut.js`, `stockRun.js` | P0 #1, P1 #6 #7 #9 #11, Q4 Q5 Q8 | RTG's release paths (B) |
| **B. RTG + Finishing Floor** | `RTGDispatchTab.js`, `FinishingFloor/*`, `Shared/orderLifecycle.js`, `workOrderContract.js`, `orderStatus.js`, `finishingTime.js`, `finishRouting.js` | P1 #5 #8 #10, P0 #3 (fin side), Q2 Q5 Q11 | the writers (A), the shop's own status flow (C) |
| **C. Shop Floor** | `ShopFloor/*`, `pushToShop` payload contract (with B), plating hand-off | P0 #3 (shop side), Q2 Q7 | RTG release logic (B) |
| **D. WMS** | `PickPack/*`, `functions/index.js` `onStockBuildDone` + fulfilment, `nsOutbox.js`, convert/rod-cut/plating gates, `rodPieces*.js` | P0 #2 (once Eric answers), #3 (receipt), #4, fulfilment queue | — |
| **E. CPQ + Vision + Order Entry (sales side)** | `CPQTab.js`, `VisionHardware.js`, `visionBridge.js`, `QuickShipTab.js`, `ExternalCoopTab.js` (SO surfaces), `nsTransmit.js`, `hardwareHandoff.js`, `lineClassification.js` | P2 #14, Q6 Q9 Q10 Q12 | RTG, floors |
| **F. The tag engine + Kits + Spec Sheets + 1.6** | `hardwareModel.js`, `hardwareAdapter.js`, `hardwarePricing.js`, `HardwareConfigurator.js`, `assemblyTags.js`, `traverse*.js`, `sizeMatrix.js`, `plateRules.js`, `kitSeed.js`, `kitCode.js`, `CustomerCollectionsTab.js` (4.6), `SpecSheet/*`, `AssemblyBuilderTab.js` (1.6), `NodeClusterTab.js`, the flow generator in `AdminTab.js`, `studioScene.js`, `GuideBuilder.js` | own backlogs — `KIT_CPQ_ALIGNMENT_BRIEF.md`, `ENGINE_CHECKOUT_BRIEF.md` §3 ①, `TRAVERSE_HANDOFF_BRIEF.md`, the spec-sheet memory (trusted over its brief), `engine-cutover-backlog` | the sales spine (E) — F produces a correct cart item; `hardwareHandoff.js` is E's |

**All six briefs are written (2026-09-02):** `BRIEF_A_WO_PO_CREATION.md`, `BRIEF_B_RTG_FINISHING.md`, `BRIEF_C_SHOP_FLOOR.md`, `BRIEF_D_WMS.md`, `BRIEF_E_SALES_SIDE.md`, `BRIEF_F_KITS_SPEC_SHEETS.md`. The standing rules S1–S5 sit at the top of A and are quoted in each.

`Shared/` modules that more than one brief reads are **owned by one and read-only to the rest**,
named per module in each brief. That rule exists (`CROSS_SESSION_CONTRACT.md`) and is the reason
tonight's RTG edit was safe — it was asked for, not assumed.

---

## 12. Recommended order of work this week

1. **Answers to Q1–Q4 first** (Stuart / Eric). Two of the P0s are questions, not code.
2. **Brief A ships the writer consolidation** (P1 #6, P0 #1, P2 #11) — one `parkWorkOrder`, the
   suffix route rule at every writer, `source` on all. This is the spine's front door; everything
   downstream gets simpler when the ten shapes become one.
3. **Brief B ships the release consolidation** (P1 #5, #8, #10) — one fin builder, one shop builder,
   one gate list. Depends on A's shape being settled, so it starts after A's plan is approved (not
   after A ships).
4. **Brief D closes the NetSuite loops** (P0 #2 once answered, #3 receipt side, #4 deploy, the
   fulfilment queue). Independent of A/B.
5. **Brief C** does the plating mirror (P0 #3 shop side) and validates the OE pair on a live order.
   Small, independent.
6. **Brief E** aligns the two sales shapes (Q6, Q9, Q10) — biggest design decision, so it goes last
   in sequence but its *plan* should be written this week.
7. **Brief F** runs in parallel throughout; it does not touch the spine.

**Churn since 08-25 (commits touching the file):** RTGDispatchTab 36 · StockViewTab 34 ·
PickPackApp 24 · HardwareConfigurator 21 · QuickShipTab 21 · CPQTab 21 · ExternalCoopTab 12 ·
finishedRunPrecheck 11 · AdminTab 11. The three most-changed files are the three the spine runs
through. That is where a consolidation pays back fastest, and where two sessions in one file is
most dangerous.

---

## 13. New requirements the decisions create

**a. The plating path, as Stuart defines it (Q4, second pass).** Every plated item is a
**complete assembly** whose BOM names its mill core, with an outsourced finish. One demand at the
ROP load or the Sales Snapshot produces up to three documents together:

1. ~~a PO to the plater~~ — **settled 09-02 evening:** the plater PO stays with the **WMS weekly
   shipment** (Phase 3); the Snapshot raises no PO. *"From the Sales Snapshot we will see demand
   there, so we need to create demand for these items to be pulled on WMS and sent to the plater
   tab."* (Briefs A and D both caught the double.)
2. a **`plating_demand`** for the BOM component — the WMS Plating tab pulls the core from stock,
   moves its bin to plating, stages it in the plating dispatch area, and ships **once a week**;
   the tab is the bridge between the PO and the physical part;
3. **if the core has no stock**, a shop work order (raised at the Snapshot) to mill it first —
   then it goes to plating.

The mechanics exist today, in **three copies**: the Stock View PO builder (`StockViewTab.js:554`
demand, `:571` core-short WO, `:609` PO), the Sales Snapshot (`:1950` demand, `:1681` PO) and the
Order Entry review (`:2206` demand, `:2511` PO). Brief A consolidates them into one
`issuePlatedDemand({item, qty, from})` so the three screens cannot disagree, and adds the data
check Stuart asked for: **a report of every outsourced-finish item that is not a complete assembly
with a core in its BOM** (the sync already classes `/P` and `/EP` SKUs as Assembly,
`NetSuiteSyncTab.js:934`; whether each carries a BOM pin is a NetSuite-data question).

What still has to be answered by testing, not design: **what waits on the plater.** Receipt
(`plating_shipments` received) must put the plated assembly into stock and, for a custom order,
tell the finishing sibling and the pack gate — P0 #3 is exactly that seam. Briefs C + D.

**b. ~~"Stocked at Finished Length" tag on poles/rods.~~ Dropped (Q7, second pass).** The finish
suffix is the control. `handlingForErp` (0615687) stands; the OE pair (b531f53) stands.

**c. The app builds every NetSuite WO it opens (Q1).** Sales-typed included. The seam is
`onStockBuildDone`'s `orderType === 'stock'` guard and RTG's `kind !== 'sales'` guards; FLOW1's
final assembly build needs a trigger defined (pack putaway of the finished order is the natural
one).

**d. RTG is automatic control + the master record, never a button (Q6, Q11).** Every path
releases through RTG's builder on its own; humans see status and close. The Master Library run
included.

**e. One sales-order header; recipe stamped at save (Q9, Q10).** Both doors.

**f. A "needs a PO" board for stock builds (Q8).**

**g. Outsourced finishes never enter the finishing floor (B §8 answer 2).** Today
`autoSplitSalesOrder` writes a `fin_workorders` doc for the small lines whatever the recipe
(`RTGDispatchTab.js:1060`), and the Setup Queue segregates outsourced arrivals (`SetupQueue.js:50`).
After: an outsourced recipe produces a WMS pick + plating demands and no finishing document; a
mixed recipe keeps the fin doc for in-house lines only; the segregation code is deleted once the
group is empty by construction. A's writers refuse to park a finishing WO for an outsourced
finish. Briefs A, B, C, D.
