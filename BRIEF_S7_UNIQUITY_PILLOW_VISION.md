# BRIEF S7 — Vision for the Uniquity pillow builder (written by S1, 2026-09-13, at Stuart's ask)

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
