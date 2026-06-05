import React, { useState } from 'react';
import { finishingDb as db } from '../../firebase'; 
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { cardStyle, btnStyle, inputStyle, labelStyle, sectionHeaderStyle } from './finishingStyles';

const Recipes = ({ recipes, paintProfiles, supplies, writeLog, user }) => {
    const [rCode, setRCode] = useState("");
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
        if(!rCode) return alert("Recipe needs a PO Code");
        const safeCode = rCode.toUpperCase().replace(/\//g, '-');
        const activeSteps = steps.filter(s => s.app !== "None" && s.color);
        if(activeSteps.length === 0) return alert("You must define at least one step and select a color.");
        
        const cleanedSteps = activeSteps.map((s, idx) => ({ ...s, step: idx + 1 }));
        
        await setDoc(doc(db, "fin_recipes", safeCode), { code: safeCode, steps: cleanedSteps, instructions });
        if (writeLog) writeLog(`Updated Recipe: ${safeCode}`, 'recipes');
        setRCode(""); 
        setInstructions(""); 
        setSteps([{step:1, color:'', app:'Sprayed'}, {step:2, color:'', app:'None'}, {step:3, color:'', app:'None'}, {step:4, color:'', app:'None'}, {step:5, color:'', app:'None'}]);
    };

    const handleEditRecipe = (r) => {
        setRCode(r.code);
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

    const canEdit = user && ['admin', 'floor_manager', 'paint_manager'].includes(user.role);

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
                    <input value={rCode} onChange={e => setRCode(e.target.value)} placeholder="Finish Code (e.g. AB)" style={{...inputStyle, fontSize: '1.1rem', marginBottom: '24px'}} />
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                       {Object.values(recipes).map(r => (
                            <div key={r.code} style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '12px', marginBottom: '16px' }}>
                                    <strong style={{ fontSize: '1.2rem', color: 'var(--ink)', fontFamily: 'var(--serif)' }}>{r.code}</strong>
                                    {canEdit && (
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button onClick={() => handleEditRecipe(r)} style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '6px 12px', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: 'pointer' }}>Edit</button>
                                            <button onClick={() => { if(window.confirm(`Delete recipe ${r.code}?`)) deleteDoc(doc(db, "fin_recipes", r.code)); }} style={{ background: 'transparent', color: '#d9534f', border: '1px solid var(--line)', padding: '6px 12px', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: 'pointer' }}>Del</button>
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
                                
                                {r.instructions && (
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--line)' }}>
                                        Includes Floor Instructions
                                    </div>
                                )}
                            </div>
                        ))}
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