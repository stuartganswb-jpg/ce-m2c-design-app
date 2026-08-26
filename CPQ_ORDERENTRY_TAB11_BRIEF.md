# CPQ · Order Entry · Tab 11 Flow Setup — Session Handoff Brief

*Written 2026-08-26 after a long live session with Stuart (pinned into the app, driving Chrome).
Scope: **8. CPQ Configurator, 7. Quick Ship/Order Entry, 11. System Admin flow setup** — the sales
side. The sibling brief (`WO_CREATION_SCREENS_BRIEF.md`) covers Stock View / Sales Snapshot /
Master Library. Read `APP_ARCHITECTURE_BRIEF.md` §4 first — the H1 principle and canonical-field
rules govern everything here.*

---

## 0. Operating the session (how this session actually worked — reuse it)

**Login (the pin-in workflow).** Stuart will pin you into the live app — this is now the standard
loop and it caught two bugs code-reading missed:
- Use the **Claude-in-Chrome** tools (his real Chrome, his session), NOT the preview pane — his
  logins live there. `tabs_context_mcp` first, then drive by `find`→ref, not coordinates (the page
  scrolls between screenshot and click; ref clicks don't drift).
- Two gates: **Factory Portal** (email+password) then **Enterprise PLM PIN** on every `/hq` load.
  Stuart types both — NEVER enter credentials; navigate to the gate and tell him it's up.
- Auth survives SPA tab-switching but NOT reloads. To pick up a fresh deploy you must reload →
  Stuart re-PINs. Prefer staying inside the SPA (switch flows/tabs) when the bundle hasn't changed.
- Tab-11 item rows save on every commit, so switching HQ tabs mid-edit is safe.

**Vercel (auto-deploys on push to main).** Trust nothing until verified:
- `curl -s https://www.4cosworkcenter.com/version.json` → `{v: <ms epoch>}` = build stamp. Compare
  to `git log -1 --format=%ad`. Stamp AFTER commit time = your build is live.
- Marker-grep the bundle: **CPQTab/HardwareConfigurator are in `main.*.js`** (not chunks). AdminTab,
  Library, QuickShip etc. are lazy chunks — sweep via `/asset-manifest.json` (lists every js file),
  never the chunk-map regex alone. Markers must be string LITERALS (comments are minified away —
  that mistake was made twice this session).
- The app shows a "NEW VERSION IS LIVE — TAP TO UPDATE" toast when version.json changes.
- Stale-build trap: see CLAUDE.md (redeploy without build cache).

**Cloud Shell** (functions + rules do NOT auto-deploy): `shell.cloud.google.com` → `git pull` →
`firebase deploy --only <target> --project ce-m2c-design-collab`. **Pending deploys Stuart owns:**
`firestore:rules` (the `hq_deletion_log` append-only ledger — see sibling brief) and a
`functions` tweak (portal jobs list should filter `!j.deleted`).

**Git**: multi-session repo — never switch branches in the shared checkout, stage only your files,
`pull --rebase --autostash` before push. Fix-forward on main.

---

## 1. Where the sales side stands (all shipped & verified this session)

**Save IS send** (`Shared/nsTransmit.js` — the ONE resolver/payload builder, extracted from tab 12):
- CPQ checkout: **💾 Save as Quote** (jobs status `CONFIGURED`, stays in CRM Quotes window, estimate
  auto-queued via `ns_outbox`, NS numbers write back via worker writeBack arrays) and **🛒 Save as
  Sales Order** (status `APPROVED`, RTG board doc `SO-APP-*` created instantly, NetSuite salesorder
  queued; real SO # replaces the app id on writeBack).
- CRM **Approve** queues the REST estimate→salesorder **`!transform`** — ⚠ **never yet verified
  against the live account**. First real approve: watch RTG's Transmit Log; if NetSuite refuses the
  transform, the error lands there verbatim.
- CE custom forms: estimate **299**, salesorder **177**. `custbody50` carries the app quote id.
- Tab 7 is local-first: record saved, then staged sync; a Quick Ship **quote** now creates a `jobs`
  doc on the CRM pipeline; an SO sits `NS_QUEUED` (hidden from WMS + CRM) until NetSuite accepts.
- `quoteDisplayNo` precedence: SO tran # > SO id > EST tran # > EST id > quoteNo > doc id.

**Kit-family tag system** (Stuart's design: "a tag system … so as we add new ones, it's automatic"):
- Kits carry `manufacturingSpecs.kitFamily` (4.6 kit-sheet import stamps it; hand kits derive from
  code); flows carry `flow.kitFamily` (generator stamps on generate AND regenerate — but refuses
  doc-id-shaped codes like `CE-ASM-*`; tab 11 → Flow Settings → **Kit Family 🏷** field edits it).
- CPQ picker matches TAG-first, then assembly-code prefix, then the **suffix-name fallback**
  ("H1-2TRV — GENERATED" → family segment before the em-dash). Super-admin sees a dashed diagnostic
  in the strip's place naming both tags + sample kit codes when nothing matches. Verified live: the
  H1-2TRV picker is back.

**Tab 11 = the master control of what CPQ presents:**
- `flow.extraItems` is EXACTLY what the configurator offers (the 08-24 library auto-derivation of
  splices is retired — it offered every diameter's joiner). Each item has a **Step** field (free-
  text matched against the live step label, datalist of flow steps + engine labels; blank = the
  pole-length step). Splice requirement/banner stays on the length step (`flow.spliceOverInches`).
- Checkout items: flow-standard list on tab 11; per-customer in 4.6 (`checkoutCustomers`) —
  ⚠ known gap: customer-specific ticks do NOT reach the customer's own portal checkout (needs Std).
- All tab-11 item fields now go through `Shared/BufferedInput` (keystrokes local, commit on
  pause/blur/Enter) — the save-per-keystroke latency is dead. Reuse this component for any other
  laggy field.

**Engine (new/tag engine) fixes:**
- **A single order has one rod** (`hardwareModel.slots`): tier questions collapse on `SINGLE` —
  FRONT wins when both tiers exist; a BACK-only assembly (H1-75) is treated as THE rod; labels drop
  the tier word on singles (`slot.tierSolo`). Doubles unchanged.
- **The Context-Lost storm is fixed** (`hardwareThumbs.js`): thumbnail batches run one-at-a-time
  through a module queue, ONE reused renderer (released after 5s idle), and a photo taken on a lost
  context is never cached (was the "thumbnails sometimes blank all session" bug). The configurator
  effect re-fires on a content key, not array identity. This is also what blanked the MAIN viewer.
- **Pole length placeholders** are em-dashes now — "96"/"1/2" as placeholders read as entered
  values and produced the false "pole not computing" report. The per-foot math is verified live:
  96″ → 8 ft → $12.50/ft = $100; NetSuite receives **qty 8** (units=feet) via the handoff's
  `perFoot/feet` stamps + the resolver's qty×feet rule (legacy lines reconstruct from total÷price);
  the BOM prints **"1 (8 ft)"** (both router renders); the floor gets 1 piece + `cutLength`.
- Old per-foot quotes priced at **$0** cannot be reconstructed — reopen + re-save them once.

---

## 2. Still to work out (Stuart's words: "still some things")

1. **H1-75 tag cleanup (1.6, data)** — the engine's own red notes: `H1-75CB` has NO projection
   tag; `H1-75ILPS` tagged 4.625 vs item field 3.625; `H1-75BD` and `H1-75D` tagged 6.5 vs 3.25.
   "Clear it or correct it before somebody believes it." Also set/blank the H1-75 flow's Kit
   Family (it carried a junk `CE-ASM-…` stamp; the guard now prevents new ones).
2. **Kit sheet imports pending**: H1-138 (and beyond) — Stuart said H1-2TRV "is the only one I
   have done to date". Import in 4.6 → Kit Builder; the tag system lights the picker automatically.
3. **Estimate→SO transform live verification** (first real CRM Approve) + CE SO form 177 via the
   CPQ direct-SO path.
4. **Per-flow splice curation**: tab 11 lists per flow need review now the derivation is gone —
   H1-138 has `H1-138JNR`; check H1-1/H1-75/Brimar flows each list their own splice/joiner.
5. **Portal mirror-sweep** for the master-control change (portal CPQ mirrors flow logic — does the
   portal length step read `flow.extraItems`/step assignment? See `portal-cpq-contract` memory).
6. **4.6 checkout-items portal gap** (customer tick ≠ portal visibility) — decide if intended.
7. Traverse odds: `H1-2TRVMTR` miter segments price $0 (mill, no basePrice) — confirm intended
   (kit money model) or price the items; `H1-2TRV` flow's kitFamily field value.
8. The **User Guide tab** (in-app, after App Imp.) has an Orders & Customers section — keep it
   current with anything you change here; it's plain JSX in `UserGuideTab.js`.

## 3. Key files
`Shared/nsTransmit.js` (resolver/payloads/queue+transform) · `Shared/kitSeed.js` (seed/pricing) ·
`Shared/hardwareModel.js` (slots/tiers) · `Shared/HardwareConfigurator.js` (UI, kit strip, diag,
length step) · `Shared/hardwareThumbs.js` (photo queue) · `Shared/hardwareHandoff.js` (cart line
contract: perFoot/feet/cutLength) · `Shared/BufferedInput.js` · `Shared/aliasSearch.js` (customer-
code matching — also in tab 7 picker + tracer) · `AdminTab.js` (generator stamps, Flow Settings
Kit Family, master-control editor) · `CPQTab.js` (save buttons, kit diag, router print) ·
`QuickShipTab.js` (local-first push, customer-code resolution).

Memories: `rtg-netsuite-transmit`, `cpq-splice-checkout-scope`, `canonical-item-identity`,
`traverse-generator-fork`, `fabricut-h1-rollout`.
