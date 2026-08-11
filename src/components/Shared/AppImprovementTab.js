import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../../firebase';
import { collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy, limit, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

// APP IMP. — the one place any operator, in any section, reports a bug or asks for an improvement.
// Mounted on Finishing, Shop, WMS and HQ; visible to EVERY role (each host nav force-includes the
// tab, so it never depends on a permission-matrix row nobody remembered to tick).
//
// Entries live at system/app_feedback/entries — a subcollection under the already-open `system`
// match in firestore.rules, so no rules deploy is needed. Screenshots go to Storage under
// app_feedback/ (staff-only bucket).

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

const SECTIONS = ['HQ', 'FINISHING', 'SHOP', 'WMS', 'PORTAL', 'OTHER'];

const ISSUE_TYPES = [
    { id: 'APP_ERROR', label: 'App Error / Bug', color: '#c0392b' },
    { id: 'NETSUITE_ERROR', label: 'NetSuite Error', color: '#8e44ad' },
    { id: 'NEW_FEATURE', label: 'Improvement / New Feature', color: '#2471a3' },
];

const entriesCol = () => collection(db, 'system', 'app_feedback', 'entries');

const labelStyle = { display: 'block', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.15em', textTransform: 'uppercase', color: theme.inkSoft, marginBottom: '6px' };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: `1px solid ${theme.line}`, borderRadius: '2px', fontFamily: theme.sans, fontSize: '0.9rem', color: theme.ink, background: '#fff', outline: 'none' };

// ---------------------------------------------------------------------------
// FLOW SKETCH — a tiny Figma-style box-and-arrow chart for new-feature asks.
// Boxes are draggable, double-click to type inside; Connect mode draws arrows
// box→box. Stored as plain JSON ({boxes, arrows}) on the feedback doc and
// re-rendered read-only (FlowView) in the report list. SVG only, no libs.
// ---------------------------------------------------------------------------
const FLOW_W = 880, FLOW_H = 380, BOX_W = 150, BOX_H = 60;
const EMPTY_FLOW = { boxes: [], arrows: [] };

// Point on the boundary of `from` where the line toward `to`'s center exits —
// so arrows start/end at box edges, not buried under the rectangles.
const edgePoint = (from, to) => {
    const cx = from.x + BOX_W / 2, cy = from.y + BOX_H / 2;
    const dx = (to.x + BOX_W / 2) - cx, dy = (to.y + BOX_H / 2) - cy;
    if (!dx && !dy) return { x: cx, y: cy };
    const s = Math.min((BOX_W / 2) / Math.abs(dx || 1e-6), (BOX_H / 2) / Math.abs(dy || 1e-6));
    return { x: cx + dx * s, y: cy + dy * s };
};

const arrowLines = (flow) => (flow.arrows || []).map((a, i) => {
    const from = (flow.boxes || []).find(b => b.id === a.from);
    const to = (flow.boxes || []).find(b => b.id === a.to);
    if (!from || !to) return null;
    const p1 = edgePoint(from, to), p2 = edgePoint(to, from);
    return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={theme.inkSoft} strokeWidth="1.5" markerEnd="url(#aiArrowHead)" />;
});

const flowDefs = (
    <defs>
        <marker id="aiArrowHead" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
            <polygon points="0 0, 9 3.5, 0 7" fill={theme.inkSoft} />
        </marker>
    </defs>
);

const boxText = (b, extra) => (
    <foreignObject x={b.x} y={b.y} width={BOX_W} height={BOX_H} style={{ pointerEvents: 'none' }}>
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', padding: '4px 8px', fontFamily: theme.sans, fontSize: '11px', color: theme.ink, textAlign: 'center', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'hidden', ...extra }}>
            {b.text || ''}
        </div>
    </foreignObject>
);

const FlowSketch = ({ flow, setFlow }) => {
    const [selected, setSelected] = useState(null);
    const [editing, setEditing] = useState(null);
    const [mode, setMode] = useState('MOVE');       // MOVE | CONNECT
    const [connectFrom, setConnectFrom] = useState(null);
    const dragRef = useRef(null);                    // { id, dx, dy }
    const svgRef = useRef(null);

    const boxes = flow.boxes || [], arrows = flow.arrows || [];
    const upd = (patch) => setFlow({ boxes, arrows, ...patch });

    const svgPoint = (e) => {
        const r = svgRef.current.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const addBox = () => {
        const id = 'b' + Date.now() + '_' + boxes.length;
        const i = boxes.length;
        upd({ boxes: [...boxes, { id, x: 30 + (i % 4) * (BOX_W + 55), y: 30 + Math.floor(i / 4) * (BOX_H + 55), text: '' }] });
        setSelected(id); setEditing(id);
    };

    const boxDown = (e, b) => {
        e.stopPropagation();
        if (editing && editing !== b.id) setEditing(null);
        if (mode === 'CONNECT') {
            if (!connectFrom) { setConnectFrom(b.id); setSelected(b.id); return; }
            if (connectFrom !== b.id && !arrows.some(a => a.from === connectFrom && a.to === b.id)) {
                upd({ arrows: [...arrows, { from: connectFrom, to: b.id }] });
            }
            setConnectFrom(null); setSelected(null);
            return;
        }
        setSelected(b.id);
        const p = svgPoint(e);
        dragRef.current = { id: b.id, dx: p.x - b.x, dy: p.y - b.y };
    };

    const move = (e) => {
        if (!dragRef.current) return;
        const p = svgPoint(e);
        const x = Math.max(0, Math.min(FLOW_W - BOX_W, p.x - dragRef.current.dx));
        const y = Math.max(0, Math.min(FLOW_H - BOX_H, p.y - dragRef.current.dy));
        upd({ boxes: boxes.map(b => b.id === dragRef.current.id ? { ...b, x, y } : b) });
    };

    const setText = (id, text) => upd({ boxes: boxes.map(b => b.id === id ? { ...b, text } : b) });
    const deleteSelected = () => {
        if (!selected) return;
        upd({ boxes: boxes.filter(b => b.id !== selected), arrows: arrows.filter(a => a.from !== selected && a.to !== selected) });
        setSelected(null); setEditing(null); setConnectFrom(null);
    };

    const toolBtn = (active) => ({ padding: '6px 12px', cursor: 'pointer', borderRadius: '2px', border: `1px solid ${active ? theme.brass : theme.line}`, background: active ? theme.brass : '#fff', color: active ? '#fff' : theme.inkSoft, fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' });

    return (
        <div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '8px' }}>
                <button type="button" onClick={addBox} style={toolBtn(false)}>+ Add Box</button>
                <button type="button" onClick={() => { setMode(m => m === 'CONNECT' ? 'MOVE' : 'CONNECT'); setConnectFrom(null); }} style={toolBtn(mode === 'CONNECT')}>{mode === 'CONNECT' ? (connectFrom ? 'Now click the target box…' : 'Connect: click first box…') : '→ Connect Boxes'}</button>
                <button type="button" onClick={deleteSelected} disabled={!selected} style={{ ...toolBtn(false), opacity: selected ? 1 : 0.4, cursor: selected ? 'pointer' : 'default' }}>Delete Selected</button>
                <button type="button" onClick={() => { setFlow(EMPTY_FLOW); setSelected(null); setEditing(null); setConnectFrom(null); }} disabled={!boxes.length} style={{ ...toolBtn(false), opacity: boxes.length ? 1 : 0.4 }}>Clear</button>
                <span style={{ fontSize: '0.75rem', color: theme.inkSoft, fontStyle: 'italic' }}>Drag boxes to move · double-click a box to type inside it</span>
            </div>
            <div style={{ border: `1px solid ${theme.line}`, borderRadius: '2px', background: theme.paper, overflowX: 'auto' }}>
                <svg ref={svgRef} width={FLOW_W} height={FLOW_H} style={{ display: 'block', touchAction: 'none' }}
                    onPointerMove={move} onPointerUp={() => { dragRef.current = null; }} onPointerLeave={() => { dragRef.current = null; }}
                    onPointerDown={() => { setSelected(null); setEditing(null); if (mode === 'CONNECT') setConnectFrom(null); }}>
                    {flowDefs}
                    {arrowLines(flow)}
                    {boxes.map(b => (
                        <g key={b.id} onPointerDown={(e) => boxDown(e, b)} onDoubleClick={(e) => { e.stopPropagation(); setEditing(b.id); setSelected(b.id); }} style={{ cursor: mode === 'CONNECT' ? 'crosshair' : 'move' }}>
                            <rect x={b.x} y={b.y} width={BOX_W} height={BOX_H} rx="6" fill="#fff"
                                stroke={connectFrom === b.id ? theme.brass : (selected === b.id ? theme.brass : theme.ink)}
                                strokeWidth={selected === b.id || connectFrom === b.id ? 2 : 1} />
                            {editing === b.id ? (
                                <foreignObject x={b.x} y={b.y} width={BOX_W} height={BOX_H}>
                                    <textarea autoFocus value={b.text} placeholder="type here…"
                                        onChange={e => setText(b.id, e.target.value)}
                                        onBlur={() => setEditing(null)}
                                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setEditing(null); } }}
                                        onPointerDown={e => e.stopPropagation()}
                                        style={{ width: '100%', height: '100%', boxSizing: 'border-box', border: 'none', outline: 'none', resize: 'none', background: 'transparent', fontFamily: theme.sans, fontSize: '11px', color: theme.ink, textAlign: 'center', padding: '4px 8px' }} />
                                </foreignObject>
                            ) : boxText(b)}
                        </g>
                    ))}
                    {boxes.length === 0 && (
                        <text x={FLOW_W / 2} y={FLOW_H / 2} textAnchor="middle" fill={theme.inkSoft} fontFamily={theme.sans} fontSize="13" fontStyle="italic">
                            Optional: sketch the flow — “+ Add Box” for each step, then “→ Connect Boxes”.
                        </text>
                    )}
                </svg>
            </div>
        </div>
    );
};

// Read-only rendering of a saved sketch, scaled down for the report list.
const FlowView = ({ flow }) => {
    const boxes = flow?.boxes || [];
    if (!boxes.length) return null;
    const maxX = Math.max(...boxes.map(b => b.x)) + BOX_W + 20;
    const maxY = Math.max(...boxes.map(b => b.y)) + BOX_H + 20;
    return (
        <div style={{ marginTop: '10px', border: `1px solid ${theme.line}`, borderRadius: '2px', background: theme.paper, overflowX: 'auto', maxWidth: '100%' }}>
            <svg viewBox={`0 0 ${maxX} ${maxY}`} width={Math.min(maxX, 560)} style={{ display: 'block' }}>
                {flowDefs}
                {arrowLines(flow)}
                {boxes.map(b => (
                    <g key={b.id}>
                        <rect x={b.x} y={b.y} width={BOX_W} height={BOX_H} rx="6" fill="#fff" stroke={theme.ink} strokeWidth="1" />
                        {boxText(b)}
                    </g>
                ))}
            </svg>
        </div>
    );
};

const AppImprovementTab = ({ currentUser, currentApp, canManage }) => {
    const [tabScope, setTabScope] = useState('EXISTING');       // EXISTING | NEW
    const [section, setSection] = useState(SECTIONS.includes(currentApp) ? currentApp : 'OTHER');
    const [tabRef, setTabRef] = useState('');
    const [issueType, setIssueType] = useState('APP_ERROR');
    const [comments, setComments] = useState('');
    const [nsFields, setNsFields] = useState('');
    const [steps, setSteps] = useState('');          // new-feature: step-by-step behavior
    const [flow, setFlow] = useState(EMPTY_FLOW);    // new-feature: box/arrow sketch
    const [shots, setShots] = useState([]);                     // [{ file, preview }]
    const [submitting, setSubmitting] = useState(false);
    const [flash, setFlash] = useState('');
    const [entries, setEntries] = useState([]);
    const [showResolved, setShowResolved] = useState(false);
    // The resolve → test → verify loop (Stuart 2026-08-11): admins write an EXPLANATION with the
    // resolve; the reporter marks it tested (VERIFIED) or fails it back open with details.
    const [noteDrafts, setNoteDrafts] = useState({});     // entryId -> resolution note draft
    const [reopenDrafts, setReopenDrafts] = useState({}); // entryId -> failure-details draft (undefined = box hidden)

    useEffect(() => {
        const q = query(entriesCol(), orderBy('t', 'desc'), limit(150));
        const unsub = onSnapshot(q, snap => setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
            err => console.warn('app_feedback listen failed', err));
        return () => unsub();
    }, []);

    useEffect(() => () => shots.forEach(s => URL.revokeObjectURL(s.preview)), [shots]);

    const addFiles = (fileList) => {
        const imgs = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
        if (!imgs.length) return;
        setShots(prev => [...prev, ...imgs.map(f => ({ file: f, preview: URL.createObjectURL(f) }))]);
    };

    // Screenshots can be pasted straight from the clipboard (⌘V / Ctrl+V anywhere on the form) —
    // that IS the expected path for NetSuite error captures.
    const onPaste = (e) => {
        const items = Array.from(e.clipboardData?.items || []).filter(i => i.type.startsWith('image/'));
        if (!items.length) return;
        addFiles(items.map(i => i.getAsFile()).filter(Boolean));
    };

    const removeShot = (idx) => setShots(prev => { URL.revokeObjectURL(prev[idx].preview); return prev.filter((_, i) => i !== idx); });

    const submit = async () => {
        if (!comments.trim()) { alert('Please describe the bug or improvement in the comments box.'); return; }
        if (tabScope === 'EXISTING' && !tabRef.trim()) { alert('Please enter which tab this refers to.'); return; }
        if (issueType === 'NETSUITE_ERROR' && !shots.length && !window.confirm('No screenshot attached. For NetSuite errors a screenshot of the error message is strongly recommended. Submit anyway?')) return;
        setSubmitting(true);
        try {
            const screenshots = [];
            for (let i = 0; i < shots.length; i++) {
                const f = shots[i].file;
                const safeName = String(f.name || 'screenshot.png').replace(/[^a-zA-Z0-9._-]/g, '_');
                const sref = ref(storage, `app_feedback/${Date.now()}_${i}_${safeName}`);
                await new Promise((res, rej) => { const task = uploadBytesResumable(sref, f); task.on('state_changed', null, rej, res); });
                screenshots.push({ url: await getDownloadURL(sref), name: safeName });
            }
            await addDoc(entriesCol(), {
                t: serverTimestamp(),
                user: currentUser || 'Unknown',
                app: currentApp || 'UNKNOWN',
                tabScope,                                       // EXISTING | NEW
                section: tabScope === 'EXISTING' ? section : '',
                tabRef: tabRef.trim(),                          // which tab / proposed new tab name
                issueType,
                comments: comments.trim(),
                nsFields: nsFields.trim(),                      // NetSuite fields & IDs (new-feature asks)
                steps: issueType === 'NEW_FEATURE' ? steps.trim() : '',
                flow: issueType === 'NEW_FEATURE' && (flow.boxes || []).length ? flow : null,
                screenshots,
                status: 'NEW',
            });
            setTabRef(''); setComments(''); setNsFields(''); setSteps(''); setFlow(EMPTY_FLOW); setShots([]); setTabScope('EXISTING'); setIssueType('APP_ERROR');
            setFlash('Thank you — your report was submitted.');
            setTimeout(() => setFlash(''), 5000);
        } catch (e) {
            console.error('app feedback submit failed', e);
            alert('Submit failed: ' + (e.message || e));
        }
        setSubmitting(false);
    };

    const setStatus = (entry, status, extra = {}) => updateDoc(doc(db, 'system', 'app_feedback', 'entries', entry.id), { status, statusBy: currentUser || '', statusAt: serverTimestamp(), ...extra }).catch(e => alert('Update failed: ' + (e.message || e)));

    // Reporter marks the fix TESTED — the closed-loop confirmation.
    const markTested = (entry) => setStatus(entry, 'VERIFIED', { testedBy: currentUser || '', testedAt: serverTimestamp() });
    // …or FAILS it back open, with the details appended to the report's history.
    const reopenFailed = (entry) => {
        const note = String(reopenDrafts[entry.id] || '').trim();
        if (!note) return alert('Describe what failed — that detail is the whole point of reopening.');
        setStatus(entry, 'REOPENED', { reopens: arrayUnion({ note, by: currentUser || '', at: Date.now() }) });
        setReopenDrafts(d => { const n = { ...d }; delete n[entry.id]; return n; });
    };

    const visibleEntries = entries.filter(en => showResolved || !['RESOLVED', 'VERIFIED'].includes(en.status));
    const typeOf = (id) => ISSUE_TYPES.find(t => t.id === id) || { label: id, color: theme.inkSoft };
    const fmtDate = (t) => { try { return t?.toDate ? t.toDate().toLocaleString() : ''; } catch (e) { return ''; } };

    return (
        <div style={{ padding: '30px', fontFamily: theme.sans, maxWidth: '1100px', margin: '0 auto' }} onPaste={onPaste}>
            <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.25em', textTransform: 'uppercase', color: theme.brass, display: 'block' }}>App Improvements &amp; Bug Reports</span>
            <h2 style={{ fontFamily: theme.serif, fontWeight: 500, fontSize: '1.8rem', color: theme.ink, margin: '6px 0 4px' }}>App Imp.</h2>
            <p style={{ color: theme.inkSoft, fontSize: '0.85rem', margin: '0 0 24px' }}>
                Spotted a bug, a NetSuite error, or something the app should do better? Log it here — include a screenshot whenever you can (you can paste one straight from the clipboard).
            </p>

            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, borderRadius: '2px', padding: '24px', marginBottom: '30px' }}>
                {/* Row 1: new tab vs existing tab + which tab */}
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '18px' }}>
                    <div style={{ minWidth: '220px' }}>
                        <label style={labelStyle}>Is this about a new tab or an existing one?</label>
                        <select value={tabScope} onChange={e => setTabScope(e.target.value)} style={inputStyle}>
                            <option value="EXISTING">An existing tab</option>
                            <option value="NEW">A brand-new tab / screen</option>
                        </select>
                    </div>
                    {tabScope === 'EXISTING' && (
                        <div style={{ minWidth: '160px' }}>
                            <label style={labelStyle}>Which section?</label>
                            <select value={section} onChange={e => setSection(e.target.value)} style={inputStyle}>
                                {SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </div>
                    )}
                    <div style={{ flex: 1, minWidth: '260px' }}>
                        <label style={labelStyle}>{tabScope === 'EXISTING' ? 'Which tab does this refer to?' : 'What should the new tab be called?'}</label>
                        <input value={tabRef} onChange={e => setTabRef(e.target.value)} placeholder={tabScope === 'EXISTING' ? 'e.g. "8. CPQ Configurator", "PICK QUEUE", "Active Floor"' : 'e.g. "Vendor Scorecard"'} style={inputStyle} />
                    </div>
                </div>

                {/* Row 2: error type */}
                <div style={{ marginBottom: '18px' }}>
                    <label style={labelStyle}>What kind of report is this?</label>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {ISSUE_TYPES.map(t => (
                            <button key={t.id} onClick={() => setIssueType(t.id)} style={{ padding: '10px 18px', cursor: 'pointer', borderRadius: '2px', border: issueType === t.id ? `1px solid ${t.color}` : `1px solid ${theme.line}`, background: issueType === t.id ? t.color : '#fff', color: issueType === t.id ? '#fff' : theme.inkSoft, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.12em', textTransform: 'uppercase', transition: 'all 0.15s' }}>
                                {t.label}
                            </button>
                        ))}
                    </div>
                    {issueType === 'NETSUITE_ERROR' && (
                        <div style={{ marginTop: '10px', padding: '12px 14px', background: '#f7f0fa', border: '1px solid #d7bde2', borderRadius: '2px', fontSize: '0.85rem', color: '#6c3483' }}>
                            <strong>NetSuite error:</strong> please paste or attach a screenshot of the NetSuite error message (the full red error text) using the upload below — it is the fastest way for us to trace it.
                        </div>
                    )}
                    {issueType === 'NEW_FEATURE' && (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ padding: '12px 14px', background: '#eef5fb', border: '1px solid #aed6f1', borderRadius: '2px', fontSize: '0.85rem', color: '#1a5276', marginBottom: '10px' }}>
                                <strong>New feature:</strong> if this touches NetSuite, please reference the fields involved and their field IDs (e.g. <code style={{ fontFamily: theme.mono }}>custitem27</code>, <code style={{ fontFamily: theme.mono }}>custbody_xyz</code>) in the box below.
                            </div>
                            <label style={labelStyle}>NetSuite fields &amp; field IDs affected (if any)</label>
                            <textarea value={nsFields} onChange={e => setNsFields(e.target.value)} rows={2} placeholder='e.g. Item record → "Sync to CPQ" checkbox (custitem_sync_to_cpq)' style={{ ...inputStyle, resize: 'vertical', marginBottom: '14px' }} />

                            <label style={labelStyle}>Step by step — how should the new page work?</label>
                            <textarea value={steps} onChange={e => setSteps(e.target.value)} rows={5}
                                placeholder={'Walk through it one action at a time, e.g.\n1. Operator opens the tab and scans the work order\n2. The app shows…\n3. Operator clicks…\n4. NetSuite gets…'}
                                style={{ ...inputStyle, resize: 'vertical', marginBottom: '14px' }} />

                            <label style={labelStyle}>Sketch the flow (optional) — boxes &amp; arrows, type notes inside each box</label>
                            <FlowSketch flow={flow} setFlow={setFlow} />
                        </div>
                    )}
                </div>

                {/* Row 3: comments */}
                <div style={{ marginBottom: '18px' }}>
                    <label style={labelStyle}>Comments — what happened / what should change?</label>
                    <textarea value={comments} onChange={e => setComments(e.target.value)} rows={5} placeholder="Describe the bug or improvement. What were you doing, what did you expect, what happened instead?" style={{ ...inputStyle, resize: 'vertical' }} />
                </div>

                {/* Row 4: screenshots */}
                <div style={{ marginBottom: '22px' }}>
                    <label style={labelStyle}>Screenshots (attach files, or paste from clipboard)</label>
                    <input type="file" accept="image/*" multiple onChange={e => { addFiles(e.target.files); e.target.value = ''; }} style={{ fontSize: '0.85rem', color: theme.inkSoft }} />
                    {shots.length > 0 && (
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '12px' }}>
                            {shots.map((s, i) => (
                                <div key={i} style={{ position: 'relative', border: `1px solid ${theme.line}`, borderRadius: '2px', padding: '4px', background: theme.paper2 }}>
                                    <img src={s.preview} alt={s.file.name} style={{ height: '90px', display: 'block' }} />
                                    <button onClick={() => removeShot(i)} title="Remove" style={{ position: 'absolute', top: '-8px', right: '-8px', width: '20px', height: '20px', borderRadius: '50%', border: 'none', background: theme.ink, color: '#fff', cursor: 'pointer', fontSize: '11px', lineHeight: '20px', padding: 0 }}>×</button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button onClick={submit} disabled={submitting} style={{ padding: '13px 34px', background: submitting ? theme.inkSoft : theme.ink, color: '#fff', border: 'none', borderRadius: '2px', cursor: submitting ? 'default' : 'pointer', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase' }}>
                        {submitting ? 'Submitting…' : 'Submit Report'}
                    </button>
                    {flash && <span style={{ color: '#1e8449', fontSize: '0.9rem' }}>✓ {flash}</span>}
                </div>
            </div>

            {/* Submitted reports — everyone can see the queue (and avoid double-reporting);
                admins can mark items resolved. */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.2em', textTransform: 'uppercase', color: theme.inkSoft }}>Submitted Reports ({visibleEntries.length})</span>
                <label style={{ fontSize: '0.8rem', color: theme.inkSoft, cursor: 'pointer' }}>
                    <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} style={{ marginRight: '6px' }} />
                    Show resolved
                </label>
            </div>
            {visibleEntries.length === 0 && <div style={{ padding: '30px', textAlign: 'center', color: theme.inkSoft, fontStyle: 'italic', border: `1px dashed ${theme.line}` }}>No reports yet.</div>}
            {visibleEntries.map(en => {
                const t = typeOf(en.issueType);
                return (
                    <div key={en.id} style={{ background: '#fff', border: `1px solid ${theme.line}`, borderLeft: `3px solid ${['RESOLVED', 'VERIFIED'].includes(en.status) ? '#1e8449' : (en.status === 'REOPENED' ? '#c0392b' : t.color)}`, borderRadius: '2px', padding: '14px 18px', marginBottom: '10px', opacity: ['RESOLVED', 'VERIFIED'].includes(en.status) ? 0.7 : 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '6px' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: '#fff', background: t.color, padding: '3px 8px', borderRadius: '2px' }}>{t.label}</span>
                                <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: theme.inkSoft, border: `1px solid ${theme.line}`, padding: '2px 7px', borderRadius: '2px' }}>{en.app}</span>
                                <strong style={{ fontSize: '0.9rem', color: theme.ink }}>{en.tabScope === 'NEW' ? `NEW TAB: ${en.tabRef || '(unnamed)'}` : `${en.section ? en.section + ' · ' : ''}${en.tabRef || '(no tab given)'}`}</strong>
                                {en.status === 'RESOLVED' && <span style={{ fontSize: '0.75rem', color: '#1e8449' }}>✓ resolved{en.statusBy ? ` by ${en.statusBy}` : ''} · awaiting test</span>}
                                {en.status === 'VERIFIED' && <span style={{ fontSize: '0.75rem', color: '#1e8449', fontWeight: 600 }}>✓✓ tested & verified{en.testedBy ? ` by ${en.testedBy}` : ''}</span>}
                                {en.status === 'REOPENED' && <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: '#fff', background: '#c0392b', padding: '3px 8px', borderRadius: '2px' }}>Reopened — failed test</span>}
                            </div>
                            <span style={{ fontSize: '0.75rem', color: theme.inkSoft }}>{en.user} · {fmtDate(en.t)}</span>
                        </div>
                        <div style={{ fontSize: '0.88rem', color: theme.ink, whiteSpace: 'pre-wrap' }}>{en.comments}</div>
                        {en.nsFields && <div style={{ fontSize: '0.8rem', color: theme.inkSoft, marginTop: '6px' }}><span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase' }}>NS fields:</span> {en.nsFields}</div>}
                        {en.steps && (
                            <div style={{ marginTop: '8px', padding: '10px 12px', background: theme.paper2, borderRadius: '2px' }}>
                                <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: theme.inkSoft, display: 'block', marginBottom: '4px' }}>Step by step</span>
                                <div style={{ fontSize: '0.83rem', color: theme.ink, whiteSpace: 'pre-wrap' }}>{en.steps}</div>
                            </div>
                        )}
                        {(en.flow?.boxes || []).length > 0 && <FlowView flow={en.flow} />}
                        {(en.screenshots || []).length > 0 && (
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                                {en.screenshots.map((s, i) => (
                                    <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.name}>
                                        <img src={s.url} alt={s.name} style={{ height: '70px', border: `1px solid ${theme.line}`, borderRadius: '2px' }} />
                                    </a>
                                ))}
                            </div>
                        )}
                        {/* RESOLUTION — the explanation travels with the resolve, so the reporter
                            reads WHAT changed before testing it. */}
                        {en.resolutionNote && (
                            <div style={{ marginTop: '10px', padding: '10px 12px', background: '#f0f7f1', border: '1px solid #cfe3d2', borderRadius: '2px' }}>
                                <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: '#1e8449', display: 'block', marginBottom: '4px' }}>Resolution{en.statusBy ? ` — ${en.statusBy}` : ''}</span>
                                <div style={{ fontSize: '0.85rem', color: theme.ink, whiteSpace: 'pre-wrap' }}>{en.resolutionNote}</div>
                            </div>
                        )}
                        {(en.reopens || []).map((r, i) => (
                            <div key={i} style={{ marginTop: '8px', padding: '10px 12px', background: '#fdf3f3', border: '1px solid #e2b8b8', borderRadius: '2px' }}>
                                <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: '#c0392b', display: 'block', marginBottom: '4px' }}>Failed test — {r.by || '?'} · {r.at ? new Date(r.at).toLocaleString() : ''}</span>
                                <div style={{ fontSize: '0.85rem', color: theme.ink, whiteSpace: 'pre-wrap' }}>{r.note}</div>
                            </div>
                        ))}

                        {/* Admin: explanation + resolve. The note saves WITH the resolve; on an
                            already-resolved report it stays editable. */}
                        {canManage && (
                            <div style={{ marginTop: '10px' }}>
                                <textarea value={noteDrafts[en.id] ?? en.resolutionNote ?? ''} onChange={e => setNoteDrafts(d => ({ ...d, [en.id]: e.target.value }))} rows={2}
                                    placeholder="Explanation for the reporter — what changed, how to use it, what to test…"
                                    style={{ ...inputStyle, resize: 'vertical', fontSize: '0.85rem', marginBottom: '6px' }} />
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    {!['RESOLVED', 'VERIFIED'].includes(en.status)
                                        ? <button onClick={() => setStatus(en, 'RESOLVED', { resolutionNote: (noteDrafts[en.id] ?? en.resolutionNote ?? '').trim() })} style={{ padding: '6px 14px', background: 'transparent', color: '#1e8449', border: '1px solid #1e8449', borderRadius: '2px', cursor: 'pointer', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' }}>Mark Resolved (saves note)</button>
                                        : <>
                                            <button onClick={() => updateDoc(doc(db, 'system', 'app_feedback', 'entries', en.id), { resolutionNote: (noteDrafts[en.id] ?? en.resolutionNote ?? '').trim() }).catch(e => alert('Save failed: ' + (e.message || e)))} style={{ padding: '6px 14px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, borderRadius: '2px', cursor: 'pointer', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' }}>Save Note</button>
                                            <button onClick={() => setStatus(en, 'REOPENED', { reopens: arrayUnion({ note: 'Reopened by admin', by: currentUser || '', at: Date.now() }) })} style={{ padding: '6px 14px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, borderRadius: '2px', cursor: 'pointer', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' }}>Reopen</button>
                                        </>}
                                </div>
                            </div>
                        )}

                        {/* Reporter: test the resolution — verify it, or fail it back open with details. */}
                        {en.status === 'RESOLVED' && (
                            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <button onClick={() => markTested(en)} style={{ padding: '8px 16px', background: '#1e8449', color: '#fff', border: 'none', borderRadius: '2px', cursor: 'pointer', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' }}>✓ Tested — it works</button>
                                <button onClick={() => setReopenDrafts(d => ({ ...d, [en.id]: d[en.id] ?? '' }))} style={{ padding: '8px 16px', background: 'transparent', color: '#c0392b', border: '1px solid #c0392b', borderRadius: '2px', cursor: 'pointer', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' }}>✗ Failed — reopen</button>
                            </div>
                        )}
                        {reopenDrafts[en.id] !== undefined && (
                            <div style={{ marginTop: '8px' }}>
                                <textarea value={reopenDrafts[en.id]} onChange={e => setReopenDrafts(d => ({ ...d, [en.id]: e.target.value }))} rows={3} autoFocus
                                    placeholder="What failed? What did you do, what did you expect, what happened instead…"
                                    style={{ ...inputStyle, resize: 'vertical', fontSize: '0.85rem', marginBottom: '6px' }} />
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button onClick={() => reopenFailed(en)} style={{ padding: '8px 16px', background: '#c0392b', color: '#fff', border: 'none', borderRadius: '2px', cursor: 'pointer', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' }}>Reopen Report</button>
                                    <button onClick={() => setReopenDrafts(d => { const n = { ...d }; delete n[en.id]; return n; })} style={{ padding: '8px 16px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, borderRadius: '2px', cursor: 'pointer', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' }}>Cancel</button>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default AppImprovementTab;
