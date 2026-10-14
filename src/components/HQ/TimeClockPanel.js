// ⏱ TIME CLOCK & PAYROLL — HQ → System Admin, admins only (Stuart 2026-10-13 / 10-14, phase 4). The pay period (two weeks,
// Monday → Sunday, from Monday 2026-10-12), person by person: every day's clock in · lunch out · lunch in · clock out, each
// week's hours with those over 40 broken out, the missed punches that need correcting — and the Excel sheet for payroll.
// Corrections never edit or delete: a missing punch is ADDED and a wrong one VOIDED, each with who and why; the raw
// punches stay and print on the sheet. Reads time_punches (admin-only by the Firestore rules) and the Floor Metrics name
// map for employee numbers; writes only a correction, a void, or the conversion date. The rules: Shared/timeClock.
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { PUNCH, PUNCH_LABEL, payPeriodFrom, payrollOf, punchTimeOf, correctionOf, voidPatchOf } from '../Shared/timeClock';
import { dateKeyOf, addDays, dayStartOf } from '../Shared/timecardImport';
import { personKeyOf } from '../Shared/floorMetrics';

const box = { background: '#fff', border: '1px solid var(--line)', padding: '20px', marginBottom: '20px' };
const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)' };
const btn = { padding: '9px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' };
const btnLight = { ...btn, background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)' };
const th = { padding: '8px 6px', borderBottom: '1px solid var(--line)', textAlign: 'left', ...mono, whiteSpace: 'nowrap' };
const td = { padding: '8px 6px', borderBottom: '1px solid var(--line)', fontSize: '0.85rem', verticalAlign: 'top', whiteSpace: 'nowrap' };
const t12 = (ms) => (ms ? new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '');
const dayName = (k) => new Date(`${k}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const firstOf = (punches, kind) => { const p = punches.filter(x => !x.void && x.kind === kind).map(punchTimeOf).sort((a, b) => a - b)[0]; return p || null; };
const RULES_OFF = 'The time clock\'s security rules are not deployed yet, so punches cannot be read here. Deploy them from Cloud Shell: git pull, then firebase deploy --only firestore:rules --project ce-m2c-design-collab';

export default function TimeClockPanel({ currentUser, writeLog }) {
    const today = dateKeyOf(Date.now());
    const [offset, setOffset] = useState(0);
    const period = useMemo(() => payPeriodFrom(today, offset), [today, offset]);
    const [punches, setPunches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [nameMap, setNameMap] = useState({});
    const [people, setPeople] = useState([]);
    const [conversion, setConversion] = useState('');
    const [convDraft, setConvDraft] = useState('');
    const [open, setOpen] = useState({});
    const [form, setForm] = useState({ name: '', date: today, time: '07:00', kind: PUNCH.IN, reason: '' });
    const [busy, setBusy] = useState(false);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        (async () => {
            try {
                const [m, c, d] = await Promise.all([getDoc(doc(db, 'hq_config', 'floor_metrics')), getDoc(doc(db, 'hq_config', 'time_clock')), getDocs(collection(db, 'directory'))]);
                setNameMap((m.exists() && m.data().map) || {});
                const conv = (c.exists() && c.data().conversionDate) || '';
                setConversion(conv); setConvDraft(conv);
                setPeople(d.docs.map(x => x.data()).filter(x => x && x.name).map(x => x.name).sort((a, b) => a.localeCompare(b)));
            } catch (e) { /* the name map and directory are optional here */ }
        })();
    }, []);
    useEffect(() => {
        let live = true;
        (async () => {
            setLoading(true); setError('');
            try {
                const from = dayStartOf(period.start) - 24 * 3600000, to = dayStartOf(addDays(period.end, 2));
                const s = await getDocs(query(collection(db, 'time_punches'), where('at', '>=', from), where('at', '<', to)));
                if (live) setPunches(s.docs.map(x => ({ id: x.id, ...x.data() })));
            } catch (e) { if (live) setError(String(e.code || e.message).includes('permission') ? RULES_OFF : (e.message || String(e))); }
            if (live) setLoading(false);
        })();
        return () => { live = false; };
    }, [period.start, period.end, reload]);

    const numberOf = (name) => nameMap[personKeyOf(name)] || '';
    const rows = useMemo(() => payrollOf({ punches, period, numberOf, todayKey: today }), [punches, period, nameMap, today]); // eslint-disable-line react-hooks/exhaustive-deps
    const toFix = rows.flatMap(r => r.days.filter(d => d.warnings.length).map(d => ({ name: r.name, ...d })));

    const addPunch = async (f) => {
        if (!f.name || !f.date || !f.time || !f.kind) return alert('Who, which day, what time and which punch.');
        if (!String(f.reason || '').trim()) return alert('A reason is needed — it prints on the payroll sheet.');
        const [h, mi] = f.time.split(':').map(Number);
        const [y, mo, d] = f.date.split('-').map(Number);
        const atMs = new Date(y, mo - 1, d, h, mi).getTime();
        setBusy(true);
        try {
            await addDoc(collection(db, 'time_punches'), { ...correctionOf({ name: f.name, kind: f.kind, atMs, by: currentUser, reason: f.reason }), t: serverTimestamp() });
            if (writeLog) writeLog(currentUser, 'System Admin', `Time clock: added ${PUNCH_LABEL[f.kind].en} for ${f.name} on ${f.date} ${f.time} — ${f.reason}`);
            setForm(x => ({ ...x, reason: '' })); setReload(n => n + 1);
        } catch (e) { alert(String(e.code || e.message).includes('permission') ? RULES_OFF : 'Not saved: ' + (e.message || e)); }
        setBusy(false);
    };
    const voidPunch = async (p, name) => {
        const reason = window.prompt(`Void ${PUNCH_LABEL[p.kind].en} ${t12(punchTimeOf(p))} for ${name}?\n\nThe punch stays on record, marked void, with your name and this reason:`);
        if (reason === null) return;
        if (!reason.trim()) return alert('A reason is needed — nothing was changed.');
        setBusy(true);
        try {
            await updateDoc(doc(db, 'time_punches', p.id), voidPatchOf({ by: currentUser, reason, nowMs: Date.now() }));
            if (writeLog) writeLog(currentUser, 'System Admin', `Time clock: voided ${PUNCH_LABEL[p.kind].en} ${dateKeyOf(punchTimeOf(p))} ${t12(punchTimeOf(p))} for ${name} — ${reason}`);
            setReload(n => n + 1);
        } catch (e) { alert('Not saved: ' + (e.message || e)); }
        setBusy(false);
    };
    const saveConversion = async () => {
        try {
            await setDoc(doc(db, 'hq_config', 'time_clock'), { conversionDate: convDraft, updatedBy: currentUser || '', updatedAt: Date.now() }, { merge: true });
            setConversion(convDraft);
            if (writeLog) writeLog(currentUser, 'System Admin', `Time clock: conversion date set to ${convDraft || '(none)'}`);
        } catch (e) { alert('Not saved: ' + (e.message || e)); }
    };

    const exportXlsx = async () => {
        setBusy(true);
        try {
            const ExcelJS = (await import('exceljs/dist/exceljs.min.js')).default;
            const wb = new ExcelJS.Workbook();
            const title = `Payroll ${period.start} → ${period.end}`;
            const head = (ws, cols) => { ws.addRow([title]).font = { bold: true, size: 13 }; ws.addRow([`Exported ${new Date().toLocaleString('en-US')} by ${currentUser || ''} · hours exact to the minute · over 40 = hours past 40 in the week (Mon–Sun)`]).font = { italic: true, size: 9 }; ws.addRow([]); const h = ws.addRow(cols); h.font = { bold: true }; h.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEAE0' } }; }); };
            const sum = wb.addWorksheet('Summary');
            head(sum, ['Employee #', 'Name', `Week of ${period.start} hours`, 'Regular', 'Over 40', `Week of ${addDays(period.start, 7)} hours`, 'Regular', 'Over 40', 'Period regular', 'Period over 40', 'Period total', 'Missed punches']);
            rows.forEach(r => sum.addRow([r.number, r.name, r.weeks[0].hours, r.weeks[0].regular, r.weeks[0].overtime, r.weeks[1].hours, r.weeks[1].regular, r.weeks[1].overtime, r.regular, r.overtime, r.hours, r.warnings]));
            sum.columns.forEach((c, i) => { c.width = i === 1 ? 24 : 14; });
            const daily = wb.addWorksheet('Daily');
            head(daily, ['Employee #', 'Name', 'Date', 'Day', 'Clock in', 'Lunch out', 'Lunch in', 'Clock out', 'Lunch (min)', 'Hours', 'Missed punches']);
            rows.forEach(r => r.days.forEach(d => daily.addRow([r.number, r.name, d.date, dayName(d.date), t12(firstOf(d.punches, PUNCH.IN)), t12(firstOf(d.punches, PUNCH.LUNCH_OUT)), t12(firstOf(d.punches, PUNCH.LUNCH_IN)), t12(d.outMs), d.lunchMins, d.hours, d.warnings.join('; ')])));
            daily.columns.forEach((c, i) => { c.width = [12, 24, 12, 14, 11, 11, 11, 11, 11, 9, 30][i] || 12; });
            const raw = wb.addWorksheet('Punches');
            head(raw, ['Employee #', 'Name', 'Date', 'Time', 'Punch', 'Source', 'Corrected by', 'Reason', 'Void', 'Voided by', 'Void reason']);
            rows.forEach(r => r.days.forEach(d => d.punches.slice().sort((a, b) => punchTimeOf(a) - punchTimeOf(b)).forEach(p => raw.addRow([r.number, r.name, d.date, t12(punchTimeOf(p)), PUNCH_LABEL[p.kind] ? PUNCH_LABEL[p.kind].en : p.kind, p.source === 'admin' ? 'correction' : 'clock', p.by || '', p.reason || '', p.void ? 'VOID' : '', p.voidBy || '', p.voidReason || '']))));
            raw.columns.forEach((c, i) => { c.width = [12, 24, 12, 10, 12, 11, 16, 30, 6, 16, 30][i] || 12; });
            const buf = await wb.xlsx.writeBuffer();
            const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
            const a = document.createElement('a'); a.href = url; a.download = `Payroll_${period.start}_${period.end}.xlsx`; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            if (writeLog) writeLog(currentUser, 'System Admin', `Time clock: payroll sheet exported for ${period.start} → ${period.end}`);
        } catch (e) { alert('Export failed: ' + (e.message || e)); }
        setBusy(false);
    };

    // a render function, not a component — a component defined here would remount (and drop focus) on every keystroke
    const punchForm = (fixed) => (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' }}>
            {!fixed && <select value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ padding: '6px' }}><option value="">— who —</option>{people.map(n => <option key={n} value={n}>{n}</option>)}</select>}
            {!fixed && <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={{ padding: '5px' }} />}
            <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} style={{ padding: '6px' }}>{Object.values(PUNCH).map(k => <option key={k} value={k}>{PUNCH_LABEL[k].en}</option>)}</select>
            <input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} style={{ padding: '5px' }} />
            <input placeholder="reason (prints on the sheet)" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} style={{ padding: '6px', width: '240px' }} />
            <button disabled={busy} onClick={() => addPunch(fixed ? { ...form, ...fixed } : form)} style={btn}>Add punch</button>
        </div>
    );

    return (
        <div style={{ padding: '30px 40px' }}>
            <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '24px' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Time Clock & Payroll</h3>
                <p style={{ margin: '8px 0 0 0', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                    Punches from the time clock (hub → Time Clock, any tablet): clock in · lunch out · lunch in · clock out. Two-week pay periods from Monday Oct 12; hours over 40 in a week (Mon–Sun) broken out. A missed punch is added, a wrong one voided — each with who and why; nothing is edited or deleted. Admins only.
                </p>
            </div>

            <div style={{ ...box, display: 'flex', gap: '20px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                    <div style={mono}>Pay period</div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                        <button onClick={() => setOffset(o => o - 1)} style={btnLight}>◀</button>
                        <strong style={{ fontSize: '1rem', minWidth: '230px', textAlign: 'center' }}>{dayName(period.start)} → {dayName(period.end)}</strong>
                        <button onClick={() => setOffset(o => o + 1)} style={btnLight}>▶</button>
                        {offset !== 0 && <button onClick={() => setOffset(0)} style={btnLight}>This period</button>}
                    </div>
                </div>
                <div>
                    <div style={mono}>Conversion date — the app's clock is payroll from</div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                        <input type="date" value={convDraft} onChange={e => setConvDraft(e.target.value)} style={{ padding: '6px' }} />
                        <button onClick={saveConversion} disabled={convDraft === conversion} style={{ ...btnLight, opacity: convDraft === conversion ? 0.5 : 1 }}>Save</button>
                    </div>
                </div>
                <button onClick={exportXlsx} disabled={busy || loading || !!error} style={{ ...btn, marginLeft: 'auto', opacity: busy || loading || error ? 0.5 : 1 }}>⬇ Payroll sheet (.xlsx)</button>
            </div>
            <div style={{ ...box, background: 'var(--paper)', fontSize: '0.9rem' }}>
                {conversion
                    ? (period.end < conversion
                        ? <>Before the conversion date ({conversion}) — the current time clock is still payroll; this period is a <strong>parallel run</strong> to check the app's clock against it.</>
                        : <>From {conversion} the app's clock <strong>is payroll</strong>.</>)
                    : <>No conversion date set — the app's clock runs alongside the current one until a date is set.</>}
            </div>

            {error && <div style={{ ...box, borderColor: '#c62828', color: '#c62828' }}>{error}</div>}
            {loading && <div style={box}>Reading the punches…</div>}

            {!loading && !error && (<>
                <div style={{ ...box, borderColor: toFix.length ? '#c62828' : 'var(--line)' }}>
                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', marginBottom: '8px' }}>{toFix.length ? `⚠ ${toFix.length} day${toFix.length === 1 ? '' : 's'} with missed punches to correct` : '✓ No missed punches this period'}</div>
                    {toFix.map((d, i) => <div key={i} style={{ fontSize: '0.88rem', padding: '3px 0' }}><strong>{d.name}</strong> · {dayName(d.date)} — <span style={{ color: '#c62828' }}>{d.warnings.join(', ')}</span> <button onClick={() => setOpen(o => ({ ...o, [d.name]: true }))} style={{ ...btnLight, padding: '2px 8px', marginLeft: '8px' }}>Open</button></div>)}
                    <div style={{ marginTop: '12px', ...mono }}>Add a punch for anyone (e.g. a day with no punch at all)</div>
                    {punchForm()}
                </div>

                <div style={box}>
                    {!rows.length ? <div style={{ color: 'var(--ink-soft)' }}>No punches in this period yet.</div> : (
                        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                            <thead><tr>
                                <th style={th}>Name</th><th style={th}>Emp #</th>
                                <th style={th}>Wk of {period.start.slice(5)}</th><th style={th}>Over 40</th>
                                <th style={th}>Wk of {addDays(period.start, 7).slice(5)}</th><th style={th}>Over 40</th>
                                <th style={th}>Regular</th><th style={th}>Over 40</th><th style={th}>Total</th><th style={th}>Missed</th><th style={th}></th>
                            </tr></thead>
                            <tbody>
                                {rows.map(r => (
                                    <React.Fragment key={r.name}>
                                        <tr>
                                            <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                                            <td style={td}>{r.number || <span style={{ color: '#c62828' }} title="No employee number — set it in Floor Metrics → name map">—</span>}</td>
                                            <td style={td}>{r.weeks[0].hours.toFixed(2)}</td><td style={{ ...td, color: r.weeks[0].overtime ? '#b26a00' : 'var(--ink-soft)' }}>{r.weeks[0].overtime.toFixed(2)}</td>
                                            <td style={td}>{r.weeks[1].hours.toFixed(2)}</td><td style={{ ...td, color: r.weeks[1].overtime ? '#b26a00' : 'var(--ink-soft)' }}>{r.weeks[1].overtime.toFixed(2)}</td>
                                            <td style={td}>{r.regular.toFixed(2)}</td><td style={td}>{r.overtime.toFixed(2)}</td><td style={{ ...td, fontWeight: 600 }}>{r.hours.toFixed(2)}</td>
                                            <td style={{ ...td, color: r.warnings ? '#c62828' : 'var(--ink-soft)' }}>{r.warnings || '—'}</td>
                                            <td style={td}><button onClick={() => setOpen(o => ({ ...o, [r.name]: !o[r.name] }))} style={{ ...btnLight, padding: '3px 10px' }}>{open[r.name] ? 'Hide' : 'Days'}</button></td>
                                        </tr>
                                        {open[r.name] && (
                                            <tr><td colSpan={11} style={{ ...td, background: 'var(--paper)', whiteSpace: 'normal' }}>
                                                {r.days.map(d => (
                                                    <div key={d.date} style={{ padding: '8px 0', borderBottom: '1px dashed var(--line)' }}>
                                                        <strong>{dayName(d.date)}</strong> · {d.hours.toFixed(2)} h{d.lunchMins ? ` · lunch ${d.lunchMins} min` : ''}
                                                        {d.warnings.length ? <span style={{ color: '#c62828' }}> · ⚠ {d.warnings.join(', ')}</span> : null}
                                                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                                                            {d.punches.slice().sort((a, b) => punchTimeOf(a) - punchTimeOf(b)).map(p => (
                                                                <span key={p.id} title={p.source === 'admin' ? `added by ${p.by}: ${p.reason}` : 'from the clock'} style={{ fontSize: '0.82rem', border: `1px solid ${p.void ? 'var(--line)' : p.source === 'admin' ? '#b08d57' : 'var(--ink)'}`, padding: '3px 8px', textDecoration: p.void ? 'line-through' : 'none', color: p.void ? 'var(--ink-soft)' : 'var(--ink)' }}>
                                                                    {PUNCH_LABEL[p.kind] ? PUNCH_LABEL[p.kind].en : p.kind} {t12(punchTimeOf(p))}{p.source === 'admin' ? ' ✎' : ''}{p.void ? ` (void: ${p.voidReason})` : ''}
                                                                    {!p.void && <button onClick={() => voidPunch(p, r.name)} disabled={busy} style={{ marginLeft: '6px', border: 'none', background: 'transparent', color: '#c62828', cursor: 'pointer', fontSize: '0.75rem' }}>void</button>}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        {punchForm({ name: r.name, date: d.date })}
                                                    </div>
                                                ))}
                                            </td></tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </>)}
        </div>
    );
}
