// Finishing time model — the rebuilt "time matrix".
//
// A finishing work order's duration is driven by three attributes that already live on
// every part: the finish RECIPE, the PAINT SIZE (S/M/L), and the PRODUCT TYPE (pole, ring,
// finial, bracket, …). This module stores one editable table of MINUTES-PER-PART keyed by
// (recipe × paintSize × productType) and resolves a work order's estimate from it.
//
// Storage: Firestore doc `fin_config/timeMatrix`
//   { rules: { "RECIPE|SIZE|TYPE": minutesPerPart, ... }, default: minutesPerPart }
// Each of the three key segments may be the wildcard "*" to mean "any". Lookups try the most
// specific rule first and fall back through progressively generic ones, then the table default.
// Nothing is stored per item, so the matrix never goes stale and new items inherit automatically.

export const WILDCARD = '*';
const norm = (v) => (v == null ? WILDCARD : String(v).trim().toUpperCase()) || WILDCARD;

// Canonical key for a (recipe, size, type) triple. Empty/missing segments become the wildcard.
export function matrixKey(recipe, size, type) {
  return `${norm(recipe)}|${norm(size)}|${norm(type)}`;
}

// Resolve minutes-per-part for one (recipe, size, type), trying most-specific → most-generic.
// Returns null when nothing (not even a default) matches, so callers can flag "unpriced".
export function lookupMinsPerPart(matrix, recipe, size, type) {
  const rules = (matrix && matrix.rules) || {};
  const R = norm(recipe), S = norm(size), T = norm(type);
  // Specificity order: drop recipe before type before size (size is the strongest signal of
  // how many parts fit a sled section, so it's the last dimension we generalize away).
  const candidates = [
    [R, S, T],
    [WILDCARD, S, T],
    [R, S, WILDCARD],
    [WILDCARD, S, WILDCARD],
    [R, WILDCARD, T],
    [WILDCARD, WILDCARD, T],
    [R, WILDCARD, WILDCARD],
    [WILDCARD, WILDCARD, WILDCARD],
  ];
  for (const [r, s, t] of candidates) {
    const val = rules[`${r}|${s}|${t}`];
    if (val != null && val !== '') return Number(val);
  }
  return (matrix && matrix.default != null && matrix.default !== '') ? Number(matrix.default) : null;
}

// Estimate total finishing minutes for a work order.
//   • Custom WO: sum each partsList line's (minsPerPart × qty) — lines carry their own size+type.
//   • Stock/simple WO: WO-level (paintSize × productType) × totalParts.
// `resolved` is false if any contributing part had no matching matrix cell (estimate is partial).
export function estimateWorkOrderMins(wo, matrix) {
  if (!wo) return { mins: 0, parts: 0, resolved: false };
  const recipe = wo.recipe;

  const list = Array.isArray(wo.partsList)
    ? wo.partsList.filter(p => p && (Number(p.qty) || 0) > 0)
    : [];
  const lineKeyed = list.some(p => p.productType || p.paintSize);

  if (lineKeyed) {
    let mins = 0, parts = 0, resolved = true;
    list.forEach(p => {
      const qty = Number(p.qty) || 0;
      const per = lookupMinsPerPart(matrix, recipe, p.paintSize, p.productType);
      if (per == null) resolved = false;
      mins += (per || 0) * qty;
      parts += qty;
    });
    return { mins, parts, resolved };
  }

  const qty = Number(wo.totalParts) || 0;
  const per = lookupMinsPerPart(matrix, recipe, wo.paintSize, wo.productType);
  return { mins: (per || 0) * qty, parts: qty, resolved: per != null };
}
