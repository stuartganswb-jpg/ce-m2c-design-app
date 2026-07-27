// GALLERY — the customer-facing slice of the Asset Gallery (Stuart 2026-07-27, Fabricut H1 =
// the test set). The portalAssets BFF serves ONLY images staff flagged for the portal (🌐 in the
// internal gallery) within this customer's entitled collections, each with a server-built
// lowercase blob of its Fabricut identity (fab{} + tags + names). Search AND-matches every
// typed token against that blob, and the DIA / TYPE dropdowns narrow the same way the internal
// chips do (TYPE limited to the customer-meaningful four: brackets, finials, rods, rings).
// Display is FABRICUT-FIRST: their part # prominent, ours in parentheses. Download/Print imprint
// the chosen id onto the image (the internal gallery's watermark mechanics, ported verbatim).
// NOTE the lightbox renders through createPortal(document.body): the page wrapper carries a
// transform (the width breakout), and a transformed ancestor becomes the containing block for
// position:fixed — rendering inline made the overlay size against the wrapper, not the viewport.
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const END_LABELS = { FRENCH_RETURN: 'FRENCH RETURN', MITER_RETURN: 'MITER RETURN', INSIDE_MOUNT: 'INSIDE MOUNT', FINIAL: 'FINIAL' };

// The one-line identity under each image — mirrors the internal gallery's summary line.
const identityOf = (a) => [
  END_LABELS[a.fab?.endTreatment] || a.fab?.pairedName || null,
  a.fab?.plateCode ? `${a.fab.plateIsCover ? 'COVERPLATE' : 'BACKPLATE'} ${a.fab.plateCode}${a.fab.plateOrientation ? ` (${a.fab.plateOrientation})` : ''}` : null,
  a.fab?.diaLabel || null,
  a.fab?.projLabel || null,
  a.fab?.ourFinishName || a.fab?.fabColorName || null,
].filter(Boolean).join(' · ');

// FABRICUT-FIRST display: their part # prominent, ours in parentheses.
const fabNoOf = (a) => String(a.fabCode || '').trim();
const ourNoOf = (a) => String(a.name || '').trim();

const hasTag = (a, t) => Array.isArray(a?.tags) && a.tags.includes(t);
// The four customer-meaningful types (mirrors the internal TYPE_CHIPS predicates).
const TYPE_FILTERS = [
  { id: 'BRACKETS', label: 'Brackets', test: (a) => hasTag(a, 'BRACKET ARM') || a.fab?.pairedRole === 'ARM' || a.fab?.role === 'BRACKET' },
  { id: 'FINIALS', label: 'Finials', test: (a) => hasTag(a, 'FINIAL') || a.fab?.role === 'FINIAL' },
  { id: 'RODS', label: 'Rods', test: (a) => hasTag(a, 'POLE') || a.fab?.role === 'POLE' },
  { id: 'RINGS', label: 'Rings', test: (a) => hasTag(a, 'RING') || a.fab?.role === 'RING' },
];

// Internal gallery's watermark download, ported verbatim: the chosen id in a white box,
// bottom-right, then a PNG download.
const downloadWithImprint = (url, textStr, prefix) => {
  if (!textStr) return alert('No part number to imprint for this image.');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const cvs = document.createElement('canvas');
      const ctx = cvs.getContext('2d');
      cvs.width = img.width; cvs.height = img.height;
      ctx.drawImage(img, 0, 0);
      const fontSize = Math.max(18, Math.floor(img.height * 0.035));
      ctx.font = `bold ${fontSize}px monospace`;
      const pad = fontSize * 0.4;
      const txtW = ctx.measureText(textStr).width;
      const boxX = img.width - txtW - pad * 3;
      const boxY = img.height - fontSize - pad * 3;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fillRect(boxX, boxY, txtW + pad * 2, fontSize + pad * 2);
      ctx.fillStyle = '#333333';
      ctx.textBaseline = 'top';
      ctx.fillText(textStr, boxX + pad, boxY + pad * 1.5);
      cvs.toBlob((blob) => {
        const el = document.createElement('a');
        el.href = URL.createObjectURL(blob);
        el.download = `${prefix}_${textStr.replace(/[^A-Za-z0-9]/g, '_')}.png`;
        el.click();
      }, 'image/png', 1.0);
    } catch (e) {
      window.open(url, '_blank'); // canvas blocked → at least hand them the original
    }
  };
  img.onerror = () => window.open(url, '_blank');
  img.src = url;
};

// Print: a minimal print window with the image + the chosen part # under it.
const printWithLabel = (url, textStr) => {
  const w = window.open('', '_blank');
  if (!w) return alert('Pop-up blocked — allow pop-ups for this site to print.');
  w.document.write(`<!doctype html><title>${textStr || 'Image'}</title><body style="margin:0;display:flex;flex-direction:column;align-items:center;font-family:monospace">` +
    `<img src="${url}" style="max-width:100%;max-height:90vh;object-fit:contain" onload="setTimeout(function(){window.print()},150)">` +
    `<div style="padding:12px;font-size:16px;font-weight:bold">${textStr || ''}</div></body>`);
  w.document.close();
};

export default function Gallery() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [diaFilter, setDiaFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [labelSide, setLabelSide] = useState('FAB'); // which part # to imprint: 'FAB' | 'OURS'
  const [zoom, setZoom] = useState(null); // the asset opened full-size

  useEffect(() => {
    let alive = true;
    httpsCallable(functions, 'portalAssets')()
      .then((res) => { if (alive) setData(res.data); })
      .catch((e) => {
        if (!alive) return;
        setErr(/permission/i.test(e.message || '')
          ? 'The gallery is not enabled on your account yet — contact your Classical Elements representative.'
          : 'Could not load the gallery right now — please try again shortly.');
      });
    return () => { alive = false; };
  }, []);

  const assets = data?.assets || [];
  const diaOptions = useMemo(() => [...new Set(assets.map((a) => a.fab?.diaLabel).filter(Boolean))].sort(), [assets]);
  const shown = useMemo(() => {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    return assets.filter((a) => {
      if (diaFilter && a.fab?.diaLabel !== diaFilter) return false;
      if (typeFilter) { const tf = TYPE_FILTERS.find((t) => t.id === typeFilter); if (tf && !tf.test(a)) return false; }
      return tokens.every((t) => (a.blob || '').includes(t));
    });
  }, [assets, q, diaFilter, typeFilter]);

  if (err) return <div className="empty" style={{ marginTop: 24 }}>{err}</div>;
  if (!data) return <div className="empty" style={{ marginTop: 24 }}>Loading your gallery…</div>;
  if (assets.length === 0) return <div className="empty" style={{ marginTop: 24 }}>No images are enabled for your account yet — contact your Classical Elements representative.</div>;

  const imprintTextOf = (a) => (labelSide === 'FAB' ? (fabNoOf(a) || ourNoOf(a)) : (ourNoOf(a) || fabNoOf(a)));

  return (
    <div style={{ marginTop: 24, position: 'relative', left: '50%', transform: 'translateX(-50%)', width: 'min(1320px, calc(100vw - 48px))' }}>
      <h2 className="sec">Gallery<span className="count">{shown.length}</span></h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '4px 0 18px' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search — pattern #, finish, french return, backplate…  (every word must match)"
          style={{ flex: '2 1 320px', boxSizing: 'border-box', padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 2, fontSize: '0.95rem', outline: 'none', background: '#fff' }}
        />
        <select value={diaFilter} onChange={(e) => setDiaFilter(e.target.value)} style={{ flex: '1 1 150px', padding: '12px 10px', border: '1px solid var(--line)', borderRadius: 2, fontSize: '0.92rem', outline: 'none', background: '#fff' }}>
          <option value="">Rod diameter — any</option>
          {diaOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ flex: '1 1 150px', padding: '12px 10px', border: '1px solid var(--line)', borderRadius: 2, fontSize: '0.92rem', outline: 'none', background: '#fff' }}>
          <option value="">Type — any</option>
          {TYPE_FILTERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      {shown.length === 0 ? (
        <div className="empty">Nothing matches — every search word must match; try fewer words or clear the filters.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {shown.map((a) => (
            <button key={a.id} onClick={() => setZoom(a)} style={{ border: '1px solid var(--line)', borderRadius: 2, background: '#fff', padding: 0, cursor: 'zoom-in', textAlign: 'left', overflow: 'hidden' }}>
              <div style={{ width: '100%', aspectRatio: '4 / 3', background: '#faf8f3', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {a.url ? <img src={a.url} alt={a.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'var(--ink-soft)' }}>⚲</span>}
              </div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: '0.9rem', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <b style={{ fontFamily: 'var(--mono, monospace)' }}>{fabNoOf(a) || ourNoOf(a)}</b>
                  {fabNoOf(a) && ourNoOf(a) && <span style={{ color: 'var(--ink-soft)', fontSize: '0.78rem' }}> ({ourNoOf(a)})</span>}
                </div>
                <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.68rem', color: 'var(--ink-soft)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {identityOf(a) || ' '}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {zoom && createPortal(
        <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,0.8)', zIndex: 4000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, cursor: 'zoom-out', padding: 20 }}>
          <img src={zoom.fullUrl || zoom.url} alt={zoom.name} style={{ maxWidth: '86vw', maxHeight: '62vh', objectFit: 'contain', background: '#fff', border: '1px solid var(--line)', padding: 10, borderRadius: 2 }} />
          <div style={{ background: '#faf8f3', border: '1px solid var(--line)', borderRadius: 2, padding: '12px 18px', maxWidth: '86vw', textAlign: 'center', cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: '1.05rem', color: 'var(--ink)' }}>
              <b style={{ fontFamily: 'var(--mono, monospace)' }}>{fabNoOf(zoom) || ourNoOf(zoom)}</b>
              {fabNoOf(zoom) && ourNoOf(zoom) && <span style={{ color: 'var(--ink-soft)', fontSize: '0.85rem' }}> ({ourNoOf(zoom)})</span>}
            </div>
            {identityOf(zoom) && <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: 4 }}>{identityOf(zoom)}</div>}
            {(zoom.tags || []).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 8 }}>
                {zoom.tags.map((t) => <span key={t} style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.62rem', color: 'var(--ink-soft)', border: '1px solid var(--line)', padding: '2px 7px', borderRadius: 10, background: '#fff' }}>{t}</span>)}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.65rem', color: 'var(--ink-soft)', letterSpacing: '.08em' }}>IMPRINT:</span>
              {[['FAB', `Fabricut # ${fabNoOf(zoom) || '—'}`], ['OURS', `CE # ${ourNoOf(zoom) || '—'}`]].map(([side, label]) => (
                <button key={side} onClick={() => setLabelSide(side)} style={{ padding: '6px 10px', fontSize: '0.72rem', fontFamily: 'var(--mono, monospace)', border: `1px solid ${labelSide === side ? 'var(--brass, #b08d57)' : 'var(--line)'}`, background: labelSide === side ? 'var(--brass, #b08d57)' : '#fff', color: labelSide === side ? '#fff' : 'var(--ink)', borderRadius: 2, cursor: 'pointer' }}>{label}</button>
              ))}
              <button onClick={() => downloadWithImprint(zoom.fullUrl || zoom.url, imprintTextOf(zoom), labelSide === 'FAB' ? 'FABRICUT' : 'CE')} className="btn" style={{ padding: '8px 14px' }}>Download</button>
              <button onClick={() => printWithLabel(zoom.fullUrl || zoom.url, imprintTextOf(zoom))} className="btn-ghost" style={{ padding: '8px 14px', border: '1px solid var(--line)', borderRadius: 2 }}>Print</button>
            </div>
          </div>
          <div style={{ color: '#fff', fontFamily: 'var(--mono, monospace)', fontSize: 11, letterSpacing: '.08em' }}>CLICK ANYWHERE TO CLOSE</div>
        </div>,
        document.body
      )}
    </div>
  );
}
