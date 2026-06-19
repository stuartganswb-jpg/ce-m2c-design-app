# SOP 2 — Using the Vision Hardware Tool with the CPQ

**Who this is for:** sales / estimating. You measure a job, spec the hardware, and push it into the CPQ to configure, price, and quote.
**Prerequisite:** the product's CPQ flow must already exist (see SOP 1). Vision picks a flow; it can't invent one.

---

## Step 1 — Open the tool and start a session

1. Go to **Tab 9 Client Vision** ("Client Vision System").
2. Set **Scene Type:** to **Drapery Hardware**. This loads the Vision Hardware tool.
3. In the session bar:
   - **1. Select Customer (Initializes Session)** — choose the customer. This starts the session and creates the quote id. (The workspace stays dimmed until a customer is selected.)
   - **2. Project / Job Name (Optional)** — e.g. "Master Suite Reno."
4. Inside the tool, use the middle tab **2. Hardware Engine** — that's where estimating happens. (Tab **1. Plan Take-Offs** is for uploading a floor plan and drawing measurements; Tab **3. Visual Overlay** is for client-facing visuals.)

---

## Step 2 — Pick the matching CPQ flow

In **"1. Line Item Details & CPQ Flow"**:
- **Line Item Sidemark** — name the window/run (e.g. "Master Bath"). Required.
- **Assign Hardware Collection (CPQ)** — choose the flow from **"-- SELECT MATCHING CPQ FLOW --"**. Pick the flow that matches this job's configuration (e.g. *Flat Iron · Wall · Finial*).

When you pick a flow, its **fabrication preset** (bay configuration, end style, projection from SOP 1) auto-seeds the inputs below — so choosing the right focused flow does most of the setup for you.

---

## Step 3 — Enter the spatial parameters ("2. Spatial Parameters")

- **Input mode:** **Use Ordering Length (Pole)** or **Use Wall Dimensions** (how you're giving the width).
- **Bay Configuration:** **Straight Pole / Mitered Bay (3-Seg) / Curved Bay**.
- **Mount:** for straight poles you set **Left / Center / Right**, each **Open / Inside / Ceiling**. (Mitered/Bow uses **Ends / Center**.)
- **Widths:** the width fields relabel to match the shape and input mode (Left/Center/Right ordering or wall dimensions; Bow shows **Bow Depth**). Mitered also asks **L Angle / R Angle**.

---

## Step 4 — Fabrication settings ("3. Fabrication Settings")

- **Brackets:** **Left End Bracket**, **Right End Bracket**, **Center Bracket (passing)** — the lists are filtered by the chosen flow and narrowed by each side's mount (Open→wall brackets, Ceiling→ceiling, Inside→inside-mount).
- **Backplates:** Left / Right / Center backplate pickers.
- **⚙ Auto-Place Brackets** (straight poles) — lays out end + center brackets using the standard spacing rule as editable markers you can nudge.
- **Projection (in)** — usually seeded by the flow/bracket; override only for custom.
- **End Style · Left / Right:** **Flush Cut / Finials / Miter Return / Bent Return (FR)**. These auto-set from mount + bracket (Inside → Flush; a return bracket → Miter), so usually you just confirm.
- **Manual Dimension Overrides** (collapsed) — bracket width/thickness, pole diameter, bend radius (for bent returns), grip allowance, inside-mount deduct. Auto-filled from the chosen bracket; open only for one-offs.

You can also click on the drawing to drop **Bracket / Splice / Note** markers (with distances) for an exact takeoff.

---

## Step 5 — Read the outputs

The bottom panels compute and show the fabrication math:
- **Client Details & Ordering:** **Pole O2O**, **Total System O2O (+ Brackets)** with a breakdown, per-section wall C2C, End Style, Projection (flags **CUSTOM** if non-standard).
- **Shop Floor BOM & Raw Cuts:** raw tube cuts, **Total Splices Req**, **Total Brackets Req**.
- A live **SVG elevation drawing** with dimensions, miter angles, bracket/splice markers, and end treatments.
- The **Engineering Export (To CPQ)** summary lists Pole Length, Brackets, Rec. Rings, Finials, Splices, Miters, Bent Returns — what will carry into the CPQ.

---

## Step 6 — Push to the CPQ

1. Click **Save Line & Draw Next** (in the quote panel footer). It's disabled until a flow and a bracket are chosen.
2. This saves the line as a **draft** (all your measurements, bracket/backplate picks, mounts, end styles, counts, and the drawing). The canvas clears for the next window, and the **Lines Queued** counter ticks up.
3. Repeat Steps 2–6 for each window in the job.
4. When all windows are entered, click **Push Configs to CPQ** in the session bar — this jumps you to **Tab 8 CPQ Configurator** with your job loaded.

---

## Step 7 — Finish in the CPQ

1. The CPQ opens with the customer **locked to your job** and a **"Lines Awaiting Configuration"** list (one row per window/sidemark).
2. Click **Configure** on a line. The CPQ **auto-selects** what Vision already chose — the brackets, the mount, the backplates — and seeds the dimensions. An **Engineering Specs / Vision Picks** strip shows the numbers to match (recommended counts, hanger drill points, fees to add).
3. Walk the steps with **Back / Next Step**. **Enter the bracket/center quantities** from the on-screen note (these are intentionally left for you to confirm).
4. On the last step, set **Total QTY** and click **Add to Quote Cart**. The line is now priced and configured.
5. Repeat **Configure** for each remaining line. When the cart has everything, click **Checkout (N Items)**, review, and **finalize the quote**.

> What you've built: each window becomes a priced, configured line tied to one master quote, with the 3D config and the fabrication math attached for the floor.

---

### Common stumbles
- **No brackets in a picker** → you haven't picked the flow yet (left bracket reads "-- Select CPQ Flow First --"), or the brackets aren't tagged for that mount in Node Grouping.
- **Wrong flow** → if the bay/end style looks off after selecting, you likely picked the wrong focused flow; change **Assign Hardware Collection (CPQ)**.
- **Quantities show 0 in CPQ** → expected; enter them from the Vision Picks note on each step.
