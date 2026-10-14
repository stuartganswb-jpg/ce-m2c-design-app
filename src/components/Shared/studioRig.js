import React from 'react';
import { Environment, ContactShadows, Lightformer } from '@react-three/drei';

// THE STUDIO LIGHT every product canvas is lit with — moved out of Shared/studioScene.js word for word
// (2026-10-14, the portal rebuild, step 4). studioScene.js reads HQ's Firestore, so a screen without it
// (the customer portal) could not light its picture the way HQ lights its own; the dials and the rig are
// unchanged, and studioScene.js still exports StudioRig for every HQ screen that imports it from there.

// --- Lighting dials ---------------------------------------------------------
const ENV_INTENSITY = 1.15;   // brief: 1.0–1.5. Overall reflection strength.
const KEY_INTENSITY = 4.0;    // main softbox (upper front, ~35°)
const RIM_INTENSITY = 1.3;    // opposite rim ≈ 30% of key
const TOP_INTENSITY = 2.0;    // long thin overhead strip (product-table light)
const AMBIENT_FLOOR = 0.15;   // tiny — stops undersides clipping to black; env does the work

// --- The rig -----------------------------------------------------------------
// Drop-in replacement for the old <ambientLight 0.9/> + <directionalLight/> +
// <Environment preset="warehouse"/> + <ContactShadows/> stack. Reflections are
// environment-map based, so it works at any model scale (inches or meters).
export const StudioRig = ({ shadowY = -0.5 }) => (
    <>
        <Environment resolution={512} environmentIntensity={ENV_INTENSITY}>
            {/* key softbox — upper front-left ~35°; the primary streak on the part */}
            <Lightformer form="rect" intensity={KEY_INTENSITY} position={[-3.2, 3.4, 4.2]} target={[0, 0, 0]} scale={[5.5, 3.2, 1]} />
            {/* rim — opposite side, ~30% of key, separates the part from the bg */}
            <Lightformer form="rect" intensity={RIM_INTENSITY} position={[4.2, 2.2, -3.6]} target={[0, 0, 0]} scale={[4.5, 2.6, 1]} />
            {/* overhead strip — the long thin highlight band on horizontal poles */}
            <Lightformer form="rect" intensity={TOP_INTENSITY} position={[0, 5.2, 0]} target={[0, 0, 0]} scale={[7, 1.6, 1]} />
            {/* warm floor bounce + cool back wall: fills the dark side so metal
                never reads as a black hole, and gives reflections two tones */}
            <Lightformer form="rect" intensity={0.7} color="#f4efe6" position={[0, -4.5, 0]} target={[0, 0, 0]} scale={[8, 8, 1]} />
            <Lightformer form="rect" intensity={0.55} color="#eef0f4" position={[0, 1.2, -6]} target={[0, 0, 0]} scale={[10, 5, 1]} />
        </Environment>
        <ambientLight intensity={AMBIENT_FLOOR} />
        <ContactShadows position={[0, shadowY, 0]} opacity={0.42} scale={10} blur={2.4} far={4} />
    </>
);

export default StudioRig;
