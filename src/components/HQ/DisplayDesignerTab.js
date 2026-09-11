// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. MARKETING — SALES DISPLAY DESIGNER (Stuart 2026-09-11)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "ideally i would like to use the marketing tab to design displays, so in other words we could
//  set a board size of say 24"x24" then go and configure each row on the cpq and have it add
//  them to the board to create the visual and the BOM for the board."
//
// A display is faces; a face is a board of a given size that carries ROWS (CPQ configurations,
// taken from the shared cart exactly as CPQ handed them) or CHIPS (one of every sellable finish,
// laid out from the master finish list). The board is drawn to scale at 100 units per inch — the
// Guide Books page convention — with the same drag / resize gestures. The bill of one board is
// COMPUTED (Shared/displayBom), never typed.
//
// WRITES: system/displays/entries/{id} (the system rule; no rules deploy) and a DISPLAY CAPTURE in
// global_assets for each row's render (Storage, so the record never carries an image inline).
// READS: the cart (never changed), the two finish lists. No job, work order, floor document,
// snapshot or NetSuite write — build orders are the next issue and start from a saved display.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../../firebase';
import { collection, doc, onSnapshot, setDoc, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import { DISPLAY_STYLES, UNITS_PER_INCH, newDisplay, chipLines, chipFaceLayout, boardBom, orderBom, bomCsv, rowConfigFromCartItem, displayFromTracker, seededRowsLayout } from '../Shared/displayBom';
import { saveGuideCapture } from '../Shared/guideCapture';
import { workbookFileToSheets } from '../Shared/customerControlFile';
import DisplayBuildsPanel from './DisplayBuildsPanel';

const uid = () => Math.random().toString(36).slice(2, 9);
const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)' };
const btn = (on, extra = {}) => ({ padding: '8px 14px', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', ...extra });
const inp = { padding: '8px 10px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none', background: '#fff' };
const td = { padding: '6px 8px', borderBottom: '1px solid var(--line)', fontSize: '0.84rem', verticalAlign: 'top' };
const th = { ...mono, padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--line)' };

const DisplayDesignerTab = ({ currentUser, activeBrand, cart = [] }) => {
    const [displays, setDisplays] = useState([]);
    const [openId, setOpenId] = useState(null);
    const [draft, setDraft] = useState(null);        // the open display, edited locally
    const [dirty, setDirty] = useState(false);
    const [faceIx, setFaceIx] = useState(0);
    const [finishes, setFinishes] = useState({ inHouse: [], outsourced: [] });
    const [busy, setBusy] = useState('');
    const [boards, setBoards] = useState(1);         // the BOM multiplier, preview only
    const [newForm, setNewForm] = useState(null);    // { name, style }
    const [view, setView] = useState('DESIGNS');     // DESIGNS | BUILDS — piece 2 lives on the same tab
    const [seed, setSeed] = useState(null);          // tracker seed preview { sheets, tabIx, boards, name, parsed, resolved, missing }
    const svgRef = useRef(null);
    const dragRef = useRef(null);
    const seedFileRef = useRef(null);

    // ── data ─────────────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        const u1 = onSnapshot(collection(db, 'system', 'displays', 'entries'), snap => {
            setDisplays(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => !activeBrand || !d.brandId || d.brandId === activeBrand).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))));
        }, () => {});
        const u2 = onSnapshot(doc(db, 'system', 'master_finishes'), s => setFinishes(f => ({ ...f, inHouse: (s.exists() && Array.isArray(s.data().finishes)) ? s.data().finishes : [] })), () => {});
        const u3 = onSnapshot(collection(db, 'hq_outsource_finishes'), s => setFinishes(f => ({ ...f, outsourced: s.docs.map(d => ({ id: d.id, ...d.data(), outsourced: true })) })), () => {});
        return () => { u1(); u2(); u3(); };
    }, [activeBrand]);
    const finishList = useMemo(() => [...finishes.inHouse, ...finishes.outsourced], [finishes]);
    const chips = useMemo(() => chipLines(finishList), [finishList]);

    const open = (d) => { setOpenId(d.id); setDraft(JSON.parse(JSON.stringify(d))); setDirty(false); setFaceIx(0); };
    const close = () => { if (dirty && !window.confirm('Discard unsaved changes to this display?')) return; setOpenId(null); setDraft(null); setDirty(false); };
    const face = draft ? (draft.faces || [])[faceIx] : null;
    const mutate = (fn, markDirty = true) => { setDraft(d => fn({ ...d, faces: (d.faces || []).map(f => ({ ...f, rows: [...(f.rows || [])] })), extras: [...(d.extras || [])] })); if (markDirty) setDirty(true); };
    const mutateFace = (fn, markDirty = true) => mutate(d => ({ ...d, faces: d.faces.map((f, i) => (i === faceIx ? fn(f) : f)) }), markDirty);

    // ── create / save / delete ───────────────────────────────────────────────────────────────
    const create = async () => {
        const name = String(newForm?.name || '').trim();
        if (!name) return alert('Give the display a name (e.g. "Fabricut H1 Tabletop").');
        const id = `DSP-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString().slice(-5)}`;
        const d = { ...newDisplay({ id, name, style: newForm.style || 'TABLETOP', brandId: activeBrand || '' }), createdAt: Date.now(), createdBy: String(currentUser || ''), updatedAt: Date.now(), updatedBy: String(currentUser || '') };
        try { await setDoc(doc(db, 'system', 'displays', 'entries', id), d); setNewForm(null); open(d); }
        catch (e) { alert('Create failed: ' + (e?.message || e)); }
    };
    const save = async () => {
        if (!draft) return;
        setBusy('Saving…');
        try {
            const d = { ...draft, updatedAt: Date.now(), updatedBy: String(currentUser || '') };
            await setDoc(doc(db, 'system', 'displays', 'entries', d.id), d);
            setDirty(false);
        } catch (e) { alert('Save failed: ' + (e?.message || e)); }
        setBusy('');
    };
    const remove = async (d) => {
        if (!window.confirm(`Delete the display "${d.name}"? Its rows and bill go with it; the row images stay in the Asset Gallery.`)) return;
        try { await deleteDoc(doc(db, 'system', 'displays', 'entries', d.id)); if (openId === d.id) { setOpenId(null); setDraft(null); } }
        catch (e) { alert('Delete failed: ' + (e?.message || e)); }
    };

    // ── SEED A DISPLAY FROM THE TRACKER SPREADSHEET (Stuart 2026-09-11) ──────────────────────
    // "any chance you can create the fabricut tabletop from the spreadsheet." The tracker's rows
    // ARE the board (Shared/displayBom.displayFromTracker, tested on the real file). Read →
    // resolve the codes against the library → show what will be written → Create. A seeded row
    // has no render (a labelled box) until it is replaced from the CPQ cart; the bill is right
    // either way. An in-app button, not a script: bulk data goes through the authenticated app.
    const onSeedFile = async (file) => {
        if (!file) return;
        setBusy('Reading the tracker…');
        try {
            const sheets = await workbookFileToSheets(file);
            const tabIx = Math.max(0, sheets.findIndex(s => /tabletop/i.test(s.name)));
            const s = { sheets, tabIx, boards: /wall/i.test(sheets[tabIx]?.name || '') ? 35 : 50, name: '', fileName: file.name, parsed: null, resolved: {}, missing: [] };
            setSeed(s);
            await parseSeed(s);
        } catch (e) { alert('Could not read that workbook:\n\n' + (e?.message || e)); setSeed(null); }
        setBusy('');
    };
    const parseSeed = async (s) => {
        const sheet = s.sheets[s.tabIx];
        const style = /wall/i.test(sheet?.name || '') ? 'WALL' : 'TABLETOP';
        let parsed;
        try { parsed = displayFromTracker(sheet.grid, { boards: s.boards, style, name: s.name || `Fabricut H1 ${style === 'WALL' ? 'Wall Board' : 'Tabletop'}` }); }
        catch (e) { alert(e?.message || String(e)); return; }
        // Resolve every code to its library doc — the id CPQ lines carry — in chunks of ten.
        const codes = [...new Set(parsed.rows.flatMap(r => r.lines.map(l => l.code)))];
        const resolved = {};
        for (let i = 0; i < codes.length; i += 10) {
            const chunk = codes.slice(i, i + 10);
            try {
                const snap = await getDocs(query(collection(db, 'Approved_Designs'), where('legacyErpId', 'in', chunk)));
                snap.docs.forEach(d => { const x = d.data(); const k = String(x.legacyErpId || '').trim().toUpperCase(); if (!resolved[k] || x.brandId === activeBrand) resolved[k] = { id: d.id, name: x.itemName || '' }; });
            } catch (e) { console.error(e); }
        }
        setSeed(prev => ({ ...(prev || s), parsed, style, resolved, missing: codes.filter(c => !resolved[c]) }));
    };
    const createFromSeed = async () => {
        const { parsed, style, resolved, missing } = seed || {};
        if (!parsed) return;
        const name = String(seed.name || parsed.name).trim();
        const id = `DSP-${name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '')}-${Date.now().toString().slice(-5)}`;
        const d = newDisplay({ id, name, style, brandId: activeBrand || '' });
        const rowsFace = d.faces.find(f => f.kind === 'ROWS');
        const laid = seededRowsLayout(parsed.rows, { widthIn: rowsFace.widthIn, heightIn: rowsFace.heightIn });
        rowsFace.rows = laid.map((r, i) => {
            const fins = [...new Set(r.lines.map(l => l.finishCode).filter(Boolean))];
            return {
                id: `seed${i + 1}`, label: r.label, x: r.x, y: r.y, w: r.w, h: r.h, imageUrl: '', hiResUrl: '',
                config: {
                    cartId: '', assemblyId: '', assemblyName: r.label, flowId: '', finishLabel: fins.join(' / '), finishes: fins,
                    lengthInches: (r.lines.find(l => l.perFoot) || {}).cutLength || 0, memo: r.note || '', seededFrom: seed.fileName || 'tracker',
                    lines: r.lines.map(l => ({ partId: resolved[l.code]?.id || l.code, legacyErpId: l.code, name: l.name || resolved[l.code]?.name || '', qty: l.qty, perFoot: l.perFoot, feet: l.feet, cutLength: l.cutLength, finishCode: l.finishCode, noFinish: !l.finishCode, ...(resolved[l.code] ? {} : { unresolved: true }) })),
                },
            };
        });
        d.extras = parsed.extras;
        Object.assign(d, { seededFrom: { file: seed.fileName || '', tab: seed.sheets[seed.tabIx]?.name || '', boards: parsed.boards, warnings: parsed.warnings, unresolvedCodes: missing }, createdAt: Date.now(), createdBy: String(currentUser || ''), updatedAt: Date.now(), updatedBy: String(currentUser || '') });
        setBusy('Writing the display…');
        try { await setDoc(doc(db, 'system', 'displays', 'entries', id), d); setSeed(null); open(d); }
        catch (e) { alert('Create failed: ' + (e?.message || e)); }
        setBusy('');
    };

    // ── rows from the cart ───────────────────────────────────────────────────────────────────
    // The cart line is CPQ's own hand-off: its breakdown becomes the row's lines, its render (the
    // JPEG CPQ keeps for the documents) is filed in the gallery as a DISPLAY CAPTURE. No render on
    // the line (an old-engine item, or an assembly with no .glb) = a labelled box, still a row.
    const addRowFromCart = async (it) => {
        if (!face || face.kind !== 'ROWS') return alert('Open a products face first — chips faces lay themselves out.');
        setBusy('Placing the row…');
        try {
            const label = `Row ${(face.rows || []).length + 1}`;
            let imageUrl = '', hiResUrl = '';
            if (it.renderSnapshot && /^data:image/.test(it.renderSnapshot)) {
                const a = await saveGuideCapture({ dataUrl: it.renderSnapshot, name: `${draft.name} ${label}`, code: it.assemblyName || '', brandId: activeBrand || '', user: currentUser, kind: 'DISPLAY' });
                imageUrl = a.thumbnailUrl; hiResUrl = a.originalUrl;
            }
            const W = (face.widthIn || 24) * UNITS_PER_INCH;
            const w = Math.round(W * 0.82);
            const h = Math.round(w / 4);
            const below = (face.rows || []).reduce((m, r) => Math.max(m, r.y + r.h), 0.6 * UNITS_PER_INCH);
            const row = { id: uid(), label, x: Math.round((W - w) / 2), y: Math.round(below + 0.4 * UNITS_PER_INCH), w, h, imageUrl, hiResUrl, config: rowConfigFromCartItem(it) };
            mutateFace(f => ({ ...f, rows: [...(f.rows || []), row] }));
        } catch (e) { alert('Could not place the row: ' + (e?.message || e)); }
        setBusy('');
    };

    // ── the drag loop (the Guide Books idiom) ────────────────────────────────────────────────
    const toBoard = (e) => {
        const svg = svgRef.current; if (!svg) return { x: 0, y: 0 };
        const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        return { x: Math.round(p.x), y: Math.round(p.y) };
    };
    const startDrag = (e, kind, id, extra = {}) => {
        e.stopPropagation(); e.preventDefault();
        dragRef.current = { kind, id, start: toBoard(e), ...extra };
        const move = (ev) => {
            const d = dragRef.current; if (!d) return;
            const now = toBoard(ev); const dx = now.x - d.start.x, dy = now.y - d.start.y;
            if (d.kind === 'move') mutateFace(f => ({ ...f, rows: f.rows.map(r => (r.id === d.id ? { ...r, x: d.ox + dx, y: d.oy + dy } : r)) }), false);
            if (d.kind === 'resize') mutateFace(f => ({ ...f, rows: f.rows.map(r => (r.id === d.id ? { ...r, w: Math.max(60, d.ow + dx), h: Math.max(30, d.oh + dy) } : r)) }), false);
        };
        const up = () => { dragRef.current = null; setDirty(true); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };

    // ── the bill ─────────────────────────────────────────────────────────────────────────────
    const bom = useMemo(() => (draft ? boardBom(draft, finishList) : { parts: [], chips: [], extras: [] }), [draft, finishList]);
    const order = useMemo(() => orderBom(bom, boards), [bom, boards]);
    const copyCsv = async () => { try { await navigator.clipboard.writeText(bomCsv(bom, boards)); alert(`Copied the bill for ${boards} board(s) as CSV.`); } catch { alert('Copy failed — click the page first, then try again.'); } };

    const cartLines = Array.isArray(cart) ? cart : [];

    // ── the list ─────────────────────────────────────────────────────────────────────────────
    if (!draft) {
        return (
            <div style={{ padding: '30px', fontFamily: 'var(--sans)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
                    <div>
                        <span style={mono}>5. Marketing</span>
                        <h2 style={{ margin: '4px 0 0', fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Sales Display Designer</h2>
                        <div style={{ color: 'var(--ink-soft)', fontSize: '0.88rem', marginTop: '6px', maxWidth: '760px' }}>A display is one or two boards. Configure each product row in CPQ and add it to the cart, then place it here; the chip board lays itself out from the finish list. The bill of one board is computed from the rows, never typed.</div>
                    </div>
                    <div style={{ display: 'flex' }}>
                        <button onClick={() => setView('DESIGNS')} style={btn(view === 'DESIGNS')}>Designs</button>
                        <button onClick={() => setView('BUILDS')} style={btn(view === 'BUILDS', { borderLeft: 'none' })}>Build orders</button>
                    </div>
                    {view === 'DESIGNS' && <button onClick={() => seedFileRef.current?.click()} disabled={!!busy} style={btn(false)} title="Read a display tracker workbook (Position on Board · Item # · Qty Needed · finish · notes) and create the display from it — every row a labelled box until you replace it from the CPQ cart">⬆ Seed from tracker</button>}
                    {view === 'DESIGNS' && <button onClick={() => setNewForm({ name: '', style: 'TABLETOP' })} style={btn(true)}>+ New display</button>}
                    <input ref={seedFileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; onSeedFile(f); }} />
                </div>
                {busy && <div style={{ ...mono, color: 'var(--brass)', marginBottom: '10px' }}>{busy}</div>}
                {seed && seed.parsed && (
                    <div onClick={() => setSeed(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,.72)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px' }}>
                        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '980px', maxWidth: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--line)' }}>
                            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem' }}>Seed from tracker — what it would create</div>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' }}>
                                    <select value={seed.tabIx} onChange={e => { const s = { ...seed, tabIx: Number(e.target.value) }; s.boards = /wall/i.test(s.sheets[s.tabIx]?.name || '') ? 35 : 50; setSeed(s); parseSeed(s); }} style={inp}>{seed.sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select>
                                    <span style={mono}>Qty Needed is for</span>
                                    <input type="number" min="1" value={seed.boards} onChange={e => setSeed({ ...seed, boards: Math.max(1, parseInt(e.target.value) || 1) })} onBlur={() => parseSeed(seed)} style={{ ...inp, width: '70px' }} />
                                    <span style={mono}>boards</span>
                                    <input value={seed.name} onChange={e => setSeed({ ...seed, name: e.target.value })} placeholder={seed.parsed.name} style={{ ...inp, width: '260px' }} />
                                    <span style={{ flex: 1 }} />
                                    <span style={mono}>{seed.parsed.rows.length} rows · {seed.parsed.rows.reduce((s, r) => s + r.lines.length, 0)} lines · {Object.keys(seed.resolved).length} codes in the library{seed.missing.length ? ` · ${seed.missing.length} NOT` : ''}</span>
                                </div>
                            </div>
                            <div style={{ padding: '14px 24px', overflowY: 'auto' }}>
                                {seed.missing.length > 0 && <div style={{ background: 'rgba(176,45,32,.06)', border: '1px solid #b02d20', padding: '8px 12px', marginBottom: '10px', fontSize: '0.84rem' }}><b>Not in the library</b> (kept as typed — their lines still count, but a build order cannot match them to stock): <span style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{seed.missing.join(' · ')}</span></div>}
                                {seed.parsed.warnings.length > 0 && <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '8px 12px', marginBottom: '10px', fontSize: '0.84rem' }}>{seed.parsed.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead><tr>{['Row', 'Per board', 'Item', 'Description', 'Finish', 'Cut'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                                    <tbody>
                                        {seed.parsed.rows.flatMap(r => r.lines.map((l, i) => (
                                            <tr key={r.label + i}>
                                                <td style={{ ...td, ...mono }}>{i === 0 ? r.label : ''}</td>
                                                <td style={{ ...td, textAlign: 'right' }}>{l.qty}</td>
                                                <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '11px', color: seed.resolved[l.code] ? 'var(--ink)' : '#b02d20' }}>{l.code}</td>
                                                <td style={td}>{l.name || seed.resolved[l.code]?.name || ''}</td>
                                                <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.finishCode || '—'}</td>
                                                <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.perFoot ? `${l.cutLength}" · ${l.feet} ft` : ''}</td>
                                            </tr>
                                        )))}
                                        {seed.parsed.extras.map((x, i) => <tr key={'x' + i}><td style={{ ...td, ...mono }}>Board</td><td style={{ ...td, textAlign: 'right' }}>{x.qty}</td><td style={td} /><td style={td}>{x.text}</td><td style={td} /><td style={td} /></tr>)}
                                    </tbody>
                                </table>
                            </div>
                            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line)', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                <button onClick={() => setSeed(null)} style={btn(false)}>Cancel</button>
                                <button onClick={createFromSeed} disabled={!!busy} style={btn(true)}>Create display →</button>
                            </div>
                        </div>
                    </div>
                )}
                {view === 'BUILDS' && <DisplayBuildsPanel currentUser={currentUser} activeBrand={activeBrand} />}
                {view === 'DESIGNS' && newForm && (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '14px', border: '1px solid var(--line)', background: '#fff', marginBottom: '18px', flexWrap: 'wrap' }}>
                        <input autoFocus value={newForm.name} onChange={e => setNewForm({ ...newForm, name: e.target.value })} placeholder="Display name, e.g. Fabricut H1 Tabletop" style={{ ...inp, width: '320px' }} />
                        <select value={newForm.style} onChange={e => setNewForm({ ...newForm, style: e.target.value })} style={inp}>
                            {Object.entries(DISPLAY_STYLES).map(([k, s]) => <option key={k} value={k}>{s.label} — {s.faces.map(f => f.label).join(' + ')}</option>)}
                        </select>
                        <button onClick={create} style={btn(true)}>Create</button>
                        <button onClick={() => setNewForm(null)} style={btn(false)}>Cancel</button>
                    </div>
                )}
                {view === 'DESIGNS' && <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', border: '1px solid var(--line)' }}>
                    <thead><tr>{['Display', 'Style', 'Faces', 'Rows', 'Updated', ''].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                        {displays.length === 0 && <tr><td colSpan={6} style={{ ...td, padding: '28px', textAlign: 'center', fontStyle: 'italic', color: 'var(--ink-soft)' }}>No displays yet — create the first one.</td></tr>}
                        {displays.map(d => (
                            <tr key={d.id}>
                                <td style={{ ...td, fontFamily: 'var(--serif)', fontSize: '1.05rem' }}><span onClick={() => open(d)} style={{ cursor: 'pointer', textDecoration: 'underline' }}>{d.name}</span></td>
                                <td style={td}>{DISPLAY_STYLES[d.style]?.label || d.style}</td>
                                <td style={td}>{(d.faces || []).map(f => `${f.label || f.key} ${f.widthIn}×${f.heightIn}"`).join(' · ')}</td>
                                <td style={td}>{(d.faces || []).reduce((n, f) => n + (f.rows || []).length, 0)}</td>
                                <td style={{ ...td, ...mono }}>{d.updatedAt ? new Date(d.updatedAt).toLocaleString() : ''}{d.updatedBy ? ` · ${d.updatedBy}` : ''}</td>
                                <td style={{ ...td, textAlign: 'right' }}><button onClick={() => open(d)} style={btn(false)}>Open</button> <button onClick={() => remove(d)} style={btn(false, { color: '#b02d20', borderColor: '#b02d20' })}>Delete</button></td>
                            </tr>
                        ))}
                    </tbody>
                </table>}
            </div>
        );
    }

    // ── the editor ───────────────────────────────────────────────────────────────────────────
    const W = (face?.widthIn || 24) * UNITS_PER_INCH, H = (face?.heightIn || 24) * UNITS_PER_INCH;
    const chipLayout = face?.kind === 'CHIPS' ? chipFaceLayout(chips, { widthIn: face.widthIn, heightIn: face.heightIn }) : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'var(--sans)', minHeight: '100vh' }}>
            {/* header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
                <button onClick={close} style={btn(false)}>‹ Displays</button>
                <input value={draft.name || ''} onChange={e => mutate(d => ({ ...d, name: e.target.value }))} style={{ ...inp, fontFamily: 'var(--serif)', fontSize: '1.2rem', width: '340px' }} />
                <span style={mono}>{DISPLAY_STYLES[draft.style]?.label || draft.style}</span>
                <span style={{ flex: 1 }} />
                {busy && <span style={{ ...mono, color: 'var(--brass)' }}>{busy}</span>}
                <span style={{ ...mono, color: dirty ? '#b02d20' : 'var(--ink-soft)' }}>{dirty ? 'unsaved' : 'saved'}</span>
                <button onClick={save} disabled={!dirty || !!busy} style={btn(dirty, { opacity: dirty ? 1 : .5 })}>Save display</button>
            </div>

            <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                {/* left: faces + rows + extras */}
                <div style={{ width: '300px', borderRight: '1px solid var(--line)', background: '#fff', overflowY: 'auto', padding: '16px' }}>
                    <div style={mono}>Faces</div>
                    {(draft.faces || []).map((f, i) => (
                        <div key={f.key} onClick={() => setFaceIx(i)} style={{ padding: '10px 12px', margin: '8px 0', border: `1px solid ${i === faceIx ? 'var(--brass)' : 'var(--line)'}`, background: i === faceIx ? 'var(--paper-2)' : '#fff', cursor: 'pointer' }}>
                            <div style={{ fontFamily: 'var(--serif)', fontSize: '1rem' }}>{f.label || f.key}</div>
                            <div style={{ ...mono, marginTop: '4px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <input type="number" min="6" max="96" step="0.5" value={f.widthIn} onClick={e => e.stopPropagation()} onChange={e => mutate(d => ({ ...d, faces: d.faces.map((x, j) => (j === i ? { ...x, widthIn: Number(e.target.value) || x.widthIn } : x)) }))} style={{ ...inp, width: '58px', padding: '3px 6px', fontSize: '0.8rem' }} />
                                ×
                                <input type="number" min="6" max="96" step="0.5" value={f.heightIn} onClick={e => e.stopPropagation()} onChange={e => mutate(d => ({ ...d, faces: d.faces.map((x, j) => (j === i ? { ...x, heightIn: Number(e.target.value) || x.heightIn } : x)) }))} style={{ ...inp, width: '58px', padding: '3px 6px', fontSize: '0.8rem' }} />
                                in · {f.kind === 'CHIPS' ? `${chips.length} chips` : `${(f.rows || []).length} rows`}
                            </div>
                        </div>
                    ))}

                    {face?.kind === 'ROWS' && (
                        <>
                            <div style={{ ...mono, marginTop: '18px' }}>Rows on this face</div>
                            {(face.rows || []).length === 0 && <div style={{ fontSize: '0.84rem', color: 'var(--ink-soft)', fontStyle: 'italic', margin: '8px 0' }}>None yet — add one from the cart on the right.</div>}
                            {(face.rows || []).map(r => (
                                <div key={r.id} style={{ padding: '8px 10px', margin: '6px 0', border: '1px solid var(--line)' }}>
                                    <input value={r.label} onChange={e => mutateFace(f => ({ ...f, rows: f.rows.map(x => (x.id === r.id ? { ...x, label: e.target.value } : x)) }))} style={{ ...inp, width: '100%', padding: '4px 6px', fontSize: '0.85rem' }} />
                                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '4px' }}>{r.config?.assemblyName}{r.config?.lengthInches ? ` · ${r.config.lengthInches}"` : ''}{r.config?.finishLabel ? ` · ${r.config.finishLabel}` : ''}</div>
                                    <div style={{ ...mono, marginTop: '4px' }}>{(r.config?.lines || []).filter(l => !l.hidden && !l.noNs).length} lines · <span onClick={() => mutateFace(f => ({ ...f, rows: f.rows.filter(x => x.id !== r.id) }))} style={{ color: '#b02d20', cursor: 'pointer' }}>remove</span></div>
                                </div>
                            ))}
                        </>
                    )}

                    <div style={{ ...mono, marginTop: '18px' }}>Board extras (base, panel, hardware)</div>
                    {(draft.extras || []).map((x, i) => (
                        <div key={i} style={{ display: 'flex', gap: '6px', margin: '6px 0' }}>
                            <input value={x.text} onChange={e => mutate(d => ({ ...d, extras: d.extras.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) }))} placeholder="e.g. Walnut base 24 × 6" style={{ ...inp, flex: 1, padding: '4px 6px', fontSize: '0.85rem' }} />
                            <input type="number" min="1" value={x.qty} onChange={e => mutate(d => ({ ...d, extras: d.extras.map((y, j) => (j === i ? { ...y, qty: Number(e.target.value) || 1 } : y)) }))} style={{ ...inp, width: '54px', padding: '4px 6px', fontSize: '0.85rem' }} />
                            <button onClick={() => mutate(d => ({ ...d, extras: d.extras.filter((_, j) => j !== i) }))} style={btn(false, { padding: '4px 8px' })}>×</button>
                        </div>
                    ))}
                    <button onClick={() => mutate(d => ({ ...d, extras: [...(d.extras || []), { text: '', qty: 1 }] }))} style={btn(false, { marginTop: '6px' })}>+ Extra</button>
                </div>

                {/* centre: the board */}
                <div style={{ flex: 1, overflow: 'auto', padding: '22px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                    <div style={mono}>{face?.label} · {face?.widthIn}" × {face?.heightIn}" · drawn to scale{chipLayout?.overflow ? ' · ⚠ the chips do not fit this height' : ''}</div>
                    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ background: '#fff', boxShadow: '0 3px 18px rgba(0,0,0,0.14)', width: `min(100%, ${Math.round(760 * (W / Math.max(W, H)))}px)`, height: 'auto', touchAction: 'none' }}>
                        <rect x="0" y="0" width={W} height={H} fill="#fbfaf7" stroke="var(--line)" />
                        {face?.kind === 'ROWS' && (face.rows || []).map(r => (
                            <g key={r.id}>
                                {r.imageUrl
                                    ? <image href={r.hiResUrl || r.imageUrl} x={r.x} y={r.y} width={r.w} height={r.h} preserveAspectRatio="xMidYMid meet" onPointerDown={e => startDrag(e, 'move', r.id, { ox: r.x, oy: r.y })} style={{ cursor: 'move' }} />
                                    : <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="var(--paper-2)" stroke="var(--line)" onPointerDown={e => startDrag(e, 'move', r.id, { ox: r.x, oy: r.y })} style={{ cursor: 'move' }} />}
                                <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="var(--brass)" strokeWidth="2" strokeDasharray="8 5" style={{ pointerEvents: 'none' }} />
                                <text x={r.x + 10} y={r.y - 8} fontSize={Math.round(UNITS_PER_INCH * 0.18)} fontFamily="var(--mono)" fill="var(--ink-soft)" style={{ pointerEvents: 'none' }}>{r.label} — {r.config?.assemblyName}{r.config?.finishLabel ? ` · ${r.config.finishLabel}` : ''}</text>
                                <rect x={r.x + r.w - 18} y={r.y + r.h - 18} width="36" height="36" fill="var(--brass)" stroke="#fff" strokeWidth="2" onPointerDown={e => startDrag(e, 'resize', r.id, { ow: r.w, oh: r.h })} style={{ cursor: 'nwse-resize' }} />
                            </g>
                        ))}
                        {chipLayout && (
                            <g>
                                {chipLayout.headers.map(h => <text key={h.group} x={h.x} y={h.y} textAnchor="middle" fontSize={Math.round(UNITS_PER_INCH * 0.26)} fontFamily="var(--serif)" fill="var(--ink-soft)" letterSpacing="4">{h.group}</text>)}
                                {chipLayout.chips.map(c => (
                                    <g key={c.code}>
                                        {c.textureUrl
                                            ? <image href={c.textureUrl} x={c.x} y={c.y} width={c.w} height={c.h} preserveAspectRatio="xMidYMid slice" />
                                            : <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="10" fill={c.material === 'WOOD' ? '#d9c39a' : '#4a4a4a'} />}
                                        <circle cx={c.x + 18} cy={c.y + 18} r="6" fill="#fff" opacity=".8" />
                                        <text x={c.x + c.w / 2} y={c.y + c.h + Math.round(UNITS_PER_INCH * 0.24)} textAnchor="middle" fontSize={Math.round(UNITS_PER_INCH * 0.14)} fontFamily="var(--mono)" fill="var(--ink-soft)">{String(c.name).toUpperCase()}</text>
                                    </g>
                                ))}
                            </g>
                        )}
                    </svg>
                </div>

                {/* right: the cart + the bill */}
                <div style={{ width: '420px', borderLeft: '1px solid var(--line)', background: '#fff', overflowY: 'auto', padding: '16px' }}>
                    <div style={mono}>Add a row from the CPQ cart</div>
                    {cartLines.length === 0 && <div style={{ fontSize: '0.84rem', color: 'var(--ink-soft)', fontStyle: 'italic', margin: '8px 0 14px' }}>The cart is empty. Configure the row on 8. CPQ Configurator, Add configuration, and come back — the cart travels between tabs.</div>}
                    {cartLines.map(it => (
                        <div key={it.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '8px 10px', margin: '6px 0', border: '1px solid var(--line)' }}>
                            {it.renderSnapshot ? <img src={it.renderSnapshot} alt="" style={{ width: '64px', height: '40px', objectFit: 'contain', background: 'var(--paper-2)' }} /> : <div style={{ width: '64px', height: '40px', background: 'var(--paper-2)' }} />}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.88rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.assemblyName || it.name || 'Configured item'}</div>
                                <div style={{ ...mono }}>{it.finishLabel || ''}{it.engineConfig?.lengthInches ? ` · ${it.engineConfig.lengthInches}"` : ''}{it.qty > 1 ? ` · qty ${it.qty}` : ''}</div>
                            </div>
                            <button onClick={() => addRowFromCart(it)} disabled={!!busy || face?.kind !== 'ROWS'} style={btn(false)}>Place</button>
                        </div>
                    ))}

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginTop: '22px' }}>
                        <div style={mono}>Bill of one board</div>
                        <span style={{ flex: 1 }} />
                        <span style={mono}>×</span>
                        <input type="number" min="1" value={boards} onChange={e => setBoards(Math.max(1, parseInt(e.target.value) || 1))} style={{ ...inp, width: '64px', padding: '4px 6px' }} title="Preview the bill for this many boards — nothing is written" />
                        <button onClick={copyCsv} style={btn(false)}>Copy CSV</button>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '8px' }}>
                        <thead><tr>{['Position', 'Item', 'Qty', 'Feet', 'Finish'].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                        <tbody>
                            {order.parts.map((l, i) => (
                                <tr key={i}>
                                    <td style={{ ...td, ...mono }}>{(l.rows || []).join(' / ')}</td>
                                    <td style={td}><span style={{ fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.code}</span><div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>{l.name}</div></td>
                                    <td style={{ ...td, textAlign: 'right' }}>{l.qty}</td>
                                    <td style={{ ...td, textAlign: 'right' }}>{l.perFoot ? l.feet : ''}</td>
                                    <td style={{ ...td, fontFamily: 'var(--mono)', fontSize: '11px' }}>{l.finishCode}</td>
                                </tr>
                            ))}
                            {order.chips.length > 0 && <tr><td colSpan={5} style={{ ...td, ...mono, background: 'var(--paper-2)' }}>Sample chips — one of every finish per chip face ({order.chips.length} finishes × {order.boards})</td></tr>}
                            {order.extras.map((x, i) => (
                                <tr key={'x' + i}><td style={{ ...td, ...mono }}>Board</td><td style={td}>{x.text}</td><td style={{ ...td, textAlign: 'right' }}>{x.qty}</td><td style={td} /><td style={td} /></tr>
                            ))}
                            {order.parts.length === 0 && order.extras.length === 0 && <tr><td colSpan={5} style={{ ...td, fontStyle: 'italic', color: 'var(--ink-soft)' }}>No rows placed yet.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default DisplayDesignerTab;
