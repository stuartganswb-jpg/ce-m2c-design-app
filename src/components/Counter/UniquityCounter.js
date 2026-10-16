// ── THE UNIQUITY SHOW COUNTER — its own address, tab 7 underneath (S7, 2026-10-12) ─────────────────
//
// Stuart: "build a lean counter page, something purpose built just for these shows … choosing icons
// rather than drop downs, so throws, pillows, then pillow sizes, etc." · "own pins" · "turn the table
// towards them and they scan a QR" · "it can also push the sales order to crm and we can later email
// from there as backup". This page is a PIN screen and a header around QuickShipTab in `counterMode`:
// the counter's screens (HQ/CounterScreens — customer → Throws / Pillows / Custom pillow / Samples →
// tiles → Add), then tab 7's own cart, Create Sales Order / Create Quote, and the pay-link QR. Every
// rule, every document and every NetSuite write is tab 7's — a counter order IS an Order Entry order.
import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, functions, getOuterIdToken } from '../../firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { setAuditPage } from '../Shared/auditContext';
import QuickShipTab from '../HQ/QuickShipTab';

const mono = { fontFamily: 'var(--mono, monospace)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#777' };
const card = { background: '#fff', border: '1px solid #ddd', borderRadius: '2px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };
const btn = (primary) => ({ padding: '10px 16px', background: primary ? '#1a1a1a' : 'transparent', color: primary ? '#fff' : '#1a1a1a', border: primary ? 'none' : '1px solid #ccc', cursor: 'pointer', ...mono, color: primary ? '#fff' : '#1a1a1a' });
const field = { padding: '10px 12px', border: '1px solid #ccc', fontFamily: 'var(--sans, sans-serif)', fontSize: '1rem', outline: 'none', boxSizing: 'border-box', background: '#fff', borderRadius: '2px' };

const UniquityCounter = () => {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [pinInput, setPinInput] = useState('');
    useEffect(() => { setAuditPage({ app: 'Show Counter', tab: 'Counter', user: (user && user.name) || '' }); }, [user]);
    const headerRef = useRef(null);
    const [headerH, setHeaderH] = useState(64);
    useEffect(() => {
        const el = headerRef.current;
        if (!el) return undefined;
        const measure = () => setHeaderH(el.offsetHeight || 64);
        measure();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        if (ro) ro.observe(el);
        window.addEventListener('resize', measure);
        return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
    }, [user]);

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
                <form onSubmit={attemptLogin} style={{ ...card, width: '340px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={mono}>Uniquity</div>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif, serif)', fontWeight: 500 }}>🛋 Show Counter</h2>
                    <input type="password" inputMode="numeric" autoFocus value={pinInput} onChange={e => setPinInput(e.target.value)} placeholder="PIN" style={{ ...field, fontSize: '1.4rem', letterSpacing: '.3em', textAlign: 'center' }} />
                    <button type="submit" style={btn(true)}>Sign in</button>
                    <button type="button" onClick={() => navigate('/')} style={btn(false)}>← Hub</button>
                </form>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: '#faf8f5', fontFamily: 'var(--sans, sans-serif)', color: '#1a1a1a', '--counter-header-h': `${headerH}px` }}>
            {/* the header's measured height rides a CSS variable: the counter's own bar (Customer · Menu · $$ Price list · Cart) sticks right beneath it (Stuart 2026-10-15) */}
            <div ref={headerRef} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 20px', background: '#fff', borderBottom: '1px solid #ddd', flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 50 }}>
                <div style={{ fontFamily: 'var(--serif, serif)', fontSize: '1.3rem' }}>🛋 Uniquity · Show Counter</div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={mono}>{user.name}</span>
                    <button onClick={() => setUser(null)} style={btn(false)}>Switch user</button>
                    <button onClick={() => navigate('/')} style={btn(false)}>Hub</button>
                </div>
            </div>
            <QuickShipTab currentUser={user.name} activeBrand="uniquity" counterMode userRole={user.role} />
        </div>
    );
};

export default UniquityCounter;
