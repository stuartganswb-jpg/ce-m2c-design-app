// Finishing capacity + time model.
//
// CAPACITY MATRIX (fin_config/capacityMatrix): how many of a part fill ONE spray-machine sled,
// keyed by PAINT SIZE × PRODUCT TYPE. Capacity is physical, so recipe is NOT a key. Size gives the
// baseline (S=70, M=35, L=22 parts/sled); a product-type entry refines it (e.g. bracket-M = 40).
// A part's "footprint" = 1/capacity (its fraction of a sled). A sled — same recipe only — packs
// mixed sizes/types until their footprints sum to 1.
//
// TIME comes from the AI Production Timers (fin_config/settings) × the recipe's steps × the batch
// count — capacity (this file) and per-step time (the timers) never overlap:
//   batches      = ceil(Σ qty / capacity)
//   machine/batch = spinSetup (load once)
//                 + Σ sprayed steps (spinPaint + oven)   // each step gets its own bake
//                 + Σ hand steps    (~2 × spinSetup)      // pull off the machine + put back on
//   hand labor   = parts × handSmallMins                 // if the recipe has any Hand Applied step

export const WILDCARD = '*';
// Baseline pieces per spray-machine ZONE (blue/red) by size — Stuart 2026-08-28: "70 pc each if
// parts are small, 35 each if medium, and 17 each if large" (L corrected from the old 22).
export const SIZE_CAPACITY = { S: 70, M: 35, L: 17 };

const normSize = (v) => { const s = String(v || '').trim().toUpperCase(); return ['S', 'M', 'L'].includes(s) ? s : ''; };
const normType = (v) => String(v || '').trim().toUpperCase() || WILDCARD;

// Canonical capacity-rule key: "SIZE|TYPE" (type may be the wildcard).
export function capacityKey(size, type) {
  return `${normSize(size) || WILDCARD}|${normType(type)}`;
}

// Pieces-per-sled for one size × type. Resolution order:
//   exact size|type  →  size|* (any type)  →  size baseline (S/M/L)  →  matrix default  →  null.
export function lookupCapacity(matrix, size, type) {
  const rules = (matrix && matrix.rules) || {};
  const S = normSize(size), T = normType(type);
  if (S) {
    for (const k of [`${S}|${T}`, `${S}|${WILDCARD}`]) {
      const v = rules[k];
      if (v != null && v !== '' && Number(v) > 0) return Number(v);
    }
    if (SIZE_CAPACITY[S]) return SIZE_CAPACITY[S];
  }
  return (matrix && Number(matrix.default) > 0) ? Number(matrix.default) : null;
}

// ── MACHINE LOAD PLAN (Stuart 2026-08-28) ─────────────────────────────────────────────────────
// One big order stays ONE work order — the shop sets up once for the total — but the spray
// machine takes it in ZONE-SIZED loads (70 S · 35 M · 17 L per zone, matrix-refinable per type).
// This turns a WO's quantity into the load list its labels print (PART 1 OF n …), so the floor
// runs one order in machine-sized bites that visibly belong together, replacing the old
// workaround of entering several small orders. Returns null when the order fits one load (or
// the size can't resolve a capacity) — callers then behave exactly as before.
export function machineLoadPlan(matrix, size, type, qty) {
  const per = lookupCapacity(matrix, size, type);
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  if (!per || !n || n <= per) return null;
  const loads = [];
  for (let i = 0, left = n; left > 0; i++) { const q = Math.min(per, left); loads.push({ part: i + 1, qty: q }); left -= q; }
  return { perLoad: per, total: n, count: loads.length, loads };
}

// Normalize a work order to [{ size, type, qty }] part lines. Custom WOs carry per-part keys on
// each partsList line; stock/simple WOs use the WO-level size + type × totalParts.
export function workOrderPartLines(wo) {
  if (!wo) return [];
  const list = Array.isArray(wo.partsList) ? wo.partsList.filter(p => p && (Number(p.qty) || 0) > 0) : [];
  if (list.some(p => p.paintSize || p.productType)) {
    return list.map(p => ({ size: p.paintSize, type: p.productType, qty: Number(p.qty) || 0 }));
  }
  const qty = Number(wo.totalParts) || 0;
  return qty > 0 ? [{ size: wo.paintSize, type: wo.productType, qty }] : [];
}

// Sum the sled-footprint + part count for a set of part lines (already pooled by the caller —
// same-recipe parts share sleds). `resolved` is false if any line had no capacity to resolve.
export function packFootprint(lines, matrix) {
  let footprint = 0, parts = 0, resolved = true;
  (lines || []).forEach(l => {
    const qty = Number(l.qty) || 0;
    parts += qty;
    const cap = lookupCapacity(matrix, l.size, l.type);
    if (!cap) { resolved = false; return; }
    footprint += qty / cap;
  });
  return { footprint, parts, resolved };
}

// Sled count from a footprint sum (≥1 sled whenever there are parts).
export function sledsFromFootprint(footprint, parts) {
  if ((parts || 0) <= 0) return 0;
  return Math.max(1, Math.ceil(footprint - 1e-9));
}

// Per-sled MACHINE minutes for a recipe (load + each sprayed step's spray+bake + hand off/on).
// Excludes per-part hand labor, which the caller adds once per part.
export function batchMachineMins(recipe, timers = {}) {
  const spinSetup = Number(timers.spinSetupMins) || 10;
  const spinPaint = Number(timers.spinPaintMins) || 3;
  const oven = Number(timers.ovenMins) || 10;
  const steps = (recipe && Array.isArray(recipe.steps)) ? recipe.steps : [];
  let mins = spinSetup; // load the sled once
  steps.forEach(s => {
    if (s.app === 'Sprayed') mins += spinPaint + oven;   // each sprayed step its own bake
    else if (s.app === 'Hand Applied') mins += 2 * spinSetup; // off the machine + back on
  });
  return mins;
}

// Estimate sleds + total finishing minutes for ONE work order on its own. The planner pools by
// recipe across WOs for tighter sled packing; this standalone version is for per-WO display.
export function estimateWorkOrder(wo, recipesById = {}, matrix = {}, timers = {}) {
  const { footprint, parts, resolved } = packFootprint(workOrderPartLines(wo), matrix);
  const batches = sledsFromFootprint(footprint, parts);
  const recipe = recipesById[wo && wo.recipe];
  const hasHand = !!(recipe && Array.isArray(recipe.steps) && recipe.steps.some(s => s.app === 'Hand Applied'));
  const handMins = hasHand ? parts * (Number(timers.handSmallMins) || 1.35) : 0;
  const mins = batches * batchMachineMins(recipe, timers) + handMins;
  return { batches, parts, mins, resolved: resolved && !!recipe };
}

const PLANNABLE_PHASES = ['Setup', 'setup', 'Painting'];
const sizeMixOf = (lines) => lines.reduce((m, l) => {
  const s = String(l.size || '').toUpperCase();
  if (['S', 'M', 'L'].includes(s)) m[s] += (Number(l.qty) || 0);
  return m;
}, { S: 0, M: 0, L: 0 });
const isCustomWO = (w) => (w.orderType || '') === 'sales' || !!w.salesOrderId;

// Is a WO actually READY to schedule onto the floor? A sales/custom order is ready only once Pick/Pack
// has scan-matched its two halves (stagingStatus 'MATCHED'); stock builds + stock poles skip that
// staging and are immediately schedulable. Not-ready sales orders still SHOW in the plan, tagged
// "In Set Up", but don't count toward the runnable schedule.
const isReadyWO = (w) => w.stagingStatus === 'MATCHED' || ((w.orderType || '') !== 'sales' && !w.salesOrderId);

// Resolve a recipe by key, tolerant of the "CODE - Name" display string RTG stamps onto a WO's
// `recipe` field (the Recipes tab keys docs by CODE only). Tries the exact key, then the code
// before the first " - ". Shared by the planner and ActiveFloor so step lookups agree.
// WHY THIS HAD TO GET FORGIVING (Stuart 2026-08-03, WO11374): recipes are keyed by FIRESTORE DOC
// ID, and a work order carries the recipe as free text stamped at dispatch ("N25", "BL - BLACK",
// whatever the flow said). An exact-key lookup fails on any drift in case or spacing — and a failed
// lookup used to mean length 0, which the floor read as "no coats left", i.e. FINISHED. An order
// completed itself the moment anyone touched it.
//
// The completion guard is the real fix and lives in ActiveFloor; this widens the match so the guard
// rarely has to fire. Order matters: exact id first, so a deliberate id always wins over a fuzzy
// name match.
export function resolveRecipe(recipes, key) {
  if (!recipes || !key) return null;
  if (recipes[key]) return recipes[key];
  const code = String(key).split(' - ')[0].trim();
  if (code && recipes[code]) return recipes[code];
  const want = String(key).trim().toUpperCase();
  const wantCode = code.toUpperCase();
  const entries = Object.entries(recipes);
  // Case/space-insensitive on the doc id.
  const byId = entries.find(([id]) => String(id).trim().toUpperCase() === want)
    || entries.find(([id]) => String(id).trim().toUpperCase() === wantCode);
  if (byId) return byId[1];
  // Then the recipe's own declared code/name — a doc stored under a generated id still resolves.
  const byField = entries.find(([, r]) => r && [r.code, r.name, r.recipeCode].some(v => v && String(v).trim().toUpperCase() === want))
    || entries.find(([, r]) => r && [r.code, r.name, r.recipeCode].some(v => v && String(v).trim().toUpperCase() === wantCode));
  return byField ? byField[1] : null;
}

// Coats in a recipe, or 0 when it cannot be resolved. ZERO IS NOT "FINISHED" — every caller that
// decides completion must check for it explicitly; see the guard in ActiveFloor.
export function recipeStepCount(recipes, key) {
  const r = resolveRecipe(recipes, key);
  return (r && Array.isArray(r.steps) && r.steps.length) || 0;
}

// ── THE FINISH CODE AN ORDER ACTUALLY RUNS (Stuart 2026-08-17) ────────────────────────────────
// "these are coming up with pending recipe on the pending set up. but they all have proper recipes?"
//
// They do. The recipes were never the problem — the ORDER never carried a finish code to match them
// with. `recipe` is stamped at dispatch, but three stock-build paths write an hq_work_orders doc
// with no `recipe` field at all (the Master Library make-up cascade and its direct build, and the
// Stock View WO push). RTG's release then falls back to `hqOrder.recipe || 'PENDING-RECIPE'`, and a
// whole batch lands on the floor labelled PENDING-RECIPE even though the finish is sitting right
// there in the item code — HCUMB410/BS is a BS order.
//
// Deriving it here heals orders already on the floor (they are picked and staged; nobody should have
// to re-raise them) and makes the gap self-correcting. The writers stamp it properly too, so this is
// a safety net rather than the mechanism.
export const PENDING_RECIPE = 'PENDING-RECIPE';
export const isPendingRecipe = (v) => {
  const s = String(v == null ? '' : v).trim();
  return !s || /^(PENDING[-\s]?RECIPE|PENDING|N\/A|NONE|[-—])$/i.test(s);
};
// The finish suffix of an item code: HCUMB410/BS → BS. The '-' split drops ring-pack suffixes
// (BASE/SG-EA, BASE/BS-7) so a pack and its single batch together, exactly as Stock View reads them.
//
// THE P FAMILY IS THREE DIFFERENT THINGS — the test is EXACT EQUALITY, never a prefix:
//   /P          the PHOSPHATED core a finish is sprayed ONTO. Not a finish. Excluded, because
//               deriving "P" would invent a spray recipe nobody wrote and batch cores under it.
//   /P01, /P1…  PAINTED finishes with real recipes, like any other code. P + digits is paint.
//   /P25        the outsourced plater code — derived like the rest, then routed away from the
//               spray line by finishRouteOf, which reads it out of the resolved recipe.
// Never widen this to /^P/: it would silently strip every painted P-code off its own recipe.
export function finishCodeFromErp(erpId) {
  const s = String(erpId == null ? '' : erpId).trim();
  const i = s.lastIndexOf('/');
  if (i <= 0) return '';
  const code = s.slice(i + 1).split('-')[0].trim().toUpperCase();
  return code === 'P' ? '' : code;
}
export function woRecipeCode(wo) {
  if (!wo) return '';
  const stamped = String(wo.recipe || wo.color || '').trim();
  if (!isPendingRecipe(stamped)) return stamped;
  // `type` is last and guarded: some paths put the item code there, others a display name.
  const looksLikeCode = (v) => /^[A-Za-z0-9][A-Za-z0-9\-/.]*$/.test(String(v || '').trim());
  const sources = [wo.stockErpId, wo.variantErpId, wo.partErpId, wo.rootItem, looksLikeCode(wo.type) ? wo.type : ''];
  for (const src of sources) {
    const code = finishCodeFromErp(src);
    if (code) return code;
  }
  return stamped || PENDING_RECIPE;
}

// ── STREAM RECIPE VARIANTS (Stuart & Grace 2026-08-11) ─────────────────────────────────────────
// ONE customer color code, TWO internal routings. CPQ, the quote and the work order all say `CP`;
// the floor runs `CP-S` on the small parts and `CP-P` on the poles WHENEVER those recipe docs
// exist in Finish Recipes (Grace authors them like any other recipe — same code plus -S / -P).
// No variant recipe → the base code resolves exactly as before, so every existing recipe and
// every order without poles is untouched. The -S/-P extension affects ONLY finishing-floor
// routing — never item codes, pricing, or what the customer sees.
export const STREAM_SUFFIX = { SMALL: 'S', POLES: 'P' };
// A -S/-P stream variant code (CP-S, CP-P). These are FLOOR ROUTING detail: they must never
// appear as selectable finishes in CPQ flow building, 4.5's master list, or customer surfaces —
// the master code (CP) is the finish; the floor resolves the variant per stream.
export const isStreamVariantCode = (code) => /-(S|P)$/i.test(String(code || '').trim());
export const streamMasterOf = (code) => String(code || '').trim().replace(/-(S|P)$/i, '');
export function streamRecipeKey(recipes, key, stream) {
  if (!key) return key;
  const sfx = STREAM_SUFFIX[stream] || String(stream || '').trim().toUpperCase();
  if (!sfx) return key;
  const base = String(key).split(' - ')[0].trim();
  const cand = `${base}-${sfx}`;
  return resolveRecipe(recipes, cand) ? cand : key;
}
export function resolveStreamRecipe(recipes, key, stream) {
  return resolveRecipe(recipes, streamRecipeKey(recipes, key, stream));
}
export function streamRecipeStepCount(recipes, key, stream) {
  const r = resolveStreamRecipe(recipes, key, stream);
  return (r && Array.isArray(r.steps) && r.steps.length) || 0;
}

// Price one batch (WOs that share a recipe + a sled pool) from capacity + timers.
function priceBatch(recipeCode, wos, kind, recipes, matrix, timers) {
  const recipe = resolveRecipe(recipes, recipeCode);
  const lines = wos.flatMap(workOrderPartLines);
  const { footprint, parts, resolved } = packFootprint(lines, matrix);
  const sleds = sledsFromFootprint(footprint, parts);
  const mix = sizeMixOf(lines);
  const sprayedSteps = recipe && Array.isArray(recipe.steps) ? recipe.steps.filter(s => s.app === 'Sprayed').length : 0;
  const hasHand = !!(recipe && Array.isArray(recipe.steps) && recipe.steps.some(s => s.app === 'Hand Applied'));
  const handMins = hasHand ? parts * (Number(timers.handSmallMins) || 1.35) : 0;
  const machineMins = sleds * batchMachineMins(recipe, timers) + handMins;
  const ovenMins = sleds * sprayedSteps * (Number(timers.ovenMins) || 10);
  const dates = wos.map(w => w.reqDate).filter(Boolean).sort();
  return {
    kind, recipe: recipeCode, wos, woCount: wos.length, parts, sleds, footprint,
    sizeMix: mix, distinctSizes: ['S', 'M', 'L'].filter(s => mix[s] > 0).length,
    sprayedSteps, hasHand, reqDate: dates[0] || null,
    machineMins, handMins, ovenMins, resolved: resolved && !!recipe,
  };
}

export const POLE_RACK = 8; // poles cure 8 per rack

// A WO whose part is a POLE. Stocked poles (ordered via Stock View) carry a POLE productType; manual
// pole orders use type:'Poles'. Custom poles are fabricated on the Shop floor and never reach
// finishing, so finishing pole work is the STOCKED poles only.
const isPoleWO = (wo) => /pole/i.test(String(wo.productType || '')) || wo.type === 'Poles';
// Poles a WO contributes to the pole rack: a pole WO's whole qty, else its explicit pole field.
const poleQtyOf = (wo) => isPoleWO(wo) ? (Number(wo.totalParts) || 0) : (Number(wo.poles?.qty) || Number(wo.totalPoles) || 0);

// Price a pole batch (same-recipe poles pooled), racked 8 at a time. Poles spray on the pole rack and
// bake in the shared oven (one rack load per sprayed step), then hand-finish.
function pricePoleBatch(recipeCode, wos, recipes, timers) {
  const recipe = resolveRecipe(recipes, recipeCode);
  const poles = wos.reduce((s, w) => s + poleQtyOf(w), 0);
  const racks = poles > 0 ? Math.ceil(poles / POLE_RACK) : 0;
  const sprayedSteps = recipe && Array.isArray(recipe.steps) ? recipe.steps.filter(s => s.app === 'Sprayed').length : 0;
  const hasHand = !!(recipe && Array.isArray(recipe.steps) && recipe.steps.some(s => s.app === 'Hand Applied'));
  const sprayMins = poles * (Number(timers.poleMins) || 5) * sprayedSteps;
  const ovenMins = racks * sprayedSteps * (Number(timers.ovenMins) || 10);
  const handMins = hasHand ? poles * (Number(timers.handPoleMins) || 10) : 0;
  const dates = wos.map(w => w.reqDate).filter(Boolean).sort();
  return {
    kind: 'pole', recipe: recipeCode, wos, woCount: wos.length, poles, racks,
    sprayedSteps, hasHand, reqDate: dates[0] || null, sprayMins, ovenMins, handMins,
    resolved: !!recipe,
  };
}

// Build a sequenced finishing plan. Stock and custom are scheduled DIFFERENTLY (sleds only ever hold
// one recipe either way):
//   • CUSTOM — a sales order is a mix of different part sizes in one finish. Each custom WO is its own
//     batch, sequenced by due date (the customer commitment).
//   • STOCK — bulk qty of one item in one finish. Pooled by recipe into filler batches that run after
//     the dated custom work / top off the machine when there's headroom.
// Pure function. opts.dailyMins = a shift's oven minutes (capacity denominator).
export function buildFinishingPlan(workOrders = [], recipes = {}, matrix = {}, timers = {}, opts = {}) {
  const plannable = workOrders.filter(w => PLANNABLE_PHASES.includes(w.currentPhase));
  const sledWOs = plannable.filter(w => !isPoleWO(w));   // small parts (sleds)
  const customWOs = sledWOs.filter(isCustomWO);
  const stockWOs = sledWOs.filter(w => !isCustomWO(w));

  // Custom small parts: one batch per order. Scan-matched (ready) first, then by due date; not-yet-
  // matched orders stay visible tagged "In Set Up".
  const customBatches = customWOs
    .map(wo => {
      const b = priceBatch(wo.recipe || '(no recipe)', [wo], 'custom', recipes, matrix, timers);
      b.ready = isReadyWO(wo);
      b.status = b.ready ? 'SCHEDULED' : 'IN SET UP';
      return b;
    })
    .sort((a, b) => {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      return (a.reqDate || '9999-12-31') < (b.reqDate || '9999-12-31') ? -1
        : (a.reqDate || '9999-12-31') > (b.reqDate || '9999-12-31') ? 1 : 0;
    });

  // Stock small parts: pooled per recipe, largest first. Always ready (skip pick/pack staging).
  const stockGroups = {};
  stockWOs.forEach(wo => { const r = wo.recipe || '(no recipe)'; (stockGroups[r] = stockGroups[r] || []).push(wo); });
  const stockBatches = Object.entries(stockGroups)
    .map(([r, wos]) => { const b = priceBatch(r, wos, 'stock', recipes, matrix, timers); b.ready = true; b.status = 'SCHEDULED'; return b; })
    .sort((a, b) => b.parts - a.parts);

  // Poles (stocked, from Stock View): pooled per recipe, racked 8 at a time. Always ready —
  // no custom-fab gate, since custom poles never reach finishing.
  const poleGroups = {};
  plannable.forEach(wo => { if (poleQtyOf(wo) > 0) { const r = wo.recipe || '(no recipe)'; (poleGroups[r] = poleGroups[r] || []).push(wo); } });
  const poleBatches = Object.entries(poleGroups)
    .map(([r, wos]) => { const b = pricePoleBatch(r, wos, recipes, timers); b.ready = true; b.status = 'SCHEDULED'; return b; })
    .sort((a, b) => b.poles - a.poles);

  // The runnable schedule = READY batches only. "In Set Up" customs still display, but don't count
  // toward sleds/oven/time or take a run-sequence slot.
  const sledScheduled = [...customBatches.filter(b => b.ready), ...stockBatches];
  const setupBatches = customBatches.filter(b => !b.ready);
  let seq = 0;
  [...sledScheduled, ...poleBatches].forEach(b => { b.seq = ++seq; });
  setupBatches.forEach(b => { b.seq = null; });

  const batches = [...customBatches, ...stockBatches];
  const sum = (arr, k) => arr.reduce((s, b) => s + b[k], 0);
  const totalMachineMins = sum(sledScheduled, 'machineMins');
  const sledOvenMins = sum(sledScheduled, 'ovenMins');  // sled bakes only (ready work)
  const totalSleds = sum(sledScheduled, 'sleds');
  const totalParts = sum(sledScheduled, 'parts');
  const smallHandMins = sum(sledScheduled, 'handMins'); // small-part hand finish (ready work)
  const setupCount = setupBatches.length;

  // Poles share the ONE oven with the sleds (the bottleneck); small-part hand-finish is done during
  // the pole-oven window (sleds can't cure then anyway).
  const poleCount = sum(poleBatches, 'poles');
  const poleRacks = sum(poleBatches, 'racks');
  const poleSprayMins = sum(poleBatches, 'sprayMins');
  const poleOvenMins = sum(poleBatches, 'ovenMins');
  const poleHandMins = sum(poleBatches, 'handMins');

  const ovenTotalMins = sledOvenMins + poleOvenMins;        // serialized through the single oven
  const totalHandMins = smallHandMins + poleHandMins;
  const handOverlapMins = Math.min(totalHandMins, poleOvenMins); // hand-finish hidden in pole-oven window
  const handBeyondMins = Math.max(0, totalHandMins - poleOvenMins);

  const dailyMins = Number(opts.dailyMins) || Number(timers.activeFloorDailyMinutes) || 480;
  // Wall-clock: the oven is the spine (sled + pole bakes serialized); sled setup/spray pipelines under
  // it, and hand-finish overlaps the pole-oven window — only hand beyond that window adds on.
  const wallMins = ovenTotalMins + handBeyondMins;

  return {
    batches, customBatches, stockBatches, poleBatches,
    totalMachineMins, totalSleds, totalParts, setupCount,
    sledOvenMins, poleOvenMins, ovenTotalMins,
    poleCount, poleRacks, poleSprayMins, smallHandMins, poleHandMins, totalHandMins, handOverlapMins,
    dailyMins, wallMins, days: wallMins / dailyMins,
  };
}
