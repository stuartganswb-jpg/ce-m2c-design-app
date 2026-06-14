# Brief — Automating Fusion 360 → CPQ "Main Assembly" .glb for the H1 collections

**For:** our designer (Mac) · **From:** Stuart + Claude Code
**Goal:** turn a family of individual Fusion part assemblies into **one master `.glb` per
diameter** that drops straight into our web app's CPQ pipeline (Auto-Group → Auto-Assign
BOM → CPQ flows) with almost no hand work.

This repeats **identically 3×** — `H1-75` (¾″ round), `H1-1` (1″), `H1-138` (1⅜″). Same
parts, same layout, different diameter. Build the H1-75 master first; the other two are
copy-paste with the diameter swapped.

Attached with this brief:
- **`H1-75_Collection_Review.xlsx`** — the 33 base parts categorised (role, mount, L/C/R,
  projection, proposed CPQ step). Stuart reviews/confirms the `CONFIRM` columns first.
- **`fusion_build_main_assembly.py`** — Fusion script that places + names every part.
- **`blender_process_glb.py`** — headless Blender cleanup + GLB export.

---

## 1. The pipeline at a glance

```
Fusion 360                     Blender (optional)        Web app (we handle)
individual part   ──build──>   cleanup + force-opaque ──> Inception: upload .glb
assemblies        master .f3d   export .glb               Node Grouping: ⚡ Auto-Group
(you have these)  + EXPORT                                Visual Assembly: ⚡ Auto-Assign BOM
                                                          CPQ Builder: 3 flows + projection + hide
```

The **one job in Fusion** is to assemble all the variant parts into a single master, each
placed at its CPQ position and **named with its part code**. Everything after that is
either a headless Blender pass or clicks in our app.

---

## 2. THE CRITICAL PART — what the `.glb` must look like for our app

Our renderer (react-three-fiber + `useGLTF`) and our **Auto-Group** / **Auto-Assign**
tools make specific assumptions. Get these right and the rest is automatic.

1. **One root, flat top level.** The master has a single root node; its **direct
   children are the selectable components**. Auto-Group reads exactly those direct
   children and turns each into a cluster. Don't bury parts 5 groups deep — one level of
   named sub-assemblies under the root.

2. **Name every top-level component with its base part CODE** (from the spreadsheet:
   `H1-75BR`, `H1-75BF`, `H1-75CB`, …). **No `/color` suffix** — color is a finish applied
   in CPQ, not geometry. This is the linchpin:
   - Auto-Group labels repeats **LEFT / CENTER / RIGHT** automatically from geometry.
   - **Auto-Assign BOM matches each cluster to the library part whose `legacyErpId`
     equals that code.** If the names match the codes, the whole BOM builds in one click.
   - Repeats keep `CODE LEFT` / `CODE CENTER` / `CODE RIGHT` — the app strips the position
     when matching, so they all map to the right part but stay independent.

3. **Position repeats along ONE axis.** Brackets/plates go at three points (Left / Center
   / Right); finials & end caps at the two ends. Auto-Group decides L/C/R from the world
   position along the longest axis, so keep the rod axis as the dominant spread.

4. **Overlap the option set at each position.** All 6 wall-bracket designs sit at the SAME
   L/C/R points, overlapping. That overlap *is* the "Choose / Swap Style" set — the CPQ
   flow shows one and hides the rest. Same for the 4 finials at each end, the backplate
   shapes, etc.

5. **Export materials OPAQUE.** Fusion tends to export steel as `alphaMode: BLEND`, which
   three.js treats as transparent → parts render see-through / behind the pole. The app
   force-opaques as a backstop, but **set steel/metal to Opaque at the source** (Blender
   step does this too). Single solid material per finish is fine — color is re-applied in
   CPQ; you don't need to bake the 8 finishes into the mesh.

6. **Scale / units — just be consistent.** Fusion exports inches/mm with a nested
   transform (~0.0254 root, ~0.3937 inner). Our app already works in world space and
   handles that, so you don't need to "fix" scale — just export the whole family the same
   way each time.

7. **Mesh names don't matter; parent names do.** Fusion names meshes generically
   (`Body1.017`). That's fine — Auto-Group reads the **component/parent** names (your
   codes). Keep your naming on the occurrences/components, not the bodies.

---

## 3. Fusion 360 — build the master assembly

Use **`fusion_build_main_assembly.py`** (Scripts and Add-Ins → green ▶ → script folder).
It's a template; you fill three things:

- **`PARTS`** — for each code in the spreadsheet, where the part lives (a component
  already in the design, or an external `.f3d` path) and which positions it occupies.
- **`LCR_POS_IN` / `END_POS_IN`** — the Left/Center/Right and end X-positions (inches) for
  this diameter. Eyeball them so variants overlap cleanly at each spot.
- **Export** — this is the part that's *specific to your setup*, so **the brief can't
  guess it.** Tell Claude Code your exact Fusion export recipe: target format into Blender
  (FBX vs OBJ vs glTF), whether you "Save As Mesh" or use the glTF exporter, refinement /
  tessellation quality, and units. Those settings are what give the clean result — fill
  them in the prompt below.

The script names each occurrence with the code (single-position parts → bare code;
repeats → `CODE LEFT/CENTER/RIGHT`), which is exactly what step 2 above needs.

> Note: the Fusion API calls in the template (`importToTarget`,
> `occurrences.addExistingComponent`, transforms) are the right shapes but may need small
> adjustments to your Fusion version / how your parts are stored. Claude Code will finalize
> them against your actual files — that's why the prompt asks for your file layout.

---

## 4. Blender (optional, lower priority)

If you post-process in Blender, **`blender_process_glb.py`** runs headless and emits the
web-ready GLB (preserves hierarchy + names, forces materials opaque, binary GLB, +Y up):

```
/Applications/Blender.app/Contents/MacOS/Blender --background \
    --python blender_process_glb.py -- INPUT.fbx OUTPUT.glb
```

Adjust the importer line to whatever Fusion hands off. You said Blender is the fast part
for you, so this is a convenience — the must-have is the Fusion master.

---

## 5. Downstream in the app (we do this — here so you see the whole loop)

Once the `.glb` exists, naming = codes makes this nearly one-click:
1. **Inception** → create/select the master assembly → upload the `.glb`.
2. **Node Grouping Studio** → **⚡ Auto-Group** → 33 clusters appear, repeats labelled
   L/C/R → Save. (Hide any hidden helper parts here.)
3. **Visual Assembly** → **⚡ Auto-Assign BOM** → matches every cluster to its library
   part by code → review → Assign. The BOM is built.
4. **CPQ Builder** → 3 flows (Wall / Ceiling / Inside-Mount), each: Choose-Style steps for
   bracket / finial / plate, **per-option projection** (e.g. 3.625″ vs 4.625″ arms),
   **Hide-Geometry** to hide the other configs, finishes cascade, rollup item.

The closer the master's names are to the codes, the less hand-fixing in steps 2–4.

---

## 6. THE PROMPT to paste into Claude Code (team environment)

> I'm automating our Fusion-360-to-web-CPQ pipeline for the **H1-75** curtain-hardware
> family (then identically for H1-1 and H1-138). I have a brief
> (`BRIEF_Fusion_to_CPQ_Pipeline.md`), a reviewed parts spreadsheet
> (`H1-75_Collection_Review.xlsx`), and starter scripts
> (`fusion_build_main_assembly.py`, `blender_process_glb.py`). Please finalize the Fusion
> script to build our CPQ "main assembly" and the Blender GLB export.
>
> **Here's what only I can provide — please ask me for any of these you need:**
> 1. **File locations:** my Fusion part files live at `____` (one `.f3d` per design, OR
>    all components inside one master design named `____`). The mapping of part code →
>    file/component name is `____` (or: read it from the spreadsheet's Base Code + Name).
> 2. **My Fusion export settings (specific — this gets the desired effect):** I export to
>    `____` (FBX / OBJ / glTF) using `____` (Save As Mesh / glTF exporter / add-in), with
>    refinement/tessellation = `____`, units = `____`, and `____` other options.
> 3. **Layout numbers** for this diameter: rod length `____`″, Left/Center/Right bracket X
>    = `____`, end (finial) X = `____`.
>
> **Everything about the target is in the brief** — the .glb must have a single root with
> the selectable parts as named top-level components, each named with the base code (no
> /color), repeats placed at Left/Center/Right (or the two ends) overlapping, materials
> opaque, hierarchy/names preserved through to GLB. Build it so re-running for H1-1 and
> H1-138 only needs the diameter + file paths swapped.

That's the whole ask — Claude Code has the brief + spreadsheet + starter scripts and only
needs the three `____` answers from you.

---

## 7. What Stuart still needs to confirm (before the designer runs it)

- **Open the spreadsheet and check the `CONFIRM` columns** — especially:
  - which 6 codes are the "wall bracket" choices vs. the ceiling (`H1-75CB`) / inside-mount
    (`H1-75IM`) ones;
  - which 4 are backplates vs. 4 cover plates, and which are the "for Returns" twins
    (`RBP-*` / `RCP-*`) that live at the return/end positions, not the main wall;
  - which 4 are the end **finials** (Ball `BF` / Gem `GF` / Knob `KF` + an End Cap),
    and whether `EC` vs `CC` (Classic End Cap) both count.
- The L/C/R + Wall/Ceiling/End "X" columns are my best guess — correct any.

## 8. Mac specifics
- Fusion scripts: **Utilities → Add-Ins → Scripts** → add the script's folder → Run.
- Blender headless path on Mac: `/Applications/Blender.app/Contents/MacOS/Blender`.
- Python is built into both Fusion (its own bundled Python) and Blender — no install
  needed for the scripts.

## 9. The 8 finishes (color codes — applied in CPQ, not geometry)
`/EP1` Satin Nickel · `/EP2` Polished Nickel · `/EP3` Satin Brass · `/EP4` Satin Gold ·
`/EP5` Aged Brass · `/EP6` Oil Rubbed Bronze · `/P` Painted Finish · `/P25` Satin Steel.
You do **not** model these — one opaque material per part is enough; CPQ swaps the finish.
