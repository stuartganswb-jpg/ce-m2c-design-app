# Brief F — the tag engine, kits and spec sheets: all fixes on the item

*Cut from `SYSTEM_FLOW_AUDIT.md` §11 (this is the one brief that does not touch the order spine)
and from the five briefs already on this ground — `KIT_CPQ_ALIGNMENT_BRIEF.md` (08-22),
`SPEC_SHEET_CPQ_TIEIN_BRIEF.md` (08-25), `SPEC_SHEET_HANDOFF_BRIEF.md` (08-23, **stale where it
conflicts with the memory**), `ENGINE_CHECKOUT_BRIEF.md` (08-21), `TRAVERSE_HANDOFF_BRIEF.md`
(08-13). Written 2026-09-02. This session's job: finish what the tag engine started — kits that
seed the engine's axes, spec sheets that read like the reference set, the H2 cutover, one real
bug in checkout — and never once fix a flow when the fix belongs on the item.*

## ⛔ WORKING AGREEMENT (Stuart, 2026-08-31) — binds this session

1. **Plan first, always** — state the plan and WAIT for approval before editing code, shipping, or
   changing production data. Reading and measuring need no permission; changing does.
2. **Requested scope only.** Adjacent problems get NAMED, not fixed.
3. **No temporary fixes.**
4. **Look downstream — RTG is the single source of truth.** This brief's changes reach the spine
   only through what CPQ hands off (`hardwareHandoff`'s line contract). Every change that touches
   a line, a price or a BOM is traced through the split, the floors, the WMS and the NetSuite push,
   and said in the plan.

**The governing principle of this ground** (Stuart, 08-17): *"all fixes on the items, not on the
flow."* If a backplate misbehaves, the fix is its **tag in 1.6** — never a flow edit, never code.
Standing rule **S1 · Tags before code** is this principle, generalised to the whole app.

## ⚙ STANDING RULES (Stuart, 2026-09-02) — verbatim from Brief A

**S1 · Tags before code.** **S2 · The guide moves with the code** — there is **no engine / kit /
spec-sheet / 1.6 section in the guide**, only 4.6 (`UserGuideTab.js:189`); you write them (§4 F9).
**S3 · Everything auto-routes; RTG records everything** — not yours; you hand E a correct line.
**S4 · BOTH always asks. S5 · POs open, accumulate, then send** — not yours.

**Decisions that bind this brief:** *Q7, second pass* — the pole handling rule is the finish
suffix; **no stock- or length-based pole tag** (S1 is about the *next* modification, not that one).
*Q10* — E stamps the recipe at save; your engine's `finishes[] / finishLabel / globalFinish` are
the sources it reads first — keep them on the cart item. The 08-07 product rule: *"the fundamental
flows will not change; data must flow seamlessly from CPQ / Vision / Portal back to HQ."*

---

## 0. Operating the session

**Login.** Stuart pins you in — **Claude-in-Chrome**, `find`→ref, never credentials. HQ gates:
Factory Portal then the PLM PIN per `/hq` load. The engine is reached via **▶ New engine** on the
CPQ toolbar (super admin); the spec sheet via **📐** in BOM Engine (tab 3); 1.6 is **Assembly
Builder**; kits live in **4.6 Customer Collections → KITS** and `system/quick_ship_kits`.

**Vercel.** `curl -s https://www.4cosworkcenter.com/version.json` → stamp after commit time.
**`CPQTab` and `HardwareConfigurator` are in `main.*.js`**; `AdminTab`, `AssemblyBuilderTab`,
`CustomerCollectionsTab`, the SpecSheet modal are lazy chunks — sweep `/asset-manifest.json`.
Save-is-send refuses from a stale bundle (`assertFreshBundle`): reload → re-PIN after a deploy.

**The fast loop — your real verification.** Twenty-one pure-module test files in `scripts/`
(`hardwareModel`, `hardwarePricing`, `hardwareAdapter`, `hardwareHandoff`, `kitSeed`, `kitCode`,
`specSheetPages`, `specSheetRows`, `traverse*`, `visionBridge`, `tagSheetImport`, …) run with
`sh scripts/run-traverse-tests.sh` (stages the CRA ESM as `.mjs` and runs `node --test`). **A fix
on this ground is proven in a test before it is looked at on a screen.** And the **offline
spec-sheet replay harness** (`SPEC_SHEET_CPQ_TIEIN_BRIEF.md` Part 3): pull the pins+clusters dump
via the console recipe (keep `passing`, `legacyErpId`, `returnOnly`), `curl` the assembly's
`cadUrl` (token-public) → GLB, strip textures, replay `choicesFromAssembly → specPages →
buildPageSvg` headless in Node for exact fit percentages. "This is how every fix this session was
proven before deploy — no screenshots, no loop." The scratchpad dies daily; rebuild it in minutes.

**Two fixture rules that were paid for:** fixtures must use the **prod shape** (`name` = the part
code, `partId` = the library doc id — `codeOf()` exists because fixtures once used codes as ids and
every test passed while 187 sheets printed); and **a fixture that cannot fail is decoration** —
mutation-test every new assertion.

**Driving a 4.6 save from the browser tools:** the client-row save gates on **`window.confirm`**
(`CustomerCollectionsTab.js:426`), not only `alert`. Stub both, or a dismissed confirm reads as
*cancel* and nothing is written — the retiring session lost one attempt exactly this way. Read the
confirm text back each time; it states what else the save touches (below).

**Cloud Shell.** Rules deployed. `functions/portalEngine.js` mirrors the engine's size families
(`SIZE_FAMILIES`) — a family change is a hand-off to the portal, deployed there.

**Git.** Multi-session repo: never switch branches, stage only your files, `pull --rebase
--autostash`, fix-forward, lint to 0 errors. `HardwareConfigurator.js` took 21 commits since
08-25 and `CPQTab.js` is E's — `ListAgents`, ask before the engine mount.

---

## 1. Territory

**You own — the engine:** `Shared/hardwareModel.js` (the one resolver) · `hardwareAdapter.js`
(1.6 → choices) · `hardwarePricing.js` · `HardwareConfigurator.js` (the UI) · `assemblyTags.js`
(the locked vocabulary) · `traverseTags.js`, `traverseFlow.js`, `traverseConfigurator.js`,
`traverseDraw.js`, `traverseExplode.js`, `traverseKitImport.js` · `sizeMatrix.js`, `plateRules.js`,
`platePool.js`, `finishLabel.js`, `configQty.js`, `tagPhrase.js`, `tagSheetImport.js` ·
`Shared/studioScene.js` (the render rig). **Kits:** `kitSeed.js`, `kitCode.js`,
`CustomerCollectionsTab.js` (4.6: KITS, PLATES, ARMS, FEES, CHECKOUT, COLLECTION), the
`system/quick_ship_kits` record, `Shared/customerControlFile.js`. **Spec sheets:** everything in
`src/components/SpecSheet/`, `system/spec_sheet_config`. **Authoring:** `AssemblyBuilderTab.js`
(1.6), `NodeClusterTab.js` (1.5), the flow generator in `AdminTab.js`, `Shared/fusionImport.js`,
`itemCodeMatch.js`, `nodeList.js`, `GuideBuilder.js`, `guideCapture.js`.

**Read-only:** E's — `CPQTab.js` (the engine's **mount** at `:4814` and the old-engine gate
`flowNeedsOldEngine` at `:1064` are yours to *specify*, E's to edit; `hardwareHandoff.js` is E's
because six downstream consumers read it), `VisionHardware.js`, `visionBridge.js`, `nsTransmit.js`.
A's, B's, C's, D's — everything on the spine. The portal (`functions/portalEngine.js`) — mirror by
hand-off.

**Must not touch:** the line contract (`hardwareHandoff`) — you produce lines that satisfy it; if
it needs a field, E adds it. Pricing chains (`priceChoice`, `clientPricing`, `priceLevels`) —
settled. Anything on the spine. **And never a flow edit for an item's fault.**

---

## 2. What this brief inherits

| ref | item | this brief's part |
|---|---|---|
| `engine-cutover-backlog` memory, #1 | **H2 combined flow onto the new engine** — "next after the Vision bridge"; H2 is the proving ground for combined-flow handling | F1 |
| `KIT_CPQ_ALIGNMENT_BRIEF.md` §2 | kit alignment was built against the OLD flow's steps; **the CPQ half is gone** — rebuild against the engine's **axes** (`kitSeed.seedFromKit`, `kitCode.parseKitCode/matchKit`); §3.4's four questions (projection, seed-or-lock, what a kit bills, the motor) | F2 |
| `ENGINE_CHECKOUT_BRIEF.md` §3 ① | **the traverse components modal is bypassed in the new engine** — "a real bug": the old engine gated every add on `trvPendingRef`; the new one does not, so a traverse add can skip its components | F3 |
| `spec-sheet-generator` memory (**trust it over the handoff brief**) | rebuilt 08-23 on the tag engine: one page per (leaf × subject) from `activeAxes()`; measured grid, one true scale, "REDUCED n% — bound by height/width" in the footer; 8.5×11 binder, doubles solved by rod *selection*. **NEXT: text / measurement refinement** | F4 |
| `SPEC_SHEET_HANDOFF_BRIEF.md` "also open" | `H1-138D` double placement **unverified** (two-step dim wall→3¼→5¼); the two repeated detail columns (**French Return**, **Passing Support Arm**) never built; `HTCAR35/01` still `RING` with no carrier tag (one-line 1.6 fix) | F4, F6 |
| `SPEC_SHEET_CPQ_TIEIN_BRIEF.md` Part 1 | H1-138 data/tag items for Stuart: S72 rear-pole `returnOnly` did not persist; FR/MTR double return pins' proj is a list not a tier map; the flow's splice extra is an H2 code; 6" single returns' `feeItemNo` raw; one untagged pin copy per wood single | F6 (data, with Stuart, in 1.6) |
| `TRAVERSE_HANDOFF_BRIEF.md` §3, §4, ⏸ | the live render bug (H1: duplicate fascia clusters; H2: the clearing effect — one test separates them); duplicate bracket clusters; **⏸ BLOCKED**: the return arms are tagged FINIAL and draw as finials — preferred fix is the `end-arm` (`isReturnArm`) tick on those pins, read by the traverse module | F5, F6 |
| `ENGINE_CHECKOUT_BRIEF.md` §6 | open data items: unpriced `H1-138AR`, `H1-138D`, `H1-DBLMR`; two NEW-SLOT finial sections needing `rod: front`; H1-2TRV's duplicate fascia clusters; centre-bracket picture | F6 |
| `engine-cutover-backlog` #2 | a 1.6 window for the **243 untagged nodes** on H1-138 — explicitly low priority; `diagnose()` already lists them | F7, last |
| `h2-simple-elegance-flow` memory, pending | auto-route the finial step's finish onto the paired collar cluster; Stuart's live portal test of the H2 landing | F1 |
| `CPQ_ORDERENTRY_TAB11_BRIEF.md` §2 | kit sheet imports pending beyond H1-2TRV; the H1-75 depth audit | F2, F6 |
| S1, S2 | tags before code; the guide | every item; F9 |

---

## 3. The rules you build on — settled

**The engine's two invariants** (`hardware-tag-engine`): geometry is **default-hidden** and
visibility is the **union** of what is selected — no veto, so two steps can never make a part
invisible; axes and their values are **discovered from tags, never enumerated** — a fourth
projection is a tick, not a release. `hardwareModel.js` bakes nothing; `hardwareAdapter.js` reads
what 1.6 already writes.

**Construction facts vs pairing facts.** `basic` (one piece) and `no-finish` describe the part —
read wherever the tag sits, never conditioned on category. `inl-bkt` / projection describe how two
parts go together — always read from one side against the other. Both were learned the hard way
twice in one day; do not relearn them.

**The vocabulary is locked** (`assemblyTags.js`, `canonical-tag-spec` memory): three plate pools,
end-arm / inl-bkt bracket tags, `normalizeLocation / Position / Category / EndTreatment`;
`validateAssemblyAlignment` and the ⚖ scan are the audit/repair tools. Milestone 07-08: Brimar +
Flat Iron + Fabricut 4.625 all working on Vision and CPQ.

**Spec-sheet traps that are still live** (memory, verbatim intent): **never filter the answer you
asked for** — `visible` is what an additive configurator paints, not what belongs on a drawing;
`keep()` is for sweeps, a part the engine named is drawn as given. **One code can be two pins**
(`H1-138BP-R` plain and in-line) — look a pin up by the choice's own node, never by `partId`; only
the rod is side-scoped. **Read subjects by ROLE, not slot kind** — FINIAL / RETURN / INSIDE_MOUNT
merge into one `END` slot. **Judge the rod pool against the leaf before `rodForArm()`.**
`narrowings()` needs normalized choices, `resolve()` inside gets the raw list.

**The reference sheet:** one page = one arm at one projection; rows = its four plate profiles;
columns = wall-plate detail | front elevation with pole and rings, dimensioned | code | profile |
end view; returns add BENT RETURN and Passing Support Arm columns; row 1 carries the Ø callouts.
Paper is **8.5×11 binder**, portrait standard, doubles landscape two rows per sheet.

**Kits:** a kit and a configuration are the same order in two spellings (`kitSeed.js`) — the seeder
writes `answers` and `picks`, nothing else, and **refuses** (`blocked`) when the assembly cannot
honour a defining choice, because "four confident lines and one quiet one" is the shape of every
fault this engine has produced. Quick Ship bills the kit (per-set + per-foot from `clientPricing`);
CPQ bills the resolved parts — *both are live today and must not both be.*

**4.6 row saves are coupled to the item's tiers — one direction.** Saving a customer's client
pricing row *also rewrites part of the item's Fabricut pricing box* "so the CPQ price levels stay
in step" (the confirm at `CustomerCollectionsTab.js:426`; `:84`). The retiring session verified
after every save that the tiers survived — they did — but row edits and tier edits are not
independent, and a row edit made without the tiers in mind can quietly move them. Treat it as a
trap until §8 Q6 is answered.

**The H1-2TRV cuff-bracket kits, as left on 09-02 (data, no code):** `H1-2RCTCB / ECB / 6CB`
repriced — painted `/P` tiers 61/122/244 · 63/126/252 · 65/130/260, plated `/EP` tiers
80/146/292 · 83/151/302 · 87/159/318, own price cleared, client rows `H3622F / H3623F / H3624F`
aligned to the painted SKU, `kitComponents` and `plateUpcharge` untouched. Eleven ghost stubs
deleted (library 3,503 → 3,492) after an `assembly_pins` + `cpq_flows` scan (4,422 references)
proved none referenced, each through the app's own orphan guard. 1.6 search on the bracket now
returns only the real kits.

**H2** is four single-assembly flows plus a CPQ landing (🎯, 07-24) — the union/size-step machinery
is retired for H2 and stays for Fabricut H1. Never add `codeRx` to H1 while its combined flow is
live. Acrylic renders from the AC master-finish chip, not code.

**1.6** is the authoring truth: per-slot .glb, choices named `<ITEM#> <POSITION>` auto-matched to
the library, fee / hide / basic / return-only flags on the pin, `choiceNode` per choice,
`choiceSort`, "Sync BOM ↔ Library", "Repair Node Names", the Fusion .fbx importer. A wrong option
on a flow is almost always a wrong tag here.

---

## 4. The work, in order

### F1 — H2 onto the new engine (the combined-flow proving ground)

The cutover's first parked item. H2's four single-assembly flows are the cleanest data the engine
will ever see; move them from the old configurator (`flowNeedsOldEngine`, `CPQTab.js:1064` — the
gate E edits on your spec) to the tag engine, one assembly at a time, proving on each: the landing
still collapses the siblings to one picker entry; `PROJ_SELECT` gating comes from `proj:` tags
(`taggedProjInchesAtDia`); acrylic tops render from the AC chip; the paired collar takes the
finial step's finish (the pending item); the portal's held runtime still mirrors (`SIZE_FAMILIES`
hand-off). **Trace (rule 4):** the cart item and breakdown must be byte-identical in shape to the
old engine's (`hardwareHandoff` — "the new engine does NOT invent a payload"); prove on tab 12 that
an H2 order pushes the same NetSuite lines before and after. Fabricut H1 untouched — its combined
flow stays on whichever engine it is on today until Stuart calls the migration
(`FABRICUT_MIGRATION_BRIEF.md`, M0–M6).

### F2 — kits seed the engine's axes (the "start over")

Rebuild the CPQ half of kit alignment against **axes, not steps**: `kitCode.parseKitCode` →
`matchKit` → `kitSeed.seedFromKit` writing `answers` + `picks` for the engine's `activeAxes()`;
the kit strip in CPQ shows what seeded, what was **missed**, and what the code could not honour
(`blocked` is a hard stop). The Quick Ship half keeps working end to end — do not touch it.
**Before building, get Stuart's four answers** (`KIT_CPQ_ALIGNMENT_BRIEF.md` §3.4, re-asked in
§8): projection default, seed-or-lock, what a kit-matched configuration *bills*, and the motor.
Answer 3 is the one that reaches NetSuite: Quick Ship bills the kit, the engine bills the parts;
one of them must win. **Trace:** the breakdown lines a kit-seeded configuration hands E's push
must carry the same `partId / legacyErpId / partHandling / finishCode` as a hand-built one — test
it in `kitSeed.test.mjs` with prod-shaped fixtures.

### F3 — the traverse components modal (a real bug)

The old engine gated every add on `trvPendingRef` (`ENGINE_CHECKOUT_BRIEF.md` §3 ①); the new
engine's add path does not, so a traverse configuration can reach the cart without its components
priced or listed. Find where the engine's add-to-cart bypasses the modal, restore the gate **as
the engine's own slot** (the components are engine choices, not a bolt-on), and prove on tab 12
that a traverse order's components push. **Trace:** components missing here are components
missing from the WMS pick and the NetSuite SO — the 58034 double-push and the missing TRACK line
(E's) are the same seam seen from the other side; coordinate with E so one of you owns the
traverse push and the other the traverse configuration.

### F4 — spec sheets: text and measurement refinement

The memory's stated NEXT. On the harness first, then on paper with Stuart:
- verify `H1-138D`'s two-step dimension (wall → 3¼ → 5¼) — the commit that placed it went out at
  the end of a session, unverified;
- build the two repeated right-hand columns the reference set carries on return pages — **French
  Return** and **Passing Support Arm** — the row builder makes detail/front/profile only;
- the text pass: callouts on row 1 only, code placement, leader lines, the footer's "REDUCED n%"
  line kept honest — every change measured offline, fit percentages stated, no screenshot loops.
Stuart has rejected the 4-row fit four times; the arithmetic is in the handoff brief and it is
correct — the levers are portrait, fewer hanging rings, or a decision he has been asked twice.
**Ask once more, plainly** (§8 Q4), then build what he chooses.

### F5 — the traverse render bug, diagnosed by the one test

`TRAVERSE_HANDOFF_BRIEF.md` §3: pick Single, click Back to an End Treatment step. Dropdown blank →
the clearing effect (H2); selection present, geometry gone → the duplicate fascia clusters (H1).
Run the test with Stuart, fix the one it names, and the **⏸ BLOCKED** item: tick `end-arm`
(`isReturnArm`) on the traverse return-arm pins in 1.6 and have the traverse module read it — a
tag, not drawing code, exactly S1.

### F6 — the data pass, with Stuart, in 1.6 (S1)

Every item here is a tag or a price, not code. One sitting, one list, ticked off:
`HTCAR35/01 → traverseRole: CARRIER` · S72 rear-pole `returnOnly` re-ticked and saved · FR/MTR
double return pins' proj → `FRONT: 8.5, BACK: 3.25` · the H1-138 flow's `H2-138SPLC` splice
extra replaced or dropped · the 6" single returns' `feeItemNo` · the wood singles' untagged pin
copy · the two NEW-SLOT finial sections → `rod: front` · H1-2TRV's duplicate fascia cluster
(why two? resolve, delete one) · the duplicate bracket clusters · prices for `H1-138AR`,
`H1-138D`, `H1-DBLMR` in 4.6 · the H1-75 depth audit · **the 40 remaining PENDING stubs** in the
library — 21 of them the H1-138 `ABF / AGF / AKF / WCGF / ILJL` family — the same ghost-stub defect
the retiring session cleared on H1-2TRV, in a collection it was not asked to touch: scan
`assembly_pins` + `cpq_flows` for references first, delete only the unreferenced through the
orphan guard, and say which were kept and why. Then the ⚖ scan clean. Then Regenerate.

### F7 — the 1.6 window for untagged geometry (last, low priority)

243 nodes on H1-138 that no pin claims. `diagnose()` already lists them; the configurator
collapses them behind a count. Give 1.6 a view that shows them in the model so Stuart can decide
"junk from the Fusion export" versus "should have been tagged." Only when he asks, or when
untagged geometry starts causing render questions.

### F8 — Guide Books and the render rig

`GuideBuilder` / `guideCapture` (CPQ "Send to Guide") and `studioScene.js` (the per-finish PBR
registry) are yours and stable. Nothing planned; named so nobody else picks them up.

### F9 — the guide (S2), from scratch

Sections that do not exist: **1.6 Assembly Builder** (per-slot files, naming, the flags, Sync and
Repair), **the tag engine** (what a tag does, construction vs pairing, "all fixes on the items"),
**Kits** (a kit is a configuration in another spelling; what seeds, what refuses), **Spec Sheets**
(what a page is, the paper, why a sheet says REDUCED), and 4.6's KITS/CHECKOUT views. Plus the
repo guide. Listed in the handoff.

---

## 5. What you do NOT do

- **No flow edit for an item's fault.** The fix is the tag. Every time.
- **No touching the spine** — writers, release, floors, WMS, the SO push. Your product is a correct
  cart item and breakdown; E carries it.
- **No new payload shape.** `hardwareHandoff`'s contract is E's; you satisfy it.
- **No `codeRx` on H1** while its combined flow is live. No Fabricut migration until called.
- **No fix proven only on a screenshot.** Test first, harness second, screen third.
- **No pole tag** (Q7). No pricing-chain changes. No fixing in passing.

---

## 6. Acceptance

| run | expect |
|---|---|
| `sh scripts/run-traverse-tests.sh` | every suite green; new assertions mutation-tested (a fixture that cannot fail is thrown away) |
| H2 assembly on the new engine | landing → diameter → its flow; `PROJ_SELECT` from tags; acrylic from the AC chip; collar takes the finial finish; tab 12 shows identical NetSuite lines to the old engine for the same picks |
| Kit code entered in CPQ | seeds axes; strip shows seeded / missed / blocked; a blocked kit does not open a configuration; the seeded breakdown carries the full line contract |
| Traverse configuration added to cart (new engine) | the components modal gates the add; components in the breakdown; tab 12 shows them; **one** 58034 (with E) |
| Traverse render — the one test | the diagnosis named; the fix is one thing; return arms tick `end-arm` and draw as returns on Vision without breaking CPQ's End Treatment seeding |
| Spec sheet, H1-138 return page | French Return + Passing Support Arm columns present; double's dims read wall→3¼→5¼; the footer's REDUCED line matches the harness's number exactly |
| The 4-row sheet | whatever Stuart chose in §8 Q4, measured offline first |
| The 1.6 data pass | every F6 item ticked; ⚖ scan clean; Regenerate produces no junk options |
| Fabricut H1 | untouched — `git diff -w` on its flow doc and generator path is empty |
| 1.6 untagged window | lists the 243; Stuart can mark junk vs missing tag; nothing deleted by the tool itself |

---

## 7. Sequencing and hand-offs

1. **F6 first, with Stuart** — it is a sitting, not a sprint, and half the open bugs are tags.
2. F5's one test the same day. F3 next (it reaches NetSuite). Then F2 after Stuart's four
   answers. F1 when Stuart calls it (the memory says "next after the Vision bridge" — ask whether
   the bridge counts as verified). F4 throughout, on the harness. F7 only on request. F9 last.
3. **Hand-offs out:** to **E** — the old-engine gate and the engine mount in `CPQTab.js` (you
   spec, they edit); any field the line contract needs; who owns the traverse push vs
   configuration. To the **portal** — `SIZE_FAMILIES` changes. To **Eric / Stuart** — the 4.6
   prices in F6.
4. **Hand-offs in:** Stuart's §8 answers; E's date for the recipe-at-save (your `finishes[]` /
   `finishLabel` on the cart item are what it reads).

---

## 8. Open questions (ask before the plan)

1. **The four kit questions** (`KIT_CPQ_ALIGNMENT_BRIEF.md` §3.4): does a kit seed a default
   projection or does CPQ ask; seed-or-lock when the operator diverges; **what does a kit-matched
   CPQ configuration bill — the kit or the parts?**; how does a Fabricut CSR read the motor?
2. **H2 cutover timing** — does the Vision bridge count as verified, so F1 is "next" now?
3. **Traverse ownership with E** — the push (58034, TRACK) is E's; the configuration (the modal)
   is F's. Confirm the line, or hand both to one.
4. **The 4-row plate sheet** — portrait 11×17 (shipped), fewer hanging rings (a drawing
   convention), or two sheets? One answer, then it is built to that.
5. **F7** — wanted this week, or parked as the memory says?
6. **The 4.6 row → tier coupling** (§3). Keep it one-way as it is (and say so on the screen), make
   it explicit two-way, or decouple so a row edit never moves a tier? A wrong answer here moves
   Fabricut prices silently.

---

## 9. Handoff

`BRIEF_F_HANDOFF.md`: what shipped (commit, test, harness number, run), the state of F1–F9, what
waits on Stuart / E / the portal, anything named and not fixed. Update the memories this brief
leaned on (`hardware-tag-engine`, `spec-sheet-generator`, `engine-cutover-backlog`) — they are
trusted over the briefs, so they must stay true. **The guide (S2):** the sections in F9, listed.
