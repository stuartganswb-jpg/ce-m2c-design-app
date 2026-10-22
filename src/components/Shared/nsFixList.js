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
    { re: /Invalid Field Value (?!\d+ for)(\S+) for the following field: item/i,
      words: (m, c) => {
          const codes = (c.codeItems && c.codeItems.length ? c.codeItems : [m[1]]);
          return `${codes.length === 1 ? codes[0] : codes.join(', ')} ${codes.length === 1 ? 'has' : 'have'} no NetSuite id — not in NetSuite for this division, or not synced`;
      },
      fix: (m, c) => `Create ${(c.codeItems || []).length > 1 ? 'them' : 'it'} in NetSuite for this division (or sync 11.1 → Sync Master Library if ${(c.codeItems || []).length > 1 ? 'they exist' : 'it exists'}), then ↻ Re-send.` },
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

// ── WHAT IT WAS FOR, WHAT IT SENT, WHERE NETSUITE STOPPED (Stuart 2026-10-21: "they are not providing him enough data to
// make the fixes, there are no transactions #'s to chase down as well as little description of what went wrong") ─────────
// Every queued write already holds the exact call: the record it acts on (in its address), every line it sent (item, quantity,
// bins, the NetSuite order line), and NetSuite's own pointer to the line it refused ("o:errorPath"). These read them so a
// row can name the NetSuite record (number + a link that opens it), list what was sent, and mark the line NetSuite stopped at;
// the NetSuite numbers, item codes and bin names are read back once for the whole list (readBackSqlOf).
const NS_ACCOUNT_UI = 'https://3728153.app.netsuite.com';
const REC_LABEL = {
    salesorder: 'Sales Order', purchaseorder: 'Purchase Order', workorder: 'Work Order', estimate: 'Estimate', invoice: 'Invoice',
    itemfulfillment: 'Item Fulfillment', itemreceipt: 'Item Receipt', inventoryadjustment: 'Inventory Adj.', bintransfer: 'Bin Transfer',
    assemblybuild: 'Assembly Build', workordercompletion: 'Assembly Build', customer: 'Customer', vendor: 'Vendor',
    inventoryitem: 'Item', assemblyitem: 'Item', noninventoryresaleitem: 'Item', noninventorysaleitem: 'Item', kititem: 'Item',
};
const ITEM_RECS = ['inventoryitem', 'assemblyitem', 'noninventoryresaleitem', 'noninventorysaleitem', 'kititem'];
const isId = (v) => /^\d+$/.test(str(v).trim());

/**
 * The NetSuite record a write acts on, from its address: a transform's SOURCE (the sales order a fulfilment ships, the PO a
 * receipt receives, the work order a build completes), a PATCH's target, or — for a create — only the kind. → { rec, id, label,
 * makes } | null. `makes` = what a transform creates.
 */
export const nsRecordOf = (entry) => {
    const url = str(entry && entry.targetUrl);
    const m = url.match(/\/record\/v1\/([a-zA-Z]+)(?:\/(\d+))?(?:\/!transform\/([a-zA-Z]+))?/);
    if (!m) return null;
    const rec = m[1].toLowerCase();
    return { rec, id: m[2] || '', label: REC_LABEL[rec] || m[1], makes: m[3] ? (REC_LABEL[m[3].toLowerCase()] || m[3]) : '' };
};

/** The page that opens a NetSuite record in the NetSuite UI. '' when there is no id. */
export const nsUiUrlOf = (rec, id) => {
    if (!isId(id)) return '';
    const r = str(rec).toLowerCase();
    if (r === 'customer') return `${NS_ACCOUNT_UI}/app/common/entity/custjob.nl?id=${id}`;
    if (r === 'vendor') return `${NS_ACCOUNT_UI}/app/common/entity/vendor.nl?id=${id}`;
    if (ITEM_RECS.includes(r) || r === 'item') return `${NS_ACCOUNT_UI}/app/common/item/item.nl?id=${id}`;
    return `${NS_ACCOUNT_UI}/app/accounting/transactions/transaction.nl?id=${id}`;
};

/** The app's own records a write was for (its writeBack targets) — "QUOTE-…", "WO-SO60838-…". */
export const appRecordsOf = (entry) => (Array.isArray(entry && entry.writeBack) ? entry.writeBack : (entry && entry.writeBack ? [entry.writeBack] : []))
    .filter(w => w && w.collection && w.docId).map(w => ({ collection: str(w.collection), id: str(w.docId) }));

/**
 * Every line a write sent, in order: { n (1-based), orderLine, item (a NetSuite id — or a CODE when the app had none), qty,
 * bins: [{ bin, toBin, qty }], skipped (a transform line not part of this write) }. A work order or build is one line.
 */
export const sentLinesOf = (entry) => {
    const p = (entry && entry.payload) || {};
    const rows = (p.item && Array.isArray(p.item.items) && p.item.items) || (p.inventory && Array.isArray(p.inventory.items) && p.inventory.items) || null;
    const binsOf = (d) => ((d && d.inventoryAssignment && d.inventoryAssignment.items) || []).map(b => ({
        bin: str(b.binNumber && (b.binNumber.id || b.binNumber.refName)), toBin: str(b.toBinNumber && (b.toBinNumber.id || b.toBinNumber.refName)), qty: b.quantity != null ? Number(b.quantity) : null,
    }));
    if (rows) return rows.map((l, i) => ({
        n: i + 1, idx: i, orderLine: l.orderLine != null ? Number(l.orderLine) : null,
        item: str(l.item && (l.item.id || l.item.refName)), qty: l.quantity != null ? Number(l.quantity) : (l.adjustQtyBy != null ? Number(l.adjustQtyBy) : null),
        bins: binsOf(l.inventoryDetail), skipped: l.itemReceive === false,
    }));
    if (p.assemblyItem) return [{ n: 1, idx: 0, orderLine: null, item: str(p.assemblyItem.id || p.assemblyItem.refName), qty: p.quantity != null ? Number(p.quantity) : null, bins: [], skipped: false }];
    if (p.quantity != null && p.inventoryDetail) return [{ n: 1, idx: 0, orderLine: null, item: '', qty: Number(p.quantity), bins: binsOf(p.inventoryDetail), skipped: false }];
    return [];
};

/** NetSuite's pointer to the line it refused ("o:errorPath"). → { path, idx?, orderLine?, bins? } | null. */
export const errorPathOf = (raw) => {
    const m = str(raw).match(/"o:errorPath"\s*:\s*"([^"]+)"/);
    if (!m) return null;
    const path = m[1];
    const ol = path.match(/orderLine\s*==\s*(\d+)/);
    const ix = path.match(/^(?:item|inventory)\.items\[(\d+)\]/);
    return { path, ...(ol ? { orderLine: Number(ol[1]) } : {}), ...(ix ? { idx: Number(ix[1]) } : {}), bins: /inventoryAssignment|inventoryDetail/.test(path) };
};

/** The line NetSuite stopped at, out of the lines sent. null when NetSuite named none. */
export const pointedLineOf = (lines = [], pointer = null) => {
    if (!pointer) return null;
    if (pointer.orderLine != null) return lines.find(l => l.orderLine === pointer.orderLine) || null;
    if (pointer.idx != null) return lines[pointer.idx] || null;
    return null;
};

/** Lines whose item went by its CODE — the app held no NetSuite id for it. */
export const codeItemLinesOf = (lines = []) => lines.filter(l => !l.skipped && l.item && !isId(l.item));

/** The NetSuite ids a list needs read back: { tx, items, bins, customers } (each a sorted unique list of digit ids). */
export const readBackIdsOf = (rows = []) => {
    const tx = new Set(), items = new Set(), bins = new Set(), customers = new Set();
    (rows || []).forEach(r => {
        if (r.nsRecord && isId(r.nsRecord.id)) (ITEM_RECS.includes(r.nsRecord.rec) ? items : (r.nsRecord.rec === 'customer' ? customers : tx)).add(r.nsRecord.id);
        if (isId(r.customerId)) customers.add(r.customerId);
        (r.lines || []).forEach(l => {
            if (isId(l.item)) items.add(l.item);
            (l.bins || []).forEach(b => { if (isId(b.bin)) bins.add(b.bin); if (isId(b.toBin)) bins.add(b.toBin); });
        });
    });
    const out = (st) => [...st].sort((a, b) => Number(a) - Number(b));
    return { tx: out(tx), items: out(items), bins: out(bins), customers: out(customers) };
};
/** The SuiteQL reads for those ids (each '' when there is nothing to ask). `txLines` = the source records' own lines. */
export const readBackSqlOf = (ids = {}) => {
    const list = (a) => (a || []).filter(isId).slice(0, 200).join(',');
    const t = list(ids.tx), i = list(ids.items), b = list(ids.bins), c = list(ids.customers);
    return {
        tx: t ? `SELECT id, tranid, type, BUILTIN.DF(status) AS st, BUILTIN.DF(entity) AS who FROM transaction WHERE id IN (${t})` : '',
        txLines: t ? `SELECT tl.transaction AS tr, tl.id AS line, BUILTIN.DF(tl.item) AS item, tl.quantity AS q, tl.quantityshiprecv AS got FROM transactionline tl WHERE tl.transaction IN (${t}) AND tl.mainline = 'F'` : '',
        items: i ? `SELECT id, itemid FROM item WHERE id IN (${i})` : '',
        bins: b ? `SELECT id, binnumber FROM bin WHERE id IN (${b})` : '',
        customers: c ? `SELECT id, entityid, companyname FROM customer WHERE id IN (${c})` : '',
    };
};
/** Index the answers → { tx: {id → {tranid, type, st, who}}, lines: {"tr|line" → {item, q, got}}, items: {id → code}, bins: {id → name}, customers: {id → name} }. */
export const indexReadBackRows = ({ tx = [], txLines = [], items = [], bins = [], customers = [] } = {}) => {
    const o = { tx: {}, lines: {}, items: {}, bins: {}, customers: {} };
    (tx || []).forEach(t => { o.tx[str(t.id)] = { tranid: str(t.tranid), type: str(t.type), st: str(t.st).split(' : ').pop(), who: str(t.who) }; });
    (txLines || []).forEach(l => { o.lines[`${str(l.tr)}|${str(l.line)}`] = { item: str(l.item), q: l.q != null ? Math.abs(Number(l.q)) : null, got: l.got != null ? Math.abs(Number(l.got)) : null }; });
    (items || []).forEach(x => { o.items[str(x.id)] = str(x.itemid); });
    (bins || []).forEach(x => { o.bins[str(x.id)] = str(x.binnumber); });
    (customers || []).forEach(x => { o.customers[str(x.id)] = str(x.companyname || x.entityid); });
    return o;
};
/** An item / bin in words, through the read-back when it is a NetSuite id. */
export const itemWordOf = (item, rb) => (isId(item) ? ((rb && rb.items[item]) || `item #${item}`) : str(item));
export const binWordOf = (bin, rb) => (isId(bin) ? ((rb && rb.bins[bin]) || `#${bin}`) : str(bin));
/** One sent line in words: "H5-1HXROD × 14 · bin Somfy Parts". A receipt / fulfilment line names no item — its order line
 *  does, so the item comes from the record's own line when that was read back. */
export const lineWordsOf = (l, rb, row = null) => [
    `${itemWordOf(l.item, rb) || (row && row.nsRecord && rb && l.orderLine != null && rb.lines[`${row.nsRecord.id}|${l.orderLine}`] ? rb.lines[`${row.nsRecord.id}|${l.orderLine}`].item : (l.orderLine != null ? `order line ${l.orderLine}` : 'the assembly'))}${l.qty != null ? ` × ${Math.abs(l.qty)}` : ''}`,
    ...(l.bins || []).map(b => `${b.toBin ? `${binWordOf(b.bin, rb)} → ${binWordOf(b.toBin, rb)}` : `bin ${binWordOf(b.bin, rb)}`}${b.qty != null && (l.bins.length > 1 || Math.abs(b.qty) !== Math.abs(l.qty || 0)) ? ` (${Math.abs(b.qty)})` : ''}`),
].join(' · ');
/** What the NetSuite record holds on that order line now (a receipt / fulfilment's source). '' when not read. */
export const lineNowOf = (row, l, rb) => {
    if (!rb || !row.nsRecord || !row.nsRecord.id || l.orderLine == null) return '';
    const x = rb.lines[`${row.nsRecord.id}|${l.orderLine}`];
    if (!x) return '';
    const done = row.nsRecord.rec === 'purchaseorder' ? 'received' : 'fulfilled';
    return `NetSuite line ${l.orderLine}: ${x.item}${x.q != null ? ` — ordered ${x.q}` : ''}${x.got != null ? `, ${done} ${x.got}` : ''}`;
};
/** The row as text, for the clipboard (an email, a NetSuite search). */
export const rowCopyTextOf = (row, rb) => {
    const t = row.nsRecord && row.nsRecord.id && rb && rb.tx[row.nsRecord.id];
    const lines = (row.lines || []).filter(l => !l.skipped);
    return [
        `${row.label}`,
        `${row.who ? `${row.who} · ` : ''}${row.page ? `${row.page} · ` : ''}${row.at ? new Date(row.at).toLocaleString() : ''}`,
        row.nsRecord ? `NetSuite: ${row.nsRecord.label}${t ? ` ${t.tranid}${t.st ? ` (${t.st})` : ''}${t.who ? ` · ${t.who}` : ''}` : (row.nsRecord.id ? ` #${row.nsRecord.id}` : ' (new)')}${row.nsRecord.makes ? ` → ${row.nsRecord.makes}` : ''}${row.nsRecord.id ? ` · ${nsUiUrlOf(row.nsRecord.rec, row.nsRecord.id)}` : ''}` : '',
        row.appRecords && row.appRecords.length ? `App: ${row.appRecords.map(a => a.id).join(', ')}` : '',
        `Refused: ${row.words}`,
        row.pointed ? `NetSuite stopped at line ${row.pointed.orderLine != null ? row.pointed.orderLine : row.pointed.n}: ${lineWordsOf(row.pointed, rb, row)}` : '',
        lines.length ? `Sent (${lines.length} line${lines.length === 1 ? '' : 's'}):\n${lines.map(l => `  ${l.orderLine != null ? `line ${l.orderLine}` : `#${l.n}`} — ${lineWordsOf(l, rb, row)}${lineNowOf(row, l, rb) ? ` · ${lineNowOf(row, l, rb)}` : ''}`).join('\n')}` : '',
        `NetSuite's words: ${row.detail}`,
        `Fix: ${row.fix}`,
    ].filter(Boolean).join('\n');
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
    const lines = sentLinesOf(e);
    const codeItems = [...new Set(codeItemLinesOf(lines).map(l => l.item))];
    const pointer = errorPathOf(e.lastError);
    const pointed = pointedLineOf(lines, pointer);
    const nsRecord = nsRecordOf(e);
    const ex = state === 'STUCK' && !e.lastError
        ? { words: `Not through yet — ${stuckWhy}`, fix: 'Usually it goes on its own; if it stays, look at it in 11.1.', detail: '' }
        : explainNsError(e.lastError, { kind: e.kind, type, item: item || (pointed && !isId(pointed.item) ? pointed.item : ''), label: e.label, codeItems });
    const at = N(e.failedAt) || N(e.createdAt);
    // Went through later: the same kind for the same NetSuite record (the SO a fulfilment ships, the PO a receipt takes), or the same words.
    const sameThing = (x) => x.kind === e.kind && ((nsRecord && nsRecord.id && (nsRecordOf(x) || {}).id === nsRecord.id) || (str(x.label) && str(x.label) === str(e.label)));
    const later = state === 'REFUSED' ? (entries || []).find(x => x && x !== e && x.status === 'POSTED' && N(x.createdAt) > N(e.createdAt) && sameThing(x)) : null;
    return {
        key: `ob:${e.id}`, id: e.id, source: 'QUEUE', state, at, who: e.createdBy || '', page: e.page || e.sourceApp || '',
        label: e.label || e.kind || '', kind: e.kind || '', type, item, qty,
        words: ex.words, fix: ex.fix, detail: ex.detail, stuckWhy,
        canResend: state === 'REFUSED', carried: at < dayStart,
        laterHint: later ? { at: N(later.postedAt) || N(later.createdAt), ref: later.nsTran || later.nsId || later.id } : null,
        nsRecord, appRecords: appRecordsOf(e), customerId: str(e.payload && e.payload.entity && e.payload.entity.id),
        lines, pointed, pointer, codeItems, keptNothing: false,
        raw: e,
    };
};

/** One direct call's row. */
export const rowFromDirect = (l, { now = Date.now(), dayStart = shopDayStartOf(now), logs = [] } = {}) => {
    const a = l.audit || {};
    const type = nsTypeOf(a.recordKind, a.targetUrl);
    const text = actionOf(l.msg);
    const { item, qty } = itemQtyOf(text, a.payloadQty != null ? { quantity: a.payloadQty } : null);
    // What the call sent — kept from 2026-10-21 (Shared/nsProxy keeps `audit.sent`); a call before then kept only NetSuite's words.
    const sent = a.sent && typeof a.sent === 'object' ? a.sent : null;
    const lines = sent && Array.isArray(sent.lines) ? sent.lines : [];
    const pointed = pointedLineOf(lines, a.errorPath ? errorPathOf(`"o:errorPath":"${a.errorPath}"`) : null);
    const codeItems = [...new Set(codeItemLinesOf(lines).map(x => x.item))];
    const ex = explainNsError(a.error || l.msg, { kind: a.recordKind, type, item, label: text, codeItems });
    const at = msOf(l.t) || 0;
    const nsRecord = a.targetUrl ? nsRecordOf({ targetUrl: a.targetUrl }) : null;
    const later = (logs || []).find(x => x && x !== l && x.audit && x.audit.kind === 'NS_DIRECT' && x.audit.ok === true && (msOf(x.t) || 0) > at && actionOf(x.msg) === text);
    return {
        key: `hl:${l.id}`, id: l.id, source: 'DIRECT', state: 'REFUSED', at, who: l.u || '', page: l.page || l.src || '',
        label: (str(l.msg).includes(' — ') ? text : '') || (sent && sent.name ? `${type}: ${sent.name}` : '') || text || type, kind: a.recordKind || '', type, item, qty,
        words: ex.words, fix: ex.fix, detail: ex.detail, stuckWhy: '',
        canResend: false, carried: at < dayStart,
        laterHint: later ? { at: msOf(later.t) || 0, ref: '', who: later.u || '' } : null,
        nsRecord: nsRecord && (nsRecord.id || a.nsId) ? { ...nsRecord, id: nsRecord.id || str(a.nsId || '') } : nsRecord,
        appRecords: [], customerId: '', lines, pointed, pointer: null, codeItems, keptNothing: !sent,
        raw: l,
    };
};
export const DIRECT_NO_RESEND = 'It was sent straight to NetSuite, so there is no queued copy to re-send — do it in NetSuite and mark Done (or Not needed).';
export const DIRECT_KEPT_NOTHING = 'This call was made before 21 Oct, when the app kept only NetSuite\'s words — not the items, bins or quantities it sent. Ask the person named above what they did at that time.';

/** What a direct call keeps of what it sent (Shared/nsProxy → hq_logs audit.sent): the record's name for a create, every line. */
export const directSentOf = (body) => {
    const p = (body && body.payload) || {};
    const name = str(p.itemId || p.itemid || p.displayName || p.companyName || p.entityId || p.tranId || '').slice(0, 120);
    const lines = sentLinesOf({ payload: p }).slice(0, 30).map(l => ({ n: l.n, idx: l.idx, orderLine: l.orderLine, item: l.item, qty: l.qty, bins: l.bins.slice(0, 6), skipped: l.skipped }));
    return { name, lines, lineCount: sentLinesOf({ payload: p }).length };
};

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
