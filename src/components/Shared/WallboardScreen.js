// 📺 THE WALLBOARD SCREEN — one screen for both floors (Stuart 2026-10-13, phase 2): the finishing floor's WALLBOARD tab
// and the WMS's. Landscape, for a large monitor: what is happening NOW on the left, the week's board on the right —
// hall of fame, hall of shame, everyone ranked, names named. "⛶ Full screen" fills the monitor and keeps it awake.
// Reads: the lists its app already holds (passed in — no new listener on orders) and ONE small document,
// fin_config/wallboard, which HQ → System Admin → Floor Metrics publishes. Writes nothing. The readings are
// Shared/wallboard (pure, harness scripts/wallboard.test.mjs).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { floorNowOf, wmsNowOf, boardHalfOf, sayMins } from './wallboard';
import { floorTimersOf, GROUP } from './floorMetrics';

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

function FloorLeft({ s }) {
    const c = s.counts;
    return (
        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto auto', gap: '0.8vw', minHeight: 0 }}>
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
                {!s.working.length ? <Empty>No hands-on step running.</Empty> : s.working.slice(0, 8).map((w, i) => (
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
                <div style={sectionHead}>In the oven — the operator is free <span style={es}>En el horno — el operador está libre</span></div>
                {!s.oven.length ? <Empty>The oven is empty.</Empty> : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6vw' }}>
                        {s.oven.slice(0, 6).map((o, i) => (
                            <div key={i} style={{ border: `1px solid ${o.done ? C.warn : C.oven}`, padding: '0.5vw 0.7vw' }}>
                                <div style={{ fontFamily: mono, fontSize: T.body }}>{o.ref} <span style={{ color: C.soft, fontSize: T.small }}>{o.step}</span></div>
                                <div style={{ fontSize: T.body, color: o.done ? C.warn : C.oven, fontWeight: 600 }}>{o.done ? 'Done — take it out' : `${sayMins(o.leftMins)} left`}</div>
                                <div style={{ fontSize: T.small, color: C.soft }}>{o.who ? `${o.who} · free` : ''}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <div style={panel}>
                <div style={sectionHead}>Crew today <span style={es}>Equipo de hoy</span></div>
                {!s.crew.length ? <Empty>No one has punched a step today yet.</Empty> : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5vw' }}>
                        {s.crew.map(p => (
                            <span key={p.name} style={{ fontSize: T.body, padding: '0.3vw 0.8vw', border: `1px solid ${p.state === 'working' ? C.good : p.state === 'free' ? C.oven : C.line}`, color: p.state === 'none' ? C.soft : C.ink }}>
                                <strong>{p.name}</strong> · {p.state === 'working' ? `${p.doing.step} ${p.doing.ref}` : p.state === 'free' ? 'free — product in the oven' : 'no step running'}
                            </span>
                        ))}
                    </div>
                )}
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

function WeekRight({ half }) {
    if (!half) {
        return (
            <div style={{ ...panel, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: '1vw' }}>
                <div style={{ fontSize: T.title, color: C.brass }}>🏆 The week's board</div>
                <div style={{ fontSize: T.body, color: C.soft, maxWidth: '80%' }}>Not published yet. HQ → System Admin → Floor Metrics → "Publish week to wallboard".</div>
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
    return (
        <div style={{ display: 'grid', gridTemplateRows: 'auto auto auto 1fr', gap: '0.8vw', minHeight: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: T.h, fontFamily: mono, textTransform: 'uppercase', letterSpacing: '.12em', color: C.brass }}>Week of {range(half.week)} – {range(half.weekEnd)}</div>
                <div style={{ fontSize: T.small, color: C.soft }}>published {when}{half.publishedBy ? ` by ${half.publishedBy}` : ''}</div>
            </div>
            <Hall title="🏆 Hall of fame" sub="Salón de la fama" rows={half.fame} colour={C.good} icon={(i) => medal[i] || ''} />
            <Hall title="⚠ Hall of shame" sub="Salón de la vergüenza" rows={half.shame} colour={C.bad} />
            <div style={panel}>
                <div style={sectionHead}>Everyone <span style={es}>Todos</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '1.2vw' }}>
                    {half.ranked.map(r => (
                        <div key={r.name} style={{ display: 'grid', gridTemplateColumns: '2.2em 1fr auto', gap: '0.5vw', alignItems: 'baseline', padding: '0.25vw 0', borderTop: `1px solid ${C.line}` }}>
                            <span style={{ fontSize: T.body, color: C.soft }}>{r.rank}.</span>
                            <span style={{ fontSize: T.body }}>{r.name}</span>
                            <span style={{ fontSize: T.body, fontWeight: 600, color: r.score >= 75 ? C.good : r.score >= 50 ? C.warn : C.bad }}>{r.score}</span>
                        </div>
                    ))}
                </div>
            </div>
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
export default function WallboardScreen({ side = 'finishing', db, workOrders = [], sysConfig = {}, wms = {} }) {
    const [now, setNow] = useState(Date.now());
    const [published, setPublished] = useState(null);
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
        : floorNowOf({ workOrders, cfg: floorTimersOf(sysConfig), nowMs: now })), [side, wms, workOrders, sysConfig, now]);
    const half = useMemo(() => boardHalfOf(published, side === 'wms' ? GROUP.WMS : GROUP.FINISHING), [published, side]);

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
                    </div>
                    <button onClick={toggleFull} title={full ? 'Leave full screen' : 'Fill the monitor (and keep it awake)'} style={{ background: 'transparent', color: C.soft, border: `1px solid ${C.line}`, padding: '0.4vw 0.8vw', fontFamily: mono, fontSize: T.small, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                        {full ? '✕ Exit' : '⛶ Full screen'}
                    </button>
                </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '58fr 42fr', gap: '1.2vw', minHeight: 0 }}>
                {side === 'wms' ? <WmsLeft s={status} /> : <FloorLeft s={status} />}
                <WeekRight half={half} />
            </div>
        </div>
    );
}
