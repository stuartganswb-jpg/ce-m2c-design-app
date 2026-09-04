# Brief B handoff — RTG Dispatch + Finishing Floor (2026-09-04, end of day)

*Brief: `BRIEF_B_RTG_FINISHING.md`. Rules: `CLAUDE.md` working agreement + Stuart 2026-09-03:
**one issue at a time per session; check for a safe push before every push; approvals relayed via
the integration session count; every order via RTG always (hard rule).***

## 1. Shipped, verified in the served bundle

| commit | what | proof |
|---|---|---|
| 3133aba | **B5 part 1** — `'Sent to Plating'` contract: `CUSTOM_FAB_STATUS` (Pending → In Process → Sent to Plating → Complete), `mirrorCustomStatusToSibling` refuses unknown states + stamps `customFabAt`; `customPartsReady(wo)` (the one pack-gate test); `customFabLabel(wo)` ("At the plater since <date>"); `PLATING` stage; Setup Queue chip; Where-Is-It next move; `WORK_ORDER_CONTRACT.md` §5 | main.6d4ba9de.js: "At the plater since", "is not a customFabStatus" |
| 7182f2e | **B2** — one gate list: `GATES`/`gatesOf`/`openGatesOf`/`isReleasable`/`gateSummary` (`Shared/orderStatus.js`); RTG's two auto effects, `pushToFinishing`'s auto branch + manual confirms, the board's gate lines (every open gate now gets a line), the AUTO-FLOW chip and Where-Is-It all read it; `scripts/orderStatus.test.mjs`; contract §5a | main: "already dispatched to finishing", "awaiting NetSuite WO #" |
| 230c266 | the B5/B2 names verbatim in Briefs A, C, D | — |
| 67ad06d + b9fe48c | **Order Entry / Quick Ship sales orders on the RTG board** (Stuart: "approved ship it"): read-side only from `liveSO`, visible from creation, NS_QUEUED = "Awaiting NetSuite", record-only card (customer, memo, WMS chip, `finishAsAvailable` flag w/ By/Reason, its WOs with gate words), **no split button** — the `hqJobId` requirement on the auto-dispatch effect is load-bearing (comment on it). `quickShipStatusOf(so)`: QUICKSHIP `status === pickStatus` in Pending \| Picked \| Shipped (NOT the finishing vocabulary — D caught it, fixed forward); `pick/packInProgress` are CLAIMS ("open on a tablet"). 53 assertions | main.35132088.js: "open on a pick tablet"; chunk 10.9be6d244: "record only, picked by the WMS" |

Riding the same pushes from others, now live: C1 (shop mirrors 'Sent to Plating', 9ef3331), D1 (receipt → `'Plating Received'`, build-back → `'Complete'` + `'Plated'`, pack gate = `customPartsReady`), A's `clearConvertGate` → `isReleasable` (037c958). **The plating loop is closed end to end.**

**Deploy-verify method that works:** `asset-manifest.json` is served — download main + every chunk it lists and grep a UNIQUE ASCII literal. RTG's board JSX is a lazy chunk; `orderStatus`/`workOrderContract` strings are in main (via PickPack). A version stamp proves nothing. In zsh, iterate files with `while read`, not `for f in $VAR`.

## 2. The eight B1 call sites (§4 B1 table) — state
None converted yet: **B1 not started** (waits on Stuart ordering it). Inputs are all in: A's `parkWorkOrder` stamp contract (writers 1/2/5/6/8/9 converted; 7 = Library run waits on B1; 10 = RTG re-issue is B6, `INTENT.REISSUE` live 646972d), C's `cutSheetMissing` + `visionUsed` + `shopInstruction`, E's header (`recipe`/`recipeSource`/`needBy`/`line.finishOutsourced`, live c73263e), the pole/sled exclusivity (WO11535 = acceptance case), caller-supplied shop id (`<woId>-C`).

## 3. Queue — one issue at a time, each on Stuart's word
1. **RTG PO panel reads A's `isOpenPo`** (POs vanish after approval; plating PO never shown). Sequence: A extends `PO_STATUS`/`isOpenPo` → D maps 'Sent to Plater' → B adopts. Stock View "📋 Open POs" cleanup twin = A's. **Approved** (item 10).
2. **`awaitingReceipt` gate** — **approved.** A sets `awaitingReceipt / receiptRefs[{poId,itemId,qtyNeeded}] / receiptGateNote` (+ `receiptPoIds[]`), A exports `clearReceiptGate` (clears only when received covers `qtyNeeded`), D calls it, B adds the `GATES` entry (`clearedBy`: "the WMS receiving tab recording enough received quantity to cover the line").
3. **`finishAsAvailable` release half** — **approved.** `true` = the outlier; absent = wait and finish complete. RTG card sets/clears with `finishAsAvailableAt/By/Reason` (D's SO Pack already does); the release: false → fin doc waits for every gate incl. receipt; true → in-stock lines now, late lines as a second fin doc on the same orderKey.
4. **"No finish" on the floor** — F's `takesNoFinish(part, line)` live (0565be6). `Shared/PullLinesLive.js` is now B's; it has no library part per line → needs a part read (callers' map or one batched read). Floor sheets too.
5. **B5 part 2 — stock-first split** (Stuart's EP rule): call `fetchAvailabilityUnits(codes, loc)` AFTER `nsInternalId`; three-way answer (covered / genuinely short → A's Backorder window / cannot be answered → data fix); `unitsKnown===false` = retry the pull, `!(code in map)` = no stock row; NO plating demand at the split; an in-stock EP small line is a pick line, never a plated custom half; pick-only `fin_workorders` doc (`currentPhase 'Pick'`, `finishingRequired:false`) for an order with nothing for the finishing floor (approved as part of B5). A's superset `Shared/stockAvailability.js` is additive later.
6. **B1** builders, then B3 (buttons retire; PO panel = review-and-Approve per A4's Draft→Approve chain), B4 (read `so.recipe` first; split writes `needBy` on the fin doc → E deletes the `reqDate/needByDate` aliases), B6 (writer 10 via `INTENT.REISSUE`; PO memo `po.note || SOURCE_LABEL[po.source]`), B7 (`identityKeysOf` gains SHOP-<id> → <id> so a milling spine finds its hq parent — C's finding), B8, B9 guide.

## 4. Named, not fixed
- `⛏ Mill Build` stays until D3 (`onMillComplete`, live but OFF per brand) earns the flip — per brand.
- A quote/estimate is not an order: the board reads `hq_sales_orders` only, never jobs.
- Stale open Order Entry SOs (14 Aug) commit stock → a stocked EP item reads unavailable; upstream, Stuart's item.
- Wood poles route to the shop (Part Handling Custom on the raw rods) — accepted for tonight's four; fix escalates on the CUT (fabMethod), not a handling tag; not B2/B5.
- Setup Queue outsourced group: delete only after A's writers are all live and the group is observed empty.
- Two overlapping auto effects in RTG (auto-release + OE auto-flow) stay two until B3.

## 5. Guide (S2)
Not yet touched. Sections to update when B3/B9 land: "⚡ Auto-Release", "the honest matrix", "Edges to know", Work Orders, finishing-floor explainer — gate words, the four `customFabStatus` states, the Order Entry rows on the board.

## 6. 2026-09-04 — shipped today (all verified in the served bundle via asset-manifest sweeps)

| commit | what |
|---|---|
| 65dbd96 | JFP View Item shows what is painted and what is pulled (Setup Queue) |
| fc6e4d1 | the auto-flow door matches the order — stock through Route A (five unanchored builds found; heal panel pressed) |
| f68a68c | `Shared/floorRelease.js`: Route A + the stock release leave the RTG tab (WMS/A call it — specs in D, A) |
| f60fc29 | closing an order cancels its open rod cut; Setup Queue refuses Start/Stage while a cut is open |
| e72e7ce | `finishAsAvailable` control on both RTG SO cards (D's four field names; reason logged) |
| e87d991 | "no finish" on the pull lines via F's `takesNoFinish` (PullLinesLive reads the part records) |
| a12c804 · 04aebab | **B1**: `buildFinDoc` + `buildShopDoc`; split + pushToShop + stock release use them; `cutSheetMissing`/`visionUsed`/`shopInstruction`; proven on the seeded Brimar order |
| beba981 | QC scrap + the custom red line reach the RTG record (`propagateFloorState` gains `extra`); rows show "⚠ SCRAP n reported on the floor" |
| ff69f79 | **B3**: one release engine (toggle = kill switch), Push buttons gone, one supervisor override, source line, PO panel = every open PO + Approve/Mark-sent through A's helpers, legacy-enrich count |
| (this) | **B9**: guide "⚡ Auto-Release — RTG is the record and the control", OVERVIEW_ORDER_FLOW, WORK_ORDER_CONTRACT §5b |

Hand-offs written today (all in the owners' briefs): A — unresolved BOM pin refuses + "fix the BOM or use JFP" (WO11588); `releaseFinWoToFloor` → `buildFinDoc`; `clearConvertGate` stock branch → `releaseStockWoToFloor`; Reset→Setup propagates. C+D — Shop Reopen cancels its plating demand. D — JFP adjustment double-post (dedupeKey); rod-cut completion calls `releaseStockWoToFloor`; the JFP/plating receipt phases.

Sweep (2026-09-04): every terminal or changing write on the four order collections goes through the one closer / propagate / the record itself, except the three above (handed off) and the Library rollback hard-delete (acceptable, ledgered).

**Still queued (B, on Stuart's word):** `awaitingReceipt` GATES entry + the `finishAsAvailable` release half (after A's `receiptRefs`/`clearReceiptGate`); B5 part 2 stock-first split (`fetchAvailabilityUnits` after `nsInternalId`, three-way answer, pick-only fin doc, no plating demand at the split); B7 `identityKeysOf` SHOP-<id> key; B8 Setup Queue PENDING-RECIPE `recipeSource`; B4 read `so.recipe` first + write `needBy` on the fin doc (then E deletes the aliases); delete the enrich branch after a week of zero; Setup Queue outsourced group after A's writers are all live.
