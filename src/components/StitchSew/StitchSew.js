// ── STITCH & SEW — the Uniquity sewing floor (S7, step 5b, 2026-10-11) ────────────────────────────
//
// Stuart 2026-10-11: "let's set up stitch and sew, finishing still has a lot of dev work and maybe this
// stitch and sew grows to something bigger itself." Its own app at /stitch-sew, on the SAME documents the
// spine writes (`fin_workorders` with `division: 'SEW'` — Shared/sewRouteShape), the same login (the PIN
// callable), the same gates (Shared/orderStatus), the same staging handshake, the same report to RTG
// (Shared/orderLifecycle.propagateFloorState) and the same end (currentPhase 'Complete' → SO Pack). Every
// PIN user may use it (Stuart: "they can all fall under operators"); nothing here is role-gated.
//
// Screens: QUEUE (documents waiting on the WMS pick / staging; Start · To the floor · the label) ·
// FLOOR (the four zones CUT · SEW · STUFF · PACK; the CUT question writes the fabric cut ledger) ·
// DONE (the last seven days) · CUT STOCK (Shared/FabricCutStock, the same drill-down 6.5 shows).
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { finishingDb as db, auth, functions, getOuterIdToken } from '../../firebase';
import { collection, onSnapshot, query, where, doc, getDoc, getDocs, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { setAuditPage } from '../Shared/auditContext';
import { propagateFloorState } from '../Shared/orderLifecycle';
import { sewQueueOf, sewFloorOf, sewDoneOf, sewPhaseOf } from '../Shared/sewFloor';
import FabricCutStock from '../Shared/FabricCutStock';
import SewQueue from './SewQueue';
import SewFloor from './SewFloor';

const TABS = ['QUEUE', 'FLOOR', 'DONE', 'CUT STOCK'];
const BRAND = 'uniquity';
export const sewStyles = {
    mono: { fontFamily: 'var(--mono, monospace)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#777' },
    card: { background: '#fff', border: '1px solid #ddd', borderRadius: '2px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
    btn: (primary, disabled) => ({ padding: '10px 16px', background: disabled ? '#eee' : (primary ? '#1a1a1a' : 'transparent'), color: disabled ? '#999' : (primary ? '#fff' : '#1a1a1a'), border: primary ? 'none' : '1px solid #bbb', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono, monospace)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', borderRadius: '2px' }),
    field: { padding: '10px 12px', border: '1px solid #ccc', fontFamily: 'var(--sans, sans-serif)', fontSize: '1rem', outline: 'none', boxSizing: 'border-box', background: '#fff', borderRadius: '2px' },
};

const StitchSew = () => {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [pinInput, setPinInput] = useState('');
    const [activeTab, setActiveTab] = useState('QUEUE');
    const [docsRaw, setDocsRaw] = useState([]);
    const [inventory, setInventory] = useState([]);
    const [now, setNow] = useState(Date.now());
    useEffect(() => { setAuditPage({ app: 'Stitch & Sew', tab: activeTab, user: (user && user.name) || '' }); }, [activeTab, user]);
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

    useEffect(() => {
        if (!user) return undefined;
        const unsubs = [
            onSnapshot(query(collection(db, 'fin_workorders'), where('division', '==', 'SEW')), s => setDocsRaw(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => { console.warn('sew documents listen failed', e); setDocsRaw([]); }),
        ];
        (async () => {
            try {
                const snap = await getDocs(query(collection(db, 'Approved_Designs'), where('brandId', '==', BRAND)));
                setInventory(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (e) { console.warn('library read failed', e); }
        })();
        return () => unsubs.forEach(u => u());
    }, [user]);

    const docs = useMemo(() => docsRaw.filter(d => !d.brand || String(d.brand).toLowerCase() === BRAND), [docsRaw]);
    const queue = useMemo(() => sewQueueOf(docs), [docs]);
    const floor = useMemo(() => sewFloorOf(docs), [docs]);
    const done = useMemo(() => sewDoneOf(docs, now), [docs, now]);
    const findPart = (code) => inventory.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === String(code || '').toUpperCase()) || null;

    const writeLog = async (msg, cat = 'production') => {
        try { await addDoc(collection(db, 'hq_logs'), { u: (user && user.name) || 'Unknown', msg, cat, src: 'STITCH_SEW', page: `Stitch & Sew · ${activeTab}`, t: serverTimestamp() }); }
        catch (e) { console.error('log failed', e); }
    };
    // Tell the RTG record what the floor just did — the ONE propagation every floor uses.
    const tellRtg = async (wo, phase) => {
        try { await propagateFloorState({ db, doc, getDoc, getDocs, query, collection, where, updateDoc }, { finWo: wo, phase, by: (user && user.name) || '' }); }
        catch (e) { console.warn('RTG propagate failed (floor state stands):', e); }
    };

    const attemptLogin = async (e) => {
        e.preventDefault();
        if (!pinInput) return;
        try {
            const authenticatePin = httpsCallable(functions, 'authenticatePin');
            const result = await authenticatePin({ pin: pinInput, outerToken: await getOuterIdToken() });
            const { token, user: userData } = result.data;
            await signInWithCustomToken(auth, token);
            setUser(userData);
            setPinInput('');
        } catch (err) {
            console.error(err);
            alert('Authentication failed: ' + (err.message || 'Invalid PIN'));
            setPinInput('');
        }
    };

    if (!user) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf8f5', fontFamily: 'var(--sans, sans-serif)' }}>
                <form onSubmit={attemptLogin} style={{ ...sewStyles.card, width: '340px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={sewStyles.mono}>Uniquity</div>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif, serif)', fontWeight: 500 }}>🪡 Stitch &amp; Sew</h2>
                    <input type="password" inputMode="numeric" autoFocus value={pinInput} onChange={e => setPinInput(e.target.value)} placeholder="PIN" style={{ ...sewStyles.field, fontSize: '1.4rem', letterSpacing: '.3em', textAlign: 'center' }} />
                    <button type="submit" style={sewStyles.btn(true, false)}>Sign in</button>
                    <button type="button" onClick={() => navigate('/')} style={sewStyles.btn(false, false)}>← Hub</button>
                </form>
            </div>
        );
    }

    const counts = { QUEUE: queue.length, FLOOR: floor.length, DONE: done.length, 'CUT STOCK': null };
    return (
        <div style={{ minHeight: '100vh', background: '#faf8f5', fontFamily: 'var(--sans, sans-serif)', color: '#1a1a1a' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 20px', background: '#fff', borderBottom: '1px solid #ddd', flexWrap: 'wrap' }}>
                <div style={{ fontFamily: 'var(--serif, serif)', fontSize: '1.3rem' }}>🪡 Stitch &amp; Sew</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                    {TABS.map(t => <button key={t} onClick={() => setActiveTab(t)} style={{ ...sewStyles.btn(activeTab === t, false), padding: '8px 12px' }}>{t}{counts[t] !== null && counts[t] !== undefined ? ` · ${counts[t]}` : ''}</button>)}
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={sewStyles.mono}>{user.name}</span>
                    <button onClick={() => setUser(null)} style={sewStyles.btn(false, false)}>Switch user</button>
                    <button onClick={() => navigate('/')} style={sewStyles.btn(false, false)}>Hub</button>
                </div>
            </div>
            <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
                {activeTab === 'QUEUE' && <SewQueue docs={queue} user={user} findPart={findPart} writeLog={writeLog} tellRtg={tellRtg} />}
                {activeTab === 'FLOOR' && <SewFloor docs={floor} user={user} findPart={findPart} writeLog={writeLog} tellRtg={tellRtg} />}
                {activeTab === 'DONE' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {done.length === 0 && <div style={{ ...sewStyles.card, color: '#777' }}>Nothing completed in the last seven days.</div>}
                        {done.map(d => (
                            <div key={d.id} style={{ ...sewStyles.card, display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: 'var(--mono, monospace)', fontWeight: 700 }}>{d.woNum || d.id}</span>
                                <span>{d.customer}</span>
                                <span style={{ color: '#777' }}>{d.itemName}</span>
                                <span style={{ marginLeft: 'auto', ...sewStyles.mono }}>{sewPhaseOf(d)} · {d.completedAt ? new Date(d.completedAt).toLocaleString() : ''} · {d.completedBy || ''}</span>
                            </div>
                        ))}
                    </div>
                )}
                {activeTab === 'CUT STOCK' && <FabricCutStock activeBrand={BRAND} currentUser={user.name || 'Sew'} />}
            </div>
        </div>
    );
};

export default StitchSew;
