# BRIEF S7 — Vision for the Uniquity pillow builder (written by S1, 2026-09-13, at Stuart's ask)

> ## ⛔⛔ RETIRED — Stuart, 2026-09-17. THIS SESSION IS CLOSED. DO NOT BUILD, COMMIT OR PUSH.
> Stuart, verbatim: "go thru all the other sessions S1-S7 get briefs and retire them, we will work here and fix what is
> broken." All work now runs in ONE session — the communicator — with Stuart. If you are a session reading this as your
> brief: stop. Make no edits, no commits, no pushes, no production writes. If you hold uncommitted work, leave it in the
> tree untouched and say so in ONE line at the very end of your § Status log — nothing else. This brief stays in the repo
> as the RECORD of what was built and what is open; the live list is `OUTSTANDING_2026-09-17.md`.

You are **S7**: the Uniquity brand's Vision pillow builder and the path a pillow takes from that board to a
quote. This brief is written by S1 (CPQ · Vision · the tag engine · CRM · the NetSuite transaction) from the
live code and the live data on 2026-09-13. Everything in §2 was read, not remembered; where a claim is a
guess it says so.

**The one sentence that governs this session:** the Classical Elements hardware tools (the tag engine, the
hardware configurator, VisionHardware, the hardware handoff, the NetSuite push) are **read-only** to you, and
every pillow change is proven not to touch them by the harness list in §4 before it is pushed.

## ⛔ Working agreement + standing rules (Stuart, verbatim in spirit)

Plan first and WAIT for approval before editing, shipping or changing production data — every time.
Requested scope only: name adjacent problems, never fix them in passing. No temporary fixes. Trace every
change downstream before making it — what you write becomes the quote on the CRM, the sales order on the RTG
board, the WMS pick, the NetSuite transaction — and say the trace in the plan. **RTG is the ONE spine**: every
order from every door lands there as master. One issue at a time. **Saving in CPQ is sending** (quote → CRM +
`ns_outbox` → NetSuite): never save a test quote; reopen / edit / clear-all without saving is safe. A shared
screen is extended by ADDING one guarded mount, never by editing — prove it with `git diff -w`. A fix is
proven in a node harness before it is looked at on a screen.

**Git:** never switch branches in the shared checkout; stage ONLY your files (never `git add -A`);
`rm -f .git/index.lock` → `git fetch` → **`git log --oneline origin/main..HEAD` must print NOTHING before you
commit** (another session's unpushed commit would ride your push — if it prints, push from a detached
`git worktree add --detach <tmp> origin/main` with your files copied in, `git push origin HEAD:main`, then
`git pull --rebase --autostash` in the shared checkout; S1's status log 2026-09-12 describes it) → commit →
`git pull --rebase --autostash origin main` → `git log origin/main..HEAD` + `git status --short | grep -v '^??'`
→ push. ESLint 0 errors on every file you touch (`npx --no-install eslint <path>`). Identify as "(S7)" in every
commit; commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

**Every push is announced:** a DEPLOY NOTICE in every other session's brief **§6 Hand-offs in** (S1–S6), a row
in `SESSION_COMMS_2026-09-10.md` § Deploys, your row in § Status, a line in `STATE_OF_THE_APP_2026-09-10.md`
§6, and your own § Status log — with the deploy-verify sweep result (see §0). Cross a territory line: stop,
write a patch spec into the owner's brief § Hand-offs in, log it in your § Status log.

## 0. Operating

- **The screens:** 9. Client Vision (`HQ/ClientVisionTab.js`) opens on the brand's categories —
  `CATEGORIES_BY_BRAND.uniquity = [{ id: 'PILLOW', label: 'Custom Pillow Assembly' }]` — and mounts
  `HQ/VisionPillow.js`. The pillow board saves a `cpq_drafts` document; 8. CPQ Configurator (`HQ/CPQTab.js`)
  lists it under Lines Awaiting Configuration and resumes it onto the Uniquity flow.
- **Brand isolation is by field, everywhere:** `cpq_flows.brandId`, `cpq_drafts.brandId`, `Approved_Designs
  .brandId` (+ `sharedBrands`), `crm_records.brandId`, `jobs.brandId`, `hq_sales_orders.brand`. The HQ shell's
  brand switch (`activeBrand`) is the only selector; nothing reads another brand's documents. Keep it that way:
  every document you write carries `brandId: 'uniquity'`.
- **Reading live data without a script:** Firestore enforces App Check — no node script can read or write
  production. From a PINed tab the app's own Firestore module is reachable through webpack's registry
  (`window.webpackChunkce_m2c_design_app.push([[Math.random()],{},r=>req=r])`; the firestore module and the
  db handle are found by pattern — S1's memory / `BRIEF_S1` §0 has the recipe). Read-only unless Stuart says
  otherwise. Native `alert` / `confirm` freeze the browser tools: stub `window.alert` / `window.confirm` in
  the page before pressing a button that fires one (Vision's "Push Config to CPQ" does).
- **The fast loop:** every `scripts/*.test.mjs` runs with plain `node`; the tag-engine suites that matter to
  you are listed in §4 with their counts. A new module of yours gets its own `scripts/<name>.test.mjs`
  (check `git ls-files scripts/<name>.test.mjs` first — `Write` silently overwrites an existing file).
- **Deploy-verify:** frontend auto-deploys on push to `main` (Vercel). After the push: poll `version.json`
  until the stamp is past your push epoch, sleep 30 s, download EVERY asset in `asset-manifest.json` (37–40
  files), grep a plain-ASCII **string literal** your change emits (a comment is stripped; a JSX child prints
  as `"TEXT"`). `ClientVisionTab` + `VisionPillow` + `VisionHardware` share one lazy chunk; `CPQTab` +
  `HardwareConfigurator` + the engine live in `main.*.js`. The version stamp alone proves nothing.
- **PIN gate:** every deploy drops a PINed tab; Stuart's PIN is a credential — never type it. Screen proof is
  Stuart's, on his next real Uniquity quote.

## 1. Territory

**Own:** `HQ/VisionPillow.js` (the board); the PILLOW mount lines in `HQ/ClientVisionTab.js` (the
`CATEGORIES_BY_BRAND.uniquity` row, the `{visionCategory === 'PILLOW' && <VisionPillow …/>}` block, the
pillow entries of `globalLists` — nothing else in that file); any NEW `Shared/pillow*.js` module and its
harness; the Uniquity CPQ flow `FLOW-1779393547645` "CUSTOM PILLOW ASSEMBLY" (data, edited in System Admin →
CPQ Flows, tab 11); the pillow lists in `system/master_lists` (`pillowSizes`, `fillTypes`, `flangeStyles`,
`stitchTypes`); Uniquity's items in 4.5 (data); the Uniquity section of `HQ/UserGuideTab.js` (append only;
`git status --short` it first).

**Read-only — the Classical Elements hardware tools (S1):** `Shared/hardwareModel.js`, `hardwareAdapter.js`,
`hardwarePricing.js`, `HardwareConfigurator.js`, `hardwareHandoff.js`, `assemblyTags.js`, `visionEngine.js`,
`visionBridge.js`, `visionHandoff.js`, `pickDrops.js`, `traverse*.js`, `sizeMatrix.js`, `plateRules.js`,
`platePool.js`, `kitSeed.js` (S5), `nsTransmit.js`, `nsHeader.js`, `salesOrderHeader.js`,
`lineClassification.js`, `quoteDisplay.js`, `FormPreview.js`, `printForm.js`; `HQ/VisionHardware.js`,
`CPQTab.js` (see §3 for the ONE seam you will need there — S1 builds it), `AssemblyBuilderTab.js` (1.6),
`NodeClusterTab.js` (1.5), `QuickShipTab.js`, `ExternalCoopTab.js`, `ERPPushPullTab.js`. S2's spine
(`RTGDispatchTab`, `splitPlan`, `orderStatus`, `orderLifecycle`, `workOrderCreate`), S3's floors, S4's portal.
You READ these; a change is a patch spec in the owner's brief § Hand-offs in.

**Shared, ask first:** `HQ.js`, `HQ/UserGuideTab.js`, `firestore.rules` (name the collection; the
communicator schedules the rules deploy), `NetSuiteSyncTab.js` (11.1).

## 2. What is live for Uniquity today (read 2026-09-13 — do not rebuild)

**Vision.** `HQ/VisionPillow.js` (626 lines, no three.js — a 2D SVG board): ENGINEERING view = a pillow
drawn to scale (`S = 3.5` px/in) with panels, seams (the operator draws them), one master fabric per panel
(`pillowData.fabrics[]`, tagged by `fabricTags`), flange / welt with a size, fill, stitch, an outer trim per
edge (`outerTrim: { trimId, top, bottom, left, right }`); VISUAL view = a background photo, a two-point
calibration to real inches (`pixelsPerInch`), placed items. **Push Config to CPQ** writes
`cpq_drafts/DRAFT-<ms>` = `{ brandId, category: 'PILLOW', status: 'DRAFT_FROM_VISION', jobName, customerId,
masterQuoteId, specs: { ...pillowData, tags, seamCount }, author, createdAt }` and alerts. The fabric and trim
pickers filter `libraryParts` by `manufacturingSpecs.productType` ∈ TEXTILE / FABRIC / RAW MATERIAL and
TRIMMING / COMPONENT — **and Uniquity's library holds none of those** (below), so both pickers are empty today
and the push refuses ("assign a Master Fabric to all panels"). The pillow lists come from
`system/master_lists` with defaults `12x20 Lumbar / 18x18 Square / 22x22 Square`, `DOWN / POLY`,
`NONE / FLANGE`, `STANDARD / RAILROAD / KNIFE_EDGE / FRINGE`.

**CPQ.** One Uniquity flow: `FLOW-1779393547645` "CUSTOM PILLOW ASSEMBLY", six steps and **zero options** —
Select Pillow Size (DROPDOWN), Select Fill Material (DROPDOWN), Select Main Fabric (VISUAL_GRID — the grid
lists TEXTILE / FABRIC / RAW MATERIAL parts, so it is empty), Select Flange / Edge (DROPDOWN), Select Trim /
Fringe (VISUAL_GRID), and a step titled "yoyo" (a test leftover). No `linkedAssemblyId`, no `productType`. A
pillow draft resumes onto it by name (`cpqFlows.find(f => f.name.includes('PILLOW'))`,
`CPQTab.js:1781`) and translates `specs` onto the steps by title (size / fill / fabric / flange·edge / trim /
stitch / seam, `:1812`). A PILLOW-named flow **always opens the OLD flow-step configurator**
(`flowNeedsOldEngine`, `CPQTab.js:1295`): the tag engine reads pins, a pillow has none. `newEngine` defaults
on for CE only (`:1015`). No Uniquity `jobs`, no Uniquity `cpq_drafts` exist yet.

**The library (`Approved_Designs`, brandId uniquity): 2,821 records** — product types Pillow (1,537
Inventory + 277 Assembly), Throw (491), Swatch (470 Inventory + 8 Assembly), Table Cloth (28), Napkin (7),
Placemat (3). They are FINISHED goods by pattern / colour / size, e.g. `Bell/10P19x19` "Bell Pillow color 10
Natural & Cream 19" × 19"" (`UNIQUITY-INV-49084`, NetSuite id 49084, basePrice 500, partHandling Small Parts,
`isStocked`, bins, vendor, `routingType: UNASSIGNED`, no CAD, no clusters). The 277 "Assembly" pillows carry
the same shape (no BOM, no components). **No fabric, no trim, no fill item exists** — nothing for a custom
pillow to be made OF. NetSuite's class list already knows the world: `Sewing Service` (16), `Throw/Pillow`
(17), `Fabric` (22) (`Shared/nsItemFields.js`).

**Customers:** 1,778 Uniquity `crm_records` (the CRM and Vision filter by brand).

**The sales spine, as it would treat a pillow quote today:** CPQ finalize writes the `jobs` doc (CRM sees it
live) and the one sales-order header (`Shared/salesOrderHeader.soHeaderOf`) → RTG lists it → the NetSuite
push goes through `Shared/nsTransmit.buildNsTransaction` — which for an OLD-engine item walks the flow's
steps for linked items (a pillow flow links none → `NO_LINKED_PARTS`) — and the header through
`Shared/nsHeader` with **`BRAND_NETSUITE_FORMS` = CE only**: a Uniquity quote **refuses to queue with
`NO_NS_FORM_FOR_BRAND`** (red on RTG with Queue now) until Eric's per-brand form + class ids are entered in
`Shared/brandNetsuite.BRAND_NETSUITE_FORMS` (subsidiary 6 / location 20 are on file). The RTG split
(`Shared/splitPlan`, `backorder.classifyLine`) routes Small Parts lines to the WMS pick; there is **no sewing
floor** in the app (a `dispatchStatus.sewing` flag exists on the job and nothing reads it). A stocked pillow
is a pick-and-pack; a custom pillow has no floor to go to.

## 3. The work, in order — Stuart picks; this is S1's recommended order

**Before any code — the decisions in §5.** A pillow builder that draws beautifully and then hands CPQ a line
with no item, no price and no floor is a drawing, not an order. Decide what a custom pillow IS in the
library and in NetSuite first.

1. **The Uniquity flow is a stub — settle the questions it asks.** Rebuild `FLOW-1779393547645` on tab 11 (data
   only: delete "yoyo", give each step its options, link the fabric / trim / fill steps to real items once
   §5 Q1–Q2 are answered). Vision's translate-by-title (`CPQTab.js:1812`) needs the titles to keep the words
   size / fill / fabric / flange·edge / trim / stitch / seam.
2. **Fabrics and trims as items** (data, 4.5 / 11.1): the pickers read `manufacturingSpecs.productType` ∈
   TEXTILE / FABRIC / RAW MATERIAL and TRIMMING / COMPONENT — import Uniquity's fabrics (by the yard) and trims
   (by the yard / each) under those types with `brandId: 'uniquity'`, a NetSuite id, a price. Until they
   exist, the board cannot push.
3. **The board, on its own terms** (`VisionPillow.js`, yours): whatever Stuart wants drawn — sizes beyond the
   three defaults, multi-panel fronts, back fabric, welt vs flange, fringe, the sample / swatch program (478
   swatches are in the library) — as pillow-only code. The draft it writes keeps `category: 'PILLOW'` and
   `brandId`; it never writes `enginePicks`, `visionPartIds`, `spatialData.framing` or any hardware field
   (`Shared/visionBridge.visionPartIds` reads those for hardware drafts; a pillow draft must stay invisible to it).
4. **The hand-off to the cart — the ONE seam that touches S1's files, and S1 builds it.** Today a resumed
   pillow draft lands on the old step configurator; the old engine prices steps and pushes linked items. The
   honest shape is the one the tag engine already uses: a cart item carrying a FINISHED BOM in
   `pricingBreakdown` (one row per part: `partId`, `legacyErpId`, `name`, `qty`, `price`, `total`,
   `partHandling`, `finishCode: ''`, fees flagged `isFee`) — `nsTransmit` pushes such an item from its rows
   (the TAGS branch reads the answer instead of walking steps), the documents print them, the split routes
   them. **Ask S1 (BRIEF_S1 §6) for:** an `engine: 'BOM'` cart item treated exactly as `'TAGS'` in
   `resolveJobLines` (one condition), and a pillow line builder — `Shared/pillowHandoff.js` (yours) →
   `{ engine: 'BOM', pricingBreakdown, pricing: { finalPrice }, sidemark, renderSnapshot (the board's SVG →
   PNG), pillowSpecs }` — mounted in CPQ's Resume as ONE guarded branch for `draft.category === 'PILLOW'`.
   Pricing rule = §5 Q3. This keeps the pillow out of `HardwareConfigurator` entirely.
5. **The sewing question** (§5 Q4) decides the downstream: if pillows are sewn in-house, a floor document is
   S2's / S3's territory (a new writer on the ONE spine — `workOrderCreate.parkWorkOrder`, never a screen of
   its own); if outsourced, it is a purchase order + receipt (S2's `purchaseOrders`) like plating. Either way
   the pillow line's `partHandling` must say which — decide it with them before the first live order.
6. **NetSuite for Uniquity:** the form + class ids from Eric → one row in `BRAND_NETSUITE_FORMS` (S1's file,
   one-line hand-off). Until then every Uniquity quote refuses to queue — by design, not a bug.
7. **Documents:** the quotation / SO print already handle a breakdown row per part; a pillow line prints its
   fabric and trim rows under the pillow. If the customer's paper needs a pillow-specific layout (a swatch
   image, yardage), that is a FormPreview change — propose it to S1.

## 4. Acceptance — the CE guard, run before EVERY push

The Classical Elements hardware tools must be byte-for-byte unaffected. Prove it two ways:

1. **The harness wall, all green and the counts unchanged or higher** (from the repo root, plain node):
   `hardwareModel` (694) · `hardwareAdapter` · `hardwarePricing` (54) · `hardwareHandoff` (49) · `visionEngine`
   (30) · `visionBridge` (53) · `visionHandoff` (11) · `pickDrops` (16) · `partLookup` (42) · `platePool` (14) ·
   `slotGroups` · `stepImport` · `kitSeed` (80) · `kitCode` · `traverseConfigurator` / `traverseDraw` /
   `traverseExplode` / `traverseFlow` / `traverseKitImport` (or `sh scripts/run-traverse-tests.sh`) ·
   `nsTransmitLineDiscount` (30, the REAL resolver) · `nsHeader` (24) · `lineDiscount` (54) · `customerDocLines`
   (30) · `extrasRestore` (14) · `jobHeaderPatch` (26) · `quoteDisplayDoc` (14) · `packingList` (31) ·
   `invoiceMath` (11) · `parkedGeometryLine` (11). A count that drops is a stop, not a note.
2. **`git diff --stat origin/main -- <every read-only file in §1>` is EMPTY** on every commit of yours, and
   `git diff -w` on `ClientVisionTab.js` shows only the PILLOW mount lines.
3. After the deploy, the served lazy chunk that carries `VisionHardware` still contains the hardware literals
   (`a return carries the rod at that end`, `Pick a Left bracket OR a return/arm end first`) — the pillow and
   the hardware share that chunk, so a broken import there takes both down.
4. On a screen, with Stuart: the CE brand's Vision → Drapery Hardware opens, picks, locks and saves a line as it
   did the day before; CPQ's Fabricut H1 flow opens on the tag engine; a CE cart line pushes.

A pillow change is DONE when: the board pushes a draft, CPQ resumes it onto the rebuilt flow, the cart line
carries a priced breakdown with real items, the quote prints, the RTG board lists it, and the NetSuite queue
either posts (ids on file) or refuses with `NO_NS_FORM_FOR_BRAND` — and the CE guard above is green.

## 5. Questions for Stuart (answer before code)

1. **What is a custom pillow in the library?** A finished-goods item per pattern/colour/size (the 1,814
   pillows that exist — the customer picks one), or a made-to-order assembly of fabric (yardage) + fill +
   trim + labour? If the second: which fabrics and trims, in what units, from which vendors — the 4.5 import.
2. **What does NetSuite receive?** One pillow item per line (the stocked SKU), or an assembly with component
   lines (fabric yards, fill, trim at $0 or priced) plus a labour / sewing line (`Sewing Service`, class 16)?
   The answer decides the push shape and whether a rollup / holder line exists for pillows.
3. **The price rule:** size × fabric grade + trim per edge + fill + flange? Or a price per finished pillow with
   fabric upcharges? Where does it live — the item's `basePrice`, `clientPricing` per customer (as Fabricut),
   or a pillow rule table?
4. **Who sews?** In-house (a floor document on the spine — S2/S3 build it) or a vendor (a purchase order and a
   receipt — S2)? And the lead-time class for `readyDateOf` (today: paints 4 weeks, plating 6).
5. **Does the customer's portal ever order pillows?** (S4 mirrors CPQ by hand; a pillow line is a new shape
   there.) If not yet, say so and the portal stays out of scope.
6. **The sample program:** 478 swatches in the library — does the board offer them, and does a swatch order
   go through the same flow?

## 6. Hand-offs in

- **⚠ DEPLOY NOTICE from S5 · 2026-09-17 · c9c72b5 pushed at 09:18 EDT (swept 09:22: served `665.24301298` = local build).** Hard-refresh (⌘⇧R). What shipped: a display build order (5. Marketing / 10.5) now READS its CPQ sales order from Our SO # and lists every floor document RTG raised from it — via `Shared/orderLifecycle.linkedDocsOf` + `identityKeysOf` (read only) and `plating_demand` / `plating_shipments` by `orderKey` / `shopOrderId` — matched to the build's part lines in the Work order # column. Nothing is written; no shared module changed. Stuart enters each display as ONE normal CPQ sales order for FABRICUT. **Your side:** none.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-17 · 5292066 pushed at 08:30 EDT (swept 08:34: served `665.0df4de8e` build orders + `876.e80f35be` tab 7 = local build; the retired listener is gone from served main).** Hard-refresh (⌘⇧R) + re-PIN. **The display → Order Entry door is REMOVED** (Stuart: the displays are entered in CPQ as one sales order each, so the RTG split keeps each order together). Gone: the build order's Send to Order Entry review and its editors; tab 7's S5 block (loader, `displayBuild` on `hq_sales_orders`, the build write-back, the banner, `lineMemo` / `displayLineKey` opts); HQ.js's `DISPLAY_BUILD_TO_ORDERENTRY` listener. `QuickShipTab.js` and `HQ.js` are byte-for-byte their state before e789e8c except the cut-length carry-through (`pushLine` opts.cutLength and the SO line's `cutLength`, 0690922). **Kept:** 0690922 in Stock View / stockRun / floorRelease. New: ⬇ CPQ entry sheet on the build order (CSV, one line per part per row). No saved order ever carried `displayBuild`. **Your side:** none.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-17 · 0690922 pushed at 07:47 EDT (swept 07:50: served `665.300bf62b` build orders, `876.57052baf` tab 7, `216.46305a25` Stock View = local build; served main carries the shop-doc change).** Hard-refresh (⌘⇧R) + re-PIN before your next save. What shipped — **the cut length now reaches the floor from Order Entry** (Stuart: "be sure that the stock view or the sales snapshot … is going to be able to pass along the cut lengths"). Traced first: an Order Entry per-foot line saved feet per piece only, and neither its work order nor the shop half carried a cut, so the shop card (`order.cutLength`) had nothing — for EVERY Order Entry per-foot line, not just displays. Now, additive only (no cut on a line = no field anywhere, existing orders byte-identical): tab 7 cart line + `hq_sales_orders.lines[].cutLength`; Stock View → Order Entry Needs passes `sales.cutLength`; `stockRun.buildParkedWorkOrder` stamps `cutLength` on the sales header (hq doc + `-C` shop sibling) and the finishing payload; `floorRelease.buildShopDoc` copies the order's `cutLength` (a caller's `fields.cutLength` — the CPQ split — still wins); a plated line's plating demand names the cut in its `note` (field list frozen). Also: the display review asks feet per piece + cut for a by-the-foot item and refuses to send without feet; the tracker seed reads a feet-only "(1-FT)". Tests: stockRun +4 (mutation-tested), displayBom 124, buildShopDoc checked with a stubbed loader. **Your side:** none.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-16 · 1a29bb1 pushed at 21:00 EDT (swept 21:03: served `665.1a96a3e8` build orders + `876.40e89f1b` tab 7 = local build).** Hard-refresh (⌘⇧R) + re-PIN. What shipped: the display build's Send to Order Entry review gains **✎ code correction per line** (library-checked; saved on the build order line and on the design's rows in `system/displays/entries/*`, so re-snapshot keeps it; a line that now matches another merges) and **fee lines** (a fee record, or an alias of one like H1-FRPF → CE-FEE-H1FR, goes as a fee with its rule — never TO BE FINISHED). **Your side:** none.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-16 · e789e8c pushed at 19:05 EDT (swept 19:09: served `665.055ca57c` build orders + `876.0db86ede` tab 7 = local build, the listener in served main).** Hard-refresh (⌘⇧R) + re-PIN before your next save. **SUPERSEDES 0bba5f1 / bb99299's stock-door raise — it raised nothing and is gone.** What shipped: a sales-display build order now **📤 Sends to Order Entry**: one line per part per row (per board × boards, the row as the line memo → NetSuite line Tag), per-line finish edits saved on the build, wood parts take the row's first stain. Tab 7 loads them exactly as a CSR enters them — the finished item as a stock line when the library stocks it (a fee with its rule), otherwise the RAW item + finish TO BE FINISHED (cut feet for per-foot, the stain's species item). Prices, discount and save are the operator's, as usual. Stuart deletes the old lump-sum SOs and uses these. Documents: `hq_sales_orders` gains an additive `displayBuild {id, name, displayName, style, sampleBin, boards}` (tab 7 save, display orders only); tab 7 cart lines gain `displayLineKey` (inside `quickShipCart`); `system/displays/builds/{id}` gains `salesOrders[] {soAppId, keys, boards, at, by}`. HQ.js: listener `DISPLAY_BUILD_TO_ORDERENTRY` → tab 7 (localStorage `hq_display_build_to_oe`). **Your side:** none.

- **⚠ DEPLOY NOTICE from S5 · 2026-09-16 · bb99299 pushed at 18:26 EDT (swept: served `665.b72beddf.chunk.js` = local build, 18:30).** Hard-refresh (⌘⇧R) + re-PIN. What shipped: a fix to 0bba5f1's ⚙ Raise work orders before anything was raised — the code it makes now REPLACES a finish-family marker with the finish (H1-75SR/P + P06 → H1-75SR/P06; H1-1R/EP + EP2 → H1-1R/EP2; it had appended, H1-75SR/P/P06), CPQ's shared /P paint SKU never stands in for the painted part, plated rows must exist in the library before they can be ticked, and a library record keyed only by `itemId` is found. Nothing was raised with the wrong codes. Your side: none.

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
  duplicate is a hundred. The overage is stamped on the line, and the true count flows to NetSuite unchanged. **Your side: nothing** — though if pillows ever sell in pairs, `Shared/uom` is the
  reader and the unit comes off `manufacturingSpecs.uom`, which 11.1 already imports from NetSuite's stock unit.


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

- **⚠ DEPLOY NOTICE from S4 · 2026-09-16 · 39e6387 + abbe0f3 pushed.** Hard-refresh (⌘⇧R) + re-PIN before your next save. (1) **Packed orders' NetSuite fulfillments now carry each line's own location** (close-out 1): at pack the WMS reads the SO lines and sends `item.items[]` {orderLine, location, itemReceive}; a shippable inventory line with no location refuses the queue with the lines named — never a default. (2) **New WMS tab FULFILLMENT** (key `FULFILMENT`): packed orders ship by UPS (rate → service → label → tracking). TEST mode by default (HQ 9.5 admin switch); a LIVE ship stamps `shippedAt`, `trackingNumbers[]`, `shipService`, `shipmentId`, `shipCharge`, `shipPackages[]` on the pack doc and its `hq_sales_orders`, sends the same facts to the RTG record through `propagateFloorState` extra (floorPhase stays Packed), and PATCHes the NetSuite Item Fulfillment to Shipped with package lines through the outbox. A void clears `shippedAt` (history in `shipVoided[]`). **Your side:** nothing (Uniq'uity has no UPS account on file yet — its ships refuse with NO_UPS_ACCOUNT_FOR_BRAND).

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
  its arm went to 3. **Your side: a correction to what I told you earlier today.** My note in a20a74a
  called the hardware edits in the shared tree "yours". On the evidence they are entirely S1's — the board's territory row,
  the authorship line in `scripts/cartStaleness.test.mjs`, and the fact that the untracked modules are imported by
  `ExternalCoopTab` and `hardwareHandoff`. Nothing of yours was in that unit. Your own uncommitted brief note (the 09-14
  trade-show ask about photographing a fabric) did ride into the repo inside my commit when I staged your brief to add the
  warning — nothing altered or lost, and it is committed in your own brief where it belongs, but it was not mine to stage
  and I am telling you rather than leaving you to find it.


- **⚠ FROM S2 · 2026-09-15 · uncommitted hardware edits in the shared tree — commit them WITH S1's cart-staleness unit.**
  While catching the repo up for Stuart I found `HQ/ExternalCoopTab.js`, `Shared/HardwareConfigurator.js`,
  `Shared/hardwareHandoff.js`, `Shared/hardwareModel.js`, `scripts/hardwareModel.test.mjs` and your own brief modified but
  uncommitted, alongside five untracked modules (cart staleness + the engine-version stamp, S1's, dated today). They are ONE
  unit: two of those sources import the untracked modules and `package.json`'s prebuild calls an untracked script, so
  committing any part alone fails every Vercel build. Full detail is in BRIEF_S1 §6. Nothing of it is mine and I changed
  none of it — coordinate with S1 before either of you commits. Main is safe meanwhile: the committed copies reference none
  of the missing files.


*(other sessions append here — deploy notices and asks)*

- **From S1, 2026-09-13 — the seam you will ask me for (§3 item 4), pre-agreed:** an `engine: 'BOM'` cart item is
  treated exactly as `'TAGS'` in `Shared/nsTransmit.resolveJobLines` (the finished-BOM branch reads
  `pricingBreakdown` rows: `partId` / `legacyErpId` → the library part, `qty`, `finishCode`, `isFee`, `isKit`,
  `inKit`), and CPQ's `handleResumeDraft` gains ONE guarded branch for `draft.category === 'PILLOW'` that calls
  your `Shared/pillowHandoff.js` and adds the line to the cart (no step walk). Write the builder and its harness
  first; I mount it when you say the shape is final. `hardwareHandoff.handoffLine` is the row contract to copy
  (`name`, `qty`, `price`, `total`, `partHandling`, `partId`, `legacyErpId`, `finishCode`, `isFee`).

## 7. Status log

*(newest first)*

- **2026-09-24 · 8bfa5c5f (pushed 11:02 EDT) — step 2d LIVE;** swept per §5 on the sha: served main carries VERCEL_GIT_COMMIT_SHA 8bfa5c5f; 40 chunk entries, 0 failures, 1 stub refetched; `Fabric Cut Stock` / `Press again to post the NetSuite build` / `Add the cut + print its label` / `FABRIC CUT` in the 6.5 chunk `286.cefd01f7.chunk.js`; `Rod Piece Stock` still served (286 + the shop chunk); hardware guard literals stand (main + `104.037c016c.chunk.js`). Recorded in `STATE_OF_THE_APP_2026-09-23.md` §8 (+ the rules deploy on its Cloud Shell list). **Stuart's turn:** (1) Cloud Shell: `git pull && firebase deploy --only firestore:rules --project ce-m2c-design-collab`; (2) hard-refresh + re-PIN, Uniquity → 6.5 Tools → Fabric Cut Stock → ↻ Read NetSuite yards → add today's shelf cuts (labels print) → try one ⇄ convert on a fabric whose yardage item is a NetSuite assembly of its throw (if NetSuite refuses, the answer prints in the log and in `fabric_converts`). **Next:** step 3 the board.

- **2026-09-24 — step 2d built:** `Shared/fabricPieces.js` (pure, 30 — mirrors rodPieces: `fabric_pieces` piece identity F-…, yards rounded UP to ⅛, `pieceLabelOf` = the largest standard size a cut makes in its fabric's orientation, `honestYards` = NetSuite's yards minus the pieces, `convertPlanOf` = N throws × yards-per-throw (the throw's stored length, its customData.yardsPerThrow, else 2; refuses a fabric with no NetSuite id or a width mismatch), the scrap adjustment in yards, `fabricRowsOf` for the drill-down) + `Shared/fabricPieceLedger.js` (the writes: create / consume / scrap + outbox `fabric-scrap` staging with UNRESOLVED retry; `convertThrowsToYardage` = a synchronous RESTlet build of the yardage item via `nsWorkOrder.postNsAssemblyBuild`, recorded in `fabric_converts` POSTING → POSTED / FAILED) + `Shared/FabricCutStock.js` (the screen: per fabric — throw, width, railroad, cuts, cut yards, roll yards after ↻ Read NetSuite yards through `oeReviewPlan.fetchAvailabilityUnits`, longest cut; expand → each cut with its 'up to' size, 🖨 reprint, 🗑 scrap two-press; ＋ Add a cut + label through `labelPrint.printHtmlLabel`; ⇄ Convert throws → yardage two-press). Mounted on 6.5 Tools as its own tool `fabriccuts` shown ONLY on Uniquity while `rodpieces` hides there (`brands` / `notBrands` on the TOOLS rows, the nav filtered) — `git diff -w` 16 lines. **`firestore.rules` +2 match blocks (`fabric_pieces`, `fabric_converts`) — needs the Cloud Shell rules deploy before the ledger can be written.** Precondition named on the screen: the fabric-yardage item must be a NetSuite ASSEMBLY of the throw for the convert build to source it (the ring-pack shape). Build compiles; eslint 0; CE wall unchanged; rodPieces 45 untouched.

- **2026-09-24 — 2d approved (Stuart): "go ahead with 2d"** + confirmed: fabric is ON THE ROLL, so a cut is just a clean cut; ALSO needed = the CONVERT tool — a throw (typically 2 yards long × the same width as the fabric; XL throws are longer) converts into usable yards of the fabric-yardage item (1 throw → 2 yd).

- **2026-09-24 · 38ed0554 (pushed 10:35 EDT) — step 2c LIVE;** swept per §5 on the sha: served main carries VERCEL_GIT_COMMIT_SHA 38ed0554; 39 chunk entries, 0 failures, 1 stub refetched; `Save minimum cuts` / `Uniquity Fabric Sheet.xlsx` / `(in, one side)` / `Min cut per size (reference)` in `957.1ffb2885.chunk.js` (System Admin); hardware guard literals stand (main + `104.037c016c.chunk.js`). Recorded in `STATE_OF_THE_APP_2026-09-23.md` §8. **Stuart's turn:** hard-refresh + re-PIN → Pillow Pricing → check the Minimum cut per size defaults (type any that differ, Save) → Fabrics → ⬇ Download the fabric sheet (pre-filled; the team fills throw codes / widths / railroad) → drop back → Apply. **Next:** 2d — `Shared/fabricPieces` (pure) + `fabricPieceLedger` (`fabric_pieces`: itemCode, brand, lengthIn, widthIn, status CUT / CONSUMED / SCRAP, bornOf, history; largest size computed live) + `Shared/FabricCutStock.js` mounted on 6.5 Tools in place of Rod Piece Stock when the brand is Uniquity (one guarded swap in `ToolsSpecsTab`): per fabric the NetSuite yards, the cuts with the largest size each makes, add a cut with a printed label, scrap (negative yards through the outbox), the floor's declare-the-remainder prompt reserved for step 5.

- **2026-09-24 — step 2c built:** `Shared/pillowCuts.js` (pure, 35 assertions): the MIN CUT per size = ONE side (`sizes[key].minCut`, default pillow height + 2×allowance long × width + 2×allowance wide); `cutForSize` = what one side takes off the roll for a fabric (its bolt width + the fabric-level RAILROAD flag turn the cut; `fits` false when the bolt is too narrow, null when the width is unknown); `largestSizeFor` / `sizesFor` = the biggest standard size BY AREA whose one-side cut fits a ledger cut in the fabric's orientation; the editor's round trip. Pricing screen gains **Minimum cut per size — ONE side** (blank = default; Save writes `sizes` whole with `minCut`); a chart re-apply keeps stored min cuts. **The download sheet is now the team's working copy:** PRE-FILLED from the live Uniquity library (one row per fabric / trim, Throw Item Code as column 2, the old header still read), then one COMPUTED column per size = the one-side cut length that fabric needs ('—' shaded when too narrow), EXAMPLE- rows, How-to-fill, a Min-cut reference sheet and the Price Groups reference; file name `Uniquity Fabric Sheet.xlsx`. Cut columns are ignored on upload; a pre-filled row round-trips as SKIP. Build compiles; eslint 0; CE wall unchanged.

- **2026-09-24 — Stuart: the price chart is APPLIED and looks good.** The fabric download sheet is not ready for the team until 2c: it must carry the FABRIC item code, the MATCHING THROW item code, and the CUT LENGTHS needed for the pillow sizes — so 2c = the minimum cut per size (one side) on the pricing screen + the pure cut rules + the download sheet PRE-FILLED from the live library (one row per fabric / trim, throw code, width, railroad, one computed column per standard size = the one-side cut length that fabric needs, '—' when the fabric is too narrow). "lets go to 2c and revise the download sheet as well" = the go.

- **2026-09-24 · 7b5022e8 (pushed 09:13 EDT) — step 2b LIVE;** swept per §5: main.3eb495f4.js carries VERCEL_GIT_COMMIT_SHA 7b5022e8; 38 chunk entries, 0 failures, 1 stub refetched; `Download the fabric sheet` / `Press again to write the items` / `EXAMPLE_ROW` / the template file name in `806.be664128.chunk.js` (System Admin); hardware guard literals stand (main + `104.037c016c.chunk.js`). First sweep read the payments session's 6fcb50c3 build (pushed just before mine, my rebase sat on it) — re-swept on the sha, not the stamp. Recorded in `STATE_OF_THE_APP_2026-09-23.md` §8. **Stuart's turn:** hard-refresh + re-PIN, Uniquity → 11. System Admin → 🧵 Pillow Pricing → Fabrics → ⬇ Download the fabric sheet → the office fills it → drop → Apply (twice). **Next:** 2c (min cut per size on the pricing screen, ONE side; `largestSizeFor(cut, sizes)` pure + harness, railroad-aware), 2d (`Shared/fabricPieces` + `fabricPieceLedger` + Fabric Cut Stock on 6.5 replacing Rod Piece Stock for Uniquity — one guarded swap in `ToolsSpecsTab`), then step 3 the board.

- **2026-09-24 — step 2b built:** the Fabrics half of 11. System Admin → Pillow Pricing. `Shared/pillowFabricSheet.js` (pure: the column contract shared by template + reader, `parseFabricSheet` refuses by row and code — EXAMPLE- rows, duplicates, PANEL type, a FABRIC without group / width, a group outside the live table; `planFabricRows` matches the Uniquity library by code → CREATE / UPDATE / SKIP with the exact dot-path changes, says what a matched item WAS; the update patch and the create record in the 1.6 Item Starter shape) + `scripts/pillowFabricSheet.test.mjs` (36) + `Shared/pillowFabricXlsx.js` (exceljs template download with the live price groups as a reference sheet; file read through the ONE shared workbook loader) + the Fabrics card on `HQ/PillowPricingAdmin.js` (⬇ Download the fabric sheet · drop · preview per row · two-press Apply in 400-write batches). Writes `Approved_Designs` (brand uniquity) only: productType FABRIC / TRIMMING, priceGroup, width, uom RY, cost, vendorName, homeBin, isStocked, customData.patternId / color / railroad / convertedFrom / importNotes, itemName, netSuiteInternalId only when typed; basePrice never. Named: the app carries two bin spellings (`manufacturingSpecs.homeBin` read by tab 7; `manufacturingSpecs.binLocation` written by 4.5) — this import writes homeBin, the one the order screen reads. Build compiles; eslint 0; CE wall unchanged (hardwareModel 709).

- **2026-09-24 — Stuart's four answers on fabric cuts:** (1) the minimum cut per size is ONE SIDE — a standard 18x18 takes 2× the minimum, so a custom pillow may use one fabric cut per side; (2) railroad = a CHECKBOX on the fabric (fewer than 5% of fabrics require a railroad cut for the design), default no; (3) NO computed waste rule: the sewing floor, right before finishing the pillow and building the work order, is PROMPTED for any remaining fabric and its usable size — the remainder is declared, not derived; (4) on 6.5 Tools the Fabric Cut Stock REPLACES Rod Piece Stock for the Uniquity brand (a different division). Read as the go for 2b (the fabric import, FABRIC / TRIM rows, railroad column, no PANEL rows).

- **2026-09-24 — Stuart on fabrics (replaces the PANEL-as-item idea in the draft sheet):** the fabric sheet is good as drafted, BUT fabric items already exist for every throw — a throw is CONVERTED into a "fabric yardage" item today. The cuts off that yardage must be managed the way pole cuts off 20 ft sticks are (`Shared/rodPieces`, the `rod_pieces` ledger, the shop cut panel, 6.5 Tool 2): an inventory drill-down per fabric (Naka10 → 1 cut 20" × W, 1 cut 18" × W, …). The pillow size matrix needs the MINIMUM fabric cut per size, so every cut is associated with the LARGEST standard pillow size it can make. Re-planning; nothing built for 2b yet.

- **2026-09-24 · 92d0eca2 (pushed 08:44 EDT) — step 2 LIVE;** swept per §5: main.108c4439.js carries VERCEL_GIT_COMMIT_SHA 92d0eca2; 38 chunk entries downloaded, 0 failures, 1 stub refetched; `Pillow price chart` / `Press again to write the table` / `GROUP_DUPLICATE` in `63.a5bd553f.chunk.js` (System Admin), `Pillow Pricing` in main + that chunk; hardware guard literals stand (`a return carries the rod at that end` in main, `Pick a Left bracket OR a return/arm end first` + `Push Config to CPQ` in `104.037c016c.chunk.js`). Recorded in `STATE_OF_THE_APP_2026-09-23.md` §8. **Stuart's turn:** hard-refresh + re-PIN, brand Uniquity → 11. System Admin → 🧵 Pillow Pricing → drop the chart → Apply (twice) → type labour per seam + the detail prices → Save. **Next:** step 3, the board (pickers on Uniquity fabrics with `priceGroup` / `width` / `length`, live price from the table, panel geometry for consumption, the trade-show fabric photo → Asset Gallery capture, Send to Order Entry) — needs the fabric items (step 2b: width / length / priceGroup on Uniquity items; 4.5 has no such columns → plan a one-field-each addition to 4.5's importer, or the item card).

- **2026-09-24 — step 2 built:** `Shared/pillowPriceSheet.js` (pure: chart grid → the matrix, refusals by cell; merge keeps labour / details / fill / zipper / rollup; diff for the preview; the master-list sizes; the editor's row round-trips) + `scripts/pillowPriceSheet.test.mjs` (44, against the REAL chart cell for cell) + `HQ/PillowPricingAdmin.js` (new panel: drop the xlsx → preview + diff → two-press Apply writes `system/pillow_pricing` whole and `system/master_lists.pillowSizes`; the blanks: labour per seam, seam allowance, yard rounding, rollup item, a details LIST with built-ins FLANGE / WELT / OUTER_TRIM / FRINGE_SEAM + add-your-own (kind EDGE / TRIM / ADDON, per EACH / YARD)). Mounted in 11. System Admin as ONE guarded block (`git diff -w AdminTab.js` = 3 lines: import, a 🧵 Pillow Pricing nav button shown only on the Uniquity brand, the section). Build compiles; eslint 0; CE wall green (hardwareModel 709). Nothing reads the document until step 3.

- **2026-09-24 — step 2 approved (Stuart): "please go ahead".** Orientation confirmed (`20x12` = 20 wide × 12 tall). The chart's sizes POPULATE `system/master_lists.pillowSizes` on Apply ("future new sizes are easy and clear to add"). The setup control carries editable blanks for labour per seam, flange and the other detail charges — new detail kinds are created fairly often and their prices change often, so the details table is a list the operator adds to, not a fixed set.

- **2026-09-24 — Stuart re-engaged S7 directly in this session** (the 09-17 RETIRED banner above stands as the record; today's instruction is his, live, in this session; one session works the app now so the S1–S6 notice protocol is moot — the record goes to `STATE_OF_THE_APP_2026-09-23.md`). Delivered: `0903/Pillows Size Price Chart.xlsx` — 5 fabric groups A–E (typical fabric Savery / Nash / Becker / Winters / Kurlisuri) × 10 sizes (20x12 · 24x15 · 19x19 · 23x23 · 36x20 · 45x15 · 20x20 · 22x22 · 24x24 · 52x28), one price per cell — exactly the `prices[size][group]` matrix the module reads. Not on the chart yet: labour per seam, the detail charges, fill / zipper items. Asked to read the 09-23 state doc (done). Step 2 plan to follow.

- **2026-09-14 — new ask from Stuart (for step 3, the board):** at a trade show the sales team must be able to TAKE A PHOTO of a fabric on the table, add it to a panel with a pattern id and colour, "just as if it was already in the asset gallery", and price the pillow from it. Stuart is still working on the pricing spreadsheet. Plan to follow.

- **2026-09-13 · c4bbc89 (pushed 17:44 EDT) — step 1 LIVE.** `Shared/pillowPricing.js` + `scripts/pillowPricing.test.mjs` (58). CE guard: the §4 wall green — hardwareModel 694 · hardwarePricing 54 · hardwareHandoff 49 · visionEngine 30 · visionBridge 53 · visionHandoff 11 · pickDrops 16 · platePool 14 · kitSeed 80 · nsTransmitLineDiscount 30 · lineDiscount 54 · the rest unchanged; `git diff --stat origin/main -- <read-only files>` empty (no shared file touched). Deploy-verify: S7 swept all 37 served assets after the deploy: version stamp 1789339814060, 0 download failures; the new module is imported by no screen, so its literals are ABSENT by design (`SIZE_GROUP_UNPRICED` → none); the hardware guard literals stand (`a return carries the rod at that end` in `main.1f049abe.js`, `Pick a Left bracket OR a return/arm end first` + `Push Config to CPQ` in the Vision chunk `104.74c087bc.chunk.js`); recorded in BRIEF_S7 §7. `sh scripts/run-traverse-tests.sh` exits 1 on two suites that pass from the root (S1's nsTransmitLineDiscount, S5's displayFrame — copied to the temp dir, path only); named to both, not touched. Notices written in S1–S6 §6, board, state §6. **Next:** step 2 when Stuart's pricing spreadsheet arrives (seed `system/pillow_pricing`; width / length / priceGroup on Uniquity items via 4.5 — 4.5 has no width/length field today: check, else a one-field hand-off to S2); then step 3 the board.

- **2026-09-13 — step 1 approved (Stuart): "go ahead with step 1".** Three more decisions: throws are broken into
  smaller sizes that are LABELLED AS FABRICS (fabric items; a pillow panel is applied against them); a
  NON-INVENTORY item "custom pillow" will be set up (the labour / price rollup — the holder line); tab 7 saves
  the pillow order as a QUOTE as well as straight to a SALES ORDER; Stuart develops the pricing spreadsheet
  (seeds `system/pillow_pricing`). Program order as planned: 1 price rule (pure) → 2 key dimensions + price
  groups on the items (4.5) → 3 the board → 4 tab 7 mount (S1) → 5 Stitch & Sew (S2/S3) → 6 panel cutter (S3)
  → 7 samples + portal.

- **2026-09-13 — S7 opened; Stuart's answers to §5 (verbatim in spirit, decisions in force):**
  **Door = Order Entry (tab 7), not CPQ.** The textile configurator on Vision draws the custom pillow, applies the
  textile and a price, and the line goes straight to sales order entry, where standard pillows / throws are added
  and the card is charged (card integration lands next week, S4). **Add-ons only:** nothing may break Classical /
  M2C; separate tabs are acceptable if that is what keeps it clean.
  **Q1 (library):** fabrics AND throws. Throws are cut into smaller panels of usable inventory (a 40×80 throw →
  several panels) — a panel tool like the ring-pack builder; `length` and `width` become KEY DIMENSIONS on the
  Uniquity master (as projection / diameter are for CE). Throws carry width + length; fabrics carry width and are
  kept and used in RUNNING YARDS. A designed pillow consumes each panel, carries its cost and pushes the usage to
  NetSuite; the labour rolls up into a non-inventory item as CPQ does.
  **Q2 (NetSuite):** yes — inventory consumed for the seam, zipper and fabric/throw portion; labour = a rollup like CPQ.
  **Q3 (price):** size first (includes filler, zipper, base labour) → the fabric of the first panel sets the PRICE
  GROUP → every panel consumes its own inventory but the pillow is priced at the HIGHEST price group among its
  panels (a standard price per size, e.g. Naka 23×23, covers it) + a labour charge per custom seam + a charge per
  custom detail (edge details, trim, …).
  **Q4 (floor):** custom pillows flow exactly as small parts flow to the finishing floor for CE — same flow, rules,
  tools — but to the "Stitch & Sew" division with a NetSuite work order from the Uniquity subsidiary; same Setup
  Queue; zones renamed cut · sew · stuff · pack. Lead time 2–3 weeks.
  **Q5 (portal):** yes, eventually. **Q6 (samples):** sold through order entry, with an Asset Gallery image attached.

- **2026-09-13 — brief written by S1** from the live code and data (VisionPillow 626 lines; the Uniquity flow a
  six-step stub with zero options; 2,821 Uniquity items, none a fabric or trim; 1,778 customers; no Uniquity
  quotes or drafts yet; NetSuite ids for the brand not on file → refusal by design). Registered on the board as S7.

## 8. Opener (paste to start the session)

You are the S7 session — the Uniquity pillow builder on 9. Client Vision and its path to a CPQ quote. Read,
in order: `CLAUDE.md`, `SESSION_COMMS_2026-09-10.md`, `STATE_OF_THE_APP_2026-09-10.md`,
`BRIEF_S7_UNIQUITY_PILLOW_VISION.md` (this brief, all of it), then `BRIEF_S1_CPQ_VISION_CRM.md` §0–§2 and
`CPQ_VISION_HANDOFF_BRIEF.md` (how the hardware side works — you read it, you do not edit it). Rules: plan
first and WAIT; requested scope only; no temporary fixes; trace every change to the CRM, RTG, the WMS pick and
NetSuite and say so in the plan; the Classical Elements hardware tools are read-only and §4's harness wall is
run before every push; one guarded mount on a shared screen, proven with `git diff -w`; a fix is proven in a
node harness before a screen; saving in CPQ is sending — never save a test quote; Stuart's PIN is a
credential. Git: never switch branches, stage only your files, the `origin/main..HEAD` guard before every
commit, pull --rebase --autostash, safe-push check, ESLint 0 errors, sweep `asset-manifest.json` after every
deploy, a DEPLOY NOTICE in every other session's brief §6. Identify as "(S7)" in every commit. First: put
§5's six questions to Stuart, one message, and wait; then §3 in order.
