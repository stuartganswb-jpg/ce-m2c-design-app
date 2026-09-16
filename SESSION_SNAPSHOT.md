# SESSION SNAPSHOT — CE / M2C Design App
**Last updated: 2026-07-05 (evening)** · Branch: `main` (all work merged + deployed) · Repo: github.com/stuartganswb-jpg/ce-m2c-design-app

> Hand this to a fresh Claude Code session to resume instantly. Everything below is **shipped to production `main`**. The persistent memory files (auto-loaded each session) carry the deep details — this is the orientation + punch list.

---

## TL;DR — where things stand
The **FABRICUT H1** flow is fully working end-to-end (per-end pole render, returns, return-scoped backplates, fees, finish-variant pricing, BOM, ERP routing) and the whole authoring pipeline got hardened around it. **SIMPLE ELEGANCE** was built in 1.6 and is mid-setup. Tab 1.6 is now the one-stop authoring surface: Item Starter Kit → slot upload (auto-match, flags, split, arrows, preflight) → Build / **Extend** → Assign/Repair/Sync tools → regenerate flow in place.

## PICK UP HERE (tomorrow's punch list)
1. **Run the proof loop on SIMPLE ELEGANCE** (last thing built, not yet verified):
   - 1.6 **Extend** it with one small slot → confirm in Node Grouping (new cluster added, old untouched).
   - Visual Assembly: reassign one part → confirm it updates live in BOM Engine (tab 3).
   - BOM Engine → **🔍 Master BOM Scan** → work the report (ghosts / no-price / missing /P variants).
   - System Admin → **Regenerate Steps from Tags (keep prices)** → confirm old prices held, new choice appears.
2. **Pricing spot-checks on FABRICUT** (all plumbing new as of today): P finish → `/P` item price; EP finish → exact `/EPn` item price; pole per-foot ($36 line confirmed working); bend/miter fee lines price from their fee entities (CE-FEE-5138 works; **"MITER RETURN" is still a PENDING placeholder — give it a base price or reassign its pin to a real CE-FEE entity**).
3. **Item Starter Kit dry run**: download template on 1.6, fill a couple of rows, upload → items created under a Project, auto-match finds them.
4. If any $0 line survives: it's DATA (that variant/fee has no basePrice in NetSuite/library), not plumbing — re-run item sync or price it.

## OPEN DECISIONS (waiting on Stuart)
- **NetSuite price write-back** pushes basePrice → `custitem9`, which is NOT the real sales price (that's pricing level 1 "Base Price"). Decide: drop price from the push (recommended; ERP is price master) or wire the push to the price sublist.
- Second-pass 1.6 ideas not built: bushing-class hidden-component slot, library display names on pins, build-draft persistence, one-click Build→Generate Flow.
- Onboarding sheet polish (finish swatches, PDF variant) — unstarted.

## Today's shipped commits (newest first)
| Commit | What |
|---|---|
| `38f38f0` | **1.6 Extend mode** (append slots to existing assembly, same doc id, links survive) + cross-tab alignment (BOM Engine reassign matches VA contract; Node Grouping warns before auto-grouping builder assemblies). |
| `3de1ec6` | **Item Starter Kit** (xlsx template + upload-create under a Project, skips existing ERP ids) + **Master BOM Scan** on BOM Engine. |
| `4b35edd` | Visual Assembly shows builder assemblies (Inception-approvals gate had hidden them; Build now stamps approvals). |
| `22c1757` | CPQ loads Fee/Alias classes → fee options price from fee entity basePrice. |
| `2962130` | **Big regression fix**: finials were misread as returns (cluster-name prefix "…RETURNS" in node names poisoned the regex — greyed brackets, broke finial render). Leaf-label matching now. + pole per-foot pricing (step linkedItemId) + fee options keep partId. |
| `56e212f` | Paint finishes ALWAYS consume `/P` (structural; EP/SG/CP still gate on Stocked flag). |
| `9d4709e` | **Finish-variant pricing**: P→`/P`, EP→exact `/EPn`; option price 0 no longer overrides item price; backplate sub-lines priced (works even when a return cleared the bracket). |
| `c798a03` | Fees searchable in VA picker; **rtn-bp flag** (In Line brackets pair with return backplates). |
| `14d9ed5` | Thumbnail cross-up fixed (per-pin thumbUrl; cluster image only for whole-cluster pins); fee role follows assigned part. |
| `d7ab38d` | **Pin-id mismatch fix** (stored id ≠ doc id made VA reassign a silent no-op; doc id now always wins). |
| `32e1b13` | Sync BOM ↔ Library tool; builder pins written fully LINKED; VA node-thumb renders just the choice. |
| `d93eddd` | Slot uploader full parity (auto-unwrap, flags, picker, thumbs, arrows, **preflight report**). |

## Key how-tos (details in memory files)
- **Regenerate flow without losing prices**: System Admin → flow → "↻ Regenerate Steps from Tags (keep prices)". Needed after any retag/pin/flag change.
- **1.6 flags per choice**: item # (auto-matched from node names `<ITEM#> <POSITION>`) · **fee** (bills as charge, no BOM unit) · **hide** (never renders) · **basic** (bracket takes no backplate) · **rtn-bp** (bracket pairs with return backplates) · ▲▼ order (saved as choiceSort).
- **Finish→item rule**: paints P## → `<base>/P` (stocked phosphated, painted in-house, always consumed); EP## → exact `<base>/EP##` (stocked); SG/CP (BRIMAR ready-to-ship) → exact via Stocked flag; else base.
- **Return conventions**: cluster/slot label contains RETURN → returnOnly plates; return geometry nodes contain BEND/MTR (leaf name) → return behavior even when renamed to a fee entity.
- **NetSuite probes**: curl the proxy (see CLAUDE.md); price = `pricing` table, pricelevel 1.

## Memory files most relevant
`assembly-builder-project.md` (the whole 1.6 saga + tool inventory), `cpq-finish-variant-pricing.md`, `cpq-per-end-pole-render.md`, `netsuite-price-mapping.md`, `onboarding-xlsx-export.md`.

## Hard constraints (unchanged)
App Check → no local scripts against prod data (in-app admin buttons only) · Vercel auto-deploys `main`, hard-refresh ⌘⇧R after deploy · Firebase Functions deploy from Google Cloud Shell only · lint 0 errors before commit (`npx --no-install eslint <path>`).
