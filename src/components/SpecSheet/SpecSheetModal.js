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
import { fabricutCodeOf } from '../Shared/priceLevels';
import { loadGLBScene } from '../Shared/componentExport';
import { Box3 } from 'three';
import { normalizeCategory, normalizePosition } from '../Shared/assemblyTags';
import {
  M2IN, extractWorldMeshes, groupBbox, translateMeshes, inferAxes, makeViews,
  armRootCenter, parseInches, clipSegmentsU, breakMarks, sanitize,
} from './specSheetGeometry';
import { renderHiddenLine } from './hiddenLine';
import { buildPageSvg, buildWallMountsPage, buildItemsGridPage, PAPERS } from './specSheetPage';
import { rodForArm, visibleNodesForRow } from './specSheetRows';
import { specPages } from './specSheetPages';
import { choicesFromAssembly } from '../Shared/hardwareAdapter';
import { resolve as resolveHardware } from '../Shared/hardwareModel';
import { openSpecSheetPrint, downloadSpecSheetPdf } from './specSheetOutput';

// Wall-mount plate meshes are children of each backplate choice node in the merged GLB
// (item codes like H1-CPWP2/P, H2-75CPWP1/P — any family). Fragment match: the classic
// H1 trios plus the generic "WP<digit>" token so new collections work without edits here.
const WALL_PLATE_MATCH = /(CPWP|BPWP|IMWP|WP\d)/i;
// Full wall-plate code inside a mesh path — family-agnostic (was hardcoded H1-).
const WALL_CODE_RX = /[A-Z]+\d*-[A-Z0-9]*WP\d+(\s*\/?\s*P)?/i;
const SCREW_MATCH = /screw/i;

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

const SpecSheetModal = ({ assembly: baseAssembly, pins: basePins, libraryParts, onClose }) => {
  const [status, setStatus] = useState('Loading 3D model…');
  const [error, setError] = useState('');
  const [pageIndex, setPageIndex] = useState(0);

  // ── THE SIZE MACHINE IS GONE (Stuart 2026-08-23) ─────────────────────────────────────────
  // "the old engine and all the related assemblies are retired so we either start over or strip
  //  all the code out that related to it."
  //
  // What stood here: dia × projection dropdowns, a coverage strip of cells, a per-cell registry
  // mapping each cell to a SOURCE assembly or an uploaded spec GLB, and a code translator that
  // renamed every printed part on the way out. All of it existed for one reason — the ORIGINAL
  // sizes were never tagged, so one assembly had to stand in for its siblings and its codes had
  // to be rewritten to match the cell being drawn. Those assemblies are retired, and a tagged
  // assembly needs none of it: its pins say what it contains, and it draws itself.
  //
  // The sheet is the assembly you opened, its own codes, its own geometry.
  const assembly = baseAssembly;
  const pins = basePins;
  const hasTruePins = React.useMemo(
    () => (basePins || []).some(p => p && p.choiceNode && !p.isHiddenPart && p.partId),
    [basePins]);

  const [edition, setEdition] = useState('H1'); // 'H1' | 'FAB'
  // ── ONE MASTER, TWO PAPERS (Stuart 2026-08-23) ───────────────────────────────────────────
  // "i am ok having it scale 1:1 at 11 x17 as long as the page formats to print well at the
  //  reduced 8.5x11 … the call out measurements show the true dim's so that is fine."
  //
  // So there is ONE layout — the 11×17 master, drawn at true 1:1 — and a choice of what to print
  // it on. The third mode ('fit', a compact letter layout with its own scale rules) is gone: it
  // was where the column-scale defect lived, and a second layout that reads differently from the
  // master is a second thing to be wrong.
  const [paperMode, setPaperMode] = useState('tab11');
  const layoutPaper = 'tabloid';
  const outputPaper = paperMode === 'tab11' ? 'tabloid' : 'letter';
  const reducedNote = paperMode === 'letterReduced'
    ? 'REDUCED PRINT OF THE 11×17 1:1 MASTER — NOT 1:1 AT THIS SIZE (dimensions are true; use 11×17 at 100% for actual scale)'
    : null;
  // The scene is loaded ONCE and counted, not described. What a page contains is the engine's
  // answer (specSheetPages), which needs pins and tags — not geometry — so the two no longer
  // have to agree about anything.
  const [sceneReady, setSceneReady] = useState(0);
  const [manualDims, setManualDims] = useState(() => assembly?.specSheetOverrides?.manualDims || []);
  // Manual dims belong to the SOURCE assembly's geometry — reload when the size cell swaps it.
  useEffect(() => { setManualDims(assembly?.specSheetOverrides?.manualDims || []); setDirty(false); }, [assembly?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [wallCfg, setWallCfg] = useState({});
  const [showWallCfg, setShowWallCfg] = useState(false);
  const [dimTool, setDimTool] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pages, setPages] = useState([]); // [{ key, title, bracketPin }]
  const [pageData, setPageData] = useState(null); // { svg, viewMaps }
  const sceneRef = useRef(null);
  const unitScaledRef = useRef(false); // the >10-units inches→meters guess fired on this scene
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

  const nodesFor = useCallback((cat) => {
    const cls = clusters.filter(c => c.cat === cat && !c.hidden && (c.nodes || []).length && ['LEFT', 'SHARED', 'CENTER', ''].includes(c.pos || ''));
    const preferred = cls.filter(c => c.pos === 'LEFT');
    return (preferred.length ? preferred : cls).flatMap(c => c.nodes || []);
  }, [clusters]);

  // ── WHAT ONE PAGE IS ALLOWED TO DRAW (Stuart 2026-08-21) ─────────────────────────────────
  // "each drop down should filter and only show the rod and bracket and arm assigned to it, you can
  // see the rear rods from doubles showing on the single bracket … if it respects the available
  // combinations from the cpq flow based on its code and tags it will render the correct
  // combinations."
  //
  // nodesFor() asks the GLB for every pole cluster in the file, so a double's REAR rod landed on a
  // single bracket's page. The configurator never has that problem: it renders additively, so
  // selecting the arm, its plate and the rod that belongs with it yields exactly the geometry that
  // combination owns — which is the same question this page is asking.
  //
  // Used as a FILTER, never as a source: it can only remove geometry that does not belong to the
  // row, never invent any. An assembly with no true pins has no engine answer and is left alone.
  const engineChoices = React.useMemo(
    () => (hasTruePins ? choicesFromAssembly(assembly, pins) : null), [hasTruePins, assembly, pins]);
  const allowedNodesFor = useCallback((bracketPin, platePin) => {
    if (!engineChoices) return null;
    const model = resolveHardware({ choices: engineChoices, answers: {}, selectedIds: [] });
    const byNode = (pin) => pin && (model.choices || []).find(c =>
      (c.nodes || []).some(n => String(n).toLowerCase() === String(pin.choiceNode || '').toLowerCase()));
    const arm = byNode(bracketPin);
    if (!arm) return null;                       // an untagged page keeps drawing as it did
    const set = visibleNodesForRow({
      choices: engineChoices, arm, plate: byNode(platePin), rod: rodForArm(model, arm),
    });
    return set.size ? set : null;
  }, [engineChoices]);

  // Fabricut customer code for a part — THE SAME resolver the quote line uses
  // (Shared/priceLevels.fabricutCodeOf: Painted → Base → Premium, tier by finish suffix, variant
  // docs hop to their base doc). This sheet used to carry its own precedence (Painted → Premium →
  // exact_*), so a part could print one pattern # on the quote and another on the spec sheet
  // (playbook 4.6). exact_* stays as this sheet's LAST resort only — no other reader has it.
  const fabCodeFor = useCallback((partName) => {
    const part = (libraryParts || []).find(p => p.legacyErpId === partName || p.itemId === partName || p.id === partName);
    if (!part) return null;
    const findByCode = (c) => (libraryParts || []).find(p =>
      String(p.legacyErpId || '').toUpperCase() === c || String(p.itemId || '').toUpperCase() === c) || null;
    const shared = fabricutCodeOf(part, findByCode);
    if (shared) return shared;
    const fab = part.manufacturingSpecs?.fabricut;
    if (!fab) return null;
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
        // SPEC LAYOUT PREFERRED (Stuart 2026-07-20): if the assembly carries a dedicated
        // spec-sheet layout (1.6 "Spec Sheet Layout (📐)" slot → manufacturingSpecs.specCadUrl),
        // draw from THAT — flat, code-named, true positions per pole size/projection — instead
        // of the merged sellable model. Fixes the larger pole sizes / projections the combined
        // Fabricut .75 / 1 / 1-3/8 files couldn't render correctly.
        const specUrl = assembly?.manufacturingSpecs?.specCadUrl;
        const url = specUrl || assembly?.manufacturingSpecs?.cadUrl;
        if (!url) throw new Error('This assembly has no working GLB (manufacturingSpecs.cadUrl).');
        const [scene, cfgSnap] = await Promise.all([
          loadGLBScene(url),
          getDoc(doc(db, 'system', 'spec_sheet_config')).catch(() => null),
        ]);
        if (dead) return;
        // UNIT AUTO-NORMALIZE (Stuart 2026-07-24: H2-75 sheet blank from its own merged model) —
        // merged sales GLBs are exported in PRODUCTION units (inches); the sheet's meter math
        // then draws ~39× off-window, leaving a title block on an empty page. A rod set in true
        // meters measures well under 10 units; anything larger is inches → scale to meters.
        // True-m spec layouts and registry GLBs stay untouched (extent < 10).
        unitScaledRef.current = false;
        try {
          const bb = new Box3().setFromObject(scene);
          const ext = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
          if (Number.isFinite(ext) && ext > 10) { scene.scale.setScalar(0.0254); scene.updateMatrixWorld(true); unitScaledRef.current = true; }
        } catch (unitErr) { /* keep original units */ }
        sceneRef.current = scene;
        setError(''); // a fresh source is loading — clear any stale banner from the previous one
        // Row/wall-mount/finial caches are keyed by RAW pin names, which collide across size
        // sources (the 3.625" source pins the same …ILE names as the master) — flush on every
        // source load so a cell switch can never reuse the other source's geometry.
        rowCacheRef.current = {};
        wallMountsRef.current = null;
        finialsRef.current = null;
        setPageData(null); // never leave the previous source's drawing on screen during a swap
        // stale mismatch warnings die with the source they measured
        if (cfgSnap?.exists()) setWallCfg(cfgSnap.data()?.wallPlates || {});
        // ⚠ THE SCENE NO LONGER SAYS WHAT THE SHEET CONTAINS. It used to: choices were derived
        // here from node names against the library, plates sorted into "families" by regexes over
        // part codes, end treatments classified by sniffing /MTR|BEND/ out of node names. None of
        // that could read a tag, so none of it could be narrowed — which is why every page showed
        // too much. The GLB is asked for geometry and nothing else now; the page list comes from
        // the engine, off the pins.
        setSceneReady(n => n + 1);
        setStatus('');
      } catch (e) {
        console.error('SpecSheet load failed', e);
        if (!dead) { setError(e?.message || String(e)); setStatus(''); }
      }
    })();
    return () => { dead = true; };
  }, [assembly]);

  // ── THE PAGE LIST IS THE ENGINE'S ANSWER (Stuart 2026-08-23) ─────────────────────────────
  // "each page should be filtered down to show only a specific bracket arm at a specific
  //  projection … the same decisions made in the cpq steps. for each bracket arm we show it with
  //  all 4 backplates and cover plates, and the pole in place with any ring options that fit that
  //  pole diameter."
  //
  // specSheetPages walks activeAxes() and hands back one page per (leaf × arm), already carrying
  // its plates and its rings. Everything this effect still does is TRANSLATION: an engine choice
  // names a part, a pin names a node in the GLB, and the drawing needs the node.
  const pinForChoice = useCallback((choice) => {
    if (!choice) return null;
    const want = String(choice.partId || '').trim().toUpperCase();
    const usable = (pins || []).filter(p => p.choiceNode && !p.isHiddenPart);
    const same = usable.filter(p => String(p.partId || '').trim().toUpperCase() === want);
    // The hand-made sheets are all left-hand views, so an arm pinned both sides draws its LEFT
    // copy — the same preference choicesFor() has always applied.
    const pin = same.find(p => (clusterById[p.clusterId]?.pos || 'LEFT') === 'LEFT')
      || same[0]
      || usable.find(p => String(p.id || p.choiceNode || '') === String(choice.id));
    return pin ? { ...pin, partName: pin.partName || choice.name || choice.partId } : null;
  }, [pins, clusterById]);

  useEffect(() => {
    if (!sceneReady) return;
    // An untagged assembly has no engine answer, and the old machine that stood in for one — the
    // per-cell source registry, the code translation, the name-sniffing — is retired along with
    // the assemblies it served. Saying so beats drawing something plausible and wrong.
    if (!engineChoices) {
      setError('This assembly is not tagged, so the sheet has nothing to filter on. Tag its pins in 1.6 / ⚖ (category, projection, rod world) and reopen.');
      return;
    }
    const built = specPages({ choices: engineChoices });
    const pageList = [];
    for (const p of built) {
      if (p.kind === 'CATALOG') {
        const items = [...(p.finials || []), ...(p.accessories || [])].map(pinForChoice).filter(Boolean);
        if (items.length) pageList.push({ key: p.key, kind: 'CATALOG', title: `❖ Finials & accessories${p.label ? ` · ${p.label}` : ''}`, itemPins: items, family: p.label });
        continue;
      }
      const bracketPin = pinForChoice(p.subject);
      if (!bracketPin) continue;   // the engine offers it, this GLB does not carry it
      const familyPins = (p.plates || []).map(pinForChoice).filter(Boolean);
      const ringPins = (p.rings || []).map(pinForChoice).filter(Boolean);
      const riderPins = (p.riders || []).map(pinForChoice).filter(Boolean);
      pageList.push({
        key: p.key,
        kind: p.kind,
        title: `${bracketPin.partName}${p.plateFamily ? ` + ${p.plateFamily}` : ''}${p.label ? ` · ${p.label}` : ''}${p.plates.length ? '' : ' (draws alone)'}`,
        bracketPin, familyPins, ringPins, riderPins, plateFamily: p.plateFamily || '',
        rodNodes: (p.rod?.nodes || []),
        isTraverse: p.isTraverse,
        isIM: p.kind === 'INSIDE_MOUNT',
        family: p.label,
        reason: p.reason || '',
      });
    }
    if (!pageList.length) {
      setError('The engine offers no bracket this GLB carries — check that the pinned nodes still exist in the model.');
      return;
    }
    setError('');
    pageList.push({ key: '__WM__', kind: 'WALLMOUNTS', title: '⊞ Wall mounts (1:1)', family: '' });
    setPages(pageList);
    setPageIndex(0);
  }, [sceneReady, engineChoices, pinForChoice]);

  // Smallest box containing both — the MOUNTING is plate + arm together.
  const unionBox = (a, b) => {
    if (!a || !isFinite(a.minU)) return b;
    if (!b || !isFinite(b.minU)) return a;
    return { minU: Math.min(a.minU, b.minU), maxU: Math.max(a.maxU, b.maxU), minV: Math.min(a.minV, b.minV), maxV: Math.max(a.maxV, b.maxV) };
  };

  // ── CHOOSE YOUR WAY TO A PAGE (Stuart 2026-08-23) ────────────────────────────────────────
  // "we need to narrow the choices down as it is still erroring and really hard to look at all
  //  the choices … rod world, then setup, then projection, then arm."
  //
  // H1-138 pins 31 distinct arms; with projections and plate families that is seventy-odd sheets
  // in one flat dropdown. These are the SAME questions the pages were built from — every page
  // already carries the leaf it belongs to — so the controls are read back off the page list
  // rather than asked of the engine a second time. Cascading: each answer is measured among the
  // pages that survive the answers above it, so a question with one answer is not asked.
  const NARROW = [
    { key: 'rodKind', label: 'Rod' },
    { key: 'setup', label: 'Setup' },
    { key: 'drive', label: 'Drive' },
    { key: 'mount', label: 'Mount' },
    { key: 'proj', label: 'Projection', fmt: (v) => `${v}"` },
    { key: '__arm', label: 'Bracket arm' },
  ];
  const valueOf = (page, key) => (key === '__arm' ? (page.bracketPin?.partName || '') : page.answers?.[key]);
  const [narrow, setNarrow] = useState({});
  useEffect(() => { setNarrow({}); }, [pages]);

  // The questions, with their live values — and the pages that survive every answer.
  const { steps, shownPages } = React.useMemo(() => {
    const drawing = pages.filter(p => p.bracketPin);
    const extras = pages.filter(p => !p.bracketPin);   // catalog + wall mounts: always reachable
    let pool = drawing;
    const out = [];
    for (const ax of NARROW) {
      const values = [...new Set(pool.map(p => valueOf(p, ax.key)).filter(v => v !== undefined && v !== null && v !== ''))]
        .sort((a, b) => (typeof a === 'number' && typeof b === 'number') ? a - b : String(a).localeCompare(String(b)));
      if (values.length > 1) out.push({ ...ax, values });
      const picked = narrow[ax.key];
      // eslint-disable-next-line eqeqeq
      if (picked !== undefined && picked !== '' && values.some(v => String(v) === String(picked))) {
        pool = pool.filter(p => String(valueOf(p, ax.key)) === String(picked));
      }
    }
    return { steps: out, shownPages: [...pool, ...extras] };
  }, [pages, narrow]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPageIndex(0); }, [narrow]);

  // ---- build rows for a page (cached per bracket × family) ----
  const buildRows = useCallback((bracketPin, familyPins, opts = {}) => {
    const scene = sceneRef.current;
    const bracket = extractWorldMeshes(scene, [bracketPin.choiceNode]);
    if (!bracket.length) throw new Error(`Bracket node "${bracketPin.choiceNode}" not found in GLB.`);
    // ⚠ ONLY THE ROD THIS BRACKET HOLDS. nodesFor('POLE') is every pole cluster in the file;
    // allowedNodesFor is the engine's answer for THIS combination, so a double's rear rod stops
    // appearing on a single bracket's page. Null = no engine answer (untagged) → unchanged.
    const allowed = allowedNodesFor(bracketPin, opts.platePin || null);
    const keep = (list) => (allowed ? list.filter(n => allowed.has(String(n).toLowerCase())) : list);
    // ⚠ THE ROD IS THE ONE THIS PAGE HOLDS. Three fallbacks stood here — a POLE-cluster sweep, a
    // /pole|rod/ node-name search, and a library-classified guess over top-level nodes — each one
    // there because an untagged source could not say which rod an arm belonged to. rodForArm()
    // answered that when the page was built (a double pins a front rod and a back rod; the arm's
    // tier says which is its own), so the page carries the node list and nothing here guesses.
    // ⚠ THE ENGINE NAMES THE ROD; THE CLUSTER NAMES ITS GEOMETRY. A pin's node list comes from
    // `targetNode`, and for H1-138's pole that is not what the .glb calls the mesh — asking for
    // `S1-LONG-ROD--LEFT-HALF__1_H1138inPOLEleft1` found nothing and every page threw, leaving the
    // PREVIOUS page's drawing on screen under a red banner (which is why two different arms showed
    // the same picture). The cluster's node list is the one the scene answers to.
    //
    // So the engine still decides WHICH rod — `allowed` is its answer for this arm, and a double's
    // rear rod stays off a single's page — but the names handed to the GLB are the cluster's.
    const engineRod = (opts.rodNodes || []).filter(n => extractWorldMeshes(scene, [n]).length);
    const poleNodes = engineRod.length ? keep(engineRod) : keep(nodesFor('POLE'));
    const pole = poleNodes.length ? extractWorldMeshes(scene, poleNodes) : [];
    // ring CHOICES: the cluster can hold several ring options stacked in the model (BPR +
    // BR) — the composed views draw only the one actually hanging on the rod; every option
    // gets its own labeled detail image in the page corner.
    // ⚠ THE RINGS ARE THIS PAGE'S RINGS. Sweeping the RING category gave every ring the file
    // contains, at every diameter — the page then drew whichever happened to sit lowest. The
    // engine already answered "which rings fit this rod" when the page was built (slots() with the
    // rod selected), so the page carries them and this reads them.
    const ringPins = opts.ringPins || [];
    let ringChoices = ringPins
      .map(p => ({ partName: p.partName, meshes: extractWorldMeshes(scene, [p.choiceNode]) }))
      .filter(r => r.meshes.length);

    const plateChoices = familyPins || [];
    if (!pole.length) throw new Error(`No rod geometry for this page — the engine pairs the arm with ${(opts.rodNodes || []).join(', ') || 'no rod at all'}, and the POLE cluster carries ${nodesFor('POLE').length} node(s). Check the POLE pins in 1.6 / ⚖.`);
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
    // ── EVERY RING OPTION HANGS ON THE ROD (Stuart 2026-08-23) ──────────────────────────────
    // "you can add each ring there and show the measurement from the top of the rod to the bottom
    //  of the eye lit for each."
    //
    // The sheet used to pick ONE — the lowest option whose box wraps the pole — because the merged
    // model stacks every ring at the same station, so drawing them all drew them on top of each
    // other. They are not alternatives to be chosen between here; they are the choices this rod
    // offers, and the drop measurement is exactly what differs between them. So each one is parked
    // at its own station along the open rod instead.
    const ringDetails = ringChoices.map(rc => ({ ...rc, b: groupBbox(rc.meshes) }));
    // presentation: park the ring on OPEN rod PAST the plate/bracket edge (per row — wide
    // -H plates push it further out). A ring in front of the plate face reads as if it
    // aligned to the plate top instead of hanging from the rod; off to the side the ring
    // and its drop measurement are unambiguous (matches how the return pages read).
    // Park each ring on OPEN rod PAST the plate/bracket edge, one after another. A ring in front
    // of the plate face reads as if it aligned to the plate top instead of hanging from the rod;
    // out along the rod, each ring and its own drop measurement are unambiguous.
    // Returns [{ partName, meshes }] in the order they sit on the rod.
    const parkRings = (clearHalfM) => {
      if (!ringDetails.length) return [];
      const pb = axes.poleBox, bb = groupBbox(bracket);
      const ax = axes.poleAxis;
      const sign = Math.sign(pb.center[ax] - bb.center[ax]) || 1;
      let edge = bb.center[ax] + sign * (clearHalfM + 0.008);
      const out = [];
      for (const rc of ringDetails) {
        const rb = rc.b;
        const half = (rb.max[ax] - rb.min[ax]) / 2 + 0.002;
        let target = edge + sign * half;
        target = Math.min(Math.max(target, pb.min[ax] + half), pb.max[ax] - half);
        const d = [0, 0, 0];
        d[ax] = target - rb.center[ax];
        out.push({ partName: rc.partName, meshes: translateMeshes(rc.meshes, d) });
        // next station: past this ring, with a gap wide enough for its dimension label
        edge = target + sign * (half + 0.020);
      }
      return out;
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
    // ── THE CARRIER RIDES INSIDE THE TRACK, AND MUST STILL BE VISIBLE (Stuart 2026-08-23) ───
    // "traverse a sideview with the carrier inserted … just needs to be inserted into it."
    //
    // The GLB already has it in the right place — a carrier is a RIDER, so the configurator
    // renders it with the track and never asks about it. Adding its meshes to the composed group
    // would draw nothing, though: the depth raster is built from every mesh in that group, and a
    // carrier inside a closed extrusion is behind the track wall at every pixel.
    //
    // So it is rendered against ITS OWN depth buffer and the segments merged in — the track drawn
    // whole, the carrier drawn through it. That is the cutaway convention the reference sheets
    // use, and it is honest: nothing is moved, only un-occluded.
    const carrierMeshes = (opts.riderPins || [])
      .flatMap(rp => extractWorldMeshes(scene, [rp.choiceNode]))
      .filter(Boolean);
    const carrierView = carrierMeshes.length ? renderHiddenLine(carrierMeshes, views.front, 900) : null;
    // ⚠ THE CARRIERS DO NOT WIDEN THE WINDOW. A track carries them along its whole length, so
    // letting them vote on the rod break would open the view to the entire track and defeat it.
    // They are merged BEFORE the clip instead, so the ones inside the window are drawn and the
    // rest are cut with the track — which is what a broken view means.
    // Union of two rendered views: segments concatenated, bounds widened. Only the bounds are
    // read downstream (place/clip), so a merged view needs nothing from the depth raster.
    const withCarrier = (view) => (!carrierView ? view : {
      vis: [...view.vis, ...carrierView.vis],
      zb: {
        minU: Math.min(view.zb.minU, carrierView.zb.minU), maxU: Math.max(view.zb.maxU, carrierView.zb.maxU),
        minV: Math.min(view.zb.minV, carrierView.zb.minV), maxV: Math.max(view.zb.maxV, carrierView.zb.maxV),
      },
    });

    // Rod break: clip the front view to a window around plate/bracket/ring and mark the
    // cut — a full rod can't print at 1:1, and the hand-made sheets truncate it the same way.
    // ⚠ THE ELEVATION IS A WINDOW, AND THE WINDOW HAS A MAXIMUM (Stuart 2026-08-23: "lots of
    // dead white space, not matching my examples at all"). The window used to be whatever the
    // included boxes spanned, so one box reaching down the rod opened it to the whole pole — the
    // page then reduced to 41% to fit, drew a hairline rod across the sheet and left two thirds of
    // it empty. The hand-made sheets show a SHORT broken view: plate, arm, the rings, and a stub
    // of rod either side. So the window is capped, and anything past the cap is cut with a break
    // mark, which is what a broken view means.
    const WINDOW_MAX_M = 22 * 0.0254;   // ~22" — the widest the reference elevations run
    // The rod's centreline expressed in a given view's v axis — both the elevation and the
    // section contain the rod, so this is the one height they can agree on.
    const rodCentreV = (view) => { const b = viewBbox(pole, view); return (b.minV + b.maxV) / 2; };

    // ⚠ THE WINDOW IS ANCHORED ON THE MOUNTING, NOT ON THE LEFT (Stuart 2026-08-23: "the double
    // bracket is too far off to the right, so the backplates are out of the page view"). The cap
    // used to keep `lo` and cut `hi`, which silently assumes the wall is at the left of the view.
    // On a double it is not — the geometry runs the other way, so the cut took off the plates and
    // kept a length of empty rod. The plate and arm are what a reader lines up on, so they are
    // what the window is built around and the rod is what gets cut, whichever side it runs to.
    const clipFront = (front0, includeBoxes, mountBox = null) => {
      const poleFull = viewBbox(pole, views.front);
      let lo = Infinity, hi = -Infinity;
      for (const b of includeBoxes) {
        if (!b || !isFinite(b.minU)) continue;
        if (b.minU < lo) lo = b.minU;
        if (b.maxU > hi) hi = b.maxU;
      }
      if (!isFinite(lo) || !isFinite(hi)) { lo = poleFull.minU; hi = poleFull.maxU; }
      lo -= 0.015; hi += 0.018; // extra visible rod so the parked ring clearly hangs on it
      if (hi - lo > WINDOW_MAX_M) {
        const m = (mountBox && isFinite(mountBox.minU)) ? mountBox : null;
        const mountC = m ? (m.minU + m.maxU) / 2 : lo;
        // Which way does the rod run away from the mounting? That end is the one to cut.
        const runsRight = ((poleFull.minU + poleFull.maxU) / 2) >= mountC;
        if (runsRight) { lo = Math.min(lo, (m ? m.minU : lo) - 0.015); hi = lo + WINDOW_MAX_M; }
        else { hi = Math.max(hi, (m ? m.maxU : hi) + 0.018); lo = hi - WINDOW_MAX_M; }
      }
      const vis = clipSegmentsU(front0.vis, lo, hi);
      if (poleFull.minU < lo) vis.push(...breakMarks(lo + 0.004, poleFull.minV, poleFull.maxV));
      if (poleFull.maxU > hi) vis.push(...breakMarks(hi - 0.006, poleFull.minV, poleFull.maxV));
      return { view: { vis, zb: { ...front0.zb, minU: lo, maxU: hi } }, hi, poleFull };
    };
    // BASIC bracket / INSIDE MOUNT page: one row, choice + pole + ring only
    if (!plateChoices.length) {
      const rowRings = parkRings(bracketHalfAlong);
      const meshes = [...bracket, ...pole, ...rowRings.flatMap(r => r.meshes)];
      const front0 = withCarrier(renderHiddenLine(meshes, views.front, 1600));
      // ⚠ NO RINGS IN THE PROFILE. Every ring is parked at its own station ALONG the rod, and the
      // profile looks down that axis — so they all land on the same spot and draw on top of each
      // other (Stuart 2026-08-23: "rendering over laps"). The reference's profile column is the
      // arm's section; each ring's own end view is on the bottom strip.
      const profile = renderHiddenLine([...bracket, ...pole], views.profile, 900);
      const bracketF = viewBbox(bracket, views.front);
      const ringBoxes = rowRings.map(r => viewBbox(r.meshes, views.front));
      const { view: front, hi: frontHi, poleFull: poleF } = clipFront(front0, [bracketF, ...ringBoxes], bracketF);
      const dims = { front: [], profile: [], detail: [] };
      let measProjIn = null; // captured for the geometry-vs-cell check (IM has no projection)
      dims.front.push({ t: 'dia', u: frontHi - 0.008, v: poleF.maxV, in: (poleF.maxV - poleF.minV) * M2IN });
      // one drop dim per ring option: top of rod → bottom of that ring's eyelet
      ringBoxes.forEach(rb => dims.front.push({ t: 'v', u: rb.maxU, v0: poleF.maxV, v1: rb.minV, off: 18, ldy: 26, in: (poleF.maxV - rb.minV) * M2IN }));
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
        // end-view ring Ø, from the first ring on the rod — OD only, since the eyelet hangs
        // below and would inflate it. Every option's own Ø is on the bottom strip.
        const endRing = rowRings[0]?.meshes || [];
        if (endRing.length) {
          const ringBody = endRing.filter(m => !/eyelet/i.test(m.name + m.path));
          const rP = viewBbox(ringBody.length ? ringBody : endRing, views.profile);
          dims.profile.push({ t: 'dia', u: rP.maxU - (rP.maxU - rP.minU) * 0.15, v: rP.maxV - (rP.maxV - rP.minV) * 0.15, in: (rP.maxV - rP.minV) * M2IN });
        }
      } else {
        const wallPt = [0, 0, 0]; wallPt[axes.projAxis] = axes.wallCoord;
        const wallU = projPoint(views.profile, wallPt)[0];
        const poleU = projPoint(views.profile, axes.poleCenter)[0];
        const profTopV = viewBbox(meshes, views.profile).maxV;
        measProjIn = Math.abs(poleU - wallU) * M2IN;
        dims.profile.push({ t: 'h', u0: Math.min(wallU, poleU), u1: Math.max(wallU, poleU), v: profTopV, off: -8, in: measProjIn });
      }
      // The rod centreline in each view — the row's shared datum, so the section reads across
      // from the elevation instead of each cell floating on its own extents.
      const datum = { front: (poleF.minV + poleF.maxV) / 2, profile: rodCentreV(views.profile) };
      return { rows: [{ rowKey: bracketPin.partName, partName: bracketPin.partName, wallCode: '', front, profile, detail: null, dims, datum, hasAsMounted: false }], axes, ringItems, measured: { poleDiaIn: (poleF.maxV - poleF.minV) * M2IN, projIn: measProjIn } };
    }
    let measured = null; // first row's pole Ø + projection, for the geometry-vs-cell check
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
      const wallCodeMatch = (wallPlate[0] ? (wallPlate[0].path + '/' + wallPlate[0].name) : '').match(WALL_CODE_RX);
      const wallCode = wallCodeMatch ? wallCodeMatch[0].toUpperCase().replace(/\s*\/?\s*P$/, '/P') : (wallPlate.length ? 'WALL PLATE' : '');
      // park the ring past THIS row's plate edge — wide -H plates push it further out
      const plateHalfAlong = (cb0.max[axes.poleAxis] - cb0.min[axes.poleAxis]) / 2;
      const rowRings = parkRings(Math.max(plateHalfAlong, bracketHalfAlong));
      const meshes = [...bracket, ...plateAll, ...pole, ...rowRings.flatMap(r => r.meshes)];
      const front0 = withCarrier(renderHiddenLine(meshes, views.front, 1600));
      // Rings excluded — see the note on the basic row: they stack in this view.
      const profile = renderHiddenLine([...bracket, ...plateAll, ...pole], views.profile, 900);
      const detail = wallPlate.length ? renderHiddenLine(wallPlate, views.front, 300) : null;
      // measures in view space
      const coverF = viewBbox(cover.length ? cover : plateAll, views.front);
      const bracketF = viewBbox(bracket, views.front);
      const ringBoxes = rowRings.map(r => viewBbox(r.meshes, views.front));
      const ringF = ringBoxes[0] || null;
      const coverP = viewBbox(cover.length ? cover : plateAll, views.profile);
      const wallF = wallPlate.length ? viewBbox(wallPlate, views.front) : null;
      const { view: front, hi: frontHi, poleFull: poleF } = clipFront(front0, [coverF, bracketF, ...ringBoxes], unionBox(coverF, bracketF));
      const isRound = /-R$/i.test(platePin.partName || '');
      const dims = { front: [], profile: [], detail: [] };
      const plateWIn = (coverF.maxU - coverF.minU) * M2IN;
      // round plate: Ø leader off the circle's upper-LEFT arc (clear of the pole Ø leader)
      // plate width BELOW the plate — above it the rod crosses the dim on short plates
      if (isRound) dims.front.push({ t: 'dia', u: coverF.minU + (coverF.maxU - coverF.minU) * 0.15, v: coverF.maxV - (coverF.maxV - coverF.minV) * 0.15, dir: -1, in: plateWIn });
      else dims.front.push({ t: 'h', u0: coverF.minU, u1: coverF.maxU, v: coverF.minV, off: 16, in: plateWIn });
      dims.front.push({ t: 'dia', u: frontHi - 0.008, v: poleF.maxV, in: (poleF.maxV - poleF.minV) * M2IN });
      if (ringF) {
        // ring drop: TOP OF ROD → bottom of the eyelet (Stuart's definition), for EVERY ring
        // option on the rod — that measurement is the thing that differs between them. Label
        // drops ~1/4" printed so the text clears the underside of the pole.
        ringBoxes.forEach(rb => dims.front.push({ t: 'v', u: rb.maxU, v0: poleF.maxV, v1: rb.minV, off: 18, ldy: 26, in: (poleF.maxV - rb.minV) * M2IN }));
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
      if (!measured) measured = { poleDiaIn: (poleF.maxV - poleF.minV) * M2IN, projIn: Math.abs(poleU - wallU) * M2IN };
      dims.profile.push({ t: 'h', u0: Math.min(wallU, poleU), u1: Math.max(wallU, poleU), v: profTopV, off: -8, in: Math.abs(poleU - wallU) * M2IN });
      // plate height: line + label in the empty space LEFT of the plate (wall side), off the artwork
      dims.profile.push({ t: 'v', u: coverP.minU, v0: coverP.maxV, v1: coverP.minV, off: -12, side: -1, in: (coverP.maxV - coverP.minV) * M2IN, dia: isRound });
      if (wallF && detail) {
        dims.detail.push({ t: 'h', u0: wallF.minU, u1: wallF.maxU, v: wallF.maxV, off: -12, in: (wallF.maxU - wallF.minU) * M2IN });
        dims.detail.push({ t: 'v', u: wallF.maxU, v0: wallF.maxV, v1: wallF.minV, off: 12, in: (wallF.maxV - wallF.minV) * M2IN });
      }
      const datum = { front: (poleF.minV + poleF.maxV) / 2, profile: rodCentreV(views.profile) };
      return { rowKey: platePin.partName, partName: platePin.partName, wallCode, front, profile, detail, dims, datum, hasAsMounted: ringF && parseInches(wallCfg[wallCode]?.topHole) != null };
    }).filter(r => !r.missing);
    return { rows, axes, ringItems, measured };
  }, [allowedNodesFor, wallCfg, nodesFor]);

  // ---- wall-mounts reference page: every unique wall-mount style at 1:1 ----
  const buildWallMounts = useCallback(() => {
    if (wallMountsRef.current) return wallMountsRef.current;
    const scene = sceneRef.current;
    const poleNodes = nodesFor('POLE');
    const pole = poleNodes.length ? extractWorldMeshes(scene, poleNodes) : [];
    const seen = new Map();
    // Every plate the SHEET actually draws, across its pages — so a wall mount that no page uses
    // is not on the reference either.
    const seenPin = new Set();
    const allPlatePins = pages.flatMap(pg => pg.familyPins || []).filter(pn => {
      const k = String(pn.choiceNode || '');
      if (!k || seenPin.has(k)) return false;
      seenPin.add(k); return true;
    });
    for (const p of allPlatePins) {
      const meshes = extractWorldMeshes(scene, [p.choiceNode]).filter(m => WALL_PLATE_MATCH.test(m.name + m.path));
      if (!meshes.length) continue;
      const codeM = (meshes[0].path + '/' + meshes[0].name).match(WALL_CODE_RX);
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
  }, [pages, nodesFor, wallCfg]);

  // ---- catalog page: the finials + accessories this leaf offers, at 1:1, L × Ø dims ----
  const buildCatalog = useCallback((itemPins = []) => {
    const cacheKey = itemPins.map(p => p.choiceNode).join('|');
    if (finialsRef.current?.key === cacheKey) return finialsRef.current.items;
    const scene = sceneRef.current;
    const poleNodes = nodesFor('POLE');
    const pole = poleNodes.length ? extractWorldMeshes(scene, poleNodes) : [];
    const items = [];
    let views = null;
    for (const p of itemPins) {
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
    finialsRef.current = { key: cacheKey, items };
    return items;
  }, [nodesFor]);

  const composeCatalogPage = useCallback((page) => buildItemsGridPage({
    title: `${baseAssembly?.itemName || baseAssembly?.itemId} — Finials & accessories${page?.family ? ` · ${page.family}` : ''}`,
    subtitle: 'Every end treatment and accessory this configuration offers, at actual size. Socket depth is hidden geometry — add it with the manual dim tool.',
    items: buildCatalog(page?.itemPins || []).map(f => ({ code: rowCode(f.partName), view: f.view, wIn: f.wIn, hIn: f.hIn })),
    paper: layoutPaper,
    footerNote: reducedNote,
    perRowOverride: layoutPaper === 'tabloid' ? 5 : 4,
  }), [buildCatalog, rowCode, layoutPaper, reducedNote, baseAssembly?.itemName, baseAssembly?.itemId]);

  const composeWallMountsPage = useCallback(() => buildWallMountsPage({
    title: `${baseAssembly?.itemName || baseAssembly?.itemId} — Wall mounts`,
    items: buildWallMounts(),
    noteLines: ['Top-hole offsets come from the Wall mounts panel and drive the as-mounted dims.'],
    paper: layoutPaper,
    footerNote: reducedNote,
  }), [buildWallMounts, layoutPaper, reducedNote, baseAssembly?.itemName, baseAssembly?.itemId]);

  // ---- compose current page ----
  useEffect(() => {
    if (!shownPages.length || error) return;
    const page = shownPages[Math.min(pageIndex, shownPages.length - 1)];
    setStatus('Rendering…');
    const t = setTimeout(() => {
      try {
        if (page.kind === 'WALLMOUNTS') { setPageData(composeWallMountsPage()); setStatus(''); return; }
        if (page.kind === 'CATALOG') { setPageData(composeCatalogPage(page)); setStatus(''); return; }
        let built = rowCacheRef.current[page.key];
        if (!built) {
          built = buildRows(page.bracketPin, page.familyPins, { isIM: page.isIM, ringPins: page.ringPins, riderPins: page.riderPins, rodNodes: page.rodNodes });
          rowCacheRef.current[page.key] = built;
        }
        // GEOMETRY vs CELL (playbook 4.2, warn-only): the measured pole Ø / projection must agree
        // with what the selected dia×proj cell CLAIMS (sizeMatrix inches). The sheet still renders
        // — borrowing geometry is sometimes deliberate — but it stops doing so silently. This was
        // the most likely silent failure of the H1 mass load (a ¾" file registered under 1-3/8").
                const rows = built.rows.map(r => ({ ...r, code: rowCode(r.partName) }));
        const anyAsMounted = rows.some(r => r.hasAsMounted);
        const bSized = page.bracketPin.partName;
        const titleCode = edition === 'FAB' ? (fabCodeFor(bSized) || bSized) : bSized;
        // The subtitle says what this page IS: the CPQ leaf it belongs to, and how many plates the
        // engine paired with the arm — or, when there are none, the engine's own reason.
        const nPlates = (page.familyPins || []).length;
        const famLabel = [page.family, page.plateFamily, nPlates ? `${nPlates} plate${nPlates === 1 ? '' : 's'}` : (page.reason || 'drawn alone')]
          .filter(Boolean).join(' · ');
        const result = buildPageSvg({
          title: `${baseAssembly.itemName || baseAssembly.itemId} — ${titleCode}`,
          subtitle: `${edition === 'FAB' ? 'Fabricut edition' : 'H1 edition'} · ${famLabel}`,
          rows,
          manualDims: manualDims.filter(d => d.pageKey === page.key),
          noteLines: [
            ...(anyAsMounted ? [AS_MOUNTED_NOTE] : []),
            'Ring dim = top of rod to bottom of eyelet. Profile horizontal dim = wall face to pole centerline.',
            'Measured from 3D geometry, nearest 1/16". Manual dims entered where geometry cannot provide them.',
          ],
          paper: layoutPaper,
          footerNote: reducedNote,
          // Each ring on its own, side view, along the bottom of the sheet.
          bottomItems: (built.ringItems || []).map(r => ({ code: rowCode(r.partName), view: r.view, odIn: r.odIn, hIn: r.hIn })),
        });
        setPageData(result);
        setStatus('');
      } catch (e) {
        // ⚠ CLEAR THE DRAWING. A throw used to leave the PREVIOUS page's SVG on screen under a red
        // banner, so two different arms showed the same picture and the error read as cosmetic.
        // One bad page is now visibly one bad page, and the rest of the set stays usable.
        console.error('SpecSheet render failed', e);
        setPageData(null);
        setError(`${page.title}: ${e?.message || String(e)}`);
        setStatus('');
      }
    }, 30);
    return () => clearTimeout(t);
  }, [shownPages, pageIndex, edition, manualDims, wallCfg, buildRows, rowCode, fabCodeFor, assembly, error, layoutPaper, reducedNote, composeWallMountsPage, composeCatalogPage, baseAssembly]);

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
    const page = shownPages[Math.min(pageIndex, shownPages.length - 1)];
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
  // Prints what you are looking at — the narrowed set, not all seventy.
  const buildAllPages = () => shownPages.map((page) => {
    try {
    if (page.kind === 'WALLMOUNTS') return composeWallMountsPage().svg;
    if (page.kind === 'CATALOG') return composeCatalogPage(page).svg;
    let built = rowCacheRef.current[page.key];
    if (!built) { built = buildRows(page.bracketPin, page.familyPins, { isIM: page.isIM, ringPins: page.ringPins, riderPins: page.riderPins, rodNodes: page.rodNodes }); rowCacheRef.current[page.key] = built; }
    const rows = built.rows.map(r => ({ ...r, code: rowCode(r.partName) }));
    const bSized = page.bracketPin.partName;
    const titleCode = edition === 'FAB' ? (fabCodeFor(bSized) || bSized) : bSized;
    // The subtitle says what this page IS: the CPQ leaf it belongs to, and how many plates the
    // engine paired with the arm — or, when there are none, the engine's own reason.
    const nPlates = (page.familyPins || []).length;
    const famLabel = [page.family, page.plateFamily, nPlates ? `${nPlates} plate${nPlates === 1 ? '' : 's'}` : (page.reason || 'drawn alone')]
      .filter(Boolean).join(' · ');
    return buildPageSvg({
      title: `${baseAssembly.itemName || baseAssembly.itemId} — ${titleCode}`,
      subtitle: `${edition === 'FAB' ? 'Fabricut edition' : 'H1 edition'} · ${famLabel}`,
      rows,
      manualDims: manualDims.filter(d => d.pageKey === page.key),
      noteLines: [
        ...(rows.some(r => r.hasAsMounted) ? [AS_MOUNTED_NOTE] : []),
        'Ring dim = top of rod to bottom of eyelet. Profile horizontal dim = wall face to pole centerline.',
      ],
      paper: layoutPaper,
      footerNote: reducedNote,
      bottomItems: (built.ringItems || []).map(r => ({ code: rowCode(r.partName), view: r.view, odIn: r.odIn, hIn: r.hIn })),
    }).svg;
    } catch (e) {
      // One page that cannot draw does not cost you the other sixty-nine.
      console.error('SpecSheet page skipped', page.key, e);
      return null;
    }
  }).filter(Boolean);

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
          <strong style={{ fontSize: '0.95rem' }}>Spec Sheet — {baseAssembly?.itemName || baseAssembly?.itemId}</strong>
          {/* The CPQ's own questions, cascading — choose your way to a sheet rather than
              scrolling seventy. Read back off the page list, so they cannot disagree with it. */}
          {steps.map(ax => (
            <select key={ax.key} value={narrow[ax.key] ?? ''} title={ax.label}
              onChange={e => setNarrow(n => {
                const next = { ...n, [ax.key]: e.target.value };
                // answering higher up invalidates what was chosen below it
                const from = NARROW.findIndex(a => a.key === ax.key);
                NARROW.slice(from + 1).forEach(a => { delete next[a.key]; });
                if (!e.target.value) delete next[ax.key];
                return next;
              })}
              style={{ padding: '5px', fontSize: '0.8rem', maxWidth: '170px' }}>
              <option value="">{ax.label}: all</option>
              {ax.values.map(v => <option key={String(v)} value={String(v)}>{ax.fmt ? ax.fmt(v) : String(v)}</option>)}
            </select>
          ))}
          <select value={pageIndex} onChange={e => setPageIndex(+e.target.value)} style={{ padding: '5px', fontSize: '0.8rem', maxWidth: '360px' }}>
            {shownPages.map((p, i) => <option key={p.key} value={i}>{p.title}</option>)}
          </select>
          <span style={{ fontSize: '0.72rem', color: '#666' }}>{shownPages.length} of {pages.length} sheets</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button style={edition === 'H1' ? btnOn : btn} onClick={() => setEdition('H1')}>H1 codes</button>
            <button style={edition === 'FAB' ? btnOn : btn} onClick={() => setEdition('FAB')}>Fabricut codes</button>
          </div>
          <div style={{ display: 'flex', gap: '4px' }} title="1:1 = actual size on 11×17 · Reduced = the same master printed on 8.5×11 (~64%; dimensions still read true)">
            <button style={paperMode === 'tab11' ? btnOn : btn} onClick={() => setPaperMode('tab11')}>1:1 · 11×17</button>
            <button style={paperMode === 'letterReduced' ? btnOn : btn} onClick={() => setPaperMode('letterReduced')}>Reduced · 8.5×11</button>

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
          {error ? <span style={{ color: '#b00020' }}>⚠ {error}</span>
            : status ? status
            : dimTool ? 'Manual dim: click two points on a drawing, then enter the value.'
            : (assembly && !assembly.manufacturingSpecs?.specCadUrl) ? <span style={{ color: '#8a6d1a' }}>📐 Drawing from the merged sales model — every option is in it, stacked, so pages can misdraw. For clean sheets upload this assembly's "Spec Sheet Layout (📐)" in 1.6 (the Fusion Import "Spec · true m" export).</span>
            : ''}
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
