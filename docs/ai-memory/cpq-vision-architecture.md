---
name: cpq-vision-architecture
description: "Division of labor between the Vision Hardware tool and the CPQ configurator, and the one-flow-per-projection rule"
metadata: 
  node_type: memory
  type: project
  originSessionId: 030aee85-078f-43db-b9dd-2f6e27fc2944
---

Hard rule from the user (2026-06): **Vision Hardware = fabrication only** (bends, miters, cut length, splice location); **CPQ = item + finish selection** (which rod/backplate/bracket/ring and their finishes). CPQ selections must NEVER change fabrication.

Because the **bracket projection drives all the fabrication**, there is **one CPQ flow per bracket projection**. Each flow therefore needs its own:
- **Fabrication Preset** (`fabEndStyle` e.g. 'RETURN_BEND' for FR, + `fabProjection`) — stored on the cpq_flows doc, set in AdminTab flow settings. VisionHardware reads it on flow load and it is authoritative: the bracket selection can no longer override projection (only physical bracketW/bracketThickness still come from the part). See [[work-order-contract-impl]].
- **NetSuite rollup item** (`nsRollupItemId`) — see [[cpq-line-division-flow]].

Compound bracket step: a CPQ Dropdown step can carry `finishDataSource` + `finishTargetNodes` to render a second "Finish" dropdown (one step = pick bracket style via geometryMap visibility toggle + pick its finish). This lives on the CPQ side (not Vision), since items/finishes are chosen in CPQ. Finish stored at dynamicConfigParams['<stepId>__finish'].

Vision-computed engineeringNotes (qtyBends/qtySplices/qtyMiters/shape/poleO2O) + the shop drawing now flow to the shop_custom_orders doc (fabNotes/fabMethod/imageUrl) and the fin WO, so the shop knows bend-vs-splice and sees placement.
