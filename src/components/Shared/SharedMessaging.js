import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, orderBy, limit, addDoc, updateDoc, doc, serverTimestamp, getDocs } from "firebase/firestore";

const APP_COLORS = {
    'SHOP': '#0056b3', // Blue
    'FINISHING': '#CC6600', // Orange
    'HQ': '#28a745', // Green
    'SYSTEM': '#6f42c1' // Purple
};

const SharedMessaging = ({ currentUser, currentApp, writeLog }) => {
    const [messages, setMessages] = useState([]);
    const [directory, setDirectory] = useState([]);
    const [msgBody, setMsgBody] = useState('');
    const [targetUser, setTargetUser] = useState('ALL');
    const [filterTarget, setFilterTarget] = useState('ALL');

    // 1. Fetch Global Directory to populate To: dropdowns
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                // Fetching from Finishing directory as it is currently the master list
                const snap = await getDocs(collection(db, "fin_users"));
                let users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                users.sort((a,b) => (a.name || '').localeCompare(b.name || ''));
                setDirectory(users);
            } catch (err) { console.error("Error fetching directory:", err); }
        };
        fetchUsers();
    }, []);

    // 2. Fetch the shared Global Message Board
    useEffect(() => {
        const q = query(collection(db, "global_messages"), orderBy("t", "desc"), limit(100));
        const unsub = onSnapshot(q, (snap) => {
            setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, []);

    const handleSendMessage = async () => {
        if (!msgBody.trim()) return;
        
        try {
            await addDoc(collection(db, "global_messages"), {
                sender: currentUser || 'Unknown',
                sourceApp: currentApp || 'UNKNOWN',
                target: targetUser,
                msg: msgBody.trim(),
                t: serverTimestamp(),
                readBy: [], 
                isSystem: false
            });
            
            if (writeLog) writeLog(`Sent message to ${targetUser}`, 'messaging');
            setMsgBody('');
            setTargetUser('ALL');
        } catch (error) {
            console.error("Failed to send message:", error);
            alert("Error sending message.");
        }
    };

    const handleMarkAsRead = async (msgId, currentReadBy) => {
        if (!currentUser) return;
        if (currentReadBy.includes(currentUser)) return; // Already read

        try {
            const updatedReadBy = [...currentReadBy, currentUser];
            await updateDoc(doc(db, "global_messages", msgId), { readBy: updatedReadBy });
        } catch (error) {
            console.error("Failed to mark read:", error);
        }
    };

    // Filter messages based on the toggle
    const displayMessages = messages.filter(m => {
        if (filterTarget === 'ALL') return true;
        if (filterTarget === 'MINE') return m.target === currentUser || m.target === 'ALL' || m.sender === currentUser;
        return true;
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', fontFamily: 'monospace' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #ccc', paddingBottom: '10px' }}>
                <h2 style={{ margin: 0, color: APP_COLORS[currentApp] || '#333' }}>O.S. Communications Hub</h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => setFilterTarget('ALL')} style={{ padding: '6px 15px', background: filterTarget === 'ALL' ? '#333' : '#fff', color: filterTarget === 'ALL' ? '#fff' : '#333', border: '1px solid #333', fontWeight: 'bold', cursor: 'pointer', borderRadius: '4px' }}>ALL MESSAGES</button>
                    <button onClick={() => setFilterTarget('MINE')} style={{ padding: '6px 15px', background: filterTarget === 'MINE' ? '#333' : '#fff', color: filterTarget === 'MINE' ? '#fff' : '#333', border: '1px solid #333', fontWeight: 'bold', cursor: 'pointer', borderRadius: '4px' }}>MY MESSAGES & BROADCASTS</button>
                </div>
            </div>

            {/* MESSAGE COMPOSER */}
            <div style={{ background: '#fff', border: `1px solid ${APP_COLORS[currentApp] || '#ccc'}`, padding: '20px', borderRadius: '8px', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#666', display: 'block', marginBottom: '5px' }}>TO:</label>
                        <select value={targetUser} onChange={e => setTargetUser(e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid #ccc', borderRadius: '4px', fontWeight: 'bold', fontSize: '1rem' }}>
                            <option value="ALL">📣 ALL DEPARTMENTS (Broadcast)</option>
                            <optgroup label="Direct Message">
                                {directory.map(u => <option key={u.id} value={u.name}>{u.name} ({u.role || 'User'})</option>)}
                            </optgroup>
                        </select>
                    </div>
                </div>

                <textarea 
                    value={msgBody} 
                    onChange={e => setMsgBody(e.target.value)} 
                    placeholder="Type your message here..." 
                    style={{ width: '100%', boxSizing: 'border-box', padding: '15px', minHeight: '80px', borderRadius: '4px', border: '1px solid #ccc', fontFamily: 'monospace', fontSize: '1rem', resize: 'vertical' }}
                />
                
                <button 
                    onClick={handleSendMessage} 
                    disabled={!msgBody.trim()}
                    style={{ 
                        background: APP_COLORS[currentApp] || '#333', color: '#fff', border: 'none', padding: '12px', marginTop: '15px', 
                        borderRadius: '4px', fontWeight: 'bold', fontSize: '1rem', cursor: msgBody.trim() ? 'pointer' : 'not-allowed', 
                        width: '100%', opacity: msgBody.trim() ? 1 : 0.5
                    }}
                >
                    ✉️ SEND MESSAGE
                </button>
            </div>

            {/* MESSAGE FEED */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {displayMessages.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#888', fontStyle: 'italic', border: '1px dashed #ccc', borderRadius: '8px' }}>No messages found.</div>
                ) : (
                    displayMessages.map(m => {
                        const dateStr = m.t?.toDate ? m.t.toDate().toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '-';
                        const isSystem = m.isSystem;
                        const borderColor = isSystem ? APP_COLORS['SYSTEM'] : (APP_COLORS[m.sourceApp] || '#ccc');
                        
                        const iHaveRead = (m.readBy || []).includes(currentUser);
                        const isTargetedToMe = m.target === currentUser;
                        const isBroadcast = m.target === 'ALL';

                        return (
                            <div key={m.id} style={{ background: '#fff', padding: '15px', borderRadius: '8px', borderLeft: `4px solid ${borderColor}`, borderTop: '1px solid #eee', borderRight: '1px solid #eee', borderBottom: '1px solid #eee', position: 'relative' }}>
                                
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                        <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: isSystem ? borderColor : '#333' }}>
                                            {isSystem ? '🤖 SYSTEM ALERT' : m.sender}
                                        </span>
                                        {!isSystem && <span style={{ fontSize: '0.7rem', background: '#e9ecef', padding: '2px 6px', borderRadius: '4px', color: '#666', fontWeight: 'bold' }}>via {m.sourceApp}</span>}
                                        <span style={{ fontSize: '0.8rem', color: '#888' }}>{dateStr}</span>
                                    </div>

                                    {/* TARGET BADGE */}
                                    <div style={{ background: isBroadcast ? '#f8f9fa' : '#eef5ff', border: `1px solid ${isBroadcast ? '#ccc' : '#0056b3'}`, color: isBroadcast ? '#666' : '#0056b3', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                                        TO: {m.target}
                                    </div>
                                </div>

                                <div style={{ whiteSpace: 'pre-wrap', fontSize: '1rem', lineHeight: '1.5', color: '#000', marginBottom: '15px' }}>
                                    {m.msg}
                                </div>

                                {/* READ RECEIPT FOOTER */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed #eee', paddingTop: '10px' }}>
                                    <div style={{ fontSize: '0.75rem', color: '#888' }}>
                                        Read by: {(m.readBy || []).length === 0 ? 'None' : (m.readBy || []).join(', ')}
                                    </div>
                                    
                                    {(isTargetedToMe || isBroadcast) && !isSystem && m.sender !== currentUser && (
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: 'bold', color: iHaveRead ? '#28a745' : '#d9534f', cursor: iHaveRead ? 'default' : 'pointer' }}>
                                            <input 
                                                type="checkbox" 
                                                checked={iHaveRead} 
                                                onChange={() => handleMarkAsRead(m.id, m.readBy || [])} 
                                                disabled={iHaveRead}
                                                style={{ transform: 'scale(1.2)' }}
                                            />
                                            {iHaveRead ? '✓ ACKNOWLEDGED' : 'MARK AS READ'}
                                        </label>
                                    )}
                                </div>

                            </div>
                        );
                    })
                )}
            </div>

        </div>
    );
};

export default SharedMessaging;