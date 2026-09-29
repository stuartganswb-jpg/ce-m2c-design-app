// WHICH ROUTING A SHOP ORDER IS MADE ON (Stuart 2026-09-29: "two items there that we have already made
// but are stuck there as they are looking for a routing but there is a routing").
//
// Routings are filed under the library record's id (partId "CE-ASM-64044") and carry the item code as
// their displayName ("H2-138-TB3"). A milling order names its item by CODE (itemCode / partNum
// "H2-138-TB3") and carries the description in `item` ("Upper Slotted Arm for 1-3/8" Traverse…"). The
// milling tab's accept compared displayName with the description and partId with the code — never
// displayName with the code — so H2-138-TB3 and H2-138-TB4 (962 each, 8/31) found nothing and Accept said
// "No routing exists". The checks it always made come first, unchanged; then the code against either
// field, ignoring case. Two routings for one code are never guessed between.
//
// Pure. The milling tab stores the routing's partId as the job's partNum — the key every later routing
// lookup (backlog, tracker, schedule, export) already reads.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

export function routingForOrder(routings, order) {
    const list = Array.isArray(routings) ? routings.filter(Boolean) : [];
    if (!order || !list.length) return null;
    const legacy = list.find(r => r.displayName === order.item || r.partId === order.item || (order.partNum && r.partId === order.partNum));
    if (legacy) return legacy;
    const codes = [...new Set([order.itemCode, order.partNum, order.erpId].map(U).filter(Boolean))];
    if (!codes.length) return null;
    const hits = list.filter(r => codes.includes(U(r.partId)) || codes.includes(U(r.displayName)));
    return hits.length === 1 ? hits[0] : null;
}
