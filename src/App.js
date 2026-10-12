import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Import our core applications
import LandingPage from './LandingPage';
import HQ from './components/HQ/HQ';
import ShopFloor from './components/ShopFloor/ShopFloor';
import FinishingFloor from './components/FinishingFloor/FinishingFloor';
import StitchSew from './components/StitchSew/StitchSew';   // 🪡 the Uniquity sewing floor (S7, 2026-10-11)
import PickPackApp from './components/PickPack/PickPackApp'; // 🚀 NEW: Import Pick & Pack App
import OuterGate from './components/Shared/OuterGate';
import UpdateBanner from './components/Shared/UpdateBanner';

// 🛋 the Uniquity show counter (S7, 2026-10-12) — lazy, so tab 7 (which it wears) stays out of every floor app's main bundle
const UniquityCounter = lazy(() => import('./components/Counter/UniquityCounter'));

const App = () => {
  return (
    <Router>
      {/* One-tap reload when a newer deploy is live — shows on every surface, incl. login. */}
      <UpdateBanner />
      {/* Daily email sign-in fronts every route; PINs switch users behind it. */}
      <OuterGate>
      <Routes>
        {/* The Master Hub */}
        <Route path="/" element={<LandingPage />} />
        
        {/* The PLM & Admin Dashboard */}
        <Route path="/hq" element={<HQ />} />
        
        {/* The Factory Apps */}
        <Route path="/shop-floor" element={<ShopFloor />} />
        <Route path="/finishing-floor" element={<FinishingFloor />} />
        <Route path="/stitch-sew" element={<StitchSew />} />
        <Route path="/uniquity-counter" element={<Suspense fallback={<div style={{ padding: '40px', fontFamily: 'var(--mono, monospace)', fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', color: '#777' }}>Loading the counter…</div>}><UniquityCounter /></Suspense>} />
        
        {/* 🚀 NEW: The Warehouse Routing */}
        <Route path="/pick-pack" element={<PickPackApp />} />
      </Routes>
      </OuterGate>
    </Router>
  );
};

export default App;