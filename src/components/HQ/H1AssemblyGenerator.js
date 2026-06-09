import React, { useState } from 'react';
import { db } from '../../firebase';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';

const H1AssemblyGenerator = () => {
    const [isRunning, setIsRunning] = useState(false);
    const [log, setLog] = useState("");

    const handleRunMassUpdate = async () => {
        if (!window.confirm("Run one-time Dayton Grey backfill script? This will update thousands of records.")) return;
        
        setIsRunning(true);
        setLog("Fetching all Approved Designs from database...");

        try {
            const snap = await getDocs(collection(db, "Approved_Designs"));
            let updateCount = 0;
            let batches = [];
            
            // Firestore limits batches to 500 operations. We will chunk them.
            let currentBatch = writeBatch(db);
            let currentBatchCount = 0;

            snap.docs.forEach(document => {
                const data = document.data();
                const specs = data.manufacturingSpecs || {};

                // 1. Identify Target Records
                const isAssembly = data.partClass === 'Assembly' || data.partClass === 'Master Assembly';
                const isOutsourced = specs.isInHouse === false;
                
                const outAction = (specs.outsourceAction || "").toUpperCase();
                const isPlated = outAction === "PLATED" || outAction.includes("PLATING");

                // If it matches the exact criteria requested
                if (isAssembly && isOutsourced && isPlated) {
                    
                    const pType = specs.productType || "";
                    const isBracket = pType.toUpperCase().includes("BRACKET");

                    // 2. Build the exact field updates using Dot Notation 
                    // (This safely updates nested fields without deleting sibling fields)
                    const updates = {
                        "manufacturingSpecs.vendorName": "Dayton Grey",
                        "manufacturingSpecs.vendorId": pType,
                        "manufacturingSpecs.leadTime": "14",
                        "manufacturingSpecs.reorderPoint": isBracket ? "10" : "6"
                    };

                    // 3. Conditional Bracket Logic
                    if (isBracket && specs.customData?.projection) {
                        updates["manufacturingSpecs.customData.bracketType"] = "WALL";
                    }

                    // Add to the batch queue
                    currentBatch.update(doc(db, "Approved_Designs", document.id), updates);
                    updateCount++;
                    currentBatchCount++;

                    // Commit batch if we hit the 450 limit
                    if (currentBatchCount >= 450) {
                        batches.push(currentBatch.commit());
                        currentBatch = writeBatch(db);
                        currentBatchCount = 0;
                    }
                }
            });

            // Commit any remaining updates
            if (currentBatchCount > 0) {
                batches.push(currentBatch.commit());
            }

            await Promise.all(batches);
            setLog(`✅ Success! Updated ${updateCount} Plated Outsourced Assemblies.`);

        } catch (err) {
            console.error(err);
            setLog(`❌ Error: ${err.message}`);
        }
        
        setIsRunning(false);
    };

    return (
        <div style={{ background: '#fdf2f2', border: '1px solid #d9534f', padding: '24px', marginBottom: '30px', borderRadius: '4px' }}>
            <h3 style={{ margin: '0 0 12px 0', color: '#d9534f', fontFamily: 'var(--serif)', fontSize: '1.4rem' }}>
                ⚠️ ONE-TIME DATA BACKFILL: Dayton Grey & Plating
            </h3>
            <p style={{ fontSize: '0.95rem', marginBottom: '20px', color: 'var(--ink)', lineHeight: '1.6' }}>
                This script finds all <strong>Outsourced Assemblies</strong> mapped to the <strong>Plated</strong> or <strong>PLATING</strong> Outsource Action and automatically sets:<br/><br/>
                • <strong>Vendor:</strong> Dayton Grey<br/>
                • <strong>Vendor Part # / SKU:</strong> [Injected from Product Type]<br/>
                • <strong>Lead Time:</strong> 14 Days<br/>
                • <strong>Reorder Pt (ROP):</strong> 10 (If Bracket) / 6 (All others)<br/>
                • <strong>Bracket Mount:</strong> Wall (If Bracket AND has a Projection)
            </p>
            <button
                onClick={handleRunMassUpdate}
                disabled={isRunning}
                style={{ padding: '16px 32px', background: '#d9534f', color: '#fff', border: 'none', cursor: isRunning ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}
            >
                {isRunning ? 'Processing Database...' : 'Run Backfill Script'}
            </button>
            
            {log && (
                <div style={{ marginTop: '20px', padding: '16px', background: '#fff', border: '1px solid #d9534f', color: log.includes('✅') ? '#28a745' : '#d9534f', fontWeight: 500, fontFamily: 'var(--mono)' }}>
                    {log}
                </div>
            )}
        </div>
    );
};

export default H1AssemblyGenerator;