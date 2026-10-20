// ── NETSUITE TO FIX TODAY — the floor keeps moving; NetSuite is put right before the day ends (Stuart 2026-10-20) ─────────
// "i want to come up with a way that we do not need to stop the floor immediately so things can keep moving when it is only
//  a netsuite acceptance issue, and detail these so they can be fixed before days end but keep the floor moving" ·
// "eric will own list".
//
// The ten days to 2026-10-20: 353 NetSuite writes, 35 refused — every one NetSuite saying no to the record (a bin not set up
// for the item, an inactive item id, an assembly with no bill of materials, a closed work order, receipt lines that no
// longer match the PO), never an outage. Some of them stopped the floor (a rod cut was held seven hours); the rest let it
// carry on and told nobody — 11.1 shows the newest 80 entries and nothing ever said a refusal had been dealt with.
//
// This is the ONE reading of what is still owed to NetSuite, for 11.1 and the RTG and WMS chips (the 3 pm OS Comms note is
// its twin in functions/nsFix.js — scripts/nsFixServer.test.mjs holds the two to the same rows):
//   · every queued write NetSuite REFUSED (ns_outbox FAILED) that nobody has dealt with (`fix` unset);
//   · every queued write STUCK — still retrying or waiting more than half an hour;
//   · every direct NetSuite call that failed (hq_logs audit NS_DIRECT, ok false) that nobody has dealt with (`nsFix` unset).
// Each says, in words, what NetSuite refused and what puts it right (explainNsError — written from the real refusals), and
// the three ways it leaves the list: ↻ Re-send (the queue's own entry, with the known repairs), ✓ Done in NetSuite (the
// transaction's number, checked to exist) or ✕ Not needed (a reason). A write NetSuite later accepts in another entry leaves
// by itself (the worker marks it POSTED_LATER). The window is fourteen days; what is older is counted, not listed.
// Pure. Harness: scripts/nsFixList.test.mjs.

import { msOf, nsTypeOf, itemQtyOf } from './auditLog.js';

export const NS_FIX_OWNER = 'Eric';
export const FIX_WINDOW_DAYS = 14;
export const STUCK_MINUTES = 30;
export const FIX_HOW = Object.freeze({ DONE_IN_NS: 'DONE_IN_NS', NOT_NEEDED: 'NOT_NEEDED', POSTED_LATER: 'POSTED_LATER' });
export const FIX_HOW_WORDS = Object.freeze({ DONE_IN_NS: 'done in NetSuite', NOT_NEEDED: 'not needed', POSTED_LATER: 'NetSuite took it in a later entry' });
const DAY = 86400000;
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => String(v == null ? '' : v);

// ── the shop's day (High Point NC — the queue's own memo clock, Shared/nsOutbox) ──────────────────────────────────────────
export const shopDayStartOf = (now = Date.now()) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(now));
    const get = (t) => N((parts.find(p => p.type === t) || {}).value);
    return now - (((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000) - (now % 1000);
};

// ── what NetSuite said ────────────────────────────────────────────────────────────────────────────────────────────────────
/** NetSuite's own words out of a stored error (every `detail` in its JSON), else the text as it is. */
export const nsDetailOf = (raw) => {
    const s = str(raw);
    const m = [...s.matchAll(/"detail"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(x => x[1].replace(/\\"/g, '"').replace(/^Error while accessing a resource\.\s*/i, ''));
    return (m.length ? m.join(' · ') : s.replace(/^HTTP \d+:\s*/, '').replace(/^Error while accessing a resource\.\s*/i, '')).trim();
};

// Written from the refusals of 2026-10-10 … 10-20. Each: what it means in words, and what puts it right.
const RULES = [
    { re: /Invalid binnumber reference key ([^.]+?)\./i,
      words: (m, c) => `NetSuite has no bin ${m[1]} for ${c.item || 'this item'}`,
      fix: (m) => `In NetSuite, set bin ${m[1]} up for the item (or use the bin it really sits in), then ↻ Re-send.` },
    { re: /Invalid Field Value (\d+) for the following field: subsidiary/i,
      words: (m) => `The customer is not in this division's subsidiary (#${m[1]})`,
      fix: () => 'Enter the order again on the customer of the right division (or add the subsidiary to the customer in NetSuite) — mark this one Not needed once the new one posts.' },
    { re: /Invalid Field Value (\d+) for the following field: item/i,
      words: (m, c) => `NetSuite will not take item #${m[1]}${c.item ? ` (${c.item})` : ''} — it is inactive there, or the app holds the wrong id`,
      fix: () => 'Check the item in NetSuite; if its id changed, sync it (11.1 → Sync Master Library). Then ↻ Re-send, or do it by hand in NetSuite and mark Done.' },
    { re: /You only have (\d+) available/i,
      words: (m) => `NetSuite shows only ${m[1]} there`,
      fix: () => 'Count the bin and correct NetSuite (or move the stock into that bin), then ↻ Re-send.' },
    { re: /must enter at least one line item/i,
      words: (m, c) => (c.kind === 'workorder' ? `${c.item || 'The assembly'} has no bill of materials in NetSuite` : 'NetSuite received no lines'),
      fix: (m, c) => (c.kind === 'workorder'
          ? 'Give the assembly its bill of materials in NetSuite (its other finishes have one), then ↻ Re-send. The run is already on the floor — do not make another one.'
          : 'Open the record in NetSuite and check what it holds; do it by hand there and mark Done.') },
    { re: /invalid work order (\d+) or the order is already closed/i,
      words: (m) => `NetSuite work order #${m[1]} is already closed`,
      fix: () => 'If it was built by hand in NetSuite, mark Done with that build #. If it was closed by mistake, reopen it there and ↻ Re-send.' },
    { re: /invalid sublist or line item operation/i,
      words: (m, c) => `The lines no longer match the NetSuite ${c.type ? c.type.toLowerCase() : 'record'}`,
      fix: () => 'Open it in NetSuite — a line was changed, closed or already received. Do it by hand there and mark Done with its #.' },
    { re: /cannot create an inventory detail for this item/i,
      words: () => 'NetSuite does not keep bins for that item',
      fix: () => 'Do it by hand in NetSuite without a bin and mark Done — or turn bins on for the item there, then ↻ Re-send.' },
    { re: /total inventory detail quantity must be (\d+)/i,
      words: (m) => `The bins add up to a different quantity than the line (NetSuite wants ${m[1]})`,
      fix: () => 'Do it by hand in NetSuite with the right bins and mark Done — and tell the app session, the app built the bins wrong.' },
    { re: /reconfigure the inventory detail record/i,
      words: () => 'The app sent the bin detail in a shape NetSuite refuses (the app\'s mistake)',
      fix: () => 'Make the change by hand in NetSuite and mark Done — and tell the app session.' },
    { re: /subsidiary restrictions on this record are incompatible/i,
      words: () => 'The item\'s subsidiaries do not match its class\'s',
      fix: () => 'In NetSuite give the item the same subsidiaries as its class (or choose another class), then do it again.' },
    { re: /more than the maximum number\s*\(\s*(\d+)\s*\)\s*of characters/i,
      words: (m) => `A text was longer than NetSuite allows (${m[1]} characters)`,
      fix: () => 'Tell the app session; do it by hand in NetSuite meanwhile and mark Done.' },
    { re: /^Not sent: the entry it follows/i,
      words: () => 'It waits on another write NetSuite refused',
      fix: () => 'Put that one right first — its ↻ Re-send sends this one after it.' },
    { re: /HTTP (429|5\d\d)|ECONN|ETIMEDOUT|socket hang up|fetch failed/i,
      words: () => 'NetSuite did not answer',
      fix: () => '↻ Re-send — nothing in the record is wrong.' },
];

/** → { words, fix, detail } for one refusal. `ctx` = { kind, type, item, label }. */
export const explainNsError = (raw, ctx = {}) => {
    const detail = nsDetailOf(raw);
    for (const r of RULES) {
        const m = detail.match(r.re) || str(raw).match(r.re);
        if (m) return { words: r.words(m, ctx), fix: r.fix(m, ctx), detail };
    }
    return { words: detail.slice(0, 220) || 'NetSuite refused it', fix: 'Read NetSuite\'s words, put the record right in NetSuite, then ↻ Re-send — or do it by hand there and mark Done.', detail };
};

// ── the repairs a re-send carries (were two copies — 11.1 and RTG's Transmit Log) ─────────────────────────────────────────
// workorder creation must use `assemblyItem`; a build's receive bin must be ONE bin (the library home-bin field is a
// comma-joined list); a non-WIP work order completes by the WO-linked assemblyBuild, never workordercompletion.
export const healRetryOf = (o) => {
    const p = o && o.payload ? JSON.parse(JSON.stringify(o.payload)) : {};
    if (o && o.kind === 'workorder' && p.item && !p.assemblyItem) { p.assemblyItem = p.item; delete p.item; }
    if (o && o.kind === 'workordercompletion' && p.inventoryDetail) {
        const q0 = p.inventoryDetail.quantity;
        const raw = str(p.inventoryDetail && p.inventoryDetail.inventoryAssignment && p.inventoryDetail.inventoryAssignment.items && p.inventoryDetail.inventoryAssignment.items[0] && p.inventoryDetail.inventoryAssignment.items[0].binNumber && p.inventoryDetail.inventoryAssignment.items[0].binNumber.refName);
        const first = raw.split(',')[0].trim().toUpperCase();
        if (!first || first === 'UNASSIGNED') delete p.inventoryDetail;
        else p.inventoryDetail = { quantity: q0, inventoryAssignment: { items: [{ binNumber: { refName: first }, quantity: q0 }] } };
    }
    return { payload: p, targetUrl: str(o && o.targetUrl).replace('/!transform/workordercompletion', '/!transform/assemblyBuild') };
};

/**
 * ↻ Re-send: the entry back to PENDING with the repairs. Attempts are KEPT, so the worker first looks for an already-posted
 * copy (its memo marker) — pressing it twice can never post twice. What NetSuite said last is kept as `lastErrorBefore`.
 */
export const resendPatchOf = (o, { by = '', now = Date.now(), writeBack } = {}) => ({
    ...healRetryOf(o), status: 'PENDING', lastError: null, lastErrorBefore: (o && o.lastError) || null,
    nextAttemptAt: now, requeuedAt: now, requeuedBy: by || '', fix: null,
    ...(writeBack !== undefined ? { writeBack } : {}),
});

// A RE-SENT WRITE NEVER ROLLS A RECORD BACK (2026-10-20). An order NetSuite refused keeps moving on the floor — picked,
// packed — while it waits; its queued write still carries the status it was to set on acceptance (an Order Entry order's
// NS_QUEUED → 'Pending'). Re-sent once the order has moved on, that patch would put a picked order back to "to pick". So a
// writeBack's `status` is kept only while its record still waits on NetSuite.
export const NS_WAITING_STATUSES = Object.freeze(['NS_QUEUED', 'HELD_PLACEHOLDER', 'QUEUED']);
/** The writeBack to re-send with. `currentOf(collection, docId)` → the record as it is now (or null/undefined if unread). */
export const resendWriteBackOf = (o, currentOf = () => undefined) => {
    const wbs = Array.isArray(o && o.writeBack) ? o.writeBack : (o && o.writeBack ? [o.writeBack] : null);
    if (!wbs) return o ? o.writeBack || null : null;
    const out = wbs.map(wb => {
        if (!wb || !wb.patch || !('status' in wb.patch)) return wb;
        const cur = currentOf(wb.collection, wb.docId);
        if (!cur || NS_WAITING_STATUSES.includes(str(cur.status))) return wb;
        const { status, ...rest } = wb.patch;
        return { ...wb, patch: rest, statusKept: str(cur.status) };
    });
    return Array.isArray(o.writeBack) ? out : out[0];
};

/** Entries that failed only because they wait on this one (a bin move behind a receipt) — they go back to waiting with it. */
export const waitingBehindOf = (o, entries = []) => (entries || []).filter(e => e && o && e.afterId === o.id && e.status === 'FAILED' && /^Not sent: the entry it follows/i.test(str(e.lastError)));
export const rewaitPatchOf = ({ by = '', now = Date.now() } = {}) => ({ status: 'WAITING', lastError: null, requeuedAt: now, requeuedBy: by || '', fix: null });

/** How a row leaves the list by hand. */
export const fixMarkOf = ({ how, by = '', why = '', nsRef = null, now = Date.now() }) => ({ how, by: by || '', why: str(why).trim(), nsRef: nsRef || null, at: now });

/** The SuiteQL that finds a transaction by its number (IA27606, ASSYB10633 …) or internal id — "Done in NetSuite" checks it exists. */
export const tranLookupSql = (ref) => {
    const r = str(ref).trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!r) return '';
    return /^\d+$/.test(r)
        ? `SELECT id, tranid, type, BUILTIN.DF(status) AS st, trandate FROM transaction WHERE id = ${r} OR UPPER(tranid) = '${r}'`
        : `SELECT id, tranid, type, BUILTIN.DF(status) AS st, trandate FROM transaction WHERE UPPER(tranid) = '${r}'`;
};

// ── the rows ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const LIVE = ['PENDING', 'PROCESSING', 'WAITING'];
/** Is this queued write still owed — refused and not dealt with, or stuck? → 'REFUSED' | 'STUCK' | '' */
export const queueStateOf = (e, { now = Date.now() } = {}) => {
    if (!e) return '';
    const st = str(e.status);
    if (st === 'FAILED') return e.fix ? '' : 'REFUSED';
    if (!LIVE.includes(st)) return '';
    const age = now - (N(e.createdAt) || now);
    if (st === 'PROCESSING') return now - (N(e.leasedAt) || now) > 10 * 60000 ? 'STUCK' : '';
    if (st === 'WAITING') return age > STUCK_MINUTES * 60000 ? 'STUCK' : '';
    return N(e.attempts) > 0 && age > STUCK_MINUTES * 60000 ? 'STUCK' : '';
};
/** Is this activity-log line a direct NetSuite call that failed and is not dealt with? */
export const directOpenOf = (l) => !!l && !!l.audit && l.audit.kind === 'NS_DIRECT' && l.audit.ok === false && !l.nsFix;

const actionOf = (msg) => { const s = str(msg); const i = s.indexOf(' — '); return (i >= 0 ? s.slice(i + 3) : s).trim(); };

/** One queued write's row. */
export const rowFromQueue = (e, { now = Date.now(), dayStart = shopDayStartOf(now), entries = [] } = {}) => {
    const state = queueStateOf(e, { now });
    const type = nsTypeOf(e.kind, e.targetUrl);
    const { item, qty } = itemQtyOf(e.label, e.payload);
    const stuckWhy = state === 'STUCK' ? (e.status === 'WAITING' ? `waiting ${Math.round((now - N(e.createdAt)) / 60000)} min on the entry it follows` : `still ${str(e.status).toLowerCase()} after ${Math.round((now - N(e.createdAt)) / 60000)} min${N(e.attempts) ? ` (try ${N(e.attempts)})` : ''}`) : '';
    const ex = state === 'STUCK' && !e.lastError
        ? { words: `Not through yet — ${stuckWhy}`, fix: 'Usually it goes on its own; if it stays, look at it in 11.1.', detail: '' }
        : explainNsError(e.lastError, { kind: e.kind, type, item, label: e.label });
    const at = N(e.failedAt) || N(e.createdAt);
    const later = state === 'REFUSED' ? (entries || []).find(x => x && x !== e && x.status === 'POSTED' && x.kind === e.kind && N(x.createdAt) > N(e.createdAt) && str(x.label) && str(x.label) === str(e.label)) : null;
    return {
        key: `ob:${e.id}`, id: e.id, source: 'QUEUE', state, at, who: e.createdBy || '', page: e.page || e.sourceApp || '',
        label: e.label || e.kind || '', kind: e.kind || '', type, item, qty,
        words: ex.words, fix: ex.fix, detail: ex.detail, stuckWhy,
        canResend: state === 'REFUSED', carried: at < dayStart,
        laterHint: later ? { at: N(later.postedAt) || N(later.createdAt), ref: later.nsTran || later.nsId || later.id } : null,
        raw: e,
    };
};

/** One direct call's row. */
export const rowFromDirect = (l, { now = Date.now(), dayStart = shopDayStartOf(now), logs = [] } = {}) => {
    const a = l.audit || {};
    const type = nsTypeOf(a.recordKind, a.targetUrl);
    const text = actionOf(l.msg);
    const { item, qty } = itemQtyOf(text, a.payloadQty != null ? { quantity: a.payloadQty } : null);
    const ex = explainNsError(a.error || l.msg, { kind: a.recordKind, type, item, label: text });
    const at = msOf(l.t) || 0;
    const later = (logs || []).find(x => x && x !== l && x.audit && x.audit.kind === 'NS_DIRECT' && x.audit.ok === true && (msOf(x.t) || 0) > at && actionOf(x.msg) === text);
    return {
        key: `hl:${l.id}`, id: l.id, source: 'DIRECT', state: 'REFUSED', at, who: l.u || '', page: l.page || l.src || '',
        label: text || type, kind: a.recordKind || '', type, item, qty,
        words: ex.words, fix: ex.fix, detail: ex.detail, stuckWhy: '',
        canResend: false, carried: at < dayStart,
        laterHint: later ? { at: msOf(later.t) || 0, ref: '', who: later.u || '' } : null,
        raw: l,
    };
};
export const DIRECT_NO_RESEND = 'It was sent straight to NetSuite, so there is no queued copy to re-send — do it in NetSuite and mark Done (or Not needed).';

/**
 * Everything still owed to NetSuite. → { rows (oldest first: carried over, then today), earlier (refusals older than the window,
 * counted), counts: { open, carried, today, refused, stuck, earlier } }.
 */
export function fixRowsOf({ outbox = [], directLogs = [], now = Date.now(), windowDays = FIX_WINDOW_DAYS } = {}) {
    const dayStart = shopDayStartOf(now);
    const since = now - windowDays * DAY;
    const rows = [], earlier = [];
    (outbox || []).forEach(e => {
        if (!e || !queueStateOf(e, { now })) return;
        const r = rowFromQueue(e, { now, dayStart, entries: outbox });
        if ((N(e.createdAt) || r.at) < since) { if (r.state === 'REFUSED') earlier.push(r); return; }
        rows.push(r);
    });
    (directLogs || []).filter(directOpenOf).forEach(l => {
        const r = rowFromDirect(l, { now, dayStart, logs: directLogs });
        if (r.at < since) earlier.push(r); else rows.push(r);
    });
    rows.sort((a, b) => (a.carried === b.carried ? a.at - b.at : (a.carried ? -1 : 1)));
    earlier.sort((a, b) => a.at - b.at);
    const counts = {
        open: rows.length, carried: rows.filter(r => r.carried).length, today: rows.filter(r => !r.carried).length,
        refused: rows.filter(r => r.state === 'REFUSED').length, stuck: rows.filter(r => r.state === 'STUCK').length, earlier: earlier.length,
    };
    return { rows, earlier, counts };
}

/** The chip's words. */
export const fixChipTextOf = (counts) => (!counts || !counts.open ? 'NetSuite ✓' : `NetSuite: ${counts.open} to fix${counts.carried ? ` · ${counts.carried} from before today` : ''}`);
