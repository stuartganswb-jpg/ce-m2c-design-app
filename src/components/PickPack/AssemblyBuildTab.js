import React, { useState } from 'react';
import { buildablePartsOf, buildPreviewOf, buildMemoOf, buildRowError } from '../Shared/assemblyBuild';

// ── ASSEMBLY BUILD (Stuart 2026-09-30: "should look just like the bin count but do an assembly build") ─────────────────
// The Bin Count's shape — search, a table, a review, approve — but the post is an ASSEMBLY BUILD: NetSuite consumes the
// components from their bins and receives the assembly into the scanned bin. The review asks NetSuite first (the
// RESTlet's check mode: nothing is saved) and shows what it would consume, part by part and bin by bin; approve posts
// the build. What arrives is offered to the orders waiting for it, exactly as a put-away is. The rules are in
// Shared/assemblyBuild; the post is the Convert tab's proven RESTlet (postBuild).
const AssemblyBuildTab = ({ theme, t = (s) => s, hqParts = [], nsStock = {}, activeBrand, nsConfig, operator, isSyncing, pullStock,
    fetchLiveBins, lockBin, postBuild, nsMemo = (s) => s, writeLog = () => {}, offerAllocation, coverBackordersOn, coverNoteOf }) => {
    const [search, setSearch] = useState('');
    const [rows, setRows] = useState({});        // part id → { qty, toBin }
    const [review, setReview] = useState(null);  // { items: [{ part, qty, toBin, bin, preview, error }], memo }
    const [busy, setBusy] = useState('');

    const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
    const codeOf = (p) => U(p && (p.legacyErpId || p.itemId));
    const list = buildablePartsOf(hqParts, search).slice(0, 80);
    const liveBinsOf = (code) => ((nsStock[code] && nsStock[code].bins) || []).filter(b => b.bin);
    const defaultBin = (p) => { const b = liveBinsOf(codeOf(p))[0]; return b ? (b.name || b.bin) : String((p.manufacturingSpecs && p.manufacturingSpecs.binLocation) || '').split(',')[0].trim().replace(/^UNASSIGNED$/i, ''); };
    const rowOf = (p) => rows[p.id] || { qty: '', toBin: '' };
    const setRow = (p, patch) => setRows(prev => ({ ...prev, [p.id]: { ...rowOf(p), ...patch } }));
    const chosen = hqParts.filter(p => rows[p.id] && Number(rows[p.id].qty) > 0);

    // REVIEW: every chosen row — its bin locked to NetSuite's own, then NetSuite's CHECK of the build.
    const openReview = async () => {
        if (!nsConfig) return alert('NetSuite routing (subsidiary / location) is missing for this brand.');
        const bad = chosen.map(p => ({ p, err: buildRowError({ qty: Number(rowOf(p).qty), toBin: rowOf(p).toBin || defaultBin(p) }) })).find(x => x.err);
        if (bad) return alert(`${codeOf(bad.p)}: ${bad.err}.`);
        setBusy('Asking NetSuite what each build consumes…');
        const items = [];
        try {
            for (const p of chosen) {
                const qty = Number(rowOf(p).qty);
                const typed = rowOf(p).toBin || defaultBin(p);
                const lock = await lockBin(typed);   // THE BIN LOCK — a real bin, NetSuite's spelling
                if (!lock.ok) { items.push({ part: p, qty, toBin: typed, error: lock.msg }); continue; }
                try {
                    const d = await postBuild({ itemId: String(p.netSuiteInternalId), quantity: qty, subsidiary: nsConfig.subsidiary, location: nsConfig.location, toBin: lock.bin, memo: nsMemo(buildMemoOf({ by: operator && operator.name })), diag: true });
                    const lines = Array.isArray(d && d.diag) ? d.diag : [];
                    const byNs = (id) => hqParts.find(x => String(x.netSuiteInternalId || '') === String(id)) || null;
                    const codes = [...new Set(lines.map(l => byNs(l.item)).filter(Boolean).map(codeOf))];
                    const live = (codes.length && fetchLiveBins ? await fetchLiveBins(codes) : null) || {};
                    const binsByCode = Object.fromEntries(codes.map(c => [c, (live[c] && live[c].bins) || []]));
                    items.push({ part: p, qty, toBin: lock.bin, preview: buildPreviewOf({ diag: lines, findByNsId: byNs, binsByCode }) });
                } catch (e) { items.push({ part: p, qty, toBin: lock.bin, error: `NetSuite could not check it: ${e.message || e}` }); }
            }
            setReview({ items, memo: '' });
        } finally { setBusy(''); }
    };

    // APPROVE: post each build that checked clean; offer what arrived to the orders waiting for it.
    const postAll = async () => {
        if (!review) return;
        const ready = review.items.filter(it => !it.error && (it.preview || []).every(l => l.ok));
        if (!ready.length) return alert('Nothing here can be built as it stands — fix what the review names first.');
        if (!window.confirm(`Post ${ready.length} assembly build${ready.length > 1 ? 's' : ''} to NetSuite?\n\n${ready.map(it => `  • ${it.qty} × ${codeOf(it.part)} → ${it.toBin}`).join('\n')}\n\nNetSuite consumes the components shown and receives the assemblies into those bins.`)) return;
        setBusy('Posting to NetSuite…');
        const done = [], failed = [];
        let notes = '';
        try {
            for (const it of ready) {
                const code = codeOf(it.part);
                try {
                    const r = await postBuild({ itemId: String(it.part.netSuiteInternalId), quantity: it.qty, subsidiary: nsConfig.subsidiary, location: nsConfig.location, toBin: it.toBin, memo: nsMemo(buildMemoOf({ by: operator && operator.name, note: review.memo })) });
                    done.push(`${it.qty} × ${code} → ${it.toBin} (build #${(r && r.id) || '?'})`);
                    writeLog(`Assembly build by ${(operator && operator.name) || 'Unknown'}: ${it.qty} × ${code} → ${it.toBin}, NetSuite #${(r && r.id) || '?'}${String(review.memo || '').trim() ? ` — ${review.memo.trim()}` : ''}`, 'wms');
                    // THE SAME ARRIVAL RULE AS A PUT-AWAY: an order waiting for this item is offered it before it vanishes onto the shelf.
                    try {
                        const taken = offerAllocation ? await offerAllocation(code, it.qty, { from: `assembly build ${code}` }) : 0;
                        if (taken > 0) notes += `\n📦 ${taken} × ${code} gathered for open orders — see SO Pack.`;
                        if (coverBackordersOn) notes += (coverNoteOf ? coverNoteOf(await coverBackordersOn(code, it.qty, `assembly build ${code}`)) : '');
                    } catch (e) { console.warn('arrival alert failed (the build stands):', e); }
                } catch (e) { failed.push(`${code}: ${e.message || e}`); }
            }
        } finally { setBusy(''); }
        setReview(null);
        setRows({});
        if (pullStock) pullStock();
        alert(`${done.length ? `✅ Built:\n${done.map(x => `  • ${x}`).join('\n')}` : ''}${failed.length ? `\n\n⛔ NOT built — NetSuite refused:\n${failed.map(x => `  • ${x}`).join('\n')}` : ''}${notes}`);
    };

    const cell = { padding: '16px', borderBottom: `1px solid ${theme.line}` };
    const head = { ...cell, fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.08em' };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', height: '100%' }}>
            {review && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#fff', padding: '40px', width: 'min(860px, 96vw)', maxHeight: '90vh', overflowY: 'auto', border: `1px solid ${theme.line}` }}>
                        <h2 style={{ margin: '0 0 8px 0', fontFamily: theme.serif, fontSize: '2rem', color: theme.ink }}>{t('Build Review')}</h2>
                        <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, marginBottom: '20px', letterSpacing: '.1em', textTransform: 'uppercase' }}>
                            {t('NetSuite checked each build — nothing is posted until you approve')} · {t('Subsidiary')} {nsConfig && nsConfig.subsidiary} · {t('Location')} {nsConfig && nsConfig.location}
                        </div>
                        {review.items.map(it => (
                            <div key={it.part.id} style={{ border: `1px solid ${theme.line}`, padding: '16px', marginBottom: '16px' }}>
                                <div style={{ fontFamily: theme.sans, fontSize: '1.05rem', color: theme.ink, fontWeight: 500 }}>{it.qty} × {codeOf(it.part)} <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.brass }}>→ {it.toBin}</span></div>
                                <div style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft, marginBottom: '10px' }}>{it.part.itemName || ''}</div>
                                {it.error ? <div style={{ color: '#d9534f', fontFamily: theme.sans, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>⛔ {it.error}</div> : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                        <thead><tr>{['Consumes', 'Qty', 'From bin', 'In that bin', ''].map(h => <th key={h} style={{ ...head, padding: '8px' }}>{t(h)}</th>)}</tr></thead>
                                        <tbody>
                                            {(it.preview || []).map((l, i) => (
                                                <tr key={i}>
                                                    <td style={{ padding: '8px', fontFamily: theme.mono, fontSize: '12px' }}>{l.code}<div style={{ fontFamily: theme.sans, fontSize: '11px', color: theme.inkSoft }}>{l.name}</div></td>
                                                    <td style={{ padding: '8px', fontFamily: theme.mono }}>{l.qty}</td>
                                                    <td style={{ padding: '8px', fontFamily: theme.mono, fontSize: '12px' }}>{l.bin}</td>
                                                    <td style={{ padding: '8px', fontFamily: theme.mono }}>{l.onHand == null ? '—' : l.onHand}</td>
                                                    <td style={{ padding: '8px', fontFamily: theme.sans, fontSize: '12px', color: l.ok ? '#3a7d44' : '#d9534f' }}>{l.ok ? '✓' : `⛔ ${l.why}`}</td>
                                                </tr>
                                            ))}
                                            {!(it.preview || []).length && <tr><td colSpan="5" style={{ padding: '8px', color: '#d9534f', fontFamily: theme.sans, fontSize: '0.9rem' }}>⛔ {t('NetSuite lists no components for this assembly — check its BOM in NetSuite.')}</td></tr>}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        ))}
                        <label style={{ display: 'block', fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', margin: '8px 0' }}>
                            {t('Build memo')}{operator && operator.name ? ` — ${t('recorded as')} ${operator.name}` : ''}
                        </label>
                        <textarea value={review.memo} onChange={e => setReview(r => ({ ...r, memo: e.target.value }))} rows={2} placeholder={t('Optional note (what it is for, who verified…). Pushed to the NetSuite memo with your name.')}
                            style={{ width: '100%', padding: '12px', fontFamily: theme.sans, fontSize: '0.9rem', color: theme.ink, border: `1px solid ${theme.line}`, outline: 'none', resize: 'vertical', boxSizing: 'border-box', marginBottom: '24px' }} />
                        <div style={{ display: 'flex', gap: '20px', justifyContent: 'flex-end' }}>
                            <button onClick={() => setReview(null)} disabled={!!busy} style={{ padding: '15px 30px', background: 'transparent', border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{t('Cancel')}</button>
                            <button onClick={postAll} disabled={!!busy} style={{ padding: '15px 30px', background: theme.brass, color: '#fff', border: 'none', cursor: busy ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                {busy || t('Approve & Post Build')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '24px', display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input placeholder={t('Search assembly name or SKU…')} value={search} onChange={e => setSearch(e.target.value)} style={{ padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, outline: 'none', flex: 1, minWidth: '220px' }} />
                <button onClick={pullStock} disabled={isSyncing} style={{ padding: '12px 20px', background: isSyncing ? theme.paper : theme.ink, color: isSyncing ? theme.inkSoft : '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                    {isSyncing ? t('Syncing...') : t('Pull Live Stock')}
                </button>
                <button onClick={openReview} disabled={!chosen.length || !!busy} style={{ padding: '12px 20px', background: chosen.length ? theme.brass : theme.paper, color: chosen.length ? '#fff' : theme.inkSoft, border: 'none', cursor: chosen.length && !busy ? 'pointer' : 'not-allowed', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                    {busy || `${t('Review build')}${chosen.length ? ` (${chosen.length})` : ''}`}
                </button>
            </div>

            <div style={{ flex: 1, background: '#fff', border: `1px solid ${theme.line}`, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ background: theme.paper2, position: 'sticky', top: 0, zIndex: 10 }}>
                        <tr>
                            <th style={head}>{t('Assembly')}</th>
                            <th style={{ ...head, textAlign: 'center' }}>{t('In stock (bins)')}</th>
                            <th style={{ ...head, textAlign: 'center' }}>{t('Build qty')}</th>
                            <th style={{ ...head, textAlign: 'center' }}>{t('Into bin')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {list.map(p => {
                            const code = codeOf(p);
                            const bins = liveBinsOf(code);
                            const r = rowOf(p);
                            return (
                                <tr key={p.id} style={{ borderBottom: `1px solid ${theme.line}`, background: Number(r.qty) > 0 ? '#f8fdf8' : '#fff' }}>
                                    <td style={{ padding: '16px' }}>
                                        <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{code}</div>
                                        <div style={{ fontFamily: theme.sans, fontSize: '1rem', color: theme.ink, fontWeight: 500 }}>{p.itemName}</div>
                                    </td>
                                    <td style={{ padding: '16px', textAlign: 'center', fontFamily: theme.mono, fontSize: '12px', color: theme.inkSoft }}>
                                        {(nsStock[code] && nsStock[code].onHand) || 0}{bins.length ? ` · ${bins.slice(0, 2).map(b => `${b.name || b.bin} ${b.qty}`).join(', ')}` : ''}
                                    </td>
                                    <td style={{ padding: '16px', textAlign: 'center' }}>
                                        <input type="number" min="0" placeholder="-" value={r.qty} onChange={e => setRow(p, { qty: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0) })}
                                            style={{ width: '100px', padding: '12px', textAlign: 'center', fontSize: '1.2rem', fontFamily: theme.mono, border: `1px solid ${Number(r.qty) > 0 ? theme.brass : theme.line}`, outline: 'none' }} />
                                    </td>
                                    <td style={{ padding: '16px', textAlign: 'center' }}>
                                        <input placeholder={defaultBin(p) || t('scan bin')} value={r.toBin} onChange={e => setRow(p, { toBin: e.target.value.toUpperCase() })}
                                            style={{ width: '170px', padding: '12px', textAlign: 'center', fontFamily: theme.mono, border: `1px solid ${theme.line}`, outline: 'none' }} />
                                    </td>
                                </tr>
                            );
                        })}
                        {!list.length && <tr><td colSpan="4" style={{ padding: '40px', textAlign: 'center', color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>{t('No assembly matches — search by SKU or name.')}</td></tr>}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default AssemblyBuildTab;
