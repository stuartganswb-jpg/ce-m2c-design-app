// 🏆 FLOOR METRICS — HQ → System Admin, admins only (Stuart 2026-10-14, phase 1 of the metrics + wallboard work).
// How each person on the finishing floor and the pick / pack bench worked, week by week, from the history the
// app keeps (Shared/floorMetrics) and the time clock's export dropped here (Shared/timecardImport). The export is
// read in this browser and NEVER stored — payroll hours are admin-only (Stuart 2026-10-13). Two writes, each on
// a button: the name map (app name → time-clock employee number, and which board a person is ranked on) to
// hq_config/floor_metrics; and "Publish to wallboard" — names, scores and the facts behind them, NO hours — to
// fin_config/wallboard, which the floor's and the WMS's screens may read. Nothing else is written: no order,
// no floor document, no RTG, WMS or NetSuite record.
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, where } from 'firebase/firestore';
import { timecardDaysOf, mergeTimecardDays, timecardPeopleOf, weekKeyOf, addDays, dateKeyOf, dayStartOf } from '../Shared/timecardImport';
import {
    floorTimersOf, floorStepsOf, activityOf, clockIndexOf, personDaysOf, weekRowsOf, rankWeek, wallboardDocOf, weeksOf,
    boardOfRole, personKeyOf, standardsCheckOf, GROUP, GROUP_LABEL, SCORE_PARTS, RANK_MIN,
} from '../Shared/floorMetrics';
import { choreIntervalsOf } from '../Shared/floorChores';

const box = { background: '#fff', border: '1px solid var(--line)', padding: '20px', marginBottom: '20px' };
const h4 = { margin: '0 0 12px 0', fontFamily: 'var(--serif)', fontSize: '1.3rem', fontWeight: 500 };
const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)' };
const btn = { padding: '10px 18px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' };
const btnLight = { ...btn, background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)' };
const th = { padding: '8px 6px', borderBottom: '1px solid var(--line)', textAlign: 'left', ...mono, whiteSpace: 'nowrap' };
const td = { padding: '8px 6px', borderBottom: '1px solid var(--line)', fontSize: '0.85rem', verticalAlign: 'top', whiteSpace: 'nowrap' };

const mins = (m) => (m == null ? '—' : m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`);
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const scoreColour = (s) => (s == null ? 'var(--ink-soft)' : s >= 75 ? '#2e7d32' : s >= 50 ? '#b08d57' : '#c62828');
const WEEKS_BACK = [4, 6, 8, 12];
const STEP_LABEL = { spinSetup: 'Sled setup', spinSpray: 'Spray coat', spinBake: 'Bake', poleSpray: 'Pole spray', poleBake: 'Pole bake', hand: 'Hand finish', poleHand: 'Pole hand finish' };
const STANDARD_SETTING = { spinSetup: 'Spin Setup (load sled)', spinSpray: 'Spin Paint (per step)', spinBake: 'Oven Bake (per step)', poleBake: 'Oven Bake (per step)', poleSpray: 'Pole Paint (Per Piece) × poles', hand: 'Hand Finish (Small) × pieces', poleHand: 'Hand Finish (Pole) × poles' };   // the labels Production Times shows

export default function FloorMetricsPanel({ currentUser, writeLog }) {
    const [weeksBack, setWeeksBack] = useState(6);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [data, setData] = useState({ wos: [], finLogs: [], hqLogs: [], people: [], settings: {} });
    const [cfg, setCfg] = useState({ map: {}, groups: {} });
    const [draft, setDraft] = useState({ map: {}, groups: {} });
    const [timecards, setTimecards] = useState([]);      // the dropped exports — this browser only, never stored
    const [fileNote, setFileNote] = useState('');
    const [week, setWeek] = useState('');
    const [busy, setBusy] = useState(false);
    const [showMap, setShowMap] = useState(false);

    const fromKey = useMemo(() => addDays(weekKeyOf(dateKeyOf(Date.now())), -7 * (weeksBack - 1)), [weeksBack]);
    const fromMs = dayStartOf(fromKey);

    useEffect(() => {
        let live = true;
        (async () => {
            setLoading(true); setLoadError('');
            try {
                const [wosS, finS, hqS, dirS, setS, cfgS] = await Promise.all([
                    getDocs(collection(db, 'fin_workorders')),
                    getDocs(query(collection(db, 'fin_logs'), where('at', '>=', fromMs), orderBy('at'))),
                    getDocs(query(collection(db, 'hq_logs'), where('t', '>=', new Date(fromMs)), orderBy('t'))),
                    getDocs(collection(db, 'directory')),
                    getDoc(doc(db, 'fin_config', 'settings')),
                    getDoc(doc(db, 'hq_config', 'floor_metrics')),
                ]);
                if (!live) return;
                const saved = cfgS.exists() ? cfgS.data() : {};
                const c = { map: saved.map || {}, groups: saved.groups || {} };
                setCfg(c); setDraft(c);
                setData({
                    wos: wosS.docs.map(d => ({ id: d.id, ...d.data() })),
                    finLogs: finS.docs.map(d => d.data()),
                    hqLogs: hqS.docs.map(d => d.data()),
                    people: dirS.docs.map(d => d.data()).filter(p => p && p.name),
                    settings: setS.exists() ? setS.data() : {},
                });
            } catch (e) { if (live) setLoadError(e.message || String(e)); }
            if (live) setLoading(false);
        })();
        return () => { live = false; };
    }, [fromMs]);

    // ── the reading ──────────────────────────────────────────────────────────────────────────────────────
    const directory = useMemo(() => {
        const m = new Map();
        data.people.forEach(p => { const k = personKeyOf(p.name); if (!m.has(k)) m.set(k, { name: p.name, role: p.role || '' }); });
        return m;
    }, [data.people]);
    const boardOf = useMemo(() => (pk) => cfg.groups[pk] || boardOfRole((directory.get(pk) || {}).role), [cfg.groups, directory]);
    const computed = useMemo(() => {
        const wosById = Object.fromEntries(data.wos.map(w => [w.id, w]));
        const steps = floorStepsOf({ finLogs: data.finLogs, wosById, timers: floorTimersOf(data.settings) }).filter(s => s.startMs >= fromMs);
        const events = activityOf({ finLogs: data.finLogs, hqLogs: data.hqLogs, wos: data.wos }).filter(e => e.at >= fromMs);
        const firstName = new Map(); events.forEach(e => { const k = personKeyOf(e.who); if (!firstName.has(k)) firstName.set(k, e.who); });
        const nameOf = (pk) => (directory.get(pk) || {}).name || firstName.get(pk) || pk;
        const clock = clockIndexOf(timecards.filter(d => d.date >= fromKey), cfg.map);
        const chores = choreIntervalsOf(data.finLogs).filter(c => c.startMs >= fromMs);
        const personDays = personDaysOf({ steps, events, chores, clockByPerson: clock, boardOf, nameOf });
        return { wosById, steps, events, personDays, weeks: weeksOf(personDays), nameOf, standards: standardsCheckOf(steps, wosById) };
    }, [data, timecards, cfg.map, boardOf, directory, fromMs, fromKey]);
    useEffect(() => { if (!week || !computed.weeks.includes(week)) setWeek(computed.weeks[0] || ''); }, [computed.weeks, week]);
    const rows = useMemo(() => (week ? weekRowsOf({ personDays: computed.personDays, week, wosById: computed.wosById }) : []), [computed, week]);
    const ranked = useMemo(() => rankWeek(rows), [rows]);

    // ── the time clock's export ──────────────────────────────────────────────────────────────────────────
    const readFiles = async (fileList) => {
        const files = [...(fileList || [])];
        if (!files.length) return;
        const lists = []; const errs = [];
        for (const f of files) {
            try { lists.push(timecardDaysOf(await f.text())); } catch (e) { errs.push(`${f.name}: ${e.message}`); }
        }
        const merged = mergeTimecardDays(timecards, ...lists);
        setTimecards(merged);
        const dates = merged.map(d => d.date).sort();
        setFileNote([merged.length ? `${merged.length} days · ${timecardPeopleOf(merged).length} people · ${dates[0]} → ${dates[dates.length - 1]}` : '', ...errs].filter(Boolean).join('  ·  '));
    };
    const cardPeople = useMemo(() => timecardPeopleOf(timecards), [timecards]);

    // ── the name map ─────────────────────────────────────────────────────────────────────────────────────
    const mapPeople = useMemo(() => {
        const keys = new Set([...directory.keys(), ...computed.events.map(e => personKeyOf(e.who))]);
        const counts = {}; computed.events.forEach(e => { const k = personKeyOf(e.who); counts[k] = (counts[k] || 0) + 1; });
        return [...keys].map(pk => ({ pk, name: computed.nameOf(pk), role: (directory.get(pk) || {}).role || '', actions: counts[pk] || 0 }))
            .sort((a, b) => b.actions - a.actions || a.name.localeCompare(b.name));
    }, [directory, computed]);
    const suggest = () => {
        const next = { ...draft.map };
        mapPeople.forEach(p => {
            if (next[p.pk]) return;
            const first = p.name.split(/\s+/)[0].toLowerCase();
            if (first.length < 3) return;
            const hits = cardPeople.filter(c => c.name.toLowerCase().startsWith(first));
            if (hits.length === 1 && !Object.values(next).includes(hits[0].number)) next[p.pk] = hits[0].number;
        });
        setDraft({ ...draft, map: next });
    };
    const mapDirty = JSON.stringify(draft) !== JSON.stringify(cfg);
    const saveMap = async () => {
        setBusy(true);
        try {
            const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));
            const next = { map: clean(draft.map), groups: clean(draft.groups) };
            await setDoc(doc(db, 'hq_config', 'floor_metrics'), { ...next, updatedAt: Date.now(), updatedBy: currentUser || '' });
            setCfg(next); setDraft(next);
            if (writeLog) writeLog(currentUser, 'System Admin', 'Floor Metrics: name map saved');
        } catch (e) { alert('Could not save the name map: ' + (e.message || e)); }
        setBusy(false);
    };

    // ── publish ──────────────────────────────────────────────────────────────────────────────────────────
    const publish = async () => {
        if (!week) return;
        const n = ranked[GROUP.FINISHING].length + ranked[GROUP.WMS].length;
        if (!window.confirm(`Publish the week of ${week} to the floor's wallboard?\n\n${n} people ranked — names, scores and the facts behind them go to fin_config/wallboard, which every finishing and WMS screen can read.\n\nNo hours and no clock times are published.`)) return;
        setBusy(true);
        try {
            await setDoc(doc(db, 'fin_config', 'wallboard'), wallboardDocOf({ week, ranked, by: currentUser || '' }));
            if (writeLog) writeLog(currentUser, 'System Admin', `Floor Metrics: published the week of ${week} to the wallboard (${n} ranked)`);
            alert('Published.');
        } catch (e) { alert('Publish failed: ' + (e.message || e)); }
        setBusy(false);
    };

    // ── the screen ───────────────────────────────────────────────────────────────────────────────────────
    const weekHasClock = rows.some(r => r.clockDays > 0);
    const unmappedActive = mapPeople.filter(p => p.actions > 0 && boardOf(p.pk) !== GROUP.NONE && !cfg.map[p.pk]);
    const partCell = (r, key) => { const p = (r.parts || []).find(x => x.key === key); return p && p.value != null ? Math.round(p.value * 100) : '—'; };

    const groupTable = (g) => {
        const list = ranked[g] || [];
        const parts = SCORE_PARTS[g];
        return (
            <div style={box} key={g}>
                <h4 style={h4}>{GROUP_LABEL[g]} — week of {week}</h4>
                {!list.length ? <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>Nobody ranked this week.</div> : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                            <thead><tr>
                                <th style={th}>#</th><th style={th}>Name</th><th style={th}>Score</th>
                                {parts.map(p => <th key={p.key} style={th} title={`weight ${p.weight}`}>{p.label}</th>)}
                                <th style={th}>Days</th><th style={th}>Hours</th><th style={th}>First touch</th>
                                {g === GROUP.FINISHING ? (<>
                                    <th style={th}>Steps</th><th style={th} title="Setup Queue: started setup or staged to the floor">Setups</th><th style={th}>Real</th><th style={th}>Pace</th><th style={th}>Next order</th><th style={th} title="Chores punched in between the steps">Chores</th><th style={th}>Oven-free</th>
                                </>) : (<>
                                    <th style={th}>Picks</th><th style={th}>Packs</th><th style={th}>Actions</th><th style={th}>Per hour</th>
                                </>)}
                                <th style={th}>Steady</th><th style={th}>Longest idle</th><th style={th}>Due dates</th>
                            </tr></thead>
                            <tbody>
                                {list.map(r => (
                                    <tr key={r.pk}>
                                        <td style={td}>{r.rank}</td>
                                        <td style={{ ...td, fontWeight: 500 }}>{r.who}{r.unclockedDays ? <span title="Days worked with no time-clock row" style={{ color: '#c62828' }}> · {r.unclockedDays} unclocked</span> : null}</td>
                                        <td style={{ ...td, fontWeight: 600, color: scoreColour(r.score) }}>{r.score}</td>
                                        {parts.map(p => <td key={p.key} style={{ ...td, color: 'var(--ink-soft)' }}>{partCell(r, p.key)}</td>)}
                                        <td style={td}>{r.activeDays}</td>
                                        <td style={td}>{r.hours ? r.hours.toFixed(1) : '—'}</td>
                                        <td style={td}>{mins(r.startLagMins)}</td>
                                        {g === GROUP.FINISHING ? (<>
                                            <td style={td}>{r.steps}{r.overruns ? <span style={{ color: 'var(--ink-soft)' }} title="Left running — not timed"> +{r.overruns}</span> : null}</td>
                                            <td style={td}>{r.setups || '—'}</td>
                                            <td style={td}>{pct(r.realShare)}</td>
                                            <td style={td}>{r.paceRatio == null ? '—' : `${r.paceRatio.toFixed(1)}×`}</td>
                                            <td style={td}>{mins(r.nextGapMins)}</td>
                                            <td style={td}>{r.chores ? `${r.chores} · ${mins(r.choreMins)}` : '—'}</td>
                                            <td style={td}>{mins(r.ovenFreeMins)}</td>
                                        </>) : (<>
                                            <td style={td}>{r.picks}</td><td style={td}>{r.packs}</td><td style={td}>{r.actions}</td>
                                            <td style={td}>{r.actionsPerHour == null ? '—' : r.actionsPerHour.toFixed(1)}</td>
                                        </>)}
                                        <td style={td}>{pct(r.steadyShare)}</td>
                                        <td style={td}>{mins(r.longestIdleMins)}</td>
                                        <td style={td}>{r.onTime.total ? `${r.onTime.ok}/${r.onTime.total}` : '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <div style={{ display: 'flex', gap: '20px', marginTop: '16px', flexWrap: 'wrap' }}>
                    {[['🏆 Hall of fame', ranked.fame[g] || [], '#2e7d32'], ['⚠ Hall of shame', ranked.shame[g] || [], '#c62828']].map(([title, names, colour]) => (
                        <div key={title} style={{ flex: '1 1 320px', border: `1px solid ${colour}`, padding: '12px 16px' }}>
                            <div style={{ ...mono, color: colour, marginBottom: '8px' }}>{title}</div>
                            {!names.length ? <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Needs at least two people ranked.</div>
                                : names.map(f => <div key={f.name} style={{ fontSize: '0.9rem', marginBottom: '4px' }}><strong>{f.name}</strong> · {f.score} — {f.why}</div>)}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div style={{ padding: '30px 40px' }}>
            <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '24px' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Floor Metrics</h3>
                <p style={{ margin: '8px 0 0 0', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                    How each person on the finishing floor and the pick / pack bench worked, week by week — from the floor's punches, the WMS's actions, the pick and pack stamps and the time clock. Admins only. The time-clock file is read here and never stored.
                </p>
            </div>

            <div style={{ ...box, display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={mono}>History</span>
                    <select value={weeksBack} onChange={e => setWeeksBack(Number(e.target.value))} style={{ padding: '8px' }}>
                        {WEEKS_BACK.map(n => <option key={n} value={n}>last {n} weeks (from {addDays(weekKeyOf(dateKeyOf(Date.now())), -7 * (n - 1))})</option>)}
                    </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={mono}>Week</span>
                    <select value={week} onChange={e => setWeek(e.target.value)} style={{ padding: '8px' }} disabled={!computed.weeks.length}>
                        {computed.weeks.map(w => <option key={w} value={w}>{w} → {addDays(w, 6)}</option>)}
                    </select>
                </label>
                <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); readFiles(e.dataTransfer.files); }}
                    style={{ flex: '1 1 320px', border: '1px dashed var(--line)', padding: '12px 16px', background: 'var(--paper)' }}>
                    <div style={mono}>Time clock export (.csv) — drop here or choose</div>
                    <input type="file" accept=".csv,text/csv" multiple onChange={e => { readFiles(e.target.files); e.target.value = ''; }} style={{ marginTop: '8px' }} />
                    <div style={{ fontSize: '0.85rem', marginTop: '6px', color: 'var(--ink-soft)' }}>
                        {fileNote || 'No file yet — start times, steadiness and hours need it.'}
                        {timecards.length ? <button onClick={() => { setTimecards([]); setFileNote(''); }} style={{ ...btnLight, padding: '4px 10px', marginLeft: '12px' }}>Clear</button> : null}
                    </div>
                </div>
                <button onClick={publish} disabled={busy || !week || loading} style={{ ...btn, opacity: busy || !week || loading ? 0.5 : 1 }}>Publish week to wallboard</button>
            </div>

            {loading && <div style={box}>Reading the floor's history…</div>}
            {loadError && <div style={{ ...box, borderColor: '#c62828', color: '#c62828' }}>Could not read the history: {loadError}</div>}

            {!loading && !loadError && (<>
                <div style={box}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <h4 style={{ ...h4, margin: 0 }}>Names on the time clock {unmappedActive.length ? <span style={{ color: '#c62828', fontSize: '0.9rem' }}>· {unmappedActive.length} working people not matched</span> : null}</h4>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => setShowMap(!showMap)} style={btnLight}>{showMap ? 'Hide' : 'Show'} name map</button>
                            {showMap && cardPeople.length > 0 && <button onClick={suggest} style={btnLight}>Suggest by first name</button>}
                            {showMap && <button onClick={saveMap} disabled={!mapDirty || busy} style={{ ...btn, opacity: !mapDirty || busy ? 0.5 : 1 }}>Save</button>}
                        </div>
                    </div>
                    {showMap && (
                        <div style={{ overflowX: 'auto', marginTop: '12px' }}>
                            <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', margin: '0 0 10px 0' }}>
                                Which time-clock employee each app name is, and which board they are ranked on. Saved as employee numbers only (hq_config/floor_metrics) — drop the export to pick from the names on it.
                            </p>
                            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                                <thead><tr><th style={th}>App name</th><th style={th}>Role</th><th style={th}>Actions in range</th><th style={th}>Board</th><th style={th}>Time clock</th></tr></thead>
                                <tbody>
                                    {mapPeople.map(p => {
                                        const no = draft.map[p.pk] || '';
                                        const known = cardPeople.find(c => c.number === no);
                                        return (
                                            <tr key={p.pk}>
                                                <td style={{ ...td, fontWeight: 500 }}>{p.name}</td>
                                                <td style={td}>{p.role || '—'}</td>
                                                <td style={td}>{p.actions}</td>
                                                <td style={td}>
                                                    <select value={draft.groups[p.pk] || ''} onChange={e => setDraft({ ...draft, groups: { ...draft.groups, [p.pk]: e.target.value } })}>
                                                        <option value="">by role — {GROUP_LABEL[boardOfRole(p.role)]}</option>
                                                        {[GROUP.FINISHING, GROUP.WMS, GROUP.BOTH, GROUP.NONE].map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
                                                    </select>
                                                </td>
                                                <td style={td}>
                                                    {cardPeople.length ? (
                                                        <select value={no} onChange={e => setDraft({ ...draft, map: { ...draft.map, [p.pk]: e.target.value } })}>
                                                            <option value="">— not matched —</option>
                                                            {no && !known && <option value={no}>#{no} (not in this file)</option>}
                                                            {cardPeople.map(c => <option key={c.number} value={c.number}>{c.name} · #{c.number}</option>)}
                                                        </select>
                                                    ) : (no ? `#${no}` : '—')}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {cardPeople.length > 0 && (() => {
                                const used = new Set(Object.values(draft.map));
                                const left = cardPeople.filter(c => !used.has(c.number));
                                return left.length ? <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '10px' }}>On the time clock with no app name: {left.map(c => c.name).join(', ')}.</p> : null;
                            })()}
                        </div>
                    )}
                </div>

                {computed.standards.some(c => c.off && !c.oven) && (
                    <div style={{ ...box, borderColor: '#c62828' }}>
                        <strong style={{ color: '#c62828' }}>Standards far from the floor:</strong> {computed.standards.filter(c => c.off && !c.oven).map(c => `${STEP_LABEL[c.task] || c.task} (${c.station}) — standard ${mins(c.standardMins)}, the crew's real median ${mins(c.realMedianMins)}`).join(' · ')}.
                        <span style={{ color: 'var(--ink-soft)' }}> Pace reads against Production Times — where a standard is this far off, pace is wrong for everyone on that step until it is set (Finishing → Production Times). See the table at the bottom.</span>
                    </div>
                )}

                {!weekHasClock && <div style={{ ...box, borderColor: '#b08d57' }}>No time-clock days for this week{timecards.length ? ' (the export dropped does not cover it, or no one working is matched)' : ''} — start times, steadiness and hours read "—" and each score is out of the parts that could be read.</div>}

                {groupTable(GROUP.FINISHING)}
                {groupTable(GROUP.WMS)}

                {ranked.unranked.length > 0 && (
                    <div style={box}>
                        <h4 style={h4}>Not ranked this week</h4>
                        <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', lineHeight: 1.7 }}>
                            {ranked.unranked.map(r => {
                                const why = r.group === GROUP.NONE ? 'not on a board (role)' : r.activeDays < RANK_MIN.days ? `${r.activeDays} day worked` : (r.group === GROUP.FINISHING ? (r.steps || 0) + (r.setups || 0) : r.actions) < RANK_MIN.work ? `${r.group === GROUP.FINISHING ? `${r.steps} steps, ${r.setups || 0} setups` : r.actions + ' actions'}` : 'too little could be read';
                                return <span key={`${r.pk}|${r.group}`} style={{ marginRight: '18px', display: 'inline-block' }}><strong style={{ color: 'var(--ink)' }}>{r.who}</strong>{r.group !== GROUP.NONE ? ` (${GROUP_LABEL[r.group]})` : ''} — {why}</span>;
                            })}
                        </div>
                    </div>
                )}

                <div style={box}>
                    <h4 style={h4}>The standards, against the floor ({weeksBack} weeks)</h4>
                    <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', margin: '0 0 10px 0' }}>Every timed step: how many were punched, how many were not real, and how long the real ones took against the standard Production Times gives. Bakes are the oven's time — the operator is free — and are not scored.</p>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                            <thead><tr><th style={th}>Step</th><th style={th}>Station</th><th style={th}>Punched</th><th style={th}>Not real</th><th style={th}>Real median</th><th style={th}>Standard</th><th style={th}>Setting</th></tr></thead>
                            <tbody>
                                {computed.standards.map(c => (
                                    <tr key={c.task + c.station} style={{ background: c.off && !c.oven ? '#fdecea' : 'transparent' }}>
                                        <td style={{ ...td, fontWeight: 500 }}>{STEP_LABEL[c.task] || c.task}{c.oven ? ' (oven)' : ''}</td>
                                        <td style={td}>{c.station}</td>
                                        <td style={td}>{c.n}</td>
                                        <td style={td}>{pct(c.n ? c.short / c.n : null)}</td>
                                        <td style={td}>{mins(c.realMedianMins)}{c.real < 10 ? <span style={{ color: 'var(--ink-soft)' }}> (of {c.real})</span> : null}</td>
                                        <td style={td}>{mins(c.standardMins)}</td>
                                        <td style={{ ...td, color: 'var(--ink-soft)' }}>{STANDARD_SETTING[c.task] || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div style={{ ...box, background: 'var(--paper)' }}>
                    <h4 style={h4}>How it is read</h4>
                    <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.85rem', color: 'var(--ink-soft)', lineHeight: 1.7 }}>
                        <li><strong>First touch</strong> — clock-in to the first floor punch (finishing) or first WMS or Setup Queue action; the median of the week's days. The WMS logs a pick when it is DONE, so a picker's first touch includes their first pick.</li>
                        <li><strong>Real punches</strong> — steps that ran at least what the floor's punch check accepts (a quarter of the step's standard, never under a minute). A step left running past three times its standard is not timed.</li>
                        <li><strong>Pace</strong> — real steps against the floor's own standard (Production Times); 1.0× is on standard.</li>
                        <li><strong>Next order</strong> — from finishing a step on one order to starting a step on the next.</li>
                        <li><strong>Steady</strong> — the clocked half-hours with something done or a step running, a chore running, less the day's unpaid break. Oven time with nothing else done is shown as oven-free; before chores could be punched (until 2026-10-14) it is not scored, from 2026-10-15 it counts as idle — the operator is free and expected to do chores.</li>
                        <li><strong>Due dates</strong> — finishing: the orders they worked that the floor finished by their due date; WMS: picks and packs done by the due date.</li>
                        <li>Not in the history: the machine cards' Start / Complete (only Manual Control is logged); when a pick or pack STARTED (the WMS keeps only when it finished); lunch punches; chores.</li>
                        <li>Hours are shown here only. The wallboard gets names, scores and the facts behind them — never hours or clock times.</li>
                    </ul>
                </div>
            </>)}
        </div>
    );
}
