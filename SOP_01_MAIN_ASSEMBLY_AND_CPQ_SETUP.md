# SOP 1 — Setting Up a Main Assembly & Its CPQ Flow

**Who this is for:** the person who builds a product so it can be configured, rendered, and priced in the CPQ.
**Examples used throughout:** **Flat Iron** (M2C brand) and **Brimar FR / Brimar Signature** (Classical Elements brand) — both straight-pole drapery hardware.
**Focus:** setup → node grouping → generate the flow → edit the steps → **pricing & customer pricing**.

> Tip: switch to the correct **brand** first (top of HQ). Flat Iron lives in M2C; Brimar lives in Classical Elements.

---

## Before you start — what makes an assembly a "Main Assembly"

An assembly only appears in Node Grouping / the flow tools when **both** are true:

1. **It is flagged MAIN.** In **Tab 1.4 BOM Engine**, the assembly's **"Routing Classification"** dropdown must be set to **MAIN** (not Unassigned/Standard). This is what marks it as the top-level product that drives a CPQ flow.
2. **It has a 3D model (.glb).** Upload the model in **Tab 1 Inception** (the file picker accepts `.glb`, or use **"Upload Revision"**). It is stored on the assembly as its CAD model. Without it, Node Grouping shows *"Please upload a 3D CAD model to manage nodes."*

So: Flat Iron and Brimar must each be Routing Classification = **MAIN** and have their `.glb` uploaded before the steps below.

---

## Part A — Node Grouping (Tab 1.5): tag the model so it can render

This is where you teach the model which meshes are brackets, poles, finials, etc., and where they sit (left/right, wall/ceiling). Everything the CPQ shows or hides depends on this.

### A1. Select the assembly
- Use the **Search / Project / Status** filters on the left. Status chips read **Awaiting CAD**, **Needs Clustering**, or **Clustered (n)**.
- Click the assembly card (e.g. **Flat Iron**). The 3D model loads in the center viewer. Camera tip: *right-click & drag to pan*.

### A2. Auto-Group the parts
1. Click **⚡ Auto-Group (n)** (top-right of the viewer; n = parts detected). This opens the **"Group by Location & Position"** panel.
2. Choose **Split by Position** (one cluster per physical instance, each labeled LEFT/CENTER/RIGHT) — this is what you want for hardware. (*Merge Instances* lumps all copies into one; use only for parts that are truly one group.)
3. **⇄ Flip L/R** — **this is the Brimar fix.** Flat Iron's model is built so screen-left = LEFT automatically. Brimar is mirrored, so its left/right come out swapped — toggle **Flip L/R** once and the labels correct for the whole assembly. (Setting is remembered per assembly.)
4. Click **Select all**, then **⛓ From Library** — this auto-fills each group's **Location** and **Category** from the matched library part (the most reliable tagging). You can also bulk-tag with the **WALL / CEILING / END** and **BRACKET / POLE / FINIAL / BACKPLATE / RING** buttons under "Tag checked:".
5. Review each row's **Loc:** and **Cat:** tags; fix any that are wrong with the per-row buttons. Use **✎ Edit** on a row to click meshes in 3D and add/remove them from that group.
6. Click **Save Clusters**.

### A3. Verify with Locate (the "glow")
- In the **Saved BOM Bindings** list, click **Locate** on a cluster — it lights that cluster's meshes gold in 3D and fades everything else. This is how you confirm a cluster contains *exactly* the right meshes (e.g. the center bracket is really the center bracket). If it lights up extra/foreign parts, fix it (re-Edit or split) before generating a flow.
- **Highlight Unassigned** (viewer toolbar) glows any meshes not yet in a cluster red — use it to catch leftovers.

### A4. Fix a mislabeled cluster anytime (no re-run needed)
Each saved cluster card has **WALL/CEILING/END**, **LEFT/CENTER/RIGHT**, and category buttons. Click the right one to correct it — only that tag changes, the meshes stay. (**Clear all** wipes the assembly's clusters to start over.)

### What the tags do downstream
- **Category** (BRACKET/POLE/FINIAL/BACKPLATE/RING) — what the part is; the flow generator builds a step per category.
- **Location** (WALL/CEILING/END) — the mount context; controls which parts show for a given mount.
- **Position** (LEFT/CENTER/RIGHT) — which physical spot; CENTER is what the "passing bracket" clone uses.

---

## Part B — Generate the CPQ flow (Tab 11 System Admin → "CPQ Flow Builder")

1. Open **Tab 11 System Admin → CPQ Flow Builder**.
2. Under **"Active CPQ Flows"**, find the **"— assembly to generate from —"** dropdown, pick your assembly (e.g. Flat Iron), and click **⚙ Generate Flow from Tags**.
3. This reads your clusters + pins and creates one flow with a standard step set: **Pole / Rod Material**, **Pole Length & Finish**, per-position **Bracket & Mount** steps (center marked "clone along pole"), per-end **End Treatment**, **Rings**, **Splice**, **Cut / Splice Fee**.

> One flow = one configuration. The builder is **1:1 with a bay configuration + end style + projection** (the "Fabrication Preset" block). So you generate a separate flow for each mount/end combination you sell (e.g. Flat Iron · Wall · Finial; Flat Iron · Ceiling · Miter). Name them clearly.

---

## Part C — Edit the flow & its steps

Click a flow card to load it. You'll edit two levels: the whole flow, then each step.

### Flow-level settings
- **Link to Master Assembly** — ties the flow to the 3D model (must match the assembly you grouped). This is what makes it render.
- **CPQ Flow Name**, **ERP Item ID**, **Base Price ($)** — the flow's identity and starting price.
- **Fabrication Preset** — **Bay Configuration / End Style / Bracket Projection** — stamps what config this flow represents (these auto-seed the Vision tool later).
- **Default Finishes (cascade to every step)** + **Apply to all steps ↓** — set the finish options once for the whole flow.
- **Hide Geometry (other configs)** — force-hide clusters this configuration never shows.
- **Save and Cascade to Master** when done.

### The step editor
Each step row shows **Step N: <title>**, its Type, Data, and Required flag, with **⬆️/⬇️** to reorder, **Edit**, and **Del**. In the editor, the key fields:

- **Title** — what the customer sees ("Select Bracket Style").
- **Type** — choose how the step behaves:
  - **Choose / Swap Style** (`STYLE_SWAP`) — curated BOM items the customer swaps between; each option carries its own price and 3D mesh. Use for brackets, poles, finials.
  - **Dropdown List** (`DROPDOWN`) — pick one from a data source (e.g. finishes, rings).
  - **Visual Grid / Visual Grid + Dimensions** — image/swatch picker (+ a size calculator).
  - **Dimensional Input Only** (`DIMENSIONS`) — a measurement, priced by a calculator template.
  - **Static Fee / Quantity** (`STATIC_FEE`) — a flat fee × quantity (splices, cut fees).
- **Clone along pole (center passing bracket)** — check on the center bracket step; the chosen bracket is cloned by the step quantity and spaced down the pole in 3D.
- **Tag-driven Mount selector** + **Applies to position** — a step that shows only the parts matching the chosen mount (Wall/Ceiling/Inside).
- **Restrict Options** — limit which library items/finishes this step offers.
- **Style Options** (STYLE_SWAP) — tick which BOM items can be swapped; each gets a **price**, a **Z** layer, and **Proj″**. Optionally **"Also let the customer pick a Finish for the chosen style."**
- **Geometry Swap (Mesh)** / **Inspect 3D Nodes** — which meshes an option shows (auto-filled from your clusters; verify with Inspect).
- **Required Step** — must be answered before quoting.

---

## Part D — Pricing (how a quote total is built)

The engine sums, in this order, and shows a live **Pricing Breakdown** / **Config Total**:

1. **Base assembly price** — the assembly's base price (or the flow's **Base Price** if no assembly).
2. **For each step:**
   - **Step Base Price** (if set) — set under **Item Mapping & Base Price**; the **Fetch** button pulls the linked part's base price automatically.
   - **+ Option native price** — the selected part's own base price (for Choose/Swap, the per-option **price** you set in Style Options wins).
   - **+ Upcharge** — the per-option **Upcharge ($)** in the Option Properties table (`priceMap`).
   - **× quantity** (and any multiplier).
3. **Flat Price Override ($)** — under **Pricing Rules**, if set, *replaces* that step's whole price (ignores native + upcharge). Use to force a fixed price.
4. **Static fees** — STATIC_FEE steps add their amount × qty.

**Rule of thumb:** per step the price is **Override (if set), otherwise Base + Native + Upcharge**, then × qty. Set component prices from the BOM by using **Fetch**, and use **Upcharge** for "this option costs more than the default," and **Override** only when you want to ignore everything else.

---

## Part E — Customer pricing (private-label / per-client)

1. In the CPQ run screen, use the top **"Active Customer:"** dropdown ("-- Select Customer to Activate Live Client Pricing --"). Until a customer is chosen, the customer sees **base MSRP**.
2. On each part you can store **client pricing** (the customer's own SKU and their price). For a step to use it, turn on **"Enable Client-Specific Pricing"** (`useClientPricing`) in the step's **Pricing Rules**.
3. With a customer active + client pricing enabled + a matching entry on the part, that step prices at the **customer's price** instead of the base price.

**Resolution order:** **Flat Price Override** beats everything → otherwise **client price** (when customer + client pricing on) → otherwise **base/native price**. Upcharges still add unless an override is set. (Note: the engine currently prices off the client `price`; client SKU is stored for paperwork.)

---

## Part F — Verify it works

1. Open **Tab 8 CPQ Configurator**, **Step 1: Select Flow**, pick your flow.
2. The model should render a complete default configuration. Step through; each pick should swap the right part in 3D (use the option's geometry to confirm).
3. Pick a customer and confirm the price shifts to client pricing where you enabled it.
4. If a part shows in the wrong place or not at all, it's a **grouping** issue — go back to Node Grouping and use **Locate** to find the bad cluster.

---

### Quick worked examples
- **Flat Iron (M2C):** Auto-Group → Split by Position → From Library → Save → Locate-check the center bracket → Generate Flow from Tags → set prices via Fetch + Upcharges → test in CPQ.
- **Brimar (Classical Elements):** same, but **toggle ⇄ Flip L/R** in Auto-Group first (its model is mirrored), then proceed identically. Verify with Locate that LEFT is the on-screen left before generating the flow.
