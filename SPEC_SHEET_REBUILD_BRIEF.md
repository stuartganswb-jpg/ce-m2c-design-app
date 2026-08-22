# Spec sheet renderer — rebuild brief

Paste into a fresh session. Written to be read cold. **This is a rebuild of the RENDERER, not the
tool.** Read `CLAUDE.md` first for the ship workflow and the multi-session git rules.

## The verdict

Stuart, 2026-08-21, after three rounds of fixes: *"i think we may want to trash the entire tool and
start over?"* — the answer is the page composer, not the tool. The projection maths, the mesh
extraction, the page frame and the PDF output all work. What fails is placement: nothing measures a
drawing's extents before positioning it, so parts land on top of each other at unrelated scales.

## The target

`Dropbox/Production/D and E 2025/Spec Drawings/0.75in collection/combined brackets with exposed
fasteners/0.75 French Return, support arm, screw backplates Drawing v3.pdf` — and Stuart will send
newer ones as the designer finishes. Read it as a TABLE:

| | column 1 | column 2 | column 3 |
|---|---|---|---|
| row per arm+plate | the plate + arm + rod + ring, side elevation, dimensioned | BENT RETURN | Passing Support Arm |

Each cell is its own small drawing: independently scaled, its own dimensions, its own leader-lined
part code. Rows are labelled by the arm code (`H1-75RBP-H`, `-R`, `-S`, `-V`). A title block sits top
left; a note explains the key dimension ("height from the centre of the top centre hole of the back
plate to the bottom of the ring").

## What to keep, unchanged

| File | Why |
|---|---|
| `SpecSheet/hiddenLine.js` | 3D → hidden-line 2D. The hard maths, and the line work in the current output is clean. |
| `SpecSheet/specSheetRows.js` | WHAT goes on a page. New, node-tested (`scripts/specSheetRows.test.mjs`), and it asks the tag engine rather than deciding: `sheetRows()` gives arm→plates by the SAME `slots()` call the CPQ makes; `rodForArm()` picks the rod that arm holds; `visibleNodesForRow()` gives exactly that combination's nodes. |
| `SpecSheet/specSheetOutput.js` | PDF/print. |
| The page frame | Border, A–D / 1–8 zones, scale note. Already matches the reference. |

## What to replace

`SpecSheet/specSheetPage.js` + the composition half of `SpecSheetModal.js` (`buildRows`,
`buildPageSvg`, the ring/carrier detail strip). Everything that positions geometry.

Also delete, once the new renderer draws: the per-cell source registry (`sizeSources`,
`srcState`, `showSrcPicker`), `legacyChoicesFor` (name-sniffing), and the three pole fallbacks in
`buildRows`. All of it exists because the ORIGINAL sizes were never tagged; H1-138 and H1-2TRV are
tagged, and the untagged assemblies are being retired.

## The renderer, in the order I would build it

1. **Measure, then place.** Project each part group to 2D, take its bounding box, THEN choose the
   cell scale and origin. The current composer places first and hopes. Every overlap in Stuart's
   screenshots is this.
2. **One cell = one part group.** A cell knows its own extents, so a plate and a rod can sit in the
   same row at different scales, exactly as the reference does.
3. **Rows from `sheetRows()`.** One row per arm; the plates come with it. A basic arm's row has no
   plate — that is the engine's answer, not a missing drawing.
4. **Dimensions per cell**, from the geometry, at 1/16". The reference dimensions: plate width and
   height, arm projection, rod diameter, and the plate-hole-to-ring-bottom height that the note
   calls out.
5. **Columns for the fixed details** — bent return, passing support arm — repeated per row.

## Traps that have already cost time

- **`resolve()` normalizes what it is handed**, and normalizing an already-normalized choice drops
  the projection tag. Pass RAW pins to `resolve()`, and the model's own `choices` to `slots()`.
- **A const is not hoisted.** A hook whose dependency array names something declared further down
  throws "Cannot access X before initialization". It took the CPQ engine out twice on 2026-08-21.
- **The GLB is a MERGED SALES model**, not a spec layout: every option is in it, stacked. Draw only
  `visibleNodesForRow()` — the whole point of the tag engine is that it answers this.
- **1.6 can supply a purpose-built spec GLB** (`manufacturingSpecs.specCadUrl`, the "Spec · true m"
  export). Where one exists it is flat and code-named and needs no unstacking. Prefer it.

## Definition of done

Open H1-138 from BOM Engine tab 3, pick a bracket arm, and get a sheet that prints at 1:1 on 11×17
and reads like the reference: one row per combination, nothing overlapping, every part labelled with
its own code and dimensioned from its own geometry. Then H1-2TRV.
