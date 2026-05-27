import React from 'react';
import { btnStyle } from './finishingStyles';

const Summary = ({ workOrders }) => {
    const today = new Date().toDateString();
    const completed = workOrders.filter(w => w.currentPhase === "Complete" && w.completedAt && new Date(w.completedAt).toDateString() === today).sort((a,b) => b.completedAt - a.completedAt);
    
    return (
        <div style={{ padding: '30px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '2px solid #000', paddingBottom: '15px' }}>
                <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.5rem' }}>DAILY PRODUCTION SUMMARY</h2>
                <button onClick={() => window.print()} style={btnStyle}>🖨️ PRINT REPORT</button>
            </div>
            
            <div style={{ background: '#fff', border: '2px solid #000', overflowX: 'auto', boxShadow: '6px 6px 0 rgba(0,0,0,0.05)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                    <thead style={{ background: '#000', color: '#fff' }}>
                        <tr>
                            <th style={{ padding: '12px' }}>Time</th><th style={{ padding: '12px' }}>WO #</th>
                            <th style={{ padding: '12px' }}>SO #</th><th style={{ padding: '12px' }}>Cust PO</th>
                            <th style={{ padding: '12px' }}>Poles</th><th style={{ padding: '12px' }}>Brackets</th>
                            <th style={{ padding: '12px' }}>Rings</th><th style={{ padding: '12px' }}>Finials</th>
                            <th style={{ padding: '12px', color: '#d9534f' }}>Scrap</th><th style={{ padding: '12px' }}>Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {completed.length === 0 && <tr><td colSpan="10" style={{ padding: '30px', textAlign: 'center', color: '#999', fontStyle: 'italic' }}>No work orders have been completed today.</td></tr>}
                        {completed.map(wo => {
                            let p=0, b=0, r=0, f=0;
                            if(wo.type === 'sales') {
                                p = wo.poles?.qty || 0; b = wo.smallParts?.brk || 0; r = wo.smallParts?.rng || 0; f = wo.smallParts?.fin || 0;
                            } else { p = wo.stock?.qty || 0; }
                            
                            const notesArr = [];
                            if(wo.holdReason) notesArr.push(wo.holdReason);
                            if(wo.scrapReported > 0) notesArr.push("Reported Scrap");
                            
                            return (
                                <tr key={wo.id} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '12px' }}>{new Date(wo.completedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                                    <td style={{ padding: '12px', fontWeight: 'bold', color: '#007bff' }}>{wo.id}</td>
                                    <td style={{ padding: '12px', fontWeight: 'bold', color: '#6f42c1' }}>{wo.soId || '-'}</td>
                                    <td style={{ padding: '12px' }}>{wo.custPo || '-'}</td>
                                    <td style={{ padding: '12px' }}>{wo.type === 'stock' ? <b>{p} (Stock)</b> : p}</td>
                                    <td style={{ padding: '12px' }}>{b}</td><td style={{ padding: '12px' }}>{r}</td><td style={{ padding: '12px' }}>{f}</td>
                                    <td style={{ padding: '12px', color: '#d9534f', fontWeight: 'bold' }}>{wo.scrapReported || 0}</td>
                                    <td style={{ padding: '12px', color: '#666', fontSize: '0.75rem' }}>{notesArr.join(' | ') || '-'}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Summary;