import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, doc, onSnapshot, setDoc, getDoc } from "firebase/firestore";

// Stocked / pre-finished items are sold flat — each line goes to NetSuite as its own sales-order
// line (NO assembly/BOM rollup like the CPQ does). Quick Ship is the fast counter for that stock.
const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "20" },
    'ce': { subsidiary: "2", location: "17" },
    'leyla': { subsidiary: "5", location: "18" }
};
const FIREBASE_FUNCTION_URL = "https://netsuiteproxy-f3h3jadzaq-uc.a.run.app";
const KITS_DOC = { col: "system", id: "quick_ship_kits" };

// Map a part's productType/name to one of our slot categories.
const classifyCat = (pt) => {
    const t = String(pt || '').toUpperCase();
    if (t.includes('BACKPLATE') || t.includes('BACK PLATE')) return 'BACKPLATE';
    if (t.includes('BRACKET')) return 'BRACKET';
    if (t.includes('FINIAL')) return 'FINIAL';
    if (t.includes('RING')) return 'RING';
    if (t.includes('POLE') || t.includes('ROD')) return 'POLE';
    return '';
};
const erpOf = (it) => String(it.legacyErpId || it.itemId || '').toUpperCase();
const nsIdOf = (it) => it.netSuiteInternalId || it.legacyErpId || it.itemId || '';

// Compact searchable picker — shows "ITEM# — Name", sorted by item# (numeric-aware).
const ItemSelect = ({ value, onChange, items, placeholder }) => {
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const it = items.find(x => x.id === value);
        setSearch(it ? `${erpOf(it)} — ${it.itemName}` : '');
    }, [value, items]);
    const q = search.toLowerCase();
    const filtered = items
        .filter(it => !value || open ? (erpOf(it).toLowerCase().includes(q) || String(it.itemName || '').toLowerCase().includes(q)) : true)
        .sort((a, b) => erpOf(a).localeCompare(erpOf(b), undefined, { numeric: true, sensitivity: 'base' }))
        .slice(0, 60);
    return (
        <div style={{ position: 'relative' }}>
            <input
                value={search}
                onChange={e => { setSearch(e.target.value); setOpen(true); if (e.target.value === '') onChange(''); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 200)}
                placeholder={placeholder || 'Search item #…'}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px', fontSize: '0.85rem', fontFamily: 'var(--mono)', border: '1px solid var(--line)', outline: 'none' }}
            />
            {open && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--line)', maxHeight: '240px', overflowY: 'auto', zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                    {filtered.length === 0 && <div style={{ padding: '10px', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.8rem' }}>No matches.</div>}
                    {filtered.map(it => (
                        <div key={it.id} onMouseDown={() => { onChange(it.id); setOpen(false); }}
                            style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '0.82rem', borderBottom: '1px solid var(--paper-2)', display: 'flex', justifyContent: 'space-between', gap: '10px' }}
                            onMouseOver={e => e.currentTarget.style.background = 'var(--paper)'}
                            onMouseOut={e => e.currentTarget.style.background = '#fff'}>
                            <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>{erpOf(it)}</span>
                            <span style={{ color: 'var(--ink-soft)', textAlign: 'right', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.itemName}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const EMPTY_KB = { poleId: '', poleQty: 1, bracketId: '', bracketQty: 2, ringId: '', ringQty: 14, finialId: '', finialQty: 2, cutId: '', cutLen: '', cutQty: 1, spliceId: '', spliceQty: 1, miterId: '', miterQty: 1 };

const QuickShipTab = ({ currentUser, activeBrand }) => {
    const [allItems, setAllItems] = useState([]);     // every brand part (for fee lookup)
    const [customers, setCustomers] = useState([]);
    const [kits, setKits] = useState([]);             // saved prebuilt kits

    const [customerId, setCustomerId] = useState('');
    const [custSearch, setCustSearch] = useState('');
    const [custOpen, setCustOpen] = useState(false);
    const [jobName, setJobName] = useState('');

    const [cart, setCart] = useState([]);             // flat lines
    const [quickItemId, setQuickItemId] = useState('');
    const [quickQty, setQuickQty] = useState(1);
    const [kb, setKb] = useState(EMPTY_KB);
    const [kitName, setKitName] = useState('');

    const [pushing, setPushing] = useState(false);
    const [log, setLog] = useState([]);
    const addLog = (msg, type = 'info') => setLog(prev => [{ time: new Date().toLocaleTimeString(), msg, type }, ...prev]);

    useEffect(() => {
        if (!activeBrand) return;
        const unsubParts = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
            setAllItems(docs);
        }, e => console.warn('Quick Ship parts listen failed', e));
        const unsubCrm = onSnapshot(collection(db, "crm_records"), (snap) => {
            setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r =>
                r.type === 'CUSTOMER' && (r.brandId === activeBrand || (r.sharedBrands && r.sharedBrands.includes(activeBrand)))));
        }, e => console.warn('Quick Ship crm listen failed', e));
        const unsubKits = onSnapshot(doc(db, KITS_DOC.col, KITS_DOC.id), (s) => {
            setKits(s.exists() && Array.isArray(s.data().kits) ? s.data().kits : []);
        }, e => console.warn('Quick Ship kits listen failed', e));
        return () => { unsubParts(); unsubCrm(); unsubKits(); };
    }, [activeBrand]);

    // Strictly-stocked: only items flagged isStocked feed quick-add + the part dropdowns.
    const stocked = useMemo(() => allItems.filter(it => it.manufacturingSpecs?.isStocked === true), [allItems]);
    const catOf = (it) => classifyCat(it.manufacturingSpecs?.productType || it.productType || it.customData?.category);
    const byCat = (cat) => stocked.filter(it => catOf(it) === cat);
    const poles = useMemo(() => byCat('POLE'), [stocked]);     // eslint-disable-line react-hooks/exhaustive-deps
    const brackets = useMemo(() => byCat('BRACKET'), [stocked]); // eslint-disable-line react-hooks/exhaustive-deps
    const rings = useMemo(() => byCat('RING'), [stocked]);      // eslint-disable-line react-hooks/exhaustive-deps
    const finials = useMemo(() => byCat('FINIAL'), [stocked]);  // eslint-disable-line react-hooks/exhaustive-deps

    // Fee / billable items — matched by keyword across ALL brand parts (fees aren't usually "stocked").
    const feeItems = (kw) => allItems.filter(it => {
        const hay = `${it.manufacturingSpecs?.productType || ''} ${it.productType || ''} ${it.itemName || ''} ${it.customData?.feeType || ''}`.toUpperCase();
        return kw.some(k => hay.includes(k));
    });
    const cutItems = useMemo(() => feeItems(['CUT']), [allItems]);            // eslint-disable-line react-hooks/exhaustive-deps
    const spliceItems = useMemo(() => feeItems(['SPLICE']), [allItems]);      // eslint-disable-line react-hooks/exhaustive-deps
    const miterItems = useMemo(() => feeItems(['MITER', 'RETURN']), [allItems]); // eslint-disable-line react-hooks/exhaustive-deps

    const itemById = (id) => allItems.find(it => it.id === id);
    const rateFor = (it) => {
        let r = parseFloat(it.manufacturingSpecs?.basePrice || 0) || 0;
        const cp = it.clientPricing?.find(c => c.customerId === customerId);
        if (cp && cp.price !== undefined && cp.price !== '' && !isNaN(parseFloat(cp.price))) r = parseFloat(cp.price);
        return r;
    };

    const pushLine = (it, qty, note) => {
        if (!it) return;
        setCart(prev => [...prev, {
            key: `${it.id}-${Date.now()}-${Math.round(prev.length)}`,
            itemId: it.id, erp: erpOf(it), nsId: nsIdOf(it), name: it.itemName || erpOf(it),
            qty: Math.max(1, parseInt(qty) || 1), rate: rateFor(it), note: note || '',
            bin: it.manufacturingSpecs?.homeBin || it.binLocation || ''
        }]);
    };

    const addQuick = () => {
        const it = itemById(quickItemId);
        if (!it) return alert('Pick a stocked item first.');
        pushLine(it, quickQty, '');
        setQuickItemId(''); setQuickQty(1);
        addLog(`Added ${erpOf(it)} ×${quickQty}`, 'success');
    };

    // Resolve a kit-builder config into flat lines against CURRENT inventory (prices re-resolve live).
    const resolveKb = (cfg) => {
        const out = [];
        const add = (id, qty, note) => { const it = itemById(id); if (it && qty > 0) out.push({ it, qty: parseInt(qty) || 1, note: note || '' }); };
        add(cfg.poleId, cfg.poleQty, '');
        add(cfg.bracketId, cfg.bracketQty, '');
        add(cfg.ringId, cfg.ringQty, '');
        add(cfg.finialId, cfg.finialQty, '');
        add(cfg.cutId, cfg.cutQty, cfg.cutLen ? `cut @ ${cfg.cutLen}` : 'cut');
        add(cfg.spliceId, cfg.spliceQty, 'splice');
        add(cfg.miterId, cfg.miterQty, 'miter return');
        return out;
    };

    const addKbToCart = () => {
        const lines = resolveKb(kb);
        if (!lines.length) return alert('Fill at least one field in the kit builder.');
        lines.forEach(l => pushLine(l.it, l.qty, l.note));
        addLog(`Kit builder → ${lines.length} line(s) added`, 'success');
        setKb(EMPTY_KB);
    };

    const addSavedKit = (kit) => {
        const lines = resolveKb(kit.cfg || {});
        if (!lines.length) return alert('That kit has no resolvable stocked items right now.');
        lines.forEach(l => pushLine(l.it, l.qty, l.note));
        addLog(`Kit "${kit.name}" → ${lines.length} line(s) added`, 'success');
    };

    const saveKit = async () => {
        const name = (kitName || '').trim();
        if (!name) return alert('Name the kit first.');
        if (!resolveKb(kb).length) return alert('Build a kit (fill some fields) before saving.');
        try {
            const ref = doc(db, KITS_DOC.col, KITS_DOC.id);
            const snap = await getDoc(ref);
            const existing = snap.exists() && Array.isArray(snap.data().kits) ? snap.data().kits : [];
            const others = existing.filter(k => !(k.name === name && k.brand === activeBrand));
            const next = [...others, { name, brand: activeBrand, cfg: { ...kb }, savedBy: currentUser || '', savedAt: Date.now() }];
            await setDoc(ref, { kits: next }, { merge: true });
            setKitName('');
            addLog(`Saved kit "${name}"`, 'success');
        } catch (e) { addLog(`Save kit failed: ${e.message}`, 'error'); }
    };

    const deleteKit = async (kit) => {
        if (!window.confirm(`Delete saved kit "${kit.name}"?`)) return;
        try {
            const ref = doc(db, KITS_DOC.col, KITS_DOC.id);
            const snap = await getDoc(ref);
            const existing = snap.exists() && Array.isArray(snap.data().kits) ? snap.data().kits : [];
            await setDoc(ref, { kits: existing.filter(k => !(k.name === kit.name && k.brand === kit.brand)) }, { merge: true });
            addLog(`Deleted kit "${kit.name}"`, 'info');
        } catch (e) { addLog(`Delete kit failed: ${e.message}`, 'error'); }
    };

    const setQty = (key, q) => setCart(prev => prev.map(l => l.key === key ? { ...l, qty: Math.max(1, parseInt(q) || 1) } : l));
    const removeLine = (key) => setCart(prev => prev.filter(l => l.key !== key));
    const cartTotal = cart.reduce((s, l) => s + l.rate * l.qty, 0);

    const myKits = kits.filter(k => k.brand === activeBrand);
    const selectedCustomer = customers.find(c => c.id === customerId);

    const pushToNetSuite = async () => {
        if (!customerId) return alert('Select a customer first.');
        if (cart.length === 0) return alert('Cart is empty.');
        const unmapped = cart.filter(l => !l.nsId);
        if (unmapped.length) {
            if (!window.confirm(`${unmapped.length} line(s) have no NetSuite ID and will be skipped:\n\n${unmapped.map(l => `• ${l.erp || l.name}`).join('\n')}\n\nContinue with the rest?`)) return;
        }
        const lines = cart.filter(l => l.nsId);
        if (!lines.length) return alert('No lines have a NetSuite item ID. Sync these items to NetSuite first.');
        if (!window.confirm(`Create a NetSuite SALES ORDER for ${selectedCustomer?.name || customerId} with ${lines.length} stock line(s)?`)) return;

        setPushing(true);
        try {
            let nsCustomerId = customerId.startsWith('CUST-') ? customerId.replace('CUST-', '') : customerId;
            const brandMapping = BRAND_NETSUITE_MAP[activeBrand] || { subsidiary: "2", location: "17" };
            const memoText = `Quick Ship${jobName ? ' - ' + jobName : ''}`.slice(0, 40);

            const payload = {
                entity: { id: nsCustomerId },
                subsidiary: { id: brandMapping.subsidiary },
                location: { id: brandMapping.location },
                memo: memoText,
                item: {
                    items: lines.map(l => ({
                        item: { id: l.nsId.toString() },
                        quantity: l.qty,
                        rate: parseFloat((l.rate || 0).toFixed(2)),
                        price: { id: "-1" },
                        description: `${l.name}${l.note ? ' (' + l.note + ')' : ''} [Quick Ship stock]`
                    }))
                }
            };

            addLog(`Transmitting Sales Order (${lines.length} lines) to NetSuite…`, 'info');
            const response = await fetch(FIREBASE_FUNCTION_URL, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/salesorder`, method: 'POST', payload })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(`API Rejected [${response.status}]: ${JSON.stringify(result)}`);
            const returnedId = result.id || result.recordId || `QS-${Date.now()}`;
            addLog(`✅ Sales Order created (NS ID: ${returnedId})`, 'success');

            // Mirror to hq_sales_orders, tagged QUICKSHIP so pick/pack shows it in its own STOCK tab
            // (separate from custom orders, which arrive via fin_workorders).
            const hqId = `QS-${returnedId}`;
            await setDoc(doc(db, "hq_sales_orders", hqId), {
                id: hqId, soId: returnedId, nsInternalId: returnedId,
                orderClass: 'QUICKSHIP', type: 'Stock',
                brand: activeBrand,
                customer: selectedCustomer?.name || nsCustomerId, customerId,
                jobName: jobName || '', memo: memoText,
                status: 'Pending', pickStatus: 'Pending',
                totalParts: lines.reduce((s, l) => s + l.qty, 0),
                lines: lines.map(l => ({ erp: l.erp, name: l.name, qty: l.qty, bin: l.bin || '', note: l.note || '' })),
                createdBy: currentUser || '', createdAt: Date.now(), createdDate: new Date().toISOString()
            });
            addLog(`Recorded ${hqId} for pick/pack (Stock tab).`, 'success');

            setCart([]); setJobName('');
        } catch (e) {
            console.error('Quick Ship push error', e);
            addLog(`❌ FAILED: ${e.message}`, 'error');
            alert(`Sales Order push failed:\n\n${e.message}`);
        }
        setPushing(false);
    };

    // ---- shared styles ----
    const card = { background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' };
    const cardHd = { padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'var(--paper)', fontFamily: 'var(--serif)', fontSize: '1.15rem', fontWeight: 500, color: 'var(--ink)' };
    const lbl = { fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '5px' };
    const inp = { width: '100%', boxSizing: 'border-box', padding: '10px', fontSize: '0.85rem', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' };
    const qtyInp = { ...inp, width: '64px', textAlign: 'center', fontFamily: 'var(--mono)' };
    const btn = (bg, fg) => ({ padding: '11px 18px', background: bg, color: fg, border: `1px solid ${bg}`, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase' });

    const KitSlot = ({ title, items, idKey, qtyKey, children }) => (
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 64px', gap: '10px', alignItems: 'end' }}>
            <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink)', paddingBottom: '8px' }}>{title}</div>
            <div>
                <ItemSelect value={kb[idKey]} onChange={v => setKb({ ...kb, [idKey]: v })} items={items} placeholder={`Search ${title.toLowerCase()}…`} />
                {children}
            </div>
            <div><span style={lbl}>Qty</span><input type="number" min="0" value={kb[qtyKey]} onChange={e => setKb({ ...kb, [qtyKey]: e.target.value })} style={qtyInp} /></div>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', fontFamily: 'var(--sans)' }}>
            {/* HEADER */}
            <div style={{ ...card, padding: '20px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <span style={{ ...lbl, color: 'var(--brass)' }}>Stocked / Pre-Finished Counter</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Quick Ship</h2>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textAlign: 'right' }}>
                    Flat lines → NetSuite Sales Order<br />No BOM build · {stocked.length} stocked items
                </div>
            </div>

            {/* CUSTOMER + JOB */}
            <div style={{ ...card, padding: '20px 24px', display: 'grid', gridTemplateColumns: '2fr 2fr', gap: '20px' }}>
                <div style={{ position: 'relative' }}>
                    <span style={lbl}>Customer</span>
                    <input value={customerId ? (custSearch || `${selectedCustomer?.name || ''} (${customerId})`) : custSearch}
                        onChange={e => { setCustSearch(e.target.value); setCustOpen(true); if (e.target.value === '') setCustomerId(''); }}
                        onFocus={() => setCustOpen(true)} onBlur={() => setTimeout(() => setCustOpen(false), 200)}
                        placeholder="Search customer…" style={inp} />
                    {custOpen && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--line)', maxHeight: '240px', overflowY: 'auto', zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                            {customers.filter(c => `${c.name} ${c.id}`.toLowerCase().includes((custSearch || '').toLowerCase())).slice(0, 50).map(c => (
                                <div key={c.id} onMouseDown={() => { setCustomerId(c.id); setCustSearch(`${c.name} (${c.id})`); setCustOpen(false); }}
                                    style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--paper-2)' }}
                                    onMouseOver={e => e.currentTarget.style.background = 'var(--paper)'} onMouseOut={e => e.currentTarget.style.background = '#fff'}>
                                    {c.name} <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--ink-soft)' }}>({c.id})</span>
                                </div>
                            ))}
                            {customers.length === 0 && <div style={{ padding: '10px', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.8rem' }}>No customers for this brand.</div>}
                        </div>
                    )}
                </div>
                <div><span style={lbl}>Job / Sidemark (optional)</span><input value={jobName} onChange={e => setJobName(e.target.value)} placeholder="e.g. Smith Residence" style={inp} /></div>
            </div>

            {/* PREBUILT KITS */}
            <div style={card}>
                <div style={cardHd}>Prebuilt Kits</div>
                <div style={{ padding: '16px 20px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    {myKits.length === 0 && <span style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '0.95rem' }}>No saved kits yet — build one below and “Save as kit”.</span>}
                    {myKits.map(kit => (
                        <div key={kit.name} style={{ display: 'flex', alignItems: 'stretch', border: '1px solid var(--line)' }}>
                            <button onClick={() => addSavedKit(kit)} style={{ ...btn('var(--paper-2)', 'var(--ink)'), border: 'none', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--sans)', fontSize: '0.9rem' }}
                                onMouseOver={e => e.currentTarget.style.background = 'var(--brass)'} onMouseOut={e => e.currentTarget.style.background = 'var(--paper-2)'}>
                                + {kit.name}
                            </button>
                            <button title="Delete kit" onClick={() => deleteKit(kit)} style={{ border: 'none', borderLeft: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', padding: '0 10px', fontSize: '0.9rem' }}>×</button>
                        </div>
                    ))}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: '20px', alignItems: 'start' }}>
                {/* LEFT: QUICK ADD + KIT BUILDER */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    <div style={card}>
                        <div style={cardHd}>Quick Add Item</div>
                        <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: '1fr 70px auto', gap: '12px', alignItems: 'end' }}>
                            <div><span style={lbl}>Stocked Item #</span><ItemSelect value={quickItemId} onChange={setQuickItemId} items={stocked} /></div>
                            <div><span style={lbl}>Qty</span><input type="number" min="1" value={quickQty} onChange={e => setQuickQty(e.target.value)} style={qtyInp} /></div>
                            <button onClick={addQuick} style={btn('var(--ink)', '#fff')}>Add</button>
                        </div>
                    </div>

                    <div style={card}>
                        <div style={cardHd}>Kit Builder</div>
                        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <KitSlot title="Pole" items={poles} idKey="poleId" qtyKey="poleQty" />
                            <KitSlot title="Bracket" items={brackets} idKey="bracketId" qtyKey="bracketQty" />
                            <KitSlot title="Ring" items={rings} idKey="ringId" qtyKey="ringQty" />
                            <KitSlot title="Finial" items={finials} idKey="finialId" qtyKey="finialQty" />

                            <div style={{ borderTop: '1px dashed var(--line)', margin: '4px 0', paddingTop: '12px', fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Billable Fees</div>
                            <KitSlot title="Cut" items={cutItems} idKey="cutId" qtyKey="cutQty">
                                <input value={kb.cutLen} onChange={e => setKb({ ...kb, cutLen: e.target.value })} placeholder="Cut length (e.g. 84in)" style={{ ...inp, marginTop: '8px', fontSize: '0.8rem' }} />
                            </KitSlot>
                            <KitSlot title="Splice" items={spliceItems} idKey="spliceId" qtyKey="spliceQty" />
                            <KitSlot title="Miter Return" items={miterItems} idKey="miterId" qtyKey="miterQty" />

                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap' }}>
                                <button onClick={addKbToCart} style={btn('var(--brass)', '#fff')}>Add Kit to Cart</button>
                                <button onClick={() => setKb(EMPTY_KB)} style={btn('transparent', 'var(--ink-soft)')}>Clear</button>
                                <div style={{ flex: 1 }} />
                                <input value={kitName} onChange={e => setKitName(e.target.value)} placeholder="Name to save as kit…" style={{ ...inp, width: '180px', flex: 'none' }} />
                                <button onClick={saveKit} style={btn('var(--ink)', '#fff')}>Save as Kit</button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* RIGHT: CART */}
                <div style={{ ...card, display: 'flex', flexDirection: 'column', minHeight: '400px' }}>
                    <div style={{ ...cardHd, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Order Cart</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{cart.length} line(s)</span>
                    </div>
                    <div style={{ padding: '12px 16px', flex: 1, overflowY: 'auto' }}>
                        {cart.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', padding: '20px', textAlign: 'center' }}>Empty — add stocked items or a kit.</div>}
                        {cart.map(l => (
                            <div key={l.key} style={{ display: 'grid', gridTemplateColumns: '1fr 64px auto', gap: '10px', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--paper-2)' }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '0.82rem', color: 'var(--ink)' }}>{l.erp || '—'} {!l.nsId && <span style={{ color: '#d9534f' }} title="No NetSuite ID — will be skipped on push">⚠</span>}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}{l.note ? ` · ${l.note}` : ''}</div>
                                </div>
                                <input type="number" min="1" value={l.qty} onChange={e => setQty(l.key, e.target.value)} style={qtyInp} />
                                <button onClick={() => removeLine(l.key)} style={{ border: 'none', background: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '1.1rem' }} title="Remove">×</button>
                            </div>
                        ))}
                    </div>
                    <div style={{ borderTop: '1px solid var(--line)', padding: '16px 20px', background: 'var(--paper)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Est. Total</span>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem', color: 'var(--ink)' }}>${cartTotal.toFixed(2)}</span>
                        </div>
                        <button onClick={pushToNetSuite} disabled={pushing || cart.length === 0}
                            style={{ ...btn(pushing ? 'var(--paper-2)' : 'var(--ink)', pushing ? 'var(--ink-soft)' : '#fff'), width: '100%', cursor: pushing ? 'wait' : 'pointer' }}>
                            {pushing ? 'Transmitting…' : 'Create NetSuite Sales Order'}
                        </button>
                    </div>
                </div>
            </div>

            {/* LOG */}
            {log.length > 0 && (
                <div style={{ ...card, background: 'var(--dark)', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 16px', background: 'var(--dark-2)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{'>'}_ Quick Ship Log</span>
                        <button onClick={() => setLog([])} style={{ background: 'none', border: 'none', color: 'var(--paper)', cursor: 'pointer', opacity: 0.6, fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>Clear</button>
                    </div>
                    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto', fontFamily: 'var(--mono)', fontSize: '11px' }}>
                        {log.map((l, i) => {
                            let c = '#a8a5a0';
                            if (l.type === 'error') c = '#e27373';
                            if (l.type === 'success') c = '#7dbb81';
                            if (l.type === 'warn') c = '#e2b373';
                            return <div key={i} style={{ color: c }}><span style={{ opacity: 0.5, marginRight: '8px' }}>[{l.time}]</span>{l.msg}</div>;
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default QuickShipTab;
