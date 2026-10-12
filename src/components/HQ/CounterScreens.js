// ── THE SHOW COUNTER'S SCREENS (Uniquity · S7, 2026-10-12) ────────────────────────────────────────
//
// Stuart: "a lean counter page, something purpose built just for these shows … some of the sales team
// would react a lot better if they drove thru the menus by choosing icons rather than drop downs, so
// throws, pillows, then pillow sizes, etc." These screens are the counter's face; the cart, the customer,
// the save and every rule stay tab 7's (QuickShipTab renders this in `counterMode` and hands it its own
// state) — one door, one spine. Screens: CUSTOMER → HOME (Throws · Pillows · Custom pillow · Samples) →
// the tiles → Add; the cart rides beneath. A new customer met at the show is written in the CRM's own
// shape (crm_records, the same record the CRM's + New makes).
import React, { useEffect, useState } from 'react';
import { db } from '../../firebase';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import PillowQuickSell from './PillowQuickSell';
import VisionPillow from './VisionPillow';

const mono = { fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const card = { background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' };
const inp = { boxSizing: 'border-box', padding: '14px 16px', fontSize: '1.1rem', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', background: '#fff', width: '100%' };
const bigTile = (on) => ({ flex: '1 1 200px', minHeight: '150px', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', fontFamily: 'var(--serif)', fontSize: '1.4rem', borderRadius: '2px' });
const btn = (primary) => ({ padding: '12px 18px', background: primary ? 'var(--ink)' : 'transparent', color: primary ? '#fff' : 'var(--ink)', border: primary ? 'none' : '1px solid var(--line)', cursor: 'pointer', ...mono, color: primary ? '#fff' : 'var(--ink)' });

const HOME = [
    { key: 'THROWS', glyph: '🧣', label: 'Throws', sub: 'the throw, standard or XL' },
    { key: 'PILLOWS', glyph: '🛋', label: 'Pillows', sub: 'size · fabric · edge' },
    { key: 'CUSTOM', glyph: '✂️', label: 'Custom pillow', sub: 'draw it on the board' },
    { key: 'SAMPLES', glyph: '🗂', label: 'Samples', sub: 'swatches, small or large' },
];

const CounterScreens = ({ currentUser, customers = [], customerId = '', selectedCustomer = null, onPickCustomer = () => {}, jobName = '', setJobName = () => {}, items = [], findPart, rateFor, onAddQuickSell = () => {}, onAddCustomPillow = () => {}, addLog = () => {}, cartCount = 0, cartTotal = 0, onShowCart = () => {} }) => {
    const [screen, setScreen] = useState(customerId ? 'HOME' : 'CUSTOMER');
    const [q, setQ] = useState('');
    const [newCust, setNewCust] = useState(null);   // { name, email, phone } while the form is open
    const [busy, setBusy] = useState(false);
    const [globalLists, setGlobalLists] = useState({ pillowSizes: [], fillTypes: ['DOWN', 'POLY'], flangeStyles: ['NONE', 'FLANGE'], stitchTypes: ['STANDARD'] });
    useEffect(() => onSnapshot(doc(db, 'system', 'master_lists'), s => { if (s.exists()) setGlobalLists(prev => ({ ...prev, ...s.data() })); }, () => {}), []);

    const matches = customers.filter(c => !q || `${c.name} ${c.id} ${c.email || ''} ${c.contact || ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 24);

    const createCustomer = async () => {
        const name = String(newCust && newCust.name || '').trim();
        if (!name) { addLog('A new customer needs a name.', 'error'); return; }
        setBusy(true);
        try {
            // the CRM's own record shape (ExternalCoopTab.handleCreateNewCrm): CUST-<4 digits>, brand uniquity
            const id = `CUST-${Math.floor(1000 + Math.random() * 9000)}`;
            const rec = { id, type: 'CUSTOMER', name, email: String(newCust.email || '').trim(), phone: String(newCust.phone || '').trim(), contact: name, salesRep: currentUser || '', terms: '', discountCode: '', creditLimit: '', billingAddress: '', shippingAddresses: [], brandId: 'uniquity', sharedBrands: ['uniquity'], createdAt: new Date().toISOString(), ytd: 0, mtd: 0, openOrders: 0, createdVia: 'SHOW_COUNTER' };
            await setDoc(doc(db, 'crm_records', id), rec);
            addLog(`👤 New customer ${name} (${id}) filed in the CRM.`, 'success');
            onPickCustomer(rec);
            setNewCust(null); setScreen('HOME');
        } catch (e) { addLog(`Could not create the customer: ${e.message || e}`, 'error'); }
        setBusy(false);
    };

    const crumb = (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button onClick={() => setScreen('CUSTOMER')} style={btn(false)}>👤 {selectedCustomer ? selectedCustomer.name : 'Customer'}</button>
            {screen !== 'CUSTOMER' && screen !== 'HOME' && <button onClick={() => setScreen('HOME')} style={btn(false)}>← Menu</button>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={mono}>{cartCount} line{cartCount === 1 ? '' : 's'} · ${Number(cartTotal || 0).toFixed(2)}</span>
                <button onClick={onShowCart} style={btn(true)}>🛒 Cart</button>
            </div>
        </div>
    );

    if (screen === 'CUSTOMER' || !customerId) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {crumb}
                <div style={{ ...card, padding: '20px' }}>
                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', marginBottom: '12px' }}>Who is this for?</div>
                    {!newCust ? (
                        <>
                            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type a name, a company, an email…" style={inp} />
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '12px' }}>
                                {matches.map(c => (
                                    <button key={c.id} onClick={() => { onPickCustomer(c); setScreen('HOME'); }} style={{ ...bigTile(customerId === c.id), minHeight: '90px', fontSize: '1.05rem', flex: '1 1 220px', alignItems: 'flex-start', padding: '14px', textAlign: 'left' }}>
                                        <span>{c.name}</span>
                                        <span style={{ ...mono, color: customerId === c.id ? '#ddd' : 'var(--ink-soft)' }}>{c.id}{c.email ? ` · ${c.email}` : ''}</span>
                                    </button>
                                ))}
                                {q && matches.length === 0 && <div style={{ color: 'var(--ink-soft)' }}>No customer matches.</div>}
                                <button onClick={() => setNewCust({ name: q, email: '', phone: '' })} style={{ ...bigTile(false), minHeight: '90px', fontSize: '1.05rem', flex: '1 1 220px', border: '1px dashed var(--brass)', color: 'var(--brass)' }}>＋ New customer{q ? ` "${q}"` : ''}</button>
                            </div>
                        </>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '520px' }}>
                            <input autoFocus value={newCust.name} onChange={e => setNewCust({ ...newCust, name: e.target.value })} placeholder="Name / company" style={inp} />
                            <input value={newCust.email} onChange={e => setNewCust({ ...newCust, email: e.target.value })} placeholder="Email" inputMode="email" style={inp} />
                            <input value={newCust.phone} onChange={e => setNewCust({ ...newCust, phone: e.target.value })} placeholder="Phone" inputMode="tel" style={inp} />
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <button onClick={createCustomer} disabled={busy} style={btn(true)}>{busy ? 'Saving…' : 'Save customer'}</button>
                                <button onClick={() => setNewCust(null)} style={btn(false)}>Back</button>
                            </div>
                        </div>
                    )}
                    <div style={{ marginTop: '16px' }}>
                        <span style={{ ...mono, display: 'block', marginBottom: '6px' }}>Job / sidemark (optional)</span>
                        <input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="e.g. Smith Residence" style={{ ...inp, maxWidth: '520px' }} />
                    </div>
                </div>
            </div>
        );
    }

    if (screen === 'HOME') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {crumb}
                <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                    {HOME.map(h => (
                        <button key={h.key} onClick={() => setScreen(h.key)} style={bigTile(false)}>
                            <span style={{ fontSize: '2.6rem' }}>{h.glyph}</span>
                            <span>{h.label}</span>
                            <span style={{ ...mono, fontSize: '10px' }}>{h.sub}</span>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    const fixedMode = screen === 'THROWS' ? 'THROW' : screen === 'SAMPLES' ? 'SAMPLE' : 'PILLOW';
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {crumb}
            {screen === 'CUSTOM' ? (
                <div style={card}>
                    <VisionPillow currentUser={currentUser} activeBrand="uniquity" visionConfigs={[]} libraryParts={items} globalLists={globalLists}
                        activeSession={{ quoteId: null, customerId, jobName }} customerName={(selectedCustomer && selectedCustomer.name) || ''}
                        counter onAddToCart={(line) => onAddCustomPillow(line)} />
                </div>
            ) : (
                <PillowQuickSell items={items} findPart={findPart} rateFor={rateFor} onAdd={onAddQuickSell} addLog={addLog} counter fixedMode={fixedMode} />
            )}
        </div>
    );
};

export default CounterScreens;
