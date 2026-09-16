# H1-138 Mixed-Material Flow — Continuation Brief (2026-08-16)

Session handoff. The big war is WON; what remains is a short punch list where **the last
session's diagnoses were going stale** — read the corrections below before prescribing anything.

## ⚠ FIRST RULE FOR THE NEW SESSION
Stuart's closing correction: **"you're way off — we have done this already, the tags are there."**
The last hours drifted into prescribing 1.6 tagging (mount/proj on plates, collar pairing) that
is ALREADY DONE in the data. Do not repeat that. Before any prescription: **read the actual 1.6
rows** (Load Choices → the row extractor pattern below) and the **actual flow doc options**, then
diagnose from data. The remaining bugs are in code/generator behavior, not missing tags.

## What this is
- **H1-138** = Fabricut 1-3/8" rod family, first MIXED-MATERIAL single-assembly flow:
  material step offers **R (steel) / TRV (integrated traverse track) / WR (wood) / AR (acrylic)**
  — one option each — with whole-rod swap, traverse grammar in a standard flow.
- Assembly doc `Approved_Designs/CE-ASM-1786572226393` (also itemId). Flow **"H1-138 — GENERATED"**
  (11 steps), registered on the **"Fabricut H1 — pick rod diameter" group's 1-3/8" chip**
  (size stamper). Bay: Straight Pole, single-assembly checkbox ON when generating fresh —
  but ALWAYS regenerate IN PLACE via the flow editor's **↻ Regenerate Steps from Tags (keep
  prices)** (the bare GENERATE button makes a duplicate flow; that mistake was made + cleaned).
- Current .glb `assemblies/ce_H1_138_*.glb` (~60MB, 59 sections / 316 choice nodes). Node names
  carry time-minted slot prefixes (`S58<MINT>-LABEL__n_<orig>`).

## Verified WORKING (don't re-litigate)
- Full matrix: 3 projections × 4 materials — correct proj-matched arms auto-seed at all
  3 positions; traverse swaps arms+plates in/out (mutual pools); wood/acrylic swap whole-rod;
  finials persist across materials (asymmetric pools); trv returns are trv-only; steel returns
  hidden on traverse; coherent opening render (projection seeds first, wall-first defaults).
- The traverse renders the REAL track (channel profile, carriers riding it) — after the ghost
  purge (below). Steel/wood/acrylic render single coherent rods.
- Both audit banners clean (⚠ mapped-missing and 👻 uncontrolled).

## OPEN ISSUES (the actual work)
1. **3-5/8" backplate gap** — plates render with a visible gap to the arm (should sit flush).
   Seed picked `H1-138CP-R` (Round Cover Plate) at 3-5/8. **Tags exist** (Stuart). Suspects:
   which plate the seeder/pairing actually picks vs which mesh depth the designer modeled;
   whether per-proj plate meshes exist in the pack and the sub-gate isn't using them; possible
   ghost/stale mesh at the plate position. Diagnose with HIGHLIGHT + the glb probe (below).
2. **6" projection picks wrong backplates** — same family of bug, same tools.
3. **Acrylic finial collar not rendering** — collar machinery (AdminTab ~1240: isCollar pins
   leave the pool, requiresCollar pairing appends collar nodes to finial options) exists, and
   **Stuart says the collar pairing is already set in 1.6**. So debug WHY the append isn't
   landing in the generated options: read the flow doc's end-step options for appended collar
   nodes; check the collar pin's partId/partName match path (`requiresCollar` matched by
   partId/partName, preferring same position); check the collar pin's nodes still exist in the
   glb (ghost-strip era). The CLEAR guard is fixed (ACKF/ACGF/138AR/138ACR now render clear —
   commit 002d4d7); the finish should land on the collar once the append works.
4. **H2-138 left bracket pool EMPTY** at 1-3/8 chip (dropdown has zero options, selection
   cleared, render lost). Hypothesis (UNCONFIRMED, Stuart checking): stale small-rod projection
   (3-5/8"/S) carried across a diameter-chip switch where dia 138 only offers E/6 → every
   bracket banned. If confirmed → the banned-pick sweep must also re-pick the PROJECTION step
   (replace-don't-clear) on chip switches. H2 memory: dias[] projections "S/E small rods, E/6
   at 138".
5. **Rings vs carriers either/or** — `trv: std-only` role SHIPPED (traverseTags STD_ONLY +
   1.6 dropdown + gate). The RINGS rows may still need the tag + one regen (verify in 1.6
   before saying so — see First Rule).
6. **Finish scoping pass** (manual, in the flow editor): material step per option — AR → CLEAR
   ACRYLIC, WR → S01–S12, R → P+EP, TRV → track finishes. Not started.
7. **1.6 thumbnail generation storm** crashes Chrome (316 progressive 3D snapshots over a 60MB
   scene). Build on-demand thumbs (per-section button or viewport-lazy) before the doubles wave.
8. BP-R naming: the plate pins were mis-auto-matched to `H1-138BPR` (passing ring); Stuart fixed
   them to `H1-138BP-R`. The Code Collision Audit card (1.6) exists to catch such near-miss codes.

## What shipped today (main, all deployed)
- `traverseTags.dedupeByPart` **delimiter fix** (THE bug of the day: comma-merge of pipe-joined
  node lists made maps of garbage tokens — material options controlled nothing; always merge
  node lists via `splitNodes`/`joinNodes` from `Shared/nodeList.js`).
- Materials merge (one material listed once across center+halves) + **carrier/fclip rider nodes
  merged into trv-tagged material options** (riders live in the OTHER pool — sampled now).
- **Wall-first seeding** (main seed + banned-pick replacement) — flows open on wall builds.
- **Unique time-minted slot prefixes** (S58<MINT>-…): the collision class (deletes re-minting
  the same S<n> namespace) is dead.
- 1.6 tools: **✎ reclassify** (category/position per section), **↩ Restore .glb backup**,
  **🧹 Strip unclaimed** (RECURSIVE, sibling-scoped dup rule — a name repeated down the
  ancestor chain is structure, only sibling repeats are twins; the global-dup version stripped
  the whole assembly once — ↩ Restore recovered), **shared-name guard** on section delete
  (record-only when a sibling claims the same names), ⚠ EMPTY sections visible, sorted section
  list (poles → finials → per-position brackets/plates).
- **👻 inverse audit** (CPQ, super-admin): sections whose geometry NO step controls (renders in
  every config). Blind spot: cluster-LESS glb groups (the ghost rods) — those are the strip's
  job. The ⚠ banner is the other direction (mapped-but-missing).
- **`trv: std-only`** role (inverse of trv-only).
- **Acrylic clear guard** extended: ACKF, ACGF, 138AR, 138ACR.
- Fusion-import rule confirmed: `buildGlbFromAnalysis` names meshes from the import panel's
  final names — the component name IS the item code (a "wood rod" file whose component was
  still named H1138AR arrives as acrylic; that mystery cost hours).

## The ghost-rod saga (why the track wouldn't show) — resolved
Deleted early wood/acrylic attempts left **orphaned 30" rod meshes** (S58/S59) in the glb —
claimed by NO cluster → rendered permanently OVER the track. Proven by parsing the glb JSON
(steel rods 376 tris / 1.4×1.4; the TRV center AND halves are all real track: 2552 tris /
1.4×1.2 — the designer was right all along). 🧹 strip (recursive) removed them. **The glb-JSON
probe is the ground-truth tool** — trust it over the eye and over my own theories.

## Diagnostic toolkit (browser-drive)
- Stuart PINs a tab for me (per-tab auth; hard refresh = logged out again; the extension tab
  group resets when Chrome crashes — ask him to re-PIN the NEWEST tab in the Claude group).
- **Native dialogs freeze the renderer** (CDP timeouts = a confirm/alert is up) → Stuart clicks
  OK. Long parses also freeze (60MB glb) — wait, don't hammer.
- React selects: `find`+`form_input` works; JS fallback = native value setter + change event.
- **glb JSON probe** (in-page): tokened URL from `performance.getEntriesByType('resource')`
  after a Load Choices / CPQ model fetch → `fetch` → GLB header: JSON chunk = bytes 20..20+len
  (len = uint32 LE at offset 12) → nodes[].name, mesh→primitives→accessors for tri counts/dims.
- 1.6 row extractor: trv-select spans (`option[0].text` starts `trv:`) → walk previous siblings
  for item/label inputs and `span[title]` node names. Items live in INPUT VALUES — innerText
  misses them.
- Regenerate via MY clicks is unreliable — **Stuart clicks the flow editor's ↻** (tab 11 →
  H1-138 — GENERATED card → ↻ → OK).

## Deploy pipeline (Vercel + Cloud Shell)
- **Frontend auto-deploys to prod on push to `main`** — Vercel project `ce-m2c-design-app`,
  live at **4cosworkcenter.com**. ~2 min per deploy; the app shows an update pill — Stuart must
  hard-refresh (⌘⇧R) before testing, and a REGENERATE clicked on a stale bundle runs the OLD
  generator (that burned one round today — always: deploy → refresh → regenerate, in that order).
- **Stale-build trap**: "Ready" + right commit hash can still serve OLD code (poisoned build
  cache). Verify prod by grepping the live bundle for a plain-ASCII marker string; the app is
  CODE-SPLIT — tab code (1.6, CPQ, Admin…) lives in chunks, never `main.*.js`: extract EVERY
  chunk map from main (`LC_ALL=C grep -oE '\{[0-9]+:"[a-f0-9]{8}"(,…)*\}'` — sweep ALL matches,
  not head -1), download each `static/js/<id>.<hash>.chunk.js`, grep those. Fix = Vercel
  dashboard → Deployments → ⋯ → **Redeploy with "Use existing Build Cache" UNCHECKED**.
  (`"prebuild": "rm -rf node_modules/.cache"` stays as the determinism guard.)
- **Firebase Functions are NOT deployed by Vercel** (`functions/index.js`: `netsuiteProxy`,
  `authenticatePin`). Local `firebase login` fails on this Mac (localhost callback). Deploy from
  **Google Cloud Shell** (shell.cloud.google.com): `git pull` then
  `firebase deploy --only functions:<name> --project ce-m2c-design-collab`.
  Nothing in today's work touched functions — no Cloud Shell deploy pending.
- Firebase project `ce-m2c-design-collab`; Firestore/Storage enforce **App Check** — reads and
  writes only from inside the authenticated app (build admin buttons, never Node scripts;
  storage fetches need the tokened `getDownloadURL` URLs, which is why the glb probe harvests
  them from the app's own network activity).

## Rules (unchanged)
- Fix-forward on main, never switch branches, stage only your files, rebase-autostash before
  push, hard-refresh after deploy. Lint MUST gate the commit (`ec=$?` — a piped tail eats the
  exit code; that mistake shipped an import/first error once today).
- AssemblyBuilderTab/traverseTags/CPQTab/AdminTab are shared with other sessions — additive
  touches, note them in commits.
- App Check: no local scripts against prod data — everything through the authenticated app.
