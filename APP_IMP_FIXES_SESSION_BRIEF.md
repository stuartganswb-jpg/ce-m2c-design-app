# App-Imp / Rapid-Fix Session — Brief (2026-08-14)

You are continuing the session that built and now operates the **App Imp feedback loop** and ships
rapid fixes across HQ/WMS/Finishing/CPQ at Stuart's direction. Read `CROSS_SESSION_CONTRACT.md`
first (territories, deploy matrix, git rules). Memory files carry the deep models — key ones:
`finished-goods-wo-model`, `finishing-machine-model` (-S/-P streams), `portal-cpq-contract`,
`payments-ups-integration` (that build runs in its OWN session).

## 1. The App Imp workflow (proven, use it)

- **App Imp tab** exists in every section (HQ/Shop/Finishing/WMS), all roles, force-included in
  each nav. Data: `system/app_feedback/entries` (subcollection → no rules deploy needed).
  Lifecycle: NEW → resolved-with-note (stays visible, "awaiting test") → reporter hits
  **✓ Tested** (VERIFIED, leaves default list) or **✗ Failed** (REOPENED + details appended).
  Stuart pastes resolution notes from your summaries — write them paste-ready.
- **Reading it live**: Claude-in-Chrome → Stuart's "MacAir" browser (switch_browser if multiple),
  open 4cosworkcenter.com/hq in a NEW tab, **Stuart PINs** (auth is in-memory per tab — a reload
  logs out), click App Imp, `get_page_text`. Allowed domain is 4cosworkcenter.com ONLY (portal +
  firebasestorage are blocked — attachments can't be opened; ask for text or in-chat screenshots).
  Screenshot capture on the heavy HQ tab often times out; get_page_text is reliable.
- Ship pattern per fix: eslint (0 errors) → `CI=false npx react-scripts build` → commit ONLY your
  files → `rm -f .git/index.lock`, `git pull --rebase --autostash`, push. Vercel auto-deploys
  (~2 min); users hard-refresh + re-PIN. Functions = Cloud Shell command handed to Stuart.

## 2. Open items (as of 2026-08-14)

- **Traverse mixed-flow gating — THE open design item**: H1-138 (1.6) mixes standard + traverse
  poles in one group. Tags exist and Stuart is applying them (`trv: fascia` on integrated
  pole/track units, `trv: carrier` on carriers, ALWAYS unticked). NEEDED: generator/CPQ rule
  "trv:carrier options appear ONLY when a trv:fascia/track pole is the selected pole; fascia math
  for integrated units." Lives in `Shared/traverseFlow.js` = **traverse session's fork** — Stuart
  to route (or explicitly direct building it here, flagged).
- **Sinaya — "HQ·8 rendering not populating"**: PAUSED by Stuart. Likely a legacy Blender-era flow
  (CPQ's render-audit banner is now super-admin-only, 48025db) — ask which flow before chasing.
- **Christie — CPQ center backplate can't pick NONE**: PAUSED (flow being re-uploaded).
- **Christie — portal checkout blank**: functions deployed (full portal set); awaiting her retest.
- **Sandra — WO11399 / HCUSMBF1 "sync BC1/BC2 to raw"**: awaiting Stuart's data look.
- **Eric — EP11 plating $0**: app guard shipped; DATA still needed — add the screw's product-type
  row ($1) in HQ Admin → Plating Fees; fix the NetSuite PO line rate.
- **Grace**: rebuild CP recipes (CP master + CP-S/CP-P via the variant checkboxes); her Manual
  Floor Control hand-finish card likely self-resolves once CP-P carries its Hand Applied step.
- Awaiting-test cards: vendor-catalog BOTH fix, 📖 floor recipe dialog, Wand-on-own-NS-line
  (re-push needed), labels suite, JFP pull-source, cascade make-up orders, Liesl's 1.6 layout.

## 3. What this session shipped (headlines — `git log` has the detail)

App Imp tab + closed loop · quote author (createdBy) + CRM pipeline split + portal team-access
matrix (CRM side; BFF enforcement pending) · finished-goods WO overhaul (BOM explosion, live
stock check, parent NS WO via Route A, make-up-order cascade, close-everywhere in RTG, On-Ord
drill-down shows WOs) · production gate (pickGateOf) + WMS overtaken-pick flag · -S/-P stream
recipes end-to-end (floor resolution, Recipe Builder ID/name split, master/variant hierarchy,
HQ↔floor sync direction: HQ pushes needs-recipe stubs DOWN; stub-delete offers HQ removal) ·
finishStream item flag (elbow) · NS estimate mapping (CE form 299/class 2/PO#/internal memo/
custcol3 line sidemarks) · checkout add-ons (any class + independent fee curation + push as real
lines) · JFP pull-source at creation + auto −qty adjustment at pick · plating: zero-rate guard,
branded PO (print + PDF twins, "<Vendor> <PO#>" filenames, Unit Cost/Amount) · 1.6: fee picker
entries, backplate proj:/mount: tags, 🗑 delete-entire-section (strips geometry from the .glb),
checkbox layout wrap · CPQ audit banner super-admin-only.

## 4. Fenced-file flags this session made (other sessions should know)

`RTGDispatchTab.js` (recipe display fallback, close-everywhere) · `AssemblyBuilderTab.js`
(layout wrap, fee picker, backplate tags, 🗑 section — Brimar session VERY active here) ·
`ERPPushPullTab.js` (estimate mapping, add-on lines) · floors files (ActiveFloor/SetupQueue/
Recipes — stream recipes, gate, 📖 dialog, JFP) · all at Stuart's direction, flagged in commits.

## 5. Working rules recap

Never switch branches; stage only your files; `pull --rebase --autostash` before push. ESLint 0
errors; full CRA build before ship. New `jobs`/order fields ripple: CRM cards, FormPreview,
portalMyOrders whitelist, ERP push. Firestore = App Check (no local scripts; admin buttons).
Briefs stay untracked.

## 6. Vercel (frontends — AUTO deploy)

- **HQ/floors/WMS app** (`src/`, CRA): auto-deploys to **4cosworkcenter.com** on every push to
  `main`, ~2 min. Users must **hard-refresh (⌘⇧R)**; the floor/HQ PIN auth is in-memory per tab,
  so a refresh also logs them out — warn when telling people to refresh.
- **Portal** (`portal/`, Vite): its OWN Vercel project → **portal.classicalelements.com**, ~10 s
  deploys, also auto on push. `cd portal && npm run build` is its build check.
- **Stale-build trap** (memory `vercel-deploy-pipeline`): a deploy can show "Ready" with the right
  commit yet serve OLD code. Verify prod by grepping the live bundle for a marker string — and the
  app is CODE-SPLIT: tab code lives in `static/js/<id>.<hash>.chunk.js`, never `main.*.js`; sweep
  EVERY chunk map in main (several exist), use plain-ASCII markers. Fix for a truly stale build:
  Vercel dashboard → ce-m2c-design-app → Deployments → ⋯ → **Redeploy with "Use existing Build
  Cache" UNCHECKED**.

## 7. Cloud Shell (functions + rules — MANUAL deploy, Stuart runs it)

- Local `firebase login` fails on Stuart's Mac → ALL `functions/index.js` and `firestore.rules`
  deploys happen in **Google Cloud Shell** (shell.cloud.google.com). You WRITE the command; Stuart
  pastes it. Template:
  ```
  cd ~/ce-m2c-design-app && git pull origin main && firebase deploy --only functions:<name1>,functions:<name2> --project ce-m2c-design-collab
  ```
  (rules: `--only firestore:rules`). Always list the exact changed function names; for portal
  checkout/catalog work the safe set is all 13 `portal*` exports (see PAYMENTS brief §1 or
  `grep '^exports.portal' functions/index.js`).
- **Every functions edit ends with handing Stuart the command** — until he runs it, prod runs the
  old functions while the frontend is already new; that mismatch caused Christie's blank portal
  checkout. Track pending deploys in `CROSS_SESSION_CONTRACT.md` §Pending and check there BEFORE
  diagnosing "prod doesn't match the code".
- Secrets for any new integration: `defineSecret` (Google Secret Manager), set via Cloud Shell
  (`firebase functions:secrets:set NAME`), never in bundles or CRA .env.
