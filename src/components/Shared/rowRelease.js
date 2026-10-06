// ── A ROW IS RELEASED BY THE DISPLAY, NOT ONLY WHOLE (Stuart 2026-10-05) ────────────────────────────────────────────
// "when we release a row it is releasing all 35 pcs, which in some cases is fine and in others we would like the ability
//  to put say just 10pcs (full rows) of the 35pcs into motion … i have another new display order for 100pcs and do not
//  want to set it up until we have this ability."
//
// THE SALES ORDER'S LINES STAY AS SOLD. What changes is how much of each line is in motion: a row of an order released
// by count (`releaseByCount`, stamped when it is put on the row route) carries a TARGET — "10 of 35 displays" — on the
// sales order (`rowRelease.<ROW>.boards`), and every line of that row is due its share of it:
//     pieces due = line quantity ÷ displays on the order × displays released   (the whole line when all are released)
// Each start raises only what is due and not yet raised, and records it on the line's start stamp as a RELEASE
// (`oeGen[idx].releases[]` — how many pieces, by which route, under which documents). Everything after reads those:
// 10.5's rows, the WMS pick (a stocked line follows its row's count — "1. release count"), the gather, and what ships —
// a display ships only when a display's worth of EVERY row is in the order's bin ("if we make 10pcs of row 1 and 25 of
// row 2 and 7pc of row 3, the maximum that could be shipped would be 7").
//
// An order put on the row route before this carries no `releaseByCount`: its rows start whole and every reader keeps
// the reading it had. Pure — no Firestore. scripts/rowRelease.test.mjs asserts it.
import { rowKeyOf, rowOfLine } from './rowKey.js';
import { isKitLine, isOffOrderLine } from './itemKit.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** The key the order's own lines (its base — `orderLevel`) are released under: they belong to no row. */
export const ORDER_ROW_KEY = 'ORDER';

/** Is this order released by count? Only an order put on the row route since 2026-10-05. */
export const isReleaseByCount = (so) => !!so && so.releaseByCount === true;

/** What an order is stamped with when it goes on the row route: released by count, of this many displays. */
export const releaseByCountPatch = (displays) => (Math.floor(N(displays)) > 0 ? { releaseByCount: true, releaseOf: Math.floor(N(displays)) } : {});

/** The release key of a line: its row's, or the order's own. */
export const releaseRowKeyOf = (line) => ((line && line.orderLevel === true) ? ORDER_ROW_KEY : rowKeyOf(rowOfLine(line)));

/** The row's record on the sales order: { boards (released so far), of, log: [{ no, from, to, at, by }] }, or null. */
export const rowReleaseOf = (so, rowKey) => { const r = ((so && so.rowRelease) || {})[rowKey]; return (r && typeof r === 'object') ? r : null; };
/** How many displays the order is. The row's own record wins (what it was released against), else the order's. */
export const rowDisplaysOf = (so, rowKey) => Math.floor(N((rowReleaseOf(so, rowKey) || {}).of)) || Math.floor(N(so && so.releaseOf));
/** How many displays of a row are released. */
export const rowTargetOf = (so, rowKey) => {
    const of = rowDisplaysOf(so, rowKey);
    const t = Math.max(0, Math.floor(N((rowReleaseOf(so, rowKey) || {}).boards)));
    return of > 0 ? Math.min(t, of) : t;
};
/** The run a start belongs to — the row's latest release: { no, from, to, of }. */
export const releaseRunOf = (so, rowKey) => {
    const r = rowReleaseOf(so, rowKey);
    const log = (r && Array.isArray(r.log)) ? r.log : [];
    const last = log[log.length - 1] || null;
    const to = rowTargetOf(so, rowKey);
    return { no: last ? N(last.no) || log.length : 1, from: last ? Math.max(0, Math.floor(N(last.from))) : 0, to, of: rowDisplaysOf(so, rowKey) };
};
/** The row's record after `add` more displays are released (add 0 = the same target, run again). */
export const nextRowReleaseOf = ({ so, rowKey, add = 0, of, by = '', now = Date.now() } = {}) => {
    const cur = rowReleaseOf(so, rowKey) || {};
    const total = Math.floor(N(of)) || rowDisplaysOf(so, rowKey);
    const from = rowTargetOf(so, rowKey);
    const n = Math.max(0, Math.floor(N(add)));
    const to = total > 0 ? Math.min(total, from + n) : from + n;
    const log = Array.isArray(cur.log) ? cur.log : [];
    return {
        ...cur, boards: to, of: total, at: now, by: by || '',
        log: to > from ? [...log, { no: log.length + 1, from, to, at: now, by: by || '' }] : log,
    };
};
/** "displays 11–20 of 35" — what a release's documents are named. */
export const releaseLabelOf = (rel) => {
    if (!rel || !(N(rel.to) > 0)) return '';
    const from = Math.max(0, Math.floor(N(rel.from))), to = Math.floor(N(rel.to)), of = Math.floor(N(rel.of));
    const span = to - from <= 1 ? `display ${to}` : `displays ${from + 1}–${to}`;
    return `${span}${of > 0 ? ` of ${of}` : ''}`;
};

/**
 * The pieces of a line its row's target calls for. A partial target needs the line to divide evenly by the display —
 * the same rule a shipment uses (Shared/orderBinPick.displayShareOf); all displays released is the whole line and
 * needs no division. `round` is for a fee that rides a pole (it is fabrication, counted with its pole).
 * @returns { qty, ok, why, per, target, of, whole }
 */
export const lineTargetOf = (so, line, { round = false } = {}) => {
    const q = N(line && line.qty);
    const key = releaseRowKeyOf(line);
    const of = rowDisplaysOf(so, key), target = rowTargetOf(so, key);
    if (!(q > 0) || !(target > 0)) return { qty: 0, ok: true, why: '', target, of };
    if (of > 0 && target >= of) return { qty: q, ok: true, why: '', target, of, whole: true };
    if (!(of > 0)) return { qty: 0, ok: false, why: 'the order does not say how many displays it is', target, of };
    const per = q / of;
    if (!Number.isInteger(per)) {
        if (round) return { qty: Math.round(per * target), ok: true, why: '', per, target, of };
        return { qty: 0, ok: false, why: `${q} does not divide into ${of} displays`, per, target, of };
    }
    return { qty: per * target, ok: true, why: '', per, target, of };
};

/** The releases recorded on a line's start stamp (none on a stamp written for the whole line). */
export const releasesOf = (gen) => ((gen && Array.isArray(gen.releases)) ? gen.releases : []);
const isShelfKind = (k) => U(k) === 'STOCK';
/** Pieces of a line released so far, by where they come from. A stamp with no releases is the whole line. */
export const releasedByKindOf = (gen, lineQty) => {
    if (!gen) return { shelf: 0, floor: 0, total: 0 };
    if (!Array.isArray(gen.releases)) { const q = N(lineQty); return isShelfKind(gen.kind) ? { shelf: q, floor: 0, total: q } : { shelf: 0, floor: q, total: q }; }
    const shelf = gen.releases.filter(r => isShelfKind(r.kind)).reduce((a, r) => a + N(r.qty), 0);
    const floor = gen.releases.filter(r => !isShelfKind(r.kind)).reduce((a, r) => a + N(r.qty), 0);
    return { shelf, floor, total: shelf + floor };
};
export const releasedQtyOf = (so, idx, line = null) => releasedByKindOf(so && so.oeGen && so.oeGen[idx], N((line || ((so && so.lines) || [])[idx] || {}).qty)).total;

/**
 * What a start still has to raise for a line: its row's target, less what is already released.
 * @returns { qty, ok, why, target, of, released, want }
 */
export const lineDueOf = (so, line, idx, opts = {}) => {
    const t = lineTargetOf(so, line, opts);
    const released = releasedQtyOf(so, idx, line);
    if (!t.ok) return { qty: 0, ok: false, why: t.why, target: t.target, of: t.of, released, want: 0 };
    return { qty: Math.max(0, t.qty - released), ok: true, why: '', target: t.target, of: t.of, released, want: t.qty };
};

/**
 * THE LINE'S START STAMP WITH ONE MORE RELEASE ON IT. A second document of the same run for the same line (a start-now
 * split) joins that run's entry. The stamp's own `kind` stays what every older reader asks of it: WO once any piece of
 * the line is on a floor document, else STOCK (a shelf pick); `ids` is every document of every release.
 * @param cur   the stamp as it stands (or null)
 * @param run   { no, from, to, of } — Shared/rowRelease.releaseRunOf
 */
export const releaseStampOf = ({ cur = null, kind = 'WO', ids = [], code = '', qty = 0, run = {}, at = Date.now(), by = '', auto = false, rowKey = '', finish = '', rider = false } = {}) => {
    const prior = releasesOf(cur);
    const no = N(run.no) || prior.length + 1;
    const mine = prior.find(r => N(r.no) === no && U(r.kind) === U(kind)) || null;
    const entry = {
        ...(mine || {}), no, kind, from: Math.floor(N(run.from)), to: Math.floor(N(run.to)), of: Math.floor(N(run.of)),
        qty: N(mine && mine.qty) + N(qty), ids: [...new Set([...((mine && mine.ids) || []), ...(ids || [])])],
        ...(code ? { code: U(code) } : {}), at, by: by || '',
    };
    const releases = mine ? prior.map(r => (r === mine ? entry : r)) : [...prior, entry];
    const anyFloor = releases.some(r => !isShelfKind(r.kind));
    const lastCode = [...releases].reverse().map(r => r.code).find(Boolean) || '';
    return {
        kind: anyFloor ? 'WO' : 'STOCK',
        ids: [...new Set(releases.flatMap(r => r.ids || []))],
        ...(lastCode ? { code: lastCode } : {}),
        at, by: by || '', auto: !!auto, rowKey: rowKey || (cur && cur.rowKey) || '', finish: U(finish) || (cur && cur.finish) || '',
        ...((rider || (cur && cur.rider)) ? { rider: true } : {}),
        releases, released: releases.reduce((a, r) => a + N(r.qty), 0),
    };
};
/** The stamp with a run taken back off it — null when nothing is left (the line reads NOT STARTED). */
export const stampWithoutRunOf = (cur, no) => {
    const left = releasesOf(cur).filter(r => N(r.no) !== N(no));
    if (!left.length) return null;
    const anyFloor = left.some(r => !isShelfKind(r.kind));
    const lastCode = [...left].reverse().map(r => r.code).find(Boolean) || '';
    const rest = { ...(cur || {}) };
    delete rest.code;
    return { ...rest, kind: anyFloor ? 'WO' : 'STOCK', ids: [...new Set(left.flatMap(r => r.ids || []))], ...(lastCode ? { code: lastCode } : {}), releases: left, released: left.reduce((a, r) => a + N(r.qty), 0) };
};

/** A start stamp written for the WHOLE line — a row started before release counts (no releases recorded on it). */
export const isWholeStamp = (gen) => !!gen && !Array.isArray(gen.releases);

/**
 * THE SWITCH — an order ALREADY on the row route goes onto release counts (Stuart 2026-10-06, the wall: released whole on
 * 10-01/02, "i am just trying to get the first 2 thru the floor"). Every row with anything started is recorded as FULLY
 * released: its documents are for every display, so nothing on the floor changes and every reader goes on reading the
 * whole line off them. A row with nothing started reads 0 and takes the count box. Rows are then put back one at a time
 * with ⟲ Restart row (Shared/displayRelease.rowRestartPlanOf).
 * @returns { patch: { releaseByCount, releaseOf, rowRelease }, rows: [rowKey] } | null (already by count, or no display count)
 */
export const countSwitchOf = ({ so, of, by = '', now = Date.now() } = {}) => {
    const total = Math.floor(N(of));
    if (!so || isReleaseByCount(so) || !(total > 0)) return null;
    const started = new Set();
    ((so.lines) || []).forEach((l, i) => { if (l && so.oeGen && so.oeGen[i]) { const k = releaseRowKeyOf(l); if (k) started.add(k); } });
    const rowRelease = { ...((so.rowRelease) || {}) };
    started.forEach(k => { rowRelease[k] = { boards: total, of: total, at: now, by: by || '', whole: true, log: [{ no: 1, from: 0, to: total, at: now, by: by || '', whole: true }] }; });
    return { patch: { ...releaseByCountPatch(total), rowRelease }, rows: [...started] };
};

/**
 * WHAT RELEASING A ROW TO `target` DISPLAYS ASKS OF ONE SALES ORDER — read before anything is written, so the confirm
 * names every line at its quantity and a line that cannot be divided stops the release. Kit lines and lines off the
 * order carry no pieces; a fee is counted with its pole and never stops a release.
 * @returns { ok, why: [], lines: [{ lineIdx, erp, finish, qty (the line), released, now, want, prev }] }
 */
export const rowReleasePlanOf = ({ so, rowKey, target, of } = {}) => {
    const total = Math.floor(N(of)) || rowDisplaysOf(so, rowKey);
    const sim = { ...(so || {}), releaseOf: total, rowRelease: { ...((so && so.rowRelease) || {}), [rowKey]: { ...(rowReleaseOf(so, rowKey) || {}), boards: Math.floor(N(target)), of: total } } };
    const why = [], lines = [];
    ((so && so.lines) || []).forEach((line, lineIdx) => {
        if (!line || releaseRowKeyOf(line) !== rowKey || isKitLine(line) || isOffOrderLine(line) || !(N(line.qty) > 0)) return;
        const fee = !!(line.isFee || line.lineIsFee);
        const d = lineDueOf(sim, line, lineIdx, { round: fee });
        if (!d.ok) { why.push(`${U(line.erp)}: ${d.why}`); return; }
        // `prev` = what the row's target called for BEFORE this release — a stocked line (never stamped) reads its
        // release off the target alone, so its "now" is want − prev (the caller knows which lines are stocked).
        const before = lineTargetOf(so, line, { round: fee });
        lines.push({ lineIdx, erp: U(line.erp), finish: U(line.finishCode || ''), qty: N(line.qty), released: d.released, now: d.qty, want: d.want, prev: before.ok ? before.qty : 0, ...(fee ? { fee: true } : {}) });
    });
    if (!(total > 0)) why.unshift('the build does not say how many displays it is');
    return { ok: why.length === 0, why, lines };
};
