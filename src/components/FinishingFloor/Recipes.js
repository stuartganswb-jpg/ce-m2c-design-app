import React, { useState } from 'react';
import { finishingDb as db } from '../../firebase'; 
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { cardStyle, btnStyle, inputStyle, labelStyle, sectionHeaderStyle } from './finishingStyles';

const Recipes = ({ recipes, paintProfiles, supplies, writeLog, user }) => {
    const [rCode, setRCode] = useState("");
    const [rName, setRName] = useState("");
    const [steps, setSteps] = useState([
        {step:1, color:'', app:'Sprayed'}, {step:2, color:'', app:'None'}, 
        {step:3, color:'', app:'None'}, {step:4, color:'', app:'None'}, {step:5, color:'', app:'None'}
    ]);
    const [instructions, setInstructions] = useState(""); 
    const [base, setBase] = useState("");
    const [cat, setCat] = useState("");
    const [rBase, setRBase] = useState("");
    const [rCat, setRCat] = useState("");

    const paintSupplies = supplies.filter(s => s.cat === "Paint/Chemical").map(s => s.name);

    const handleSaveRecipe = async () => {
        if(!rCode) return alert("Recipe needs a Finish ID");
        const safeCode = rCode.trim().toUpperCase().replace(/\//g, '-');
        // THE ID IS THE MATCHING KEY (Stuart 2026-08-11: "grace is putting in too much in the id
        // field, which will cause this new rule to fail"). Work orders resolve their recipe — and
        // the -S/-P stream variants — by this EXACT code, so it must stay a short machine code.
        // Descriptions belong in the Name field, same split as HQ 4.5 In-House Master Finishes.
        if (!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(safeCode)) {
            return alert(`"${rCode}" won't work as a Finish ID.\n\nThe ID is the short MACHINE CODE work orders match on — letters/numbers/dashes only, 12 characters max, no spaces. Examples: CP · RF1 · CP-S · CP-P\n\nPut the description ("Champagne 587, poles, 4 coats…") in the Descriptive Name field next to it.`);
        }
        const activeSteps = steps.filter(s => s.app !== "None" && s.color);
        if(activeSteps.length === 0) return alert("You must define at least one step and select a color.");

        const cleanedSteps = activeSteps.map((s, idx) => ({ ...s, step: idx + 1 }));

        await setDoc(doc(db, "fin_recipes", safeCode), { code: safeCode, name: rName.trim(), steps: cleanedSteps, instructions });
        if (writeLog) writeLog(`Updated Recipe: ${safeCode}${rName.trim() ? ` — ${rName.trim()}` : ''}`, 'recipes');
        setRCode("");
        setRName("");
        setInstructions("");
        setSteps([{step:1, color:'', app:'Sprayed'}, {step:2, color:'', app:'None'}, {step:3, color:'', app:'None'}, {step:4, color:'', app:'None'}, {step:5, color:'', app:'None'}]);
    };

    const handleEditRecipe = (r) => {
        setRCode(r.code);
        setRName(r.name || "");
        setInstructions(r.instructions || "");
        let loadedSteps = r.steps?.map(s => ({ ...s })) || [];
        while (loadedSteps.length < 5) loadedSteps.push({ step: loadedSteps.length + 1, color: '', app: 'None' });
        setSteps(loadedSteps);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSaveProfile = async () => {
        if(!base || !rBase) return alert("Base color and base ratio are required fields");
        
        const safeBaseID = base.replace(/\//g, '-');

        try {
            await setDoc(doc(db, "fin_paint_profiles", safeBaseID), { 
                base, 
                cat, 
                rBase, 
                rCat: rCat || "0" 
            });
            if (writeLog) writeLog(`Updated Paint Profile: ${base}`, 'recipes');
            
            setBase(""); setCat(""); setRBase(""); setRCat("");
        } catch (error) {
            console.error("Firebase error saving profile:", error);
            alert("Error saving profile. Check the console for details.");
        }
    };

    const handleEditProfile = (p) => {
        setBase(p.base || "");
        setCat(p.cat || "");
        setRBase(p.rBase || "");
        setRCat(p.rCat || "");
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const updateStep = (index, field, value) => {
        const newSteps = [...steps];
        newSteps[index][field] = value;
        setSteps(newSteps);
    };

    const addStepRow = () => setSteps([...steps, { step: steps.length + 1, color: '', app: 'None' }]);

    // EDIT / DELETE GATE — normalised (Stuart 2026-08-01: "did we lose the ability to edit or delete
    // a recipe?"). It was an exact match against the underscored spellings, so a role stored as
    // "Paint Manager", "PAINT_MANAGER" or "paintManager" — all of which the app uses elsewhere —
    // silently hid the buttons, and SUPER ADMIN was missing entirely, which is the standing gotcha
    // on this codebase (a super admin reaches the tab and then cannot use it).
    const roleKey = String(user?.role || '').toLowerCase().replace(/[^a-z]/g, '');
    const canEdit = !!user && (user.superAdmin === true || ['admin', 'superadmin', 'floormanager', 'paintmanager', 'programmer'].includes(roleKey));

    return (
        <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'var(--sans)' }}>
            <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '40px' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Formula Management</span>
                <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500, color: 'var(--ink)' }}>Finish Recipes & Mixing Profiles</h2>
            </div>
            
            {/* TOP HALF: FORMS */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '40px', marginBottom: '60px' }}>
                <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '32px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <h3 style={sectionHeaderStyle}>Recipe Builder</h3>
                    {/* ID + NAME, same split as HQ 4.5 In-House Master Finishes: the ID is the short
                        machine code work orders (and the -S/-P stream variants) match on; the name
                        carries the description that used to get crammed into the ID. */}
                    <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '16px', marginBottom: '8px' }}>
                        <div>
                            <label style={labelStyle}>Finish ID</label>
                            <input value={rCode} onChange={e => setRCode(e.target.value.toUpperCase())} placeholder="e.g. CP-P" maxLength={12} style={{...inputStyle, fontSize: '1.1rem', fontFamily: 'var(--mono)', textTransform: 'uppercase'}} />
                        </div>
                        <div>
                            <label style={labelStyle}>Descriptive Name</label>
                            <input value={rName} onChange={e => setRName(e.target.value)} placeholder="e.g. Champagne 587 — POLES (4 coats, DTM-7, hand, 30 sheen)" style={{...inputStyle, fontSize: '1.1rem'}} />
                        </div>
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', letterSpacing: '.04em', marginBottom: '24px' }}>
                        The ID must exactly match the code on the work order (CP, RF1, N25…). Variants of the SAME color: <strong>-S</strong> = small parts · <strong>-P</strong> = poles (e.g. CP-S / CP-P) — the floor picks them automatically.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {steps.map((s, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: '16px', alignItems: 'center' }}>
                                <strong style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>S{s.step}</strong>
                                <select value={s.color} onChange={e => updateStep(i, 'color', e.target.value)} style={inputStyle}>
                                    <option value="">Select Color...</option>
                                    {paintSupplies.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                                <select value={s.app} onChange={e => updateStep(i, 'app', e.target.value)} style={inputStyle}>
                                    <option>None</option><option>Sprayed</option><option>Hand Applied</option>
                                </select>
                            </div>
                        ))}
                    </div>
                    <button onClick={addStepRow} style={{ width: '100%', padding: '12px', background: 'transparent', color: 'var(--ink-soft)', border: '1px dashed var(--line)', marginTop: '24px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Add Another Step</button>
                    
                    <div style={{ marginTop: '24px', borderTop: '1px solid var(--line)', paddingTop: '24px' }}>
                        <label style={{...labelStyle, color: 'var(--ink)'}}>Floor Application Instructions</label>
                        <textarea 
                            value={instructions} 
                            onChange={e => setInstructions(e.target.value)} 
                            placeholder="Type step-by-step physical SOP instructions here..." 
                            style={{ ...inputStyle, minHeight: '100px', resize: 'vertical' }}
                        />
                    </div>

                    <button onClick={handleSaveRecipe} style={{ ...btnStyle, width: '100%', marginTop: '24px' }}>Save Recipe</button>
                </div>

                <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '32px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', height: 'fit-content' }}>
                    <h3 style={sectionHeaderStyle}>Paint Mixing Profiles</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px', marginBottom: '24px' }}>
                        <div><label style={labelStyle}>Base Color</label><select value={base} onChange={e=>setBase(e.target.value)} style={inputStyle}><option value="">Select...</option>{paintSupplies.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select></div>
                        <div><label style={labelStyle}>Catalyst (Optional)</label><select value={cat} onChange={e=>setCat(e.target.value)} style={inputStyle}><option value="">Select...</option>{paintSupplies.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        <div><label style={labelStyle}>Base Ratio (Parts)</label><input type="number" step="0.1" value={rBase} onChange={e=>setRBase(e.target.value)} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Cat Ratio (Parts)</label><input type="number" step="0.1" value={rCat} onChange={e=>setRCat(e.target.value)} style={inputStyle} /></div>
                    </div>
                    <button onClick={handleSaveProfile} style={{ ...btnStyle, background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', width: '100%', marginTop: '32px' }}>Save Mix Profile</button>
                </div>
            </div>
            
            {/* BOTTOM HALF: DICTIONARIES */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '40px' }}>
                
                {/* RECIPE LIST */}
                <div>
                    <h3 style={sectionHeaderStyle}>Saved Recipe Dictionary</h3>
                    {/* MASTER-GROUPED (Stuart 2026-08-11): the master (CP) is the top level; its
                        -S/-P stream variants live INSIDE the card as checkboxes — check to create
                        (starts as a copy of the master's steps), uncheck to delete. Matches the
                        4.5 In-House Master Finishes view so the two screens read the same. */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                       {(() => {
                            const byCode = {};
                            Object.values(recipes).forEach(r => { byCode[String(r.code).toUpperCase()] = r; });
                            const isSub = (c) => /-(S|P)$/.test(String(c || '').toUpperCase());
                            const cmp = (a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true });
                            const masters = Object.values(recipes).filter(r => !isSub(r.code)).sort(cmp);
                            const orphanSubs = Object.values(recipes).filter(r => isSub(r.code) && !byCode[String(r.code).toUpperCase().replace(/-(S|P)$/, '')]).sort(cmp);
                            const stepsLine = (rec) => (rec.steps || []).map(s => s.color).filter(Boolean).join(' → ');
                            const variantRow = (master, sfx) => {
                                const code = `${String(master.code).toUpperCase()}-${sfx}`;
                                const sub = byCode[code];
                                const label = sfx === 'S' ? 'Small parts' : 'Poles';
                                return (
                                    <div key={sfx} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'var(--paper)', border: '1px solid var(--line)', marginTop: '6px' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: canEdit ? 'pointer' : 'default', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink)', whiteSpace: 'nowrap' }}>
                                            <input type="checkbox" checked={!!sub} disabled={!canEdit}
                                                onChange={() => sub
                                                    ? (window.confirm(`Delete ${code}? ${label} on ${master.code} orders fall back to the master recipe.`) && deleteDoc(doc(db, "fin_recipes", code)).then(() => writeLog && writeLog(`Deleted stream variant ${code}`, 'recipes')))
                                                    : (window.confirm(`Create ${code} — the ${label.toUpperCase()} variant of ${master.code}?\n\nIt starts as a copy of ${master.code}'s steps; press Edit on it to set the real ${label.toLowerCase()} sequence (coats, DTMs). The floor picks it automatically for the ${label.toLowerCase()} stream.`) && setDoc(doc(db, "fin_recipes", code), { code, name: `${master.name || master.code} — ${label.toUpperCase()}`, masterCode: String(master.code).toUpperCase(), steps: (master.steps || []).map(s => ({ ...s })), instructions: master.instructions || '' }).then(() => writeLog && writeLog(`Created stream variant ${code} from ${master.code}`, 'recipes')))}
                                                style={{ accentColor: 'var(--brass)' }} />
                                            -{sfx} · {label}
                                        </label>
                                        {sub ? (
                                            <>
                                                <span style={{ flex: 1, minWidth: 0, fontSize: '0.82rem', color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={stepsLine(sub)}>{(sub.steps || []).length} coat{(sub.steps || []).length === 1 ? '' : 's'} · {stepsLine(sub) || '—'}</span>
                                                {canEdit && <button onClick={() => handleEditRecipe(sub)} style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '4px 10px', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: 'pointer' }}>Edit</button>}
                                            </>
                                        ) : (
                                            <span style={{ flex: 1, fontSize: '0.82rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>not defined — {label.toLowerCase()} run the master recipe</span>
                                        )}
                                    </div>
                                );
                            };
                            const card = (r, isOrphan) => (
                                <div key={r.code} style={{ ...cardStyle, ...(isOrphan ? { borderLeft: '3px solid #d9534f' } : {}) }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '12px', marginBottom: '16px' }}>
                                        <div style={{ minWidth: 0 }}>
                                            <strong style={{ fontSize: '1.2rem', color: 'var(--ink)', fontFamily: 'var(--serif)' }}>{r.code}</strong>
                                            {isOrphan && <span title="This -S/-P variant has no master recipe — create the master, or rename this" style={{ fontFamily: 'var(--mono)', fontSize: '8px', letterSpacing: '.08em', color: '#d9534f', border: '1px solid #d9534f', padding: '2px 6px', marginLeft: '8px', verticalAlign: 'middle' }}>NO MASTER</span>}
                                            {r.name && <span style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', display: 'block', marginTop: '2px' }}>{r.name}</span>}
                                        </div>
                                        {canEdit && (
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button onClick={() => handleEditRecipe(r)} style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '6px 12px', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: 'pointer' }}>Edit</button>
                                                <button onClick={() => { if(window.confirm(`Delete recipe ${r.code}?${byCode[`${String(r.code).toUpperCase()}-S`] || byCode[`${String(r.code).toUpperCase()}-P`] ? `\n\n⚠ Its -S/-P variants stay — delete or re-home them too.` : ''}`)) deleteDoc(doc(db, "fin_recipes", r.code)); }} style={{ background: 'transparent', color: '#d9534f', border: '1px solid var(--line)', padding: '6px 12px', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: 'pointer' }}>Del</button>
                                            </div>
                                        )}
                                    </div>

                                    {r.steps?.map(st => (
                                        <div key={st.step} style={{ fontSize: '0.9rem', padding: '8px 0', borderBottom: '1px solid rgba(28,26,22,.05)', display: 'flex', alignItems: 'center' }}>
                                            <span style={{ width: '40px', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>S{st.step}</span>
                                            <span style={{ flex: 1, color: 'var(--ink)' }}>{st.color}</span>
                                            <span style={{ background: st.app === 'Sprayed' ? 'var(--paper-2)' : 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '4px 10px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{st.app}</span>
                                        </div>
                                    ))}

                                    {!isOrphan && (
                                        <div style={{ marginTop: '14px' }}>
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '2px' }}>Stream variants — the floor picks these automatically</div>
                                            {variantRow(r, 'S')}
                                            {variantRow(r, 'P')}
                                        </div>
                                    )}

                                    {r.instructions && (
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--line)' }}>
                                            Includes Floor Instructions
                                        </div>
                                    )}
                                </div>
                            );
                            return (
                                <>
                                    {masters.map(r => card(r, false))}
                                    {orphanSubs.length > 0 && (
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', marginTop: '8px' }}>⚠ Variants with no master recipe</div>
                                    )}
                                    {orphanSubs.map(r => card(r, true))}
                                </>
                            );
                       })()}
                    </div>
                </div>

                {/* PAINT PROFILES LIST */}
                <div>
                    <h3 style={sectionHeaderStyle}>Saved Mixing Profiles</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                       {Object.values(paintProfiles).map(p => (
                            <div key={p.base} style={{...cardStyle, borderLeft: '2px solid var(--brass)'}}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '12px', marginBottom: '16px' }}>
                                    <div>
                                        <strong style={{ fontSize: '1.1rem', color: 'var(--ink)', display: 'block', fontWeight: 500 }}>{p.base}</strong>
                                        {p.cat && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px', display: 'block' }}>+ {p.cat}</span>}
                                    </div>
                                    {canEdit && (
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button onClick={() => handleEditProfile(p)} style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '6px 12px', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: 'pointer' }}>Edit</button>
                                            <button onClick={() => { if(window.confirm(`Delete profile for ${p.base}?`)) deleteDoc(doc(db, "fin_paint_profiles", p.base)); }} style={{ background: 'transparent', color: '#d9534f', border: '1px solid var(--line)', padding: '6px 12px', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: 'pointer' }}>Del</button>
                                        </div>
                                    )}
                                </div>
                                
                                <div style={{ display: 'flex', gap: '30px', background: 'var(--paper)', padding: '16px', borderRadius: '2px', border: '1px solid var(--line)' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)' }}>{p.rBase}</div>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Base Parts</div>
                                    </div>
                                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink-soft)' }}>:</div>
                                    <div style={{ flex: 1, textAlign: 'right' }}>
                                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)' }}>{p.rCat || 0}</div>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Cat Parts</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default Recipes;