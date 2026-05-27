import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Import our core applications
import LandingPage from './LandingPage';
import HQ from './components/HQ/HQ';
import ShopFloor from './components/ShopFloor/ShopFloor';
import FinishingFloor from './components/FinishingFloor/FinishingFloor';
import PickPackApp from './components/PickPack/PickPackApp'; // 🚀 NEW: Import Pick & Pack App

const App = () => {
  return (
    <Router>
      <Routes>
        {/* The Master Hub */}
        <Route path="/" element={<LandingPage />} />
        
        {/* The PLM & Admin Dashboard */}
        <Route path="/hq" element={<HQ />} />
        
        {/* The Factory Apps */}
        <Route path="/shop-floor" element={<ShopFloor />} />
        <Route path="/finishing-floor" element={<FinishingFloor />} />
        
        {/* 🚀 NEW: The Warehouse Routing */}
        <Route path="/pick-pack" element={<PickPackApp />} />
      </Routes>
    </Router>
  );
};

export default App;