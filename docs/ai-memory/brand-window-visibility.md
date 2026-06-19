---
name: brand-window-visibility
description: Dictionary items are global; per-brand visibility gated by system/window_config; one source of truth in systemWindows.js
metadata: 
  node_type: memory
  type: project
  originSessionId: 16514794-a0fe-4468-ad5a-b6fab28bf535
---

Dictionary categories (product types, part handling, collections, UOM, etc.) are **global** in `system/master_lists` — shared across all brands. What's per-brand is only *visibility*: whether a brand's UI exposes a given dictionary "window," gated by `system/window_config.system[<key>]` (an array of brand ids: ce/m2c/uniquity/leyla). A control renders iff `windowConfig.system[key].includes(activeBrand)`.

Edited via the **Manage Brand Windows** modal: Mass Update tab → "Expand System Data & Master Dictionaries" → Manage Brand Windows. Before 2026-06-14 that button was dead (set state nothing rendered) — modal built then.

**Single source of truth:** `src/components/HQ/systemWindows.js` (`DEFAULT_SYSTEM_WINDOWS` + `mergeWindowConfig`). All four consumers — LibraryTab, LibraryMassUpdateTab, BOMTab, VisualAssemblyTab — load through it for both initial state and the onSnapshot loader. Previously each merged defaults differently (BOMTab seeded only partHandling, VisualAssemblyTab merged none, LibraryTab's copy lacked bins/bracketMounts/feeTypes) → the SAME config showed a window in one tab but hid it in another. That was the "checked but not showing" bug class. Fixed + shipped to prod (main → 40e1b9c) on 2026-06-14.

**Why it matters for the FI work:** product-type categories are the planned 1:1 BOM-cluster drivers (part tagged CEILING → ceiling cluster), so they must be enabled for M2C's prodTypes window. See [[cluster-region-tags]] and [[flat-iron-3flow-build]].
