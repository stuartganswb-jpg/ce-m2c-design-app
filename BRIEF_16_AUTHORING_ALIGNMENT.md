# Brief — 1.6 authoring alignment + 1.5 slot locator

*Written 2026-09-03 from Stuart's ask, by the Brief E session (sales side), which is NOT taking
this work — it is handed to a fresh linked session so Brief E's context stays on the sales spine.
Scope: **tab 1.6 Assembly Builder** (`src/components/HQ/AssemblyBuilderTab.js`, 3,201 lines) and
**tab 1.5 Node Grouping** (`src/components/HQ/NodeClusterTab.js`, 1,429 lines). Driver: finishing
the **H1-2TRV** load, where the designer and Stuart cannot see the same tags and cannot agree
which slot is which.*

## ⛔ WORKING AGREEMENT (Stuart, 2026-08-31) — binds this session

1. **Plan first, always** — state the plan and WAIT for approval before editing code, shipping or
   changing production data. Reading and measuring need no permission; changing does.
2. **Requested scope only.** Adjacent problems get NAMED, not fixed. Both files are long, heavily
   commented and load-bearing; every comment in them records an incident. Do not tidy.
3. **No temporary fixes.** Fix the cause or say it cannot be done properly and stop.
4. **Look downstream.** 1.6 and 1.5 are the AUTHORING truth: a tag written here becomes the CPQ
   flow's options, the 3D engine's visibility, the spec sheet's pages, the BOM's pins and the
   floor's router. Trace every change through the generator, `hardwareModel`/`hardwareAdapter`,
   the SpecSheet and the BOM before touching a field name.

**Standing rules S1 and S2 apply** (`BRIEF_A_WO_PO_CREATION.md` top): **S1 tags before code** —
this brief is the purest form of that rule, since the whole ask is "let the tag be reachable";
**S2 the guide moves with the code** — `UserGuideTab.js` gets the 1.6/1.5 sections (see §6).

## ⚠ TERRITORY — these files belong to Brief F

`AssemblyBuilderTab.js` (1.6) and `NodeClusterTab.js` (1.5) are listed as **Brief F's** files
(`SYSTEM_FLOW_AUDIT.md` §11: *"the tag engine + Kits + Spec Sheets + 1.6 … `AssemblyBuilderTab.js`
(1.6), `NodeClusterTab.js`"*). Brief F's own F6/F7 backlog touches 1.6 (the data pass with Stuart;
the untagged-geometry window).

**Before editing:** run `ListAgents`, message the Brief F session (`SendMessage`, ask
*"are you in AssemblyBuilderTab.js or NodeClusterTab.js?"*), wait for "not mine", and tell the
integration session (it holds the map and routes hand-offs). Five or six sessions work this repo
at once. If F is mid-edit in either file, this work waits or lands as a patch spec into F's brief —
Stuart decides, not you.

**Git:** never switch branches in the shared checkout; stage ONLY these files;
`git pull --rebase --autostash origin main` before every push; fix-forward on main;
`npx --no-install eslint <path>` → **0 errors** (pre-existing warnings are fine);
`CI=false npx --no-install react-scripts build` before pushing a change this large.
1.6 and 1.5 are **lazy chunks** — verify a deploy by sweeping `/asset-manifest.json`, never
`main.*.js` alone, with plain-ASCII string-literal markers.

---

## 1. The three asks, in Stuart's words (2026-09-03)

1. *"on 1.6 when using the extend feature the designer does not see the same tag choices as i do
   when i load choices on already built. can you please align that"*
2. *"also can you please label each slot with the load order and arrange on 1.6 in the order that
   she loads them, we often have discussions of which tags need applying and it is difficult to be
   aligned on data"*
3. *"the 1.5 Node grouping tool it would be of much better help if on the right hand side you could
   display the same slots and when selected there the items in that slot would be the ones that
   glow so that we can identify the location, on these larger assemblies with multiple tracks and
   rods it can be hard for the designer to tag them all correctly"*

**Why now:** H1-2TRV is a traverse assembly with **multiple tracks and rods**. Every tag that
disambiguates those — `traverseRole`, `driveType`, `trvSetup`, `tier` — is exactly what the
designer's screen does not offer (§2). So she loads geometry she cannot tag, and Stuart re-tags it
afterwards from a different screen with different controls and a different projection data shape.
That is the whole problem, and it is a UI-parity problem, not a data-model problem.

---

## 2. Ask 1 — the divergence, measured

> **POST-CHANGE STATE (2026-09-03, Brief F session):** every row of the 2a table is now reachable on the
> slot row — both renderers mount ONE `ChoiceTagControls` component (`bb52947`, `c7d42bd`), so the
> table below describes the code as it was this morning. The projection grammar (2b) is one grammar
> on both screens; the `basic` tooltip is the assign row's; the three slot seeds carry the 2c keys.
> Load order (§3) and the 1.5 locator (§4) shipped `411c7c6` / `383489b`. See
> `BRIEF_16_AUTHORING_ALIGNMENT_HANDOFF.md`.


There are **two paths that produce the same thing** (a `choices[]` row per geometry node) and
**two different renderers** for it. The data model is already identical; the UI is not.

| path | who uses it | seed | row renderer |
|---|---|---|---|
| **Build / Extend slot rows** | the DESIGNER, uploading .glb into slots (incl. Extend) | `:535` (slot drop), `:611` (`splitSlotChoice`), `:1550` (re-match) | **`:2916–3012`** |
| **Load Choices (assign) rows** | STUART, on an already-built assembly | `:1377` (from saved pins + 1.5 cluster flags) | **`:2583–2846`** |

Both write pins through near-identical writers — Build at **`:817–844`**, assign at
**`:1984–1989`** — and **both writers already persist every field below**. So a tag missing from
the slot row is not unsupported: it is unreachable.

### 2a. Controls the Load Choices row has and the slot row does NOT

| tag | field | Load Choices | why it matters for H1-2TRV |
|---|---|---|---|
| **TRAVERSE ROLE** | `traverseRole` | `:2681` | FASCIA / TRACK / … — **the** traverse tag. Unreachable to the designer. |
| **DRIVE** | `driveType` | `:2685` | MOTORIZED / MANUAL, blank = both. |
| **SETUP** | `trvSetup` | `:2692` | SINGLE / DOUBLE per bracket and per track. |
| **TIER** | `tier` | `:2700` | FRONT / BACK — *which rod of a double a part belongs to*. This is the "multiple tracks and rods" tag. |
| **PASSING** | `passing` | `:2713` | STANDARD / PASSING — centre bracket + rings. |
| **ALWAYS SHOWN** | `alwaysShown` | `:2718` | present in every configuration, never offered. |
| **MATERIALS** (+ derived `noFinish`) | `materials`, `noFinish` | `:2661–2671` | metal / wood / clear — gates which finishes are offered. |
| **NO PLATE** | `noBackplate` | `:2641` | an end treatment that mounts without a backplate. |
| **designer note** | `note` → `designerNote` | `:2601` | the field for *"I am not sure how to tag this"*. Its absence is why these discussions happen in chat instead of on the row. |
| **swatch image** | `imgUrl` | `:2603` | hybrid material rail. |
| **re-map node** | `nodeName` | `:2611` | assign-only; probably correct to stay assign-only (see §5 Q3). |

### 2b. Controls that exist on BOTH but disagree

- **PROJECTIONS.** Load Choices (`:2755`) is a **multi-tick list** and additionally understands a
  **per-rod syntax** (`String(c.projInches).includes(':')`, e.g. `FRONT:4.625,6`). The slot row
  (`:2976`) is a **single-value `<select>`**. A part the designer loads can therefore only ever be
  one projection, and a double's two rods cannot be expressed at all. This is a data-shape
  divergence, not a cosmetic one: the same field carries two grammars depending on which screen
  wrote it.
- **BASIC** means two different things in the two tooltips: assign `:2637` says *"BASIC = ONE
  PIECE. The arm and the backplate are combined into a single part"*; slot `:2952` says *"Basic
  bracket: takes NO backplate"*. Same flag, two explanations — and `noBackplate` exists as its own
  separate flag on the assign row only. One of those descriptions is wrong; **Brief F's rule is
  that `basic` is a CONSTRUCTION fact (one piece)** (`BRIEF_F_KITS_SPEC_SHEETS.md` §3, *"learned
  the hard way twice in one day"*). The slot tooltip is the one to correct.
- **RETURN BACKPLATE** (`returnOnly`): slot `:3000` vs assign `:2831` — same flag, wording differs.
  Harmless, worth unifying while the strings are being touched.

### 2c. The seeds are missing keys too

The slot-path seeds (`:535`, `:611`, `:1550`) build the row object **without** `passing`,
`noFinish`, `materials`, `noBackplate`, `parked`; the assign seed (`:1377`) has all of them. Adding
the controls therefore also means adding those keys to the three seeds, or the first keystroke on a
new control writes onto an object shape that never had the field.

### Fix shape (recommended)

**Extract ONE `<ChoiceTagRow>` component** used by both renderers, driven by props for the few
genuine differences (assign-only: node re-map, delete-choice, `parked` display; slot-only: nothing
found). One tooltip per tag, one grammar per field, and a new tag becomes reachable on both screens
in one edit forever after. Do it in **two commits**: (1) extract the component with the assign row
as the source of truth and prove `git diff -w` leaves assign behaviour byte-identical; (2) mount it
in the slot rows, extend the three seeds, delete the divergent slot markup. If extraction turns out
to be too invasive to keep behaviour identical, say so and stop — do not half-extract.

---

## 3. Ask 2 — load order, on screen and in the data

**The load order already exists in the data and nobody can see it.** At Build
(`:760–780`) each slot is written with:

```js
const slotOffset = existingClusters.length;              // :760  — Extend continues the count
mergeSlots.forEach((slot, slotIdx) => { …
  const prefix = `S${slotOffset + slotIdx}${mint}-${pretty}`;   // :779 — every node renamed to this
  const clusterId = `CLUSTER-${slot.id}-${Date.now()}`;         // :793 — the SLOT ID, in the id
```

So for any assembly built through 1.6: **`S<n>` in the node-name prefix IS the load order**, and
the **slot id is embedded in the cluster id**. No migration is needed to display either — parse
what is there. (`cluster.name` is the pretty slot label, uppercased with dashes.)

**Build:**
- Number every slot row on screen `#0`, `#1`, `#2` … **using the same arithmetic the prefix uses**
  (`slotOffset + slotIdx`), so the badge on screen is literally the `S<n>` that will appear in the
  node names — that is what makes "which slot are we talking about" answerable in one word. On
  **Extend**, seed `slotOffset` from the target's `nodeClusters.length` and show the existing
  assembly's slots above the new ones, greyed, with their own numbers, so she can see she is
  appending `#7` and not re-uploading `#3`.
- Let the slot list be **reordered** (▲▼ per row, the same pattern `moveSlotChoice` `:587` already
  uses for choices) so it can be arranged in her actual load sequence. `slots` is plain state
  (`:174`) and only `mergeSlots` order feeds the prefix, so reordering is honest: it changes the
  numbers, and it must therefore be **locked once a file is uploaded to any slot** — or the badge
  and the eventual prefix disagree, which is worse than no badge. (Alternative: allow reorder any
  time and recompute badges live, since the prefix is only minted at Build. Prefer this if it
  holds — verify against `filledSlots` `:631` and the preflight.)
- Show the numbers in the **preflight confirm** (`:730`) too, since that is the last screen before
  the geometry is minted.

**Also display, per slot row:** the slot's canonical tags as chips (category · position ·
location) — they exist on the slot def but a custom slot (`addSlot` `:549`) defaults to
`OTHER/SHARED` and the auto-tag from the label (`:554`) is invisible until Build. Stuart and the
designer discussing "which tags need applying" need to see what the slot itself is claiming.

---

## 4. Ask 3 — the 1.5 slot locator

**Everything needed already exists.** 1.5's `SelectableModel` (`:218`) takes `locatingNodes` — a
plain **array of node names** — and isolates them in brass emissive while fading everything else
(`:305–308`). Today that array comes from exactly one cluster:

```js
const locatingNodes     = existingClusters.find(c => c.id === locatingClusterId)?.nodes || [];  // :640
const hoveredClusterNodes = existingClusters.find(c => c.id === hoveredClusterId)?.nodes || []; // :641
locatingNodes={(showAutoPanel && glowNodes.length) ? glowNodes : (hoveredClusterNodes.length ? … )} // :1128
```

**Build:** a **SLOTS panel** on the right-hand side, above or beside the saved-cluster list, that
groups `existingClusters` (`:639`) **by slot** and glows the whole group.

- **Grouping key**, in order of confidence: (1) an explicit `slotId` / `slotOrder` on the cluster
  if present (see below); (2) the `CLUSTER-<slotId>-<ts>` id parse; (3) the `S<n><mint>-<PRETTY>`
  node-name prefix, which also yields the load-order number and the label. Clusters matching none
  of these (hand-made in 1.5, or pre-1.6) group under **"Ungrouped"** — never hidden, never
  guessed into a slot.
- **Selecting a slot** sets the glow to `slotClusters.flatMap(c => c.nodes)` — one line beside
  `:640`, then feed it into the same precedence at `:1128`. Hover glows, click locks, exactly as
  the cluster rows and the auto-proposal rows behave today (`:884–886`, `:1355–1357`) so there is
  one interaction language on the screen.
- **Each slot row shows** its load-order number, the pretty label, its cluster count, and its
  canonical tags; **expanding** it lists that slot's clusters, each still individually locatable
  as now. Show a **tag-completeness marker** per slot (e.g. clusters with no category, choices with
  no item #) — that is the thing the designer is actually trying to find on a multi-track assembly.
- **Additive only.** The existing per-cluster locate, the auto-proposal panel, `Highlight
  Unassigned` (`:1095`) and the 2D region editor path (`:1037–1045`) keep working untouched.
  `git diff -w` on `SelectableModel` should be empty or a one-line prop change.

**Going forward (additive, recommended):** have 1.6's Build write `slotId`, `slotLabel` and
`slotOrder` onto each cluster (`:793`, the `clusters.push` at the end of the loop) so the grouping
stops being a parse. Every reader that already ignores unknown cluster fields keeps working. Do
**not** rewrite existing clusters to add it — the parse covers them, and a migration over
`nodeClusters` is exactly the kind of blast radius rule 4 is about.

---

## 5. Open questions — ask Stuart BEFORE the plan (ask, don't derive)

1. **A traverse template?** 1.6 has two workflows only — `standard` (Standard Bay) and `double`
   (Double Bracket) (`TEMPLATES`, `:100–101`). H1-2TRV is neither: it wants fascia / track(s) /
   carriers / end stops / splice / motor slots. Is a third **TRAVERSE** template wanted (which
   would give the designer correctly pre-tagged slots instead of custom `OTHER/SHARED` ones), or
   does H1-2TRV keep being loaded into custom slots this time?
2. **Slot reorder after upload** — lock the order once a slot holds a file (badge always truthful),
   or allow reorder any time and recompute badges live? §3 prefers live, if it verifies.
3. **Node re-map on the slot row** — the assign row can re-point a choice at a different node
   (`:2611`). Should the designer's row get it too, or is that deliberately Stuart-only?
4. **Who may set the traverse tags?** The four traverse tags are currently Stuart-only *by
   accident* (they were added to the assign row). Confirm the designer should have them — the whole
   ask implies yes, but it is a real change in who tags what.
5. **`basic` vs `noBackplate`** — confirm the assign-row meaning is the correct one (`basic` = ONE
   PIECE, construction fact; `noBackplate` = mounts without a plate) so the slot tooltip can be
   corrected rather than the flag re-interpreted.

## 6. Acceptance — with Stuart and the designer, pinned in, on H1-2TRV

| run | expect |
|---|---|
| Extend an existing assembly with one new slot | the slot row offers **every** tag the Load Choices row offers — traverse role, drive, setup, tier, passing, always-shown, materials, no-plate, note — and each writes the same pin field |
| Same choice tagged from the slot row vs from Load Choices | identical `assembly_pins` doc (diff the two docs; only `choiceSort` may differ) |
| A double's bracket, projections per rod | the slot row can express `FRONT:4.625,6` the way the assign row can |
| Slot numbering on Extend | new slots continue the count; after Build, `S<n>` in the .glb node names matches the number that was on screen |
| Reorder slots, then Build | the prefixes follow the on-screen order; the preflight names the same numbers |
| 1.5 on H1-2TRV | the SLOTS panel lists every slot with its load-order number; selecting one glows **all** of that slot's geometry and nothing else; expanding still locates a single cluster |
| 1.5 on a hand-clustered / pre-1.6 assembly | its clusters appear under "Ungrouped" — nothing hidden, nothing guessed |
| 1.5 regression | per-cluster locate, hover glow, auto-proposal panel, Highlight Unassigned, 2D regions all unchanged |
| Both tabs | `eslint` 0 errors; `CI=false react-scripts build` compiles; the ⚖ Flow Alignment Scan and 🩺 Flow Doctor report no new faults on H1-2TRV |
| Guide (S2) | `UserGuideTab.js` — the 1.6 and 1.5 sections say what a slot is, what the load-order number means, that the two tagging screens are now the same screen, and how to use the 1.5 slot locator. **Brief F owns the new 1.6 / tag-engine guide sections (its F9) and appends rather than rewrites — coordinate before editing that file.** |

## 7. Handoff

Write `BRIEF_16_AUTHORING_ALIGNMENT_HANDOFF.md`: what shipped (commits, the parity table re-run as
proof), what Stuart answered from §5, anything named and not fixed, and the state of the H1-2TRV
load. Update this file's §2 table to the post-change state so the next session can see at a glance
that the two screens agree.

---

### Appendix — fast orientation

- **1.6 two paths:** slot/Build/Extend seeds `:535` `:611` `:1550`, renderer `:2916–3012`, writer
  `:817–844`, Build/merge `:657–900` (prefix minting `:760–795`); Load Choices seed `:1377`,
  renderer `:2583–2846`, writer `:1984–1989`.
- **1.6 slot machinery:** `TEMPLATES` `:100`, `STANDARD_SLOTS` `:64`, `DOUBLE_SLOTS` `:87`,
  `slots` state `:174`, `addSlot` `:549`, auto-tag-from-label `:554`, `setSlotChoicePatch` `:586`,
  `moveSlotChoice` `:587`, `splitSlotChoice` `:597`, `filledSlots` `:631`, Extend target +
  preview `:238–268`, duplicate-slot warning `:714–722`, preflight confirm `:700–730`.
- **1.5 glow machinery:** `SelectableModel` `:218` (locate branch `:305–308`),
  `existingClusters` `:639`, `locatingNodes` `:640`, `hoveredClusterNodes` `:641`,
  glow precedence `:1128`, cluster rows `:1250`+, auto-proposal rows `:1355–1357`,
  `Highlight Unassigned` `:1095`, 2D region editor `:1037–1045`.
- **Tag vocabulary:** `Shared/assemblyTags.js` is locked — `TAG_CATEGORIES`, `TAG_LOCATIONS`,
  `normalizeCategory/Position/Location/EndTreatment`, `validateAssemblyAlignment` (the ⚖ scan).
  Dictionary lists (projections, materials, bracket mounts) come from 4.5 Master Dictionary via
  `dictLists` (`:323`). Memory: `canonical-tag-spec`, `hardware-tag-engine`,
  `assembly-builder-project`, `traverse-generator-fork`, `spec-sheet-generator`.
- **Line numbers are as of 2026-09-03** and both files change often — **re-locate by symbol.**
