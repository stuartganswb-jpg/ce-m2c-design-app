# Project Handoff — ce-m2c-design-app (2026-06-19)

This doc lets you (or a fresh Claude Code session) pick the work up on a new machine.
**Your code is safe** — every change is committed and pushed to **`main`** on GitHub. The only
things that *don't* travel with git are the local AI-memory files (now copied into
`docs/ai-memory/`) and a few local spec/SOP files (now committed alongside this doc).

---

## 0. Snapshot
- **Repo:** https://github.com/stuartganswb-jpg/ce-m2c-design-app  (`origin/main`)
- **Prod:** `main` auto-deploys to **https://4cosworkcenter.com** via **Vercel**. `main` IS the production branch.
- **Stack:** Create-React-App (CRA) + Firebase/Firestore + a NetSuite REST proxy (Google Cloud Function).
- **Latest pre-handoff commit:** `0eea6f0` (Admin role matrix: add new PickPack tabs).
- **Today:** 2026-06-19. User: Stuart (stuart@classicalelements.com).

## 1. Get running on a new machine
```bash
git clone https://github.com/stuartganswb-jpg/ce-m2c-design-app.git
cd ce-m2c-design-app
npm install
CI=false npm run build      # production build (CRA; CI=false so warnings don't fail it)
npm start                   # local dev server
```
- Node 18+ recommended. Firebase web config is committed in `src/firebase.js` (client config, not secret).
- You usually **don't run locally** — you push to `main` and let Vercel build/deploy. The build command is the gate: if `CI=false npm run build` says "Compiled successfully," it'll deploy.

## 2. Restore the AI memory (so Claude regains all project context)
The persistent memory lived at:
`~/.claude/projects/-Users-stuartgans-ma2-Projects-ce-m2c-design-app/memory/`
On the new machine it'll be at the equivalent path for your new home dir / project path. To restore:
```bash
# from the repo root on the new machine, after cloning:
mkdir -p ~/.claude/projects/<your-new-project-slug>/memory
cp docs/ai-memory/*.md ~/.claude/projects/<your-new-project-slug>/memory/
```
The project slug is the absolute project path with `/` → `-` (Claude Code derives it automatically; if unsure, start Claude in the repo once, then `ls ~/.claude/projects/` to see the folder it made, and copy the `.md` files into its `memory/` subfolder).
**Most important memory files to read:** `finishing-conversion-wip.md`, `netsuite-rest-reference.md`,
`label-printing.md`, `no-regressions-ask-first.md`, and the `MEMORY.md` index.
Even without restoring memory, this HANDOFF + `docs/ai-memory/` give a fresh Claude everything.

## 3. Git workflow conventions (IMPORTANT)
- **`main` = production.** Per change: `git switch -c feat/X main` → edit → `CI=false npm run build` → commit → `git switch main` → `git merge --ff-only feat/X` → `git push origin main` → delete branch.
- **⚠️ `feat/production-packet` is STALE / behind main.** It's the branch the working tree was often left on, but it does NOT have the latest code. **Always branch new work off `main`, never off `feat/production-packet`.** (You can ignore/delete it; just don't base work on it.)
- Switching branches invalidates Claude's file-read cache — re-Read before Edit after a switch.
- Commit message footer used: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## 4. Deploy model
- **App:** push to `main` → Vercel auto-builds + deploys to 4cosworkcenter.com.
- **Firestore rules:** deploy **separately** (NOT via Vercel). Edit in the Firebase Console → Firestore → Rules → Publish, OR `firebase deploy --only firestore:rules`. The repo's `firestore.rules` should be a SUPERSET of live so a deploy never drops a live collection.
- **NetSuite proxy:** Google Cloud Function `https://netsuiteproxy-f3h3jadzaq-uc.a.run.app` (OAuth-signed server-side; `functions/index.js`). Deploy via `firebase deploy --only functions` if ever changed (rare; secrets are set in the function's env).

---

## 5. 🔴 OUTSTANDING ACTION ITEMS (do these to finish testing)
1. **Publish the `plating_demand` firestore rule** — it's in the repo `firestore.rules` (and the full ruleset is current) but the LIVE project needs it published, or the "Needs Plating" queue (Library tool + Stock View) is permission-denied. The line:
   `match /plating_demand/{document=**} { allow read, write: if isAuth(); }`
2. **Flag your "Stocked" in-house items** (bases + stocked `/P`) via the Library item-editor checkbox or the Mass Update "Set Stocked Finished Assembly" field — otherwise Stock View's **WO builder shows nothing** (it now lists Stocked-only) and CPQ won't consume their finished stock.
3. **Re-link outsourced-finish vendors** (EP1–EP6 show "⚠ relink") to the NetSuite-synced vendor so the plating PO resolves the real vendor (else it falls back to Dayton Grey 42036).
4. **Live-untested paths** (work, but never exercised end-to-end against prod): Phase 4a plating **receive** (PO→item-receipt transform), Phase 4b **build-back**, the CPQ→NetSuite **finished-item push** (outsourced + stocked), and Stock View **dispatch** (plated→Needs Plating + raw→milling WO). Test, and paste any NetSuite 400 to Claude to iterate.

## 6. What this session built (newest → oldest, with commits)
The big theme: the **outsourced-plating / in-house-phosphate finishing-conversion WMS** + making
**Stock View (Tab 12.5)** the planning hub + the **CPQ→NetSuite** finish logic. All on `main`:
- `0eea6f0` Admin role matrix lists all 8 PickPack tabs (Count/Convert/Transfer/Plating were missing).
- `886bbcf` Plating manual pull defaults WO# to `IS_MMDDYY` (initial-stock tracking).
- `36a6eec` PickPack: Watchlist filter on Count/Convert/Transfer/Plating.
- `4c6a46f` Plating jobs get a `PLW-…` WO# (on label + shipment + PO); Stock View WO builder = Stocked-only.
- `e2e9588` Stock View: plated `/EP#` lines → "Needs Plating" + a milling WO for the short raw base (not a vendor PO).
- `d8644a5` Stock View: robust suggested-qty = greater-of(top-up-to-ROP, cover-demand), MOQ-rounded; "Fill All With Suggested".
- `a80fed9` Stock View: WO doc-id `/` sanitize.
- `fd14945` Outsourced demand routing (Library WO tool): base in stock → `plating_demand` "Needs Plating"; base short → shop-floor WO for the base. New `plating_demand` collection + PickPack queue.
- `0a17408` Fix WO-generation crash (`/` in Firestore doc id for finished assemblies).
- `490b727` CPQ push: stocked in-house finished assemblies consume finished stock like outsourced; "Stocked finished assembly" checkbox in Library + `45fe8f8` in Mass Update.
- `847d501` CPQ→NetSuite push: outsourced finishes push the finished assembly `base/CODE` (consume plated stock); in-house finish-to-order unchanged.
- `af90cdc` / `58d39d2` Plating finish dropdown brand-scoped + `code||name` fallback.
- (earlier this session) Plating Phase 1–3 shipped & confirmed live (PO2179 posted), 4a/4b built; device-aware label printing (`5d3f85d`); the big NetSuite PO "Invalid subsidiary" saga — ROOT CAUSE was vendor **entityid 83361 vs internal id 42036** (see §7).

## 7. NetSuite integration — the must-know facts (full ref: `docs/ai-memory/netsuite-rest-reference.md`)
- **GOLDEN RULE:** every `{id}` in a payload (entity/item/account/subsidiary/location/customForm/status) is the NetSuite **INTERNAL id**, never the entityid/itemid/number. A wrong entity id surfaces as a *misleading downstream* error (the multi-hour "Invalid Field Value 2 for subsidiary" was really the wrong vendor id). When a write 400s on a field that looks correct, **SuiteQL-verify every id resolves** before changing anything.
- Record POSTs return **204 + the new id only in the `Location` header** (the proxy drops it) → recover via SuiteQL by a unique memo.
- **Confirmed IDs:** subsidiaries 1=CE Consolidated(parent), **2=CE LLC**, **3=M2C**, 5=Leyla, 6=Unique, 7=Mill Yard. Locations: 17=High Point-CE(sub2), 18=HP-LG(5), 19=HP-M2C(3), 22=Verellen-Denver(3). Inventory-adjustment account **254**. Statuses: Good **1**, WIP-Plating **13**. **Dayton Grey** plater vendor internal id **42036** (entityid 83361). "Weekly Plating Shipment" service item **61947**. PO customForm "LG - Purchase Order Form" **272**. Phosphate assy `H1-138EC/P` = 56771. CPQ rollup item 61502.
- Finish-code prefix encodes brand: **EP*/P → CE (sub 2)**, **MEP* → M2C (sub 3)**.
- SuiteQL: **no `subsidiary` table** — read a sub via the `location` table's `subsidiary` column.

## 8. The finishing / plating flow (end-to-end)
Raw base (e.g. `H1-138EC`, in-house milled) → finished via **in-house phosphate** (`/P`) OR **outsourced plating** (`/EP1..EP6`, vendor Dayton Grey). In PickPack (warehouse app):
1. **CONVERT** tab — in-house phosphate: assembly-build `/P` consuming the raw (lot-numbered). *Live-confirmed.*
2. **PLATING** tab — outsourced round-trip: **Pull to WIP** (status Good→WIP-Plating, assign a finish EP#, prints a 2x4 label with the finish code) → **Ship Pallet** (NetSuite PO to the plater, item 61947) → **Receive** (PO→item receipt) → **Build-back** (reverse WIP→Good + assembly-build `base/EP#` into its bin). Phase 1–3 live-confirmed (PO2179); 4a/4b untested.
3. **Needs Plating** queue — to-dos routed from HQ (Library WO tool / Stock View) when the base is in stock; "Pull & Plate" pre-fills the pull. Demand-routed jobs carry a `PLW-…` WO#; manual initial-stock pulls default to `IS_MMDDYY`.
- **Demand/supply (HQ):** Tab 12.5 **Stock View** is the planning hub (NS snapshot + ROP/MOQ + variant-demand rollup + suggested qty). Dispatch: outsourced plated → plating flow; in-house Stocked → WO; in-house not-stocked → made-to-order from the sales order (off the planning board). The Library "Generate Production Work Order" is the one-off escape hatch.
- **CPQ side (sales):** the CPQ→NetSuite estimate push (`ERPPushPullTab`) pushes the **finished assembly** `base/CODE` for outsourced finishes and for in-house finishes flagged **Stocked** (consume finished stock); in-house finish-to-order pushes the base (floor makes+finishes). Quote total preserved (rollup line absorbs the balance).

## 9. Key files
- `src/components/PickPack/PickPackApp.js` — warehouse app (QUEUE/PACKING/COUNT/CONVERT/TRANSFER/PLATING/GALLERY/MESSAGING). All the plating/convert/transfer/count NetSuite writes + labels live here.
- `src/components/HQ/StockViewTab.js` — Tab 12.5 planning hub (suggested-qty, PO/WO builders, plated→plating + milling dispatch).
- `src/components/HQ/LibraryTab.js` — master library item editor + the one-off WO generator (stock-aware plating routing) + the "Stocked" checkbox.
- `src/components/HQ/LibraryMassUpdateTab.js` — bulk CSV + bulk field editor (incl. Stocked) + Outsourced Master Finishes editor (vendor = NS-synced).
- `src/components/HQ/ERPPushPullTab.js` — CPQ quote → NetSuite estimate push (finish-aware).
- `src/components/HQ/AdminTab.js` — role permission matrices (`PICK_TABS` etc.).
- `src/components/HQ/NetSuiteSyncTab.js` — pulls customers/vendors into `crm_records` as `CUST-/VEND-{nsInternalId}`.
- `functions/index.js` — the NetSuite proxy (generic pass-through; adds `Prefer: return=representation` on `/record/` POSTs).
- `firestore.rules` — security rules (publish separately; superset of live).
- `docs/ai-memory/` — the full AI project memory (this is the deep context; read `finishing-conversion-wip.md` first).

## 10. Gotchas
- Firestore doc ids **can't contain `/`** — finished codes (`H1-138EC/EP1`) must be sanitized into doc ids (`[^A-Za-z0-9]+`→`-`); keep the real code in a display field. (Caused two WO-generation crashes this session.)
- New Firestore collections need an explicit `firestore.rules` line (default-deny) AND must be published.
- The NetSuite proxy is pass-through → a single bad/unknown field rejects the WHOLE record (no per-field tolerance).
- Don't reintroduce the old flat CPQ-flow Hide-Geometry checklist — current region-grouped version is canonical.
