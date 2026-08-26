import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp } from "firebase/firestore";

const ProjectManagementTab = ({ currentUser, activeBrand }) => {
    const [projects, setProjects] = useState([]);
    const [activeProject, setActiveProject] = useState(null);
    const [libraryParts, setLibraryParts] = useState([]);

    useEffect(() => {
        if (!activeBrand) return;
        const q = query(
            collection(db, "jobs"), 
            where("brandId", "==", activeBrand), 
            where("isProjectManaged", "==", true)
        );
        const unsub = onSnapshot(q, (snap) => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(j => !j.deleted);
            docs.sort((a, b) => {
                const timeA = a.createdAt?.seconds || 0;
                const timeB = b.createdAt?.seconds || 0;
                return timeB - timeA;
            });
            setProjects(docs);
        });
        return () => unsub();
    }, [activeBrand]);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
            setLibraryParts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, []);

    const getPartInfo = (partId) => {
        if (!partId) return { name: 'Unknown Part', isInHouse: true, vendor: 'Unknown' };
        
        const p = libraryParts.find(x => x.id === partId || x.itemId === partId || x.legacyErpId === partId);
        if (!p) return { name: partId, isInHouse: true, vendor: 'Internal Factory' };
        
        return { 
            name: p.itemName || partId, 
            isInHouse: p.manufacturingSpecs?.isInHouse !== false,
            vendor: p.manufacturingSpecs?.vendorName || 'Unknown Vendor'
        };
    };

    const handleSimulateErpSync = async () => {
        if (!activeProject) return;
        if (!window.confirm("⚠️ SIMULATION: Auto-assigning Sales Order # and cascading Work/Purchase Orders to all line items. Proceed?")) return;

        const dummySo = `SO-PRJ-${Math.floor(1000 + Math.random() * 9000)}`;
        const updatedLines = [];
        let count = 1;

        if (activeProject.cpqData?.configuration) {
            Object.values(activeProject.cpqData.configuration).forEach(val => {
                if (!val) return;
                
                const info = getPartInfo(val);
                const orderType = info.isInHouse ? 'WO' : 'PO';
                const orderId = `${orderType}-${dummySo.split('-')[2]}-00${count}`;
                
                updatedLines.push({
                    partId: val,
                    partName: info.name,
                    orderType: orderType,
                    orderId: orderId,
                    vendor: info.isInHouse ? 'Internal Factory' : info.vendor,
                    status: 'Dispatched to Floor'
                });
                count++;
            });
        }

        try {
            const batch = writeBatch(db);
            const jobRef = doc(db, "jobs", activeProject.id);
            
            batch.update(jobRef, {
                soNum: dummySo,
                projectLines: updatedLines,
                status: 'IN_PRODUCTION',
                erpSyncedAt: serverTimestamp()
            });

            await batch.commit();
            alert(`✅ Simulation Complete! Assigned ${dummySo} with ${updatedLines.length} child orders.`);
        } catch (e) {
            console.error(e);
            alert("Simulation failed.");
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
            
            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Complex Build Tracking & Multi-Order Dissection</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Project Management</h2>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flex: 1 }}>
                
                {/* LEFT: PROJECT LIST QUEUE */}
                <div style={{ width: '380px', background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', flexShrink: 0 }}>
                    <div style={{ padding: '20px 24px', background: 'var(--paper-2)', color: 'var(--ink)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500 }}>Active Projects</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>{projects.length} Total</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '24px', background: '#fff', minHeight: '600px', overflowY: 'auto' }}>
                        {projects.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', textAlign: 'center' }}>No active complex projects.</div>}
                        
                        {projects.map(p => {
                            const isSelected = activeProject?.id === p.id;
                            return (
                                <div key={p.id} onClick={() => setActiveProject(p)} style={{ background: isSelected ? 'var(--paper-2)' : '#fff', border: `1px solid ${isSelected ? 'var(--brass)' : 'var(--line)'}`, padding: '20px', cursor: 'pointer', transition: 'all 0.2s', boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontFamily: 'var(--sans)', fontWeight: 500, fontSize: '1.1rem', color: 'var(--ink)' }}>{p.soNum || 'Pending SO#'}</span>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: p.status === 'CONFIGURED' ? 'var(--ink-soft)' : 'var(--ink)', background: p.status === 'CONFIGURED' ? 'var(--paper)' : 'var(--brass-light)', border: '1px solid var(--line)', padding: '4px 8px' }}>
                                            {p.status === 'CONFIGURED' ? 'Awaiting ERP' : 'In Prod'}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', marginTop: '12px', fontWeight: 500 }}>{p.jobName || p.sidemark}</div>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '8px' }}>{p.customer?.name}</div>
                                </div>
                            )
                        })}
                    </div>
                </div>

                {/* RIGHT: PROJECT DETAILS & DISSECTION DASHBOARD */}
                <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', minHeight: '600px' }}>
                    {!activeProject ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.4rem' }}>
                            Select a project from the queue to view dissection.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            
                            {/* Dashboard Header */}
                            <div style={{ padding: '30px 40px', background: 'var(--paper-2)', color: 'var(--ink)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                                <div>
                                    <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500 }}>{activeProject.jobName || activeProject.sidemark}</h3>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '8px' }}>{activeProject.customer?.name}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontFamily: 'var(--sans)', fontSize: '1.2rem', fontWeight: 500, background: '#fff', border: '1px solid var(--line)', padding: '10px 20px', color: 'var(--ink)' }}>
                                        {activeProject.soNum || 'No Sales Order Assigned'}
                                    </div>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '8px' }}>Quote Ref: {activeProject.jobId}</div>
                                </div>
                            </div>

                            {/* KPI Banner */}
                            <div style={{ padding: '30px 40px', background: 'var(--paper)', borderBottom: '1px solid var(--line)', display: 'flex', gap: '40px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Required Date</label>
                                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)', fontWeight: 500 }}>{activeProject.reqDate || 'TBD'}</div>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Total Value</label>
                                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)', fontWeight: 500 }}>${activeProject.cpqData?.totalPrice?.toFixed(2) || '0.00'}</div>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Master Assembly</label>
                                    <div style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>
                                        {getPartInfo(activeProject.linkedAssemblyId).name}
                                    </div>
                                </div>
                            </div>

                            {/* Dissection Table */}
                            <div style={{ padding: '40px', flex: 1, overflowY: 'auto' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                                    <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Line Item Dissection (CPQ Components)</h4>
                                    {!activeProject.soNum && (
                                        <button onClick={handleSimulateErpSync} style={{ padding: '12px 24px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'background 0.2s' }}>
                                            Test: Simulate ERP Dissection
                                        </button>
                                    )}
                                </div>

                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontFamily: 'var(--sans)' }}>
                                    <thead style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)', borderTop: '1px solid var(--line)' }}>
                                        <tr>
                                            <th style={{ padding: '16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Component Name</th>
                                            <th style={{ padding: '16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Type</th>
                                            <th style={{ padding: '16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Assigned Order #</th>
                                            <th style={{ padding: '16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Vendor / Destination</th>
                                            <th style={{ padding: '16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {activeProject.projectLines ? (
                                            activeProject.projectLines.map((line, idx) => (
                                                <tr key={idx} style={{ borderBottom: '1px solid var(--line)', background: line.orderType === 'WO' ? '#fff' : 'var(--paper-2)' }}>
                                                    <td style={{ padding: '20px 16px', fontWeight: 500, color: 'var(--ink)' }}>{line.partName}</td>
                                                    <td style={{ padding: '20px 16px', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>
                                                        {line.orderType === 'WO' ? 'In-House (WO)' : 'Outsource (PO)'}
                                                    </td>
                                                    <td style={{ padding: '20px 16px', fontWeight: 500, fontSize: '1.05rem', color: 'var(--ink)' }}>{line.orderId}</td>
                                                    <td style={{ padding: '20px 16px', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>{line.vendor}</td>
                                                    <td style={{ padding: '20px 16px' }}>
                                                        <span style={{ background: 'var(--paper)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                                            {line.status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan="5" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>
                                                    Order has not been dissected yet. Awaiting ERP Sync to generate Work/Purchase Orders.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

export default ProjectManagementTab;