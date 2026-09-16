# Brief S6 — spec sheets: the 📐 generator, its paper, its text and measurements, its harness

*Written 2026-09-13 by S5 at Stuart's ask ("i need a new session to work specifically on the spec sheets"). Spec
sheets were S5's territory until today; S5 keeps 4.6 collections and kits, marketing (the display program),
guide books and assets, and continues on the display tool. Starts when Stuart opens it. Read, in order:
`CLAUDE.md`, `SESSION_COMMS_2026-09-10.md`, `STATE_OF_THE_APP_2026-09-10.md` (your items: §1 F, §2.4 #50, the
spec-sheet share of #28 and #49), then the memories `spec-sheet-generator` (**trusted over every spec-sheet
brief**), `spec-sheet-cpq-contract`, `canonical-tag-spec`, `hardware-tag-engine`, `brief-f-decisions-2026-09-03`
(Q4: the 4-row sheet is not to be touched); then `BRIEF_F_KITS_SPEC_SHEETS.md` §F4 and §F6, and
`SPEC_SHEET_CPQ_TIEIN_BRIEF.md` Part 3 (the offline replay harness). `SPEC_SHEET_HANDOFF_BRIEF.md` and
`SPEC_SHEET_SESSION_BRIEF.md` are history where they conflict with the memory.*

## ⛔ Working agreement + standing rules

Plan first and WAIT. Requested scope only. No temporary fixes. Trace downstream — a spec sheet is a READ of the
same pins and tags the CPQ engine reads, so a sheet defect is almost always a tag defect: **tags before code** —
a wrong page is a wrong tag in 1.6 (S1's file; hand them the slot # and the tag, never draw around it). One issue
at a time. The spec-sheet traps, all still live (memory, verbatim intent): **never filter the answer you asked
for; one code can be two pins; no single field holds the part code; read subjects by role, not slot kind; judge
the rod pool against the leaf before `rodForArm()`; fixtures use the prod shape; a fixture that cannot fail is
decoration — mutation-test every new assertion.** Stuart's locked drawing rules are in the memory (the pole is
fixed and everything moves back from it; an audit that fires when it should not is worse than none; one side is
the whole drawing; the paper is the 8.5×11 binder; carriers drawn through the track; ring drop = top of rod →
bottom of eyelet).

## 0. Operating

- The generator opens from **📐 in BOM Engine (tab 3)** on the selected assembly (`HQ/BOMTab.js:1204` button,
  `:1998` mount — three lines; the rest of BOMTab is not yours). Editions: H1 codes or Fabricut codes, never
  mixed. Left/Right toggle in the header. Print window = the true-vector path; PDF download = a 300 dpi raster
  embed (`specSheetOutput.js`).
- **The fast loop:** `node scripts/specSheetPages.test.mjs` (79) and `node scripts/specSheetRows.test.mjs` (19)
  — both green on 2026-09-13; then the **offline replay harness** (`SPEC_SHEET_CPQ_TIEIN_BRIEF.md` Part 3): pull
  the assembly's pins + clusters through the console recipe keeping `passing`, `legacyErpId`, `returnOnly`;
  `curl` its `manufacturingSpecs.cadUrl` (token-public); strip textures from the GLB's JSON chunk; replay
  `choicesFromAssembly → specPages → buildPageSvg` headless for exact fit percentages. The scratchpad dies daily —
  the recipe rebuilds it in minutes. **Fit percentages are stated, never screenshot-looped.**
- H1-138's live shape: `Approved_Designs/CE-ASM-1786572226393`, 467 pins, 96 clusters, no `specCadUrl` and none
  coming (Stuart: "it is all here"). 31 bracket arms (six pinned CENTER only), 11 plates, `HTCAR35/01` is a
  RING, `HTSLNTCAR` the only carrier, `passing: "PASSING"` on the six passing brackets + `H1-138BPR`.
- Reading prod without the PIN gate: the console recipe in the memory (module `1624` = `db`, `565` = the
  Firestore SDK; duck-test the ops; never brute-force module exports).
- Deploy-verify: `SpecSheetModal` is a lazy chunk — sweep `asset-manifest.json`, match the served chunk hash to
  your local `build/static/js/<id>.<hash>.chunk.js` (CRA hashes are content-deterministic) before reading a
  marker miss as a stale build; plain-ASCII markers only. With six sessions pushing, a version stamp proves
  nothing.

## 1. Territory

**Own:** `src/components/SpecSheet/*` (`SpecSheetModal`, `specSheetPages`, `specSheetRows`, `specSheetPage`,
`specSheetGeometry`, `specSheetOutput`, `specCellCheck`, `hiddenLine` — ~3,600 lines); `scripts/specSheetPages.test.mjs`,
`scripts/specSheetRows.test.mjs`; the 📐 button + lazy mount lines in `HQ/BOMTab.js` (nothing else in that
file); the Firestore surfaces `system/spec_sheet_config` (`wallPlates`) and `Approved_Designs.<doc>.specSheetOverrides`
(`manualDims[]`); the spec-sheet section of the User Guide (`HQ/UserGuideTab.js` — shared, ask first; `git status
--short` it before editing); `SPEC_SHEET_*.md`, `SPEC_MASTER_MANIFESTS.md`, the `Spec Sheets/` and `SpecSheet/`
reference folders.

**Read-only:** S1's engine and 1.6 (`Shared/hardwareModel`, `hardwareAdapter`, `assemblyTags`, `componentExport`,
`slotGroups`, `AssemblyBuilderTab`, `NodeClusterTab`) — you *read* pins, tags and the GLB; a tag change is a
hand-off with the slot # into BRIEF_S1 §6; S5's 4.6 (`CustomerCollectionsTab`, `clientPricing`, `priceLevels`,
`feeRules`) — the FAB edition reads `manufacturingSpecs.fabricut.*` that S5's importer stamps (coordination item:
`fabCodeBase` for single-finish items is not yet in `fabCodeFor()`'s chain); S1's `sizeMatrix` (per-configuration
sheets, when built, must resolve identity through it — designed, not built); everything on the RTG spine.

**Never:** a per-assembly spec GLB or a spec-layout upload (rejected 2026-08-23, twice); the size-source machine
(deleted 2026-08-23 — do not reintroduce); drawing around a tag.

## 2. What is live (do not rebuild)

The generator rebuilt on the tag engine 2026-08-23 → 08-27 (79 commits on `SpecSheet/` since 08-20, last
bb76ff8): one page per (leaf × subject) from `activeAxes()` — the CPQ's own questions in its own order; measured
grid, one true scale, "REDUCED n% — bound by height/width" honest in the footer; 8.5×11 binder, portrait
standard, doubles auto-landscape and 2 rows per sheet (presentation-only split); doubles by ROD SELECTION
(`rodForArm` FRONT rule, `backRodForArm` mirrors the CPQ pairing, `pinForChoice` narrows on tier + cut);
returns as PLAN VIEW (window with a 2.0" stub, plate at the wall leg, rtn-only plates by twin swap from the
leaf's admissible set, a page per projection); ceiling pages dimensioned by DROP; one unioned finial catalog per
material with collars; section riders (passing ring / carrier) in the cell's own basis; `auditPages()` scoping
guarantee on every load; names `legacyErpId → feeItemNo → partName`; the customer picker with CRM names; the
sheet says inches and can speak the customer's language; `H1-75D` tagged right (a tiered arm never fans across
the plates' depths).

## 3. The work, in order — Stuart picks

1. **#50 the text and measurement pass** (F4, the memory's stated NEXT) — on the harness first, then on paper
   with Stuart: the type scale was sized for a 64% reduction that no longer happens (can shrink ~⅓ at equal
   printed size); TEXT is most of the fixed overhead (`cellAboveBelow` charges dim/label room; text does not
   scale with geometry — why ring ids stagger on two lines with leaders); callouts on row 1 only, code placement,
   leader lines; the footer's REDUCED line kept honest. **Stuart's Q4 (09-03): the 4-row plate sheet is NOT to be
   touched; H1-138 is at 2 rows per sheet and he is content.** Every change measured offline, percentages stated.
2. **Verify `H1-138D` on paper**: the two-step dimension reads wall → 3¼ → 5¼. Every placement measured 0.00 on
   the harness; it was never confirmed on a printed sheet.
3. **The two repeated right-hand columns on return pages** — **French Return** and **Passing Support Arm** — the
   reference set carries them; the row builder makes detail / front / profile (plan) only. Return pages draw as
   ordinary bracket pages today.
4. **H1-2TRV sheets** — the declared next stop: fascia + stationary front = ring AND carrier on one page (rings
   ride the solid front rod's page; already safe in the builder rule). The traverse family's own generator is
   S1's (`Shared/traverseFlow.js`); you read its pins like any other.
5. **The data with Stuart** (the spec-sheet share of STATE #28 — each is a tag in S1's 1.6, cite the slot #):
   S72 rear-pole pin's `returnOnly` re-ticked and saved (it did not persist — false in Firestore); FR/MTR double
   return pins' proj as the tier-labelled form `FRONT:8.5, BACK:3.25` (the bare list means "made at two
   projections" and pairs 6.5); the 6" single returns' `feeItemNo`; the wood singles' untagged pin copy; the two
   NEW-SLOT finial sections → `rod: front`. Run the sitting; S1 applies nothing — Stuart types in 1.6.
6. **`fabCodeFor()` + `fabCodeBase`** (the contract's coordination item): single-finish items (wood / acrylic /
   raw aluminium) carry `fabricut.fabCodeBase`; add it to the FAB edition's chain before those items get sheets.
7. **PDF as true vector** — only if Stuart asks; the print window already is.
8. **Per-configuration sheets** (a quote's selections at a chosen size; identity through S1's `sizeMatrix`
   chain, geometry the master GLB) and **Phase 4 ceiling / double flows** (`nodesFor()` accepts LEFT / SHARED /
   CENTER / '' only — a FRONT/BACK double assembly finds no pole nodes) — designed joints, not built; propose
   when Stuart names them.

**Guide (S2 rule) — #49, the spec-sheet third:** no section exists for spec sheets ("what a page is, the paper,
why a sheet says REDUCED, editions, Left/Right"). S1 owns the tag-engine section, S5 the kits / 4.6 sections;
coordinate before editing `UserGuideTab.js`.

## 4. Acceptance

| run | expect |
|---|---|
| `node scripts/specSheetPages.test.mjs` · `specSheetRows.test.mjs` | green; every new assertion mutation-tested (break the builder, watch the test dissent) |
| the offline replay on H1-138 after the text pass | the fit percentage per page STATED and not worse than today's; 4-row plate sheets untouched |
| H1-138D on paper | wall → 3¼ → 5¼; landscape, 2 rows per sheet |
| an H1-138 return page | French Return + Passing Support Arm columns present; the footer's REDUCED figure equals the harness's |
| an H1-2TRV page | fascia + stationary front: ring AND carrier, carrier drawn through the track, no rings on a track-only page |
| `auditPages()` on every load | 0 violations on H1-138, H1-75, H1-2TRV; a deliberately broken builder is named |
| a tag fix from #5 | the sheet changes with NO code change (that is the proof it was a tag) |

## 5. Questions for Stuart

1. Which first: the text pass (#1), the paper check of H1-138D (#2), or the return columns (#3)?
2. When does the tag sitting (#5) happen — it needs him in 1.6, and #3 partly waits on the FR/MTR tier form.
3. Does he want the H1-2TRV sheets before or after the H1 text pass?

## 6. Hand-offs in

- **⚠ DEPLOY NOTICE from S5 · 2026-09-16 · 0bba5f1 pushed at 16:31 EDT (swept by marker in the served build-orders chunk; recorded in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **⚙ Raise work orders on a sales-display build order** (5. Marketing → Build orders, and the same panel on 10.5). Every part line of the order is split by the ROW it sits on and each (line × row) is ONE stock order for per-board × boards, raised through the EXISTING writers exactly as the Stock View grid calls them: `Shared/workOrderCreate.parkWorkOrder` (STOCK_FINISH / STOCK_MILL, component pre-check first, parked on RTG, `source: 'DISPLAY_BUILD'`, the SO in `soRef` and the note) and `Shared/platingDemand.issuePlatedDemand` (plated EP/MEP/P25 → a demand on the WMS Plating tab, `from: 'stockview'`, core stock read, `woSource: 'DISPLAY_BUILD'`). /P lines are named as Stock View convert to-dos, never raised here. Each raised id is recorded on the build order's line (`lines.parts[].raised[]` + the WO # column); the order gains `sampleBin` (FDISTABLE tabletop / FDISWALL wall). No change to any writer, floor, WMS screen, PO path or NetSuite call. Volume: Stuart is raising for 50 tabletops (SO53215) and 35 wall boards now — expect a batch of stock work orders and plating demands landing together. **Your side:** none.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-16 · 5ebfeeb pushed at 15:32 EDT (swept by chunk-hash match of the designer chunk; recorded in BRIEF_S5 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **the 5. Marketing designer's cart tools** (Stuart: a configuration fixed and re-added in CPQ never reached the board — a placed row keeps its own copy of the line). Each cart line gains **▸ Lines** (its billable parts × qty · feet · finish, before placing) and **✕** (removes the line from the ONE shared cart — the same filter CPQ's own Remove makes, with a confirm); a placed row shows when it was placed and **"a newer cart line exists · Place again"** when its own line is gone from the cart and a line for the same assembly was added after. `HQ/HQ.js` (shared): one prop, `setCart={setGlobalCart}` on the Marketing mount. Documents: `system/displays/entries/*` unchanged in shape; the browser cart (`hq_global_cart`) can now be shortened from tab 5. No job, work order, floor or NetSuite write; build orders keep their snapshot. **Your side:** none.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-16 · THREE commits pushed together, swept live in `main.ac9346d4.js`.** Hard-refresh
  (⌘⇧R) + re-PIN before your next save. **(1) e5ff62c — the unit a line is counted in (S2)** and **(2) e104691 — the unit on
  every WMS / finishing / shop screen and label (S3)**, the two halves of Stuart's 09-16 ruling, shipped as ONE deploy exactly
  as the hand-off required: every floor line now carries `uom` and `pcs` beside `qty`, and every screen and label prints the
  one string `uomLabel(qty, uom)` — "3 EA", "3 PR = 6 pcs", "3 × 7PK = 21 pcs". **`qty` NEVER changed meaning** — it stays in
  the item's own unit, as NetSuite holds it, because the legacy items are held there as Pair; `pcs` is the derived count the
  paint line sprays and the packer boxes. Most of the vocabulary already existed and was live (the pack parser, the barcode
  that already encoded code+uom+pcs, `scanTally` already counting a scanned pair as two) — the gap was that nothing put the
  unit on an ORDER LINE and no label was quantity-aware. **(3) f0f77ce — a vendor may ship long (S2):** PO receipts accept an
  overage bounded at 10% (Stuart: "many of our suppliers may ship 255 when we order 250, it does not allow us"). 255 of 250 is
  now taken in; the ceiling is 275; over the ordered qty CONFIRMS, beyond the ceiling REFUSES and says a count that far over is
  usually a pallet being received twice — which is the bound's whole purpose, since a real overage is a few percent and a
  duplicate is a hundred. The overage is stamped on the line, and the true count flows to NetSuite unchanged. **Your side: nothing.**


- **⚠ DEPLOY NOTICE from S1 · 2026-09-16 · 6fa627c pushed at 11:03 EDT (S1 swept every served asset after the deploy: version stamp 1789571165556; main.473fbd57.js carries "Pick the WOOD finish first", the stamp ce3f8724a13d and "priced from the base product" ×5; tab 7 chunk 876.d2199eb0.chunk.js carries "the line carries the species item"; recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped (Stuart 2026-09-16, SO60428 / SO60429 / SO60430): **a stain consumes the SPECIES item everywhere the engine writes.** `Shared/hardwarePricing.priceChoice` step 0a runs `sizeMatrix.speciesVariantOf` (the finish's 4.5 `bomSuffix` OAK / WALNUT, via the new `ctx.finishObjOf`) BEFORE the /P //EPn swap — so H1-138WEC in S04 is **H1-138WEC-O** and the wood pole is **H1-138WHTOAK / H1-138WLNUT** (through the item's `customData.speciesMap`, now stamped on H1-138WR) on the breakdown row (`legacyErpId` / `partId`), the fin doc `partsList`, the pick, the documents and the NetSuite line (which already did this swap — it is now identity there). Price stays the base product's when the species record has none. Order Entry's TO-BE-FINISHED row applies the same rule (`QuickShipTab.addToBeFinished`). The saved line keeps EVERY material's finish (`engineConfig.globalFinishes`) — a reopen no longer drops the wood stain. A WOOD part with no stain refuses to add. Engine stamp regenerated → `ce3f8724a13d`: every quote saved before this push reads STALE at Approve (expected — reopen · re-save · approve). Your side: nothing — spec sheets route on tags, not on the billed code. Say if a sheet prints the breakdown's `legacyErpId`.

- **⚠ DEPLOY NOTICE from S4 · 2026-09-16 · 39e6387 + abbe0f3 pushed.** Hard-refresh (⌘⇧R) + re-PIN before your next save. (1) **Packed orders' NetSuite fulfillments now carry each line's own location** (close-out 1): at pack the WMS reads the SO lines and sends `item.items[]` {orderLine, location, itemReceive}; a shippable inventory line with no location refuses the queue with the lines named — never a default. (2) **New WMS tab FULFILLMENT** (key `FULFILMENT`): packed orders ship by UPS (rate → service → label → tracking). TEST mode by default (HQ 9.5 admin switch); a LIVE ship stamps `shippedAt`, `trackingNumbers[]`, `shipService`, `shipmentId`, `shipCharge`, `shipPackages[]` on the pack doc and its `hq_sales_orders`, sends the same facts to the RTG record through `propagateFloorState` extra (floorPhase stays Packed), and PATCHes the NetSuite Item Fulfillment to Shipped with package lines through the outbox. A void clears `shippedAt` (history in `shipVoided[]`). **Your side:** nothing.

- **⚠ DEPLOY NOTICE from S2 · 2026-09-16 · 3a3aca4 pushed, swept live in `main.9876b7f7.js`.** Hard-refresh (⌘⇧R) + re-PIN
  before your next save. **"Where is it?" now shows OPEN work only.** Stuart: "once a work order is completed or the item is
  no longer in production it should not still be there, should only be for current working production or currently on a
  purchase order, rod cut, etc." The cause: the search filtered nothing by status. It holds no data of its own — each screen
  hands it a list and it text-matches over that list — and THREE of the four screens hand it an entire collection (the
  finishing floor and the packing station both subscribe to all of `fin_workorders`, the shop tablet to all of
  `custom_orders`), so every job ever run answered the search, while the popup's own empty-state text already promised that a
  closed order would not appear. The rule now lives in `Shared/orderLifecycle` beside the closer, so there is ONE answer to
  "is this finished": `openForSearch` (not `isDoneState`, not `floorPhase` Packed/Shelved, not shipped) and
  `openExtraForSearch` (a PO while `isOpenPo` says so — `poLock` owns that rule; a rod cut until DONE/CANCELLED; a convert or
  plating demand while it exists, since the WMS DELETES it when the pull posts). **COMPLETE IS STILL VISIBLE, deliberately** —
  `isDoneState` already carries Stuart's 2026-09-10 ruling that a job off the paint line is not done, and a pick-only doc is
  BORN Complete. Hidden matches are COUNTED, not dropped: a grey footer says how many finished or closed matches were hidden,
  and when every match is finished the no-match text says so. No writes, no document shape changes, nothing reaches NetSuite —
  the screens keep their own lists for queues, cards and pick lists; only the search dropdown narrows. **Your side: nothing.**


- **⚠ DEPLOY NOTICE from S2 · 2026-09-15 · f56bb7d pushed, swept live in `main.ee8a193e.js`.** Hard-refresh (⌘⇧R) + re-PIN
  before your next save. **This is S1's cart-staleness / engine-version work, committed and pushed by S2 on Stuart's relay
  ("other sessions say its up to you to finish and push"), as ONE unit and with nothing of it changed.** Three things are
  now true in production. **(1) A saved quote line records what built it** — the engine's own source hash
  (`Shared/engineVersion`, regenerated by the build) and a fingerprint of the tags it read — and CRM's **Approve compares
  both against what runs today and names any line that no longer matches, BEFORE the sales order exists** (the way out is
  the one that always existed: reopen in CPQ, re-save, approve; going ahead anyway is stamped `approvedWithStaleLines` on
  the job). The cases were SO60429 / SO60430 / SO60431: quotes saved 09-10 and approved 09-14 carried the BOM from before
  that evening's engine fixes. **(2) APPROVED now means a sales order really exists** (QUO143 — the status used to flip
  before the confirm, so a cancelled dialog left a quote reading APPROVED with no order). **(3) ⚠ A BACKPLATE'S QUANTITY
  NOW FOLLOWS ITS ARM** (SO60429: "3 brackets on order and in the bom it only put 1 of the matching cover plates when it
  should be 3") — the typed count lands on the centre bracket and a plate is never asked for one, so it stayed at 1 while
  its arm went to 3. **Your side: nothing.** Informational only — no spec-sheet code was touched.


- **⚠ DEPLOY NOTICE from S2 · 2026-09-15 · 0edddb0 pushed, swept live in `10.fcd64a54.chunk.js`.** Hard-refresh (⌘⇧R)
  + re-PIN before your next save. **The backorder hold is real at the split now.** It was decided in one place and written
  to one document, so the RTG chip said HOLD while every other document went to work (Stuart, on the 09-14 Fabricut orders
  SO60427–SO60432: "showing as hold waiting on back orders yet they still hit the floor"). `Shared/backorder.backorderHoldOf`
  is the rule — short lines + no "Finish as available" = held, the reason naming every short line by code and qty — and the
  split stamps it, on ONE timestamp, on every document it writes: the finishing doc as before, the **PICK-ONLY** doc (that
  exemption is how SO60429 reached the WMS pick with seven short lines) and the **SHOP** sibling (so a rod is not cut for an
  order that cannot ship). The lift matches: "Finish as available" on the RTG card now clears the hold on the shop order as
  well as every finishing doc. New/changed fields: `held` / `heldAt` / `heldBy` / `heldStage` / `heldReasonKind: 'BACKORDER'`
  / `heldReason` on `fin_workorders` AND `shop_custom_orders`; nothing else changed; no NetSuite effect. **Your side:** nothing.


- **⚠ DEPLOY NOTICE from S7 · 2026-09-13 · c4bbc89 pushed at 17:44 EDT (S7 swept all 37 served assets after the deploy: version stamp 1789339814060, 0 download failures; the new module is imported by no screen, so its literals are ABSENT by design (`SIZE_GROUP_UNPRICED` → none); the hardware guard literals stand (`a return carries the rod at that end` in `main.1f049abe.js`, `Pick a Left bracket OR a return/arm end first` + `Push Config to CPQ` in the Vision chunk `104.74c087bc.chunk.js`); recorded in BRIEF_S7 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped: **`Shared/pillowPricing.js` (NEW, pure, imported by nothing yet) + `scripts/pillowPricing.test.mjs` (58)** — the Uniquity custom pillow price rule as Stuart stated it 09-13: the size's standard price at the HIGHEST fabric price group among the panels (matrix `prices[size][group]`, fallback base + upcharge), + labour per drawn seam, + a charge per custom detail (FLANGE / WELT each, OUTER_TRIM and FRINGE_SEAM per yard); every panel consumes its OWN fabric (running-yard goods by widths × cut ÷ 36 rounded up to ⅛ yd; a cut-down throw labelled as a fabric = one each); fill + zipper consumed at $0 when the size names them; a missing table row REFUSES by code, never a $0 line. Output = ONE priced holder line on the non-inventory `CUSTOM PILLOW` item (`isRollup`, partHandling Custom, division `SEW`) + $0 consumption rows, all in `hardwareHandoff`'s row shape. Tables live in `system/pillow_pricing` (shape `DEFAULT_PILLOW_PRICING`, EMPTY until Stuart's spreadsheet). **Nothing served changes; no document, work order, floor or NetSuite write.** Decisions logged in BRIEF_S7 §7: the pillow goes Vision → **Order Entry (tab 7)**, not CPQ; quote or sales order both; throws cut into panels labelled as fabrics; a non-inventory 'custom pillow' item; Stitch & Sew = the small-parts flow to a SEW division with a Uniquity-subsidiary NetSuite WO (2–3 wk). Your side: nothing.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-16 · 3c2e004 pushed 12:25 EDT (S3 sweeps and records in BRIEF_S3 §7).** Hard-refresh
  (⌘⇧R) + re-PIN before your next save. **Close-out #18 — the receipt-side lift of a backorder hold (S2's hand-off 09-15).**
  New `Shared/backorderCover.js` (pure `allocateArrival` + writer `coverArrival`, 16-assertion harness): material landing in
  the WMS — the vendor PO put-away, the plating put-away, a convert (straight through or from the cart), a finished stock
  put-away incl. a paint run — covers the short lines on `hq_sales_orders.backorderLines[]` that name its code, OLDEST
  FIRST, stamping `covered / coveredAt / coveredBy / coveredFrom / coveredCode` on the line and reducing `qty` (the
  shortfall); an order with no short line left has its BACKORDER hold lifted on every sibling (`linkedDocsOf`, fin + shop)
  with RTG's own patch (`held:false, heldClearedAt/By/Note`), `isBackorderHold` as the test so a floor STOP is never
  lifted by a delivery. FINISH COMPLETE stays the rule; `finishAsAvailable` stays the one exception. `PickPackApp.js` hooks
  only; no NetSuite write. S2: the Snapshot's Backorders board reads the same record — a covered line now shows `qty` 0
  with the stamps. Your side: nothing.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-15 · 8c0677e pushed 19:46 EDT (S3 sweeps and records in BRIEF_S3 §7).** Hard-refresh
  (⌘⇧R) + re-PIN before your next save. App Imp card 2 (Grace 09-14, WO11610 / WO11612 "HF pending as if she never went
  through") — diagnosed from the two docs + `fin_logs`: Anne DID hand-finish coat 3 on both (10:10–10:48 and 11:31–1:09 PM,
  PIN-logged) and advanced; coat 4 of SG-P is sprayed, and the Hand bench in Manual Controls listed "Pole Hand Finish ·
  Pending" for a step that coat does not have (the advance resets the task status; the panel showed only the word).
  `ActiveFloor.js` only: the Hand bench lists a hand task only when the stream's CURRENT coat is hand-applied (else a
  muted "not this coat" row naming the coat); every completion stamps `tasks.<key>.completedCoat` and the panel / station
  chips show "✓ coat n · who · when" as history after the advance; the tablet's hand off-ramp card is small-parts only
  (`woHasSmallParts`) and its Complete stamps who / when / coat like the PIN path. New task field `completedCoat`
  (number); no other document change; no RTG / NetSuite effect. Your side: nothing.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-15 · bb031e2 (+3cd1c68) pushed 17:53 EDT and 3658a0d pushed 17:58 EDT (S3 sweeps and
  records in BRIEF_S3 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. **Three things:** (1) App Imp card 1 — a grey
  ✓ Complete Packing prints its first unmet reason under the button (lines left · photo · put-away bin · shop-label scan ·
  poles at the plater / custom half · box choice) and the box pickers read "no boxes for this brand → HQ 15" when empty
  (`PickPackApp.js`, display only). (2) App Imp card 5 — the shop's completion label prints ONE label per cut-list line
  with a length ("Cut n/N", that line's length and count), ZPL and HTML alike; single-length orders unchanged
  (`ShopFloor.js`, `Shared/labelPrint.printShopCompletionLabel` gains `cuts`). (3) **S1's BACKORDER HOLD spec, the floor
  half:** `holdGateOf` (`Shared/OrderStatusChips.js`) reads `held` + `heldReasonKind`; the Setup Queue shows a held doc in a
  ⏸ WAITING ON BACKORDER lane (out of the finish batches, no Start Setup / Stage to Floor); Active Floor cards and the manual
  controls refuse to advance; the Schedule Planner skips held docs; the WMS pick queue shows the lane on the row and
  refuses claim / pick / early release. The floors CANNOT lift a backorder hold (RTG's "Finish as available" or the
  material arriving does — S2's #18 half); STOP holds keep the red banner and are refused the same way. No document
  change, no NetSuite write. S2: `releaseHold` / `HeldOrdersBanner` untouched; the WMS and Setup Queue banners now show
  STOP holds only. Your side: nothing.

- **⚠ DEPLOY NOTICE from S3 · 2026-09-13 · 6a8f1c1 pushed 17:24 EDT (S3 sweeps and records in BRIEF_S3 §7).** Hard-refresh
  (⌘⇧R) + re-PIN before your next save. Close-out #14, the JFP double-post (IA26935 / IA26936): both paint-run put-away
  adjustment enqueues in `PickPackApp.js` now carry `dedupeKey: jfp-adj:<fin doc id>` (the outbox refuses a second entry
  while one is PENDING/POSTING; FAILED does not block); the put-away scan refuses up front on `jfpAdjQueued || jfpAdjPosted`;
  ↩ re-post reads the outbox first (in flight → wait / 11.1; POSTED → nothing to redo; only FAILED earns a re-post). #35 the
  pack-scrap adjustment looked at: a different shape (each report is a typed count), left as is. No document shape change,
  no other writer touched. Your side: nothing. Stuart reverses IA26936 by hand.

- **⚠ DEPLOY NOTICE from S1 · 2026-09-13 · f29c4db pushed at 17:22 EDT (S1 swept every served asset after the deploy: version stamp 1789338315036; `recorded for the Snapshot's Backorders board` in tab 7's `876.665697cc.chunk.js`; recorded in BRIEF_S1 §7).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped (close-out item 4 / STATE #17): an **Order Entry (tab 7) order now carries `backorderLines[]` like a CPQ one**. At save, tab 7 hands its lines (stock lines as pieces, to-be-finished lines with their outsourced flag, the traverse components) to THE SAME planner RTG's split uses (`Shared/splitPlan.planSmallLines` over `Shared/backorder.classifyLine`) after one `fetchAvailabilityUnits` read of every cover code at the brand's location, and writes `backorderLines[]` + `backorderAt` on `hq_sales_orders` (`Shared/quickShipBackorder`, pure; 11 assertions incl. byte-identity with the split's own record). An unread shelf claims nothing; a failed read is logged, never a shortage. The Snapshot's Backorders board (S2's `backorderBoard`) reads the record as it is. Also: the tab 7 SO header is computed once (`soHeaderOf` → spread), no behaviour change. Your side: nothing.

- **From S5 · 2026-09-13 (the hand-over):** everything spec-sheet in `BRIEF_S5_CUSTOMER_FACING.md` §3 items 5–8
  and the data list is yours now; S5's §7 has no spec-sheet commits since 2026-09-10 (the generator's last commit
  is bb76ff8, 08-27). Nothing is half-done in the code. The 📐 mount in BOMTab is intact (checked 09-13). Your
  side: nothing to merge — start from the memory and the harness.

## 7. Status log

(append: hash + one line after every commit; every decision Stuart gives you)

## 8. Opener (paste to start the session)

```
You are the S6 session — spec sheets: the 📐 generator in BOM Engine, its paper, text and measurements, its
harness. Read, in order: CLAUDE.md (the working agreement binds you), SESSION_COMMS_2026-09-10.md (the map,
file ownership, hand-off protocol — briefs are the channel), STATE_OF_THE_APP_2026-09-10.md, BRIEF_S6_SPEC_SHEETS.md
(your brief), then the memories spec-sheet-generator (trusted over every spec-sheet brief), spec-sheet-cpq-contract,
canonical-tag-spec, hardware-tag-engine, brief-f-decisions-2026-09-03; then BRIEF_F_KITS_SPEC_SHEETS.md §F4 + §F6
and SPEC_SHEET_CPQ_TIEIN_BRIEF.md Part 3 (the offline harness). Rules: tags before code — a wrong page is a wrong
tag in 1.6 (S1's file; hand them the slot #); never filter the answer you asked for; one code can be two pins;
read subjects by role; fixtures use the prod shape; a fix is proven on the harness or in a node test before a
screen; the 4-row plate sheet is not to be touched. Other sessions: S1 (CPQ/engine/1.6 — the tags you read),
S2 (RTG), S3 (floors/WMS), S4 (portal), S5 (4.6 kits, marketing / displays, guide books, assets — the Fabricut
codes you print come from their importer). Cross a line: stop, patch spec into THEIR brief's § Hand-offs in, log
it in yours. Git: never switch branches, stage only your files, pull --rebase --autostash, safe-push check
(git log origin/main..HEAD must show only your commit), eslint 0 errors, sweep asset-manifest.json by chunk
hash. Plan first and wait — every time. One issue at a time. First: ask Stuart BRIEF_S6 §5 Q1, then plan that one
issue. Identify as "(S6)" in every commit.
```
