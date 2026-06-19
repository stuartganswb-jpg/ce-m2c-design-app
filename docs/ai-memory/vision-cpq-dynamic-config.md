---
name: vision-cpq-dynamic-config
description: "Vision Hardware as dynamic decision engine feeding CPQ — branch feat/vision-dynamic-config, O2O math, field maps, open O2O-freeze diagnosis"
metadata: 
  node_type: memory
  type: project
  originSessionId: 16514794-a0fe-4468-ad5a-b6fab28bf535
---

**SHIPPED to production 2026-06-14** — branch **feat/vision-dynamic-config** fast-forward-merged to main at commit **0badce7** (main was strictly behind, nothing lost; branch retained). Vercel auto-deploys main → 4cosworkcenter.com (PIN-gated, see [[prod-appcheck-pin-login]]). Builds via `CI=true npm run build` (eslint disabled in build via DISABLE_ESLINT_PLUGIN, so exhaustive-deps does not fail CI). Preview-first always — see [[no-regressions-ask-first]].

**Goal:** Make Vision Hardware the dynamic decision engine for complex jobs while keeping a CPQ-only path for simple orders (an 8ft pole skips Vision). Collapse many baked CPQ flows into ~3 dynamic ones (straight / mitered / bow bay); end style + brackets are chosen in Vision, not baked per-flow. Builds on [[cpq-vision-architecture]] + [[cpq-builder-status]].

**Vision decision flow** (shape default STRAIGHT): shape → Mount L/R → narrowed brackets → independent Left/Center/Right brackets + Left/Right backplates → backplate ½-dim feeds O2O → per-side End Style → Auto-Place Brackets button → snap 1/8".
- Mount→bracket mapping **LOCKED**: open→wall, ceiling→ceiling, inside→inside.
- Auto-place: center bracket when span >36", spaced so no gap >54", editable; end brackets 2"–6" in from pole end, EXCEPT return brackets which sit at 0" (flush) and add to O2O. Snap all placements `Math.round(x*8)/8`.

**Library field maps** (manufacturingSpecs): `customData.bpOrientation` VERTICAL|HORIZONTAL|SQUARE|ROUND (BACKPLATE only), `customData.isReturnBracket` bool, `customData.armThickness` in (shown when isReturnBracket; e.g. 0.5" flat-iron), `parametric.length/width/height/fixedDiameter`. Metadata editors in LibraryTab.js + BOMTab.js (with helper text); bulk via LibraryMassUpdateTab.js (CSV cols Backplate Orientation/Is Return Bracket/Backplate L/W/H/Bracket Arm Thickness + master dictionary `backplateOrientations`).

**O2O math** (VisionHardware.js ~315–394):
- `isLeftInside/isRightInside = (shape==='STRAIGHT' ? mountLeft/mountRight : mountOuter) === 'INSIDE'`
- `imDeduct = inside ? insideMountDeduct(0.25) : 0`
- `endAddL = isLeftInside ? 0 : (isRetBkt(bracketId) && backplateIdLeft ? bpEndHalf(backplateIdLeft)+armThk(bracketId) : bracketW/2)` — same for R with bracketIdRight/backplateIdRight (`o2oRightBktId`/`o2oRightBpId`).
- `bpEndHalf(bp)`: orientation H→½length, R→½(fixedDiameter||width), else ½width.
- `totalSystemO2O = poleO2O + endAddL + endAddR`. Plain job unchanged (½+½ = bracketW).

**Key effects** (all guarded `return changed?next:prev`; deps use stable refs — libraryParts is local useState, activeFlow is cpqFlows.find so stable):
- L137 auto-detect: seeds proj/endStyle/shape from flow fab preset (authoritative) or pin detection. deps [activeFlow, flowPins, libraryParts].
- L180 dynamicConfig sync: bracketId → dynamicConfigParams[bracketStep.id].
- L186 dim-sync: bracketId → proj/bracketW/bracketThickness from bracket.
- L214 end-style combined (added 0badce7): each side INSIDE→FLUSH, else isReturnBracket→RETURN_MITER, else leave manual/preset. deps [bracketId, bracketIdRight, mountLeft, mountRight, mountOuter, shape, libraryParts].
- L232 per-option proj.

**UI anchors** VisionHardware.js: shape select 889; mount selects 899/902 (mountLeft/Right, STRAIGHT) vs 907 (mountOuter, non-straight); brackets L935 / R943 / C950; backplates L962 / R969; IM Deduct 1008; **Client Details & Ordering panel 1310–1325 uses LIVE poleO2O/totalSystemO2O** (only when `viewMode==='ENGINEERING' && !showQuotePanel`).

**RESOLVED — the reported "O2O freeze after first entry" was a stale browser cache on the user's side, not a code bug** (confirmed working after a hard refresh on 0badce7). Both symptoms were also logical:
- Symptom "right backplate didn't move O2O" = **logical, not a bug**: endAddR uses the right backplate only when bracketIdRight is itself a return bracket. Same-as-left mirroring was removed (user asked), so the Right return bracket must now be selected explicitly.
- Symptom "inside mount didn't move O2O" = pre-0badce7 it moved only 0.25" (imDeduct); 0badce7 gates endAdd→0 for inside (drops full backplate+arm) and auto-flips inside end to FLUSH → now clearly visible.
- Wiring/refs were all correct (no max-update-depth); the panel uses live values. Lesson: when "data won't update" on a Vercel preview but the code is provably correct, suspect a **stale browser cache / service worker** first — a hard refresh fixed it here.

**CPQ flow builder (AdminTab.js → Firestore `cpq_flows`)** — building the Flat Iron configurator as the reusable template (copy + swap .glb/BOM per collection). Existing FI flows backed up in `_deliverables/flow_backups/FLOW-FI-{WALL,WALL-FINIAL,CEILING,END}.json` (Firestore export format — decode typed values). All `brand=m2c`, fabShape STRAIGHT (⚠️ old asm `M2C-ASM-6776` was NUKED 2026-06-13 — link flows to the live FI assembly fresh, never hardcode an assembly id; see [[flat-iron-3flow-build]]); today split 4 ways by mount×endstyle (collapsing to fewer dynamic flows is the goal). Shared 6-step skeleton: Pole(VISUAL_DIMENSIONS finish+len) → End Bracket & Wall Plate(STYLE_SWAP, backplate geometryMap show-selected/hide-others) → Add Center Passing Bracket(STYLE_SWAP qty) → Splice → [L/R Finial] → Ring(DROPDOWN) → Cut/Splice Fee(STATIC_FEE). Backplate parts: 54254/53061 Vertical, 53060/53062 Horizontal (map to Vision bpOrientation); center arms 55171 Wall / 55172 Ceiling.
- **Fab preset** (AdminTab ~960–982): Bay Config + End Style + Bracket Projection, now 1:1 with Vision (added FLUSH option). Seeds Vision via auto-detect effect.
- **Finishes topology (4 stores + floor):** in-house master = `system/master_finishes` doc `.finishes[]` (synced copy); outsourced = `hq_outsource_finishes` col; legacy `hq_global_finishes`/`hq_inhouse_finishes` cols (read-only, no writers). Source of truth for in-house = **Finishing Floor `fin_recipes` col (keyed by code)** → pushed to master via `handleSyncFloorRecipes` in LibraryMassUpdateTab (DON'T break). AdminTab CPQ picker (`getDataSourceItems('master_finishes')`) now unions all stores **+ live fin_recipes**, deduped by code — fixes unsynced finishes (e.g. MEP) not appearing.
- **Center-bracket cloning (rendering, commit 6084a7e):** step flag `isCenterClone` (checkbox on STYLE_SWAP in builder). CPQTab builds `cloneSpecs` {meshNames from step.geometryMap[selectedOpt], count from stepQuantities[stepId]}; `DynamicModel` clones the one middle bracket N times spaced along the model's LONGEST axis (no pole cluster needed), hides the original, try/catch graceful. Clusters are `{id,name,meshes}` (no category/position fields — identify by name). Center count also pushed from Vision (draft.specs.engineeringNotes.qtyBrackets).

**ARCHITECTURE DECISION (user-confirmed):** fab preset locks ONLY the Bay Config (shape) — leave End Style = auto-detect + Projection blank. So **3 flows by shape (Straight/Mitered/Bow)**, NOT one per end-style/mount. Mount + end style + brackets + backplates + center count are all dynamic. The **bay config is the hinge**: picking the flow = picking the shape; Vision and the flow are two views of one line config. Complex job → configure in Vision → Push pre-fills the flow's steps; simple job → use flow steps directly (skip Vision). The "show selected/hide others" geometryMap (already works on the backplate step) replaces the old static per-flow `hiddenClusters`, letting one flow carry all mounts.

**Vision→CPQ pre-fill (commit 4dda655):** CPQTab `handleResumeDraft` now pre-selects each choose-swap step by matching `step.styleOptions[].partId` to the parts Vision chose, read from `draft.spatialData` (bracketId/bracketIdRight/bracketIdCenter/backplateIdLeft/backplateIdRight) — config-agnostic, no hard-coded step ids. `isCenterClone` steps get the CENTER count: Vision now pushes `engineeringNotes.qtyCenterBrackets` (attachments noted 'Center'); resume falls back to qtyBrackets−2. NOT YET: end-style→end-treatment-step pre-fill (endStyle isn't a partId — needs a convention once the end-treatment step exists).

**TAG-DRIVEN FLOW ENGINE (the pivot — hand-wiring pins was too confusing for employees; flows now build from Node-Grouping tags):**
- **Node Grouping tags** are the source of truth: cluster `.category` (BRACKET/POLE/FINIAL/BACKPLATE, from classifyCategory(productType)), `.location` (WALL/CEILING/END), `.position` (LEFT/CENTER/RIGHT). NodeClusterTab.js now has per-cluster LEFT/CENTER/RIGHT **position buttons** (handleSetClusterPosition) beside the WALL/CEILING/END location buttons; tag writes getDoc-before-write so a 2nd tab/rapid clicks can't clobber.
- **Visibility = AND-across-steps + hidden-until-chosen** (CPQTab `visibilityOverrides`): a node renders only if EVERY step listing it has the current selection include it, keyed per-node (not the comma list). Unselected step contributes nothing → full assembly hides until chosen and builds up as the customer picks; a Vision-pushed draft arrives fully selected so it renders complete. This solved one-or-other (skip a step = its geometry stays hidden), alternatives double-showing, and mount×type intersection.
- **Tag-driven Mount step** (`step.mountSelector` + optional `step.mountPosition` LEFT/RIGHT): options auto-fill from distinct cluster `.location` (Wall/Ceiling/Inside); picking one hides every end cluster of the OTHER locations. Builder checkbox; needs no partHandling/dataSource. Vision push pre-fills it (OPEN→WALL, CEILING→CEILING, INSIDE→END).
- **⚙ Generate Flow from Tags** (AdminTab `handleGenerateHardwareFlow` + stand-alone assembly picker): one click reads a tagged assembly's clusters+pins, groups by Category+part (unioning each part's placement nodes into ONE option, optId = short cluster id — Firestore caps map keys at 1500 bytes so the raw mesh CSV could NOT be the key; mesh list is the VALUE), stamps the 10 standard steps fully wired, creates a NEW "<asm> — GENERATED" flow. Symmetric ends for now (per-side asymmetry = follow-up). Untagged clusters aren't controlled → always visible (that was the "objects I can't hide").
- **Import/Export Flow (JSON)** in builder; stripUndefined on all cpq_flows writes (Firestore rejects undefined); save errors now show the real Firestore message. Template: `_deliverables/flow_backups/FLOW-FI-STRAIGHT-TEMPLATE.json` (11 steps, unlinked, hidden-until-chosen).

**Status:** f8664ca on PROD. feat/vision-dynamic-config far ahead (HEAD ~0063a14) — NOT merged; all the tag-driven engine + generator + visibility rework is preview-only, iterating live with user on the Flat Iron flow. **Next:** user runs Generate Flow from Tags on Flat Iron → report counts (gauges tagging completeness) → fix gaps → verify the configurator renders/hides correctly → then per-side asymmetry, end-treatment pre-fill, Duplicate-Flow; merge to main on user OK.
