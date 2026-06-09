import React, { useState } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';

const H1AssemblyGenerator = () => {
    const [isRunning, setIsRunning] = useState(false);
    const [log, setLog] = useState("");

    const handleRunMassUpdate = async () => {
        if (!window.confirm("Run one-time In-House Logistics backfill script?")) return;
        
        setIsRunning(true);
        setLog("Fetching all Approved Designs from database...");

        try {
            const snap = await getDocs(collection(db, "Approved_Designs"));
            let updateCount = 0;
            let batches = [];
            let currentBatch = writeBatch(db);
            let currentBatchCount = 0;

            snap.docs.forEach(document => {
                const data = document.data();
                const specs = data.manufacturingSpecs || {};

                // 1. Target Only In-House Items
                // (If isInHouse is explicitly false, it is outsourced. Otherwise, it's in-house).
                if (specs.isInHouse !== false) {
                    const isAssembly = data.partClass === 'Assembly' || data.partClass === 'Master Assembly';
                    const pType = (specs.productType || "").toUpperCase();
                    
                    const isBracket = pType.includes("BRACKET");
                    const isBackplate = pType.includes("BACKPLATE");
                    const hasProjection = !!specs.customData?.projection;

                    const updates = {};
                    let willUpdate = false;

                    // Rule 1: In-House Bracket Assemblies (With a Projection)
                    if (isAssembly && isBracket && hasProjection) {
                        updates["manufacturingSpecs.reorderPoint"] = "36";
                        updates["manufacturingSpecs.customData.bracketType"] = "WALL";
                        willUpdate = true;
                    } 
                    // Rule 2: In-House Backplates
                    else if (isBackplate) {
                        updates["manufacturingSpecs.reorderPoint"] = "36";
                        willUpdate = true;
                    } 
                    // Rule 3: All other In-House items/assemblies
                    else {
                        updates["manufacturingSpecs.reorderPoint"] = "18";
                        willUpdate = true;
                    }

                    // Apply the batch payload
                    if (willUpdate) {
                        currentBatch.update(doc(db, "Approved_Designs", document.id), updates);
                        updateCount++;
                        currentBatchCount++;

                        // Firestore batch limit safety chunking
                        if (currentBatchCount >= 450) {
                            batches.push(currentBatch.commit());
                            currentBatch = writeBatch(db);
                            currentBatchCount = 0;
                        }
                    }
                }
            });

            // Commit any remaining updates
            if (currentBatchCount > 0) {
                batches.push(currentBatch.commit());
            }

            await Promise.all(batches);
            setLog(`✅ Success! Updated ${updateCount} In-House Records.`);

        } catch (err) {
            console.error(err);
            setLog(`❌ Error: ${err.message}`);
        }
        
        setIsRunning(false);
    };

    return (
        <div style={{ background: '#f0f4f8', border: '1px solid #4a90e2', padding: '24px', marginBottom: '30px', borderRadius: '4px' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#4a90e2', fontFamily: 'var(--serif)', fontSize: '1.4rem' }}>
                ⚙️ ONE-TIME DATA BACKFILL: In-House ROP & Bracket Mounts
            </h3>
            <p style={{ fontSize: '0.95rem', marginBottom: '20px', color: 'var(--ink)', lineHeight: '1.6' }}>
                This script finds all <strong>In-House Items & Assemblies</strong> and updates them based on your rules:<br/><br/>
                • <strong>In-House Bracket Assemblies (with Projection):</strong> Sets ROP to 36, Bracket Mount to WALL<br/>
                • <strong>In-House Backplates:</strong> Sets ROP to 36<br/>
                • <strong>All other In-House Items:</strong> Sets ROP to 18
            </p>
            <button
                onClick={handleRunMassUpdate}
                disabled={isRunning}
                style={{ padding: '16px 32px', background: '#4a90e2', color: '#fff', border: 'none', cursor: isRunning ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}
            >
                {isRunning ? 'Processing Database...' : 'Run Backfill Script'}
            </button>
            
            {log && (
                <div style={{ marginTop: '20px', padding: '16px', background: '#fff', border: '1px solid #4a90e2', color: log.includes('✅') ? '#28a745' : '#d9534f', fontWeight: 500, fontFamily: 'var(--mono)' }}>
                    {log}
                </div>
            )}
        </div>
    );
};

export default H1AssemblyGenerator;