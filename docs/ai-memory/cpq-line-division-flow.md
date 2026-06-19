---
name: cpq-line-division-flow
description: How custom dimensions/quantities are generated (Vision) and how a CPQ line is tagged small vs custom
metadata: 
  node_type: memory
  type: project
  originSessionId: 030aee85-078f-43db-b9dd-2f6e27fc2944
---

The small-vs-custom division flag for an order line is `step.partHandling` on CPQ flow steps (`cpq_flows/{id}.steps[]`), authored in AdminTab's flow builder. Values come from `master_lists.partHandling` (default `['Small Parts','Custom']`); part-level `manufacturingSpecs.partHandling` uses the same vocabulary. `routingType` is NOT this flag — it holds productType-like categories.

Custom dimensions/quantities are NOT entered in CPQ. They are generated upstream in the Vision tabs (Client Vision → VisionHardware/Pillow/Lighting), saved to `cpq_drafts.specs.engineeringNotes` (poleO2O, pole1/2/3, recRings, qtyBrackets, qtyFinials, qtySplices, miters/bends) + `spatialData`. CPQTab.handleResumeDraft maps those onto steps by matching step.title keywords ("bracket"/"ring"/"finial"/"splice") → stepQuantities, and calculatorTemplate steps → dimensionInputs. The CPQ only applies generated qty/dims to the correct parts and prices them.

Implemented for WORK_ORDER_CONTRACT §7: CPQTab now bakes `partHandling`, `partId`, `cutLength`, `dimensions` onto each priced line (build loop + cart→cpqData.breakdown merge); pure classifier in [[shared-line-classifier]]; AdminTab handleAutoSyncBOM now defaults step.partHandling from the linked part (was '').

See [[work-order-contract-impl]].
