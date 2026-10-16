// 🚚 BASE SHIPPING RATE, PER BRAND — tab 11 (Stuart 2026-10-16: "we should add this control tab 11
// where we can enter base rate shipping per cent for each brand and easily update in the future").
//
// A brand's percent is what the app fills into an EMPTY shipping charge so the freight is never
// left at $0 by accident. It never overrules a figure someone typed, and it never overrules a
// customer's own programme in 4.6 — Fabricut's flat-rate boxes always win (Shared/baseShipping).
//
// A brand left blank is a brand nothing happens to, which is how CE, M2C and Leyla stay exactly as
// they are today.
import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { BRANDS, SHIPPING_CONFIG_DOC, baseRateOf, shipAmountFor } from './baseShipping';

const LABELS = { ce: 'Classical Elements', uniquity: "Uniq'uity (MC America)", m2c: 'M2C Studio', leyla: 'Leyla' };
const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' };

export default function BaseShippingPanel() {
    const [cfg, setCfg] = useState(null);
    const [draft, setDraft] = useState({});
    const [saving, setSaving] = useState('');
    const [err, setErr] = useState('');

    useEffect(() => onSnapshot(doc(db, SHIPPING_CONFIG_DOC.collection, SHIPPING_CONFIG_DOC.id),
        (s) => setCfg({ baseRatePct: {}, ...(s.exists() ? s.data() : {}) }),
        () => setCfg({ baseRatePct: {} })), []);
    // Follow what is stored, so an edit left half-typed on one brand never rides onto another.
    useEffect(() => {
        if (!cfg) return;
        const d = {};
        BRANDS.forEach((b) => { const v = (cfg.baseRatePct || {})[b]; d[b] = v === undefined || v === null || v === '' ? '' : String(v); });
        setDraft(d);
    }, [cfg]);

    if (!cfg) return null;

    const save = async (brand) => {
        setErr(''); setSaving(brand);
        const raw = String(draft[brand] ?? '').trim();
        const pct = raw === '' ? null : Number(raw);
        if (raw !== '' && (!Number.isFinite(pct) || pct <= 0 || pct > 100)) {
            setErr(`${LABELS[brand]}: a rate is a percent between 0 and 100, or blank for none.`);
            setSaving(''); return;
        }
        try {
            // Spread what is stored: writing the map wholesale without it would wipe the other
            // brands' rates (the empty-map merge trap, 2026-10-04).
            const next = { ...(cfg.baseRatePct || {}) };
            if (pct === null) delete next[brand]; else next[brand] = pct;
            await setDoc(doc(db, SHIPPING_CONFIG_DOC.collection, SHIPPING_CONFIG_DOC.id), { baseRatePct: next }, { merge: true });
        } catch (e) { setErr(e.message || String(e)); }
        finally { setSaving(''); }
    };

    return (
        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
            <h4 style={{ margin: '0 0 8px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Base Shipping Rate</h4>
            <p style={{ fontSize: '0.86rem', color: 'var(--ink-soft)', margin: '0 0 18px' }}>
                The percentage of the goods the app fills into an <strong>empty</strong> shipping charge, so freight is
                never missed. It never changes a figure someone typed, and a customer with their own shipping
                programme in 4.6 — Fabricut's flat-rate boxes — always overrules it. Leave a brand blank and nothing
                is defaulted for it.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {BRANDS.map((b) => {
                    const live = baseRateOf(b, cfg);
                    return (
                        <div key={b} style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px dashed var(--line)', paddingBottom: '10px' }}>
                            <span style={{ flex: '1 1 180px', fontSize: '0.95rem' }}>{LABELS[b]}</span>
                            <input
                                type="number" min="0" max="100" step="0.1"
                                value={draft[b] ?? ''} onChange={(e) => setDraft({ ...draft, [b]: e.target.value })}
                                placeholder="none"
                                style={{ width: '90px', padding: '9px', border: '1px solid var(--line)', outline: 'none', textAlign: 'right' }}
                            />
                            <span style={mono}>%</span>
                            <button
                                onClick={() => save(b)} disabled={saving === b}
                                style={{ padding: '9px 14px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: saving === b ? 'wait' : 'pointer', ...mono, color: '#fff' }}
                            >
                                {saving === b ? 'Saving…' : 'Save'}
                            </button>
                            {/* What it would actually charge, so a typo is seen before an order carries it. */}
                            <span style={{ ...mono, flex: '1 1 200px', textAlign: 'right' }}>
                                {live > 0 ? `in force · $1,000 of goods → $${shipAmountFor(1000, live).toFixed(2)}` : 'no default for this brand'}
                            </span>
                        </div>
                    );
                })}
            </div>

            {err && <div style={{ fontSize: '13px', color: '#9b2c2c', marginTop: '12px' }}>✗ {err}</div>}
        </div>
    );
}
