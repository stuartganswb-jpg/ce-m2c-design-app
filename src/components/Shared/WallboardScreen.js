// 📺 THE WALLBOARD SCREEN — one screen for both floors (Stuart 2026-10-13, phase 2): the finishing floor's WALLBOARD tab
// and the WMS's. Landscape, for a large monitor: what is happening NOW on the left, the week's board on the right —
// hall of fame, hall of shame, everyone ranked, names named. "⛶ Full screen" fills the monitor and keeps it awake.
// Reads: the lists its app already holds (passed in — no new listener on orders) and ONE small document,
// fin_config/wallboard, which HQ → System Admin → Floor Metrics publishes. Writes nothing. The readings are
// Shared/wallboard (pure, harness scripts/wallboard.test.mjs).
// The finishing side also prints what the floor FINISHED — today · this week · last week, by category, spray only or with
// a hand coat (Stuart 2026-10-22, Shared/floorOutput); it asks the item master for the type of each finished code it
// cannot read off the order, once per code. And what the spin machine SPRAYED (2026-10-22), from the floor's own punches
// (fin_logs since last Monday, one listener) — the machine's work shows before its orders are signed off.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { floorNowOf, wmsNowOf, boardHalfOf, sayMins } from './wallboard';
import { feedStatusOf, FEED_RETRY_MS } from './liveFeed';
import { floorTimersOf, floorStepsOf, GROUP } from './floorMetrics';
import { outputPeriodsOf, codesToAskOf, typeOfCodeFrom, changeOf, periodsOf, spinPeriodsOf, CATEGORIES, CATEGORY_LABEL, CATEGORY_LABEL_ES } from './floorOutput';
import { fetchPartsByCode } from './PullLinesLive';

const C = { bg: '#121110', panel: '#1c1a17', line: 'rgba(244,241,234,.12)', ink: '#f4f1ea', soft: 'rgba(244,241,234,.6)', brass: '#c9a36a', good: '#5cb85c', bad: '#e5534b', warn: '#e0a63a', oven: '#5aa9e6' };
const fs = (min, vw, max) => `clamp(${min}px, ${vw}vw, ${max}px)`;
const T = { title: fs(18, 1.9, 54), big: fs(22, 2.6, 80), h: fs(12, 1.05, 30), body: fs(12, 1.0, 28), small: fs(10, 0.8, 22), name: fs(14, 1.35, 38) };
const mono = "'IBM Plex Mono', monospace";
const sectionHead = { fontFamily: mono, fontSize: T.h, letterSpacing: '.12em', textTransform: 'uppercase', color: C.brass, margin: '0 0 0.6vw 0', display: 'flex', alignItems: 'baseline', gap: '0.8vw' };
const es = { fontSize: T.small, color: C.soft, letterSpacing: '.06em', textTransform: 'none' };
const panel = { background: C.panel, border: `1px solid ${C.line}`, padding: '1vw 1.2vw', minHeight: 0, overflow: 'hidden' };
const STATE_COLOUR = { overdue: C.bad, running: C.ink, untimed: C.soft, baking: C.oven, chore: C.brass };

const Counter = ({ label, es: sub, value, tone }) => (
    <div style={{ ...panel, padding: '0.8vw 1vw', display: 'flex', flexDirection: 'column', gap: '0.2vw' }}>
        <div style={{ fontSize: T.big, fontWeight: 600, color: tone || C.ink, lineHeight: 1 }}>{value}</div>
        <div style={{ fontFamily: mono, fontSize: T.small, textTransform: 'uppercase', letterSpacing: '.08em', color: C.soft }}>{label}</div>
        {sub && <div style={{ fontSize: T.small, color: C.soft, opacity: 0.8 }}>{sub}</div>}
    </div>
);
const Empty = ({ children }) => <div style={{ fontSize: T.body, color: C.soft, fontStyle: 'italic' }}>{children}</div>;
const Bar = ({ elapsed, est, colour }) => {
    const pct = est > 0 && elapsed != null ? Math.min(100, Math.round((elapsed / est) * 100)) : 0;
    return <div style={{ height: '0.35vw', minHeight: 3, background: C.line, marginTop: '0.3vw' }}><div style={{ width: `${pct}%`, height: '100%', background: colour }} /></div>;
};

// What the floor finished: pieces by category, spray only and with a hand coat — and this week against last week to the same hour.
// Kept tight (one header row, close rows) so "Working now" still shows the four hands-on steps the floor runs at most at
// once (the two weeks to 2026-10-22: never more than 4, 95% of the time 2 or fewer).
function Production({ p }) {
    if (!p) return null;
    const cell = { fontSize: T.body, textAlign: 'right', padding: '0.1vw 0.4vw' };
    const n = (v) => (v ? v : <span style={{ color: C.soft, opacity: 0.5 }}>·</span>);
    const sub = { fontFamily: mono, fontSize: T.small, letterSpacing: '.06em', color: C.soft };
    const rows = [...CATEGORIES.map(k => ({ k, label: CATEGORY_LABEL[k], es: CATEGORY_LABEL_ES[k], at: (per) => p[per].byCategory[k] })),
        { k: 'total', label: 'Total', es: '', at: (per) => ({ spray: CATEGORIES.reduce((t, k) => t + p[per].byCategory[k].spray, 0), hand: CATEGORIES.reduce((t, k) => t + p[per].byCategory[k].hand, 0), total: p[per].total }) }];
    const vs = (r) => {
        const ch = changeOf(r.at('week').total, r.at('lastWeekToDate').total);
        if (!ch.diff) return <span style={{ color: C.soft, opacity: 0.5 }}>=</span>;
        return <span style={{ color: ch.diff > 0 ? C.good : C.warn }}>{ch.diff > 0 ? '▲' : '▼'} {Math.abs(ch.diff)}</span>;
    };
    return (
        <div style={{ ...panel, padding: '0.6vw 1.2vw' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2.2fr repeat(6, 1fr) 1.4fr', alignItems: 'end' }}>
                <div style={{ paddingBottom: '0.2vw' }}>
                    <div style={{ ...sectionHead, margin: 0 }}>Finished — pieces</div>
                    <div style={{ fontSize: T.small, color: C.soft }}>Terminado — piezas</div>
                </div>
                {[['Today', 'Hoy'], ['This week', 'Esta semana'], ['Last week', 'Semana pasada']].map(([en, sp]) => (
                    <div key={en} style={{ gridColumn: 'span 2', textAlign: 'center', borderBottom: `1px solid ${C.line}`, margin: '0 0.4vw', paddingBottom: '0.2vw' }}>
                        <div style={{ whiteSpace: 'nowrap' }}><span style={{ fontSize: T.body, fontWeight: 600 }}>{en}</span> <span style={es}>{sp}</span></div>
                        <div style={{ display: 'flex', justifyContent: 'space-around', ...sub }}><span>spray</span><span style={{ color: C.brass }}>+ hand</span></div>
                    </div>
                ))}
                <div style={{ ...sub, textAlign: 'right', padding: '0 0.4vw 0.2vw', lineHeight: 1.3 }}>vs last wk<br />same hour</div>
                {rows.map(r => {
                    const tot = r.k === 'total';
                    const line = { borderTop: `1px solid ${tot ? C.brass : C.line}`, fontWeight: tot ? 700 : 400 };
                    return (
                        <React.Fragment key={r.k}>
                            <div style={{ ...line, fontSize: T.body, padding: '0.1vw 0', whiteSpace: 'nowrap' }}>{r.label} <span style={{ ...es, fontWeight: 400 }}>{r.es}</span></div>
                            {['today', 'week', 'lastWeek'].map(per => (
                                <React.Fragment key={per}>
                                    <div style={{ ...cell, ...line }}>{n(r.at(per).spray)}</div>
                                    <div style={{ ...cell, ...line, color: C.brass }}>{n(r.at(per).hand)}</div>
                                </React.Fragment>
                            ))}
                            <div style={{ ...cell, ...line }}>{vs(r)}</div>
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
}

function FloorLeft({ s, production }) {
    const c = s.counts;
    return (
        <div style={{ display: 'grid', gridTemplateRows: production ? 'auto 1fr auto auto auto' : 'auto 1fr auto auto', gap: '0.8vw', minHeight: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.6vw' }}>
                <Counter label="On the floor" es="En el piso" value={c.onFloor} />
                <Counter label="In the oven" es="En el horno" value={c.inOven} tone={C.oven} />
                <Counter label="Setup queue" es="Por preparar" value={c.setupQueue} />
                <Counter label="Finished today" es="Terminadas hoy" value={c.finishedToday} tone={C.good} />
                <Counter label="Due today" es="Para hoy" value={c.dueToday} tone={c.dueToday ? C.warn : C.ink} />
                <Counter label="Late" es="Atrasadas" value={c.late} tone={c.late ? C.bad : C.ink} />
            </div>
            <div style={panel}>
                <div style={sectionHead}>Working now <span style={es}>Trabajando ahora</span></div>
                {!s.working.length ? <Empty>No hands-on step running.</Empty> : s.working.slice(0, production ? 4 : 8).map((w, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '22% 30% 1fr 17%', gap: '0.8vw', alignItems: 'center', padding: '0.45vw 0', borderTop: i ? `1px solid ${C.line}` : 'none' }}>
                        <div style={{ fontSize: T.name, fontWeight: 600 }}>{w.who || '—'}</div>
                        <div style={{ fontSize: T.body, color: w.chore ? C.brass : C.ink }}>{w.chore ? '🧰 ' : ''}{w.step}<div style={{ fontSize: T.small, color: C.soft }}>{w.chore ? 'chore · tarea' : w.window}</div></div>
                        <div style={{ fontFamily: mono, fontSize: T.body }}>{w.ref}<div style={{ fontSize: T.small, color: C.soft, fontFamily: 'inherit' }}>{w.item}</div></div>
                        <div style={{ textAlign: 'right', fontSize: T.body, color: STATE_COLOUR[w.state] || C.ink }}>
                            {sayMins(w.elapsedMins)}{w.estMins ? <span style={{ color: C.soft }}> / {sayMins(w.estMins)}</span> : null}
                            {w.state === 'overdue' && <div style={{ fontSize: T.small, color: C.bad }}>over by {sayMins(w.elapsedMins - w.estMins)}</div>}
                            <Bar elapsed={w.elapsedMins} est={w.estMins} colour={STATE_COLOUR[w.state] || C.ink} />
                        </div>
                    </div>
                ))}
            </div>
            <div style={panel}>
                <div style={sectionHead}>In the oven or air drying — the operator is free <span style={es}>En el horno o secándose — el operador está libre</span></div>
                {!s.oven.length ? <Empty>Nothing in the oven or on the drying rack.</Empty> : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6vw' }}>
                        {s.oven.slice(0, 6).map((o, i) => (
                            <div key={i} style={{ border: `1px solid ${o.done ? C.warn : C.oven}`, padding: '0.5vw 0.7vw' }}>
                                <div style={{ fontFamily: mono, fontSize: T.body }}>{o.ref} <span style={{ color: C.soft, fontSize: T.small }}>{o.step}</span></div>
                                <div style={{ fontSize: T.body, color: o.done ? C.warn : C.oven, fontWeight: 600 }}>{o.done ? (o.airDry ? 'Dry — take it off the rack' : 'Done — take it out') : `${sayMins(o.leftMins)} left`}</div>
                                <div style={{ fontSize: T.small, color: C.soft }}>{o.who ? `${o.who} · free` : ''}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <Production p={production} />
            {/* smaller since the production table came in (Stuart 2026-10-22) — one line of names */}
            <div style={{ ...panel, padding: '0.6vw 1.2vw', display: 'flex', alignItems: 'center', gap: '0.8vw', flexWrap: 'wrap' }}>
                <div style={{ ...sectionHead, margin: 0, fontSize: T.small }}>Crew today <span style={es}>Equipo</span></div>
                {!s.crew.length ? <Empty>No one has punched a step today yet.</Empty> : s.crew.map(p => (
                    <span key={p.name} style={{ fontSize: T.small, padding: '0.15vw 0.6vw', border: `1px solid ${p.state === 'working' ? C.good : p.state === 'free' ? C.oven : C.line}`, color: p.state === 'none' ? C.soft : C.ink }}>
                        <strong>{p.name}</strong> · {p.state === 'working' ? `${p.doing.step} ${p.doing.ref}` : p.state === 'free' ? 'free · oven / drying' : 'no step running'}
                    </span>
                ))}
            </div>
        </div>
    );
}

function WmsLeft({ s }) {
    const c = s.counts;
    return (
        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: '0.8vw', minHeight: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '0.6vw' }}>
                <Counter label="Awaiting pick" es="Por surtir" value={c.awaitingPick} />
                <Counter label="Picking now" es="Surtiendo" value={c.picking} tone={C.good} />
                <Counter label="Awaiting staging" es="Por preparar" value={c.staging} />
                <Counter label="Ready to pack" es="Por empacar" value={c.readyToPack} />
                <Counter label="Packing now" es="Empacando" value={c.packing} tone={C.good} />
                <Counter label="Picked today" es="Surtidas hoy" value={c.pickedToday} tone={C.brass} />
                <Counter label="Packed today" es="Empacadas hoy" value={c.packedToday} tone={C.brass} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '0.8vw', minHeight: 0 }}>
                <div style={panel}>
                    <div style={sectionHead}>Working now <span style={es}>Trabajando ahora</span></div>
                    {!s.claims.length ? <Empty>No pick or pack open.</Empty> : s.claims.slice(0, 8).map((x, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '32% 22% 1fr 18%', gap: '0.8vw', alignItems: 'center', padding: '0.45vw 0', borderTop: i ? `1px solid ${C.line}` : 'none' }}>
                            <div style={{ fontSize: T.name, fontWeight: 600 }}>{x.who}</div>
                            <div style={{ fontFamily: mono, fontSize: T.small, textTransform: 'uppercase', letterSpacing: '.08em', color: x.kind === 'pick' ? C.brass : C.good }}>{x.kind === 'pick' ? 'Picking' : 'Packing'}</div>
                            <div style={{ fontFamily: mono, fontSize: T.body }}>{x.ref}</div>
                            <div style={{ textAlign: 'right', fontSize: T.body, color: x.stale ? C.bad : C.ink }}>{sayMins(x.mins)}{x.stale && <div style={{ fontSize: T.small }}>left open?</div>}</div>
                        </div>
                    ))}
                </div>
                <div style={panel}>
                    <div style={sectionHead}>Today <span style={es}>Hoy</span></div>
                    {!s.today.length ? <Empty>Nothing picked or packed yet today.</Empty> : s.today.slice(0, 8).map((p, i) => (
                        <div key={p.name} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '1vw', alignItems: 'baseline', padding: '0.4vw 0', borderTop: i ? `1px solid ${C.line}` : 'none' }}>
                            <div style={{ fontSize: T.name, fontWeight: 600 }}>{p.name}</div>
                            <div style={{ fontSize: T.body }}>{p.picks} <span style={{ color: C.soft, fontSize: T.small }}>picked</span></div>
                            <div style={{ fontSize: T.body }}>{p.packs} <span style={{ color: C.soft, fontSize: T.small }}>packed</span></div>
                        </div>
                    ))}
                </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8vw' }}>
                <div style={panel}>
                    <div style={sectionHead}>Picks past their due date <span style={es}>Atrasadas</span></div>
                    {!s.latePicks.length ? <Empty>None — every open pick is on time.</Empty> : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5vw' }}>{s.latePicks.slice(0, 10).map(x => <span key={x.ref} style={{ fontFamily: mono, fontSize: T.body, color: C.bad, border: `1px solid ${C.bad}`, padding: '0.2vw 0.6vw' }}>{x.ref} · {x.due.slice(5)}</span>)}</div>
                    )}
                </div>
                <div style={panel}>
                    <div style={sectionHead}>Longest waiting to pack <span style={es}>Esperando empaque</span></div>
                    {!s.oldestPacks.length ? <Empty>Nothing waiting.</Empty> : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5vw' }}>{s.oldestPacks.map(x => <span key={x.ref} style={{ fontFamily: mono, fontSize: T.body, border: `1px solid ${x.waitingMins > 24 * 60 ? C.bad : C.line}`, padding: '0.2vw 0.6vw' }}>{x.ref} · {sayMins(x.waitingMins)}</span>)}</div>
                    )}
                </div>
            </div>
        </div>
    );
}

// What the spin machine sprayed — its coats, rings among them — today, this week against last week to the same hour.
function SpinSprayed({ s }) {
    if (!s) return null;
    const ch = changeOf(s.week.coats, s.lastWeekToDate.coats);
    const big = { fontSize: T.name, fontWeight: 700 };
    return (
        <div style={{ ...panel, padding: '0.7vw 1.2vw' }}>
            <div style={{ ...sectionHead, margin: '0 0 0.3vw 0' }}>Spin machine — coats sprayed <span style={es}>Máquina — capas</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.8vw', alignItems: 'baseline' }}>
                {[['Today', 'Hoy', s.today], ['This week', 'Esta semana', s.week], ['Last week', 'Semana pasada', s.lastWeek]].map(([en, sp, v]) => (
                    <div key={en}><div style={big}>{v.coats}</div><div style={{ fontSize: T.small, color: C.soft }}>{en} · {sp}{v.rings && v.rings !== v.coats ? ` · ${v.rings} rings` : ''}</div></div>
                ))}
                <div><div style={{ ...big, color: !ch.diff ? C.soft : ch.diff > 0 ? C.good : C.warn }}>{!ch.diff ? '=' : `${ch.diff > 0 ? '▲' : '▼'} ${Math.abs(ch.diff)}`}</div><div style={{ fontSize: T.small, color: C.soft }}>vs last week, same hour</div></div>
            </div>
        </div>
    );
}

function WeekRight({ half, spin }) {
    if (!half) {
        return (
            <div style={{ display: 'grid', gridTemplateRows: '1fr auto', gap: '0.8vw', minHeight: 0 }}>
                <div style={{ ...panel, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '1vw' }}>
                    <div style={{ fontSize: T.title, color: C.brass }}>🏆 The week's board</div>
                    <div style={{ fontSize: T.body, color: C.soft, maxWidth: '80%' }}>Not published yet. HQ → System Admin → Floor Metrics → "Publish week to wallboard".</div>
                </div>
                <SpinSprayed s={spin} />
            </div>
        );
    }
    const when = half.publishedAt ? new Date(half.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const range = (k) => (k ? new Date(`${k}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
    const medal = ['🥇', '🥈', '🥉'];
    const Hall = ({ title, sub, rows, colour, icon }) => (
        <div style={{ ...panel, borderColor: colour }}>
            <div style={{ ...sectionHead, color: colour }}>{title} <span style={es}>{sub}</span></div>
            {!rows.length ? <Empty>Needs at least two people ranked.</Empty> : rows.map((r, i) => (
                <div key={r.name} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '0.9vw', alignItems: 'center', padding: '0.5vw 0', borderTop: i ? `1px solid ${C.line}` : 'none' }}>
                    <div style={{ fontSize: T.name }}>{icon ? icon(i) : ''}</div>
                    <div>
                        <div style={{ fontSize: T.name, fontWeight: 700 }}>{r.name}</div>
                        <div style={{ fontSize: T.small, color: C.soft }}>{r.why}</div>
                    </div>
                    <div style={{ fontSize: T.big, fontWeight: 700, color: colour }}>{r.score}</div>
                </div>
            ))}
        </div>
    );
    // the two scores beside the score (finishing, 2026-10-22) — a board published before them has neither, and shows the score alone
    const subs = half.ranked.some(r => r.punching != null || r.production != null);
    const tone = (v) => (v == null ? C.soft : v >= 75 ? C.good : v >= 50 ? C.warn : C.bad);
    const hd = { fontFamily: mono, fontSize: T.small, letterSpacing: '.06em', color: C.soft, textAlign: 'right' };
    return (
        <div style={{ display: 'grid', gridTemplateRows: spin ? 'auto auto auto 1fr auto' : 'auto auto auto 1fr', gap: '0.8vw', minHeight: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: T.h, fontFamily: mono, textTransform: 'uppercase', letterSpacing: '.12em', color: C.brass }}>Week of {range(half.week)} – {range(half.weekEnd)}</div>
                <div style={{ fontSize: T.small, color: C.soft }}>published {when}{half.publishedBy ? ` by ${half.publishedBy}` : ''}</div>
            </div>
            <Hall title="🏆 Hall of fame" sub="Salón de la fama" rows={half.fame} colour={C.good} icon={(i) => medal[i] || ''} />
            <Hall title="⚠ Hall of shame" sub="Salón de la vergüenza" rows={half.shame} colour={C.bad} />
            <div style={panel}>
                <div style={sectionHead}>Everyone <span style={es}>Todos</span></div>
                {subs ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '2.2em 1fr repeat(4, auto)', columnGap: '1.4vw', alignItems: 'baseline' }}>
                        <span /><span />
                        <span style={hd}>days<br />días</span><span style={hd}>score<br />total</span><span style={hd}>punching<br />marcaje</span><span style={hd}>production<br />producción</span>
                        {half.ranked.map(r => {
                            const f = r.facts || {};
                            const cell = { fontSize: T.body, textAlign: 'right', padding: '0.25vw 0', borderTop: `1px solid ${C.line}` };
                            return (
                                <React.Fragment key={r.name}>
                                    <span style={{ ...cell, textAlign: 'left', color: C.soft }}>{r.rank}.</span>
                                    <span style={{ ...cell, textAlign: 'left' }}>{r.name}</span>
                                    <span style={{ ...cell, color: C.soft }}>{f.floorDays != null ? `${f.floorDays}${half.weekDays ? `/${half.weekDays}` : ''}` : '—'}</span>
                                    <span style={{ ...cell, fontWeight: 700, color: tone(r.score) }}>{r.score}</span>
                                    <span style={{ ...cell, color: tone(r.punching) }}>{r.punching == null ? '—' : r.punching}</span>
                                    <span style={{ ...cell, color: tone(r.production) }}>{r.production == null ? '—' : r.production}</span>
                                </React.Fragment>
                            );
                        })}
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '1.2vw' }}>
                        {half.ranked.map(r => (
                            <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '2.2em 1fr auto', gap: '0.5vw', alignItems: 'baseline', padding: '0.25vw 0', borderTop: `1px solid ${C.line}` }}>
                                <span style={{ fontSize: T.body, color: C.soft }}>{r.rank}.</span>
                                <span style={{ fontSize: T.body }}>{r.name}</span>
                                <span style={{ fontSize: T.body, fontWeight: 600, color: tone(r.score) }}>{r.score}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <SpinSprayed s={spin} />
        </div>
    );
}

/**
 * @param side       'finishing' | 'wms'
 * @param db         the app's Firestore
 * @param workOrders (finishing) the floor's documents
 * @param sysConfig  (finishing) fin_config/settings — the floor's timers
 * @param wms        (wms) { openPicks, staging, packQueue, docs, refOf } — the WMS's own lists
 */
// `feed` (Shared/liveFeed) — whether the app's order list is live; printed under the clock so a frozen board can never pass
// for a live one (2026-10-21).
// `recipes` (finishing) fin_recipes — which finished pieces had a hand coat.
export default function WallboardScreen({ side = 'finishing', db, workOrders = [], sysConfig = {}, wms = {}, finishes = null, feed = null, recipes = null }) {
    const [now, setNow] = useState(Date.now());
    const [published, setPublished] = useState(null);
    const parts = useRef({});                       // item records by code — asked once per code (null = not in the item master)
    const [partsAt, setPartsAt] = useState(0);
    const [full, setFull] = useState(false);
    const box = useRef(null);
    const lock = useRef(null);

    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(t); }, []);
    useEffect(() => {
        if (!db) return undefined;
        return onSnapshot(doc(db, 'fin_config', 'wallboard'), (s) => setPublished(s.exists() ? s.data() : null), () => setPublished(null));
    }, [db]);
    useEffect(() => {
        const onChange = () => {
            const on = document.fullscreenElement === box.current;
            setFull(on);
            // keep a monitor awake while it is the wallboard; let it sleep again when it is not
            if (on && navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then(l => { lock.current = l; }).catch(() => {});
            if (!on && lock.current) { lock.current.release().catch(() => {}); lock.current = null; }
        };
        document.addEventListener('fullscreenchange', onChange);
        return () => { document.removeEventListener('fullscreenchange', onChange); if (lock.current) lock.current.release().catch(() => {}); };
    }, []);
    const toggleFull = () => {
        if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
        if (box.current && box.current.requestFullscreen) box.current.requestFullscreen().catch(() => {});
    };

    const status = useMemo(() => (side === 'wms'
        ? wmsNowOf({ ...wms, nowMs: now })
        : floorNowOf({ workOrders, cfg: floorTimersOf(sysConfig), nowMs: now, finishes })), [side, wms, workOrders, sysConfig, now, finishes]);
    const half = useMemo(() => boardHalfOf(published, side === 'wms' ? GROUP.WMS : GROUP.FINISHING), [published, side]);

    // ── what the floor finished (finishing side) ──
    const sinceMs = periodsOf(now).lastWeek.fromMs;
    const askKey = useMemo(() => (side === 'wms' || !recipes ? '' : codesToAskOf(workOrders, { fromMs: sinceMs }).filter(c => !(c in parts.current)).join('|')), [side, recipes, workOrders, sinceMs]);
    useEffect(() => {
        if (!askKey) return undefined;
        let live = true;
        const codes = askKey.split('|');
        fetchPartsByCode(codes).then(found => {
            if (!live) return;
            codes.forEach(c => { parts.current[c] = found[c] || null; });
            setPartsAt(Date.now());
        }).catch(() => {});                          // unreachable: the pieces read by their order and name; asked again when the next order finishes
        return () => { live = false; };
    }, [askKey]);
    // ── what the spin machine sprayed (finishing side): the floor's punches since last Monday, one listener ──
    const [finLogs, setFinLogs] = useState(null);
    const [logRetry, setLogRetry] = useState(0);
    useEffect(() => {
        if (!db || side === 'wms' || !recipes) return undefined;
        let retry = null;
        const unsub = onSnapshot(query(collection(db, 'fin_logs'), where('at', '>=', sinceMs)), (snap) => setFinLogs(snap.docs.map(d => d.data())),
            () => { retry = setTimeout(() => setLogRetry(n => n + 1), FEED_RETRY_MS); });   // lost: try again, as the order feed does
        return () => { unsub(); clearTimeout(retry); };
    }, [db, side, recipes, sinceMs, logRetry]);
    const spin = useMemo(() => {
        if (side === 'wms' || !finLogs) return null;
        const wosById = Object.fromEntries(workOrders.map(w => [w.id, w]));
        const known = Object.fromEntries(Object.entries(parts.current).filter(([, v]) => v));
        return spinPeriodsOf({ steps: floorStepsOf({ finLogs, wosById, timers: floorTimersOf(sysConfig) }), wosById, typeOfCode: typeOfCodeFrom(known), nowMs: now });
    }, [side, finLogs, workOrders, sysConfig, now, partsAt]);   // eslint-disable-line react-hooks/exhaustive-deps
    const production = useMemo(() => {
        if (side === 'wms' || !recipes) return null;
        const known = Object.fromEntries(Object.entries(parts.current).filter(([, v]) => v));
        return outputPeriodsOf({ workOrders, recipes, typeOfCode: typeOfCodeFrom(known), nowMs: now });
    }, [side, recipes, workOrders, now, partsAt]);   // eslint-disable-line react-hooks/exhaustive-deps

    const clock = new Date(now);
    return (
        <div ref={box} style={{
            background: C.bg, color: C.ink, fontFamily: "'Inter', -apple-system, sans-serif", boxSizing: 'border-box',
            width: full ? '100vw' : '100%', height: full ? '100vh' : 'auto', aspectRatio: full ? 'auto' : '16 / 9',
            padding: '1.2vw 1.5vw', display: 'grid', gridTemplateRows: 'auto 1fr', gap: '1vw', overflow: 'hidden',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${C.brass}`, paddingBottom: '0.6vw' }}>
                <div style={{ fontSize: T.title, fontFamily: "'Cormorant Garamond', Georgia, serif", fontWeight: 500, letterSpacing: '.04em' }}>
                    {side === 'wms' ? 'Pick / Pack' : 'Finishing Floor'} <span style={{ color: C.brass, fontSize: T.h, fontFamily: mono, letterSpacing: '.2em', verticalAlign: 'middle' }}>● LIVE</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5vw' }}>
                    <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: T.big, fontWeight: 600, lineHeight: 1 }}>{clock.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
                        <div style={{ fontSize: T.small, color: C.soft }}>{clock.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                        {feed && (() => { const f = feedStatusOf(feed); return <div title={f.textEs} style={{ fontSize: T.small, fontFamily: mono, marginTop: '0.2vw', color: f.tone === 'live' ? C.good : f.tone === 'lost' ? C.bad : f.tone === 'offline' ? C.warn : C.soft }}>{f.text}</div>; })()}
                    </div>
                    <button onClick={toggleFull} title={full ? 'Leave full screen' : 'Fill the monitor (and keep it awake)'} style={{ background: 'transparent', color: C.soft, border: `1px solid ${C.line}`, padding: '0.4vw 0.8vw', fontFamily: mono, fontSize: T.small, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                        {full ? '✕ Exit' : '⛶ Full screen'}
                    </button>
                </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '58fr 42fr', gap: '1.2vw', minHeight: 0 }}>
                {side === 'wms' ? <WmsLeft s={status} /> : <FloorLeft s={status} production={production} />}
                <WeekRight half={half} spin={spin} />
            </div>
        </div>
    );
}
