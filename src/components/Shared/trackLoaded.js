// ── LOADED ONTO THE TRACK — the leaf facts every reader of the traverse station's rule needs (Stuart 2026-10-07) ──
// Shared/traverseStation holds the rule and its reasons; these few predicates live apart, importing nothing, so the
// pick-line reader, the order-status reader and the split can ask them without importing each other in a ring.
//
// WHICH PARTS: the ITEM says so — a tick in the Library ("Loaded onto the track", customData.trackLoaded). Nothing is
// read from a name or a code, and until an item is ticked nothing changes anywhere.

/** Is this ITEM loaded onto the track at the traverse station? The Library's tick — the only source. */
export const isTrackLoadedPart = (part) => !!(part && part.manufacturingSpecs && part.manufacturingSpecs.customData && part.manufacturingSpecs.customData.trackLoaded === true);
/** A document line stamped at the split (a CPQ parts-list line): the station picks it, after finishing. */
export const isTrackLoadedLine = (line) => !!(line && line.trackLoaded === true);
/**
 * Does the STATION pick this document line — after finishing — rather than the warehouse before it? Only a track
 * part that comes off the shelf as it is (a stocked or plated pick, a part that wears nothing). One that is painted
 * here must be pulled BEFORE finishing like any other part; it reaches the station off the finishing floor.
 */
export const isStationPickLine = (line) => isTrackLoadedLine(line) && (line.pickOnly === true || line.noFinish === true);
/** The stamp a parts-list line carries: {} or { trackLoaded: true }. */
export const trackStampOf = (part) => (isTrackLoadedPart(part) ? { trackLoaded: true } : {});

// A finishing document of an order with track parts waits on the station; the station's confirmation lifts it.
export const TRAVERSE_GATE = Object.freeze({ WAITING: 'WAITING', LOADED: 'LOADED' });
/** Why a finishing document may not be packed yet as far as the traverse station goes, or ''. */
export const traverseWaitOf = (doc) => (doc && doc.traverseGate === TRAVERSE_GATE.WAITING
    ? 'traverse station: its components are not loaded onto the tracks yet' : '');
