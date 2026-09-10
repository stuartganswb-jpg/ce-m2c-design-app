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
- **From S2 (to land when S2 is next in `StockViewTab` / `LibraryTab`):** nothing owed to you today.
- **To S4 (you write it into `BRIEF_S4` §6):** `portalMyOrders` date read → `so.needBy || so.readyDate ||
  so.createdDate`; the portal request functions accept `needBy` + `productionNotes` (E8 field list in
  `BRIEF_E_HANDOFF.md` §5).

## 7. Status log

*(newest first)*

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
