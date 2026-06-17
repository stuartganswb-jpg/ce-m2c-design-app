import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot } from 'firebase/firestore';

// READ-ONLY audit of NetSuite-identifier completeness on library parts.
// • netSuiteInternalId (numeric) is what ERP Push and Inventory Adjustment send to NetSuite;
//   when it's blank the code falls back to a string code (or the Firestore doc id), which
//   silently mis-targets. Re-sync the flagged parts from the NetSuite Sync tab.
// • itemId is the key BOM / assembly_pins match on.
// No writes — purely a report.

const labelStyle = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' };
const thStyle = { padding: '12px 14px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' };
const tdStyle = { padding: '10px 14px', color: 'var(--ink)', fontSize: '0.95rem', verticalAlign: 'top' };

const ErpMappingAudit = ({ currentUser, activeBrand }) => {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('Inventory');
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const unsub = onSnapshot(
      collection(db, 'Approved_Designs'),
      (snap) => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const mine = all.filter(p => p.brandId === activeBrand || (Array.isArray(p.sharedBrands) && p.sharedBrands.includes(activeBrand)));
        setParts(mine);
        setLoading(false);
      },
      (err) => { console.error('ERP Mapping Audit: subscribe failed', err); setError(err?.message || 'Failed to load parts'); setLoading(false); }
    );
    return () => unsub();
  }, [activeBrand]);

  const rows = useMemo(() => (parts || []).map(p => {
    const specs = p.manufacturingSpecs || {};
    const nsRaw = p.netSuiteInternalId ?? specs.netSuiteInternalId;
    const hasNsId = nsRaw !== undefined && nsRaw !== null && String(nsRaw).trim() !== '';
    const hasItemId = !!(p.itemId && String(p.itemId).trim());
    const itemIdMismatch = hasItemId && p.itemId !== p.id;
    const code = p.legacyErpId || p.itemId || p.id || '(no code)';
    const partClass = p.partClass || specs.partClass || '—';
    const issues = [];
    if (!hasNsId) issues.push('No NetSuite id');
    if (!hasItemId) issues.push('No itemId');
    return { id: p.id, code, name: p.itemName || p.tempName || '(unnamed)', partClass, hasNsId, hasItemId, itemIdMismatch, issues };
  }), [parts]);

  const classes = useMemo(() => ['ALL', ...Array.from(new Set(rows.map(r => r.partClass))).sort()], [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (classFilter !== 'ALL' && r.partClass !== classFilter) return false;
    if (onlyIssues && r.issues.length === 0) return false;
    if (search) {
      const t = search.toLowerCase();
      if (!String(r.code).toLowerCase().includes(t) && !String(r.name).toLowerCase().includes(t)) return false;
    }
    return true;
  }), [rows, classFilter, onlyIssues, search]);

  const missNsInv = useMemo(() => rows.filter(r => r.partClass === 'Inventory' && !r.hasNsId).length, [rows]);
  const missItemId = useMemo(() => rows.filter(r => !r.hasItemId).length, [rows]);

  const copyCodes = () => {
    try {
      const codes = filtered.map(r => r.code).join('\n');
      if (navigator.clipboard && codes) { navigator.clipboard.writeText(codes); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    } catch (e) { console.error('copy failed', e); }
  };

  const card = (n, lbl, color) => (
    <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', borderLeft: `4px solid ${color}`, padding: '20px', borderRadius: '2px' }}>
      <div style={{ fontFamily: 'var(--serif)', fontSize: '2.4rem', fontWeight: 500, color: 'var(--ink)', lineHeight: 1 }}>{n}</div>
      <div style={{ ...labelStyle, marginTop: '8px' }}>{lbl}</div>
    </div>
  );

  return (
    <div style={{ fontFamily: 'var(--sans)' }}>
      <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)', margin: '0 0 6px 0' }}>ERP Mapping Audit</h2>
      <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem', margin: '0 0 24px 0', maxWidth: '780px', lineHeight: 1.5 }}>
        Read-only. <strong>netSuiteInternalId</strong> is what ERP Push &amp; Inventory Adjustment send to NetSuite — blank means they silently mis-target; re-sync those parts from the <em>NetSuite Sync</em> tab.
        <strong> itemId</strong> is the key BOM / assembly pins match on. (Fees &amp; non-stock items may legitimately have no NetSuite id.)
      </p>

      {error && <div style={{ background: '#fdf2f2', border: '1px solid #d9534f', color: '#d9534f', padding: '16px', marginBottom: '20px', borderRadius: '2px', fontSize: '0.9rem' }}>Couldn't load parts: {error}</div>}

      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
        {card(loading ? '…' : missNsInv, 'Inventory parts · no NetSuite id', '#d9534f')}
        {card(loading ? '…' : missItemId, 'Parts · no itemId', 'var(--brass)')}
        {card(loading ? '…' : rows.length, `Total parts (${activeBrand || '—'})`, 'var(--ink)')}
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '16px' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code / name…" style={{ flex: 1, minWidth: '200px', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />
        <select value={classFilter} onChange={e => setClassFilter(e.target.value)} style={{ padding: '10px', border: '1px solid var(--line)', outline: 'none', background: '#fff', fontFamily: 'var(--sans)' }}>
          {classes.map(c => <option key={c} value={c}>{c === 'ALL' ? 'All classes' : c}</option>)}
        </select>
        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} /> Only parts with gaps
        </label>
        <button onClick={copyCodes} disabled={!filtered.length} style={{ padding: '10px 16px', background: filtered.length ? 'var(--ink)' : 'var(--paper-2)', color: filtered.length ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: filtered.length ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
          {copied ? 'Copied ✓' : `Copy ${filtered.length} codes`}
        </button>
      </div>

      <div style={{ border: '1px solid var(--line)', borderRadius: '2px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ background: 'var(--paper-2)' }}>
            <tr><th style={thStyle}>Code</th><th style={thStyle}>Item Name</th><th style={thStyle}>Class</th><th style={thStyle}>Gaps</th></tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ ...tdStyle, fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>{r.code}</td>
                <td style={tdStyle}>{r.name}</td>
                <td style={{ ...tdStyle, color: 'var(--ink-soft)', fontSize: '0.85rem' }}>{r.partClass}</td>
                <td style={tdStyle}>
                  {r.issues.length === 0
                    ? <span style={{ color: '#3a7d44', fontSize: '0.8rem' }}>● ok</span>
                    : r.issues.map(iss => (
                        <span key={iss} style={{ display: 'inline-block', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em', background: iss.indexOf('NetSuite') >= 0 ? '#fdf2f2' : 'var(--paper-2)', color: iss.indexOf('NetSuite') >= 0 ? '#d9534f' : 'var(--brass)', border: '1px solid var(--line)', padding: '2px 6px', marginRight: '6px', borderRadius: '2px' }}>{iss}</span>
                      ))}
                  {r.itemIdMismatch && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>itemId≠docId</span>}
                </td>
              </tr>
            ))}
            {loading && <tr><td colSpan={4} style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>Loading parts…</td></tr>}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={4} style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>
                {onlyIssues ? 'No mapping gaps in this view. 🎉' : 'No parts match.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ErpMappingAudit;
