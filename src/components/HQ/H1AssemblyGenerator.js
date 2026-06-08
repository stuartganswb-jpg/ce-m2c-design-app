import React, { useState } from 'react';
import { db } from '../../firebase'; 
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';

const H1AssemblyGenerator = () => {
    const [status, setStatus] = useState("Ready");
    const [progress, setProgress] = useState({ current: 0, total: 0 });

    // 1. The BAD codes to hunt down and delete
    const BAD_CODES = ['EP01', 'EP02', 'EP03', 'EP04', 'EP05', 'EP06'];
    // 2. The GOOD codes to correctly generate/link
    const GOOD_CODES = ['EP1', 'EP2', 'EP3', 'EP4', 'EP5', 'EP6', 'P25'];

    const executeFix = async () => {
        if (!window.confirm("This will delete the erroneous EP01-EP06 items, and generate/re-link the correct EP1-EP6 and P25 items to their roots without renaming them. Proceed?")) return;
        
        setStatus("Scanning library...");
        
        try {
            const snapshot = await getDocs(collection(db, "Approved_Designs"));
            const allItems = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

            let operations = [];

            // --- 1. IDENTIFY AND NUKE BAD ITEMS & PINS ---
            const badItems = allItems.filter(item => {
                const erpId = item.legacyErpId || "";
                return BAD_CODES.some(bad => erpId.endsWith(`/${bad}`));
            });

            badItems.forEach(bad => {
                operations.push({ type: 'delete', ref: doc(db, "Approved_Designs", bad.id) });
                operations.push({ type: 'delete', ref: doc(db, "assembly_pins", `BOM-${bad.id}-ROOT`) });
                operations.push({ type: 'delete', ref: doc(db, "assembly_pins", `BOM-${bad.id}-P`) });
            });

            // --- 2. IDENTIFY ROOT ITEMS ---
            const rootItems = allItems.filter(item => {
                const erpId = item.legacyErpId || "";
                return erpId.toUpperCase().startsWith("H1") && !erpId.includes("/");
            });

            // --- 3. CORRECT ITEMS & PINS ---
            rootItems.forEach(root => {
                const rootErpId = root.legacyErpId.toUpperCase();
                const brandId = root.brandId || "ce";

                // Ensure /P is linked correctly
                const pId = `${rootErpId}/P`;
                const pDocId = `AUTO-${pId.replace(/[^a-zA-Z0-9]/g, '')}`;
                const existingP = allItems.find(i => i.legacyErpId === pId);
                
                operations.push({
                    type: 'set', ref: doc(db, "Approved_Designs", pDocId),
                    data: {
                        id: pDocId, itemId: pDocId, legacyErpId: pId,
                        // PRESERVE Existing Name if it exists
                        itemName: existingP ? existingP.itemName : `${root.itemName} (Phosphated WIP)`,
                        partClass: "Assembly", routingType: "Finishing", brandId: brandId,
                        manufacturingSpecs: { 
                            ...(root.manufacturingSpecs || {}), 
                            ...(existingP?.manufacturingSpecs || {}), // PRESERVE existing specs
                            isInHouse: true, outsourceAction: "" 
                        }
                    }
                });
                operations.push({
                    type: 'set', ref: doc(db, "assembly_pins", `BOM-${pDocId}-ROOT`),
                    data: { assemblyId: pDocId, partId: root.id, partName: root.itemName, legacyErpId: rootErpId, defaultQty: 1 }
                });

                // Generate/Update Good Codes (/EP1 - /EP6, /P25)
                GOOD_CODES.forEach(finishCode => {
                    const finishId = `${rootErpId}/${finishCode}`;
                    const finishDocId = `AUTO-${finishId.replace(/[^a-zA-Z0-9]/g, '')}`;
                    const existingFinish = allItems.find(i => i.legacyErpId === finishId);
                    
                    const labelPrefix = finishCode.startsWith('EP') ? 'Plated' : 'Outsourced';
                    const fallbackName = `${root.itemName} (${labelPrefix} ${finishCode})`;

                    operations.push({
                        type: 'set', ref: doc(db, "Approved_Designs", finishDocId),
                        data: {
                            id: finishDocId, itemId: finishDocId, legacyErpId: finishId,
                            // PRESERVE Existing Name if it exists
                            itemName: existingFinish ? existingFinish.itemName : fallbackName,
                            partClass: "Assembly", routingType: "Plating", brandId: brandId,
                            manufacturingSpecs: { 
                                ...(root.manufacturingSpecs || {}), 
                                ...(existingFinish?.manufacturingSpecs || {}), // PRESERVE existing specs
                                isInHouse: false, outsourceAction: "PLATING" 
                            }
                        }
                    });

                    // Delete the old, incorrect pin (just in case)
                    operations.push({
                        type: 'delete', ref: doc(db, "assembly_pins", `BOM-${finishDocId}-P`)
                    });

                    // Add the new, correct pin pointing directly to the ROOT item
                    operations.push({
                        type: 'set', ref: doc(db, "assembly_pins", `BOM-${finishDocId}-ROOT`),
                        data: { assemblyId: finishDocId, partId: root.id, partName: root.itemName, legacyErpId: rootErpId, defaultQty: 1 }
                    });
                });
            });

            // --- 4. EXECUTE BATCHES ---
            const chunkSize = 400;
            for (let i = 0; i < operations.length; i += chunkSize) {
                const chunk = operations.slice(i, i + chunkSize);
                const batch = writeBatch(db);
                chunk.forEach(op => {
                    if (op.type === 'set') batch.set(op.ref, op.data, { merge: true });
                    else if (op.type === 'delete') batch.delete(op.ref);
                });
                await batch.commit();
                setProgress({ current: Math.min(operations.length, i + chunkSize), total: operations.length });
                setStatus(`Committed batch ${Math.ceil(i / chunkSize)} of ${Math.ceil(operations.length / chunkSize)}...`);
            }

            setStatus(`✅ Fixed! Deleted ${badItems.length} bad items. Corrected EP1-EP6 descriptions and links.`);

        } catch (error) {
            console.error(error);
            setStatus(`❌ Error: ${error.message}`);
        }
    };

    return (
        <div style={{ padding: '24px', background: '#fff', border: '1px solid #d9534f', borderRadius: '2px', margin: '20px 0' }}>
            <h3 style={{ margin: '0 0 12px 0', fontFamily: 'var(--serif)', color: '#d9534f' }}>Database Corrector: Fix EP01 - EP06</h3>
            <p style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink-soft)', marginBottom: '20px' }}>
                Finds and deletes erroneous EP01-EP06 assemblies. Re-links EP1-EP6 and P25 directly to the Root while PRESERVING their current item descriptions.
            </p>
            <button onClick={executeFix} style={{ padding: '12px 24px', background: '#d9534f', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                Execute Clean & Re-Link
            </button>
            <div style={{ marginTop: '20px', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>
                <strong>Status:</strong> {status}
                {progress.total > 0 && (
                    <div style={{ marginTop: '8px', background: 'var(--paper-2)', height: '10px', width: '100%', borderRadius: '5px', overflow: 'hidden' }}>
                        <div style={{ width: `${(progress.current / progress.total) * 100}%`, height: '100%', background: '#d9534f', transition: 'width 0.3s' }}></div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default H1AssemblyGenerator;