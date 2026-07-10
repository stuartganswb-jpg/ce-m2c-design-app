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
import { normalizeCategory, normalizePosition, normalizeEndTreatment } from '../Shared/assemblyTags';
import {
  M2IN, extractWorldMeshes, groupBbox, translateMeshes, inferAxes, makeViews,
  armRootCenter, parseInches, clipSegmentsU, breakMarks, sanitize,
} from './specSheetGeometry';
import { renderHiddenLine } from './hiddenLine';
import { buildPageSvg, buildWallMountsPage, buildItemsGridPage, PAPERS } from './specSheetPage';
import { openSpecSheetPrint, downloadSpecSheetPdf } from './specSheetOutput';

// Wall-mount plate meshes are children of each backplate choice node in the merged GLB
// (Fabricut H1 convention: item codes like H1-CPWP2/P). Extend here if a collection names
// its wall plates differently.
const WALL_PLATE_MATCH = /(CPWP|BPWP|IMWP)/i;
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
  // 'tab11' = true 1:1 on 11×17 · 'letterReduced' = same 11×17 master reduced onto 8.5×11
  // (~64%, marked not-to-scale) · 'fit' = compact 8.5×11 fit-scale layout
  const [paperMode, setPaperMode] = useState('tab11');
  const scaleMode = paperMode === 'fit' ? 'fit' : 'actual';
  const layoutPaper = scaleMode === 'actual' ? 'tabloid' : 'letter';
  const outputPaper = paperMode === 'tab11' ? 'tabloid' : 'letter';
  const reducedNote = paperMode === 'letterReduced'
    ? 'REDUCED PRINT OF THE 11×17 1:1 MASTER — NOT 1:1 AT THIS SIZE (use the 11×17 option at 100% for actual scale)'
    : null;
  const [choiceData, setChoiceData] = useState(null);
  const [manualDims, setManualDims] = useState(() => assembly?.specSheetOverrides?.manualDims || []);
  const [wallCfg, setWallCfg] = useState({});
  const [showWallCfg, setShowWallCfg] = useState(false);
  const [dimTool, setDimTool] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pages, setPages] = useState([]); // [{ key, title, bracketPin }]
  const [pageData, setPageData] = useState(null); // { svg, viewMaps }
  const sceneRef = useRef(null);
  const rowCacheRef = useRef({}); // pageKey -> built rows
  const wallMountsRef = useRef(null); // unique wall-mount styles for the 1:1 reference page
  const finialsRef = useRef(null);    // finial catalog items for the 1:1 grid page
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
        // A plate is a RETURN plate if its pin OR its cluster carries the return flag —
        // the same part code (e.g. H1-75RCP-S) exists in both the L/R bracket-backplate
        // cluster and the french/miter return-backplate cluster, so the CLUSTER chip is
        // what actually distinguishes them.
        const plateIsReturn = (p) => {
          const cl = clusterById[p.clusterId];
          return !!(p.returnOnly || cl?.returnOnly || cl?.usesReturnPlates);
        };
        // inline plates (the I set, at pole height) pair ONLY with inline brackets (the
        // ILE clip); standard plates (the D set, at arm height) pair with the rest —
        // mixing them puts the plate at the wrong height relative to rod and ring
        const plateIsInline = (p) => {
          const cl = clusterById[p.clusterId];
          return !!(p.inlineOnly || cl?.inlineOnly);
        };
        const stdFams = {}, inlFams = {}, retFams = {};
        plates.forEach(p => {
          const f = familyOf(p.partName);
          const target = plateIsReturn(p) ? retFams : (plateIsInline(p) ? inlFams : stdFams);
          (target[f] = target[f] || []).push(p);
        });
        // dedupe within each family (same part can pin LEFT and RIGHT positions)
        const dedupe = (arr) => { const seen = new Set(); return arr.filter(p => seen.has(p.partName) ? false : (seen.add(p.partName), true)); };
        [stdFams, inlFams, retFams].forEach(map => Object.keys(map).forEach(f => { map[f] = dedupe(map[f]); }));
        const platesFlagged = Object.keys(retFams).length > 0;
        const inlineFlagged = Object.keys(inlFams).length > 0;
        // the FINIAL cluster holds ALL end-treatment choices (canonical tag spec):
        // plain finials → catalog grid page; french/miter returns → bracket-style pages;
        // inside mounts → single-row page (their threaded plate is nested in the geometry)
        const endChoices = choicesFor('FINIAL');
        const et = (p) => normalizeEndTreatment(p.endTreatment || '');
        const finials = endChoices.filter(p => !et(p) || et(p) === 'FINIAL');
        const returnArms = endChoices.filter(p => et(p) === 'FRENCH_RETURN' || et(p) === 'MITER_RETURN');
        const insideMounts = endChoices.filter(p => et(p) === 'INSIDE_MOUNT');
        setChoiceData({ brackets, stdFams, inlFams, retFams, platesFlagged, inlineFlagged, finials, returnArms, insideMounts });
        setStatus('');
      } catch (e) {
        console.error('SpecSheet load failed', e);
        if (!dead) { setError(e?.message || String(e)); setStatus(''); }
      }
    })();
    return () => { dead = true; };
  }, [assembly, choicesFor, clusterById]);

  // ---- derive pages from choices (re-chunked when the scale mode changes) ----
  useEffect(() => {
    if (!choiceData) return;
    const { brackets, stdFams = {}, inlFams = {}, retFams = {}, platesFlagged, inlineFlagged, finials = [], returnArms = [], insideMounts = [] } = choiceData;
    // 1:1 rows are ~4" tall (ring drop + plate + padding) — two fit on 11×17's 10.5" printable height
    const maxRows = scaleMode === 'actual' ? 2 : MAX_ROWS_PER_PAGE;
    const pageList = [];
    const allFams = {};
    [stdFams, inlFams, retFams].forEach(m => Object.entries(m).forEach(([f, pins]) => { allFams[f] = [...(allFams[f] || []), ...pins]; }));
    // return arms page like brackets (their bend geometry is part of the choice node)
    const armLike = [
      ...brackets.map(b => ({ pin: b, retSuffix: '' })),
      ...returnArms.map(a => ({ pin: a, retSuffix: ' (return)' })),
    ];
    for (const { pin: b, retSuffix } of armLike) {
      // isBasic = bracket takes NO backplate (canonical flag) — its page draws the
      // bracket/pole/ring alone, no plate rows, no wall-mount detail.
      if (b.isBasic) {
        pageList.push({ key: `${b.partName}__BASIC`, title: `${b.partName} (basic — no backplate)`, bracketPin: b, familyPins: [], family: 'basic, no backplate' });
        continue;
      }
      const bracketIsReturn = !!(retSuffix || b.usesReturnPlates || b.isReturnArm || /RETURN/i.test(b.endTreatment || ''));
      const bracketIsInline = !!(b.inlineOnly || clusterById[b.clusterId]?.inlineOnly);
      // returns pair ONLY with return-plate families, inline brackets with the inline (I)
      // set, everything else with the standard (D) set — falls back to the whole pool when
      // the respective flags aren't in the data yet
      let famMap;
      if (bracketIsReturn) famMap = platesFlagged ? retFams : allFams;
      else if (bracketIsInline && inlineFlagged) famMap = inlFams;
      else famMap = (platesFlagged || inlineFlagged) ? stdFams : allFams;
      if (!Object.keys(famMap).length) famMap = allFams;
      for (const [fam, famPins] of Object.entries(famMap)) {
        for (let i = 0; i < famPins.length; i += maxRows) {
          const chunk = famPins.slice(i, i + maxRows);
          const part = famPins.length > maxRows ? ` (${i / maxRows + 1})` : '';
          pageList.push({
            key: `${b.partName}__${fam}__${i}_${maxRows}`,
            title: `${b.partName}${retSuffix} + ${fam}${part}`,
            bracketPin: b,
            familyPins: chunk,
            family: fam,
          });
        }
      }
    }
    for (const im of insideMounts) {
      pageList.push({ key: `${im.partName}__IM`, title: `${im.partName} (inside mount)`, bracketPin: im, familyPins: [], family: 'inside mount', isIM: true });
    }
    if (!pageList.length) { setError('No bracket × backplate-family pages could be derived.'); return; }
    if (finials.length) pageList.push({ key: '__FINIALS__', title: '❖ Finials (1:1)', family: '' });
    pageList.push({ key: '__WM__', title: '⊞ Wall mounts (1:1)', family: '' });
    setPages(pageList);
    setPageIndex(0);
  }, [choiceData, scaleMode, clusterById]);

  // ---- build rows for a page (cached per bracket × family) ----
  const buildRows = useCallback((bracketPin, familyPins, opts = {}) => {
    const scene = sceneRef.current;
    const bracket = extractWorldMeshes(scene, [bracketPin.choiceNode]);
    if (!bracket.length) throw new Error(`Bracket node "${bracketPin.choiceNode}" not found in GLB.`);
    const poleNodes = nodesFor('POLE');
    const ringNodes = nodesFor('RING');
    const pole = poleNodes.length ? extractWorldMeshes(scene, poleNodes) : [];
    // ring CHOICES: the cluster can hold several ring options stacked in the model (BPR +
    // BR) — the composed views draw only the one actually hanging on the rod; every option
    // gets its own labeled detail image in the page corner.
    const ringPins = choicesFor('RING');
    let ringChoices = ringPins
      .map(p => ({ partName: p.partName, meshes: extractWorldMeshes(scene, [p.choiceNode]) }))
      .filter(r => r.meshes.length);
    if (!ringChoices.length && ringNodes.length) {
      ringChoices = [{ partName: '', meshes: extractWorldMeshes(scene, ringNodes) }];
    }
    let ring = [];
    const plateChoices = familyPins || [];
    if (!pole.length) throw new Error('No POLE cluster nodes found.');
    // basic brackets have no plate — the bracket itself marks the wall side for axis inference
    const firstPlate = plateChoices.length ? extractWorldMeshes(scene, [plateChoices[0].choiceNode]) : [];
    const axes = inferAxes(pole, firstPlate.length ? firstPlate : bracket);
    const views = makeViews(axes);
    // Some plate/bracket GLB nodes embed a RING instance modeled inside the assembly
    // (e.g. BP-H / CP-H carry one) — the plate-centering shift would drag it to the wrong
    // spot and double the parked ring. Strip ring meshes from those groups: matched by
    // ring part name (exact path segment) or eyelet, AND sitting on the rod plane — the
    // plane guard keeps the BP-R PLATE safe from the BPR RING's colliding sanitized name.
    const ringKeys = ringChoices.map(rc => sanitize(rc.partName)).filter(Boolean);
    const onRodPlane = (m) => {
      const b = groupBbox([m]);
      return Math.abs(b.center[axes.projAxis] - axes.poleBox.center[axes.projAxis]) < 0.02;
    };
    const isStrayRing = (m) => {
      if (!onRodPlane(m)) return false;
      if (/eyelet/i.test(m.name + m.path)) return true;
      const segs = (m.path + '/' + m.name).split('/');
      return segs.some(s => ringKeys.includes(sanitize(s)));
    };
    // scrub embedded rings from the bracket group (in place — the array is shared below)
    if (bracket.some(isStrayRing)) {
      const keep = bracket.filter(m => !isStrayRing(m));
      bracket.length = 0;
      bracket.push(...keep);
    }
    // pick the ring that actually HANGS on the rod for the composed views: prefer choices
    // whose bbox wraps the pole centerline; among those the lowest one (a stacked second
    // option floats above the rod and would corrupt the ring-drop measurement)
    const ringDetails = [];
    if (ringChoices.length) {
      const vert = axes.vertAxis;
      const poleC = axes.poleBox.center[vert];
      const scored = ringChoices.map(rc => {
        const b = groupBbox(rc.meshes);
        return { ...rc, b, wraps: b.min[vert] <= poleC && b.max[vert] >= poleC, centerV: b.center[vert] };
      });
      const wrapping = scored.filter(s => s.wraps);
      const pool = wrapping.length ? wrapping : scored;
      const main = pool.reduce((lo, s) => (s.centerV < lo.centerV ? s : lo), pool[0]);
      ring = main.meshes;
      // detail images for EVERY ring option (they stack on the rod; key dims match, but
      // the customer should see both parts) — rendered later once views exist
      for (const s of scored) ringDetails.push(s);
    }
    // presentation: park the ring on OPEN rod PAST the plate/bracket edge (per row — wide
    // -H plates push it further out). A ring in front of the plate face reads as if it
    // aligned to the plate top instead of hanging from the rod; off to the side the ring
    // and its drop measurement are unambiguous (matches how the return pages read).
    const parkRing = (clearHalfM) => {
      if (!ring.length) return ring;
      const rb = groupBbox(ring), pb = axes.poleBox, bb = groupBbox(bracket);
      const ax = axes.poleAxis;
      const sign = Math.sign(pb.center[ax] - bb.center[ax]) || 1;
      const ringHalf = (rb.max[ax] - rb.min[ax]) / 2 + 0.002;
      let target = bb.center[ax] + sign * (clearHalfM + ringHalf + 0.008);
      target = Math.min(Math.max(target, pb.min[ax] + ringHalf), pb.max[ax] - ringHalf);
      const d = [0, 0, 0];
      d[ax] = target - rb.center[ax];
      return translateMeshes(ring, d);
    };
    const bracketHalfAlong = bracket.length
      ? (groupBbox(bracket).max[axes.poleAxis] - groupBbox(bracket).min[axes.poleAxis]) / 2
      : 0;
    // ring-option detail images: FACE-ON (profile direction — the ring reads as a circle),
    // body OD + overall height including the eyelet
    const ringItems = ringDetails.map(s => {
      const view = renderHiddenLine(s.meshes, views.profile, 350);
      const body = s.meshes.filter(m => !/eyelet/i.test(m.name + m.path));
      const bP = viewBbox(body.length ? body : s.meshes, views.profile);
      const aP = viewBbox(s.meshes, views.profile);
      return {
        partName: s.partName,
        view,
        odIn: (bP.maxV - bP.minV) * M2IN,
        hIn: (aP.maxV - aP.minV) * M2IN,
      };
    });
    const rootV = armRootCenter(bracket, axes);
    // Rod break: clip the front view to a window around plate/bracket/ring and mark the
    // cut — a full rod can't print at 1:1, and the hand-made sheets truncate it the same way.
    const clipFront = (front0, includeBoxes) => {
      const poleFull = viewBbox(pole, views.front);
      let lo = Infinity, hi = -Infinity;
      for (const b of includeBoxes) {
        if (!b || !isFinite(b.minU)) continue;
        if (b.minU < lo) lo = b.minU;
        if (b.maxU > hi) hi = b.maxU;
      }
      lo -= 0.015; hi += 0.018; // extra visible rod so the parked ring clearly hangs on it
      const vis = clipSegmentsU(front0.vis, lo, hi);
      if (poleFull.minU < lo) vis.push(...breakMarks(lo + 0.004, poleFull.minV, poleFull.maxV));
      if (poleFull.maxU > hi) vis.push(...breakMarks(hi - 0.006, poleFull.minV, poleFull.maxV));
      return { view: { vis, zb: { ...front0.zb, minU: lo, maxU: hi } }, hi, poleFull };
    };
    // BASIC bracket / INSIDE MOUNT page: one row, choice + pole + ring only
    if (!plateChoices.length) {
      const rowRing = parkRing(bracketHalfAlong);
      const meshes = [...bracket, ...pole, ...rowRing];
      const front0 = renderHiddenLine(meshes, views.front, 1600);
      const profile = renderHiddenLine(meshes, views.profile, 900);
      const bracketF = viewBbox(bracket, views.front);
      const ringF = rowRing.length ? viewBbox(rowRing, views.front) : null;
      const { view: front, hi: frontHi, poleFull: poleF } = clipFront(front0, [bracketF, ringF]);
      const dims = { front: [], profile: [], detail: [] };
      dims.front.push({ t: 'dia', u: frontHi - 0.008, v: poleF.maxV, in: (poleF.maxV - poleF.minV) * M2IN });
      if (ringF) dims.front.push({ t: 'v', u: ringF.maxU, v0: poleF.maxV, v1: ringF.minV, off: 18, ldy: 26, in: (poleF.maxV - ringF.minV) * M2IN });
      if (opts.isIM) {
        // inside mount: barrel length + Ø; end view gets plate Ø + ring Ø leaders.
        // No projection dim — IM mounts at the rod end, not on the wall.
        dims.front.push({ t: 'h', u0: bracketF.minU, u1: bracketF.maxU, v: bracketF.maxV, off: -10, in: (bracketF.maxU - bracketF.minU) * M2IN });
        const barrel = bracket.filter(m => !WALL_PLATE_MATCH.test(m.name + m.path));
        if (barrel.length) {
          const bF = viewBbox(barrel, views.front);
          dims.front.push({ t: 'v', u: bF.maxU, v0: bF.maxV, v1: bF.minV, off: 14, dia: true, in: (bF.maxV - bF.minV) * M2IN });
        }
        const imPlate = bracket.filter(m => WALL_PLATE_MATCH.test(m.name + m.path));
        if (imPlate.length) {
          const pP = viewBbox(imPlate, views.profile);
          dims.profile.push({ t: 'dia', u: pP.minU + (pP.maxU - pP.minU) * 0.15, v: pP.maxV - (pP.maxV - pP.minV) * 0.15, dir: -1, in: (pP.maxV - pP.minV) * M2IN });
        }
        if (ring.length) {
          // ring OD only — the eyelet hangs below and would inflate the Ø
          const ringBody = ring.filter(m => !/eyelet/i.test(m.name + m.path));
          const rP = viewBbox(ringBody.length ? ringBody : ring, views.profile);
          dims.profile.push({ t: 'dia', u: rP.maxU - (rP.maxU - rP.minU) * 0.15, v: rP.maxV - (rP.maxV - rP.minV) * 0.15, in: (rP.maxV - rP.minV) * M2IN });
        }
      } else {
        const wallPt = [0, 0, 0]; wallPt[axes.projAxis] = axes.wallCoord;
        const wallU = projPoint(views.profile, wallPt)[0];
        const poleU = projPoint(views.profile, axes.poleCenter)[0];
        const profTopV = viewBbox(meshes, views.profile).maxV;
        dims.profile.push({ t: 'h', u0: Math.min(wallU, poleU), u1: Math.max(wallU, poleU), v: profTopV, off: -8, in: Math.abs(poleU - wallU) * M2IN });
      }
      return { rows: [{ rowKey: bracketPin.partName, partName: bracketPin.partName, wallCode: '', front, profile, detail: null, dims, hasAsMounted: false }], axes, ringItems };
    }
    const rows = plateChoices.map((platePin) => {
      const plateAll0 = extractWorldMeshes(scene, [platePin.choiceNode]).filter(m => !isStrayRing(m));
      if (!plateAll0.length) return { rowKey: platePin.partName, code: platePin.partName, missing: true };
      const cover0 = plateAll0.filter(m => !WALL_PLATE_MATCH.test(m.name + m.path) && !SCREW_MATCH.test(m.name + m.path));
      const cb0 = groupBbox(cover0.length ? cover0 : plateAll0);
      // OLD GLBs park every plate on the pole centerline — those need re-centering on the
      // bracket arm root. Repaired/merged GLBs model plates at their TRUE heights (D set at
      // arm height, I set at pole height) — shifting those corrupts the row. Only shift
      // when the plate sits ON the centerline while the arm root is clearly elsewhere.
      const poleCV = axes.poleBox.center[axes.vertAxis];
      const plateOnCenterline = Math.abs(cb0.center[axes.vertAxis] - poleCV) < 0.004; // < ~5/32"
      const rootOffCenterline = rootV != null && Math.abs(rootV - poleCV) > 0.008;    // > ~5/16"
      let plateAll = plateAll0;
      if (plateOnCenterline && rootOffCenterline) {
        const d = [0, 0, 0];
        d[axes.vertAxis] = rootV - cb0.center[axes.vertAxis];
        plateAll = translateMeshes(plateAll0, d);
      }
      const wallPlate = plateAll.filter(m => WALL_PLATE_MATCH.test(m.name + m.path));
      const cover = plateAll.filter(m => !WALL_PLATE_MATCH.test(m.name + m.path) && !SCREW_MATCH.test(m.name + m.path));
      // merged GLBs may drop the "/" from item codes ("H1-CPWP2P") — normalize back to ".../P"
      const wallCodeMatch = (wallPlate[0] ? (wallPlate[0].path + '/' + wallPlate[0].name) : '').match(/H1-[A-Z]*WP\d+(\s*\/?\s*P)?/i);
      const wallCode = wallCodeMatch ? wallCodeMatch[0].toUpperCase().replace(/\s*\/?\s*P$/, '/P') : (wallPlate.length ? 'WALL PLATE' : '');
      // park the ring past THIS row's plate edge — wide -H plates push it further out
      const plateHalfAlong = (cb0.max[axes.poleAxis] - cb0.min[axes.poleAxis]) / 2;
      const rowRing = parkRing(Math.max(plateHalfAlong, bracketHalfAlong));
      const meshes = [...bracket, ...plateAll, ...pole, ...rowRing];
      const front0 = renderHiddenLine(meshes, views.front, 1600);
      const profile = renderHiddenLine(meshes, views.profile, 900);
      const detail = wallPlate.length ? renderHiddenLine(wallPlate, views.front, 300) : null;
      // measures in view space
      const coverF = viewBbox(cover.length ? cover : plateAll, views.front);
      const bracketF = viewBbox(bracket, views.front);
      const ringF = rowRing.length ? viewBbox(rowRing, views.front) : null;
      const coverP = viewBbox(cover.length ? cover : plateAll, views.profile);
      const wallF = wallPlate.length ? viewBbox(wallPlate, views.front) : null;
      const { view: front, hi: frontHi, poleFull: poleF } = clipFront(front0, [coverF, bracketF, ringF]);
      const isRound = /-R$/i.test(platePin.partName || '');
      const dims = { front: [], profile: [], detail: [] };
      const plateWIn = (coverF.maxU - coverF.minU) * M2IN;
      // round plate: Ø leader off the circle's upper-LEFT arc (clear of the pole Ø leader)
      if (isRound) dims.front.push({ t: 'dia', u: coverF.minU + (coverF.maxU - coverF.minU) * 0.15, v: coverF.maxV - (coverF.maxV - coverF.minV) * 0.15, dir: -1, in: plateWIn });
      else dims.front.push({ t: 'h', u0: coverF.minU, u1: coverF.maxU, v: coverF.maxV, off: -10, in: plateWIn });
      dims.front.push({ t: 'dia', u: frontHi - 0.008, v: poleF.maxV, in: (poleF.maxV - poleF.minV) * M2IN });
      if (ringF) {
        // ring drop: TOP OF ROD → bottom of the eyelet (Stuart's definition); label drops
        // ~1/4" printed so the text clears the underside of the pole
        dims.front.push({ t: 'v', u: ringF.maxU, v0: poleF.maxV, v1: ringF.minV, off: 18, ldy: 26, in: (poleF.maxV - ringF.minV) * M2IN });
        // as-mounted: top hole of the wall mount → bottom of the ring, from bulk-entered offset
        const topHoleOff = parseInches(wallCfg[wallCode]?.topHole);
        if (topHoleOff != null && wallF) {
          const topHoleV = wallF.maxV - topHoleOff / M2IN;
          dims.front.push({ t: 'v', u: coverF.minU, v0: topHoleV, v1: ringF.minV, off: -16, side: -1, in: (topHoleV - ringF.minV) * M2IN });
        }
      }
      // profile: projection (wall face → pole centerline) + plate height
      const wallPt = [0, 0, 0]; wallPt[axes.projAxis] = axes.wallCoord;
      const polePt = [...axes.poleCenter];
      const wallU = projPoint(views.profile, wallPt)[0];
      const poleU = projPoint(views.profile, polePt)[0];
      const profTopV = viewBbox(meshes, views.profile).maxV;
      dims.profile.push({ t: 'h', u0: Math.min(wallU, poleU), u1: Math.max(wallU, poleU), v: profTopV, off: -8, in: Math.abs(poleU - wallU) * M2IN });
      // plate height: line + label in the empty space LEFT of the plate (wall side), off the artwork
      dims.profile.push({ t: 'v', u: coverP.minU, v0: coverP.maxV, v1: coverP.minV, off: -12, side: -1, in: (coverP.maxV - coverP.minV) * M2IN, dia: isRound });
      if (wallF && detail) {
        dims.detail.push({ t: 'h', u0: wallF.minU, u1: wallF.maxU, v: wallF.maxV, off: -12, in: (wallF.maxU - wallF.minU) * M2IN });
        dims.detail.push({ t: 'v', u: wallF.maxU, v0: wallF.maxV, v1: wallF.minV, off: 12, in: (wallF.maxV - wallF.minV) * M2IN });
      }
      return { rowKey: platePin.partName, partName: platePin.partName, wallCode, front, profile, detail, dims, hasAsMounted: ringF && parseInches(wallCfg[wallCode]?.topHole) != null };
    }).filter(r => !r.missing);
    return { rows, axes, ringItems };
  }, [nodesFor, wallCfg, choicesFor]);

  // ---- wall-mounts reference page: every unique wall-mount style at 1:1 ----
  const buildWallMounts = useCallback(() => {
    if (wallMountsRef.current) return wallMountsRef.current;
    const scene = sceneRef.current;
    const poleNodes = nodesFor('POLE');
    const pole = poleNodes.length ? extractWorldMeshes(scene, poleNodes) : [];
    const seen = new Map();
    const allPlatePins = choiceData
      ? [...Object.values(choiceData.stdFams || {}), ...Object.values(choiceData.inlFams || {}), ...Object.values(choiceData.retFams || {})].flat()
      : [];
    for (const p of allPlatePins) {
      const meshes = extractWorldMeshes(scene, [p.choiceNode]).filter(m => WALL_PLATE_MATCH.test(m.name + m.path));
      if (!meshes.length) continue;
      const codeM = (meshes[0].path + '/' + meshes[0].name).match(/H1-[A-Z]*WP\d+(\s*\/?\s*P)?/i);
      const code = codeM ? codeM[0].toUpperCase().replace(/\s*\/?\s*P$/, '/P') : `WALL PLATE (${p.partName})`;
      if (seen.has(code) || !pole.length) continue;
      const axes = inferAxes(pole, meshes);
      const views = makeViews(axes);
      const view = renderHiddenLine(meshes, views.front, 300);
      const wb = viewBbox(meshes, views.front);
      seen.set(code, {
        code,
        view,
        wIn: (wb.maxU - wb.minU) * M2IN,
        hIn: (wb.maxV - wb.minV) * M2IN,
        topHole: wallCfg[code]?.topHole || '',
      });
    }
    wallMountsRef.current = [...seen.values()];
    return wallMountsRef.current;
  }, [choiceData, nodesFor, wallCfg]);

  // ---- finials catalog: every finial choice at 1:1, side view, L × Ø dims ----
  const buildFinials = useCallback(() => {
    if (finialsRef.current) return finialsRef.current;
    const scene = sceneRef.current;
    const poleNodes = nodesFor('POLE');
    const pole = poleNodes.length ? extractWorldMeshes(scene, poleNodes) : [];
    const items = [];
    let views = null;
    for (const p of (choiceData?.finials || [])) {
      const meshes = extractWorldMeshes(scene, [p.choiceNode]);
      if (!meshes.length) continue;
      if (!views) {
        const axes = inferAxes(pole.length ? pole : meshes, meshes);
        views = makeViews(axes);
      }
      const view = renderHiddenLine(meshes, views.front, 400);
      const b = viewBbox(meshes, views.front);
      items.push({ partName: p.partName, view, wIn: (b.maxU - b.minU) * M2IN, hIn: (b.maxV - b.minV) * M2IN });
    }
    finialsRef.current = items;
    return items;
  }, [choiceData, nodesFor]);

  const composeFinialsPage = useCallback(() => buildItemsGridPage({
    title: `${assembly.itemName || assembly.itemId} — Finials`,
    subtitle: 'All finial choices at actual size. Socket depth is hidden geometry — add it with the manual dim tool.',
    items: buildFinials().map(f => ({ code: rowCode(f.partName), view: f.view, wIn: f.wIn, hIn: f.hIn })),
    paper: layoutPaper,
    footerNote: reducedNote,
    perRowOverride: layoutPaper === 'tabloid' ? 5 : 4,
  }), [assembly, buildFinials, rowCode, layoutPaper, reducedNote]);

  const composeWallMountsPage = useCallback(() => buildWallMountsPage({
    title: `${assembly.itemName || assembly.itemId} — Wall mounts`,
    items: buildWallMounts(),
    noteLines: ['Top-hole offsets come from the Wall mounts panel and drive the as-mounted dims.'],
    paper: layoutPaper,
    footerNote: reducedNote,
  }), [assembly, buildWallMounts, layoutPaper, reducedNote]);

  // ---- compose current page ----
  useEffect(() => {
    if (!pages.length || error) return;
    const page = pages[Math.min(pageIndex, pages.length - 1)];
    setStatus('Rendering…');
    const t = setTimeout(() => {
      try {
        if (page.key === '__WM__') { setPageData(composeWallMountsPage()); setStatus(''); return; }
        if (page.key === '__FINIALS__') { setPageData(composeFinialsPage()); setStatus(''); return; }
        let built = rowCacheRef.current[page.key];
        if (!built) {
          built = buildRows(page.bracketPin, page.familyPins, { isIM: page.isIM });
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
          scaleMode,
          paper: layoutPaper,
          footerNote: reducedNote,
          cornerItems: (built.ringItems?.length > 1)
            ? built.ringItems.map(r => ({ code: rowCode(r.partName), view: r.view, odIn: r.odIn, hIn: r.hIn }))
            : [],
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
  }, [pages, pageIndex, edition, manualDims, wallCfg, buildRows, rowCode, fabCodeFor, assembly, error, scaleMode, layoutPaper, reducedNote, composeWallMountsPage, composeFinialsPage]);

  // wall config affects measures → invalidate the caches when it changes
  useEffect(() => { rowCacheRef.current = {}; wallMountsRef.current = null; }, [wallCfg]);

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
    if (page.key === '__WM__') return composeWallMountsPage().svg;
    if (page.key === '__FINIALS__') return composeFinialsPage().svg;
    let built = rowCacheRef.current[page.key];
    if (!built) { built = buildRows(page.bracketPin, page.familyPins, { isIM: page.isIM }); rowCacheRef.current[page.key] = built; }
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
      scaleMode,
      paper: layoutPaper,
      footerNote: reducedNote,
      cornerItems: (built.ringItems?.length > 1)
        ? built.ringItems.map(r => ({ code: rowCode(r.partName), view: r.view, odIn: r.odIn, hIn: r.hIn }))
        : [],
    }).svg;
  });

  const handlePrint = () => {
    try { openSpecSheetPrint(assembly.itemName || assembly.itemId, buildAllPages(), outputPaper); }
    catch (e) { alert('Print failed: ' + (e?.message || e)); }
  };
  const handlePdf = async () => {
    try {
      setStatus('Building PDF…');
      await downloadSpecSheetPdf(assembly.itemName || assembly.itemId, buildAllPages(), outputPaper);
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
          <div style={{ display: 'flex', gap: '4px' }} title="1:1 = actual size on 11×17 · Reduced = the same 11×17 master shrunk onto 8.5×11 (~64%, not to scale) · Fit = compact 8.5×11">
            <button style={paperMode === 'tab11' ? btnOn : btn} onClick={() => setPaperMode('tab11')}>1:1 · 11×17</button>
            <button style={paperMode === 'letterReduced' ? btnOn : btn} onClick={() => setPaperMode('letterReduced')}>Reduced · 8.5×11</button>
            <button style={paperMode === 'fit' ? btnOn : btn} onClick={() => setPaperMode('fit')}>Fit · 8.5×11</button>
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
            <div style={{ background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,0.2)', maxWidth: `${PAPERS[layoutPaper].W}px`, margin: '0 auto', aspectRatio: `${PAPERS[layoutPaper].W}/${PAPERS[layoutPaper].H}` }}
              dangerouslySetInnerHTML={{ __html: pageData.svg }} />
          )}
        </div>
      </div>
    </div>
  );
};

export default SpecSheetModal;
