import React, { useState } from 'react';
import { finishingDb as db } from '../../firebase'; // 🔒 SECURE IMPORT
import { doc, updateDoc, addDoc, deleteDoc, collection, increment } from "firebase/firestore";
import { cardStyle, btnStyle, inputStyle, labelStyle } from './finishingStyles';

const Supplies = ({ supplies, writeLog, user }) => {
    const [editId, setEditId] = useState(null);
    const [name, setName] = useState("");
    const [cat, setCat] = useState("Paint/Chemical");
    const [loc, setLoc] = useState("");
    const [qty, setQty] = useState("");
    const [unit, setUnit] = useState("Gallons");
    const [reorder, setReorder] = useState("");

    const safeUserRole = user?.role ? user.role.toLowerCase() : 'operator';

    const handleSaveSupply = async () => {
        if(!name) return;
        if (editId) {
            await updateDoc(doc(db, "fin_supplies", editId), { name, cat, loc, unit, qty: parseFloat(qty)||0, reorder: parseFloat(reorder)||0 });
            writeLog(`Updated supply: ${name}`, 'inventory');
            setEditId(null);
        } else {
            await addDoc(collection(db, "fin_supplies"), { name, cat, loc, unit, qty: parseFloat(qty)||0, reorder: parseFloat(reorder)||0 });
            writeLog(`Added supply: ${name}`, 'inventory');
        }
        setName(""); setLoc(""); setQty(""); setReorder(""); setCat("Paint/Chemical"); setUnit("Gallons");
    };

    const handleEditSupply = (s) => {
        setEditId(s.id);
        setName(s.name); setCat(s.cat); setLoc(s.loc || ""); setQty(s.qty); setUnit(s.unit); setReorder(s.reorder);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const updateQty = async (id, change) => {
        await updateDoc(doc(db, "fin_supplies", id), { qty: increment(change) });
    };

    return (
        <div style={{ padding: '30px' }}>
            <h2 style={{ margin: '0 0 20px 0', borderBottom: '2px solid #000', paddingBottom: '10px' }}>PAINT & EQUIPMENT INVENTORY</h2>
            <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', marginBottom: '30px', boxShadow: '6px 6px 0 rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                    <input value={name} onChange={e=>setName(e.target.value)} placeholder="Item Name" style={inputStyle} />
                    <select value={cat} onChange={e=>setCat(e.target.value)} style={inputStyle}><option>Paint/Chemical</option><option>Equipment</option><option>Consumable</option></select>
                    <input value={loc} onChange={e=>setLoc(e.target.value)} placeholder="Location/Bin" style={inputStyle} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px' }}>
                    <div><label style={labelStyle}>CURRENT QTY</label><input type="number" step="0.01" value={qty} onChange={e=>setQty(e.target.value)} style={inputStyle} /></div>
                    <div><label style={labelStyle}>UNIT</label><select value={unit} onChange={e=>setUnit(e.target.value)} style={inputStyle}><option>Gallons</option><option>Quarts</option><option>Pieces</option><option>Rolls</option></select></div>
                    <div><label style={labelStyle}>REORDER ALERT AT</label><input type="number" step="0.01" value={reorder} onChange={e=>setReorder(e.target.value)} style={inputStyle} /></div>
                </div>
                
                <button onClick={handleSaveSupply} style={{ ...btnStyle, marginTop: '20px', background: editId ? '#007bff' : '#000', width: editId ? 'calc(50% - 5px)' : '100%', float: 'left' }}>
                    {editId ? 'UPDATE INVENTORY ITEM' : '+ ADD INVENTORY ITEM'}
                </button>
                {editId && (
                    <button onClick={() => { setEditId(null); setName(""); setLoc(""); setQty(""); setReorder(""); }} style={{ ...btnStyle, marginTop: '20px', background: '#fff', color: '#000', border: '2px solid #000', width: 'calc(50% - 5px)', float: 'right' }}>
                        CANCEL EDIT
                    </button>
                )}
                <div style={{ clear: 'both' }}></div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px' }}>
                {supplies.map(t => {
                    const isLow = t.qty <= t.reorder;
                    return (
                        <div key={t.id} style={{...cardStyle, borderLeft: isLow ? '5px solid #d9534f' : '5px solid #28a745'}}>
                            {['admin', 'floor_manager', 'purchasing'].includes(safeUserRole) && (
                                <div style={{ float: 'right', display: 'flex', gap: '5px' }}>
                                    <button onClick={() => handleEditSupply(t)} style={{ background: '#f4f4f4', color: '#007bff', border: '1px solid #ccc', cursor: 'pointer', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 'bold' }}>EDIT</button>
                                    <button onClick={() => deleteDoc(doc(db, "fin_supplies", t.id))} style={{ background: '#fff0f0', color: '#d9534f', border: '1px solid #ffcccc', cursor: 'pointer', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 'bold' }}>DEL</button>
                                </div>
                            )}
                            <b style={{ fontSize: '1rem' }}>{t.name}</b><br/>
                            <span style={{ fontSize: '0.75rem', color: '#666' }}>{t.cat} | Bin: {t.loc}</span>
                            <div style={{ marginTop: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <button onClick={() => updateQty(t.id, -1)} style={{ padding: '5px 15px', background: '#f4f4f4', border: '2px solid #ccc', cursor: 'pointer', fontWeight: 'bold', fontSize: '1.2rem' }}>-</button>
                                <span style={{ fontWeight: 'bold', fontSize: '1.5rem', color: isLow ? '#d9534f' : '#000' }}>{(t.unit === 'Gallons' || t.unit === 'Quarts') ? t.qty.toFixed(2) : t.qty}</span> 
                                <span style={{ fontSize: '0.7rem', color: '#777' }}>{t.unit}</span>
                                <button onClick={() => updateQty(t.id, 1)} style={{ padding: '5px 15px', background: '#f4f4f4', border: '2px solid #ccc', cursor: 'pointer', fontWeight: 'bold', fontSize: '1.2rem' }}>+</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Supplies;