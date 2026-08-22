# Next session — new CPQ flow, spec sheet renderer

Paste into a fresh session. Written to be read cold. Two jobs plus the operating rules:

1. **A new CPQ flow** for another assembly, on the tag engine (part 2 below)
2. **The spec sheet renderer**, rebuilt (part 3)

Read `CLAUDE.md` too — it carries the ship workflow and the multi-session git rules.

---

# 1 · How this app ships, and what will waste your day if you don't know it

## Vercel — the frontend

Pushing to `main` auto-deploys to production. There is no staging step and no build to run by hand.

```
rm -f .git/index.lock
git add <only your files> && git commit -q -m "..."
git pull --rebase --autostash origin main
git push origin main
```

After it deploys, Stuart must **hard-refresh (⌘⇧R)** — the old bundle is cached.

⚠ **THE STALE-BUILD TRAP.** A deploy can report "Ready" with the right commit hash and a fresh
`version.json`, and still serve OLD code: Vercel compiles a stale checkout. No amount of pushing
fixes it. The fix is the Vercel dashboard → ce-m2c-design-app → Deployments → top row ⋯ →
**Redeploy with "Use existing Build Cache" UNCHECKED**.

So when a shipped change "does nothing" on prod, check WHAT IS SERVED before debugging the feature:

```
curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js'
```

Two things that make that check lie:
- **The app is CODE-SPLIT.** Tab code (CPQ, Library, Admin…) never appears in `main.*.js`. Extract
  every chunk map from the main bundle — there are several, sweeping only the first false-negatived
  once — then grep the `static/js/<id>.<hash>.chunk.js` files.
- **Pick a marker that survives minification.** A local variable name is renamed and a non-ASCII
  character may be unicode-escaped. Grep for a string literal that a user would see.

## Cloud Shell — the Firebase Functions

**Vercel does not deploy functions.** `functions/index.js` (the NetSuite proxy, PIN auth, the portal
endpoints) deploys only from Google Cloud Shell — `firebase login` fails on Stuart's Mac (the
localhost callback never returns).

At https://shell.cloud.google.com:

```
git pull
firebase deploy --only functions:netsuiteProxy --project ce-m2c-design-collab
```

Name the function you changed. If you edit `functions/`, say plainly that it needs a Cloud Shell
deploy — it will silently not take effect otherwise.

## App Check — why no script can touch the data

Firestore enforces App Check, so **no local or Node script can read or write production data**
(permission-denied, always). Bulk data changes are made INSIDE the authenticated app — build an
admin button. Do not offer to "just run a quick script"; it cannot work.

Same reason the NetSuite proxy rejects unauthenticated SuiteQL. To diagnose a push: the RTG NetSuite
Transmit Log (click a row for the full error + sent payload), tab 11.1 → NetSuite Sync Queue, or ask
Stuart for a screenshot.

## Verifying your own work

- `node scripts/<name>.test.mjs` — the engine suites are pure and fast. **Add to them.** Every fix
  today that mattered has an assertion phrased as Stuart's own sentence.
- `npx --no-install eslint <path>` — 0 errors required; pre-existing warnings are fine.
- `CI=false npx --no-install react-scripts build` — the real compile check, ~1–2 min.
- To prove a test is worth having: `git show HEAD:<file> > <file>`, run it, watch it FAIL, restore.

---

# 2 · Starting a CPQ flow for a new assembly on the tag engine

## What the engine actually reads

**Pins in 1.6, and the assembly's node clusters. Not flow steps.** `Shared/hardwareAdapter.js` turns
one pin + its cluster into one tagged CHOICE; `Shared/hardwareModel.js` turns choices + answers into
the questions, the options, the BOM and the visible geometry. The flow doc carries ordering, labels,
prices and settings — never which options exist.

That is the whole point: a corrected tag takes effect immediately, with nothing to regenerate.

## The tags that decide behaviour (all set per pin in 1.6)

| Tag | What it does |
|---|---|
| cluster category / `catOverride` | the ROLE — rod, bracket, backplate, finial, ring, return… |
| `endTreatment` | FINIAL / FRENCH_RETURN / MITER_RETURN / INSIDE_MOUNT — a return replaces that end's bracket |
| cluster position | LEFT / RIGHT / CENTER — which question it belongs to |
| `tier` | FRONT / BACK on a double: which rod it dresses |
| `projInches` | **the projection.** Gates parts by depth AND is what Vision engineers from (2026-08-21) |
| `mountType` | WALL / CEILING / END |
| `traverseRole`, `driveType`, `trvSetup` | the traverse world: track, fascia, carrier, f-clip, TRV_END; manual vs motorised |
| `isBasic` | one piece — takes no backplate |
| `usesReturnPlates` | this bracket is IN LINE (the arm-side flag) |
| `inlineOnly` / `returnOnly` | which POOL a plate belongs to. One flag per pin, never both |
| `noBackplate` | this end mounts without a plate |
| `materials` / `noFinish` | what it is made of — gates which finishes it can wear |
| `isCollar` / `requiresCollar` | a collar comes with its finial, never asked |
| `alwaysShown` | built and billed, never offered (carriers, f-clips) |
| `isHiddenPart` | BOM-only: billed, never drawn, never asked |

⚠ **THREE PLATE POOLS, and each arm asks for its own first**: a return takes `returnOnly`, an
in-line arm takes `inlineOnly`, an ordinary wall bracket takes the plates tagged NEITHER. Leave the
plain copies untagged or standard brackets lose their plates.

## Tab 11 (System Admin → CPQ Flow Builder) — what still matters

The builder was slimmed on 2026-08-21. What it now shows is what a flow still IS:

- **Link to Master Assembly** — this is what the engine reads. Without it the flow opens the OLD
  configurator.
- **Flow name / ERP item id**
- **Fabrication preset** (bay configuration + end style) — read by **Vision Hardware**, not the CPQ
- **Finishes offered** — the colours this collection sells. Empty = every finish
- **Customer** — the flow's own account, the pricing fallback when a job names nobody
- **Items added by hand** — splices, extra rings; offered in the walk
- **NetSuite rollup item** — labour + fees ride this on the estimate push
- **Backup price per kind of part** — last resort only, when an item has no price under any rule.
  A line quoted this way is flagged AMBER on the quote
- **⚙ Generate Flow from Tags** — builds the flow doc from the assembly's tags
- **🧬 Size-Family Stamper** — for a COMBINED flow (one flow, every diameter: H2 today, H1 next)

A **"Legacy step tools"** checkbox brings back the old step editor, the per-step finish cascade and
the geometry-hiding list. Off by default. Only needed for flows that still run the old configurator.

## Which engine a flow opens

`newEngine` defaults ON for the **Classical (ce)** brand and is available to everyone on every
brand. A flow opens the OLD configurator regardless when it is a **2D tear sheet** (`sheet2d`), a
**PILLOW** flow, or has **no linked assembly** — those have no pins to read.

## Setting up a new assembly, in order

1. Model and pin it in 1.6 — every choice pin gets a `choiceNode`, a part, and the tags above.
2. Create the flow in tab 11, link the master assembly, generate from tags.
3. Set Finishes offered, the rollup item, and any add-by-hand items.
4. Open it in CPQ and click **the tag-notes button** in Notes & Guidance (super-admin). It reports:
   untagged geometry (nodes no choice claims — collapsed behind a count), and the **projection
   audit**: red where a part carries NO `projInches` tag, amber where the library item's old
   `customData.projection` contradicts it. Fix what it names.
5. Walk it. Check the pricing panel names the right items, each with its finish underneath.
6. Push one quote and read the **NetSuite Transmit Log** before trusting it with a customer.

## The bracket-span message

"No span guidance — this rod is not listed against a family in 6.5" means exactly that: tab 6.5
lists rod FAMILIES, each with an **item codes** box, and the chosen rod's legacy ERP id matched
none of them. Matching ignores case, punctuation and any finish suffix (`H1-138R/P` matches
`H1-138R`). H2 has its own rows — filling in the H1 rows does not cover an H2 quote. On a combined
flow the rod is size-swapped BEFORE the lookup, so each diameter's code needs to be in its family's
box. Stored at `system/bracket_span_map`.

---

# 3 · The spec sheet renderer

**This is a rebuild of the RENDERER, not the tool.**

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
