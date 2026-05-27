import React, { useState } from 'react';
import { db } from '../../firebase'; 
import { addDoc, collection, serverTimestamp, updateDoc, doc, deleteDoc } from "firebase/firestore";
import { cardStyle, btnStyle, inputStyle } from './finishingStyles';

const Messaging = ({ messages, user }) => {
    const [msgBody, setMsgBody] = useState("");

    const handleSend = async () => {
        if(!msgBody) return;
        await addDoc(collection(db, "fin_messaging"), { u: user.name, msg: msgBody, t: serverTimestamp(), read: {}, completed: {} });
        setMsgBody("");
    };

    const toggleAction = async (id, actionType, currentMap) => {
        const updateData = {};
        if (currentMap[user.name]) updateData[`${actionType}.${user.name}`] = null;
        else updateData[`${actionType}.${user.name}`] = Date.now();
        await updateDoc(doc(db, "fin_messaging", id), updateData);
    };

    return (
        <div style={{ padding: '30px', maxWidth: '800px', margin: '0 auto' }}>
            <h2 style={{ margin: '0 0 20px 0', borderBottom: '2px solid #000', paddingBottom: '10px' }}>SHOP BROADCASTS</h2>
            <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', boxShadow: '6px 6px 0 rgba(0,0,0,0.05)', marginBottom: '30px' }}>
                <textarea value={msgBody} onChange={e=>setMsgBody(e.target.value)} placeholder="Broadcast a shop message..." style={{...inputStyle, height: '100px', resize: 'vertical'}}></textarea>
                <button onClick={handleSend} style={{ ...btnStyle, width: '100%', marginTop: '10px' }}>POST MESSAGE</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {messages.map(m => {
                    const readMap = m.read || {}; const compMap = m.completed || {};
                    const hasRead = !!readMap[user.name]; const hasComp = !!compMap[user.name];
                    return (
                        <div key={m.id} style={cardStyle}>
                            {['admin', 'floor_manager'].includes(user.role) && <button onClick={() => deleteDoc(doc(db, "fin_messaging", m.id))} style={{ float: 'right', background: '#fff0f0', color: '#d9534f', border: '1px solid #ffcccc', cursor: 'pointer', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 'bold' }}>DEL</button>}
                            <b>{m.u}</b> <span style={{ color: '#888', fontSize: '0.7rem', marginLeft: '10px' }}>{m.t?.toDate().toLocaleString() || 'Just now'}</span>
                            <div style={{ marginTop: '10px', fontSize: '1rem', marginBottom: '15px', color: '#000' }}>{m.msg}</div>
                            <div style={{ paddingTop: '10px', borderTop: '1px dashed #eee', display: 'flex', gap: '15px' }}>
                                <button onClick={() => toggleAction(m.id, 'read', readMap)} style={{ background: hasRead ? '#eafaf1' : '#f8f9fa', border: '1px solid #ccc', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 'bold' }}>{hasRead ? '☑️ READ' : '⬜ MARK READ'}</button>
                                <button onClick={() => toggleAction(m.id, 'completed', compMap)} style={{ background: hasComp ? '#eafaf1' : '#f8f9fa', border: '1px solid #ccc', padding: '6px 12px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 'bold' }}>{hasComp ? '✅ COMPLETED' : '⬜ MARK COMPLETE'}</button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Messaging;