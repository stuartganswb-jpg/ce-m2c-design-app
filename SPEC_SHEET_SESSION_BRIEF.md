# Spec sheet — its own session

Paste into a fresh session. Written to be read cold.

One job: **the spec-sheet renderer in BOM Engine (tab 3) is nowhere near correct.** Part 1 is how
this app ships, because not knowing it costs an evening. Part 2 is the sheet.

Read `CLAUDE.md` too — ship workflow and the multi-session git rules.

---

# 1 · How this app ships

## Vercel — the frontend

Pushing to `main` auto-deploys to production. There is no staging step.

```
rm -f .git/index.lock
git add <only your files> && git commit -q -m "..."
git pull --rebase --autostash origin main
git push origin main
```

Then Stuart must **hard-refresh (⌘⇧R)** — the old bundle is cached.

⚠ **THE STALE-BUILD TRAP.** A deploy can report "Ready" with the right commit hash and a fresh
`version.json`, and still serve OLD code: Vercel compiles a stale checkout. No amount of pushing
fixes it. The fix is the Vercel dashboard → ce-m2c-design-app → Deployments → top row ⋯ →
**Redeploy with "Use existing Build Cache" UNCHECKED**.

So when a shipped change "does nothing" on prod, check WHAT IS SERVED before debugging the feature:

```
curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js'
```

Two things make that check lie:

- **The app is CODE-SPLIT.** Tab code — including all of `SpecSheet/` — never appears in
  `main.*.js`. Extract every chunk map from the main bundle (there are several; sweeping only the
  first has false-negatived before), then grep the `static/js/<id>.<hash>.chunk.js` files.
- **Pick a marker that survives minification.** A local variable name is renamed, and a non-ASCII
  character may be unicode-escaped. Grep for a plain-ASCII string literal a user would see.

## Cloud Shell — the Firebase Functions

**Vercel does not deploy functions.** `functions/index.js` (NetSuite proxy, PIN auth, the portal
endpoints) deploys only from Google Cloud Shell — `firebase login` fails on Stuart's Mac.

At https://shell.cloud.google.com:

```
git pull
firebase deploy --only functions:netsuiteProxy --project ce-m2c-design-collab
```

The spec sheet needs none of this. It matters only if you touch `functions/` — and if you do, say
plainly that it needs a Cloud Shell deploy, because it will otherwise silently not take effect.

## App Check — why no script can touch the data

Firestore enforces App Check, so **no local or Node script can read or write production data**.
Bulk data changes are made INSIDE the authenticated app — build an admin button. Do not offer to
"just run a quick script"; it cannot work.

This bites the spec sheet directly: you cannot pull a real GLB or a real pin set locally. What you
CAN do is drive the live app through Claude-in-Chrome (Stuart pins a browser in), and read anything
you like from the running page. That is how today's diagnoses were made.

## Verifying your own work

- `node scripts/<name>.test.mjs` — the engine suites are pure and fast. **Add to them.**
  `scripts/specSheetRows.test.mjs` is the one that matters here (19 assertions, all green).
- `npx --no-install eslint <path>` — 0 errors required; pre-existing warnings are fine.
- `CI=false npx --no-install react-scripts build` — the real compile check, ~1–2 min.
- **Prove a new test is worth having**: break the code it covers, watch it fail, restore. Every
  assertion added in this codebase recently has been falsified that way before being trusted.

---

# 2 · The spec sheet

## The verdict

Stuart, 2026-08-21, after three rounds of fixes: *"i think we may want to trash the entire tool and
start over?"* — and 2026-08-22: *"still nowhere near correct."*

The answer is still **the page composer, not the tool**. The projection maths, the mesh extraction,
the hidden-line work, the page frame and the PDF output are all fine. What fails is layout.

## The target

`Dropbox/Production/D and E 2025/Spec Drawings/0.75in collection/combined brackets with exposed
fasteners/0.75 French Return, support arm, screw backplates Drawing v3.pdf` — Stuart will send newer
ones as the designer finishes. Read it as a TABLE:

| | column 1 | column 2 | column 3 |
|---|---|---|---|
| row per arm+plate | plate + arm + rod + ring, side elevation, dimensioned | BENT RETURN | Passing Support Arm |

Each cell is **its own small drawing: independently scaled**, with its own dimensions and its own
leader-lined part code. Rows are labelled by arm code (`H1-75RBP-H`, `-R`, `-S`, `-V`). A title
block sits top left; a note explains the key dimension ("height from the centre of the top centre
hole of the back plate to the bottom of the ring").

## The module, as it stands

| file | lines | verdict |
|---|---|---|
| `SpecSheetModal.js` | **1246** | the monster — UI, source registry, `buildRows`, and the composition half |
| `specSheetPage.js` | 255 | **the defect lives here** — `place`, `columnScale`, `buildPageSvg` |
| `specSheetGeometry.js` | 205 | KEEP — `groupBbox`, `extractWorldMeshes`, `inferAxes`, `makeViews`, fraction text |
| `hiddenLine.js` | 192 | KEEP — 3D → hidden-line 2D. The hard maths, and the line work is clean |
| `specSheetRows.js` | 143 | KEEP — asks the tag engine what goes on a page. Node-tested |
| `specCellCheck.js` | 79 | KEEP — per-cell warnings |
| `specSheetOutput.js` | 76 | KEEP — PDF/print |

## ⚠ THE ACTUAL DEFECT — this corrects the previous brief

The earlier brief said *"nothing measures a drawing's extents before positioning it."* **That is
wrong, and building on it would waste the session.** Measurement already exists and works: every
view carries a bounding box `zb`, and `place()` centres on it correctly.

The real fault is in `specSheetPage.js`:

```js
// specSheetPage.js:94 — ONE scale for a whole COLUMN, taken as the tightest fit across ALL rows
function columnScale(rows, key, rowH) {
  let s = Infinity;
  for (const r of rows) s = Math.min(s, maxW / (zb.maxU - zb.minU), (rowH - inset) / (zb.maxV - zb.minV));
  return Math.min(s, SCALE_1TO1);
}
const COL_FIT = { detail: 130, front: 430, code: 660, profile: 890 };  // fixed x centres
const rowH = (P.H - 2 * MARGIN - 90) / Math.max(rows.length, 1);       // equal row heights
```

Three consequences, and they are the whole bug:

1. **The largest part in a column shrinks every other row in it.** One long rod and every plate on
   the page is drawn tiny.
2. **Columns sit at fixed x centres with fixed widths** (`BOX_FIT`), so a wide cell has nowhere to
   go and a narrow one leaves a hole.
3. **Rows are equal height** in fit mode regardless of content.

The reference does the opposite: **one cell = one independently scaled drawing.** So the work is not
"add measurement" — it is to move the unit of scaling from the column to the cell, and let row
heights and cell widths follow content.

## The renderer, in the order I would build it

1. **Scale per cell, not per column.** Each cell computes its own scale from its own `zb` and its
   own box, capped at `SCALE_1TO1`. This one change is most of the visible fix.
2. **Lay the grid out from content.** Row height = the tallest cell in that row; column width = the
   widest cell in it. Fixed `COL_FIT` / `BOX_FIT` constants go away.
3. **Rows from `sheetRows()`.** One row per arm; the plates come with it. A basic arm's row has no
   plate — that is the engine's answer, not a missing drawing.
4. **Dimensions per cell**, from the geometry, at 1/16". The reference dimensions: plate width and
   height, arm projection, rod diameter, and the plate-hole-to-ring-bottom height the note calls out.
5. **Columns for the fixed details** — bent return, passing support arm — repeated per row.

Also delete, once it draws: the per-cell source registry (`sizeSources`, `srcState`,
`showSrcPicker`), `legacyChoicesFor` name-sniffing, and the pole fallbacks in `buildRows`. All of it
exists because the ORIGINAL sizes were never tagged. H1-138, H1-2TRV and now H1-1 are tagged, and
the untagged assemblies are being retired.

## Traps that have already cost time

- **`resolve()` normalizes what it is handed**, and normalizing an already-normalized choice drops
  the projection tag. Pass RAW pins to `resolve()`, and the model's own `choices` to `slots()`.
- **A const is not hoisted.** A hook whose dependency array names something declared further down
  throws "Cannot access X before initialization". It took the CPQ engine out twice on 2026-08-21.
- **The GLB is a MERGED SALES model**, not a spec layout: every option is in it, stacked. Draw only
  `visibleNodesForRow()`.
- **Prefer `manufacturingSpecs.specCadUrl`** — the 1.6 "Spec Sheet Layout (📐)" slot, a flat,
  code-named "Spec · true m" export that needs no unstacking. The modal already prefers it. The
  merged-model path is exactly what broke H1 before 2026-07-14, and the modal shows an amber hint
  when it is being used.
- **Units.** Merged sales GLBs export in PRODUCTION inches; spec layouts in true metres. The loader
  measures the scene (extent > 10 units = inches → ×0.0254). Don't re-derive this.

## What changed on 2026-08-22 that helps you

- **H1-1 is now correctly tagged** — rear finials freed from a wrong 3.25" projection gate, rear rod
  tiered BACK. So you have a second tagged assembly to test against, not just H1-138.
- **A new tag note, "NOT ASKED"**, reports any axis the engine answers silently because only one
  value is tagged. Worth reading on whatever assembly you open — it catches the class of fault where
  a part is quietly excluded and the screen looks fine.
- `specSheetRows.js` is the layer that asks the engine rather than deciding: `sheetRows()` gives
  arm→plates by the SAME `slots()` call the CPQ makes, `rodForArm()` picks the rod that arm holds,
  `visibleNodesForRow()` gives exactly that combination's nodes. It is tested and it works. **Do not
  rewrite it** — the composer is what is broken.

## Definition of done

Open H1-138 from BOM Engine tab 3, pick a bracket arm, and get a sheet that prints at 1:1 on 11×17
and reads like the reference: one row per combination, nothing overlapping, **every cell at its own
scale**, every part labelled with its own code and dimensioned from its own geometry. Then H1-2TRV.
