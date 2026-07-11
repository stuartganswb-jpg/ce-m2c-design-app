# SPEC MASTER MANIFESTS v2 — one assembly per DIAMETER × PROJECTION

> **v2 correction (2026-07-11): projections cannot share an assembly.** The sheet tool measures the
> projection dimension wall-plane → pole-centerline, and each assembly has ONE pole position — so a
> spec assembly covers exactly one diameter × one projection (the proven shape of the two existing
> builds). 9 cells total; 3/4"×4-5/8" is done (production master) and 3/4"×3-5/8" may already work
> from the old 3.625 assembly (test 📐 on it first — if its plates lack the nested wall-mount
> meshes, rebuild it from re-exports like the others).
>
> **Shared-per-diameter set** (model ONCE per diameter, re-upload into all three of its
> assemblies): backplates + coverplates (wall-mount mesh nested inside each, mesh name containing
> the real CPWP/BPWP code), finials + end caps, rings, pole stub, french/miter bend rods, IM
> barrel. Only the ARMS differ per assembly.
>
> RULES (every assembly): TRUE physical dimensions, real-world scale, GLB in METERS (verify: the
> first test sheet's pole Ø must read exactly 3/4 / 1 / 1-3/8). One shared coordinate frame per
> assembly: wall plane fixed; plates ON the wall at true heights; rod centerline at THIS
> assembly's true projection from the wall; arms mounted to the wall with the cradle meeting the
> rod exactly; finials at rod end; rings on the rod. Node naming `<ITEM#> LEFT` (arms, plates,
> finials, bends, IM), `<pole#> CENTER`, `<ring#> SHARED` — LEFT side only. One GLB per piece;
> 1.6 does all merging (never hand-build a combined file).
>
> Returns exist only at 4-5/8" and 6" → bend rods go in the E and 6 assemblies, never S.
> Include the IM barrel + the finial/ring catalog set in ALL three (pages are per-assembly).
> At 3/4": the RETURN plate copies (rtn-only cluster) go in the E and 6 assemblies.


---

# 3/4" ROUND — three assemblies

## Shared 3/4" set — model once, upload into all three assemblies

**Backplates (wall-mount mesh nested inside each)**

| Item # | Description | Node name |
|---|---|---|
| `H1-75BP-H` | Horizontal Backplate | `H1-75BP-H LEFT` |
| `H1-75BP-R` | Round Backplate | `H1-75BP-R LEFT` |
| `H1-75BP-S` | Square Backplate | `H1-75BP-S LEFT` |
| `H1-75BP-V` | Vertical Backplate | `H1-75BP-V LEFT` |

**Coverplates (same)**

| Item # | Description | Node name |
|---|---|---|
| `H1-75CP-H` | Horizontal Coverplate (Hidden Fasteners) | `H1-75CP-H LEFT` |
| `H1-75CP-R` | Round Coverplate (Hidden Fasteners) | `H1-75CP-R LEFT` |
| `H1-75CP-S` | Square Coverplate (Hidden Fasteners) | `H1-75CP-S LEFT` |
| `H1-75CP-V` | Vertical Coverplate (Hidden Fasteners) | `H1-75CP-V LEFT` |

**RETURN backplates — E + 6 assemblies only, cluster chip "RETURN plates"**

| Item # | Description | Node name |
|---|---|---|
| `H1-75RBP-H` | Horizontal Backplate for Returns | `H1-75RBP-H LEFT` |
| `H1-75RBP-R` | Round Backplate for Returns | `H1-75RBP-R LEFT` |
| `H1-75RBP-S` | Square Backplate for Returns | `H1-75RBP-S LEFT` |
| `H1-75RBP-V` | Vertical Backplate for Returns | `H1-75RBP-V LEFT` |

**RETURN coverplates — same**

| Item # | Description | Node name |
|---|---|---|
| `H1-75RCP-H` | Horizontal Coverplate for Returns (Hidden Fasteners) | `H1-75RCP-H LEFT` |
| `H1-75RCP-R` | Round Coverplate for Returns (Hidden Fasteners) | `H1-75RCP-R LEFT` |
| `H1-75RCP-S` | Square Coverplate for Returns (Hidden Fasteners) | `H1-75RCP-S LEFT` |
| `H1-75RCP-V` | Vertical Coverplate for Returns (Hidden Fasteners) | `H1-75RCP-V LEFT` |

**Finials (endTreatment = FINIAL)**

| Item # | Description | Node name |
|---|---|---|
| `H1-75BF` | BALL FINIAL | `H1-75BF LEFT` |
| `H1-75CC` | PILLOW FINIAL- PAINTED | `H1-75CC LEFT` |
| `H1-75GF` | GEM FINIAL | `H1-75GF LEFT` |
| `H1-75KF` | KNOB FINIAL | `H1-75KF LEFT` |

**End caps (endTreatment = FINIAL)**

| Item # | Description | Node name |
|---|---|---|
| `H1-75EC` | END CAP | `H1-75EC LEFT` |

**Pole stub (~12-16", TRUE diameter)**

| Item # | Description | Node name |
|---|---|---|
| `H1-75R` | 3/4" ROUND POLE | `H1-75R CENTER` |

**Rings (each option its own node)**

| Item # | Description | Node name |
|---|---|---|
| `H1-75BPR` | PASSING RING | `H1-75BPR SHARED` |
| `H1-75BR` | STRAIGHT EDGE RING | `H1-75BR SHARED` |

**End treatments (shared)**

| Geometry | Node name | Load-Choices setup | Goes in |
|---|---|---|---|
| French bent rod (3/4", true bend radius) | `<bend fee item#> LEFT` | endTreatment = FRENCH RETURN | E + 6 only |
| Miter rod | `<miter fee item#> LEFT` | endTreatment = MITER RETURN | E + 6 only |
| Inside-mount barrel | `H1-75IM LEFT` | endTreatment = INSIDE MOUNT | all three |

## Assembly `H1-75 SPEC 3-5/8"` — arms for this cell  — old 3.625 assembly may cover this; test 📐 first

| Item # | Description | Node name | Flags |
|---|---|---|---|
| `H1-75BS` | Basic Bracket (3-5/8" P) | `H1-75BS LEFT` | basic |
| `H1-75DS` | Decorative Bracket (3-5/8" P) | `H1-75DS LEFT` | — |
| `H1-75ILPS` | In Line Passing Bracket (3-5/8" P) | `H1-75ILPS LEFT` | inl-bkt |
| `H1-75ILS` | In Line Bracket (3-5/8" P) | `H1-75ILS LEFT` | inl-bkt |
| `H1-75PS` | Passing Bracket (3-5/8" P) | `H1-75PS LEFT` | — |

## Assembly `H1-75 SPEC 4-5/8"` — arms for this cell  — ✅ EXISTS (production master; no build needed)

| Item # | Description | Node name | Flags |
|---|---|---|---|
| `H1-75BE` | Basic Bracket (4-5/8" P) | `H1-75BE LEFT` | basic |
| `H1-75DE` | Decorative Bracket (4-5/8" P) | `H1-75DE LEFT` | — |
| `H1-75ILE` | In Line Bracket (4-5/8" P) | `H1-75ILE LEFT` | inl-bkt |
| `H1-75ILPE` | In Line Passing Bracket (4-5/8" P) | `H1-75ILPE LEFT` | inl-bkt |
| `H1-75PE` | Passing Bracket (4-5/8" P) | `H1-75PE LEFT` | — |

## Assembly `H1-75 SPEC 6"` — arms for this cell

| Item # | Description | Node name | Flags |
|---|---|---|---|
| `H1-75B6` | Basic Bracket (6" P) | `H1-75B6 LEFT` | basic |
| `H1-75D6` | Decorative Bracket (6" P) | `H1-75D6 LEFT` | — |
| `H1-75IL6` | In Line Bracket (6" P) | `H1-75IL6 LEFT` | inl-bkt |
| `H1-75ILP6` | In Line Passing Bracket (6" P) | `H1-75ILP6 LEFT` | inl-bkt |
| `H1-75P6` | Passing Bracket (6" P) | `H1-75P6 LEFT` | — |


---

# 1" ROUND — three assemblies

## Shared 1" set — model once, upload into all three assemblies

**Backplates (wall-mount mesh nested inside each)**

| Item # | Description | Node name |
|---|---|---|
| `H1-1BP-H` | Horizontal Backplate | `H1-1BP-H LEFT` |
| `H1-1BP-R` | Round Backplate | `H1-1BP-R LEFT` |
| `H1-1BP-S` | Square Backplate | `H1-1BP-S LEFT` |
| `H1-1BP-V` | Vertical Backplate | `H1-1BP-V LEFT` |

**Coverplates (same)**

| Item # | Description | Node name |
|---|---|---|
| `H1-1CP-H` | Horizontal Coverplate (Hidden Fasteners) | `H1-1CP-H LEFT` |
| `H1-1CP-R` | Round Coverplate (Hidden Fasteners) | `H1-1CP-R LEFT` |
| `H1-1CP-S` | Square Coverplate (Hidden Fasteners) | `H1-1CP-S LEFT` |
| `H1-1CP-V` | Vertical Coverplate (Hidden Fasteners) | `H1-1CP-V LEFT` |

**Finials (endTreatment = FINIAL)**

| Item # | Description | Node name |
|---|---|---|
| `H1-1BF` | BALL FINIAL | `H1-1BF LEFT` |
| `H1-1CC` | PILLOW FINIAL- PAINTED | `H1-1CC LEFT` |
| `H1-1GF` | GEM FINIAL | `H1-1GF LEFT` |
| `H1-1KF` | KNOB FINIAL | `H1-1KF LEFT` |

**End caps (endTreatment = FINIAL)**

| Item # | Description | Node name |
|---|---|---|
| `H1-1EC` | END CAP | `H1-1EC LEFT` |

**Pole stub (~12-16", TRUE diameter)**

| Item # | Description | Node name |
|---|---|---|
| `H1-1R` | 1" ROUND POLE | `H1-1R CENTER` |

**Rings (each option its own node)**

| Item # | Description | Node name |
|---|---|---|
| `H1-1BPR` | PASSING RING | `H1-1BPR SHARED` |
| `H1-1BR` | STRAIGHT EDGE RING | `H1-1BR SHARED` |

**End treatments (shared)**

| Geometry | Node name | Load-Choices setup | Goes in |
|---|---|---|---|
| French bent rod (1", true bend radius) | `<bend fee item#> LEFT` | endTreatment = FRENCH RETURN | E + 6 only |
| Miter rod | `<miter fee item#> LEFT` | endTreatment = MITER RETURN | E + 6 only |
| Inside-mount barrel | `H1-1IM LEFT` | endTreatment = INSIDE MOUNT | all three |

## Assembly `H1-1 SPEC 3-5/8"` — arms for this cell

| Item # | Description | Node name | Flags |
|---|---|---|---|
| `H1-1BS` | Basic Bracket (3-5/8" P) | `H1-1BS LEFT` | basic |
| `H1-1DS` | Decorative Bracket (3-5/8" P) | `H1-1DS LEFT` | — |
| `H1-1ILPS` | In Line Passing Bracket (3-5/8" P) | `H1-1ILPS LEFT` | inl-bkt |
| `H1-1ILS` | In Line Bracket (3-5/8" P) | `H1-1ILS LEFT` | inl-bkt |
| `H1-1PS` | Passing Bracket (3-5/8" P) | `H1-1PS LEFT` | — |

## Assembly `H1-1 SPEC 4-5/8"` — arms for this cell

| Item # | Description | Node name | Flags |
|---|---|---|---|
| `H1-1BE` | Basic Bracket (4-5/8" P) | `H1-1BE LEFT` | basic |
| `H1-1DE` | Decorative Bracket (4-5/8" P) | `H1-1DE LEFT` | — |
| `H1-1ILE` | In Line Bracket (4-5/8" P) | `H1-1ILE LEFT` | inl-bkt |
| `H1-1ILPE` | In Line Passing Bracket (4-5/8" P) | `H1-1ILPE LEFT` | inl-bkt |
| `H1-1PE` | Passing Bracket (4-5/8" P) | `H1-1PE LEFT` | — |

## Assembly `H1-1 SPEC 6"` — arms for this cell

| Item # | Description | Node name | Flags |
|---|---|---|---|
| `H1-1B6` | Basic Bracket (6" P) | `H1-1B6 LEFT` | basic |
| `H1-1D6` | Decorative Bracket (6" P) | `H1-1D6 LEFT` | — |
| `H1-1IL6` | In Line Bracket (6" P) | `H1-1IL6 LEFT` | inl-bkt |
| `H1-1ILP6` | In Line Passing Bracket (6" P) | `H1-1ILP6 LEFT` | inl-bkt |
| `H1-1P6` | Passing Bracket (6" P) | `H1-1P6 LEFT` | — |


---

# 1-3/8" ROUND — three assemblies

## Shared 1-3/8" set — model once, upload into all three assemblies

**Backplates (wall-mount mesh nested inside each)**

| Item # | Description | Node name |
|---|---|---|
| `H1-138BP-H` | Horizontal Backplate | `H1-138BP-H LEFT` |
| `H1-138BP-R` | Round Backplate | `H1-138BP-R LEFT` |
| `H1-138BP-S` | Square Backplate | `H1-138BP-S LEFT` |
| `H1-138BP-V` | Vertical Backplate | `H1-138BP-V LEFT` |

**Coverplates (same)**

| Item # | Description | Node name |
|---|---|---|
| `H1-138CP-H` | Horizontal Coverplate (Hidden Fasteners) | `H1-138CP-H LEFT` |
| `H1-138CP-R` | Round Coverplate (Hidden Fasteners) | `H1-138CP-R LEFT` |
| `H1-138CP-S` | Square Coverplate (Hidden Fasteners) | `H1-138CP-S LEFT` |
| `H1-138CP-V` | Vertical Coverplate (Hidden Fasteners) | `H1-138CP-V LEFT` |

**Finials (endTreatment = FINIAL)**

| Item # | Description | Node name |
|---|---|---|
| `H1-138AGF` | ACRYLIC GEM FINIAL W/ PAINTED COLLAR | `H1-138AGF LEFT` |
| `H1-138BF` | BALL FINIAL | `H1-138BF LEFT` |
| `H1-138CC` | PILLOW FINIAL | `H1-138CC LEFT` |
| `H1-138GF` | GEM FINIAL | `H1-138GF LEFT` |
| `H1-138KF` | KNOB FINIAL | `H1-138KF LEFT` |
| `H1-138WBF` | WOOD BALL FINIAL | `H1-138WBF LEFT` |
| `H1-138WCC` | WOOD PILLOW FINIAL | `H1-138WCC LEFT` |
| `H1-138WKF` | WOOD KNOB FINIAL | `H1-138WKF LEFT` |

**End caps (endTreatment = FINIAL)**

| Item # | Description | Node name |
|---|---|---|
| `H1-138EC` | END CAP | `H1-138EC LEFT` |
| `H1-138WEC` | WOOD END CAP | `H1-138WEC LEFT` |

**Pole stub (~12-16", TRUE diameter)**

| Item # | Description | Node name |
|---|---|---|
| `H1-138R` | 1 3/8" ROUND POLE | `H1-138R CENTER` |
| `H1-138WR` | 1 3/8" WOOD POLE | `H1-138WR CENTER` |

**Rings (each option its own node)**

| Item # | Description | Node name |
|---|---|---|
| `H1-138BPR` | PASSING RING | `H1-138BPR SHARED` |
| `H1-138BR` | STRAIGHT EDGE RING | `H1-138BR SHARED` |
| `H1-138WRNG` | WOOD RING | `H1-138WRNG SHARED` |

**End treatments (shared)**

| Geometry | Node name | Load-Choices setup | Goes in |
|---|---|---|---|
| French bent rod (1-3/8", true bend radius) | `<bend fee item#> LEFT` | endTreatment = FRENCH RETURN | E + 6 only |
| Miter rod | `<miter fee item#> LEFT` | endTreatment = MITER RETURN | E + 6 only |
| Inside-mount barrel | `H1-138IM LEFT` | endTreatment = INSIDE MOUNT | all three |

**1-3/8" wood & acrylic (TRUE-dimension exports of the production models)**

| Item # | Description | Node name |
|---|---|---|
| `H1-138WBF` | Wood Ball Finial (shell) | `H1-138WBF LEFT` |
| `H1-138WKF` | Wood Knob Finial | `H1-138WKF LEFT` |
| `H1-138WCC` | Wood Classic Cap | `H1-138WCC LEFT` |
| `H1-138WEC` | Wood End Cap | `H1-138WEC LEFT` |
| `H1-138AGF` | Acrylic Gem Finial | `H1-138AGF LEFT` |
| `H1-138ABF` | Acrylic Ball Finial | `H1-138ABF LEFT` |
| `H1-138AKF` | Acrylic Knob Finial | `H1-138AKF LEFT` |
| `H1-138WR` | Wood Pole (shell) | `H1-138WR CENTER` |
| `H1-138AR` | Acrylic Pole | `H1-138AR CENTER` |
| `H1-138WRNG` | Wood Ring (shell) | `H1-138WRNG SHARED` |

## Assembly `H1-138 SPEC 3-5/8"` — arms for this cell

| Item # | Description | Node name | Flags |
|---|---|---|---|
| `H1-138BS` | Basic Bracket (3-5/8" P) | `H1-138BS LEFT` | basic |
| `H1-138DS` | Decorative Bracket (3-5/8" P) | `H1-138DS LEFT` | — |
| `H1-138ILJL` | In Line Joining Loop Bracket (3-5/8" P) | `H1-138ILJL LEFT` | inl-bkt |
| `H1-138ILPS` | In Line Passing Bracket (3-5/8" P) | `H1-138ILPS LEFT` | inl-bkt |
| `H1-138ILS` | In Line Bracket (3-5/8" P) | `H1-138ILS LEFT` | inl-bkt |
| `H1-138PS` | Passing Bracket (3-5/8" P) | `H1-138PS LEFT` | — |
| `H1-138WSB` | Wood Bracket (3-5/8" P) | `H1-138WSB LEFT` | — |

## Assembly `H1-138 SPEC 4-5/8"` — arms for this cell

| Item # | Description | Node name | Flags |
|---|---|---|---|
| `H1-138BE` | Basic Bracket (4-5/8" P) | `H1-138BE LEFT` | basic |
| `H1-138DE` | Decorative Bracket (4-5/8" P) | `H1-138DE LEFT` | — |
| `H1-138ILE` | In Line Bracket (4-5/8" P) | `H1-138ILE LEFT` | inl-bkt |
| `H1-138ILJLE` | In Line Joining Loop Bracket (4-5/8" P) | `H1-138ILJLE LEFT` | inl-bkt |
| `H1-138ILPE` | In Line Passing Bracket (4-5/8" P) | `H1-138ILPE LEFT` | inl-bkt |
| `H1-138PE` | Passing Bracket (4-5/8" P) | `H1-138PE LEFT` | — |
| `H1-138WEB` | Wood Bracket (4-5/8" P) | `H1-138WEB LEFT` | — |

## Assembly `H1-138 SPEC 6"` — arms for this cell

| Item # | Description | Node name | Flags |
|---|---|---|---|
| `H1-138B6` | Basic Bracket (6" P) | `H1-138B6 LEFT` | basic |
| `H1-138D6` | Decorative Bracket (6" P) | `H1-138D6 LEFT` | — |
| `H1-138IL6` | In Line Bracket (6" P) | `H1-138IL6 LEFT` | inl-bkt |
| `H1-138ILJL6` | In Line Joining Loop Bracket (6" P) | `H1-138ILJL6 LEFT` | inl-bkt |
| `H1-138ILP6` | In Line Passing Bracket (6" P) | `H1-138ILP6 LEFT` | inl-bkt |
| `H1-138P6` | Passing Bracket (6" P) | `H1-138P6 LEFT` | — |
| `H1-138W6B` | Wood Bracket (6" P) | `H1-138W6B LEFT` | — |

---

# IMPORT — same 5 steps for every assembly (you or the designer, in the app)

1. **1.6 → New assembly** → name it (`H1-1 SPEC 4-5/8` etc.) → STANDARD template.
2. **Upload** each GLB to its slot: arms → bracket slot · plates → backplate slot · finials +
   bends + IM → finial slot · pole → pole slot · rings → ring slot. (Shared pieces = the same
   files re-uploaded per assembly.)
3. **Load Choices**: item #s auto-match from node names. Set flags per the tables (basic /
   inl-bkt on arms; endTreatment on bends + IM; "RETURN plates" cluster chip at 3/4" E + 6).
4. **BOM Engine → ⚖ Flow Alignment Scan** on the new assembly → apply fixes.
5. **BOM Engine → 📐 Spec Sheets** → set wall-mount top-hole offsets (once per mount CODE —
   the config is shared, so later assemblies inherit them) → Print / PDF.

Never link a spec assembly to a CPQ flow, and never add these projections to the production
flow master.

# BUILD ORDER (fastest path to full coverage)

1. `H1-75 SPEC 3-5/8`: run 📐 on the OLD 3.625 assembly first — if wall-mount details render,
   it's done free; if not, rebuild from re-exports (arms from the old sources + the 4-5/8
   master's plate/finial/pole exports).
2. `H1-75 SPEC 6`: only 5 new arm models (B6/IL6/ILP6/D6/P6) + shared 3/4" re-exports.
3. `H1-1 SPEC 4-5/8` → then `3-5/8` → then `6` (shared 1" set modeled once).
4. `H1-138 SPEC 4-5/8` → `3-5/8` → `6` (+ ILJL arms; wood/acrylic set in all three).
