# New Engine → Checkout — continuation brief

**Written 2026-08-20, end of session. Stuart is testing the shipped work right now.**

The tag-driven configurator ("NEW ENGINE", `Shared/HardwareConfigurator.js` +
`Shared/hardwareModel.js`) is close to final on **H1-138**. Stuart is about to open it to the team
for testing. The remaining work is **checkout**, described at the bottom.

---

## 1. Where things stand

**Return point:** `git checkout engine-good-2026-08-20` — a tag on the last known-good H1-138 state
before the step reshuffle. Everything after it is verified, but that tag is the parachute.

### Shipped today (newest first)

| commit | what |
|---|---|
| `9648294` | centre-bracket count = span total − ends that carry load |
| `767d162` | one pole per BOM line; footage prices it; `cutLength` now set |
| `3ad2e08` | quantity field on centre bracket + rings, reaching BOM and router |
| `60bff4c` | rod stock bills by the foot |
| `6352348` | `NO PLATE` tag in 1.6 |
| `e53dbfe` | a return falls back to plain plates |
| `a02fb50` | `reseatPicks` — a bracket change swaps the pin, keeps the part |
| `6b71fdb` | a pin naming its tier beats an untagged one |
| `6d716f1` | reshuffle phase 2 — pole length before the brackets |
| `f6ac01d` | reshuffle phase 1 — ends lead |
| `e96131c` | the selection settles instead of stranding stale picks |
| `4c25583` | framing questions collapsed into one step |
| `c5b9bd4` | tier pricing: a null bare column is not "included" |
| `ad395a5` | span guidance asks 6.5 with the item code |

### Current H1-138 step order

```
Rod Setup (rod type · single/double · drive · mount)
→ Bracket Projection
→ Front L/R end, Back L/R end
→ Pole Length
→ Brackets → Backplates → Rods → Rings
```

---

## 2. What Stuart is testing now

Everything in the table above, particularly:

- **Per-foot rods** — a 10 ft double should read `one pole · 119" 10 ft × $12.50` per rod, qty **1**.
- **Quantities** — centre bracket and shared rings have a "How many" field. Rings/carriers
  recommend `4 × ft + 2`. Centre bracket recommends `span total − load-bearing ends`.
- **H1-2TRV tags** — a save may still be sitting on its confirmation alert (see §4). It sets all
  four fascia and the passing ring to `rod: front`, which removes the phantom BACK FASCIA step and
  drops rings from BACK SHARED.

---

## 3. The remaining work — CHECKOUT

Stuart's spec, verbatim in intent:

> Once the config is done, checkout should let you **print, PDF and email right there**, then save
> the quote and make it accessible in the CRM — no trip to tab 10 just to send it. Two buttons:
> **Save as Quote** and **Save as Sales Order**.

Four pieces, very different sizes. **Recommended order: ① ② ④ ③.**

### ① Traverse components modal is bypassed — a real bug

The old engine gates every add:

```js
// CPQTab.js ~2455
const handleAddToCart = async () => {
    if (isTraverseFlow && trvRules && trvPendingRef.current === null) { setTrvCfgOpen(true); return; }
    const trvComponents = trvPendingRef.current || [];
    ...
    pricing: { ...pricing, finalPrice: (pricing.finalPrice||0) + configuratorTotal(trvComponents) },
    pricingBreakdown: [...pricingBreakdown, ...trvComponents.map(...)],
```

The new engine does **not**:

```js
// CPQTab.js ~4502
onAdd={(item) => setCart(prev => [...prev, item])}      // straight into the cart
```

**So a traverse config through the new engine silently skips its track components.** They are never
asked for and never reach the quote. This is the one known functional gap the team may hit.

Not a one-liner: the components fold into the item's `finalPrice` *and* `pricingBreakdown`, and the
modal's completion path re-enters `handleAddToCart`. It needs to learn which engine is waiting.
~25 lines in the shared `CPQTab.js`, touching cart money — worth doing carefully.

### ② The 4.6 checkout item list — probably already works

`buildCheckoutCatalog` (`Shared/feeRules.js:158`), curated in 4.6 → Checkout Items, is applied at
**cart level**, so new-engine items should already get it. **Test before building anything.**

### ③ Save as Quote / Save as Sales Order — genuinely new

There is **no sales-order path anywhere in the app** (grep for `salesOrder` / `SALES_ORDER` returns
nothing in CPQTab or ExternalCoopTab). This one writes a real order downstream into RTG and
eventually NetSuite. **Do it on its own, in a session where nothing else is changing.**

### ④ Print / PDF / email at checkout — reuse, don't invent

PDF machinery already exists in `ExternalCoopTab.js` (`.pdf-page` print CSS) and
`Shared/QuickShipInvoiceModal.js`. The wrinkle: doing this *at checkout* means rendering the
document from the **cart**, before anything is persisted — a different lifecycle from tab 10, which
renders an already-saved quote.

---

## 4. Operational must-knows

**Vercel — the stale-build trap.** A deploy can report "Ready" with the right commit hash and a
fresh `version.json` and still serve OLD code. If a shipped change "does nothing", grep the live
bundle *before* debugging the feature:

```bash
curl -sL https://www.4cosworkcenter.com/ | grep -o 'static/js/main\.[a-z0-9]*\.js'
```

Fix is a dashboard redeploy with **"Use existing Build Cache" UNCHECKED**.

- **Use a marker that survives minification.** Local variable names are mangled — grepping for one
  gives a false negative. Use a distinctive string literal, or compare the minified logic itself.
  Today `hidden:!!e.hidden` and the rank function's shape both worked; `chosenPoles` did not.
- **The app is code-split.** Tab code (Library, Admin, CRM…) never appears in `main.*.js`. CPQTab
  *is* in main. For tab code, sweep **every** chunk map in the main bundle, not just the first.
- Vercel stopped building entirely for ~4 hours today; an empty commit restarted it.

**Firebase Functions are NOT auto-deployed.** Frontend auto-deploys on push to `main`; functions do
not. `firebase login` fails on this Mac. Deploy from **Google Cloud Shell**:

```bash
firebase deploy --only functions:netsuiteProxy --project ce-m2c-design-collab
```

**Firestore enforces App Check** → no local or Node script can read or write production data. All
bulk data work happens **inside the authenticated app**. That is why tag changes are driven through
the 1.6 UI rather than scripted.

**Never authenticate as Stuart.** The PIN gate appears after any reload. Ask him to click
AUTHENTICATE; do not enter credentials.

**Multi-session git.** Several Claude sessions work this repo at once. Never switch branches in the
shared checkout. Stage only files you changed (never `git add -A`). Always
`git pull --rebase --autostash origin main` before pushing.

---

## 5. Traps learned today — these cost real time

**1.6 editor: DOM row order ≠ editor state order.** 463 of 466 rows differed. Index-matching state
rows to DOM selects wrote 30 edits to the wrong rows. Caught before saving, discarded via Load
Choices. **Identify rows by name and section heading, never by index.**

**1.6 editor: synthetic events stop registering under load.** With 466 rows open, `dispatchEvent`
on a select silently reverts — the assembly picker itself stopped switching. At 59 rows it works
fine. If edits will not stick, reduce what is open or reload.

**1.6 save ends in a native `alert()`** ("✅ Wrote N pins") that **freezes the whole tab** until a
human clicks OK. Synthetic Enter does not reliably dismiss it. Expect to ask Stuart.

**Always run the idempotency check before a 1.6 save.** The save rewrites every pin. A row whose
item was auto-matched by the library but has no pin will **create a new one** — this is how a
duplicate F-clip got billed. Compare each row's intended partId against existing pins on that node
and confirm zero identity changes first.

**`HardwareConfigurator.js` hook order is load-bearing.** A `const` read before its declaration is a
`ReferenceError`, which React answers by unmounting the tree — the white screen of 2026-08-17. The
length hooks have been hoisted twice for this reason. There is also a real cycle to respect:
`advice → quantities → resolved`, so `advice` reads the **pre-quantity** `model`, never `resolved`.

**Do not bundle unrelated changes in one commit.** The step reorder and the per-slot dedupe shipped
together; the reorder broke H1-138, the revert took the dedupe with it, and the duplicate backplates
came back. One idea per commit.

---

## 6. How Stuart wants this worked

- **Tags, not rules.** "All fixes on the items, not on the flow." If behaviour differs between two
  collections, the item should say so — do not derive it from the rod world or anything else.
- **Discuss before rule/code changes.** Check tags first and report before touching the engine.
- **H1-138 must not regress.** It is the reference flow and the team is testing it.
- **Verify, do not assume.** Every claim about behaviour today was cheap to check and several
  "obvious" reads were wrong.

### Open data items (his, not code)

- **Unpriced, flagged red in the panel:** `H1-138AR` (acrylic rod), `H1-138D`, `H1-DBLMR`.
  `H1-DBLFR` is set at $75; its miter twin needs the same in 4.6.
- **`slot_1786739405484` / `…406248`** — the two `NEW-SLOT · FINIAL · LEFT/RIGHT` sections (15 rows
  each) hold the front finials and should carry **`rod: front`**. The tier tie-break (`6b71fdb`)
  stops the symptom, so this is hygiene. My attempt to script it hit the two 1.6 traps above.
- **H1-2TRV** has two fascia clusters offering the same wood/metal pair (`short_rod` and
  `slot_…237366`). Stuart says there is only one fascia, at the front. Why it exists twice is
  unresolved — both are currently tagged `rod: front`.
- **Centre-bracket cloning** — the old engine offset the centre bracket as its count rose (1 in the
  middle, 2 at the thirds…). The count is now correct everywhere; **only the picture still draws
  one**. That is renderer work and its own change.
