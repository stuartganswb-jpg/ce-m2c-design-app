# Brief S5 — customer-facing: spec sheets · 4.6 Customer Collections and kits · marketing · guide books · assets

*Written 2026-09-10 by the communicator session. Starts when Stuart opens it. Read, in order: `CLAUDE.md`,
`SESSION_COMMS_2026-09-10.md`, `STATE_OF_THE_APP_2026-09-10.md` (your items: §1 F, §2.4 #46 (the kit half), #49,
#50–51), then the memories `spec-sheet-generator` (trusted over every spec-sheet brief), `spec-sheet-cpq-contract`,
`brief-f-decisions-2026-09-03`, `quick-ship-stocked-items` (the kit model), `onboarding-xlsx-export`,
`guide-builder`, `asset-gallery-fabricut-combo`, `canonical-tag-spec`; then `BRIEF_F_KITS_SPEC_SHEETS.md` §2–§4 (F2,
F4, F6, F9 are yours), `KIT_CPQ_ALIGNMENT_BRIEF.md` (for why; the CPQ half is gone), `SPEC_SHEET_CPQ_TIEIN_BRIEF.md`
Part 3 (the offline replay harness), `ASSET_GALLERY_PRINTS_SPEC.md`. Older spec-sheet briefs are history where
they conflict with the memory.*

## ⛔ Working agreement + standing rules

Plan first and WAIT. Requested scope only. No temporary fixes. Trace downstream: a kit record feeds S1's engine
seed and tab 7's counter; a 4.6 row save rewrites part of the item's Fabricut pricing box (one way, on purpose
— Stuart chose A: keep it one-way and show the before/after tier numbers in the confirm); a spec sheet reads the
same pins the CPQ reads. One issue at a time. **Tags before code** — a wrong page on a sheet is almost always a
wrong tag in 1.6 (S1's file; hand them the tag, never draw around it). **Never filter the answer you asked for;
one code can be two pins; read subjects by role, not slot kind; fixtures use the prod shape; a fixture that
cannot fail is decoration** (the spec-sheet traps, all still live).

## 0. Operating

- The spec sheet opens from 📐 in BOM Engine (tab 3); 4.6 is Customer Collections; kits live in 4.6 → KITS and
  `system/quick_ship_kits`; guide books in tab 1; assets in 14 / 14.5 / 14.6; marketing in tab 5.
- **The fast loop:** `node scripts/specSheetPages.test.mjs`, `specSheetRows`, `kitSeed` (68), `kitCode`,
  `feeRules`, `priceLevels`, `customerDocLines`, `tagSheetImport`; the **offline replay harness** for sheets
  (`SPEC_SHEET_CPQ_TIEIN_BRIEF.md` Part 3: pull the pins + clusters dump via the console recipe keeping
  `passing`, `legacyErpId`, `returnOnly`; `curl` the assembly's `cadUrl`; strip textures; replay
  `choicesFromAssembly → specPages → buildPageSvg` headless). The scratchpad dies daily — rebuild it in minutes.
  Fit percentages are stated, never screenshot-looped.
- **Driving a 4.6 save from the browser tools:** the client-row save gates on `window.confirm` — stub both
  `confirm` and `alert`, read the confirm text back (it states what else the save touches).
- Deploy-verify: `CustomerCollectionsTab`, the SpecSheet modal, `AssetGalleryTab`, the batch processors are lazy
  chunks; sweep `asset-manifest.json`.

## 1. Territory

**Own:** `SpecSheet/*` and `system/spec_sheet_config`; `HQ/CustomerCollectionsTab.js` (4.6: COLLECTION, FEES,
KITS, CHECKOUT, PLATES, ARMS); `Shared/kitSeed`, `kitCode`, `customerControlFile`, `clientPricing`, `priceLevels`,
`feeRules`, `itemStarterXlsx`, the onboarding xlsx export (BOM Engine's Generate Excel); `system/quick_ship_kits`;
`HQ/GuideBuilder`, `guideCapture`; `Shared/AssetGalleryTab`, `BatchImageProcessor`, `BatchTextureProcessor`; tab 5
Marketing.

**Read-only:** S1's engine and 1.6 (you *read* pins; a tag change is a hand-off with the slot #), S1's
`hardwareHandoff` (the line contract — a kit-seeded configuration must hand it the same `partId / legacyErpId /
partHandling / finishCode` as a hand-built one), S1's documents (`printForm`, `FormPreview`, `customerDocLines` —
you may propose; they edit), S2's spine, S3's floors, S4's portal (which mirrors `priceLevels` / `sizeMatrix`
by hand — tell S4 when a pricing rule changes).

## 2. What is live (do not rebuild)

The spec-sheet generator rebuilt on the tag engine (one page per leaf × subject from `activeAxes()`, measured
grid, one true scale, "REDUCED n%" honest, 8.5×11 binder, doubles by rod selection, returns as plan view,
ceiling pages by drop, one unioned catalog, `auditPages` scoping guarantee). 4.6 as the guide describes it
(pickers, grid, P/EP editor, checkout items two homes, fees, kits as real item records with a finish matrix,
plates & arms, control-file and kit-sheet imports with a full diff). Kits: `kitSeed.seedFromKit` writes
`answers` + `picks` and refuses (`blocked`) when the assembly cannot honour a defining choice; F2's F half
(`applyKitPricing`: `billGroup` 1–4, included at $0, motor folded at the per-motor code); `kitFamily` tag match;
the kit picker shows the customer's kit code. Guide books (8.5×11 pages, pin/leader/text notes, CPQ "Send to
Guide"). Asset gallery Fabricut combo tagging, bulk re-tag, crop per folder.

## 3. The work, in order — Stuart picks

**Kits (Stuart's decision of 09-03: ONE kit bill shape on both doors)**
1. **#46, your half:** confirm `applyKitPricing`'s output is what S1's push and documents expect (kit + first
   4 ft with the motor folded · extra feet · added parts · included at $0), with prod-shaped fixtures; hand S1
   the `billGroup` contract in writing (it is in `kitSeed.js` — quote it into `BRIEF_S1` §6). S1 owns the
   NetSuite side (all $0 + one holder line) and the document order.
2. The 30 `H1-2TRV-4*` kit records: 4.6 `frontRail` must be set on the -4D / -4DC / -4MD / -4MDC (TRACK) and
   -4FRT / -4MFRT (RING) records for the seed to answer `frontLayer` (Stuart's data; you run the sitting).
3. F2's remaining questions (`KIT_CPQ_ALIGNMENT_BRIEF.md` §3.4, answered 09-03): projection stays asked; seed,
   never lock; the kit-matched configuration bills the KIT shape above; the motor as tab 7 does. Build the
   CPQ kit strip's "seeded / missed / blocked" report if it is not complete (check `HardwareConfigurator` —
   S1's file; spec to them).
4. Kit sheet imports beyond H1-2TRV (the pending list in `CPQ_ORDERENTRY_TAB11_BRIEF.md` §2).

**Spec sheets (F4 — the memory's stated NEXT)**
5. **#50** the text and measurement pass on the harness first: the type scale was sized for a 64% reduction that
   no longer happens; text is most of the fixed overhead; callouts on row 1 only; the footer's REDUCED line kept
   honest. Then the two repeated right-hand columns on return pages — **French Return** and **Passing Support
   Arm** — the row builder makes detail/front/profile only. Stuart's Q4 (09-03): the 4-row plate sheet is NOT
   to be touched; H1-138 is at 2 rows per sheet and he is content.
6. Verify `H1-138D`'s two-step dimension reads wall → 3¼ → 5¼ on paper (the memory says every placement
   measured 0.00 on the harness; it was never confirmed on paper).
7. H1-2TRV sheets (fascia + stationary front = ring AND carrier on one page) — the declared next stop.
8. PDF download is a 300 dpi raster embed; the print window is the true-vector path. Only if Stuart asks.

**Data with Stuart (the spec-sheet share of §2.3 #28):** S72 rear-pole `returnOnly` re-ticked and saved (it
did not persist); FR/MTR double return pins' proj as `FRONT:8.5, BACK:3.25`; the 6" single returns'
`feeItemNo`; the wood singles' untagged pin copy; the two NEW-SLOT finial sections → `rod: front`; prices for
`H1-138AR`, `H1-138D`, `H1-DBLMR` in 4.6. Each is a tag or a price in S1's 1.6 or your 4.6 — cite the slot #.

**4.6 and pricing**
9. The 4.6 row → tier coupling confirm shows before/after tier numbers (Stuart's answer A, 09-03) — verify it
   does; if not, one small change in your file.
10. Fabricut price levels, the H1-75 depth audit, per-foot $0 quotes reopening once — the `fabricut-h1-rollout`
    memory's open list; ask which still matter.

**Marketing, guide books, assets**
11. Tab 5 Marketing — the communicator has not read it; survey it and report what it is before proposing.
12. `ASSET_GALLERY_PRINTS_SPEC.md` (program prints from the gallery, "Print" resolving by program name) — status
    unknown; check against `Shared/programPrints.js` (S3's) and the gallery before proposing.
13. The onboarding price-list xlsx and the customer control file — keep them reading `clientPricing` through
    the one matcher (`Shared/clientPricing.js`, yours).

**Guide (S2 rule) — #49:** no section exists for kits ("a kit is a configuration in another spelling; what seeds,
what refuses"), spec sheets ("what a page is, the paper, why a sheet says REDUCED"), or 4.6's KITS / CHECKOUT
views beyond the 4.6 chip. S1 owns the tag-engine section; coordinate before editing `UserGuideTab.js`
(`git status --short` it first).

## 4. Acceptance

| run | expect |
|---|---|
| a kit code entered in CPQ (with S1) | seeds axes; strip shows seeded / missed / blocked; a blocked kit does not open; the breakdown carries the full line contract in `billGroup` order |
| the same kit on tab 7 and in CPQ, on paper | identical line order; tab 12 shows one holder line at the configuration total and N lines at $0 |
| H1-138 return page | French Return + Passing Support Arm columns present; the footer's REDUCED figure equals the harness's |
| H1-138D on paper | wall → 3¼ → 5¼ |
| a 4.6 client-row save | the confirm states the tier numbers before and after; the tiers survive |
| `sh scripts/run-traverse-tests.sh` | every suite green; new assertions mutation-tested |

## 5. Questions for Stuart

1. Which first: the kit contract with S1 (#1), or the spec-sheet text pass (#5)?
2. Tab 5 Marketing — what does he want it to become? (Survey first, then ask.)
3. When does the data sitting happen (the kit `frontRail` records; the spec-sheet tags)?

## 6. Hand-offs in

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · 7d3f594 pushed at 16:28 EDT (S1 swept every served asset after the deploy: version stamp 1789158660457, `Line discounts are applied in the cart` + `Line discounts from the cart` in `main.74cee60a.js`, Vision chunk `104.74c087bc.chunk.js`; recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **(1) DISCOUNTS, the cart or the checkout, never both** — Stuart's redesign of S5's order-level ask: in the CPQ cart a manager or higher (admin / superadmin / manager / executive) ticks lines and applies a % off or sets a net unit price (`Shared/lineDiscount`, gross unit price never overwritten); at checkout a set % replaces the customer's code for the order. The job header stamps `orderDiscount { mode: LINES | ORDER_PERCENT | CODE | NONE, percent, code, by }`; cart items may carry `lineDiscount`; breakdown rows are `isDiscount` / `isNetLine` (+ `isLineDiscount`) — every floor consumer already skips them via `isDisplayOnlyLine`. NetSuite: a cart-discounted line pushes at its OWN lower rates (`nsTransmit` per-item `netFactor`), the set % / code ride the whole-quote scale as before; the Transmit Log names the mode. **(2) QUO147 'one splice shows 3'** — a reopen rebuilt hand-added extras from breakdown rows by doc id and the length step auto-added its joiner by code, one more per cycle; now `engineConfig.extras` is saved as typed and a legacy line reopens merged one row per item (`Shared/extrasRestore`). **(3) QUO142 in Vision 'keeps asking for a bracket'** — the Save Line gate now reads the engine's own left bracket picker (`visionEngine.engineEndSettled`): a return / inside mount that locks it counts as settled. `cpqData.totalPrice` stays the one net number. Work orders / finishing / shop / WMS / Sales Snapshot untouched. Your side: **the settled field for your display build orders (replaces my §6 ask on the order-level shape):** the door that enters the display SO stamps `orderDiscount` on the job — for a display order hand `{ mode: 'ORDER_PERCENT', percent: <n> }` (a set % for the whole order, applied at CPQ checkout) or per-line `lineDiscount: { mode: 'PERCENT'|'NET', percent | netPrice }` on the cart items (a manager sets them in the cart). Tab 7 has NO discount yet — offered to Stuart as the next issue (same set % at checkout); until then a display order that needs a discount goes through CPQ.

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

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · 2b164a5 pushed at 09:59 EDT.** Hard-refresh + re-PIN before your next save.
  What shipped (Vision Phase 2): CPQ cart lines on the tag engine gain a **Vision** button (line → draft on the board);
  a Vision re-save of a line CPQ already holds REPLACES that line on Resume instead of adding one. `cpq_drafts` gains
  optional `cartItemId` / `openedFromCpqAt` (status `DRAFT_FROM_CPQ`); cart lines gain `visionDraftId`. Jobs / floors /
  NetSuite untouched until a re-finalize. Your side: nothing.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-11 · e2cef1f pushed at 08:42 EDT (S3 sweeps every served asset after the deploy
  and records it in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: (1) WMS pick queue —
  a finishing doc RTG's bulk reopen restored with a reconstructed pick state (`reopenConfirmPick: true`) shows a red
  "⟲ REOPENED — confirm pick state" chip on its queue row and the active pick header, with ✓ confirmed; completing the
  pick clears it too (`reopenConfirmPick: false, reopenConfirmedBy/At`); refuses nothing. (2) Shop floor — Undo on a doc
  the closer stamped `closed: true` now REFUSES, naming who/when/why and pointing at RTG (before: status went back to In
  Process with the closed flag left, so the card vanished). No NetSuite write; no shape change beyond the three confirm
  fields S2 specified. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-11 · 3c0e101 pushed at 08:33 EDT.** Hard-refresh + re-PIN before your next save.
  What shipped (Vision Phase 1b): on a flow with a pinned assembly, Vision Hardware's hardware pickers (ends, brackets,
  plates; rear ends on a double) come from the engine's slots with the engine's locks and reasons; a saved line carries
  `specs.enginePicks`; Push to CPQ waits for acknowledged removals. Flows without pins: unchanged. `cpq_drafts` gains the
  optional `specs.enginePicks` array. Board / placement / cut sheet / engineeringNotes shape unchanged. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 21bea0f pushed at 23:40 EDT.** Hard-refresh + re-PIN before your next save.
  What shipped (Vision Phase 1a, the pure half): `Shared/visionEngine.js` (pickers from the engine's slots), the bridge reads
  `specs.enginePicks`, and the adapter / engine carry the pin's `endTreatment` on the choice (additive; no rule reads it).
  NOTHING on any screen changes yet — Vision Hardware still reads the old steps; the mount is Phase 1b. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · b180339 pushed at 23:32 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped (Vision Phase 0): CPQ's
  save no longer deletes a quote's Vision drawings — `cpq_drafts` docs with `spatialData` are kept and marked
  `status: 'FINALIZED'` (+ `finalizedJobId/At/By`); pending-line readers exclude them; Vision's "Load saved line…" lists
  them. So CRM → Reopen Vision on a saved quote has its lines again. Jobs / floors / NetSuite untouched. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 26f45de pushed at 23:04 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: CPQ (tag engine
  configurator) — a selection a later choice removes is listed in a strip under the step rail with the engine's reason,
  and **+ Add configuration / Checkout refuse until each is acknowledged** (BRIEF_S1 #45, Stuart: "never a silent
  clear"). New pure reader `Shared/pickDrops.js`. Nothing leaves the configurator differently; no document or field
  shape change. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 2c61b3e pushed at 22:34 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: a REFUSED NetSuite
  queue at CPQ save is stamped on the `jobs` doc — `nsTransmitRefusedAt` (ms), `nsTransmitRefusedCode`,
  `nsTransmitRefusedMessage` (≤500 chars) — in both save branches and the catch; a later successful queue (CPQ save or
  tab 12 push) removes all three with `deleteField()` in the write that stamps `nsTransmitQueuedAt`. Jobs document only;
  no floor document, no NetSuite write. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 38b1ba6 pushed at 22:08 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the H1-138TRV kit
  explosion re-keyed to S5's correction — an ARM by depth (SBA/EBA/6BA/DBA/CBA) plus a BACKPLATE by orientation
  (BP-H/BP-V/BP-C) per bracket position, both at the chart count; no sheet combo code is ever consumed. H1-2TRV
  unchanged. No document or field shape change. Your side: your correction is LANDED; the guard test `the explode table and the importer export the SAME codes` is green on main again and now compares `plates` too. The 12 ft double explodes 24 rods (two per foot), per Stuart's confirmation in your note.

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
  No document or field shape change; the H1-138TRV rules document is S5's importer's to write. Your side: your Ask 1 and Ask 2 are LANDED. The guard test `the explode table and the importer export the SAME codes` runs against your `H1_138TRV_PARTS` (it passed here against your uncommitted file) — push your half and it holds on main. ONE question to settle with Stuart: a 12 ft `-4VD/EP` double explodes TWO rods per foot in my table (the double bracket carries two tracks, as H1-2TRV's track-front double consumes two tracks); your fixture note said 12 × rod. Rules-doc reads are by `kitFamily` now, so `traverse_rules_H1-138TRV` is read as soon as your import writes it.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · 6572b6f pushed at 18:17 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: tag engine —
  **parked geometry never rides**: a pin with no item number (`parked`, or a `HIDDEN-<node>` id) is no longer a rider, so
  new quotes lose their $0 `HIDDEN-…` placeholder breakdown lines. Real hidden parts with an item ride as before. No
  document or field shape change. Your side: nothing for kits/spec sheets.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · e4ab15a pushed at 17:30 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: a new pin tag
  **`ridesWith: RETURN`** (1.6 tag row, beside "hide": rides the rod / rides a return) — a hidden rider so tagged reaches
  the BOM only when a miter or French return is chosen on the order AND its rod is on the order (never a single). Built
  for the H1-138 standoffs of the short rear rod (`1.6 #72 / 1.5 #68`); H1-1's `#31/#32` get the same. Untagged
  riders unchanged. Docs: `assembly_pins` gains the optional field `ridesWith`. Your side: nothing for kits/spec sheets; the H1-138TRV kit work you handed me is read and queued after this push.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-10 · f5a6c19 pushed at 15:14 EDT (S3 sweeps every served asset after the
  deploy and records it in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: WMS →
  Rod Cuts & Ring Packs → RING PACKS gains **⇄ REPACK** — break N packs and build another size from the eaches in one
  flow (5 × /BL-12 → 60 × /BL-EA → 6 × /BL-10, remainder stays loose in the each bin). Two NetSuite records through the
  convert RESTlet already deployed (unbuild, then build); a build failure after the unbuild is reported as an honest
  partial state. `PickPackApp.js` only — no RESTlet, functions, outbox, document or field shape change; pack SKUs are
  shelf stock nothing on the spine reads. Your side: nothing.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-10 · bd5907e pushed at 15:07 EDT (S1 sweeps the served bundle after the deploy
  and records it in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: the tag
  engine's step order is ONE order for every flow — Rod Setup → Rod → Rod length → Ends (front L, R, then rear)
  → Bracket → Backplate → Rings → Accessories (`Shared/hardwareModel` rank; `HardwareConfigurator` length step).
  Consequence you may notice: the BOM / quote lines follow the slot order, so a NEW quote lists the rod first,
  then ends, brackets, plates, rings — identities, quantities and prices unchanged; older quotes keep the order
  they were saved with. No document or field shape changed. Your side: spec sheets are unaffected (page order is the engine's narrowing, not the step order); documents print lines in the new order for new quotes.

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
  is NOT updated by the edit. Your side: the DOCS packet re-reads ship-to / sidemark / PO from the job at print time, so the paper follows the edit; nothing in kits or spec sheets changes.

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
  gains the estimate entries it was missing. Your side: the money documents already dropped `hidden` lines (`customerDocLines`); the spec sheets and kits are untouched. Re-PIN is the one S2's deploy already required.

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

*(none yet)*

## 7. Status log

*(newest first)*

- **2026-09-11 — Issue 3 (S5) d3c6777 PUSHED and SWEPT: stamp 1789153072018 → 1789155620577, 40 assets; all four markers (`New build order`, `Re-take the bill from the display`, `display_demand_`, `Fill plan`) in `665.aff7b20f.chunk.js` — the shared panel chunk both 5. Marketing and 10.5 load. Notices in BRIEF_S1–S4 §6, board Deploys row + status, state doc §6. Next: Stuart's first display and first build order (the tracker's 50 tabletops); then I confirm `display_demand_CE` is populated and S2 builds the column.**

- **2026-09-11 — Issue 3 (S5): display BUILD ORDERS — BUILT, tests green, awaiting the push window.** `Shared/displayBom` gains `buildLinesFrom` (snapshot of the board bill as order lines with the tracker columns), `resnapshotLines` (typed WO#/plater/notes/done survive a re-take), `displayDemandFrom` (open boards × per-board, done lines and COMPLETE/CANCELLED orders excluded, keyed by the finished SKU `billedId` else code, plus `CHIP|<finish>`), `shipPlanFill`; harness 36 → 50, four mutations caught. `HQ/DisplayBuildsPanel.js` (new): orders list, open an order from a display × qty × customer (crm_records CUSTOMER) × SO/PO, ship plan (fill N every D days from a date; planned/shipped per drop), the lines table with the tracker's columns, boards built → open demand, Re-snapshot, status. Writes `system/displays/builds/{id}` + `system/display_demand_<brand>` (recomputed from every open order on each save/delete). Mounted twice: a Designs | Build orders toggle on 5. Marketing, and ONE guarded mount at the top of 10.5 Project Mgmt (`ProjectManagementTab.js`, unowned — named on the board). **Never writes `jobs`** — CRM (`ExternalCoopTab.js:881`), RTG (`RTGDispatchTab.js:149`) and tab 12 list every brand job, so a build there would be a phantom quote. No work order raised (RTG spine rule) — WO numbers recorded as the tracker does. Handed S2 (BRIEF_S2 §6): the "Display" column on the Sales Snapshot reading `display_demand_<brand>` (shape stated) + include it in the Rec math.

- **2026-09-11 — Issue 2 (S5) b3fd59f PUSHED and SWEPT: stamp 1789146260823 → 1789152828095, 39 assets (one new lazy chunk); `Add a row from the CPQ cart` + `PREMIUM PLATED METAL` in `695.e3344d66.chunk.js` (the designer), `DISPLAY CAPTURE` in `main.a53a11cd.js` (guideCapture). Push carried S2's docs-only c0f562d (noted in BRIEF_S2 §6). Notices in BRIEF_S1–S4 §6, board Deploys row + status, state doc §6. Next: Stuart's first display via CPQ → cart → place; then Issue 3 = build orders (→ 10.5) + the display-demand record (S2 column spec).**

- **2026-09-11 — handed S1: ORDER-LEVEL DISCOUNT on both doors (BRIEF_S1 §6, From S5 2026-09-11) — Stuart's ask for the display program; today only the customer trade code exists (CPQ per item) and tab 7 has none. Issue 2 pushed with Stuart's word ("push knowing this is coming").**

- **2026-09-11 — Issue 2 (S5): the Sales Display Designer — BUILT, in the working tree, NOT committed (Stuart: wait).** Stuart's ask: a tool to design and manage the production of sales display boards (tabletop: product front + chip back; wall: product board + chip board; 50 + 35 in flight, 100 more ordered; H2/H3/H4 coming). Sources: `0903/Displays/` (tracker xlsx + four renders). Decisions: rows come from the SHARED CPQ cart (HQ.js `globalCart`, one prop pass); designer first, build orders (→ 10.5) second, the Sales Snapshot "Display" demand column third (S2 hand-off); NetSuite SO = lump sum (my recommendation, Stuart leaning the same; component relief at build = a piece-2 question for Eric). Built: `Shared/displayBom.js` (pure: rows→lines, item+finish aggregation with feet, chips one per sellable finish grouped plated/brass/painted/wood, chip-face layout at 100 u/in, order multiply, tracker-shaped CSV) + `scripts/displayBom.test.mjs` (36 assertions, 4 mutations caught); `HQ/DisplayDesignerTab.js` (list, faces with sizes, to-scale SVG board with Guide-Books drag/resize, chip face auto-laid, Add row from cart → render filed as a DISPLAY CAPTURE in global_assets via `saveGuideCapture(kind)`, extras, live BOM × N, Copy CSV; writes `system/displays/entries/{id}` only — no rules deploy); `HQ.js` +2 lines (lazy import + mount on the empty "5. Marketing" label, `cart={globalCart}`). Lint 0 errors, build compiled. Not verified on a screen (PIN gate); first live proof = Stuart entering the tracker's Top Row 1 via CPQ → cart → place. Downstream: reads the cart, writes one system doc + Storage images; no job/WO/floor/NS write.

- **2026-09-11 — Issue 1 (S5) chain COMPLETE and live: S1 landed 38b1ba6 (explosion re-keyed to arms SBA/EBA/6BA/DBA/CBA + plates BP-H/V/C, a plate line per bracket, guard test green on main; runner green on the merged tree). Stuart applied the import last night (preview: 8 NEW + 30 UPDATE kits, 104 components priced, 0 not in library, rules docs for both families). The tab-7 order hold is LIFTED. Remaining = Stuart's data (finish matrix optional — material fallback exists; H1-138 flow Kit Family `H1-138TRV` in tab 11 required for the CPQ picker) and the acceptance run: one H1-138TRV-4H/P kit on tab 7 (contents 4 × rod, 2 × SBA, 2 × BP-H, 2 plugs, no splice) and in CPQ (Start from a kit → carried traverse/single/manual/wall/4 ft; missed finish + bracket style), same bill both doors (kit 136, +30/ft above 4, included at $0).**

- **2026-09-10 — Issue 1 correction (S5) 105b29c pushed, SWEPT: stamp 1789084309360 → 1789086883805, 38 assets; `Fabricut bracket codes are arm + plate here` + `included with the arm` in `606.9fbe4164.chunk.js` (4.6 + the parser); main static/js/main.777877ed.js carries the seeder literal 'the arm follows the measured projection' (the earlier 'H backplate' marker was an interpolation, not a literal). Deploy notices in BRIEF_S1–S4 §6, board Deploys row + status, state doc §6. Hard-refresh + re-PIN.**

- **2026-09-10 evening — Issue 1 (S5) CORRECTION built, tests green but for S1's guard test (by design), push pending.**
  Stuart asked for a read of the live H1-2TRV records before re-applying the sheet ("i dont want to overwrite anything").
  Read via the console recipe (module 565 = firestore fns, 5042 = app `db`; reads work behind the PIN): all 30 H1-2TRV kits
  and 40 component rows would be rewritten IDENTICAL (every Fabricut row still `KIT_IMPORT` at the 13 Aug stamp); finish
  matrices / contents / collections outside the import; the rules doc differs only by explicit splice zeros at 2–10 ft
  (Stuart accepted: the components popup pre-sets 0 below 11 ft, his 9 Sep rule). FOUND: the 18 "not in library" codes are
  Fabricut COMBOS — the H1-138 assembly pins arms by depth (SBA/EBA/6BA/DBA/CBA) + backplates by orientation (BP-H/V/C), each
  in /P, /EP1–6, /P25 — so my afternoon mapping (and S1's 9415338 entry) keyed codes no item carries. Stuart: arm + plate,
  one each per bracket at the chart count; price on the ARM (H pattern), plates $0 with their own patterns. Built:
  `H1_138TRV_PARTS` re-keyed (arms by depth, DOUBLE/CEILING strings, new `plates`), rules rows for arms + plates,
  `splitComboCode` + combo → arm/plate rows with `finishTier`, `tierTargets` (P → `/P`; EP → every `/EPn` + `/P25` that
  exists, never the base) applied in `diffTraverseKits`, preview lists the 18 mappings, MISSING de-duplicated, seeder
  wording = backplate. Tests: importer +1 (16 combos → 10 arm + 6 plate rows, prices/patterns, tier expansion against a
  library slice), three mutations caught. Corrected hand-off in BRIEF_S1 §6 (plate line at the bracket count; their guard
  test red until re-keyed).

- **2026-09-10 — Issue 1 (S5) COMPLETE on main: S1 landed both asks in 9415338 (explosion entry `TRAVERSE_FAMILY_PARTS['H1-138TRV']`, rules doc read by `kitFamily` in CPQ + tab 7, `singleProjections(family, style)`); the guard test ties their table to my `H1_138TRV_PARTS`; runner green on the merged tree (fail 0). My derived rules rows key exactly the codes their explosion looks up (H/V at three depths, -HD/-VD, `H1-138TRVJNR`). OPEN for Stuart: S1 explodes a DOUBLE as TWO rods per foot (front + rear rod); my spec said one — S1's reading is the physical one and is what is live; the kit's double additional-foot price (63.5 vs 30) already prices both rods. Next = Stuart's data (4.6 import → finish matrix → H1-138 flow Kit Family `H1-138TRV`), then the acceptance run: one H1-138TRV kit on tab 7 and in CPQ, same bill.

- **2026-09-10 — Issue 1 (S5) 09104cf pushed 17:46.** The H1-138TRV kits (the entry below). Safe-push check: one commit, mine; the rebase carried S1's e4ab15a + 8f91be8 (already on origin). Deploy notices written into BRIEF_S1–S4 §6, the board's Deploys row and status. Stuart's two confirms folded into the S1 spec: rod ends = `H1-2TRVPLUG` ×2 on a manual rod as a placeholder ("it will need to be updated but for placement sake it is better than nothing"); brackets wear the MAINLINE finish (`subFinishRoles: []`). Served-bundle sweep: VERIFIED — stamp 1789075982080 → 1789076872496, 38 assets; `Horizontal bracket` + `bracket at the measured projection` in `main.641da7e6.js` (kitCode / kitSeed), `NO DOC WILL BE WRITTEN` + `no 1-3/8" equivalent for` in `606.23d79921.chunk.js` (the parser + the 4.6 preview). Hard-refresh + re-PIN.

- **2026-09-10 — Issue 1 (S5): the H1-138TRV kits — BUILT, tests green, NOT committed (waits for Stuart's push
  window; a local commit on main rides the next session's push).** Stuart's Q1 answer replaced §3 #1: "add in the kits
  for the H1-138TRV kits … same spreadsheet … check the components and pricing are correct and that it will function
  with the cpq flow just like H1-2TRV does"; data answers: the models workbook `0903/abricut Hardware 2026 Models
  6.17.26.xlsx` (Models 1–4 = the 1-3/8" traverse: carrier style / draw / hand-drawn / component colours / bracket
  preference by depth or ceiling / returns as fees), "the exact same carrier usage and carrier options as the H1-2TRV …
  just the rod and brackets change", "mimic exactly" the H1-2TRV manner, and the ownership split (S5 edits the
  kit-sheet parser; S1 lands the explosion entry + the two per-family rules reads).
  Built: `Shared/kitCode.js` (second grammar `H1-138TRV-4(H|V)D?/(P|EP)` → `rodKind: TRAVERSE`, `bracketStyle`;
  `axesKeyOf` carries the style; describe chips), `Shared/traverseKitImport.js` (tab `H1-138TRV`: 8 kits, 19
  components; rules doc DERIVED from the H1-2TRV Carrier Usage tab — carriers + configurator verbatim, bracket rows per
  style with the same counts, splice → `H1-138TRVJNR`, DRTWB dropped and named; `families[]` on the parse result, the
  top level still H1-2TRV's; `H1_138TRV_PARTS` exported for S1's explosion entry), `Shared/kitSeed.js` (`rodKind` is an
  axis — first, as the engine asks it; blocked on a solid-only assembly; H1-2TRV kits carry none and are untouched; the
  bracket style is reported in `missed`, never picked — parity with projection on H1-2TRV), `HQ/CustomerCollectionsTab.js`
  (apply walks every family: `kitFamily` per entry, one rules doc per family, NO doc for an empty usage table — said in
  the alert; preview shows family + style + per-family RULES counts with "(derived)"), `scripts/run-traverse-tests.sh`
  (stages `./kitCode` for the parser). Tests: importer +5 on the REAL sheet, kitCode +5, kitSeed 68 → 80 (a combined
  fixture that asks Rod Type through the real `resolve()`); five mutations each caught (rodKind axis dropped, style
  unreported, key blind to style, tab ignored, H1-2TRV codes left in the derived rules). Lint 0 errors; `CI=false build`
  compiled. Handed S1 (BRIEF_S1 §6): `TRAVERSE_FAMILY_PARTS['H1-138TRV']` (rod H1-138TRV per ft, brackets by style ×
  projection, splice, no plug/motor — two confirms for Stuart: how the rod's ends close, and that the brackets wear the
  mainline finish since the sheet prices them /P and /EP), `singleProjections(family, style)`, `CPQTab.js:1070` and
  `QuickShipTab.js:228` rules reads by family. Until S1's entry lands, an imported H1-138TRV kit lists on tab 7 and seeds
  in CPQ but explodes nothing (no NetSuite consumption, brackets bill as ADDED) — Stuart told.
  Stuart's data after the push: 4.6 → Fabricut → ⬆ Import kit sheet (`Fabricut/Aug12/Fabricut_Traverse.xlsx`) → read the
  preview's NOT IN LIBRARY list (the 19 component codes are matched by exact code, `/P` and `/EP` included) → Apply;
  tick each kit's finish matrix; tab 11 → the H1-138 flow → Kit Family `H1-138TRV`.
  Family naming: the kits carry `kitFamily: 'H1-138TRV'` (= the sheet tab = the code prefix the hand-kit rule derives),
  the rules doc is `system/traverse_rules_H1-138TRV`; the H1-138 flow's tag is the one data step (its assembly code
  `H1-138` is not the kit codes' prefix, so the picker's fallback cannot find them).

## 8. Opener (paste to start the session)

```
You are the S5 session — customer-facing: spec sheets · 4.6 Customer Collections and kits · marketing · guide
books · assets. Read, in order: CLAUDE.md (the working agreement binds you), SESSION_COMMS_2026-09-10.md (the
map, file ownership, hand-off protocol — briefs are the channel), STATE_OF_THE_APP_2026-09-10.md,
BRIEF_S5_CUSTOMER_FACING.md (your brief), then the memories spec-sheet-generator (trusted over every spec-sheet
brief), spec-sheet-cpq-contract, brief-f-decisions-2026-09-03, quick-ship-stocked-items, onboarding-xlsx-export,
guide-builder, asset-gallery-fabricut-combo, canonical-tag-spec; then BRIEF_F_KITS_SPEC_SHEETS.md §2–§4 and
SPEC_SHEET_CPQ_TIEIN_BRIEF.md Part 3 (the offline harness). Rules: tags before code — a wrong page is a wrong tag
in 1.6 (S1's file; hand them the slot #); never filter the answer you asked for; one code can be two pins; read
subjects by role; fixtures use the prod shape; a fix is proven on the harness or in a node test before a
screen; the 4.6 row save rewrites the item's Fabricut tiers one way, on purpose. Other sessions: S1 (CPQ/engine/
1.6 — consumes your kit records through the engine mount; owns the documents), S2 (RTG), S3 (floors/WMS), S4
(portal — mirrors priceLevels/sizeMatrix by hand; tell them when a pricing rule changes). Cross a line: stop,
patch spec into THEIR brief's § Hand-offs in, log it in yours. Git: never switch branches, stage only your
files, pull --rebase --autostash, safe-push check, eslint 0 errors, sweep asset-manifest.json. Plan first and
wait — every time. One issue at a time. First: ask Stuart BRIEF_S5 §5 Q1, then plan that one issue. Identify
as "(S5)" in every commit.
```
