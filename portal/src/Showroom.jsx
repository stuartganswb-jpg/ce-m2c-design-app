// Read-only 3D showroom for portal customers. Loads the customer's priced products (portalCatalog
// BFF) and renders a spin-able GLB with a finish switcher. Mirrors the internal viewer's three.js
// setup (DRACO GLTF, warehouse environment) but applies one finish across the whole piece — a slim
// explore-and-preview experience, not the full CPQ node-by-node configurator.
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows, Bounds, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const DRACO_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/';

const fmtMoney = (v) => (v === null || v === undefined) ? '' :
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// One GLB, one optional finish texture applied to every mesh. Restores the as-designed materials
// when no finish is selected.
function Model({ url, finishUrl }) {
  const { scene } = useGLTF(url, DRACO_URL);
  const cloned = useMemo(() => scene.clone(true), [scene]);

  useEffect(() => {
    let tex = null;
    if (finishUrl) {
      tex = new THREE.TextureLoader().setCrossOrigin('anonymous').load(finishUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.flipY = false;
    }
    cloned.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (!o.userData._origMat) o.userData._origMat = o.material;
      if (tex) {
        const m = o.userData._origMat.clone();
        m.map = tex;
        m.color = new THREE.Color(0xffffff);
        m.envMapIntensity = 1.0;
        m.needsUpdate = true;
        o.material = m;
      } else {
        o.material = o.userData._origMat;
      }
    });
    return () => { if (tex) tex.dispose(); };
  }, [cloned, finishUrl]);

  return <primitive object={cloned} />;
}

function Viewer({ item, finishUrl }) {
  return (
    <div className="viewer">
      <Canvas camera={{ position: [5, 5, 5], fov: 50 }} dpr={[1, 2]}>
        <ambientLight intensity={0.9} />
        <directionalLight position={[5, 10, 5]} intensity={0.7} />
        <Suspense fallback={null}>
          <Environment preset="warehouse" />
          <ContactShadows position={[0, -0.5, 0]} opacity={0.5} scale={10} blur={2} far={4} />
          <Bounds fit clip margin={1.2}>
            <Model url={item.cadUrl} finishUrl={finishUrl} />
          </Bounds>
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
      <span className="viewer-hint">Drag to rotate · scroll to zoom</span>
    </div>
  );
}

export default function Showroom() {
  const [data, setData] = useState(null);   // { items, finishes }
  const [err, setErr] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [finishId, setFinishId] = useState(''); // '' = as designed

  useEffect(() => {
    let alive = true;
    httpsCallable(functions, 'portalCatalog')()
      .then((res) => { if (!alive) return; setData(res.data); setActiveId(res.data.items?.[0]?.id || null); })
      .catch(() => { if (alive) setErr('Could not load your product showroom right now — please try again shortly.'); });
    return () => { alive = false; };
  }, []);

  if (err) return <div className="empty" style={{ marginTop: 24 }}>{err}</div>;
  if (!data) return <div className="empty" style={{ marginTop: 24 }}>Loading your showroom…</div>;

  const { items = [], finishes = [] } = data;
  if (items.length === 0) {
    return <div className="empty" style={{ marginTop: 24 }}>Your showroom hasn't been set up yet — contact your Classical Elements representative to have your product lines enabled.</div>;
  }

  const active = items.find((i) => i.id === activeId) || items[0];
  const finishUrl = finishes.find((f) => f.id === finishId)?.textureUrl || null;

  return (
    <div className="showroom">
      <aside className="product-rail">
        {items.map((it) => (
          <button
            key={it.id}
            className={`product-btn${it.id === active.id ? ' active' : ''}`}
            onClick={() => setActiveId(it.id)}
          >
            <span className="p-name">{it.name}</span>
            {it.sku ? <span className="p-sku">{it.sku}</span> : null}
            {it.price !== null ? <span className="p-price">{fmtMoney(it.price)}</span> : null}
          </button>
        ))}
      </aside>

      <div className="stage">
        <Viewer key={active.id} item={active} finishUrl={finishUrl} />

        <div className="finish-bar">
          <span className="finish-label">Finish</span>
          <div className="swatches">
            <button className={`swatch as-designed${finishId === '' ? ' active' : ''}`} onClick={() => setFinishId('')} title="As designed">
              <span>As shown</span>
            </button>
            {finishes.map((f) => (
              <button
                key={f.id}
                className={`swatch${finishId === f.id ? ' active' : ''}`}
                onClick={() => setFinishId(f.id)}
                title={f.name}
                style={{ backgroundImage: `url(${f.textureUrl})` }}
              >
                <span className="swatch-name">{f.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
