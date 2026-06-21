import React, { useState, useMemo } from 'react';
import { db } from '../../firebase';
import { doc, setDoc } from "firebase/firestore";
import { btnStyle, inputStyle, labelStyle } from './finishingStyles';
import { matrixKey, WILDCARD, estimateWorkOrderMins } from '../Shared/finishingTime';

// Finishing-side production-time configuration. Two things live here:
//   1) AI Production Timers — the global per-operation minutes (fin_config/settings). This editor
//      was orphaned when the old Management tab was unhooked; it's restored here.
//   2) The Finishing Time Matrix — minutes-per-part keyed by recipe × paint size × product type
//      (fin_config/timeMatrix). The scheduler resolves every WO's duration from this table.
const SIZES = ['S', 'M', 'L'];

const ProductionTimes = ({ sysConfig = {}, timeMatrix = {}, recipes = {}, workOrders = [], prodTypes = [], writeLog, user }) => {
    const canEdit = ['admin', 'floor_manager', 'paint_manager'].includes(user?.role);

    // --- 1) Global timers (restored) ---
    const [config, setConfig] = useState({
        mixMins: sysConfig?.mixMins ?? 5,
        spinSetupMins: sysConfig?.spinSetupMins ?? 10,
        spinPaintMins: sysConfig?.spinPaintMins ?? 3,
        ovenMins: sysConfig?.ovenMins ?? 10,
        handSmallMins: sysConfig?.handSmallMins ?? 1.35,
        handPoleMins: sysConfig?.handPoleMins ?? 10,
        poleMins: sysConfig?.poleMins ?? 5,
        potLifeMins: sysConfig?.potLifeMins ?? 189,
        recoatMins: sysConfig?.recoatMins ?? 90,
    });

    const saveTimers = async () => {
        await setDoc(doc(db, "fin_config", "settings"), config, { merge: true });
        if (writeLog) writeLog("Updated AI Production Timers", "admin");
        alert("Timers saved.");
    };

    // --- 2) Time matrix ---
    const [rules, setRules] = useState(() => ({ ...(timeMatrix?.rules || {}) }));
    const [def, setDef] = useState(timeMatrix?.default ?? '');
    const [draft, setDraft] = useState({ recipe: WILDCARD, size: 'S', type: '', mins: '' });

    // Product-type options: the HQ master dictionary (system/master_lists.prodTypes) is the source
    // of truth, unioned with any types already seen on live work orders so nothing in the field is
    // unselectable. Uppercased + de-duped to match how productType is stored.
    const typeOptions = useMemo(() => {
        const s = new Set((prodTypes || []).map(t => String(t).toUpperCase()).filter(Boolean));
        workOrders.forEach(wo => {
            if (wo.productType) s.add(String(wo.productType).toUpperCase());
            (wo.partsList || []).forEach(p => { if (p.productType) s.add(String(p.productType).toUpperCase()); });
        });
        return [...s].sort();
    }, [prodTypes, workOrders]);

    const recipeCodes = useMemo(() => Object.keys(recipes || {}).sort(), [recipes]);

    const addRule = () => {
        const mins = Number(draft.mins);
        if (!draft.mins || isNaN(mins) || mins < 0) return alert("Enter a valid minutes-per-part value.");
        const key = matrixKey(draft.recipe, draft.size, draft.type || WILDCARD);
        setRules(prev => ({ ...prev, [key]: mins }));
        setDraft({ ...draft, mins: '' });
    };

    const removeRule = (key) => setRules(prev => { const n = { ...prev }; delete n[key]; return n; });

    const saveMatrix = async () => {
        const payload = { rules, default: def === '' ? null : Number(def) };
        await setDoc(doc(db, "fin_config", "timeMatrix"), payload);
        if (writeLog) writeLog(`Updated Finishing Time Matrix (${Object.keys(rules).length} rules)`, "admin");
        alert("Time matrix saved.");
    };

    // Live preview: total estimated machine-minutes for everything currently queued/painting,
    // using the in-progress (unsaved) matrix so you see the effect of edits immediately.
    const previewMatrix = { rules, default: def === '' ? null : Number(def) };
    const preview = useMemo(() => {
        const plannable = workOrders.filter(w => ['Setup', 'setup', 'Painting'].includes(w.currentPhase));
        let mins = 0, unresolved = 0;
        plannable.forEach(wo => {
            const r = estimateWorkOrderMins(wo, previewMatrix);
            mins += r.mins;
            if (!r.resolved) unresolved++;
        });
        return { count: plannable.length, mins, unresolved };
    }, [workOrders, rules, def]); // eslint-disable-line react-hooks/exhaustive-deps

    const labelForKey = (k) => {
        const [r, s, t] = k.split('|');
        const show = (v) => v === WILDCARD ? 'Any' : v;
        return { recipe: show(r), size: show(s), type: show(t) };
    };

    if (!canEdit) {
        return <div style={{ padding: '40px', fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink-soft)', fontStyle: 'italic', textAlign: 'center' }}>Access Denied. Admin, Floor Manager, or Paint Manager only.</div>;
    }

    const cellHead = { padding: '12px 14px', textAlign: 'left', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' };
    const cell = { padding: '12px 14px', borderBottom: '1px solid var(--line)', fontSize: '0.9rem', color: 'var(--ink)' };

    return (
        <div style={{ padding: '40px', maxWidth: '1100px', margin: '0 auto', fontFamily: 'var(--sans)' }}>
            <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '40px' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Finishing Configuration</span>
                <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500, color: 'var(--ink)' }}>Production Times</h2>
            </div>

            {/* 1) GLOBAL TIMERS */}
            <div style={{ marginBottom: '50px' }}>
                <h3 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>AI Production Timers (Minutes)</h3>
                <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div><label style={labelStyle}>Mix Station</label><input type="number" step="0.1" value={config.mixMins} onChange={e => setConfig({ ...config, mixMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Spin Setup (Small Parts)</label><input type="number" step="0.1" value={config.spinSetupMins} onChange={e => setConfig({ ...config, spinSetupMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Spin Paint Time</label><input type="number" step="0.1" value={config.spinPaintMins} onChange={e => setConfig({ ...config, spinPaintMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Oven Bake Time</label><input type="number" step="0.1" value={config.ovenMins} onChange={e => setConfig({ ...config, ovenMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Hand Finish (Small)</label><input type="number" step="0.1" value={config.handSmallMins} onChange={e => setConfig({ ...config, handSmallMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Hand Finish (Pole)</label><input type="number" step="0.1" value={config.handPoleMins} onChange={e => setConfig({ ...config, handPoleMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Pole Paint (Per Piece)</label><input type="number" step="0.1" value={config.poleMins} onChange={e => setConfig({ ...config, poleMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={{ ...labelStyle, color: 'var(--brass)' }}>Pot Life</label><input type="number" step="1" value={config.potLifeMins} onChange={e => setConfig({ ...config, potLifeMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={{ ...labelStyle, color: '#d9534f' }}>Recoat Window</label><input type="number" step="1" value={config.recoatMins} onChange={e => setConfig({ ...config, recoatMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <button onClick={saveTimers} style={{ ...btnStyle, gridColumn: '1 / -1', marginTop: '8px' }}>Save Timers</button>
                </div>
            </div>

            {/* 2) TIME MATRIX */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                    <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Finishing Time Matrix</h3>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>minutes per part</span>
                </div>
                <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', marginTop: 0, marginBottom: '24px', lineHeight: 1.5 }}>
                    Assign a minutes-per-part time by <strong>recipe × paint size × product type</strong>. Use <strong>Any</strong> for a
                    dimension to make a broad rule; the most specific matching rule wins, falling back to the table default.
                    A part's three attributes pick its cell automatically — nothing is stored per item.
                </p>

                {/* live capacity preview */}
                <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: '2px', padding: '16px 20px', marginBottom: '24px', display: 'flex', gap: '32px', alignItems: 'center' }}>
                    <div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Queued + On Floor</div>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)' }}>{preview.count} WOs</div>
                    </div>
                    <div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Est. Finishing Time</div>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)' }}>{Math.round(preview.mins)} min · {(preview.mins / 60).toFixed(1)} h</div>
                    </div>
                    {preview.unresolved > 0 && (
                        <div style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', border: '1px solid #d9534f', padding: '6px 10px', borderRadius: '2px' }}>
                            {preview.unresolved} WO{preview.unresolved === 1 ? '' : 's'} unpriced — add rules or a default
                        </div>
                    )}
                </div>

                {/* add-rule row */}
                <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', padding: '20px', marginBottom: '24px', display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.4fr 0.9fr auto', gap: '16px', alignItems: 'end', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div>
                        <label style={labelStyle}>Recipe</label>
                        <select value={draft.recipe} onChange={e => setDraft({ ...draft, recipe: e.target.value })} style={{ ...inputStyle, background: '#fff' }}>
                            <option value={WILDCARD}>Any recipe</option>
                            {recipeCodes.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Paint Size</label>
                        <select value={draft.size} onChange={e => setDraft({ ...draft, size: e.target.value })} style={{ ...inputStyle, background: '#fff' }}>
                            {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                            <option value={WILDCARD}>Any</option>
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Product Type</label>
                        <select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })} style={{ ...inputStyle, background: '#fff' }}>
                            <option value="">Any type</option>
                            {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Min / Part</label>
                        <input type="number" step="0.05" min="0" value={draft.mins} onChange={e => setDraft({ ...draft, mins: e.target.value })} style={inputStyle} />
                    </div>
                    <button onClick={addRule} style={{ ...btnStyle, height: 'fit-content' }}>Add Rule</button>
                </div>

                {/* rules table */}
                <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', overflow: 'hidden', marginBottom: '24px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: 'var(--paper)' }}>
                            <tr><th style={cellHead}>Recipe</th><th style={cellHead}>Size</th><th style={cellHead}>Product Type</th><th style={{ ...cellHead, textAlign: 'right' }}>Min / Part</th><th style={cellHead}></th></tr>
                        </thead>
                        <tbody>
                            {Object.keys(rules).length === 0 ? (
                                <tr><td colSpan={5} style={{ ...cell, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.1rem' }}>No rules yet — add one above, or set a default below.</td></tr>
                            ) : Object.keys(rules).sort().map(k => {
                                const L = labelForKey(k);
                                return (
                                    <tr key={k}>
                                        <td style={cell}>{L.recipe}</td>
                                        <td style={cell}>{L.size}</td>
                                        <td style={cell}>{L.type}</td>
                                        <td style={{ ...cell, textAlign: 'right' }}>
                                            <input type="number" step="0.05" min="0" value={rules[k]} onChange={e => setRules(prev => ({ ...prev, [k]: e.target.value }))} style={{ ...inputStyle, width: '90px', textAlign: 'right', padding: '6px 8px' }} />
                                        </td>
                                        <td style={{ ...cell, textAlign: 'right' }}>
                                            <button onClick={() => removeRule(k)} style={{ background: 'transparent', color: '#d9534f', border: '1px solid var(--line)', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer' }}>Del</button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                <div style={{ display: 'flex', alignItems: 'end', gap: '20px' }}>
                    <div>
                        <label style={labelStyle}>Default (min/part, when no rule matches)</label>
                        <input type="number" step="0.05" min="0" value={def} onChange={e => setDef(e.target.value)} placeholder="(none)" style={{ ...inputStyle, width: '220px' }} />
                    </div>
                    <button onClick={saveMatrix} style={{ ...btnStyle, marginLeft: 'auto' }}>Save Time Matrix</button>
                </div>
            </div>
        </div>
    );
};

export default ProductionTimes;
