// Single source of truth for the per-brand "dictionary window" visibility model.
//
// Each system dictionary (prodTypes, partHandling, collections, ...) is visible to a
// brand IFF that brand id appears in the window's brand array. The stored config doc
// (system/window_config) overrides these defaults per-key; any key the stored doc omits
// falls back to the default below — so a brand always sees a window unless it was
// explicitly turned off for that brand via the "Manage Brand Windows" UI.
//
// IMPORTANT: every consumer MUST build its windowConfig via mergeWindowConfig() so the
// SAME stored doc yields the SAME visibility everywhere. This used to drift badly:
// LibraryTab merged the full defaults (but was missing bins/bracketMounts/feeTypes),
// BOMTab seeded only `partHandling`, and VisualAssemblyTab merged no defaults at all —
// so a window enabled in one tab could be invisible in another.

const ALL = ['ce', 'm2c', 'uniquity', 'leyla'];

export const DEFAULT_SYSTEM_WINDOWS = {
  inHouseFinishes: ['ce', 'm2c'], outsourceFinishes: ['ce', 'm2c'],
  prodTypes: [...ALL], uom: [...ALL],
  collections: [...ALL], watchLists: [...ALL],
  vendors: [...ALL], outsourceActions: [...ALL],
  pillowSizes: ['uniquity'], fillTypes: ['uniquity'], flangeStyles: ['uniquity'], stitchTypes: ['uniquity'],
  seamCounts: ['uniquity'], assemblyTypes: [...ALL],
  customers: [...ALL],
  partHandling: [...ALL],
  inventoryTypes: [...ALL],
  projections: [...ALL],
  bins: [...ALL],
  bracketMounts: [...ALL],
  feeTypes: [...ALL]
};

// Build a normalized windowConfig from a raw system/window_config snapshot's data()
// (or null/undefined). Always merges the full defaults so omitted keys stay visible.
export const mergeWindowConfig = (data) => ({
  system: { ...DEFAULT_SYSTEM_WINDOWS, ...((data && data.system) || {}) },
  custom: (data && data.custom) || []
});
