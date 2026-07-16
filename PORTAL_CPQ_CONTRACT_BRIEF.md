# BRIEF — CPQ ↔ Customer Portal Contract (read before touching CPQTab / cpq_flows / pricing)

> Paste this into the CPQ/flow session. It documents every link the customer portal
> (portal.classicalelements.com) has into the CPQ so your changes flow through cleanly — and flags
> the few places where a CPQ change MUST be mirrored on the portal or it will silently diverge.

## TL;DR — the one thing to remember

The portal does **not** import CPQTab. It reads the **same Firestore data** through new Cloud
Functions (a BFF), and it runs a **hand-ported copy** of the CPQ pricing/size/finish logic on the
server. So:

- **DATA changes flow through automatically** — new flows, new options, new finishes, edited
  `clientPricing`, new items, price edits, new assemblies/GLBs. Nothing to do on the portal.
- **LOGIC or SCHEMA changes must be mirrored** in two files (below). If you add a new step *type*, a
  new pricing rule, a new geometry-map mechanism, change `sizeMatrix.js` / `priceLevels.js`, or add
  a new option flag the renderer needs — the portal will not see it until the port is updated.

**The two files that must stay in sync with the CPQ:**
1. `functions/portalEngine.js` — a CommonJS port of the **CPQTab pricing memo** + `Shared/sizeMatrix.js`
   + `Shared/priceLevels.js`. This computes portal pricing + option descriptions server-side.
2. `functions/index.js → sanitizeStep()` — the whitelist of **flow-step fields** the portal
   renderer receives. A render-affecting field you add to a flow step is invisible to the portal
   until it's added here.

Everything else is data and rides for free.

## Architecture (how the portal consumes the CPQ)

```
Customer (portal.classicalelements.com, separate Vite app in /portal)
   │  Firebase email auth, custom claim { customer:true, customerId:'CUST-…' }
   │  NEVER reads Firestore directly (rules deny any token with the 'customer' claim)
   ▼
Portal BFF Cloud Functions (functions/index.js) — Admin SDK, sanitize server-side
   • portalCatalog     → the customer's showroom (their assigned flows → assemblies)
   • portalFlow(flowId)→ ONE flow, sanitized for the renderer (+ assembly GLB + finishes)
   • portalResolve(flowId, selections) → live pricing + resolved option descriptions (the ENGINE)
   • portalQuoteRequest→ writes a jobs doc {status:'PORTAL_REQUEST', source:'PORTAL', quoteNo}
   • reserveQuoteNo    → the shared short quote-number counter (also used by CPQTab)
   ▼
Same Firestore the CPQ uses: cpq_flows, Approved_Designs, assembly_pins,
system/master_finishes, hq_outsource_finishes, crm_records
```

Portal frontend files that MIRROR CPQ code (keep aligned if the CPQ equivalents change):
- `portal/src/cpqRender.jsx` — port of `CPQTab DynamicModel` + `Shared/studioScene.js` (StudioRig + PBR).
- `portal/src/Configurator.jsx` — ports the `textureOverrides` / `visibilityOverrides` / `cloneSpecs`
  builders, the step UI, and the return/bracket rule helpers.
- `portal/src/shared/sizeMatrix.js`, `portal/src/shared/priceLevels.js` — **verbatim copies** of the
  `Shared/` originals.

## The entitlement model (what a customer can see)

Set per customer on the CRM card (**External Co-Op → customer → Portal Access**):
- `crm_records.portalFlowIds: [flowId, …]` — **the flows this customer may open in the portal.** This
  is the master gate. A flow not in this list is invisible to that customer. Assign a flow here and it
  appears in their showroom automatically.
- `crm_records.portalPriceLevel: 'STANDARD' | 'FAB_WHOLESALE' | 'FAB_RETAIL'` — the price level the
  customer sees. **`FAB_COST` is intentionally impossible** (forced back to STANDARD server-side).

Portal user logins live in `portal_users` (managed by the same panel). Not your concern for CPQ work.

## Contract #1 — the FLOW (`cpq_flows`) → portal renderer

`portalFlow()` runs `sanitizeStep()` over `flow.steps[]` and sends the result to the portal. **These
step fields are read by the portal renderer — keep their meaning identical to CPQTab:**

- Step: `id, title, type, stepRole, position, sizeAxis, sizeFamily, targetNodes, finishTargetNodes,
  finishDataSource, finishAllowedOptions, dataSource, allowedOptions, geometryMap, subGeometryMap,
  mountSelector, mountPosition, hideQty, isCenterClone`
- `styleOptions[]`: `optId, partId, partName, label, targetNode, finalImageUrl, sizeValue, sizeScale,
  location, position, finishAllowedOptions, hidesBracket, isReturn, endTreatment, isReturnArm,
  usesReturnPlates, isBasic`
- `subOptions[]` (backplates): `optId, partId, partName, label, targetNode, location, position,
  returnOnly, inlineOnly`

Behaviours the portal replicates from these (already matched to CPQTab):
- **Finish scoping:** dedicated finish step → `step.allowedOptions` (finish ids); compound step →
  selected option's `finishAllowedOptions` else `step.finishAllowedOptions`. Empty = all.
- **Geometry/visibility:** `targetNodes`, `geometryMap[optId]`, `subGeometryMap[subId]`,
  `finishTargetNodes`, `mountSelector`/`mountPosition`, flow `hiddenClusters`/`hiddenNodes`.
- **Return rules:** `endTreatment` (`FRENCH_RETURN`/`MITER_RETURN`/`INSIDE_MOUNT`) + `subOptions.returnOnly`
  drive the return→bracket lock and the return-plate pool; `hidesBracket`, `isReturnArm`,
  `usesReturnPlates`, `isBasic` behave as in CPQ. Return-plate pool is also derived server-side from
  RBP/RCP codes, so it works even if a flag is missing.
- **Size:** `type:'SIZE_SELECT'` steps + `sizeAxis`/`sizeFamily` scale the model and re-resolve part
  identity/price via `sizeMatrix`.
- **Quantity:** shown on every non-SIZE step unless `hideQty`. (Portal seeds Splice/Cut-Splice steps
  to qty 0 by title match `/splice/i` — if you rename those steps, tell me.)

**⚠️ If you add a NEW render-affecting step field or a NEW `step.type`,** it must be added to
`sanitizeStep()` in `functions/index.js` AND handled in `portal/src/Configurator.jsx`. Ping me.

**Fields NOT in sanitizeStep but still used:** pricing fields (`basePrice, priceMap, priceOverride,
useClientPricing, linkedItemId, calculatorTemplate`) are read by the **pricing engine** from the raw
flow doc (see Contract #3), not the renderer — so they don't need to be in sanitizeStep.

Also read at the flow level: `flow.name`, `flow.linkedAssemblyId` (the assembly whose GLB renders and
whose BOM/`clientPricing` prices the base), `flow.basePrice`, `flow.brandId`, `flow.hiddenClusters`,
`flow.hiddenNodes`.

## Contract #2 — ASSEMBLY & PARTS (`Approved_Designs`) → portal render + price

The portal reads the same item fields the CPQ does. Keep these populated the same way:
- `manufacturingSpecs.cadUrl` — the GLB the portal renders (must be a `getDownloadURL` token URL).
- `manufacturingSpecs.basePrice` — base price fallback.
- `manufacturingSpecs.fabricut` — the Fabricut sheet pricing (retail/wholesale/cost + painted/plated
  tiers); read by `fabricutPriceOf` at the Fabricut levels.
- `manufacturingSpecs.customData.sizeKey` `{family, dia, style, projLetter}` — size resolution.
- `manufacturingSpecs.customData.speciesMap` `{ '-O':…, '-W':… }` — species resolution.
- `clientPricing[]` `{ customerId, clientSku, price, clientSalesPrice }` — the customer's own price
  (STANDARD level) + their SKU. Matched by `customerId` == the CRM id OR the customer name.
- `routingType==='MAIN'` OR `recordType==='PRODUCT'` — marks a customer-facing product (showroom).
- `nodeClusters[]` `{id, location, position, category, nodes|meshes}` — mount/visibility.
- `itemName`, `legacyErpId`, `itemId` — descriptions + item #s.

Any of these you edit in Master Library / BOM flows through to the portal with **no code change** —
it's the same read.

## Contract #3 — PRICING (the engine port) — the highest-risk sync point

`portalResolve()` loads the flow + the brand's `Approved_Designs` + the assembly's `assembly_pins`
BOM + finishes + the customer, and runs **`functions/portalEngine.js`**, which is a line-for-line port
of:
- the **CPQTab pricing memo** (`computePricing`), and
- `Shared/sizeMatrix.js` + `Shared/priceLevels.js`.

Precedence it reproduces (highest wins): `step.priceOverride` > Fabricut level (`fabricutPriceOf`) >
`clientPricing` (`useClientPricing`) > `option.price` > item `basePrice` > `step.basePrice`. Identity
chain: **base → size (`sizeVariantOf`) → species (`speciesVariantOf`) → finish variant (`/P`, `/EPn`)**.

**If you change ANY of these, mirror it in `functions/portalEngine.js` (and redeploy) or portal prices
diverge from the CPQ:**
- the CPQTab pricing memo logic (new price source, new rule, new line type),
- `Shared/sizeMatrix.js` (families, variant resolution, return rules) — also copied to
  `portal/src/shared/sizeMatrix.js`,
- `Shared/priceLevels.js` (`fabricutPriceOf`, `fabricutCodeOf`, the level list) — also copied to
  `portal/src/shared/priceLevels.js`.

The header comment in `portalEngine.js` says "keep in sync with these three source files." That's the
contract. When in doubt, tell me what you changed and I'll re-port it.

Per-option descriptions/prices in the choices come from the same engine (`resolveStepOptions`, a port
of CPQTab `optionDisplayFor` + `renderOptionPrice`). Finish names use `master_finishes.clientMapping`
(`{customerId: companyName, clientFinishName}`) — fill those in Library 4.5 to give a customer their
own finish names.

## Contract #4 — QUOTES back into the CPQ

- Portal submissions write a `jobs` doc: `{ status:'PORTAL_REQUEST', source:'PORTAL',
  customer:{id,name}, quoteNo, portalRequest:{ flowId, flowName, selections:{params,quantities},
  note, byEmail } }`. **These land in the same `jobs` collection your CPQ reads.** A "portal request
  inbox" surface in HQ is not built yet — if you build one, filter `where('source','==','PORTAL')`.
- **Quote numbers are shared.** Format `<initials><MMDDYY>-<NN>` (e.g. `SG071626-01`), minted by
  `reserveQuoteNo` off one atomic counter (`quote_counters/{prefix}`). CPQTab already calls it on
  finalize and stores `job.quoteNo` (the `QUOTE-<ts>` doc id is unchanged). If you add new
  quote-creation paths, call `reserveQuoteNo({name})` and store `quoteNo` so numbering stays uniform.

## Hard guardrails (do not break these)

The portal must NEVER expose: `manufacturingSpecs.cost`, `fabricut.cost` / the `FAB_COST` level, other
customers' `clientPricing` or identities, vendor names/POs, margins, internal notes, NetSuite ids, or
raw spec GLBs. All portal responses are shaped server-side to strip these — if you add a new field to
items/flows that's sensitive, assume the portal BFF must be updated to keep excluding it.

## Deploy reminder

Portal **frontend** and **CPQTab** auto-deploy on push to `main` (Vercel). The **BFF functions do NOT**
— any change to `functions/index.js` or `functions/portalEngine.js` needs a Cloud Shell deploy:
`git fetch origin && git reset --hard origin/main` then
`firebase deploy --only functions:<names> --project ce-m2c-design-collab`.

## Quick "is my flow portal-ready?" checklist

1. Flow has `linkedAssemblyId` → an assembly with `manufacturingSpecs.cadUrl` (a GLB).
2. The assembly (and its option parts) carry `manufacturingSpecs.fabricut` and/or `clientPricing` for
   the customer, so pricing resolves at their level.
3. Finish steps have `allowedOptions` / options have `finishAllowedOptions` if you want a subset
   (empty = all finishes).
4. The customer's `crm_records.portalFlowIds` includes the flow, and `portalPriceLevel` is set.
5. If you introduced anything the portal renderer/engine doesn't already know about (new step type,
   new rule, sizeMatrix/priceLevels edit) → coordinate the two-file mirror above.
