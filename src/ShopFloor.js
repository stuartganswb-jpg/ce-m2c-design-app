import React from 'react';
import { useNavigate } from 'react-router-dom';

const ShopFloor = () => {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#e5e5e5', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      
      {/* SHOP FLOOR HEADER */}
      <header style={{ backgroundColor: '#d9534f', color: '#fff', padding: '15px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '4px solid #000' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', letterSpacing: '2px' }}>SHOP FLOOR: FABRICATION</h1>
          <span style={{ fontSize: '0.7rem', opacity: 0.9, fontWeight: 'bold' }}>CNC ROUTING, LATHE, & METALWORK</span>
        </div>
        <div>
          <button onClick={() => navigate('/')} style={{ padding: '8px 15px', fontSize: '0.8rem', cursor: 'pointer', background: '#fff', color: '#d9534f', border: '2px solid #000', fontWeight: 'bold', boxShadow: '3px 3px 0 #000', transition: '0.1s' }}>
            🏠 RETURN TO HUB
          </button>
        </div>
      </header>

      {/* SHOP FLOOR MAIN WORKSPACE */}
      <main style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ backgroundColor: 'white', border: '4px solid #000', flex: 1, boxShadow: '12px 12px 0px #d9534f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: '40px', textAlign: 'center' }}>
          
          <div style={{ fontSize: '5rem', marginBottom: '20px' }}>🏭</div>
          <h2 style={{ fontSize: '2.5rem', margin: '0 0 15px 0', color: '#000', letterSpacing: '2px' }}>WORKSPACE PENDING</h2>
          <div style={{ height: '4px', width: '60px', background: '#d9534f', marginBottom: '20px' }}></div>
          <p style={{ color: '#666', fontSize: '1.1rem', maxWidth: '600px', lineHeight: '1.6', fontWeight: 'bold' }}>
            The Fabrication UI will be mounted inside this container. This module will automatically ingest routed jobs from the HQ Dispatch Queue.
          </p>

        </div>
      </main>
    </div>
  );
};

export default ShopFloor;