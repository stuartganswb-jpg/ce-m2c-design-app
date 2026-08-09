import React, { useState, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { collection, addDoc, updateDoc, doc, onSnapshot, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
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

const AppImprovementTab = ({ currentUser, currentApp, canManage }) => {
    const [tabScope, setTabScope] = useState('EXISTING');       // EXISTING | NEW
    const [section, setSection] = useState(SECTIONS.includes(currentApp) ? currentApp : 'OTHER');
    const [tabRef, setTabRef] = useState('');
    const [issueType, setIssueType] = useState('APP_ERROR');
    const [comments, setComments] = useState('');
    const [nsFields, setNsFields] = useState('');
    const [shots, setShots] = useState([]);                     // [{ file, preview }]
    const [submitting, setSubmitting] = useState(false);
    const [flash, setFlash] = useState('');
    const [entries, setEntries] = useState([]);
    const [showResolved, setShowResolved] = useState(false);

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
                screenshots,
                status: 'NEW',
            });
            setTabRef(''); setComments(''); setNsFields(''); setShots([]); setTabScope('EXISTING'); setIssueType('APP_ERROR');
            setFlash('Thank you — your report was submitted.');
            setTimeout(() => setFlash(''), 5000);
        } catch (e) {
            console.error('app feedback submit failed', e);
            alert('Submit failed: ' + (e.message || e));
        }
        setSubmitting(false);
    };

    const setStatus = (entry, status) => updateDoc(doc(db, 'system', 'app_feedback', 'entries', entry.id), { status, statusBy: currentUser || '', statusAt: serverTimestamp() }).catch(e => alert('Update failed: ' + (e.message || e)));

    const visibleEntries = entries.filter(en => showResolved || en.status !== 'RESOLVED');
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
                            <textarea value={nsFields} onChange={e => setNsFields(e.target.value)} rows={2} placeholder='e.g. Item record → "Sync to CPQ" checkbox (custitem_sync_to_cpq)' style={{ ...inputStyle, resize: 'vertical' }} />
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
                    <div key={en.id} style={{ background: '#fff', border: `1px solid ${theme.line}`, borderLeft: `3px solid ${en.status === 'RESOLVED' ? '#1e8449' : t.color}`, borderRadius: '2px', padding: '14px 18px', marginBottom: '10px', opacity: en.status === 'RESOLVED' ? 0.65 : 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '6px' }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: '#fff', background: t.color, padding: '3px 8px', borderRadius: '2px' }}>{t.label}</span>
                                <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', color: theme.inkSoft, border: `1px solid ${theme.line}`, padding: '2px 7px', borderRadius: '2px' }}>{en.app}</span>
                                <strong style={{ fontSize: '0.9rem', color: theme.ink }}>{en.tabScope === 'NEW' ? `NEW TAB: ${en.tabRef || '(unnamed)'}` : `${en.section ? en.section + ' · ' : ''}${en.tabRef || '(no tab given)'}`}</strong>
                                {en.status === 'RESOLVED' && <span style={{ fontSize: '0.75rem', color: '#1e8449' }}>✓ resolved{en.statusBy ? ` by ${en.statusBy}` : ''}</span>}
                            </div>
                            <span style={{ fontSize: '0.75rem', color: theme.inkSoft }}>{en.user} · {fmtDate(en.t)}</span>
                        </div>
                        <div style={{ fontSize: '0.88rem', color: theme.ink, whiteSpace: 'pre-wrap' }}>{en.comments}</div>
                        {en.nsFields && <div style={{ fontSize: '0.8rem', color: theme.inkSoft, marginTop: '6px' }}><span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase' }}>NS fields:</span> {en.nsFields}</div>}
                        {(en.screenshots || []).length > 0 && (
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                                {en.screenshots.map((s, i) => (
                                    <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.name}>
                                        <img src={s.url} alt={s.name} style={{ height: '70px', border: `1px solid ${theme.line}`, borderRadius: '2px' }} />
                                    </a>
                                ))}
                            </div>
                        )}
                        {canManage && (
                            <div style={{ marginTop: '10px' }}>
                                {en.status !== 'RESOLVED'
                                    ? <button onClick={() => setStatus(en, 'RESOLVED')} style={{ padding: '6px 14px', background: 'transparent', color: '#1e8449', border: '1px solid #1e8449', borderRadius: '2px', cursor: 'pointer', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' }}>Mark Resolved</button>
                                    : <button onClick={() => setStatus(en, 'NEW')} style={{ padding: '6px 14px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, borderRadius: '2px', cursor: 'pointer', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' }}>Reopen</button>}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default AppImprovementTab;
