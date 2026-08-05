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

### ❓ Open question — is the second track a choice or an automatic part?

The two track pins are the **same part** (`H1-2TRVTRK/C`) at different nodes, separated only by
their setup tag. That leaves two readings, and they need different code:

- **Automatic** — a double simply *has* two tracks. Then the second one is an `includedPart` whose
  geometry turns on with DOUBLE, and the Track step stays a one-option finish chooser.
- **A choice** — the customer picks each track. Then the step needs two independent pickers.

Retagging to "shared + double" (the brief's advice) only makes sense under the first reading, and
under the current code it would put **two identical options in one picker** on a double. Settle the
reading first, then tag.

### B. Generator — remaining

1. **Multi-material fascia has no finish step.** `fascia.length > 1` emits Material + `DIMENSIONS`
   Length, assuming the material step owns a scoped finish list the way the pole does. Confirm that
   list exists; if not, mirror the single-material `VISUAL_DIMENSIONS` shape. **This is why picking
   a fascia does not lead to a finish question.**

### C. Runtime — `CPQTab.js`

1. **Apply `trvOkFor` to the main-option seed** (`:791`) — one-line parity with `:797`. The sub-option
   seed and the display filter both apply it; the main seed does not, so a selection can be seeded to
   an option the filter forbids: on the quote, absent from the dropdown, still rendering.
2. **Make seeding gated, not all-at-once.** `CPQTab.js:764` pre-answers every step on load — that is
   why step 1 already showed three priced lines. Seed a step's default only once the steps that gate
   it are answered. This is the architectural fix, and it reduces the clearing effect (`:912`) to a
   no-op in normal use. *Deferred deliberately: it touches the shared runtime, and the fork above
   should be verified in isolation first.*

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
