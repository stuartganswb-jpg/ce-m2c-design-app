// ============================================================================
// ONE TRANSMITTER — quotes and sales orders ⇄ NetSuite (Stuart 2026-08-25)
// ============================================================================
// "once an order is created in either cpq or order entry, we have buttons to save as either quote
//  or sales order, then it is sent to CRM and to RTG automatically, RTG handles the netsuite sync,
//  both to netsuite and then pushing the netsuite quote or sales order # back to crm."
//
// This module is that machine, extracted from ERPPushPullTab so every surface — the CPQ save
// buttons, the CRM Approve, tab 12's manual push, and RTG's master review — resolves lines and
// builds the NetSuite transaction the SAME way (H1 principle: one rule, one module).
//
// The push itself rides ns_outbox (staged, serial, retried, idempotency-markered) — this was the
// ONE NetSuite write in the app that still posted live from the browser with no retry and no
// record. The worker's writeBack (array-capable) stamps the returned NetSuite internal id and
// tran number back onto the jobs doc (CRM display) and the hq_sales_orders board doc (RTG/WMS).
//
// `data` is the caller's live library state — the same four subscriptions CPQ and tab 12 already
// hold: { libraryParts, cpqFlows, outsourceFinishes, globalFinishes }.
import { customerKeys, clientPriceFor } from './clientPricing';
import { SIZE_STEP_TYPE, makeSizeSwap, speciesVariantOf } from './sizeMatrix';
import { aliasTargetIdOf } from './aliasIdentity';
import { nsProxyFetch } from './nsProxy';
import { enqueueNsWrite } from './nsOutbox';
import { BRAND_NETSUITE_MAP } from './brandNetsuite';

// A finish's code is the assembly suffix (base + CODE -> base/CODE). Some finish docs carry the
// identifier in `name` with `code` blank, so fall back to name.
export const finishCodeOf = (f) => String((f && (f.code || f.name)) || '').toUpperCase();

// Resolve a job's CPQ selections into physical-inventory lines, while tracking what could NOT be
// resolved so the caller can report a specific reason. Extracted VERBATIM from ERPPushPullTab
// (2026-08-25) — only the four data inputs became parameters.
export function resolveJobLines(job, data) {
  const { libraryParts, cpqFlows, outsourceFinishes, globalFinishes } = data;
      const result = { lines: [], stepsConsidered: 0, unresolved: [], hasConfig: false };
      if (!job || !job.cpqData) return result;

      // Resolve a CPQ selection to its real library part. STYLE_SWAP selections are per-instance
      // optIds whose styleOption carries a PROJECTED partId/partName (e.g. "FICERA1001 CEILING BRACKET
      // LEFT") that is NOT the doc id, and legacy parts have itemId != doc id — so without this, every
      // STYLE_SWAP bracket/finial/backplate silently dropped from the pushed BOM. Match exact, then by
      // longest part-code prefix (brackets: FICERA1001…→FICERA) or full item-name (poles/rings).
      const normCode = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const matchPart = (key) => {
          if (key == null || key === '') return null;
          const exact = libraryParts.find(p => p.id === key || p.itemId === key || p.itemName === key || p.legacyErpId === key);
          if (exact) return exact;
          const nk = normCode(key);
          if (nk.length < 3) return null;
          let best = null, bestLen = 0;
          libraryParts.forEach(p => {
              [p.legacyErpId, p.itemId].forEach(code => { const nc = normCode(code); if (nc.length >= 3 && nk.startsWith(nc) && nc.length > bestLen) { best = p; bestLen = nc.length; } });
              const nn = normCode(p.itemName); if (nn.length >= 3 && nk === nn && nn.length > bestLen) { best = p; bestLen = nn.length; }
          });
          return best;
      };
      // Find the styleOption (main step or backplate __sub) behind a selection id, to read its part link.
      // ── WHICH ITEM A FINISHED LINE CONSUMES ──────────────────────────────────────────────
      // Lifted out of the step walk unchanged (Stuart 2026-08-21) because the TAGS engine has to
      // answer the same question and this rule is far too load-bearing to exist twice: an
      // OUTSOURCED finish always consumes finished stock, an in-house finish consumes it only where
      // the finished assembly is flagged Stocked, and paint is structural — every P-code shares the
      // one phosphated "/P" item, which is then painted here. Anything else stays on the BASE item
      // and the floor makes and finishes it.
      const routeFinishedItem = (masterPart, finishObj, isOutsourced) => {
          const out = {
              nsId: masterPart.netSuiteInternalId || masterPart.legacyErpId || masterPart.itemId || 'UNMAPPED',
              finishedErpId: '', finishUnmapped: '',
          };
          const finishCode = finishObj ? finishCodeOf(finishObj) : '';
          if (!finishCode) return out;
          const baseErp = String(masterPart.legacyErpId || masterPart.itemId || '').toUpperCase();
          // Exact "/<CODE>" first (EP finishes are stocked as exact SKUs, e.g. /EP5); paints
          // (P01, P02, …) share ONE "/P" item, so fall back to it when no exact SKU exists.
          const candidates = [`${baseErp}/${finishCode}`];
          if (/^P\d/.test(finishCode)) candidates.push(`${baseErp}/P`);
          let candidateErpId = candidates[0];
          let finishedPart = null;
          for (const cand of candidates) {
              const hit = libraryParts.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === cand);
              if (hit) { candidateErpId = cand; finishedPart = hit; break; }
          }
          const isStocked = !!finishedPart?.manufacturingSpecs?.isStocked;
          const isPaintRollup = !!finishedPart && candidateErpId.endsWith('/P');
          if (isOutsourced || isStocked || isPaintRollup) {
              out.finishedErpId = candidateErpId;
              if (finishedPart && finishedPart.netSuiteInternalId) out.nsId = finishedPart.netSuiteInternalId;
              else out.finishUnmapped = candidateErpId;   // finished SKU has no NS id → base + warn
          }
          return out;
      };

      const findOpt = (flowSteps, stepId, selId) => {
          const base = stepId.endsWith('__sub') ? stepId.slice(0, -5) : stepId;
          const st = flowSteps.find(s => s.id === base);
          if (!st) return null;
          const pool = stepId.endsWith('__sub') ? (st.subOptions || []) : (st.styleOptions || []);
          return pool.find(o => (o.optId || o.partId) === selId) || null;
      };

      // Each configured assembly in the cart pushes its OWN components × its OWN qty. Older quotes (saved
      // before per-item cartItems existed) fall back to the single merged configuration/quantities blob at
      // qty 1. Iterating cartItems fixes two push bugs: (a) multiple assemblies on the same flow collapsed
      // into one because the merged maps are keyed by stepId (last write wins), and (b) per-assembly
      // component quantities were never multiplied by the number of assemblies ordered.
      const carts = (Array.isArray(job.cpqData.cartItems) && job.cpqData.cartItems.length)
          ? job.cpqData.cartItems.map(ci => ({
              config: ci.dynamicConfigParams || {},
              quantities: ci.stepQuantities || {},
              dimensions: ci.dimensionInputs || {},
              flowId: ci.flowId || job.flowId,
              assemblyQty: parseInt(ci.qty) || 1,
              // Line-level sidemark ("Formal Living 1") — rides every line this cart item
              // produces and lands in NetSuite's line Tag (custcol3; Eric 2026-08-11).
              sidemark: String(ci.sidemark || '').trim(),
              // Traverse components chosen in the checkout configurator — carriers, end stops,
              // splices, accessories. Not flow steps, so the step walk never sees them.
              trvComponents: Array.isArray(ci.trvComponents) ? ci.trvComponents : [],
              // ── WHICH ENGINE BUILT THIS LINE (Stuart 2026-08-21) ──────────────────────────
              // The tag-driven engine does not answer flow steps: it resolves the parts itself and
              // hands over a finished BOM. So a TAGS item's `config`/`quantities` are empty by
              // design, and walking steps against them produced nothing at all — the push failed
              // with "this quote has no CPQ configuration data attached", which is true of the map
              // it was looking for and false of the quote.
              engine: String(ci.engine || '').toUpperCase(),
              breakdown: Array.isArray(ci.pricingBreakdown) ? ci.pricingBreakdown : []
            }))
          : [{
              config: job.cpqData.configuration || {},
              quantities: job.cpqData.quantities || {},
              dimensions: job.cpqData.dimensions || {},
              flowId: job.flowId,
              assemblyQty: 1
            }];
      // A TAGS cart's configuration IS its breakdown — there is no step map to find, and its
      // absence is not the stale-quote symptom that message describes.
      result.hasConfig = carts.some(c => Object.keys(c.config).length > 0 || Object.keys(c.quantities).length > 0
          || (c.engine === 'TAGS' && c.breakdown.length > 0));

      const rawLines = []; // per-assembly lines, aggregated by NetSuite item at the end

      carts.forEach(cart => {
          // ── THE TAG ENGINE HANDS OVER A FINISHED BOM ─────────────────────────────────────────
          // Everything the step walk below works out — which part a selection means, which size it
          // resolves to, what it is finished in — the engine has already worked out, and its answer
          // is on the line: `partId` is the library doc, `finishCode` is what THAT part wears (a
          // configuration may carry several), `qty` is the count. So this reads the answer instead
          // of re-deriving it from questions that were never asked.
          //
          // What it does NOT do differently: which ITEM a finished line consumes is the same rule,
          // through the same routeFinishedItem — because the floor's copy of that decision is what
          // makes a phosphate line a phosphate line, and two engines must never disagree about it.
          if (cart.engine === 'TAGS') {
              cart.breakdown.forEach(l => {
                  if (!l) return;
                  // A fee prices the quote and rides the rollup; it is not a NetSuite component.
                  // ⚠ AND NEITHER IS A KIT (Stuart 2026-08-22). A traverse kit has no NetSuite
                  // identity by design — Quick Ship has always pushed "exploded components plus a
                  // generic traverse $-holder, never the kit itself". Its dollars ride the rollup
                  // the same way a fee's do, and the component lines beneath it are what push.
                  // Without this the estimate would carry a line item NetSuite has no item for.
                  if (l.isFee || l.isKit) return;
                  // The traverse components have their own loop below — they are on the breakdown
                  // for the documents, and pushing them from both places would double the order.
                  if (l.trvComponent) return;
                  let qty = Number(l.qty) > 0 ? Number(l.qty) : 1;
                  // ── ROD STOCK CONSUMES BY THE FOOT (Stuart 2026-08-25, first Brimar orders) ──
                  // The engine prices per-foot lines with qty pinned at 1 (one pole on the router)
                  // and the feet multiplying the money — but NetSuite's per-foot items bill and
                  // relieve stock in FEET, exactly as the old engine's pole steps pushed (their
                  // step qty WAS the footage). Pushing qty 1 sent the pole at one foot's rate and
                  // left the balance riding the rollup as labor. So the NetSuite quantity is
                  // qty × feet; the cut length still travels for the bench.
                  // (No addLog here — this resolver also runs during render; the push loop logs.)
                  let feetNote = 0;
                  if (l.perFoot && Number(l.feet) > 0) {
                      qty = qty * Number(l.feet);
                  } else if (!l.perFoot && Number(l.cutLength) > 12 && Number(l.price) > 0 && Number(l.total) > 0) {
                      // LEGACY LINE (saved before perFoot/feet were stamped): reconstruct the
                      // footage only when the line's own arithmetic states it — total is a clean
                      // integer multiple (≥2) of unit × qty AND that integer agrees with the cut
                      // length (billed feet round the cut up to whole feet). Anything else pushes
                      // exactly as stored.
                      const ratio = Number(l.total) / (Number(l.price) * qty);
                      const feet = Math.round(ratio);
                      if (feet >= 2 && Math.abs(ratio - feet) < 0.01 && Math.abs(feet - Math.ceil(Number(l.cutLength) / 12)) <= 1) {
                          qty = qty * feet;
                          feetNote = feet;
                      }
                  }
                  let masterPart = matchPart(l.partId) || matchPart(l.legacyErpId);
                  if (!masterPart) { result.unresolved.push({ stepTitle: `${l.name || 'Configured line'}`, partId: l.partId || l.legacyErpId }); return; }
                  result.stepsConsidered++;
                  if (masterPart.partClass === 'Fee' || String(masterPart.manufacturingSpecs?.productType || '').toUpperCase() === 'FEE') return;
                  if (masterPart.partClass === 'Kit') return;
                  // An ALIAS is sold under its own name and consumed as the real item — the same
                  // rule the step walk applies, for the same reason (Shared/aliasIdentity).
                  let aliasFace = null;
                  const aliasId = aliasTargetIdOf(masterPart);
                  if (aliasId) { const real = matchPart(aliasId); if (real) { aliasFace = masterPart; masterPart = real; } }
                  // THE FINISH IS PER LINE HERE, not per step: this engine lets one part be finished
                  // differently from the rest of the configuration, so the line's own code decides.
                  const code = String(l.finishCode || '').toUpperCase();
                  const outFin = code ? outsourceFinishes.find(f => finishCodeOf(f) === code) : null;
                  const finObj = code ? (outFin || globalFinishes.find(f => finishCodeOf(f) === code) || { code }) : null;
                  // A species finish consumes the per-species item (…WBF → …WBF-O/-W) before routing.
                  if (finObj?.bomSuffix) {
                      const sp = speciesVariantOf(masterPart, finObj, (c) => libraryParts.find(p => String(p.legacyErpId || p.itemId || '').trim().toUpperCase() === c) || null);
                      if (sp) masterPart = sp;
                  }
                  const { nsId, finishedErpId, finishUnmapped } = routeFinishedItem(masterPart, finObj, !!outFin);
                  rawLines.push({
                      stepId: `tags:${l.legacyErpId || l.partId}:${code}`,
                      masterPart,
                      aliasFace,
                      qty: qty * cart.assemblyQty,
                      ...(feetNote ? { feetReconstructed: feetNote } : {}),
                      nsId,
                      finishedErpId,
                      finishUnmapped,
                      // The ITEM's handling is the routing signal, exactly as it is on the floors;
                      // the line already carries it, resolved from the same place.
                      partCategory: l.partHandling || masterPart.manufacturingSpecs?.partHandling || '',
                      // What the bench cuts to, where this line is cut at all.
                      projection: l.cutLength ? String(l.cutLength) : '',
                      sidemark: cart.sidemark || ''
                  });
              });
              // …and then fall through to the traverse loop, which is shared.
          }
          const flow = cpqFlows.find(f => f.id === cart.flowId);
          const flowSteps = flow?.steps || [];
          const activeStepIds = new Set([...Object.keys(cart.config), ...Object.keys(cart.quantities)]);
          // SIZE-MATRIX: this cart's Rod Diameter / Projection selections re-resolve every part to
          // the right size BEFORE finish routing (H1-75BE → H1-1B6 → H1-1B6/EP2). Identity when the
          // flow has no SIZE steps.
          const sizeBundle = makeSizeSwap(flow, cart.config, libraryParts);

          // A TAGS cart has no step map to walk — its parts were pushed above.
          (cart.engine === 'TAGS' ? new Set() : activeStepIds).forEach(stepId => {
              if (stepId.endsWith('__finish')) return; // finishes are applied, not physical BOM components
              const step = flowSteps.find(s => s.id === stepId);
              if (step?.type === SIZE_STEP_TYPE || step?.type === 'PROJ_SELECT') return; // size/projection selectors are not physical components
              const userSelectionId = cart.config?.[stepId];

              // A step's quantity. Blank/undefined = a single-select step (qty 1). An explicit 0 means the
              // step was OFFERED but NOT taken (e.g. an unselected Splice / Cut fee) — it contributes
              // nothing: neither its part NOR its hidden includedParts. Firing includedParts for un-taken
              // steps is what dragged phantom joiner/ring hardware into the push.
              const qtyRaw = cart.quantities?.[stepId];
              let qty = (qtyRaw === undefined || qtyRaw === null || qtyRaw === '') ? 1 : (parseInt(qtyRaw) || 0);
              // Selection-only steps (hideQty) have no qty input; their stored 0 is a Vision-resume
              // artifact, not "offered but not taken" — taken = a selection exists. Heal to the
              // implicit 1 so the arm/backplate/material still hits the BOM.
              if (qty <= 0 && step?.hideQty && userSelectionId) qty = 1;
              if (qty <= 0) return;

              // Hidden BOM-only accessories (e.g. bushings) attached to this step in Node Grouping — auto-added
              // to the BOM when the step is taken. Never a customer choice; qty scales with assemblies ordered.
              (step?.includedParts || []).forEach(ip => {
                  const accPart = sizeBundle.swap(matchPart(ip.partId));
                  if (!accPart) { result.unresolved.push({ stepTitle: `${step?.title || stepId} · included`, partId: ip.partId }); return; }
                  rawLines.push({
                      stepId: `${stepId}__inc__${ip.partId}`, masterPart: accPart, qty: (parseInt(ip.qty) || 1) * cart.assemblyQty,
                      nsId: accPart.netSuiteInternalId || accPart.legacyErpId || accPart.itemId || 'UNMAPPED',
                      finishedErpId: '', finishUnmapped: '', partCategory: accPart.manufacturingSpecs?.partHandling || 'Accessory', projection: ''
                  });
              });

              const targetPartId = step?.linkedItemId || step?.linkedPinId || userSelectionId;
              if (!targetPartId) return;

              result.stepsConsidered++;
              // direct match first, then resolve through the selection's styleOption (projected name → code)
              let masterPart = matchPart(targetPartId);
              if (!masterPart) {
                  const opt = findOpt(flowSteps, stepId, userSelectionId);
                  masterPart = matchPart(opt?.partId) || matchPart(opt?.partName);
              }
              if (!masterPart) {
                  result.unresolved.push({ stepTitle: step?.title || stepId, partId: targetPartId });
                  return;
              }
              // ALIAS parts render as their own node but ARE the aliased real item in the BOM (e.g. two pole
              // lengths that are both the same steel pole) → resolve to the real part before building the line.
              // The alias identity is KEPT (aliasFace) because an estimate is a CUSTOMER document: the app-wide
              // rule is that customer-facing forms name the alias, never the item it refers back to
              // (Shared/aliasIdentity.js). Only the pushed item id, stock and BOM follow the real part.
              let aliasFace = null;
              const aliasId = aliasTargetIdOf(masterPart);
              if (aliasId) { const real = matchPart(aliasId); if (real) { aliasFace = masterPart; masterPart = real; } }
              // SIZE-MATRIX swap: the configured diameter/projection picks the actual item (return
              // plates collapse to standard plates at 1"/1-3/8" per the resolver's RBP→BP rule).
              const preSizeMaster = masterPart; // wall-mount pairing may live only on the base-size doc
              masterPart = sizeBundle.swap(masterPart);
              // Fee/Charge entities price the quote (their charge rides the rollup item's price) but are
              // NOT physical NetSuite BOM components — skip instead of pushing an UNMAPPED item line.
              if (masterPart.partClass === 'Fee' || String(masterPart.manufacturingSpecs?.productType || '').toUpperCase() === 'FEE') return;
              // KIT records are the SALES face of a set (Stuart 2026-08-08): the customer part# may
              // appear on the quote, but what ships to NetSuite is the exploded ORDER totals of the
              // kit's components — never the kit itself, which has no NetSuite item. The explosion
              // logic lands with the traverse configurator; until then a kit line is skipped exactly
              // like a fee rather than pushed as an UNMAPPED item.
              if (masterPart.partClass === 'Kit') return;
              // The demand lands on the finished assembly (base/CODE, e.g. H1-138BF/EP1 or H1-138BF/P) instead of the
              // bare base when the selected finish is either (a) OUTSOURCED — always consumes finished stock — or
              // (b) IN-HOUSE but the finished assembly is flagged "Stocked" in the library (held in stock, not
              // finished-to-order). Otherwise (in-house finish-to-order) the line stays on the base and the floor
              // makes + finishes it. Reading the Stocked flag off the FINISHED part means the same /P code is
              // finish-to-order for most parts and stocked only where it's been checked. Pricing stays on the base
              // part so the quote total is unchanged (rollup absorbs the balance); only the pushed ITEM id changes.
              // If the finished assembly isn't in the library / NetSuite-mapped, we keep the base and flag it.
              // The finish selection lives on the BASE step id — sub lines (backplates) share the bracket
              // step's finish, so strip the __sub suffix before looking it up. Pole steps carry the finish
              // as their MAIN selection, so that resolves as a finish too (species only — routing unchanged).
              const baseStepId = stepId.endsWith('__sub') ? stepId.slice(0, -5) : stepId;
              const finishId = cart.config?.[`${baseStepId}__finish`];
              const outFinish = finishId ? outsourceFinishes.find(f => f.id === finishId) : null;
              const finishObj = finishId ? (outFinish || globalFinishes.find(f => f.id === finishId)) : null; // outsourced or in-house
              const selAsFinish = userSelectionId ? (outsourceFinishes.find(f => f.id === userSelectionId) || globalFinishes.find(f => f.id === userSelectionId)) : null;
              // FINISH-DRIVEN SPECIES: a bomSuffix finish consumes the per-species physical item
              // (H1-138WBF → H1-138WBF-O/-W; wood pole via customData.speciesMap) — swap BEFORE the
              // NetSuite id + finished-SKU routing so the SO line lands on the real species item.
              const speciesFinish = finishObj?.bomSuffix ? finishObj : (selAsFinish?.bomSuffix ? selAsFinish : null);
              if (speciesFinish) {
                  const sp = speciesVariantOf(masterPart, speciesFinish, (c) => libraryParts.find(p => String(p.legacyErpId || p.itemId || '').trim().toUpperCase() === c) || null);
                  if (sp) masterPart = sp;
              }
              const { nsId, finishedErpId, finishUnmapped } = routeFinishedItem(masterPart, finishId ? finishObj : null, !!outFinish);
              // MULTI-MATERIAL POLE: the material step carries the pole ITEM; the Length/calculator
              // step carries the FOOTAGE (its per-foot qty) — push the pole line at the feet, and
              // take the cut length from the calculator step's dimensions.
              let lineQty = qty * cart.assemblyQty;
              let dimStepId = stepId;
              if (step?.type === 'STYLE_SWAP' && /pole.*material|rod material/i.test(step?.title || '')) {
                  const calcStep = flowSteps.find(s => s.calculatorTemplate);
                  const feet = calcStep ? parseInt(cart.quantities?.[calcStep.id]) : 0;
                  if (feet > 0) { lineQty = feet * cart.assemblyQty; dimStepId = calcStep.id; }
              }
              rawLines.push({
                  stepId,
                  masterPart,
                  aliasFace,       // the alias doc this line was SOLD as, when it was sold under one
                  qty: lineQty,
                  nsId,
                  finishedErpId,   // non-empty when this line pushes a finished assembly (outsourced or stocked in-house)
                  finishUnmapped,  // non-empty when a finished SKU couldn't be NS-resolved (fell back to base)
                  partCategory: masterPart.manufacturingSpecs?.partHandling || '',
                  projection: cart.dimensions?.[dimStepId]?.length || '',
                  sidemark: cart.sidemark || ''
              });
              // 🔩 Paired wall mount (backplates/cover plates): one per plate rides the push like a
              // BOM component — mirrors the cart line CPQTab adds. Aggregator below merges duplicates.
              const wmPair = masterPart.manufacturingSpecs?.wallMount || preSizeMaster.manufacturingSpecs?.wallMount;
              if (wmPair && wmPair.partId) {
                  const wmPart = matchPart(wmPair.partId);
                  if (wmPart) {
                      rawLines.push({
                          stepId: `${stepId}__wallmount`,
                          masterPart: wmPart,
                          qty: lineQty,
                          nsId: wmPart.netSuiteInternalId || wmPart.legacyErpId || wmPart.itemId || 'UNMAPPED',
                          finishedErpId: '',
                          finishUnmapped: '',
                          partCategory: wmPart.manufacturingSpecs?.partHandling || 'Small Parts',
                          projection: '',
                          sidemark: cart.sidemark || ''
                      });
                  } else {
                      result.unresolved.push({ stepTitle: `${step?.title || stepId} — wall mount`, partId: wmPair.partId });
                  }
              }
          });

          // TRAVERSE CONFIGURATOR COMPONENTS (Stuart 2026-08-13) — the checkout popup's lines:
          // real items consumed with the order (carriers, end stops, splices, accessories).
          // Included lines and billables both push as item lines; the estimate's scale-to-quoted
          // rule already reconciles rates to the quoted total, so no second pricing path.
          (cart.trvComponents || []).forEach(c => {
              const part = matchPart(c.code);
              if (!part) { result.unresolved.push({ stepTitle: `Traverse component — ${c.code}`, partId: c.code }); return; }
              rawLines.push({
                  stepId: `trvcfg:${part.id}`, masterPart: part,
                  qty: (parseInt(c.qty) || 1) * cart.assemblyQty,
                  nsId: part.netSuiteInternalId || part.legacyErpId || part.itemId || 'UNMAPPED',
                  finishedErpId: '', finishUnmapped: '',
                  partCategory: part.manufacturingSpecs?.partHandling || 'Small Parts', projection: '',
                  ...(cart.sidemark ? { sidemark: cart.sidemark } : {}),
              });
          });
      });

      // CHECKOUT ADD-ON ITEMS (Eric 2026-08-13: "the order came in without the Wand item on a
      // line — it rolled up the wand pricing into the top-line Fee roll up"). A real item picked
      // at checkout lives ONLY in cpqData.breakdown (it is not a flow step), so the step walk
      // above never sees it — and its dollars silently landed in the rollup. Append every
      // non-fee add-on breakdown line as a REAL line: its own NetSuite line, its own routing.
      ((job.cpqData && job.cpqData.breakdown) || [])
          .filter(l => l && l.isAddOn && l.isFee === false && (l.partId || l.legacyErpId))
          .forEach(l => {
              const part = matchPart(l.partId) || matchPart(l.legacyErpId);
              if (!part) { result.unresolved.push({ stepTitle: `Checkout add-on — ${l.name || l.legacyErpId || l.partId}`, partId: l.partId || l.legacyErpId }); return; }
              rawLines.push({
                  stepId: `addon:${part.id}`,
                  masterPart: part,
                  qty: Number(l.qty) || 1,
                  nsId: part.netSuiteInternalId || part.legacyErpId || part.itemId || 'UNMAPPED',
                  finishedErpId: '',
                  finishUnmapped: '',
                  partCategory: l.partHandling || part.manufacturingSpecs?.partHandling || '',
                  projection: '',
                  sidemark: ''
              });
          });

      // Aggregate identical resolved lines across assemblies (same NetSuite item + finished variant +
      // projection) into one summed-quantity line, so 3× + 2× of the same pole become a single line. Keep
      // UNMAPPED/PENDING lines distinct per part so their skip-warnings still name each one.
      const agg = new Map();
      rawLines.forEach(l => {
          const unmapped = (l.nsId === 'UNMAPPED' || l.nsId === 'PENDING');
          // Sidemark is part of line identity: two rooms ordering the same pole stay TWO lines,
          // each carrying its own Tag (custcol3) — merging them would blank the room attribution.
          const key = `${l.nsId}|${l.finishedErpId}|${l.projection}|${l.sidemark || ''}|${unmapped ? (l.masterPart?.id || l.stepId) : ''}`;
          const cur = agg.get(key);
          if (cur) cur.qty += l.qty;
          else agg.set(key, { ...l });
      });
      result.lines = Array.from(agg.values());
      return result;
}

// NetSuite refuses an estimate header shipping cost without a ship method (400). Resolve one ONCE
// per session: prefer a Ship Item named like shipping/freight/delivery, else the first active one.
let _shipMethodCache; // undefined = not looked up; null = none found
export async function resolveShipMethod() {
    if (_shipMethodCache !== undefined) return _shipMethodCache;
    const runQ = async (q) => {
        const r = await nsProxyFetch({ targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`, method: 'POST', payload: { q } });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof b === 'object' ? JSON.stringify(b) : String(b));
        return b.items || [];
    };
    let rows = [];
    try { rows = await runQ("SELECT id, itemid FROM item WHERE itemtype = 'ShipItem' AND NVL(isinactive,'F') = 'F' ORDER BY id"); } catch (e) { rows = []; }
    if (!rows.length) { try { rows = await runQ("SELECT id, itemid FROM shipitem ORDER BY id"); } catch (e) { rows = []; } }
    const pick = rows.find(x => /ship|freight|delivery|best way/i.test(String(x.itemid))) || rows[0] || null;
    _shipMethodCache = pick ? { id: String(pick.id), name: String(pick.itemid) } : null;
    return _shipMethodCache;
}

/**
 * Build the complete NetSuite transaction body for a job — estimate or salesorder, identical
 * arithmetic: customer-negotiated rates (same matcher CPQ priced with), discount scale-to-quoted-
 * total, the flow rollup line absorbing the balance, header shipping cost + ship method, CE custom
 * form. Returns { ok:false, error } with a specific code, or { ok:true, payload, meta }.
 * Never confirms and never alerts — interactive callers read `meta` and ask their own questions.
 */
export async function buildNsTransaction({ job, asType = 'estimate', brand, data, ctx, log = () => {} }) {
    const { lines: linesToPush, stepsConsidered, unresolved, hasConfig } = resolveJobLines(job, data);
    if (linesToPush.length === 0) {
        if (!hasConfig) return { ok: false, error: { code: 'NO_CONFIG', message: 'This quote has no CPQ configuration data attached — re-save it as a fresh quote.' } };
        if (stepsConsidered === 0) return { ok: false, error: { code: 'NO_LINKED_PARTS', message: "This flow's steps aren't linked to physical parts (no Linked Item / Auto-Sync BOM)." } };
        return { ok: false, error: { code: 'UNRESOLVED', message: `${stepsConsidered} configured step(s), but none resolve to a library part:\n${unresolved.map(u => `• ${u.stepTitle} → ${u.partId}`).join('\n')}` } };
    }
    const finishFallbacks = linesToPush.filter(l => l.finishUnmapped).map(l => l.finishUnmapped);

    const lineItems = [];
    let physicalItemsTotal = 0;
    const unmappedNames = [];
    // THE SAME MATCHER CPQ PRICED WITH — resolve the CRM record once so line rates match the quote.
    let custRec = null;
    if (job.customer?.id && ctx?.getDoc) {
        try { const cs = await ctx.getDoc(ctx.doc(ctx.db, 'crm_records', job.customer.id)); custRec = cs.exists() ? cs.data() : null; }
        catch (e) { /* offline/rules — fall back to the job's own fields */ }
    }
    const custKeys = customerKeys(job.customer?.id, custRec || { name: job.customer?.name || job.clientName });

    for (const line of linesToPush) {
        if (line.nsId !== 'UNMAPPED' && line.nsId !== 'PENDING') {
            if (line.feetReconstructed) log(`Per-foot line ${line.masterPart?.legacyErpId || line.masterPart?.itemId}: footage reconstructed — pushing qty ${line.qty} (ft).`, 'warn');
            let itemRate = parseFloat(line.masterPart.manufacturingSpecs?.basePrice || 0) || 0;
            const cpPrice = clientPriceFor(line.masterPart.clientPricing, custKeys);
            if (cpPrice != null) itemRate = cpPrice;
            physicalItemsTotal += itemRate * line.qty;
            const linePayload = {
                item: { id: line.nsId.toString() },
                quantity: line.qty,
                rate: parseFloat(itemRate.toFixed(2)),
                price: { id: "-1" },
                description: (() => {
                    const face = line.aliasFace ? `${line.aliasFace.legacyErpId || line.aliasFace.itemId || line.aliasFace.itemName} — ` : '';
                    return line.finishedErpId
                        ? `${face}${line.masterPart.itemName} → ${line.finishedErpId} (finished assembly, CPQ)`
                        : `${face}${line.masterPart.itemName} (Mapped from CPQ)`;
                })(),
                custcol_part_category: line.partCategory
            };
            if (line.projection) linePayload.custcol_bracket_projection = line.projection.toString();
            if (line.sidemark) linePayload.custcol3 = String(line.sidemark).slice(0, 300);
            lineItems.push(linePayload);
        } else {
            unmappedNames.push(line.masterPart.itemName || line.masterPart.id);
            log(`WARNING: Skipping "${line.masterPart.itemName}" — no NetSuite ID mapped.`, 'warn');
        }
    }
    if (lineItems.length === 0) {
        return { ok: false, error: { code: 'NO_NS_IDS', message: `${linesToPush.length} part(s) resolved but none have a NetSuite internal ID yet:\n${unmappedNames.map(n => `• ${n}`).join('\n')}\nSync them in 11.1 first.` } };
    }

    const cpqGrandTotal = parseFloat(job.cpqData.totalPrice || 0);
    let silentFeeBalance = Math.max(0, cpqGrandTotal - physicalItemsTotal);
    // Discounted quotes net BELOW the items' standard-rate sum — scale rates down so the
    // transaction lands exactly at the quoted total (rollup absorbs rounding, never negative).
    if (cpqGrandTotal - physicalItemsTotal < -0.005 && physicalItemsTotal > 0) {
        const factor = cpqGrandTotal / physicalItemsTotal;
        let scaledSum = 0;
        lineItems.forEach(li => { const r = Math.floor(li.rate * factor * 100) / 100; li.rate = r; scaledSum += r * li.quantity; });
        silentFeeBalance = Math.max(0, cpqGrandTotal - scaledSum);
        log(`Discounted quote: item rates scaled to ${(factor * 100).toFixed(1)}% so the ${asType} lands at $${cpqGrandTotal.toFixed(2)}.`, 'info');
    }

    let nsCustomerId = job.customer?.id || "";
    if (nsCustomerId.startsWith('CUST-')) nsCustomerId = nsCustomerId.replace('CUST-', '');
    if (!nsCustomerId) return { ok: false, error: { code: 'NO_CUSTOMER', message: 'This job has no NetSuite customer id — pick the customer on the quote first.' } };
    const brandMapping = BRAND_NETSUITE_MAP[brand] || { subsidiary: "2", location: "17" };

    const flowDoc = (data.cpqFlows || []).find(f => f.id === job.flowId);
    const flowName = flowDoc?.name || 'Custom Assembly';
    const rollupItemId = flowDoc?.nsRollupItemId || '61502';
    if (!flowDoc?.nsRollupItemId) log(`⚠️ Flow "${flowName}" has no dedicated rollup item — using shared default 61502.`, 'warn');
    const headerDesc = `${flowName} labor portion of quote# ${job.jobId || job.id} for Job: ${job.jobName || 'N/A'} Sidemark: ${job.sidemark || 'N/A'}`;

    const shippingPayload = {};
    if (job.shippingMethod === 'SAVED' && job.shippingAddressId) {
        shippingPayload.shipaddresslist = { id: job.shippingAddressId };
    } else if (job.shippingMethod === 'CUSTOM' && job.customShippingAddress) {
        let cleanState = job.customShippingAddress.state || '';
        if (cleanState) cleanState = cleanState.toUpperCase().replace(/\./g, '').trim();
        shippingPayload.shippingaddress = {
            attention: job.customShippingAddress.attention || '',
            addressee: job.customShippingAddress.addressee || '',
            addr1: job.customShippingAddress.addr1 || '',
            addr2: job.customShippingAddress.addr2 || '',
            city: job.customShippingAddress.city || '',
            state: cleanState,
            zip: job.customShippingAddress.zip || '',
            country: { id: job.customShippingAddress.country || 'US' }
        };
    }
    const memoText = String((job.sidemark || '').trim() || (job.jobName || '').trim());
    const shippingAmount = parseFloat(job.shippingAmount) || 0;
    if (shippingAmount > 0) {
        const sm = await resolveShipMethod();
        if (sm) {
            shippingPayload.shippingcost = parseFloat(shippingAmount.toFixed(2));
            shippingPayload.shipMethod = { id: sm.id };
            log(`Shipping $${shippingAmount.toFixed(2)} → header via ship method "${sm.name}".`, 'info');
        } else {
            log(`⚠️ No active Ship Item in NetSuite — pushing WITHOUT the $${shippingAmount.toFixed(2)} shipping charge.`, 'warn');
        }
    }

    const payload = {
        entity: { id: nsCustomerId },
        subsidiary: { id: brandMapping.subsidiary },
        location: { id: brandMapping.location },
        // CE rides its own custom forms (Eric 2026-08-11): estimate = "CE - Quote" (299), sales
        // order = 177 (the form Quick Ship has always used). Class 2 = Hardware.
        ...(brand === 'ce' ? { customForm: { id: asType === 'estimate' ? '299' : '177' }, class: { id: '2' } } : {}),
        memo: memoText,
        ...(job.poNumber ? { otherRefNum: String(job.poNumber).slice(0, 40) } : {}),
        ...(job.internalMemo ? { custbody_bit_internalmemo: String(job.internalMemo).slice(0, 999) } : {}),
        custbody50: job.jobId || job.id,
        ...shippingPayload,
        item: {
            items: [
                { item: { id: rollupItemId }, quantity: 1, rate: parseFloat(silentFeeBalance.toFixed(2)), price: { id: "-1" }, description: headerDesc },
                ...lineItems
            ]
        }
    };
    return { ok: true, payload, meta: { silentFeeBalance, unmappedNames, finishFallbacks, lineCount: lineItems.length, quotedTotal: cpqGrandTotal } };
}

// Standard writeBack specs — the worker stamps the returned NetSuite ids into these fields.
export const jobsEstimateWriteBack = (jobDocId) => ({ collection: 'jobs', docId: jobDocId, idField: 'netsuiteEstimateId', tranField: 'netsuiteEstimateNo', patch: { dateTransmitted: new Date().toISOString() } });
export const jobsSalesOrderWriteBack = (jobDocId) => ({ collection: 'jobs', docId: jobDocId, idField: 'netsuiteSalesOrderId', tranField: 'netsuiteSalesOrderNo', patch: {} });
// tranField lands the REAL SO number in `soId` — every screen keys the display off soId, so the
// app id shows until NetSuite posts and the true number takes over (the nsWoTran convention).
export const boardSalesOrderWriteBack = (soDocId) => ({ collection: 'hq_sales_orders', docId: soDocId, idField: 'nsInternalId', tranField: 'soId', patch: {} });

/**
 * Queue a job → NetSuite as an estimate or a salesorder, through ns_outbox (staged, serial,
 * retried, visible in RTG's Transmit Log and 11.1's Sync Queue). Returns { ok, outboxId, meta }.
 */
export async function queueNsTransaction({ job, asType = 'estimate', brand, data, ctx, by, writeBacks, log }) {
    const built = await buildNsTransaction({ job, asType, brand, data, ctx, log });
    if (!built.ok) return built;
    const outboxId = await enqueueNsWrite({
        kind: asType,
        label: `${asType === 'salesorder' ? 'Sales Order' : 'Quote/Estimate'} · ${job.quoteNo || job.jobId || job.id} · ${job.customer?.name || ''}`,
        targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/${asType}`,
        method: 'POST', payload: built.payload, sourceApp: 'HQ', createdBy: by || '',
        writeBack: writeBacks || null,
    });
    return { ok: true, outboxId, meta: built.meta };
}

/**
 * Turn an EXISTING NetSuite estimate into a Sales Order via the REST transform — the step that
 * until now was a human opening NetSuite and pressing Transform by hand. NetSuite copies the
 * lines, pricing and custbody50 linkage itself, so no line data is needed here.
 * ⚠ Needs live verification on the first real approve — the transform endpoint is exercised for
 * work-order completions already (the OAuth "!" encoding fix), but not yet for estimates.
 */
export async function queueEstimateToSalesOrder({ job, by, writeBacks }) {
    const estId = job.netsuiteEstimateId;
    if (!estId) return { ok: false, error: { code: 'NO_ESTIMATE', message: 'No NetSuite estimate on this job yet — the quote push may still be in the queue (watch the Transmit Log).' } };
    const outboxId = await enqueueNsWrite({
        kind: 'salesorder',
        label: `Sales Order ⇐ estimate ${job.netsuiteEstimateNo || estId} · ${job.quoteNo || job.jobId || job.id}`,
        targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/estimate/${estId}/!transform/salesorder`,
        method: 'POST', payload: {}, sourceApp: 'HQ', createdBy: by || '',
        writeBack: writeBacks || null,
    });
    return { ok: true, outboxId };
}
