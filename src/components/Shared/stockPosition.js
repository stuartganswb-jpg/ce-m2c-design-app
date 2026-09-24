// STOCK POSITION — the Sales Snapshot's three live numbers, read ONE way for every screen that shows
// them: Avail (NetSuite, at the brand's location), On Ord (open purchase-order lines + open work
// orders), BO (OUR backorder lines — the customers actually waiting).
//
// Moved here verbatim from StockViewTab.openSalesHistory (2026-09-24) so the 4.7 Flow Stock board
// and the Snapshot read the SAME queries instead of two copies drifting apart. The Snapshot calls
// these; nothing about its numbers changed in the move.
//
// ⚠ PURE ON PURPOSE. No Firestore, no nsProxy import: the caller hands in `runSql(q) → rows` (its
// own authenticated SuiteQL call) and, for the backorder tally, the sales-order documents it read.
// That keeps this file node-testable (scripts/stockPosition.test.mjs) against a fake NetSuite —
// including the 1000-row split, which is the one behaviour nobody can see from a screen.
//
// Ids are NetSuite INTERNAL ids (strings); the backorder tally is keyed by UPPERCASE item code,
// because that is how the split writes backorderLines.

// ── CHUNKED READS: SIZED TO THE ROW BUDGET, NEVER SILENTLY TRUNCATED ──────────────────────────
// SuiteQL returns AT MOST 1000 rows per response and says NOTHING when it clips — the failure the
// Snapshot has already been bitten by twice (the unpaginated item universe; the Fabricut "999"
// report). So a chunk size does not mean "how many ids is it polite to ask about", it means "how
// many ids can I ask about before the ANSWER might exceed 1000 rows" — which depends on how many
// rows ONE id can produce: exactly one for availability, one per month in range for sales, one per
// open line for PO/WO.
//
// Two guarantees make choosing a size safe rather than merely prudent:
//   · SPLIT ON SUSPICION — any chunk answering at or over the cap is re-run as two halves,
//     recursively, until every answer sits inside it. Costs nothing when it never fires, and makes
//     silent truncation structurally impossible at any size.
//   · BOUNDED WIDTH — 4 in flight. The proxy shares an account-wide NetSuite concurrency limit of
//     about five, and the rest of the app is talking to NetSuite while this runs; 4 leaves it room.
export const ROW_CAP = 1000;
export const NS_WIDTH = 4;

export async function runChunked(ids, size, fetchChunk, onRows) {
    const jobs = [];
    for (let i = 0; i < ids.length; i += size) jobs.push(ids.slice(i, i + size));
    const run = async (chunk) => {
        const rows = await fetchChunk(chunk);
        if (rows.length >= ROW_CAP && chunk.length > 1) {
            const half = Math.ceil(chunk.length / 2);
            await run(chunk.slice(0, half));
            await run(chunk.slice(half));
            return;
        }
        onRows(rows);
    };
    for (let i = 0; i < jobs.length; i += NS_WIDTH) {
        await Promise.all(jobs.slice(i, i + NS_WIDTH).map(run));
    }
}

/**
 * Live AVAILABLE qty straight from NetSuite — AggregateItemLocation.quantityavailable at ONE
 * location (the brand's, from BRAND_NETSUITE_MAP). GROUP BY item = exactly one row per id, so 900
 * ids can never fill the 1000-row cap.
 *
 * @returns {Promise<Object<string, number>>} internal id → available (rounded); ids NetSuite has
 *          no row for are ABSENT (the caller decides whether absent reads as 0 or as unknown).
 */
export async function fetchAvailableById(ids, locationId, runSql) {
    const availById = {};
    await runChunked(ids, 900,
        (chunk) => runSql(`SELECT ail.item AS internal_id, SUM(ail.quantityavailable) AS avail FROM AggregateItemLocation ail WHERE ail.item IN (${chunk.join(',')}) AND ail.location = ${locationId} GROUP BY ail.item`),
        (arows) => arows.forEach(row => { availById[String(row.internal_id)] = Math.round(Number(row.avail) || 0); }));
    return availById;
}

/**
 * INBOUND SUPPLY: open purchase-order lines (on order from a vendor) + open work orders (in
 * production), per item. No location filter — this is the Snapshot's On Ord, all locations.
 *
 * BEST-EFFORT, exactly as the Snapshot always treated it: a failure part-way leaves whatever was
 * gathered and reports the error; it never throws, so an On Ord hiccup can never make a report
 * unopenable.
 *
 * @returns {Promise<{ byId: Object<string, {qty:number, lines:Array}>, error: Error|null }>}
 *          line = { kind:'PO'|'WO', tranid, source, ordered, done, open, expected, status }
 */
export async function fetchInboundById(ids, runSql) {
    const inboundById = {};
    try {
        const pushInb = (row, kind, source, expected) => {
            const iid = String(row.internal_id);
            const ordered = Math.abs(parseFloat(row.ordered) || 0);
            const done = Math.max(0, parseFloat(row.done) || 0);
            const open = ordered - done;
            if (open <= 0) return;
            let rec = inboundById[iid]; if (!rec) { rec = { qty: 0, lines: [] }; inboundById[iid] = rec; }
            rec.qty += open;
            rec.lines.push({ kind, tranid: row.tranid, source: source || '', ordered, done, open, expected: expected || '', status: row.statusname || '' });
        };
        // An id can produce SEVERAL rows here (one per open line), so this is the one loop whose
        // answer size is not bounded by the id count — 400 is a judgement, and the cap guard in
        // runChunked is what actually makes it safe.
        await runChunked(ids, 400,
            (chunk) => runSql(`SELECT tl.item AS internal_id, t.tranid AS tranid, t.duedate AS duedate, BUILTIN.DF(t.status) AS statusname, BUILTIN.DF(t.entity) AS vendor, ABS(NVL(tl.quantity,0)) AS ordered, NVL(tl.quantityshiprecv,0) AS done FROM transaction t JOIN transactionline tl ON tl.transaction = t.id WHERE t.type = 'PurchOrd' AND tl.item IN (${chunk.join(',')}) AND NVL(tl.isclosed,'F') = 'F' AND BUILTIN.DF(t.status) NOT LIKE '%Closed%' AND BUILTIN.DF(t.status) NOT LIKE '%Rejected%'`),
            (poRows) => poRows.forEach(row => pushInb(row, 'PO', row.vendor, row.duedate)));
        // WOs: the mainline row carries the assembly being built; quantityshiprecv = qty already
        // built. t.enddate (production end) may not be queryable — fall back to duedate-only. The
        // fallback is LATCHED: every chunk used to re-try enddate, so in an account where it is not
        // queryable each real call was preceded by a failed one.
        const woSel = (extra, chunk) => `SELECT tl.item AS internal_id, t.tranid AS tranid, t.duedate AS duedate${extra}, BUILTIN.DF(t.status) AS statusname, ABS(NVL(tl.quantity,0)) AS ordered, NVL(tl.quantityshiprecv,0) AS done FROM transaction t JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T' WHERE t.type = 'WorkOrd' AND tl.item IN (${chunk.join(',')}) AND BUILTIN.DF(t.status) NOT LIKE '%Closed%' AND BUILTIN.DF(t.status) NOT LIKE '%Built%'`;
        let woExtra = ', t.enddate AS expected';
        await runChunked(ids, 400,
            async (chunk) => {
                try { return await runSql(woSel(woExtra, chunk)); }
                catch (weErr) { if (!woExtra) throw weErr; woExtra = ''; return await runSql(woSel('', chunk)); }
            },
            (woRows) => woRows.forEach(row => pushInb(row, 'WO', 'Production', row.expected || row.duedate)));
    } catch (inbErr) {
        console.warn('Inbound (PO/WO) fetch failed — On Ord column left empty:', inbErr);
        return { byId: inboundById, error: inbErr };
    }
    return { byId: inboundById, error: null };
}

// ── WHO IS ACTUALLY WAITING (Stuart 2026-09-09) ──────────────────────────────────────────────
// NetSuite's own quantitybackordered is a different number — it counts what its sales orders could
// not commit, which includes orders we have already covered another way. This counts OUR record:
// the backorderLines the split writes when nothing on the shelf can make a line. That is the number
// with customers behind it.
//
// The caller reads hq_sales_orders (where brand == …) and passes the documents in ({ id, ...data }).
/** @returns {Object<string, {qty:number, orders:string[]}>} UPPERCASE code → waiting qty + who */
export function backorderTallyOf(salesOrders) {
    const out = {};
    (salesOrders || []).forEach(so => {
        if (!so || so.deleted || ['Closed', 'Deleted', 'Cancelled'].includes(String(so.status || ''))) return;
        (so.backorderLines || []).forEach(l => {
            const code = String(l.code || '').toUpperCase();
            const qty = Math.max(0, Number(l.qty) || 0);
            if (!code || !qty) return;
            const rec = out[code] || (out[code] = { qty: 0, orders: [] });
            rec.qty += qty;
            rec.orders.push(`${qty} × ${so.nsSoTran || so.soNumber || so.orderKey || so.id}${so.customer ? ` (${so.customer})` : ''}`);
        });
    });
    return out;
}
