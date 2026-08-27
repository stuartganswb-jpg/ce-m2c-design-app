// SpecSheetModal.js — Fabricut-style specification sheet generator. Renders the assembly's
// working GLB (manufacturingSpecs.cadUrl) as CAD-style hidden-line drawings: one page per
// bracket choice, one row per backplate choice, columns = wall-mount detail | front view |
// code | profile view. Dimensions auto-measure from geometry; what geometry can't give
// (hole spacing, ring height from top hole) is drawn with the manual dimension tool and
// saved to the assembly doc (specSheetOverrides). Wall-mount styles carry bulk-entered
// dims in system/spec_sheet_config. Editions: H1 (internal) or Fabricut customer codes.
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { specPages, auditPages } from './specSheetPages';
import { choicesFromAssembly } from '../Shared/hardwareAdapter';
import { resolve as resolveHardware, parseProjTiers, companionsFor } from '../Shared/hardwareModel';
import { openSpecSheetPrint, downloadSpecSheetPdf } from './specSheetOutput';

// Wall-mount plate meshes are children of each backplate choice node in the merged GLB
// (item codes like H1-CPWP2/P, H2-75CPWP1/P — any family). Fragment match: the classic
// H1 trios plus the generic "WP<digit>" token so new collections work without edits here.
// Room a dropped caption needs under the artwork, in page units — the label's own height plus a
// little air. Kept beside the offsets that place them so the two cannot drift apart.
const FS_LABEL_ROOM = 14;
// Ring/plate codes hang this far below the artwork — Stuart 2026-08-23: "the ring id's can be
// lower with a pencil line from the id to the [ring] as they overlap". The codes are TEXT, which
// does not shrink with the page scale, so on any reduced sheet neighbouring ids collide whatever
// the geometric spread is. Alternate ids drop one line further (their leaders already bridge the
// gap), which is his own fix, re-applied now that each id is centred under its own ring.
// 34 → 48 (Stuart 2026-08-27: "space everything out so it is clearly legible"): the ring DROP
// measurement now sits under its own measure line (dim `below`), so the codes start a clear lane
// further down instead of sharing the band with the numbers.
const RING_LABEL_DROP = 48;
// Three levels, not two (Stuart 2026-08-23b: "please stagger further as the text is
// overlapping") — with two, alternate ids sat one thin line apart and long codes still touched.
// On three levels a code's same-level neighbour is three ring pitches away.
const RING_LABEL_STAGGER = 14;
const RING_LABEL_LEVELS = 3;
const WALL_PLATE_MATCH = /(CPWP|BPWP|IMWP|WP\d)/i;
// Full wall-plate code inside a mesh path — family-agnostic (was hardcoded H1-).
const WALL_CODE_RX = /[A-Z]+\d*-[A-Z0-9]*WP\d+(\s*\/?\s*P)?/i;
const SCREW_MATCH = /screw/i;

const AS_MOUNTED_NOTE = 'As-mounted dim marks the height from the center of the top hole of the wall mount to the bottom of the ring.';
// The one drawing-convention note, Stuart's own wording (2026-08-23b) — the 'Measured from 3D
// geometry' line is gone at his ask.
const RING_NOTE = 'Ring dimension shown is drop from top of the rod to the bottom of the eyelet. Profile view displays wall projection = wall face to pole centerline, and vertical height of bracket at wall mounting.';

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

  const [edition, setEdition] = useState('H1'); // 'H1' | 'FAB' | 'CUST'
  // ── THE CUSTOMER'S OWN PART #s (Stuart 2026-08-27: "add the ability to print this with
  // customers part# rather than ours as an option at the top") ─────────────────────────────────
  // Same idea as the Fabricut edition, generalized: pick a customer and every code on the sheet
  // becomes THEIR number. The numbers come from the items' own clientPricing rows ("Their SKU" in
  // 4.6) — no extra load, and a part the customer has no SKU for falls back to our number rather
  // than printing a hole.
  const [custKey, setCustKey] = useState('');
  // ── ONE MASTER, TWO PAPERS (Stuart 2026-08-23) ───────────────────────────────────────────
  // "i am ok having it scale 1:1 at 11 x17 as long as the page formats to print well at the
  //  reduced 8.5x11 … the call out measurements show the true dim's so that is fine."
  //
  // So there is ONE layout — the 11×17 master, drawn at true 1:1 — and a choice of what to print
  // it on. The third mode ('fit', a compact letter layout with its own scale rules) is gone: it
  // was where the column-scale defect lived, and a second layout that reads differently from the
  // master is a second thing to be wrong.
  // ── THE PAPER IS THE BINDER'S (Stuart 2026-08-23) ────────────────────────────────────────
  // "let's lose the 11x17 format, not needed go with 8.5x11 standard should be portrait,
  //  landscape only for long doubles as is now." The 11×17 master and its reduced-print mode are
  // gone: the sheets live in an 8.5×11 catalog binder, so letter IS the master and the footer's
  // % is honest against the page that prints. 'auto' follows the page — a double stands up two
  // rods and its section is the projection deep, so it is a WIDE drawing and turns landscape;
  // everything else is portrait. Clicking an orientation overrides the page you are looking at;
  // moving to another page returns to auto. layoutPaper is derived below, after the page list.
  const [paperMode, setPaperMode] = useState('auto'); // 'auto' | 'P' | 'L'
  const reducedNote = null; // letter is the master now — nothing is a reduced print of anything
  // The scene is loaded ONCE and counted, not described. What a page contains is the engine's
  // answer (specSheetPages), which needs pins and tags — not geometry — so the two no longer
  // have to agree about anything.
  // Which hand the sheet draws. The reference sheets are all left-hand views; the right is the
  // mirror, and drawing both is drawing the same thing twice.
  const [side, setSide] = useState('LEFT');
  const [sceneReady, setSceneReady] = useState(0);
  // Parts drawn on a page the engine would not offer there — always empty if everything is right.
  const [bleed, setBleed] = useState([]);
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

  // ── ONE SIDE IS THE WHOLE DRAWING (Stuart 2026-08-23) ────────────────────────────────────
  // "we only need to look at one side, either left side or right side, not all 3 as left and
  //  right are mirrors of each other … if we just look at one side and if we respect the single,
  //  double, and projection options along with the front and back/rear placements everything we
  //  need is there."
  //
  // He is right, and it makes a per-assembly spec GLB unnecessary. A merged sales model holds
  // every option stacked — but stacked ACROSS THE SIDES as much as anything else, and the two
  // sides are mirrors, so half the pile is a duplicate of the other half. Take one side and what
  // remains is separated by tags the engine already reads: setup, projection, and tier.
  //
  // The rule is a FILTER, never a preference. The old nodesFor() kept only LEFT clusters when any
  // existed, which silently dropped CENTER — and six of H1-138's arms are pinned CENTER only (the
  // passing brackets H1-138PS / PE / P6 and the ILP trio), so their rod resolved to nothing and
  // every one of those pages threw. CENTRE and SHARED belong to both sides; only the far side is
  // excluded.
  const sideNodesFor = useCallback((cat) => {
    const far = side === 'LEFT' ? 'RIGHT' : 'LEFT';
    return clusters
      .filter(c => c.cat === cat && !c.hidden && (c.nodes || []).length && (c.pos || '') !== far)
      .flatMap(c => c.nodes || []);
  }, [clusters, side]);

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

  // Every customer identity that appears on any loaded item's clientPricing rows — the picker's
  // options. The key is whatever 4.6 stamped (a CRM id or a company name); it matches the same way.
  const custOptions = useMemo(() => {
    const seen = new Map();
    for (const p of libraryParts || []) {
      for (const r of (Array.isArray(p.clientPricing) ? p.clientPricing : [])) {
        const k = String(r?.customerId || '').trim();
        if (k && !seen.has(k.toUpperCase())) seen.set(k.toUpperCase(), k);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [libraryParts]);

  const custCodeFor = useCallback((partName) => {
    if (!custKey) return null;
    const part = (libraryParts || []).find(p => p.legacyErpId === partName || p.itemId === partName || p.id === partName);
    const row = (Array.isArray(part?.clientPricing) ? part.clientPricing : [])
      .find(r => String(r?.customerId || '').trim().toUpperCase() === custKey.toUpperCase());
    const sku = String(row?.clientSku || '').trim();
    return sku || null;
  }, [libraryParts, custKey]);

  const rowCode = useCallback((partName) => {
    if (edition === 'FAB') return fabCodeFor(partName) || `${partName} (no Fabricut code)`;
    if (edition === 'CUST') return custCodeFor(partName) || partName;   // no SKU → our number, never a hole
    return partName;
  }, [edition, fabCodeFor, custCodeFor]);

  // What the subtitle calls this printing — the reader must know whose numbers they hold.
  const editionLabel = edition === 'FAB' ? 'Fabricut edition'
    : edition === 'CUST' ? `${custKey || 'customer'} part numbers` : 'H1 edition';

  // ── EVERY PRINTED CODE FOLLOWS THE EDITION (Stuart 2026-08-27: "the fabricut codes print on
  // the right but not for the items on the left") ─────────────────────────────────────────────
  // The row builder bakes ring ids, plate ids and the wall-mount code into the drawing as text
  // dims — in OUR numbers, and cached that way (the cache must stay edition-blind or switching
  // editions rebuilds every drawing). So the codes are translated at COMPOSE time instead: text
  // dims flagged `code: true` and the row's wallCode run through the edition here. Soft fallback
  // on purpose — a small in-drawing label has no room for "(no Fabricut code)".
  const labelCodeFor = useCallback((name) => {
    if (edition === 'FAB') return fabCodeFor(name) || name;
    if (edition === 'CUST') return custCodeFor(name) || name;
    return name;
  }, [edition, fabCodeFor, custCodeFor]);
  const editionRows = useCallback((builtRows, armName) => builtRows.map(r => ({
    ...r,
    code: rowCode(r.partName),
    armCode: rowCode(r.__arm || armName),
    ...(r.wallCode ? { wallCode: labelCodeFor(r.wallCode) } : {}),
    dims: Object.fromEntries(Object.entries(r.dims || {}).map(([k, list]) => [k,
      (list || []).map(d => (d.t === 'text' && d.code) ? { ...d, text: labelCodeFor(d.text) } : d)])),
  })), [rowCode, labelCodeFor]);

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
  // ⚠ MATCH THE PIN BY ITS NODE, NOT BY ITS PART CODE (Stuart 2026-08-23: "the inline brackets
  // are pulling the wrong backplates they need to use the ones tagged inline").
  //
  // H1-138 pins the SAME CODE in more than one pool: H1-138BP-R exists as a plain plate AND as an
  // in-line plate, at every projection, on every side — different pins, different slot nodes,
  // different tags, different positions in the model, one code. Looking the pin up by partId
  // therefore returned whichever copy came first, so an in-line arm drew the PLAIN plate's
  // geometry at the PLAIN plate's position while the row label read correctly. The page list was
  // right the whole time; this lookup was throwing the distinction away.
  //
  // The engine's choice already names its own node — that IS the pin, with nothing to resolve.
  // Code matching survives only as a fallback for a choice carrying no node at all.
  const pinForChoice = useCallback((choice, { sideFirst = false, centerFirst = false } = {}) => {
    if (!choice) return null;
    const usable = (pins || []).filter(p => p.choiceNode && !p.isHiddenPart);
    const want = String(choice.partId || '').trim().toUpperCase();
    const same = usable.filter(p => String(p.partId || '').trim().toUpperCase() === want);
    const posOf = (p) => clusterById[p.clusterId]?.pos || '';
    // ⚠ NAME IT BY OUR PATTERN ID (Stuart 2026-08-23b: "pull the actual erp item id for these
    // bends not the node name"). A pin's partName is sometimes the node it was built from — an
    // artefact of the .fbx that means nothing to anyone reading a sheet. The Legacy ERP ID field
    // is the item number, so it leads wherever it is filled; partName remains the fallback.
    const named = (p) => ({ ...p, partName: p.legacyErpId || p.feeItemNo || p.partName || choice.name || choice.partId });
    // ⚠ THE ROD IS THE ONE EXCEPTION. The sheet draws one hand, and a three-piece pole is pinned
    // per side — so whichever SEGMENT the engine happened to name must not decide which way the
    // rod runs on the page (Stuart: "for some reason these brackets the pole went off to the left
    // rather than the right, keep them all the same"). Everything else takes the engine's node.
    // ⚠ …BUT THE SIDE SWAP STAYS ON THE SAME ROD. H1-138R is the front rod AND the dec double's
    // back rod — same part number, different pins, different tiers, different cuts — so preferring
    // "any pin of this part on the drawn side" resolved the BACK rod choice to the FRONT rod's
    // left segment, and the D page drew one pole twice. The pin pool is narrowed to the choice's
    // own tier and cut first (kept only where it leaves something, so untagged collections are
    // untouched); the side preference then picks among segments of the RIGHT rod.
    if (sideFirst) {
      const narrowPins = (pool, pred) => { const n = pool.filter(pred); return n.length ? n : pool; };
      const ct = String(choice.tier || '').toUpperCase();
      const cut = JSON.stringify(choice.projTiers || null);
      let like = same;
      if (ct) like = narrowPins(like, p => String(p.tier || '').toUpperCase() === ct);
      like = narrowPins(like, p => JSON.stringify(
        Object.keys(parseProjTiers(p.projInches || '')).length ? parseProjTiers(p.projInches || '') : null) === cut);
      // ⚠ RTN-ONLY IS PART OF THE PIN'S IDENTITY TOO (Stuart 2026-08-24b: "the rear rod goes
      // thru the return rod and sticks out the other side — the correct rod in the 1.6 file is
      // tagged rtn-only and double back"). The short return rear pole shares part, tier AND cut
      // with the long dec rear pole — only the flag separates them, so the side-swap narrows on
      // it in both directions, exactly as it narrows on tier and cut.
      like = narrowPins(like, p => !!p.returnOnly === !!choice.returnOnly);
      // ⚠ A RETURN'S ROD IS THE CENTRE SEGMENT (Stuart 2026-08-23b: "you have the miter and the
      // french return on one sheet together merged into each other"). The subject of a return
      // page IS a length of pole with the bend or miter on its end — drawing the drawn side's
      // rod segment on top of it drew the straight rod THROUGH the bend, and the overlap read
      // as both shapes merged. The configurator agrees: a chosen return replaces that end's rod
      // segment (segmentShows: answered && !isReturn). So a return page's rod leads from the
      // CENTRE, and the bend carries its own pole.
      const order = centerFirst ? ['CENTER', side, 'SHARED'] : [side, 'CENTER', 'SHARED'];
      const onSide = order.map(pos => like.find(p => posOf(p) === pos)).find(Boolean);
      if (onSide) return named(onSide);
    }
    const wanted = new Set((choice.nodes || []).map(n => String(n).toLowerCase()));
    const exact = usable.find(p => wanted.has(String(p.choiceNode || '').toLowerCase())
      || wanted.has(String(p.targetNode || '').toLowerCase()));
    if (exact) return named(exact);
    const at = (pos) => same.find(p => (posOf(p) || side) === pos);
    const pin = at(side) || at('CENTER') || at('SHARED') || at('') || same[0]
      || usable.find(p => String(p.id || p.choiceNode || '') === String(choice.id));
    return pin ? named(pin) : null;
  }, [pins, clusterById, side]);

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
        // The CHOICE rides along with its pin: the collar pairing (requiresCollar) is a fact on
        // the choice, and the catalog needs it to draw a two-part acrylic finial whole.
        // Finials ONLY — the accessories (carrier strips, standoffs) threw off the finial scale
        // and are gone from these pages (Stuart 2026-08-23b).
        const items = (p.finials || [])
          .map(c => ({ choice: c, pin: pinForChoice(c) })).filter(x => x.pin);
        if (items.length) pageList.push({ key: p.key, kind: 'CATALOG', title: `❖ Finials${p.label ? ` · ${p.label}` : ''}`, itemPins: items, family: p.label });
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
        title: `${bracketPin.partName}${p.plateFamily ? ` + ${p.plateFamily}` : ''}${p.label ? ` · ${p.label}` : ''}${p.part ? ` · sheet ${p.part}` : ''}${p.plates.length ? '' : ' (draws alone)'}`,
        bracketPin, familyPins, ringPins, riderPins, plateFamily: p.plateFamily || '',
        // Every pole this configuration stands up, each taken on the drawn side — one on a
        // single, front and back on a double.
        rodNodes: (() => {
          const set = (p.rods && p.rods.length ? p.rods : [p.rod]).filter(Boolean);
          // A return page's rod leads from the CENTRE segment — the bend IS that end's rod.
          const nodes = set.map(r => pinForChoice(r, { sideFirst: true, centerFirst: p.kind === 'RETURN' })?.choiceNode).filter(Boolean);
          return nodes.length ? [...new Set(nodes)] : (p.rod?.nodes || []);
        })(),
        // ⚠ THE PROJECTION OF A DOUBLE IS PER TIER. A double's tag is not a number but a map —
        // "FRONT: 6.5, BACK: 3.25" — and the plate's depth is measured from the pole THIS arm
        // holds, so it is that tier's figure. Reading the axis answer alone gives a double no
        // projection at all, which is why its plate never moved.
        projTiers: (p.subject?.projTiers || p.rod?.projTiers || null),
        projIn: (() => {
          const direct = Number(p.answers?.proj);
          if (isFinite(direct) && direct > 0) return direct;
          const tiers = p.subject?.projTiers || p.rod?.projTiers || null;
          if (!tiers) return null;
          const tier = String(p.rod?.tier || p.subject?.tier || '').toUpperCase();
          const v = Number(tiers[tier] ?? Object.values(tiers)[0]);
          return isFinite(v) && v > 0 ? v : null;
        })(),
        isTraverse: p.isTraverse,
        isIM: p.kind === 'INSIDE_MOUNT',
        mount: String(p.answers?.mount || '').toUpperCase(),
        family: p.label,
        reason: p.reason || '',
        // Pairing facts for the basics rule below — tags, never code sniffing.
        __isBasic: !!p.subject?.isBasic,
        __famKey: [
          Array.isArray(p.subject?.materials) ? p.subject.materials.join(',') : String(p.subject?.materials || 'METAL'),
          p.subject?.rodKind || '', String(p.subject?.mount || ''),
        ].join('|'),
        __proj: Number(p.answers?.proj ?? (p.subject?.projTiers?.FRONT)) || 0,
      });
    }
    // ── BASICS COMBINE, TWO PER SHEET (Stuart 2026-08-23b) ─────────────────────────────────
    // "the basic brackets can be combined to two per page, so H1-138BD and H1-138B6 together
    //  and H1-138BE and H1-138BS together, that can basically be a rule if from same family and
    //  tagged the same combine when possible."
    // A basic draws alone — one row — so two share a sheet the way the reference books do.
    // Family is read from TAGS (materials, rod world, mount), never from the code. Doubles
    // lead, then deepest projection first, which is exactly the order he paired them in.
    // Presentation only: the engine's per-arm pages (and the audit) are untouched; the combo
    // page simply builds both arms' rows onto one sheet.
    const paged = (() => {
      const groups = new Map();
      pageList.forEach((pg) => {
        if (!(pg.kind === 'BRACKET' && pg.__isBasic && !(pg.familyPins || []).length)) return;
        if (!groups.has(pg.__famKey)) groups.set(pg.__famKey, []);
        groups.get(pg.__famKey).push(pg);
      });
      const merged = new Map(); // first member key -> combined page · other members dropped
      const drop = new Set();
      for (const group of groups.values()) {
        group.sort((a, b) => ((b.rodNodes || []).length - (a.rodNodes || []).length) || (b.__proj - a.__proj));
        for (let i = 0; i + 1 < group.length; i += 2) {
          const [a, b] = [group[i], group[i + 1]];
          merged.set(a.key, {
            ...a,
            key: `${a.key}+${b.key}`,
            title: `${a.bracketPin.partName} + ${b.bracketPin.partName} · basics, 2 per sheet`,
            combo: [a, b],
          });
          drop.add(b.key);
        }
      }
      return pageList
        .filter(pg => !drop.has(pg.key))
        .map(pg => merged.get(pg.key) || pg);
    })();
    pageList.length = 0;
    pageList.push(...paged);
    if (!pageList.length) {
      setError('The engine offers no bracket this GLB carries — check that the pinned nodes still exist in the model.');
      return;
    }
    setError('');
    // ── THE SET IS AUDITED BEFORE IT IS SHOWN (Stuart 2026-08-23) ─────────────────────────
    // "every assembly needs its own to avoid a mess." Every filter above is the engine's, so
    // this should always come back empty — which is exactly why it is worth running. The old
    // sheet was confidently wrong for months; a set that can prove it is its own assembly's is
    // the difference between that and this. Independent path: it asks the gate directly rather
    // than re-running the builder.
    setBleed(auditPages(built, engineChoices));
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

  // A WIDE page is one that stands up two rods (a double) — its section is the projection deep,
  // so landscape is its natural orientation. Everything else prints portrait. The same rule keys
  // the bulk print/PDF below, so what you see per page is what the binder set contains.
  const paperFor = useCallback((page) => ((((page?.rodNodes || []).length > 1) || page?.projTiers) ? 'letter' : 'letterP'), []);
  const curPage = shownPages[Math.min(pageIndex, Math.max(0, shownPages.length - 1))] || null;
  const layoutPaper = paperMode === 'P' ? 'letterP' : paperMode === 'L' ? 'letter' : paperFor(curPage);
  useEffect(() => { setPaperMode('auto'); }, [pageIndex]);

  // ---- build rows for a page (cached per bracket × family) ----
  const buildRows = useCallback((bracketPin, familyPins, opts = {}) => {
    const scene = sceneRef.current;
    const bracket = extractWorldMeshes(scene, [bracketPin.choiceNode]);
    if (!bracket.length) throw new Error(`Bracket node "${bracketPin.choiceNode}" not found in GLB.`);
    // ⚠ ONLY THE ROD THIS BRACKET HOLDS. sideNodesFor('POLE') is every pole cluster in the file;
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
    // ⚠ NEVER FILTER THE ANSWER YOU ASKED FOR. `allowed` is `visible` — what an ADDITIVE
    // CONFIGURATOR renders for a set of selections — and a three-piece pole's END segments only
    // render once that end's treatment is chosen. A spec sheet picks an arm and a rod and no
    // finial, so the left half legitimately does not render, `allowed` did not contain it, and
    // keep() threw away the very rod rodForArm() had just named. The page then reported "no rod
    // geometry" while quoting the rod it had discarded — Stuart's first click, every time.
    //
    // The distinction is the fix: `keep` is for SWEEPS. A cluster list is a guess and the engine
    // narrows it. A rod the engine itself named is not a guess, so it is drawn as given.
    const engineRod = (opts.rodNodes || []).filter(n => extractWorldMeshes(scene, [n]).length);
    const poleNodes = engineRod.length ? engineRod : keep(sideNodesFor('POLE'));
    const pole = poleNodes.length ? extractWorldMeshes(scene, poleNodes) : [];
    // ⚠ AXES ARE INFERRED FROM THE ARM'S OWN ROD, NOT THE SET. inferAxes reads the pole to decide
    // which way is up, along and out — hand it a double's two rods and the projection axis it
    // picks can differ, which silently moves every plate placement that depends on it. The page
    // lists the arm's rod first for exactly this reason.
    const axisRod = poleNodes.length ? extractWorldMeshes(scene, [poleNodes[0]]) : [];
    // ── THE RODS THEMSELVES ARE PLACED FROM THE TAGS (Stuart 2026-08-23) ──────────────────────
    // "the poles are in wrong place and projection still not right."
    //
    // The plate was being placed from its projection tag while the RODS were left wherever the
    // merged sales model parked them — so on H1-138D the printed steps came out wall→3-1/4 then
    // 3-1/4→8-1/2, when the tags say FRONT 8.5 / BACK 3.25 and the second step should be 5-1/4.
    // The plate obeyed the rule and the rods did not, so they could not agree.
    //
    // "the front pole is always fixed and everything moves back from there" applied properly: the
    // FRONT rod is the datum and stays; the BACK rod moves to (front − (frontProj − backProj)).
    // Everything on the sheet is then measured from one story instead of two.
    const rodTiers = opts.projTiers || null;
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
    if (!pole.length) {
      const named = opts.rodNodes || [];
      const inScene = named.filter(n => extractWorldMeshes(scene, [n]).length);
      throw new Error(`No rod geometry for this page. The engine pairs this arm with ${named.join(', ') || 'no rod at all'}; ${inScene.length} of ${named.length} of those nodes are in the GLB, and the ${side.toLowerCase()}-side POLE clusters carry ${sideNodesFor('POLE').length}. Check the POLE pins in 1.6 / ⚖.`);
    }
    // basic brackets have no plate — the bracket itself marks the wall side for axis inference
    const firstPlate = plateChoices.length ? extractWorldMeshes(scene, [plateChoices[0].choiceNode]) : [];
    const axes = inferAxes(axisRod.length ? axisRod : pole, firstPlate.length ? firstPlate : bracket);
    const views = makeViews(axes);
    // ⚠ THIS RUNS AFTER `axes`, AND MUST. It reads axes.projAxis / axes.wallCoord, and an IIFE
    // assigned to a const evaluates where it is WRITTEN — placed above `const axes` it threw
    // "Cannot access 'M' before initialization" on every page, which is the temporal-dead-zone
    // trap this codebase has now hit three times (CPQ engine, twice, 2026-08-21).
    // ── RINGS RIDE THE FRONT ROD, AND ONLY THE FRONT ROD (Stuart 2026-08-23) ─────────────────
    // "no rings need to be shown on rear rod." A double now draws both poles, so "the rod" is no
    // longer a single thing: the ring stations, the ring drop datum and the rod Ø all have to
    // name WHICH. The front rod is the one furthest from the wall — that is what projection
    // means, and it needs no extra tag to determine.
    const frontPole = (() => {
      if (poleNodes.length < 2) return pole;
      const groups = poleNodes.map(n => extractWorldMeshes(scene, [n])).filter(g => g.length);
      if (groups.length < 2) return pole;
      const ax = axes.projAxis;
      const toWall = Math.sign(axes.wallCoord - axes.poleBox.center[ax]) || 1;
      return groups.reduce((best, g) => {
        const c = groupBbox(g).center[ax], b = groupBbox(best).center[ax];
        return (toWall > 0 ? c < b : c > b) ? g : best;
      }, groups[0]);
    })();

    // Re-seat the BACK rod relative to the fixed FRONT rod, from the tags. Only when this page
    // actually has two tiers and the tags give both figures — otherwise nothing moves.
    let poleDrawn = pole;
    if (frontPole.length && rodTiers && poleNodes.length > 1) {
      const fp = Number(rodTiers.FRONT ?? rodTiers.front);
      const bp = Number(rodTiers.BACK ?? rodTiers.back);
      if (isFinite(fp) && isFinite(bp) && fp > bp) {
        const ax = axes.projAxis;
        const toWall = Math.sign(axes.wallCoord - groupBbox(frontPole).center[ax]) || 1;
        const target = groupBbox(frontPole).center[ax] + toWall * ((fp - bp) / M2IN);
        const front = new Set(frontPole.map(m => m.path + '/' + m.name));
        const back = pole.filter(m => !front.has(m.path + '/' + m.name));
        if (back.length) {
          const d = [0, 0, 0];
          d[ax] = target - groupBbox(back).center[ax];
          poleDrawn = [...frontPole, ...translateMeshes(back, d)];
        }
      }
    }
    // ── THE MOUNTING IS ON THE LEFT AND THE ROD RUNS RIGHT — ON EVERY SHEET ──────────────────
    // Stuart 2026-08-23: "again the rod goes off to the wrong side, please fix this for all."
    //
    // Which way the rod runs was falling out of WHICH ROD SEGMENT got picked, and that varies by
    // arm: the passing brackets are pinned CENTER, so the left-hand pole segment runs away to the
    // left of them, while a LEFT arm sits at the end of its own segment and the rod runs right.
    // Chasing that through the pin data would fix one family and break the next.
    //
    // It is a drawing decision, so it is made once, here. Mirroring the FRONT VIEW BASIS — negate
    // `right` — is choosing to stand on the other side of the window, which is exactly what makes
    // a right-hand bracket read as its left-hand mirror. Every measurement downstream is taken in
    // this basis, so the dimensions are unaffected and nothing else needs to know.
    {
      const bF = viewBbox(bracket, views.front);
      const pF = viewBbox(pole, views.front);
      const mountC = (bF.minU + bF.maxU) / 2, rodC = (pF.minU + pF.maxU) / 2;
      if (isFinite(mountC) && isFinite(rodC) && rodC < mountC) {
        views.front = { ...views.front, right: views.front.right.map(v => -v) };
      }
    }
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
      const pb = frontPole.length ? groupBbox(frontPole) : axes.poleBox;
      const bb = groupBbox(bracket);
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
        // Next station: past this ring, with a gap wide enough for its drop dimension AND its
        // pattern id. Stuart 2026-08-23: "spread the rings out some as they appear very busy",
        // and again 2026-08-23b: "ideally are just spread a little further apart horizontally so
        // that it is visually pleasing."
        // ⚠ THE SPREAD IS FREE ON MULTI-ROW SHEETS AND COSTS SCALE ON ONE-ROW SHEETS. A one-row
        // page is width-bound — every inch of ring spread comes straight off the drawn size that
        // is already at 96-100%. A multi-row page is height-bound with its width sitting unused
        // (same split as WINDOW_MAX_M below). So the rings breathe where the width is free.
        const gap = plateChoices.length > 1 ? 0.028 : 0.019;   // ~1-1/4" spread · ~3/4" tight — room for each drop dim beside its ring (Stuart 2026-08-23b: 'the ring measurement text is being covered up by the rings themselves')
        edge = target + sign * (half + gap);
      }
      return out;
    };
    const bracketHalfAlong = bracket.length
      ? (groupBbox(bracket).max[axes.poleAxis] - groupBbox(bracket).min[axes.poleAxis]) / 2
      : 0;
    // NOTE: the per-ring detail views that used to feed a bottom strip are gone. Each ring is
    // drawn where it hangs, on the rod, with its pattern id under it — one drawing of a part
    // instead of two, and the height that strip took is what the rows were short of.
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
    // ⚠ A RING ENCIRCLES THE ROD, SO IT IS NEVER BEHIND IT (Stuart 2026-08-23: "rings are shown
    // behind rod not 'over' rod"). The depth raster is built from the whole composed group, and
    // the rod's front face is nearer the camera than the far side of the ring, so most of each
    // ring was correctly — and uselessly — hidden. Rendered against its own buffer and merged in,
    // exactly as the carriers are: nothing moves, the ring simply is not occluded by the thing it
    // is threaded onto.
    const ringOverlay = (meshes) => (meshes.length ? renderHiddenLine(meshes, views.front, 1200) : null);
    // Union of two rendered views: segments concatenated, bounds widened. Only the bounds are
    // read downstream (place/clip), so a merged view needs nothing from the depth raster.
    const mergeViews = (view, other) => (!other ? view : {
      vis: [...view.vis, ...other.vis],
      zb: {
        minU: Math.min(view.zb.minU, other.zb.minU), maxU: Math.max(view.zb.maxU, other.zb.maxU),
        minV: Math.min(view.zb.minV, other.zb.minV), maxV: Math.max(view.zb.maxV, other.zb.maxV),
      },
    });
    const withCarrier = (view) => mergeViews(view, carrierView);
    // ── THE SECTION SHOWS HOW IT WORKS (Stuart 2026-08-23b) ─────────────────────────────────
    // "on the passing brackets page please include one passing ring on the rod in the side
    //  profile, as we have a lot of questions how that works and it looks from the front view the
    //  same as the standard ring. then on the traverse track items please also add one carrier in
    //  the track from the side profile."
    // Both use the cutaway convention the carriers already have in the elevation: rendered
    // against their OWN depth buffer and merged, so the part draws THROUGH the bracket or track
    // it rides instead of being occluded by it. The TAGS name the part — the pin's `passing` tag
    // marks the passing ring, `traverseRole: CARRIER` marks the carrier — and the part sits where
    // the model put it: on the rod, which is exactly the story the section is asked to tell.
    const sectionRider = (() => {
      const tag = (v) => String(v || '').trim().toUpperCase();
      if (tag(bracketPin.passing) === 'PASSING') {
        const rp = (opts.ringPins || []).find(p => tag(p.passing) === 'PASSING');
        const m = rp ? extractWorldMeshes(scene, [rp.choiceNode]) : [];
        if (m.length) return m;
      }
      if (opts.isTraverse) {
        const cp = (opts.riderPins || []).find(p => tag(p.traverseRole) === 'CARRIER');
        const m = cp ? extractWorldMeshes(scene, [cp.choiceNode]) : [];
        if (m.length) return m;
      }
      return null;
    })();
    // ⚠ THE OVERLAY RENDERS IN THE CELL'S OWN BASIS. A return page's right cell is the PLAN
    // view — merging a side-profile render of the carrier into it put the part at nonsense
    // coordinates (the floating ghost on the traverse miter sheets). The caller says which view
    // the cell is drawn in; the overlay renders in the same one.
    const withSection = (view, basis) => (sectionRider ? mergeViews(view, renderHiddenLine(sectionRider, basis || views.profile, 900)) : view);
    // ── A RETURN IS SHOWN FROM OVERHEAD (Stuart 2026-08-23b) ────────────────────────────────
    // "instead of showing from the side profile, we need to show these (all when marked as
    //  returns) from overhead view, so that we can clearly mark the projection and show the
    //  curved vs miter shape between the two." Shared by BOTH row builders — the traverse miters
    // draw alone (no plates) and need the plan view too. Same `right` basis as the elevation so
    // the row reads across; the wall sits at the bottom edge.
    // ⚠ A VIEW IS THREE VECTORS. renderHiddenLine reads view.viewDir for edge collection and the
    // depth raster; the camera direction is derived so the basis keeps makeViews' handedness
    // invariant (cross(right, up) = −viewDir), whatever the mirror decision did to `right`.
    // ── THE BEND IS ONE PIECE OF POLE (Stuart 2026-08-24) ───────────────────────────────────
    // "the fusion file shows a line between the returns and the pole, is there a way you can
    //  suppress this as it is actually very misleading as we are bending or miter cutting the
    //  pole to make these and they are not a separate part." The bend node and the rod segment
    // are separate MESHES that butt exactly, so each draws its end-cap edge at the joint — a
    // hairline across the pole that reads as a joint that does not exist on the real part. The
    // seam is found where a bracket bbox edge meets a rod bbox edge in the view, and
    // near-vertical segments at that station are dropped. The miter's own diagonal cut lines are
    // nowhere near it and stay.
    const scrubSeams = (view, basis) => {
      if (!opts.isReturn || !view) return view;
      const bB = viewBbox(bracket, basis), rB = viewBbox(poleDrawn, basis);
      // ⚠ ONLY THE ROD-SIDE END, ONLY ACROSS THE POLE (Stuart 2026-08-24: "you are suppressing
      // the outer leftside of the returns — you should only suppress the small line that cuts
      // across the straight section of the pole just to the right before the return begins").
      // Pairing every bbox edge also matched the return's outer wall-leg edge. The joint is one
      // place: the bracket's ROD-side end (the mounting sits left, the rod runs right in this
      // basis), and the cap line spans only the pole's own height — everything outside that band
      // is real geometry and stays.
      const seams = [];
      for (const re of [rB.minU, rB.maxU]) {
        if (isFinite(bB.maxU) && isFinite(re) && Math.abs(bB.maxU - re) < 0.006) seams.push((bB.maxU + re) / 2);
      }
      if (!seams.length) return view;
      const near = (u) => seams.some(s => Math.abs(u - s) < 0.004);
      const inPole = (v) => v > rB.minV - 0.012 && v < rB.maxV + 0.012;
      return { ...view, vis: view.vis.filter(([u0, v0, u1, v1]) => !(near(u0) && near(u1) && inPole(v0) && inPole(v1))) };
    };
    const topView = (() => {
      if (!opts.isReturn) return null;
      const away = [0, 0, 0];
      away[axes.projAxis] = -(Math.sign(axes.wallCoord - axes.poleBox.center[axes.projAxis]) || 1);
      const right = views.front.right;
      const viewDir = [
        -(right[1] * away[2] - right[2] * away[1]),
        -(right[2] * away[0] - right[0] * away[2]),
        -(right[0] * away[1] - right[1] * away[0]),
      ];
      return { right, up: away, viewDir };
    })();
    // ── THE PLAN VIEW IS A WINDOW TOO (Stuart 2026-08-24b) ──────────────────────────────────
    // "the pole is a little long and could be shortened some to make the lefthand side view
    //  larger." The overhead never went through clipFront, so its rod ran the full segment
    // length and the page's scale paid for it. The window ends a short stub past the return and
    // its plate; the cut carries a break mark, which is what a broken view means.
    const clipOverhead = (view, mountMeshes) => {
      if (!topView || !view) return view;
      const mount = viewBbox(mountMeshes, topView);
      const rodT = viewBbox(poleDrawn, topView);
      if (!isFinite(mount.maxU) || !isFinite(rodT.maxU)) return view;
      const hiU = mount.maxU + 0.051;   // 2" of straight rod past the return (Stuart 2026-08-24c)
      if (rodT.maxU <= hiU + 0.008) return view;
      const vis = clipSegmentsU(view.vis, view.zb.minU - 1, hiU);
      vis.push(...breakMarks(hiU - 0.006, rodT.minV, rodT.maxV));
      return { ...view, vis, zb: { ...view.zb, maxU: hiU } };
    };

    // Rod break: clip the front view to a window around plate/bracket/ring and mark the
    // cut — a full rod can't print at 1:1, and the hand-made sheets truncate it the same way.
    // ⚠ THE ELEVATION IS A WINDOW, AND THE WINDOW HAS A MAXIMUM (Stuart 2026-08-23: "lots of
    // dead white space, not matching my examples at all"). The window used to be whatever the
    // included boxes spanned, so one box reaching down the rod opened it to the whole pole — the
    // page then reduced to 41% to fit, drew a hairline rod across the sheet and left two thirds of
    // it empty. The hand-made sheets show a SHORT broken view: plate, arm, the rings, and a stub
    // of rod either side. So the window is capped, and anything past the cap is cut with a break
    // mark, which is what a broken view means.
    // ⚠ THE WINDOW IS THE SCALE, AND EVERY WIDENING SHRANK THE SHEET. There are ~15" of drawable
    // width on 11×17; an elevation wider than that forces the WHOLE page to reduce to fit, so the
    // 22" → 26" → 34" growth across three rounds — each one a reasonable-sounding request to
    // lengthen the rod and spread the rings — is exactly what made everything tiny. Scale and rod
    // length are the same dial turned opposite ways. Back to the tightest window that still holds
    // the plate, the arm and the ring options (Stuart 2026-08-23: "we are trying to maximize the
    // product and show it as close to scale that fits properly").
    // ── THE ROD GETS THE WIDTH THE ROWS ARE NOT USING ────────────────────────────────────
    // Stuart 2026-08-23: "the basic brackets and wood brackets render a good size, something
    // about the brackets that use backplates is throwing off your formula … everything can be
    // larger and the poles on the left can be longer."
    //
    // Those two families are the ONE-ROW sheets. A one-row page is bound by WIDTH — the elevation
    // is the widest thing on it — so a tight window is what keeps it near 1:1. A four-row plate
    // page is bound by HEIGHT: four plate-and-ring rows are about twenty inches of drawing on a
    // ten-inch page, and no amount of narrowing helps. On those pages the width sat unused, which
    // is exactly the empty middle of the sheet he is looking at.
    //
    // So the window is not a constant. It grows with the row count, because the more rows there
    // are the more certain it is that height binds and the width is free. The longer rod costs
    // nothing on the sheets that can afford it and is not taken on the sheets that cannot.
    const rowN = Math.max(1, (familyPins || []).length);
    const WINDOW_MAX_M = Math.min(44, 18 + (rowN - 1) * 9) * 0.0254;
    // The rod's centreline expressed in a given view's v axis — both the elevation and the
    // section contain the rod, so this is the one height they can agree on.
    const rodCentreV = (view) => { const b = viewBbox(pole, view); return (b.minV + b.maxV) / 2; };

    // ⚠ THE WINDOW IS ANCHORED ON THE MOUNTING, NOT ON THE LEFT (Stuart 2026-08-23: "the double
    // bracket is too far off to the right, so the backplates are out of the page view"). The cap
    // used to keep `lo` and cut `hi`, which silently assumes the wall is at the left of the view.
    // On a double it is not — the geometry runs the other way, so the cut took off the plates and
    // kept a length of empty rod. The plate and arm are what a reader lines up on, so they are
    // what the window is built around and the rod is what gets cut, whichever side it runs to.
    const clipFront = (front0, includeBoxes, mountBox = null, keepToU = -Infinity) => {
      // Ø and the ring drop are quoted against the FRONT rod — see frontPole above.
      const poleFull = viewBbox(frontPole.length ? frontPole : pole, views.front);
      let lo = Infinity, hi = -Infinity;
      for (const b of includeBoxes) {
        if (!b || !isFinite(b.minU)) continue;
        if (b.minU < lo) lo = b.minU;
        if (b.maxU > hi) hi = b.maxU;
      }
      if (!isFinite(lo) || !isFinite(hi)) { lo = poleFull.minU; hi = poleFull.maxU; }
      // Extra visible rod so the rings clearly hang on it — longer on the open end, which is
      // what makes the elevation read as a rod rather than a stub ("we can make the rod on the
      // left side longer for all").
      lo -= 0.012; hi += 0.022;
      // ── A RETURN'S ROD STUB IS SHORT (Stuart 2026-08-24) ──────────────────────────────────
      // "the pole on right is too long and makes the pole on left side too short so the rings
      //  are bunched up again, shorten the length of the straight rod shown on the right by
      //  1.5\"." The bend carries its own pole tail, so the window was paying for bend + rings +
      // tail; the open end trims by 1.5", floored so the cut can never land on a ring or plate.
      if (opts.isReturn) hi = Math.max(hi - 0.038, (isFinite(keepToU) ? keepToU : -Infinity) + 0.006, lo + 0.05);
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
      const ringMeshes = rowRings.flatMap(r => r.meshes);
      const meshes = [...bracket, ...poleDrawn, ...ringMeshes];
      const front0 = scrubSeams(mergeViews(withCarrier(renderHiddenLine([...bracket, ...poleDrawn], views.front, 1600)), ringOverlay(ringMeshes)), views.front);
      // ⚠ NO RINGS IN THE PROFILE. Every ring is parked at its own station ALONG the rod, and the
      // profile looks down that axis — so they all land on the same spot and draw on top of each
      // other (Stuart 2026-08-23: "rendering over laps"). The reference's profile column is the
      // arm's section; each ring's own end view is on the bottom strip.
      const profile = clipOverhead(scrubSeams(withSection(renderHiddenLine([...bracket, ...poleDrawn], topView || views.profile, 900), topView || views.profile), topView || views.profile), bracket);
      const bracketF = viewBbox(bracket, views.front);
      const ringBoxes = rowRings.map(r => viewBbox(r.meshes, views.front));
      const { view: front, hi: frontHi, poleFull: poleF } = clipFront(front0, [bracketF, ...ringBoxes], bracketF, Math.max(...ringBoxes.map(b => b.maxU), -Infinity));
      const dims = { front: [], profile: [], detail: [] };
      let measProjIn = null; // captured for the geometry-vs-cell check (IM has no projection)
      dims.front.push({ t: 'dia', u: frontHi - 0.008, v: poleF.maxV, in: (poleF.maxV - poleF.minV) * M2IN });
      // one drop dim per ring option — the VALUE under the measure line, in its own lane
      // (Stuart 2026-08-27), and the pattern id staggered further below.
      ringBoxes.forEach((rb, i) => {
        dims.front.push({ t: 'v', u: rb.maxU, v0: poleF.maxV, v1: rb.minV, off: 24, below: true, in: (poleF.maxV - rb.minV) * M2IN });
        const code = rowRings[i]?.partName;
        if (code) dims.front.push({ t: 'text', u: (rb.minU + rb.maxU) / 2, v: rb.minV, off: RING_LABEL_DROP + (i % RING_LABEL_LEVELS) * RING_LABEL_STAGGER, lead: true, code: true, text: code });
      });
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
      } else if (topView) {
        // Overhead return with no plate (the traverse miters): projection is the vertical
        // measure in the plan view, wall edge to pole centreline, marked clear on the right.
        const topB = viewBbox(bracket, topView);   // NOT the rod: its unclipped span put the dim ~18" off-cell (Stuart 2026-08-25: dim missing)
        const wallPt = [0, 0, 0]; wallPt[axes.projAxis] = axes.wallCoord;
        const wallV = projPoint(topView, wallPt)[1];
        const poleV = projPoint(topView, [...axes.poleCenter])[1];
        measProjIn = Math.abs(poleV - wallV) * M2IN;
        dims.profile.push({ t: 'v', u: topB.maxU, v0: Math.max(wallV, poleV), v1: Math.min(wallV, poleV), off: 16, side: 1, in: measProjIn });
      } else {
        const wallPt = [0, 0, 0]; wallPt[axes.projAxis] = axes.wallCoord;
        const wallU = projPoint(views.profile, wallPt)[0];
        const poleU = projPoint(views.profile, axes.poleCenter)[0];
        const profTopV = viewBbox(meshes, views.profile).maxV;
        measProjIn = Math.abs(poleU - wallU) * M2IN;
        dims.profile.push({ t: 'h', u0: Math.min(wallU, poleU), u1: Math.max(wallU, poleU), v: profTopV, off: -8, in: measProjIn });
        // ── THE BRACKET'S HEIGHT AT THE WALL (Stuart 2026-08-23b) ───────────────────────────
        // "the basic brackets are missing the vertical dimension at the far right of the bracket
        //  (see brackets with backplates)." A basic IS its own mounting, so the dim the plate
        // sheets hang on the plate reads off the bracket's own wall face instead: the vertical
        // extent of its geometry in a ~1/2" band at the wall end of the section.
        const bP = viewBbox(bracket, views.profile);
        const faceRight = Math.abs(bP.maxU - wallU) <= Math.abs(bP.minU - wallU);
        const face = faceRight ? bP.maxU : bP.minU;
        const band = 0.014;
        let fLo = Infinity, fHi = -Infinity;
        for (const m of bracket) {
          const P = m.positions;
          for (let k = 0; k < P.length; k += 3) {
            const u = P[k] * views.profile.right[0] + P[k + 1] * views.profile.right[1] + P[k + 2] * views.profile.right[2];
            if (Math.abs(u - face) > band) continue;
            const v = P[k] * views.profile.up[0] + P[k + 1] * views.profile.up[1] + P[k + 2] * views.profile.up[2];
            if (v < fLo) fLo = v; if (v > fHi) fHi = v;
          }
        }
        if (isFinite(fLo) && fHi - fLo > 0.004) {
          dims.profile.push({ t: 'v', u: face, v0: fHi, v1: fLo, off: faceRight ? 16 : -16, side: faceRight ? 1 : -1, in: (fHi - fLo) * M2IN });
        }
      }
      // The rod centreline in each view — the row's shared datum, so the section reads across
      // from the elevation instead of each cell floating on its own extents.
      const datum = { front: (poleF.minV + poleF.maxV) / 2, profile: topView ? undefined : rodCentreV(views.profile) };
      const padBelow = ringBoxes.length ? RING_LABEL_DROP + (RING_LABEL_LEVELS - 1) * RING_LABEL_STAGGER + FS_LABEL_ROOM : 0;
      return { rows: [{ rowKey: bracketPin.partName, partName: bracketPin.partName, wallCode: '', front, profile, detail: null, dims, datum, padBelow, hasAsMounted: false }], axes, measured: { poleDiaIn: (poleF.maxV - poleF.minV) * M2IN, projIn: measProjIn } };
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
      if (opts.isReturn) {
        // ── A RETURN'S PLATE IS CENTRED ON THE POLE (Stuart 2026-08-23b) ─────────────────
        // "the backplates should line up directly in the middle of the pole." A return has no
        // arm — the bent pole itself meets the wall — so the plate sits with the pole through
        // its centre, wherever the borrowed pin's copy was modelled.
        const d = [0, 0, 0];
        d[axes.vertAxis] = poleCV - cb0.center[axes.vertAxis];
        if (Math.abs(d[axes.vertAxis]) > 1e-5) plateAll = translateMeshes(plateAll0, d);
      } else if (plateOnCenterline && rootOffCenterline) {
        const d = [0, 0, 0];
        d[axes.vertAxis] = rootV - cb0.center[axes.vertAxis];
        plateAll = translateMeshes(plateAll0, d);
      }
      // ── THE POLE IS FIXED; EVERYTHING MOVES BACK FROM IT (Stuart 2026-08-23) ─────────────
      // "the only one with the backplate in the correct place is the double … the rule in the cpq
      //  engine states the front pole is always fixed and everything moves back from there, that
      //  is why on the shortest projection bracket the backplate is the farthest out of correct
      //  position."
      //
      // Exactly right, and it says the earlier fix was aimed down the wrong axis. Sliding the
      // plate ALONG THE ROD to the arm's station addressed a station mismatch that was never the
      // real fault; the error is in DEPTH. A merged sales model carries one plate mesh serving
      // every projection, parked at whatever depth it was modelled at — so the further that depth
      // is from THIS arm's projection, the further out the plate lands. The shortest arm is worst
      // because it is furthest from the modelled depth, which is precisely what he observed.
      //
      // The projection is a TAG on the page, so it does not have to be measured or guessed: with
      // the pole as the datum, the plate's wall face sits exactly `proj` inches behind the pole
      // centreline. Nothing else about the plate is touched.
      // ── THE ARM IS DEAD CENTRE OF THE BACKPLATE (Stuart 2026-08-23) ─────────────────────
      // "the bracket arm is showing off to the right of the backplate … the bracket arm is always
      //  dead center of the backplate."
      //
      // Two different offsets were confused for one. DEPTH — how far behind the pole the plate
      // sits — is the projection, fixed below. STATION — where along the rod the pair sits — is
      // this, and the merged sales model parks each plate variant at its own station so they do
      // not collide in 3D. I had a station fix, replaced it with the depth fix, and needed both:
      // correcting the depth alone left the arm sitting off to one side of its plate.
      //
      // The arm holds the rod, so the arm keeps its station and the plate comes to it.
      {
        const ax = axes.poleAxis;
        const pb = groupBbox(plateAll), bb = groupBbox(bracket);
        // ── A RETURN'S PLATE SITS AT ITS WALL LEG (Stuart 2026-08-23b) ───────────────────
        // "the backplates are still not aligned with the returns, they are shown off to the
        //  right." The station used to be the bracket's bbox centre — but a return's bbox
        // middle is halfway along the bend, not where it mounts. The leg is the geometry
        // NEAREST THE WALL (a ~3/4" band at the bracket's wall-most extent); the plate goes to
        // that band's centre along the rod. An ordinary arm is symmetric about its mount, so
        // nothing changes for it — the bbox centre remains its answer.
        let target = bb.center[ax];
        if (opts.isReturn) {
          const pj = axes.projAxis;
          const wallSign = Math.sign(axes.wallCoord - axes.poleBox.center[pj]) || 1;
          const wallEdge = wallSign > 0 ? bb.max[pj] : bb.min[pj];
          const band = 0.02;
          let lo = Infinity, hi = -Infinity;
          for (const m of bracket) {
            const P = m.positions;
            for (let k = 0; k < P.length; k += 3) {
              const depth = [P[k], P[k + 1], P[k + 2]][pj];
              if (Math.abs(depth - wallEdge) > band) continue;
              const s = [P[k], P[k + 1], P[k + 2]][ax];
              if (s < lo) lo = s; if (s > hi) hi = s;
            }
          }
          if (isFinite(lo)) target = (lo + hi) / 2;
        }
        const gap = target - pb.center[ax];
        if (isFinite(gap) && Math.abs(gap) > 1e-5) {
          const d = [0, 0, 0];
          d[ax] = gap;
          plateAll = translateMeshes(plateAll, d);
        }
      }
      const projIn = Number(opts.projIn);
      // ⚠ NOT ON A CEILING PAGE (Stuart 2026-08-24). A ceiling plate hangs the pole from above —
      // there is no wall, so inferAxes' wallCoord is a fiction there, and sliding the plate to
      // "projIn behind the pole" dragged a ceiling plate sideways. The ceiling geometry is
      // modelled true (plate above the rod); it stays exactly where the designer put it.
      if (!opts.isCeiling && isFinite(projIn) && projIn > 0) {
        const ax = axes.projAxis;
        const poleC = axes.poleBox.center[ax];
        // Even a badly-parked plate is on the correct SIDE of the rod, so the sense is reliable.
        const wallSign = Math.sign(axes.wallCoord - poleC) || 1;
        const target = poleC + wallSign * (projIn / M2IN);
        const pb = groupBbox(plateAll);
        const face = wallSign > 0 ? pb.max[ax] : pb.min[ax];
        const d = [0, 0, 0];
        d[ax] = target - face;
        if (isFinite(d[ax]) && Math.abs(d[ax]) > 1e-5) plateAll = translateMeshes(plateAll, d);
      }
      const wallPlate = plateAll.filter(m => WALL_PLATE_MATCH.test(m.name + m.path));
      const cover = plateAll.filter(m => !WALL_PLATE_MATCH.test(m.name + m.path) && !SCREW_MATCH.test(m.name + m.path));
      // merged GLBs may drop the "/" from item codes ("H1-CPWP2P") — normalize back to ".../P"
      const wallCodeMatch = (wallPlate[0] ? (wallPlate[0].path + '/' + wallPlate[0].name) : '').match(WALL_CODE_RX);
      const wallCode = wallCodeMatch ? wallCodeMatch[0].toUpperCase().replace(/\s*\/?\s*P$/, '/P') : (wallPlate.length ? 'WALL PLATE' : '');
      // park the ring past THIS row's plate edge — wide -H plates push it further out
      const plateHalfAlong = (cb0.max[axes.poleAxis] - cb0.min[axes.poleAxis]) / 2;
      const rowRings = parkRings(Math.max(plateHalfAlong, bracketHalfAlong));
      const ringMeshes = rowRings.flatMap(r => r.meshes);
      const meshes = [...bracket, ...plateAll, ...poleDrawn, ...ringMeshes];
      const front0 = scrubSeams(mergeViews(withCarrier(renderHiddenLine([...bracket, ...plateAll, ...poleDrawn], views.front, 1600)), ringOverlay(ringMeshes)), views.front);
      // Rings excluded — see the note on the basic row: they stack in this view.
      const profile = clipOverhead(scrubSeams(withSection(renderHiddenLine([...bracket, ...plateAll, ...poleDrawn], topView || views.profile, 900), topView || views.profile), topView || views.profile), [...bracket, ...plateAll]);
      const detail = wallPlate.length ? renderHiddenLine(wallPlate, views.front, 300) : null;
      // measures in view space
      const coverF = viewBbox(cover.length ? cover : plateAll, views.front);
      const bracketF = viewBbox(bracket, views.front);
      const ringBoxes = rowRings.map(r => viewBbox(r.meshes, views.front));
      const ringF = ringBoxes[0] || null;
      const coverP = viewBbox(cover.length ? cover : plateAll, views.profile);
      const wallF = wallPlate.length ? viewBbox(wallPlate, views.front) : null;
      const { view: front, hi: frontHi, poleFull: poleF } = clipFront(front0, [coverF, bracketF, ...ringBoxes], unionBox(coverF, bracketF), Math.max(...ringBoxes.map(b => b.maxU), coverF.maxU, -Infinity));
      const isRound = /-R$/i.test(platePin.partName || '');
      const dims = { front: [], profile: [], detail: [] };
      // The plate names itself where it is drawn (Stuart 2026-08-23: "we need to add the pattern
      // id's for the backplates and coverplates"), on the same line as the ring ids so it costs
      // no extra height.
      // ⚠ THE PLATE'S DIM AND ID SIT BELOW EVERYTHING THE ROW DRAWS AT THAT STATION (Stuart
      // 2026-08-23b: "the pattern and measurement of the back plate must move down as it is
      // written off the pole"). On the traverse sheets the plate is SHORTER than the track, so a
      // label anchored at the plate's own bottom landed inside the track lines. Anchoring at the
      // lower of plate-bottom and rod-bottom clears every case, and changes nothing on the solid
      // sheets where the plate already reaches lowest.
      // ── A CEILING PLATE IS ANNOTATED ABOVE THE POLE (Stuart 2026-08-24) ─────────────────
      // "on the ceiling brackets on the left side, put the measurements of the backplates above
      //  the pole, it is deceiving below as it does not align with their placement." The plate
      // hangs the pole from above there, so its id and width ride above the artwork; on a wall
      // page they stay below, clear of the rod, as before.
      const plateAnchorV = Math.min(coverF.minV, viewBbox(poleDrawn, views.front).minV);
      const plateTopV = Math.max(coverF.maxV, viewBbox(poleDrawn, views.front).maxV);
      if (platePin.partName) {
        dims.front.push(opts.isCeiling
          ? { t: 'text', u: (coverF.minU + coverF.maxU) / 2, v: plateTopV, off: -(RING_LABEL_DROP - 8), lead: true, code: true, text: platePin.partName }
          // The id sits a clear line BELOW the width dim bar (Stuart 2026-08-24b: "the item id
          // is printed really close to the line, can you lower the id's").
          : { t: 'text', u: (coverF.minU + coverF.maxU) / 2, v: plateAnchorV, off: RING_LABEL_DROP + 22, lead: true, code: true, text: platePin.partName });
      }
      const plateWIn = (coverF.maxU - coverF.minU) * M2IN;
      // round plate: Ø leader off the circle's LOWER-left arc, running DOWN — anchored up top it
      // walked its label straight into the pole (Stuart 2026-08-27, the stray ⌀ on the -R rows).
      // plate width BELOW the plate — above it the rod crosses the dim on short plates
      if (isRound && !opts.isCeiling) dims.front.push({ t: 'dia', u: coverF.minU + (coverF.maxU - coverF.minU) * 0.15, v: coverF.minV + (coverF.maxV - coverF.minV) * 0.15, dir: -1, down: true, in: plateWIn });
      else if (opts.isCeiling) dims.front.push({ t: 'h', u0: coverF.minU, u1: coverF.maxU, v: plateTopV, off: -12, in: plateWIn });
      else dims.front.push({ t: 'h', u0: coverF.minU, u1: coverF.maxU, v: plateAnchorV, off: 32, in: plateWIn });
      dims.front.push({ t: 'dia', u: frontHi - 0.008, v: poleF.maxV, in: (poleF.maxV - poleF.minV) * M2IN });
      // ── THE CARRIER'S DROP (Stuart 2026-08-23b) ─────────────────────────────────────────
      // "the drop measurement shown for traverse should show the line from the bottom of the rod
      //  to the bottom of the eyelet of the carrier." A track's drapery hangs from the carrier,
      // so its drop is quoted from the track's UNDERSIDE — not the top, as a ring's is.
      if (opts.isTraverse) {
        const tag = (v) => String(v || '').trim().toUpperCase();
        const cp = (opts.riderPins || []).find(p => tag(p.traverseRole) === 'CARRIER');
        const cm = cp ? extractWorldMeshes(scene, [cp.choiceNode]) : [];
        if (cm.length) {
          const cF = viewBbox(cm, views.front);
          if (isFinite(cF.minV) && cF.minV < poleF.minV - 0.002) {
            dims.front.push({ t: 'v', u: cF.maxU, v0: poleF.minV, v1: cF.minV, off: 18, ldy: 12, in: (poleF.minV - cF.minV) * M2IN });
          }
        }
      }
      if (ringF) {
        // ring drop: TOP OF ROD → bottom of the eyelet (Stuart's definition), for EVERY ring
        // option on the rod — that measurement is the thing that differs between them. The value
        // sits UNDER its own measure line (2026-08-27) so each drop reads in its own lane.
        ringBoxes.forEach((rb, i) => {
          dims.front.push({ t: 'v', u: rb.maxU, v0: poleF.maxV, v1: rb.minV, off: 24, below: true, in: (poleF.maxV - rb.minV) * M2IN });
          // ⚠ THE RING NAMES ITSELF WHERE IT HANGS (Stuart 2026-08-23: "lose the rings along the
          // bottom just keep them along the rod on the left and add their pattern ids below each
          // one"). The bottom strip was a second drawing of parts already on the page, and it cost
          // the height that made everything else cramped.
          // ⚠ THE IDS OVERLAP UNLESS THEY ARE STAGGERED (Stuart 2026-08-23: "the ring id's can be
          // lower with a pencil line from the id to the [ring] as they overlap"). Ring codes are
          // longer than the gap between rings, so they are dropped clear of the eyelets on two
          // alternating lines, each on its own leader back to the ring it names.
          const code = rowRings[i]?.partName;
          if (code) dims.front.push({ t: 'text', u: (rb.minU + rb.maxU) / 2, v: rb.minV, off: RING_LABEL_DROP + (i % RING_LABEL_LEVELS) * RING_LABEL_STAGGER, lead: true, code: true, text: code });
        });
        // as-mounted: top hole of the wall mount → bottom of the ring, from bulk-entered offset
        const topHoleOff = parseInches(wallCfg[wallCode]?.topHole);
        if (topHoleOff != null && wallF) {
          const topHoleV = wallF.maxV - topHoleOff / M2IN;
          dims.front.push({ t: 'v', u: coverF.minU, v0: topHoleV, v1: ringF.minV, off: -16, side: -1, in: (topHoleV - ringF.minV) * M2IN });
        }
      }
      // profile: projection (wall face → pole centerline) + plate height
      // Wall face = the back of the plate we just placed, so the printed projection is the one
      // the drawing shows. Reading axes.wallCoord here would quote the mis-parked depth back.
      const placed = groupBbox(plateAll);
      const wallAt = (Math.sign(axes.wallCoord - axes.poleBox.center[axes.projAxis]) || 1) > 0
        ? placed.max[axes.projAxis] : placed.min[axes.projAxis];
      const wallPt = [0, 0, 0]; wallPt[axes.projAxis] = isFinite(wallAt) ? wallAt : axes.wallCoord;
      const polePt = [...axes.poleCenter];
      const wallU = projPoint(views.profile, wallPt)[0];
      const poleU = projPoint(views.profile, polePt)[0];
      const profTopV = viewBbox(meshes, views.profile).maxV;
      if (!measured) measured = { poleDiaIn: (poleF.maxV - poleF.minV) * M2IN, projIn: Math.abs(poleU - wallU) * M2IN };
      // ── A DOUBLE IS DIMENSIONED IN TWO STEPS (Stuart 2026-08-23) ────────────────────────
      // "projection measuring from front of rod to middle of rear rod should be from wall to
      //  middle of rear rod and from there to middle of front rod."
      //
      // One dim from the wall to the front rod describes neither pole on a double: what a fitter
      // needs is how far off the wall the REAR rod sits, and then the gap out to the front one.
      // So each rod centre is measured in turn, wall outwards.
      // ⚠ MEASURE THE RODS AS DRAWN. Re-seating the back rod from its tag and then dimensioning
      // the model's original positions would print one story and draw another.
      const frontKeys = new Set(frontPole.map(m => m.path + '/' + m.name));
      const backDrawn = poleDrawn.filter(m => !frontKeys.has(m.path + '/' + m.name));
      const rodCentres = (poleNodes.length > 1 && backDrawn.length
        ? [frontPole, backDrawn] : [])
        .filter(g => g.length)
        .map(g => projPoint(views.profile, groupBbox(g).center)[0])
        .sort((x, y) => Math.abs(x - wallU) - Math.abs(y - wallU));
      if (opts.isCeiling) {
        // ── A CEILING BRACKET IS DIMENSIONED BY ITS DROP (Stuart 2026-08-24) ─────────────
        // "on ceiling brackets we do not measure the projection from the wall but rather the
        //  drop from the ceiling to the top of pole." There is no wall: the mount plane is the
        // plate's top face against the ceiling, and the figure a fitter needs is how far the
        // pole hangs below it. Vertical dim, ceiling face → top of pole, clear on the side.
        const profB = viewBbox([...bracket, ...plateAll, ...poleDrawn], views.profile);
        const ceilV = placed.max[axes.vertAxis];
        const poleTopV = axes.poleBox.max[axes.vertAxis];
        dims.profile.push({
          t: 'v', u: profB.maxU, v0: ceilV, v1: poleTopV,
          off: 16, side: 1, in: (ceilV - poleTopV) * M2IN,
        });
      } else if (topView) {
        // Overhead: the projection is a VERTICAL measure in this view — wall face at the bottom
        // edge to the pole centreline — marked clear of the artwork on the right.
        const topB = viewBbox([...bracket, ...plateAll], topView);   // NOT the rod: its unclipped span put the dim ~18" off-cell (Stuart 2026-08-25: dim missing)
        const wallV = projPoint(topView, wallPt)[1];
        const poleV = projPoint(topView, polePt)[1];
        dims.profile.push({
          t: 'v', u: topB.maxU, v0: Math.max(wallV, poleV), v1: Math.min(wallV, poleV),
          off: 16, side: 1, in: Math.abs(poleV - wallV) * M2IN,
        });
      } else if (rodCentres.length > 1) {
        let from = wallU;
        rodCentres.forEach((c, i) => {
          dims.profile.push({ t: 'h', u0: Math.min(from, c), u1: Math.max(from, c), v: profTopV, off: -8 - i * 16, in: Math.abs(c - from) * M2IN });
          from = c;
        });
      } else {
        dims.profile.push({ t: 'h', u0: Math.min(wallU, poleU), u1: Math.max(wallU, poleU), v: profTopV, off: -8, in: Math.abs(poleU - wallU) * M2IN });
      }
      // ⚠ PLATE HEIGHT DIM GOES CLEAR OF THE ARTWORK, ON THE WALL SIDE (Stuart 2026-08-23: "the
      // measurement line and dims for the backplate needs to move to the right so it is off
      // behind the backplate"). It was pinned to the plate's minU with the label to its LEFT,
      // which lands inside the section whenever the wall is on the right — which is where it is
      // in these views. The side is read from the geometry rather than assumed: the dim sits on
      // the plate face pointing away from the rod.
      const plateRight = ((coverP.minU + coverP.maxU) / 2) >= poleU;
      // ⚠ NO Ø ON THE HEIGHT DIM (Stuart 2026-08-23b: "the text measurements need to be
      // uniformed some say 3 and others say ⌀3") — a round plate's height happens to be its
      // diameter, but the column reads as one measurement, so it is written as one.
      // (Not on the overhead return view — plate height is invisible looking straight down.)
      if (!topView && !opts.isCeiling) dims.profile.push({
        t: 'v',
        u: plateRight ? coverP.maxU : coverP.minU,
        v0: coverP.maxV, v1: coverP.minV,
        off: plateRight ? 16 : -16,
        side: plateRight ? 1 : -1,
        in: (coverP.maxV - coverP.minV) * M2IN,
      });
      if (wallF && detail) {
        dims.detail.push({ t: 'h', u0: wallF.minU, u1: wallF.maxU, v: wallF.maxV, off: -12, in: (wallF.maxU - wallF.minU) * M2IN });
        dims.detail.push({ t: 'v', u: wallF.maxU, v0: wallF.maxV, v1: wallF.minV, off: 12, in: (wallF.maxV - wallF.minV) * M2IN });
      }
      const datum = { front: (poleF.minV + poleF.maxV) / 2, profile: topView ? undefined : rodCentreV(views.profile) };
      // ⚠ THE LABELS ARE BELOW THE GEOMETRY AND THE GRID CANNOT SEE THEM. Row heights are measured
      // from mesh bounding boxes, so text dropped under a ring is invisible to the layout and the
      // next row lands on top of it (Stuart 2026-08-23: "the lower row is overlapping the text").
      // The row declares the room its captions need.
      const padBelow = ringBoxes.length ? RING_LABEL_DROP + (RING_LABEL_LEVELS - 1) * RING_LABEL_STAGGER + FS_LABEL_ROOM : 0;
      return { rowKey: platePin.partName, partName: platePin.partName, wallCode, front, profile, detail, dims, datum, padBelow, hasAsMounted: ringF && parseInches(wallCfg[wallCode]?.topHole) != null };
    }).filter(r => !r.missing);
    return { rows, axes, measured };
  }, [allowedNodesFor, wallCfg, sideNodesFor, side]);

  // One page's rows, combo-aware: a combined basics sheet builds each arm's own rows — its own
  // rod set, its own projection — and stacks them. Cached per SUB page, so narrowing in and out
  // of the combined sheet never rebuilds what a single sheet already drew.
  // ⚠ SITS BELOW buildRows AND MUST — the useCallback deps array evaluates where it is WRITTEN
  // (the temporal-dead-zone trap, fourth sighting in this codebase).
  const builtRowsFor = useCallback((page) => {
    const subs = page.combo || [page];
    let first = null;
    const rows = [];
    for (const sub of subs) {
      let b = rowCacheRef.current[sub.key];
      if (!b) {
        b = buildRows(sub.bracketPin, sub.familyPins, { isIM: sub.isIM, isTraverse: sub.isTraverse, isReturn: sub.kind === 'RETURN', isCeiling: sub.mount === 'CEILING', ringPins: sub.ringPins, riderPins: sub.riderPins, rodNodes: sub.rodNodes, projIn: sub.projIn, projTiers: sub.projTiers });
        rowCacheRef.current[sub.key] = b;
      }
      if (!first) first = b;
      rows.push(...b.rows.map(r => ({ ...r, __arm: sub.bracketPin.partName })));
    }
    return { ...first, rows };
  }, [buildRows]);

  // ---- wall-mounts reference page: every unique wall-mount style at 1:1 ----
  const buildWallMounts = useCallback(() => {
    if (wallMountsRef.current) return wallMountsRef.current;
    const scene = sceneRef.current;
    const poleNodes = sideNodesFor('POLE');
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
  }, [pages, sideNodesFor, wallCfg]);

  // ---- catalog page: the finials + accessories this leaf offers, at 1:1, L × Ø dims ----
  const buildCatalog = useCallback((itemPairs = []) => {
    const cacheKey = itemPairs.map(x => x.pin.choiceNode).join('|');
    if (finialsRef.current?.key === cacheKey) return finialsRef.current.items;
    const scene = sceneRef.current;
    const poleNodes = sideNodesFor('POLE');
    const pole = poleNodes.length ? extractWorldMeshes(scene, poleNodes) : [];
    // companionsFor reads projTiers/tier off NORMALIZED choices — resolve once for the page.
    const norm = engineChoices ? (resolveHardware({ choices: engineChoices, answers: {}, selectedIds: [] }).choices || []) : [];
    const items = [];
    let views = null;
    for (const { choice, pin } of itemPairs) {
      let meshes = extractWorldMeshes(scene, [pin.choiceNode]);
      if (!meshes.length) continue;
      // ── A TWO-PART ACRYLIC FINIAL IS DRAWN WHOLE (Stuart 2026-08-23) ────────────────────
      // "the acrylic finials need to be shown with the collars, they are tagged that way on
      //  1.6/cpq." The collar is never a choice — it is the companion of the finial that
      // requires it (companionsFor, the same call the configurator and the BOM make), so the
      // catalog asks the same question and draws the pair as one item.
      if (choice?.requiresCollar) {
        for (const col of companionsFor(norm, [String(choice.id)])) {
          const colPin = pinForChoice(col);
          if (colPin) meshes = [...meshes, ...extractWorldMeshes(scene, [colPin.choiceNode])];
        }
      }
      if (!views) {
        const axes = inferAxes(pole.length ? pole : meshes, meshes);
        views = makeViews(axes);
      }
      const view = renderHiddenLine(meshes, views.front, 400);
      const b = viewBbox(meshes, views.front);
      items.push({ partName: pin.partName, view, wIn: (b.maxU - b.minU) * M2IN, hIn: (b.maxV - b.minV) * M2IN });
    }
    finialsRef.current = { key: cacheKey, items };
    return items;
  }, [sideNodesFor, engineChoices, pinForChoice]);

  const composeCatalogPage = useCallback((page, paper) => buildItemsGridPage({
    title: `${baseAssembly?.itemName || baseAssembly?.itemId} — Finials${page?.family ? ` · ${page.family}` : ''}`,
    subtitle: 'Every finial, once, from the front, at actual size. Socket depth is hidden geometry — add it with the manual dim tool.',
    items: buildCatalog(page?.itemPins || []).map(f => ({ code: rowCode(f.partName), view: f.view, wIn: f.wIn, hIn: f.hIn })),
    paper: paper || layoutPaper,
    footerNote: reducedNote,
  }), [buildCatalog, rowCode, layoutPaper, reducedNote, baseAssembly?.itemName, baseAssembly?.itemId]);

  const composeWallMountsPage = useCallback((paper) => buildWallMountsPage({
    title: `${baseAssembly?.itemName || baseAssembly?.itemId} — Wall mounts`,
    items: buildWallMounts(),
    noteLines: ['Top-hole offsets come from the Wall mounts panel and drive the as-mounted dims.'],
    paper: paper || layoutPaper,
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
        const built = builtRowsFor(page);
        // GEOMETRY vs CELL (playbook 4.2, warn-only): the measured pole Ø / projection must agree
        // with what the selected dia×proj cell CLAIMS (sizeMatrix inches). The sheet still renders
        // — borrowing geometry is sometimes deliberate — but it stops doing so silently. This was
        // the most likely silent failure of the H1 mass load (a ¾" file registered under 1-3/8").
                const rows = editionRows(built.rows, page.bracketPin.partName);
        const anyAsMounted = rows.some(r => r.hasAsMounted);
        const titleCode = (page.combo || [page])
          .map(s => (edition === 'FAB' ? (fabCodeFor(s.bracketPin.partName) || s.bracketPin.partName)
            : edition === 'CUST' ? (custCodeFor(s.bracketPin.partName) || s.bracketPin.partName)
            : s.bracketPin.partName))
          .join(' + ');
        // The subtitle says what this page IS: the CPQ leaf it belongs to, and how many plates the
        // engine paired with the arm — or, when there are none, the engine's own reason.
        const nPlates = (page.familyPins || []).length;
        const famLabel = [page.family, page.plateFamily, nPlates ? `${nPlates} plate${nPlates === 1 ? '' : 's'}` : (page.reason || 'drawn alone')]
          .filter(Boolean).join(' · ');
        const result = buildPageSvg({
          title: `${baseAssembly.itemName || baseAssembly.itemId} — ${titleCode}`,
          subtitle: `${editionLabel} · ${famLabel}`,
          rows,
          manualDims: manualDims.filter(d => d.pageKey === page.key),
          noteLines: [
            ...(anyAsMounted ? [AS_MOUNTED_NOTE] : []),
            RING_NOTE,
          ],
          paper: layoutPaper,
          footerNote: reducedNote,
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
  }, [shownPages, pageIndex, edition, manualDims, wallCfg, builtRowsFor, rowCode, fabCodeFor, custCodeFor, editionLabel, editionRows, assembly, error, layoutPaper, reducedNote, composeWallMountsPage, composeCatalogPage, baseAssembly]);

  // wall config affects measures → invalidate the caches when it changes
  useEffect(() => { rowCacheRef.current = {}; wallMountsRef.current = null; finialsRef.current = null; }, [wallCfg, side]);

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
  // Prints what you are looking at — the narrowed set, not all seventy. Each page carries its
  // OWN paper (the auto rule): portrait standard, landscape for the wide double sheets, so the
  // binder set prints mixed and the output lane turns the landscape ones onto the portrait page.
  const buildAllPages = () => shownPages.map((page) => {
    try {
    if (page.kind === 'WALLMOUNTS') return { svg: composeWallMountsPage('letterP').svg, paper: 'letterP' };
    if (page.kind === 'CATALOG') return { svg: composeCatalogPage(page, 'letterP').svg, paper: 'letterP' };
    const built = builtRowsFor(page);
    const rows = editionRows(built.rows, page.bracketPin.partName);
    const titleCode = (page.combo || [page])
      .map(s => (edition === 'FAB' ? (fabCodeFor(s.bracketPin.partName) || s.bracketPin.partName)
        : edition === 'CUST' ? (custCodeFor(s.bracketPin.partName) || s.bracketPin.partName)
        : s.bracketPin.partName))
      .join(' + ');
    // The subtitle says what this page IS: the CPQ leaf it belongs to, and how many plates the
    // engine paired with the arm — or, when there are none, the engine's own reason.
    const nPlates = (page.familyPins || []).length;
    const famLabel = [page.family, page.plateFamily, nPlates ? `${nPlates} plate${nPlates === 1 ? '' : 's'}` : (page.reason || 'drawn alone')]
      .filter(Boolean).join(' · ');
    const pagePaper = paperFor(page);
    return {
      svg: buildPageSvg({
        title: `${baseAssembly.itemName || baseAssembly.itemId} — ${titleCode}`,
        subtitle: `${editionLabel} · ${famLabel}`,
        rows,
        manualDims: manualDims.filter(d => d.pageKey === page.key),
        noteLines: [
          ...(rows.some(r => r.hasAsMounted) ? [AS_MOUNTED_NOTE] : []),
          RING_NOTE,
        ],
        paper: pagePaper,
        footerNote: reducedNote,
      }).svg,
      paper: pagePaper,
    };
    } catch (e) {
      // One page that cannot draw does not cost you the other sixty-nine.
      console.error('SpecSheet page skipped', page.key, e);
      return null;
    }
  }).filter(Boolean);

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
          <div style={{ display: 'flex', gap: '4px' }} title="Which hand the sheet draws — the other side is its mirror, so only one is needed">
            <button style={side === 'LEFT' ? btnOn : btn} onClick={() => setSide('LEFT')}>Left</button>
            <button style={side === 'RIGHT' ? btnOn : btn} onClick={() => setSide('RIGHT')}>Right</button>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button style={edition === 'H1' ? btnOn : btn} onClick={() => setEdition('H1')}>H1 codes</button>
            <button style={edition === 'FAB' ? btnOn : btn} onClick={() => setEdition('FAB')}>Fabricut codes</button>
            <button style={edition === 'CUST' ? btnOn : btn} onClick={() => setEdition('CUST')}
              title="Print with a customer's own part numbers (their SKUs from 4.6) — parts they have no SKU for keep our number.">
              Customer #s
            </button>
            {edition === 'CUST' && (
              <select value={custKey} onChange={e => setCustKey(e.target.value)} style={{ padding: '5px', fontSize: '0.8rem', maxWidth: '190px' }}>
                <option value="">— pick customer —</option>
                {custOptions.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            )}
          </div>
          <div style={{ display: 'flex', gap: '4px' }} title="8.5×11 binder pages — portrait is the standard; a double is a wide drawing, so its sheets turn landscape automatically. Click to override the page you are on.">
            <button style={layoutPaper === 'letterP' ? btnOn : btn} onClick={() => setPaperMode('P')}>8.5×11 ↕</button>
            <button style={layoutPaper === 'letter' ? btnOn : btn} onClick={() => setPaperMode('L')}>8.5×11 ↔</button>
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
            : bleed.length ? (
              <span style={{ color: '#b00020' }} title={bleed.map(b => `${b.subject} · ${b.part}: ${b.why}`).join('\n')}>
                ⚠ {bleed.length} part{bleed.length === 1 ? '' : 's'} on {new Set(bleed.map(b => b.page)).size} sheet{new Set(bleed.map(b => b.page)).size === 1 ? '' : 's'} the engine would not offer there — first: {bleed[0].subject} · {bleed[0].part} ({bleed[0].why}). Hover for the rest.
              </span>
            )
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
