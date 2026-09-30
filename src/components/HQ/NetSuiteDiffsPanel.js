import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc, deleteDoc, deleteField } from 'firebase/firestore';
import { takeNetSuitePatch } from '../Shared/nsImportGuard';

// ⚠ NETSUITE DIFFERS — the 4.5 half of the import lock (Stuart 2026-09-30: "prepare a warning so they can be set on
// 4.5 no more steps backwards"). 11.1 never writes a sales-side field on an item the app already has; where
// NetSuite's own value differs (base price, stock unit, category) it records it in system/ns_import_diffs/items
// (Shared/nsImportGuard). This lists them: take NetSuite's value (written the way 4.5 writes it) or keep the app's
// (remembered at that NetSuite value, so the next import does not raise it again). Nothing changes until a person
// chooses. Renders nothing when there is nothing to decide.
const theme = { paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', red: '#b02d20', green: '#1e8449' };
const show = (field, v) => (v === undefined || v === null || v === '' ? '—' : field === 'basePrice' && Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : String(v));

export default function NetSuiteDiffsPanel({ activeBrand, inventory = [] }) {
    const [docs, setDocs] = useState([]);
    const [sel, setSel] = useState(new Set());
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(true);
    useEffect(() => onSnapshot(collection(db, 'system', 'ns_import_diffs', 'items'),
        (snap) => setDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => setDocs([])), []);
    // This brand's items only — the list follows the records 4.5 is showing.
    const mine = useMemo(() => new Set((inventory || []).map(p => p.id)), [inventory]);
    const rows = useMemo(() => docs.filter(d => mine.has(d.id))
        .flatMap(d => Object.entries(d.fields || {}).map(([field, f]) => ({ key: `${d.id}|${field}`, docId: d.id, code: d.code || d.id, name: d.name || '', field, ...f, rec: d })))
        .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }) || a.field.localeCompare(b.field)), [docs, mine]);
    if (!activeBrand || !rows.length) return null;

    // After a field is settled, the record goes when nothing is left on it but remembered choices… and those stay.
    const settle = async (r, keep) => {
        const ref = doc(db, 'system', 'ns_import_diffs', 'items', r.docId);
        const left = Object.keys(r.rec.fields || {}).filter(f => f !== r.field);
        const dismissedLeft = Object.keys(r.rec.dismissed || {}).length + (keep ? 1 : 0);
        if (!left.length && !dismissedLeft) return deleteDoc(ref);
        return updateDoc(ref, { [`fields.${r.field}`]: deleteField(), ...(keep ? { [`dismissed.${r.field}`]: String(r.ns) } : {}), updatedAt: Date.now() });
    };
    const takeNs = async (r) => {
        await updateDoc(doc(db, 'Approved_Designs', r.docId), takeNetSuitePatch(r.field, r.ns));
        await settle(r, false);
    };
    const run = async (list, keep) => {
        if (!list.length || busy) return;
        if (!keep && !window.confirm(`Take NetSuite's value on ${list.length} field${list.length === 1 ? '' : 's'}?\n\n${list.slice(0, 12).map(r => `${r.code} · ${r.label}: ${show(r.field, r.app)} → ${show(r.field, r.ns)}`).join('\n')}${list.length > 12 ? `\n…and ${list.length - 12} more` : ''}\n\nThis writes the Master Library — quotes, order entry and the portal use the new value from now on.`)) return;
        setBusy(true);
        let done = 0; const failed = [];
        for (const r of list) {
            try { if (keep) await settle(r, true); else await takeNs(r); done++; }
            catch (e) { failed.push(`${r.code}: ${e.message || e}`); }
        }
        setBusy(false); setSel(new Set());
        if (failed.length) alert(`${done} done, ${failed.length} failed:\n\n${failed.slice(0, 10).join('\n')}`);
    };
    const ticked = rows.filter(r => sel.has(r.key));
    const items = new Set(rows.map(r => r.docId)).size;
    const btn = (on, extra = {}) => ({ padding: '6px 12px', background: on ? theme.ink : 'transparent', color: on ? '#fff' : theme.ink, border: `1px solid ${on ? theme.ink : theme.line}`, cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', ...extra });

    return (
        <div style={{ background: '#fff', border: `1px solid ${theme.red}`, padding: '18px 22px', borderRadius: '2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '260px' }}>
                    <h3 style={{ margin: '0 0 4px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: theme.ink }}>⚠ NetSuite differs — {rows.length} field{rows.length === 1 ? '' : 's'} on {items} item{items === 1 ? '' : 's'}</h3>
                    <span style={{ fontSize: '0.82rem', color: theme.inkSoft }}>The 11.1 import no longer overwrites price, unit or category on items the app already has. These are the ones where NetSuite says something different — nothing has changed yet. Take NetSuite's value, or keep the app's.</span>
                </div>
                <button onClick={() => setOpen(o => !o)} style={btn(false)}>{open ? 'Hide' : 'Show'}</button>
            </div>
            {open && (
                <>
                    <div style={{ display: 'flex', gap: '8px', margin: '12px 0 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: theme.inkSoft, cursor: 'pointer' }}>
                            <input type="checkbox" checked={ticked.length === rows.length} onChange={e => setSel(e.target.checked ? new Set(rows.map(r => r.key)) : new Set())} /> all
                        </label>
                        <button disabled={!ticked.length || busy} onClick={() => run(ticked, false)} style={btn(!!ticked.length)}>Use NetSuite's for {ticked.length || 'ticked'}</button>
                        <button disabled={!ticked.length || busy} onClick={() => run(ticked, true)} style={btn(false)}>Keep the app's for {ticked.length || 'ticked'}</button>
                        {busy && <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: theme.brass }}>writing…</span>}
                    </div>
                    <div style={{ maxHeight: '320px', overflowY: 'auto', border: `1px solid ${theme.line}` }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                            <thead>
                                <tr style={{ background: theme.paper2, textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: theme.inkSoft }}>
                                    <th style={{ padding: '6px 8px', width: '24px' }} /><th style={{ padding: '6px 8px' }}>Item</th><th style={{ padding: '6px 8px' }}>Field</th>
                                    <th style={{ padding: '6px 8px' }}>App (kept)</th><th style={{ padding: '6px 8px' }}>NetSuite</th><th style={{ padding: '6px 8px' }} />
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.key} style={{ borderTop: `1px solid ${theme.line}` }}>
                                        <td style={{ padding: '6px 8px' }}><input type="checkbox" checked={sel.has(r.key)} onChange={e => setSel(prev => { const n = new Set(prev); if (e.target.checked) n.add(r.key); else n.delete(r.key); return n; })} /></td>
                                        <td style={{ padding: '6px 8px' }}><b style={{ fontFamily: 'var(--mono)' }}>{r.code}</b> <span style={{ color: theme.inkSoft }}>{r.name}</span></td>
                                        <td style={{ padding: '6px 8px' }}>{r.label || r.field}</td>
                                        <td style={{ padding: '6px 8px' }}>{show(r.field, r.app)}</td>
                                        <td style={{ padding: '6px 8px', color: theme.red }}>{show(r.field, r.ns)}</td>
                                        <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                                            <button disabled={busy} onClick={() => run([r], false)} style={btn(true, { marginRight: '6px' })}>Use NetSuite's</button>
                                            <button disabled={busy} onClick={() => run([r], true)} style={btn(false)}>Keep app's</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
