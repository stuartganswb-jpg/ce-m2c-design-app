import React, { useState } from 'react';
import { db } from '../../firebase'; 
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';

const H1AssemblyGenerator = () => {
    const [status, setStatus] = useState("Ready");
    const [progress, setProgress] = useState({ current: 0, total: 0 });

    // The outsourced finish codes
    const OUTSOURCED_CODES = ['EP01', 'EP02', 'EP03', 'EP04', 'EP05', 'EP06', 'P25']; 

    const generateAssemblies = async () => {
        if (!window.confirm("WARNING: This will remap /EP and /P25 assemblies to consume the ROOT item and delete the old incorrect /P pins. Proceed?")) return;
        
        setStatus("Fetching Root H1 Items...");
        
        try {
            // 1. Fetch all designs
            const snapshot = await getDocs(collection(db, "Approved_Designs"));
            const allItems = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

            // 2. Filter for Root Items (Starts with H1, does NOT contain a slash)
            const rootItems = allItems.filter(item => {
                const erpId = item.legacyErpId || "";
                return erpId.toUpperCase().startsWith("H1") && !erpId.includes("/");
            });

            setStatus(`Found ${rootItems.length} root items. Generating correction payloads...`);
            setProgress({ current: 0, total: rootItems.length });

            let operations = [];

            // 3. Build the Payloads
            rootItems.forEach(root => {
                const rootErpId = root.legacyErpId.toUpperCase();
                const brandId = root.brandId || "ce";

                // --- 1. PRESERVE /P (PHOSPHATED) IN-HOUSE ASSEMBLY (Unchanged) ---
                const pId = `${rootErpId}/P`;
                const pDocId = `AUTO-${pId.replace(/[^a-zA-Z0-9]/g, '')}`;
                
                operations.push({
                    type: 'set',
                    ref: doc(db, "Approved_Designs", pDocId),
                    data: {
                        id: pDocId,
                        itemId: pDocId,
                        legacyErpId: pId,
                        itemName: `${root.itemName} (Phosphated WIP)`,
                        partClass: "Assembly",
                        routingType: "Finishing", 
                        brandId: brandId,
                        manufacturingSpecs: {
                            ...(root.manufacturingSpecs || {}),
                            isInHouse: true,
                            outsourceAction: ""
                        },
                        createdAt: new Date().toISOString()
                    }
                });

                operations.push({
                    type: 'set',
                    ref: doc(db, "assembly_pins", `BOM-${pDocId}-ROOT`),
                    data: {
                        assemblyId: pDocId,
                        partId: root.id,
                        partName: root.itemName,
                        legacyErpId: rootErpId,
                        defaultQty: 1
                    }
                });

                // --- 2. CORRECT /EP AND /P25 OUTSOURCED ASSEMBLIES ---
                OUTSOURCED_CODES.forEach(finishCode => {
                    const finishId = `${rootErpId}/${finishCode}`;
                    const finishDocId = `AUTO-${finishId.replace(/[^a-zA-Z0-9]/g, '')}`;
                    
                    const labelPrefix = finishCode.startsWith('EP') ? 'Plated' : 'Outsourced';

                    operations.push({
                        type: 'set',
                        ref: doc(db, "Approved_Designs", finishDocId),
                        data: {
                            id: finishDocId,
                            itemId: finishDocId,
                            legacyErpId: finishId,
                            itemName: `${root.itemName} (${labelPrefix} ${finishCode})`,
                            partClass: "Assembly",
                            routingType: "Plating", 
                            brandId: brandId,
                            manufacturingSpecs: {
                                ...(root.manufacturingSpecs || {}),
                                isInHouse: false, 
                                outsourceAction: "PLATING"
                            },
                            createdAt: new Date().toISOString()
                        }
                    });

                    // 🚨 CLEANUP: Delete the old, incorrect pin pointing to the /P item
                    operations.push({
                        type: 'delete',
                        ref: doc(db, "assembly_pins", `BOM-${finishDocId}-P`)
                    });

                    // ✅ FIX: Add the new, correct pin pointing directly to the ROOT item
                    operations.push({
                        type: 'set',
                        ref: doc(db, "assembly_pins", `BOM-${finishDocId}-ROOT`),
                        data: {
                            assemblyId: finishDocId,
                            partId: root.id,
                            partName: root.itemName,
                            legacyErpId: rootErpId,
                            defaultQty: 1
                        }
                    });
                });
            });

            // 4. Execute in Batches of 400
            const chunkSize = 400;
            for (let i = 0; i < operations.length; i += chunkSize) {
                const chunk = operations.slice(i, i + chunkSize);
                const batch = writeBatch(db);
                
                chunk.forEach(op => {
                    if (op.type === 'set') {
                        batch.set(op.ref, op.data, { merge: true });
                    } else if (op.type === 'delete') {
                        batch.delete(op.ref);
                    }
                });

                await batch.commit();
                
                const currentRootProgress = Math.min(rootItems.length, Math.floor((i / operations.length) * rootItems.length));
                setProgress({ current: currentRootProgress, total: rootItems.length });
                setStatus(`Committed batch ${Math.ceil(i / chunkSize)} of ${Math.ceil(operations.length / chunkSize)}...`);
            }

            setStatus("✅ Correction Complete! /EP and /P25 items now consume the Root Raw Material directly.");
            setProgress({ current: rootItems.length, total: rootItems.length });

        } catch (error) {
            console.error("Migration Error:", error);
            setStatus(`❌ Error: ${error.message}`);
        }
    };

    return (
        <div style={{ padding: '24px', background: '#fff', border: '1px solid var(--brass)', borderRadius: '2px', margin: '20px 0' }}>
            <h3 style={{ margin: '0 0 12px 0', fontFamily: 'var(--serif)', color: 'var(--ink)' }}>Database Engine: H1 BOM Correction</h3>
            <p style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink-soft)', marginBottom: '20px' }}>
                Remaps outsourced finishes (/EP and /P25) to consume the root component instead of the Phosphated (/P) component, and deletes the erroneous links.
            </p>
            
            <button 
                onClick={generateAssemblies} 
                style={{ padding: '12px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}
            >
                Execute Correction
            </button>

            <div style={{ marginTop: '20px', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>
                <strong>Status:</strong> {status}
                {progress.total > 0 && (
                    <div style={{ marginTop: '8px', background: 'var(--paper-2)', height: '10px', width: '100%', borderRadius: '5px', overflow: 'hidden' }}>
                        <div style={{ width: `${(progress.current / progress.total) * 100}%`, height: '100%', background: 'var(--brass)', transition: 'width 0.3s' }}></div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default H1AssemblyGenerator;