// THE PICTURE — drawn by HQ's OWN drawing code (step 4 of the portal rebuild, 2026-10-14). Shared/DynamicModel.js is the
// component HQ's CPQ draws every configured rod with; Shared/studioRig.js is the light it is lit by; Shared/finishPbr.js says
// how each finish catches it. This page hands them exactly what CPQ's screen hands them (HardwareConfigurator: the same
// canvas, camera, bounds and props), from the server's view — so the picture a customer builds is the picture HQ quotes.
import React from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Bounds } from '@react-three/drei';
import { DynamicModel } from '@engine/DynamicModel.js';
import { StudioRig } from '@engine/studioRig.js';
import { primeFinishPbr } from '@engine/finishPbr.js';
import { currentViewPictureOf } from '@engine/viewCapture.js';

// THE PICTURE AT ADD (step 5, Stuart 2026-10-20): hands the walk a function that takes the view as the customer left it — CPQ's
// own picture at Add (Shared/viewCapture) — so the line carries it to HQ, where a reopened request shows what they built.
function StageCapturer({ onReady }) {
  const { gl, scene, camera } = useThree();
  React.useEffect(() => {
    if (!onReady) return undefined;
    onReady(() => currentViewPictureOf(gl, scene, camera));
    return () => onReady(null);
  }, [gl, scene, camera, onReady]);
  return null;
}

// A model that cannot be drawn (no WebGL, a file that will not load) must never take the configurator down with it.
class StageBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e) { console.warn('3D view failed', e); }
  render() {
    if (this.state.failed) {
      return (
        <div className="cf-stage-msg">
          The 3D view could not be shown on this device. Your choices and the price below are unaffected.
          <button className="btn-ghost" onClick={() => this.setState({ failed: false })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function ConfigStage({ cadUrl, render, onCapture }) {
  // CPQ hands the drawing two maps; the server's view carries them as lists (the frozen render's shape) — turned back here.
  const textureOverrides = React.useMemo(() => Object.fromEntries(((render && render.textures) || []).filter((e) => e && e.target != null).map((e) => [e.target, e.url])), [render]);
  const visibilityOverrides = React.useMemo(() => Object.fromEntries(((render && render.visible) || []).map((t) => [t, true])), [render]);
  // How each finish on screen catches the light — the numbers HQ's registry holds — primed before the drawing paints.
  if (render && render.pbr) primeFinishPbr(render.pbr);
  if (!cadUrl) return <div className="cf-stage-msg">No 3D model for this product yet.</div>;
  return (
    <StageBoundary>
      <Canvas camera={{ position: [5, 5, 5], fov: 50 }} dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} style={{ width: '100%', height: '100%' }}>
        <StudioRig />
        <StageCapturer onReady={onCapture} />
        <OrbitControls makeDefault />
        <Bounds fit clip margin={1.2}>
          <group scale={(render && render.scale) || 1}>
            <DynamicModel url={cadUrl} textureOverrides={textureOverrides} visibilityOverrides={visibilityOverrides}
              cloneSpecs={(render && render.cloneSpecs) || []} stretchSpec={(render && render.stretchSpec) || null} spliceMarks={(render && render.spliceMarks) || []}
              highlightOverrides={[]} defaultHidden clearNodes={(render && render.clear) || []} />
          </group>
        </Bounds>
      </Canvas>
    </StageBoundary>
  );
}
