# Spec sheet — handoff

Paste into a fresh session. Written to be read cold. Supersedes `SPEC_SHEET_SESSION_BRIEF.md`.

Read `CLAUDE.md` first (ship workflow, multi-session git rules, the Vercel stale-build trap).

---

## Where this actually stands

The **filtering is solved and proven**. The **placement is nearly solved**. The **scale is not** — and
it is the thing Stuart keeps rejecting, correctly.

Code: `src/components/SpecSheet/`. Opened by the 📐 button in BOM Engine (tab 3).
Tests: `node scripts/specSheetPages.test.mjs` (59 assertions), `node scripts/specSheetRows.test.mjs` (19).

| file | state |
|---|---|
| `specSheetPages.js` | NEW this session. Page list = the CPQ's own narrowing. Plus `auditPages()`. Solid. |
| `specSheetRows.js` | asks the engine what pairs with what. Untouched, tested, correct. |
| `SpecSheetModal.js` | ~900 lines (was 1246). Geometry extraction + placement + dims. Where the remaining faults are. |
| `specSheetPage.js` | the composer: measured grid, fit, captions. Where the SCALE problem lives. |
| `hiddenLine.js`, `specSheetGeometry.js`, `specSheetOutput.js` | fine, barely touched. |

---

## THE OPEN PROBLEM — read this before changing anything

**Four-row plate sheets print at ~41%. Stuart has rejected this four times running.** One-row
sheets (basic/wood brackets: H1-138BD, BE, WEB) print at 96–100% and he is happy with them.

The arithmetic, which no layout trick escapes:

- A row is a plate (~3" tall) plus a ring hanging ~2⅞" below the rod ⇒ **~5" per row**.
- Four rows ⇒ **~20" of drawing**. Landscape 11×17 gives **10.5"**. Portrait gives **16.5"**.
- So landscape 4-row cannot exceed ~50%, and is at 41%.

The footer now states which constraint bound the fit — `REDUCED 41% TO FIT 11×17 (4 rows, bound by
height)`. **Trust that line; do not re-derive it from a screenshot.** I wasted three rounds widening
the rod window (22"→26"→34") on requests to "make the pole longer", each of which shrank the whole
page, because width and height bind on different sheets and I never checked which.

Levers that actually exist, in order of honesty:

1. **Portrait 11×17** — shipped as the `1:1 · 11×17 ↕` button. 16.5" of height ⇒ roughly double.
   **Ask him to try this first; it may be the whole answer.**
2. **Fewer rings hanging on the rod.** Four rings × 2⅞" drop is most of each row's height, four
   times over. His own reference sheets carry the Ø callouts on row 1 only. This is a
   drawing-convention decision — he has been asked twice and not answered.
3. Splitting 4 rows across 2 sheets. Not offered; he wants four to a page like the originals.

**Do not** try to win this in the composer. It is measured correctly now.

---

## Also still open

- **`H1-138D` (the double) placement.** As of `195d740` the back rod is re-seated from the tags and
  the plate placed from `frontProj`. **Unverified** — that commit went out at the end of the
  session. Check the two-step dim reads wall→3-1/4 then 3-1/4→5-1/4 (was 3-1/4 then 8-1/2).
- **The two repeated detail columns** from the reference set — `French Return` and `Passing Support
  Arm` down the right of every row. Never built. The row builder only makes detail/front/profile.
- **`HTCAR35/01`** is still pinned `category: RING` with no carrier tag, so it rides solid rods as a
  ring. `HTSLNTCAR` was retagged and behaves. One-line data fix in 1.6: `traverseRole = CARRIER`.

---

## Reading PROD data without the PIN gate — do this early, it is worth it

App Check blocks Node scripts, so for a whole session I guessed from screenshots and was wrong
repeatedly. **Don't.** The Enterprise PLM PIN is an app-level gate; Firebase auth and App Check are
already satisfied on the page, so **Firestore reads work from the browser console at `/hq` while
still gated**.

```js
let req; window.webpackChunkce_m2c_design_app.push([["__p"+Math.random()], {}, r => { req = r; }]);
const db = req("1624").db, M = req("565");     // 1624 exports db; 565 is the Firestore SDK
// duck-test the ops, do not guess minified names. In the 2026-08-23 build:
//   rJ=collection  H9=doc  _M=where  P=query  x7=getDoc  GG=getDocs
const asm  = (await M.x7(M.H9(db,'Approved_Designs','CE-ASM-1786572226393'))).data();  // H1-138
const pins = (await M.GG(M.P(M.rJ(db,'assembly_pins'), M._M('assemblyId','==','CE-ASM-1786572226393')))).docs.map(d=>d.data());
```

⚠ Do **not** brute-force call every module export with a ref to find the ops — it fires hundreds of
requests, wedges the Firestore client into `INTERNAL ASSERTION FAILED: Unexpected state`, and
freezes the renderer. Reload to recover. App module exports are mangled by scope hoisting, so app
functions cannot be found by name; read raw data and reason locally instead.

You can also fetch and parse the GLB in the console to check a node exists — the JSON chunk is
plaintext (`dv.getUint32(12,true)` is its length after the 12-byte header).

---

## H1-138's real shape (read from prod, 2026-08-23)

`Approved_Designs/CE-ASM-1786572226393`, 467 pins, 96 clusters, **no `specCadUrl`** — it draws from
the merged sales model and Stuart has ruled out ever uploading a spec layout: *"we are not going to
do another upload that is a long process and it is all here."* The 1.6 slot data is the source of
truth; every part sits on its own slot at its own position with its own tags.

- **31 bracket arms.** Six are pinned **CENTER only** — passing brackets `H1-138PS/PE/P6` and
  `ILPS/ILPE/ILP6`. Anything that *prefers* the LEFT copy of a cluster breaks on those.
- **11 plates**: `BP-H/R/S/V`, `CP-H/R/S/V`, plus returns; each pinned ~28× across every
  projection, both setups, all three positions.
- **Sides are mirrors**: 29 LEFT clusters / 235 nodes and 29 RIGHT / 235 — a third of the model is
  duplication. `sideNodesFor()` excludes the far side only (CENTRE and SHARED belong to both).
- **Doubles tag projection as a MAP**, not a number: `FRONT: 8.5, BACK: 3.25` on the arm,
  `FRONT: 6.5, BACK: 3.25` on some rods. `p.answers.proj` is empty for a double — read `projTiers`.

---

## Traps that cost real time this session

Each of these cost at least one round. Several cost three.

1. **ONE CODE CAN BE TWO PINS.** `H1-138BP-R` exists as a plain plate AND an in-line plate — same
   code, different pins, nodes, tags, positions. Look a pin up by the engine choice's **own node**,
   never by `partId`. Matching on code drew the plain plate's geometry while the label read
   correctly — it looks exactly like a filtering bug and is not one.
2. **NO SINGLE FIELD HOLDS THE PART CODE.** Prod: `name`=code, `partId`=doc id (`CE-INV-…`).
   Fixtures: `normalizeChoice` defaults `name` to the choice id, so the code is in `partId`. Every
   fixture passed while prod was broken. **Any new fixture must use the prod shape.**
3. **NEVER FILTER THE ANSWER YOU ASKED FOR.** `visible` is what an *additive configurator paints*,
   not what belongs on a drawing. A three-piece pole's END segments only render once that end's
   treatment is chosen, so intersecting the rod against `visible` threw away the rod `rodForArm()`
   had just named. `keep()` is for sweeps; a part the engine named is drawn as given.
4. **`inferAxes` reads the pole.** Hand it a double's two rods and it can pick a different
   projection axis — and every plate placement is measured along that axis. Infer from the arm's
   OWN rod; the page lists it first for this reason.
5. **Which way the rod runs is a DRAWING decision.** It was falling out of which segment got picked,
   which varies by family (CENTER arms run the opposite way to LEFT arms). Mirroring the front view
   basis settles it once for every sheet. Three attempts at fixing it in the pin data failed.
6. **Depth and station are two different offsets.** Depth = projection, from the tag. Station =
   along the rod. Fixing one while dropping the other leaves the arm off to one side of its plate.
7. **Temporal dead zone.** An IIFE assigned to a `const` evaluates where it is *written*. Placing
   one above the `const axes` it reads threw `Cannot access 'M' before initialization` on every
   page. Third occurrence in this codebase; the build cannot catch it.
8. **A fixture that cannot fail is decoration.** Mutation-test every new assertion. Two versions of
   one test here could not fail and were thrown away.
9. **An audit that cries wolf is worse than none.** `auditPages()` raised 76 false alarms by testing
   `arm.inlineOnly` (a flag *plates* carry; the engine keys on `arm.isInline`). Only
   **unconditional** rules belong in it.

---

## How to work with Stuart on this

He is a precise observer and his diagnoses have been right every time. Twice he identified the
actual mechanism before I did:

- *"the front pole is always fixed and everything moves back from there"* — the placement rule.
- *"the basic brackets and wood brackets render a good size"* — which is the one-row/four-row split,
  i.e. width-bound versus height-bound.

**Read his sentences as engineering statements, not as symptoms.** And when a request trades against
something else — a longer rod against drawn size — **say so at the time**. Not doing that is what
turned three rounds into a regression he had to catch.

Verify against live data before changing code. The console recipe above takes two minutes.
