import React from 'react';
import { btnStyle } from './finishingStyles';

const Summary = ({ workOrders }) => {
    const today = new Date().toDateString();
    const completed = workOrders.filter(w => w.currentPhase === "Complete" && w.completedAt && new Date(w.completedAt).toDateString() === today).sort((a,b) => b.completedAt - a.completedAt);
    
    return (
        <div style={{ padding: '40px', maxWidth: '1400px', margin: '0 auto', fontFamily: 'var(--sans)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', borderBottom: '1px solid var(--line)', paddingBottom: '20px' }}>
                <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Production Reporting</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Daily Summary</h2>
                </div>
                <button onClick={() => window.print()} style={{ ...btnStyle, background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)' }}>Print Report</button>
            </div>
            
            <div style={{ background: '#fff', border: '1px solid var(--line)', overflowX: 'auto', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                    <thead style={{ background: 'var(--paper)' }}>
                        <tr>
                            <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Time</th>
                            <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>WO #</th>
                            <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>SO #</th>
                            <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Cust PO</th>
                            <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Poles</th>
                            <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Brackets</th>
                            <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Rings</th>
                            <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Finials</th>
                            <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Scrap</th>
                            <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        {completed.length === 0 && <tr><td colSpan="10" style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>No work orders have been completed today.</td></tr>}
                        {completed.map(wo => {
                            // §10: contract WOs carry orderType ('sales'|'stock'); type is now a category.
                            const woKind = wo.orderType || wo.type;
                            let p=0, b=0, r=0, f=0;
                            if(woKind === 'sales') {
                                p = wo.poles?.qty || 0; b = wo.smallParts?.brk || 0; r = wo.smallParts?.rng || 0; f = wo.smallParts?.fin || 0;
                            } else { p = wo.stock?.qty || 0; }
                            
                            const notesArr = [];
                            if(wo.holdReason) notesArr.push(wo.holdReason);
                            if(wo.scrapReported > 0) notesArr.push("Reported Scrap");
                            
                            return (
                                <tr key={wo.id} style={{ borderBottom: '1px solid var(--line)', background: '#fff' }}>
                                    <td style={{ padding: '16px 20px', color: 'var(--ink-soft)' }}>{new Date(wo.completedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                                    <td title={wo.id} style={{ padding: '16px 20px', fontWeight: 500, color: 'var(--ink)' }}>{wo.nsWoTran || wo.displayId || wo.woNum || wo.id}</td>
                                    <td style={{ padding: '16px 20px', color: 'var(--ink)' }}>{wo.soId || '-'}</td>
                                    <td style={{ padding: '16px 20px', color: 'var(--ink-soft)' }}>{wo.custPo || '-'}</td>
                                    <td style={{ padding: '16px 20px', color: 'var(--ink)' }}>{woKind === 'stock' ? <span style={{fontFamily: 'var(--mono)', fontSize: '10px'}}>{p} (STOCK)</span> : p}</td>
                                    <td style={{ padding: '16px 20px', color: 'var(--ink)' }}>{b}</td>
                                    <td style={{ padding: '16px 20px', color: 'var(--ink)' }}>{r}</td>
                                    <td style={{ padding: '16px 20px', color: 'var(--ink)' }}>{f}</td>
                                    <td style={{ padding: '16px 20px', color: wo.scrapReported > 0 ? '#d9534f' : 'var(--ink-soft)', fontWeight: wo.scrapReported > 0 ? 500 : 400 }}>{wo.scrapReported || 0}</td>
                                    <td style={{ padding: '16px 20px', color: 'var(--ink-soft)', fontSize: '0.85rem' }}>{notesArr.join(' | ') || '-'}</td>
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