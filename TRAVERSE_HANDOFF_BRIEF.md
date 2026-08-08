# Traverse (H1-2TRV) — handoff brief, 2026-08-04

Written because the previous session hit context exhaustion: four wrong calls in a row on this
feature (three at the fee bug, one design flip that had to be reverted, one dedupe fix that changed
nothing visible). Everything below is verified fact or an explicitly-labelled hypothesis.

**Do NOT start the assembly over.** The 1.6 tagging is good and does not need redoing.

---

## 0. The environment — everything needed to work on this

### Where it lives

| | |
|---|---|
| Repo | `github.com/stuartganswb-jpg/ce-m2c-design-app` |
| Working checkout | `/Users/stuartgansmba/Projects/ce-m2c-design-app` |
| **Branch** | **`main`** — in sync with `origin/main` at `de86784` (2026-08-04 21:59) |
| App | **www.4cosworkcenter.com** (CRA) — HQ tab 1.6 + CPQ live here |
| Portal | portal.classicalelements.com (Vite, `portal/`) |
| Firebase project | `ce-m2c-design-collab` |
| NetSuite account | `3728153` |
| Vercel dashboard | vercel.com/m2-c-ce-design-app |

**Worktree note:** `.claude/worktrees/musing-haslett-783222` exists at `ec31751` (detached). Level
with an older `origin/main`; nothing stranded. 18 untracked paths in the working tree — all data
files and `*_BRIEF.md`, no source.

### Deploy — THREE things, only one is automatic

**1. Frontend → automatic.** Every push to `main` builds two Vercel projects: `ce-m2c-design-app`
(CRA, ~2 min) and `ce-client-portal` (Vite, ~10 s). **Everything in this brief is frontend**, so a
push is the whole deploy. User must hard-refresh ⌘⇧R after.

**2. Firebase Functions → manual, Cloud Shell only.** Local `firebase login` fails on this Mac.
Nothing in the traverse work touches functions, but for completeness — Cloud Shell drops you in `~`,
so the `cd` is not optional:

```bash
cd ~/ce-m2c-design-app && git pull origin main && firebase deploy --only functions:<name>,firestore:rules --project ce-m2c-design-collab
```

Fresh Cloud Shell (home is wiped after ~120 days idle):
```bash
git clone https://github.com/stuartganswb-jpg/ce-m2c-design-app.git ~/ce-m2c-design-app
```
**Read the `git pull` output before trusting the deploy** — it must show the commit you care about
arriving. A stale checkout reports "Successful update operation" while shipping old code.
Deployed to date: `portalMyOrders`, `portalDeleteQuote`, `portalBranding`, `onStockBuildDone`.

**3. NetSuite RESTlet → manual, inside NetSuite.** `netsuite/ce_convert_build_restlet.js` is shipped
by no deploy. File Cabinet → SuiteScripts → replace the file.

### Ship workflow

```bash
rm -f .git/index.lock
git add <specific files>          # NEVER git add -A — other sessions work this repo
git commit -q -m "..."
git pull --rebase --autostash origin main
git push origin main
```

**Multi-session git safety:** never `git checkout <branch>` in the shared checkout (it races another
session's in-flight files and once landed a commit on main unintentionally). Stage only your own
files. Always `--rebase --autostash` before push. Use a `git worktree` for bigger multi-commit work.

### Verify / build

```bash
npx --no-install eslint <path>                  # 0 errors required; pre-existing warnings are fine
CI=false npx --no-install react-scripts build   # ~1–2 min
node --test <scratchpad>/traverseTags.test.mjs  # the 33 model tests
```

### ⚠ Verifying what prod actually serves

A "Ready" deploy with a fresh `version.json` can still serve old code.

```bash
curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js'
```

**The app is CODE-SPLIT — 1.6, CPQ, Library, CRM never appear in `main.*.js`.** A marker grep there
reads as "stale build" when prod is current. Extract every chunk map from main and sweep them all:

```bash
LC_ALL=C grep -oE '\{[0-9]+:"[a-f0-9]{8}"(,[0-9]+:"[a-f0-9]{8}")*\}' main.js \
  | tr ',' '\n' | grep -oE '[0-9]+:"[a-f0-9]{8}"' | tr -d '"' | sort -u
```
…then download each `static/js/<id>.<hash>.chunk.js` and grep those. **Sweep EVERY match, not
`head -1`** — main carries several maps (~33 entries). This session used exactly that to prove the
`feeItemNo` deploy had landed.

- **Pick a marker that survives minification**: string/JSX literals, property names, Firestore field
  names. Local variables and imported function names are renamed. Plain ASCII only — `·` `—` `’` may
  be unicode-escaped.
- If a shipped change genuinely does nothing: Vercel → Deployments → ⋯ →
  **Redeploy with "Use existing Build Cache" UNCHECKED**.

### Hard constraints

- **Firestore enforces App Check** — no local/Node script can read or write prod data. Bulk data
  changes must be an in-app admin button. This is why the model is pure modules + node tests.
- **The app is behind a PIN gate**, so it cannot be driven from a test harness either.
- **NetSuite reads for diagnosis:** the old unauthenticated SuiteQL curl is dead. Use the RTG
  NetSuite Transmit Log, HQ 11.1 → Sync Queue, or ask for a screenshot.

### Where the tabs are

| Tab | What |
|---|---|
| **1.6 Assembly Builder** | the tagging grids in this brief (`AssemblyBuilderTab.js`) |
| **8. CPQ Configurator** | the runtime flow (`CPQTab.js`) |
| System Admin → CPQ Flows | flow generate/regenerate (`AdminTab.js`) |
| 4.5 Master Dictionary | the projection / mount lists the `proj:` and `mount:` dropdowns read |
| 11.1 NetSuite Sync | item sync + the outbox/transmit log |

---

## 1. The two questions Stuart asked

**"Should the designer only load the fascia once?" → YES. Do this first.**

`H1-2RCTAR` and `H1-2RCTWR` are each pinned in **two** POLE clusters:

| cluster | choices |
|---|---|
| `SHORT-ROD-—-CENTER-(ALWAYS-SHOWN) · POLE · CENTER · 2 nodes` | H12RCTWR, H12RCTAR |
| `NEW-SLOT · POLE · CENTER · 2 nodes` | H12RCTARCENTER, H12RCTWR |

Every fascia symptom traces to this duplication — the "4 choices should be 2", the vanishing
aluminium fascia, and the two disconnected bars in the render. The app has been patched twice to
paper over it (dedupe, then dedupe-with-node-merge) and both patches are guesses about which
geometry is the real fascia. **One fascia part → one cluster → one pin** removes the whole class of
problem and makes the remaining diagnosis honest.

Same question applies to the duplicated bracket clusters (see §4).

**"Do I need to start all over?" → No.** The role/drive/setup tags, the fee item #s and the
projections are all correct in the dump. Only the duplicate *pinning* is wrong.

---

## 2. What is built and working

| Piece | Where | State |
|---|---|---|
| Tag vocabulary (`trv:`, `drive:`, `setup:`, `always`) | 1.6 both grids | ✅ persists + reloads |
| `Shared/traverseTags.js` | pure module | ✅ **33 node tests pass** |
| Generator emits Fascia → Single/Double → Track → ends | `AdminTab.js` | ✅ steps appear (13 steps) |
| Runtime filtering by setup + drive | `CPQTab.js` `getOptionsForStep` + 3 sub-pools | ⚠️ built, unverified |
| Cut list (fascia −0.5"/−2" track, −1"/−3" F-clip) | `traverseCutLength` | ✅ tested, **nothing calls it yet** |
| Fee item # survival | `feeItemNo` + per-node pin id | ✅ root cause was pin-id collision |

### The semantics that were argued over and settled
- `setup:` blank = **shared** (filtered by nothing). Only an explicitly tagged part is filtered.
  Blank-means-SINGLE was tried and **reverted** — his dump showed rings, plugs, pulleys, carriers
  and every return arm are untagged, so a DOUBLE order emptied the whole assembly.
- Fascia and riders (FCLIP/CARRIER) are **exempt from setup filtering by role** — a double is two
  tracks behind ONE fascia.
- `drive:` blank = both. The drive is a **sub-choice of the Track step**, not a standalone step.

---

## 3. The live bug — not yet diagnosed

**Symptom (Stuart, verified in screenshots):**
1. Step 1 Fascia Material: `H1-2RCTWR` renders correctly; `H1-2RCTAR` renders two disconnected
   bars / no coherent fascia. Unchanged by commit `de86784`.
2. Step 3 Single or Double: neither track renders; the return arms disappear at selection time.

**What was ruled out:** the deploy landed (live bundle grepped — `feeItemNo` present in
`main.337927f5.js` + chunk 311). The tags do reach the generator now (`de1db2c` fixed a whitelist
that was eating them).

**The two hypotheses worth testing, in order:**

**H1 — the duplicate clusters (most likely).** Both fascia copies carry different nodes; whichever
copy survives dedupe determines what renders. `H1-2RCTWR` looking right is luck, not correctness.
Fix §1 first, then re-test — this may be the whole thing.

**H2 — the clearing effect in `CPQTab.js`.** Added in `20c3af7`: when the setup/drive selection
changes, any main or sub selection whose option no longer passes the filter is deleted. If it is
over-reaching, the arms would vanish *at the moment* Single is picked, which matches the symptom.

> **The one test that separates them:** pick Single, then click **Back** to an End Treatment step.
> If its dropdown is now blank → H2, the clearing effect. If the selection is still there but the
> geometry is gone → renderer/geometry, i.e. H1.

---

## 4. Also outstanding

- **Duplicate bracket clusters.** `LEFT-BRACKET · 4 nodes` *and* `NEW-SLOT · BRACKET · LEFT · 1 node`
  (same for CENTER, RIGHT). Each generates its own step — part of why the flow is 13 steps. If the
  `NEW-SLOT` bracket clusters are build leftovers, deleting their pins collapses 3 steps.
- **Track tagging may be inverted.** `NEW-SLOT · OTHER · SHARED` = `setup: double`,
  `NEW-SLOT · OTHER · CENTER` = `setup: single`. Confirm which cluster holds which physical track.
- **Fascia length never reaches the cut maths.** `traverseCutLength()` is tested and correct but
  nothing feeds it a length; the Fascia Length step needs to carry a dimension the way the pole
  step does, and the deductions need a home on the assembly.
- **F-clip "hidden in CPQ, visible in the shop-floor viewer"** — that state does not exist.
  `isHidden` means never render anywhere. Needs a third state, deliberately built.
- **`cust:` on fee rows** is disabled with an explanatory tooltip (done) — customer pricing for a
  fee lives on the fee ITEM in the Master Library.

---

## 5. Rules for whoever picks this up

- **Verify prod before debugging a feature.** The app is code-split: 1.6 and CPQ live in chunks,
  never in `main.*.js`. Sweep EVERY chunk map, not `head -1`. Grep string/property names, not local
  variables (minification renames them). See CLAUDE.md.
- **Do not add another compensating layer.** Three of tonight's fixes compensated for the duplicate
  pinning rather than removing it. Fix the data first.
- **Pure modules + node tests are the only verification available** — App Check blocks any script
  from reaching Firestore or NetSuite, and the app is behind a PIN gate.

### Files touched by this feature
```
src/components/Shared/traverseTags.js      the model (33 tests)
src/components/HQ/AssemblyBuilderTab.js    1.6 tags, pin write/reload, pinIdFor
src/components/HQ/AdminTab.js              generator: traverse steps, buckets, riders
src/components/HQ/CPQTab.js                runtime filter + stale-selection clearing
```

### Relevant commits (newest first)
`de86784` dedupe merges geometry · `0f1e663` blank = shared (revert) · `e70cd9c` projection step
order · `de1db2c` whitelist ate the tags · `e54c740` seed DOUBLE from name + proj on end choices ·
`40a4670` **pin id collision — the fee bug** · `b95411a` feeItemNo · `20c3af7` runtime filter ·
`3d7adf5` single/double axis · `36b4f84` TRV_END role · `d89a552` fascia = pole pattern ·
`0d16fb7` F-clip + cut list · `35c71fa` first traverse steps · `1ddfbed` tag vocabulary

---

## ADDENDUM 2026-08-07 (appended by Session A — read `CROSS_SESSION_CONTRACT.md`)

Three sessions now run this repo in parallel; the contract file holds the territory map, mirror
pairs, deploy matrix, pending manual deploys, and git rules. Yours (Session C) is unchanged:
traverse/CPQ/Vision + the CPQ-adjacent shared modules.

Stuart's standing product rule, recorded for all three: **the Fabricut H1 flow (and siblings) will
still get small changes, but the fundamental flows will not change** — and data must flow
seamlessly CPQ / Vision / Portal → HQ, with quotes / sales orders / Quick Ship staying true to
each other. Portal (Session A) resolves flow content at read time, so your flow edits shouldn't
break it — but schema/logic changes to CPQ surfaces still need the `portal/src/shared/*` mirror
swept (coordinate with Session A rather than editing `portal/` yourself).

---

# CURRENT STATE — 2026-08-08 (Session C)

**§1–§5 above are the 2026-08-04 handoff. Its §0 environment notes are still accurate and still the
place to start. Its §3 DIAGNOSIS IS SUPERSEDED — both hypotheses were wrong.** What follows replaces
`TRAVERSE_PLAN.md`, which is now deleted: one session, one brief.

## What the traverse flow is now

`src/components/Shared/traverseFlow.js` is a **separate generator**, forked out of the pole path on
2026-08-04 (`6fce5af`) at Stuart's instruction — "traverse generator should be saved as its own,
since it is very different… i do not think we need to try and make all the code work for both."

A traverse assembly never runs a line of the pole path. The pole generator is provably back to its
pre-traverse form: `git diff -w 35c71fa^ -- AdminTab.js` shows it byte-identical.

Flow shape (13 steps): Fascia Material · Fascia Length · Single or Double (+ Front Rail sub) ·
Traverse Drive · Bracket Projection · Track · L/R End Treatment · L/C/R Bracket & Mount · fees.

| Rule | Where it lives |
|---|---|
| A double **ADDS** a track — the DOUBLE answer owns its geometry and bills its part | `traverseFlow.js` |
| Drive is one either/or for the WHOLE order, never per-track | `TRV_DRIVE` step |
| Setup gates projection — every DOUBLE part is `proj:any`, so DOUBLE skips the question | `trvSetupOnly` |
| Front Rail: a double may wear a ring instead of a front track (`hidesStepRole:'TRACK'`) | setup sub-choice |
| A track's **front** ends ride with the track; the **rear** ends ride with the DOUBLE answer | AND across steps |
| Traverse returns match projection **exactly**; pole returns keep minimum semantics | `projTagOk` |
| Track qty = fascia footage per rail — 2× falls out, never written as a rule | `CPQTab` derived qty |
| A sub-option flagged `needsQty` carries its own count under `<stepId>__sub` | `CPQTab` + ERP push |

Tests: **`sh scripts/run-traverse-tests.sh`** — 28 node tests built from Stuart's real 1.6 tag dump.

## ⚠ VISION HARDWARE — the rule, before any code

> Stuart 2026-08-08: "it is imperative we do not alter how it works, we create a separate flow or
> tool add on but this screen is tied into several cpq flows that all function and i do not want to
> break any existing connections or logic."

This is the contract's product rule ("fundamental flows will not change") applied to one screen.
**Decided: a separate module + ONE guarded mount. Not a separate tab.**

- All traverse logic in its own file. `VisionHardware.js` gets exactly one insertion,
  `{isTraverseFlow && <TraversePanel …/>}`. Its bay solve, SVG, end-style sync and panel math are
  **not edited**.
- **Verification is the deliverable, not a claim**: `git diff -w` against `VisionHardware.js` must
  show that one addition and nothing else. Same proof used for the pole generator.
- Terminology maps rather than reinvents — Stuart: "the terminology changes and parts change but in
  general the logic between them is the same/similar."

| Pole | Traverse |
|---|---|
| Pole / rod | Fascia (the datum — everything is cut shorter than it) |
| Pole O2O | **unchanged** — outside edges of the miter return |
| Main Wall C2C | **Track length** (`traverseCutLength` — fascia −0.5" manual / −2" motorised) |
| Main Tube Raw Cut | Fascia / track / F-clip cut list (`traverseCutList`) |
| Finial / return end | Traverse end return arm |

`traverseCutLength` / `traverseCutList` live in `Shared/traverseTags.js`, are tested against
Stuart's numbers, and **have never had a caller**. Vision is their destination. Both inputs now
exist: the drive is answered once for the order, the fascia footage is live.

**⏸ BLOCKED ON ONE ANSWER.** The end graphic already works — the flow-mirror (`:578`) reads each End
Treatment selection and `endStyleOf` (`:423`) maps `MITER_RETURN → RETURN_MITER`. The traverse return
arms are tagged **FINIAL**, so they draw as finials (`End Style: FINIAL` in the screenshot). Needs a
signal, not drawing code:
- Tag the arms `MITER RETURN` — simplest, but it makes them RETURNS to CPQ: `isReturnOption` bars
  returns from being a step's default, so End Treatment would stop seeding. Fixes Vision, breaks CPQ.
- **Preferred:** tick `end-arm` (`isReturnArm`) on those pins and have the traverse module read it.
  Precedent at `:233`, where an is-return BRACKET already maps to `RETURN_MITER`. Drawing-only.
  (Check the 1.6 FINIAL grid exposes the chip — today it shows on BRACKET rows.)

## Open, in priority order

1. **Vision hookup** — above, once the signal is chosen.
2. **Ring qty → BOM**: shipped for pricing; confirm the ERP push line reads
   `stepQuantities['<setupStepId>__sub']` on a real push.
3. **Seed-on-arrival is REVERTED** (`5126ea2`). Seeding only reached steps made the price start at
   $0.00 as asked, but hidden-until-chosen then hid unreached geometry — at step 3 the Track step
   (step 6) had no answer, so the front track vanished and single-vs-double looked dead. The two
   goals conflict under that rule and the render wins. Doing both needs the visibility model to tell
   "not chosen yet" from "chosen as nothing" — a real change, not a gate on the seed loop.
4. **Gate the traverse reconcile effect on `isTraverseFlow`.** Everything else this session is
   traverse-gated; that one effect still iterates pole flows. No behaviour change I can construct,
   but not *provably* inert. One line. Offered, not yet approved.
5. F-clip "hidden in CPQ, visible on the shop floor" — that state does not exist; needs a third
   visibility state, deliberately built.

## Tagging still owed in 1.6

- Delete the duplicate fascia cluster `NEW-SLOT · POLE · CENTER`. ⚠ Check which cluster's nodes are
  the real geometry first — dedupe merges both, so deleting the wrong one loses geometry.
- Delete the duplicate bracket pins `NEW-SLOT · BRACKET · L/C/R`. They add a duplicate option inside
  each bracket step, **not** extra steps (correcting §4 above).
- `H12TRVNUTP` @ `NEW-SLOT · OTHER · CENTER` still has no item # — it cannot reach the BOM.
- Plugs/pulleys are pinned in both `FINIAL · L/R` and `OTHER · L/R`. Both now carry `trv: end` so
  the finial picker is clean; decide which copy is canonical and delete the other.

## Retracted, so it isn't re-derived

- "There is only one track mesh." False — the rear appearing alone disproved it. The cause was the
  base track being tagged `setup: single` and filtered out of its own picker.
- "The duplicate bracket clusters cost 3 steps." They cost duplicate *options*, not steps.

**The lesson under all of these: a render symptom has too many possible causes to diagnose from
alone.** Two meshes vs one, and a step losing its selection, look identical on screen. Regenerate and
count steps; read the tags; run the node tests. The render is the last thing to trust.
