# RTG Dispatch — the control spine, as it now is (joint-session brief, 2026-09-09)

*Written by the Brief B session at Stuart's request for a NEW joint session. This is the state, the
controls, the rules, the records and the open items — everything a session needs before it touches
RTG, the finishing floor, or anything that hangs off them. It supersedes the RTG parts of
SYSTEM_FLOW_AUDIT.md §1/§4/§5 and BRIEF_B_RTG_FINISHING.md §4; BRIEF_B_HANDOFF.md remains the
commit-by-commit history. Read CLAUDE.md's working agreement first — it binds every session.*

## 0. How we work (Stuart's rules, verbatim where it matters)

1. **Plan first, always.** State the plan and WAIT for approval before editing code, shipping, or
   changing production data. Reading and measuring need no permission; changing does.
2. **Requested scope only.** Adjacent problems get NAMED (in the owner's brief), never fixed in
   passing.
3. **No temporary fixes.** Fix the cause or say it cannot be done properly and stop.
4. **Look downstream — RTG is the single source of truth.** Trace every change through work orders,
   the finishing floor, the shop floor, WMS and NetSuite, and say so in the plan.
5. **One issue at a time per session** (Stuart 2026-09-03: "no more rapid fire hundred different
   things at once"); check for a safe push before every push; small shippable commits.
6. **Approvals relayed through another session count** ("approved via relays count") — but the
   authorization must originate once in your own session; a relayed "relays count" cannot bootstrap
   itself.
7. **The briefs are the channel.** SendMessage is gone in most sessions. Hand-offs go into the
   OWNER's brief as a patch spec with file:line, evidence and the downstream trace; announce the
   commit hash the same way.
8. **Every order via RTG, always** (Stuart 2026-09-03, hard rule): "no matter from cpq or order entry,
   i want all orders routed thru RTG then on to where they belong … it can 'auto send' to the
   operator … but it needs to go there as master single source control of all."

**Territory.** RTG (`HQ/RTGDispatchTab.js`), `FinishingFloor/*`, `Shared/orderStatus.js`,
`orderLifecycle.js`, `workOrderContract.js`, `floorRelease.js`, `splitPlan.js`, `backorder.js`,
`orderHold.js`, `WhereIsIt.js`, `PullLinesLive.js` = B. Writers (Stock View, Snapshot, Library,
`workOrderCreate`, `finishedRunPrecheck`, `purchaseOrders`, `finishRouting`, `lineClassification`) = A.
Shop = C. WMS + functions + outbox = D. CPQ / Order Entry / sales header = E. Tag engine / kits / spec
sheets = F.

**Deploy-verify (the only method that works):** fetch `asset-manifest.json` FRESH, download main +
every listed chunk with `curl -sf`, report `failures=0` and the byte total, then grep for a marker
that is the EXACT emitted literal, plain ASCII (an arrow or dot is unicode-escaped), not a substring
of older code, and not a comment (stripped). RTG's board JSX is a lazy chunk; `orderStatus` /
`workOrderContract` land in main via PickPack. In zsh iterate with `while read -r`. Run node tests
BARE, never `| tail` inside `set -e` (it hides a failed test). Pure modules import `'./x.js'` with the
extension so node can run them.

## 1. The spine — how an order moves now

```
CPQ / Vision / Portal / CRM ─► hq_sales_orders (recipe stamped at save, needBy, recipeSource)
Order Entry (tab 7) ────────► hq_sales_orders QUICKSHIP (record only) + to-be-finished WOs via the review gate
Stock View / Snapshot / Library / Raw Cores / pre-check ─► parkWorkOrder (A) ─► hq_work_orders, parked
                                                          (source · intent · routeTo · finPayload · gates · autoFlow)
                     │
                     ▼
        RTG — THE ONE RELEASE ENGINE (⚡ toggle = kill switch)
        every Approved record whose gates are clear (orderStatus.isReleasable) and whose sales
        order is not waiting for its other lines (wholeOrderWait) goes through its door:
          · CPQ sales order  → autoSplitSalesOrder → buildFinDoc / buildShopDoc (+ packaging)
          · sales-typed WO   → releaseFinWoToFloor (A) — the SO is its NetSuite record
          · stock WO         → releaseStockWoToFloor (Shared/floorRelease) = buildFinDoc + ROUTE A
                               (the NetSuite work order queued at that moment, writeBack to both docs)
          · SHOP route       → pushToShop → buildShopDoc
        The WMS CONVERT completion (A's clearConvertGate, stock branch since 2026-09-12) calls the same
        shared release; the WMS ROD-CUT completion still waits for an open RTG tab (S3's #12).
                     │
          fin_workorders  ──► Setup Queue → Active Floor → WMS pick (Start Setup / shop START releases it)
          shop_custom_orders ► Shop Floor; START releases the sibling pick; COMPLETE mirrors
                               customFabStatus (Pending → In Process → Sent to Plating → Complete)
          rod_cut_orders ────► WMS Rod Cuts (done there only; RTG shows the read-only record)
          plating_demand / PO ► WMS Plating; receipt → build-back → 'Complete' (D)
          ns_outbox ─────────► every NetSuite write; dies with its order on close/delete
```

**The gates (one list, `orderStatus.GATES`, in flow order):** soAccept · nsWo · receipt (material) ·
components · convert · rodCut · dispatched. Each declares `open`, `label/detail`, `help`, `clearedBy`,
its `clearer` (A: what document would lift it — the audit checks it still exists) and its `lift` (the
hand patch; the receipt gate's is A's `cancelReceiptGate`). Readers: the engine, the release confirms,
the board's gate lines, the AUTO-FLOW chip, Where-Is-It, A's `clearConvertGate`, D's rod-cut cancel.
Add a gate here and every reader sees it.

## 2. The controls a person has (and what they do NOT have)

| control | where | what it does |
|---|---|---|
| ⚡ Auto-Release ON/OFF | RTG toolbar | the kill switch for ALL releasing. ON = everything auto-routes; orders parked before the switch wait for the override. Stuart: keep it ON. |
| the row chip | every parked SO / WO row | the gate words, or why nothing will take it, or "releasing…". **No Push buttons exist.** |
| ⚠ Supervisor override — release now | the order's View | the ONE manual release: names what the engine waits on, confirms, logs your name, releases through the same door (still anchored) |
| ⚡ Flag urgent | SO / WO cards | red, top of the board, pinned on the Setup Queue until acknowledged |
| ⚡ Finish as available | SO cards (RTG) + WMS SO Pack | the OUTLIER flag with a reason, who/when: in-stock parts run now, late parts follow. Default = wait and finish complete. ON releases the split's backorder hold. |
| ✓ Approve → NetSuite / ✉ Mark sent | PO panel | review-and-approve; every open PO stays on the board Draft → … → Partially Received |
| ✕ Close · × Delete | RTG cards | the same closer: floor docs closed, open rod cut cancelled, queued NetSuite writes cancelled, in-flight ones flagged, NetSuite close task raised; Delete adds the ledger tombstone |
| ⚖ Close short · ↻ Re-issue | dispatched WO rows | balance close + re-issue via `INTENT.REISSUE` (A) |
| 🔨 Post build now · 🏭 Queue the missing NetSuite WOs · ⛏ Mill build | RTG heals | the anchors/builds nobody posted; ⛏ stays until D3's auto build is turned on per brand |
| Board vs Floor panel | RTG | every disagreement: floor done/board live, closed one side, demand/rod-cut orphans, NetSuite close to-dos, **stranded gates (⬆ Lift the gate — stops the wait, never releases)**, NetSuite writes posted after their order closed (✓ Closed in NetSuite) |
| ✂ Rod cuts open | RTG, under Work Orders | read-only file-cabinet copy; the cut is done at WMS → Rod Cuts only |
| 📋 Backorders · n | Stock View 12.5 (A) | true backorders oldest first with what covers each; Order it drops the shortfall into the grid |
| Start Setup / Stage to floor | Setup Queue | refuses while the order's rod cut is still open; a PENDING-RECIPE card names where the recipe was looked for; JFP View Item shows what is painted and what is pulled |
| Report scrap (QC) | Active Floor | scrap reaches the RTG row in red; a custom-order shortfall blocks completion (red line); no re-make from the floor for stock (the Snapshot addresses it) |

## 3. The rules (settled, do not re-derive)

- **Every order via RTG.** Order Entry / Quick Ship SOs are on the board as RECORDS (WMS chip, linked
  WOs) and are NEVER split there — the `hqJobId` requirement on the split is load-bearing.
- **Doors by type.** Stock → Route A at release; sales-typed → the SO is the record (A's release);
  SHOP → pushToShop. A stock order must never go through the sales door (five unanchored builds,
  2026-09-04).
- **Finish complete by default; Finish as available is the outlier** (`wholeOrderWait`; the split writes
  a short order's floor doc ON HOLD, `heldReasonKind:'BACKORDER'`).
- **Stock first at the split.** A plated finish is NOT plating work: after the SO posts, plated lines
  are checked against live `available` (net of commitment): covered → pick; short → true backorder;
  unreadable → picked with a warning, never a shortage. **No plating demand is raised at the split**
  (the Snapshot issues PO + demand + core-short WO together, Q4).
- **True backorder** = plated with none on hand, or painted with no finished, no /P and no mill stock.
  Unreadable = data fault, not demand.
- **Outsourced finishes never enter the finishing floor.** An order with nothing to spray gets a
  PICK-ONLY floor doc (born Complete, `pickOnly`); the custom half goes shop → plater; the Setup
  Queue's outsourced group is to be deleted once observed empty (Library run converted, cfc613d).
- **The custom half's four states** are the contract; `customPartsReady` is the pack gate; the WMS
  receipt is what turns 'Sent to Plating' into 'Complete'.
- **A gate is evaluated in one place, set by the writers, cleared by the WMS / outbox / RTG's component
  effect.** The receipt gate clears only when RECEIVED covers `qtyNeeded` (A's rule, Stuart accepted).
  Cancelling a rod cut lifts the gate (D). Lifting by hand never releases.
- **Closing cancels.** Close = Delete everywhere; an open rod cut dies with its order; a queued NetSuite
  write dies with its order (Stuart: cancel, not hold); in-flight ones are flagged for a person.
- **Wood rods route by their CUT** (straight → finishing, mitered/bent/spliced → shop) because the
  split passes the cut facts; silence keeps the item tag. Do not retag the rods.
- **The pole rule is the suffix** (mill, /P, /EP, /MEP, /P25 = Custom; /BS /N90 /CP = Small Parts);
  a 4/6 ft pole is CUT from 8 ft unless the length is on the shelf (A's panel decides; a short pole
  never parks where nothing can reach it).
- **The recipe is stamped at save** (E); the split reads it first and says which source answered.
- **Poles XOR sled** on a finishing doc — `buildFinDoc` asserts it (WO11535 class).
- **The BOM pin must resolve** — an internal id is never a pull code; refuse and say "fix the BOM or use
  JFP" (A).
- **JFP** never checks quantity; its put-away adjustment must carry a dedupeKey (D).
- **Auto-release runs in the board, the shared release runs anywhere.** Nothing waits on a tab.

## 4. The records — the vocabulary every screen reads

- `hq_work_orders` (A's stamps): `source · intent · routeTo · orderType · autoFlow · itemCode · type
  · recipe · finPayload · poles/totalPoles XOR paintSize(s) · finishStream · partsList · the gates
  (`awaitingRodCut/rodCutId/rodCutNote · awaitingConvert/convertDemandIds/convertGateNote ·
  awaitingComponents/componentShopWoIds · awaitingSoAccept · awaitingNsWo · awaitingReceipt/
  receiptRefs[{poId,itemId,qtyNeeded}]/receiptGateNote`) · `nsWoQueued/nsWoId/nsWoTran` ·
  `pushedToFinishing/pushedToShop/status` · `floorPhase/floorCompletedAt` (propagated) ·
  `scrapReported/By/At, redlineAlert` · `legacyEnriched` · the gate lift stamps`.
- `hq_sales_orders`: E's header (`recipe, recipeLabel, recipeSource, recipes[], needBy, readyDate,
  leadWeeks, …`) · `finishAsAvailable/At/By/Reason` · `backorderLines[]` · `autoSplit, pushedTo*` ·
  QUICKSHIP: `status === pickStatus` in Pending | Picked | Shipped, `pick/packInProgress` (claims).
- `fin_workorders` (built by `buildFinDoc`): the contract §3 + `needBy · recipeSource · dispatchedAt/By
  · held/heldReasonKind · pickOnly/finishingRequired · partsList[].pickOnly/stockUnknown/noFinish ·
  cutSheetMissing/visionUsed · fabNotes.traverseCuts/drive/setup/frontLayer · customFabStatus/
  customFabAt · nsWoId/nsWoTran · nsWoCompletionPosted · scrapReported`.
- `shop_custom_orders` (built by `buildShopDoc`): `finSiblingId/hasSmallSibling · category/routeTo ·
  isOutsourced (shared finish rule) · needsPhosphating · shopInstruction · cutList · fabNotes ·
  cutSheetMissing/visionUsed · status Pending → In Process → Completed | Sent to Plating`.
- `rod_cut_orders`: `status OPEN | DONE | CANCELLED · finWoId · purpose · createdVia · qtySource/
  qtyTarget · cancelReason`.
- `ns_outbox`: `status PENDING | PROCESSING | POSTED | FAILED | CANCELLED · dedupeKey · writeBack[] ·
  postedForClosedOrder/AckAt`.
- `floorPhase` vocabulary on the record: Setup · Painting · Complete · Packed · Shelved · Plating
  Received · Plated · Failed (mill).

## 5. Where a stuck order says why

RTG row chip (gate words) · RTG SO card (BACKORDER chip, FINISH AS AVAILABLE) · Setup Queue card
(PENDING-RECIPE names `recipeSource` + SO; "not sent to WMS" says why; refuses Start while a cut is
open; JFP View Item) · WMS pending window (D's reasons; "custom parts at the plater") · Where is it?
on every screen · Board vs Floor (stranded gates, orphans, NetSuite to-dos) · the Daily Job Log.

## 6. Commits this week (B's, in order) — see BRIEF_B_HANDOFF.md for the per-commit proof

| hash | date | what |
|---|---|---|
| ec4b5e3 | 2026-09-08 | 🔒 A purchase order is final once it has left us — the rule, provable, and in the guide |
| 7d86d15 | 2026-09-08 | 📖 The guide catches up with 8 Sep — finish complete vs as available, stock first, true |
| 96b4983 | 2026-09-08 | 🪵✂ The split passes the cut facts, so a straight wood rod goes to finishing · and a r |
| b313082 | 2026-09-08 | 🛤 The traverse cut sheet on the card · reopen ends its plating demand · C2 through the |
| 5571d77 | 2026-09-08 | 🧴 A plating demand's END has one home too — and the shop can cancel one (Brief D, for  |
| b6c5921 | 2026-09-08 | 🛤 The traverse cut list rides to the floors — fascia / track / F-clip by drive, on fab |
| c05b974 | 2026-09-08 | 📋 True Backorders — the board: oldest first, what covers each line, and which nobody h |
| 0002224 | 2026-09-08 | ⛔ True backorders — one definition, recorded at the split, shown on the RTG card (B's h |
| 8654021 | 2026-09-08 | 📋 True backorders — the definition (plated: none on hand; painted: no /P and no raw mi |
| 0702ea4 | 2026-09-08 | 🧪 splitPlan imports finishRouting.js explicitly so its node test actually runs (17 asser |
| aacf078 | 2026-09-08 | 🧭 Stock first at the split — a plated line is picked from stock or backordered, never  |
| c0dd116 | 2026-09-08 | 📖 Guide: tab 1 Review CAD (.stp) — open, look, save as a design of its own (Brief F se |
| 80972b2 | 2026-09-08 | 🎨 The split reads the stamped recipe first — and says which source answered (B4) |
| 2736a56 | 2026-09-08 | 📋 Brief A hand-off from B — a 4 ft pole parked on the material gate with 474 × HCUMP8 |
| 2869196 | 2026-09-08 | ✂ Cancelling a rod cut lifts the gate it was holding (Brief D · A's D-1) |
| 1013530 | 2026-09-08 | 🚪 Delete calls the closer; a stranded gate lifts from the audit; a queued NetSuite write |
| 7923d03 | 2026-09-08 | 🚪 A gate declares what would lift it — and the audit checks whether that thing still e |
| c4f21fc | 2026-09-08 | 🎛 Vision asks the engine's framing axes — Rod Type, Single or Double, Front of the Dou |
| 8d73441 | 2026-09-07 | 🎛 An untagged plate pool is still a gated pool — platePoolFrom applies the live gate o |
| f5200d5 | 2026-09-07 | 🎛 Vision asks the rod type first — Solid or Traverse, then projection, and the engine' |
| 62ad937 | 2026-09-04 | 🔗 A shop job's own id names its RTG parent — identityKeysOf learns SHOP-<id> (B7) |
| 1aeac6e | 2026-09-04 | 📖 B9 — the guide moves with the code: RTG is the record and the control (no push butto |
| ff69f79 | 2026-09-04 | ⚡ B3 — one release engine, no push buttons, one supervisor override, POs reviewed and a |
| beba981 | 2026-09-04 | ⚠ Scrap reported at QC reaches the RTG record — and the card says so |
| 590ca08 | 2026-09-04 | 📋 Sweep hand-offs from B — Stock View's Reset→Setup tells the RTG record (A); Shop R |
| e87d991 | 2026-09-04 | 🏷 A joiner prints "no finish" on the pull lines — the Unfinished tag, read where the f |
| e72e7ce | 2026-09-04 | ⚡ "Finish as available" on the RTG sales-order card — the outlier, set with a reason, l |
| f60fc29 | 2026-09-04 | ✂ A missed cut cannot go unnoticed — closing an order cancels its open rod cut, and the |
| acec131 | 2026-09-04 | 📋 Briefs D + A hand-offs from B — the rod-cut and convert completions call releaseStoc |
| f68a68c | 2026-09-04 | 🏭 One stock release, callable from anywhere — Route A leaves the RTG tab (Shared/floor |
| fc6e4d1 | 2026-09-04 | ⚓ The auto-flow door matches the order — stock builds release through Route A and get t |
| f2c20f0 | 2026-09-03 | 📋 Brief B handoff — B5/B2 + the Order Entry board rows shipped and verified; the queue |
| 67ad06d | 2026-09-03 | 🧾 Order Entry sales orders are on the RTG board — as the record, never a dispatch sour |

## 7. Open items, by owner

**B:** delete the legacy enrich branch after a week of zero (from 2026-09-09; the board's title counts
"legacy releases this week" — Stuart reads it); delete the Setup Queue's outsourced group once it has
stayed empty; a staging-age flag on the Setup Queue (picked parts sitting at staging n days) — a new
rule, only if Stuart wants it.
**A:** Reset → Setup propagates to the record; the Backorders board's first live run.
**C:** the cut sheet lists traverse rows (spec in Brief C); Reopen cancels its plating demand (shipped b313082 per C's handoff — verify live).
**D:** JFP adjustment dedupeKey; arrival stamp on backorder lines + releasing the BACKORDER hold; SO
Pack toggle releasing the hold; the WMS empty state for cuts under another brand; onMillComplete flag
per brand.
**E:** Order Entry lines through `Shared/backorder.classifyLine`; delete the reqDate/needByDate aliases
(the split writes `needBy`).
**Stuart:** reverse one of IA26935/IA26936; close or re-issue WO11588; the four Fabricut orders' wood
poles routed to the shop (accepted for those).

## 8. Acceptance runs still owed on live data

1. A CPQ order with a plated small line that is short → BACKORDER chip on RTG, row on Stock View's
   board, the floor doc ON HOLD; flag Finish as available → hold releases, engine takes the siblings.
2. An all-plated CPQ order → pick-only doc; nothing in the Setup Queue; WMS picks and packs it.
3. A custom-only CPQ order → the pack document exists; shop Complete & Label with a plated finish →
   'Sent to Plating' → pack refuses → WMS receipt → 'Complete' → pack allows.
4. A stock order deleted on RTG → closer line names the rod cut cancelled and any queued NetSuite
   write (proven once, WO-STK-49005).
5. A cancelled PO behind a receipt gate → Board vs Floor shows the stranded gate → ⬆ Lift → parked,
   not released → override from View.
6. A traverse order → both floor docs carry `fabNotes.traverseCuts`; the shop cut sheet lists them.
7. A straight wood rod → finishing; a mitered one → shop.
