# SPEC MASTER MANIFESTS — modeling checklists for the per-diameter dimension masters

> For the designer. One SPEC MASTER assembly per rod diameter, built in **1.6 Assembly Builder**
> (New assembly → STANDARD template → upload each mesh as a slot choice). These assemblies exist
> ONLY to feed the 📐 Spec Sheets tool (BOM Engine) — they are NEVER linked to a CPQ flow, so every
> projection is modeled as a plain bracket choice. **All geometry at TRUE physical dimensions
> (meters, real-world scale) — the sheets print 1:1 and every dimension is measured from these
> meshes. No scaling, no guessing.**
>
> Node naming = `<ITEM#> <POSITION>` exactly — that's what auto-matches items in Load Choices.
> **Only LEFT-side geometry is needed** (the sheet tool draws one side) — half the work of a
> production master. Pole = CENTER, rings = SHARED.
>
> Wall-mount plates: model INSIDE each backplate/coverplate choice node, mesh named with its real
> code (containing CPWP / BPWP / IMWP — the sheet tool detects them by that pattern). Reuse the
> 3/4" wall-mount meshes only if the physical mounts are identical at that size — confirm first.
>
> Existing geometry to RE-EXPORT instead of remodeling: the 3/4"×4-5/8" production master (E arms,
> plates incl. return copies, finials, rings, pole, bends) and the old 3.625" assembly (S arms).
> The 6" arms and everything at 1" / 1-3/8" are new modeling.


---

## SPEC MASTER — 3/4" ROUND  (suggested name: `H1-75 SPEC MASTER`)

### Bracket arms — one choice node each · cluster BRACKET · WALL · LEFT

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-75B6` | Basic Bracket (6" P) | `H1-75B6 LEFT` | basic |
| `H1-75BD` | Basic Double Bracket (3-1/4" & 6-1/2" P) | `H1-75BD LEFT` | basic |
| `H1-75BE` | Basic Bracket (4-5/8" P) | `H1-75BE LEFT` | basic |
| `H1-75BS` | Basic Bracket (3-5/8" P) | `H1-75BS LEFT` | basic |
| `H1-75CB` | Ceiling Bracket (3/4" P) | `H1-75CB LEFT` | — |
| `H1-75D` | Decorative Double Bracket (3-1/4" & 6-1/2" P) | `H1-75D LEFT` | — |
| `H1-75D6` | Decorative Bracket (6" P) | `H1-75D6 LEFT` | — |
| `H1-75DE` | Decorative Bracket (4-5/8" P) | `H1-75DE LEFT` | — |
| `H1-75DS` | Decorative Bracket (3-5/8" P) | `H1-75DS LEFT` | — |
| `H1-75IL6` | In Line Bracket (6" P) | `H1-75IL6 LEFT` | inl-bkt |
| `H1-75ILD` | In Line Double Bracket (3-1/4" & 6-1/2" P) | `H1-75ILD LEFT` | inl-bkt |
| `H1-75ILE` | In Line Bracket (4-5/8" P) | `H1-75ILE LEFT` | inl-bkt |
| `H1-75ILP6` | In Line Passing Bracket (6" P) | `H1-75ILP6 LEFT` | inl-bkt |
| `H1-75ILPE` | In Line Passing Bracket (4-5/8" P) | `H1-75ILPE LEFT` | inl-bkt |
| `H1-75ILPS` | In Line Passing Bracket (3-5/8" P) | `H1-75ILPS LEFT` | inl-bkt |
| `H1-75ILS` | In Line Bracket (3-5/8" P) | `H1-75ILS LEFT` | inl-bkt |
| `H1-75IM` | Inside Mount | `H1-75IM LEFT` | goes in the FINIAL cluster — see End Treatments |
| `H1-75P6` | Passing Bracket (6" P) | `H1-75P6 LEFT` | — |
| `H1-75PE` | Passing Bracket (4-5/8" P) | `H1-75PE LEFT` | — |
| `H1-75PS` | Passing Bracket (3-5/8" P) | `H1-75PS LEFT` | — |

### Backplates — cluster BACKPLATE · WALL · LEFT (wall-mount mesh nested inside each)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-75BP-H` | Horizontal Backplate | `H1-75BP-H LEFT` | — |
| `H1-75BP-R` | Round Backplate | `H1-75BP-R LEFT` | — |
| `H1-75BP-S` | Square Backplate | `H1-75BP-S LEFT` | — |
| `H1-75BP-V` | Vertical Backplate | `H1-75BP-V LEFT` | — |

### Coverplates — same plate cluster

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-75CP-H` | Horizontal Coverplate (Hidden Fasteners) | `H1-75CP-H LEFT` | — |
| `H1-75CP-R` | Round Coverplate (Hidden Fasteners) | `H1-75CP-R LEFT` | — |
| `H1-75CP-S` | Square Coverplate (Hidden Fasteners) | `H1-75CP-S LEFT` | — |
| `H1-75CP-V` | Vertical Coverplate (Hidden Fasteners) | `H1-75CP-V LEFT` | — |

### RETURN backplates (3/4" only) — separate BACKPLATE cluster with chip "RETURN plates"

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-75RBP-H` | Horizontal Backplate for Returns | `H1-75RBP-H LEFT` | rtn-only (cluster chip "RETURN plates") |
| `H1-75RBP-R` | Round Backplate for Returns | `H1-75RBP-R LEFT` | rtn-only (cluster chip "RETURN plates") |
| `H1-75RBP-S` | Square Backplate for Returns | `H1-75RBP-S LEFT` | rtn-only (cluster chip "RETURN plates") |
| `H1-75RBP-V` | Vertical Backplate for Returns | `H1-75RBP-V LEFT` | rtn-only (cluster chip "RETURN plates") |

### RETURN coverplates — same return cluster

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-75RCP-H` | Horizontal Coverplate for Returns (Hidden Fasteners) | `H1-75RCP-H LEFT` | rtn-only (cluster chip "RETURN plates") |
| `H1-75RCP-R` | Round Coverplate for Returns (Hidden Fasteners) | `H1-75RCP-R LEFT` | rtn-only (cluster chip "RETURN plates") |
| `H1-75RCP-S` | Square Coverplate for Returns (Hidden Fasteners) | `H1-75RCP-S LEFT` | rtn-only (cluster chip "RETURN plates") |
| `H1-75RCP-V` | Vertical Coverplate for Returns (Hidden Fasteners) | `H1-75RCP-V LEFT` | rtn-only (cluster chip "RETURN plates") |

### Finials — cluster FINIAL · END · LEFT (endTreatment = FINIAL)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-75BF` | BALL FINIAL | `H1-75BF LEFT` | — |
| `H1-75CC` | PILLOW FINIAL- PAINTED | `H1-75CC LEFT` | — |
| `H1-75GF` | GEM FINIAL | `H1-75GF LEFT` | — |
| `H1-75KF` | KNOB FINIAL | `H1-75KF LEFT` | — |

### End caps — same finial cluster (endTreatment = FINIAL)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-75EC` | END CAP | `H1-75EC LEFT` | — |

### Pole — cluster POLE · CENTER (short display rod, TRUE diameter)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-75R` | 3/4" ROUND POLE | `H1-75R CENTER` | — |

### Rings — cluster RING · SHARED (each option its own choice node)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-75BPR` | PASSING RING | `H1-75BPR SHARED` | — |
| `H1-75BR` | STRAIGHT EDGE RING | `H1-75BR SHARED` | — |

### Accessories (joiners) — OPTIONAL on sheets, skip in v1

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-75R-JNR` | 3/4" ROUND POLE SPLICE | `H1-75R-JNR LEFT` | — |

### Return / inside-mount end treatments — extra choices in the finial cluster
| Geometry | Node name | Load-Choices setup |
|---|---|---|
| French-return bent rod — true bend radius at this rod size | `<bend fee item#> LEFT` | endTreatment = FRENCH RETURN (auto-flags fee) |
| Miter-return rod | `<miter fee item#> LEFT` | endTreatment = MITER RETURN |
| Inside-mount barrel | `H1-75IM LEFT` | endTreatment = INSIDE MOUNT |


---

## SPEC MASTER — 1" ROUND  (suggested name: `H1-1 SPEC MASTER`)

### Bracket arms — one choice node each · cluster BRACKET · WALL · LEFT

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-1B6` | Basic Bracket (6" P) | `H1-1B6 LEFT` | basic |
| `H1-1BD` | Basic Double Bracket (3-1/4" & 6-1/2" P) | `H1-1BD LEFT` | basic |
| `H1-1BE` | Basic Bracket (4-5/8" P) | `H1-1BE LEFT` | basic |
| `H1-1BS` | Basic Bracket (3-5/8" P) | `H1-1BS LEFT` | basic |
| `H1-1CB` | Ceiling Bracket (3/4" P) | `H1-1CB LEFT` | — |
| `H1-1D` | Decorative Double Bracket (3-1/4" & 6-1/2" P) | `H1-1D LEFT` | — |
| `H1-1D6` | Decorative Bracket (6" P) | `H1-1D6 LEFT` | — |
| `H1-1DE` | Decorative Bracket (4-5/8" P) | `H1-1DE LEFT` | — |
| `H1-1DS` | Decorative Bracket (3-5/8" P) | `H1-1DS LEFT` | — |
| `H1-1IL6` | In Line Bracket (6" P) | `H1-1IL6 LEFT` | inl-bkt |
| `H1-1ILD` | In Line Double Bracket (3-1/4" & 6-1/2" P) | `H1-1ILD LEFT` | inl-bkt |
| `H1-1ILE` | In Line Bracket (4-5/8" P) | `H1-1ILE LEFT` | inl-bkt |
| `H1-1ILP6` | In Line Passing Bracket (6" P) | `H1-1ILP6 LEFT` | inl-bkt |
| `H1-1ILPE` | In Line Passing Bracket (4-5/8" P) | `H1-1ILPE LEFT` | inl-bkt |
| `H1-1ILPS` | In Line Passing Bracket (3-5/8" P) | `H1-1ILPS LEFT` | inl-bkt |
| `H1-1ILS` | In Line Bracket (3-5/8" P) | `H1-1ILS LEFT` | inl-bkt |
| `H1-1IM` | Inside Mount | `H1-1IM LEFT` | goes in the FINIAL cluster — see End Treatments |
| `H1-1P6` | Passing Bracket (6" P) | `H1-1P6 LEFT` | — |
| `H1-1PE` | Passing Bracket (4-5/8" P) | `H1-1PE LEFT` | — |
| `H1-1PS` | Passing Bracket (3-5/8" P) | `H1-1PS LEFT` | — |

### Backplates — cluster BACKPLATE · WALL · LEFT (wall-mount mesh nested inside each)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-1BP-H` | Horizontal Backplate | `H1-1BP-H LEFT` | — |
| `H1-1BP-R` | Round Backplate | `H1-1BP-R LEFT` | — |
| `H1-1BP-S` | Square Backplate | `H1-1BP-S LEFT` | — |
| `H1-1BP-V` | Vertical Backplate | `H1-1BP-V LEFT` | — |

### Coverplates — same plate cluster

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-1CP-H` | Horizontal Coverplate (Hidden Fasteners) | `H1-1CP-H LEFT` | — |
| `H1-1CP-R` | Round Coverplate (Hidden Fasteners) | `H1-1CP-R LEFT` | — |
| `H1-1CP-S` | Square Coverplate (Hidden Fasteners) | `H1-1CP-S LEFT` | — |
| `H1-1CP-V` | Vertical Coverplate (Hidden Fasteners) | `H1-1CP-V LEFT` | — |

### Finials — cluster FINIAL · END · LEFT (endTreatment = FINIAL)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-1BF` | BALL FINIAL | `H1-1BF LEFT` | — |
| `H1-1CC` | PILLOW FINIAL- PAINTED | `H1-1CC LEFT` | — |
| `H1-1GF` | GEM FINIAL | `H1-1GF LEFT` | — |
| `H1-1KF` | KNOB FINIAL | `H1-1KF LEFT` | — |

### End caps — same finial cluster (endTreatment = FINIAL)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-1EC` | END CAP | `H1-1EC LEFT` | — |

### Pole — cluster POLE · CENTER (short display rod, TRUE diameter)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-1R` | 1" ROUND POLE | `H1-1R CENTER` | — |

### Rings — cluster RING · SHARED (each option its own choice node)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-1BPR` | PASSING RING | `H1-1BPR SHARED` | — |
| `H1-1BR` | STRAIGHT EDGE RING | `H1-1BR SHARED` | — |

### Accessories (joiners) — OPTIONAL on sheets, skip in v1

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-1JNR` | 1" ROUND POLE SPLICE | `H1-1JNR LEFT` | — |

### Return / inside-mount end treatments — extra choices in the finial cluster
| Geometry | Node name | Load-Choices setup |
|---|---|---|
| French-return bent rod — true bend radius at this rod size | `<bend fee item#> LEFT` | endTreatment = FRENCH RETURN (auto-flags fee) |
| Miter-return rod | `<miter fee item#> LEFT` | endTreatment = MITER RETURN |
| Inside-mount barrel | `H1-1IM LEFT` | endTreatment = INSIDE MOUNT |


---

## SPEC MASTER — 1-3/8" ROUND  (suggested name: `H1-138 SPEC MASTER`)

### Bracket arms — one choice node each · cluster BRACKET · WALL · LEFT

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-138B6` | Basic Bracket (6" P) | `H1-138B6 LEFT` | basic |
| `H1-138BD` | Basic Double Bracket (3-1/4" & 6-1/2" P) | `H1-138BD LEFT` | basic |
| `H1-138BE` | Basic Bracket (4-5/8" P) | `H1-138BE LEFT` | basic |
| `H1-138BS` | Basic Bracket (3-5/8" P) | `H1-138BS LEFT` | basic |
| `H1-138CB` | Ceiling Bracket (3/4" P) | `H1-138CB LEFT` | — |
| `H1-138D` | Decorative Double Bracket (3-1/4" & 6-1/2" P) | `H1-138D LEFT` | — |
| `H1-138D6` | Decorative Bracket (6" P) | `H1-138D6 LEFT` | — |
| `H1-138DE` | Decorative Bracket (4-5/8" P) | `H1-138DE LEFT` | — |
| `H1-138DS` | Decorative Bracket (3-5/8" P) | `H1-138DS LEFT` | — |
| `H1-138IL6` | In Line Bracket (6" P) | `H1-138IL6 LEFT` | inl-bkt |
| `H1-138ILD` | In Line Double Bracket (3-1/4" & 6-1/2" P) | `H1-138ILD LEFT` | inl-bkt |
| `H1-138ILE` | In Line Bracket (4-5/8" P) | `H1-138ILE LEFT` | inl-bkt |
| `H1-138ILJL` | In Line Joining Loop Bracket (3-5/8" P) | `H1-138ILJL LEFT` | inl-bkt |
| `H1-138ILJL6` | In Line Joining Loop Bracket (6" P) | `H1-138ILJL6 LEFT` | inl-bkt |
| `H1-138ILJLE` | In Line Joining Loop Bracket (4-5/8" P) | `H1-138ILJLE LEFT` | inl-bkt |
| `H1-138ILP6` | In Line Passing Bracket (6" P) | `H1-138ILP6 LEFT` | inl-bkt |
| `H1-138ILPE` | In Line Passing Bracket (4-5/8" P) | `H1-138ILPE LEFT` | inl-bkt |
| `H1-138ILPS` | In Line Passing Bracket (3-5/8" P) | `H1-138ILPS LEFT` | inl-bkt |
| `H1-138ILS` | In Line Bracket (3-5/8" P) | `H1-138ILS LEFT` | inl-bkt |
| `H1-138IM` | Inside Mount | `H1-138IM LEFT` | goes in the FINIAL cluster — see End Treatments |
| `H1-138P6` | Passing Bracket (6" P) | `H1-138P6 LEFT` | — |
| `H1-138PE` | Passing Bracket (4-5/8" P) | `H1-138PE LEFT` | — |
| `H1-138PS` | Passing Bracket (3-5/8" P) | `H1-138PS LEFT` | — |
| `H1-138W6B` | Wood Bracket (6" P) | `H1-138W6B LEFT` | — |
| `H1-138WDB` | Wood Double Bracket (3-1/4" & 6-1/2" P) | `H1-138WDB LEFT` | — |
| `H1-138WEB` | Wood Bracket (4-5/8" P) | `H1-138WEB LEFT` | — |
| `H1-138WSB` | Wood Bracket (3-5/8" P) | `H1-138WSB LEFT` | — |

### Backplates — cluster BACKPLATE · WALL · LEFT (wall-mount mesh nested inside each)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-138BP-H` | Horizontal Backplate | `H1-138BP-H LEFT` | — |
| `H1-138BP-R` | Round Backplate | `H1-138BP-R LEFT` | — |
| `H1-138BP-S` | Square Backplate | `H1-138BP-S LEFT` | — |
| `H1-138BP-V` | Vertical Backplate | `H1-138BP-V LEFT` | — |

### Coverplates — same plate cluster

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-138CP-H` | Horizontal Coverplate (Hidden Fasteners) | `H1-138CP-H LEFT` | — |
| `H1-138CP-R` | Round Coverplate (Hidden Fasteners) | `H1-138CP-R LEFT` | — |
| `H1-138CP-S` | Square Coverplate (Hidden Fasteners) | `H1-138CP-S LEFT` | — |
| `H1-138CP-V` | Vertical Coverplate (Hidden Fasteners) | `H1-138CP-V LEFT` | — |

### Finials — cluster FINIAL · END · LEFT (endTreatment = FINIAL)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-138AGF` | ACRYLIC GEM FINIAL W/ PAINTED COLLAR | `H1-138AGF LEFT` | — |
| `H1-138BF` | BALL FINIAL | `H1-138BF LEFT` | — |
| `H1-138CC` | PILLOW FINIAL | `H1-138CC LEFT` | — |
| `H1-138GF` | GEM FINIAL | `H1-138GF LEFT` | — |
| `H1-138KF` | KNOB FINIAL | `H1-138KF LEFT` | — |
| `H1-138WBF` | WOOD BALL FINIAL | `H1-138WBF LEFT` | — |
| `H1-138WCC` | WOOD PILLOW FINIAL | `H1-138WCC LEFT` | — |
| `H1-138WKF` | WOOD KNOB FINIAL | `H1-138WKF LEFT` | — |

### End caps — same finial cluster (endTreatment = FINIAL)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-138EC` | END CAP | `H1-138EC LEFT` | — |
| `H1-138WEC` | WOOD END CAP | `H1-138WEC LEFT` | — |

### Pole — cluster POLE · CENTER (short display rod, TRUE diameter)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-138R` | 1 3/8" ROUND POLE | `H1-138R CENTER` | — |
| `H1-138WR` | 1 3/8" WOOD POLE | `H1-138WR CENTER` | — |

### Rings — cluster RING · SHARED (each option its own choice node)

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-138BPR` | PASSING RING | `H1-138BPR SHARED` | — |
| `H1-138BR` | STRAIGHT EDGE RING | `H1-138BR SHARED` | — |
| `H1-138WRNG` | WOOD RING | `H1-138WRNG SHARED` | — |

### Accessories (joiners) — OPTIONAL on sheets, skip in v1

| Item # | Description | Node name | Load-Choices flags |
|---|---|---|---|
| `H1-138JNR` | 1 3/8" ROUND POLE SPLICE | `H1-138JNR LEFT` | — |

### Return / inside-mount end treatments — extra choices in the finial cluster
| Geometry | Node name | Load-Choices setup |
|---|---|---|
| French-return bent rod — true bend radius at this rod size | `<bend fee item#> LEFT` | endTreatment = FRENCH RETURN (auto-flags fee) |
| Miter-return rod | `<miter fee item#> LEFT` | endTreatment = MITER RETURN |
| Inside-mount barrel | `H1-138IM LEFT` | endTreatment = INSIDE MOUNT |

### 1-3/8" extras — wood & acrylic (add when the NetSuite items exist)
| Item # | Description | Node name | Notes |
|---|---|---|---|
| `H1-138WBF` | Wood Ball Finial (shell) | `H1-138WBF LEFT` | finish -O/-W picks the species |
| `H1-138WKF` | Wood Knob Finial (shell) | `H1-138WKF LEFT` | — |
| `H1-138WCC` | Wood Classic Cap (shell) | `H1-138WCC LEFT` | — |
| `H1-138WEC` | Wood End Cap (shell) | `H1-138WEC LEFT` | — |
| `H1-138WR` | Wood Pole (shell) | `H1-138WR CENTER` | finish resolves WHTOAK / WLNUT |
| `H1-138WRNG` | Wood Ring (shell — create in NS first) | `H1-138WRNG SHARED` | — |
| `H1-138AGF` | Acrylic Gem Finial | `H1-138AGF LEFT` | — |
| `H1-138ABF` | Acrylic Ball Finial (create in NS first) | `H1-138ABF LEFT` | — |
| `H1-138AKF` | Acrylic Knob Finial (create in NS first) | `H1-138AKF LEFT` | — |
| `H1-138AR` | Acrylic Pole (create in NS first) | `H1-138AR CENTER` | — |

---

## After upload (per spec master, ~10 minutes)

1. **1.6 → Load Choices**: item #s auto-match from node names; set the flags per the tables above.
2. **BOM Engine → ⚖ Flow Alignment Scan** on the spec master → apply its fixes (validates tags
   without needing a flow).
3. **BOM Engine → 📐 Spec Sheets** → pages generate per bracket × plate family. Enter the
   wall-mount top-hole offsets once in the Wall mounts panel (drives the as-mounted dims).
4. The Fabricut-codes edition works automatically — pattern ids come from the imported
   cross-reference data on each item.

## Division of labor

- **3/4"**: mostly re-export (current production master + old 3.625 assembly) + model the three 6" arms.
- **1"**: full set at 1" cradle dims (projections are the same 3-5/8 / 4-5/8 / 6).
- **1-3/8"**: full set + the ILJL arms + wood/acrylic extras when their NetSuite items exist.

## Boundaries (don't cross these)

- Spec masters are **never** linked to a flow — the combined flow keeps its own 75×4-5/8" master.
- Do **not** add other projections/diameters to the production flow master: the generator would
  offer them as bracket choices and fight the Projection question.
- The old `FABRICUT H1 - .75" … 3.625" PROJECTION` **flow** can be deleted once its S-arm geometry
  has been re-exported into the 3/4" spec master. Keep the old **assembly** until then.
