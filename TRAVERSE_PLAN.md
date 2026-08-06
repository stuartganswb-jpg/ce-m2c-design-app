# Traverse (H1-2TRV) — the plan, 2026-08-04

Supersedes the diagnosis in `TRAVERSE_HANDOFF_BRIEF.md` §3. That brief's §0 (environment, deploy,
bundle verification) is still accurate — use it. Its two hypotheses (duplicate clusters / clearing
effect) were both wrong, or at most secondary.

Derived from Stuart's full 1.6 tag dump + a read of the generator and the CPQ runtime. Every claim
below is traced to a line of code or a line of the dump.

---

## The flow Stuart actually wants

1. **Fascia** — wood or aluminium.
2. **Finish + length** for that fascia.
3. **Single or Double** — then Bracket Projection. Both gate what comes after.
4. **DOUBLE** → two tracks, and only the double bracket. Projection is meaningless here (the double
   bracket is tagged `proj: any`), so the projection question should not be asked at all.
5. **SINGLE** → one track, and the three projection brackets.

The tags already express this. The double parts (`H12TRVBDBL`, `H12TRVRAD`, `H12RCTARDBL`) are
`setup: double` + `proj: any`; the single parts are `setup: single` + a specific projection. So
**setup gates projection**, not the other way round.

---

## Root cause: three structural faults, in order of impact

### 1. `OTHER` clusters never reach the generator

`groupPlacements` is called for `POLE`, `FINIAL`, `BRACKET`, `BACKPLATE`, `RING` only
(`AdminTab.js:1137–1176`). Nothing reads `OTHER`.

Stranded in `OTHER` clusters, correctly tagged and completely invisible:

| cluster | part | tag |
|---|---|---|
| `NEW-SLOT · OTHER · SHARED` | `H12TRVTRKC` | `trv: track`, `setup: double` |
| `NEW-SLOT · OTHER · CENTER` | `H12TRVTRKC` | `trv: track`, `setup: single` |
| both of the above | `HTSLNTCAR` | `trv: carrier` |
| both of the above | `H12TRVNUTP` | (no item #) |
| `NEW-SLOT · OTHER · LEFT/RIGHT` | `H12TRVPLUG`, `H1DRIVEPULLEY` | drive manual / motorized |

Consequences: no Track step, no drive sub-choice, no carriers in the BOM, `trvSelection.drive` is
permanently blank so every drive filter is a no-op.

### 2. The fascia is collected twice — the phantom pole steps

The fascia pins are `trv: fascia` but live in `POLE` clusters. The traverse block reads them by role
into the Fascia step (`AdminTab.js:1451`, deduped). The ordinary pole path *also* reads them
(`AdminTab.js:1137`) — `dropRiders` only removes `FCLIP`/`CARRIER`, so `FASCIA` and `TRACK` stay in
the pole pool. `centerPole` ends up with all four fascia pins, undeduped, and emits:

- **Pole / Rod Material** (`centerPole.length > 1`) — the "4 choices should be 2" complaint
- **Pole Length**

Both steps carry the *same geometry nodes* as the Fascia step, with their own independent selection.
Two steps controlling one part is the most likely cause of the incoherent render: pick aluminium at
step 1 while step 5 defaults to wood and both sets of nodes are lit.

### 3. Step order contradicts its own comment

`AdminTab.js:1501` says Single-or-Double is "asked right after the fascia, because it decides which
tracks and which brackets exist." The code adds it *after* the Track block. Bracket Projection is
then spliced in after that (`AdminTab.js:1607`). Order must be: fascia → finish/length → setup →
projection (skipped on DOUBLE) → track → brackets.

---

## Secondary: the seeding effect

`CPQTab.js:764` pre-selects the first geometry-bearing option for **every** step on flow load. That
is why step 1 already shows three priced lines. Correct for a pole flow (nothing is ever removed);
wrong for traverse, where an answer subtracts.

The main-option seed at `CPQTab.js:791` does **not** apply `trvOkFor`. The sub-option seed
(`:797`) and the display filter (`:941`) both do. So a main selection can be seeded to an option the
filter forbids — present on the quote, absent from the dropdown, still rendering.

This is real and must be fixed, but with faults 1–3 corrected it stops being load-bearing. **This is
why H2 Simple Elegance works and traverse does not**: H2 has no subtractive axis, so seed-everything
is free. Traverse is the first flow where a customer answer removes options.

---

## The work

### ✅ DONE — the fork (2026-08-04, unshipped at time of writing)

`src/components/Shared/traverseFlow.js` is a new module owning the whole traverse step list.
`AdminTab.js` detects a traverse assembly and calls it *instead of* the pole path.

- **The standard generator is provably untouched.** `git diff -w 35c71fa^ -- AdminTab.js` shows the
  pole path byte-identical to its pre-traverse form. The two edits the traverse work had made to the
  shared path are reverted: `steps.splice(trvLeadSteps, …)` is `steps.unshift(…)` again, and the
  pole step's `if (!(isTraverse && centerPole.length === 0))` gate is gone.
- **Phantom `Pole / Rod Material` + `Pole Length` are gone by construction** — a traverse assembly
  never runs a line of the pole path. 13 steps → 9.
- **`groupPlacements('OTHER')` is now collected** and consumed only by the traverse generator, so
  the tracks/carriers/nuts finally arrive. No re-homing by hand needed (this was §B4 over §A1).
- **Order is fascia → length → setup → drive → projection → track → ends → brackets → fees.**
- **The drive is its own step**, not a sub-choice of the track (Stuart 2026-08-05: "either manual or
  motorized ends, no combination"). One option per drive, owning both ends' geometry — the plug is
  pinned left and right, so one answer lights both. `stepRole: 'TRV_DRIVE'`.
- **Projection is skipped on DOUBLE** via `trvSetupOnly: 'SINGLE'` + a matching disable rule in
  `CPQTab.js`'s existing disabled-steps effect.
- **15 node tests** built from the real tag dump: `sh scripts/run-traverse-tests.sh`.

### ✗ RETRACTED — "the second track is not modelled" was wrong

Briefly concluded on 2026-08-05, from DOUBLE showing one track and SINGLE none, that both track pins
shared one mesh and no rear track existed. **False.** The next test showed the rear appearing on its
own, so there are two distinct meshes. The real cause was the base track being tagged `setup: single`
and therefore filtered out of its own one-option picker whenever DOUBLE was chosen — see the fix in
`setupAllows` (TRACK exempt by role) and the required-step heal in `CPQTab`.

Recorded because it nearly cost a modelling session that was not needed. The lesson is the same one
that runs through this whole feature: **a render symptom has too many possible causes to diagnose
from alone.** Two meshes vs one, and a step losing its selection, look identical on screen.

The same-mesh guard added at the time is kept anyway — it is correct defensively and costs nothing.

### A. Tagging — Stuart, in 1.6

1. **Tag the traverse ends.** Nothing in the dump is `trv: end`. `H12TRVPLUG` (manual) and
   `H1DRIVEPULLEY` (motorized) *are* the ends. Without the role, `traverseEnds()` returns empty and
   the drive axis has no part behind it. **Highest value remaining tag change.**
2. **`H1DRIVEPULLEY` in `NEW-SLOT · FINIAL · LEFT` is tagged `drive: manual`.** Its three siblings
   say motorized. Mistag.
3. **Delete the duplicate fascia cluster** `NEW-SLOT · POLE · CENTER`. ⚠️ Check first which cluster's
   two nodes are the real geometry — dedupe merges both sets, so deleting the wrong one loses
   geometry. This is the designer question from the brief and it still stands.
4. **Delete the duplicate bracket pins** `NEW-SLOT · BRACKET · LEFT/CENTER/RIGHT`. Correction to the
   handoff brief: these do **not** create 3 extra steps — `addPerPosition` groups by position, so
   they add a duplicate `H12TRVTB` *option* inside each existing bracket step.
5. The plugs/pulleys are also pinned in `NEW-SLOT · FINIAL · LEFT/RIGHT`. Once §A1 tags them
   `trv: end` those copies leave the End Treatment picker automatically (tested). Then decide
   whether the FINIAL or the OTHER copies are canonical and delete the other.
6. ⏸ **HOLD the track setup retag.** The handoff brief says to flip them; do not, yet — see the open
   question below. Today `OTHER·SHARED` = `double` and `OTHER·CENTER` = `single`, which renders one
   track either way. That is coherent, if not yet right.

### ✅ ANSWERED — the second track is additive

Stuart 2026-08-05: switching to double "removes the bracket arms rather than **adding a second
track**." A double ADDS a track; it does not swap one for another. Implemented: a track tagged
`setup: DOUBLE` never enters the Track picker — the DOUBLE *answer* owns its geometry and bills its
part. The Track step is a one-option finish chooser, which is all it ever was.

This also means **§A6 is resolved**: the current track tags are already right. `OTHER·CENTER` =
`single` is the base track and `OTHER·SHARED` = `double` is the addition. No retag needed. (The
`single` tag on the base track is harmless — it could be `both (shared)` for clarity, since a double
has that track too, but nothing reads it: the base track is what the picker offers either way.)

### B. Generator — remaining

1. **Multi-material fascia has no finish step.** `fascia.length > 1` emits Material + `DIMENSIONS`
   Length, assuming the material step owns a scoped finish list the way the pole does. Confirm that
   list exists; if not, mirror the single-material `VISUAL_DIMENSIONS` shape. **This is why picking
   a fascia does not lead to a finish question.**

### C. Runtime — `CPQTab.js`

1. ✅ **DONE — the seed and the filter now agree.** `seedable` + `defaultOptionFor` are hoisted to
   one definition used by both the opening seed and the re-seed, and the main-option seed applies
   `trvOkFor` (the sub-seed and the dropdown always did; only that line did not).
2. ✅ **DONE — the clearing effect RE-SEEDS instead of just clearing.** This was the disappearing
   arms: picking DOUBLE invalidates every single-only return arm, and clearing alone left that end
   controlled by nothing. Now the step is handed its new default — the DOUBLE arm, which was tagged
   and sitting in the list the whole time. The selection is only removed when no option survives.
3. ⏳ **Still open: seeding is all-at-once.** `CPQTab.js` still pre-answers every step on load, which
   is why the pricing breakdown lists answers the customer never gave. Item 2 makes this survivable
   rather than wrong, but gating the seed on the steps that gate it is the honest fix.

### 🔜 NEXT — Vision Hardware (`VisionHardware.js`), scoped 2026-08-05

Stuart: "on vision, when this flow is selected, ends should react like others and turn into miter
return graphic, in the lower boxes Client Details & Ordering and Shop Floor BOM & Raw Cuts is where
the lengths details should hit. the Pole O2O is the same it is the outside edges of the miter return,
the C2C can be replaced with track length."

**Most of this already exists.** The flow-mirror at `VisionHardware.js:578` already reads each End
Treatment step's selection and sets `endStyle` / `endStyleRight` through `endStyleOf()` (`:423`),
which maps `MITER_RETURN → RETURN_MITER` and draws the miter. The panels read `poleO2O`, `pole2`,
`rawCenter` from `computeBayMath` (`Shared/bayMath.js`).

1. **The end graphic needs a signal, not new drawing code.** The traverse return arms
   (`H1-2TRVSRA` / `ERA` / `6RA` / `RAD`) are tagged **FINIAL** in 1.6, so `endStyleOf` returns
   FINIAL and draws a finial — which is why the screenshot says `End Style: FINIAL`. Physically they
   return to the wall like a miter. Two ways, **decide before building**:
   - Tag the arms `MITER RETURN` in 1.6. Simplest, but it makes them RETURNS to CPQ too:
     `isReturnOption` excludes returns from being a step's DEFAULT (`seedable`), so the End
     Treatment step would seed nothing, and `hasOwnReturn` / bracket-hiding change behaviour.
   - Add the `end-arm` (`isReturnArm`) flag to those pins and have `endStyleOf` read it — there is
     already precedent at `:233`, where an is-return BRACKET maps to `RETURN_MITER`. **Preferred:**
     it changes the drawing only and leaves CPQ's return semantics alone. Check whether the 1.6
     FINIAL grid exposes the `end-arm` chip (today it is visible on BRACKET rows).
2. **C2C → track length.** Replace the `Main Wall C2C` row (`:1716`, currently `pole2`) with the
   TRACK cut when the flow is a traverse: `traverseCutLength({ fasciaInches, role: 'TRACK', drive })`
   — fascia −0.5" manual, −2" motorised. The drive comes from the `TRV_DRIVE` step's selection.
3. **Raw cuts panel.** `traverseCutList()` returns fascia / track / F-clip in one call and is
   already tested. It has never had a caller; this is its destination.
4. **Pole O2O is unchanged** — Stuart confirms it is the outside edges of the miter return, which is
   what the existing math already produces once the ends read as returns (item 1).

`traverseCutLength` / `traverseCutList` are in `Shared/traverseTags.js`, tested against his numbers.
Both inputs now exist: the drive is answered once for the order, and the fascia footage is live.

### D. Not in this pass

- **THE CUT LIST — the point of the drive question.** `traverseCutLength()` is written and tested and
  **nothing calls it**. Fascia as ordered; track −0.5" manual / −2" motorised; F-clip −1" / −3". Now
  that the drive is answered once for the order, both inputs exist — the missing pieces are the
  Fascia Length step carrying its dimension through, and a decision about **where the cut list is
  surfaced** (the traveller? the BOM? the work order?). That destination is Stuart's call.
- F-clip "hidden in CPQ, visible on the shop floor" — that state does not exist; needs a third
  visibility state, deliberately built.
- Pricing. Stuart: "$0.00 doesn't concern me yet, I still need to assign pricing."

---

## Order of operations

1. ✅ **The fork** — done. Regenerate the H1-2TRV flow and count: **13 steps → 9**.

   | # | expected |
   |---|---|
   | 1 | Fascia Material — **2 options**, not 4 |
   | 2 | Fascia Length |
   | 3 | Single or Double |
   | 4 | Bracket Projection — 3 options, gone when DOUBLE is picked |
   | 5 | **Track** — new; proves the OTHER pool arrived |
   | 6–7 | Left / Right End Treatment |
   | 8 | Bracket & Mount ×3 positions |
   | 9 | Splice, Cut / Splice Fee |

   No `Pole / Rod Material`, no `Pole Length`. If either is still there, the flow was not
   regenerated. **Regenerate a pole flow too (Simple Elegance) and confirm it is unchanged.**
2. **A1 + A2** — tag the ends `trv: end`, fix the pulley's drive. The Track step grows its
   Motorised / Manual sub-choice and the pulleys leave the finial picker.
3. Settle the **open question** on the second track, then **A6**.
4. **C1 + C2** — seeding stops fighting the filter. Expect the pricing breakdown to stop listing
   answers the customer never gave.
5. **A3 + A4 + A5** — clean the duplicate pins. Independent of everything above; do whenever.
6. **B1** — the fascia finish step.

Verify by regenerating the flow and counting steps, not by reading the render — the render was the
misleading signal all along.
