// Shared/sheetPins.js — the parts-list lines a Control Sheet push writes for an assembly, and the one rule
// about them that the NetSuite item sync has to know. A leaf: no imports, so the sync can read it without
// taking the sheet's rules with it. Pure — scripts/controlSheet.test.mjs.
//
// WHY THESE LINES ARE MARKED. An assembly pushed from tab 1.2 has no NetSuite item yet, so its parts list is
// written by the app (assembly_pins, one line per part, in the linked shape Visual Assembly and 1.6 write).
// When NetSuite later comes to know the item and sends its OWN bill of materials, the 11.1 sync writes one
// line per component (PIN-<assembly>-<NetSuite id>) and, by design, leaves hand-made lines alone — so without
// a rule the assembly would carry every part TWICE and a work order, which adds the lines up, would pull
// double. Stuart 2026-10-07: "bring them back into the app and you would need to align not duplicate".
//
// THE RULE: a line the sheet wrote STANDS IN for NetSuite's until NetSuite sends a real parts list for that
// assembly, and steps aside in that same sync — NetSuite owns an assembly's parts list once it has one. Until
// then (no NetSuite item, or one with no bill of materials yet) the sheet's lines are the parts list.

export const SHEET_PIN_MARK = 'fromControlSheet';

// One line per part of an assembly, findable again: pushing the same assembly twice cannot double its own lines.
export const sheetPinId = (assemblyDocId, componentDocId) => `PIN-${assemblyDocId}-CS-${componentDocId}`;

// The line itself. `partId` is the part's LIBRARY RECORD id and `legacyErpId` its item # — the two names every
// reader of a parts list resolves a part by (BOM Engine, the Library's file cabinet, finishedGoodsRun).
export const sheetPinFor = ({ assemblyId, component, qty, origin, user, nowIso }) => {
    const id = sheetPinId(assemblyId, component.docId);
    return {
        id, assemblyId,
        partId: component.docId, partName: String(component.name || component.code || ''), legacyErpId: String(component.code || '').toUpperCase(),
        defaultQty: qty, isExistingLibraryPart: true, status: 'SPECS_LOCKED',
        [SHEET_PIN_MARK]: true,
        controlSheet: { projectId: String((origin && origin.projectId) || ''), sectionId: String((origin && origin.sectionId) || ''), lineId: String((origin && origin.lineId) || '') },
        author: String(user || ''), createdAt: nowIso,
    };
};

// Does this parts-list line step aside when NetSuite sends the assembly's own bill of materials?
export const yieldsToNetSuiteBom = (pin) => !!pin && pin[SHEET_PIN_MARK] === true;
