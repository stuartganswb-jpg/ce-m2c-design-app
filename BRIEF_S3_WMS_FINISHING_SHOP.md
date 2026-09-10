# Brief S3 — WMS · Finishing Floor · Shop Floor · the outbox and the NetSuite functions

*Written 2026-09-10 by the communicator session. You start THIRD. Read, in order: `CLAUDE.md`,
`SESSION_COMMS_2026-09-10.md`, `STATE_OF_THE_APP_2026-09-10.md` (your items: §1 C and D, §2.1 #2–4, §2.2 #12, #14,
#16, #18–19, §2.3 #23, #27, §2.4 #33–36, #42–43), then `WMS_BRIEF.md` (the warehouse in one document),
`SHOP_FLOOR_CONTINUATION_BRIEF.md` (the shop as it now is, with the exact live script for the plating round
trip), the finishing-floor parts of `RTG_CONTROL_BRIEF.md` (§2 controls, §5 where a stuck order says why),
`WORK_ORDER_CONTRACT.md` §5–5c, and the memories `brief-c-shop-floor-session`, `pickpack-in-main-bundle`,
`deploy-verify-asset-manifest`, `wms-assembly-build-component-bin`, `rod-cuts-wms`, `finishing-order-release-flow`.
`BRIEF_C_HANDOFF.md` and `BRIEF_D_HANDOFF.md` are history.*

## ⛔ Working agreement + standing rules

Plan first and WAIT. Requested scope only. No temporary fixes. Trace downstream. One issue at a time.
**Two rules this territory lives by:** every NetSuite write here **moves real inventory** — nothing posted
twice, from two places, or guessed; and `functions/index.js` **does not auto-deploy** — every functions change
ends with the Cloud Shell command for Stuart and a verification it is live. **The floors receive work; they
never route it.** If a doc arrives in the wrong queue, the bug is upstream (S2) — name it, do not filter it.
**Outsourced finishes never enter the finishing floor.** A validator refuses only on complete knowledge.
Never guess a number a person would act on.

## 0. Operating

- Three PIN-gated front-ends: `/pick-pack` (Sandra, Andrea — Spanish-first, `Shared/i18n.js`),
  `/finishing-floor` (Grace, chip PINs from `fin_users`), `/shop-floor`. Stuart pins you in with
  Claude-in-Chrome; ask for a floor tablet view when you need the queue as the operator sees it.
- **PickPackApp, ShopFloor and the FinishingFloor compile into `main.*.js`** — sweep main (and every
  chunk) with `curl -sf`, report failures and bytes. The User Guide is a numbered chunk.
- Cloud Shell: `cd ~/ce-m2c-design-app && git pull origin main && firebase deploy --only functions:<name>
  --project ce-m2c-design-collab`. The RESTlet (`netsuite/ce_convert_build_restlet.js`) deploys in NetSuite by
  Eric / Stuart (File Cabinet replace; script 2848/1). Nothing in `functions/` or `netsuite/` has changed since
  the last reported deploy (b6b616c, 09-03).
- Windows onto NetSuite: 11.1 → NetSuite Sync Queue, the RTG Transmit Log, screenshots. The outbox worker runs
  every minute, 6 attempts, marker recovery on retry.
- Suites: `committedBins` (46), `pickLines` (48), `labelScan` (36), `rodPieces`, `orderLifecycle` (S2's, you
  read), `finishLabel`. Run bare.

## 1. Territory

**Own:** `PickPack/*`, `FinishingFloor/*` (SetupQueue, ActiveFloor, Recipes, Management, ProductionTimes,
SchedulePlanner, Modals, Summary, FinishingFloor), `ShopFloor/*` (ShopFloor, ShopEngineering, shopShared);
`functions/index.js` — `netsuiteProxy`, `nsOutboxWorker`, `onStockBuildDone`, `onMillComplete`, `authenticatePin`,
the user-directory callables (the `portal*` exports are S4's); `netsuite/ce_convert_build_restlet.js`;
`Shared/nsOutbox`, `nsWorkOrder`, `nsProxy`, `convertDiag`, `pickOrder`, `pickTabs`, `pickLines`, `committedBins`,
`labelScan`, `labelPrint`, `platingPackingList`, `platingOrderPdf`, `quickShipUom`, `i18n`, `rodPieces`,
`rodPieceLedger`, `RodPieceInventory`, `programPrints`, `PullLinesLive`, `WhereIsIt`, `OrderStatusChips`,
`finishingTime`, `floorActivity`.

**Read-only:** S2's (RTG, the writers, `orderStatus.GATES` — you *read* `gatesOf` / `isReleasable` /
`customPartsReady`, *call* `clearConvertGate` / `clearReceiptGate` / `releaseStockWoToFloor` /
`propagateFloorState` / `mirrorCustomStatusToSibling` / `fulfilPlatingDemand` / `cancelPlatingDemand`);
S1's (`salesOrderHeader`, `lineClassification`, `finishLabel.takesNoFinish` — you read); S4's Fulfilment
module (they mount ONE guarded panel in `PickPackApp.js` — your file; you review the mount, they own the
module); S5's `labelPrint` templates? — no: `labelPrint` is yours; S1 edited the UOM template on Stuart's ask
(5ec3acd) and left you a note in memory.

## 2. What is live (do not rebuild)

The claim gate; SO Pack (four numbers, both doors, Close order); committed bins; the arrival alert; the
plating receiving station (scan → cart → bin, receipt on the outbox, build-back through the convert RESTlet
with the component bin); D1 (receipt → 'Plating Received', build-back → 'Complete' + 'Plated', pack gate =
`customPartsReady`); `Shared/pickLines`; RECEIVING (PO) calling `clearReceiptGate`; LABELS with the pack barcode
grammar; pole length/qty/sidemark on pick and pack cards; cancelling a rod cut lifts its gate; the plating
demand's END (`fulfil` / `cancel`); the shop's four-state mirror through the ONE shared outsourced test; the
mill-complete stamps through `propagateFloorState`; the Traverse Cut Sheet; the "no cut sheet from Vision"
banner; Reopen cancels its demand; the Setup Queue saying why (PENDING-RECIPE names its source, "not sent to
WMS" says why, refuses Start while a cut is open, JFP View Item); functions D2 (`onStockBuildDone` builds
sales-typed anchors) and D3 (`onMillComplete`, OFF per brand).

## 3. The work, in order

Numbers are `STATE_OF_THE_APP_2026-09-10.md` §2 items.

**Proof first — on Stuart's live orders (he is turning his quotes into sales orders now)**
1. **#2 the plating round trip** — the script is `SHOP_FLOOR_CONTINUATION_BRIEF.md` §5.1, verbatim: an /EP
   custom order from Stuart → shop ▶ Start (sibling In Process, pick open) → Complete & Label ('Sent to
   Plating', ONE demand with `finSiblingId / orderKey / shopOrderId`, OB PLATING prompt, nothing to finishing)
   → ↩ Undo (demand gone, chip back) → Complete again (one fresh demand) → pull → ship → receive → build-back
   → sibling 'Complete', RTG "Plated", pack allowed; and the refusal: undo after the pull has shipped says
   "receive them back first". Screenshot each step. S2 watches the board side.
2. **#3 the watched sales-typed build at pack** — Order Entry, ONE to-be-finished line whose raw item exists in
   NetSuite and whose finished variant does not (FLOW1, anchored on the BASE); take it to pack; watch 11.1 for
   the entry labelled `… · SALES`. If it fails nothing moved and the error is Eric's answer. Then a FLOW2 line.
3. **#1 the rest of the live pass on the WMS**: claim gate (two tablets), SO Pack numbers and the green open,
   committed bins (refusal names the order in the bin), the arrival alert at both handlers, LABELS, the pole
   details on the pick card, the receiving dock.
4. **#4 C4 — the Order Entry pair** (`HCUMP810 + /P01`): card in Custom Fabrication, `finSiblingId` set, START
   releases the sibling pick, COMPLETE mirrors, the item's Shop Instruction shows (Stuart types one first).
5. **#6** three clean manual ⛏ posts → Stuart flips `rootBuildAuto` for CE (console, no UI) → ⛏ retires per brand.

**Hand-offs that never landed — your files**
6. **#14 the JFP double-post** (IA26935 / IA26936, Stuart 09-04: "it def. doubled the transaction"): both JFP
   `enqueueNsWrite` calls (`PickPackApp.js:1759`, `:1867`) get `dedupeKey: \`jfp-adj:${job.id}\``; the put-away
   branch refuses up front on `jfpAdjQueued || jfpAdjPosted`; `redoPutaway` refuses while the first is in
   flight unless its entry is FAILED. Spec verbatim in `BRIEF_D_WMS.md` "Hand-off from B — the JFP paint-run
   adjustment posts TWICE". Stuart reverses one adjustment by hand (recommend the later, IA26936). Then **#35**:
   the pack-scrap adjustment (same account 254) may share the shape — look while you are there.
7. **#12** the rod-cut completion calls `releaseStockWoToFloor` for a stock WO (spec verbatim in `BRIEF_D_WMS.md`
   "the rod-cut / convert completions RELEASE a stock order"); sales-typed keeps `releaseFinWoToFloor`. Until
   this and S2's #11 land, a stock order whose last gate clears at the WMS waits for an open RTG tab.
8. **#16** (from S2) retire the Setup Queue "⟲ Create Re-make WO" for stock (`SetupQueue.js:686`, writer `:525`);
   keep a "report scrap" that calls the one closer; the guide's honest-matrix row goes. Custom re-issue is RTG's.
9. **#18** arrival stamp: a receipt / put-away that makes a cover code available re-evaluates the backorder
   lines that name it (`Shared/backorder`, S2's — you call it), stamps `backorderCovered: true`, and releases
   the split's BACKORDER hold when every line of that doc is covered; the SO Pack "Finish as available" toggle
   releases the same hold when it turns ON (spec verbatim in `BRIEF_D_WMS.md` "the release half of
   finishAsAvailable is live"). Nothing auto-releases the pick; the board shows ARRIVED.
10. **#19** the Rod Cuts empty state: "0 for CE — n open under M2C" (the WMS keeps its own brand in `pp_brand`).
11. **#32** (from S2, after they observe it empty) delete the Setup Queue's outsourced group (`SetupQueue.js:51`,
    `:594`) — never keep it as a safety net.

**Owned, not blocked**
12. **#33 the plating build-back onto the outbox** — the last direct inventory write with no double-post guard
    (`PickPackApp.js` ~3926–3987 via `postConvertBuild`). Needs the convert RESTlet reachable through the
    outbox with a deterministic id (`platebuild-<lineId>`) and writeBack to the shipment line. The pull stays
    immediate by Stuart's instruction (Sandra needs NetSuite's answer at the bin); ask whether the build-back
    may read "queued — watch 11.1" (STATE §3 Q6 recommends yes).
13. **#34** the pre-pack confirm calling an Order Entry custom half `<woId>-C` "still in production" forever —
    read `customFabStatus` (the mirror) for that half, not `floorPhase`; write the spec first.
14. **#36** the two pull adjustments with no writeBack — add a writeBack naming the order so a future audit can
    reason outward from it.
15. **#42 C3** read one shape: sweep the shop's fallback chains (`partNum || item || 'CUSTOM'`, `soNumOf`,
    `shopItemCodeOf`, the intake form's three candidates) to read `buildShopDoc`'s canonical field first; read
    `cutSheetMissing` / `visionUsed` off the doc (B1 stamps both) and delete the shop's own derivation.
16. **#43 C6**: `isShopEngineer` verify (engineer reaches the four engineering tabs, an operator does not); the
    Brimar bent-pole end to end; polish last and only what a commit already touches.
17. **#40** with S2: the receiving-tab receipt shape (per-line `receivedAt/By`; a short/over field that is not
    `scrapQty`). S2 owns the writer; you own the tab.
18. LABELS needs granting in the WMS permission matrix (Stuart, admin).

**Waiting on Stuart:** #23 Q3 root-build N (default 3) and Q4 the 20 ft stick family (default H1-1R only, 20 ft,
offcuts kept, home bin = library bin) → then C5 (declare in 6.5 Tool 2, run a custom pole through the card).

## 4. Acceptance — live, Stuart pinned in, 11.1 open beside you

The tables in `SHOP_FLOOR_CONTINUATION_BRIEF.md` §9 and `BRIEF_D_WMS.md` §6 stand. Additions:

| run | expect |
|---|---|
| JFP put-away scanned twice (after #6) | ONE `ns_outbox` entry; the second scan refused naming the first |
| a stock WO's rod cut completed with NO RTG tab open (after #7) | Setup Queue shows it within seconds; 11.1 shows its WO |
| a vendor receipt covering a backordered line (after #9) | the line reads ARRIVED on the Backorders board; the floor doc's hold released only when every line is covered |
| plating build-back double-tap (after #12) | one build |

## 5. Questions for Stuart

1. STATE §3 Q5 — which of IA26935 / IA26936 to reverse; approve the dedupe fix.
2. STATE §3 Q6 — may the build-back be queued (no immediate NetSuite answer)?
3. STATE §3 Q4 — Q3 / Q4 one line each.
4. STATE §3 Q3 — delete the Setup Queue re-make now?

## 6. Hand-offs in

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · bb5b5e1 pushed at 19:48 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: tag engine —
  **a backplate follows its arm**: un-picking the return (or any arm) at a position drops the plate chosen for it
  instead of re-seating it under a bracket nobody has chosen; changing bracket still keeps the plate. No document or
  field shape change. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 9415338 pushed at 19:23 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped (S5's kit hand-off,
  S1's half): the kit explosion knows the **H1-138TRV** family (rod as the one per-foot part, brackets by style H/V,
  joiner as the splice, returns stay the fee items on the end steps); CPQ and tab 7 read `system/traverse_rules_<family>`
  from the flow's / kit's `kitFamily` instead of the fixed H1-2TRV document. H1-2TRV explodes exactly as before.
  No document or field shape change; the H1-138TRV rules document is S5's importer's to write. Your side: an H1-138TRV kit's components arrive on the STOCK pick like H1-2TRV's; the brackets carry the customer's finish code (no base colour) — the floor sheet will say so.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 6572b6f pushed at 18:17 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: tag engine —
  **parked geometry never rides**: a pin with no item number (`parked`, or a `HIDDEN-<node>` id) is no longer a rider, so
  new quotes lose their $0 `HIDDEN-…` placeholder breakdown lines. Real hidden parts with an item ride as before. No
  document or field shape change. Your side: nothing — pickLines already treated HIDDEN- as no real part; those lines simply stop arriving on new orders.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-10 · 09104cf pushed at 17:45 EDT (S5 sweeps every served asset after the
  deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the
  H1-138TRV kits — `Shared/kitCode` reads a second grammar `H1-138TRV-4(H|V)D?/(P|EP)` (a parsed align now may carry
  `rodKind` and `bracketStyle`; `axesKeyOf` gained a sixth field, blank on every H1-2TRV kit); `Shared/kitSeed`
  answers `rodKind` as an axis when the kit carries it (H1-2TRV kits do not — untouched) and reports the bracket
  style; the 4.6 kit-sheet import reads tab H1-138TRV and writes, on Apply, 8 `Approved_Designs` Kit records
  (`kitFamily: H1-138TRV`), 19 `clientPricing` rows on existing bracket/splice items, and `system/traverse_rules_H1-138TRV`
  (derived from the H1-2TRV usage table). No document or field shape changed for existing records; nothing is
  written until Stuart applies the import. Your side: nothing until S1 lands the explosion entry — until then a tab-7 H1-138TRV kit explodes NO components (no NetSuite consumption lines, nothing extra on the WMS STOCK pick).

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · e4ab15a pushed at 17:30 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: a new pin tag
  **`ridesWith: RETURN`** (1.6 tag row, beside "hide": rides the rod / rides a return) — a hidden rider so tagged reaches
  the BOM only when a miter or French return is chosen on the order AND its rod is on the order (never a single). Built
  for the H1-138 standoffs of the short rear rod (`1.6 #72 / 1.5 #68`); H1-1's `#31/#32` get the same. Untagged
  riders unchanged. Docs: `assembly_pins` gains the optional field `ridesWith`. Your side: pick lists / floor sheets lose the return standoffs on plain doubles once Stuart tags the pins — that is the intent ("it will confuse the floor").

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · bd5907e pushed at 15:07 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the tag
  engine's step order is ONE order for every flow — Rod Setup → Rod → Rod length → Ends (front L, R, then rear)
  → Bracket → Backplate → Rings → Accessories (`Shared/hardwareModel` rank; `HardwareConfigurator` length step).
  Consequence you may notice: the BOM / quote lines follow the slot order, so a NEW quote lists the rod first,
  then ends, brackets, plates, rings — identities, quantities and prices unchanged; older quotes keep the order
  they were saved with. No document or field shape changed. Your side: pick lists and floor sheets from new quotes list rod → ends → brackets → plates → rings; nothing to do.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-10 · Issue 2 PREVENTION (push pending Stuart's word) — hard-refresh + re-PIN when it
  lands.** `Shared/orderLifecycle`: (1) `isDoneState` no longer reads a finishing doc's `currentPhase 'Complete'` as done —
  DONE = `packStatus 'Packed'` (also the stock put-away) / shop `Completed` / `Built` / closed; a pick-only doc is not done
  until packed. **S3: `isDoneState` is not imported by your files, but if any WMS/finishing screen relied on "Complete =
  done" via the audit, say so.** (2) new `recordKnowsDone(p)` = done OR `floorPhase` in Complete/Packed/Shelved/Plated.
  (3) `auditOrphans` raises FLOOR_DONE once per RECORD, only when EVERY linked floor doc is done and the record neither is
  closed nor knows (`floors[]` on the finding). (4) `closeOrderEverywhere` stamps `stateBeforeClose` on every fin / shop /
  hq doc it closes (the fields it overwrites) and the reopen restores from it exactly. (5) RTG: no "Close all" on FLOOR_DONE.
  No writer, no floor screen, no NetSuite write changed.
- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 16a74bb pushed at 11:24 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the CRM
  pipeline card (Quotes + Sales Orders windows on a customer) prints JOB · SIDEMARK · PO rows. Display only —
  no document or field changed. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 1259391 pushed at 10:56 EDT (S1 sweeps the served bundle after the
  deploy and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped:
  the CRM (tab 10) **Modify Quote / Job** modal now edits the whole checkout header — order sidemark, PO #,
  internal memo, need-by, production notes, ship-to (saved NetSuite address or custom drop-ship), shipping
  charge — through `Shared/salesOrderHeader.jobHeaderPatchOf` (the field set CPQ's finalize writes). Docs it
  touches: `jobs` (those header fields + `headerEditedAt/By`); `hq_sales_orders/SO-APP-<quoteNo>` when it
  exists and is not QUICKSHIP — header rebuilt through `soHeaderOf` (`sidemark, customerPo, internalMemo,
  needBy` + aliases, `productionNotes, shipTo[], shippingMethod/AddressId, customShippingAddress,
  shippingAmount, memo` + `headerEditedAt/By`; `readyDate`, recipe, `status`, `createdBy` untouched). NetSuite
  is NOT updated by the edit. Your side: the WMS pick reads `so.needBy` / `so.sidemark` live; floor docs already released keep their copy — named for S2/S3, not built.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-10 · second push (reopen rules corrected after the first dry run) — hard-refresh
  + re-PIN again.** Three rules changed in `Shared/orderLifecycle.reopenPlanFor` before anything was written: (1) on a
  sales order a fin doc with `nsFulfillQueued` / `nsIfTran` is SHIPPED and stays closed (14 July/August Brimar orders
  would otherwise have come back onto the WMS); (2) a shop half reopened by hand after the close keeps its status and
  loses the `closed: true` flag the bulk close set (the shop's Reopen never clears it, so Livio's six were still hidden —
  S3: that is a defect in `ShopFloor.js undoComplete` worth a line in your queue); (3) a cancelled `ns_outbox` entry that
  had `lastError` / `attempts` goes back to FAILED (11.1 Retry by hand), only a clean one to PENDING. No other code changed.
  **Plus the operator override** (Stuart: of the packed orders "keep open only SO60151, SO60152"): every finishing / shop row on
  the dry-run list has "⟲ reopen anyway" (on a KEEP) or "✕ keep closed" (on a RESTORE); the order's other documents follow;
  the written doc carries `reopenOverride: 'REOPEN'|'KEEP'` + `reopenOverrideBy`.
- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · a58d126 is LIVE (verified in the served `main.d8130142.js`; it
  rode S2's 10:07 deploy).** What shipped: `Shared/nsTransmit`'s TAGS branch now SKIPS a parked-geometry line
  (partId `HIDDEN-<node>`, no money) instead of refusing the whole transaction as LINES_UNRESOLVED; the
  predicate is `Shared/lineClassification.isParkedGeometryLine` (11-assertion harness). Effect: every H1-138
  quote (and Sinaya's Thom Filicia quotes) had silently failed to queue its NetSuite estimate since 21 Aug —
  from this bundle on, a CPQ save queues it. No Firestore document or field changed shape; `ns_outbox` simply
  gains the estimate entries it was missing. Your side: nothing on the floors or in the WMS reads the outbox payload for these lines; `pickLines` already treated `HIDDEN-` as no real part. Re-PIN is the one S2's deploy already required.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-10 · 6c72e80 is LIVE (verified in the served bundle).** Production
  changed under you: hard-refresh (⌘⇧R) and re-PIN before your next save — CPQ save-is-send refuses on a stale
  bundle. What shipped: `Shared/orderLifecycle` gains `reopenPlanFor` / `planBulkReopen` / `applyBulkReopen`
  (pure; 66 assertions) and RTG's Board vs Floor panel gains **⟲ Reopen a bulk close** — the recovery for this
  morning's "Close all" that closed live orders (dry run → confirm → write, ledgered `BULK_CLOSE_REOPEN`). Docs
  it touches: `fin_workorders` (restored `currentPhase / stepStatus / sentToPickPack / pickStatus`, new
  `reopenConfirmPick`, `reopenedAt/By/From`, `reopenRunId`, `reopenedFromClose`), `shop_custom_orders` (`status`
  restored, `closed` removed), `hq_work_orders` / `hq_sales_orders` (`status` restored, `nsWoCloseRequired`
  removed), `rod_cut_orders` (CANCELLED → OPEN for reopened orders), `ns_outbox` (CANCELLED → PENDING for the
  writes the close cancelled). Nothing in your territory's code changed. The push also carried S1's a58d126.
- **From S2:** #16 (retire the Setup Queue re-make for stock); #12 (rod-cut completion → `releaseStockWoToFloor`);
  #32 (delete the outsourced group once S2 says empty). Specs referenced above.
- **From S2, 2026-09-10 — the bulk-close REOPEN chip (`reopenConfirmPick`).** This morning's "Close all" on
  Board vs Floor closed live orders; S2's reopen tool (RTG → Board vs Floor → ⟲ Reopen a bulk close) restores
  each `fin_workorders` doc from its own stamps. The closer had overwritten `pickStatus`, so a reopened doc's
  pick state is RECONSTRUCTED from `stagedAt` / `pickedAt` (else `'Pending'`) and the doc is stamped
  `reopenConfirmPick: true`, `reopenedAt`, `reopenedBy`, `reopenedFrom: 'RTG_BULK_REOPEN'`, `reopenRunId`, with
  the close kept in `reopenedFromClose`. **Ask:** (1) WMS — on the pick queue row / pick detail
  (`PickPackApp.js` where `isOpenPick`, ~:1162, and the pick-list card) show a red chip "REOPENED — confirm pick
  state" while `reopenConfirmPick === true`, and clear it (`reopenConfirmPick: false`, `reopenConfirmedBy/At`)
  when the operator confirms or completes the pick; refuse nothing. (2) Setup Queue / Active Floor — a reopened
  doc carries its restored `currentPhase` (`Setup` / `Painting` at the recorded `currentStepIndex`, `stepStatus
  'Staged'`) and needs no new read; only verify on the tablet that a Painting doc reappears on the Active Floor
  and a Setup doc in the Setup Queue. Downstream trace: work orders unchanged (record back to Dispatched);
  finishing sees the doc at its recorded step; shop unchanged; WMS sees the pick/pack rows return with the
  chip; NetSuite: the queued writes the close cancelled return to PENDING (the worker posts them; dedupeKey
  guards the double post). Nothing else in the WMS needs to change for the chip to be safe to ignore.

- **From S4 (when they start):** ONE guarded mount for the Fulfilment tab in `PickPackApp.js` + a row in
  `Shared/pickTabs.PICK_TABS` (a new tab key is permission identity — an admin ticks it per role).

## 7. Status log

*(newest first)*

- **2026-09-10 — f5a6c19 pushed 15:14 EDT (S3): ⇄ REPACK on RING PACKS.** Plan A approved by Stuart in-session
  ("go ahead with Plan A for the ring break, the pairs needs to wait on information from eric"). Break N packs → eaches →
  build the sibling size, one flow, two NetSuite records via the convert RESTlet (unbuild, then build); the operator may
  build fewer and keep the rest loose; a build failure after the unbuild reports the bin the eaches are in and says to
  finish on BUILD PACKS, never repeat; double-tap guarded by a ref; labels for the new size and count. Lint 0 errors,
  full build passed, safe-push check = one commit. Deploy notice written into S1/S2/S4/S5 §6, the board's Deploys
  row, state doc §6. **Sweep 15:17 EDT:** stamp 1789067831208 (after the push); `asset-manifest.json` = 38 JS assets,
  all fetched with `curl -sf` (8,406,465 bytes, 0 failures); marker `never repeat the repack` ×1 in `main.49b6a398.js`
  (`Repack step 2 FAILED` ×1 there too); the retired BREAK footer string ×0 everywhere. **LIVE.** Not yet run by an
  operator on real packs — the first REPACK on the floor is the acceptance run (two NetSuite records, watch 11.1 is
  not involved: both post synchronously through the RESTlet).
- **2026-09-10 — decisions and the queue.** (1) **Pairs wait on Eric**: the pair item ids in NetSuite (assemblies whose
  BOM is 2 × the each, e.g. `HCUDEC1/CP-PR`?) — then the pack grammar learns the suffix and BUILD / BREAK / REPACK apply.
  (2) **Plating round trip — parked on two answers** (asked 15:0x, unanswered): fix the custom line's dropped links + the
  custom-aware put-away BEFORE the run; NetSuite at return = receipt only (recommended) or a build of `<base>/EPn`. The
  finding: `PickPackApp.js` OB scan-in (`:1621`) writes no `finSiblingId / orderKey / soAppId / shopOrderId`; receive
  (`:3017`) and put-away (`:3296`) act only on `finSiblingId`; put-away step 1 adjusts against a null item. (3) From S2,
  acknowledged and queued: the `reopenConfirmPick` chip on the pick queue/pick detail (spec in §6); `ShopFloor.js
  undoComplete` never clears `closed: true` (defect, mine); S2's question "did any WMS/finishing screen rely on
  'Complete = done' via the audit?" — **no**: the WMS gates on `customPartsReady` / `pickStatus` / `packStatus` and the
  finishing screens on `currentPhase`; nothing of mine reads `isDoneState` or a FLOOR_DONE finding. (4) Named, not
  fixed: the SO pick's pack-build queue (`:4455`) will not recognise a pair line.

## 8. Opener (paste to start the session)

```
You are the S3 session — WMS · Finishing Floor · Shop Floor · the outbox and the NetSuite functions. Read,
in order: CLAUDE.md (the working agreement binds you), SESSION_COMMS_2026-09-10.md (the map, file ownership,
hand-off protocol — briefs are the channel), STATE_OF_THE_APP_2026-09-10.md (your items are named in BRIEF_S3
§3), BRIEF_S3_WMS_FINISHING_SHOP.md (your brief), then WMS_BRIEF.md, SHOP_FLOOR_CONTINUATION_BRIEF.md,
RTG_CONTROL_BRIEF.md §2/§5, WORK_ORDER_CONTRACT.md §5–5c, and the memories brief-c-shop-floor-session,
pickpack-in-main-bundle, deploy-verify-asset-manifest, wms-assembly-build-component-bin, rod-cuts-wms. Two rules:
every NetSuite write here moves real inventory — never twice, never from two places, never guessed; and
functions/index.js does NOT auto-deploy — every functions change ends with the Cloud Shell command for Stuart
and a live verification. The floors receive work, they never route it. Outsourced finishes never enter the
finishing floor. Stuart's live customer orders are the round-trip tests — never raise your own. Other
sessions: S2 (RTG/WO/PO — owns orderStatus/orderLifecycle/workOrderCreate/floorRelease/platingDemand, which you
CALL), S1 (sales doors + engine), S4 (portal/payments/UPS — will mount ONE Fulfilment panel in PickPackApp.js),
S5 (spec sheets/kits). Cross a line: stop, patch spec into THEIR brief's § Hand-offs in, log it in yours.
Git: never switch branches, stage only your files, pull --rebase --autostash, safe-push check, eslint 0 errors;
PickPack/ShopFloor/FinishingFloor are in main.*.js — sweep every asset with curl -sf. Plan first and wait —
every time. One issue at a time. First: with Stuart pinned in, run the plating round trip
(SHOP_FLOOR_CONTINUATION_BRIEF.md §5.1) on the /EP custom order he raises, screenshot each step, and hand S2
the board-side observations. Identify as "(S3)" in every commit.
```
