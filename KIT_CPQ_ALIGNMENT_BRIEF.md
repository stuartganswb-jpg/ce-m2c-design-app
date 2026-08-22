# Traverse kits ↔ the new CPQ engine — session brief, 2026-08-22

Paste into a fresh session. Written to be read cold.

**This session is CPQ only.** Stuart is working the other half in a parallel session: Quick Ship
(tab 7) refinement, 4.6 setup, and the checkout-fee catalogue. The two sessions touch each other in
exactly two places — **kit records** and the **checkout fee catalogue** — and nowhere else. Read
`CROSS_SESSION_CONTRACT.md` before the first edit.

| | Yours | His |
|---|---|---|
| Files | `Shared/HardwareConfigurator.js`, `hardwareModel.js`, `hardwarePricing.js`, `hardwareHandoff.js`, `kitCode.js`, the engine mount in `CPQTab.js` | `HQ/QuickShipTab.js`, `HQ/CustomerCollectionsTab.js` (4.6), `Shared/feeRules.js` |
| Shared, coordinate before editing | `kitCode.js`, `traverseExplode.js`, `traverseConfigurator.js`, `system/traverse_rules_H1-2TRV`, `ERPPushPullTab.js` | same |

---

## 0. Environment

Repo `github.com/stuartganswb-jpg/ce-m2c-design-app` · checkout `/Users/stuartgansmba/Projects/ce-m2c-design-app`
on **`main`**, fix-forward. App **www.4cosworkcenter.com** (CRA, Vercel **auto-deploys on push to
main**, ~2 min, hard-refresh ⌘⇧R after). Firebase `ce-m2c-design-collab`.

Functions + `firestore.rules` are **manual, Google Cloud Shell only** (`firebase login` fails on this
Mac). Nothing in this brief needs them — but note `firestore.rules` is a **whitelist**, which is why
the traverse rules live at `system/traverse_rules_H1-2TRV` rather than a new collection. Keep new
documents under `system/`.

**Verify:** `node scripts/hardwarePricing.test.mjs` · `node scripts/hardwareHandoff.test.mjs` ·
`node scripts/kitCode.test.mjs` · `sh scripts/run-traverse-tests.sh` ·
`npx --no-install eslint <file>` (0 errors) · `CI=false npx --no-install react-scripts build`.
Baseline on 2026-08-22: pricing **54 passed**, handoff **28 passed**. App Check + the PIN gate mean
**no script can touch prod data and there is no browser harness** — pure `Shared/*` modules plus node
tests are the only verification path, and a push is proven only by one real quote through the RTG
NetSuite Transmit Log.

**Git, multi-session:** never `git checkout <branch>` or `git stash` in this checkout · stage only
your own files (never `git add -A`) · `rm -f .git/index.lock` then
`git pull --rebase --autostash origin main` before every push.

---

## 1. What already works — do not re-prove any of it

**The engine.** `HardwareConfigurator` + `hardwareModel` is the default for Classical and available
on every brand (`newEngine` / `engineOn` in `CPQTab.js`). A 2D tear sheet, a pillow flow, or a flow
with no linked assembly still opens the OLD configurator — `flowNeedsOldEngine` at
[CPQTab.js:895](src/components/HQ/CPQTab.js:895), and that must stay true.

**The handoff.** `handoffItem` ([hardwareHandoff.js:88](src/components/Shared/hardwareHandoff.js:88))
writes the same cart item the old engine wrote — `pricing.finalPrice`, `pricingBreakdown`,
`finishes`/`finishLabel`, `trvComponents` — plus `engine: 'TAGS'` and three per-line facts
(`hidden`, `trvComponent`, `finishCode`). Every downstream consumer was left untouched on purpose.

**The push.** `resolveJobLines` branches on `cart.engine === 'TAGS'`
([ERPPushPullTab.js:209](src/components/HQ/ERPPushPullTab.js:209)) and reads the finished BOM instead
of walking flow steps, through the *same* `routeFinishedItem` the step walk uses.

**Traverse components in the walk.** The configurator is the engine's last step on a traverse rod
(`isTraverse`, [HardwareConfigurator.js:554](src/components/Shared/HardwareConfigurator.js:554)). It
seeds from the length chart and re-seeds when the length changes, until the operator touches it.
`trvDrive` reads `answers.drive`; `trvTracks` reads `answers.setup` — **the axes already drive it**.

**Pricing.** `priceChoice` composes the existing rules in one order: override → price level → the
customer's 4.6 row → base price → the flow's per-role fallback, with the 2026-08-21 rule that a
*defaulted* level loses to the customer's own row (the Brimar french-return fix). It adds no pricing
rules of its own, and it must not start.

**Kit machinery that exists today — all of it Quick Ship-side:**
- `manufacturingSpecs.kitAlign` = `{ setup, frontRail, drive, mount, material, minFeet }` on each
  Kit-class record, written by the 4.6 kit-sheet importer (`traverseKitImport.js`).
- [kitCode.js](src/components/Shared/kitCode.js) — `parseKitCode` (the
  `H1-2TRV-4 M? (D|FRT)? C? /(P|EP|W) (-<watt><W|C>)?` grammar), `matchKit`, `resolveKitCode`,
  **`kitCodeFor`** (configuration → the customer's own code — the reverse banner), `describeKitAlign`.
- `kitMotorCodes[]` = per-motor identification codes hanging off a base kit (`{ code, fabSku,
  motorItem, net }`); `kitFinishOptions[]` = the finish matrix ticked in 4.6.
- `explodeTraverse` = kit → the components NetSuite consumes.
- `system/traverse_rules_H1-2TRV` = per-length usage totals + the configurator item list with the
  `billable` flag.

**Checkout fees on the new engine.** The configurator's strip has a `Checkout (N)` button wired to
`onCheckout` → the same `showCheckoutModal`. The catalogue is curated in 4.6 → Checkout Items,
add-on lines append to `cpqData.breakdown` after the configuration subtotal is fixed. Not broken by
the engine swap.

---

## 2. Where we left off

**Kit alignment was built against the OLD flow and does not survive the engine swap.** The kit ⇄
configuration translation assumed `TRV_SETUP` / `TRV_LENGTH` flow steps and a `trvSelection` blob.
The tag engine has no steps and never will. So the *Quick Ship* half still works end to end, and the
*CPQ* half is gone. **That is the "start over" — rebuild it against the engine's axes, not against
steps.**

**Percentage-of-order fees are untested.** Flat and per-unit checkout fees have been used;
percentage-of-order has not been run end to end. Stuart is testing that in the other session. Until
it lands, **do not build anything that depends on percent-fee semantics** — in particular do not
change what the configuration subtotal contains.

---

## 3. The work — a client's kit becomes pre-existing decisions

The goal, in his words: when that client is selected, the CPQ flow already carries the decisions that
match their kits.

### 3.1 The mapping

| `kitAlign` | The engine |
|---|---|
| `setup` SINGLE/DOUBLE | `answers.setup` — the `setup` axis (AXES order 20) |
| `drive` MANUAL/MOTORIZED | `answers.drive` — the `drive` axis (order 25), asked only where both exist |
| `mount` WALL/CEILING | `answers.mount` — the `mount` axis (order 30) |
| `frontRail` TRACK/RING | **not an axis — a PICK.** RING = the front tier's rod is `H1-2RCTPR` (ring pole); TRACK = a second track. Seed the FRONT-tier rod slot, not an answer. |
| `material` P/EP/W | the finish family: `/P` → in-house paints, `/EP` → outsourced plated, `/W` → `S…` stains. Same rule as Quick Ship's `trvFinishOptions`, and `kitFinishOptions` on the record wins over it. |
| `minFeet` (4) | the length minimum + the 4ft minimum charge |
| — | **`proj` has no kit equivalent.** `explodeTraverse` literally notes "bracket assumed standard projection — Quick Ship does not ask projection". Open question below. |

### 3.2 The seed mechanism already exists — copy it, do not invent one

`seedFromVision` + the effect at
[HardwareConfigurator.js:306](src/components/Shared/HardwareConfigurator.js:306) is the precedent and
the contract:

- applied **once** per source id (`seededRef`), never re-applied — a seed is answers, not a lock, and
  re-applying fights the operator;
- matches on **part numbers**, never guesses;
- returns **`carried` and `missed` together** — what could not be seeded is reported, not
  approximated, and the caller shows both (`visionReport`).

A kit seed is the same shape: `seedFromKit({ kit, model })` → `{ answers, picks, lengthMin,
finishFilter, carried, missed }`. Put it in its own pure module with node tests (`kitBridge.js`
alongside `visionBridge.js`), mount it behind one guard. **One addition, nothing else** — prove the
rest untouched with `git diff -w`.

### 3.3 Which kits, and when

Entitlement is already defined and must stay identical to Quick Ship's: **Kit-class record + carries
`kitAlign` + has a `clientPricing` row for the selected customer**
([QuickShipTab.js:514](src/components/HQ/QuickShipTab.js:514)). The engine already receives
`customerId` and `customer`, so the kit list is derivable where it stands.

The reverse direction is already written: `kitCodeFor(kits, align, motorItem)` turns the current
configuration into the customer's own code. That is the banner — *"this configuration is your
H1-2TRV-4MD/P-35C"* — and it is the cheapest first deliverable, because it needs no seeding at all
and immediately proves the axis mapping is right.

### 3.4 The questions only Stuart can answer

1. **Projection.** No kit carries one. Does a kit seed a default projection, or does CPQ still ask?
   (Quick Ship silently assumes standard; a CPQ quote that does the same will eventually ship the
   wrong bracket.)
2. **Seed or lock?** If the operator diverges from a seeded kit, does the configuration silently
   become custom (banner drops), or does it warn?
3. **What does a kit-matched CPQ configuration BILL?** Today these are two different numbers: Quick
   Ship bills the **kit** (per-set price + per-foot from the `clientPricing` row); the engine bills
   the **sum of the resolved parts**. Both are defensible; they must not both be live.
4. **The motor.** Quick Ship folds it into the kit line at the per-motor code and price so our line
   matches their PO line. The kit importer's comment says CPQ prices the motor as an upcharge. Which
   one does a Fabricut CSR read on a CPQ quote?

---

## 4. Fees on this side

The engine already models fee ITEMS as parts — a french return is a fee item pinned on the assembly,
priced through the same chain, riding the BOM as a line flagged `isFee`. Checkout fees are a second
mechanism. The dividing line to propose to Stuart: *if the cart held two configurations, would this
fee be asked twice?* Yes → an engine fee, pinned on the assembly (returns, bends, miters). No → a
checkout fee, attached to the order (rush, freight, packaging, strike-off, custom colour).

The consequence worth stating to him plainly: any fee that has moved onto the engine must be
**unticked** in 4.6 → Checkout Items, or it bills twice — the same rule already written there for the
french return. That tick-list is the other session's surface; report, don't edit.

---

## 5. Traps — four of them are non-negotiable, two were found by reading

1. **A fee never pushes as a NetSuite item line.** It prices the quote and rides the rollup.
   `resolveJobLines` skips `l.isFee` in the TAGS branch and re-checks `partClass === 'Fee'` /
   `productType === 'FEE'` on the resolved part. Keep both.
2. **A traverse component is pushed once.** The rows are on the breakdown for the documents *and* on
   `item.trvComponents`, which is what the push reads. The `trvComponent` flag is what stops the
   breakdown walk pushing them a second time — remove it and the order carries double the carriers.
3. **Hidden lines are BOM-only.** `customerLines()` filters them; production consumers take
   everything. One list, two audiences.
4. **The old engine still runs lighting and pillow.** Do not delete its checkout path.
5. **⚠ The push re-prices instead of reading the quoted line** *(verified by reading, not yet proven
   on a live push)*. `handlePushToNetSuite` rates every line at `clientPriceFor ?? basePrice`
   ([ERPPushPullTab.js:456](src/components/HQ/ERPPushPullTab.js:456)) — it knows nothing of the
   engine's override / level / fallback sources. The loud case is the per-foot rod: `priceConfiguration`
   keeps `qty: 1` and multiplies the money by feet, so a 10ft rod quotes $125 and pushes as 1 × $12.50
   with the balance absorbed by the rollup — and NetSuite consumes one unit of rod stock instead of
   ten feet. The estimate total still lands on the quoted figure, which is why nobody has seen it.
   **Prove it on a Transmit Log before changing anything**, and route the fix through Stuart — the
   push is shared ground.
6. **⚠ The finalize merge drops per-line flags** *(verified by reading)*. `mergedBreakdown` rebuilds
   each row from an explicit field list ([CPQTab.js:2602](src/components/HQ/CPQTab.js:2602)) and does
   not carry `hidden`, `trvComponent`, `finishCode` or `clientSku`. So the quote HTML
   ([CPQTab.js:2891](src/components/HQ/CPQTab.js:2891)) and CRM documents
   ([ExternalCoopTab.js:1192](src/components/HQ/ExternalCoopTab.js:1192)) print hidden BOM-only parts
   to the customer, and cannot filter them because the flag is gone. The push is unaffected — it
   reads `cartItems[].pricingBreakdown`, where the flags survive.
7. **A `const` is not hoisted.** A hook whose dependency array names something declared further down
   throws "Cannot access X before initialization" and takes the whole engine out. It has happened
   once. Scan declaration order after moving anything.
8. **The app is code-split.** After a deploy, hard-refresh; if a change "does nothing", grep the live
   bundle for a plain-ASCII marker BEFORE debugging the feature — and sweep **every** chunk map, not
   the first.

---

## 6. Suggested order of work

1. **The reverse banner** — `kitCodeFor` against the live axes. No seeding, no schema, and it proves
   the mapping in §3.1 is correct before anything depends on it.
2. **`kitBridge.js` + node tests** — pure, `kitAlign` → `{ answers, picks, … , carried, missed }`,
   tested against the real kit records the importer produces.
3. **One guarded mount** in the configurator: the customer's entitled kits, picking one seeds once
   and reports what it could not carry.
4. **Then, and only with Stuart's answer to §3.4 Q3**, the pricing question — kit price vs sum of
   parts. Do not guess this one; it is the difference between a quote that matches their PO and one
   that does not.
