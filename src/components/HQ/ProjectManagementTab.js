import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, doc, writeBatch, serverTimestamp } from "firebase/firestore";

const ProjectManagementTab = ({ currentUser, activeBrand }) => {
    const [projects, setProjects] = useState([]);
    const [activeProject, setActiveProject] = useState(null);
    const [libraryParts, setLibraryParts] = useState([]);

    // 1. Fetch Complex Projects (Jobs flagged with isProjectManaged)
    useEffect(() => {
        if (!activeBrand) return;
        const q = query(
            collection(db, "jobs"), 
            where("brandId", "==", activeBrand), 
            where("isProjectManaged", "==", true)
        );
        const unsub = onSnapshot(q, (snap) => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Sort by newest first
            docs.sort((a, b) => {
                const timeA = a.createdAt?.seconds || 0;
                const timeB = b.createdAt?.seconds || 0;
                return timeB - timeA;
            });
            setProjects(docs);
        });
        return () => unsub();
    }, [activeBrand]);

    // 2. Fetch Master Parts Dictionary for ID Resolution & Vendor Lookup
    useEffect(() => {
        const unsub = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
            setLibraryParts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, []);

    // Helper: Find the part name and routing destination based on the CPQ ID
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

    // 🚀 THE ERP SIMULATION ENGINE
    const handleSimulateErpSync = async () => {
        if (!activeProject) return;
        if (!window.confirm("⚠️ SIMULATION: Auto-assigning Sales Order # and cascading Work/Purchase Orders to all line items. Proceed?")) return;

        // Generate a mock master Sales Order Number
        const dummySo = `SO-PRJ-${Math.floor(1000 + Math.random() * 9000)}`;
        const updatedLines = [];
        let count = 1;

        // Dissect the CPQ configuration line-by-line
        if (activeProject.cpqData?.configuration) {
            Object.values(activeProject.cpqData.configuration).forEach(val => {
                if (!val) return;
                
                const info = getPartInfo(val);
                const orderType = info.isInHouse ? 'WO' : 'PO';
                // E.g., WO-8492-001 or PO-8492-002
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
            
            // Update the master job document with the dissected lines
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
            
            {/* HEADER */}
            <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
                <div>
                    <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#17a2b8' }}>10.5 Project Management</h2>
                    <span style={{ fontSize: '0.7rem', color: '#666' }}>COMPLEX BUILD TRACKING & MULTI-ORDER DISSECTION</span>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flex: 1 }}>
                
                {/* LEFT: PROJECT LIST QUEUE */}
                <div style={{ width: '350px', background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)', flexShrink: 0 }}>
                    <div style={{ padding: '15px', background: '#000', color: '#fff', fontWeight: 'bold' }}>
                        ACTIVE PROJECTS ({projects.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '15px', background: '#f8f9fa', minHeight: '600px', overflowY: 'auto' }}>
                        {projects.length === 0 && <div style={{ color: '#999', fontStyle: 'italic', fontSize: '0.85rem' }}>No active complex projects.</div>}
                        
                        {projects.map(p => {
                            const isSelected = activeProject?.id === p.id;
                            return (
                                <div key={p.id} onClick={() => setActiveProject(p)} style={{ background: isSelected ? '#e6f2ff' : '#fff', border: `2px solid ${isSelected ? '#17a2b8' : '#ccc'}`, padding: '15px', cursor: 'pointer', transition: '0.2s', boxShadow: isSelected ? '4px 4px 0 #17a2b8' : 'none' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '1rem', color: '#000' }}>
                                        <span>{p.soNum || 'PENDING SO#'}</span>
                                        <span style={{ color: p.status === 'CONFIGURED' ? '#ffc107' : '#28a745', fontSize: '0.8rem', background: '#333', padding: '2px 6px', borderRadius: '4px' }}>
                                            {p.status === 'CONFIGURED' ? 'AWAITING ERP' : 'IN PROD'}
                                        </span>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '10px', fontWeight: 'bold' }}>{p.jobName || p.sidemark}</div>
                                    <div style={{ fontSize: '0.75rem', color: '#17a2b8', marginTop: '5px', fontWeight: 'bold' }}>{p.customer?.name}</div>
                                </div>
                            )
                        })}
                    </div>
                </div>

                {/* RIGHT: PROJECT DETAILS & DISSECTION DASHBOARD */}
                <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)', minHeight: '600px' }}>
                    {!activeProject ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontWeight: 'bold', fontSize: '1.2rem' }}>
                            SELECT A PROJECT FROM THE QUEUE TO VIEW DISSECTION
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                            
                            {/* Dashboard Header */}
                            <div style={{ padding: '20px', background: '#17a2b8', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '1.6rem' }}>{activeProject.jobName || activeProject.sidemark}</h3>
                                    <div style={{ fontSize: '0.9rem', opacity: 0.9, marginTop: '5px' }}>{activeProject.customer?.name}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: '1.4rem', fontWeight: 'bold', background: '#000', padding: '5px 15px' }}>
                                        {activeProject.soNum || 'NO SALES ORDER ASSIGNED'}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', marginTop: '5px' }}>Quote Ref: {activeProject.jobId}</div>
                                </div>
                            </div>

                            {/* KPI Banner */}
                            <div style={{ padding: '20px', background: '#eafaf1', borderBottom: '2px solid #ccc', display: 'flex', gap: '20px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666' }}>REQUIRED DATE:</label>
                                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#d9534f' }}>{activeProject.reqDate || 'TBD'}</div>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666' }}>TOTAL VALUE:</label>
                                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#28a745' }}>${activeProject.cpqData?.totalPrice?.toFixed(2) || '0.00'}</div>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666' }}>MASTER ASSEMBLY:</label>
                                    <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#007bff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {getPartInfo(activeProject.linkedAssemblyId).name}
                                    </div>
                                </div>
                            </div>

                            {/* Dissection Table */}
                            <div style={{ padding: '20px', flex: 1, overflowY: 'auto' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                    <h4 style={{ margin: 0, color: '#333' }}>📋 LINE ITEM DISSECTION (CPQ COMPONENTS)</h4>
                                    {!activeProject.soNum && (
                                        <button onClick={handleSimulateErpSync} style={{ padding: '10px 20px', background: '#ffc107', color: '#000', border: '2px solid #856404', fontWeight: 'bold', cursor: 'pointer', boxShadow: '2px 2px 0 #856404', transition: '0.2s' }}>
                                            ⚠️ TEST: SIMULATE ERP DISSECTION
                                        </button>
                                    )}
                                </div>

                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                                    <thead style={{ background: '#333', color: '#fff' }}>
                                        <tr>
                                            <th style={{ padding: '12px', borderBottom: '2px solid #000' }}>COMPONENT NAME</th>
                                            <th style={{ padding: '12px', borderBottom: '2px solid #000' }}>TYPE</th>
                                            <th style={{ padding: '12px', borderBottom: '2px solid #000' }}>ASSIGNED ORDER #</th>
                                            <th style={{ padding: '12px', borderBottom: '2px solid #000' }}>VENDOR / DESTINATION</th>
                                            <th style={{ padding: '12px', borderBottom: '2px solid #000' }}>STATUS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {activeProject.projectLines ? (
                                            activeProject.projectLines.map((line, idx) => (
                                                <tr key={idx} style={{ borderBottom: '1px solid #ccc', background: line.orderType === 'WO' ? '#e6f2ff' : '#fff0f0' }}>
                                                    <td style={{ padding: '15px', fontWeight: 'bold', color: '#000' }}>{line.partName}</td>
                                                    <td style={{ padding: '15px', fontWeight: 'bold', color: line.orderType === 'WO' ? '#007bff' : '#d9534f' }}>
                                                        {line.orderType === 'WO' ? 'IN-HOUSE (WO)' : 'OUTSOURCE (PO)'}
                                                    </td>
                                                    <td style={{ padding: '15px', fontWeight: 'bold', fontSize: '1rem' }}>{line.orderId}</td>
                                                    <td style={{ padding: '15px', color: '#666', fontWeight: 'bold' }}>{line.vendor}</td>
                                                    <td style={{ padding: '15px' }}>
                                                        <span style={{ background: line.orderType === 'WO' ? '#28a745' : '#17a2b8', color: '#fff', padding: '4px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 'bold' }}>
                                                            {line.status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))
                                        ) : (
                                            <tr>
                                                <td colSpan="5" style={{ padding: '40px 20px', textAlign: 'center', color: '#999', fontStyle: 'italic', fontSize: '1rem' }}>
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