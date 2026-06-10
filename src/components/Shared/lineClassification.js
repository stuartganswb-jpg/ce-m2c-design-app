// Single source of truth for splitting a CPQ order line into the two
// production divisions: 'small' (-> Finishing Floor) vs 'custom' (-> Shop Floor).
//
// See WORK_ORDER_CONTRACT.md §7. The authoritative signal is the per-step
// `partHandling` flag set in the CPQ flow builder (AdminTab "Part Handling &
// Routing", values from master_lists.partHandling, default 'Small Parts'/'Custom').
// CPQTab bakes that flag (and the selected partId) onto each priced line, so by
// the time the SO-import handler reads job.cpqData lines it can classify without
// re-joining to the flow doc.

export const DIVISION_SMALL = 'small';
export const DIVISION_CUSTOM = 'custom';

// Normalize any free-text handling value ('Small Parts', 'SMALL', 'Custom',
// 'Custom Fabrication', ...) to a division, or null if it isn't a handling value.
function normalizeHandling(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  if (v.includes('small')) return DIVISION_SMALL;
  if (v.includes('custom')) return DIVISION_CUSTOM;
  return null;
}

/**
 * Classify a single order line as 'small' or 'custom'.
 *
 * @param {object} line  A cpqData line. Expected (after the CPQTab change):
 *                       { name, qty, price, total, partHandling, partId }.
 * @param {object} [part] The resolved Approved_Designs part for line.partId,
 *                        used only for fallback signals when the line carries
 *                        no explicit flag.
 * @returns {'small'|'custom'}
 */
export function classifyLine(line, part) {
  // 1. Explicit per-line flag (propagated from step.partHandling) — authoritative.
  const explicit = normalizeHandling(line && line.partHandling);
  if (explicit) return explicit;

  // 2. Fall back to the part-level manufacturing handling, if a part resolved.
  const specs = part && part.manufacturingSpecs;
  const partLevel = normalizeHandling(specs && specs.partHandling);
  if (partLevel) return partLevel;

  // 3. Made-to-measure parts are custom fabrication.
  if (part && part.parametric && part.parametric.isCutToSize === true) {
    return DIVISION_CUSTOM;
  }

  // 4. Default: route to the small-parts/finishing side.
  return DIVISION_SMALL;
}
