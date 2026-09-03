# Handoff — 1.6 authoring alignment + 1.5 slot locator

*Brief F session, 2026-09-03. Brief: `BRIEF_16_AUTHORING_ALIGNMENT.md`. All five planned commits
shipped the same afternoon; the traverse template (Stuart's §5 Q1 = yes, "build it right") is
the sixth, waiting on his check of the slot list against the live 1.5 SLOTS panel on H1-2TRV.*

## What shipped (main, Vercel auto-deployed; markers verified in the live chunks)

| commit | ask | what |
|---|---|---|
| `c3bb342` | — | `scripts/run-traverse-tests.sh` runs all 22 suites in one command (the 15 `../src`-importing suites were failing on path alone inside the staging dir). 6 staged + 16 root, all green. |
| `bb52947` | 1 | `ChoiceTagControls` — the Load Choices flags cell lifted verbatim into one module-level component (props: `c, category, onPatch, dictLists, custList, ensureCustomers, collarCands, inp`). The assign row mounts it back; behaviour identical. |
| `c7d42bd` | 1 | Slot (Build / Extend) rows mount the same component; the slot-only markup (single-value projection select, the wrong `basic` tooltip) deleted. The drop / split / sheet-build seeds gain `passing, noFinish, materials, noBackplate, parked`. |
| `411c7c6` | 2 | Load-order badge on every filled slot row, computed with the prefix's own arithmetic (index among filled merge slots + existing-cluster count on Extend); SOP/spec read *attach*, empty reads *—*. ▲▼ per slot row (`moveSlot`). Extend panel numbers existing clusters; preflight lists the numbers. Build writes `slotId / slotLabel / slotOrder` on each NEW cluster (additive; existing clusters untouched). |
| `383489b` + `c3aed74` | 3 | `Shared/slotGroups.js` (pure; `scripts/slotGroups.test.mjs`, 6 tests, prod-shaped fixtures, 3 mutations killed, one unreachable guard removed). 1.5 SLOTS panel above Saved BOM Bindings: number, label, cluster/node counts, tag line, ⚠ gaps (no category / no position); hover glows the slot, Locate locks, ▸ lists its clusters with the existing per-cluster Locate; Ungrouped last, never hidden. One prop expression changed on `SelectableModel`'s mount (precedence: auto-panel glow → hovered cluster → hovered slot → locating cluster → locating slot). |
| `6eef1ed` | S2 | Guide chip **1.6 / 1.5 Authoring** (`UserGuideTab.js`, appended; E's sections untouched). |

Every commit: `eslint` 0 errors (3 pre-existing warnings in AssemblyBuilderTab: two unused helpers,
one loop closure — not mine), `CI=false react-scripts build` compiled, the suite green.

## Stuart's §5 answers (2026-09-03)

1. Traverse template — **yes**, build it right, immediately after the parity work.
2. Slot reorder — **live recompute** (verified: the prefix is minted only at Build).
3. Node re-map on the slot row — **no** (assign-only stays).
4. The designer gets the traverse tags — **yes**.
5. `basic` = one piece; `noBackplate` = mounts without a plate — **both kept**; "no harm in leaving".

## Named, not fixed

- The two assign-path seeds (`addChoice2d`, `splitChoice`) lack the same five keys; harmless — those rows render every control and a patch adds the field on first edit.
- The Build writer spreads `tier` twice (a harmless duplicate).
- Per-slot tag chips were not added: the slot header already shows category / position / location as selects.
- The Build-time number can differ from the badge only if the target assembly gains clusters between choosing it under Extend and pressing Build (both read live at their moment).

## Verification done / not done

- Proven in code: eslint, build, node tests with mutation checks on the grouping rule, marker sweep of the live chunks (`Load order #`, `slotOrder`, `Slots (`, `clear locate`).
- **Not yet run:** the §6 acceptance table with Stuart and the designer pinned in on H1-2TRV — extend with one slot and confirm every tag is offered; tag one choice from each screen and diff the two `assembly_pins` docs (only `choiceSort` may differ); a double's per-rod projection from the slot row; slot numbering after an Extend; the SLOTS panel on H1-2TRV and on a hand-clustered assembly; the ⚖ scan and 🩺 Flow Doctor on H1-2TRV. No JSX here is coverable by a node test, so this run is the proof.

## Next

- **Traverse template** (sixth commit): `TEMPLATES.traverse` with per-slot `defaults` applied in the three slot seeds, so a choice uploaded into "Fascia" is born `traverseRole: FASCIA`, into "Rear Track" `TRACK + DOUBLE + BACK`, carriers `CARRIER + alwaysShown`, ends `TRV_END`. Draft slot list is in the session transcript; Stuart checks it against the live SLOTS panel on H1-2TRV first (open: the category carriers / F-clips are pinned under; whether splice and motor get slots).
- Then the H1-2TRV load itself (F6 data pass) with the designer, using the panel.
