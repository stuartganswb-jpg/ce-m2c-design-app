import React, { useState } from 'react';
import { db, storage } from '../../firebase';
import { collection, addDoc, serverTimestamp, getDocs, deleteDoc, doc, query } from "firebase/firestore";
import { ref, deleteObject } from "firebase/storage";

const EngineeringTab = ({ currentUser, currentProjectData }) => {
  const [projectName, setProjectName] = useState("");
  const [approvals, setApprovals] = useState({ designer: false, technical: false, machinist: false });
  const [isArchived, setIsArchived] = useState(false);

  const toggleApproval = (role) => setApprovals(prev => ({ ...prev, [role]: !prev[role] }));
  const allApproved = approvals.designer && approvals.technical && approvals.machinist;

  const archiveAndClearWorkspace = async () => {
    if (!projectName) return alert("Enter Project Name!");
    if (!currentProjectData?.isFinal) return alert("Wait! You must mark a revision as 'FINAL' on the Inception tab before archiving.");

    try {
      // 1. Save to Permanent Library
      await addDoc(collection(db, "Design_Library"), {
        projectName: projectName.toUpperCase(),
        finalImageUrl: currentProjectData.imageUrl,
        pins: currentProjectData.pins,
        approvedBy: currentUser,
        archivedAt: serverTimestamp(),
      });

      // 2. WIPE THE WORKSPACE
      const q = query(collection(db, "project_images"));
      const snapshot = await getDocs(q);

      const deletePromises = snapshot.docs.map(async (docSnap) => {
        const data = docSnap.data();
        await deleteDoc(doc(db, "project_images", docSnap.id));
        try {
          const fileRef = ref(storage, data.imageUrl);
          await deleteObject(fileRef);
        } catch(e) { console.log("File cleanup skipped or already gone."); }
      });

      // 3. Clear Markup Pins
      const pinSnap = await getDocs(collection(db, "markups"));
      const pinDeletes = pinSnap.docs.map(p => deleteDoc(doc(db, "markups", p.id)));

      await Promise.all([...deletePromises, ...pinDeletes]);

      setIsArchived(true);
      alert("Project Archived. Workspace cleared for next item.");
      window.location.reload();
    } catch (err) { console.error(err); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh', maxWidth: '900px', margin: '0 auto' }}>
      
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Stage 2</span>
          <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Engineering Sign-Off</h2>
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', display: 'flex', flexDirection: 'column', gap: '24px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
          <div>
              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' }}>Project Name (Recall ID)</label>
              <input 
                value={projectName} 
                onChange={(e) => setProjectName(e.target.value)} 
                placeholder="e.g. THE DAWN44 SERIES" 
                style={{ width: '100%', padding: '16px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '1rem', boxSizing: 'border-box' }}
              />
          </div>
          
          <div>
              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '12px', letterSpacing: '.1em' }}>Required Approvals</label>
              <div style={{ display: 'flex', gap: '16px' }}>
                {['designer', 'technical', 'machinist'].map(role => (
                  <button 
                    key={role} 
                    onClick={() => toggleApproval(role)} 
                    style={{ 
                        flex: 1, padding: '20px', 
                        background: approvals[role] ? 'var(--paper-2)' : '#fff', 
                        color: 'var(--ink)', 
                        border: `1px solid ${approvals[role] ? 'var(--brass)' : 'var(--line)'}`, 
                        cursor: 'pointer', fontFamily: 'var(--sans)', fontSize: '0.95rem',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                        transition: 'all 0.2s ease',
                        boxShadow: approvals[role] ? '0 4px 12px rgba(0,0,0,0.05)' : 'none'
                    }}
                  >
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: approvals[role] ? 'var(--brass)' : 'var(--ink-soft)' }}>
                        {role.replace('technical', 'technical designer')}
                    </span>
                    <span style={{ fontWeight: 500 }}>
                        {approvals[role] ? "Approved ✓" : "Pending"}
                    </span>
                  </button>
                ))}
              </div>
          </div>

          {allApproved && !isArchived && (
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: '24px', marginTop: '8px' }}>
                <button 
                  onClick={archiveAndClearWorkspace} 
                  style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s ease' }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'var(--brass)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'var(--ink)'}
                >
                  Confirm Archive & Wipe Workspace
                </button>
                <p style={{ textAlign: 'center', fontFamily: 'var(--serif)', fontSize: '0.9rem', color: 'var(--ink-soft)', marginTop: '12px', fontStyle: 'italic' }}>
                    This will permanently archive the design and clear the inception board for the next item.
                </p>
            </div>
          )}
      </div>
    </div>
  );
};

export default EngineeringTab;