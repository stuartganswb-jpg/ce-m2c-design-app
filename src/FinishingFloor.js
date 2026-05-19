import React from 'react';
import { useNavigate } from 'react-router-dom';

const FinishingFloor = () => {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#e5e5e5', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      
      {/* FINISHING FLOOR HEADER */}
      <header style={{ backgroundColor: '#6f42c1', color: '#fff', padding: '15px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '4px solid #000' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', letterSpacing: '2px' }}>FINISHING FLOOR</h1>
          <span style={{ fontSize: '0.7rem', opacity: 0.9, fontWeight: 'bold' }}>PAINT, PATINA, PLATING, & QA</span>
        </div>
        <div>
          <button onClick={() => navigate('/')} style={{ padding: '8px 15px', fontSize: '0.8rem', cursor: 'pointer', background: '#fff', color: '#6f42c1', border: '2px solid #000', fontWeight: 'bold', boxShadow: '3px 3px 0 #000', transition: '0.1s' }}>
            🏠 RETURN TO HUB
          </button>
        </div>
      </header>

      {/* FINISHING FLOOR MAIN WORKSPACE */}
      <main style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ backgroundColor: 'white', border: '4px solid #000', flex: 1, boxShadow: '12px 12px 0px #6f42c1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: '40px', textAlign: 'center' }}>
          
          <div style={{ fontSize: '5rem', marginBottom: '20px' }}>🎨</div>
          <h2 style={{ fontSize: '2.5rem', margin: '0 0 15px 0', color: '#000', letterSpacing: '2px' }}>WORKSPACE PENDING</h2>
          <div style={{ height: '4px', width: '60px', background: '#6f42c1', marginBottom: '20px' }}></div>
          <p style={{ color: '#666', fontSize: '1.1rem', maxWidth: '600px', lineHeight: '1.6', fontWeight: 'bold' }}>
            The Finishing UI will be mounted inside this container. This module will track active paint recipes and push custom operator formulas back to the PLM master dictionary.
          </p>

        </div>
      </main>
    </div>
  );
};

export default FinishingFloor;