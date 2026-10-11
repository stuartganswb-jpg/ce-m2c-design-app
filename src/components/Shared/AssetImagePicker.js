// ── PICK A PICTURE FROM THE ASSET GALLERY (S7, step 7, 2026-10-11) ───────────────────────────────
// One small modal every screen can mount: the brand's gallery assets (+ the ones filed for ALL brands),
// searched by name / pattern / colour / type, as thumbnails; one click hands the asset back. Reads
// `global_assets` once when opened (no listener). No native dialogs.
import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';

const mono = { fontFamily: 'var(--mono, monospace)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft, #777)' };
const btn = (primary) => ({ padding: '8px 14px', background: primary ? 'var(--ink, #1a1a1a)' : 'transparent', border: primary ? 'none' : '1px solid var(--line, #ccc)', cursor: 'pointer', fontFamily: mono.fontFamily, fontSize: mono.fontSize, textTransform: mono.textTransform, letterSpacing: mono.letterSpacing, color: primary ? '#fff' : 'var(--ink, #1a1a1a)' });

const AssetImagePicker = ({ brandId = '', initialQuery = '', title = 'Pick a picture from the Asset Gallery', onPick = () => {}, onClose = () => {} }) => {
    const [assets, setAssets] = useState(null);
    const [q, setQ] = useState(initialQuery || '');
    const [err, setErr] = useState('');
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const snap = await getDocs(collection(db, 'global_assets'));
                const b = String(brandId || '').toLowerCase();
                const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                const mine = all.filter(a => { const ab = String(a.brandId || 'ALL').toLowerCase(); return !b || ab === b || ab === 'all'; });
                if (alive) setAssets(mine.filter(a => a.thumbnailUrl || a.url || a.originalUrl));
            } catch (e) { if (alive) { setAssets([]); setErr(`Could not read the gallery: ${e.message || e}`); } }
        })();
        return () => { alive = false; };
    }, [brandId]);
    const list = useMemo(() => {
        const t = String(q || '').trim().toLowerCase();
        const rows = (assets || []).filter(a => !t || [a.name, a.patternId, a.finishId, a.productType, a.collection, a.clientSku].some(v => String(v || '').toLowerCase().includes(t)));
        return rows.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).slice(0, 120);
    }, [assets, q]);
    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', border: '1px solid var(--line, #ccc)', width: 'min(900px, 94vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', borderRadius: '2px' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line, #ddd)', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ fontFamily: 'var(--serif, serif)', fontSize: '1.15rem' }}>{title}</div>
                    <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="search name · pattern · colour · type" style={{ flex: 1, minWidth: '220px', padding: '8px 10px', border: '1px solid var(--line, #ccc)', fontFamily: 'var(--sans, sans-serif)', fontSize: '0.9rem', outline: 'none' }} />
                    <span style={mono}>{assets === null ? 'reading…' : `${list.length}${(assets || []).length > list.length ? ` of ${(assets || []).length}` : ''}`}</span>
                    <button onClick={onClose} style={btn(false)}>Close</button>
                </div>
                {err && <div style={{ padding: '10px 18px', color: '#d9534f', fontSize: '0.85rem' }}>{err}</div>}
                <div style={{ overflowY: 'auto', padding: '14px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px' }}>
                    {assets !== null && list.length === 0 && <div style={{ color: 'var(--ink-soft, #777)', fontSize: '0.9rem' }}>No gallery picture matches.</div>}
                    {list.map(a => (
                        <button key={a.id} onClick={() => onPick(a)} style={{ background: '#fff', border: '1px solid var(--line, #ddd)', padding: '6px', cursor: 'pointer', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '4px' }} title={a.name}>
                            <img src={a.thumbnailUrl || a.url || a.originalUrl} alt={a.name || ''} style={{ width: '100%', height: '110px', objectFit: 'cover', background: '#f4f1ec' }} />
                            <div style={{ fontSize: '0.78rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || a.id}</div>
                            <div style={{ ...mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[a.patternId, a.finishId, a.productType].filter(Boolean).join(' · ')}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default AssetImagePicker;
