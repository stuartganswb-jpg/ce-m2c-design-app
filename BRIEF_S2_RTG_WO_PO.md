# Brief S2 — RTG Dispatch · work-order and purchase-order creation (the control spine)

*Written 2026-09-10 by the communicator session. You are the FIRST session to start. Read, in order:
`CLAUDE.md` (the working agreement binds you), `SESSION_COMMS_2026-09-10.md` (the map and the hand-off
protocol), `STATE_OF_THE_APP_2026-09-10.md` (the state; your items are §2.1 #1–7, §2.2 #9–16, §2.3, §2.4
#31–41, #55–56), then `RTG_CONTROL_BRIEF.md`, `BRIEF_WO_PO_SPINE.md`, `BRIEF_REPAINT_JFP_JOINT.md` and
`WORK_ORDER_CONTRACT.md` for the rules as they now stand. `BRIEF_A_HANDOFF.md` and `BRIEF_B_HANDOFF.md` are the
commit-by-commit history — read them for why, not for the current state.*

## ⛔ Working agreement + standing rules

Plan first and WAIT, every time. Requested scope only — adjacent problems get NAMED in this brief, never
fixed in passing. No temporary fixes. Trace every change through work orders → finishing → shop → WMS →
NetSuite and say so in the plan. **One issue at a time.** S1–S5 from the top of `BRIEF_A_WO_PO_CREATION.md`
(tags before code · the guide moves with the code · everything auto-routes and RTG records everything · BOTH
always asks · POs open, accumulate, then send). Plus: **every order via RTG, always**; **a decision and a
silence are different things**; **a gate must be liftable**; **the recoverable answer is the default**.

## 0. Operating

- **⚡ Auto-release is ON** (Stuart, 2026-09-10). The engine runs only while an RTG tab is open — that
  limitation is one of your items (§3 #11–12).
- **Stuart's live orders are the test vehicles.** He is entering quotes for one customer today and turning
  them into sales orders. Every acceptance run below uses those orders. Do not raise a test order of your
  own; ask him which order to watch.
- Pin-in: Stuart drives Claude-in-Chrome on his tab (`tabs_context_mcp` first, `find` → ref, never
  credentials; Factory Portal + PLM PIN are his to type). Get-page-text beats screenshots on the heavy HQ tab.
- Deploy-verify: RTG's board JSX is a lazy chunk; `orderStatus` / `workOrderContract` strings sit in main via
  PickPack. Sweep the whole `asset-manifest.json`. StockViewTab and LibraryTab are lazy chunks.
- Node suites for your modules: `orderStatus`, `orderLifecycle`, `stockRun`, `splitPlan`, `backorder`,
  `backorderBoard`, `poLock`, `repaintSource`, `woodRouting`, `stockReviewRows`, `orderRoute` — run bare
  (never `| tail` inside `set -e`), or `sh scripts/run-traverse-tests.sh` for everything.

## 1. THE IMMEDIATE PROBLEM — "Close all" on Board vs Floor closed live orders

**Stuart, 2026-09-10, verbatim:** *"the RTG this morning i hit the button to close All on the board vs. floor
as there were a lot of orders that it stated were closed on the floor but open on the board. when i did that
it worked, but it also closed a lot of orders that were still open on the floor, either still in packing,
still in finishing, etc. so one i need to reopen some of these orders to see them thru, but more importantly
we need to understand why it did this, clearly our sync where RTG is in control and see's everything was
off."*

Two deliverables, in this order: **(a) understand why** and stop it recurring; **(b) reopen the orders** that
were still live, without guessing their state. Nothing else in this brief comes before these.

### 1a. The cause, as read in the code this morning (communicator; verify before you act on it)

The button is `reconcileAll` (`RTGDispatchTab.js` ~2195–2225), offered on every finding type except
`NS_CLOSE_TODO / DEMAND_ORPHAN / RODCUT_ORPHAN / STRANDED_GATE / NS_POSTED_AFTER_CLOSE` — so it is offered on
**`FLOOR_DONE`** ("Finished on the floor, still live here"). For each finding it calls
`closeOrderEverywhere` on the parent record with `from: 'RTG_RECONCILE_ALL'`, `reason: <finding type>`.

`FLOOR_DONE` is raised by `Shared/orderLifecycle.auditOrphans` (`:304`) whenever ONE floor doc reads
`isDoneState` and its parent record does not. `isDoneState(d)` (`:47`) is true for a fin doc at
`currentPhase === 'Complete'`, a doc with `packStatus === 'Packed'`, or a shop doc with `status === 'Completed'`.
Three ways that catches an order still being worked:

1. **"Still in packing."** A finishing doc goes `currentPhase 'Complete'` when it leaves the paint line
   (`ActiveFloor.js:402`), *before* the WMS packs and puts it away. "Complete" on the fin doc means "off the
   finishing floor", not "order done" — but the audit reads it as done. Likewise `packStatus 'Packed'` is set
   at pack (`PickPackApp.js:1833`), before put-away / shipment.
2. **Pick-only orders are born "Complete".** Since B5 part 2 (aacf078, 09-08) the split writes a pick-only
   floor doc with `currentPhase: "Complete", pickOnly: true` (`RTGDispatchTab.js:1306`) for every all-plated or
   custom-only sales order — so every such order reads `FLOOR_DONE` from the moment it is created, while the
   WMS is still picking it.
3. **"Still in finishing."** The audit runs over shop docs too. A CPQ order whose custom half finished
   (`shop_custom_orders.status === 'Completed'`) while its small parts are still in Painting raises
   `FLOOR_DONE` on the SHOP doc; "Close all" then closes the whole order — the finishing sibling in Painting
   included — because the closer walks every linked doc.

**Why the sync looked "off" when it was not.** The floor DOES tell the record: `propagateFloorState` stamps
`floorPhase` on the hq record at every completion. But `isDoneState(parent)` never reads `floorPhase` — it
reads `currentPhase / status / packStatus / closed`, fields the hq record does not carry in those forms. So the
audit cannot see the propagation the record already holds, and flags the order as "board doesn't know" even
when the board knows exactly. The record was right; the audit's test was wrong, and the bulk button trusted
the audit.

### 1b. What "Close all" did to each order (the blast radius — `closeOrderEverywhere`, `orderLifecycle.js:154`)

- every linked `fin_workorders` doc → `currentPhase 'Closed', stepStatus 'Closed', status 'Closed',
  sentToPickPack: false, pickStatus 'Closed'` — **it vanished from the WMS pick/pack queues and the finishing
  floor**; the previous `currentPhase` / `pickStatus` values are OVERWRITTEN (not kept);
- every linked `shop_custom_orders` doc → `status 'Completed', closed: true`;
- the hq record → `status 'Closed'`;
- **every OPEN `rod_cut_orders` for the order → `CANCELLED`** ("the cut was still open; no inventory moved");
- **every PENDING/FAILED `ns_outbox` entry whose writeBack names the order's docs → `CANCELLED`** (a queued
  assembly build for a packed order, a Route A work order, a fulfilment); in-flight ones flagged
  `postedForClosedOrder`;
- where a NetSuite WO was open: `nsWoCloseRequired: true` on the record → the panel now shows an
  `NS_CLOSE_TODO` for each ("close it in NetSuite by hand").
- Every touched doc carries the fingerprint: `closedFrom: 'RTG_RECONCILE_ALL'`, `closeReason: 'FLOOR_DONE'`
  (or `'FLOOR_CLOSED'`), `closedAt` = this morning, `closedBy` = Stuart. **That fingerprint is the recovery
  list.** The Daily Job Log holds "⇄ Bulk close: n/N…" lines but not per-order ids.

### 1c. What to tell Stuart NOW (before any code)

- **Do not press "✓ Closed in NetSuite" on the new `NS_CLOSE_TODO` rows and do not close those work orders in
  NetSuite** — they belong to live orders.
- **Do not Retry or Cancel anything in 11.1 → NetSuite Sync Queue yet.** The CANCELLED entries stamped this
  morning are part of the recovery (11.1 offers ↻ Retry on CANCELLED, `NetSuiteSyncTab.js:1644`; use it only
  after the order is reopened, or a build posts for a closed record).
- The rod cuts cancelled this morning are still physically wanted; the saw must not treat the tab as truth
  until they are reopened.

### 1d. The plan to propose (two issues, in this order — plan, then WAIT)

**Issue 1 — Reopen (an in-app admin tool; App Check forbids scripts).** On the Board vs Floor panel, a
"⟲ Reopen the 2026-09-10 bulk close" action that: lists every `fin_workorders` / `shop_custom_orders` /
`hq_work_orders` / `hq_sales_orders` doc with `closedFrom === 'RTG_RECONCILE_ALL'` in this morning's window,
**dry run first** (the list, per doc: what is still on it — `completedAt`, `packStatus/packedAt`, `putawayBin`,
`tasks.*` statuses, `pickedAt/stagedAt`, `shopSiblingId/hasCustomSibling`, `customFabStatus`); then, on
approval, restores each from what is still on the doc — never a guess: a fin doc with `putawayBin` / shipped →
leave closed (it WAS done); with `packStatus 'Packed'` → `currentPhase 'Complete'`, pack state as stamped;
with `completedAt` and no pack → `currentPhase 'Complete'`, `sentToPickPack: true`, `pickStatus` back to
the pre-close value if it can be read from `hq_logs`, else `'Pending'` with a red "REOPENED — confirm pick
state" chip the WMS shows; with `tasks.*` partly done and no `completedAt` → `currentPhase 'Painting'` at the
recorded step; the shop doc → `status` from `startedAt/completedAt` (`'In Process'` or `'Completed'`),
`closed` removed; the hq record → `status 'Dispatched'`, `nsWoCloseRequired` removed; cancelled rod cuts with
this order's reason → `OPEN`; `ns_outbox` entries cancelled with this order's reason → `PENDING` (the worker
picks up PENDING; marker recovery prevents a double post). Every reopened doc stamped `reopenedAt/By/From`
and the ledger written. Downstream trace: finishing sees its jobs back in the Setup Queue / Active Floor at
the recorded step; the shop sees Completed customs stay Completed and in-process ones return; the WMS sees
the picks and packs return with a chip that says they were reopened; NetSuite gets the queued writes it was
owed and no close tasks. Ask Stuart which orders he already reopened by hand so the tool skips them.

**Issue 2 — Prevention.** (i) `FLOOR_DONE` is never bulk-closable — remove it from the "Close all" set (a
finished-on-the-floor order is closed by PUT-AWAY / SHIPMENT, or by a person one at a time); (ii) the audit
compares the floor to what the record already knows: `isDoneState(parent)` reads `floorPhase` (`Complete /
Packed / Shelved / Plated`) as done, so a propagated completion is not an orphan; (iii) `FLOOR_DONE` requires
the WHOLE order done (every linked doc), not one doc — a Completed shop half beside a Painting fin doc is
normal work, not a finding; (iv) pick-only docs (`pickOnly: true`) are never "done" until packed and put
away; (v) the closer keeps the previous `currentPhase / pickStatus / sentToPickPack` in a `closedFrom*`
snapshot so a reopen never has to infer again. Node-test every rule in `scripts/orderLifecycle.test.mjs`
(the fixtures: a Complete fin doc unpacked; a pick-only doc; a Completed shop half with a Painting sibling;
a propagated `floorPhase 'Complete'` parent). Then the guide's "Close and Delete mean the same everywhere"
paragraph says what Close all does and does not touch.

**Hand-off to S3 after Issue 1:** the WMS should show the "REOPENED" chip and refuse nothing; the finishing
floor's Setup Queue reads the restored phase. S3 verifies both on their tablets.

## 2. Territory

**Own:** `HQ/RTGDispatchTab.js`, `StockViewTab.js`, `LibraryTab.js` (WO/PO/repaint paths only), `LibraryMassUpdateTab.js`
(4.5); `Shared/workOrderCreate`, `floorRelease`, `orderStatus`, `orderLifecycle`, `workOrderContract`, `orderHold`,
`purchaseOrders`, `poLock`, `platingDemand`, `finishedRunPrecheck`, `finishedGoodsRun`, `stockRun`, `oeReviewPlan`,
`poleCut`, `finishRouting`, `sourcing`, `backorder`, `backorderBoard`, `splitPlan`, `repaintRun`, `repaintSource`,
`paintOnly`, `woRef`, `shortId`, `scrapClose`, `stockReviewRows`.

**Read-only:** S1's (`CPQTab`, `QuickShipTab`, `ExternalCoopTab`, `nsTransmit`, `salesOrderHeader`,
`lineClassification`, `hardwareHandoff`); S3's (`PickPack/*`, `FinishingFloor/*` — **including `SetupQueue.js`**,
`ShopFloor/*`, `functions/`, `nsOutbox`, `nsWorkOrder`); S4's, S5's. The Setup Queue re-make (§3 #16) is
therefore a patch spec to S3, not your edit.

## 3. The work, in order (after §1)

Numbers are `STATE_OF_THE_APP_2026-09-10.md` §2 item numbers.

**Proof first**
1. **#1 the live pass on Stuart's orders** — for each of his sales orders: the record on the board from
   creation, the split (stock first for plated lines, pick-only doc when nothing needs spraying, BACKORDER
   chip when short, the floor doc ON HOLD when the flag is off), the chip words, the release through the
   right door, the Route A anchor on a stock WO, the closer on one you delete. Screenshot each state; note
   anything the chip does not explain.
2. **#5 repaint from each door** (Master Library, then the Snapshot row) — the writer moved files after the
   Library tool was tested.
3. **#6** hand Stuart the Firestore console step for `rootBuildAuto` when three clean ⛏ posts are in.

**Hand-offs that never landed — all in your files, all small**
4. **#9** `releaseFinWoToFloor` writes through `buildFinDoc` (`finishedRunPrecheck.js:334`). Behaviour identical
   for what it stamps today; the sales release gains urgent / holds / needBy; never both streams.
5. **#10** `executeMakeupActions` shop write through `buildShopDoc` (`:271`).
6. **#11** `clearConvertGate` stock branch → `releaseStockWoToFloor` (`:377`); the spec is in
   `BRIEF_A_WO_PO_CREATION.md` "Hand-off from B — clearConvertGate's STOCK branch".
7. **#13** `resetWoToSetup` → `propagateFloorState` (`StockViewTab.js:1762`); spec in the same file.
8. **#15** the RTG PO line editor: `if (poLinesLocked(e.po)) return alert(poLockMessage(e.po));` and hide ✎ on a
   locked card (`RTGDispatchTab.js` ~:163–190). `Shared/poLock` has 13 assertions already.
9. **#16** → patch spec to S3: retire the Setup Queue "⟲ Create Re-make WO" for stock (`SetupQueue.js:686`,
   writer at `:525`); the guide's honest-matrix row goes with it. Custom re-issue stays RTG's (`INTENT.REISSUE`).
10. **#12** → patch spec to S3: the WMS rod-cut completion calls `releaseStockWoToFloor` (spec already in
    `BRIEF_D_WMS.md` "the rod-cut / convert completions RELEASE a stock order"). After #6 and #12 land, the RTG
    tab is the safety net, not the mechanism — say so in `RTG_CONTROL_BRIEF.md` §1, which currently claims it.

**Owned, not blocked**
11. **#31** delete the legacy enrich branch after a week of zero (from 09-09; the Stock Builds panel title counts).
12. **#32** delete the Setup Queue outsourced group once observed empty — S3's file; you confirm "empty", S3 deletes.
13. **#37** the Stock View "📋 Open POs" twin — ask Stuart first (STATE §3 Q10 recommends deferring).
14. **#39** `stockCheckReport` unknown-as-zero — a proposal to Stuart, never a silent change.
15. **#40** the receiving-tab receipt shape (per-line `receivedAt/By`, a short/over field that is not
    `scrapQty`) — settle with S3, who owns the tab that reads it; you own the writer.
16. **#41** A6 leftovers (identity/display suffix reads) — only when a commit already touches the line.
17. **#55** the three `BRAND_NETSUITE_MAP` copies → import `Shared/brandNetsuite` in `StockViewTab` and `LibraryTab`
    (S1 owns that module; the import is yours). Then correct the CLAUDE.md bullet.
18. **#56** verify the Library run stamps `poles/totalPoles` through `buildStockFinPayload`; if not, the guide's
    "poles released from the Master Library run as small parts" edge is still true and stays.

**Waiting on Stuart (relay through the communicator)**
- #24 tag `material = WOOD` on `H1-138WHTOAK-*` (4.5) — the wood rule is live and dormant until then.
- #25 `HCUMSBF15` in-house tag; clear `WO-HCUMSBF15-N25-655308-4`; close / re-issue WO11588 (pull 7674).
- #26 close the two 14-Aug Order Entry orders in NetSuite.

## 4. Acceptance — on Stuart's orders, pinned in

| run | expect |
|---|---|
| a CPQ order with a plated small line, short | BACKORDER chip; row on Stock View 📋 Backorders; floor doc on hold; flag Finish as available → hold releases, engine takes the siblings |
| an all-plated CPQ order | pick-only doc; nothing in the Setup Queue; WMS picks and packs |
| a custom-only CPQ order | pack document exists; shop Complete & Label plated → 'Sent to Plating' → pack refuses → WMS receipt → 'Complete' → pack allows (S3 watches the receipt) |
| a stock order deleted on RTG | closer line names the rod cut cancelled and any queued NetSuite write |
| a cancelled PO behind a receipt gate | Board vs Floor shows the stranded gate → ⬆ Lift → parked, not released → override from View |
| a straight wood rod / a mitered one | finishing / shop (once #24 is tagged) |
| a WMS rod-cut completion with NO RTG tab open (after #12) | Setup Queue shows the order within seconds; 11.1 shows its WO |

## 5. Questions for Stuart (ask through the communicator or in-session; both count)

1. §1 — the problem, in the shape above.
2. STATE §3 Q3 — delete the Setup Queue re-make now (S3's file, one commit)? Recommended yes.
3. STATE §3 Q7 — the four A-side hand-offs as one issue, four commits? Recommended yes.
4. STATE §3 Q10 — the Open POs twin: still wanted? Recommended defer.
5. STATE §3 Q14 — when does he read the legacy-release count and the outsourced group as empty?

## 6. Hand-offs in

*(other sessions append patch specs here; strike when landed)*

## 7. Status log

*(newest first; one line per commit or decision, with the hash)*

- 2026-09-10 · **6c72e80** (pushed on Stuart's "push", carried S1's a58d126 with it) · Issue 1: `Shared/orderLifecycle` gains `reopenPlanFor` / `planBulkReopen` / `applyBulkReopen` (pure rules, 66 assertions green); RTG Board vs Floor gains **⟲ Reopen a bulk close** (dry run → confirm → write, ledgered as `BULK_CLOSE_REOPEN`). Handed the WMS `reopenConfirmPick` chip to S3 (their § Hand-offs in). Issue 2 (prevention: FLOOR_DONE never bulk-closable, parent reads `floorPhase`, whole-order test, pick-only never done until packed, closer snapshots the pre-close state) is next; until it lands "Close all" on FLOOR_DONE stays a trap — the panel copy says so.
- 2026-09-10 · Stuart: none of this morning's closed orders were reopened by hand; **go on Issue 1** (the reopen tool, dry run first, restore from stamps only). He holds a hand list of statuses to check the result against. Live read before the plan: bulk close ran ≈08:31 (the one outbox entry it cancelled: NS Fulfillment WO-SO60152, 08:31:06); 148 NS_CLOSE_TODO rows raised, 0 FLOOR_DONE left, 4 FLOOR_CLOSED (SO59732/SO59752) untouched by this issue. Named, not fixed: the closer raises NS_CLOSE_TODO off the hq record's nsWoId without reading nsWoCompletionPosted (WO11529/11588/11593/11594 already built).

## 8. Opener (paste to start the session)

```
You are the S2 session — RTG Dispatch · work-order and purchase-order creation (the control spine). Read,
in order: CLAUDE.md (the working agreement binds you), SESSION_COMMS_2026-09-10.md (the map, the file
ownership, the hand-off protocol — briefs are the channel, SendMessage is gone), STATE_OF_THE_APP_2026-09-10.md
(the state; your items are named in BRIEF_S2 §3), BRIEF_S2_RTG_WO_PO.md (your brief), then
RTG_CONTROL_BRIEF.md, BRIEF_WO_PO_SPINE.md, BRIEF_REPAINT_JFP_JOINT.md and WORK_ORDER_CONTRACT.md for the rules
as they stand. Standing rules S1–S5 (top of BRIEF_A_WO_PO_CREATION.md) bind you. ⚡ Auto-release is ON.
Stuart's live customer orders are the round-trip tests — never raise your own. Four other sessions work this
repo: S1 (CPQ/Vision/CRM — owns the sales doors and the engine), S3 (WMS/Finishing/Shop — owns SetupQueue.js
and every NetSuite inventory write), S4 (portal/payments/UPS), S5 (spec sheets/kits/marketing). When your
work crosses a line: stop, write a patch spec into THEIR brief's § Hand-offs in, log it in your § Status log.
Git: never switch branches, stage only your files, pull --rebase --autostash, safe-push check, eslint 0
errors, verify by marker sweep of asset-manifest.json. Plan first and wait — every time. One issue at a time.
First: ask Stuart to state the immediate problem in the shape of BRIEF_S2 §1, read the record on the board
and the Transmit Log, then plan. Identify as "(S2)" in every commit.
```
