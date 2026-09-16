# CPQ · Vision · Traverse — Handoff Brief (Brief E, sales side)

Written 2026-09-09 at the end of a three-day run (Stuart + Brief E session). Everything below is
**deployed and live-verified on Stuart's tab** unless marked otherwise. Commits are on `main`.

Read first: `CLAUDE.md` (the four working-agreement rules — plan first and WAIT, requested scope
only, no temporary fixes, RTG is the one spine), then this brief, then the memory files named in §9.

---

## 0. How to work this territory (non-negotiable)

- **Plan, then wait for "build it" / "go".** Stuart approves every change. Diagnosis and reads need
  no permission; edits do. He relays approvals in short messages ("your in", "go ahead").
- **One shared checkout, ~6 sessions.** Never switch branches. Stage only your files. `rm -f
  .git/index.lock` → commit → `git pull --rebase --autostash origin main` → push. Check
  `git status --short | grep -v '^??'` shows only your files and `git log HEAD..origin/main` is empty
  before every push ("check other sessions before any push").
- **Lint gate:** `npx --no-install eslint <files>` → 0 errors (warnings are pre-existing). Build
  sanity when JSX changes: `CI=false npx --no-install react-scripts build` (~2 min).
- **Deploy verification (Vercel auto-deploys main).** `version.json` stamp alone proves nothing. Rule
  used all week: poll `https://www.4cosworkcenter.com/version.json` until its stamp postdates the
  commit epoch, wait 30 s, then fetch every asset in `asset-manifest.json` (expect 38, 0 failures).
  For a change confined to the Vision chunk, byte-compare the served `630.<hash>.chunk.js` against
  the local build. A fresh deploy can serve 3 chunks 404 for a minute — re-sweep before alarm.
- **Stuart's tab.** He PINs in (a credential — never type it). Every deploy forces reload + re-PIN.
  A reload can keep the OLD chunk — confirm with
  `performance.getEntriesByType('resource')` (`630.<hash>.chunk.js`) before reading anything. A
  frozen renderer (native `confirm`/`alert` open, or a heavy 3D pane) times out CDP; ask him to
  dismiss/reload. Prefer a fresh tab (`tabs_context_mcp createIfEmpty` → navigate `/hq`) for a PIN.
- **Reading live state:** the configurator's `resolved` / `model` / `stretchSpec` are reachable by
  walking the DOM fiber up from the "ROD SETUP" rail chip and scanning hook `memoizedState`
  (useMemo values are `[value, deps]`). The r3f scene is NOT reachable that way. CRM jobs: walk from
  `#root`'s `__reactContainer$` for an array whose items have `cpqData.cartItems`.
- **Saving in CPQ is sending** (quote → CRM + ns_outbox → NetSuite). Never save a test quote
  without Stuart's OK. Reopen/edit/clear-all without saving is safe; leave the cart empty after.
- **Territory:** `HardwareConfigurator.js`, `CPQTab.js`, `ExternalCoopTab.js` docs path, the
  Shared engine/bridge/pricing/handoff files, `VisionHardware.js`. **Not ours:** `RTGDispatchTab.js`
  (B — hand patch specs), the WMS Labels tab in `PickPackApp.js` (D — `Shared/labelPrint.js`
  templates may be edited on Stuart's ask; leave D a note in memory).

---

## 1. The tag engine (Shared/hardwareModel.js) — rules settled this week

The engine is the single gate: `admits(choice, ctx)` returns `{ok, rule, detail}`; `slots()`
builds the questions; `resolve()` the render/BOM. **All fixes go on the ITEM (1.6 pin tags), not
on the flow.** The old engine is retired; CPQ and Vision both must work 100% on this one.

| Rule | Where |
|---|---|
| END-ARM tag on a bracket cluster = the part IS the end (re-roled RETURN); END-ARM + NO PLATE = decorative: keeps its bracket, plate follows the bracket | `normalizeChoice`, `slots()` ~1244/1417 |
| End arm pairs its plate strictly by depth; a FEE return takes rtn-only plates whatever their depth; untagged plates fit all | `slots()` ~1316 |
| A tiered (FRONT:x,BACK:y) bracket votes no projection — it is the projection question itself | `axisValuesOf`, `admits` |
| Front-of-the-double axis (`frontLayer` FASCIA/TRACK) gated under setup DOUBLE; DRTWB↔FASCIA, DWB↔TRACK | AXES, `admits` |
| A single order has one rod: FRONT-tier parts dropped, tier word dropped from labels | `slots()` ~955 |
| Pole construction fallback: no LEFT/RIGHT pieces → CENTER piece serves | `slots()` |
| Riders (carriers, F-clips) never questions; tier-matched to their rod | `ridersFor` |
| `clusterId` now rides every choice (adapter + normalize) — Vision matches options by it | `hardwareAdapter.choiceFromPin`, `normalizeChoice` |

Harnesses (all green, run with `node scripts/<name>.test.mjs`; traverse set via
`sh scripts/run-traverse-tests.sh`): hardwareModel 664 · partLookup 42 · visionBridge 53 ·
kitSeed 68 · platePool 14 · hardwareHandoff 45 · hardwarePricing 54 · traverse suite 52.

---

## 2. Vision (HQ/VisionHardware.js) — brought onto the engine

Vision still renders the OLD flow steps, but every picker is now gated by the engine from the pins:

- **Framing row** in *3. Fabrication Settings* = `activeAxes()` over `choicesFromAssembly(linkedAssembly,
  flowPins)`: Rod Type → Single or Double → Front of the Double (under Double) → Drive Type. Asked
  only where the pins hold two values, applied silently where one; stale answers dropped; cleared on
  a flow switch; saved as `specs.rodKind/setup/frontLayer/drive` + on `engData`.
- **Engine gate** `engineOk(opt)` = `admits(choice, {rodKind, setup, frontLayer, drive, proj})` on
  brackets, ends, plates, the sweep. `proj` = PROJ_SELECT pick / implied / size-matrix — the same
  value CPQ feeds `effAnswers.proj` — never the free-typed field.
- **Option → its own pin** (`choicesOfOpt`): part → `-C<cluster6>` in the optId → node names →
  side + depth; a part pinned 24× (H1-2TRVMTR) is judged by its own copy.
- **Bracket Projection list** narrowed to depths the rod world is built at; the phantom `6.53"`
  (generator reading `FRONT:6.5,BACK:3.25` as one number) is gone; tiered options pass `projTagOk`.
- **Plates pair with the arm holding the rod** (`armHolding` + `platePairs` = engine rule verbatim);
  decorative END-ARM keeps the bracket unlocked; an END-ARM bracket redraws the pole end as
  `RETURN_MITER`; twice-listed parts say their depth (`· 4-5/8"`).
- `platePoolFrom` "one pool" shortcut now applies the live gate (was returning the raw list — the
  centre-plates-24 bug).
- **Drive ends never in End Style** (`isDriveEnd`); **traverse cut list** on the Shop Floor BOM from
  `Shared/traverseTags.traverseCutList` (fascia as ordered · track −0.5"/−2" · F-clip −1"/−3";
  double + track front & rear → 2 tracks, no fascia) → `engineeringNotes.traverseCuts` (+ drive/
  setup/frontLayer). **B's one-line patch** to carry it to the floors: `RTG_TRAVERSE_CUTS_PATCH.md`.
- **Vision → CPQ bridge** (`Shared/visionBridge.seedFromVision`): `specs.rodKind/setup/drive/
  frontLayer` are the first word on step 1, then drawn rods, then the worlds the placed parts fit;
  hinted BRACKET retried as the END; carried/missed report names parts by our number.

Live proofs: H1-2TRV push → CPQ step 1 lit TRAVERSE · DOUBLE · FASCIA · MOTORIZED · WALL, DRTWB ×2,
HSOM-04 ×2 priced, missed none. H1-75 / H1-138 pickers populate and gate as before.

---

## 3. CPQ (Shared/HardwareConfigurator.js + HQ/CPQTab.js) — what shipped

| Feature | Notes | Commit |
|---|---|---|
| 🔎 Part lookup under the FLOW row | ours/theirs → flow, tags, verdict; read-only; live-first index | b3ac21a…8e08b80 |
| Finish rail: **one default per material** (`globalFinishes` {MAT→code}); `globalFinish` = METAL pick for single-code readers; "just this part" wins; plate follows its arm (`armFinishOf`) | wood gem + metal collar each keep their own | 5751d76, 20ec875 |
| Pricing line prints the **customer's finish name** · code (4.5 client mapping, customerId = CRM companyName e.g. "FABRICUT"); never "S11 · S11" | codes with no 4.5 row print bare | e76351e |
| **Track stock colour**: TRACK / `usesSubFinish` lines print "TRAVERSE BRONZE · TBR · stock colour", handoff `subFinishCode` + `finishLabel "TBR (sub finish)"`, no finishCode (no /P lookup, no finishing route); rust warning when 4.5 has no aligned colour | priced lines now carry `role` | ad3d8e8 |
| **Centre-bracket clones** on the new engine (`cloneSpecs` from resolved slots; rail = every visible ROD_ROLES + FCLIP node) | viewer replays `renderState.cloneSpecs` | e76351e, c91cfc2, 63ff5b5 |
| **Pole stretch v3** (`stretchSpec`): none ≤72"; over 72" the rail draws a FIXED 1.4× of modelled length, extra in the middle half only (rail meshes re-shaped from `userData.originalGeometry`; ends slide; anything ≥80% rail length is rail); no unit guard | Stuart: "just let it overscale"; a 20-ft frame reference was tried and REVERTED (emptied the pane on non-inch models) — do not reintroduce | 1a46a57, a70d2de, c10de64 |
| **Splice pencil line** (`spliceMarks`): centre / evenly N from CPQ, drawn position from Vision (`drawnSplices`) | thin unlit band after stretch + clones | d5c4a22 |
| **Render snapshot at Add configuration** (`ViewCapturer` exported from CPQTab; front JPEG ≤900px) → `renderSnapshot` → quote/SO documents print it above the lines | ~60–90 KB per line inside the job doc; watch the 1 MB Firestore limit on big carts | ad3d8e8 |
| Documents: the FULL_PACKET's quote page is built as `QUOTE` (customer SKU swap + feet × unit fire); View Item shows their part # and colour | | f2ce410 |
| **Save-time re-stamp** (`restampLines`): reopened quotes gain colour names / track colours on re-finalize (pictures need a re-add) | | 0989d33 |
| **Cart edit-in-place**: Edit keeps the line ("Editing…"), Add replaces it, Checkout warns if a line is open — root cause of "reopen lost a line" | | d578fa9 |
| Kit picker shows the customer's kit code (`clientSku` from the 4.6 row) | "HTS7510F PREMIUM" text is data | 0b5cdd4 |
| Traverse splice chart: 0 splices below the chart's first length (chart starts at 11 ft) | `explodeTraverse` | 8034316 |
| No print window after save; `resetWorkspace()` (= Clear All) runs after the Saved pop-up | | 8034316 |
| Configuration quantity asked ONCE, in the header (last-step copy removed — it sat beside the ring "How many"; a 50 quoted 50 builds) | | 9215fd3 |
| Checkout drop-ship: City / State / Zip one row, minWidth 0 | | e76351e |
| UOM label (D's Labels tab, template in `Shared/labelPrint.js`): APP grammar barcode → "PAIR (2 pcs)" → LEGACY item + QTY 1 barcodes | preview via node + headless Chrome (memory) | 5ec3acd |

---

## 4. Data findings Stuart owns (tags in 1.6 / 4.5)

- H1-75: `H1-75IM` L/R and `H175MTR3` L/R carried **tier FRONT** → doubled End Treatment steps.
  Stuart cleared → fixed. Check H1-1 / H1-138 inside mounts the designer loaded the same way.
- **`H1-DBLFR` / `H1-DBLMR` on 3/4" (H1-75) carry no `setup: double`** (the 1" and 1-3/8" copies are
  tagged) → they show on a Single. Tag them.
- Rear `HSOM-04` pins: rear-left missing `setup: double`; both carry a stray `proj 3.25"`.
- H1-138 french return `H1-FRPF` drops out at 4-5/8" because its fee tag is another depth (engine
  reads exact — CPQ and Vision agree). Stuart aware.
- 4.5 Master Finishes: a finish with no client-mapping row prints bare (S11); a finish with no
  `subFinishCode` makes the track line warn in rust.
- Test lines queued under FABRICUT in CPQ/Vision: "TRV LINK TEST", "ROD TYPE LINK TEST",
  "DRIVE TYPE LINK TEST". One real quote saved at qty 50 (QUOTE-1788999902223) needs re-saving at 1.

---

## 5. Open / named, not built

- RTG `fabNotes` one-liner for `traverseCuts` (B) — `RTG_TRAVERSE_CUTS_PATCH.md`.
- A per-assembly home to edit the traverse deductions (table in `Shared/traverseTags.js`; the
  function takes an override).
- Vision's traverse End Style list still shows drive ends' step titles; generator still emits TRV
  END steps (both engines skip them).
- No CPQ → Vision write-back; Vision itself renders the old flow steps (gated by the engine).
- Pictures on old quotes need the line re-added; if carts get big, move snapshots to Storage + URL.
- Shrink direction of the stretch (orders shorter than the model) — not built by choice.
- Alias window (`reqDate`/`needByDate`) until B's split writes `needBy`; E3 NetSuite class map
  (Eric); Fabricut order 3 (4-5/8" returns GLB) and order 4 never entered.

---

## 6. Key files

`Shared/hardwareModel.js` (engine) · `Shared/hardwareAdapter.js` (pins → choices, `clusterId`) ·
`Shared/HardwareConfigurator.js` (CPQ walk, finishes, clones/stretch/splice specs, snapshot, kit
picker, lookup) · `HQ/CPQTab.js` (`DynamicModel` = render: visibility, textures, clones, stretch,
splice marks; `ViewCapturer`; cart, edit-in-place, finalize, `resetWorkspace`) ·
`Shared/hardwareHandoff.js` (cart line shape: `clientSku`, `clientFinishName`, `subFinishCode`,
`renderSnapshot`, `restampLines`) · `Shared/lineClassification.js` (customer document lines) ·
`HQ/ExternalCoopTab.js` (DOCS packet) · `Shared/FormPreview.js` (quotation form) ·
`Shared/ConfiguredItemViewer.js` (View Item) · `HQ/VisionHardware.js` · `Shared/visionBridge.js` ·
`Shared/traverseTags.js` (deductions, cut list) · `Shared/traverseExplode.js` (kit explode, splice
chart) · `Shared/platePool.js` · `Shared/partLookup.js` + `PartLookupPanel.js` ·
`Shared/labelPrint.js` · `HQ/UserGuideTab.js` (team guide — CPQ section updated 2026-09-09).

---

## 7. Verification playbook (what "done" meant this week)

1. Harnesses green; eslint 0 errors; build compiles when JSX moved.
2. Push; poll version.json past the commit epoch; sweep 38 assets; byte-compare the Vision chunk
   when only Vision changed.
3. Stuart reloads + PINs; confirm the chunk hash on the tab; read the actual pickers/pricing rows
   via JS (option texts, `tr` rows) rather than screenshots where text suffices; screenshot the 3D
   pane for render changes; leave the cart empty; never save.
4. Report the observed values, not the intent; name the data defects separately from the code.

---

## 8. Stuart's standing preferences (learned the hard way)

- "For tags always also refer to the slot #" (1.6 slot chip `#<order> · <slotId>`).
- Fixes on the item, not the flow; do not break the other flows; the old engine is retired.
- Rendering is a picture: he will call the stretch by eye ("20% more"); ask for the number.
- He notices data oddities himself (7× miter returns are correct: one fee per depth per side).
- When a change empties a pane or hides a part, revert first, discuss after.

---

## 9. Memory files to load

`h1-2trv-traverse-engine-session.md` (engine findings, Vision gate, driving notes),
`brief-e-sales-side-session.md` (everything in §3, day by day, with commits),
`deploy-verify-asset-manifest.md`, `fabricut-projection-tag-defects.md`, `working-agreement.md`,
`one-issue-at-a-time.md`.
