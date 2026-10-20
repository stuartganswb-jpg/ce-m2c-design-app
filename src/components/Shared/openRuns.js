// ── A SECOND RUN OF THE SAME THING IS ASKED ABOUT FIRST (Stuart 2026-10-20: "4 … good") ───────────────────────────────────
// HCUSR15/N25-EA, 2026-10-19: four stock runs of 120 were made from the Sales Snapshot inside thirteen minutes — 8:15, 8:15,
// 8:27, 8:28 — each released, each one's NetSuite work order refused (the item has no bill of materials there), all four on
// the finishing floor. The snapshot had no way to know a run was already open: an app run is not "on order" until NetSuite
// has its work order. So before a stock run is made, the open runs of the same item are found and the person is asked —
// with each run's quantity, when and by whom it was made, where it stands, and whether NetSuite refused its work order.
// Pure; the read is Shared/workOrderCreate.findOpenRuns. Harness: scripts/openRuns.test.mjs.

import { isClosedState, isDoneState } from './orderLifecycle.js';
import { refusalOf } from './nsRefusal.js';

export const OPEN_RUN_HOURS = 24 * 7;
const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The item a work-order record makes. */
export const runItemOf = (h) => U(h && (h.itemCode || h.erpId || h.partErpId || h.stockErpId || h.rootItem));

/** Is this RTG record a run that is still open (not closed, packed, put away, built or deleted)? */
export const isOpenRun = (h) => !!h && !h.deleted && !isClosedState(h) && !isDoneState(h)
    && !['Packed', 'Shelved'].includes(String(h.floorPhase || '')) && !h.rtgDeleted;

/** The open runs of `erp` made in the last `hours` (default a week), newest first. */
export const openRunsOf = (rows = [], { erp, now = Date.now(), hours = OPEN_RUN_HOURS } = {}) => {
    const code = U(erp);
    if (!code) return [];
    return (rows || [])
        .filter(h => runItemOf(h) === code && isOpenRun(h) && now - N(h.createdAt) <= hours * 3600000)
        .sort((a, b) => N(b.createdAt) - N(a.createdAt));
};

const whenOf = (ms) => (ms ? new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
/** One run in words: "120 · Oct 19, 8:15 AM by Eric · on the floor (Setup) · ⛔ NetSuite refused its work order". */
export const openRunLineOf = (h) => [
    `${N(h.qty || h.totalParts) || '?'} pcs`,
    `${whenOf(N(h.createdAt))}${h.createdBy ? ` by ${h.createdBy}` : ''}`,
    h.floorPhase ? `on the floor (${h.floorPhase})` : (h.status === 'Dispatched' ? 'released' : 'parked in RTG'),
    h.nsWoTran ? `NetSuite ${h.nsWoTran}` : (refusalOf(h, 'workorder') ? '⛔ NetSuite refused its work order — it is on the NetSuite-to-fix list' : (h.nsWoQueued ? 'NetSuite WO queued' : '')),
].filter(Boolean).join(' · ');

/** The question asked before another run is made. */
export const openRunsQuestionOf = ({ erp, qty, runs = [] }) => [
    `${U(erp)} already has ${runs.length} open run${runs.length === 1 ? '' : 's'}:`,
    '',
    ...runs.slice(0, 6).map(h => `• ${h.id} — ${openRunLineOf(h)}`),
    ...(runs.length > 6 ? [`…and ${runs.length - 6} more`] : []),
    '',
    `Make ANOTHER run of ${N(qty) || '?'} anyway?`,
    '',
    'OK = make it as well · Cancel = do not make it (a run whose NetSuite work order was refused is put right on the NetSuite-to-fix list, not made again).',
].join('\n');
