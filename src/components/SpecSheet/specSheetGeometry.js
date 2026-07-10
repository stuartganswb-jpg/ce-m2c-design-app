// specSheetGeometry.js — mesh extraction, measuring, and row composition for spec sheets.
// Works on the assembly's merged working GLB (manufacturingSpecs.cadUrl). All positions are
// baked to WORLD space so measurements are true regardless of node nesting/scale.

export const M2IN = 39.3700787;

// Match the CPQ 3D matcher: sanitized alphanumeric key so raw glb names match the
// names stored on clusters/pins (same rule as Shared/componentExport.js).
export const sanitize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Pull every mesh under the named nodes (matched directly or by descent) out of a THREE
// scene as plain data with world transforms baked in. Returns [{ name, path, positions, indices }].
export function extractWorldMeshes(scene, nodeNames) {
  const want = new Set((nodeNames || []).map(sanitize));
  scene.updateMatrixWorld(true);
  const matched = new Set();
  scene.traverse((o) => { if (want.has(sanitize(o.name))) matched.add(o); });
  const underMatched = (o) => { for (let p = o; p; p = p.parent) if (matched.has(p)) return true; return false; };
  const out = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    if (!(matched.has(o) || underMatched(o))) return;
    const src = o.geometry.attributes.position.array;
    const positions = new Float32Array(src.length);
    const e = o.matrixWorld.elements;
    for (let i = 0; i < src.length; i += 3) {
      const x = src[i], y = src[i + 1], z = src[i + 2];
      positions[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
      positions[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      positions[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    const idxAttr = o.geometry.index;
    const indices = idxAttr ? Uint32Array.from(idxAttr.array) : null;
    const path = [];
    for (let p = o; p && p !== scene; p = p.parent) path.unshift(p.name || '');
    out.push({ name: o.name || '', path: path.join('/'), positions, indices });
  });
  return out;
}

export function groupBbox(meshes) {
  const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const m of meshes) {
    const P = m.positions;
    for (let i = 0; i < P.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        const v = P[i + a];
        if (v < b.min[a]) b.min[a] = v;
        if (v > b.max[a]) b.max[a] = v;
      }
    }
  }
  b.size = b.max.map((v, a) => v - b.min[a]);
  b.center = b.max.map((v, a) => (v + b.min[a]) / 2);
  return b;
}

export function translateMeshes(meshes, d) {
  return meshes.map((m) => {
    const P = new Float32Array(m.positions);
    for (let i = 0; i < P.length; i += 3) { P[i] += d[0]; P[i + 1] += d[1]; P[i + 2] += d[2]; }
    return { ...m, positions: P };
  });
}

// Infer the assembly's axes from the pole geometry: pole axis = longest pole bbox axis,
// vertical = Y (app convention), projection axis = the remaining one. Wall side = the
// side of the pole the backplate sits on along the projection axis.
export function inferAxes(poleMeshes, plateMeshes) {
  const pb = groupBbox(poleMeshes);
  let poleAxis = 0;
  if (pb.size[1] > pb.size[poleAxis]) poleAxis = 1;
  if (pb.size[2] > pb.size[poleAxis]) poleAxis = 2;
  const vertAxis = poleAxis === 1 ? 2 : 1; // never the pole axis; prefer Y
  const projAxis = [0, 1, 2].find((a) => a !== poleAxis && a !== vertAxis);
  const plb = groupBbox(plateMeshes);
  const wallSign = Math.sign(plb.center[projAxis] - pb.center[projAxis]) || -1;
  // wall plane = the plate face farthest from the pole along the projection axis
  const wallCoord = wallSign > 0 ? plb.max[projAxis] : plb.min[projAxis];
  return { poleAxis, vertAxis, projAxis, wallSign, wallCoord, poleCenter: pb.center, poleBox: pb };
}

const AXIS_VEC = (a, s = 1) => [a === 0 ? s : 0, a === 1 ? s : 0, a === 2 ? s : 0];

// Orthographic view bases from inferred axes (right×up must equal -viewDir).
export function makeViews(axes) {
  const { poleAxis, vertAxis, projAxis, wallSign } = axes;
  const up = AXIS_VEC(vertAxis);
  // FRONT: camera looks toward the wall; right = pole axis.
  const front = { right: AXIS_VEC(poleAxis), up, viewDir: AXIS_VEC(projAxis, wallSign) };
  // cross(right, up) must be -viewDir; flip right if not.
  const fix = (v) => {
    const c = [
      v.right[1] * v.up[2] - v.right[2] * v.up[1],
      v.right[2] * v.up[0] - v.right[0] * v.up[2],
      v.right[0] * v.up[1] - v.right[1] * v.up[0],
    ];
    const dot = c[0] * v.viewDir[0] + c[1] * v.viewDir[1] + c[2] * v.viewDir[2];
    if (dot > 0) v.right = v.right.map((x) => -x);
    return v;
  };
  // PROFILE: camera looks down the pole axis; wall lands on the left (right vector
  // points AWAY from the wall along the projection axis).
  const profile = { right: AXIS_VEC(projAxis, -wallSign), up, viewDir: AXIS_VEC(poleAxis) };
  return { front: fix(front), profile: fix(profile) };
}

// Vertical center of the bracket's wall-end cross-section (the "arm root"). The GLBs model
// plates centered on the pole centerline; reality centers plates on the arm root — the
// composer shifts the plate group to match (locked per Stuart's example sheets).
export function armRootCenter(bracketMeshes, axes, sliceM = 0.012) {
  const bb = groupBbox(bracketMeshes);
  const { projAxis, vertAxis, wallSign } = axes;
  const wallEdge = wallSign > 0 ? bb.max[projAxis] : bb.min[projAxis];
  let minV = Infinity, maxV = -Infinity;
  for (const m of bracketMeshes) {
    const P = m.positions;
    for (let i = 0; i < P.length; i += 3) {
      const p = [P[i], P[i + 1], P[i + 2]];
      if (Math.abs(p[projAxis] - wallEdge) < sliceM) {
        const v = p[vertAxis];
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
  }
  if (!isFinite(minV)) return null;
  return (minV + maxV) / 2;
}

// --- fractional-inch formatting ---
export function frac(inches) {
  const sixteenths = Math.round(Math.abs(inches) * 16);
  let whole = Math.floor(sixteenths / 16);
  let num = sixteenths - whole * 16, den = 16;
  while (num % 2 === 0 && num > 0) { num /= 2; den /= 2; }
  return { whole, num, den };
}
export function fracText(inches) {
  const f = frac(inches);
  if (!f.num) return String(f.whole);
  return f.whole ? `${f.whole} ${f.num}/${f.den}` : `${f.num}/${f.den}`;
}
// Parse "2 3/4", "3/8", "2.75" → inches (null when unparseable).
export function parseInches(text) {
  const t = String(text || '').trim().replace(/["”]/g, '');
  if (!t) return null;
  const m = t.match(/^(\d+)?\s*(?:(\d+)\s*\/\s*(\d+))?$/);
  if (m && (m[1] || m[2])) {
    const whole = m[1] ? parseInt(m[1], 10) : 0;
    const num = m[2] ? parseInt(m[2], 10) : 0;
    const den = m[3] ? parseInt(m[3], 10) : 1;
    return whole + (den ? num / den : 0);
  }
  const dec = parseFloat(t);
  return isNaN(dec) ? null : dec;
}

// Clip 2D view segments to a u-window — the front view's rod break: at 1:1 print scale a
// full-length rod can't fit, so the drawing truncates it like a hand-made CAD sheet.
export function clipSegmentsU(vis, lo, hi) {
  const out = [];
  for (const [u0, v0, u1, v1] of vis) {
    let a = u0, av = v0, b = u1, bv = v1;
    if (a > b) { const t = a; a = b; b = t; const tv = av; av = bv; bv = tv; }
    if (b < lo || a > hi) continue;
    let nu0 = a, nv0 = av, nu1 = b, nv1 = bv;
    const span = (b - a) || 1e-12;
    if (a < lo) { const t = (lo - a) / span; nu0 = lo; nv0 = av + (bv - av) * t; }
    if (b > hi) { const t = (hi - a) / span; nu1 = hi; nv1 = av + (bv - av) * t; }
    out.push([nu0, nv0, nu1, nv1]);
  }
  return out;
}

// CAD-style rod break marks: two short parallel diagonals across the rod at a cut edge.
export function breakMarks(u, vLo, vHi) {
  const slant = 0.004, gap = 0.0018, over = 0.003;
  return [
    [u - slant / 2, vLo - over, u + slant / 2, vHi + over],
    [u - slant / 2 + gap, vLo - over, u + slant / 2 + gap, vHi + over],
  ];
}

// Stacked-fraction SVG text (matches the CAD drawing style). Returns markup string.
export function fracSvg(x, y, inches, fontSize = 11, dia = false) {
  const f = frac(inches);
  let out = '', dx = x;
  if (dia) { out += `<text x="${dx}" y="${y}" font-size="${fontSize}">⌀</text>`; dx += fontSize * 0.75; }
  if (f.whole || !f.num) { out += `<text x="${dx}" y="${y}" font-size="${fontSize}">${f.whole}</text>`; dx += fontSize * 0.6 * String(f.whole).length; }
  if (f.num) {
    const fs2 = fontSize * 0.6;
    out += `<text x="${dx + fs2 * 0.55}" y="${y - fontSize * 0.34}" font-size="${fs2}" text-anchor="middle">${f.num}</text>`;
    out += `<text x="${dx + fs2 * 0.55}" y="${y + fontSize * 0.36}" font-size="${fs2}" text-anchor="middle">${f.den}</text>`;
    out += `<line x1="${dx}" y1="${y - fontSize * 0.1}" x2="${dx + fs2 * 1.1}" y2="${y - fontSize * 0.1}" stroke="black" stroke-width="0.6"/>`;
    dx += fs2 * 1.25;
  }
  return out;
}
// Same, from a user-entered string value (manual dims print verbatim).
export function fracSvgFromText(x, y, text, fontSize = 11) {
  const inches = parseInches(text);
  if (inches == null) return `<text x="${x}" y="${y}" font-size="${fontSize}">${String(text)}</text>`;
  return fracSvg(x, y, inches, fontSize);
}
