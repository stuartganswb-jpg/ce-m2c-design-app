# H1 collection load — deep dive, verdict, and playbook (2026-08-08)

Four parallel code dives (1.6 load path · H1-vs-H2 flow mechanics · spec-sheet geometry pipeline ·
alias/client-pricing chain) behind every claim here; file:line refs throughout. Written before the
big H1 load so the load happens in the right order, with the right checks, breaking nothing.

---

## 1. VERDICT FIRST — what H1 needs and what it does not

**H1 does not need a flow rebuild, and should not get one.** The H1 flow's architecture (one
assembly, one flow, runtime code-swapping) differs from H2's (one assembly + one flow per
diameter, grouped by the CPQ landing switcher), but the difference only *bites* in one place —
exactly the one Stuart named: **spec sheets**. Everything else about H1 works because items and
prices already swap per diameter; only the *geometry* is a single ¾"-native GLB scaled uniformly
(`CPQTab.js:3630`, `sizeMatrix.js:388-392`), and the spec generator measures raw world-space mesh
bounds × 39.37 (`specSheetGeometry.js:5`) — it never applies the display scale, and uniform scale
would be the wrong model anyway (projection is an orthogonal axis; plate dims don't track
diameter — see `SPEC_MASTER_MANIFESTS.md:3-8`).

**Why a rebuild is off the table:** a flow is bound to its GLB by node NAMES, not just by
`linkedAssemblyId` — `step.geometryMap`/`subGeometryMap` CSVs, `step.targetNodes`,
`flow.hiddenClusters` (cluster ids change on re-import), and mount options derived live from
`nodeClusters` (`CPQTab.js:2912-2939, 943-947`). Re-pointing the flow at per-diameter masters
breaks all of it; regenerating as H2-style per-dia flows mints new flow/step/opt ids — saved
quotes don't migrate and portal `portalFlowIds` entitlements go stale. Against "fundamentals
frozen," the cost buys nothing the spec registry doesn't already provide.

**The fix that is already built:** the spec-sheet **per-cell registry**
(`system/spec_sheet_config.sizeSources[family]["dia|proj"]`) with **direct spec GLB upload** as
its preferred source (`SpecSheetModal.js:128-138`). One flat, true-meters, code-named GLB per
dia×proj cell. H1's job is to FEED it — 3 dias × up to 3 projections of true geometry — not to
change CPQ. New families started later can use the H2 method from day one; H1 stays H1.

---

## 2. The load, in dependency order

Each layer depends on the one before it. Loading out of order is how holes appear.

**Step 0 — freeze the naming grammar (before any file is authored).**
The item code is load-bearing in four different parsers, so it must be right at authoring time:
- Fusion component names ARE the codes — matched by normalized **longest-prefix**
  (`itemCodeMatch.js:53-80`); codes <4 chars dropped; ties broken by slot category.
- The Fabricut importer derives `sizeKey` from the code + description
  (`fabricutImport.js:27-75`): dia token between `H1-` and the style, projLetter from the
  DESCRIPTION text `(3-5/8" P)`→S `(4-5/8")`→E `(6" P)`→6, dual→D.
- The spec scene-derived path requires node name == `legacyErpId`/`itemId` EXACTLY
  (`SpecSheetModal.js:375`), and legacy cluster names must match `^(H\d|CE-|FI)`
  (`SpecSheetModal.js:297`).
- `sizeVariantOf` rewrites `family|dia|style|projLetter` (`sizeMatrix.js:283-295`) — the style
  chunk must be IDENTICAL across H1-75BE / H1-1BE / H1-138BE or the swap misses (miss = silent
  fallback to the base item's code on quotes AND spec sheets).
Rule: **codes are immutable once pinned.** A rename ripples through GLB node names, pins,
the size index, clientPricing clientSku, and NetSuite mapping. Get it right in the Excel/Fusion
source, not in the app afterward.

**Step 1 — items into the library** (Fabricut xlsx importer, 11.1). It stamps `sizeKey` and the
`fabricut{}` box in the same pass. Watch the importer's gap report (`NetSuiteSyncTab.js:1093+`) —
an xlsx row with no library match is a hole that every later layer inherits. Then NetSuite sync
for `netSuiteInternalId` — an item without one is silently DROPPED from every pushed SO
(`ERPPushPullTab.js:414-422`).

**Step 2 — customer pricing** (bulk Fabricut→clientPricing in Library tab 4 detail drawer, or
4.6). Two non-obvious rules:
- Rows must key on the **CRM doc id** — it is the only key ALL read sites agree on. CPQ matches
  id∪name∪companyName (`clientPricing.js:14-18`) but the **NetSuite SO push matches strict id
  only** (`ERPPushPullTab.js:386-389`), as do RTG pick (`RTGDispatchTab.js:475`) and the
  onboarding export. A name-keyed row prices the quote right and pushes the SO rates WRONG —
  quietly, because the rollup absorbs the difference.
- The `fabricut{}` box and the clientPricing row are a DUAL WRITE and only 4.6 writes both
  (`CustomerCollectionsTab.js:97-117`); the Library editor and the importer write only the box.
  After any box-only edit, re-run "Add to Client Pricing" for the touched items.

**Step 3 — assemblies/pins** (1.6). Always **Extend the existing doc — never re-type the name**:
a new build mints `<BRAND>-ASM-<Date.now()>` with no name-collision check
(`AssemblyBuilderTab.js:604`) and silently forks the assembly. Doc ids never change on
update — that stability IS the BOM/CPQ linkage. Known trap: extending the SAME slot twice
appends a duplicate cluster + duplicate geometry (no replace-slot exists); 1.5's cluster delete
removes the record but not the mesh. Fix mistakes by pin edit (Load Choices grid), not rebuild.

**Step 4 — spec geometry per cell** (the actual H1 gap). Per dia×proj cell:
1. Author flat in Fusion: ONE of each item, true positions, nodes named exactly as codes,
   top-level (nesting one group deep makes them invisible — `SpecSheetModal.js:369`).
2. 1.6 Fusion Import → **Spec (true m)** flavor → download .glb. (The PRODUCTION-inches vs
   SPEC-meters toggle is NOT bound to the destination — picking wrong is silent. Meters for
   spec, always.)
3. BOM Engine → 📐 → select the cell → upload. Registry entry + `spec_glbs/<fam>/<cell>` blob.
4. Wall-mount `topHole` per wall-plate code (global, entered once — the only amortized artifact)
   + manual dims for what geometry can't show.
Acceptance check per the manifest: **the first printed sheet's pole Ø must read exactly
3/4 / 1 / 1-3/8.** Nothing in code asserts this today (see §4.2) — until it does, check by eye.

**Step 5 — flow + portal.** H1 flow steps that offer client-priced items must carry
`useClientPricing` (a correct row is INERT without it — `CPQTab.js:1701` etc.); Fabricut's CRM
record needs the flow in `portalFlowIds` and the collection allowed. Then one end-to-end proof
quote: portal request → CRM doc → reopen in CPQ → price → SO push, checking the per-line rates
(not just the total) against the clientPricing rows.

---

## 3. Rules that protect the existing linkage (the "don't break it" list)

1. `Approved_Designs` doc id never changes; update in place, Extend not rebuild.
2. Item codes immutable once pinned (see Step 0).
3. Alias docs NEVER get a `netSuiteInternalId` (sync excludes them by design —
   `NetSuiteSyncTab.js:822`; a mapped alias would push as itself).
4. clientPricing rows keyed by CRM doc id; never hand-type customer names into rows.
5. The retired-assembly pattern: a FLOW can be deleted, its ASSEMBLY DOC must stay if any spec
   cell or pin history references it (the 3.625" precedent).
6. `spec_sheet_config` mappings: Remove deletes the registry entry AND its manualDims — re-map
   means re-dim. Prefer re-upload over remove+re-add.
7. Never edit Session C's files (CPQTab/AdminTab/AssemblyBuilderTab/sizeMatrix…) from another
   session — route through Stuart (CROSS_SESSION_CONTRACT.md).

---

## 4. Proposals — in order of value per effort

> **STATUS 2026-08-08 (weekend sprint):** 4.1 ✅ `c36db6f` (🧭 Readiness in BOM Engine) ·
> 4.2 ✅ `7e26cc6` (warn-only, in the 📐 modal) · 4.3 ✅ `7e26cc6` (chips beside the pickers) ·
> 4.4 ✅ `dcd2d63` · 4.5 ✅ `6715b03` (all five gates) · 4.6 partly ✅ `7e26cc6` (fabCode
> precedence + registry pins by both ids; the portal-engine P25 mirror remains OPEN — Session A's
> next engine pass). 4.7 unchanged: not doing it. Remaining §2 work is DATA, not code: author and
> load the collection through the steps, watching the board.

### 4.1 H1 Readiness Board (the one big build; do before the mass load)
One read-only screen that scores EVERY H1 item and cell across the layers, so holes show before
an operator hits them. In-app (App Check forbids scripts), pure scoring module + node tests.
Columns per item: code parses to sizeKey ✓ · sizeVariantOf round-trip 75→1→138 resolves ✓ ·
basePrice ✓ · netSuiteInternalId ✓ · productType classifiable ✓ · fabricut tiers+pattern # ✓ ·
clientPricing row (id-keyed, >0) ✓ · pinned on the master ✓. Per family cell: registry entry ✓ ·
source kind (GLB/assembly/blocked) · savedAt · measured pole Ø vs expected (see 4.2).
This generalizes to every future collection load — build once, use forever. The data reads are
all existing shapes; no writes; no territory conflicts if built as its own module/panel.

### 4.2 Geometry-vs-cell assertion in the spec pipeline (small, high value)
The expected numbers already sit in `sizeMatrix.js` (`dia.options[].inches`,
`proj.options[].inches`); the measured ones are already computed. Compare and WARN (don't block):
"pole measures 0.75", cell expects 1-3/8"" / "projection measures 3.6", cell says 4-5/8"" /
unit-guess flag when the >10-units inches heuristic fired. Kills the top silent failure of the
whole H1 spec effort. (SpecSheet module — coordinate ownership before editing.)

### 4.3 Registry coverage strip in the 📐 modal (small)
The dia/proj dropdowns render every cell identically; coverage is discovered by clicking each
one. Color the options (green mapped-GLB / amber assembly-mapped / red missing) from the already
loaded `sizeSources`, and show `savedAt`. 9 cells for H1 today; the H2 families make it 16.

### 4.4 Unify the customer matcher in the push path (data-trueness fix, do EARLY)
Switch `ERPPushPullTab.js:386`, `RTGDispatchTab.js:475`, and the onboarding export to the shared
`customerKeys`/`clientPriceFor` matcher CPQ already uses. This is the "quotes and sales orders
must remain true to each other" defect in its purest form: today the same row can price the quote
and miss the SO. (RTG is Session B territory; route it.)

### 4.5 1.6 hardening asks (Session C's file — routed, not edited by others)
In value order: (a) a match-rate GATE on Fusion import — "7 of 9 components matched a library
code" with the unmatched named, confirm to proceed (today unmatched is silent and identical to
shared hardware); (b) bind the SPEC/PRODUCTION export flavor to the destination slot (📐 slot ⇒
true-meters, merge slots ⇒ inches) instead of an unbound toggle; (c) name-collision check on new
build — "an assembly with this name exists; Extend it instead?"; (d) the build path still writes
the old colliding pin id `PIN-<asm>-<cluster>-<part>` (`AssemblyBuilderTab.js:744`) that the
assign path already fixed with a node-name hash (`:1079-1083`) — same fix, other path; (e)
replace-slot on Extend (or dedupe by slot id) so a corrected upload doesn't append a duplicate
cluster and orphaned mesh.

### 4.6 Small drift repairs (opportunistic)
- Spec `fabCodeFor` precedence (`SpecSheetModal.js:311-314`) ≠ `fabricutCodeOf`
  (`priceLevels.js:62`) — the sheet can print a different pattern # than the quote line. Unify.
- Portal engine's inlined priceLevels lacks the outsourced-registry (`/P25`-is-plated)
  correction — portal and CPQ can tier the same item differently. Mirror it on the next portal
  engine pass (Session A).
- Registry `assemblyId` stores the Firestore doc id but pins are keyed by itemId — a mapped
  source whose doc id ≠ itemId resolves with zero pins silently (`SpecSheetModal.js:143-144` vs
  `AssemblyBuilderTab.js:665`). Accept both on lookup.

### 4.7 NOT proposed: converting H1 to per-dia flows
Cost (new flow/step ids, quote migration, portal re-entitlement, re-tagged geometry maps) exceeds
benefit (spec sheets — already solved by the registry). Revisit only if a NEW requirement needs
per-diameter render geometry inside CPQ itself. New families: use the H2 single-assembly method
from day one and this question never arises again.

---

## 5. What "done" looks like for the H1 load

Every H1 item green on the readiness board; every dia×proj cell mapped to a true-geometry GLB
whose measured pole Ø matches its cell; one Fabricut proof quote priced at each level with
per-line SO rates matching the rows; spec sheets printed for one item per cell and dimension-
checked by hand once. Then the collection is loaded, not just present.

---

## 6. HARD NOTE — the regression protocol for generator changes (Stuart 2026-08-09)

> "i really need to make sure these fixes stick, we have done this so many times and each time i
> add a new cpq flow we wreck what already worked."

Recorded as standing law for THIS session and every session after it:

1. **Fix order is SINGLE-assembly first, then combined/family, then the rest.** A change is not
   done until the single-flow case (Brimar) is proven, because it is the simplest and the one the
   team demos with.
2. **Every generator change names its blast radius before it ships.** The generator serves FOUR
   flow shapes — single-assembly, combined size-family (H2/new-H1), the traverse fork
   (`Shared/traverseFlow.js`), and the legacy H1 flow. A commit that touches step emission,
   geometry maps, or plate gating must state which of the four it can affect and how the other
   three were verified untouched (guard flag, test, or `git diff -w` scope proof — the
   contract's "extend by adding" rule).
3. **Vision Hardware is a co-consumer of the same flows.** Any change to CPQ render gating
   (geometryMap, end-treatment, backplate pools) gets checked against Vision's read of the same
   fields before shipping (see memory `cpq-bay-fab-linkage`).
4. **Regression pins accumulate.** Every incident becomes a permanent node test with the real
   shape in it (the Brimar poisoning, the legacy-H1 render scale, the stamped-only keys). The
   suite in the scratchpad runs before every generator commit; incidents never get re-litigated
   from memory.
