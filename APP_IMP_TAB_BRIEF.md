# App Improvement Tab — Focused Brief (2026-08-14)

Start a session with: **"Read APP_IMP_TAB_BRIEF.md — you're running the App Imp feedback loop."**
Scope: ONLY the in-app improvement tab and the fixes it feeds. The 2D tear-sheet / M2C lighting
project lives in its OWN session (memory `sheet2d-cpq`); don't pick up its files here. Read
`CROSS_SESSION_CONTRACT.md` for territories + pending deploys before touching anything.

## 1. What the App Imp tab is

- Feedback tab in **every section** (HQ / Shop / Finishing / WMS), all roles, force-included in
  each nav. Users file issues; fixes ship fix-forward on `main`; the reporter closes the loop.
- **Data**: `system/app_feedback/entries` (subcollection → rules already cover it, no deploy
  needed for new entry fields).
- **Lifecycle**: NEW → you resolve with a note (card stays visible, "awaiting test") → reporter
  hits **✓ Tested** (VERIFIED, leaves the default list) or **✗ Failed** (REOPENED, their details
  appended). Write resolution notes PASTE-READY — Stuart pastes them from your summaries verbatim.

## 2. The operating loop (proven)

1. **Read entries live**: Claude-in-Chrome → Stuart's **"MacAir"** browser (switch_browser) → open
   4cosworkcenter.com/hq in a NEW tab → **Stuart PINs** → App Imp tab → `get_page_text`
   (screenshots time out on the heavy HQ tab; text is reliable).
   - Allowed domain is **4cosworkcenter.com ONLY** — attachments (firebasestorage) can't be
     opened; ask for text or in-chat screenshots.
   - **PIN auth is in-memory PER TAB** — any reload/navigate logs the tab out. Batch your reading;
     warn Stuart before anything that reloads.
   - **Native `alert()`/`confirm()` dialogs FREEZE the tab for automation** (renderer blocks; a
     stuck confirm once forced a reload + re-PIN). Before clicking buttons that end in dialogs,
     silence them in-page (`window.alert = m => { window.__lastAlert = m; }`, same for confirm →
     return true), read `__lastAlert` after, restore when done. Coordinates: computer-click frame ≈
     CSS px × 0.825; re-read `getBoundingClientRect` right before every click (panels grow and
     scroll the page) and `scrollIntoView` anything below the fold.
2. **Fix** → per-fix ship pattern: `npx --no-install eslint <files>` (0 errors) → `CI=false npx
   --no-install react-scripts build` → `rm -f .git/index.lock` → stage ONLY your files → commit →
   `git pull --rebase --autostash origin main` → push. Never switch branches (other sessions live
   in this checkout); briefs stay untracked.
3. **Resolve** the card with the paste-ready note; the reporter tests after the deploy.

## 3. Vercel settings (frontends — AUTO deploy on push to main)

- **HQ/floors/WMS app** (`src/`, CRA) → **4cosworkcenter.com**, ~2 min per deploy. Users must
  **hard-refresh (⌘⇧R)** AND **re-PIN** (see above) — say both every time you tell anyone to test.
- **Portal** (`portal/`, Vite) → its own Vercel project → **portal.classicalelements.com**, ~10 s.
  Build check: `cd portal && npm run build`.
- **`version.json` is a build TIMESTAMP only** (`{"v":"<ms>"}`) — no commit hash. Two pushes close
  together deploy SEQUENTIALLY: the first flip you see may be the EARLIER push's build (bit us
  2026-08-14 — a tab hard-refreshed after flip #1 was still one build behind). To wait for a
  specific commit: note the current `v`, wait for it to change, then **grep the live bundle for
  your change** before trusting it.
- **Verifying prod serves your code** (stale-build trap, memory `vercel-deploy-pipeline`): the app
  is CODE-SPLIT — tab code lives in `static/js/<id>.<hash>.chunk.js`, NEVER `main.*.js`. Extract
  every chunk map from live main (`LC_ALL=C grep -oE '\{[0-9]+:"[a-f0-9]{8}"(,[0-9]+:"[a-f0-9]{8}")*\}'`
  — sweep ALL matches), download the chunks, grep for a plain-ASCII marker string.
- **Truly stale build** ("Ready" + fresh stamp but old code): Vercel dashboard →
  ce-m2c-design-app → Deployments → top row ⋯ → **Redeploy with "Use existing Build Cache"
  UNCHECKED** (fresh clone). `"prebuild": "rm -rf node_modules/.cache"` stays as the guard.

## 4. Cloud Shell settings (functions + rules — MANUAL, Stuart runs it)

- Local `firebase login` fails on Stuart's Mac → ALL `functions/index.js` + `firestore.rules`
  deploys run in **Google Cloud Shell** (shell.cloud.google.com). You WRITE the command; Stuart
  pastes it:
  ```
  cd ~/ce-m2c-design-app && git pull origin main && firebase deploy --only functions:<name1>,functions:<name2> --project ce-m2c-design-collab
  ```
  Rules: `--only firestore:rules`. List the EXACT changed function names; for portal checkout/
  catalog work the safe set is all 13 `portal*` exports (`grep '^exports.portal' functions/index.js`).
- **Every functions edit ends with handing Stuart the command.** Until he runs it, prod functions
  are old while the frontend is already new — that mismatch caused Christie's blank portal
  checkout. Track pending deploys in `CROSS_SESSION_CONTRACT.md` §Pending and check there BEFORE
  diagnosing "prod doesn't match the code".
- Secrets: `defineSecret` (Google Secret Manager), set via Cloud Shell
  (`firebase functions:secrets:set NAME`) — never in bundles or CRA `.env`.
- Firestore enforces **App Check** → no local/Node script can touch prod data. Bulk data changes =
  admin buttons inside the authenticated app.

## 5. Done (shipped by the rapid-fix session — headlines; `git log` has detail)

App Imp tab + closed loop itself · quote author + CRM pipeline split + portal team-access matrix
(CRM side) · finished-goods WO overhaul (BOM explosion, live stock check, parent NS WO Route A,
make-up-order cascade, close-everywhere in RTG, On-Ord WO drill-down) · production gate
(pickGateOf) + WMS overtaken-pick flag · -S/-P stream recipes end-to-end (floor resolution, Recipe
Builder ID/name split, master/variant hierarchy, HQ↔floor sync direction) · finishStream item flag
· NS estimate mapping (CE form 299 / class 2 / PO# / memo / custcol3 sidemarks) · checkout add-ons
as real lines · JFP pull-source + auto −qty at pick · plating zero-rate guard + branded PO ·
1.6: fee picker, backplate proj:/mount: tags, 🗑 delete-section (now with phase logs + completion
alert), checkbox wrap · CPQ audit banner super-admin-only · inside mounts pool as END TREATMENTS
wherever loaded (H2 rule canonical, `03f92fc`) · delete-section silent-freeze feedback (`b1694ec`).

## 6. Outstanding (as of 2026-08-14 evening)

- **Awaiting Stuart's test**: 1.6 delete-section feedback (`b1694ec` — he was mid-test) ·
  inside-mount re-home (`03f92fc` — needs H1-138 flow REGENERATE after hard-refresh, then check
  the L/R End Treatment steps list the IMs and the bracket step doesn't; check IM option prices).
- **Traverse mixed-flow gating — THE open design item**: H1-138 mixes standard + traverse poles.
  Needed: "trv:carrier options only when a trv:fascia/track pole is selected; fascia math for
  integrated units." Lives in `Shared/traverseFlow.js` = traverse session's fork — Stuart routes.
- **Sinaya — "HQ·8 rendering not populating"**: PAUSED by Stuart; likely legacy Blender-era flow —
  ask which flow before chasing.
- **Christie — CPQ center backplate can't pick NONE**: PAUSED (flow being re-uploaded).
- **Christie — portal checkout blank**: functions deployed; awaiting her retest.
- **Sandra — WO11399 / HCUSMBF1 "sync BC1/BC2 to raw"**: awaiting Stuart's data look.
- **Eric — EP11 plating $0**: app guard shipped; DATA needed — screw's product-type row ($1) in
  HQ Admin → Plating Fees + fix the NetSuite PO line rate.
- **Grace**: rebuild CP recipes (CP master + CP-S/CP-P via variant checkboxes); her hand-finish
  card likely self-resolves once CP-P carries its Hand Applied step.
- **Older awaiting-test cards**: vendor-catalog BOTH fix · 📖 floor recipe dialog ·
  Wand-on-own-NS-line (re-push needed) · labels suite · JFP pull-source · cascade make-up orders ·
  Liesl's 1.6 layout.

## 7. Fenced files (multi-session courtesy)

`AssemblyBuilderTab.js` (Brimar session VERY active; App Imp + M2C sessions have both added to it
— additive only, flag in commits) · `RTGDispatchTab.js` · `ERPPushPullTab.js` · floors files
(ActiveFloor/SetupQueue/Recipes) · `AdminTab.js` + `CPQTab.js` now also carry the M2C session's 2D
fork/viewer (keyed on `sheet2d` — don't touch those branches here). Portal mirror work belongs to
the portal session (`portal-cpq-contract`).
