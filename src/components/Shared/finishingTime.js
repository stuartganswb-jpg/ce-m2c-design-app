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
export const SIZE_CAPACITY = { S: 70, M: 35, L: 22 }; // baseline pieces-per-sled by size

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

// Resolve a recipe by key, tolerant of the "CODE - Name" display string RTG stamps onto a WO's
// `recipe` field (the Recipes tab keys docs by CODE only). Tries the exact key, then the code
// before the first " - ". Shared by the planner and ActiveFloor so step lookups agree.
export function resolveRecipe(recipes, key) {
  if (!recipes || !key) return null;
  if (recipes[key]) return recipes[key];
  const code = String(key).split(' - ')[0].trim();
  return (code && recipes[code]) || null;
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

// Build a sequenced finishing plan. Stock and custom are scheduled DIFFERENTLY (sleds only ever hold
// one recipe either way):
//   • CUSTOM — a sales order is a mix of different part sizes in one finish. Each custom WO is its own
//     batch, sequenced by due date (the customer commitment).
//   • STOCK — bulk qty of one item in one finish. Pooled by recipe into filler batches that run after
//     the dated custom work / top off the machine when there's headroom.
// Pure function. opts.dailyMins = a shift's oven minutes (capacity denominator).
export function buildFinishingPlan(workOrders = [], recipes = {}, matrix = {}, timers = {}, opts = {}) {
  const plannable = workOrders.filter(w => PLANNABLE_PHASES.includes(w.currentPhase));
  const customWOs = plannable.filter(isCustomWO);
  const stockWOs = plannable.filter(w => !isCustomWO(w));

  // Custom: one batch per order, earliest due date first.
  const customBatches = customWOs
    .map(wo => priceBatch(wo.recipe || '(no recipe)', [wo], 'custom', recipes, matrix, timers))
    .sort((a, b) => (a.reqDate || '9999-12-31') < (b.reqDate || '9999-12-31') ? -1
      : (a.reqDate || '9999-12-31') > (b.reqDate || '9999-12-31') ? 1 : 0);

  // Stock: pooled per recipe, largest first (better sled fill).
  const stockGroups = {};
  stockWOs.forEach(wo => { const r = wo.recipe || '(no recipe)'; (stockGroups[r] = stockGroups[r] || []).push(wo); });
  const stockBatches = Object.entries(stockGroups)
    .map(([r, wos]) => priceBatch(r, wos, 'stock', recipes, matrix, timers))
    .sort((a, b) => b.parts - a.parts);

  const batches = [...customBatches, ...stockBatches];
  const sum = (arr, k) => arr.reduce((s, b) => s + b[k], 0);
  const totalMachineMins = sum(batches, 'machineMins');
  const sledOvenMins = sum(batches, 'ovenMins');  // sled bakes only
  const totalSleds = sum(batches, 'sleds');
  const totalParts = sum(batches, 'parts');
  const smallHandMins = sum(batches, 'handMins'); // small-part hand finish

  // --- Poles share the ONE oven with the sleds (the bottleneck), and small-part hand-finishing is
  // done during the pole-oven window (sleds can't cure then anyway). Pole qty lives on the finishing
  // WO's `poles.qty` (manual intake) / `totalPoles` / a `type:'Poles'` WO. ---
  const poleMin = Number(timers.poleMins) || 5;
  const handPoleMin = Number(timers.handPoleMins) || 10;
  const ovenMin = Number(timers.ovenMins) || 10;
  let poleCount = 0, poleSprayMins = 0, poleOvenMins = 0, poleHandMins = 0;
  plannable.forEach(wo => {
    const poles = Number(wo.poles?.qty) || Number(wo.totalPoles) || (wo.type === 'Poles' ? Number(wo.totalParts) : 0) || 0;
    if (poles <= 0) return;
    const recipe = resolveRecipe(recipes, wo.recipe);
    const sprayed = recipe && Array.isArray(recipe.steps) ? recipe.steps.filter(s => s.app === 'Sprayed').length : 0;
    const hasHand = !!(recipe && Array.isArray(recipe.steps) && recipe.steps.some(s => s.app === 'Hand Applied'));
    poleCount += poles;
    poleSprayMins += poles * poleMin * sprayed;
    poleOvenMins += sprayed * ovenMin;              // one pole-rack load per sprayed step
    if (hasHand) poleHandMins += poles * handPoleMin;
  });

  const ovenTotalMins = sledOvenMins + poleOvenMins;        // serialized through the single oven
  const totalHandMins = smallHandMins + poleHandMins;
  const handOverlapMins = Math.min(totalHandMins, poleOvenMins); // hand-finish hidden in pole-oven window
  const handBeyondMins = Math.max(0, totalHandMins - poleOvenMins);

  const dailyMins = Number(opts.dailyMins) || Number(timers.activeFloorDailyMinutes) || 480;
  // Wall-clock: the oven is the spine (sled + pole bakes serialized); sled setup/spray pipelines under
  // it, and hand-finish overlaps the pole-oven window — only hand beyond that window adds on.
  const wallMins = ovenTotalMins + handBeyondMins;

  return {
    batches, customBatches, stockBatches,
    totalMachineMins, totalSleds, totalParts,
    sledOvenMins, poleOvenMins, ovenTotalMins,
    poleCount, poleSprayMins, smallHandMins, poleHandMins, totalHandMins, handOverlapMins,
    dailyMins, wallMins, days: wallMins / dailyMins,
  };
}
