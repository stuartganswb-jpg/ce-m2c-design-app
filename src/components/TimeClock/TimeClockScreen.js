// ⏱ THE TIME CLOCK — /time-clock, a kiosk for any tablet (Stuart 2026-10-13 / 10-14, phase 4): PIN → Clock in · Lunch out ·
// Lunch in · Clock out → done, signed out again. "need to track clock in, lunch out, lunch in, end of day out".
// The punch is the person's OWN (the name on their PIN token) at the SERVER's time; the clock runs on its own Firebase
// instance so a punch never switches or logs out the floor app in the next tab (Shared/timeClockFirebase). Out-of-order
// punches are asked about, in English and Spanish, and still allowed — a wrong punch is corrected in HQ (System Admin →
// Time Clock & Payroll), never lost. The rules: Shared/timeClock.
// 🔒 ONLY ON THE SHOP'S TABLETS, ON THE SHOP'S NETWORK (Stuart 2026-10-16: "both locks, so personal phones are refused.
// one wifi network"). The punch is written by the clockPunch Cloud Function, which takes it only from an enrolled tablet
// (the id kept on this tablet, below) on a trusted network (functions/timeClockGuard.js). Before the keypad shows, the
// server is asked whether this is such a tablet (clockCheck); an admin sets a tablet up — or trusts the network — HERE,
// with their PIN (clockDevice).
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { getOuterIdToken } from '../../firebase';
import { clockFirebase } from '../Shared/timeClockFirebase';
import { PUNCH, PUNCH_LABEL, clockKeyOf, clockOfferOf, punchOrderWarning } from '../Shared/timeClock';

const C = { bg: '#121110', panel: '#1c1a17', line: 'rgba(244,241,234,.14)', ink: '#f4f1ea', soft: 'rgba(244,241,234,.6)', brass: '#c9a36a', good: '#5cb85c', bad: '#e5534b' };
const mono = "'IBM Plex Mono', monospace";
const ORDER = [PUNCH.IN, PUNCH.LUNCH_OUT, PUNCH.LUNCH_IN, PUNCH.OUT];
const IDLE_MS = 30000;     // signed in and nothing pressed → back to the keypad
const DONE_MS = 4000;      // how long "✓ Clocked in 6:58" stays
const fmt = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const NOT_ON = 'The time clock is not switched on yet — tell the office.\nEl reloj todavía no está activado — avise a la oficina.';
// This tablet's id as a shop time clock — given by clockDevice when an admin sets it up. Nothing else is kept here.
const DEVICE_KEY = 'ce_time_clock_device';
const readDevice = () => { try { return localStorage.getItem(DEVICE_KEY) || ''; } catch (e) { return ''; } };
const writeDevice = (id) => { try { localStorage.setItem(DEVICE_KEY, id); return true; } catch (e) { return false; } };
const isAdminRole = (r) => ['admin', 'superadmin'].includes(String(r || '').toLowerCase().replace(/[^a-z]/g, ''));

export default function TimeClockScreen() {
    const navigate = useNavigate();
    const [now, setNow] = useState(Date.now());
    const [pin, setPin] = useState('');
    const [busy, setBusy] = useState(false);
    const [who, setWho] = useState(null);          // { name, role }
    const [status, setStatus] = useState(null);    // time_status/<key>
    const [done, setDone] = useState(null);        // { kind, at }
    const [error, setError] = useState('');
    const [check, setCheck] = useState(null);      // clockCheck: { enrolled, deviceName, onSite, ip, chain, networksSet } | { failed }
    const [mode, setMode] = useState('punch');     // 'punch' | 'setup' (enroll this tablet) | 'trust' (trust this network) — admin PIN
    const idle = useRef(null);
    const recheck = async () => {
        try { const r = await httpsCallable(clockFirebase().functions, 'clockCheck')({ deviceId: readDevice() }); setCheck(r.data); }
        catch (e) { setCheck({ failed: true }); }
    };
    useEffect(() => { recheck(); const t = setInterval(recheck, 5 * 60000); return () => clearInterval(t); }, []);

    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
    const reset = async () => {
        clearTimeout(idle.current);
        try { await signOut(clockFirebase().auth); } catch (e) { /* already out */ }
        setWho(null); setStatus(null); setDone(null); setPin(''); setBusy(false); setMode('punch');
    };
    useEffect(() => () => { clearTimeout(idle.current); try { signOut(clockFirebase().auth); } catch (e) { /* leaving */ } }, []);
    const armIdle = (ms = IDLE_MS) => { clearTimeout(idle.current); idle.current = setTimeout(reset, ms); };

    const enter = async () => {
        if (!pin || busy) return;
        setBusy(true); setError('');
        const fb = clockFirebase();
        try {
            const res = await httpsCallable(fb.functions, 'authenticatePin')({ pin, outerToken: await getOuterIdToken() });
            await signInWithCustomToken(fb.auth, res.data.token);
            const name = res.data.user.name;
            if (mode !== 'punch') { await adminAction(name, res.data.user.role); return; }
            let st = null;
            try { const s = await getDoc(doc(fb.db, 'time_status', clockKeyOf(name))); st = s.exists() ? s.data() : null; }
            catch (e) { if (String(e.code || e.message).includes('permission')) { setError(NOT_ON); await reset(); return; } throw e; }
            setWho({ name, role: res.data.user.role }); setStatus(st); setPin(''); armIdle();
        } catch (e) {
            setError(e.message || 'PIN not recognized — PIN no reconocido.'); setPin('');
            try { await signOut(fb.auth); } catch (x) { /* nothing to sign out */ }
        }
        setBusy(false);
    };

    // An admin, at this tablet: set it up as a shop time clock (and trust the network it is on), or trust this network.
    const adminAction = async (name, role) => {
        const fb = clockFirebase();
        try {
            if (!isAdminRole(role)) { setError(`${name} is not an admin — only an admin sets up a time clock.\n${name} no es administrador.`); return; }
            const where = (check && check.ip) || 'this network';
            if (!window.confirm(`${mode === 'setup' ? 'Set this tablet up as a shop time clock — and trust' : 'Trust'} the network it is on right now (${where}) as the shop's?\n\nDo this only AT the shop, on the shop Wi-Fi: punches will be taken from this network.`)) return;
            if (mode === 'setup') {
                const label = window.prompt('Name this tablet (e.g. "Finishing tablet 2"):', check && check.deviceName ? check.deviceName : '');
                if (!label || !label.trim()) return;
                const r = await httpsCallable(fb.functions, 'clockDevice')({ action: 'enroll', name: label.trim() });
                if (!writeDevice(r.data.deviceId)) { setError('This browser will not keep the tablet\'s id (private browsing?) — set it up in a normal window.'); return; }
            } else {
                await httpsCallable(fb.functions, 'clockDevice')({ action: 'trustNetwork', label: 'Shop Wi-Fi' });
            }
            await recheck();
        } catch (e) { setError(e.message || String(e)); }
        finally { await reset(); }
    };

    const punch = async (kind) => {
        if (!who || busy) return;
        const warning = punchOrderWarning(status, kind, Date.now());
        if (warning && !window.confirm(`${warning}\n\n${PUNCH_LABEL[kind].en} anyway? · ¿${PUNCH_LABEL[kind].es} de todos modos?`)) { armIdle(); return; }
        setBusy(true);
        const fb = clockFirebase();
        try {
            // the server takes it only from this tablet's enrolled id, on the shop network (functions clockPunch)
            const r = await httpsCallable(fb.functions, 'clockPunch')({ kind, deviceId: readDevice() });
            setDone({ kind, at: r.data.at }); armIdle(DONE_MS);
        } catch (e) {
            const code = String(e.code || '');
            setError(code.includes('not-found') || code.includes('internal') ? NOT_ON : `${e.message || e}\n\nThe punch was NOT recorded · El registro NO se guardó.`);
            armIdle(8000); recheck();
        }
        setBusy(false);
    };

    const offer = clockOfferOf(status, now);
    const ready = !!(check && !check.failed && check.enrolled && check.onSite);
    const big = { fontSize: 'clamp(16px, 2.2vw, 30px)' };
    return (
        <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, fontFamily: "'Inter', -apple-system, sans-serif", display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3vh 4vw', boxSizing: 'border-box' }}>
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 'clamp(22px, 3vw, 44px)' }}>⏱ Time Clock <span style={{ color: C.soft, fontSize: '0.6em' }}>· Reloj</span></div>
                <button onClick={() => { reset(); navigate('/'); }} style={{ background: 'transparent', color: C.soft, border: `1px solid ${C.line}`, padding: '8px 14px', fontFamily: mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }}>Hub</button>
            </div>
            <div style={{ fontSize: 'clamp(48px, 9vw, 140px)', fontWeight: 600, marginTop: '3vh', lineHeight: 1 }}>{new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</div>
            <div style={{ color: C.soft, ...big, marginBottom: '4vh' }}>{new Date(now).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>

            {error && <div style={{ whiteSpace: 'pre-line', color: C.bad, border: `1px solid ${C.bad}`, padding: '14px 18px', marginBottom: '3vh', maxWidth: '760px', ...big }}>{error}</div>}

            {/* 🔒 not a shop tablet, or not on the shop network: no keypad — say why, and let an admin fix it here */}
            {!who && mode === 'punch' && !ready && (
                <div style={{ textAlign: 'center', maxWidth: '760px', display: 'flex', flexDirection: 'column', gap: '18px', alignItems: 'center' }}>
                    {!check ? <div style={{ color: C.soft, ...big }}>Checking this tablet… · Revisando esta tableta…</div>
                        : check.failed ? <div style={{ color: C.bad, whiteSpace: 'pre-line', ...big }}>{NOT_ON}</div>
                        : <>
                            <div style={{ color: C.bad, ...big }}>{!check.enrolled
                                ? 'This device is not a shop time clock — punches are taken only on the shop tablets. · Este dispositivo no es un reloj de la tienda.'
                                : 'This tablet is not on the shop network — punches are taken only at the shop. · Esta tableta no está en la red de la tienda.'}</div>
                            <button onClick={() => { setError(''); setMode(check.enrolled ? 'trust' : 'setup'); }} style={{ padding: '14px 22px', background: 'transparent', color: C.brass, border: `1px solid ${C.brass}`, fontFamily: mono, fontSize: '13px', letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}>
                                {check.enrolled ? 'Admin: trust this network' : 'Admin: set up this tablet'}
                            </button>
                            <div style={{ color: C.soft, fontFamily: mono, fontSize: '11px' }}>network seen by the server: {check.ip || '—'}{check.networksSet ? '' : ' · no shop network trusted yet'}</div>
                        </>}
                </div>
            )}

            {!who && (ready || mode !== 'punch') && (
                <form onSubmit={e => { e.preventDefault(); enter(); }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
                    <div style={{ color: mode === 'punch' ? C.soft : C.brass, ...big }}>{mode === 'setup' ? 'Admin PIN — set up this tablet as a time clock' : mode === 'trust' ? 'Admin PIN — trust this network as the shop\'s' : 'Enter your PIN · Ingrese su PIN'}</div>
                    <input type="password" inputMode="numeric" autoFocus value={pin} maxLength={4} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                        style={{ width: '280px', textAlign: 'center', fontSize: '44px', letterSpacing: '18px', padding: '12px', background: C.panel, color: C.ink, border: `1px solid ${C.line}`, outline: 'none', fontFamily: mono }} />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 90px)', gap: '10px' }}>
                        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '→'].map(k => (
                            <button key={k} type={k === '→' ? 'submit' : 'button'} disabled={busy}
                                onClick={() => { if (k === '⌫') setPin(p => p.slice(0, -1)); else if (k !== '→') setPin(p => (p + k).slice(0, 4)); }}
                                style={{ height: '72px', fontSize: '28px', background: k === '→' ? C.brass : C.panel, color: k === '→' ? '#111' : C.ink, border: `1px solid ${C.line}`, cursor: 'pointer' }}>{k}</button>
                        ))}
                    </div>
                    {mode !== 'punch'
                        ? <button type="button" onClick={() => { setMode('punch'); setPin(''); }} style={{ background: 'transparent', color: C.soft, border: 'none', fontFamily: mono, fontSize: '12px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }}>Cancel · Cancelar</button>
                        : <div style={{ color: C.soft, fontFamily: mono, fontSize: '11px', marginTop: '6px' }}>🔒 {check.deviceName} · shop network <button type="button" onClick={() => { setError(''); setMode('setup'); }} style={{ marginLeft: '10px', background: 'transparent', color: C.soft, border: `1px solid ${C.line}`, fontFamily: mono, fontSize: '10px', cursor: 'pointer', padding: '2px 8px' }}>admin</button></div>}
                </form>
            )}

            {who && !done && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2.5vh', width: '100%', maxWidth: '900px' }}>
                    <div style={{ fontSize: 'clamp(26px, 3.6vw, 52px)', fontWeight: 600 }}>{who.name}</div>
                    <div style={{ color: C.soft, ...big, textAlign: 'center' }}>
                        {offer.stale
                            ? <span style={{ color: C.bad }}>Your last day ({offer.stale.day}) has no clock-out — your manager will correct it. · Su último día no tiene salida.</span>
                            : status && status.at
                                ? <>{{ in: 'Clocked in', lunch: 'Out to lunch', out: 'Clocked out' }[offer.state]} · last punch {PUNCH_LABEL[status.kind] ? PUNCH_LABEL[status.kind].en : ''} {fmt(status.at)}</>
                                : 'No punches yet · Sin registros todavía'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', width: '100%' }}>
                        {ORDER.map(kind => {
                            const expected = offer.expected.includes(kind);
                            return (
                                <button key={kind} onClick={() => punch(kind)} disabled={busy}
                                    style={{ padding: '3.2vh 10px', fontSize: 'clamp(20px, 2.8vw, 40px)', fontWeight: 600, cursor: 'pointer', border: `2px solid ${expected ? C.brass : C.line}`, background: expected ? C.brass : C.panel, color: expected ? '#111' : C.soft }}>
                                    {PUNCH_LABEL[kind].en}<div style={{ fontSize: '0.55em', fontWeight: 400 }}>{PUNCH_LABEL[kind].es}</div>
                                </button>
                            );
                        })}
                    </div>
                    <button onClick={reset} style={{ background: 'transparent', color: C.soft, border: 'none', fontFamily: mono, fontSize: '12px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }}>Cancel · Cancelar</button>
                </div>
            )}

            {who && done && (
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 'clamp(40px, 6vw, 90px)', color: C.good, fontWeight: 700 }}>✓ {PUNCH_LABEL[done.kind].en}</div>
                    <div style={{ fontSize: 'clamp(22px, 3vw, 44px)', marginTop: '1vh' }}>{who.name} · {fmt(done.at)}</div>
                    <div style={{ color: C.soft, ...big, marginTop: '1vh' }}>{PUNCH_LABEL[done.kind].es}{done.kind === PUNCH.OUT ? ' — have a good evening · buenas noches' : ''}</div>
                </div>
            )}
        </div>
    );
}
