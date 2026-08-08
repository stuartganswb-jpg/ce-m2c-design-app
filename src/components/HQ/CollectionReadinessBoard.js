// COLLECTION READINESS BOARD (playbook 4.1, Stuart 2026-08-08) — "loaded" vs merely "present".
//
// Read-only. One row per family item, one colored cell per readiness check, one chip per spec
// dia×proj cell — so the H1 mass load can be audited at a glance instead of discovered one wrong
// quote, dropped SO line, or blank spec sheet at a time. All judgment lives in
// Shared/collectionReadiness.js (pure, node-tested); this component only gathers documents and
// renders verdicts. It writes NOTHING — fixes happen in the tools that own each fact (importer,
// 🧬 stamper, 11.1 sync, 4.6 pricing, 1.6 pins, 📐 registry).
import React, { useState, useMemo } from 'react';
import { db } from '../../firebase';
import { doc, getDoc, getDocs, query, collection, where } from 'firebase/firestore';
import { SIZE_FAMILIES, projAllowedAtDia } from '../Shared/sizeMatrix';
import { customerKeys } from '../Shared/clientPricing';
import { scoreCollection, cellCoverage, CHECKS } from '../Shared/collectionReadiness';

const COL = { OK: '#2e7d4f', WARN: '#8a6d1a', FAIL: '#b00020', NA: '#bbb' };
const GLYPH = { OK: '✓', WARN: '⚠', FAIL: '✗', NA: '—' };
// The family's code prefix ("H1-RND" → "H1-"): UNSTAMPED items that look like family members are
// included on purpose — a missing sizeKey is exactly the kind of hole this board exists to show.
const prefixOf = (familyKey) => `${String(familyKey).split('-')[0]}-`;

const CollectionReadinessBoard = ({ libraryParts, customersData, assemblies, activeBrand, onClose }) => {
    const [familyKey, setFamilyKey] = useState('H1-RND');
    const [customerId, setCustomerId] = useState('');
    const [masterIds, setMasterIds] = useState([]);      // Approved_Designs docs whose pins define "reachable"
    const [includeVariants, setIncludeVariants] = useState(false);
    const [filter, setFilter] = useState('ALL');         // ALL | FAIL | WARN
    const [result, setResult] = useState(null);          // { scored, cells, scannedAt }
    const [busy, setBusy] = useState(false);

    const masters = useMemo(() => (assemblies || [])
        .filter(a => a.manufacturingSpecs?.cadUrl)
        .sort((a, b) => String(a.itemName || '').localeCompare(String(b.itemName || ''))), [assemblies]);

    const runScan = async () => {
        setBusy(true);
        try {
            const prefix = prefixOf(familyKey);
            const parts = (libraryParts || []).filter(p => {
                const code = String((p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : p.itemId) || '').toUpperCase();
                if (!includeVariants && code.includes('/')) return false;
                const fam = p.manufacturingSpecs?.customData?.sizeKey?.family;
                return fam === familyKey || (!fam && code.startsWith(prefix));
            });
            // Pins for every selected master — keyed by itemId in practice, by doc id for older
            // writers (the same both-ids lesson as the spec registry), so query both.
            const pinnedIdSet = new Set();
            for (const mid of masterIds) {
                const m = masters.find(a => a.id === mid);
                const keys = [...new Set([m?.itemId, m?.id].filter(Boolean))];
                for (const k of keys) {
                    const snap = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', k)));
                    snap.docs.forEach(d => {
                        const pin = d.data();
                        [pin.partId, pin.partName].filter(Boolean).forEach(v => {
                            pinnedIdSet.add(String(v));
                            pinnedIdSet.add(String(v).toUpperCase());
                        });
                    });
                }
            }
            const cfgSnap = await getDoc(doc(db, 'system', 'spec_sheet_config')).catch(() => null);
            const sizeSources = cfgSnap?.exists() ? (cfgSnap.data().sizeSources || {}) : {};
            const cust = customerId ? (customersData || []).find(c => c.id === customerId) : null;
            const scored = scoreCollection(parts, {
                familyKey,
                allParts: libraryParts || [],
                custKeys: customerId ? customerKeys(customerId, cust) : null,
                crmId: customerId,
                pinnedIdSet,
            });
            setResult({ scored, cells: cellCoverage(familyKey, sizeSources, projAllowedAtDia), scannedAt: Date.now() });
        } catch (e) {
            console.error('readiness scan failed', e);
            alert('Scan failed: ' + (e.message || e));
        }
        setBusy(false);
    };

    const rows = useMemo(() => {
        if (!result) return [];
        if (filter === 'FAIL') return result.scored.rows.filter(r => r.fails > 0);
        if (filter === 'WARN') return result.scored.rows.filter(r => r.fails > 0 || r.warns > 0);
        return result.scored.rows;
    }, [result, filter]);

    const sel = { padding: '6px', fontSize: '0.8rem' };
    const chip = (state) => ({ display: 'inline-block', minWidth: '18px', textAlign: 'center', padding: '2px 4px', borderRadius: '3px', fontSize: '0.72rem', color: '#fff', background: COL[state], cursor: 'default' });

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.75)', zIndex: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#fff', width: 'min(1250px, 96vw)', height: '92vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem' }}>Collection Readiness</span>
                    <select style={sel} value={familyKey} onChange={e => { setFamilyKey(e.target.value); setResult(null); }}>
                        {Object.entries(SIZE_FAMILIES).map(([k, f]) => <option key={k} value={k}>{f.label || k}</option>)}
                    </select>
                    <select style={sel} value={customerId} onChange={e => { setCustomerId(e.target.value); setResult(null); }} title="Customer for the pricing-row check">
                        <option value="">no customer (skip row check)</option>
                        {(customersData || []).map(c => <option key={c.id} value={c.id}>{c.companyName || c.name || c.id}</option>)}
                    </select>
                    <select style={sel} value="" onChange={e => { const v = e.target.value; if (v && !masterIds.includes(v)) { setMasterIds([...masterIds, v]); setResult(null); } }} title="Master assemblies whose pins define reachability — add each one the family sells through">
                        <option value="">+ master assembly (pins)…</option>
                        {masters.map(a => <option key={a.id} value={a.id}>{a.itemName || a.itemId}</option>)}
                    </select>
                    {masterIds.map(id => (
                        <span key={id} style={{ fontSize: '0.72rem', border: '1px solid var(--line)', padding: '2px 6px', borderRadius: '3px' }}>
                            {masters.find(a => a.id === id)?.itemName || id}
                            <button style={{ marginLeft: '4px', border: 'none', background: 'none', cursor: 'pointer' }} onClick={() => { setMasterIds(masterIds.filter(x => x !== id)); setResult(null); }}>✕</button>
                        </span>
                    ))}
                    <label style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input type="checkbox" checked={includeVariants} onChange={e => { setIncludeVariants(e.target.checked); setResult(null); }} /> finish variants
                    </label>
                    <button onClick={runScan} disabled={busy} style={{ padding: '8px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                        {busy ? 'Scanning…' : result ? 'Re-scan' : 'Run scan'}
                    </button>
                    <span style={{ flex: 1 }} />
                    <button onClick={onClose} style={{ padding: '8px 14px', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer' }}>Close</button>
                </div>

                {!result ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontSize: '0.9rem', padding: '20px', textAlign: 'center' }}>
                        Pick the family (and optionally the customer + the master assemblies), then Run scan.<br />
                        Read-only — fixes happen in the tool that owns each fact (importer / 🧬 / 11.1 / 4.6 / 1.6 / 📐).
                    </div>
                ) : (
                    <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
                        {/* Summary: per-check totals + spec-cell coverage */}
                        <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', marginBottom: '14px', alignItems: 'flex-start' }}>
                            <div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '6px' }}>
                                    {result.scored.total} items · {result.scored.ready} fully ready
                                </div>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    {CHECKS.map(({ key, label }) => {
                                        const t = result.scored.totals[key];
                                        return (
                                            <span key={key} style={{ fontSize: '0.72rem', border: '1px solid var(--line)', padding: '3px 6px', borderRadius: '3px' }}
                                                title={`${label}: ${t.ok} ok · ${t.warn} warn · ${t.fail} fail · ${t.na} n/a`}>
                                                {label} <b style={{ color: COL.OK }}>{t.ok}</b>{t.warn ? <b style={{ color: COL.WARN }}> ⚠{t.warn}</b> : null}{t.fail ? <b style={{ color: COL.FAIL }}> ✗{t.fail}</b> : null}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                            <div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '6px' }}>Spec cells (📐 registry)</div>
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxWidth: '380px' }}>
                                    {result.cells.map(c => {
                                        const col = c.kind === 'GLB' ? COL.OK : c.kind === 'ASSEMBLY' ? COL.WARN : COL.FAIL;
                                        const tip = c.kind === 'MISSING' ? 'no spec geometry registered'
                                            : `${c.kind === 'GLB' ? 'direct spec GLB' : 'mapped assembly'} · ${c.name}${c.savedAt ? ` · ${new Date(c.savedAt).toLocaleDateString()}` : ''}`;
                                        return <span key={c.key} title={tip} style={{ fontSize: '0.7rem', border: `1px solid ${col}`, color: col, padding: '2px 6px', borderRadius: '3px' }}>{c.key}</span>;
                                    })}
                                </div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--ink-soft)', marginTop: '4px' }}>One cell is also covered by each master's own geometry when the 📐 modal opens it (its base cell).</div>
                            </div>
                            <div style={{ display: 'flex', gap: '4px', alignSelf: 'flex-start' }}>
                                {['ALL', 'WARN', 'FAIL'].map(f => (
                                    <button key={f} onClick={() => setFilter(f)} style={{ padding: '5px 10px', fontSize: '0.72rem', cursor: 'pointer', border: '1px solid var(--line)', background: filter === f ? 'var(--ink)' : '#fff', color: filter === f ? '#fff' : 'var(--ink)' }}>
                                        {f === 'ALL' ? `all (${result.scored.total})` : f === 'WARN' ? 'needs attention' : 'blocking only'}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                            <thead>
                                <tr style={{ position: 'sticky', top: 0, background: 'var(--paper-2, #f2efe8)', zIndex: 1 }}>
                                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>Item</th>
                                    {CHECKS.map(c => <th key={c.key} style={{ padding: '6px 4px', fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>{c.label}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.code} style={{ borderBottom: '1px solid var(--line)' }}>
                                        <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '0.74rem' }}>{r.code}</span>
                                            <span style={{ color: 'var(--ink-soft)', marginLeft: '8px' }}>{r.name}</span>
                                        </td>
                                        {r.checks.map(c => (
                                            <td key={c.key} style={{ textAlign: 'center', padding: '4px' }}>
                                                <span style={chip(c.state)} title={`${CHECKS.find(x => x.key === c.key)?.label}: ${c.detail || c.state}`}>{GLYPH[c.state]}</span>
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                                {!rows.length && <tr><td colSpan={CHECKS.length + 1} style={{ padding: '18px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Nothing matches this filter.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CollectionReadinessBoard;
