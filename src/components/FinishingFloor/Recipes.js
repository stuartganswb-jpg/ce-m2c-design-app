import React, { useState } from 'react';
import { db } from '../../firebase'; 
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { cardStyle, btnStyle, inputStyle, labelStyle } from './finishingStyles';

const Recipes = ({ recipes, paintProfiles, supplies, writeLog, user }) => {
    const [rCode, setRCode] = useState("");
    const [steps, setSteps] = useState([
        {step:1, color:'', app:'Sprayed'}, {step:2, color:'', app:'None'}, 
        {step:3, color:'', app:'None'}, {step:4, color:'', app:'None'}, {step:5, color:'', app:'None'}
    ]);
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
        await setDoc(doc(db, "fin_recipes", safeCode), { code: safeCode, steps: cleanedSteps });
        if (writeLog) writeLog(`Updated Recipe: ${safeCode}`, 'recipes');
        setRCode(""); 
        setSteps([{step:1, color:'', app:'Sprayed'}, {step:2, color:'', app:'None'}, {step:3, color:'', app:'None'}, {step:4, color:'', app:'None'}, {step:5, color:'', app:'None'}]);
    };

    const handleEditRecipe = (r) => {
        setRCode(r.code);
        let loadedSteps = r.steps?.map(s => ({ ...s })) || [];
        while (loadedSteps.length < 5) loadedSteps.push({ step: loadedSteps.length + 1, color: '', app: 'None' });
        setSteps(loadedSteps);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSaveProfile = async () => {
        if(!base || !rBase || !rCat) return alert("Fill required fields");
        await setDoc(doc(db, "fin_paint_profiles", base), { base, cat, rBase, rCat });
        if (writeLog) writeLog(`Updated Paint Profile: ${base}`, 'recipes');
        setBase(""); setCat(""); setRBase(""); setRCat("");
    };

    // NEW: Handle Editing Paint Profiles
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
        <div style={{ padding: '30px' }}>
            <h2 style={{ margin: '0 0 20px 0', borderBottom: '2px solid #000', paddingBottom: '10px' }}>FINISH RECIPES & MIXING PROFILES</h2>
            
            {/* TOP HALF: FORMS */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', boxShadow: '6px 6px 0 rgba(0,0,0,0.05)' }}>
                    <h3 style={{ marginTop: 0 }}>RECIPE BUILDER</h3>
                    <input value={rCode} onChange={e => setRCode(e.target.value)} placeholder="Finish Code" style={{...inputStyle, fontSize: '1.2rem', fontWeight: 'bold'}} />
                    <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {steps.map((s, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr', gap: '10px', alignItems: 'center' }}>
                                <strong>S{s.step}:</strong>
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
                    <button onClick={addStepRow} style={{ width: '100%', padding: '10px', background: '#f4f4f4', color: '#666', fontWeight: 'bold', border: '2px dashed #ccc', marginTop: '15px', cursor: 'pointer' }}>+ ADD ANOTHER STEP</button>
                    <button onClick={handleSaveRecipe} style={{ ...btnStyle, width: '100%', marginTop: '15px' }}>SAVE RECIPE</button>
                </div>

                <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', boxShadow: '6px 6px 0 rgba(0,0,0,0.05)' }}>
                    <h3 style={{ marginTop: 0 }}>PAINT MIXING PROFILES</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                        <div><label style={labelStyle}>BASE COLOR</label><select value={base} onChange={e=>setBase(e.target.value)} style={inputStyle}><option value="">Select...</option>{paintSupplies.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select></div>
                        <div><label style={labelStyle}>CATALYST (Optional)</label><select value={cat} onChange={e=>setCat(e.target.value)} style={inputStyle}><option value="">Select...</option>{paintSupplies.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                        <div><label style={labelStyle}>BASE RATIO (Parts)</label><input type="number" step="0.1" value={rBase} onChange={e=>setRBase(e.target.value)} style={inputStyle} /></div>
                        <div><label style={labelStyle}>CAT RATIO (Parts)</label><input type="number" step="0.1" value={rCat} onChange={e=>setRCat(e.target.value)} style={inputStyle} /></div>
                    </div>
                    <button onClick={handleSaveProfile} style={{ ...btnStyle, background: '#fff', color: '#000', border: '2px solid #000', width: '100%', marginTop: '20px' }}>SAVE MIX PROFILE</button>
                </div>
            </div>
            
            {/* BOTTOM HALF: DICTIONARIES */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginTop: '40px' }}>
                
                {/* RECIPE LIST */}
                <div>
                    <h3 style={{ borderBottom: '2px solid #000', paddingBottom: '10px' }}>SAVED RECIPE DICTIONARY</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                       {Object.values(recipes).map(r => (
                            <div key={r.code} style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #eee', paddingBottom: '5px', marginBottom: '10px' }}>
                                    <strong style={{ fontSize: '1.2rem', color: '#007bff' }}>{r.code}</strong>
                                    {canEdit && (
                                        <div style={{ display: 'flex', gap: '5px' }}>
                                            <button onClick={() => handleEditRecipe(r)} style={{ background: '#f4f4f4', color: '#007bff', border: '1px solid #ccc', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>EDIT</button>
                                            <button onClick={() => { if(window.confirm(`Delete recipe ${r.code}?`)) deleteDoc(doc(db, "fin_recipes", r.code)); }} style={{ background: '#fff0f0', color: '#d9534f', border: '1px solid #ffcccc', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>DEL</button>
                                        </div>
                                    )}
                                </div>
                                
                                {r.steps?.map(st => (
                                    <div key={st.step} style={{ fontSize: '0.8rem', padding: '5px 0', borderBottom: '1px dashed #eee' }}>
                                        <b>S{st.step}:</b> {st.color} <span style={{ background: st.app === 'Sprayed' ? '#007bff' : '#ffc107', color: st.app === 'Sprayed' ? '#fff' : '#000', padding: '2px 6px', borderRadius: '12px', fontSize: '0.7rem', marginLeft: '10px', fontWeight: 'bold' }}>{st.app}</span>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>

                {/* PAINT PROFILES LIST */}
                <div>
                    <h3 style={{ borderBottom: '2px solid #000', paddingBottom: '10px' }}>SAVED MIXING PROFILES</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                       {Object.values(paintProfiles).map(p => (
                            <div key={p.base} style={{...cardStyle, borderLeft: '6px solid #CC6600'}}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #eee', paddingBottom: '5px', marginBottom: '10px' }}>
                                    <div>
                                        <strong style={{ fontSize: '1.1rem', color: '#333', display: 'block' }}>{p.base}</strong>
                                        {p.cat && <span style={{ fontSize: '0.8rem', color: '#666' }}>+ {p.cat}</span>}
                                    </div>
                                    {canEdit && (
                                        <div style={{ display: 'flex', gap: '5px' }}>
                                            <button onClick={() => handleEditProfile(p)} style={{ background: '#f4f4f4', color: '#CC6600', border: '1px solid #ccc', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>EDIT</button>
                                            <button onClick={() => { if(window.confirm(`Delete profile for ${p.base}?`)) deleteDoc(doc(db, "fin_paint_profiles", p.base)); }} style={{ background: '#fff0f0', color: '#d9534f', border: '1px solid #ffcccc', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>DEL</button>
                                        </div>
                                    )}
                                </div>
                                
                                <div style={{ display: 'flex', gap: '20px', background: '#f8f9fa', padding: '10px', borderRadius: '4px' }}>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#333' }}>{p.rBase}</div>
                                        <div style={{ fontSize: '0.7rem', color: '#888', fontWeight: 'bold' }}>BASE PARTS</div>
                                    </div>
                                    <div style={{ textAlign: 'center', fontSize: '1.2rem', fontWeight: 'bold', color: '#ccc' }}>:</div>
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#CC6600' }}>{p.rCat || 0}</div>
                                        <div style={{ fontSize: '0.7rem', color: '#888', fontWeight: 'bold' }}>CAT PARTS</div>
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