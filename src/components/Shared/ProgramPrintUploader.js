import React, { useState, useRef, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
import { uploadProgramPrint, programPrintExists, printKey } from './programPrints';

// Worker pinned to the installed version; pdfjs falls back to a main-thread
// "fake worker" if this can't load (offline), so previews still work.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.js`;

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

// Best-guess the program name off a page's text layer: prefer a code-like token
// (e.g. H1-75BS, M2C-1234), else the largest-font text. Empty if no text layer.
const guessName = (items) => {
    const texts = (items || [])
        .map(it => ({ s: String(it.str || '').trim(), h: Math.hypot(it.transform?.[2] || 0, it.transform?.[3] || 0) }))
        .filter(t => t.s.length >= 2);
    if (!texts.length) return '';
    const codeRe = /^[A-Za-z0-9]+(?:[-_/][A-Za-z0-9]+)+$/;
    const byFont = [...texts].sort((a, b) => b.h - a.h);
    const codeHit = byFont.find(t => codeRe.test(t.s));
    return (codeHit ? codeHit.s : byFont[0].s).toUpperCase();
};

const ProgramPrintUploader = ({ currentUser, activeBrand }) => {
    const [pages, setPages] = useState([]);          // { pageNum, name, blob, fileType, previewUrl, status, error }
    const [currentIndex, setCurrentIndex] = useState(0);
    const [phase, setPhase] = useState('idle');      // idle | parsing | review | saving | done
    const [parseMsg, setParseMsg] = useState('');
    const [sourceName, setSourceName] = useState('');
    const pdfDocRef = useRef(null);
    const fileInputRef = useRef(null);

    const reset = () => {
        try { pages.forEach(p => p.previewUrl && p.previewUrl.startsWith('blob:') && URL.revokeObjectURL(p.previewUrl)); } catch (e) {}
        if (pdfDocRef.current) { try { pdfDocRef.current.destroy(); } catch (e) {} pdfDocRef.current = null; }
        setPages([]); setCurrentIndex(0); setPhase('idle'); setParseMsg(''); setSourceName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Render one PDF page to a JPEG data URL (lazy — only the page being viewed).
    const renderPreview = async (pageNum) => {
        if (!pdfDocRef.current) return null;
        try {
            const page = await pdfDocRef.current.getPage(pageNum);
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(2, Math.max(0.5, 900 / base.width));
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            return canvas.toDataURL('image/jpeg', 0.75);
        } catch (e) { return null; }
    };

    // Lazily fill in the preview for whichever page is on screen.
    useEffect(() => {
        const p = pages[currentIndex];
        if (!p || p.previewUrl || p.fileType !== 'pdf' || !pdfDocRef.current) return;
        let cancelled = false;
        renderPreview(p.pageNum).then(url => {
            if (cancelled || !url) return;
            setPages(prev => prev.map((x, i) => i === currentIndex ? { ...x, previewUrl: url } : x));
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex, pages.length]);

    const handleFile = async (file) => {
        if (!file) return;
        setSourceName(file.name || '');
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');

        // Single image -> one print, no split.
        if (!isPdf) {
            const url = URL.createObjectURL(file);
            setPages([{ pageNum: 1, name: printKey(String(file.name || '').replace(/\.[^.]+$/, '')), blob: file, fileType: 'image', previewUrl: url, status: 'pending' }]);
            setCurrentIndex(0); setPhase('review');
            return;
        }

        setPhase('parsing'); setParseMsg('Reading PDF…');
        try {
            const buf = await file.arrayBuffer();
            // pdf-lib splits; pdfjs reads text + renders. Separate copies so neither detaches the other.
            const src = await PDFDocument.load(buf.slice(0));
            pdfDocRef.current = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
            const count = src.getPageCount();

            const built = [];
            for (let i = 0; i < count; i++) {
                setParseMsg(`Splitting & reading labels… page ${i + 1} of ${count}`);
                // best-guess name from the text layer
                let name = '';
                try {
                    const pjsPage = await pdfDocRef.current.getPage(i + 1);
                    const tc = await pjsPage.getTextContent();
                    name = guessName(tc.items);
                } catch (e) { /* no text layer -> blank, user fills */ }
                // single-page PDF blob
                const out = await PDFDocument.create();
                const [pg] = await out.copyPages(src, [i]);
                out.addPage(pg);
                const bytes = await out.save();
                built.push({ pageNum: i + 1, name, blob: new Blob([bytes], { type: 'application/pdf' }), fileType: 'pdf', previewUrl: null, status: 'pending' });
            }
            setPages(built); setCurrentIndex(0); setPhase('review');
        } catch (e) {
            console.error('PDF parse failed', e);
            alert('Could not read this PDF. It may be corrupt or password-protected.');
            reset();
        }
    };

    const setName = (idx, val) => setPages(prev => prev.map((p, i) => i === idx ? { ...p, name: val } : p));

    // Upload one page. Returns true on success. `silent` skips the overwrite prompt (used by Save All).
    const savePage = async (idx, { silent } = {}) => {
        const p = pages[idx];
        if (!p) return false;
        const name = printKey(p.name);
        if (!name) { if (!silent) alert('Enter a name for this page first.'); return false; }
        if (!silent && await programPrintExists(db, name)) {
            if (!window.confirm(`A print already exists for "${name}". Replace it?`)) return false;
        }
        setPages(prev => prev.map((x, i) => i === idx ? { ...x, status: 'saving' } : x));
        try {
            await uploadProgramPrint(db, storage, { name, file: p.blob, fileType: p.fileType, uploadedBy: currentUser, brandId: activeBrand || null, source: sourceName || null });
            setPages(prev => prev.map((x, i) => i === idx ? { ...x, status: 'done', name } : x));
            return true;
        } catch (e) {
            console.error('Print upload failed', e);
            setPages(prev => prev.map((x, i) => i === idx ? { ...x, status: 'error', error: String(e?.message || e) } : x));
            return false;
        }
    };

    const advance = () => {
        // Scan ALL other pages so nothing is stranded if you jump around the list. Exclude the
        // current index — its just-changed status isn't reflected in this render's closure yet.
        const next = pages.findIndex((p, i) => i !== currentIndex && (p.status === 'pending' || p.status === 'error'));
        if (next === -1) setPhase('done'); else setCurrentIndex(next);
    };

    const handleSaveNext = async () => { if (await savePage(currentIndex)) advance(); };
    const handleSkip = () => {
        setPages(prev => prev.map((x, i) => i === currentIndex ? { ...x, status: x.status === 'done' ? 'done' : 'skipped' } : x));
        advance();
    };

    const handleSaveAll = async () => {
        const remaining = pages.filter(p => p.status === 'pending' || p.status === 'error');
        if (!remaining.length) return;
        const named = remaining.filter(p => printKey(p.name));
        if (named.length < remaining.length && !window.confirm(`${remaining.length - named.length} page(s) have no name and will be skipped. Continue saving the other ${named.length}?`)) return;
        if (!window.confirm(`Save ${named.length} print(s) now? Existing prints with the same name will be overwritten.`)) return;
        setPhase('saving');
        for (let i = 0; i < pages.length; i++) {
            if (pages[i].status === 'pending' || pages[i].status === 'error') {
                if (printKey(pages[i].name)) await savePage(i, { silent: true });
            }
        }
        setPhase('done');
    };

    const remaining = pages.filter(p => p.status === 'pending' || p.status === 'error').length;
    const savedCount = pages.filter(p => p.status === 'done').length;
    const cur = pages[currentIndex];

    const statusChip = (s) => {
        const map = { pending: ['#fff', theme.inkSoft, '•'], saving: [theme.paper, theme.brass, '…'], done: ['#eef7ee', '#2e7d32', '✓'], skipped: [theme.paper2, theme.inkSoft, '–'], error: ['#fdf2f2', '#d9534f', '!'] };
        const [bg, col, ic] = map[s] || map.pending;
        return <span style={{ background: bg, color: col, border: `1px solid ${theme.line}`, borderRadius: '2px', padding: '1px 5px', fontFamily: theme.mono, fontSize: '9px' }}>{ic}</span>;
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: theme.paper, minHeight: '100vh', fontFamily: theme.sans }}>
            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                <div>
                    <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.6rem', fontWeight: 500, color: theme.ink }}>Program Print Uploader</h2>
                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.18em', textTransform: 'uppercase' }}>PDF → one print per page · pulled by the Print button on the floor & library</span>
                </div>
                {pages.length > 0 && (
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                        <div style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', color: theme.brass }}>{savedCount} SAVED · {remaining} LEFT</div>
                        <button onClick={reset} style={{ background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, padding: '8px 14px', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }}>Start Over</button>
                    </div>
                )}
            </div>

            {phase === 'idle' && (
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', background: '#fff', border: `1px dashed ${theme.brass}`, color: theme.inkSoft, padding: '60px', cursor: 'pointer', textAlign: 'center' }}>
                    <span style={{ fontSize: '2.5rem' }}>📄</span>
                    <span style={{ fontFamily: theme.serif, fontSize: '1.4rem', color: theme.ink }}>Drop a PDF (or image) to begin</span>
                    <span style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.05em' }}>A multi-page PDF is split into one print per page. Each page's label is read automatically — you confirm or fix the name before it saves.</span>
                    <input ref={fileInputRef} type="file" accept="application/pdf,image/*" onChange={e => handleFile(e.target.files[0])} style={{ display: 'none' }} />
                </label>
            )}

            {phase === 'parsing' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', background: '#fff', border: `1px solid ${theme.line}`, color: theme.ink, padding: '60px' }}>
                    <div style={{ fontSize: '2rem' }}>⏳</div>
                    <div style={{ fontFamily: theme.serif, fontSize: '1.3rem' }}>Preparing pages…</div>
                    <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft, letterSpacing: '.05em' }}>{parseMsg}</div>
                </div>
            )}

            {phase === 'done' && (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', background: theme.paper2, border: `1px solid ${theme.line}`, color: theme.ink, padding: '60px' }}>
                    <div style={{ fontSize: '3rem' }}>✅</div>
                    <h2 style={{ margin: 0, fontFamily: theme.serif, fontWeight: 500 }}>Done — {savedCount} print(s) saved</h2>
                    {pages.some(p => p.status === 'error') && <div style={{ fontFamily: theme.mono, fontSize: '11px', color: '#d9534f' }}>{pages.filter(p => p.status === 'error').length} failed — check console.</div>}
                    <button onClick={reset} style={{ marginTop: '10px', padding: '12px 24px', background: theme.ink, color: '#fff', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', border: 'none', cursor: 'pointer' }}>Upload Another</button>
                </div>
            )}

            {(phase === 'review' || phase === 'saving') && cur && (
                <div style={{ display: 'flex', gap: '20px', flex: 1 }}>
                    {/* page list */}
                    <div style={{ width: '260px', background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', maxHeight: '78vh', overflowY: 'auto' }}>
                        <div style={{ padding: '14px', background: theme.paper, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textAlign: 'center', position: 'sticky', top: 0, borderBottom: `1px solid ${theme.line}`, textTransform: 'uppercase' }}>{pages.length} Pages — {sourceName}</div>
                        <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {pages.map((p, i) => (
                                <div key={i} onClick={() => setCurrentIndex(i)} style={{ padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', background: i === currentIndex ? theme.paper2 : '#fff', border: i === currentIndex ? `1px solid ${theme.brass}` : `1px solid ${theme.line}` }}>
                                    {statusChip(p.status)}
                                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>p{p.pageNum}</span>
                                    <span style={{ fontFamily: theme.sans, fontSize: '12px', color: theme.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.name || <em style={{ color: theme.inkSoft }}>unnamed</em>}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* preview */}
                    <div style={{ flex: 2, background: theme.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${theme.line}`, overflow: 'auto', position: 'relative', minHeight: '400px' }}>
                        {cur.previewUrl
                            ? <img src={cur.previewUrl} alt={`page ${cur.pageNum}`} style={{ maxWidth: '100%', maxHeight: '76vh', objectFit: 'contain', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }} />
                            : <div style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>rendering preview…</div>}
                        <div style={{ position: 'absolute', bottom: '14px', right: '14px', background: 'rgba(255,255,255,0.92)', border: `1px solid ${theme.line}`, padding: '6px 12px', fontFamily: theme.mono, fontSize: '10px' }}>Page {cur.pageNum} / {pages.length}</div>
                    </div>

                    {/* name + actions */}
                    <div style={{ flex: 1.1, background: '#fff', border: `1px solid ${theme.line}`, padding: '26px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ fontFamily: theme.serif, fontSize: '1.3rem', fontWeight: 500, color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: '10px' }}>Name this print</div>
                        <div style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>Program / Item name — read from the page, confirm or fix</div>
                        <input
                            autoFocus
                            value={cur.name}
                            onChange={e => setName(currentIndex, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveNext(); }}
                            placeholder="e.g. H1-75BS"
                            style={{ width: '100%', padding: '14px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '1.05rem', textTransform: 'uppercase', boxSizing: 'border-box', outline: 'none' }}
                        />
                        {cur.status === 'error' && <div style={{ fontFamily: theme.mono, fontSize: '10px', color: '#d9534f' }}>Upload failed: {cur.error}</div>}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: 'auto' }}>
                            <button onClick={handleSaveNext} disabled={cur.status === 'saving' || phase === 'saving'} style={{ padding: '15px', background: (cur.status === 'saving' || phase === 'saving') ? theme.paper2 : theme.ink, color: (cur.status === 'saving' || phase === 'saving') ? theme.inkSoft : '#fff', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', border: 'none', cursor: (cur.status === 'saving' || phase === 'saving') ? 'not-allowed' : 'pointer' }}>
                                {cur.status === 'saving' ? 'Saving…' : (cur.status === 'done' ? 'Saved ✓ — Next' : 'Save & Next')}
                            </button>
                            <button onClick={handleSkip} disabled={phase === 'saving'} style={{ padding: '10px', background: 'transparent', color: theme.inkSoft, border: 'none', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', textDecoration: 'underline', cursor: 'pointer' }}>Skip this page</button>
                            <button onClick={handleSaveAll} disabled={phase === 'saving' || remaining === 0} style={{ padding: '12px', background: 'transparent', color: theme.brass, border: `1px solid ${theme.brass}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: phase === 'saving' ? 'not-allowed' : 'pointer' }}>Save all remaining ({remaining}) with shown names</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProgramPrintUploader;
