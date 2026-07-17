import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, doc, onSnapshot, setDoc, getDoc } from "firebase/firestore";
import { nsProxyFetch } from "../Shared/nsProxy";

// Stocked / pre-finished items are sold flat — each line goes to NetSuite as its own sales-order
// line (NO assembly/BOM rollup like the CPQ does). Quick Ship is the fast counter for that stock.
const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "20" },
    'ce': { subsidiary: "2", location: "17" },
    'leyla': { subsidiary: "5", location: "18" }
};
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

    const [cart, setCart] = useState([]);             // flat lines (rates resolve LIVE — see pricedCart)
    const [quickItemId, setQuickItemId] = useState('');
    const [quickQty, setQuickQty] = useState(1);
    const [kb, setKb] = useState(EMPTY_KB);
    const [kitName, setKitName] = useState('');
    const [kitCollection, setKitCollection] = useState(''); // "file" the kit under a collection (e.g. TQS)
    const [kitEdit, setKitEdit] = useState(null);     // kit pricing/collection editor {name, brand, basePrice, collection, clientPricing, finishCodes}
    const [openCols, setOpenCols] = useState({});     // collection accordion state
    const [finishList, setFinishList] = useState([]); // [{code, name, outsourced}] — kit finish options
    const [kitFinishPick, setKitFinishPick] = useState(null); // kit awaiting a finish choice on add

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
        // Finish codes (in-house + outsourced) feed the kit "available finishes" picker —
        // one PATTERN kit + a color choice replaces one kit per finish.
        const unsubFin = onSnapshot(doc(db, "system", "master_finishes"), (s) => {
            const arr = (s.exists() && s.data().finishes) || [];
            setFinishList(prev => [...arr.filter(f => f && f.code).map(f => ({ code: String(f.code).toUpperCase(), name: f.name || f.code, outsourced: false })), ...prev.filter(p => p.outsourced)]);
        }, e => console.warn('Quick Ship finishes listen failed', e));
        const unsubOut = onSnapshot(collection(db, "hq_outsource_finishes"), (s) => {
            const arr = s.docs.map(d => d.data()).filter(f => f && f.code);
            setFinishList(prev => [...prev.filter(p => !p.outsourced), ...arr.map(f => ({ code: String(f.code).toUpperCase(), name: f.name || f.code, outsourced: true }))]);
        }, e => console.warn('Quick Ship outsource finishes listen failed', e));
        return () => { unsubParts(); unsubCrm(); unsubKits(); unsubFin(); unsubOut(); };
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

    const pushLine = (it, qty, note, kitMeta) => {
        if (!it) return;
        setCart(prev => [...prev, {
            key: `${it.id}-${Date.now()}-${Math.round(prev.length)}`,
            itemId: it.id, erp: erpOf(it), nsId: nsIdOf(it), name: it.itemName || erpOf(it),
            qty: Math.max(1, parseInt(qty) || 1), note: note || '',
            bin: it.manufacturingSpecs?.homeBin || it.binLocation || '',
            // Kit lines carry their kit identity so pricedCart can apply KIT pricing live.
            kitKey: kitMeta?.kitKey || null, kitName: kitMeta?.kitName || null, kitBrand: kitMeta?.kitBrand || null, kitFinish: kitMeta?.kitFinish || ''
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

    // Finish-variant swap (Stuart 2026-07-17): stocked components follow the same "/<FIN>"
    // suffix rule as production — HCUMP410/BL → HCUMP410/SG. Components without a "/" are
    // finish-agnostic and pass through unchanged.
    const variantFor = (it, fin) => {
        const erp = erpOf(it);
        if (!erp.includes('/')) return it;
        const target = `${erp.split('/')[0]}/${String(fin).toUpperCase()}`;
        return allItems.find(x => erpOf(x) === target) || null;
    };

    const addSavedKit = (kit, finCode) => {
        const fins = Array.isArray(kit.finishCodes) ? kit.finishCodes : [];
        if (!finCode && fins.length === 1) finCode = fins[0];
        if (!finCode && fins.length > 1) { setKitFinishPick(kit); return; } // choose a color first
        const lines = resolveKb(kit.cfg || {});
        if (!lines.length) return alert('That kit has no resolvable stocked items right now.');
        let resolved = lines;
        if (finCode) {
            const missing = [];
            resolved = [];
            lines.forEach(l => {
                const v = variantFor(l.it, finCode);
                if (v) resolved.push({ ...l, it: v });
                else missing.push(`${erpOf(l.it).split('/')[0]}/${String(finCode).toUpperCase()}`);
            });
            if (missing.length) return alert(`Can't add "${kit.name}" in ${finCode} — no stocked item for:\n\n${missing.map(m => `• ${m}`).join('\n')}\n\nCreate/stock those variants, or remove ${finCode} from this kit's available finishes.`);
        }
        // One kitKey per ADD — adding the same kit twice makes two independently-priced groups.
        const kitKey = `${kit.name}-${Date.now()}`;
        resolved.forEach(l => pushLine(l.it, l.qty, l.note, { kitKey, kitName: kit.name, kitBrand: kit.brand, kitFinish: finCode ? String(finCode).toUpperCase() : '' }));
        addLog(`Kit "${kit.name}"${finCode ? ` · ${finCode}` : ''} → ${resolved.length} line(s) added`, 'success');
    };

    const saveKit = async () => {
        const name = (kitName || '').trim();
        if (!name) return alert('Name the kit first.');
        if (!resolveKb(kb).length) return alert('Build a kit (fill some fields) before saving.');
        try {
            const ref = doc(db, KITS_DOC.col, KITS_DOC.id);
            const snap = await getDoc(ref);
            const existing = snap.exists() && Array.isArray(snap.data().kits) ? snap.data().kits : [];
            const prior = existing.find(k => k.name === name && k.brand === activeBrand);
            const others = existing.filter(k => !(k.name === name && k.brand === activeBrand));
            // Re-saving a kit's CONTENTS never wipes its filing/pricing (collection, basePrice,
            // clientPricing survive an overwrite).
            const next = [...others, {
                name, brand: activeBrand, cfg: { ...kb },
                collection: (kitCollection || '').trim() || prior?.collection || '',
                basePrice: prior?.basePrice ?? '', clientPricing: prior?.clientPricing || [],
                savedBy: currentUser || '', savedAt: Date.now()
            }];
            await setDoc(ref, { kits: next }, { merge: true });
            setKitName(''); setKitCollection('');
            addLog(`Saved kit "${name}"`, 'success');
        } catch (e) { addLog(`Save kit failed: ${e.message}`, 'error'); }
    };

    // Rewrite one kit's metadata (pricing / collection) in place.
    const updateKitMeta = async (kitRef, patch) => {
        const ref = doc(db, KITS_DOC.col, KITS_DOC.id);
        const snap = await getDoc(ref);
        const existing = snap.exists() && Array.isArray(snap.data().kits) ? snap.data().kits : [];
        await setDoc(ref, { kits: existing.map(k => (k.name === kitRef.name && k.brand === kitRef.brand) ? { ...k, ...patch } : k) }, { merge: true });
    };

    // Effective KIT price for the CURRENT customer: clientPricing row → base kit price → null
    // (null = no kit pricing, lines bill at their own item rates).
    const effectiveKitPrice = (kitName2, kitBrand) => {
        const kit = kits.find(k => k.name === kitName2 && k.brand === kitBrand);
        if (!kit) return null;
        const cp = (kit.clientPricing || []).find(c => c.customerId === customerId);
        if (cp && cp.price !== '' && cp.price !== undefined && !isNaN(parseFloat(cp.price))) return parseFloat(cp.price);
        const bp = parseFloat(kit.basePrice);
        return (kit.basePrice !== '' && kit.basePrice !== undefined && kit.basePrice !== null && !isNaN(bp)) ? bp : null;
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

    // LIVE pricing (Stuart 2026-07-17): rates resolve at RENDER/PUSH time, never frozen at add
    // time — so picking the customer before OR after filling the cart reprices every line
    // (item clientPricing included). A kit group with a kit price distributes it across the
    // group's lines proportionally to their standard subtotals (2dp, LAST line absorbs the
    // rounding) so the SO sums to the kit price; kits without a price bill per item.
    const rateForId = (id) => { const it = itemById(id); return it ? rateFor(it) : 0; };
    const pricedCart = useMemo(() => {
        const rateMap = new Map();
        const byKit = {};
        cart.forEach(l => {
            if (l.kitKey) (byKit[l.kitKey] = byKit[l.kitKey] || []).push(l);
            else rateMap.set(l.key, rateForId(l.itemId));
        });
        Object.values(byKit).forEach(group => {
            const kp = effectiveKitPrice(group[0].kitName, group[0].kitBrand);
            const stds = group.map(l => ({ l, std: rateForId(l.itemId) }));
            if (kp === null) { stds.forEach(({ l, std }) => rateMap.set(l.key, std)); return; }
            const S = stds.reduce((s, x) => s + x.std * x.l.qty, 0);
            let spent = 0;
            stds.forEach(({ l, std }, i) => {
                let rate;
                if (i === stds.length - 1) {
                    rate = Math.round(((kp - spent) / Math.max(1, l.qty)) * 100) / 100; // absorbs rounding
                } else {
                    const share = S > 0 ? (kp * (std * l.qty) / S) : (kp / group.length);
                    rate = Math.floor((share / Math.max(1, l.qty)) * 100) / 100;
                }
                rate = Math.max(0, rate);
                spent += rate * l.qty;
                rateMap.set(l.key, rate);
            });
        });
        return cart.map(l => ({ ...l, rate: rateMap.get(l.key) ?? 0 }));
    }, [cart, customerId, kits, allItems]); // eslint-disable-line react-hooks/exhaustive-deps
    const cartTotal = pricedCart.reduce((s, l) => s + l.rate * l.qty, 0);

    const myKits = kits.filter(k => k.brand === activeBrand);
    const selectedCustomer = customers.find(c => c.id === customerId);

    const pushToNetSuite = async () => {
        if (!customerId) return alert('Select a customer first.');
        if (cart.length === 0) return alert('Cart is empty.');
        const unmapped = pricedCart.filter(l => !l.nsId);
        if (unmapped.length) {
            if (!window.confirm(`${unmapped.length} line(s) have no NetSuite ID and will be skipped:\n\n${unmapped.map(l => `• ${l.erp || l.name}`).join('\n')}\n\nContinue with the rest?`)) return;
        }
        const lines = pricedCart.filter(l => l.nsId);
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
                        description: `${l.name}${l.note ? ' (' + l.note + ')' : ''}${l.kitName ? ' [Kit: ' + l.kitName + (l.kitFinish ? ' - ' + l.kitFinish : '') + ']' : ''} [Quick Ship stock]`
                    }))
                }
            };

            addLog(`Transmitting Sales Order (${lines.length} lines) to NetSuite…`, 'info');
            const response = await nsProxyFetch({ targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/salesorder`, method: 'POST', payload });
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
                lines: lines.map(l => ({ erp: l.erp, name: l.name, qty: l.qty, bin: l.bin || '', note: l.note || '', kit: l.kitName ? `${l.kitName}${l.kitFinish ? ' - ' + l.kitFinish : ''}` : '' })),
                // Customer-facing INVOICE presentation (CRM prints/sends this): the customer pays
                // against the KIT # + kit price; components print as unpriced sub-lines; loose
                // items itemized. Captured at TRANSACTION time so later kit-price edits never
                // rewrite an issued invoice. NetSuite keeps the distributed per-item lines.
                invoiceLines: (() => {
                    const groups = {};
                    lines.forEach(l => { if (l.kitKey) (groups[l.kitKey] = groups[l.kitKey] || []).push(l); });
                    const out = Object.values(groups).map(g => {
                        const kp = effectiveKitPrice(g[0].kitName, g[0].kitBrand);
                        // Customer-facing kit # = pattern + finish suffix (HS0109T … - SG).
                        return { type: 'KIT', code: `${g[0].kitName}${g[0].kitFinish ? ' - ' + g[0].kitFinish : ''}`, price: kp !== null ? kp : g.reduce((s, l) => s + l.rate * l.qty, 0), components: g.map(l => ({ erp: l.erp, name: l.name, qty: l.qty })) };
                    });
                    lines.filter(l => !l.kitKey).forEach(l => out.push({ type: 'ITEM', erp: l.erp, name: l.name, qty: l.qty, rate: l.rate, total: l.rate * l.qty }));
                    return out;
                })(),
                invoiceTotal: lines.reduce((s, l) => s + l.rate * l.qty, 0),
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

            {/* PREBUILT KITS — filed under collections (Stuart 2026-07-17); click a group title to
                open it. Each kit chip shows its effective price for the SELECTED customer (★ = a
                per-customer row is driving it); the $ button edits pricing + filing. */}
            <div style={card}>
                <div style={{ ...cardHd, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Prebuilt Kits</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', fontWeight: 400 }}>{myKits.length} kit(s) · filed by collection</span>
                </div>
                <div style={{ padding: '4px 20px 16px' }}>
                    {myKits.length === 0 && <div style={{ padding: '12px 0', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '0.95rem' }}>No saved kits yet — build one below and “Save as kit”.</div>}
                    {(() => {
                        const groups = new Map();
                        myKits.forEach(k => { const c = (k.collection || '').trim() || 'Unfiled'; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(k); });
                        const names = [...groups.keys()].sort((a, b) => ((a === 'Unfiled') - (b === 'Unfiled')) || a.localeCompare(b));
                        return names.map(colName => {
                            const open = !!openCols[colName];
                            const list = groups.get(colName);
                            return (
                                <div key={colName} style={{ marginTop: '10px', border: '1px solid var(--line)' }}>
                                    <div onClick={() => setOpenCols(p => ({ ...p, [colName]: !p[colName] }))} style={{ padding: '10px 14px', background: open ? 'var(--ink)' : 'var(--paper-2)', color: open ? '#fff' : 'var(--ink)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 600 }}>{open ? '▾' : '▸'} {colName}</span>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', opacity: 0.75 }}>{list.length} kit(s)</span>
                                    </div>
                                    {open && (
                                        <div style={{ padding: '12px 14px', display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                                            {list.map(kit => {
                                                const kp = effectiveKitPrice(kit.name, kit.brand);
                                                const hasCust = !!customerId && (kit.clientPricing || []).some(c => c.customerId === customerId);
                                                return (
                                                    <div key={kit.name} style={{ display: 'flex', alignItems: 'stretch', border: '1px solid var(--line)' }}>
                                                        <button onClick={() => addSavedKit(kit)} style={{ ...btn('var(--paper-2)', 'var(--ink)'), border: 'none', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--sans)', fontSize: '0.9rem' }}
                                                            onMouseOver={e => e.currentTarget.style.background = 'var(--brass)'} onMouseOut={e => e.currentTarget.style.background = 'var(--paper-2)'}>
                                                            + {kit.name}{(kit.finishCodes || []).length > 0 && <span style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--ink-soft)' }}> · {kit.finishCodes.length} color{kit.finishCodes.length === 1 ? '' : 's'}</span>}{kp !== null && <span style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: hasCust ? '#3a7d44' : 'var(--ink-soft)' }}> · ${kp.toFixed(2)}{hasCust ? ' ★' : ''}</span>}
                                                        </button>
                                                        <button title="Kit pricing, finishes & collection" onClick={() => setKitEdit({ name: kit.name, brand: kit.brand, basePrice: kit.basePrice ?? '', collection: kit.collection || '', clientPricing: (kit.clientPricing || []).map(r => ({ ...r })), finishCodes: Array.isArray(kit.finishCodes) ? [...kit.finishCodes] : [], addCust: '', addPrice: '' })} style={{ border: 'none', borderLeft: '1px solid var(--line)', background: '#fff', color: 'var(--brass)', cursor: 'pointer', padding: '0 10px', fontSize: '0.85rem', fontFamily: 'var(--mono)' }}>$</button>
                                                        <button title="Delete kit" onClick={() => deleteKit(kit)} style={{ border: 'none', borderLeft: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', padding: '0 10px', fontSize: '0.9rem' }}>×</button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        });
                    })()}
                </div>

                {kitEdit && (
                    <div style={{ borderTop: '1px solid var(--brass)', padding: '16px 20px', background: 'var(--paper)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', color: 'var(--ink)' }}>Kit Pricing & Filing — {kitEdit.name}</span>
                            <button onClick={() => setKitEdit(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.2rem', cursor: 'pointer' }}>×</button>
                        </div>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'end', flexWrap: 'wrap', marginBottom: '12px' }}>
                            <div><span style={lbl}>Collection (filing)</span><input value={kitEdit.collection} onChange={e => setKitEdit({ ...kitEdit, collection: e.target.value })} list="qs-collections" placeholder="e.g. TQS" style={{ ...inp, width: '160px' }} /></div>
                            <div><span style={lbl}>Base kit price ($)</span><input type="number" value={kitEdit.basePrice} onChange={e => setKitEdit({ ...kitEdit, basePrice: e.target.value })} placeholder="blank = per-item" style={{ ...inp, width: '140px', fontFamily: 'var(--mono)' }} /></div>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', paddingBottom: '10px', maxWidth: '380px' }}>Blank = lines bill at their own item rates. A kit price distributes across the component lines so the sales order totals exactly the kit price.</span>
                        </div>
                        <span style={lbl}>Available finishes — the counter picks a color; components resolve to their /CODE variants</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
                            {[...new Map(finishList.map(f => [f.code, f])).values()].sort((a, b) => a.code.localeCompare(b.code)).map(f => {
                                const on = (kitEdit.finishCodes || []).includes(f.code);
                                return (
                                    <button key={f.code} title={f.name} onClick={() => setKitEdit({ ...kitEdit, finishCodes: on ? (kitEdit.finishCodes || []).filter(c => c !== f.code) : [...(kitEdit.finishCodes || []), f.code] })}
                                        style={{ padding: '5px 10px', border: on ? '1px solid var(--ink)' : '1px solid var(--line)', background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px' }}>
                                        {f.code}
                                    </button>
                                );
                            })}
                            {finishList.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No finish codes found — add them to the in-house / outsourced finish lists first (11.x / Library).</span>}
                        </div>
                        <span style={lbl}>Per-customer kit pricing</span>
                        {(kitEdit.clientPricing || []).length === 0 && <div style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', fontStyle: 'italic', padding: '4px 0 8px' }}>None — every customer gets the base kit price.</div>}
                        {(kitEdit.clientPricing || []).map((r, i) => (
                            <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--paper-2)' }}>
                                <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--ink)' }}>{r.customerName || r.customerId}</span>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem', color: 'var(--ink)' }}>${parseFloat(r.price || 0).toFixed(2)}</span>
                                <button onClick={() => setKitEdit({ ...kitEdit, clientPricing: kitEdit.clientPricing.filter((_, x) => x !== i) })} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1rem' }}>×</button>
                            </div>
                        ))}
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'end', marginTop: '10px', flexWrap: 'wrap' }}>
                            <div style={{ minWidth: '240px', flex: 1 }}>
                                <span style={lbl}>Customer</span>
                                <select value={kitEdit.addCust} onChange={e => setKitEdit({ ...kitEdit, addCust: e.target.value })} style={{ ...inp, background: '#fff' }}>
                                    <option value="">Select customer…</option>
                                    {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                                </select>
                            </div>
                            <div><span style={lbl}>Kit price ($)</span><input type="number" value={kitEdit.addPrice} onChange={e => setKitEdit({ ...kitEdit, addPrice: e.target.value })} style={{ ...inp, width: '120px', fontFamily: 'var(--mono)' }} /></div>
                            <button onClick={() => {
                                if (!kitEdit.addCust || kitEdit.addPrice === '' || isNaN(parseFloat(kitEdit.addPrice))) return alert('Pick a customer and enter a price.');
                                const c = customers.find(x => x.id === kitEdit.addCust);
                                const rows = (kitEdit.clientPricing || []).filter(r => r.customerId !== kitEdit.addCust);
                                setKitEdit({ ...kitEdit, clientPricing: [...rows, { customerId: kitEdit.addCust, customerName: c?.name || '', price: parseFloat(kitEdit.addPrice) }], addCust: '', addPrice: '' });
                            }} style={btn('transparent', 'var(--ink)')}>+ Add Row</button>
                            <div style={{ flex: 1 }} />
                            <button onClick={async () => {
                                try {
                                    await updateKitMeta({ name: kitEdit.name, brand: kitEdit.brand }, { collection: (kitEdit.collection || '').trim(), basePrice: (kitEdit.basePrice === '' || kitEdit.basePrice === null) ? '' : parseFloat(kitEdit.basePrice), clientPricing: kitEdit.clientPricing || [], finishCodes: kitEdit.finishCodes || [] });
                                    addLog(`Kit "${kitEdit.name}" pricing/filing saved`, 'success');
                                    setKitEdit(null);
                                } catch (e) { alert('Save failed: ' + (e.message || e)); }
                            }} style={btn('var(--ink)', '#fff')}>Save Kit Pricing</button>
                        </div>
                    </div>
                )}
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
                                <input value={kitName} onChange={e => setKitName(e.target.value)} placeholder="Name to save as kit…" style={{ ...inp, width: '170px', flex: 'none' }} />
                                <input value={kitCollection} onChange={e => setKitCollection(e.target.value)} list="qs-collections" placeholder="Collection (e.g. TQS)" style={{ ...inp, width: '150px', flex: 'none' }} />
                                <datalist id="qs-collections">{[...new Set(myKits.map(k => (k.collection || '').trim()).filter(Boolean))].map(c => <option key={c} value={c} />)}</datalist>
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
                        {pricedCart.map(l => (
                            <div key={l.key} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 74px auto', gap: '10px', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--paper-2)' }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '0.82rem', color: 'var(--ink)' }}>{l.erp || '—'} {!l.nsId && <span style={{ color: '#d9534f' }} title="No NetSuite ID — will be skipped on push">⚠</span>}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}{l.note ? ` · ${l.note}` : ''}{l.kitName && <span style={{ color: 'var(--brass)' }}> · KIT: {l.kitName}{l.kitFinish ? ` · ${l.kitFinish}` : ''}</span>}</div>
                                </div>
                                <input type="number" min="1" value={l.qty} onChange={e => setQty(l.key, e.target.value)} style={qtyInp} />
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', textAlign: 'right', color: 'var(--ink)' }}>${(l.rate * l.qty).toFixed(2)}</div>
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

            {/* FINISH CHOOSER — a pattern kit with 2+ available finishes asks for the color first */}
            {kitFinishPick && (
                <div onClick={() => setKitFinishPick(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 11000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', padding: '24px', width: 'min(560px, 94vw)', border: '1px solid var(--line)', borderRadius: '4px', boxShadow: '0 16px 60px rgba(0,0,0,0.3)' }}>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.25rem', color: 'var(--ink)', marginBottom: '4px' }}>{kitFinishPick.name}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '16px' }}>Select finish — every component resolves to its /CODE variant</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                            {(kitFinishPick.finishCodes || []).map(code => {
                                const f = finishList.find(x => x.code === code);
                                return (
                                    <button key={code} onClick={() => { const k = kitFinishPick; setKitFinishPick(null); addSavedKit(k, code); }}
                                        style={{ ...btn('var(--paper-2)', 'var(--ink)'), textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--sans)', fontSize: '0.9rem' }}
                                        onMouseOver={e => e.currentTarget.style.background = 'var(--brass)'} onMouseOut={e => e.currentTarget.style.background = 'var(--paper-2)'}>
                                        <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{code}</span>{f && f.name && f.name !== code ? ` — ${f.name}` : ''}
                                    </button>
                                );
                            })}
                        </div>
                        <button onClick={() => setKitFinishPick(null)} style={{ marginTop: '18px', background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Cancel</button>
                    </div>
                </div>
            )}

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
