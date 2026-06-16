import React, { useState, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { parseComboName, uploadComboImage } from './comboImages';

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

// Bulk uploader for combined-product photos. Drop images named PATTERN/FINISH_PATTERN/FINISH
// (e.g. H1-138BP-H/EP1_H1-138DE/EP1); each is parsed into its two pieces, previewed, and
// saved to the hidden combo_images store. CPQ checkout pulls the match into the doc roll-up.
const ComboImageUploader = ({ currentUser }) => {
    const [entries, setEntries] = useState([]); // { id, file, previewUrl, name, status, error }
    const [dragActive, setDragActive] = useState(false);
    const [saving, setSaving] = useState(false);

    // Swallow page-level drag/drop so a dropped image never navigates the browser to it.
    useEffect(() => {
        const swallow = (e) => e.preventDefault();
        window.addEventListener('dragover', swallow);
        window.addEventListener('drop', swallow);
        return () => { window.removeEventListener('dragover', swallow); window.removeEventListener('drop', swallow); };
    }, []);
    useEffect(() => () => { entries.forEach(e => e.previewUrl && URL.revokeObjectURL(e.previewUrl)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const addFiles = (fileList) => {
        const files = Array.from(fileList || []).filter(f => f && f.type && f.type.startsWith('image/'));
        if (!files.length) return;
        setEntries(prev => [...prev, ...files.map((f, i) => ({
            id: `${Date.now ? '' : ''}${f.name}-${prev.length + i}-${f.size}`,
            file: f,
            previewUrl: URL.createObjectURL(f),
            name: String(f.name || '').replace(/\.[^.]+$/, ''),
            status: 'pending',
            error: null,
        }))]);
    };

    const setName = (id, val) => setEntries(prev => prev.map(e => e.id === id ? { ...e, name: val, status: e.status === 'error' ? 'pending' : e.status } : e));
    const removeEntry = (id) => setEntries(prev => prev.filter(e => e.id !== id));

    const saveAll = async () => {
        const valid = entries.filter(e => e.status !== 'done' && parseComboName(e.name));
        if (!valid.length) return alert("Nothing to save. Each file must be named PATTERN/FINISH_PATTERN/FINISH (e.g. H1-138BP-H/EP1_H1-138DE/EP1).");
        setSaving(true);
        for (const e of valid) {
            const parsed = parseComboName(e.name);
            setEntries(prev => prev.map(x => x.id === e.id ? { ...x, status: 'saving' } : x));
            try {
                await uploadComboImage(db, storage, { pieces: parsed.pieces, key: parsed.key, file: e.file, uploadedBy: currentUser });
                setEntries(prev => prev.map(x => x.id === e.id ? { ...x, status: 'done' } : x));
            } catch (err) {
                console.error('Combo upload failed', err);
                setEntries(prev => prev.map(x => x.id === e.id ? { ...x, status: 'error', error: String(err?.message || err) } : x));
            }
        }
        setSaving(false);
    };

    const validCount = entries.filter(e => e.status !== 'done' && parseComboName(e.name)).length;
    const doneCount = entries.filter(e => e.status === 'done').length;

    const dropHandlers = {
        onDragEnter: e => { e.preventDefault(); setDragActive(true); },
        onDragOver: e => { e.preventDefault(); if (!dragActive) setDragActive(true); },
        onDragLeave: e => { e.preventDefault(); setDragActive(false); },
        onDrop: e => { e.preventDefault(); setDragActive(false); addFiles(e.dataTransfer?.files); },
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: theme.paper, minHeight: '100vh', fontFamily: theme.sans }}>
            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                <div>
                    <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.6rem', fontWeight: 500, color: theme.ink }}>Combination Photos</h2>
                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.18em', textTransform: 'uppercase' }}>Two pieces in one photo · name = PATTERN/FINISH_PATTERN/FINISH · pulled into the CPQ doc roll-up</span>
                </div>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    {entries.length > 0 && <div style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', color: theme.brass }}>{doneCount} SAVED · {validCount} READY</div>}
                    <label style={{ background: theme.ink, color: '#fff', padding: '10px 20px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }}>
                        + Select Photos
                        <input type="file" multiple accept="image/*" onChange={e => addFiles(e.target.files)} style={{ display: 'none' }} />
                    </label>
                </div>
            </div>

            {entries.length === 0 ? (
                <label {...dropHandlers} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', background: dragActive ? theme.paper2 : '#fff', border: `1px dashed ${dragActive ? theme.ink : theme.brass}`, color: theme.inkSoft, padding: '60px', cursor: 'pointer', textAlign: 'center' }}>
                    <span style={{ fontSize: '2.5rem' }}>🖼️</span>
                    <span style={{ fontFamily: theme.serif, fontSize: '1.4rem', color: theme.ink }}>{dragActive ? 'Drop to add' : 'Drop combined photos — or click to browse'}</span>
                    <span style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.05em' }}>Name each file with both pieces, e.g. <b>H1-138BP-H/EP1_H1-138DE/EP1</b>. The name is parsed into the two pattern/finish pieces; fix any below before saving.</span>
                    <input type="file" multiple accept="image/*" onChange={e => addFiles(e.target.files)} style={{ display: 'none' }} />
                </label>
            ) : (
                <div {...dropHandlers} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', border: dragActive ? `1px dashed ${theme.ink}` : '1px solid transparent', borderRadius: '2px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', alignContent: 'start' }}>
                        {entries.map(e => {
                            const parsed = parseComboName(e.name);
                            const chipBg = e.status === 'done' ? '#eef7ee' : e.status === 'error' ? '#fdf2f2' : e.status === 'saving' ? theme.paper2 : '#fff';
                            return (
                                <div key={e.id} style={{ background: chipBg, border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column' }}>
                                    <div style={{ height: '160px', background: theme.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
                                        <img src={e.previewUrl} alt="combo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                        {e.status === 'done' && <div style={{ position: 'absolute', top: '8px', right: '8px', background: '#2e7d32', color: '#fff', fontFamily: theme.mono, fontSize: '9px', padding: '2px 6px' }}>✓ SAVED</div>}
                                        <button onClick={() => removeEntry(e.id)} disabled={saving} style={{ position: 'absolute', top: '8px', left: '8px', background: 'rgba(255,255,255,0.9)', border: `1px solid ${theme.line}`, borderRadius: '50%', width: '22px', height: '22px', cursor: 'pointer', fontSize: '12px', lineHeight: '18px', padding: 0 }} title="Remove">×</button>
                                    </div>
                                    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <input value={e.name} onChange={ev => setName(e.id, ev.target.value)} disabled={saving} style={{ width: '100%', padding: '8px', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '11px', boxSizing: 'border-box', textTransform: 'uppercase' }} />
                                        {parsed ? (
                                            <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.ink }}>
                                                {parsed.pieces.map((p, i) => <span key={i}>{i > 0 && <span style={{ color: theme.brass }}>  +  </span>}<span style={{ background: theme.paper2, padding: '2px 5px', border: `1px solid ${theme.line}` }}>{p.pattern}/{p.finish}</span></span>)}
                                            </div>
                                        ) : (
                                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: '#d9534f', letterSpacing: '.03em' }}>⚠ Not a combo name — expected PATTERN/FINISH_PATTERN/FINISH</div>
                                        )}
                                        {e.status === 'error' && <div style={{ fontFamily: theme.mono, fontSize: '9px', color: '#d9534f' }}>{e.error}</div>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <button onClick={saveAll} disabled={saving || validCount === 0} style={{ padding: '14px 24px', background: (saving || validCount === 0) ? theme.paper2 : theme.ink, color: (saving || validCount === 0) ? theme.inkSoft : '#fff', border: 'none', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', cursor: (saving || validCount === 0) ? 'not-allowed' : 'pointer' }}>
                            {saving ? 'Saving…' : `Save ${validCount} combo photo${validCount === 1 ? '' : 's'}`}
                        </button>
                        <button onClick={() => setEntries([])} disabled={saving} style={{ padding: '14px 20px', background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }}>Clear</button>
                        <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>Re-uploading the same pair overwrites it.</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ComboImageUploader;
