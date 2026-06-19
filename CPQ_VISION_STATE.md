# CPQ ↔ Vision Hardware — Current State & Cleanup Map

**Scanned:** Node Grouping (`NodeClusterTab.js` + dead `NodeCluster.js`), BOM Engine (`BOMTab.js`), CPQ (`CPQTab.js`), Vision Hardware (`VisionHardware.js`), and the flow generator in `AdminTab.js`, on branch `feat/vision-dynamic-config`.

**Headline:** The app **compiles (0 errors)** and the work is committed, so nothing is broken or lost. The "mess" is accumulated duplication — the new tag-driven flow generator was added without retiring the old one, plus two unfinished field-rename migrations.

---

## 1. How the pipeline is wired today (the happy path)

1. **Node Grouping** (`NodeClusterTab.js`, Tab 1.5) writes clusters as an array **on the assembly's `Approved_Designs` doc**: `nodeClusters[] = { id, name, nodes[], location, position, category, center }`. Tags: `location` (WALL/CEILING/END), `position` (LEFT/CENTER/RIGHT), `category` (BRACKET/POLE/FINIAL/BACKPLATE).
2. **Visual Assembly** (Tab 2) writes **`assembly_pins`** = `{ assemblyId (=itemId), clusterId, partId, partName, targetNode (=nodes joined), ... }`, binding library parts to clusters.
3. **Flow generator** — `AdminTab.handleGenerateHardwareFlow` ("Generate Flow from Tags", `AdminTab.js:426-488`, button `:1019`) reads the pins + clusters, classifies each cluster's category (tag, or derived from the pinned part's `productType`), groups clusters by part, and emits a **fixed 10-step hardware flow** into a new `cpq_flows` doc (`FLOW-<ts>`).
4. **CPQ** (`CPQTab.js`, Tab 8) loads the flow via `linkedAssemblyId`, renders the `.glb` (`DynamicModel`/`useGLTF`), and computes 3D show/hide from `step.geometryMap` (optId→mesh CSV), `mountSelector` steps (by cluster `location`), and flow-level `hiddenClusters[]`.
5. **Vision Hardware** (`VisionHardware.js`) is a **separate 2D SVG drafting + fabrication-math tool**, rendered inside **Client Vision** (Tab 9) for the HARDWARE category. It writes **`cpq_drafts`**; CPQ's `handleResumeDraft` (`CPQTab.js:407-521`) translates a draft into CPQ step selections. They are complementary tools sharing the `cpq_drafts` document — **not** two copies of the same renderer.

The `cpq_flows` step contract (as written): `{ id, title, type (DROPDOWN|STYLE_SWAP|STATIC_FEE|DIMENSIONS|VISUAL_DIMENSIONS), dataSource, required, priceMap{}, geometryMap{optId→csv}, styleOptions[], mountSelector, mountPosition, isCenterClone, linkedItemId, linkedPinId, ... }`.

---

## 2. The mess, prioritized

### P0 — actual bugs

- **`nodes` vs `meshes` half-migration.** Current Node Grouping writes `nodes`; most consumers defensively read `cl.nodes || cl.meshes`, but **`InstructionsTab.js:40` reads `cluster.meshes` only** — so clusters created by the current tab won't animate in the Instructions tab. Either migrate old `meshes`→`nodes` everywhere and fix that line, or add the fallback there. (`AdminTab.js:451,1465,1542`, `CPQTab.js:1235,1260`, `VisualAssemblyTab.js:1235` all carry the fallback; InstructionsTab is the one that doesn't.)

### P1 — competing paths (the core "disaster")

- **Two live flow generators.** New tag generator `handleGenerateHardwareFlow` (`AdminTab.js:426`, button `:1019`) coexists with the **old** BOM-pin generators `handleAutoCreateFlowForAssembly` (`:650`, button `:1043`) + `handleAutoSyncBOM` (`:667`, button `:1259`). Both are wired to live buttons and produce differently-shaped flows. **This is the central confusion — decide which is canonical and retire/relabel the other.**
- **Three overlapping ways to record meshes on a step:** `step.geometryMap` (optId→CSV, the new model), `styleOptions[].targetNode` (CSV, duplicates geometryMap), and `step.targetNodes` (CSV, old). The old `handleAutoSyncBOM` writes `targetNodes` (`:689`); CPQ reads it only in one legacy finish branch (`CPQTab.js:1194`) and uses geometryMap/styleOptions everywhere else. Fields written by the old path are dead in the new path. **Standardize on `geometryMap` + cluster `nodes`.**
- **Two render paths inside CPQTab:** the 3D `DynamicModel` path (`:1608-1623`) and a legacy 2D texture-layer path `get2DRenderLayers` (`:1160-1186`, rendered `:1624-1638`) with its own z-stacking the 3D path ignores. **Decide if 2D is still needed; if 3D is the future, retire the 2D path.**
- **`linkedItemId` vs `linkedPinId`** — duplicate fields set together and kept in sync by hand; CPQ reads `linkedPinId` for quantity but `linkedItemId` for pricing/part (`CPQTab.js:657,666,740`). Collapse to one.

### P2 — dead code & rough edges

- **Dead file `NodeCluster.js`** (206 lines) — an old cluster studio using the `meshes` schema, imported nowhere (`HQ.js:11` loads `NodeClusterTab`). Delete it.
- **Category classifier duplicated 3×:** `classifyCategory` (`NodeClusterTab.js:80`), `classifyCat` (`AdminTab.js:436`), `catOf` (`AdminTab.js:439`) — slightly different (one handles "BACK-PLATE", the others don't). Consolidate into one shared helper.
- **`category` is write-once** — only settable in the Auto-Group panel (`NodeClusterTab.js:1094`), not editable on a saved cluster, and not shown in `regionLabel` (`:131`). Add an edit control + surface it.
- **Generated flows ship unpriced** — generator leaves `price: 0` / empty `priceMap` (`AdminTab.js:453,470`) and admits it with an alert (`:486`). Decide whether the generator should pull prices from the part's `basePrice`/`clientPricing` instead of forcing manual entry.
- **`handleAiGenerateRule` is a stub** (`AdminTab.js:749`) — `setTimeout` + string match, no model call, behind a live button (`:1787`). Remove or implement.
- **Redundant flow-id copies** in the Vision→CPQ draft: `linkedCpqFlowId` / `flowId` / `cpqFlowId` all the same value (`VisionHardware.js:801-803`), CPQ tries all three (`CPQTab.js:414`). Collapse to one.
- **Legacy/dead state** in AdminTab: `colGlobalFinishes`, `inhouseFinishes`, `floorRecipes` (`:64-66`) — redundant snapshots only spread into a dedup loop.
- **`visionConfigs` prop** passed to VisionHardware (`ClientVisionTab.js:173`) but never used.

> Note: there is **no `controlledNodes` field** anywhere — if any notes/prompts reference it, the real mechanism is `geometryMap` + cluster `nodes`.

---

## 3. Decisions to make before cleanup

1. **Canonical flow generator:** keep the new **tag-driven** `handleGenerateHardwareFlow` and retire the old BOM-pin generators? (Recommended — the tag model is what CPQ's visibility engine actually consumes.)
2. **Mesh field standard:** commit to `geometryMap` (+ cluster `nodes`), drop `targetNodes`/`styleOptions[].targetNode` duplication, and finish the `meshes`→`nodes` migration. Yes/no?
3. **2D render path:** retire `get2DRenderLayers` and go 3D-only, or is 2D still used for某 brands/products?
4. **Generated-flow pricing:** should the generator auto-populate prices from `basePrice`/`clientPricing`, or stay manual?

---

## 4. Suggested cleanup order (low-risk → higher)

1. Delete dead `NodeCluster.js`; fix `InstructionsTab.js:40` (`meshes`→`nodes` fallback). *(safe, immediate)*
2. Consolidate the 3 category classifiers into one shared util. *(safe)*
3. Pick the canonical flow generator; remove or clearly archive the other path + its button. *(the big de-confusion)*
4. Standardize mesh fields on `geometryMap`; remove `targetNodes`/`targetNode` writes; migrate old docs.
5. Collapse `linkedItemId`/`linkedPinId` to one; collapse the triple flow-id copies.
6. Decide 2D vs 3D render path; remove the loser.
7. Address generated-flow pricing + the `category` edit gap.

Each step is a clean, separately-reviewable commit. Do it on a branch off `feat/vision-dynamic-config`, build after each, and the existing data keeps working (consumers already tolerate missing/legacy fields).
