import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, orderBy, limit, addDoc, updateDoc, doc, serverTimestamp, getDocs } from "firebase/firestore";

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

// Muted app colors aligning to the new Enterprise PLM theme
const APP_COLORS = {
    'SHOP': theme.inkSoft, 
    'FINISHING': theme.brass, 
    'HQ': theme.ink, 
    'SYSTEM': '#8C7D70' 
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', fontFamily: theme.sans }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.line}`, paddingBottom: '15px' }}>
                <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.6rem', fontWeight: 500, color: APP_COLORS[currentApp] || theme.ink }}>O.S. Communications Hub</h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => setFilterTarget('ALL')} style={{ padding: '8px 16px', background: filterTarget === 'ALL' ? theme.ink : 'transparent', color: filterTarget === 'ALL' ? '#fff' : theme.inkSoft, border: `1px solid ${filterTarget === 'ALL' ? theme.ink : theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', cursor: 'pointer' }}>ALL MESSAGES</button>
                    <button onClick={() => setFilterTarget('MINE')} style={{ padding: '8px 16px', background: filterTarget === 'MINE' ? theme.ink : 'transparent', color: filterTarget === 'MINE' ? '#fff' : theme.inkSoft, border: `1px solid ${filterTarget === 'MINE' ? theme.ink : theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', cursor: 'pointer' }}>MY MESSAGES & BROADCASTS</button>
                </div>
            </div>

            {/* MESSAGE COMPOSER */}
            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, display: 'block', marginBottom: '8px' }}>TO:</label>
                        <select value={targetUser} onChange={e => setTargetUser(e.target.value)} style={{ width: '100%', padding: '12px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', background: theme.paper, outline: 'none' }}>
                            <option value="ALL">ALL DEPARTMENTS (Broadcast)</option>
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
                    style={{ width: '100%', boxSizing: 'border-box', padding: '15px', minHeight: '80px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', resize: 'vertical', background: theme.paper, outline: 'none' }}
                />
                
                <button 
                    onClick={handleSendMessage} 
                    disabled={!msgBody.trim()}
                    style={{ 
                        background: APP_COLORS[currentApp] || theme.ink, color: '#fff', border: 'none', padding: '15px', marginTop: '15px', 
                        fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', cursor: msgBody.trim() ? 'pointer' : 'not-allowed', 
                        width: '100%', opacity: msgBody.trim() ? 1 : 0.5, transition: 'background 0.2s'
                    }}
                >
                    SEND MESSAGE
                </button>
            </div>

            {/* MESSAGE FEED */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {displayMessages.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: theme.inkSoft, fontFamily: theme.serif, fontStyle: 'italic', border: `1px solid ${theme.line}`, background: '#fff' }}>No messages found.</div>
                ) : (
                    displayMessages.map(m => {
                        const dateStr = m.t?.toDate ? m.t.toDate().toLocaleString([], {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '-';
                        const isSystem = m.isSystem;
                        const borderColor = isSystem ? APP_COLORS['SYSTEM'] : (APP_COLORS[m.sourceApp] || theme.line);
                        
                        const iHaveRead = (m.readBy || []).includes(currentUser);
                        const isTargetedToMe = m.target === currentUser;
                        const isBroadcast = m.target === 'ALL';

                        return (
                            <div key={m.id} style={{ background: '#fff', padding: '25px', borderLeft: `2px solid ${borderColor}`, borderTop: `1px solid ${theme.line}`, borderRight: `1px solid ${theme.line}`, borderBottom: `1px solid ${theme.line}`, position: 'relative', boxShadow: '0 2px 12px rgba(0,0,0,0.01)' }}>
                                
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '15px' }}>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                        <span style={{ fontFamily: theme.serif, fontSize: '1.2rem', fontWeight: 500, color: isSystem ? borderColor : theme.ink }}>
                                            {isSystem ? 'System Alert' : m.sender}
                                        </span>
                                        {!isSystem && <span style={{ fontFamily: theme.mono, fontSize: '9px', background: theme.paper, border: `1px solid ${theme.line}`, padding: '3px 8px', color: theme.inkSoft, letterSpacing: '.1em', textTransform: 'uppercase' }}>via {m.sourceApp}</span>}
                                        <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>{dateStr}</span>
                                    </div>

                                    {/* TARGET BADGE */}
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.1em', textTransform: 'uppercase', background: isBroadcast ? theme.paper : '#fff', border: `1px solid ${isBroadcast ? theme.line : borderColor}`, color: isBroadcast ? theme.inkSoft : borderColor, padding: '4px 8px' }}>
                                        TO: {m.target}
                                    </div>
                                </div>

                                <div style={{ whiteSpace: 'pre-wrap', fontFamily: theme.sans, fontSize: '0.95rem', lineHeight: '1.6', color: theme.ink, marginBottom: '20px' }}>
                                    {m.msg}
                                </div>

                                {/* READ RECEIPT FOOTER */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${theme.line}`, paddingTop: '15px' }}>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>
                                        Read by: {(m.readBy || []).length === 0 ? 'None' : (m.readBy || []).join(', ')}
                                    </div>
                                    
                                    {(isTargetedToMe || isBroadcast) && !isSystem && m.sender !== currentUser && (
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: iHaveRead ? theme.brass : theme.inkSoft, cursor: iHaveRead ? 'default' : 'pointer' }}>
                                            <input 
                                                type="checkbox" 
                                                checked={iHaveRead} 
                                                onChange={() => handleMarkAsRead(m.id, m.readBy || [])} 
                                                disabled={iHaveRead}
                                                style={{ accentColor: theme.brass }}
                                            />
                                            {iHaveRead ? 'ACKNOWLEDGED' : 'MARK AS READ'}
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