// 📦 UPS ACCOUNTS, PER BRAND — HQ 9.5 (Stuart 2026-10-21: "ideally we add all the account #'s on
// the main ups integrations page", and "both have a domestic to use and an international intl
// account, all are accessed under one login").
//
// His UPS profile, 2026-10-21:
//     CE Domestic   16FH19   (default)      CE Intl          19549H
//     MC America    22V17C                  MC America Intl  22V17D
// CE's pair serves Classical Elements AND M2C Studio, so M2C's row says "same as CE" rather than
// repeating the numbers — one place to change them when they change.
//
// A UPS account number is printed on every label and is not a secret; it lives in
// system/ups_config.shippers. The OAuth client id and secret are secrets and stay in Secret
// Manager. The DESTINATION picks which of a brand's two accounts is used, for rating and for the
// label alike — quoting on one and billing the other is the mistake this shape prevents.
import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';

const BRANDS = [
    { key: 'ce', label: 'Classical Elements' },
    { key: 'uniquity', label: "Uniq'uity (MC America)" },
    { key: 'm2c', label: 'M2C Studio' },
    { key: 'leyla', label: 'Leyla' },
];
const FIELDS = [
    ['accountDomestic', 'Domestic account', '16FH19'],
    ['accountIntl', 'International account', '19549H'],
    ['name', 'Shipper name', 'Classical Elements'],
    ['phone', 'Phone', '3369673313'],
    ['addr1', 'Street', '1200 Redding Dr'],
    ['city', 'City', 'High Point'],
    ['state', 'State', 'NC'],
    ['zip', 'ZIP', '27260'],
];
const mono = { fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const input = { padding: '9px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', width: '100%', boxSizing: 'border-box' };

export default function UpsAccountsPanel() {
    const [cfg, setCfg] = useState(null);
    const [open, setOpen] = useState('');
    const [draft, setDraft] = useState({});
    const [saving, setSaving] = useState('');
    const [err, setErr] = useState('');

    useEffect(() => onSnapshot(doc(db, 'system', 'ups_config'),
        (s) => setCfg({ shippers: {}, ...(s.exists() ? s.data() : {}) }),
        () => setCfg({ shippers: {} })), []);
    useEffect(() => { if (cfg && open) setDraft({ ...(((cfg.shippers) || {})[open] || {}) }); }, [cfg, open]);

    if (!cfg) return null;
    const shippers = cfg.shippers || {};

    const save = async (brand, row) => {
        setErr(''); setSaving(brand);
        try {
            await setDoc(doc(db, 'system', 'ups_config'), { shippers: { ...shippers, [brand]: row } }, { merge: true });
            setOpen('');
        } catch (e) { setErr(e.message || String(e)); }
        finally { setSaving(''); }
    };

    const inForce = (b) => {
        let row = shippers[b]; const seen = new Set();
        while (row && row.sameAs && !seen.has(row.sameAs)) { seen.add(row.sameAs); row = shippers[row.sameAs]; }
        return row || null;
    };

    return (
        <div style={{ border: '1px solid var(--line)', background: '#fff', padding: '20px', marginTop: '16px' }}>
            <div style={{ ...mono, color: 'var(--brass)', marginBottom: '6px' }}>📦 UPS accounts, per brand</div>
            <p style={{ fontSize: '0.88rem', color: 'var(--ink-soft)', margin: '0 0 16px' }}>
                Each brand ships on its own UPS account, and the <strong>destination</strong> picks which of its two —
                a shipment crossing a border is rated <em>and</em> billed on the international account. A brand with
                nothing here refuses rather than shipping on another company's number.
            </p>

            {BRANDS.map(({ key, label }) => {
                const row = shippers[key] || null;
                const live = inForce(key);
                return (
                    <div key={key} style={{ borderTop: '1px dashed var(--line)', padding: '10px 0' }}>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ flex: '1 1 180px', fontSize: '0.95rem' }}>{label}</span>
                            <span style={{ ...mono, flex: '1 1 260px' }}>
                                {row && row.sameAs ? `same accounts as ${String(row.sameAs).toUpperCase()}`
                                    : live ? `${live.accountDomestic || '—'} domestic · ${live.accountIntl || '—'} intl`
                                        : 'none — this brand cannot ship'}
                            </span>
                            <button onClick={() => setOpen(open === key ? '' : key)} style={{ ...mono, padding: '6px 12px', background: 'transparent', border: '1px solid var(--line)', cursor: 'pointer', color: 'var(--ink)' }}>
                                {open === key ? 'Close' : 'Edit'}
                            </button>
                        </div>

                        {open === key && (
                            <div style={{ marginTop: '10px', background: 'var(--paper-2)', padding: '14px', border: '1px solid var(--line)' }}>
                                {/* CE and M2C share a pair of accounts — said once, not typed twice. */}
                                <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.88rem', marginBottom: '12px' }}>
                                    <input type="checkbox" checked={!!draft.sameAs} onChange={(e) => setDraft(e.target.checked ? { sameAs: 'ce' } : {})} />
                                    Uses the same accounts as another brand
                                </label>
                                {draft.sameAs ? (
                                    <select style={{ ...input, maxWidth: '260px' }} value={draft.sameAs} onChange={(e) => setDraft({ sameAs: e.target.value })}>
                                        {BRANDS.filter(b => b.key !== key).map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
                                    </select>
                                ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
                                        {FIELDS.map(([f, lab, ph]) => (
                                            <div key={f}>
                                                <div style={{ ...mono, marginBottom: '4px' }}>{lab}</div>
                                                <input style={input} value={draft[f] ?? ''} placeholder={ph} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
                                    <button onClick={() => save(key, draft)} disabled={saving === key} style={{ ...mono, padding: '9px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: saving === key ? 'wait' : 'pointer' }}>
                                        {saving === key ? 'Saving…' : 'Save'}
                                    </button>
                                    <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                                        Leave the international box empty and the domestic account is used for everything.
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
            {err && <div style={{ fontSize: '13px', color: '#9b2c2c', marginTop: '10px' }}>✗ {err}</div>}
        </div>
    );
}
