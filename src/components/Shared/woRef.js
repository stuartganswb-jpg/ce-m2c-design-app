// ONE IDENTITY STAMP (Stuart 2026-08-29: "let's make sure these cards and their stamps are all
// honest with RTG / work order"). Before this, five hand-written fallback chains disagreed across
// the floor screens — the SAME order was called by its NetSuite number on a card and by its app
// id in the confirm dialog the operator was OK-ing, the WMS stock card showed no WO identity at
// all, and RTG never rendered the human-readable woDisplayId (Eric's standing complaint).
//
// The rule: the NETSUITE number leads wherever it exists; the human-readable app display id is
// next; raw app ids are the last resort. Every card, dialog, log line and label imports THIS.

export const woRefOf = (o) => (o && (o.nsWoTran || o.woDisplayId || o.woNum || o.displayId || o.id)) || '';

// The secondary line under a header: the app id, only when it adds information.
export const appIdIfDifferent = (o) => {
    const ref = woRefOf(o);
    return o && o.id && o.id !== ref ? o.id : '';
};

// A DEMAND (convert/plating/rod-cut) is honest only when it names the work order it serves —
// its own invented number (CVW-…/PLW-…) exists nowhere else. Pass the demand and, when the host
// has it loaded, the resolved parent doc for the real NetSuite-first reference.
export const demandRefOf = (demand, parentDoc) => {
    const own = (demand && (demand.woNum || demand.id)) || '';
    const parent = parentDoc ? woRefOf(parentDoc) : (demand && (demand.finWoErpId || demand.finWoId)) || '';
    return parent ? `${own} · for ${parent}` : own;
};
