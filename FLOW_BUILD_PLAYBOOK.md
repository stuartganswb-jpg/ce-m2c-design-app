# CPQ FLOW BUILD PLAYBOOK — the one true method (Fabricut H1 pattern)

> The repeatable recipe for extending or building size-matrix CPQ flows. Written 2026-07-11 against
> the live system (size matrix + species finishes + price levels all shipped). The legacy tooling
> (Auto-Sync BOM, manual mesh wiring, empty-flow auto-create, Danger Zone) was REMOVED 2026-07-11 —
> a flow with a linked assembly now shows only the generated-flow editor: prices, finishes,
> required, fee amounts, and Regenerate. If a control isn't visible, the generator owns it.

## THE METHOD IN ONE PARAGRAPH

Model choices as GLB slots in **1.6** → assign item #s + tags in **Load Choices** → the generator
(**tab 11 → Regenerate Steps from Tags**) builds every CPQ step from the tags → items carry all
pricing (NetSuite basePrice + imported Fabricut levels) → CPQ runtime, Vision, spec sheets, and the
NetSuite push all read the same tags and resolve size/species/finish per selection. You never
hand-author steps; you model, tag, price the ITEMS, and regenerate.

---

## PART A — MONDAY'S JOB: add wood + acrylic rods & finials (1-3/8" only) to the H1 flow

### A1. Data prerequisites (team, before modeling)

**NetSuite items** (flag `sync_to_cpq` on every one):
- ✅ Already exist: `H1-138WHTOAK`, `H1-138WLNUT` (by-foot wood poles); species finials/caps
  `H1-138WBF-O/-W`, `WKF-O/-W`, `WCC-O/-W`, `WEC-O/-W`; shells `H1-138WBF/WKF/WCC/WEC`;
  wood rings `H1-138WRNG-O/-W`; acrylic gem `H1-138AGF`.
- ❌ Still to create: shells **`H1-138WR`** (wood pole) + **`H1-138WRNG`** (wood ring);
  acrylic **`H1-138AR`** (pole), **`H1-138ABF`**, **`H1-138AKF`** (finials).
  (Shells = plain base items, like the mill bases: pins anchor them, imports stamp them,
  the finish resolves the species. Without a shell, walnut can't resolve from an oak pin.)

**Cross-reference sheet** (`Fabricut/Fabricut_CE_CrossReferenceJuly9.xlsx`):
- ✅ Already has: wood finial/cap/ring rows (suffixless, single-price), `H1-138WR` pole row.
- ❌ Re-add the acrylic rows that were removed July 10: `H1-138AR`, `H1-138ABF`, `H1-138AKF`
  (+ keep `H1-138AGF`), suffixless, with the Fabricut codes + Retail/Wholesale/Sale prices.
- Collection = `1 3/8" ROUND` (space or dash — both accepted).

**Then in-app**: tab 11.1 → **Sync Master Library** → **Import Fabricut Pricing** (re-upload the
sheet — fully idempotent). This stamps prices + size keys + the wood pole's species map
(`H1-138WR → WHTOAK/WLNUT` is automatic).

**Finishes** (tab 4.5 → Master Finishes): confirm/create **White Oak** with BOM Species Suffix
`-O` and **Walnut** with `-W`. Acrylic items are single-finish — no suffix, no finish needed.

### A2. Modeling (1.6)

1. **1.6 → Extend: FABRICUT H1 assembly** (extend mode — existing geometry/tags untouched).
2. Upload the new meshes as **added choices on the existing slots**:
   - POLE slot: wood rod mesh + acrylic rod mesh (node names `H1-138WR CENTER`,
     `H1-138AR CENTER` — item # + position is what auto-matches).
   - LEFT/RIGHT finial slots: wood ball/knob/classic-cap + acrylic ball/knob/gem meshes
     (`H1-138WBF LEFT`, etc. — model LEFT + RIGHT copies like the metal finials).
   - RING slot: wood ring mesh (`H1-138WRNG SHARED`).
3. **Load Choices**: assign each new choice its item # (**the SHELL codes**: `H1-138WR`,
   `H1-138WBF`, `H1-138AR`…, never the -O/-W items — the finish picks the species).
   Finial-slot choices: END TREATMENT = FINIAL (default). No other flags needed.
4. Save / merge.

### A3. Regenerate + scope finishes (tab 11)

1. Select the FABRICUT H1 flow → **↻ Regenerate Steps from Tags (keep prices)**.
   - Because the POLE cluster now has >1 material, the generator emits a
     **"Pole / Rod Material"** chooser automatically. Wood/acrylic finials join the End
     Treatment steps. Nothing else to build.
2. Per-option finish scoping (the ONE legitimate manual edit): on the new wood options set
   finishAllowedOptions = White Oak + Walnut; on acrylic options = none (or a clear-coat
   entry if you want a swatch to show). Metal options keep the default finish list.

### A4. What the engine now does automatically (verify, don't build)

- Wood/acrylic options **appear only at 1-3/8"** (size-native gating — flipping to ¾"/1"
  hides them and clears any such selection).
- Picking White Oak on a wood finial → BOM/cart/push consume `H1-138WBF-O`; Walnut → `-W`;
  wood pole → `H1-138WHTOAK`/`WLNUT` by the foot.
- Price levels: wood/acrylic items price from their imported rows at all four levels
  (suffixless rows price the base AND the -O/-W siblings identically).
- Spec sheets pick up the new finial choices on their catalog page automatically.

### A5. Verify (5 minutes)

1-3/8" selected → Pole Material lists metal/white-oak-walnut-wood/acrylic; pick wood + White
Oak → cart shows `H1-138WHTOAK` per foot; finial wood + Walnut → `H1-138WBF-W`; flip Diameter
to 1" → wood/acrylic options vanish, selections clear to metal defaults; flip levels →
Fabricut Cost shows `our id — desc · pattern id`, Wholesale/Retail show pattern ids.

---

## PART B — BUILDING A BRAND-NEW FLOW (same manner, from zero)

1. **Items first** (skip what exists): 1.6 → Item Starter Kit → download template → fill →
   upload (creates library items under a Project). For Fabricut-priced collections, add the
   rows to the cross-reference workbook instead/als and run the Import (it stamps pricing +
   size keys; NetSuite merge-or-create in 11.1 links or creates the NetSuite side).
2. **Model in 1.6**: one slot per choice-position (pole, L/R/C brackets, L/R/C backplates,
   L/R finials+returns, rings). Node naming `<ITEM#> <POSITION>`. Multiple choices per slot =
   stacked meshes, each named for its item.
3. **Load Choices**: assign item # + tags per choice — END TREATMENT on finial-slot choices
   (FINIAL / FRENCH_RETURN / MITER_RETURN / INSIDE_MOUNT; returns auto-flag fee), and the
   flag checkboxes where they apply: `fee`, `hide`, `basic` (no backplate), `inl-bkt`
   (in-line bracket → inline plates), `end-arm` (bracket that IS the end), `rtn-only` /
   `inl-only` (plate pools).
4. **Generate** (tab 11): pick the assembly → **⚙ Generate Flow from Tags**. Set flow name,
   ERP id, rollup item, base price, default finishes (**Apply to all steps**).
5. **Size matrix**: automatic — if the pinned parts carry family size keys (from the import),
   the Rod Diameter + Projection steps inject themselves. No config.
6. **Prices**: items carry pricing (NetSuite basePrice via Sync; Fabricut levels via Import).
   Author option prices ONLY for fees (returns) — never for parts.
7. **Audit**: BOM Engine → **⚖ Flow Alignment Scan** → fix → regenerate if it says so.
8. **Test the matrix**: defaults ≙ master; flip sizes; flip levels; push a test quote.

## RULES OF THUMB

- **Never hand-add steps to a generated flow** — regenerate would not preserve them the way
  you expect. Model + tag + regenerate instead.
- Regenerate preserves per-option **price, layerZ, projection, hidesBracket, finish scoping**
  (matched by step title + option id) and all flow settings. Everything else is rebuilt from
  tags — which is the point.
- Pins anchor **shell/base items**; finishes resolve `/P`, `/EPn`, `-O`, `-W`; sizes resolve
  the diameter/projection code. One part per pin, always the base.
- If a picker shows something wrong, fix the TAGS (1.5/1.6) or the ITEM data — not the flow.

## SPEC SHEETS FOR ALL SIZES (added 2026-07-11)

Sheets measure TRUE geometry — they never use the flow's render scaling. Each rod diameter gets a
**SPEC MASTER** assembly (dimension-only, never flow-linked) built in 1.6 from true-scale slot
GLBs; the 📐 tool then generates that diameter's full catalog (every projection is just a bracket
choice there). The complete modeling checklists — every item #, node name, and Load-Choices flag,
generated from the live import data — are in `SPEC_MASTER_MANIFESTS.md`. Never add other
projections/diameters to the production flow master; that's what the spec masters are for.
