// GALLERY — the customer-facing slice of the Asset Gallery (Stuart 2026-07-27, Fabricut H1 =
// the test set). The portalAssets BFF serves ONLY images staff flagged for the portal (🌐 in the
// internal gallery) within this customer's entitled collections, each with a server-built
// lowercase blob of its Fabricut identity (fab{} + tags + names). Search AND-matches every
// typed token against that blob — the same matching rule as the internal gallery — so
// "french return 4-5/8" or "P01 coverplate" narrow exactly like staff expect.
import React, { useEffect, useMemo, useState } from 'react';
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

export default function Gallery() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
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
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(
    () => tokens.length ? assets.filter((a) => tokens.every((t) => (a.blob || '').includes(t))) : assets,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assets, q]
  );

  if (err) return <div className="empty" style={{ marginTop: 24 }}>{err}</div>;
  if (!data) return <div className="empty" style={{ marginTop: 24 }}>Loading your gallery…</div>;
  if (assets.length === 0) return <div className="empty" style={{ marginTop: 24 }}>No images are enabled for your account yet — contact your Classical Elements representative.</div>;

  return (
    <div style={{ marginTop: 24, position: 'relative', left: '50%', transform: 'translateX(-50%)', width: 'min(1320px, calc(100vw - 48px))' }}>
      <h2 className="sec">Gallery<span className="count">{shown.length}</span></h2>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search — pattern #, finish, french return, backplate, 4-5/8…  (every word must match)"
        style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', border: '1px solid var(--line)', borderRadius: 2, fontSize: '0.95rem', outline: 'none', margin: '4px 0 18px', background: '#fff' }}
      />
      {shown.length === 0 ? (
        <div className="empty">Nothing matches “{q}” — every word must match; try fewer words.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {shown.map((a) => (
            <button key={a.id} onClick={() => setZoom(a)} style={{ border: '1px solid var(--line)', borderRadius: 2, background: '#fff', padding: 0, cursor: 'zoom-in', textAlign: 'left', overflow: 'hidden' }}>
              <div style={{ width: '100%', aspectRatio: '4 / 3', background: '#faf8f3', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {a.url ? <img src={a.url} alt={a.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ color: 'var(--ink-soft)' }}>⚲</span>}
              </div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.68rem', color: 'var(--ink-soft)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {identityOf(a) || (a.fabCode ? `FABRICUT ${a.fabCode}` : ' ')}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {zoom && (
        <div onClick={() => setZoom(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,0.8)', zIndex: 4000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, cursor: 'zoom-out', padding: 20 }}>
          <img src={zoom.fullUrl || zoom.url} alt={zoom.name} style={{ maxWidth: '86vw', maxHeight: '72vh', objectFit: 'contain', background: '#fff', border: '1px solid var(--line)', padding: 10, borderRadius: 2 }} />
          <div style={{ background: '#faf8f3', border: '1px solid var(--line)', borderRadius: 2, padding: '10px 16px', maxWidth: '86vw', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: '0.95rem', color: 'var(--ink)' }}>{zoom.name}</div>
            {identityOf(zoom) && <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: 4 }}>{identityOf(zoom)}</div>}
            {zoom.fabCode && <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: 2 }}>FABRICUT CODE: {zoom.fabCode}</div>}
            {zoom.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 8 }}>
                {zoom.tags.map((t) => <span key={t} style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.62rem', color: 'var(--ink-soft)', border: '1px solid var(--line)', padding: '2px 7px', borderRadius: 10, background: '#fff' }}>{t}</span>)}
              </div>
            )}
          </div>
          <div style={{ color: '#fff', fontFamily: 'var(--mono, monospace)', fontSize: 11, letterSpacing: '.08em' }}>CLICK ANYWHERE TO CLOSE</div>
        </div>
      )}
    </div>
  );
}
