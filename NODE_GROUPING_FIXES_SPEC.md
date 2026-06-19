# Node Grouping (Tab 1.5) — Two Fixes Spec

Both fixes are contained to `src/components/HQ/NodeClusterTab.js`. Goal: make LEFT/RIGHT consistent across every assembly (for training), and keep the 3D locate tool usable on long (20+ part) BOMs.

---

## Fix 1 — LEFT/RIGHT must match the screen, not the model's authored orientation

**Problem:** Auto-Group assigns LEFT/CENTER/RIGHT by sorting parts along the model's **longest world axis** — lowest coordinate = LEFT (`NodeClusterTab.js:569-575` picks `axis`; `:587-593` `positionLabel` sorts `center[axis]` and labels idx 0 = LEFT). This has no notion of which way the model faces the camera. M2C "Flat Iron" is authored so low-coordinate = screen-left (correct); CE "BRIMAR SIGNATURE" is mirrored/rotated, so low-coordinate = screen-**right** → labels come out flipped. It's model orientation, not bad data.

**Fix A — order by screen direction (root cause).** The viewer camera is fixed at `[5,5,5]` looking at origin (`:946`), so "screen-right" is a constant world direction. Order parts left→right by their projection onto that direction instead of the raw dominant axis, so "left on screen" is always LEFT for every model.

- Compute screen-right once from the camera: with camera `(5,5,5)` → origin, up `(0,1,0)`, screen-right ≈ `(1, 0, -1)` normalized. (If the camera position is ever changed, recompute from it rather than hardcoding.)
- In `positionLabel` (`:587-593`), replace `sort((a,b) => a.center[axis] - b.center[axis])` with a sort by `proj(center) = center.x*rx + center.y*ry + center.z*rz` (the dot with screen-right). Keep the idx→LEFT/CENTER/RIGHT mapping.
- The `axis`/`spread` block (`:569-575`) can stay for the `eps` overlap math (`:614`); only the ordering key changes.

**Fix B — per-assembly "Flip L/R" override (safety net).** For any oddball model that still disagrees:
- Add `nodeOrientationFlip: boolean` to the assembly's `Approved_Designs` doc.
- Add a small **"Flip L/R"** toggle in the Auto-Group panel header (near the SPLIT BY POSITION control) that persists it (`updateDoc(... { nodeOrientationFlip })`).
- In `positionLabel`, when the flag is set, reverse the order (or swap LEFT↔RIGHT after labeling). Applies on re-run and to the live re-tag.

**Acceptance:** Flat Iron and BRIMAR (and any future assembly) both label the on-screen left side LEFT, with the same view, no manual per-cluster fixing. The existing per-cluster L/C/R buttons (`:1035`) remain as a last-resort manual override.

**Immediate workaround (no code):** until this ships, fix BRIMAR by clicking the L/C/R buttons under each saved cluster (`:1035`) to flip the mislabeled ones.

---

## Fix 2 — Keep the 3D locate viewer in view while scrolling a long BOM

**Problem:** The viewer and the cluster/BOM list are a two-column flex row (`NodeClusterTab.js:883`: `display:flex; gap:24px; minHeight:600px`), with the 3D viewer at `flex:1.8` (`:886`) and the cluster list as the sibling column (~`:1010+`). On a BOM with 20+ parts the list column grows tall, the whole row grows, and the **page scrolls the viewer off-screen** — so you can no longer see or drag the model, defeating the locate/glow button mid-list.

**Fix — peg the viewer, scroll the list independently** (owner's option 2; cleaner than floating). In the two-column row:
- **Viewer column** (`:886`): make it stay put — `position: sticky; top: <header offset, e.g. 90px>; align-self: flex-start; height: calc(100vh - <offset>); max-height: calc(100vh - <offset>)`. Keep `overflow: hidden` (Canvas fills it).
- **Cluster/BOM list column** (the sibling, ~`:1010`): give it its own scroll — `max-height: calc(100vh - <offset>); overflow-y: auto` — so it scrolls internally while the viewer stays pinned beside it. (Alternatively let the page scroll and rely on the sticky viewer; the bounded-list version keeps both aligned and avoids a giant page.)
- Ensure the row's parent doesn't `overflow: hidden` in a way that breaks `sticky`.

**Acceptance:** with a 20+ part BOM, scrolling the binding list keeps the 3D model fully visible and draggable, and the locate/glow stays usable for every row. Both columns stay aligned.

---

## Build notes
- One change to `positionLabel` + one small flag/toggle (Fix 1), one layout change to the two-column row (Fix 2). No data migration; existing saved clusters keep their `position` until Auto-Group is re-run or buttons are used.
- Test on M2C "Flat Iron" (should stay correct) and CE "BRIMAR SIGNATURE" (should now read left=LEFT), plus one 20+ part BOM for the scroll behavior.
