// hiddenLine.js — headless hidden-line renderer for spec-sheet drawings.
// Takes plain mesh data ({ positions: Float32Array world-space, indices }) and an
// orthographic view basis, returns the VISIBLE edge segments as 2D coordinates —
// no WebGL/Canvas involved, so output stays vector (SVG paths / PDF lines) at any
// print size. Pipeline: weld → feature edges + view-dependent silhouettes →
// software z-buffer → per-sample occlusion clip.

const EPS_WELD = 1e-6;

const weldKey = (x, y, z) =>
  `${Math.round(x / EPS_WELD)},${Math.round(y / EPS_WELD)},${Math.round(z / EPS_WELD)}`;

// Build edge adjacency + face normals per mesh. featureAngleDeg: dihedral angle above
// which an edge is always drawn (CAD look ~18°).
export function buildEdges(meshes, featureAngleDeg = 18) {
  const cosThresh = Math.cos((featureAngleDeg * Math.PI) / 180);
  const items = [];
  for (const mesh of meshes) {
    const P = mesh.positions;
    const idx = mesh.indices || Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
    const remap = new Map();
    const vid = new Uint32Array(P.length / 3);
    for (let i = 0; i < P.length / 3; i++) {
      const k = weldKey(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      if (!remap.has(k)) remap.set(k, i);
      vid[i] = remap.get(k);
    }
    const nf = idx.length / 3;
    const fnorm = new Float64Array(nf * 3);
    for (let f = 0; f < nf; f++) {
      const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      fnorm[f * 3] = nx / l; fnorm[f * 3 + 1] = ny / l; fnorm[f * 3 + 2] = nz / l;
    }
    const emap = new Map();
    for (let f = 0; f < nf; f++) {
      for (let e = 0; e < 3; e++) {
        const i0 = idx[f * 3 + e], i1 = idx[f * 3 + ((e + 1) % 3)];
        const a = vid[i0], b = vid[i1];
        if (a === b) continue;
        const k = a < b ? `${a}_${b}` : `${b}_${a}`;
        let rec = emap.get(k);
        if (!rec) { rec = { a: i0, b: i1, faces: [] }; emap.set(k, rec); }
        rec.faces.push(f);
      }
    }
    items.push({ mesh, emap, fnorm });
  }
  return { items, cosThresh };
}

// Edges worth drawing for a given view direction: boundaries, feature edges, and
// silhouettes (front-facing/back-facing flip). Returns world-space segments.
export function collectViewEdges(built, viewDir) {
  const segs = [];
  const [dx, dy, dz] = viewDir;
  for (const { mesh, emap, fnorm } of built.items) {
    const P = mesh.positions;
    for (const rec of emap.values()) {
      let keep = false;
      if (rec.faces.length === 1) keep = true;
      else {
        const f0 = rec.faces[0], f1 = rec.faces[1];
        const dot01 = fnorm[f0 * 3] * fnorm[f1 * 3] + fnorm[f0 * 3 + 1] * fnorm[f1 * 3 + 1] + fnorm[f0 * 3 + 2] * fnorm[f1 * 3 + 2];
        if (dot01 < built.cosThresh) keep = true;
        else {
          const d0 = fnorm[f0 * 3] * dx + fnorm[f0 * 3 + 1] * dy + fnorm[f0 * 3 + 2] * dz;
          const d1 = fnorm[f1 * 3] * dx + fnorm[f1 * 3 + 1] * dy + fnorm[f1 * 3 + 2] * dz;
          if ((d0 < 0) !== (d1 < 0)) keep = true;
        }
      }
      if (keep) {
        const a = rec.a * 3, b = rec.b * 3;
        segs.push([P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2]]);
      }
    }
  }
  return segs;
}

// Software orthographic depth raster over all meshes. view = { right, up, viewDir }
// (unit vectors, right×up = -viewDir). res = pixel width of the buffer.
export function rasterDepth(meshes, view, res = 1400) {
  const { right, up, viewDir } = view;
  const proj = (x, y, z) => [
    x * right[0] + y * right[1] + z * right[2],
    x * up[0] + y * up[1] + z * up[2],
    x * viewDir[0] + y * viewDir[1] + z * viewDir[2],
  ];
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, minW = Infinity, maxW = -Infinity;
  for (const m of meshes) {
    const P = m.positions;
    for (let i = 0; i < P.length; i += 3) {
      const u = P[i] * right[0] + P[i + 1] * right[1] + P[i + 2] * right[2];
      const v = P[i] * up[0] + P[i + 1] * up[1] + P[i + 2] * up[2];
      const w = P[i] * viewDir[0] + P[i + 1] * viewDir[1] + P[i + 2] * viewDir[2];
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
      if (w < minW) minW = w; if (w > maxW) maxW = w;
    }
  }
  const pad = 0.02 * Math.max(maxU - minU, maxV - minV, 1e-6);
  minU -= pad; maxU += pad; minV -= pad; maxV += pad;
  const W = res;
  const H = Math.max(2, Math.round((res * (maxV - minV)) / (maxU - minU)));
  const scale = W / (maxU - minU);
  const depth = new Float32Array(W * H).fill(Infinity);
  const toPx = (u, v) => [(u - minU) * scale, H - (v - minV) * scale];
  for (const m of meshes) {
    const P = m.positions;
    const idx = m.indices || Uint32Array.from({ length: P.length / 3 }, (_, i) => i);
    for (let f = 0; f < idx.length; f += 3) {
      const vs = [idx[f] * 3, idx[f + 1] * 3, idx[f + 2] * 3].map((o) => proj(P[o], P[o + 1], P[o + 2]));
      const px = vs.map(([u, v]) => toPx(u, v));
      const minX = Math.max(0, Math.floor(Math.min(px[0][0], px[1][0], px[2][0])));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(px[0][0], px[1][0], px[2][0])));
      const minY = Math.max(0, Math.floor(Math.min(px[0][1], px[1][1], px[2][1])));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(px[0][1], px[1][1], px[2][1])));
      if (maxX < minX || maxY < minY) continue;
      const [x0, y0] = px[0], [x1, y1] = px[1], [x2, y2] = px[2];
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(den) < 1e-12) continue;
      for (let py = minY; py <= maxY; py++) {
        for (let pxx = minX; pxx <= maxX; pxx++) {
          const cx = pxx + 0.5, cy = py + 0.5;
          const l0 = ((y1 - y2) * (cx - x2) + (x2 - x1) * (cy - y2)) / den;
          const l1 = ((y2 - y0) * (cx - x2) + (x0 - x2) * (cy - y2)) / den;
          const l2 = 1 - l0 - l1;
          if (l0 < -0.001 || l1 < -0.001 || l2 < -0.001) continue;
          const w = l0 * vs[0][2] + l1 * vs[1][2] + l2 * vs[2][2];
          const o = py * W + pxx;
          if (w < depth[o]) depth[o] = w;
        }
      }
    }
  }
  return { depth, W, H, minU, minV, maxU, maxV, scale, toPx, proj, minW, maxW };
}

// Clip world segments against the depth buffer → visible 2D sub-segments [u0,v0,u1,v1].
// Hidden only when EVERY pixel of the 3×3 neighborhood is strictly nearer than the
// sample (max-reference rule — robust for curved-surface silhouettes at grazing angles).
export function visibleSegments(segs, zb, opts = {}) {
  const stepPx = opts.stepPx || 0.75;
  const bias = opts.bias || (zb.maxW - zb.minW) * 2e-3 + 1e-6;
  const out = [];
  for (const s of segs) {
    const a = zb.proj(s[0], s[1], s[2]);
    const b = zb.proj(s[3], s[4], s[5]);
    const pxA = zb.toPx(a[0], a[1]);
    const pxB = zb.toPx(b[0], b[1]);
    const lenPx = Math.hypot(pxB[0] - pxA[0], pxB[1] - pxA[1]);
    const n = Math.max(2, Math.ceil(lenPx / stepPx) + 1);
    let runStart = null, prev = null;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const u = a[0] + (b[0] - a[0]) * t;
      const v = a[1] + (b[1] - a[1]) * t;
      const w = a[2] + (b[2] - a[2]) * t;
      const [px, py] = zb.toPx(u, v);
      const xi = Math.min(zb.W - 1, Math.max(0, Math.round(px - 0.5)));
      const yi = Math.min(zb.H - 1, Math.max(0, Math.round(py - 0.5)));
      let zref = -Infinity;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const xx = xi + ox, yy = yi + oy;
          if (xx < 0 || yy < 0 || xx >= zb.W || yy >= zb.H) continue;
          const d = zb.depth[yy * zb.W + xx];
          if (d > zref) zref = d;
        }
      }
      const vis = zref === Infinity || zref === -Infinity || w <= zref + bias;
      if (vis && runStart === null) runStart = [u, v];
      if (!vis && runStart !== null) { out.push([runStart[0], runStart[1], prev[0], prev[1]]); runStart = null; }
      prev = [u, v];
    }
    if (runStart !== null) out.push([runStart[0], runStart[1], prev[0], prev[1]]);
  }
  return out;
}

// One-call convenience: meshes + view → { vis (2D segments), zb (bounds/mapping) }.
export function renderHiddenLine(meshes, view, res = 1400, featureAngleDeg = 18) {
  const built = buildEdges(meshes, featureAngleDeg);
  const segs = collectViewEdges(built, view.viewDir);
  const zb = rasterDepth(meshes, view, res);
  const vis = visibleSegments(segs, zb);
  return { vis, zb };
}
