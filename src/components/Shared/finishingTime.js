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
  // BOTH partsList SPELLINGS, AND PIECES FIRST (2026-10-13): a stock run, a paint run and an Order Entry pair write
  // `quantity`, the CPQ split `qty`, and a rod sold by the foot carries its pieces in `pcs` — read as the writers count
  // them (Shared/rowPairShape.docStreamsOf). On `qty` alone every line that was not a CPQ split's counted for nothing.
  const pcsOf = (p) => Number(p.pcs) || Number(p.quantity) || Number(p.qty) || 0;
  const list = Array.isArray(wo.partsList) ? wo.partsList.filter(p => p && pcsOf(p) > 0) : [];
  if (list.some(p => p.paintSize || p.productType)) {
    return list.map(p => ({ size: p.paintSize, type: p.productType, qty: pcsOf(p) }));
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
// `opts.dryMins`: what follows each sprayed coat when it is NOT the oven — a wood coat's 20-minute air dry, worked out by
// the caller (Shared/airDry.dryMinsOf, which reads this file, so the rule cannot live here). Omitted = the oven, as before.
export function batchMachineMins(recipe, timers = {}, opts = {}) {
  const spinSetup = Number(timers.spinSetupMins) || 10;
  const spinPaint = Number(timers.spinPaintMins) || 3;
  const oven = Number(opts.dryMins) > 0 ? Number(opts.dryMins) : (Number(timers.ovenMins) || 10);
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

// Poles cure 8 to a rack — the pole track's capacity (Shared/finishingPlan prices the racks).
export const POLE_RACK = 8;

// THE SCHEDULE ITSELF MOVED (2026-10-13) → Shared/finishingPlan.buildFinishingPlan: each track on its own recipe, only
// what is left, spin or booth, and the floor's own word for ready. This file keeps what it is named for — capacity,
// the per-sled machine time and how a recipe code is resolved.
