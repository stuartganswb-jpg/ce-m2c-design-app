# CPQ Hardware — Flow-Matrix Model (REVISED, supersedes the dynamic-flow approach)

**Why this rewrite:** the single flexible flow with runtime tag-driven hide/show (the `mountSelector` + AND-across-steps visibility in `CPQTab.js:1262-1308`) became too complex and fragile. We're replacing it with a generator that stamps out a **matrix of focused, pre-configured flows** — one per *mount × end-treatment*. Each flow is specific enough that visibility is essentially static, which removes the machinery that's been breaking. This is closer to how the older, better-behaving CPQs worked.

**Keep from before:** Stage 0 clean-slate + the **cluster inspector ("glow")** to verify node selection; default-select on load; bracket clone; pricing from `basePrice`.

**Decisions locked (owner):** tag-driven generation is canonical; standardize on `geometryMap` (optId→CSV) + cluster `nodes`; prices pull from component `basePrice` with a per-step override; the legacy 2D `get2DRenderLayers` path is left alone; one universal center bracket.

---

## The matrix (grounded in Vision's real parameters)

Axes, from `VisionHardware.js`:
- **Shape** (`engData.shape`): `STRAIGHT` now; `MITERED` (3-seg bay) and `BOW` as separate sets later.
- **Mount tier** (`engData.mount*`, values `OPEN|CEILING|INSIDE`): **Wall (OPEN) / Ceiling / Inside**. Maps to cluster `location` via `OPEN→WALL, CEILING→CEILING, INSIDE→END` (`CPQTab.js:601`).
- **End treatment** (`engData.endStyle`/`endStyleRight`, values `FLUSH|FINIAL|RETURN_MITER|RETURN_BEND`): **Finial / Miter-return / Bent-return**. `INSIDE` mount forces `FLUSH` (`VisionHardware.js:218`).

Straight-pole set to generate (~7 flows):

| Mount | End treatments |
|---|---|
| Wall (OPEN) | Finial, Miter-return, Bent-return |
| Ceiling | Finial, Miter-return, Bent-return |
| Inside (END) | Flush only |

Each generated flow stamps `fabShape='STRAIGHT'`, `fabEndStyle=<that end>`, and a new `mountTier` tag, and is **pre-filtered to that mount's clusters** (so no runtime mount hiding). `bracketMatchesMount` (`VisionHardware.js:281-289`) defines which brackets belong to each mount.

> Note: end-style is technically per-side (`endStyle` vs `endStyleRight`); current flows carry a single `fabEndStyle`, so generate **symmetric** flows and let in-Vision overrides handle the rare asymmetric job. Don't make projection a matrix axis — it's derived from the pinned bracket.

---

## Stage 0 — Clean slate + make grouping visible (DO THIS FIRST)

Unchanged and still first. The 3D view shows exactly the meshes in the selected cluster/option — wrong render = wrong grouping. You must be able to *see* groupings before generating anything.

- **0a. Reset:** "Clear all clusters" action (empties `nodeClusters` on the assembly's `Approved_Designs` doc) + delete old generated flows from `cpq_flows`. Never clear an assembly tied to a live quote.
- **0b. Cluster inspector ("glow") — highest value:** clicking a cluster in Node Grouping (and an option in CPQ) **highlights its exact meshes in 3D** (emissive/recolor its `nodes`, dim the rest), using the same sanitized matcher as render (`CPQTab.js:99-102`). This is what makes tagging trustworthy.
- **0c. Re-tag with the glow on:** group → verify highlight shows only intended meshes → tag category/location/position → save. Split any cluster that lights up extra/foreign meshes; split per-position where you need independent placement (this is the "backplates in wrong places" fix).
- **Acceptance:** every saved cluster highlights exactly its meshes, zero strays.

---

## Stage 1 — Flow-Matrix generator (the core change)

Add a **"Generate Flow Matrix"** action (evolve `AdminTab.handleGenerateHardwareFlow`, `AdminTab.js:426-488`): pick the assembly once, stamp out the ~7 focused flows. For each (mount, endTreatment):

1. **Pre-filter clusters to the mount.** Include only clusters whose `location` matches the mount tier (`OPEN→WALL`, etc.). The flow therefore contains *only* that mount's brackets/backplates — **no `mountSelector` step, no runtime location hiding.**
2. **Bracket options** = brackets passing `bracketMatchesMount` for that mount (so the Wall flow offers wall brackets, etc.).
3. **End-treatment geometry** = only the chosen end style's parts (finial meshes for Finial; miter/bend fee + geometry for the returns; nothing for Flush).
4. **Stamp** `fabShape`, `fabEndStyle`, `mountTier`, `linkedAssemblyId`; build per-option `geometryMap` from cluster `nodes`.
5. **Seed prices** from each part's `manufacturingSpecs.basePrice` (not `0`), leaving the per-step override.
6. Name flows clearly, e.g. `FLAT IRON — STRAIGHT · WALL · FINIAL`.

Result: each flow is small and specific. The fragile cross-step visibility is gone because the flow already only contains what belongs.

---

## Stage 2 — Per-flow render (now simple)

1. **Default-select required STYLE_SWAP steps on open** (first `styleOptions[].optId`) so the full default model renders immediately. (No mount default needed — mount is baked into the flow.)
2. Visibility reduces to: show the flow's clusters; **hidden-until-chosen only for genuine either/or swaps** within the flow (e.g. choosing between two wall-bracket styles). Keep `geometryMap`-per-option for those swaps; retire the `mountSelector`/AND-across-steps branch (`CPQTab.js:1273-1298`) once the matrix flows are in.
3. Verify each option with the Stage 0 glow: selecting it lights up exactly its meshes.

---

## Stage 3 — Vision auto-selects the matching flow

Replace the manual flow dropdown (`VisionHardware.js:872-873`) with automatic selection:
- From the job's `engData.{shape, mount*, endStyle}`, resolve the matching generated flow by `{fabShape, mountTier, fabEndStyle}`.
- Stamp that flow id into the `cpq_draft` (the existing `cpqFlowId`/`flowId`/`linkedCpqFlowId` — collapse to one); CPQ's resume already re-opens by id (`CPQTab.js:520-527`).
- This is the "pick a focused flow, then configure within it" model you described — now automatic.

---

## Stage 4 — Bracket count / center clone

Unchanged from prior analysis:
- Auto-select the single center bracket option on the `isCenterClone` step so `cloneSpecs` (`CPQTab.js:1268-1282`) always has a source.
- Count from `engineeringNotes.qtyCenterBrackets` via resume (`CPQTab.js:485-487`).
- Even spacing for v1; Vision `hangerLocations` for exact placement later.

---

## Stage 5 — Pricing

`basePrice` per component (seeded in the generator), `step.priceOverride` wins where set (`CPQTab.js:611,995`), client pricing applies per customer.

---

## Test path

1. Node Grouping: clear → re-group → **inspect each cluster's glow** → tag → Save.
2. AdminTab: **Generate Flow Matrix** → ~7 focused flows appear → confirm prices.
3. CPQ: open one flow (e.g. WALL · FINIAL) standalone → full default model renders → swap a bracket option → glow confirms correct meshes.
4. Vision: spec a wall/finial job → it auto-selects the WALL·FINIAL flow → Push to CPQ → model matches, brackets clone.
5. Pricing totals correct.

Branch off `feat/vision-dynamic-config`; one commit per stage; build after each.

---

## Cleanup this unlocks (from `CPQ_VISION_STATE.md`)

Retiring the dynamic-visibility model lets you also drop: the `mountSelector` runtime branch, the triple mesh fields (`targetNodes`/`styleOptions.targetNode` → keep only `geometryMap`), and the old BOM-pin generator. Do those as the matrix model proves out.

---

## Key code references

- Vision params: `VisionHardware.js:65-71` (engData), `:281-289` (bracketMatchesMount), `:138-179` (flow preset seeding), `:795-820` (draft payload).
- Mount→location map: `CPQTab.js:601`.
- Generator: `AdminTab.js:426-488`.
- Visibility (to simplify): `CPQTab.js:1262-1308`; clone: `:1268-1282`, `:139-172`; resume: `:407-527`.
- Clusters: `NodeClusterTab.js` (`nodeClusters` on `Approved_Designs`, positions via `:555`).
