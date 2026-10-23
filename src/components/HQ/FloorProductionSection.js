// 📦 PRODUCTION & CAPACITY — a section of HQ → System Admin → Floor Metrics, admins only (Stuart 2026-10-22: "i need to start
// seeing some metrics on per piece, per order to start to learn our capacity"). What the finishing floor finished, by
// category and by finish (spray only / with a hand coat), who did what, what each order took, the minutes a piece takes
// and how busy the oven was — all read by Shared/floorOutput from the documents the panel already holds, plus the item
// master's type for the codes an order does not say (the panel reads it, by code). Reads only; the one output is the
// "Export (.xlsx)" button's file. Hours appear here only when the time clock covers the week — never on the wallboard.
// THE STATIONS (2026-10-22: "whom ran it last week vs this week for each station that will paint a clearer picture"): who
// worked the spin machine, the booth, the poles and the hand bench, day by day, and the spin machine's day — with what
// it sprayed beside what was finished, so a week of coats not yet signed off is not read as a slow week.
import React, { useMemo, useState } from 'react';
import { addDays, dayStartOf } from '../Shared/timecardImport';
import { personKeyOf, GROUP } from '../Shared/floorMetrics';
import {
    outputPeriodsOf, outputByDayOf, workByPersonOf, ordersBetween, minutesPerPieceOf, ovenByDayOf,
    changeOf, stationsOf, spinPeriodsOf, stepWorthOf, CATEGORIES, CATEGORY_LABEL, STATIONS, STATION_LABEL, SIZE_BANDS, WORTH_MIN_REAL,
} from '../Shared/floorOutput';
import { woRefOf } from '../Shared/woRef';

const box = { background: '#fff', border: '1px solid var(--line)', padding: '20px', marginBottom: '20px' };
const h4 = { margin: '0 0 12px 0', fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500 };
const h5 = { margin: '18px 0 8px 0', fontFamily: 'var(--serif)', fontSize: '1.05rem', fontWeight: 500 };
const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)' };
const btnLight = { padding: '8px 14px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' };
const th = { padding: '7px 6px', borderBottom: '1px solid var(--line)', textAlign: 'right', ...mono, whiteSpace: 'nowrap' };
const thL = { ...th, textAlign: 'left' };
const td = { padding: '7px 6px', borderBottom: '1px solid var(--line)', fontSize: '0.85rem', textAlign: 'right', whiteSpace: 'nowrap' };
const tdL = { ...td, textAlign: 'left' };
const note = { fontSize: '0.85rem', color: 'var(--ink-soft)', margin: '0 0 10px 0' };

const mins = (m) => (m == null ? '—' : m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`);
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const dec = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
const median = (xs) => { const a = xs.filter(x => x != null && Number.isFinite(x)).sort((p, q) => p - q); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const dayName = (k) => new Date(`${k}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const when = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const sumOf = (o, key) => CATEGORIES.reduce((t, k) => t + o.byCategory[k][key], 0);
const STEP_WORTH_LABEL = { 'spinSetup|spin': 'Setup, spin', 'spinSpray|spin': 'Spray coat, spin', 'spinSetup|booth': 'Setup, booth', 'spinSpray|booth': 'Spray coat, booth', 'poleSpray|poles': 'Pole spray', 'hand|hand': 'Hand finish, small parts', 'poleHand|hand': 'Hand finish, poles' };

/**
 * @param wos       every fin_workorders document
 * @param steps     the floor's punches since the history start (Shared/floorMetrics.floorStepsOf)
 * @param recipes   fin_recipes by id
 * @param week      the week chosen in the panel (its Monday)
 * @param rows      that week's rows (Shared/floorMetrics.weekRowsOf) — the clocked hours, when the clock covers it
 * @param nameOf    person key → the name to print
 * @param fromMs    the history start
 * @param typeOfCode the item master's type by code (the panel reads it); partsNote — what that read could not do
 * @param stationRates what a usual full day at each station earns (Shared/floorMetrics.stationRatesOf) — production's yardstick
 */
export default function FloorProductionSection({ wos = [], steps = [], recipes = {}, week, rows = [], nameOf = (pk) => pk, fromMs, weeksBack, currentUser, writeLog, typeOfCode = () => '', partsNote = '', stationRates = null }) {

    const R = useMemo(() => {
        const now = Date.now();
        const wosById = Object.fromEntries(wos.map(w => [w.id, w]));
        const wkFrom = dayStartOf(week), wkTo = dayStartOf(addDays(week, 7)), prevFrom = dayStartOf(addDays(week, -7));
        const periods = outputPeriodsOf({ workOrders: wos, recipes, typeOfCode, nowMs: now });
        const byDay = outputByDayOf({ workOrders: wos, recipes, typeOfCode, fromMs: wkFrom, toMs: Math.min(wkTo, now + 1) });   // up to today
        const prevByDay = outputByDayOf({ workOrders: wos, recipes, typeOfCode, fromMs: prevFrom, toMs: wkFrom });
        // who did what — one row a person, however their name was punched
        const work = workByPersonOf({ steps, wosById, typeOfCode, fromMs: wkFrom, toMs: wkTo });
        const people = new Map();
        Object.entries(work).forEach(([who, w]) => {
            const pk = personKeyOf(who);
            const p = people.get(pk) || { pk, name: nameOf(pk), setup: 0, sprayed: 0, handFinished: 0, baked: 0, steps: 0, orders: 0, byCategory: Object.fromEntries(CATEGORIES.map(c => [c, 0])) };
            ['setup', 'sprayed', 'handFinished', 'baked', 'steps', 'orders'].forEach(k => { p[k] += w[k]; });
            CATEGORIES.forEach(c => { p.byCategory[c] += w.byCategory[c]; });
            people.set(pk, p);
        });
        const hoursOf = new Map(); rows.filter(r => r.group === GROUP.FINISHING).forEach(r => hoursOf.set(r.pk, r.hours || 0));
        const crew = [...people.values()].map(p => ({ ...p, hours: hoursOf.get(p.pk) || 0 }))
            .map(p => ({ ...p, perHour: p.hours ? (p.sprayed + p.handFinished) / p.hours : null }))
            .sort((a, b) => (b.sprayed + b.handFinished + b.setup) - (a.sprayed + a.handFinished + a.setup));
        const crewHours = [...hoursOf.values()].reduce((t, h) => t + h, 0);
        const weekPieces = byDay.reduce((t, d) => t + d.total, 0);
        const orders = ordersBetween({ workOrders: wos, steps, recipes, typeOfCode, fromMs: wkFrom, toMs: wkTo, refOf: woRefOf });
        const mppWeek = minutesPerPieceOf({ steps, wosById, typeOfCode, fromMs: wkFrom, toMs: wkTo });
        const mppAll = minutesPerPieceOf({ steps, wosById, typeOfCode, fromMs, toMs: now + 1 });
        const oven = ovenByDayOf({ steps, fromMs: wkFrom, toMs: wkTo });
        const stations = stationsOf({ steps, wosById, typeOfCode, fromMs: wkFrom, toMs: wkTo });
        const prevStations = stationsOf({ steps, wosById, typeOfCode, fromMs: prevFrom, toMs: wkFrom });
        const spin = spinPeriodsOf({ steps, wosById, typeOfCode, nowMs: now });
        const worth = stepWorthOf({ steps, wosById, typeOfCode }).table;
        return { periods, byDay, prevByDay, crew, crewHours, weekPieces, orders, mppWeek, mppAll, oven, stations, prevStations, spin, worth };
    }, [wos, steps, recipes, typeOfCode, week, rows, nameOf, fromMs]);

    // ── the export ──
    const [busy, setBusy] = useState(false);
    const exportXlsx = async () => {
        setBusy(true);
        try {
            const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default;
            const wb = new ExcelJS.Workbook();
            const head = (ws, title, cols) => { ws.addRow([title]).font = { bold: true, size: 13 }; ws.addRow([`Exported ${new Date().toLocaleString('en-US')} by ${currentUser || ''} · finishing floor · a piece counts when its order is signed off the floor`]).font = { italic: true, size: 9 }; ws.addRow([]); const h = ws.addRow(cols); h.font = { bold: true }; h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEAE0' } }; }); };
            const P = R.periods;
            const fin = wb.addWorksheet('Finished');
            head(fin, 'Pieces finished', ['Category', 'Today spray', 'Today hand', 'Today total', 'This week spray', 'This week hand', 'This week total', 'Last week to this point', 'Change', 'Last week spray', 'Last week hand', 'Last week total']);
            CATEGORIES.forEach(k => { const c = (per) => P[per].byCategory[k]; fin.addRow([CATEGORY_LABEL[k], c('today').spray, c('today').hand, c('today').total, c('week').spray, c('week').hand, c('week').total, c('lastWeekToDate').total, c('week').total - c('lastWeekToDate').total, c('lastWeek').spray, c('lastWeek').hand, c('lastWeek').total]); });
            fin.addRow(['Total', sumOf(P.today, 'spray'), sumOf(P.today, 'hand'), P.today.total, sumOf(P.week, 'spray'), sumOf(P.week, 'hand'), P.week.total, P.lastWeekToDate.total, P.week.total - P.lastWeekToDate.total, sumOf(P.lastWeek, 'spray'), sumOf(P.lastWeek, 'hand'), P.lastWeek.total]).font = { bold: true };
            fin.addRow(['Orders', '', '', P.today.orders, '', '', P.week.orders, P.lastWeekToDate.orders, '', '', '', P.lastWeek.orders]);
            fin.columns.forEach((c, i) => { c.width = i ? 14 : 20; });
            const day = wb.addWorksheet('By day');
            head(day, `Day by day — week of ${week}`, ['Date', ...CATEGORIES.map(k => CATEGORY_LABEL[k]), 'Total', 'Orders', 'Same day, week before']);
            R.byDay.forEach((d, i) => day.addRow([d.date, ...CATEGORIES.map(k => d.byCategory[k]), d.total, d.orders, (R.prevByDay[i] || {}).total || 0]));
            day.columns.forEach((c, i) => { c.width = i ? 14 : 12; });
            const ppl = wb.addWorksheet('People');
            head(ppl, `Who did what — week of ${week} (a coat counts each time)`, ['Name', 'Set up', 'Sprayed', 'Hand-finished', 'Baked', 'Steps', 'Orders', ...CATEGORIES.map(k => CATEGORY_LABEL[k]), 'Clocked hours', 'Sprayed + hand per clocked hour']);
            R.crew.forEach(p => ppl.addRow([p.name, p.setup, p.sprayed, p.handFinished, p.baked, p.steps, p.orders, ...CATEGORIES.map(k => p.byCategory[k]), p.hours || '', p.perHour == null ? '' : Number(p.perHour.toFixed(1))]));
            ppl.columns.forEach((c, i) => { c.width = i ? 13 : 22; });
            const ord = wb.addWorksheet('Orders');
            head(ord, `Orders finished — week of ${week}`, ['Order', 'Finished', 'Pieces', 'Poles', 'Categories', 'Coats', 'Floor minutes', 'Hands-on minutes', 'Steps left running', 'Worked share']);
            R.orders.forEach(o => ord.addRow([o.ref, when(o.at), o.pieces, o.poles, o.categories.map(k => CATEGORY_LABEL[k]).join(', '), o.coats, o.floorMins == null ? '' : Math.round(o.floorMins), Math.round(o.handsOnMins), o.leftRunning, o.flow == null ? '' : Math.round(o.flow * 100) / 100]));
            ord.columns.forEach((c, i) => { c.width = [16, 22, 9, 9, 30, 8, 14, 16, 16, 13][i] || 12; });
            const per = wb.addWorksheet('Per piece');
            head(per, 'Minutes a piece — real punches only', ['Category', 'Kind', `Week of ${week} min/piece`, 'Week pieces', `${weeksBack} weeks min/piece`, `${weeksBack} weeks median`, `${weeksBack} weeks pieces`, `${weeksBack} weeks coats`]);
            ['sprayed', 'handFinished'].forEach(kind => CATEGORIES.forEach(k => { const w = R.mppWeek[kind][k], a = R.mppAll[kind][k]; if (!w && !a) return; per.addRow([CATEGORY_LABEL[k], kind === 'sprayed' ? 'Spray coat' : 'Hand finish', w ? Number(w.perPiece.toFixed(2)) : '', w ? w.pieces : '', a ? Number(a.perPiece.toFixed(2)) : '', a && a.median != null ? Number(a.median.toFixed(2)) : '', a ? a.pieces : '', a ? a.coats : '']); }));
            per.columns.forEach((c, i) => { c.width = i ? 16 : 20; });
            const stn = wb.addWorksheet('Stations');
            head(stn, `Who worked each station — week of ${week} and the week before`, ['Week', 'Station', 'Name', 'Days', 'Steps', 'Real steps', 'Pieces set up', 'Coats / pieces finished there', 'Real minutes', 'Orders']);
            [[week, R.stations], [addDays(week, -7), R.prevStations]].forEach(([w, x]) => x.people.forEach(p => stn.addRow([w, STATION_LABEL[p.station], nameOf(personKeyOf(p.who)), p.days, p.steps, p.real, p.setUp, p.coats, Math.round(p.mins), p.orders])));
            stn.columns.forEach((c, i) => { c.width = [12, 14, 20][i] || 13; });
            const sp = wb.addWorksheet('Spin machine');
            head(sp, 'The spin machine, day by day', ['Date', 'Sprays', 'Coats', 'Ring coats', 'Spraying (min)', 'First spray', 'Last spray', 'Who ran it', `No spray for 45 min or more`]);
            [...R.prevStations.spin, ...R.stations.spin].forEach(d => sp.addRow([d.date, d.sprays, d.coats, d.rings, Math.round(d.busyMins), clock(d.firstMs), clock(d.lastMs), d.operators.map(w => nameOf(personKeyOf(w))).join(', '), d.gaps.map(g => `${clock(g.fromMs)}–${clock(g.toMs)} (${Math.round(g.mins)} min)`).join('; ')]));
            sp.columns.forEach((c, i) => { c.width = [12, 8, 8, 10, 13, 11, 11, 26, 60][i] || 12; });
            const ov = wb.addWorksheet('Oven');
            head(ov, `Oven — week of ${week}`, ['Date', 'Loads', 'Busy minutes', 'First to last punch (min)', 'Busy share']);
            R.oven.forEach(d => ov.addRow([d.date, d.loads, Math.round(d.busyMins), Math.round(d.dayMins), d.busyShare == null ? '' : Math.round(d.busyShare * 100) / 100]));
            ov.columns.forEach(c => { c.width = 16; });
            const buf = await wb.xlsx.writeBuffer();
            const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
            const a = document.createElement('a'); a.href = url; a.download = `Floor_production_${week}.xlsx`; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            if (writeLog) writeLog(currentUser, 'System Admin', `Floor Metrics: production sheet exported for the week of ${week}`);
        } catch (e) { alert('Export failed: ' + (e.message || e)); }
        setBusy(false);
    };

    const P = R.periods;
    const ch = (now, before) => { const c = changeOf(now, before); const p = c.pct == null ? 0 : Math.round(Math.abs(c.pct) * 100); return !c.diff ? '=' : `${c.diff > 0 ? '▲' : '▼'} ${Math.abs(c.diff)}${p ? ` (${c.diff > 0 ? '+' : '−'}${p}%)` : ''}`; };
    const chColour = (now, before) => (now > before ? '#2e7d32' : now < before ? '#b08d57' : 'var(--ink-soft)');
    const flows = R.orders.map(o => o.flow);
    const unpunched = R.orders.filter(o => o.floorMins == null).length;

    return (
        <div style={box}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
                <h4 style={{ ...h4, margin: 0 }}>Production & capacity — finishing floor</h4>
                <button onClick={exportXlsx} disabled={busy || !week} style={{ ...btnLight, opacity: busy || !week ? 0.5 : 1 }}>Export (.xlsx)</button>
            </div>
            <p style={{ ...note, marginTop: '8px' }}>
                A piece counts when its order is signed off the floor; pick-only lines and lines not finished here do not. Spray or hand is the recipe the order ran, small parts and poles each their own. Finial collars count as finials.
                {partsNote ? <span style={{ color: '#b08d57' }}> {partsNote}</span> : null}
            </p>

            <h5 style={h5}>Pieces finished</h5>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                        <tr><th style={thL} /><th style={{ ...th, textAlign: 'center' }} colSpan={3}>Today</th><th style={{ ...th, textAlign: 'center' }} colSpan={3}>This week</th><th style={{ ...th, textAlign: 'center' }} colSpan={2}>vs last week, same point</th><th style={{ ...th, textAlign: 'center' }} colSpan={3}>Last week</th></tr>
                        <tr><th style={thL}>Category</th>{[0, 1].map(i => <React.Fragment key={i}><th style={th}>Spray</th><th style={th}>+ Hand</th><th style={th}>Total</th></React.Fragment>)}<th style={th}>Then</th><th style={th}>Change</th><th style={th}>Spray</th><th style={th}>+ Hand</th><th style={th}>Total</th></tr>
                    </thead>
                    <tbody>
                        {CATEGORIES.map(k => {
                            const c = (per) => P[per].byCategory[k];
                            return (
                                <tr key={k}>
                                    <td style={{ ...tdL, fontWeight: 500 }}>{CATEGORY_LABEL[k]}</td>
                                    {['today', 'week'].map(per => <React.Fragment key={per}><td style={td}>{c(per).spray}</td><td style={td}>{c(per).hand}</td><td style={{ ...td, fontWeight: 600 }}>{c(per).total}</td></React.Fragment>)}
                                    <td style={td}>{c('lastWeekToDate').total}</td>
                                    <td style={{ ...td, color: chColour(c('week').total, c('lastWeekToDate').total) }}>{ch(c('week').total, c('lastWeekToDate').total)}</td>
                                    <td style={td}>{c('lastWeek').spray}</td><td style={td}>{c('lastWeek').hand}</td><td style={{ ...td, fontWeight: 600 }}>{c('lastWeek').total}</td>
                                </tr>
                            );
                        })}
                        <tr style={{ background: 'var(--paper)' }}>
                            <td style={{ ...tdL, fontWeight: 700 }}>Total</td>
                            {['today', 'week'].map(per => <React.Fragment key={per}><td style={td}>{sumOf(P[per], 'spray')}</td><td style={td}>{sumOf(P[per], 'hand')}</td><td style={{ ...td, fontWeight: 700 }}>{P[per].total}</td></React.Fragment>)}
                            <td style={td}>{P.lastWeekToDate.total}</td>
                            <td style={{ ...td, color: chColour(P.week.total, P.lastWeekToDate.total) }}>{ch(P.week.total, P.lastWeekToDate.total)}</td>
                            <td style={td}>{sumOf(P.lastWeek, 'spray')}</td><td style={td}>{sumOf(P.lastWeek, 'hand')}</td><td style={{ ...td, fontWeight: 700 }}>{P.lastWeek.total}</td>
                        </tr>
                        <tr>
                            <td style={{ ...tdL, color: 'var(--ink-soft)' }}>Orders</td>
                            <td style={td} colSpan={3}>{P.today.orders}</td><td style={td} colSpan={3}>{P.week.orders}</td><td style={td}>{P.lastWeekToDate.orders}</td><td style={td} /><td style={td} colSpan={3}>{P.lastWeek.orders}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            {P.week.byName + P.lastWeek.byName > 0 && <p style={{ ...note, marginTop: '8px' }}>{P.week.byName} pieces this week and {P.lastWeek.byName} last week are placed by their name only — the line and the item master carry no type for them.</p>}
            <p style={{ ...note, marginTop: '8px', color: 'var(--ink)' }}>
                <strong>Spin machine — coats sprayed</strong> (ring coats among them), counted when sprayed, before any order is signed off: today <strong>{R.spin.today.coats}</strong> ({R.spin.today.rings}) · this week <strong>{R.spin.week.coats}</strong> ({R.spin.week.rings}) · last week to this point {R.spin.lastWeekToDate.coats} ({R.spin.lastWeekToDate.rings}) <span style={{ color: chColour(R.spin.week.coats, R.spin.lastWeekToDate.coats) }}>{ch(R.spin.week.coats, R.spin.lastWeekToDate.coats)}</span> · all last week {R.spin.lastWeek.coats} ({R.spin.lastWeek.rings}).
            </p>

            <h5 style={h5}>Day by day — week of {week}</h5>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead><tr><th style={thL}>Day</th>{CATEGORIES.map(k => <th key={k} style={th}>{CATEGORY_LABEL[k]}</th>)}<th style={th}>Total</th><th style={th}>Orders</th><th style={th}>Same day, week before</th></tr></thead>
                    <tbody>
                        {R.byDay.map((d, i) => {
                            const before = (R.prevByDay[i] || {}).total || 0;
                            return (
                                <tr key={d.date}>
                                    <td style={{ ...tdL, fontWeight: 500 }}>{dayName(d.date)}</td>
                                    {CATEGORIES.map(k => <td key={k} style={td}>{d.byCategory[k] || '·'}</td>)}
                                    <td style={{ ...td, fontWeight: 600 }}>{d.total}</td><td style={td}>{d.orders}</td>
                                    <td style={{ ...td, color: 'var(--ink-soft)' }}>{before}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <h5 style={h5}>Who did what — week of {week}</h5>
            <p style={note}>From the floor's punches. A coat counts each time — two coats of 140 rings is 280 sprayed; a spin job in loads counts the load. The category columns are the coats they put on (sprayed + hand-finished), split by each order's own mix.</p>
            {!R.crew.length ? <div style={note}>No floor punches this week.</div> : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead><tr><th style={thL}>Name</th><th style={th}>Set up</th><th style={th}>Sprayed</th><th style={th}>Hand-finished</th><th style={th}>Baked</th><th style={th}>Orders</th>{CATEGORIES.map(k => <th key={k} style={th}>{CATEGORY_LABEL[k]}</th>)}<th style={th}>Clocked</th><th style={th} title="Pieces sprayed plus pieces hand-finished, per clocked hour">Per clocked hour</th></tr></thead>
                        <tbody>
                            {R.crew.map(p => (
                                <tr key={p.pk}>
                                    <td style={{ ...tdL, fontWeight: 500 }}>{p.name}</td>
                                    <td style={td}>{p.setup || '·'}</td><td style={td}>{p.sprayed || '·'}</td><td style={td}>{p.handFinished || '·'}</td><td style={td}>{p.baked || '·'}</td><td style={td}>{p.orders}</td>
                                    {CATEGORIES.map(k => <td key={k} style={{ ...td, color: 'var(--ink-soft)' }}>{p.byCategory[k] || '·'}</td>)}
                                    <td style={td}>{p.hours ? `${p.hours.toFixed(1)} h` : '—'}</td>
                                    <td style={td}>{dec(p.perHour)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            <p style={{ ...note, marginTop: '8px' }}>
                Crew: {R.weekPieces} pieces finished{R.crewHours ? ` over ${R.crewHours.toFixed(1)} clocked hours — ${dec(R.weekPieces / R.crewHours)} pieces per crew hour` : ' — pieces per crew hour needs the time clock for this week'}.
            </p>

            <h5 style={h5}>Stations — who worked each, week of {week} and the week before</h5>
            <p style={note}>Coats count each time, at the station they were sprayed or hand-finished (a pole's hand coat is the hand bench's); set up is the pieces loaded for that station. Real minutes are the punches the floor's check accepts.</p>
            {(() => {
                const by = new Map();
                [['now', R.stations], ['before', R.prevStations]].forEach(([k, x]) => x.people.forEach(p => { const id = `${p.station}|${personKeyOf(p.who)}`; const o = by.get(id) || { station: p.station, pk: personKeyOf(p.who) }; o[k] = p; by.set(id, o); }));
                const list = [...by.values()].sort((a, b) => STATIONS.indexOf(a.station) - STATIONS.indexOf(b.station) || ((b.now || {}).coats || 0) - ((a.now || {}).coats || 0) || ((b.before || {}).coats || 0) - ((a.before || {}).coats || 0));
                const cells = (p) => (p ? [p.days, p.steps, p.setUp || '·', p.coats || '·', Math.round(p.mins)] : ['·', '·', '·', '·', '·']);
                return !list.length ? <div style={note}>No floor punches in these two weeks.</div> : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                            <thead>
                                <tr><th style={thL} /><th style={thL} /><th style={{ ...th, textAlign: 'center' }} colSpan={5}>Week of {week}</th><th style={{ ...th, textAlign: 'center' }} colSpan={5}>Week before</th></tr>
                                <tr><th style={thL}>Station</th><th style={thL}>Name</th>{[0, 1].map(i => <React.Fragment key={i}><th style={th}>Days</th><th style={th}>Steps</th><th style={th}>Set up</th><th style={th}>Coats</th><th style={th}>Real min</th></React.Fragment>)}</tr>
                            </thead>
                            <tbody>
                                {list.map((o, i) => (
                                    <tr key={o.station + o.pk} style={{ borderTop: i && list[i - 1].station !== o.station ? '2px solid var(--line)' : undefined }}>
                                        <td style={{ ...tdL, fontWeight: 500 }}>{!i || list[i - 1].station !== o.station ? STATION_LABEL[o.station] : ''}</td>
                                        <td style={tdL}>{nameOf(o.pk)}</td>
                                        {cells(o.now).map((v, j) => <td key={'n' + j} style={{ ...td, fontWeight: j === 3 ? 600 : 400 }}>{v}</td>)}
                                        {cells(o.before).map((v, j) => <td key={'b' + j} style={{ ...td, color: 'var(--ink-soft)' }}>{v}</td>)}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            })()}

            <h5 style={h5}>Who ran each station, day by day</h5>
            <p style={note}>Coats each person put on at each station, that day (steps in brackets).</p>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead><tr><th style={thL}>Day</th>{STATIONS.map(k => <th key={k} style={thL}>{STATION_LABEL[k]}</th>)}</tr></thead>
                    <tbody>
                        {[...R.prevStations.days, ...R.stations.days].map(d => (
                            <tr key={d.date} style={{ background: d.date >= week ? 'transparent' : 'var(--paper)' }}>
                                <td style={{ ...tdL, fontWeight: 500 }}>{dayName(d.date)}</td>
                                {STATIONS.map(k => <td key={k} style={{ ...tdL, whiteSpace: 'normal' }}>{(d.stations[k] || []).map(x => `${nameOf(personKeyOf(x.who))} ${x.coats} (${x.steps})`).join(' · ') || <span style={{ color: 'var(--ink-soft)' }}>·</span>}</td>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <h5 style={h5}>The spin machine, day by day</h5>
            <p style={note}>Its sprays and coats, how long it was spraying, first to last spray, who ran it, and every stretch of 45 minutes or more with no spray (a bake between coats, lunch, or the machine standing).</p>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead><tr><th style={thL}>Day</th><th style={th}>Sprays</th><th style={th}>Coats</th><th style={th}>Ring coats</th><th style={th}>Spraying</th><th style={thL}>First – last spray</th><th style={thL}>Who ran it</th><th style={thL}>No spray for 45 min or more</th></tr></thead>
                    <tbody>
                        {[...R.prevStations.spin, ...R.stations.spin].map(d => (
                            <tr key={d.date} style={{ background: d.date >= week ? 'transparent' : 'var(--paper)' }}>
                                <td style={{ ...tdL, fontWeight: 500 }}>{dayName(d.date)}</td>
                                <td style={td}>{d.sprays}</td><td style={{ ...td, fontWeight: 600 }}>{d.coats}</td><td style={td}>{d.rings}</td><td style={td}>{mins(d.busyMins)}</td>
                                <td style={tdL}>{clock(d.firstMs)} – {clock(d.lastMs)}</td>
                                <td style={tdL}>{d.operators.map(w => nameOf(personKeyOf(w))).join(', ')}</td>
                                <td style={{ ...tdL, whiteSpace: 'normal', color: 'var(--ink-soft)' }}>{d.gaps.map(g => `${clock(g.fromMs)}–${clock(g.toMs)} (${mins(g.mins)})`).join(' · ') || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <h5 style={h5}>What a step is worth in the production score</h5>
            <p style={note}>The crew's usual time for each step at each station, for a batch that size — the median of the real punches over the {weeksBack} weeks (how many in brackets). Production counts every step a person did at this worth; a size with fewer than {WORTH_MIN_REAL} real punches (grey) counts the floor's own standard for that step instead.</p>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead><tr><th style={thL}>Step</th>{SIZE_BANDS.map(b => <th key={b.label} style={th}>{b.label} pcs</th>)}</tr></thead>
                    <tbody>
                        {Object.entries(STEP_WORTH_LABEL).filter(([k]) => R.worth.some(t => `${t.task}|${t.station}` === k)).map(([k, label]) => (
                            <tr key={k}>
                                <td style={{ ...tdL, fontWeight: 500 }}>{label}</td>
                                {SIZE_BANDS.map(b => { const t = R.worth.find(x => x.key === `${k}|${b.label}`); return <td key={b.label} style={{ ...td, color: t && t.n >= WORTH_MIN_REAL ? 'var(--ink)' : 'var(--ink-soft)' }}>{t ? `${mins(t.mins)} (${t.n})` : '·'}</td>; })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {stationRates && (
                <p style={{ ...note, marginTop: '8px' }}>
                    A usual full day earns (six hours or more on the floor, most of it at the one station): {STATIONS.map(st => `${STATION_LABEL[st]} ${pct(stationRates[st])}${stationRates[`${st}Days`] >= 3 ? ` (${stationRates[`${st}Days`]} days)` : ' (too few full days — every full day\'s usual)'}`).join(' · ')}. The spin waits on its oven between coats, so it earns least of a day — production holds each station to its own.
                </p>
            )}

            <h5 style={h5}>Orders finished — week of {week}</h5>
            <p style={note}>
                On the floor is clock time from the first punch on the order to its sign-off, nights and weekends included; hands-on is the minutes someone was on it (a step left running counts its standard); worked share is hands-on over floor time — the rest of the time it was waiting, baking or between steps.
                {R.orders.length ? <> Medians: <strong>{mins(median(R.orders.map(o => o.floorMins)))}</strong> on the floor, <strong>{mins(median(R.orders.filter(o => o.floorMins != null).map(o => o.handsOnMins)))}</strong> hands-on, <strong>{pct(median(flows))}</strong> worked, <strong>{median(R.orders.map(o => o.pieces))}</strong> pieces an order.</> : null}
                {unpunched ? <> {unpunched} of the {R.orders.length} orders have no floor punch in the history — their time is not known and they are left out of the time medians.</> : null}
            </p>
            {!R.orders.length ? <div style={note}>No orders finished this week.</div> : (
                <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto', border: '1px solid var(--line)' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#fff' }}><tr><th style={thL}>Order</th><th style={thL}>Finished</th><th style={th}>Pieces</th><th style={th}>Poles</th><th style={thL}>What</th><th style={th}>Coats</th><th style={th}>On the floor</th><th style={th}>Hands-on</th><th style={th}>Worked</th></tr></thead>
                        <tbody>
                            {R.orders.map(o => (
                                <tr key={o.woId}>
                                    <td style={{ ...tdL, fontFamily: 'var(--mono)' }}>{o.ref}</td>
                                    <td style={tdL}>{when(o.at)}</td>
                                    <td style={td}>{o.pieces}</td><td style={td}>{o.poles || '·'}</td>
                                    <td style={{ ...tdL, color: 'var(--ink-soft)' }}>{o.categories.map(k => CATEGORY_LABEL[k]).join(', ')}</td>
                                    <td style={td}>{o.coats || '—'}</td>
                                    <td style={td}>{mins(o.floorMins)}</td>
                                    <td style={td}>{mins(o.handsOnMins)}{o.leftRunning ? <span style={{ color: 'var(--ink-soft)' }} title="Steps left running — counted at their standard"> · {o.leftRunning} est.</span> : null}</td>
                                    <td style={td}>{pct(o.flow)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <h5 style={h5}>Minutes a piece — real punches only</h5>
            <p style={note}>Each coat's minutes over the pieces it covered, by the order's main category. Punches the floor's check calls not real, and steps left running, are left out.</p>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                    <thead><tr><th style={thL}>Category</th><th style={thL}>Step</th><th style={th}>Week of {week}</th><th style={th}>pieces</th><th style={th}>{weeksBack} weeks</th><th style={th}>median coat</th><th style={th}>pieces</th><th style={th}>coats</th></tr></thead>
                    <tbody>
                        {['sprayed', 'handFinished'].flatMap(kind => CATEGORIES.map(k => {
                            const w = R.mppWeek[kind][k], a = R.mppAll[kind][k];
                            if (!w && !a) return null;
                            return (
                                <tr key={kind + k}>
                                    <td style={{ ...tdL, fontWeight: 500 }}>{CATEGORY_LABEL[k]}</td>
                                    <td style={tdL}>{kind === 'sprayed' ? 'Spray coat' : 'Hand finish'}</td>
                                    <td style={td}>{w ? `${dec(w.perPiece, 2)} min` : '—'}</td><td style={{ ...td, color: 'var(--ink-soft)' }}>{w ? w.pieces : ''}</td>
                                    <td style={{ ...td, fontWeight: 600 }}>{a ? `${dec(a.perPiece, 2)} min` : '—'}</td><td style={td}>{a && a.median != null ? `${dec(a.median, 2)} min` : '—'}</td>
                                    <td style={{ ...td, color: 'var(--ink-soft)' }}>{a ? a.pieces : ''}</td><td style={{ ...td, color: 'var(--ink-soft)' }}>{a ? a.coats : ''}</td>
                                </tr>
                            );
                        }).filter(Boolean))}
                    </tbody>
                </table>
            </div>

            <h5 style={h5}>The oven — week of {week}</h5>
            {!R.oven.length ? <div style={note}>No floor punches this week.</div> : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                        <thead><tr><th style={thL}>Day</th><th style={th}>Loads</th><th style={th}>Busy</th><th style={th}>First to last punch</th><th style={th}>Busy share</th></tr></thead>
                        <tbody>
                            {R.oven.map(d => (
                                <tr key={d.date}><td style={{ ...tdL, fontWeight: 500 }}>{dayName(d.date)}</td><td style={td}>{d.loads}</td><td style={td}>{mins(d.busyMins)}</td><td style={td}>{mins(d.dayMins)}</td><td style={td}>{pct(d.busyShare)}</td></tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
