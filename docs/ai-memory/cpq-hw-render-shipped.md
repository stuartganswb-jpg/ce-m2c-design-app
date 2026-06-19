---
name: cpq-hw-render-shipped
description: CPQ hardware 3D rendering shipped to prod; main IS the production branch (Vercel)
metadata: 
  node_type: memory
  type: project
  originSessionId: 1e7b552c-c53c-4c1c-97ab-57f189a62061
---

CPQ hardware 3D rendering (FLAT IRON generated flow) shipped to prod 2026-06-15. Latest prod commit `ff0d660` (deployed off `feat/production-packet`, which added: Vision-resume step quantities default to 0 — operators enter counts manually from the on-screen Engineering Specs note; that spec note moved out of the 3D viewport into a horizontal strip in the pricing row; the 3D render is a fixed 440px height; capture-views fits the VISIBLE model only via a hand-built world-space box). Known rough edge shipped as-is per owner: the 📷 Capture Views PNG thumbnails still frame poorly — being superseded by the shop-floor live viewer (see [[cpq-shopfloor-viewer]]).

**`main` IS the production branch** — Vercel deploys `main` → 4cosworkcenter.com. It had drifted ~40 commits behind the active work; deploying = fast-forward `main` to the feature branch and push (`git push origin <branch>:main`). Feature-branch pushes give preview URLs only.

Model (AdminTab generator + CPQTab render): per-POSITION steps — Left/Center/Right "Bracket & Mount" (center `isCenterClone`), each with a Backplate **sub-chooser** scoped to the chosen mount's location; **no global Mount step**. Pole finish rides the Pole Length step via `targetNodes`; rings only texture if the ring part's productType contains RING. Visibility = "shown-wins" over a flat node→bool map. The mesh matcher is **EXACT name + ancestry** (mirrors Node Grouping's `isDescendantOf`) — do NOT reintroduce prefix/sanitized matching, it over-matched name-cousin parts (one backplate lit all). Fasteners (screw/bolt/washer/nut/rivet by name, `\bnut\b` so WALNUT is safe) are never rendered — BOM-only. The center-bracket **clone** (qty>1) must use the SAME exact-name+ancestry matcher (a sanitized/prefix matcher over-reached, scattering the matched set so clones never centered); it spaces along the **pole step's geometry** (the rail — the pole is ribbed/many segments, so a "longest single mesh" rail fails), anchored on the main bracket mesh, with fasteners excluded. TEMP "Show all"/"Highlight" debug toggles still live in the 3D toolbar.

**Why:** preview-first then deliberate prod deploy — see [[no-regressions-ask-first]]; architecture in [[cpq-vision-architecture]].
**How to apply:** generator changes need a flow regenerate on the deployed build; flows live in shared Firestore so preview + prod see the same `cpq_flows` docs.
