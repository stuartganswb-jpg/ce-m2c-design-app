# Finishing Schedule Board — Change Brief & Commit Instructions

**Author:** Pairing session with Stuart, 2026-06-21
**Purpose:** Hand off a set of working-tree changes that add a unified **Finishing Schedule** board
(the "what / where / who" planner) plus the `paintSize` plumbing it depends on. This doc tells the
reviewing agent **exactly** what changed, what deliberately did **not** change, how it was verified,
and how to commit it safely.

> **READ THIS FIRST — do not blanket `git add .`**
> The working tree contains changes from **two** sources: this session (5 files) and pre-existing
> uncommitted work (2 files) that were already modified before the session. Only commit the 5 files
> from this session. See [§7 Git steps](#7-git-steps-do-this-exactly).

---

## 1. What this adds (functional summary)

1. **New "SCHEDULE" tab** on the Finishing Floor app — a read-only plan that groups queued + on-floor
   work orders by recipe, packs each paint size into its own sled-section capacity (S=70, M=35, L=22),
   interleaves **custom** (date-driven) with **stock** (volume-driven filler), and prices each batch
   in machine-minutes. It shows, per batch: **what** (recipe steps, custom/stock counts, size mix),
   **where** (RED/BLUE sled, number of section loads, hand-finish off-ramp), and **who** (recommended
   spray + hand-finish operators).

2. **A "Commit Schedule" action** on that board that writes the plan back onto each `fin_workorder`
   (`machineAssigned` + `schedule*` fields) so the Active Floor inherits the sled/operator/load plan.
   It is idempotent — safe to re-run; it just refreshes the assignments.

3. **`paintSize` is now carried onto every finishing work order** at creation time (it previously only
   lived on the master item, `Approved_Designs.manufacturingSpecs.paintSize`). Without this, the board
   could not know a part's size and would treat everything as Small.

4. **The recovered "time matrix"** is computed live inside the board from each recipe's steps × the
   timers in `fin_config/settings` (the same timers Management → AI Production Timers edits). Nothing
   new is stored for it; it can't go stale.

---

## 2. IMPORTANT — what did NOT change (and why it's safe)

- **The custom-vs-small-parts routing split is untouched.** That division lives in
  `src/components/Shared/lineClassification.js` (`classifyLine()` → `'small'` | `'custom'`, driven by
  the per-step `partHandling` flag from the CPQ flow builder). It is the decision that sends a line to
  the **Shop Floor** (custom) vs the **Finishing Floor** (small). **It is a completely different
  mechanism from the S/M/L `paintSize` field.** `paintSize` only matters *after* a part is already on
  the finishing side; it sets how many fit a sled section. None of the changes here read, write, or
  alter `partHandling` or the shop/finishing routing.
  - Concretely: in `RTGDispatchTab.autoSplitSalesOrder`, the new `buildPaintSizes()` aggregation runs
    **only over `smallLines`** (lines already classified `small`). It never sees custom lines.

- **`ActiveFloor.js` is not modified.** It already auto-assigns RED/BLUE only when `machineAssigned`
  is null (`ActiveFloor.js:114-115`). The new Commit step pre-sets `machineAssigned`, so Active Floor
  simply respects the committed sled instead of auto-picking. Compatible, no edit needed.

- **No Firestore collections were added.** New fields live on existing docs (`fin_workorders`,
  `hq_work_orders`), so existing security rules apply (but see [§6](#6-things-to-check-before-relying-on-it)).

- **No dependencies added**, no build config touched, no schema migration required. Legacy work orders
  with no `paintSize` simply fall back to Small on the board.

---

## 3. Files changed in THIS session (commit these)

### NEW — `src/components/FinishingFloor/ScheduleBoard.js`
The whole component. Read-only planner + `commitSchedule()` writer. Props:
`workOrders, recipes, users, sysConfig, writeLog`. Key behavior:
- Filters `workOrders` to `currentPhase` ∈ {`setup`, `painting`}.
- Groups by `recipe`; sorts members custom-first then by `reqDate` (stock acts as filler).
- Packs each size into its own section loads: `loads = Σ ceil(size[k] / cap[k])`, caps `{S:70,M:35,L:22}`
  (S honors `sysConfig.smallPartsBatchSize` if set).
- Computes machine-minutes from `mix + sprayedSteps × (spinSetup + spinPaint + oven)` per load, plus
  per-part hand minutes; wall-clock assumes RED+BLUE run in parallel.
- Capacity meter compares total machine-minutes to `sysConfig.activeFloorDailyMinutes` (default 480).
- `commitSchedule()` uses a Firestore `writeBatch` to update each member WO with:
  `machineAssigned, scheduleSled, scheduleSeq, scheduleBatch, scheduleLoads, scheduleSprayOp,
  scheduleHandOp, scheduleMachineMins, scheduledAt`. Guarded by a `window.confirm`.

### MODIFIED — `src/components/FinishingFloor/FinishingFloor.js`
Three edits:
1. Added import: `import ScheduleBoard from './ScheduleBoard';` (right after the `SetupQueue` import).
2. Added `'SCHEDULE'` to the `TABS` array, positioned between `'SETUP QUEUE'` and `'ACTIVE FLOOR'`:
   ```js
   const TABS = ['SETUP QUEUE', 'SCHEDULE', 'ACTIVE FLOOR', 'FINISH RECIPES', 'SUPPLIES', 'OS COMMS', 'ASSET GALLERY', 'DAILY SUMMARY'];
   ```
3. Added the render line (right after the `SETUP QUEUE` render line):
   ```jsx
   {activeTab === 'SCHEDULE' && <ScheduleBoard workOrders={workOrders} recipes={recipes} users={users} sysConfig={sysConfig} writeLog={writeLog} />}
   ```
   > Note: `SCHEDULE` is gated by the same per-role tab permissions as every other tab
   > (`myTabs`/`perms`). New tab will only show for roles whose permission list includes it — admins
   > see all. You may want to add `SCHEDULE` to the relevant roles in `fin_config/permissions`.

### MODIFIED — `src/components/FinishingFloor/SetupQueue.js`
Manual order intake now captures a size:
1. New state: `const [paintSize, setPaintSize] = useState("S");`
2. `newWO` doc now includes:
   ```js
   paintSize,
   paintSizes: { S: 0, M: 0, L: 0, [paintSize]: totalPartsCalc },
   ```
3. Reset on successful create: `setPaintSize("S")` added to the clear block.
4. New **Paint Size** `<select>` (S/M/L) added to the intake form, before the Total Parts / poles inputs.

### MODIFIED — `src/components/HQ/RTGDispatchTab.js`
The sales-order auto-split and the manual finishing push both stamp size now:
1. `buildPartsList()` — each pick-list entry gains `paintSize` from the part:
   ```js
   paintSize: (part?.manufacturingSpecs?.paintSize || '').toUpperCase() || null,
   ```
2. Two new helpers added right after `buildPartsList`:
   - `buildPaintSizes(smallLines, partCache)` → `{S,M,L}` counts (sums line qty by part size), or
     `null` if no small line carries a size.
   - `dominantPaintSize(paintSizes)` → the size carrying the most parts (single-chip display value).
3. In `autoSplitSalesOrder`, inside the `if (hasSmall)` block, after `totalParts` is computed:
   ```js
   const paintSizes = buildPaintSizes(smallLines, partCache);
   const paintSize = dominantPaintSize(paintSizes);
   ```
   and the `fin_workorders` doc now includes `paintSizes, paintSize` (added right after `totalParts`).
4. In `pushToFinishing`, the `finPayload` now includes:
   ```js
   paintSize: (hqOrder.paintSize || '').toUpperCase() || null,
   paintSizes: (hqOrder.paintSize && ['S','M','L'].includes((hqOrder.paintSize || '').toUpperCase()))
       ? { S: 0, M: 0, L: 0, [(hqOrder.paintSize).toUpperCase()]: Number(hqOrder.totalParts) || 0 }
       : null,
   ```

### MODIFIED — `src/components/HQ/StockViewTab.js`
Stock builds carry size from the master item into the work order:
- In `pushWOsToDispatch`, the `hq_work_orders` doc now includes:
  ```js
  paintSize: (part.manufacturingSpecs?.paintSize || '').toUpperCase() || null,
  ```
  (added right after `type: "Stock Build"`). This is what later flows through `pushToFinishing` (above).

---

## 4. New / changed data fields (reference)

**`fin_workorders`** (created by SetupQueue, RTGDispatchTab):
| Field | Type | Set by | Meaning |
|---|---|---|---|
| `paintSize` | `'S'｜'M'｜'L'｜null` | split / push / manual | dominant size, for display |
| `paintSizes` | `{S,M,L}｜null` | split / push / manual | part counts per size (drives load packing) |
| `machineAssigned` | `'RED'｜'BLUE'` | **Commit Schedule** | committed sled (also read by ActiveFloor) |
| `scheduleSled` | string | Commit | same as machineAssigned, explicit |
| `scheduleSeq` | number | Commit | batch order in the schedule |
| `scheduleBatch` | string | Commit | recipe code of the batch |
| `scheduleLoads` | number | Commit | section loads for the batch |
| `scheduleSprayOp` | string｜null | Commit | recommended spray operator |
| `scheduleHandOp` | string｜null | Commit | recommended hand-finish operator |
| `scheduleMachineMins` | number | Commit | est. machine-minutes for the batch |
| `scheduledAt` | epoch ms | Commit | when committed |

**`hq_work_orders`** (created by StockViewTab):
| Field | Type | Meaning |
|---|---|---|
| `paintSize` | `'S'｜'M'｜'L'｜null` | passed downstream to the finishing WO |

**`fin_config/settings`** (optional, not created automatically):
| Field | Type | Default | Meaning |
|---|---|---|---|
| `activeFloorDailyMinutes` | number | 480 | capacity-meter denominator (a shift's machine-minutes) |

---

## 5. Verification already performed

- `eslint` run on all five files: **0 errors.** The only warnings reported are **pre-existing** and
  not introduced here (`logs` unused in FinishingFloor.js; `sectionHeaderStyle` unused import in
  SetupQueue.js; `loadRTGOrders` exhaustive-deps in RTGDispatchTab.js; `successCount` unused in
  StockViewTab.js).
- Babel parse of the new component and the edited parent: OK.
- Not yet done: running app smoke test against live Firestore data, and confirming the new tab
  appears for non-admin roles (permission-gated). See §6.

---

## 6. Things to check before relying on it

1. **Firestore rules** (`firestore.rules`): the new fields are on existing collections
   (`fin_workorders`, `hq_work_orders`), so no new rules are strictly required — **but** confirm the
   Finishing app's auth context is allowed to `update` `fin_workorders` (the Commit writes use
   `finishingDb`). If updates are currently locked down, Commit will fail with a permission error.
2. **Tab permissions**: add `'SCHEDULE'` to the appropriate roles in `fin_config/permissions` so the
   right operators/managers can see the tab (admins already see everything).
3. **Live-data sanity check**: create a couple of real split + stock WOs, open SCHEDULE, and confirm
   the size breakdowns, load counts, and times match the floor reality. The visual mockup used sample
   numbers.
4. **Operator assignment is round-robin** by eligible role — it is **not** yet load-balanced against
   who's currently busy (the Active Floor's live `getAiRecommendation` does that). Fine for planning;
   upgrade later if desired.
5. **`index.lock` warning**: during the session, git reported
   `unable to unlink .git/index.lock: Operation not permitted`. That usually means an editor or running
   dev server holds the repo. If git commands fail, stop the dev server / close other git processes (or
   remove a stale `.git/index.lock`) before committing.

---

## 7. Git steps (do this EXACTLY)

Current state: branch `feat/paint-size-rec-prod`, last commit `6ff72f9`. **Nothing from this session is
committed or pushed.**

**Files to commit (this session only):**
```
src/components/FinishingFloor/ScheduleBoard.js      (new)
src/components/FinishingFloor/FinishingFloor.js     (modified)
src/components/FinishingFloor/SetupQueue.js         (modified)
src/components/HQ/RTGDispatchTab.js                 (modified)
src/components/HQ/StockViewTab.js                   (modified)
```

**Do NOT commit (pre-existing, unrelated, not from this session):**
```
src/components/HQ/LibraryMassUpdateTab.js
src/components/HQ/NetSuiteSyncTab.js
```
Review those two separately and decide what to do with them on their own.

**Recommended: put this on its own branch.**
```bash
# 0. sanity check
git status
git log --oneline -1            # expect 6ff72f9

# 1. branch off current work
git checkout -b feat/finishing-schedule-board

# 2. stage ONLY the five session files (explicit paths — no `git add .`)
git add \
  src/components/FinishingFloor/ScheduleBoard.js \
  src/components/FinishingFloor/FinishingFloor.js \
  src/components/FinishingFloor/SetupQueue.js \
  src/components/HQ/RTGDispatchTab.js \
  src/components/HQ/StockViewTab.js

# 3. confirm staging is exactly those five and the two excluded files are still unstaged
git status

# 4. commit
git commit -m "Finishing: unified Schedule board + paintSize on work orders

- New SCHEDULE tab (ScheduleBoard.js): groups WOs by recipe, packs each
  paint size into its own sled-section capacity (S70/M35/L22), interleaves
  custom (date-driven) with stock (filler), prices batches in machine-minutes
  using recipe steps x fin_config timers (the recovered finishing time matrix).
- Commit Schedule writes sled + operators + load plan back to fin_workorders
  (machineAssigned + schedule* fields); idempotent. ActiveFloor inherits it.
- Carry paintSize/paintSizes onto fin_workorders at creation: sales split and
  manual push (RTGDispatchTab), stock build (StockViewTab -> hq_work_orders),
  and manual intake (SetupQueue Paint Size dropdown).
- No change to the custom/small-parts routing split (lineClassification.js)
  or ActiveFloor.js. No new collections or deps."

# 5. push
git push -u origin feat/finishing-schedule-board
```

> If you'd rather commit straight onto `feat/paint-size-rec-prod` instead of a new branch, skip step 1
> and just `git push` at the end. The staging discipline in steps 2-3 is the important part.

---

## 8. Suggested next steps (not done yet)

- Make the board's operator picker load-aware (respect who's already running a task), or simply reuse
  ActiveFloor's `getAiRecommendation`.
- Optionally surface committed `scheduleSeq` ordering on the Active Floor so the floor runs batches in
  the planned sequence.
- Add a small seeder (a few sample split + stock WOs) to demo the board with realistic data.
