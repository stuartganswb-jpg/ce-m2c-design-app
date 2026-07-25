# SESSION BRIEF — bringing VISION + QUICK SHIP into the customer portal

**Written:** 2026-07-25, for a FRESH portal session · **Repo:** github.com/stuartganswb-jpg/ce-m2c-design-app · **Branch:** main
**Mission:** give portal customers the two surfaces they don't have yet — a **stock counter** (HQ tab 7, Quick Ship) and a **measurement intake** (HQ tab 9, Client Vision — scope settled in §6) — without diverging from the internal app.

**Read first:** `PORTAL_CPQ_CONTRACT_BRIEF.md` (the architecture + mirror rule) and `CPQ_VISION_QUICKSHIP_BRIEF.md` §4b + §8 (the alias rule and the standing portal gaps). This brief assumes both and only adds what's new.

---

## 1. The one rule that governs all of this

The portal **never touches Firestore** — customer tokens are denied on every collection and Storage bucket by rules (`isAuth()` excludes `customer` claims). It only ever sees what a **BFF Cloud Function** hands it. So:

- **DATA rides free** — new items, prices, flows, finishes, collections, `clientPricing`, GLBs. Nothing to do.
- **LOGIC/SCHEMA must be mirrored**, and the mirror is the whole job. Five places:
  1. `functions/portalEngine.js` — pricing/size/priceLevel port
  2. `functions/index.js sanitizeStep()` — the step-field whitelist (the ONLY reason internal fields don't leak)
  3. `portal/src/cpqRender.jsx` — DynamicModel + studioScene port
  4. `portal/src/Configurator.jsx` — override builders + return/bracket rules
  5. `portal/src/shared/{sizeMatrix,priceLevels}.js` — **verbatim copies**; `cp` them in the same commit and diff them

**Whatever you add for stock, add it as a new BFF function + a new portal page — do not widen an existing one.** The sanitize boundary is per-function and that's what keeps leaks impossible.

Portal app: `portal/` (Vite, React 19, its own Vercel project, root = `portal/`). Files today: `App.jsx`, `Showroom.jsx`, `Configurator.jsx`, `cpqRender.jsx`, `firebase.js`, `shared/`. There is **no** stock page and **no** Vision page — both are net new.

---

## 2. Entitlement — what a customer may see

Set on the CRM card (**External Co-Op → customer → Portal Access**):

| Field | Meaning | Status |
|---|---|---|
| `portalFlowIds: []` | the flows they may open (master gate for the configurator) | live |
| `portalCollections: []` | the collections they may see; **empty = whole catalog** | enforced server-side in `portalCatalog` / `portalFlow` / `portalQuoteRequest` / `portalResolve` as of commit `0341e21` — **confirm the Cloud Shell deploy actually ran** |
| `portalPriceLevel` | `STANDARD` / `FAB_WHOLESALE` / `FAB_RETAIL`; **`FAB_COST` is forced back to STANDARD server-side and must never be exposed** | live |
| `qsRingPack` / `qsFinialPack` / `qsInsideMountPack` | preferred pack per category (see §4) | app-side only — **the portal ignores these until you port them** |

`portalCollections` is the natural gate for a stock counter: it already answers "which product lines is this customer allowed to buy off the shelf?" Reuse `collectionGateOf` / `assertCollectionAllowed` in `functions/index.js` rather than writing a second gate.

---

## 3. Quick Ship as it stands (HQ tab 7) — what you're porting

`src/components/HQ/QuickShipTab.js`. Stocked/pre-finished goods → **flat NetSuite Sales Order lines**, no BOM, no flow. Mirrored to `hq_sales_orders` with `orderClass:'QUICKSHIP'` for pick/pack.

The picker is **six stacked predicates**, and porting means porting all six or the portal will show a different catalog than the counter:

1. `manufacturingSpecs.isStocked === true`
2. **collection scope** — `manufacturingSpecs.collections`, alias-linked (§5)
3. category from `productType` → POLE / BRACKET / RING / FINIAL
4. **finished goods only** — the code must carry a `/FINISH` suffix; a bare code is a raw mill part we paint and never sell
5. **rod diameter** — parsed from the code's size grammar via `Shared/sizeMatrix` `sizeKeyOf`, alias-aware
6. **finish** — the `/SUFFIX` itself; one finish per kit

Plus **outer vs center brackets**, which are NOT derived from naming: the flow generator stamps `stepRole:'BRACKET'` + `position: LEFT|CENTER|RIGHT` on generated steps (`AdminTab.js` `addPerPosition`), and Quick Ship indexes `styleOptions[].partName/partId` from a brand-wide `cpq_flows` query. **`sanitizeStep()` already whitelists `stepRole` and `position`**, so a portal port can read the same thing from `portalFlow` — but a brand-wide flow query has no portal equivalent, so this likely wants its own BFF call.

There's an **"Item missing? Type its code"** probe at the foot of the Kit Builder that replays all six predicates and names the one that rejected an item. Port it or not, but read `diagFor()` — it is the clearest statement of the filter chain.

---

## 4. Packs — the part most likely to be got wrong

`src/components/Shared/quickShipUom.js`. **Verbatim-copy candidate** into `portal/src/shared/` alongside `sizeMatrix`/`priceLevels`.

We **stock EACH and pack to order**. A pack is a selling unit, never a separate SKU. Some customers buy rings 7/10/12 to a pack, finials singly or in pairs.

> **The invariant, which must hold identically in the portal:**
> **qty means PACKS · `rate` is always per EACH · every subtotal multiplies by `qty × packSize` · NetSuite and pick/pack always receive the EACH count.**

`2 × 7 PACK` of a $4 ring quotes as $56, shows as "2 × 7 PACK (14 ea)" on the customer's document, and transmits 14. Vocabulary is a master list (`system/master_lists.quickShipUom`, edited in Mass Update 4.5); the count is parsed from the name (`7PACK`→7, `PAIR`→2, explicit `- N` override). Per-item default on `manufacturingSpecs.quickShipUom`; the **customer's CRM preference wins over it**.

Rush fees (`master_lists.rushFeeTypes`, amount parsed from `"RUSH 3 DAY - 75"`) are Quick Ship only and have **no portal exposure yet** — decide with Stuart whether customers may self-select a rush.

---

## 5. The alias rule — already app-wide, already free on the portal

Full statement: `CPQ_VISION_QUICKSHIP_BRIEF.md` §4b. Implementation: `src/components/Shared/aliasIdentity.js`.

> Customer-facing forms **always** show the alias, never the item it refers back to. Internal/ERP/shop-floor surfaces show the real item with the alias in minor form.

**The portal already complies for free** — `portalEngine` resolves parts from flow `styleOptions`, and those options point at the alias doc; nothing dereferences `aliasOf`. **Don't add a dereference.** If you build a stock counter that resolves parts by code instead of through flow options, you must apply `customerFaceOf()` yourself or customers will see the wrong code.

**In flight (2026-07-25):** Stuart is restructuring the stocked Simple Elegance items as **real finished assemblies** (`H2-1BE/CG`) with the mill root (`H1-1BE`) in the BOM, instead of aliasing the mill root. In that shape no alias is involved for this collection at all — the bare code `H2-1BE` matches the flow's bracket step and parses to the 1" cell directly. **Check the state of that data before building anything that depends on the alias path.**

---

## 6. Client Vision in the portal — SCOPE IS SETTLED (Stuart, 2026-07-25)

`ClientVisionTab.js` → `VisionHardware.js` / `VisionPillow.js` / `VisionLighting.js`. Internally this is a field/takeoff **and** engineering board. The portal gets **the measurement-intake half only**, landing as a `cpq_drafts` doc for staff to price — the same doc the internal Vision writes, so it appears in CPQ's "Lines Awaiting Configuration" with no new plumbing.

### Why this exists (build to this, not to a feature list)

> *"Every day customers are confused over the outside edge measurements and we can't afford to not have these orders fit."*

The purpose is **fit**, not self-service engineering. The customer supplies wall measurements and end treatments; the portal shows them, in their own units, the **outside-edge numbers their opening has to accommodate**. If a customer can leave without understanding how wide the finished system actually is, the page has failed regardless of how nice it looks.

### IN — what the customer sees and does

**Inputs**
- Wall / opening measurements, per bay leg.
- **Bay shape: straight, MITERED (angled bay), and BOW (curved)** — `engData.shape` is `'STRAIGHT' | 'MITERED' | 'BOW'`, seeded from `activeFlow.fabShape`. All three are in scope.
- **French returns** — the customer picks them and sees them. End treatments are `FRENCH_RETURN` / `RETURN_MITER` / `INSIDE_MOUNT` (`endStyleL` / `endStyleR`); a return end changes the O2O math, which is precisely why they must be able to select it here.
- Mount type per end (wall / ceiling / inside), projection.

**The three readouts — these are the point of the page** (`VisionHardware.js:1785-1792`):

| Label | Field | Notes |
|---|---|---|
| **Pole O2O (Edge-to-Edge)** | `poleO2O` | `orderL + orderC + orderR` |
| **Total System O2O (+ Brackets)** | `totalSystemO2O` | `poleO2O + endAddL + endAddR` — **this is the number that has to fit the opening** |
| **Main Wall C2C** | `pole2` | label is shape-dependent: `STRAIGHT` → "Main Wall C2C", otherwise "Center Wall C2C", with Left/Right Wall C2C (`pole1`/`pole3`) shown as well on `MITERED` |

Show the `totalSystemO2O` breakdown line too (`= pole + L + R`) — it's what makes the number believable to a sceptical customer. Plus clearance inputs already in the model: `returnRadius` (default 4.0), `gripAllowance` (8.5), `bracketThickness` (0.25), `insideMountDeduct` (0.25).

### OUT — never render to a customer

Raw cut lengths (`rawLeft` / `rawCenter` / `rawRight`), miter **saw angles** (`sawAngle1` / `sawAngle2`), wall angles, bend deducts, hanger locations (`hangerLocations`), the captured **shop drawing SVG** (`svgString`), and per-part BOM quantities. These exist to drive the floor.

**Compute and STORE them anyway.** The draft must carry the same `engineeringNotes` / `spatialData` shape the internal Vision writes, or staff lose the downstream cut sheet and the whole point of the draft handoff. The rule is **don't display**, not **don't derive**.

### The mirror risk — ✅ EXTRACTION DONE (2026-07-25)

The O2O/C2C math now lives in **`src/components/Shared/bayMath.js`** (`computeBayMath({ engData, safeProj, libraryParts })` + `safeProjOf`), with `VisionHardware.js` importing it, and a **verbatim copy already at `portal/src/shared/bayMath.js`** (same convention as `sizeMatrix.js` / `priceLevels.js` — edit the app copy, `cp`, diff, same commit). Equivalence to the old inline block was **proven by harness**: 6,912 input cases (3 shapes × both input modes × end styles × mounts × return-bracket/backplate-orientation fixtures), 269k field comparisons, zero mismatches. The return object is tiered: FIT/customer-facing fields vs SHOP-ONLY fields (store on the draft, never render) — the portal page should consume it accordingly. Only remaining math to port is page-level display formatting.

### Still blocking

Vision learned the H2 per-assembly model in commit `0fcc583` (grouped flow picker, `PROJ_SELECT` beside the SIZE steps, `flowProjSel`/`projTagOk` gating). **All of it is gated on stamps only 🎯 single-assembly flows carry**, so Fabricut/legacy behavior is identical — keep it that way. **H2 remains HELD from the portal** until `partAllowedAtSize` / `PROJ_SELECT` / the size landing are mirrored client-side; that block applies to anything built here.

Pillow and Lighting are **not** in scope for this pass.

---

## 7. Standing portal gaps to carry in

- Wall-mount auto-lines (`11ebeed`) are not in `portalEngine` → portal quotes omit those BOM lines.
- Phase B two-part finials will need a full mirror (new mechanism).
- `custVisible` (customer-restricted options dropped server-side) needs the Cloud Shell deploy to actually gate.
- Portal has no deploy-refresh banner — the `version.json` stamp is CRA-only.
- `Shared/clientPricing.js` (the unified per-customer price matcher, commit `803b063`) needs **no** mirror — the portal prices off `portalPriceLevel`, and `clientPricing` appears nowhere in `functions/` or `portal/`. Don't "helpfully" port it.

---

## 8. Deploy reality

**Vercel does NOT deploy Cloud Functions.** Every BFF change needs Google Cloud Shell:

```bash
cd ~/ce-m2c-design-app && git pull origin main
```

```bash
firebase deploy --only functions --project ce-m2c-design-collab
```

Decline any prompt to DELETE a function. Use `firebase login --no-localhost` if it asks for auth. Vercel builds both projects on push to `main` (CRA ~2.5 min, portal Vite ~10s).

**You cannot verify in a browser preview** — HQ is PIN-gated and Firestore enforces App Check, so no local script or dev server can read production data. Verification = lint (`npx --no-install eslint <path>`, 0 errors) + `CI=false npx --no-install react-scripts build` + Stuart testing on production. When a filter hides something, build a probe rather than guessing — that is how the alias bug was finally found.

**Multi-session git safety:** never `git checkout` in the shared checkout, never `git add -A`, always `git pull --rebase --autostash origin main` before push.

---

## 9. Decisions — SETTLED with Stuart 2026-07-25 (build to these)

0. **Sequence** — **Vision measurement intake FIRST**, stock counter second.
1. ~~Stock counter scope~~ — **Browse + quote request.** The customer builds a stock cart and submits a request; staff open it in Quick Ship (tab 7), review, and push the real NetSuite SO. No customer action ever writes a Sales Order directly.
2. ~~Vision scope~~ — **SETTLED, see §6:** measurement intake + French returns + curved/mitered bays + the three O2O/C2C readouts, landing as a `cpq_drafts` doc. No cuts, no saw angles, no shop drawing. (Extraction done — `Shared/bayMath.js`, portal copy in place.)
3. ~~Packs~~ — **Set on the CRM record, not chosen by the customer.** The Portal Access section already carries `portalPriceLevel` + `qsRingPack`/`qsFinialPack`/`qsInsideMountPack`; the portal SHOWS the customer their preferred pack and prices/labels with it. No pack picker.
4. ~~Rush fees~~ — **Internal only.** No portal exposure; staff add rush in Quick Ship when reviewing the request.
5. ~~Kits~~ — **The portal gets the Kit Builder experience "just like in the app"** (category × diameter × finish assembly of stocked items), following the pack unit rules when applicable (qty = PACKS, rate per EACH, request carries the each count). Pricing per the customer's `portalPriceLevel` / kit clientPricing, same as the app.
6. **Units** — STILL OPEN (the one remaining question): the internal board works in decimal inches (`12.75"`). Customers measure in feet-and-fractions. Proposed default: accept both fractional and decimal input, display both, **store decimal always** (it must, or the shop math breaks). Confirm display format with Stuart at build time.
