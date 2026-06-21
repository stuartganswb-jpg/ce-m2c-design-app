import React, { useState, useMemo } from 'react';
import { db } from '../../firebase';
import { doc, setDoc } from "firebase/firestore";
import { btnStyle, inputStyle, labelStyle } from './finishingStyles';
import {
    capacityKey, WILDCARD, SIZE_CAPACITY,
    workOrderPartLines, packFootprint, sledsFromFootprint, batchMachineMins,
} from '../Shared/finishingTime';

// Finishing-side production-time configuration. Two non-overlapping inputs live here:
//   1) AI Production Timers (fin_config/settings) = minutes PER STEP (spin setup, spray, oven,
//      hand). Restored here after the old Management tab was unhooked. Runs the live Active Floor.
//   2) Sled Capacity Matrix (fin_config/capacityMatrix) = pieces PER SLED by paint size × product
//      type. The scheduler combines capacity (how many fit) with the timers (time per step) and the
//      recipe's steps to price each batch — capacity and time never overlap.
const SIZES = ['S', 'M', 'L'];
const PLANNABLE = ['Setup', 'setup', 'Painting'];

const ProductionTimes = ({ sysConfig = {}, capacityMatrix = {}, recipes = {}, workOrders = [], prodTypes = [], writeLog, user }) => {
    // Normalize the role (alpha-only) so SUPERADMIN / super_admin / Floor Manager all match,
    // and honor the superAdmin flag. Super admin always has edit access.
    const role = String(user?.role || '').toLowerCase().replace(/[^a-z]/g, '');
    const canEdit = user?.superAdmin === true || ['superadmin', 'admin', 'floormanager', 'paintmanager'].includes(role);

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

    // --- 2) Sled capacity matrix ---
    const [rules, setRules] = useState(() => ({ ...(capacityMatrix?.rules || {}) }));
    const [def, setDef] = useState(capacityMatrix?.default ?? '');
    const [draft, setDraft] = useState({ size: 'S', type: '', cap: '' });

    // Product-type options: HQ master dictionary (system/master_lists.prodTypes) unioned with types
    // already on live work orders, so nothing in the field is unselectable.
    const typeOptions = useMemo(() => {
        const s = new Set((prodTypes || []).map(t => String(t).toUpperCase()).filter(Boolean));
        workOrders.forEach(wo => {
            if (wo.productType) s.add(String(wo.productType).toUpperCase());
            (wo.partsList || []).forEach(p => { if (p.productType) s.add(String(p.productType).toUpperCase()); });
        });
        return [...s].sort();
    }, [prodTypes, workOrders]);

    const addRule = () => {
        const cap = Number(draft.cap);
        if (!draft.cap || isNaN(cap) || cap <= 0) return alert("Enter a valid pieces-per-sled value (> 0).");
        setRules(prev => ({ ...prev, [capacityKey(draft.size, draft.type || WILDCARD)]: cap }));
        setDraft({ ...draft, cap: '' });
    };

    const removeRule = (key) => setRules(prev => { const n = { ...prev }; delete n[key]; return n; });

    const saveMatrix = async () => {
        await setDoc(doc(db, "fin_config", "capacityMatrix"), { rules, default: def === '' ? null : Number(def) });
        if (writeLog) writeLog(`Updated Sled Capacity Matrix (${Object.keys(rules).length} rules)`, "admin");
        alert("Capacity matrix saved.");
    };

    // Live preview: pool everything queued + on the floor BY RECIPE (sleds only mix same recipe),
    // pack each pool into sleds by footprint, and price machine time off the timers + recipe steps.
    const previewMatrix = { rules, default: def === '' ? null : Number(def) };
    const preview = useMemo(() => {
        const plannable = workOrders.filter(w => PLANNABLE.includes(w.currentPhase));
        const byRecipe = {};
        plannable.forEach(wo => { const r = wo.recipe || '(no recipe)'; (byRecipe[r] = byRecipe[r] || []).push(wo); });
        let sleds = 0, mins = 0, unresolved = 0;
        Object.entries(byRecipe).forEach(([rcode, wos]) => {
            const lines = wos.flatMap(workOrderPartLines);
            const { footprint, parts, resolved } = packFootprint(lines, previewMatrix);
            const recipe = recipes[rcode];
            const batches = sledsFromFootprint(footprint, parts);
            const hasHand = !!(recipe?.steps?.some(s => s.app === 'Hand Applied'));
            const handMins = hasHand ? parts * (Number(config.handSmallMins) || 1.35) : 0;
            sleds += batches;
            mins += batches * batchMachineMins(recipe, config) + handMins;
            if (!resolved || !recipe) unresolved += wos.length;
        });
        return { count: plannable.length, sleds, mins, unresolved };
    }, [workOrders, rules, def, recipes, config]); // eslint-disable-line react-hooks/exhaustive-deps

    const labelForKey = (k) => {
        const [s, t] = k.split('|');
        return { size: s === WILDCARD ? 'Any' : s, type: t === WILDCARD ? 'Any' : t };
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
                <h3 style={{ margin: '0 0 6px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>AI Production Timers (Minutes)</h3>
                <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', marginTop: 0, marginBottom: '20px' }}>Time per <strong>step</strong>. Each sprayed recipe step is its own spray + oven bake; hand steps come off the machine. Runs the live Active Floor.</p>
                <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div><label style={labelStyle}>Mix Station</label><input type="number" step="0.1" value={config.mixMins} onChange={e => setConfig({ ...config, mixMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Spin Setup (load sled)</label><input type="number" step="0.1" value={config.spinSetupMins} onChange={e => setConfig({ ...config, spinSetupMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Spin Paint (per step)</label><input type="number" step="0.1" value={config.spinPaintMins} onChange={e => setConfig({ ...config, spinPaintMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Oven Bake (per step)</label><input type="number" step="0.1" value={config.ovenMins} onChange={e => setConfig({ ...config, ovenMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Hand Finish (Small)</label><input type="number" step="0.1" value={config.handSmallMins} onChange={e => setConfig({ ...config, handSmallMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Hand Finish (Pole)</label><input type="number" step="0.1" value={config.handPoleMins} onChange={e => setConfig({ ...config, handPoleMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Pole Paint (Per Piece)</label><input type="number" step="0.1" value={config.poleMins} onChange={e => setConfig({ ...config, poleMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={{ ...labelStyle, color: 'var(--brass)' }}>Pot Life</label><input type="number" step="1" value={config.potLifeMins} onChange={e => setConfig({ ...config, potLifeMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <div><label style={{ ...labelStyle, color: '#d9534f' }}>Recoat Window</label><input type="number" step="1" value={config.recoatMins} onChange={e => setConfig({ ...config, recoatMins: Number(e.target.value) })} style={inputStyle} /></div>
                    <button onClick={saveTimers} style={{ ...btnStyle, gridColumn: '1 / -1', marginTop: '8px' }}>Save Timers</button>
                </div>
            </div>

            {/* 2) CAPACITY MATRIX */}
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                    <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Sled Capacity Matrix</h3>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>pieces per sled</span>
                </div>
                <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', marginTop: 0, marginBottom: '24px', lineHeight: 1.5 }}>
                    How many of a part fill one sled, by <strong>paint size × product type</strong>. Size sets the baseline
                    (<strong>S {SIZE_CAPACITY.S} · M {SIZE_CAPACITY.M} · L {SIZE_CAPACITY.L}</strong>); add a product-type entry to
                    refine it (e.g. a bracket-M that fits 40). The scheduler packs mixed parts of the <strong>same recipe</strong>
                    onto a sled until they fill it, then prices the batch from the timers above. Capacity is physical — recipe is not a key.
                </p>

                {/* live preview */}
                <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: '2px', padding: '16px 20px', marginBottom: '24px', display: 'flex', gap: '32px', alignItems: 'center' }}>
                    <div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Queued + On Floor</div>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)' }}>{preview.count} WOs</div>
                    </div>
                    <div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Sleds (same-recipe packed)</div>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)' }}>{preview.sleds}</div>
                    </div>
                    <div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Est. Machine Time</div>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)' }}>{Math.round(preview.mins)} min · {(preview.mins / 60).toFixed(1)} h</div>
                    </div>
                    {preview.unresolved > 0 && (
                        <div style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', border: '1px solid #d9534f', padding: '6px 10px', borderRadius: '2px' }}>
                            {preview.unresolved} WO{preview.unresolved === 1 ? '' : 's'} unpriced — missing capacity or recipe
                        </div>
                    )}
                </div>

                {/* add-rule row */}
                <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', padding: '20px', marginBottom: '24px', display: 'grid', gridTemplateColumns: '1fr 1.6fr 1fr auto', gap: '16px', alignItems: 'end', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div>
                        <label style={labelStyle}>Paint Size</label>
                        <select value={draft.size} onChange={e => setDraft({ ...draft, size: e.target.value })} style={{ ...inputStyle, background: '#fff' }}>
                            {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Product Type</label>
                        <select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })} style={{ ...inputStyle, background: '#fff' }}>
                            <option value="">Any type (size baseline)</option>
                            {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div>
                        <label style={labelStyle}>Pieces / Sled</label>
                        <input type="number" step="1" min="1" value={draft.cap} onChange={e => setDraft({ ...draft, cap: e.target.value })} style={inputStyle} />
                    </div>
                    <button onClick={addRule} style={{ ...btnStyle, height: 'fit-content' }}>Add</button>
                </div>

                {/* rules table */}
                <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', overflow: 'hidden', marginBottom: '24px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: 'var(--paper)' }}>
                            <tr><th style={cellHead}>Paint Size</th><th style={cellHead}>Product Type</th><th style={{ ...cellHead, textAlign: 'right' }}>Pieces / Sled</th><th style={cellHead}></th></tr>
                        </thead>
                        <tbody>
                            {Object.keys(rules).length === 0 ? (
                                <tr><td colSpan={4} style={{ ...cell, textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.1rem' }}>No overrides — every size uses its baseline (S {SIZE_CAPACITY.S} · M {SIZE_CAPACITY.M} · L {SIZE_CAPACITY.L}). Add a row to refine a product type.</td></tr>
                            ) : Object.keys(rules).sort().map(k => {
                                const L = labelForKey(k);
                                return (
                                    <tr key={k}>
                                        <td style={cell}>{L.size}</td>
                                        <td style={cell}>{L.type}</td>
                                        <td style={{ ...cell, textAlign: 'right' }}>
                                            <input type="number" step="1" min="1" value={rules[k]} onChange={e => setRules(prev => ({ ...prev, [k]: e.target.value }))} style={{ ...inputStyle, width: '90px', textAlign: 'right', padding: '6px 8px' }} />
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
                        <label style={labelStyle}>Fallback pieces/sled (unknown size)</label>
                        <input type="number" step="1" min="1" value={def} onChange={e => setDef(e.target.value)} placeholder="(none)" style={{ ...inputStyle, width: '220px' }} />
                    </div>
                    <button onClick={saveMatrix} style={{ ...btnStyle, marginLeft: 'auto' }}>Save Capacity Matrix</button>
                </div>
            </div>
        </div>
    );
};

export default ProductionTimes;
