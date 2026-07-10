// SpecSheetModal.js — Fabricut-style specification sheet generator. Renders the assembly's
// working GLB (manufacturingSpecs.cadUrl) as CAD-style hidden-line drawings: one page per
// bracket choice, one row per backplate choice, columns = wall-mount detail | front view |
// code | profile view. Dimensions auto-measure from geometry; what geometry can't give
// (hole spacing, ring height from top hole) is drawn with the manual dimension tool and
// saved to the assembly doc (specSheetOverrides). Wall-mount styles carry bulk-entered
// dims in system/spec_sheet_config. Editions: H1 (internal) or Fabricut customer codes.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import { loadGLBScene } from '../Shared/componentExport';
import { normalizeCategory, normalizePosition } from '../Shared/assemblyTags';
import {
  M2IN, extractWorldMeshes, groupBbox, translateMeshes, inferAxes, makeViews,
  armRootCenter, parseInches,
} from './specSheetGeometry';
import { renderHiddenLine } from './hiddenLine';
import { buildPageSvg, PAGE_W, PAGE_H } from './specSheetPage';
import { openSpecSheetPrint, downloadSpecSheetPdf } from './specSheetOutput';

// Wall-mount plate meshes are children of each backplate choice node in the merged GLB
// (Fabricut H1 convention: item codes like H1-CPWP2/P). Extend here if a collection names
// its wall plates differently.
const WALL_PLATE_MATCH = /(CPWP|BPWP)/i;
const SCREW_MATCH = /screw/i;

// Plate FAMILY = part code minus the shape suffix (H1-75RCP-S → H1-75RCP). A page is one
// bracket × one family with the shapes as rows — matching the hand-made sheets. Return-arm
// brackets pair with return plates when pins carry the flags; otherwise every family gets
// its own page (tag pins in 1.6/⚖ to prune).
const familyOf = (name) => String(name || '').replace(/-(H|R|S|V)$/i, '');
const MAX_ROWS_PER_PAGE = 5;
const AS_MOUNTED_NOTE = 'As-mounted dim marks the height from the center of the top hole of the wall mount to the bottom of the ring.';

const btn = { padding: '6px 12px', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid #444', background: '#fff', borderRadius: '4px' };
const btnOn = { ...btn, background: '#1c2025', color: '#fff' };

// Project a world point into a view basis → [u, v].
const projPoint = (view, p) => [
  p[0] * view.right[0] + p[1] * view.right[1] + p[2] * view.right[2],
  p[0] * view.up[0] + p[1] * view.up[1] + p[2] * view.up[2],
];
// View-space bbox of a mesh group.
const viewBbox = (meshes, view) => {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const m of meshes) {
    const P = m.positions;
    for (let i = 0; i < P.length; i += 3) {
      const u = P[i] * view.right[0] + P[i + 1] * view.right[1] + P[i + 2] * view.right[2];
      const v = P[i] * view.up[0] + P[i + 1] * view.up[1] + P[i + 2] * view.up[2];
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
  }
  return { minU, maxU, minV, maxV };
};

const SpecSheetModal = ({ assembly, pins, libraryParts, onClose }) => {
  const [status, setStatus] = useState('Loading 3D model…');
  const [error, setError] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [edition, setEdition] = useState('H1'); // 'H1' | 'FAB'
  const [manualDims, setManualDims] = useState(() => assembly?.specSheetOverrides?.manualDims || []);
  const [wallCfg, setWallCfg] = useState({});
  const [showWallCfg, setShowWallCfg] = useState(false);
  const [dimTool, setDimTool] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pages, setPages] = useState([]); // [{ key, title, bracketPin }]
  const [pageData, setPageData] = useState(null); // { svg, viewMaps }
  const sceneRef = useRef(null);
  const rowCacheRef = useRef({}); // pageKey -> built rows
  const pendingPtRef = useRef(null);
  const svgHostRef = useRef(null);

  const clusters = React.useMemo(() => (assembly?.nodeClusters || []).map(c => ({
    ...c, cat: normalizeCategory(c.category), pos: normalizePosition(c.position),
  })), [assembly]);

  const clusterById = React.useMemo(() => {
    const m = {}; clusters.forEach(c => { m[c.id] = c; }); return m;
  }, [clusters]);

  // Choice pins per category, LEFT side preferred (sheets draw one side).
  const choicesFor = useCallback((cat) => {
    const inCat = (pins || []).filter(p => {
      const cl = clusterById[p.clusterId];
      return cl && cl.cat === cat && !cl.hidden && p.choiceNode && !p.isHiddenPart;
    });
    const left = inCat.filter(p => (clusterById[p.clusterId].pos || 'LEFT') === 'LEFT');
    const pool = left.length ? left : inCat;
    // stable order: H, R, S, V suffixes first (matches the hand-made sheets), then name
    const rank = (p) => { const m = (p.partName || '').match(/-(H|R|S|V)$/i); return m ? 'HRSV'.indexOf(m[1].toUpperCase()) : 9; };
    return [...pool].sort((a, b) => rank(a) - rank(b) || String(a.partName).localeCompare(String(b.partName)));
  }, [pins, clusterById]);


  const nodesFor = useCallback((cat) => {
    const cls = clusters.filter(c => c.cat === cat && !c.hidden && (c.nodes || []).length && ['LEFT', 'SHARED', 'CENTER', ''].includes(c.pos || ''));
    const preferred = cls.filter(c => c.pos === 'LEFT');
    return (preferred.length ? preferred : cls).flatMap(c => c.nodes || []);
  }, [clusters]);

  // Fabricut customer code for a part (stamped by the CrossReference import).
  const fabCodeFor = useCallback((partName) => {
    const part = (libraryParts || []).find(p => p.legacyErpId === partName || p.itemId === partName || p.id === partName);
    const fab = part?.manufacturingSpecs?.fabricut;
    if (!fab) return null;
    if (fab.fabCodePainted) return fab.fabCodePainted;
    if (fab.fabCodePremium) return fab.fabCodePremium;
    const exact = Object.keys(fab).find(k => k.startsWith('exact_') && fab[k]?.fabCode);
    return exact ? fab[exact].fabCode : null;
  }, [libraryParts]);

  const rowCode = useCallback((partName) => {
    if (edition === 'FAB') return fabCodeFor(partName) || `${partName} (no Fabricut code)`;
    return partName;
  }, [edition, fabCodeFor]);

  // ---- load GLB + wall-plate config once ----
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const url = assembly?.manufacturingSpecs?.cadUrl;
        if (!url) throw new Error('This assembly has no working GLB (manufacturingSpecs.cadUrl).');
        const [scene, cfgSnap] = await Promise.all([
          loadGLBScene(url),
          getDoc(doc(db, 'system', 'spec_sheet_config')).catch(() => null),
        ]);
        if (dead) return;
        sceneRef.current = scene;
        if (cfgSnap?.exists()) setWallCfg(cfgSnap.data()?.wallPlates || {});
        const brackets = choicesFor('BRACKET');
        if (!brackets.length) throw new Error('No bracket choices found (need BRACKET-category cluster pins with choiceNode).');
        const plates = choicesFor('BACKPLATE');
        if (!plates.length) throw new Error('No backplate choices found (need BACKPLATE-category cluster pins with choiceNode).');
        const families = {};
        plates.forEach(p => { const f = familyOf(p.partName); (families[f] = families[f] || []).push(p); });
        const anyReturnFlags = plates.some(p => p.returnOnly) || brackets.some(b => b.usesReturnPlates || b.isReturnArm);
        const pageList = [];
        for (const b of brackets) {
          const bracketIsReturn = !!(b.usesReturnPlates || b.isReturnArm || /RETURN/i.test(b.endTreatment || ''));
          for (const [fam, famPins] of Object.entries(families)) {
            if (anyReturnFlags) {
              const famIsReturn = famPins.some(p => p.returnOnly);
              if (famIsReturn !== bracketIsReturn) continue;
            }
            // safety: never overload a page — chunk oversized families
            for (let i = 0; i < famPins.length; i += MAX_ROWS_PER_PAGE) {
              const chunk = famPins.slice(i, i + MAX_ROWS_PER_PAGE);
              const part = famPins.length > MAX_ROWS_PER_PAGE ? ` (${i / MAX_ROWS_PER_PAGE + 1})` : '';
              pageList.push({
                key: `${b.partName}__${fam}__${i}`,
                title: `${b.partName} + ${fam}${part}`,
                bracketPin: b,
                familyPins: chunk,
                family: fam,
              });
            }
          }
        }
        if (!pageList.length) throw new Error('No bracket × backplate-family pages could be derived.');
        setPages(pageList);
        setStatus('');
      } catch (e) {
        console.error('SpecSheet load failed', e);
        if (!dead) { setError(e?.message || String(e)); setStatus(''); }
      }
    })();
    return () => { dead = true; };
  }, [assembly, choicesFor]);

  // ---- build rows for a page (cached per bracket × family) ----
  const buildRows = useCallback((bracketPin, familyPins) => {
    const scene = sceneRef.current;
    const bracket = extractWorldMeshes(scene, [bracketPin.choiceNode]);
    if (!bracket.length) throw new Error(`Bracket node "${bracketPin.choiceNode}" not found in GLB.`);
    const poleNodes = nodesFor('POLE');
    const ringNodes = nodesFor('RING');
    const pole = poleNodes.length ? extractWorldMeshes(scene, poleNodes) : [];
    let ring = ringNodes.length ? extractWorldMeshes(scene, ringNodes) : [];
    const plateChoices = familyPins || [];
    if (!plateChoices.length) throw new Error('No backplate choices found for this bracket.');
    const firstPlate = extractWorldMeshes(scene, [plateChoices[0].choiceNode]);
    if (!pole.length) throw new Error('No POLE cluster nodes found.');
    const axes = inferAxes(pole, firstPlate);
    const views = makeViews(axes);
    // presentation: slide the ring group onto the visible pole span (examples show the
    // ring on the rod) when it sits off this segment
    if (ring.length) {
      const rb = groupBbox(ring), pb = axes.poleBox;
      const rc = rb.center[axes.poleAxis];
      if (rc < pb.min[axes.poleAxis] || rc > pb.max[axes.poleAxis]) {
        const d = [0, 0, 0];
        d[axes.poleAxis] = pb.center[axes.poleAxis] - rc;
        ring = translateMeshes(ring, d);
      }
    }
    const rootV = armRootCenter(bracket, axes);
    const rows = plateChoices.map((platePin) => {
      const plateAll0 = extractWorldMeshes(scene, [platePin.choiceNode]);
      if (!plateAll0.length) return { rowKey: platePin.partName, code: platePin.partName, missing: true };
      const cover0 = plateAll0.filter(m => !WALL_PLATE_MATCH.test(m.name + m.path) && !SCREW_MATCH.test(m.name + m.path));
      const cb0 = groupBbox(cover0.length ? cover0 : plateAll0);
      // center the plate group on the bracket arm root (GLBs model plates at pole centerline)
      let plateAll = plateAll0;
      if (rootV != null) {
        const d = [0, 0, 0];
        d[axes.vertAxis] = rootV - cb0.center[axes.vertAxis];
        plateAll = translateMeshes(plateAll0, d);
      }
      const wallPlate = plateAll.filter(m => WALL_PLATE_MATCH.test(m.name + m.path));
      const cover = plateAll.filter(m => !WALL_PLATE_MATCH.test(m.name + m.path) && !SCREW_MATCH.test(m.name + m.path));
      // merged GLBs may drop the "/" from item codes ("H1-CPWP2P") — normalize back to ".../P"
      const wallCodeMatch = (wallPlate[0] ? (wallPlate[0].path + '/' + wallPlate[0].name) : '').match(/H1-[A-Z]*WP\d+(\s*\/?\s*P)?/i);
      const wallCode = wallCodeMatch ? wallCodeMatch[0].toUpperCase().replace(/\s*\/?\s*P$/, '/P') : (wallPlate.length ? 'WALL PLATE' : '');
      const meshes = [...bracket, ...plateAll, ...pole, ...ring];
      const front = renderHiddenLine(meshes, views.front, 1600);
      const profile = renderHiddenLine(meshes, views.profile, 900);
      const detail = wallPlate.length ? renderHiddenLine(wallPlate, views.front, 300) : null;
      // measures in view space
      const coverF = viewBbox(cover.length ? cover : plateAll, views.front);
      const poleF = viewBbox(pole, views.front);
      const ringF = ring.length ? viewBbox(ring, views.front) : null;
      const coverP = viewBbox(cover.length ? cover : plateAll, views.profile);
      const wallF = wallPlate.length ? viewBbox(wallPlate, views.front) : null;
      const isRound = /-R$/i.test(platePin.partName || '');
      const dims = { front: [], profile: [], detail: [] };
      const plateWIn = (coverF.maxU - coverF.minU) * M2IN;
      if (isRound) dims.front.push({ t: 'dia', u: coverF.maxU - 0.004, v: coverF.maxV, in: plateWIn });
      else dims.front.push({ t: 'h', u0: coverF.minU, u1: coverF.maxU, v: coverF.maxV, off: -10, in: plateWIn });
      dims.front.push({ t: 'dia', u: poleF.maxU - 0.004, v: poleF.maxV, in: (poleF.maxV - poleF.minV) * M2IN });
      if (ringF) {
        // ring drop: TOP OF ROD → bottom of the eyelet (Stuart's definition)
        dims.front.push({ t: 'v', u: ringF.maxU, v0: poleF.maxV, v1: ringF.minV, off: 14, in: (poleF.maxV - ringF.minV) * M2IN });
        // as-mounted: top hole of the wall mount → bottom of the ring, from bulk-entered offset
        const topHoleOff = parseInches(wallCfg[wallCode]?.topHole);
        if (topHoleOff != null && wallF) {
          const topHoleV = wallF.maxV - topHoleOff / M2IN;
          dims.front.push({ t: 'v', u: coverF.minU, v0: topHoleV, v1: ringF.minV, off: -16, in: (topHoleV - ringF.minV) * M2IN });
        }
      }
      // profile: projection (wall face → pole centerline) + plate height
      const wallPt = [0, 0, 0]; wallPt[axes.projAxis] = axes.wallCoord;
      const polePt = [...axes.poleCenter];
      const wallU = projPoint(views.profile, wallPt)[0];
      const poleU = projPoint(views.profile, polePt)[0];
      const profTopV = viewBbox(meshes, views.profile).maxV;
      dims.profile.push({ t: 'h', u0: Math.min(wallU, poleU), u1: Math.max(wallU, poleU), v: profTopV, off: -8, in: Math.abs(poleU - wallU) * M2IN });
      dims.profile.push({ t: 'v', u: coverP.maxU, v0: coverP.maxV, v1: coverP.minV, off: 14, in: (coverP.maxV - coverP.minV) * M2IN, dia: isRound });
      if (wallF && detail) {
        dims.detail.push({ t: 'h', u0: wallF.minU, u1: wallF.maxU, v: wallF.maxV, off: -12, in: (wallF.maxU - wallF.minU) * M2IN });
        dims.detail.push({ t: 'v', u: wallF.maxU, v0: wallF.maxV, v1: wallF.minV, off: 12, in: (wallF.maxV - wallF.minV) * M2IN });
      }
      return { rowKey: platePin.partName, partName: platePin.partName, wallCode, front, profile, detail, dims, hasAsMounted: ringF && parseInches(wallCfg[wallCode]?.topHole) != null };
    }).filter(r => !r.missing);
    return { rows, axes };
  }, [nodesFor, wallCfg]);

  // ---- compose current page ----
  useEffect(() => {
    if (!pages.length || error) return;
    const page = pages[Math.min(pageIndex, pages.length - 1)];
    setStatus('Rendering…');
    const t = setTimeout(() => {
      try {
        let built = rowCacheRef.current[page.key];
        if (!built) {
          built = buildRows(page.bracketPin, page.familyPins);
          rowCacheRef.current[page.key] = built;
        }
        const rows = built.rows.map(r => ({ ...r, code: rowCode(r.partName) }));
        const anyAsMounted = rows.some(r => r.hasAsMounted);
        const titleCode = edition === 'FAB' ? (fabCodeFor(page.bracketPin.partName) || page.bracketPin.partName) : page.bracketPin.partName;
        const result = buildPageSvg({
          title: `${assembly.itemName || assembly.itemId} — ${titleCode}`,
          subtitle: `${edition === 'FAB' ? 'Fabricut edition' : 'H1 edition'} · ${page.family} backplates · generated from 3D model`,
          rows,
          manualDims: manualDims.filter(d => d.pageKey === page.key),
          noteLines: [
            ...(anyAsMounted ? [AS_MOUNTED_NOTE] : []),
            'Ring dim = top of rod to bottom of eyelet. Profile horizontal dim = wall face to pole centerline.',
            'Measured from 3D geometry, nearest 1/16". Manual dims entered where geometry cannot provide them.',
          ],
        });
        setPageData(result);
        setStatus('');
      } catch (e) {
        console.error('SpecSheet render failed', e);
        setError(e?.message || String(e));
        setStatus('');
      }
    }, 30);
    return () => clearTimeout(t);
  }, [pages, pageIndex, edition, manualDims, wallCfg, buildRows, rowCode, fabCodeFor, assembly, error]);

  // wall config affects measures → invalidate the row cache when it changes
  useEffect(() => { rowCacheRef.current = {}; }, [wallCfg]);

  // ---- manual dimension tool: two clicks on the SVG → value prompt ----
  const handleSvgClick = (e) => {
    if (!dimTool || !pageData) return;
    const svgEl = svgHostRef.current?.querySelector('svg');
    if (!svgEl) return;
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return;
    const p = pt.matrixTransform(ctm.inverse());
    const hit = pageData.viewMaps.find(vm => {
      const [x, y, w, h] = vm.mapping.rect;
      return p.x >= x - 30 && p.x <= x + w + 30 && p.y >= y - 30 && p.y <= y + h + 30;
    });
    if (!hit) return;
    const { x0, y0, scale, minU, minV } = hit.mapping;
    const wu = minU + (p.x - x0) / scale;
    const wv = minV + (y0 - p.y) / scale;
    if (!pendingPtRef.current) {
      pendingPtRef.current = { rowKey: hit.rowKey, view: hit.view, u: wu, v: wv };
      setStatus('First point set — click the second point.');
      return;
    }
    const a = pendingPtRef.current;
    pendingPtRef.current = null;
    if (a.rowKey !== hit.rowKey || a.view !== hit.view) { setStatus('Points must be on the same view — start again.'); return; }
    const value = window.prompt('Dimension value (inches — e.g. 2 3/4):');
    if (!value) { setStatus(''); return; }
    const page = pages[Math.min(pageIndex, pages.length - 1)];
    setManualDims(d => [...d, { id: `md_${d.length}_${a.rowKey}`, pageKey: page.key, rowKey: a.rowKey, view: a.view, aU: a.u, aV: a.v, bU: wu, bV: wv, value: value.trim() }]);
    setDirty(true);
    setStatus('');
  };

  const saveOverrides = async () => {
    try {
      await updateDoc(doc(db, 'Approved_Designs', assembly.id), { specSheetOverrides: { manualDims } });
      setDirty(false);
      setStatus('Overrides saved.');
    } catch (e) { alert('Save failed: ' + (e?.message || e)); }
  };

  const saveWallCfg = async () => {
    try {
      await setDoc(doc(db, 'system', 'spec_sheet_config'), { wallPlates: wallCfg }, { merge: true });
      rowCacheRef.current = {};
      setStatus('Wall-mount dims saved.');
    } catch (e) { alert('Save failed: ' + (e?.message || e)); }
  };

  // every page rendered (uses cache; builds missing ones) — for print/PDF
  const buildAllPages = () => pages.map((page) => {
    let built = rowCacheRef.current[page.key];
    if (!built) { built = buildRows(page.bracketPin, page.familyPins); rowCacheRef.current[page.key] = built; }
    const rows = built.rows.map(r => ({ ...r, code: rowCode(r.partName) }));
    const titleCode = edition === 'FAB' ? (fabCodeFor(page.bracketPin.partName) || page.bracketPin.partName) : page.bracketPin.partName;
    return buildPageSvg({
      title: `${assembly.itemName || assembly.itemId} — ${titleCode}`,
      subtitle: `${edition === 'FAB' ? 'Fabricut edition' : 'H1 edition'} · ${page.family} backplates · generated from 3D model`,
      rows,
      manualDims: manualDims.filter(d => d.pageKey === page.key),
      noteLines: [
        ...(rows.some(r => r.hasAsMounted) ? [AS_MOUNTED_NOTE] : []),
        'Ring dim = top of rod to bottom of eyelet. Profile horizontal dim = wall face to pole centerline.',
      ],
    }).svg;
  });

  const handlePrint = () => {
    try { openSpecSheetPrint(assembly.itemName || assembly.itemId, buildAllPages()); }
    catch (e) { alert('Print failed: ' + (e?.message || e)); }
  };
  const handlePdf = async () => {
    try {
      setStatus('Building PDF…');
      await downloadSpecSheetPdf(assembly.itemName || assembly.itemId, buildAllPages());
      setStatus('');
    } catch (e) { console.error(e); alert('PDF failed: ' + (e?.message || e)); setStatus(''); }
  };

  // wall codes present on the current page rows (seed rows for the bulk editor)
  const knownWallCodes = Array.from(new Set(
    Object.values(rowCacheRef.current).flatMap(b => b.rows.map(r => r.wallCode)).filter(Boolean)
  ));
  const cfgCodes = Array.from(new Set([...Object.keys(wallCfg), ...knownWallCodes])).sort();

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#f4f5f7', borderRadius: '8px', width: 'min(1240px, 96vw)', maxHeight: '94vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid #d5d8dd', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '0.95rem' }}>Spec Sheet — {assembly?.itemName || assembly?.itemId}</strong>
          <select value={pageIndex} onChange={e => setPageIndex(+e.target.value)} style={{ padding: '5px', fontSize: '0.8rem' }}>
            {pages.map((p, i) => <option key={p.key} value={i}>{p.title}</option>)}
          </select>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button style={edition === 'H1' ? btnOn : btn} onClick={() => setEdition('H1')}>H1 codes</button>
            <button style={edition === 'FAB' ? btnOn : btn} onClick={() => setEdition('FAB')}>Fabricut codes</button>
          </div>
          <button style={dimTool ? btnOn : btn} onClick={() => { setDimTool(v => !v); pendingPtRef.current = null; }}>＋ Manual dim</button>
          {manualDims.length > 0 && (
            <button style={btn} onClick={() => {
              const page = pages[pageIndex];
              const count = manualDims.filter(d => d.pageKey === page?.key).length;
              if (!count || !window.confirm(`Remove ${count} manual dim(s) on this page?`)) return;
              setManualDims(d => d.filter(x => x.pageKey !== page.key));
              setDirty(true);
            }}>Clear page dims</button>
          )}
          <button style={btn} onClick={() => setShowWallCfg(v => !v)}>Wall mounts</button>
          {dirty && <button style={{ ...btnOn, background: '#2e7d4f' }} onClick={saveOverrides}>Save dims</button>}
          <div style={{ flex: 1 }} />
          <button style={btn} onClick={handlePrint}>Print</button>
          <button style={btn} onClick={handlePdf}>PDF</button>
          <button style={btn} onClick={onClose}>✕ Close</button>
        </div>
        {showWallCfg && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #d5d8dd', background: '#fff', maxHeight: '32vh', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.8rem', marginBottom: '6px' }}>
              Wall-mount styles — enter inches as fractions ("2 3/4"). <b>Top hole</b> = distance from the TOP of the wall plate down to the top hole center (drives the as-mounted dim).
              <button style={{ ...btn, marginLeft: '10px' }} onClick={() => { const code = window.prompt('Wall plate code (e.g. H1-CPWP2/P):'); if (code) setWallCfg(c => ({ ...c, [code.toUpperCase()]: c[code.toUpperCase()] || {} })); }}>＋ Add style</button>
              <button style={{ ...btnOn, marginLeft: '6px' }} onClick={saveWallCfg}>Save wall mounts</button>
            </div>
            <table style={{ borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead><tr>{['Code', 'Width', 'Height', 'Top hole ↓ from top', 'Hole spacing', 'Note'].map(h => <th key={h} style={{ textAlign: 'left', padding: '3px 10px 3px 0', borderBottom: '1px solid #ccc' }}>{h}</th>)}</tr></thead>
              <tbody>
                {cfgCodes.length === 0 && <tr><td colSpan={6} style={{ padding: '6px 0', color: '#777' }}>No wall-mount styles yet — render a page first (codes are detected from the GLB) or add one.</td></tr>}
                {cfgCodes.map(code => (
                  <tr key={code}>
                    <td style={{ padding: '3px 10px 3px 0', fontFamily: 'monospace' }}>{code}</td>
                    {['width', 'height', 'topHole', 'holeSpacing', 'note'].map(f => (
                      <td key={f} style={{ padding: '3px 10px 3px 0' }}>
                        <input value={wallCfg[code]?.[f] || ''} onChange={e => setWallCfg(c => ({ ...c, [code]: { ...c[code], [f]: e.target.value } }))}
                          style={{ width: f === 'note' ? '160px' : '70px', padding: '3px', fontSize: '0.78rem' }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: '8px 16px', fontSize: '0.8rem', color: '#555', minHeight: '20px' }}>
          {error ? <span style={{ color: '#b00020' }}>⚠ {error}</span> : (status || (dimTool ? 'Manual dim: click two points on a drawing, then enter the value.' : ''))}
        </div>
        <div ref={svgHostRef} onClick={handleSvgClick}
          style={{ flex: 1, overflow: 'auto', padding: '0 16px 16px', cursor: dimTool ? 'crosshair' : 'default' }}>
          {pageData && (
            <div style={{ background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,0.2)', maxWidth: `${PAGE_W}px`, margin: '0 auto', aspectRatio: `${PAGE_W}/${PAGE_H}` }}
              dangerouslySetInnerHTML={{ __html: pageData.svg }} />
          )}
        </div>
      </div>
    </div>
  );
};

export default SpecSheetModal;
