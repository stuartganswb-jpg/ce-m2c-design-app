import React, { useState } from 'react';
import { db } from '../../firebase'; 
import { addDoc, collection, serverTimestamp, updateDoc, doc, deleteDoc } from "firebase/firestore";
import { btnStyle, inputStyle } from './finishingStyles';

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
        <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto', fontFamily: 'var(--sans)' }}>
            <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '30px' }}>
                <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Shop Broadcasts</h2>
            </div>
            
            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', marginBottom: '40px' }}>
                <textarea 
                    value={msgBody} 
                    onChange={e=>setMsgBody(e.target.value)} 
                    placeholder="Broadcast a shop message..." 
                    style={{...inputStyle, height: '120px', resize: 'vertical', marginBottom: '16px'}}
                />
                <button onClick={handleSend} style={{ ...btnStyle, width: '100%' }}>Post Message</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {messages.length === 0 && <div style={{ textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem', padding: '40px' }}>No active broadcasts.</div>}
                
                {messages.map(m => {
                    const readMap = m.read || {}; const compMap = m.completed || {};
                    const hasRead = !!readMap[user.name]; const hasComp = !!compMap[user.name];
                    return (
                        <div key={m.id} style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', borderRadius: '2px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
                            {['admin', 'floor_manager'].includes(user.role) && (
                                <button onClick={() => deleteDoc(doc(db, "fin_messaging", m.id))} style={{ float: 'right', background: 'transparent', color: '#d9534f', border: 'none', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1, padding: 0 }}>×</button>
                            )}
                            
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '16px' }}>
                                <span style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '1.1rem' }}>{m.u}</span> 
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>
                                    {m.t?.toDate().toLocaleString() || 'Just now'}
                                </span>
                            </div>
                            
                            <div style={{ fontSize: '1.05rem', color: 'var(--ink)', lineHeight: '1.6', marginBottom: '24px', whiteSpace: 'pre-wrap' }}>
                                {m.msg}
                            </div>
                            
                            <div style={{ paddingTop: '16px', borderTop: '1px solid var(--line)', display: 'flex', gap: '16px' }}>
                                <button 
                                    onClick={() => toggleAction(m.id, 'read', readMap)} 
                                    style={{ background: hasRead ? 'var(--paper-2)' : '#fff', color: 'var(--ink)', border: '1px solid var(--line)', padding: '10px 20px', borderRadius: '2px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px' }}
                                >
                                    <span style={{ fontSize: '1.2rem', color: hasRead ? 'var(--brass)' : 'var(--line)' }}>{hasRead ? '☑' : '☐'}</span> 
                                    {hasRead ? 'Read' : 'Mark Read'}
                                </button>
                                <button 
                                    onClick={() => toggleAction(m.id, 'completed', compMap)} 
                                    style={{ background: hasComp ? 'var(--paper-2)' : '#fff', color: 'var(--ink)', border: '1px solid var(--line)', padding: '10px 20px', borderRadius: '2px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '8px' }}
                                >
                                    <span style={{ fontSize: '1.2rem', color: hasComp ? 'var(--brass)' : 'var(--line)' }}>{hasComp ? '☑' : '☐'}</span> 
                                    {hasComp ? 'Completed' : 'Mark Complete'}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Messaging;