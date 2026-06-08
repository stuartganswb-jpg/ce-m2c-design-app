import React, { useState } from 'react';
import { db } from '../../firebase'; 
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';

const H1AssemblyGenerator = () => {
    const [status, setStatus] = useState("Ready");
    const [progress, setProgress] = useState({ current: 0, total: 0 });

    // The outsourced finish codes to generate for every root item
    const OUTSOURCED_CODES = ['EP01', 'EP02', 'EP03', 'EP04', 'EP05', 'EP06', 'P25']; 

    const generateAssemblies = async () => {
        if (!window.confirm("WARNING: This will generate new /P, /EP, and /P25 assemblies and BOM pins for all root H1 items. Proceed?")) return;
        
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

            setStatus(`Found ${rootItems.length} root items. Generating payloads...`);
            setProgress({ current: 0, total: rootItems.length });

            let operations = [];

            // 3. Build the Payloads
            rootItems.forEach(root => {
                const rootErpId = root.legacyErpId.toUpperCase();
                const brandId = root.brandId || "ce";

                // --- GENERATE /P (PHOSPHATED) IN-HOUSE ASSEMBLY ---
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

                // Add BOM Pin for /P consuming the Root H1 item
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

                // --- GENERATE /EP AND /P25 OUTSOURCED ASSEMBLIES ---
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

                    // Add BOM Pin for the Outsourced item consuming the /P WIP item
                    operations.push({
                        type: 'set',
                        ref: doc(db, "assembly_pins", `BOM-${finishDocId}-P`),
                        data: {
                            assemblyId: finishDocId,
                            partId: pDocId,
                            partName: `${root.itemName} (Phosphated WIP)`,
                            legacyErpId: pId,
                            defaultQty: 1
                        }
                    });
                });
            });

            // 4. Execute in Batches of 400 (Firestore limit is 500)
            const chunkSize = 400;
            for (let i = 0; i < operations.length; i += chunkSize) {
                const chunk = operations.slice(i, i + chunkSize);
                const batch = writeBatch(db);
                
                chunk.forEach(op => {
                    if (op.type === 'set') {
                        batch.set(op.ref, op.data, { merge: true });
                    }
                });

                await batch.commit();
                
                const currentRootProgress = Math.min(rootItems.length, Math.floor((i / operations.length) * rootItems.length));
                setProgress({ current: currentRootProgress, total: rootItems.length });
                setStatus(`Committed batch ${Math.ceil(i / chunkSize) + 1} of ${Math.ceil(operations.length / chunkSize)}...`);
            }

            setStatus("✅ Migration Complete! All WIP, Plated, and P25 assemblies are now linked in the database.");
            setProgress({ current: rootItems.length, total: rootItems.length });

        } catch (error) {
            console.error("Migration Error:", error);
            setStatus(`❌ Error: ${error.message}`);
        }
    };

    return (
        <div style={{ padding: '24px', background: '#fff', border: '1px solid var(--brass)', borderRadius: '2px', margin: '20px 0' }}>
            <h3 style={{ margin: '0 0 12px 0', fontFamily: 'var(--serif)', color: 'var(--ink)' }}>Database Engine: H1 Assembly Migration</h3>
            <p style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink-soft)', marginBottom: '20px' }}>
                Scans the library for root H1 items and automatically constructs the Phosphated (/P), Plated (/EP), and /P25 assemblies, strictly binding them via Bill of Materials.
            </p>
            
            <button 
                onClick={generateAssemblies} 
                style={{ padding: '12px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}
            >
                Execute Mass Generation
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