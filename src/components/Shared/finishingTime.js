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

// Build a sequenced finishing plan from work orders. Sleds only ever hold ONE recipe, so we group
// by recipe, pack each recipe's pooled parts into sleds by footprint, price the batch from the
// timers × recipe steps, and sequence custom (date-driven) ahead of stock filler. Pure function.
export function buildFinishingPlan(workOrders = [], recipes = {}, matrix = {}, timers = {}, opts = {}) {
  const plannable = workOrders.filter(w => PLANNABLE_PHASES.includes(w.currentPhase));

  const groups = {};
  plannable.forEach(wo => {
    const r = wo.recipe || '(no recipe)';
    (groups[r] = groups[r] || { recipe: r, wos: [] }).wos.push(wo);
  });

  const ovenPerStep = Number(timers.ovenMins) || 10;

  const batches = Object.values(groups).map(g => {
    const recipe = recipes[g.recipe];
    const lines = g.wos.flatMap(workOrderPartLines);
    const { footprint, parts, resolved } = packFootprint(lines, matrix);
    const sleds = sledsFromFootprint(footprint, parts);
    const sprayedSteps = recipe && Array.isArray(recipe.steps) ? recipe.steps.filter(s => s.app === 'Sprayed').length : 0;
    const hasHand = !!(recipe && Array.isArray(recipe.steps) && recipe.steps.some(s => s.app === 'Hand Applied'));
    const handMins = hasHand ? parts * (Number(timers.handSmallMins) || 1.35) : 0;
    const machineMins = sleds * batchMachineMins(recipe, timers) + handMins;
    const ovenMins = sleds * sprayedSteps * ovenPerStep;     // oven demand = the shared bottleneck
    const dates = g.wos.map(w => w.reqDate).filter(Boolean).sort();
    return {
      recipe: g.recipe,
      wos: g.wos,
      woCount: g.wos.length,
      parts,
      sleds,
      footprint,
      sizeMix: sizeMixOf(lines),
      sprayedSteps,
      hasHand,
      hasCustom: g.wos.some(isCustomWO),
      hasStock: g.wos.some(w => !isCustomWO(w)),
      reqDate: dates[0] || null,
      machineMins,
      handMins,
      ovenMins,
      resolved: resolved && !!recipe,
    };
  });

  // Sequence: custom batches first (earliest due date wins), stock filler after, unpriced last.
  batches.sort((a, b) => {
    if (a.hasCustom !== b.hasCustom) return a.hasCustom ? -1 : 1;
    if (a.reqDate && b.reqDate) return a.reqDate < b.reqDate ? -1 : (a.reqDate > b.reqDate ? 1 : 0);
    if (a.reqDate) return -1;
    if (b.reqDate) return 1;
    return b.parts - a.parts;
  });

  const totalMachineMins = batches.reduce((s, b) => s + b.machineMins, 0);
  const totalOvenMins = batches.reduce((s, b) => s + b.ovenMins, 0);
  const totalSleds = batches.reduce((s, b) => s + b.sleds, 0);
  const totalParts = batches.reduce((s, b) => s + b.parts, 0);
  const dailyMins = Number(opts.dailyMins) || Number(timers.activeFloorDailyMinutes) || 480;
  // Wall-clock is gated by the shared oven (one bake at a time) — both sleds funnel bakes through it,
  // so total oven minutes is the floor on elapsed time, never less than that. Refined in a later pass.
  const wallMins = Math.max(totalOvenMins, totalMachineMins / 2);

  return { batches, totalMachineMins, totalOvenMins, totalSleds, totalParts, dailyMins, wallMins, days: wallMins / dailyMins };
}
