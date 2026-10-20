// ── 12.7 LAUNCH — the day's orders, line by line, and what to do with each (S7, 2026-10-20) ─────────
//
// Stuart: "we need a more focused screen for all the brands that just address launching the orders … list the daily
// orders and click each one open and decide what to do, release partial lines … orders that are entirely in stock can
// go straight to auto release just like Classical. only difference the throws for uniquity never hit the floor they can
// go straight to be picked, packed, shipped as long as they are paid. the orders that have some pillows with throws we
// need to look at to decide whether to ship the throws ahead or wait for the pillows … we could use this screen even
// for Classical when we want to release partial orders as well." Decisions: tab 12.7; HOLD as the default for a mixed
// order; a second shipment per order is fine.
//
// THE RULE, pure. Every line of a stocked (Order Entry / counter) sales order is one KIND:
//   SHELF        picked off the shelf (a throw, a stocked pillow, any stocked item)
//   SEW          made at Stitch & Sew (a pillow line — madeToOrder SEW / pillow)
//   FINISH       made on the finishing floor (a to-be-finished line)
//   FLOOR        made on a floor though it wears nothing (a cut length, a WO line)
//   PLACEHOLDER  a quick-add still to identify (the NetSuite order waits on it)
//   FEE / HIDDEN a fee, a kit face, a $0 making — never picked, never decided
// and one LAUNCH STATE for a SHELF line:
//   AUTO      no decision needed — the order has no SEW line, so the warehouse picks it as it always has
//   HELD      waiting on the office (a mixed order's shelf lines, by default) or held by hand
//   RELEASED  released by hand — the warehouse may pick it now (Ship ahead)
// The decision lives on the record: `launch: { mode: 'HOLD' | 'SHIP_AHEAD' | 'PARTIAL', lines: { [idx]: { state, by, at,
// note } }, decidedAt, decidedBy }`. No marker = today's behaviour for every order that has no SEW line.
//
// The pick side (Shared/pickLines.pickableLinesOf) reads `lineIsLaunchHeld` — a SHELF line that is HELD is not picked
// until released. A mixed order with no decision holds its shelf lines; an order with FINISH + SHELF but no SEW line is
// NOT held by default (Classical keeps picking stock while the floor works, exactly as today) — the office holds a
// Classical line by hand on 12.7 when it wants a partial.

import { isPlaceholderLine } from './placeholderLine.js';
import { oeIsTbf } from './oeLines.js';
import { soLineIsFee, soLineIsShelfPick } from './pickLines.js';

const str = (v) => String(v == null ? '' : v).trim();
const up = (v) => str(v).toUpperCase();

export const LAUNCH_KINDS = ['SHELF', 'SEW', 'FINISH', 'FLOOR', 'PLACEHOLDER', 'FEE'];
export const LAUNCH_STATES = ['AUTO', 'HELD', 'RELEASED'];
export const LAUNCH_MODES = { HOLD: 'HOLD', SHIP_AHEAD: 'SHIP_AHEAD', PARTIAL: 'PARTIAL' };

export const isSewLine = (l) => !!l && (up(l.madeToOrder) === 'SEW' || !!l.pillow);

/** One line's kind. */
export function launchLineKindOf(so, l, idx) {
    if (!l) return 'FEE';
    if (isPlaceholderLine(l)) return 'PLACEHOLDER';
    if (l.inKit || l.ooakPart || l.hidden) return 'FEE';
    if (soLineIsFee(so, l, idx)) return 'FEE';
    if (isSewLine(l)) return 'SEW';
    if (oeIsTbf(l)) return 'FINISH';
    if (!soLineIsShelfPick(so, l, idx)) return 'FLOOR';
    return 'SHELF';
}

/** The order is MIXED when a SEW line and a SHELF line share it — the case the office decides. */
export const launchIsMixed = (so) => {
    const kinds = ((so && so.lines) || []).map((l, i) => launchLineKindOf(so, l, i));
    return kinds.includes('SEW') && kinds.includes('SHELF');
};

/** A SHELF line's launch state. */
export function launchLineStateOf(so, idx) {
    const d = so && so.launch && so.launch.lines && so.launch.lines[idx];
    if (d && (d.state === 'RELEASED' || d.state === 'HELD')) return d.state;
    if (so && so.launch && so.launch.mode === LAUNCH_MODES.SHIP_AHEAD) return 'RELEASED';
    return launchIsMixed(so) ? 'HELD' : 'AUTO';
}

/** The pick side's one question: is this line held back from the shelf pick? */
export const lineIsLaunchHeld = (so, l, idx) => launchLineKindOf(so, l, idx) === 'SHELF' && launchLineStateOf(so, idx) === 'HELD';

/**
 * The order on the board.
 *   docsOf(so) → the order's work orders / documents (hq_work_orders with soAppId) — a SEW / FINISH line with one is STARTED
 * → { id, number, customer, brand, kinds: {SHELF,SEW,…counts}, mixed, lines: [{ idx, line, kind, state, started, doc }],
 *    shelf: { total, held, released, auto }, suggestion, backorders, placeholders, nsAccepted, closed }
 */
export function launchOrderOf(so, { docs = [], startedOf = null } = {}) {
    const lines = ((so && so.lines) || []).map((l, idx) => {
        const kind = launchLineKindOf(so, l, idx);
        const made = kind === 'SEW' || kind === 'FINISH' || kind === 'FLOOR';
        // STARTED = the line has a live document: the caller's coverage rule (RTG's oeCoverageOf) when given, else a document
        // naming the line by index
        const doc = made ? ((docs || []).find(d => d && !d.deleted && (d.lineIdx === idx || (Array.isArray(d.lineIdxs) && d.lineIdxs.includes(idx)) || (d.soLineIdx === idx))) || null) : null;
        const started = made && (typeof startedOf === 'function' ? !!startedOf(so, l, idx) : !!doc);
        return { idx, line: l, kind, state: kind === 'SHELF' ? launchLineStateOf(so, idx) : '', started, doc };
    });
    const kinds = {};
    LAUNCH_KINDS.forEach(k => { kinds[k] = lines.filter(x => x.kind === k).length; });
    const shelfLines = lines.filter(x => x.kind === 'SHELF');
    const shelf = { total: shelfLines.length, held: shelfLines.filter(x => x.state === 'HELD').length, released: shelfLines.filter(x => x.state === 'RELEASED').length, auto: shelfLines.filter(x => x.state === 'AUTO').length };
    const mixed = kinds.SEW > 0 && kinds.SHELF > 0;
    const st = up(so && (so.status || so.pickStatus));
    const closed = st === 'CLOSED' || st === 'CANCELLED' || !!(so && (so.closed || so.currentPhase === 'Closed'));
    const nsAccepted = !!(so && so.nsInternalId);
    const placeholders = kinds.PLACEHOLDER;
    const makes = lines.filter(x => (x.kind === 'SEW' || x.kind === 'FINISH') && !x.started).length;
    let suggestion = 'AUTO';
    if (closed) suggestion = 'CLOSED';
    else if (placeholders) suggestion = 'IDENTIFY';
    else if (!nsAccepted) suggestion = 'WAIT_NS';
    else if (mixed && shelf.held > 0 && !(so.launch && so.launch.decidedAt)) suggestion = 'DECIDE';
    else if (makes > 0) suggestion = 'START';
    else if (shelf.held > 0) suggestion = 'HELD';
    return {
        id: so.id, number: so.soId || so.id, customer: str(so.customer), brand: str(so.brand), createdAt: Number(so.createdAt) || Number(so.nsQueuedAt) || 0,
        kinds, mixed, lines, shelf, suggestion, closed, nsAccepted,
        backorders: Array.isArray(so.backorderLines) ? so.backorderLines : [], placeholders,
        decided: !!(so.launch && so.launch.decidedAt), mode: str(so.launch && so.launch.mode),
    };
}

/** The patch for a decision: `lineIdxs` to `state`, under `mode`; merged over what was decided before. */
export function launchPatchOf(so, { lineIdxs = [], state = 'RELEASED', mode = '', by = '', at = 0, note = '' } = {}) {
    const now = at || Date.now();
    const prev = (so && so.launch) || {};
    const lines = { ...(prev.lines || {}) };
    (lineIdxs || []).forEach(i => { lines[i] = { state, by: str(by), at: now, ...(str(note) ? { note: str(note) } : {}) }; });
    return { launch: { ...prev, mode: str(mode) || str(prev.mode) || LAUNCH_MODES.PARTIAL, lines, decidedAt: now, decidedBy: str(by) } };
}

/** Ship ahead = every SHELF line released now; Hold = every SHELF line held until the office says. */
export const shipAheadPatchOf = (so, { by = '', at = 0 } = {}) => launchPatchOf(so, { lineIdxs: ((so && so.lines) || []).map((l, i) => (launchLineKindOf(so, l, i) === 'SHELF' ? i : -1)).filter(i => i >= 0), state: 'RELEASED', mode: LAUNCH_MODES.SHIP_AHEAD, by, at, note: 'ship ahead' });
export const holdAllPatchOf = (so, { by = '', at = 0, note = '' } = {}) => launchPatchOf(so, { lineIdxs: ((so && so.lines) || []).map((l, i) => (launchLineKindOf(so, l, i) === 'SHELF' ? i : -1)).filter(i => i >= 0), state: 'HELD', mode: LAUNCH_MODES.HOLD, by, at, note: note || 'hold until the made lines are ready' });

/** The board's rows: open orders of the brand within the window, newest first. */
export const launchRowsOf = (orders = [], { brand = '', sinceMs = 0, docsOf = () => [], startedOf = null } = {}) => (orders || [])
    .filter(so => so && (!brand || str(so.brand) === brand) && (!sinceMs || (Number(so.createdAt) || Number(so.nsQueuedAt) || 0) >= sinceMs))
    .map(so => launchOrderOf(so, { docs: docsOf(so), startedOf }))
    .filter(r => !r.closed)
    .sort((a, b) => b.createdAt - a.createdAt);

export const SUGGESTION_WORDS = {
    AUTO: 'on the shelf — picked as it is',
    DECIDE: 'pillows + shelf lines — decide: ship the shelf lines ahead, or hold them until the pillows are sewn',
    START: 'lines to make — start them',
    HELD: 'shelf lines held — release when ready',
    IDENTIFY: 'a quick-add to identify first (RTG or the CRM)',
    WAIT_NS: 'waiting for NetSuite to accept the order',
    CLOSED: 'closed',
};
