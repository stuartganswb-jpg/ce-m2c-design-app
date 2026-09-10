# Orientation brief — know the app as it stands today, before touching anything

*Written 2026-09-10 for a fresh session. Its one deliverable is understanding: read everything
below in order, then hand Stuart a written state-of-the-app report (§6) and wait. Nothing is
edited, shipped or changed in production data by this session until he says what comes next.*

## ⛔ WORKING AGREEMENT (Stuart, 2026-08-31) — binds you from the first minute

1. **Plan first, always** — state the plan and WAIT for approval before editing code, shipping or
   changing production data. Reading and measuring need no permission; changing does.
2. **Requested scope only.** Adjacent problems get NAMED, not fixed.
3. **No temporary fixes.**
4. **Look downstream — RTG is the single source of truth.** Every order from every door lands on
   the RTG board; work orders, the finishing floor, the shop floor, WMS and NetSuite all hang off
   that one spine. Trace every change forward through all of them, in the plan.

Standing rules **S1–S5** (top of `BRIEF_A_WO_PO_CREATION.md`): tags before code · the guide
moves with the code · everything auto-routes and RTG records everything · BOTH always asks ·
purchase orders open, accumulate, then send. Plus, from 09-03: **one issue at a time**, a
**safe-push check** (`git log origin/main..HEAD`, name every commit a push would carry) before
every push, and relayed approvals count.

## 0. Operating the session

- **Repo** `github.com/stuartganswb-jpg/ce-m2c-design-app`, checkout at
  `/Users/stuartgansmba/Projects/ce-m2c-design-app`, `main`, fix-forward. **Vercel auto-deploys
  every push to main**; Stuart must hard-refresh and re-PIN after each. Firebase functions and
  rules deploy from Google Cloud Shell only.
- **Git, multi-session:** never switch branches in the shared checkout; stage only your files;
  `git pull --rebase --autostash origin main` before every push; `npx --no-install eslint <file>`
  → 0 errors; `CI=false npx --no-install react-scripts build` before anything large.
- **Verification:** `sh scripts/run-traverse-tests.sh` runs every node suite (23 files, two
  groups). Deploys are proven by sweeping `/asset-manifest.json` and grepping each chunk for a
  plain-ASCII marker string — never `main.*.js` alone, never `version.json` alone.
- **Prod data cannot be read from a script** (App Check + the PIN gate). Diagnosis is the app's
  own screens, the RTG Transmit Log, 11.1's sync queue, or Stuart pinning you in via
  Claude-in-Chrome (`tabs_context_mcp` first, drive by `find`→ref, never credentials).
- **Memory** lives at `~/.claude/projects/-Users-stuartgansmba-Projects-ce-m2c-design-app/memory/`;
  `MEMORY.md` is the index. Memories are trusted over briefs where they conflict (they are
  updated at the end of every session; briefs are written at the start).

## 1. Reading order — do it in this order, all of it

Read each fully. Line numbers inside older documents are stale; re-locate by symbol.

1. `CLAUDE.md` — the project guide and the working agreement.
2. `APP_ARCHITECTURE_BRIEF.md` (09-01) — the orientation doc: what the app is, the
   single-source-of-truth register, the field-mismatch failure mode, the deploy traps.
3. `SYSTEM_FLOW_AUDIT.md` (updated 09-09) — the spine as it exists: every writer, every release
   path, every gate, every NetSuite write; §10 Stuart's decisions; §11 the six territories.
4. `CROSS_SESSION_CONTRACT.md` — who owns which `Shared/` module; the rule that made parallel
   sessions safe.
5. **The six specialist briefs, then each one's handoff** (the handoff says what actually
   shipped and what did not):
   - A `BRIEF_A_WO_PO_CREATION.md` → `BRIEF_A_HANDOFF.md` (764 lines — the richest record of the
     WO/PO spine, read it all)
   - B `BRIEF_B_RTG_FINISHING.md` → `BRIEF_B_HANDOFF.md`
   - C `BRIEF_C_SHOP_FLOOR.md` → `BRIEF_C_HANDOFF.md`
   - D `BRIEF_D_WMS.md` → `BRIEF_D_HANDOFF.md`
   - E `BRIEF_E_SALES_SIDE.md` → `BRIEF_E_HANDOFF.md`
   - F `BRIEF_F_KITS_SPEC_SHEETS.md` (no handoff file yet — F's record is in the memories
     `brief-f-decisions-2026-09-03`, `unfinished-item-tag`, `step-review-tab1`,
     `h1-2trv-traverse-engine-session`, and in `BRIEF_16_AUTHORING_ALIGNMENT.md` +
     `BRIEF_16_AUTHORING_ALIGNMENT_HANDOFF.md`)
6. `CONSOLIDATION_BRIEF.md` (09-08) — six sessions folded back to one; the cross-session sweep.
7. **The 09-09 continuation briefs — the app as it now is, per territory:**
   `RTG_CONTROL_BRIEF.md` (the control spine), `WMS_BRIEF.md` (the warehouse in one document),
   `SHOP_FLOOR_CONTINUATION_BRIEF.md`, `BRIEF_WO_PO_SPINE.md`, `BRIEF_REPAINT_JFP_JOINT.md`,
   and `WORK_ORDER_CONTRACT.md` (the work-order shape every writer honours).
8. `SESSION_OPENERS.md` — how each session was started; the vocabulary the team uses.
9. **The in-app User Guide** `src/components/HQ/UserGuideTab.js` — written from the code as it
   behaves, kept current (S2). Its sections are the team's own description of the screens.
10. **The memory index** `MEMORY.md`, then every memory it links that touches a screen you will
    be asked about. Start with `working-agreement`, `one-issue-at-a-time`, `every-order-via-rtg`,
    `order-lifecycle-authority`, `rtg-netsuite-transmit`, `hardware-tag-engine`,
    `spec-sheet-generator`, `unfinished-item-tag`, `plated-lines-route-by-stock`.
11. The commit stream since the briefs were cut: `git log --since=2026-09-02 --format='%cs %h %s'`
    — 216 commits in eight days; every message says what changed and why in Stuart's words.

**Older briefs** (August and earlier: TRAVERSE_HANDOFF, ENGINE_CHECKOUT, KIT_CPQ_ALIGNMENT,
SPEC_SHEET_*, ORDER_ENTRY_FLOW, SHOPFLOOR_CATCHUP, ROD_PIECE_INVENTORY, FABRICUT_MIGRATION,
PORTAL_*, …) are history: read them for *why* a rule exists, never for the current state.

## 2. The app in one page (verify each line against the code as you read)

React + Firebase PLM/WMS for Classical Elements and M2C Studio, live at 4cosworkcenter.com. HQ is
one page of numbered tabs (`src/components/HQ/HQ.js` is the registry):

| tab | what it is | owner brief |
|---|---|---|
| 1 Inception | designs and projects; drop-pin review canvas; Guide Books; **Review CAD (.stp)** (09-08) | F (tab 1 viewer), otherwise unassigned |
| 1.5 Node Grouping | clusters on the working GLB; the **Slots panel** groups them by 1.6 slot and glows them | F |
| 1.6 Assembly Builder | per-slot .glb/.fbx upload → one merged model + tagged clusters + pins; Load Choices tags every pin; Standard / Double / **Traverse** templates | F |
| 2 Visual Assembly · 3 BOM Engine (📐 spec sheets) · 4 Master Library (4.5 Mass Update, 4.6 Customer Collections) | the item, its BOM, its prices, its tags — **"all fixes on the items, not on the flow"** | F (engine, 4.6, sheets); A (WO/PO parts of 4) |
| 6 Instructions | interactive 3D SOP pages on the SOP model | — |
| 6.5 Rod Pieces | offcut ledger | C |
| 7 Quick Ship / Order Entry | stocked orders, kits, to-be-finished lines → hq_sales_orders | E |
| 8 CPQ | the tag engine (`Shared/hardwareModel` + `HardwareConfigurator`): axes discovered from tags, additive render, one price chain; Vision reads the same engine | E (mount, push), F (engine) |
| 10 CRM · 11 System Admin (flows, 11.1 sync) · 12 ERP push pre-flight | | E |
| 12.5 Stock View · Sales Snapshot · Stock Build Needs · True Backorders | the WO/PO writers, one `parkWorkOrder`, POs that open and accumulate | A |
| 13 RTG Dispatch | **the master record of every order**; gates; the one closer; the NetSuite transmit log | B |
| Finishing Floor · Shop Floor · WMS (pick / pack / plating / rod cuts / labels / fulfilment) | the floors, reading what RTG released | B · C · D |

The spine: CPQ / Order Entry / Vision / portal → `hq_sales_orders` → RTG → work orders + floor
docs → WMS → `ns_outbox` → NetSuite, with ids written back. Everything routes on its own; a
person sees status and closes.

## 3. What is settled — do not re-litigate

The decisions in `SYSTEM_FLOW_AUDIT.md` §10 and the Brief B/E/F answer tables, plus: the pole
handling rule is the finish suffix (no pole tag); every order lands in RTG; plated lines route by
live stock (in stock → pick, short → backorder), never to finishing; the kit bill has ONE shape on
both doors (kit + first 4 ft, extra feet, added parts, included parts at $0; NetSuite gets every
item at $0 and one holder line); the "Unfinished" item tag and its one reader
`Shared/finishLabel.takesNoFinish` (item wins); the spec sheet is the 8.5×11 binder; H2 already
opens on the new engine; F7 (untagged geometry window) parked.

## 4. Traps that were paid for (read the memory named for each)

Never filter the answer you asked for · one code can be two pins · read subjects by role, not
slot kind · fixtures use the prod shape, and a fixture that cannot fail is decoration · a const
declared below a `useMemo` is a temporal-dead-zone crash · a branch push carries everyone's local
commits · a deploy can serve stale code — grep the chunk · never add `codeRx` to H1 while its
combined flow is live · the 4.6 row save rewrites the item's Fabricut box (one way, on purpose).

## 5. Where the code lives that you will be asked about

`src/components/HQ/*Tab.js` (one file per tab, long, heavily commented — every comment records an
incident; do not tidy) · `src/components/Shared/*` (pure modules with node tests in `scripts/`:
the engine, pricing, handoff, kits, spec sheets, order lifecycle, work-order contract, nsTransmit)
· `src/components/{FinishingFloor,ShopFloor,PickPack}/` · `functions/index.js` (NetSuite proxy,
outbox worker, `onStockBuildDone`) · `portal/` (the customer portal, a mirror of CPQ logic).

## 6. Your deliverable: the state-of-the-app report, then wait

Before proposing any work, write Stuart a report (a repo file, `STATE_OF_THE_APP_<date>.md`)
that a person who has not read the 40 documents could act on:

1. **One paragraph per territory (A–F)** — what shipped, what the handoff says is open, what the
   09-09 continuation brief adds, and any contradiction you found between documents (say which
   is newer and which you trust).
2. **The open-items list**, deduplicated across every brief and handoff, each with its owner
   territory and the document it came from. This is the thing Stuart cannot get today without
   reading everything himself.
3. **Questions only he can answer**, numbered, with your recommendation for each.
4. **What you verified in the code** versus what you took on the documents' word — be exact,
   because several "obvious" claims in earlier briefs were wrong when checked.

Then stop and wait. He will pick the first issue; one issue at a time from there.
