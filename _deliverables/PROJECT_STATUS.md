# CE / M2C Design App — Project Status (handoff for v2b)

_Last updated 2026-06-13. All work below is **merged to `main` / in production** unless noted._

## What this app is
A CPQ-driven product-lifecycle app for curtain hardware (brands: **m2c** / Flat Iron, **ce** / Classical Elements + BRIMAR, uniquity, leyla). Pipeline:
**Inception** (upload `.glb`) → **Node Grouping / Auto-Group** (clusters) → **Visual Assembly / Auto-Assign BOM** (pins) → **CPQ Builder** (flows) → **CPQ Configurator** (quote) → **ERP push** → **RTG Dispatch** (SO import → auto-split) → **Finishing / Shop / Packaging** floors.

- **Architecture rule:** Vision = fabrication; CPQ = items/finishes. One CPQ flow per fabrication config.
- **DB:** Firestore (`ce-m2c-design-collab`). App reads live security rules — **any new collection needs a `firestore.rules` entry + `firebase deploy --only firestore:rules`** (CLI at `/usr/local/bin/firebase`, logged in via firebase-tools token; `npx firebase-tools` fails on npm-cache EACCES — use the global binary).
- **Build/deploy:** `CI=false npx react-scripts build`; push branch → Vercel preview; merge to main → prod (`4cosworkcenter.com`). Merges via GitHub API (gh CLI not installed). App Check debug token `d3b8f1a2-7c4e-4b9a-9f2d-1e6a5c8b0f33` lets PIN login work on previews.

## Flat Iron (M2C-ASM-6776) — state
- 28-pin BOM, 4 CPQ flows (WALL / CEILING / END / WALL-FINIAL).
- **Rod material in-flow choice:** step 1 = Rod Material (Wood/Metal, STYLE_SWAP, `hideQty`); step 2 = Pole Length & Finish (VISUAL_DIMENSIONS + master_finishes). Designer re-exporting the `.glb` to carry clean wood+metal geometry (geometryMap stubs ready).
- **Still TBD by user:** bracket/fee **pricing** ($0 today — but $0 physical parts now DO flow to BOM/packaging), 3 NetSuite **rollup items**, clone **Ceiling-Finial** flow, re-export `.glb` (wood/metal + finial geometry), confirm Wood/Metal finish lists.

## Reusable tooling shipped (works across collections)
- **Auto-Group / Auto-Assign BOM / Locate / per-flow Hide-Geometry / per-option projection.**
- **Per-component flat `.glb` + auto-thumbnail** (Visual Assembly "⚙ Generate Component Files"): isolates each cluster, lays it flat, exports `.glb` + PNG; stamps cluster `glbUrl`/`imageUrl` + part `componentGlbUrl`/`componentImageUrl` + `manufacturingSpecs.parametric.width/height`. Reusable in Packaging (foam trace) and as item images. **FI is generated; BRIMAR (CE-ASM-4025) is NOT.**
- **Flow builder legibility:** cluster thumbnails in STYLE_SWAP rows + Hide-Geometry + a "Configured Options" panel.
- **Visual Assembly:** Evil-Eye panel removed; clean 3D | cluster/BOM split; locate-highlight.
- **BOM Engine:** MAIN-assemblies only + "Capture Assembly Thumbnail".
- **Mass Update:** full filter header + selection-aware CSV export.
- **Master Library "Sync Thumbnails":** match image-less parts to `global_assets` by `<pattern>/<finish>` (handles EP1↔EP01).
- **Vision hanger placement-capture:** FIPBH (per bracket) / FIPBHS (per splice) positions → shop-floor BOM.

## Packaging engine — DONE (this session's focus)
Branch merged; full loop works end-to-end.
- **Standard boxes** (`standard_boxes`, seeded "Small Parts Box 18×12×4"), 3D dims, **rotate** control in the trace modal.
- **Push-to-packaging:** `autoSplitSalesOrder` writes `packaging_orders/PKG-<orderKey>` alongside fin+shop WOs; Packaging **inbox** reads pending orders.
- **Box split** (clickable cards): **poles → pole box**, **small parts → small box**.
  - **Pole** = the cut-to-length ROD only (`cutLength>0 || name~/pole length/`). NOT every fab-Custom part (backplates/brackets are Custom but pack small). Rod-Material config line + fees + `-ASM-` header excluded.
  - **Pole box:** length = pole + 1.25"; **french-return bends → 8"W** (else 1 pole → 3"W), 3"H. Foam = a side-extruded **cross-section with bores** (pole profile + 0.125" clearance; **auto-derived from the pole name**: round→circle, flat→rect).
  - **Small box:** 18×12 base, **true-silhouette nest** (traces each part's component `.glb`, 0.5" margin, parts <3" rotate). Parts w/o a glb → rect fallback. **Rings cut on their skinny side** (0.25"-thick slots) so many fit.
- **Supporting fixes:** `$0` physical parts now emit BOM lines; `packaging_orders` Firestore rule; packaging-doc serialization (drop raw cpqData + strip undefined); clearer auto-split error alert.

### How to test
Push an FI quote (enter a **pole length** on step 2!) → ERP push → RTG **Import & Auto-Split** → order lands in Packaging inbox → click **Pole Box** (bores) and **Small Parts Box** (silhouette nest). FI backplate/bracket have glbs → real silhouettes.

## ▶ NEXT SESSION — v2b (the only packaging piece left)
1. **FI bracket T-pairing:** an FI backplate + its bracket arm bolt together and ship as ONE **T/L-shaped** unit. Pack them as one combined footprint (union-trace the CPQ-paired clusters; grouping comes from the CPQ paired-step selections — method #3). BRIMAR already gets this free (bracket+backplate are one cluster).
2. **Ring geometry:** rings are finish-step lines (partId = a `FIN-` id) so they have no glb/footprint — currently a default 0.25×2.25 slot. Wire rings to their actual part (FIPR) geometry/OD so the slot length is exact.
3. Optional: per-material finish scoping on the rod (dropped when finish moved to step 2); manual push-to-floors should also create a packaging order (only auto-split does today); the NetSuite "dropped line" (BOM part with no NS item).

**Branch for next session:** start fresh off `main` (e.g. `feat/fi-packaging-v2b`).
