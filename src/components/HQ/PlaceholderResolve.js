// ── IDENTIFY A QUICK-ADD PLACEHOLDER (S7, 2026-10-16) ─────────────────────────────────────────────
//
// Mounted on RTG's Order Entry card and the CRM's order row when the record carries a placeholder line
// (Shared/placeholderLine). Search the brand's library, pick the item: the stored line is rewritten to it, and
// when it was the last one the held NetSuite write is queued (Shared/nsOutbox) — the order then proceeds as every
// order does. The rule is pure (resolvePlaceholderOf); this file is the search box and the two writes.
import React, { useState } from 'react';
import { db } from '../../firebase';
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { enqueueNsWrite } from '../Shared/nsOutbox';
import { placeholdersOf, resolvePlaceholderOf } from '../Shared/placeholderLine';

const mono = { fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)' };
const codeOf = (it) => String((it && (it.legacyErpId || it.itemId)) || '');

const PlaceholderResolve = ({ record, collection: coll = 'hq_sales_orders', brand = '', currentUser = '' }) => {
    const [items, setItems] = useState(null);     // the brand's library, read on first search
    const [q, setQ] = useState('');
    const [forIdx, setForIdx] = useState(null);   // the placeholder being identified
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const open = placeholdersOf(record);
    if (!open.length) return null;

    const readItems = async () => {
        if (items) return items;
        const snap = await getDocs(query(collection(db, 'Approved_Designs'), where('brandId', '==', brand || 'uniquity')));
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(it => !(it.manufacturingSpecs && it.manufacturingSpecs.isRetired));
        setItems(list);
        return list;
    };
    const start = async (idx) => { setForIdx(idx); setQ(''); setMsg(''); try { await readItems(); } catch (e) { setMsg(`The library could not be read: ${e.message || e}`); } };
    const t = q.trim().toLowerCase();
    const matches = (items || []).filter(it => t && `${codeOf(it)} ${it.itemName || ''}`.toLowerCase().includes(t)).slice(0, 12);

    const pick = async (it) => {
        const r = resolvePlaceholderOf({ record, lineIdx: forIdx, item: it, by: currentUser || '' });
        if (!r.ok) { setMsg(r.errors.map(e => e.message).join(' ')); return; }
        setBusy(true);
        try {
            await updateDoc(doc(db, coll, record.id), r.patch);
            let note = `${codeOf(it)} identified.`;
            if (r.release && r.nsWrite) {
                const obId = await enqueueNsWrite({ ...r.nsWrite, createdBy: currentUser || '' });
                note += ` Every item known — the NetSuite write is queued (outbox ${obId}); the order proceeds when NetSuite accepts it.`;
            } else if (r.release) note += ' Every item known — the order proceeds.';
            else note += ` ${open.length - 1} still to identify.`;
            setMsg(`✅ ${note}`);
            setForIdx(null); setQ('');
        } catch (e) { setMsg(`⛔ ${e.message || e}`); }
        setBusy(false);
    };

    return (
        <div style={{ border: '1px solid #b3362f', background: '#fdf3f3', padding: '8px 10px', marginBottom: '8px' }}>
            <div style={{ ...mono, color: '#b3362f', marginBottom: '6px' }}>⚠ {open.length} item{open.length === 1 ? '' : 's'} to identify — the NetSuite order waits; nothing starts or picks until every one is known</div>
            {open.map(p => (
                <div key={p.lineIdx} style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', padding: '4px 0' }}>
                    <span style={{ fontSize: '0.9rem' }}><b>{p.qty} ×</b> {p.description} <span style={mono}>${Number(p.rate || 0).toLocaleString()}{p.by ? ` · ${p.by}` : ''}</span></span>
                    {forIdx !== p.lineIdx && <button onClick={() => start(p.lineIdx)} disabled={busy} style={{ ...mono, padding: '6px 10px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer' }}>Identify</button>}
                </div>
            ))}
            {forIdx !== null && (
                <div style={{ marginTop: '6px' }}>
                    <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="item # or name in the library — add it on tab 4 first if it is not there" style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem' }} />
                    {items === null && <div style={{ ...mono, marginTop: '4px' }}>reading the library…</div>}
                    {items !== null && t && matches.length === 0 && <div style={{ ...mono, marginTop: '4px' }}>nothing in the {brand || 'uniquity'} library matches — create the item on tab 4 (Master Library), sync it to NetSuite, then identify</div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                        {matches.map(it => (
                            <button key={it.id} onClick={() => pick(it)} disabled={busy} style={{ textAlign: 'left', padding: '6px 8px', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: '0.85rem', display: 'flex', gap: '10px' }}>
                                <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, minWidth: '140px' }}>{codeOf(it)}</span>
                                <span style={{ flex: 1 }}>{it.itemName || ''}</span>
                                <span style={{ ...mono, color: it.netSuiteInternalId ? '#2e7d32' : '#b3362f' }}>{it.netSuiteInternalId ? `NetSuite ${it.netSuiteInternalId}` : 'no NetSuite id — sync first'}</span>
                            </button>
                        ))}
                    </div>
                    <button onClick={() => { setForIdx(null); setQ(''); }} style={{ ...mono, marginTop: '6px', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>cancel</button>
                </div>
            )}
            {msg && <div style={{ fontSize: '0.82rem', marginTop: '6px', color: msg.startsWith('⛔') ? '#b3362f' : 'var(--ink)' }}>{msg}</div>}
        </div>
    );
};

export default PlaceholderResolve;
