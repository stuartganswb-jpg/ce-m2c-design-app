# Brief S1 — CPQ · Vision · Order Entry · CRM · the tag engine · 1.6 / 1.5 authoring

*Written 2026-09-10 by the communicator session. You start SECOND, after S2's first issue is planned. Read,
in order: `CLAUDE.md`, `SESSION_COMMS_2026-09-10.md`, `STATE_OF_THE_APP_2026-09-10.md` (your items: §1 E and F,
§2.1 #7–8, §2.2 #17, #20–21, §2.3 #22, #28–29, §2.4 #44–49, #53), then `CPQ_VISION_HANDOFF_BRIEF.md` (the
09-09 state of this territory — everything in it is live-proven), `BRIEF_E_HANDOFF.md`,
`BRIEF_16_AUTHORING_ALIGNMENT_HANDOFF.md`, and the memories `brief-e-sales-side-session`,
`h1-2trv-traverse-engine-session`, `hardware-tag-engine`, `fabricut-projection-tag-defects`,
`unfinished-item-tag`. Stuart's own words: "these areas still have a lot of work."*

## ⛔ Working agreement + standing rules

Plan first and WAIT. Requested scope only. No temporary fixes. Trace downstream: what you write becomes the
work orders, both floors, the WMS pick and the NetSuite transaction — say the trace in every plan. One issue
at a time. S1 **tags before code** is this ground's governing principle: *"all fixes on the items, not on the
flow"*; S2 the guide moves with the code. Two sales-side rules in force: **never hardcode against flow details**
(flows are data), and **a shared screen is extended by ADDING one guarded mount, never by editing** — prove it
with `git diff -w`. The old engine is retired: CPQ and Vision must work 100% on the tag engine.

## 0. Operating

- **Saving in CPQ is sending** (quote → CRM + `ns_outbox` → NetSuite). Never save a test quote without Stuart's
  OK; reopen / edit / clear-all without saving is safe; leave the cart empty. Save-is-send refuses on a
  stale bundle: every deploy costs Stuart a re-PIN — **do not push while he is mid-entry** (he is entering
  quotes for one customer today; those become the round-trip orders every session uses).
- Reading live state: the configurator's `resolved` / `model` / `stretchSpec` are reachable by walking the
  DOM fiber from the "ROD SETUP" rail chip (`CPQ_VISION_HANDOFF_BRIEF.md` §0). Native `confirm`/`alert` freeze
  CDP — avoid triggering them.
- Deploy-verify: `CPQTab` + `HardwareConfigurator` are in `main.*.js`; `QuickShipTab`, `ExternalCoopTab`,
  `VisionHardware` (chunk `630.*`), `AssemblyBuilderTab`, `NodeClusterTab`, `AdminTab` are lazy chunks. Sweep
  everything; byte-compare the Vision chunk when only Vision changed.
- The fast loop: `node scripts/hardwareModel.test.mjs` (664), `visionBridge` (53), `hardwareHandoff` (45),
  `hardwarePricing` (54), `kitSeed` (68), `partLookup` (42), `platePool` (14), `slotGroups`, `stepImport`; the
  traverse family via `sh scripts/run-traverse-tests.sh`. A fix here is proven in a test before it is looked
  at on a screen. Fixtures use the prod shape; a fixture that cannot fail is decoration.

## 1. Territory

**Own:** `HQ/CPQTab.js`, `VisionHardware.js`, `ClientVisionTab.js`, `QuickShipTab.js` (tab 7), `ExternalCoopTab.js`
(CRM), `ERPPushPullTab.js` (tab 12), `AssemblyBuilderTab.js` (1.6), `NodeClusterTab.js` (1.5), the flow generator in
`AdminTab.js`; `Shared/hardwareModel`, `hardwareAdapter`, `hardwarePricing`, `HardwareConfigurator`,
`hardwareHandoff` (the line contract six consumers read), `assemblyTags`, `traverse*`, `sizeMatrix`, `plateRules`,
`platePool`, `partLookup*`, `finishLabel`, `configQty`, `tagPhrase`, `tagSheetImport`, `visionBridge`,
`nsTransmit`, `salesOrderHeader`, `lineClassification`, `reopenQuote`, `quoteDisplay`, `printForm`, `FormPreview`,
`QuickShipInvoiceModal`, `ConfiguredItemViewer`, `aliasIdentity` (app copy), `brandNetsuite`, `studioScene`,
`fusionImport`, `itemCodeMatch`, `nodeList`, `stepImport`, `slotGroups`.

**Read-only:** S2's (RTG, the writers, the split — `autoSplitSalesOrder` reads your header and calls your
`classifyLine`); S3's floors and WMS (read your `lines[]`, `finishOutsourced`, `needBy`); S4's portal (mirrors
your logic by hand-off — every schema change needs the mirror sweep, `portal-cpq-contract`); S5's kits and 4.6
(they hand you a correct kit record; `kitSeed` is S5's — you consume it through the engine mount).

## 2. What is live (do not rebuild)

One header on every door (`soHeaderOf`; CPQ, Order Entry, CRM approve), recipe + `recipeSource` + per-line
`finishOutsourced` stamped at save, need-by never invented, ready date by finish class (PAINT/PLATED/STAIN),
customer finish names and track stock colour on the paper, documents re-resolve at print, render snapshots
at Add configuration, cart edit-in-place, the header quantity asked once, the traverse splice chart,
the Vision-on-the-engine run (rod type, framing axes, projection list, pin matching by cluster, traverse
cut list into `engineeringNotes`, the bridge answering the framing axes), Brief 16 in full (one tag row on
both 1.6 screens, load-order badges, the 1.5 SLOTS panel, the Traverse template), STEP review on tab 1, the
"Unfinished" item tag. Every claim in `CPQ_VISION_HANDOFF_BRIEF.md` §3 was live-proven on Stuart's tab.

## 3. The work, in order — Stuart picks; this is the recommended order

Numbers are `STATE_OF_THE_APP_2026-09-10.md` §2 items.

**Follow his live orders through your screens first**
1. **#1 / #7** — Stuart's quotes for one customer are being saved as sales orders now. For each: the
   `hq_sales_orders` header (needBy typed or '', readyDate, recipe / recipeSource, shipTo[], every finished
   line's `finishOutsourced`), the NetSuite payload on tab 12 versus what the Transmit Log shows was sent,
   the documents from the CRM DOCS packet (descriptions, part numbers, colour names, pictures). Report
   observed values, not intent; name data defects separately from code.

**The sales spine**
2. **#22 / E3** — one NetSuite header builder. Waits on Eric for the class + form ids per brand. STATE §3 Q9
   recommends shipping the CE map now with non-CE brands **refusing to queue with a named error** (the cc85d66
   rule) rather than sending nothing — Stuart decides. Both inline copies still exist (`nsTransmit.js:598`,
   `QuickShipTab.js:1345`); the `shipMethodRef` cache goes with them.
3. **#20** — the alias window. B's split writes `needBy`, the WMS reads it first; the last reader is
   `functions/index.js:1262` (`portalMyOrders`, S4's). Hand S4 the one-line change; when it is deployed,
   delete the two alias lines at `salesOrderHeader.js:286` and note it in `BRIEF_E_HANDOFF.md` §3.
4. **#17** — Order Entry lines classified through `Shared/backorder.classifyLine` at save (S2's module; the call
   is in your `QuickShipTab.js`), so an Order Entry order carries `backorderLines[]` like a CPQ one.
5. **#47** — the first real CRM Approve through `queueEstimateToSalesOrder` is a watched run (RTG Transmit Log
   row "Sales Order ⇐ estimate"). Never verified live.
6. **#46** — prove the Kit-class push on tab 12 (`H1-2RCTCB` → 59101 + 64805 etc. as their own lines) and
   confirm whether F2's E half shipped: every kit component at $0, ONE holder line (`CE-TRV-SYSTEM`, fallback
   61502), breakdown stable-sorted by `billGroup` (`Shared/kitSeed` already stamps it), documents print in that
   order. If not shipped, it is one issue: `nsTransmit` TAGS branch + `hardwareHandoff.handoffItem` + the doc
   lines. S5 owns `kitSeed`; you own the push.

**CPQ / Vision defects on record**
7. **#45** — the silent end-treatment deletion when the rod is picked after the ends
   (`fabricut-projection-tag-defects` #3). An order entered in the operator's natural order ships without its
   returns. Fix on the engine's own terms (a prompt or a refusal, never a silent clear).
8. **#44** — the Vision no-O2O guard at add-to-cart / finalize (a bend / return / splice configured with no
   Vision O2O → stop), and "Reopen-in-Vision does nothing" (Stuart, 09-03). The sales-forms regression
   (GLB node names on paper) is FIXED (9802142) — do not re-raise it.
9. **#48** — Vision onto the new engine: Vision renders the old flow steps gated by the engine; no CPQ →
   Vision write-back; the generator still emits TRV END steps both engines skip; Vision's traverse End Style
   list still shows drive-end step titles. This is a project, named, not started — plan it with Stuart before
   any of it.
10. **#53** — render snapshots: old quotes need the line re-added; a big cart approaches the 1 MB doc limit
    (move to Storage + URL if it bites).
11. Named in `CPQ_VISION_HANDOFF_BRIEF.md` §5: a per-assembly home to edit the traverse deductions
    (`Shared/traverseTags`, the function already takes an override); the shrink direction of the stretch
    (orders shorter than the model) — not built by choice.

**1.6 / 1.5 and the data Stuart owns** (§2.3 #28 — a sitting with him and the designer, F drives it; you are F
now): `trv: trv-only` on slots 5/6; `H12RCTAR4625RIGHT` NO PLATE; miters all SETUP SINGLE; `H1-DBLFR/DBLMR` on
3/4" `setup: double`; rear `HSOM-04` `setup: double` + stray proj; wood rod pins #10 vs #11 (never both the
same); rear `H1-2TRVNUT` tagged TRACK; S72 `returnOnly`; FR/MTR double pins' proj as `FRONT:8.5, BACK:3.25`; the
40 PENDING stubs; the 4-5/8" returns (GLB work + tags — Fabricut order 3 is parked on it) and `H1-75ILE` 3.625 →
4.625. Always cite the slot # (Stuart, 09-06). Brief 16's §6 acceptance with the designer has never run; the
Traverse template's slot list awaits his check against the live SLOTS panel.

**Guide (S2 rule):** the User Guide has sections 8, 7, 4.6 and the 1.6/1.5 Authoring chip. There is NO
section for the tag engine itself (what a tag does, construction vs pairing, "all fixes on the items") — that
is #49, shared with S5's kits/spec-sheet sections; coordinate before editing `UserGuideTab.js`.

## 4. Acceptance — on Stuart's orders, tab 12 and the Transmit Log open

| run | expect |
|---|---|
| his CPQ order saved as SO | header complete; NetSuite payload identical to before plus the class map; RTG shows the real need-by or a dash |
| his Order Entry order | same header keys; NS_QUEUED → Pending with the real SO #; straight to the WMS pick; RTG record present; `backorderLines[]` when short (after #4) |
| a non-CE brand sales order (after #2) | class sent from the map, or a named refusal |
| a traverse order with a kit | tab 12: ONE holder line at the configuration total, N lines at $0, ONE 58034 |
| ends picked before the rod (after #7) | the end treatments survive, or the operator is told — never silently deleted |
| Vision line → CPQ → SO | `missed` empty; cut sheet on the job; `git diff -w VisionHardware.js` empty or one mount |
| reopen CPQ / Order Entry on a pre-09-03 quote | fields blank, never +14 days |

## 5. Questions for Stuart

1. E3 now with a CE-only map and a named refusal for other brands, or wait for Eric? (STATE §3 Q9)
2. Which of #7 / #8 / #9 first after the live orders — the silent end-treatment deletion is the one that ships
   an order short.
3. When does the designer sit for the 1.6 data pass and the Brief 16 acceptance?
4. The Fabricut orders 2 and 4 — enter now, through which door? Order 3 waits for the 4-5/8" returns.

## 6. Hand-offs in

- **⚠ DEPLOY NOTICE from S2 · 2026-09-11 · refused quotes on RTG — 5ba0da3 PUSHED.** Hard-refresh + re-PIN before your next save. What ships: RTG's ⇄ Quotes & Sales Orders panel lists any `jobs` doc carrying
  `nsTransmitRefusedAt` (S1's stamp, 2c61b3e) in red as REFUSED — <code> with the message, and a **⇄ Queue now** that calls
  `Shared/nsTransmit.queueNsTransaction` with the whole library (fetched once per session, as tab 12 reads it): a job with
  status APPROVED re-queues as a SALES ORDER with the `SO-APP-<quoteNo>` board write-back, anything else as an ESTIMATE;
  success writes `nsTransmitQueuedAt/OutboxId` + clears the three refused fields (S1's contract); a fresh refusal renews
  the stamp. Jobs document only; no floor doc; a NetSuite write only after the person presses. Guide paragraph added.
  RTGDispatchTab + UserGuideTab only. Your side: nothing.
- **⚠ DEPLOY NOTICE from S3 · 2026-09-11 · 47c2b6b pushed at 12:25 EDT (S3 sweeps every served asset after the deploy
  and records it in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: (1) WMS Plating —
  the OB scan-in (a custom demand from the shop) now copies `finSiblingId / orderKey / soAppId / shopOrderId` onto the
  `plating_shipments` line as the stock pull does, so Receive stamps `floorPhase 'Plating Received'` and put-away mirrors
  `customFabStatus 'Complete'` + `floorPhase 'Plated'` (D1) for custom lines — before, neither ever fired and a plated custom
  order read "At the plater" forever. Put-away on a `custom: true` line posts NO NetSuite build/adjustment (custom fab is not
  stocked inventory; the plater PO + item receipt are the record), stamps `nsBuildSkipped: 'custom-fab'`, tells the order,
  commits to its bin; a short count REFUSES. (2) WMS Convert — the tab scrolls again (the column no longer pins to the
  viewport; the raw-item list keeps a 70vh scroller). No writer changed; RTG reads the same `floorPhase` vocabulary. Your side: nothing.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-11 · e2cef1f pushed at 08:42 EDT (S3 sweeps every served asset after the deploy
  and records it in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: (1) WMS pick queue —
  a finishing doc RTG's bulk reopen restored with a reconstructed pick state (`reopenConfirmPick: true`) shows a red
  "⟲ REOPENED — confirm pick state" chip on its queue row and the active pick header, with ✓ confirmed; completing the
  pick clears it too (`reopenConfirmPick: false, reopenConfirmedBy/At`); refuses nothing. (2) Shop floor — Undo on a doc
  the closer stamped `closed: true` now REFUSES, naming who/when/why and pointing at RTG (before: status went back to In
  Process with the closed flag left, so the card vanished). No NetSuite write; no shape change beyond the three confirm
  fields S2 specified. Your side: nothing.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-10 · 105b29c pushed at 20:29 EDT (S5 sweeps every served asset after the
  deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the
  H1-138TRV kit import corrected — Fabricut's "bracket" codes are arm + backplate here (the H1-138 pins carry arms
  SBA/EBA/6BA/DBA/CBA by depth and plates BP-H/BP-V/BP-C by orientation); the derived `system/traverse_rules_H1-138TRV`
  now keys those codes (a plate row per orientation, "one per bracket"); the 18 combo prices land on the arms' Fabricut
  rows (/P and every /EPn + /P25 that exists) with $0 plate rows; `H1_138TRV_PARTS` export re-shaped (`brackets.SINGLE`
  by depth, DOUBLE/CEILING strings, new `plates`). Verified first that re-applying the sheet rewrites every H1-2TRV kit
  and component row identical. No existing document or field shape changed; nothing written until Stuart applies. Your side: **your guard test `the explode table and the importer export the SAME codes` is RED on main from this push until you re-key `TRAVERSE_FAMILY_PARTS['H1-138TRV']` and add the plate line — the corrected spec is in your §6 (From S5, evening).**

- **⚠ DEPLOY NOTICE from S5 · 2026-09-10 · 09104cf pushed at 17:45 EDT (S5 sweeps every served asset after the
  deploy and records it in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the
  H1-138TRV kits — `Shared/kitCode` reads a second grammar `H1-138TRV-4(H|V)D?/(P|EP)` (a parsed align now may carry
  `rodKind` and `bracketStyle`; `axesKeyOf` gained a sixth field, blank on every H1-2TRV kit); `Shared/kitSeed`
  answers `rodKind` as an axis when the kit carries it (H1-2TRV kits do not — untouched) and reports the bracket
  style; the 4.6 kit-sheet import reads tab H1-138TRV and writes, on Apply, 8 `Approved_Designs` Kit records
  (`kitFamily: H1-138TRV`), 19 `clientPricing` rows on existing bracket/splice items, and `system/traverse_rules_H1-138TRV`
  (derived from the H1-2TRV usage table). No document or field shape changed for existing records; nothing is
  written until Stuart applies the import. Your side: the explosion entry + two per-family rules reads are asked of you in your §6 (From S5); the kit picker on the H1-138 flow lists these kits once Stuart tags the flow Kit Family H1-138TRV; `kitSeed` may now answer `rodKind` — your engine reads it as any other answer.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-10 · f5a6c19 pushed at 15:14 EDT (S3 sweeps every served asset after the
  deploy and records it in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: WMS →
  Rod Cuts & Ring Packs → RING PACKS gains **⇄ REPACK** — break N packs and build another size from the eaches in one
  flow (5 × /BL-12 → 60 × /BL-EA → 6 × /BL-10, remainder stays loose in the each bin). Two NetSuite records through the
  convert RESTlet already deployed (unbuild, then build); a build failure after the unbuild is reported as an honest
  partial state. `PickPackApp.js` only — no RESTlet, functions, outbox, document or field shape change; pack SKUs are
  shelf stock nothing on the spine reads. Your side: nothing.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-10 · Issue 2 PREVENTION (push pending Stuart's word) — hard-refresh + re-PIN when it
  lands.** `Shared/orderLifecycle`: (1) `isDoneState` no longer reads a finishing doc's `currentPhase 'Complete'` as done —
  DONE = `packStatus 'Packed'` (also the stock put-away) / shop `Completed` / `Built` / closed; a pick-only doc is not done
  until packed. **S3: `isDoneState` is not imported by your files, but if any WMS/finishing screen relied on "Complete =
  done" via the audit, say so.** (2) new `recordKnowsDone(p)` = done OR `floorPhase` in Complete/Packed/Shelved/Plated.
  (3) `auditOrphans` raises FLOOR_DONE once per RECORD, only when EVERY linked floor doc is done and the record neither is
  closed nor knows (`floors[]` on the finding). (4) `closeOrderEverywhere` stamps `stateBeforeClose` on every fin / shop /
  hq doc it closes (the fields it overwrites) and the reopen restores from it exactly. (5) RTG: no "Close all" on FLOOR_DONE.
  No writer, no floor screen, no NetSuite write changed.
- **From S2, 2026-09-10 — stamp a REFUSED estimate on the job so RTG can show it.** `CPQTab.js` ≈:3338–3347 (and the
  SALES_ORDER branch ≈:3329): when `queueNsTransaction` returns `ok:false`, nothing is written on the job — only the alert
  ("push it from Tab 12", which never lists a CONFIGURED quote). ST091026-01 today was exactly this (your HIDDEN- finding,
  refused before a58d126 was live) and was invisible on RTG, against Stuart's "everything hits RTG". **Ask:** in both
  branches on `!res.ok` (and in the `catch`), `updateDoc(doc(db,'jobs',targetJobId), { nsTransmitRefusedAt: Date.now(),
  nsTransmitRefusedCode: res.error.code, nsTransmitRefusedMessage: String(res.error.message).slice(0,500) })`; on a later
  `res.ok` clear the three (`deleteField()`). S2 then lists `nsTransmitRefusedAt` jobs in RTG's ⇄ Quotes & Sales Orders
  panel with a "⇄ Queue now" that calls your `queueNsTransaction` and clears the stamp on success. Downstream trace: jobs
  doc only; no floor doc, no NetSuite write until the person presses Queue now. Optional, yours: tab 12 could list
  CONFIGURED quotes too, or the alert could stop pointing there.
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
- **From S5, 2026-09-10 evening — CORRECTION to the H1-138TRV explosion entry (your 9415338): Fabricut's "bracket" is
  TWO of our items, and `scripts/traverseExplode.test.mjs` "the explode table and the importer export the SAME codes" is
  RED on main from S5's push until you re-key.** Read from the live pins and library with Stuart (2026-09-10, read-only):
  the H1-138 assembly pins bracket ARMS by depth — `H1-138TRVSBA` 3-5/8", `EBA` 4-5/8", `6BA` 6", `DBA` double, `CBA`
  ceiling (`traverseRole: TRV_BRACKET`, `projInches` tagged) — and BACKPLATES by orientation — `H1-138TRVBP-H`, `BP-V`,
  `BP-C` (`TRV_BACKPLATE`, pinned per depth). Every one exists in /P, /EP1–6, /P25. The sheet's `H1-138TRV-H/P`
  ("horizontal bracket") = SBA + BP-H; `-HE` = EBA + BP-H; `-H6` = 6BA + BP-H; `-HD` = DBA + BP-H; `-V…` the same arms with
  BP-V; `-C` = CBA + BP-C. None of the 18 combo codes is an item. **Stuart confirmed: arm + plate, one of each per bracket
  position, both at the chart count; the combo price sits on the ARM's Fabricut row (H pattern), plates $0 with their own
  patterns.** S5's export is now:
  `H1_138TRV_PARTS = { rod: 'H1-138TRV', brackets: { SINGLE: { '3.625': 'H1-138TRVSBA', '4.625': 'H1-138TRVEBA', '6':
  'H1-138TRV6BA' }, DOUBLE: 'H1-138TRVDBA', CEILING: 'H1-138TRVCBA' }, plates: { H: 'H1-138TRVBP-H', V: 'H1-138TRVBP-V',
  CEILING: 'H1-138TRVBP-C' }, splice: 'H1-138TRVJNR' }` — the single table is by DEPTH again (no style level), DOUBLE is
  a string, and `plates` is new. The derived rules doc now carries usage rows for SBA / EBA / 6BA / DBA (H1-2TRV's
  counts) and for BP-H / BP-V ("one per bracket", the standard row's counts), plus the joiner.
  **Ask (your `traverseExplode.js`):** (1) the H1-138TRV entry = the object above (import it: `import { H1_138TRV_PARTS }
  from './traverseKitImport'`, or copy — the guard test compares `brackets`; extend it to `plates`); (2) the single
  bracket = `brackets.SINGLE[proj]` (your `singleTableOf` already falls through to a depth-keyed table; `style` no longer
  selects the arm), the double = `brackets.DOUBLE` when it is a string (your `doubleCode` currently falls to
  `DOUBLE_TRACK`/`DOUBLE_RING` → undefined for this family); (3) NEW: after the bracket line, add the PLATE line —
  `P.plates[mount === CEILING ? 'CEILING' : (U(align.bracketStyle) || 'H')]` at the SAME quantity as the bracket, role
  `'plate'`, why `'backplates (one per bracket)'`; the rules doc has a row per plate code so `usageAt` reads it directly;
  (4) `singleProjections(family)` — a style argument is harmless but unused for this family now; tab 7's call may drop it.
  Fixture for the test: 4 ft -4H/P with rules = 4 × H1-138TRV, 2 × H1-138TRVSBA, 2 × H1-138TRVBP-H, 2 × H1-2TRVPLUG, no
  splice; 12 ft -4VD/EP = 24 × rod (two rods per foot — Stuart confirmed), 5 × H1-138TRVDBA, 5 × H1-138TRVBP-V, 1 ×
  H1-138TRVJNR. **Downstream:** the plate line reaches tab 7's NetSuite consumption and the WMS pick (one plate per
  bracket was silently missing before) and CPQ's kit cover (the engine's TRV_BACKPLATE pick is now covered at $0 instead
  of billing as ADDED). Until you land it: tab 7 consumes non-existent combo codes for the brackets (they would fail item
  resolution at push) and CPQ covers neither arm nor plate.
- **From S5, 2026-09-10 — the H1-138TRV kits: the explosion entry and two per-family reads (three of your
  files, small).** Stuart: "add in the kits for the H1-138TRV kits … check the components and pricing are
  correct and that it will function with the cpq flow just like H1-2TRV does … the exact same carrier usage and
  carrier options as the H1-2TRV … so just the rod and brackets change." Your tag audit
  (`H1_TAG_ALIGNMENT_2026-09-10.md` §2G) is the map: the 1-3/8" traverse lives INSIDE the H1-138 collection —
  rod `H1-138TRV` pinned as the fascia role at 1.6 #19–#21, TRV brackets and plates at #26–#37, return fees
  138TRVMTR / 138TRVFR at #22 / #23 — which is why H1-138 asks Rod Type.
  **What S5 built (commit hash in BRIEF_S5 §7 once pushed):** `Shared/kitCode.parseKitCode` reads the second
  grammar `H1-138TRV-4(H|V)D?/(P|EP)` → `align` gains `rodKind: 'TRAVERSE'` and `bracketStyle: 'H'|'V'`
  (`axesKeyOf` carries the style — the -4H/P and -4V/P kits share every other axis); `Shared/kitSeed.seedFromKit`
  checks `rodKind` as an axis (first, as the engine asks it; a traverse kit on a solid-only assembly is BLOCKED;
  H1-2TRV kits carry no rodKind and are untouched) and REPORTS the bracket style in `missed` the way projection
  stays asked; the 4.6 kit-sheet import reads tab `H1-138TRV` (8 kits, 19 priced components) and writes
  `system/traverse_rules_H1-138TRV` DERIVED from the H1-2TRV Carrier Usage tab per Stuart — carriers and the
  configurator list verbatim, bracket rows re-keyed one per STYLE at every depth with the same counts, the splice
  row keyed `H1-138TRVJNR` (11 ft first, as H1-2TRV's), DRTWB dropped (no 1-3/8" ring-front double).
  `H1_138TRV_PARTS` is exported from `Shared/traverseKitImport.js` — the rod, the brackets by style × projection,
  the double and ceiling brackets, the splice — so the rules doc and your explosion key the SAME codes.
  **Ask 1 — `Shared/traverseExplode.js`, `TRAVERSE_FAMILY_PARTS['H1-138TRV']`.** Today `explodeTraverse` returns
  `unknown family — nothing exploded` for these kits: tab 7 consumes NO components in NetSuite and CPQ's
  "included" cover is empty, so every bracket bills as ADDED. The entry (import `H1_138TRV_PARTS` or copy it):
  ONE per-foot part — `rod: 'H1-138TRV'` (the rod IS the track; no fascia, no separate track line, role
  `'rod'` — Stuart's "just the rod and brackets change"); `brackets: { SINGLE: { H: {3.625: H1-138TRV-H,
  4.625: -HE, 6: -H6}, V: {… -V, -VE, -V6} }, DOUBLE: { H: -HD, V: -VD }, CEILING: -C }` — the single's code is
  `SINGLE[align.bracketStyle][proj]`, the double's `DOUBLE[align.bracketStyle]`; `splice: 'H1-138TRVJNR'`;
  `plug: 'H1-2TRVPLUG'` ×2 on a manual rod — **Stuart 2026-09-10: "2 per rod manual for now use the same code as
  the H1-2trv manual, it will need to be updated but for placement sake it is better than nothing"** (say so in
  the entry's comment: a placeholder code, not the 1-3/8" part); no `baseMotor` (no motorized kits on the sheet),
  `frontRingPole` none (no FRT double), `returnArms` none (the 1-3/8" returns are the fee items at #22 / #23, not
  per-projection arms), `subFinishRoles: []` — **Stuart 2026-09-10: mainline finish** — the sheet prices every
  H1-138TRV bracket "- PAINTED" / "- PLATED" (/P and /EP), so unlike H1-2TRV's base-colour brackets they go to the
  floor in the customer's finish code. `singleProjections(family)` must take the style (`brackets.SINGLE[style]`) — tab 7's
  `trvProjOptions` (`QuickShipTab.js:697`) passes `trvKit.manufacturingSpecs.kitAlign.bracketStyle`. The
  `scripts/traverseExplode.test.mjs` fixture: a 4 ft H1-138TRV-4H/P set = 4 × H1-138TRV, 2 × H1-138TRV-H, no
  splice; a 12 ft -4VD/EP = 12 × rod, 5 × H1-138TRV-VD, 1 × H1-138TRVJNR.
  **Ask 2 — the rules doc is read by family in two places that still hard-code H1-2TRV:** `CPQTab.js:1070`
  (`onSnapshot(doc(db,'system','traverse_rules_H1-2TRV'))` → `trvRules` → `HardwareConfigurator`'s kit cover and
  the components chart) and `QuickShipTab.js:228` (the configurator offer). Under an H1-138TRV kit those read
  H1-2TRV's rows: carriers match by id, the bracket and splice rows do not → 2 brackets and no splice at every
  length in CPQ and in tab 7's chart. Subscribe by the kit's / flow's `kitFamily` (tab 7's push at `:1245`
  already reads `traverse_rules_${fam}` per kit — the same rule, one screen earlier).
  **Data, Stuart's, named here so you see it:** tab 11 → the H1-138 flow → Kit Family `H1-138TRV` (the picker
  matches `kitFamily` tag-first; the assembly code `H1-138` is not the prefix of `H1-138TRV-4H/P`, so without the
  tag the picker's super-admin diagnostic names the mismatch and lists nothing). Then in 4.6: apply the import,
  tick each kit's finish matrix (P kits paints, EP kits plated).
  **Downstream trace:** tab 7 → `hq_sales_orders` (QUICKSHIP) → WMS STOCK pick of the exploded components →
  NetSuite SO consumption lines + the $-holder; CPQ → kit line `noNs`, components at $0 → rollup; the pick list
  reads `pricingBreakdown` (nothing removed). RTG, finishing, shop untouched. Until Ask 1 lands, an H1-138TRV kit
  is listable on tab 7 and seedable in CPQ but consumes nothing and covers nothing — Stuart is told.
- **From S2 (to land when S2 is next in `StockViewTab` / `LibraryTab`):** nothing owed to you today.
- **To S4 (you write it into `BRIEF_S4` §6):** `portalMyOrders` date read → `so.needBy || so.readyDate ||
  so.createdDate`; the portal request functions accept `needBy` + `productionNotes` (E8 field list in
  `BRIEF_E_HANDOFF.md` §5).

## 7. Status log

*(newest first)*

- **2026-09-11 — Vision Phase 2 (S1) 2b164a5 pushed 09:59.** `Shared/visionHandoff` (draftFromCartLine / cartLineForDraft,
  11 assertions); CPQ: `visionDraftId` on lines from a drawing, "Vision" button → draft + REOPEN_QUOTE_IN_VISION with
  `loadDraftId`; Resume sets `editingCartId` to the owning line (replace, never add); ClientVision session carries
  `loadDraftId` (consumed once); VisionHardware auto-loads it and keeps `cartItemId` through a re-save. Phase 1b live read
  done (H1-138 / Brimar / H1-2TRV — all as designed; the H1-75 size-matrix edge not yet read). NEXT: live read of Phase 2;
  Phase 3 = `Shared/traverseFlow.js` generator stops emitting TRV END steps (both engines skip them).

- **2026-09-11 — Vision Phase 1b (S1) 3c0e101 pushed 08:33.** The mount in VisionHardware.js per the 1a plan (steps 1–7 all
  landed; `git diff -w` = six branch heads + three effect guards + the save/load lines). NOT yet: the live read on Stuart's
  tab; the sheet-2D / size-matrix filters Vision applied on the old steps are NOT applied on the engine path (the engine
  has its own size handling via projs) — read on H1-75 first. Phase 2 next: CPQ → Vision write-back + re-save replaces
  the cart line; Phase 3: generator stops emitting TRV END steps.

- **2026-09-10 — Vision Phase 1a (S1) 21bea0f pushed 23:40.** `Shared/visionEngine.js`: `settleVision` (CPQ's loop),
  `visionPickers` → `{ live, pickers[{key,kind,tier,position,options,chosen,locked,lockedBy,lockedReason}], at(kind,pos,tier), model }`,
  `engDataFromPickers` (bracketId/Right/Center, backplateId*, endStyle/Right, mountLeft/Right), `enginePicksForDraft`,
  `chosenRods`, `endStyleOf`. Bridge: `visionPartIds` reads `specs.enginePicks` first. Adapter + engine: `endTreatment`
  passthrough. 19 assertions. **Phase 1b mount plan (VisionHardware.js):** (1) `useEngine = engineChoices.length > 0`;
  (2) `enginePicks` state `{slotKey: choiceId}` replaces `dynamicConfigParams` for the five hardware pickers when
  `useEngine`; `pk = visionPickers({choices: engineChoices, answers: framing.answers + proj, picks: enginePicks, nameOf})`;
  (3) the five selects (End L/R, Bracket L/R/C) and the three plate selects read `pk.at(...)` — options/locked/reason from
  the picker, the old `stepEndL…` branches kept behind `!useEngine`; (4) the engData effect reads `engDataFromPickers(pk,
  libraryIdOf)` when `useEngine`; (5) the sweep effect is skipped when `useEngine` (the settle IS the sweep) and the
  removals strip from #45 is mounted under the pickers; (6) save writes `specs.enginePicks` + keeps `specs` framing;
  `handleLoadDraft` restores `enginePicks` when present; (7) `git diff -w` proves the old path is untouched. Bridge
  `seedFromVision` already resolves by part. Live read on Brimar + H1-138 + H1-2TRV drafts with Stuart.

- **2026-09-10 — Vision Phase 0 (S1) b180339 pushed 23:32.** Stuart: "fix vision … runs on new engine and can open and reopen
  with no problems" → the #48 project, in HIS order: **0** drawings survive the save (this commit: finalize marks
  spatialData drafts FINALIZED instead of deleting; pending readers exclude; Vision Load-saved-line includes, labelled);
  **1** Vision's pickers from the engine's `slots()` via a pure module (`Shared/visionEngine.js`, node-proven on the live
  pins) — the board / placement / cut sheet untouched (Stuart confirmed); flows with no pinned assembly keep the old path;
  **2** open + reopen both ways (CPQ → Vision write-back; Vision re-save replaces the cart line in place — today a
  re-saved FINALIZED line becomes DRAFT_FROM_VISION and a RESUME would ADD a second line — named); **3** the generator
  stops emitting TRV END steps. #44 re-verified: guard not needed (floors cover it); reopen = the deletion above.

- **2026-09-10 — Issue 10 (S1) 26f45de pushed 23:04 — §3 #45.** `Shared/pickDrops` (droppedPicks / mergeDrops / unacknowledged,
  16 assertions) + the strip under the rail + Add/Checkout refusal until acknowledged. Diagnosis: ends-then-rod keeps
  the returns at every depth on H1-75 / H1-1 / H1-138 today (fee returns carry no `projs` into the engine — the fee is one
  item at any depth; the render copy follows the cut); what still removes silently = rodKind / setup / projection
  changes and anything a reopen or Vision seed no longer fits. Engine note: `resolve()` re-normalizes, so a normalized
  choice fed back in loses `projs` — harnesses must pass raw rows (not changed). Rail read owed after re-PIN.

- **2026-09-10 — Issue 9 (S1) 2c61b3e pushed 22:34.** S2's refused-queue stamp: `refusedStamp` / `queuedStamp` helpers in
  CPQTab's finalize (both branches + catch); tab 12's manual push clears the three too. Field names per S2 verbatim.
  Handed S2 the exact `queueNsTransaction` args + the parts-universe rule for its Queue now (BRIEF_S2 §6).

- **2026-09-10 — Issue 8 (S1) 38b1ba6 pushed 22:08.** S5's correction landed: `TRAVERSE_FAMILY_PARTS['H1-138TRV']` = arm by
  depth + `plates` by orientation; explode adds the plate line (role 'plate') at the plate row's count; string DOUBLE.
  Guard test compares brackets + plates (was red on main after 105b29c). Fixtures per S5's note (4 ft -4H/P; 12 ft -4VD/EP =
  24 rods, Stuart confirmed). Still on my desk from S2: stamp `nsTransmitRefusedAt/Code/Message` on the job when the
  queue refuses, clear on success (BRIEF_S1 §6) — plan next.

- **2026-09-10 — Issue 7 (S1) bb5b5e1 pushed 19:48.** Plate follows its arm (reseatPicks). Also on Stuart's ask S1 WROTE
  production tags through the app session (module 565 setDoc=`BN`, doc=`H9`, merge): tier FRONT on 8 double-return fee
  pins (H1-75 1.6 #18/#19, H1-1 1.6 #31/#32), setup DOUBLE on 40 H1-75 plate pins with proj 6.5 (1.6 #37/#38/#40/#41/#42);
  read back 8/8 + 40/40; pin ids in scratchpad `tagplan.json`. Preview findings: double-return back-end suppression fires on
  all three flows on today's pins; 6.5 on a single = the 40 plates (fixed by the tag).

- **2026-09-10 — Issue 6 (S1) 9415338 pushed 19:23.** S5's Asks 1 + 2 landed (H1-138TRV explode entry; rules by family in
  CPQTab + QuickShipTab; `singleProjections(family, style)`). Stuart's rulings in the entry: returns are fees on the end
  steps (138TRVFR / 138TRVMTR), never exploded; plug = H1-2TRVPLUG placeholder. Tests: 4 ft -4H/P, style V, 12 ft -4VD/EP
  (2 rods/ft — OPEN vs S5's 12 × rod), motorised = nothing consumed, H1-2TRV unchanged, table == importer export (guarded).
  Next: the end-to-end read (CPQ kit cover + tab 7 chart) after S5 pushes and Stuart tags Kit Family + runs the 4.6 import.
  Stuart's open tag list (with both slot numbers) is in the chat log of this session: drive MANUAL (H1-75 4 clusters,
  H1-1 4, H1-138 17), single returns on a double (decision), carrier #12 vs #43, in-line stragglers H1-138 #51 / H1-75 #46.

- **2026-09-10 — Issue 5 (S1) 6572b6f pushed 18:17.** Parked geometry never rides (normalizeChoice `always` excludes
  parked / HIDDEN- ids). Tag pass verified on live pins (36 `ridesWith` pins across H1-138 / H1-1; shapes table in the
  chat log). Older test fixture `HIDDEN-NUTP` → `NUTP-01` (a HIDDEN- id is the placeholder by rule). Next: S5's H1-138TRV
  kit hand-off (§6).

- **2026-09-10 — Issue 4 (S1) e4ab15a pushed 17:30.** `ridesWith: RETURN` pin tag (adapter → normalizeChoice → ridersFor
  `returnChosen` gate; 1.6 select beside "hide"; both save paths). Proven: 677 engine assertions, runner green, build
  compiled. Rail read of the one-order change done on all four flows (bd5907e); rod-first then a foreign bracket reseats
  the rod's copy, nothing silently dropped. Stuart to tag: H1-138 #72 (+ #16/#17, #96/#97/#103/#104 if wanted), H1-1 #31/#32
  (one pin at #32 has setup blank); H1-75 has no real standoff pins. Defect named: H1-138 #71 standoff pinned as RETURN.
  Two pre-existing `import/first` lint errors in hardwareAdapter.js (78–79) left as found. Commits staged as HEAD+mine
  blobs so S5's uncommitted lines in this brief / BRIEF_S5 / the board are NOT carried.

- **2026-09-10 — Issue 3 (S1) bd5907e pushed 15:07.** One step order for every flow (engine rank = SLOT_ORDER; length
  after the rod). Came after the H1 tag audit (`H1_TAG_ALIGNMENT_2026-09-10.md`, three revisions: locators must
  carry BOTH the 1.6 chip `#n · slot` (0-based load order) and the 1.5 list number; the "traverse inside
  H1-138" is the 1-3/8" traverse product, withdrawn). Stuart's tag pass verified in the pins. Audit tool:
  scratchpad `h1audit.mjs` over a clipboard dump of the live pins (Firestore reached through the page's webpack
  registry — module 565 = firestore fns, 5042 = app). Handed S4: mirror the rank in `portalEngine.js`.
  ⚠ My notice commit ce91681 staged two of S2's uncommitted doc lines (their tree edits) — reported in BRIEF_S2 §6.

- **2026-09-10 — Issue 2b (S1) 16a74bb pushed 11:24.** CRM pipeline card prints JOB · SIDEMARK · PO (Stuart's ask after
  trying the header modal: "the modify works well"). Issue 2 (1259391) went live at 10:30 inside S2's push —
  a local commit on main is a push in waiting; from now on S1 commits only once Stuart has cleared the push.
  1259391 verified in `967.b8687f3c.chunk.js` (4a05e85 build, 38/38). Issue 3 on hold: Stuart walks the step
  order through with tags before anything moves.

- **2026-09-10 — Issue 2 (S1) built, committed locally, push held for Stuart's window.** CRM "Modify Quote /
  Job" now edits the WHOLE checkout header: order sidemark (the typed `orderSidemark`), PO #, internal memo,
  need-by, production notes, ship-to (saved address from the customer's CRM record or custom drop-ship) and the
  shipping charge. `Shared/salesOrderHeader.jobHeaderPatchOf` = the one field set CPQ's finalize writes
  (`scripts/jobHeaderPatch.test.mjs`, 19 assertions incl. the soHeaderOf round trip); the save patches the
  jobs doc, then, when `hq_sales_orders/SO-APP-<quoteNo>` exists (and is not QUICKSHIP), rebuilds the SO
  header through `soHeaderOf` from the patched job (ready date / recipe kept; `createdBy` kept;
  `headerEditedAt/By` stamped on both). NetSuite is NOT updated (outbox creates only) — the modal says so when
  an estimate / SO number exists. Named for S2/S3: floor docs already split keep the sidemark / need-by they
  were split with (no re-stamp built). Issue 1's deploy (a58d126) verified in `main.d8130142` and again in
  `main.d7d368f0` (4000ea4, docs push, 38/38 assets).

- **2026-09-10 — Issue 1 (S1) built, committed locally, push held for Stuart's window.** Live pass on his
  orders (ST091026-01, ST090926-09, QUO141, SO60339/60341) found that NO H1-138 quote had queued its
  NetSuite estimate since 21 Aug: the engine hands over `HIDDEN-<node>` parked-geometry lines ($0, hidden)
  and `nsTransmit`'s TAGS branch refused them as hard-unresolved (LINES_UNRESOLVED; the alert pointed at
  tab 12, which never lists a CONFIGURED quote). Fix: `Shared/lineClassification.isParkedGeometryLine`
  (HIDDEN- prefix AND no money) + one skip in the resolver; `scripts/parkedGeometryLine.test.mjs` (11).
  Data for Stuart from the same pass: `CE-INV-57732` H1-138JNR lacks the Unfinished tag (its line carries
  EP5 + finishOutsourced); Brimar BL/GOP get no lead class (asked, not derived); QUO141 shows F2's E half
  (kit components at $0) NOT shipped; "No Sidemark" literal reaches NetSuite custcol3; the CRM quotation's
  date shifts a day (`docDate` parses `dateSaved` as UTC) and prints the doc id, not the short number.
  Queue after this, in Stuart's order: (2) CRM button to edit the checkout header (ship-to, sidemark, memo,
  PO) without re-walking CPQ — reopen AT the checkout; (3) H1 step order aligned across H1-75 / H1-1 /
  H1-138: rod choice right after rod setup + projection, then rod length, then the rest.

## 8. Opener (paste to start the session)

```
You are the S1 session — CPQ · Vision · Order Entry · CRM · the tag engine · 1.6/1.5 authoring. Read, in
order: CLAUDE.md (the working agreement binds you), SESSION_COMMS_2026-09-10.md (the map, file ownership, the
hand-off protocol — briefs are the channel), STATE_OF_THE_APP_2026-09-10.md (your items are named in BRIEF_S1
§3), BRIEF_S1_CPQ_VISION_CRM.md (your brief), then CPQ_VISION_HANDOFF_BRIEF.md (the live-proven 09-09 state),
BRIEF_E_HANDOFF.md, BRIEF_16_AUTHORING_ALIGNMENT_HANDOFF.md, and the memories brief-e-sales-side-session,
h1-2trv-traverse-engine-session, hardware-tag-engine, fabricut-projection-tag-defects. Rules: all fixes on the
items, not the flow; never hardcode against flow details; extend a shared screen by one guarded mount, prove
it with git diff -w; a fix is proven in a node test before a screen. Saving in CPQ is sending — never save a
test quote; Stuart's own quotes-becoming-orders are the round-trip tests. Do not push while he is mid-entry.
Other sessions: S2 (RTG/WO/PO — owns the split that reads your header and classifyLine), S3 (floors/WMS/
functions), S4 (portal — mirrors your logic by hand-off), S5 (kits 4.6 / spec sheets — hands you kit records).
Cross a line: stop, patch spec into THEIR brief's § Hand-offs in, log it in your § Status log. Git: never
switch branches, stage only your files, pull --rebase --autostash, safe-push check, eslint 0 errors, sweep
asset-manifest.json to verify. Plan first and wait — every time. One issue at a time. First: follow Stuart's
live orders through CPQ → CRM → tab 12 → the Transmit Log and report observed values; then ask him which of
BRIEF_S1 §3 is next. Identify as "(S1)" in every commit.
```
