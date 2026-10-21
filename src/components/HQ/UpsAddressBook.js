// 📒 ADDRESSES WE RATE FROM, OVER AND OVER — HQ 9.5 (Stuart 2026-10-21: "i have around 6 address i
// would like to preload as we will use them over and over and it would be very easy to just select
// them").
//
// Suppliers, mostly abroad, and our own docks. They live in system/ups_config.addressBook so the
// live rate check can offer them at either end — an INBOUND quote is a supplier in the From box and
// us in the To box.
//
// Nothing here ships anything. It is a list of places, kept so nobody retypes a Shenzhen address
// into a rate check at eight in the morning and mistypes the postal code.
import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../firebase';

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)' };
const input = { padding: '9px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', width: '100%', boxSizing: 'border-box' };
const FIELDS = [
    ['label', 'Name for the list', 'Shenzhen supplier'],
    ['addressee', 'Company', 'Fuhua Textiles Ltd'],
    ['addr1', 'Street', '1 Fuhua Road'],
    ['addr2', 'Street 2', ''],
    ['city', 'City', 'Shenzhen'],
    ['state', 'State / province', 'only where used'],
    ['zip', 'Postal code', '518048'],
    ['country', 'Country (2 letters)', 'CN'],
    ['phone', 'Phone', ''],
];

export const addressBookOf = (cfg) => (Array.isArray(cfg && cfg.addressBook) ? cfg.addressBook : []);

export default function UpsAddressBook() {
    const [cfg, setCfg] = useState(null);
    const [draft, setDraft] = useState(null);     // { idx, row } — idx -1 is a new one
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState('');

    useEffect(() => onSnapshot(doc(db, 'system', 'ups_config'),
        (s) => setCfg({ addressBook: [], ...(s.exists() ? s.data() : {}) }),
        () => setCfg({ addressBook: [] })), []);
    if (!cfg) return null;
    const list = addressBookOf(cfg);

    const write = async (next) => {
        setErr(''); setSaving(true);
        try {
            await setDoc(doc(db, 'system', 'ups_config'), { addressBook: next }, { merge: true });
            setDraft(null);
        } catch (e) { setErr(e.message || String(e)); }
        finally { setSaving(false); }
    };

    const save = () => {
        const row = draft.row;
        if (!String(row.label || '').trim()) { setErr('Give it a name so it can be picked from the list.'); return; }
        const next = [...list];
        if (draft.idx < 0) next.push(row); else next[draft.idx] = row;
        write(next);
    };

    const remove = (i) => {
        if (!window.confirm(`Remove "${list[i].label || 'this address'}" from the list?\n\nNothing that has already shipped is affected.`)) return;
        write(list.filter((_, j) => j !== i));
    };

    return (
        <div style={{ border: '1px solid var(--line)', background: '#fff', padding: '20px', marginTop: '16px' }}>
            <div style={{ ...mono, color: 'var(--brass)', marginBottom: '6px' }}>📒 Saved addresses</div>
            <p style={{ fontSize: '0.88rem', color: 'var(--ink-soft)', margin: '0 0 14px' }}>
                Suppliers and docks you rate against repeatedly. Pick one at either end of a live rate check — a
                supplier in the <strong>From</strong> box and us in the <strong>To</strong> box is an inbound quote.
            </p>

            {list.length === 0 && <div style={{ fontSize: '13px', color: 'var(--ink-soft)', marginBottom: '10px' }}>None saved yet.</div>}
            {list.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px dashed var(--line)', padding: '9px 0' }}>
                    <span style={{ flex: '1 1 170px', fontSize: '0.95rem' }}>{a.label || '(unnamed)'}</span>
                    <span style={{ ...mono, flex: '2 1 300px' }}>
                        {[a.addressee, a.city, a.state, a.zip, a.country].filter(Boolean).join(' · ')}
                    </span>
                    <button onClick={() => setDraft({ idx: i, row: { ...a } })} style={{ ...mono, padding: '6px 11px', background: 'transparent', border: '1px solid var(--line)', cursor: 'pointer', color: 'var(--ink)' }}>Edit</button>
                    <button onClick={() => remove(i)} style={{ ...mono, padding: '6px 11px', background: 'transparent', border: '1px solid #b3362f', cursor: 'pointer', color: '#b3362f' }}>Remove</button>
                </div>
            ))}

            {!draft && (
                <button onClick={() => setDraft({ idx: -1, row: { country: 'US' } })} style={{ ...mono, padding: '9px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', marginTop: '12px' }}>
                    + Add an address
                </button>
            )}

            {draft && (
                <div style={{ marginTop: '12px', background: 'var(--paper-2)', padding: '14px', border: '1px solid var(--line)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
                        {FIELDS.map(([f, lab, ph]) => (
                            <div key={f}>
                                <div style={{ ...mono, marginBottom: '4px' }}>{lab}</div>
                                <input
                                    style={input} value={draft.row[f] ?? ''} placeholder={ph}
                                    maxLength={f === 'country' ? 2 : undefined}
                                    onChange={(e) => setDraft({ ...draft, row: { ...draft.row, [f]: f === 'country' ? e.target.value.toUpperCase() : e.target.value } })}
                                />
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button onClick={save} disabled={saving} style={{ ...mono, padding: '9px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: saving ? 'wait' : 'pointer' }}>
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => { setDraft(null); setErr(''); }} style={{ ...mono, padding: '9px 16px', background: 'transparent', border: '1px solid var(--line)', cursor: 'pointer', color: 'var(--ink)' }}>Cancel</button>
                        <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                            Leave the state or postal code empty where the country does not use one — UPS is told only what it asks for.
                        </span>
                    </div>
                </div>
            )}
            {err && <div style={{ fontSize: '13px', color: '#9b2c2c', marginTop: '10px' }}>✗ {err}</div>}
        </div>
    );
}
