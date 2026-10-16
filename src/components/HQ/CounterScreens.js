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
import CounterPriceList from './CounterPriceList';   // $$ price list — quick reference at the show (2026-10-15)
import { customerPayloadOf, createNsCustomer, crmRecordOf, crmRecordAppOnlyOf } from '../Shared/nsCustomer';   // a new customer is made in NetSuite FIRST (its id is the app's id)
import { nsProxyFetch } from '../Shared/nsProxy';
import { oneOfAKindAvailableOf, oneOfAKindOf, oneOfAKindQtyOf } from '../Shared/oneOfAKind';   // the pieces made at the show (S7, 2026-10-14)

const mono = { fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const card = { background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' };
const inp = { boxSizing: 'border-box', padding: '14px 16px', fontSize: '1.1rem', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', background: '#fff', width: '100%' };
const bigTile = (on) => ({ flex: '1 1 200px', minHeight: '150px', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px', fontFamily: 'var(--serif)', fontSize: '1.4rem', borderRadius: '2px' });
const btn = (primary) => ({ padding: '12px 18px', background: primary ? 'var(--ink)' : 'transparent', border: primary ? 'none' : '1px solid var(--line)', cursor: 'pointer', ...mono, color: primary ? '#fff' : 'var(--ink)' });

const HOME = [
    { key: 'THROWS', glyph: '🧣', label: 'Throws', sub: 'the throw, standard or XL' },
    { key: 'PILLOWS', glyph: '🛋', label: 'Pillows', sub: 'size · fabric · edge' },
    { key: 'CUSTOM', glyph: '✂️', label: 'Custom pillow', sub: 'draw it on the board' },
    { key: 'SAMPLES', glyph: '🗂', label: 'Samples', sub: 'swatches, small or large' },
    { key: 'OOAK', glyph: '🎁', label: 'One of a kind', sub: 'made at the show, one each' },
    { key: 'QUICKADD', glyph: '✚', label: 'Quick add', sub: 'not in the system yet — describe it, price it' },
];

const CounterScreens = ({ currentUser, customers = [], customerId = '', selectedCustomer = null, onPickCustomer = () => {}, jobName = '', setJobName = () => {}, items = [], findPart, rateFor, onAddQuickSell = () => {}, onAddCustomPillow = () => {}, addLog = () => {}, cartCount = 0, cartTotal = 0, onShowCart = () => {}, priceNote = '', onAddOneOfAKind = () => {}, onListReopenable = null, onReopen = null, onAddPlaceholder = null }) => {
    const [screen, setScreen] = useState(customerId ? 'HOME' : 'CUSTOMER');
    const [q, setQ] = useState('');          // the CUSTOMER search — cleared when a customer is picked
    const [wallQ, setWallQ] = useState('');
    const [reopenRows, setReopenRows] = useState(null);   // ⟲ Reopen: the last 30 days' quotes + orders, read on open
    const [reopenQ, setReopenQ] = useState('');
    const [qa, setQa] = useState({ description: '', price: '', qty: '1' });   // ✚ Quick add
    const loadReopenable = async () => {
        if (!onListReopenable) return;
        setReopenRows(null);
        try { setReopenRows(await onListReopenable()); } catch (e) { setReopenRows([]); addLog(`⛔ Could not read the quotes and orders: ${e.message || e}`, 'error'); }
    };  // the One of a kind wall's own search (Stuart 2026-10-15: "Pat" carried over from the customer search and hid every piece)
    const [newCust, setNewCust] = useState(null);   // { name, email, phone } while the form is open
    const [busy, setBusy] = useState(false);
    const [globalLists, setGlobalLists] = useState({ pillowSizes: [], fillTypes: ['DOWN', 'POLY'], flangeStyles: ['NONE', 'FLANGE'], stitchTypes: ['STANDARD'] });
    useEffect(() => onSnapshot(doc(db, 'system', 'master_lists'), s => { if (s.exists()) setGlobalLists(prev => ({ ...prev, ...s.data() })); }, () => {}), []);

    const matches = customers.filter(c => !q || `${c.name} ${c.id} ${c.email || ''} ${c.contact || ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 24);

    const [nsFail, setNsFail] = useState('');   // NetSuite's refusal, when it refused; offers the app-only save
    // A NEW CUSTOMER IS MADE IN NETSUITE FIRST (Stuart 2026-10-12): the app's customer id is the NetSuite id, so the
    // sales order can go straight to NetSuite. One synchronous POST, then the CRM record in the sync's own shape.
    const createCustomer = async () => {
        const name = String((newCust && newCust.name) || '').trim();
        if (!name) { addLog('A new customer needs a name.', 'error'); return; }
        setBusy(true); setNsFail('');
        try {
            const body = customerPayloadOf({ name, email: newCust.email, phone: newCust.phone, brand: 'uniquity', salesRep: currentUser || '' });
            if (!body.ok) { body.errors.forEach(e => addLog(`⛔ ${e.message}`, 'error')); setBusy(false); return; }
            const r = await createNsCustomer({ nsProxyFetch, payload: body.payload });
            if (!r.ok) { setNsFail(r.error); addLog(`⛔ NetSuite did not create the customer: ${r.error}`, 'error'); setBusy(false); return; }
            const rec = crmRecordOf({ nsId: r.nsId, name, email: newCust.email, phone: newCust.phone, brand: 'uniquity', by: currentUser || '' });
            await setDoc(doc(db, 'crm_records', rec.id), rec);
            addLog(`👤 New customer ${name} created in NetSuite (id ${r.nsId}) and filed in the CRM as ${rec.id}.`, 'success');
            onPickCustomer(rec);
            setNewCust(null); setScreen('HOME');
        } catch (e) { setNsFail(e.message || String(e)); addLog(`⛔ Could not create the customer in NetSuite: ${e.message || e}`, 'error'); }
        setBusy(false);
    };
    // NetSuite unreachable at the show: the sale is still recorded — in the app only, said on the record, and the
    // sales order's NetSuite push waits until the customer exists there (create + 11.1 sync, then Queue now on RTG).
    const createCustomerAppOnly = async () => {
        const name = String((newCust && newCust.name) || '').trim();
        if (!name) return;
        setBusy(true);
        try {
            const rec = crmRecordAppOnlyOf({ name, email: newCust.email, phone: newCust.phone, brand: 'uniquity', by: currentUser || '', reason: nsFail });
            await setDoc(doc(db, 'crm_records', rec.id), rec);
            addLog(`⚠ ${name} filed in the app only (${rec.id}) — NOT in NetSuite. The sales order will be recorded here and its NetSuite push will refuse until the customer is created in NetSuite and synced (11.1), then Queue now on RTG.`, 'warn');
            onPickCustomer(rec);
            setNewCust(null); setNsFail(''); setScreen('HOME');
        } catch (e) { addLog(`Could not file the customer: ${e.message || e}`, 'error'); }
        setBusy(false);
    };

    // the bar stays in reach at every point of a sale — sticky beneath the counter's header (Stuart 2026-10-15: "we need the menu
    // button at the top to stay visible so we can go back to just the price list")
    const crumb = (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', position: 'sticky', top: 'var(--counter-header-h, 64px)', zIndex: 40, background: '#faf8f5', padding: '8px 0', margin: '-8px 0' }}>
            <button onClick={() => setScreen('CUSTOMER')} style={btn(false)}>👤 {selectedCustomer ? selectedCustomer.name : 'Customer'}</button>
            {selectedCustomer && (
                // the email (and phone) on file — "a lot of customers don't know which email they gave us" (Stuart 2026-10-15)
                <span style={{ ...mono, textTransform: 'none', letterSpacing: 0, fontSize: '12px', color: selectedCustomer.email ? 'var(--ink)' : '#a86b00' }} title="What the CRM holds for this customer">
                    ✉ {selectedCustomer.email || 'no email on file'}{selectedCustomer.phone ? ` · ☎ ${selectedCustomer.phone}` : ''}
                </span>
            )}
            {selectedCustomer && priceNote && <span style={{ ...mono, color: /not read|carries no percent/.test(priceNote) ? '#a86b00' : 'var(--ink-soft)' }}>💲 {priceNote.replace(/^NetSuite price level /, '')}</span>}
            {screen !== 'CUSTOMER' && screen !== 'HOME' && <button onClick={() => setScreen('HOME')} style={btn(false)}>← Menu</button>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button onClick={() => setScreen(screen === 'PRICES' ? (customerId ? 'HOME' : 'CUSTOMER') : 'PRICES')} style={btn(screen === 'PRICES')} title="Base prices, and less 10–60% at a tick">$$ Price list</button>
                {onListReopenable && <button onClick={() => { if (screen === 'REOPEN') { setScreen(customerId ? 'HOME' : 'CUSTOMER'); return; } setScreen('REOPEN'); loadReopenable(); }} style={btn(screen === 'REOPEN')} title="Reopen a quote or sales order made in the last 30 days">⟲ Reopen</button>}
                <span style={mono}>{cartCount} line{cartCount === 1 ? '' : 's'} · ${Number(cartTotal || 0).toFixed(2)}</span>
                <button onClick={onShowCart} style={btn(true)}>🛒 Cart</button>
            </div>
        </div>
    );

    if (screen === 'REOPEN') {
        const t = reopenQ.trim().toLowerCase();
        const rows = (reopenRows || []).filter(r => !t || `${r.number} ${r.customer} ${r.kind}`.toLowerCase().includes(t));
        const when = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {crumb}
                <div style={{ ...card, padding: '20px' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem' }}>⟲ Reopen</div>
                        <input value={reopenQ} onChange={e => setReopenQ(e.target.value)} placeholder="customer · number" style={{ ...inp, width: '280px', padding: '10px 12px', fontSize: '1rem' }} />
                        <span style={mono}>{reopenRows === null ? 'reading…' : `${rows.length} of the last 30 days · tap one to load it into the cart`}</span>
                        <button onClick={loadReopenable} disabled={busy} style={btn(false)}>⟳</button>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '12px' }}>A reopened <b>quote</b> saves as the corrected quote and supersedes the old one (close the old estimate in NetSuite by hand). A reopened <b>sales order</b> saves as its replacement and closes the old one with a pointer.</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
                        {rows.map(r => (
                            <button key={`${r.kind}-${r.id}`} disabled={busy} onClick={async () => { setBusy(true); try { await onReopen(r); setScreen('HOME'); onShowCart(); } finally { setBusy(false); } }}
                                style={{ display: 'flex', gap: '14px', alignItems: 'center', textAlign: 'left', padding: '12px 14px', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', fontFamily: 'var(--sans)' }}>
                                <span style={{ ...mono, width: '96px', color: r.kind === 'QUOTE' ? 'var(--brass)' : '#2e7d32' }}>{r.kind}</span>
                                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, minWidth: '180px' }}>{r.number}</span>
                                <span style={{ fontSize: '1.05rem', flex: 1 }}>{r.customer || '—'}</span>
                                <span style={mono}>{r.lines} line{r.lines === 1 ? '' : 's'}{r.total ? ` · $${Number(r.total).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}</span>
                                <span style={mono}>{when(r.at)}{r.by ? ` · ${r.by}` : ''}</span>
                            </button>
                        ))}
                        {reopenRows !== null && rows.length === 0 && <div style={{ color: 'var(--ink-soft)' }}>Nothing to reopen in the last 30 days.</div>}
                    </div>
                </div>
            </div>
        );
    }

    if (screen === 'PRICES') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {crumb}
                {/* the LIST price: the item's own base, never the picked customer's level (that is what the counter's rate rule applies) */}
                <div style={{ ...card, padding: '20px' }}><CounterPriceList items={items} /></div>
            </div>
        );
    }

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
                                    <button key={c.id} onClick={() => { onPickCustomer(c); setQ(''); setScreen('HOME'); }} style={{ ...bigTile(customerId === c.id), minHeight: '90px', fontSize: '1.05rem', flex: '1 1 220px', alignItems: 'flex-start', padding: '14px', textAlign: 'left' }}>
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
                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                <button onClick={createCustomer} disabled={busy} style={btn(true)}>{busy ? 'Creating in NetSuite…' : 'Create customer (NetSuite + CRM)'}</button>
                                <button onClick={() => { setNewCust(null); setNsFail(''); }} style={btn(false)}>Back</button>
                            </div>
                            {nsFail && (
                                <div style={{ border: '1px solid #d9534f', background: '#fdf3f3', padding: '12px', fontSize: '0.9rem' }}>
                                    <div style={{ color: '#8a1f1f', marginBottom: '8px' }}>NetSuite did not create the customer: {nsFail}</div>
                                    <div style={{ color: 'var(--ink-soft)', marginBottom: '8px' }}>Fix it and try again, or file the customer in the app only — the sale is recorded, and its NetSuite push waits until the customer exists in NetSuite and is synced on 11.1.</div>
                                    <button onClick={createCustomerAppOnly} disabled={busy} style={btn(false)}>File in the app only for now</button>
                                </div>
                            )}
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

    if (screen === 'QUICKADD') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {crumb}
                <div style={{ ...card, padding: '20px' }}>
                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', marginBottom: '6px' }}>✚ Quick add</div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', marginBottom: '14px' }}>An item that is not in the system yet. Describe it and price it; it sells now at the customer's level. The order is recorded and its NetSuite push waits until the office identifies the item on RTG or the customer's CRM card — nothing starts or picks on a guess.</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '720px' }}>
                        <label><div style={mono}>Description</div><input autoFocus value={qa.description} onChange={e => setQa({ ...qa, description: e.target.value })} placeholder="what the customer is buying — e.g. hand-loomed lumbar, oatmeal, 20 × 12" style={inp} /></label>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <label style={{ flex: 1 }}><div style={mono}>Sale price $</div><input value={qa.price} onChange={e => setQa({ ...qa, price: e.target.value })} inputMode="decimal" style={{ ...inp, textAlign: 'right' }} /></label>
                            <label style={{ width: '140px' }}><div style={mono}>Qty</div><input value={qa.qty} onChange={e => setQa({ ...qa, qty: e.target.value })} inputMode="numeric" style={{ ...inp, textAlign: 'right' }} /></label>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => { if (onAddPlaceholder && onAddPlaceholder(qa)) { setQa({ description: '', price: '', qty: '1' }); setScreen('HOME'); onShowCart(); } }} style={btn(true)}>+ Add to cart</button>
                            <button onClick={() => setScreen('HOME')} style={btn(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (screen === 'OOAK') {
        const pieces = oneOfAKindAvailableOf(items).filter(it => !wallQ || `${it.legacyErpId} ${it.itemName}`.toLowerCase().includes(wallQ.toLowerCase()));
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {crumb}
                <div style={{ ...card, padding: '20px' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '12px' }}>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem' }}>🎁 One of a kind</div>
                        <input value={wallQ} onChange={e => setWallQ(e.target.value)} placeholder="tag · name" style={{ ...inp, width: '260px', padding: '10px 12px', fontSize: '1rem' }} />
                        <span style={mono}>{pieces.length} on the shelf · tap one to add it</span>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        {pieces.map(it => { const o = oneOfAKindOf(it) || {}; const pic = it.componentImageUrl || it.finalImageUrl || ''; return (
                            <button key={it.id} onClick={() => onAddOneOfAKind(it)} style={{ width: '200px', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', padding: '6px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <div style={{ width: '100%', height: '150px', background: '#efe9e0', overflow: 'hidden' }}>{pic ? <img src={pic} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ ...mono, padding: '12px' }}>{it.legacyErpId}</div>}</div>
                                <div style={{ fontSize: '0.95rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.itemName}</div>
                                <div style={{ ...mono }}>{it.legacyErpId} · {o.kind === 'WALL' ? 'wall art' : 'pillow'}{o.sizeKey ? ` · ${o.sizeKey}` : ''}{oneOfAKindQtyOf(it) > 1 ? ` · ${oneOfAKindQtyOf(it)} on hand` : ''}</div>
                                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>${Number((it.manufacturingSpecs && it.manufacturingSpecs.basePrice) || 0).toLocaleString()}</div>
                            </button>); })}
                        {pieces.length === 0 && <div style={{ color: 'var(--ink-soft)' }}>Nothing on the shelf — import the show pieces on 6.5 Tools → One-of-a-kind.</div>}
                    </div>
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
                <PillowQuickSell currentUser={currentUser} items={items} findPart={findPart} rateFor={rateFor} onAdd={onAddQuickSell} addLog={addLog} counter fixedMode={fixedMode} />
            )}
        </div>
    );
};

export default CounterScreens;
