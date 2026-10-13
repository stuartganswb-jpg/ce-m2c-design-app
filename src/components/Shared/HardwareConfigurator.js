import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds } from '@react-three/drei';
import { DynamicModel, ViewCapturer } from '../HQ/CPQTab';
import { StudioRig } from './studioScene';
import { resolve as resolveHardware, diagnose as diagnoseHardware, projectionAudit, reseatPicks, recommendedQty, takesQty, bearingEnds, companionsFor, ROD_ROLES } from './hardwareModel';
import { TraverseConfiguratorPanel } from './TraverseConfiguratorModal';
import { traverseAnswersMissing, drawLabel } from './traverseDraw';
import { seedFromVision } from './visionBridge';
import { seedFromKit } from './kitSeed';
import { droppedPicks, mergeDrops, unacknowledged } from './pickDrops';
import { autoPicksOf } from './hardwareAutoPicks';
import { normalizeExtras } from './extrasRestore';
import { rodMaterialsOf, extrasForRod, liveExtrasOf, noSpliceNote } from './flowExtras';
import { shopNotesOf, clientNotesOf } from './lineShopNotes';
import { SCOPE, scopeTargetsOf, scopeInForce, swatchActionOf, highlightOf } from './finishScope';
import { kitBracketPicksOf, kitBracketSummary } from './kitBracketPicks';
import { workIsPristine } from './cpqWorkspace';
import { renderScaleOf } from './sizeMatrix';
import { modelNodesOf } from './hardwareAdapter';
import { partIndexOf, partIn, ourNumberOf, sizeStepsOf, sizeSelOf, sizeIndexOf, choicesAtSize, sizeProjInchesOf, answersAtSize, settle,
    lengthInchesOf, lengthFeetExactOf, lengthFeetOf, lengthFieldsOf, bracketAdviceOf, recommendedFor, quantitiesOf, resolvedOf,
    spliceCodesAmong, singleSpliceOf, spliceLimitOf, spliceIsNeeded, sameItem, spliceIsSatisfied, withRequiredSplice,
    globalFinishOf, finishIndexOf, withGlobalFinish, wearsAsTwinFinish, wearsFinishOf, globalFinishForChoice, chosenListOf, partFinishByPartOf, armFinishOfChoice,
    finishForChoice, matchFinishOverrideOf, rodFinishForChoice, followsRodChoice, subFinishForChoice, lineFinishForChoice, textureOverridesOf, chosenFinishObjectsOf,
    bareWoodOf, clientFinishNameOf, offeredFinishesOf, finishGroupsOf, finishGroupLabel,
    driveOf, priceCtxOf, kitFromSaved, kitBillOf, carriersFromStepOf, pricingCtxOf, pricedOf, priceWarningsOf, askingFinishesOf, liveFinishAnswersOf, openFinishQuestionsOf,
    kitPartsByLineOf, extraLinesOf, isTraverseOf, trvFeetOf, trvTracksOf, trvPriceOfCode, trvItemInfoOf, trvSeedOf, trvComponentsOf, trvLinesOf, spliceOnLineOf, shipsInOnePieceOf,
    grandTotalOf } from './hardwareSession';
import { aliasFor } from './hardwarePricing';
import { priceLevelShort, customerPriceLevel } from './priceLevels';
import { findClientPriceRow, customerKeys } from './clientPricing';
import { indexForAssembly } from './partLookup.js';
import { handoffItem, customerLines } from './hardwareHandoff';
import { finishLabelOf } from './finishLabel';
import { unansweredOf } from './finishQuestions';
import { ftIn, FABRIC_CLASSES } from './bracketSpan';
import { renderThumbnails, cachedThumb } from './hardwareThumbs';
import { captureTransparentPng, saveGuideCapture } from './guideCapture';
import { BoardFrame, captureBoardFrame, readDisplayMode, writeDisplayMode } from './displayFrame';   // DISPLAY MODE (S5, Stuart 2026-09-13) — one guarded block, see below

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE MASTER TEMPLATE (Stuart 2026-08-17)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "just get a new master template that works 100% as long as the tags are correct, then all we
//  have to do to the old is check the tags."
//
// So this is the whole configurator, and it has ONE input: the assembly's pins. No flow document,
// no generated steps, no baked geometry map, nothing to regenerate and nothing that can go stale.
// The questions it asks and the parts it offers are derived from the tags every time it renders.
//
// ADDITIVE, FROM NOTHING. "i am fine with opening on single wall or even totally blank screen and
// work purely additive, that is how the portal renders, with just the pole at the start." Geometry
// is default-hidden and what you see is exactly the union of what you have chosen. Nothing is
// pre-answered, so nothing appears that you did not pick — which also means the failures that ate
// the weekend cannot occur here at all:
//   • a ghost cannot render, because an unclaimed mesh is never shown;
//   • two steps cannot fight over a part, because nothing vetoes — visibility only adds;
//   • a seeding bug cannot leave a bare position, because nothing is seeded;
//   • a stale bake cannot hide a corrected tag, because nothing is baked.
//
// FINISH AND PRICE (added 2026-08-17, once the geometry was trusted).
//
// FINISH has two modes and the FLOW chooses which, in tab 11: ONE finish for the whole
// configuration — the common case, one click — or a finish PER PART for orders that mix them.
// Either way a part tagged no-finish never takes one: the clear top of a two-part acrylic finial
// stays clear while its metal collar takes the finish, because that is what the parts are.
//
// PRICE is Shared/hardwarePricing, which COMPOSES the tiers in priceLevels and the per-customer
// rows in clientPricing rather than re-deriving either. Order: authored override → price level →
// customer row → item base. Every line says which rule set it, and a line no rule could price is
// called out rather than quietly reading as free.

const mono = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' };

const AXIS_LABEL = { rodKind: 'Rod Type', setup: 'Single or Double', drive: 'Drive', mount: 'Mount', proj: 'Bracket Projection', frontLayer: 'Front of the Double' };
const valueLabel = (axis, v) => {
    if (axis === 'proj') {
        const n = Number(v);
        const known = { 0.75: '.75"', 3.625: '3-5/8"', 4.625: '4-5/8"', 6: '6"' };
        return known[n] || `${n}"`;
    }
    // The two ways a double carries its front layer — said as the product, not as the tag.
    if (axis === 'frontLayer') return v === 'FASCIA' ? 'Stationary fascia with rings (one track)' : 'Traverse track front & rear';
    return String(v).charAt(0) + String(v).slice(1).toLowerCase();
};
const slotLabel = (s) => {
    const kind = s.kind === 'END' ? 'End Treatment' : s.kind.charAt(0) + s.kind.slice(1).toLowerCase().replace('_', ' ');
    const cap = (w) => `${w.charAt(0)}${w.slice(1).toLowerCase()}`;
    // On a double every rod asks its own questions, so the rail must say WHICH ROD — "Front Rod",
    // "Back Left End Treatment". Without it a double shows two identical headings and the operator
    // is answering one of them blind.
    // A single has ONE rod - saying Front/Back on it is noise (and on H1-75, whose only rod
    // is pinned BACK, it read as a rear-rod question on a single order). Doubles keep the word.
    const parts = [(s.tier && !s.tierSolo) ? cap(s.tier) : '', s.position ? cap(s.position) : '', kind].filter(Boolean);
    return parts.join(' ');
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE ENGINE FAILS ALONE (Stuart 2026-08-17: "once i hit new engine … goes full blank on me")
// ─────────────────────────────────────────────────────────────────────────────────────────────
// React unmounts the WHOLE tree when a render throws and nothing catches it — so one bad tag, one
// unexpected field shape, one part that isn't in the library takes the entire CPQ tab to a white
// screen. That is the worst possible failure for a tool being tested against real collections,
// because a white screen says nothing: it cannot be told from a hang, a bad deploy, or a lost
// session, and the one fact that would fix it in a minute — the error — is buried in a console
// nobody has open.
//
// So the engine is fenced. If it throws, it prints WHAT threw and WHERE, the rest of the tab keeps
// working, and Retry re-mounts it once the underlying data changes. This is a permanent fixture,
// not scaffolding: the whole premise of the rebuild is that a tag can be wrong, and a wrong tag
// must produce a message, never a blank page.
class EngineBoundary extends React.Component {
    constructor(props) { super(props); this.state = { err: null, info: null }; }
    static getDerivedStateFromError(err) { return { err }; }
    componentDidCatch(err, info) { this.setState({ info }); console.error('[hardware engine]', err, info); }
    render() {
        if (!this.state.err) return this.props.children;
        const e = this.state.err;
        const where = String(this.state.info?.componentStack || '').split('\n').filter(Boolean).slice(0, 4).join('\n');
        return (
            <div style={{ border: '1px solid #b00020', background: '#fff', padding: '16px', fontFamily: 'var(--mono)', fontSize: '11px', color: '#b00020', lineHeight: 1.6 }}>
                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '8px' }}>The new engine stopped — the rest of the tab is fine</div>
                <div style={{ color: 'var(--ink)', fontSize: '12px', marginBottom: '10px' }}>{e.name}: {e.message}</div>
                {where && <pre style={{ color: 'var(--ink-soft)', fontSize: '9.5px', whiteSpace: 'pre-wrap', margin: '0 0 10px' }}>{where}</pre>}
                {e.stack && <details><summary style={{ cursor: 'pointer', color: 'var(--ink-soft)', fontSize: '9.5px' }}>Full stack</summary>
                    <pre style={{ color: 'var(--ink-faint)', fontSize: '9px', whiteSpace: 'pre-wrap' }}>{e.stack}</pre></details>}
                <button onClick={() => this.setState({ err: null, info: null })}
                    style={{ marginTop: '10px', padding: '6px 12px', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink)' }}>Retry</button>
            </div>
        );
    }
}

function HardwareConfiguratorInner({
    assembly, pins, isSuperAdmin = false,
    finishes = [], parts = [], customer = null, customerId = '', priceLevel = 'STANDARD',
    outsourceCodes = [], onAdd = null, onCheckout = null, cartCount = 0, flow = null, spanMap = {}, spanCaps = {}, extraItems = [], flowFinishes = [], trvRules = null, visionDraft = null, reopenSeed = null,
    // Quick Ship kits this assembly could be started from. Empty on every flow that has none, and
    // the picker does not render — so a collection with no kits is untouched by all of this.
    kits = [],
    kitsUnaligned = 0,
    kitSeedDiag = null,
    // Publishes { choices, answers, index } so the part-lookup box ABOVE this component can judge a
    // part against the live configuration. Read-only: the engine tells, it is never told.
    onEngineState = null,
    // Publishes the configuration IN PROGRESS so CPQ can keep it across a tab switch or a reload
    // (Shared/cpqWorkspace) — the operator's own picks, in the shape a cart line's engineConfig keeps,
    // so it comes back through reopenSeed like an Edit. Read-only too: nothing here listens back.
    onWorkState = null,
}) {
    const [answers, setAnswers] = useState({});
    const [picks, setPicks] = useState({});     // slot key -> choice id
    const [kitPick, setKitPick] = useState('');      // the kit chosen as a starting point
    const [kitSource, setKitSource] = useState(null);  // { code, name, baseFeet, record } — bills as line 1
    const [kitReport, setKitReport] = useState(null);  // what it carried, missed, or refused
    // A KIT FILLS IN ITS OWN BRACKETS (Stuart 2026-10-01 · Shared/kitBracketPicks). Armed only by a kit the
    // operator STARTS from — a line reopened from the cart keeps the picks it was saved with — and each
    // (slot, part) is filled once, so a pick the operator changes or clears stays as they left it.
    const kitPicksArmedRef = useRef(false);
    const kitPicksDoneRef = useRef(new Set());
    const [kitMotor, setKitMotor] = useState('');      // the per-motor code chosen for a MOTORIZED kit (folds into the kit line)
    // The Traverse components selection. Declared HERE, above the pricing memos that read it (a const in
    // a temporal dead zone is a ReferenceError — this file has been taken out by that twice).
    // WHAT THE RENDERER ACTUALLY PAINTED (Stuart 2026-09-20) — counts from DynamicModel, shown in the
    // panel header. Change-guarded: a fresh object every pass would re-render forever.
    const [paintAudit, setPaintAudit] = useState(null);
    const handlePaintAudit = useCallback((p) => setPaintAudit(prev => (prev && prev.wood === p.wood && prev.finish === p.finish && prev.clear === p.clear && prev.raw === p.raw) ? prev : p), []);
    const [trvSel, setTrvSel] = useState(null);
    const [showDiag, setShowDiag] = useState(false);
    const [showGeo, setShowGeo] = useState(false);   // the untagged-node list, behind its count
    const [whySlot, setWhySlot] = useState(null);   // slot key whose exclusions are being read
    // ── WHAT A LATER CHOICE REMOVED (Stuart 2026-09-10: "never a silent clear … refuse add until
    // acknowledged"). The picks are filtered through the live options (no sweep — see the model
    // memo), so a pick a later answer invalidates simply stops showing. This list is the reader
    // that says so: one entry per removal with the engine's reason; the strip under the rail shows
    // it, and "+ Add configuration" refuses while any entry is unacknowledged.
    const [drops, setDrops] = useState([]);
    // ONE DEFAULT PER MATERIAL, held side by side; `globalFinish` is the one code for the readers that want one
    // (hardwareSession.globalFinishOf — the rule and his words are there).
    const [globalFinishes, setGlobalFinishes] = useState({});   // { METAL: 'P14', WOOD: 'S11', … }
    const globalFinish = globalFinishOf(globalFinishes);
    const [poleIn, setPoleIn] = useState('');            // finished length, whole inches
    const [poleFrac, setPoleFrac] = useState('');        // …and the fraction
    const [fabricId, setFabricId] = useState('PRINT');   // drives the span, so it is asked here
    const [thumbs, setThumbs] = useState({});            // choice id → data URL
    const [partFinish, setPartFinish] = useState({});   // choice id -> finish code (per-part mode)
    // ⚠ DECLARED HERE, WITH THE REST OF THE STATE, AND NOT WHERE THEY ARE USED. Both of these are
    // read by memos near the top of the component; sitting further down next to the JSX that edits
    // them put them in the temporal dead zone, and `const` in a TDZ is a ReferenceError, not
    // undefined — which React answers by unmounting the whole tree. That is the white screen from
    // 2026-08-17: "once i hit new engine … goes full blank on me". Every hook lives in this block.
    const [stepNotes, setStepNotes] = useState({});   // step key → note, stamped with the step
    // step key → true: this note is ALSO the customer's (prints on their quote, order and invoice). Off by default —
    // a note is the shop's until somebody ticks it (Stuart 2026-10-01 · Shared/lineShopNotes.clientNotesOf).
    const [stepNoteClient, setStepNoteClient] = useState({});
    // [{ code, qty, note }] — added by hand, AS TYPED. What bills is `extras` below: these, less any
    // item that does not fit the chosen rod (Shared/flowExtras).
    const [typedExtras, setExtras] = useState([]);
    // ── THE SPLICE, DECLINED (Stuart 2026-10-01: "at 12 ft it needs and recommends one but we need to
    // be able to make it 0 just in case and have it allow it with warning"). Over the one-piece limit
    // the length step adds the joiner and used to put it straight back when it was removed. Setting it
    // to 0 now STICKS: this flag stops the re-add, the step and the pricing panel say the pole ships
    // in one piece, and the line carries that to the floor as a shop note. Saved with the line
    // (engineConfig.spliceWaived) so Edit or a reopen does not quietly put the splice back.
    const [spliceWaived, setSpliceWaived] = useState(false);
    // What a finish asks of the order (Shared/finishQuestions — solid brass: brushed or polished, lacquered or not):
    // one answer per finish for the whole configuration. { LBR: { Surface: 'Polished', Coating: 'Lacquered' } }
    const [finishAnswers, setFinishAnswers] = useState({});
    // What a swatch click applies to, when the operator has switched it on THIS step: { step, scope } (Shared/finishScope).
    const [scopePick, setScopePick] = useState(null);
    const [drawnSplices, setDrawnSplices] = useState([]);   // [{ distInches, ref }] — where Vision drew them, for the pencil line
    // How many, per decision. Empty means "use the recommendation"; a typed number always wins.
    const [stepQty, setStepQty] = useState({});       // slot key → count

    // ⚠ HOISTED ABOVE priceCtx (2026-08-20). Rod stock prices by the foot, so the price context
    // needs the billed feet — and a const read before its declaration is a ReferenceError, not
    // undefined, which React answers by unmounting the tree. That is the white screen of
    // 2026-08-17. These depend only on the poleIn/poleFrac state at the top, so they belong here.
    // ── LENGTH, AND WHAT IT IMPLIES ──────────────────────────────────────────────────────────
    // Typed the way an installer measures — whole inches and a fraction — and the FOOT figure is
    // derived, because feet is what prices. One typed number, one shown consequence, no chance of
    // the two disagreeing.
    // (How the two fields become inches, and inches the billed feet — rounded UP — is hardwareSession's.)
    const lengthInches = useMemo(() => lengthInchesOf(poleIn, poleFrac), [poleIn, poleFrac]);
    const lengthFeetExact = lengthFeetExactOf(lengthInches);
    const lengthFeet = lengthFeetOf(lengthInches);


    // ── OUR PART NUMBER, RESOLVED ─────────────────────────────────────────────────────────────
    // This sits ABOVE the bracket advice on purpose. `advice` names ourId in its dependency list,
    // and a dependency list is read the moment the line runs — so with ourId still declared down in
    // the pricing section the whole configurator died on render with "Cannot access ... before
    // initialization" (2026-08-21). A `const` is not hoisted the way a function is; anything a hook
    // depends on has to be declared before it, not merely somewhere in the same component.
    //
    // ── THE WORKING-OUT LIVES IN Shared/hardwareSession (Stuart 2026-10-12, the portal rebuild) ───
    // How a part is found, which part a pin points at for the size chosen, and how the picks settle
    // were worked out here, where only this screen could run them. The customer portal is being
    // rebuilt on this engine, so they moved — the code AND his words that explain each rule — into
    // one module this screen, the portal and the portal's server all call. Nothing was re-thought.
    const partIndex = useMemo(() => partIndexOf(parts), [parts]);
    const findPart = useCallback((id) => partIn(partIndex, id), [partIndex]);
    // OUR part number (`legacyErpId`), never the app's own record id — see hardwareSession.ourNumberOf.
    const ourId = useCallback((id) => ourNumberOf(findPart(id), id), [findPart]);

    // ONE FLOW, EVERY DIAMETER — the swap happens on the CHOICE (hardwareSession.choicesAtSize).
    const sizeSteps = useMemo(() => sizeStepsOf(flow), [flow]);
    const [sizePick, setSizePick] = useState({});       // size step id -> optId
    const sizeSel = useMemo(() => sizeSelOf(flow, sizePick, sizeSteps), [flow, sizePick, sizeSteps]);
    const sizeIndex = useMemo(() => sizeIndexOf(sizeSel, parts), [sizeSel, parts]);
    const choices = useMemo(() => choicesAtSize({ assembly, pins, sizeSel, sizeIndex, findPart }), [assembly, pins, sizeSel, sizeIndex, findPart]);
    const sizeProjInches = useMemo(() => sizeProjInchesOf(sizeSel), [sizeSel]);
    const effAnswers = useMemo(() => answersAtSize(answers, sizeProjInches), [answers, sizeProjInches]);
    const modelNodes = useMemo(() => modelNodesOf(assembly), [assembly]);

    // The same re-seat serves BOTH the settling (hardwareSession.settle) and the live picks the UI
    // reads, so what renders, what is billed and what shows as chosen can never disagree about
    // which pin won.
    const resolvePicks = useCallback((m, raw) => reseatPicks(m, raw), []);

    const model = useMemo(() => settle({ choices, answers: effAnswers, picks, modelNodes }), [choices, effAnswers, picks, modelNodes]);

    // An answer higher up can invalidate a pick below it — choose the traverse rod and the standard
    // arm you had chosen is not offered any more. Rather than police that with a sweep (the thing
    // that deadlocked twice), the picks are simply FILTERED THROUGH the live options at render
    // time: a pick that is no longer offered is not shown as chosen and contributes no geometry.
    // Nothing to clear, nothing to re-seed, no order of operations to get wrong.
    // ── THE PICKS MADE ON THE OPERATOR'S BEHALF — Shared/hardwareAutoPicks (2026-09-29) ──────────
    // The tracks STEP 1 decided (Stuart 2026-08-31) and the traverse ends the drive answer named
    // (2026-08-21, never before a traverse rod is chosen: 2026-08-29). The rules and his words live
    // in that module now, so the spec sheets settle a set-up exactly as this screen does.
    const { settledKeys, livePicks } = useMemo(
        () => autoPicksOf({ model, answers, operatorPicks: resolvePicks(model, picks) }),
        [model, answers, picks, resolvePicks]);
    useEffect(() => {
        const now = droppedPicks(model, picks, livePicks, { labelOf: slotLabel });
        setDrops(prev => {
            const next = mergeDrops(prev, now);
            const same = next.length === prev.length && next.every((d, i) => d.key === prev[i].key && d.acked === prev[i].acked && d.reason === prev[i].reason);
            return same ? prev : next;
        });
    }, [model, picks, livePicks]);
    const pendingDrops = useMemo(() => unacknowledged(drops), [drops]);
    const ackDrop = (key) => setDrops(prev => prev.map(d => d.key === key ? { ...d, acked: true } : d));
    // ── THE ADD-BY-HAND ITEMS FOR THE ROD CHOSEN (Stuart 2026-09-30 · Shared/flowExtras) ────────
    // "we do need the ability to add a different splice/joiner for each rod type". A tab-11 item
    // may name the rod materials it is for; one that does not fit the chosen rod is not offered,
    // not auto-added and not billed — filtered here, never deleted, like a pick that is no longer
    // offered, so the row the operator typed comes back with the rod it belongs to. Blank = any
    // rod. Declared here, below livePicks and above the splice block that reads it (TDZ).
    const rodMats = useMemo(() => rodMaterialsOf(model.choices, Object.values(livePicks)), [model, livePicks]);
    const offeredExtraItems = useMemo(() => extrasForRod(extraItems, rodMats), [extraItems, rodMats]);
    const extras = useMemo(() => liveExtrasOf(typedExtras, extraItems, rodMats), [typedExtras, extraItems, rodMats]);
    // IS A SPLICE NECESSARY? Available at any length, mandatory over the flow's limit, added by the length
    // step itself only when there is ONE joiner to choose from — the rule and his words are hardwareSession's.
    const spliceCodesIn = useCallback((items) => spliceCodesAmong(items, findPart), [findPart]);
    const spliceCodes = useMemo(() => spliceCodesIn(offeredExtraItems), [spliceCodesIn, offeredExtraItems]);
    const spliceCode = singleSpliceOf(spliceCodes);
    const spliceOverIn = spliceLimitOf(flow);
    const spliceNeeded = spliceIsNeeded(spliceCodes, lengthInches, spliceOverIn);
    const sameItemCode = useCallback((a, b) => sameItem(a, b, findPart), [findPart]);
    const spliceSatisfied = spliceIsSatisfied(spliceCodes, extras, sameItemCode);
    useEffect(() => {
        if (!spliceNeeded || !spliceCode || spliceWaived) return;   // several candidates → the operator picks · declined → it stays off
        setExtras(a => withRequiredSplice(a, spliceCode, sameItemCode));
    }, [spliceNeeded, spliceCode, spliceWaived, extras, sameItemCode]);
    // The one sentence every refusal says — the same words on the button and in the strip.
    const dropRefusal = pendingDrops.length
        ? `${pendingDrops.length} selection${pendingDrops.length === 1 ? ' was' : 's were'} removed by a later choice — read the strip under the rail and press Understood on each before adding.`
        : '';


    // ── A VISION DRAWING ARRIVES AS ANSWERS (Stuart 2026-08-21) ──────────────────────────────
    // Vision is where the job is ENGINEERED — the bay measured, the returns drawn, the brackets and
    // plates chosen against the projection. CPQ quotes what was engineered, and that handoff spoke
    // only to the old engine: a resumed draft becomes flow-step params this engine does not have.
    // Opening the new engine on one would have shown an empty configurator with every engineered
    // decision quietly gone.
    //
    // ⚠ APPLIED ONCE PER DRAWING, NOT ON EVERY RENDER. The seed is the drawing's answers, not a
    // lock: the operator may change any of them afterwards, and re-applying would fight them. So it
    // fires on the draft ID changing and never again.
    const [visionReport, setVisionReport] = useState(null);
    const seededRef = useRef('');
    // ── SEND TO GUIDE (Stuart 2026-08-25) ────────────────────────────────────────────────────
    // The r3f state, captured at Canvas creation so the button can re-render the scene at a
    // boosted pixel ratio with a transparent background (Shared/guideCapture).
    const glStateRef = useRef(null);
    const captureRef = useRef(null);   // the 3D pane's snapshot function, once the canvas is up
    const [guideCapBusy, setGuideCapBusy] = useState(false);
    // ── DISPLAY MODE (Stuart 2026-09-13, built by S5 with his go-ahead — ONE guarded block) ──
    // "set the cpq window mode into display creator, then set the scale … so we could zoom and set
    // them to go as close to the edge of the display as we would like." A board frame at true
    // scale over the pane (Shared/displayFrame); Add configuration captures exactly the frame and
    // stamps it on the cart line as `displaySnapshot` + `displayBoard` for the 5. Marketing
    // designer. Off = the configurator exactly as before.
    const [displayMode, setDisplayMode] = useState(readDisplayMode);
    const frameOverlayRef = useRef(null);
    const frameReadingRef = useRef(null);
    const frameRectRef = useRef(null);
    const trueScaleSnapRef = useRef(null);
    // The frame is pinned to the pane; the hardware moves inside it (Stuart's first test). The
    // reading says what the drawn rod measures on this board; ⌖ True scale dollies to its inches.
    const onBoardFrameRect = useCallback((rect) => {
        frameRectRef.current = rect;
        const el = frameOverlayRef.current; if (!el) return;
        if (!rect) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = `${rect.x}px`; el.style.top = `${rect.y}px`; el.style.width = `${rect.w}px`; el.style.height = `${rect.h}px`;
        const rd = frameReadingRef.current; if (!rd) return;
        const off = rect.reading != null && rect.trueInches != null && Math.abs(rect.reading - rect.trueInches) > 0.25;
        rd.textContent = rect.reading == null ? 'nothing drawn yet' : `rod reads ${rect.reading.toFixed(1)}"${rect.trueInches != null ? ` · true ${rect.trueInches}"` : ''}${off ? ' · off scale' : rect.trueInches != null ? ' · ✓' : ''}`;
        rd.style.color = off ? '#b02d20' : 'var(--brass)';
    }, []);
    const setDisplayModeAndKeep = (patch) => setDisplayMode(m => { const v = { ...m, ...patch }; writeDisplayMode(v); return v; });
    const handleSendToGuide = async () => {
        if (guideCapBusy) return;
        const dataUrl = captureTransparentPng(glStateRef.current, { scale: 3 });
        if (!dataUrl) return alert('The 3D view is not ready to capture yet.');
        setGuideCapBusy(true);
        try {
            const label = finishLabelOf(chosenFinishObjects);
            const name = `${assembly?.itemName || flow?.name || 'CPQ CAPTURE'}${label ? ` — ${label}` : ''}`;
            const saved = await saveGuideCapture({
                dataUrl, name,
                code: assembly?.legacyErpId && assembly.legacyErpId !== 'PENDING' ? assembly.legacyErpId : (assembly?.itemId || flow?.id || ''),
                // No operator identity reaches this component — the gallery shows 'Unknown'.
                brandId: flow?.brandId || '', collection: '', user: '',
            });
            alert(`📸 Saved to the Asset Gallery as "${saved.id.slice(0, 40)}…"\n\nOpen tab 1 → Guide Books → Images to place it on a page.`);
        } catch (e) { console.error('guide capture failed', e); alert('Capture failed: ' + (e.message || e)); }
        setGuideCapBusy(false);
    };
    useEffect(() => {
        const id = visionDraft?.id || '';
        if (!id || seededRef.current === id) return;
        if (!model.slots.length) return;              // pins still loading — try again next render
        seededRef.current = id;
        const seed = seedFromVision({
            model, draft: visionDraft, flow,
            // Identity is OURS, not the bridge's: a Vision id may be a library doc id while a pin
            // carries the item number. Same tolerant resolution the cards and quote lines use.
            sameId: (a, b) => {
                if (!a || !b) return false;
                if (String(a).trim().toUpperCase() === String(b).trim().toUpperCase()) return true;
                const pa = findPart(a), pb = findPart(b);
                return !!(pa && pb && pa.id === pb.id);
            },
            // The bridge settles in passes the way resolve() does (a return unlocks that end's
            // rtn-only plate) — it borrows OUR resolver so the model it retries against is the
            // same one the picks will actually produce.
            resolveWith: ({ answers: a2, selectedIds }) =>
                resolveHardware({ choices, answers: { ...effAnswers, ...a2 }, selectedIds, modelNodes }),
            // The report prints OUR number, like every other number on this screen.
            nameOf: ourId,
        });
        if (Object.keys(seed.answers).length) setAnswers(a => ({ ...a, ...seed.answers }));
        if (Object.keys(seed.picks).length) setPicks(p => ({ ...p, ...seed.picks }));
        // ── THE DRAWN SPLICES ARRIVE AS THE EXTRA THEY BILL AS (Eric 2026-08-25) ─────────────
        // Two splices drawn at 36" from each end must land on the order as the flow's joiner with
        // their locations in the note — that note is the same contract the length step banner
        // states ("Vision draws the splice where the note says"), read in the other direction.
        if ((seed.splices || []).length) {
            setDrawnSplices(seed.splices.map(sp => ({ distInches: sp.distInches, ref: sp.ref || '' })));
            // The joiner for the rod THE DRAWING chose — its picks land in state only after this
            // pass, so the rod is read from them here, not from the screen (Shared/flowExtras).
            const seedRodMats = rodMaterialsOf(model.choices, Object.values({ ...picks, ...seed.picks }));
            const seedSpliceCodes = spliceCodesIn(extrasForRod(extraItems, seedRodMats));
            if (seedSpliceCodes.length === 1) {
                const code = seedSpliceCodes[0];
                const posTxt = seed.splices.map(sp => sp.note
                    || (sp.distInches != null ? `${sp.distInches}" from ${sp.ref === 'END' ? 'right edge' : 'left edge'}` : 'center')).join(' · ');
                setExtras(prev => (prev.some(x => x.code === code && Number(x.qty) > 0) ? prev
                    : [...prev.filter(x => x.code !== code), { code, qty: String(seed.splices.length), note: posTxt }]));
                seed.carried.push(`${seed.splices.length} splice${seed.splices.length > 1 ? 's' : ''} — ${posTxt}`);
            } else {
                seed.missed.push({
                    what: `${seed.splices.length} drawn splice${seed.splices.length > 1 ? 's' : ''}`,
                    why: seedSpliceCodes.length
                        ? 'several joiners fit this flow — add the right size below, with the drawn locations in the note'
                        : 'no splice/joiner item is offered on this flow — curate one in tab 11 or tag the joiner item',
                });
            }
        }
        if (seed.lengthInches) {
            const whole = Math.floor(seed.lengthInches);
            const frac = seed.lengthInches - whole;
            setPoleIn(String(whole));
            setPoleFrac(frac > 0.001 ? String(Math.round(frac * 16)) + '/16' : '');
        }
        if (visionDraft.sidemark) setConfigMemo(visionDraft.sidemark);
        setVisionReport({ carried: seed.carried, missed: seed.missed, name: visionDraft.sidemark || 'the drawing' });
        // seededRef guards re-entry; the extra deps only matter on the first fire for a draft.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visionDraft, model, flow, findPart, choices, effAnswers, modelNodes, spliceCodesIn, extraItems]);

    // ── STARTING FROM A KIT (Stuart 2026-08-22) ──────────────────────────────────────────────
    // "if a customer orders a standard kit in a standard finish we will use tab 7 … but if they
    // want any customization then they come to cpq."
    //
    // Deliberately NOT an effect. Seeding happens in the handler, once, because the operator asked
    // for it — so there is no dependency array to get wrong, nothing that can re-fire while they
    // work, and nothing declared below the memos that read it. (A const in a temporal dead zone is
    // a ReferenceError, and that has taken this engine out twice.)
    //
    // It SEEDS, it does not lock: a customer who has reached CPQ is by definition deviating from
    // the kit, so every answer stays editable. And picks need no reseating by hand — resolve()
    // runs reseatPicks on every model, exactly as the Vision seed relies on.
    const applyKit = (id) => {
        setKitPick(id);
        setKitMotor('');
        kitPicksArmedRef.current = false;
        kitPicksDoneRef.current = new Set();
        if (!id) { setKitReport(null); setKitSource(null); return; }
        const chosen = kits.find(k => String(k.id || k.legacyErpId || '') === id);
        if (!chosen) return;
        const name = String(chosen.legacyErpId || chosen.itemName || 'the kit');
        const seed = seedFromKit({ model, kit: chosen });
        // A REFUSAL WRITES NOTHING. A kit the assembly cannot build would otherwise seed every
        // answer it CAN honour and look more convincing the more of it landed.
        if (seed.blocked) { setKitReport({ name, blocked: seed.blocked, carried: [], missed: [] }); setKitSource(null); return; }
        if (Object.keys(seed.answers).length) setAnswers(a => ({ ...a, ...seed.answers }));
        if (Object.keys(seed.picks).length) setPicks(p => ({ ...p, ...seed.picks }));
        // ⚠ THE KIT'S 4 FT IS A STARTING POINT, NEVER AN OVERWRITE (Stuart 2026-09-19, QUO155 row 6: an
        // 18" display re-picked its kit and came back 48" — the shop would have cut four feet). The kit
        // seeds its length only where none has been typed; a typed length stands, and the bill follows
        // the rule either way (the kit below 4 ft, the kit + extra feet above it).
        if (seed.lengthInches && !String(poleIn || '').trim()) { setPoleIn(String(Math.floor(seed.lengthInches))); setPoleFrac(''); }
        // The brackets are filled in now, not reported: the strip says what the kit will pick, and the old
        // "pick the V backplate" instruction is dropped where the kit names its own (Shared/kitBracketPicks).
        const fills = kitBracketSummary({ kit: chosen });
        setKitReport({ name, blocked: null,
            carried: fills ? [...seed.carried, fills] : seed.carried,
            missed: fills ? seed.missed.filter(m => m.what !== 'bracket style') : seed.missed });
        kitPicksArmedRef.current = true;
        // The kit now OWNS the first line of the bill, and the feet above its base set bill under
        // it. Held as the record, not a number: the price is resolved at pricing time through the
        // same rules every other line uses (customer row, level, alias) rather than re-derived.
        setKitSource({ code: name, name: chosen.itemName || name, baseFeet: Number(chosen.manufacturingSpecs.kitAlign.minFeet) || 4, record: chosen });
    };

    // The bracket recommendation from 6.5's engineering, how many of each the length asks for, and the
    // counts the operator typed over them — hardwareSession (bracketAdviceOf / recommendedFor / quantitiesOf).
    const advice = useMemo(() => bracketAdviceOf({ model, livePicks, lengthInches, spanMap, spanCaps, fabricId, ourId }),
        [model, livePicks, lengthInches, spanMap, spanCaps, fabricId, ourId]);
    // Read by both the seeding below and the field's placeholder, so what is billed and what is shown
    // can never drift apart.
    const recommendFor = useCallback((slot, choice) => recommendedFor({ slot, choice, advice, model, livePicks, lengthFeet }),
        [advice, model, livePicks, lengthFeet]);
    const quantities = useMemo(() => quantitiesOf({ model, livePicks, stepQty, lengthFeet, recommendFor, trvRules, ourId }),
        [model, livePicks, stepQty, lengthFeet, recommendFor, trvRules, ourId]);

    // ── THE KIT'S BRACKETS, PICKED AS THEY BECOME ANSWERABLE (Stuart 2026-10-01: "it should prepopulate
    // ideally the steps … with the bracket selections in the kit … i had to manually select vertical
    // backplates and it is expressly stated in the kit"). Real picks, in order: the arm once the
    // projection is answered, then — on the next pass, when the arm holds its position — the plate in
    // the kit's orientation. Declared HERE, below recommendFor (a dependency read above its const is a TDZ
    // ReferenceError — the white screen this file has had twice). An effect because the plate slots only exist after the arms are chosen;
    // bounded because each (slot, part) is filled once. The operator's own pick is never touched.
    useEffect(() => {
        if (!kitSource || !kitSource.record || !kitPicksArmedRef.current) return;
        const add = kitBracketPicksOf({ model, kit: kitSource.record, answers: effAnswers, livePicks,
            codeOf: (o) => ourId(o.partId) || o.name, done: kitPicksDoneRef.current,
            // The centre is filled only where the span WANTS one (recommendFor: null = not known yet, 0 = a
            // short pole held at both ends). Picked regardless it would count as one — above the kit's chart.
            wants: (slot) => String(slot.position || '').toUpperCase() !== 'CENTER' || recommendFor(slot) > 0 });
        const keys = Object.keys(add);
        if (!keys.length) return;
        keys.forEach(key => kitPicksDoneRef.current.add(`${key}|${add[key]}`));
        setPicks(p => ({ ...p, ...add }));
    }, [kitSource, model, effAnswers, livePicks, ourId, recommendFor]);

    const resolved = useMemo(
        () => resolvedOf({ choices, answers: effAnswers, livePicks, modelNodes, quantities }),
        [choices, effAnswers, livePicks, modelNodes, quantities]);
    const visibleOverrides = useMemo(() => {
        const o = {};
        resolved.visible.forEach(n => { o[String(n).toLowerCase()] = true; });
        return o;
    }, [resolved]);
    // 🧊 The clear parts, from the TAG — never from a mesh name. Passing this switches the renderer
    // off its hardcoded acrylic item-code list entirely for this configurator.
    const clearList = useMemo(() => [...resolved.clear].map(n => String(n).toLowerCase()), [resolved]);
    // ── N CENTRE BRACKETS RENDER AS N (Stuart 2026-09-09: "the old engine used to clone the center
    // bracket so if we added 2,3 etc the render added them, can we please bring back that feature
    // on the new engine"). The renderer never lost it — DynamicModel still spaces N copies of a
    // mesh set along a rail; the old engine fed it from the flow's clone step and this one fed it
    // nothing. The same spec, from the resolved model: the CENTER bracket pick (and its plate) as
    // the meshes, the bracket alone as the placement anchor, the chosen rod(s) as the rail, the
    // slot's quantity as the count. Count comes from `quantities` — typed, else the span advice.
    // THE RAIL IS THE WHOLE POLE AS DRAWN (Stuart 2026-09-09: "the 1st bracket is no longer in
        // the center it is off to the left"). A rod slot's pick is ONE piece of a pole modelled in
        // three (LEFT / CENTER / RIGHT), so spacing along the pick alone centred the bracket on a
        // piece. The rail is every rod-role node the render currently shows — all the pieces, and
        // only as long as the ends leave it (a return drops its end piece).
    const railNames = useMemo(() => {
        const shown = new Set([...resolved.visible].map(n => String(n).toLowerCase()));
        // The F-clip strip runs the length of the track (Stuart 2026-09-09: "it makes it appear
        // that the track is too short since it does not stretch") — a rider, not a rod, but it is
        // rail-length and stretches with the rail; carriers stay discrete pieces and spread.
        return [...new Set((model.choices || [])
            .filter(c => ROD_ROLES.includes(c.role) || c.role === 'FCLIP')
            .flatMap(c => c.nodes || [])
            .filter(n => shown.has(String(n).toLowerCase())))];
    }, [resolved, model]);
    // ── A LONG ORDER RENDERS LONG (Stuart 2026-09-09: "i am working on a long rod of 144in and it
    // will need 5 center brackets … the 5th overruns the left bracket and right bracket. can you
    // stretch the rod/pole when they are long?"). DynamicModel scales the pole meshes along their
    // axis to this length and moves everything else out with the ends; only when the order is
    // longer than the model, and only where the model reads as inches.
    const stretchSpec = useMemo(() => (lengthInches > 0 && railNames.length ? { railNames, lengthInches } : null), [railNames, lengthInches]);
    // ── A SPLICE IS DRAWN AS A PENCIL LINE (Stuart 2026-09-09: "any time there is a splice entered
    // it adds a fine line to show it … from cpq it would always be shown in the center, if the
    // splice is added in vision at an exact spot then ideally the rendering could show that").
    // Fractions along the rail, left to right: the drawing's positions where Vision placed them
    // (from the left edge = d / L, from the right = 1 − d / L), else one at the centre, N spread
    // evenly. Keyed on the flow's own splice item — the same detection the length step uses — so
    // every flow with a joiner gets the line. A picture of a decision already on the line.
    const spliceMarks = useMemo(() => {
        const count = extras.filter(x => spliceCodes.includes(x.code)).reduce((n, x) => n + (Number(x.qty) > 0 ? Number(x.qty) : 0), 0);
        if (!count) return [];
        const L = Number(lengthInches) || 0;
        const drawn = drawnSplices.filter(sp => sp && sp.distInches != null && L > 0)
            .map(sp => (String(sp.ref).toUpperCase() === 'END' ? 1 - Number(sp.distInches) / L : Number(sp.distInches) / L))
            .filter(f => Number.isFinite(f)).map(f => Math.min(0.98, Math.max(0.02, f)));
        if (drawn.length) return drawn.map(frac => ({ frac }));
        return Array.from({ length: count }, (_, i) => ({ frac: (i + 1) / (count + 1) }));
    }, [extras, spliceCodes, drawnSplices, lengthInches]);
    const cloneSpecs = useMemo(() => {
        const pickOf = (sl) => { const id = livePicks[sl.key]; return id ? (sl.options || []).find(x => x.id === id) || null : null; };
        const out = [];
        resolved.slots.forEach(sl => {
            if (sl.kind !== 'BRACKET' || String(sl.position || '').toUpperCase() !== 'CENTER') return;
            const o = pickOf(sl);
            if (!o || !(o.nodes || []).length) return;
            const plateSlot = resolved.slots.find(x => x.kind === 'BACKPLATE' && String(x.position || '').toUpperCase() === 'CENTER');
            const plate = plateSlot ? pickOf(plateSlot) : null;
            const count = Number(quantities[o.id]) || 1;
            out.push({ stepId: sl.key, meshNames: [...o.nodes, ...((plate && plate.nodes) || [])], anchorNames: [...o.nodes], railNames, count });
        });
        return out;
    }, [resolved, railNames, livePicks, quantities]);

    // ── WHICH FINISH EACH PART WEARS — the rules and his words are hardwareSession's (the portal rebuild, 2026-10-12):
    //    one default per material, a brass twin, the exception that travels by part, the plate that follows its arm,
    //    the track painted to match, the return that follows its pole, the stock colour, and the material gate on
    //    the bill and in the render. Each hook below is the hook it was, with the dependencies it had.
    const finishByCode = useMemo(() => finishIndexOf(finishes), [finishes]);
    // A single code lands in its material's slot (seeds, restores); blank clears every default.
    const setGlobalFinish = useCallback((code) => setGlobalFinishes(g => withGlobalFinish(g, code, finishByCode)), [finishByCode]);
    const twinWear = useCallback((c, f) => wearsAsTwinFinish(c, f, findPart), [findPart]);
    const wearsFinish = useCallback((c, f) => wearsFinishOf(c, f, twinWear), [twinWear]);
    const globalFinishFor = useCallback((c) => globalFinishForChoice(c, { globalFinishes, finishByCode, twinWear }), [globalFinishes, finishByCode, twinWear]);
    const chosenList = useMemo(() => chosenListOf(resolved, livePicks), [resolved, livePicks]);
    const partFinishByPart = useMemo(() => partFinishByPartOf(partFinish, model), [partFinish, model]);
    const armFinishOf = useCallback((c) => armFinishOfChoice(c, { resolved, livePicks, partFinish, partFinishByPart }), [resolved, livePicks, partFinish, partFinishByPart]);
    const finishFor = useCallback((c) => finishForChoice(c, { partFinish, armFinishOf, globalFinishFor }), [partFinish, armFinishOf, globalFinishFor]);
    const matchFinishOverride = useMemo(() => matchFinishOverrideOf({ extras, findPart, chosenList, finishFor, globalFinish, model, livePicks }),
        [extras, findPart, chosenList, finishFor, globalFinish, model, livePicks]);
    const rodFinishFor = useCallback((choice) => rodFinishForChoice(choice, { chosenList, partFinish, partFinishByPart, globalFinishFor }),
        [chosenList, partFinish, partFinishByPart, globalFinishFor]);
    const followsRod = useCallback((choice) => followsRodChoice(choice, findPart), [findPart]);
    const subFinishFor = useCallback((choice, part) => subFinishForChoice(choice, part, { findPart, finishByCode, rodFinishFor, globalFinish }),
        [findPart, finishByCode, rodFinishFor, globalFinish]);
    const lineFinishFor = useCallback((choice) => lineFinishForChoice(choice, { partFinish, partFinishByPart, armFinishOf, globalFinishFor, finishByCode, matchFinishOverride, followsRod, rodFinishFor, findPart, wearsFinish }),
        [partFinish, partFinishByPart, armFinishOf, globalFinishFor, finishByCode, matchFinishOverride, followsRod, rodFinishFor, findPart, wearsFinish]);
    // NODE → TEXTURE, over the visible set (hardwareSession.textureOverridesOf).
    const textureOverrides = useMemo(() => textureOverridesOf({ resolved, chosenList, finishByCode, finishFor, matchFinishOverride, followsRod, rodFinishFor, partFinish, wearsFinish }),
        [resolved, chosenList, finishByCode, finishFor, matchFinishOverride, followsRod, rodFinishFor, partFinish, wearsFinish]);

    // ── PRICE ─────────────────────────────────────────────────────────────────────────────────
    // OUR COST TO THEM IS THE DEFAULT, ONCE THERE IS A "THEM" — and the level is the CUSTOMER'S, not "any customer gets
    // Fabricut's" (Shared/priceLevels). What the price rules are handed is hardwareSession.priceCtxOf; the words are there.
    const { level: effectiveLevel, isDefault: levelIsDefault } = customerPriceLevel(customer, priceLevel);

    const priceCtx = useMemo(() => priceCtxOf({ customerId, customer, effectiveLevel, levelIsDefault, outsourceCodes, globalFinish, lineFinishFor, subFinishFor, findPart, finishByCode, flow, lengthFeet, lengthInches, drive: driveOf(answers.drive) }),
        [answers.drive, customerId, customer, effectiveLevel, levelIsDefault, outsourceCodes, globalFinish, lineFinishFor, subFinishFor, findPart, finishByCode, lengthFeet, lengthInches, flow]);
    // THE KIT A LINE IS BILLED FROM — followed to the mount answered, with what it has already paid for
    // (hardwareSession.kitBillOf). ONE description of the bill, used twice: the panel below and the cart item at Add.
    const kitBill = useMemo(() => kitBillOf({ kitSource, kits, priceCtx, customerId, customer, kitMotor, drive: answers.drive, proj: answers.proj, mount: answers.mount, trvRules, lengthFeet, findPart }),
        [kitSource, kits, priceCtx, customerId, customer, kitMotor, answers.drive, answers.proj, answers.mount, trvRules, lengthFeet, findPart]);
    // ONE SOURCE OF CARRIERS: once the components step names a carrier style, the pinned rider leaves the bill
    // (hardwareSession.carriersFromStepOf / pricingCtxOf / pricedOf — the kit transform only where a kit was chosen).
    const carriersFromStep = carriersFromStepOf(trvSel);
    const pricingCtx = useMemo(() => pricingCtxOf(priceCtx, carriersFromStep), [priceCtx, carriersFromStep]);
    const priced = useMemo(() => pricedOf(resolved, pricingCtx, kitBill), [resolved, pricingCtx, kitBill]);
    // Their number for any part, chosen or not — the picker is where it is most useful.
    const aliasOf = useCallback((id) => aliasFor(findPart(id), priceCtx), [findPart, priceCtx]);
    // Every part this assembly pins, searchable by either party's number. Built from the SAME pins
    // the steps are built from, so the panel can never describe a part the flow does not actually
    // offer — and reads the pin's tags, because a projection belongs to the pin, not the item.
    const lookupIndex = useMemo(
        () => indexForAssembly({ assembly, pins, flow, findPart, aliasCtx: priceCtx }),
        [assembly, pins, flow, findPart, priceCtx]);
    // ⚠ THE SEARCH BOX LIVES ABOVE THIS COMPONENT, BESIDE THE FLOW PICKER (Stuart 2026-09-03:
    // "can't we put it up top next to the flow choices as ideally we need it to decide which flow
    // to pick"). It has to be reachable BEFORE a flow is open — which is before this component
    // exists — so the panel cannot live in here. What it needs from the engine is the live
    // configuration to judge against, so that is published upward and nothing else changes.
    useEffect(() => {
        if (typeof onEngineState !== 'function') return;
        onEngineState({ choices, answers: effAnswers, index: lookupIndex });
    }, [onEngineState, choices, effAnswers, lookupIndex]);
    // The finishes this configuration actually wears (hardwareSession.chosenFinishObjectsOf) — RTG reads the label off this.
    const chosenFinishObjects = useMemo(() => chosenFinishObjectsOf(globalFinishes, partFinish, finishByCode), [globalFinishes, partFinish, finishByCode]);
    // A hidden part with no price is reported quietly; the finishes that ASK something, among those a line wears, and
    // only their answers travel; the parts each item-kit line brings (hardwareSession).
    const priceWarnings = useMemo(() => priceWarningsOf(priced), [priced]);
    const askingFinishes = useMemo(() => askingFinishesOf(priced, finishByCode), [priced, finishByCode]);
    const liveFinishAnswers = useMemo(() => liveFinishAnswersOf(askingFinishes, finishAnswers), [askingFinishes, finishAnswers]);
    const kitPartsByLine = useMemo(() => kitPartsByLineOf(priced), [priced]);
    // Added by hand — priced by the SAME chain as everything else; an unfinished item wears nothing, a paint-match fee
    // prices at the colour it buys (hardwareSession.extraLinesOf).
    const extraLines = useMemo(() => extraLinesOf({ extras, findPart, priceCtx, globalFinish, matchFinishOverride, livePicks }),
        [extras, findPart, priceCtx, globalFinish, matchFinishOverride, livePicks]);

    // ── TRAVERSE COMPONENTS ARE THE LAST QUESTION A TRACK ASKS — gated by the drive answer already given, seeded from the
    //    chart until the operator answers, billed where billable (hardwareSession; his words are there).
    const isTraverse = useMemo(() => isTraverseOf(model, livePicks), [model, livePicks]);
    const trvDrive = driveOf(answers.drive);
    const trvFeet = trvFeetOf(lengthFeet);
    const trvTracks = trvTracksOf(answers.setup);
    const trvPriceOf = useCallback((code) => trvPriceOfCode(code, findPart, priceCtx), [findPart, priceCtx]);
    const trvItemInfo = useCallback((code) => trvItemInfoOf(code, findPart, priceCtx), [findPart, priceCtx]);
    const trvSeed = useMemo(() => trvSeedOf({ trvRules, isTraverse, trvDrive, trvFeet, trvTracks }), [trvRules, isTraverse, trvDrive, trvFeet, trvTracks]);
    const trvLive = trvSel || trvSeed;
    const trvComponents = useMemo(() => trvComponentsOf({ trvRules, isTraverse, trvLive, trvDrive, trvFeet, lengthFeet, trvPriceOf }),
        [trvRules, isTraverse, trvLive, trvDrive, trvFeet, lengthFeet, trvPriceOf]);
    const trvLines = useMemo(() => trvLinesOf(trvComponents), [trvComponents]);

    // Over the limit with NO joiner on the line — from the length step or the traverse chart: allowed, and said
    // (hardwareSession.spliceOnLineOf / shipsInOnePieceOf); and what the configuration comes to.
    const spliceOnLine = spliceOnLineOf({ extras, spliceCodes, sameItemCode, trvComponents });
    const noSplice = shipsInOnePieceOf({ lengthInches, spliceOverIn, spliceCodes, isTraverse, trvRules, spliceOnLine });
    const grandTotal = grandTotalOf(priced, extraLines, trvComponents);



    const chosen = useMemo(() => {
        const ids = new Set(Object.values(livePicks));
        return [...model.choices.filter(c => ids.has(c.id)), ...model.riders];
    }, [model, livePicks]);

    const setAnswer = useCallback((k, v) => setAnswers(a => ({ ...a, [k]: a[k] === v ? undefined : v })), []);
    const setPick = useCallback((k, v) => setPicks(p => ({ ...p, [k]: p[k] === v ? undefined : v })), []);

    const diagnosis = useMemo(() => diagnoseHardware(model), [model]);
    // ── AND ONE QUESTION THE TAGS ALONE CANNOT ANSWER (Stuart 2026-08-21) ─────────────────────
    // "make sure the integration/handoff to the vision tool is aligned … brackets are all tagged
    // with projection which is what drives most of visions math and most important."
    //
    // Vision engineers from the ITEM's customData.projection; this engine gates by the PIN's tag.
    // Two fields, two tools, and a disagreement between them is a pole cut to the wrong length with
    // nothing on either screen to say so. It sits with the tag notes because that is where someone
    // looks when an assembly is behaving oddly — and it is read-only: it reports, it never repairs.
    const projNotes = useMemo(() => projectionAudit(
        model,
        (partId) => findPart(partId)?.manufacturingSpecs?.customData?.projection,
        // A flow that stamps its own projection overrides the item's field inside Vision, so a
        // blank item is not a fault under one. Same two fields Vision reads, in the same order.
        flow?.fabProjection !== undefined && flow?.fabProjection !== '' && flow?.fabProjection !== null
            ? flow.fabProjection : (flow?.impliedProjInches ?? null),
        // OUR number, never the doc id (Stuart 2026-08-21: "it is showing app internal id which i
        // have no idea what they are"). Same resolver the cards, the quote lines and the rail use.
        (partId) => ourId(partId),
    ), [model, findPart, flow, ourId]);
    // ── A QUESTION WITH ONE ANSWER IS NEVER ASKED, SO SAY WHAT IT ANSWERED (Stuart 2026-08-22) ─
    // An axis discovers its values from the tags, and ONE value makes it `implied`: applied
    // silently as the answer (activeAxes) and filtered out of the questions on screen. That is
    // right for a genuinely one-way collection — a manual-only track should not grow a Drive
    // question with one button. But it is also exactly what H1-1 looked like: 240 brackets with a
    // blank SETUP and only the 30 doubles tagged, so the assembly had ONE setup value, every quote
    // was silently a DOUBLE, and no "Single or Double" question ever appeared. Nothing on either
    // screen said so — the missing question is invisible precisely because it is missing.
    //
    // suggestSetupFromName can only ever seed DOUBLE (never SINGLE, deliberately — a false DOUBLE
    // hides a part from every single), so this is the standing shape of any assembly with doubles
    // until someone runs 1.6's "Finish the singles". Reporting it is not calling it a fault: it
    // states the decision the engine made without asking, and leaves the judgement to the reader.
    const impliedNotes = useMemo(() => (model?.axes || [])
        .filter(a => a.implied && Array.isArray(a.values) && a.values.length === 1)
        .map(a => ({
            sev: 'amber', kind: 'NOT ASKED',
            msg: `"${a.label}" is answered ${a.values[0]} on every order — only one value is tagged, so the question never appears. Tag a second value in 1.6 to make it a question.`,
        })), [model]);

    // ── THE IMPORTANT NOTE MUST NOT BE THE 250TH ─────────────────────────────────────────────
    // H1-138 reports 243 untagged nodes, and the thirteen projection notes sat underneath them
    // where nobody would ever scroll. Untagged geometry is ONE fact about the assembly — a list of
    // nodes nothing claims — so it is collapsed to one line that carries its own count, and the
    // notes that name a part stay where they can be read.
    const tagNotes = useMemo(() => {
        const geo = diagnosis.filter(d => d.kind === 'UNTAGGED GEOMETRY');
        const rest = diagnosis.filter(d => d.kind !== 'UNTAGGED GEOMETRY');
        return [...rest, ...projNotes, ...impliedNotes, ...(geo.length ? [{
            sev: 'amber', kind: 'UNTAGGED GEOMETRY', collapsed: geo,
            msg: `${geo.length} node(s) in the .glb that no choice claims — they never render. Tag them in 1.6 or remove them.`,
        }] : [])];
    }, [diagnosis, projNotes, impliedNotes]);
    const cadUrl = assembly?.manufacturingSpecs?.cadUrl;

    // ── THUMBNAILS, PHOTOGRAPHED FROM THIS ASSEMBLY'S OWN .GLB ───────────────────────────────
    // Only for the options ON SCREEN, and only the ones not already taken. A step of twenty costs
    // twenty single frames, once, and revisiting it costs nothing — so this can never become a
    // per-interaction tax the way the Doctor briefly did.
    const onScreen = useMemo(() => {
        const seen = new Set(); const out = [];
        model.slots.forEach(sl => sl.options.forEach(o => {
            if (seen.has(o.id) || !o.nodes.length) return;
            seen.add(o.id); out.push({ key: o.id, nodes: o.nodes });
        }));
        return out;
    }, [model]);
    // Re-fire on CONTENT change, not array identity - `onScreen` is rebuilt every render, and
    // keying the effect on it re-launched the photo batch dozens of times while the first was
    // still running. Each launch made its own WebGL renderer: contexts exhausted, the main
    // canvas lost its context (the blank viewer), and thumbnails photographed on a dead context
    // cached as blanks (the sometimes-they-render bug). The queue in hardwareThumbs is the
    // other half of this fix.
    const onScreenKey = useMemo(() => onScreen.map(g => g.key).join('|'), [onScreen]);
    const onScreenRef = useRef(onScreen);
    onScreenRef.current = onScreen;
    useEffect(() => {
        const groups = onScreenRef.current;
        if (!cadUrl || !groups.length) return;
        let live = true;
        // Anything already cached paints on the first pass; the rest arrive one frame at a time.
        const seed = {};
        groups.forEach(g => { const c = cachedThumb(cadUrl, g.nodes); if (c !== undefined) seed[g.key] = c; });
        if (Object.keys(seed).length) setThumbs(t => ({ ...seed, ...t }));
        renderThumbnails(cadUrl, groups, (k, data) => { if (live) setThumbs(t => (t[k] === data ? t : { ...t, [k]: data })); });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cadUrl, onScreenKey]);

    const chip = (active, disabled) => ({
        ...mono, padding: '8px 12px', cursor: disabled ? 'not-allowed' : 'pointer',
        background: active ? 'var(--ink)' : '#fff', color: active ? '#fff' : (disabled ? 'var(--ink-soft)' : 'var(--ink)'),
        border: `1px solid ${active ? 'var(--ink)' : 'var(--line)'}`, opacity: disabled ? 0.4 : 1, textAlign: 'left',
    });

    // ── EVERY DECISION IS A STEP (Stuart 2026-08-17) ─────────────────────────────────────────
    // The rail carries the whole product; the panel carries only what is being decided now. An
    // answered step shows its ANSWER, so nothing has to be re-opened to check what it was.
    //
    // Backplates do not get a step of their own — a plate is chosen WITH its arm, so it nests
    // inside the bracket step, which is also where the pairing rules can be seen doing their work.
    const steps = useMemo(() => {
        const out = [];
        // ── THE FRAMING QUESTIONS ARE ONE STEP (Stuart 2026-08-20) ───────────────────────────
        // "combine steps 1, 2 and 3 into one step … below the rod type box another box for single
        //  or double and then another box below that for mount … that will help keep the rail from
        //  being too long as well."
        //
        // Rod type, single-or-double, drive and mount are all the same kind of question: how is
        // this rod framed, before a single part is chosen. Each is two or three chips, so each was
        // spending a whole step and a whole rail cell on one line of buttons.
        //
        // ⚠ BRACKET PROJECTION IS NOT ONE OF THEM and keeps its own step. It is the one axis with
        // consequences — it gates which brackets exist, and pairs the plates to the arm — so it is
        // a decision, not framing. Grouping everything BELOW it also means nothing is reordered:
        // projection already sorts last of the axes, so the group is the contiguous block in front
        // of it and every question stays exactly where it was.
        // ⚠ THE SIZE QUESTIONS LEAD, because everything after them is a different part. On a
        // combined flow the diameter is the first thing asked and the projection second — the same
        // order, and the same option lists, the old engine asks them in. A collection with no size
        // matrix has no size steps and nothing here changes.
        sizeSteps.forEach(st => out.push({ kind: 'SIZE', key: `size:${st.id}`, sizeStep: st, label: st.title }));
        const liveAxes = model.axes.filter(a => !a.implied && a.values.length > 1)
            // …and the matrix's projection IS the projection question. Asking the tag axis as well
            // would put the same question on screen twice, with two different vocabularies.
            .filter(a => !(a.key === 'proj' && sizeProjInches != null));
        const framing = liveAxes.filter(a => a.key !== 'proj');
        if (framing.length === 1) {
            const a = framing[0];
            out.push({ kind: 'AXIS', key: `axis:${a.key}`, axis: a, label: AXIS_LABEL[a.key] || a.key });
        } else if (framing.length) {
            out.push({ kind: 'AXES', key: 'axes:framing', axes: framing, label: 'Rod Setup' });
        }
        liveAxes.filter(a => a.key === 'proj')
            .forEach(a => out.push({ kind: 'AXIS', key: `axis:${a.key}`, axis: a, label: AXIS_LABEL[a.key] || a.key }));
        const plates = model.slots.filter(s => s.kind === 'BACKPLATE');
        const nested = new Set();
        model.slots.filter(s => s.kind !== 'BACKPLATE').forEach(s => {
            if (!s.options.length && !s.suppressedBy) return;
            if (settledKeys.has(s.key)) return;      // answered by the drive — see settledKeys
            // ── A TRACK END IS NEVER A STEP (Stuart 2026-09-06) ────────────────────────────
            // "can't we remove steps 14+15 for the track ends since these are decided when
            //  choosing manual or motorized — there is no reason to have them as steps … they are
            //  chosen in step one and do not need their own steps as there are no options."
            // A settled end was already skipped (one option → auto-picked, above). A SUPPRESSED
            // front end on a fascia-front double still drew as "not asked", and an end with two
            // options — drive not yet answered — drew as a question that step one answers. None of
            // those is a decision made here. The pick still happens: the drive answer settles it
            // and livePicks carries it, so the end still renders and bills.
            if (s.kind === 'TRV_END') return;
            // A plate belongs to the arm that carries it. Normally that is the bracket — but when a
            // RETURN has taken that end the bracket step is suppressed, and the return is the arm
            // (see bracketAt in hardwareModel), so the plate travels to the END step instead. Left
            // under the suppressed bracket it rendered nowhere and the plate could not be chosen.
            const plateHere = () => plates.find(p => (p.position || '') === (s.position || ''));
            let sub = null;
            if (s.kind === 'BRACKET' && !s.suppressedBy) sub = plateHere();
            else if (s.kind === 'END' && s.position) {
                const bkt = model.slots.find(x => x.kind === 'BRACKET' && (x.position || '') === (s.position || ''));
                if (!bkt || bkt.suppressedBy) sub = plateHere();
            }
            // A double has a front and a back end at each position; the plate is shared, so the
            // first to claim it keeps it rather than both drawing the same picker.
            if (sub && nested.has(sub.key)) sub = null;
            if (sub) nested.add(sub.key);
            out.push({ kind: 'SLOT', key: s.key, slot: s, sub, label: slotLabel(s) });
        });
        plates.filter(p => !nested.has(p.key) && p.options.length)
            .forEach(p => out.push({ kind: 'SLOT', key: p.key, slot: p, label: slotLabel(p) }));
        // ── PHASE 2 OF THE RESHUFFLE (Stuart 2026-08-20) ────────────────────────────────────
        // "after these selections will come pole length (as it helps determine # of brackets)
        //  then lastly the brackets and shared items."
        //
        // Length stops being the last thing asked and becomes the last thing asked BEFORE the
        // brackets, because it is an input to them: 6.5 ft of heavy blackout wants a different
        // number of arms than 6.5 ft of sheer, and the span advice from 6.5 cannot say so until it
        // knows the length. Asked afterwards, the advice arrived when the decision was already made.
        //
        // ── …AND FROM 2026-09-10 RIGHT AFTER THE ROD (Stuart: "right after rod choice should
        // be rod length that is just more natural, then carry on as is with the order"). Placed
        // by the ROD-kind steps (rod, fascia, track) rather than by a fixed index, so it lands
        // correctly whatever the collection offers; a collection with no rod step at all gets
        // it right after the Rod Setup axes, still before the ends.
        const lengthStep = { kind: 'LENGTH', key: 'length', label: 'Pole length' };
        let lastRod = -1, lastAxis = -1;
        out.forEach((st, i) => {
            if (st.kind === 'SLOT' && ROD_ROLES.includes(st.slot.kind)) lastRod = i;
            if (st.kind === 'AXIS') lastAxis = i;
        });
        if (lastRod >= 0) out.splice(lastRod + 1, 0, lengthStep);
        else if (lastAxis >= 0) out.splice(lastAxis + 1, 0, lengthStep);
        else out.push(lengthStep);
        // ── WHAT RIDES ON THE ROD IS ONE QUESTION (Stuart 2026-08-21) ───────────────────────
        // "if the selection for front track is track then the carriers should be presented at 13,
        // if the front is omitted then rings should be presented … it could made in one step since
        // there again is only one answer here."
        //
        // Rings and carriers are the same job done by two parts, and WHICH of them an order needs
        // was already decided upstairs: a track takes carriers, a fascia takes rings (carriesRings,
        // in the model). The engine has always known that — it builds the carriers as riders — but
        // it built them SILENTLY, so a double that chose the front track reached the end of the
        // walk having never been shown the things that will hang the drapery.
        //
        // So where there is no ring question, the carriers take that place in the walk and are
        // SHOWN rather than merely billed. It is not a decision — there is one answer and the drive
        // and the track already gave it — so nothing is asked; it is the step saying what is
        // included, at the count the length works out to.
        const ringSlot = out.find(st => st.kind === 'SLOT' && st.slot.kind === 'RING');
        const carriers = (model.riders || []).filter(r => r.role === 'CARRIER');
        if (!ringSlot && carriers.length) out.push({ kind: 'CARRIERS', key: 'carriers', label: 'Carriers', carriers });

        // …and the track's own components last of all, which is where they belong: every one of
        // them is a function of a decision above (the drive, the length, one track or two), so it
        // is the only step that can be asked once and asked correctly. No rules doc, no step — a
        // collection whose components have never been charted is not asked a question it cannot
        // answer, and says so on the step rather than offering an empty list.
        if (isTraverse && trvRules) out.push({ kind: 'TRV', key: 'traverse', label: 'Traverse components' });
        return out;
    }, [model, isTraverse, trvRules, sizeSteps, sizeProjInches, settledKeys]);

    // Rings-vs-track stopped being an omission the day it became a question (the frontLayer axis,
    // Stuart 2026-08-31) — so the track step no longer coaches "omit it". What it says instead is
    // the one fact the auto-picked card cannot: the stock finishes follow the fascia, and painting
    // to match is the upcharge (offered below via the flow's checkout items on this step).
    const hintFor = useCallback((st) => {
        if (!st || st.kind !== 'SLOT') return '';
        if (st.slot.kind === 'TRACK') return 'Chosen by the layout at Rod Setup. Comes in bronze or champagne to coordinate with the fascia — add the custom-finish upcharge to paint it to match.';
        return '';
    }, []);

    const [stepIx, setStepIx] = useState(0);
    // ── REOPENING A SAVED CONFIGURATION (Stuart 2026-08-28: "once we hit reopen there is no
    // data, all the selections are lost") ────────────────────────────────────────────────────
    // Edit on a TAGS cart line hands back the item's own engineConfig — the exact answers, picks,
    // per-part finishes, length, notes, memo and qty the walk produced. Applied ONCE per key (a
    // re-render or a model refresh must never stomp what the operator has since changed); picks
    // reseat against the live model exactly as the Vision and kit seeds rely on.
    const reopenAppliedRef = useRef(null);
    useEffect(() => {
        const s = reopenSeed;
        if (!s || !s.key || reopenAppliedRef.current === s.key) return;
        reopenAppliedRef.current = s.key;
        setAnswers({ ...(s.answers || {}) });
        setPicks({ ...(s.picks || {}) });
        setPartFinish({ ...(s.partFinish || {}) });
        setStepNotes({ ...(s.stepNotes || {}) });
        setStepNoteClient((s.stepNoteClient && typeof s.stepNoteClient === 'object') ? { ...s.stepNoteClient } : {});
        setStepQty({ ...(s.stepQty || {}) });   // operator-typed counts (rings, centre brackets) — defaults otherwise
        // Restored rows are re-keyed to the code THIS flow's add-by-hand list uses for the same
        // part, and duplicates merge — so the splice check below can never miss its twin and add
        // another (QUO147: one splice → three, Stuart 2026-09-11; Shared/extrasRestore).
        setExtras(normalizeExtras(Array.isArray(s.extras) ? s.extras : [], extraItems, findPart));
        setSpliceWaived(s.spliceWaived === true);   // a declined splice stays declined
        setFinishAnswers((s.finishAnswers && typeof s.finishAnswers === 'object') ? JSON.parse(JSON.stringify(s.finishAnswers)) : {});
        if (s.globalFinishes && typeof s.globalFinishes === 'object') setGlobalFinishes({ ...s.globalFinishes });
        else if (s.globalFinish) setGlobalFinish(s.globalFinish);
        { const typed = lengthFieldsOf(s.lengthInches); setPoleIn(typed.poleIn); setPoleFrac(typed.poleFrac); }   // whole inches + sixteenths
        setTrvSel(s.trvSel && typeof s.trvSel === 'object' ? { ...s.trvSel } : null);
        setConfigMemo(s.memo || s.sidemark || '');
        setCfgQty(String(parseInt(s.qty, 10) > 0 ? parseInt(s.qty, 10) : 1));
        // A WORKSPACE HANDED BACK AFTER A TAB SWITCH OR A RELOAD (Shared/cpqWorkspace) carries what an
        // in-progress walk holds beyond a cart line: the step it was on, the fabric weight, the size
        // picks, the splices a Vision drawing placed — and that its Vision draft was already seeded, so
        // the drawing is not laid over the operator's changes a second time. An Edit seed carries none
        // of these and opens exactly as it always has.
        setStepIx(Number.isInteger(s.stepIx) && s.stepIx > 0 ? s.stepIx : 0);
        if (s.fabricId) setFabricId(String(s.fabricId));
        if (s.sizePick && typeof s.sizePick === 'object') setSizePick({ ...s.sizePick });
        if (Array.isArray(s.drawnSplices)) setDrawnSplices(s.drawnSplices.map(sp => ({ distInches: sp.distInches, ref: sp.ref || '' })));
        if (s.visionSeededId) seededRef.current = String(s.visionSeededId);
    }, [reopenSeed]);
    // ── …AND THE KIT IT WAS BILLED FROM (Stuart 2026-09-19, QUO154 row 6) ────────────────────────
    // The kit was a dropdown pick that lived only in this component, so Edit → re-add brought back
    // every answer and NOT the kit: the $195 H1-2TRV-4/W line vanished and its parts billed one by
    // one — about $90 a board lower, silently. The pick now travels in engineConfig (`kitPick`); a
    // line saved before today names its kit on its own bill (`kitCode`, read by CPQ's Edit from the
    // saved kit row). Restored WITHOUT re-seeding — the saved answers are the truth, the kit only
    // owns the first line of the bill again. Waits for the kit list, applies once per reopen, and a
    // line that had no kit clears whatever kit the walk before it left behind.
    const kitRestoredRef = useRef(null);
    useEffect(() => {
        const s = reopenSeed;
        if (!s || !s.key || kitRestoredRef.current === s.key) return;
        const saved = kitFromSaved(kits, s);   // the kit the line names, found among this flow's kits (hardwareSession)
        if (saved.none) { kitRestoredRef.current = s.key; setKitPick(''); setKitMotor(''); setKitSource(null); setKitReport(null); return; }
        if (!kits.length) return;   // the list is still loading — this runs again when it lands
        kitRestoredRef.current = s.key;
        kitPicksArmedRef.current = false;   // a reopened line keeps the brackets it was saved with — nothing is re-filled
        if (saved.missing) {
            setKitPick(''); setKitMotor(''); setKitSource(null);
            setKitReport({ name: saved.missing, blocked: { what: 'This line was billed from that kit, and the kit is no longer offered on this flow', why: 'Pick a kit again, or the line bills part by part.' }, restore: true, carried: [], missed: [] });
            return;
        }
        setKitPick(saved.kitPick);
        setKitMotor(String(s.kitMotor || ''));
        setKitReport(null);
        setKitSource(saved.kitSource);
    }, [reopenSeed, kits]);
    const ix = Math.min(stepIx, Math.max(0, steps.length - 1));
    const step = steps[ix];
    // MASTER CONTROL (Stuart 2026-08-26): tab 11's item list IS what CPQ presents, and each item
    // names the STEP it belongs on (free-text match against the step label). Blank keeps the item
    // on the pole-length step, where these have always lived — so existing flows are unchanged.
    const extrasOnStep = (st) => (offeredExtraItems || []).filter(it => {
        const m = String(it.step || '').trim().toUpperCase();
        if (!m) return st?.kind === 'LENGTH';
        if (st?.kind === 'LENGTH' && /LENGTH|POLE/.test(m)) return true;
        const label = String(st?.label || '').toUpperCase();
        return !!label && (label.includes(m) || m.includes(label));
    });
    const stepExtras = extrasOnStep(step);
    const stepHint = hintFor(step);

    // What the rail shows under each heading: the answer, once there is one.
    const answerOf = useCallback((st) => {
        if (st.kind === 'AXIS') { const v = answers[st.axis.key]; return v == null || v === '' ? '' : valueLabel(st.axis.key, v); }
        // One cell, every answer in it — the rail still shows the whole product at a glance.
        if (st.kind === 'AXES') {
            return st.axes.map(a => {
                const v = answers[a.key];
                return v == null || v === '' ? '' : valueLabel(a.key, v);
            }).filter(Boolean).join(' \u00b7 ');
        }
        if (st.kind === 'SIZE') {
            const opt = (st.sizeStep.styleOptions || []).find(o => o.optId === sizePick[st.sizeStep.id]);
            return opt ? (opt.partName || opt.label || opt.optId) : '';
        }
        if (st.kind === 'CARRIERS') {
            const n = st.carriers.reduce((sum, c) => sum + (recommendedQty(c, lengthFeet) || c.qty || 1), 0);
            return n ? `${n} included` : 'included';
        }
        if (st.kind === 'LENGTH') return lengthFeet ? `${lengthFeet} ft` : '';
        // The rail says what was decided, so a traverse quote can be read back at a glance: the
        // carrier style is the decision, the count is the consequence.
        if (st.kind === 'TRV') {
            if (!trvLive?.carrierStyle) return '';
            const style = (trvRules?.usage || []).find(u => String(u.itemId || '').toUpperCase() === trvLive.carrierStyle);
            return `${style?.label || trvLive.carrierStyle} · ${trvComponents.length}`;
        }
        if (st.slot.suppressedBy) return 'not asked';
        const pick = st.slot.options.find(o => o.id === livePicks[st.slot.key]);
        return pick ? (ourId(pick.partId) || pick.name) : '';   // our number on the rail too
    }, [answers, livePicks, lengthFeet, ourId, trvLive, trvRules, trvComponents, sizePick]);

    // ── SEVERAL CONFIGURATIONS, ONE QUOTE ────────────────────────────────────────────────────
    // A room is a configuration; a job is several. Each is finished, memo'd and added, and the
    // strip is where you see what is already in and what it came to.
    const [configMemo, setConfigMemo] = useState('');
    // ⚠ HOW MANY OF THIS EXACT CONFIGURATION (Stuart 2026-08-26: "if customer wants 2 of the exact
    // config the last step is ask/enter this"). This is a MULTIPLIER on the whole build — 2 means
    // two complete identical sets of every part below, never a dimension. It rides the cart item as
    // `qty`, which every consumer already multiplies by (Shared/configQty: the floors print
    // "×7 each · 14 total", the NetSuite resolver pushes line qty × this, per-foot lines push
    // feet × this while the cut length stays per-piece — so 2 × an 8ft pole is two 8ft poles,
    // never a 2ft pole).
    const [cfgQty, setCfgQty] = useState('1');
    const cfgQtyN = Math.max(1, parseInt(cfgQty, 10) || 1);
    // NOTES BELONG TO THE STEP THE OPERATOR IS ON (Stuart 2026-08-17). A note typed while deciding
    // the right bracket is about the right bracket; filing them all into one box loses which
    // decision they were about, which is the only thing that makes them useful downstream.
    // EXTRAS — basic items added by hand: a splice, an extra ring, whatever the flow does not model.
    const [saved, setSaved] = useState([]);
    // ── THE WORK IN PROGRESS, PUBLISHED (Eric 2026-09-29 · Shared/cpqWorkspace) ──────────────
    // CPQ keeps it across a tab switch or a reload and hands it back through reopenSeed. Declared
    // HERE, below configMemo and cfgQty: a dependency read above its const is a TDZ ReferenceError —
    // the white screen this file has had twice. The operator's `picks`, never `livePicks`: an
    // auto-settled track or end restored as an operator pick would always win after the restore
    // (Shared/hardwareAutoPicks). Nothing is published while the work is still what a freshly opened
    // configurator holds, so a mount never overwrites the saved work it is about to be handed.
    const workPublishedRef = useRef(false);
    useEffect(() => {
        if (typeof onWorkState !== 'function') return;
        const work = {
            assemblyId: assembly?.id || '',
            answers, picks, partFinish, globalFinishes, globalFinish, stepQty, stepNotes, extras: typedExtras,
            lengthInches, memo: configMemo, qty: cfgQty,
            // The kit exactly as the handoff saves it: named only while it bills.
            kitPick: kitSource ? kitPick : '', kitMotor: kitSource ? kitMotor : '',
            trvSel, fabricId, sizePick, stepIx, drawnSplices, visionSeededId: seededRef.current || '',
            ...(spliceWaived ? { spliceWaived: true } : {}),
            ...(Object.keys(stepNoteClient).length ? { stepNoteClient } : {}),
            ...(Object.keys(finishAnswers).length ? { finishAnswers } : {}),
        };
        if (!workPublishedRef.current && workIsPristine(work)) return;
        workPublishedRef.current = true;
        onWorkState(work);
    }, [onWorkState, assembly, answers, picks, partFinish, globalFinishes, globalFinish, stepQty, stepNotes, typedExtras,
        lengthInches, configMemo, cfgQty, kitPick, kitMotor, kitSource, trvSel, fabricId, sizePick, stepIx, drawnSplices, spliceWaived, stepNoteClient, finishAnswers]);
    const addConfiguration = () => {
        if (!priced.lines.length) return;
        // ⚠ NEVER ADD SHORT (Stuart 2026-09-10). A removal nobody has acknowledged is an order that
        // would leave here missing a part the operator chose. The strip names it; Add waits.
        if (pendingDrops.length) return;
        // ⚠ WOOD WEARS A STAIN OR IT DOES NOT LEAVE HERE (Stuart 2026-09-16 — hardwareSession.bareWoodOf). The add names
        // the parts and waits; the WOOD row of the finish step (or the part's own swatch) is the answer.
        const bareWood = bareWoodOf(chosenList, finishFor);
        if (bareWood.length) {
            alert(`Pick the WOOD finish first — ${bareWood.map(c => c.name || c.partId).join(', ')} would leave here with no stain.\n\nChoose it on the WOOD row of the finish step, or on the part itself.`);
            return;
        }
        // A FINISH THAT ASKS IS ANSWERED BEFORE THE LINE LEAVES (Stuart 2026-10-06: "yes required"). Solid brass with
        // no word on brushed / polished, lacquered or not, is an order the floor cannot make.
        const openQuestions = openFinishQuestionsOf(askingFinishes, finishAnswers);
        if (openQuestions.length) {
            alert(`Answer the finish questions first — ${openQuestions.map(([a, m]) => `${a.code}${a.finish.name ? ` (${String(a.finish.name).trim()})` : ''}: ${m.join(', ')}`).join(' · ')}.\n\nThey are at the top of the finish panel and apply to the whole configuration.`);
            return;
        }
        // THE HANDOFF IS BUILT HERE, in the shape CPQ has always written — so the shop floor, the
        // finishing floor, RTG, the ERP push and the CRM documents all keep working without
        // knowing which engine produced the order. onAdd is what puts it in the cart; without one
        // the strip still works, so the configurator is usable before the cart is wired.
        // A picture of what was configured, taken as it is added — front view, white ground, ≤900px
        // JPEG (the same capturer the old engine used) — so the quotation and the sales order can
        // show the customer what they are ordering. Never blocks the add: no canvas, no picture.
        // The view AS SET — rotated / zoomed the way the operator left it (Stuart 2026-09-11), not a re-framed front.
        const renderSnapshot = (() => { try { const shots = captureRef.current ? captureRef.current({ current: true }) : null; return shots?.front || null; } catch { return null; } })();
        // DISPLAY MODE: the frame is the board — capture exactly it (transparent) for the designer.
        const displaySnapshot = (displayMode.on && frameRectRef.current) ? captureBoardFrame(glStateRef.current, frameRectRef.current, { scale: 1 }) : null;
        const displayBoard = displaySnapshot ? { widthIn: displayMode.widthIn, heightIn: displayMode.heightIn, lengthInches, readsInches: frameRectRef.current.reading != null ? Math.round(frameRectRef.current.reading * 10) / 10 : null } : null;
        const built = handoffItem(resolved, {
            ...pricingCtx, assembly, flow, findPart, qty: cfgQtyN, renderSnapshot,
            // The pins this line was resolved from — fingerprinted on the line so Approve can tell
            // when the tags have changed since the save (Shared/cartStaleness).
            pins,
            sidemark: configMemo, memo: configMemo,
            finishes: chosenFinishObjects, finishLabel: finishLabelOf(chosenFinishObjects),
            priceLevel: effectiveLevel, lengthInches, lengthFeet,
            // extraLines = the extras AS THE PANEL PRICED THEM (priceChoice, customer row) — the
            // handoff uses these verbatim so the docs, floors and NetSuite bill what was shown.
            // Filtered to extras actually TAKEN: extraLines coerces a 0 qty to 1 for display.
            extras, extraLines: extraLines.filter(l => Number((extras.find(x => x.code === l.partId && (x.slot || '') === (l.slot || '')) || {}).qty) > 0),
            stepNotes, answers, picks: livePicks, partFinish, globalFinish, globalFinishes, stepQty,
            // What the finishes were asked — written into each line's finish text, and kept for Edit.
            finishAnswers: liveFinishAnswers,
            // The kit, so the cart bills exactly what the panel showed — and WHICH kit, so Edit restores it.
            kit: kitBill, kitPick: kitSource ? kitPick : '', kitMotor: kitSource ? kitMotor : '',
            // The Traverse components answers (carrier style + count, draw, picks) — Edit restores them, or
            // a re-add would silently swap the chosen carriers back for the pinned ones.
            trvSel: (isTraverse && trvSel) ? trvSel : null,
            // The track's components, in the shape the cart has always carried them — the ERP push
            // reads `trvComponents` off the item and the documents read the breakdown rows, so
            // neither can tell which engine asked the question.
            trvComponents,
            // ── HOW IT OPENS, ON THE ORDER (Stuart 2026-08-22) ───────────────────────────────
            // Not a part and not a price — an instruction. The bench assembles the carriers to it
            // and hangs the master on the drawn side, so it has to reach the floor and the
            // paperwork, not just the screen it was answered on.
            traverseDraw: trvLive?.draw || '',
            traverseMotorSide: trvLive?.motorSide || '',
            // ── THE FROZEN RENDER (Stuart 2026-08-21) ────────────────────────────────────────
            // The shop floor, the finishing floor and the HQ work-order window re-render a saved
            // order from this and nothing else (Shared/ConfiguredItemViewer). The old engine wrote
            // it at add; without it a TAGS order opens to an empty canvas six weeks later, when the
            // assembly has moved on and nobody can reconstruct what was sold.
            //
            // ⚠ `defaultHidden` AND `clearNodes` TRAVEL WITH IT. This engine renders ADDITIVELY —
            // nothing is visible until it is chosen — so replaying the same overrides without that
            // flag would show the entire .glb, every option at once. The old engine's saved states
            // carry neither and behave exactly as they always have.
            renderState: cadUrl ? {
                cadUrl,
                textureEntries: Object.entries(textureOverrides || {}).map(([target, url]) => ({ target, url })),
                visibilityEntries: Object.entries(visibleOverrides || {}).map(([target, visible]) => ({ target, visible })),
                cloneSpecs,
                stretchSpec,
                spliceMarks,
                defaultHidden: true,
                clearNodes: clearList,
            } : null,
        });
        // ── WHAT THE SHOP IS TOLD, ON THE LINE THE SHOP READS (Stuart 2026-10-01 · Shared/lineShopNotes) ──
        // The note typed on each step ("Anything the shop needs to know about Pole length") was saved
        // for Edit and read by nothing else. It goes on the line's generalNotes — View Item prints
        // them, RTG stamps them on the shop order — under the step it was typed on. A pole over the
        // one-piece limit going out with no joiner leads the list, and carries the flag the reopen reads.
        const shopNotes = shopNotesOf({ steps, stepNotes, lead: noSplice ? [noSpliceNote(lengthInches, spliceOverIn)] : [] });
        // The notes ticked "show to the customer" also ride the line as clientNotes — CPQ's save writes them under
        // this configuration as display-only rows the money documents print. The ticks are saved for Edit.
        const clientNotes = clientNotesOf({ steps, stepNotes, visible: stepNoteClient });
        const ticked = Object.keys(stepNoteClient).length > 0;
        const item = (noSplice || shopNotes.length || ticked)
            ? { ...built,
                ...((noSplice || ticked) ? { engineConfig: { ...built.engineConfig, ...(noSplice ? { spliceWaived: true } : {}), ...(ticked ? { stepNoteClient: { ...stepNoteClient } } : {}) } } : {}),
                ...(shopNotes.length ? { generalNotes: shopNotes } : {}),
                ...(clientNotes.length ? { clientNotes } : {}) }
            : built;
        if (typeof onAdd === 'function') onAdd(displaySnapshot ? { ...item, displaySnapshot, displayBoard } : item);
        setSaved(s => [...s, { memo: `${configMemo || `Configuration ${s.length + 1}`}${cfgQtyN > 1 ? ` × ${cfgQtyN}` : ''}`, total: grandTotal * cfgQtyN, lines: customerLines(priced.lines).length }]);
        setConfigMemo(''); setCfgQty('1'); setPicks({}); setAnswers({}); setPoleIn(''); setPoleFrac('');
        kitPicksDoneRef.current = new Set();   // the next configuration fills its own brackets
        setStepNotes({}); setStepNoteClient({}); setExtras([]); setSpliceWaived(false); setDrawnSplices([]); setPartFinish({}); setFinishAnswers({}); setStepQty({}); setTrvSel(null); setStepIx(0); setDrops([]);
    };

    const railCell = (st, i) => {
        const ans = answerOf(st);
        const now = i === ix;
        return (
            <button key={st.key} onClick={() => setStepIx(i)} title={st.label}
                style={{
                    flex: '1 1 0', minWidth: '104px', textAlign: 'left', cursor: 'pointer',
                    padding: '8px 10px', borderRight: '1px solid var(--line)', border: 'none',
                    borderRightWidth: i === steps.length - 1 ? 0 : 1, borderRightStyle: 'solid',
                    background: now ? 'var(--ink)' : (ans ? 'var(--paper-2)' : '#fff'),
                    display: 'flex', flexDirection: 'column', gap: '3px', overflow: 'hidden',
                }}>
                <span style={{ ...mono, fontSize: '8.5px', color: now ? '#fff' : (ans ? 'var(--ink)' : 'var(--ink-soft)'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.label}</span>
                <span style={{ ...mono, fontSize: '8px', textTransform: 'none', letterSpacing: 0, color: now ? 'var(--brass)' : 'var(--ink-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ans || '—'}</span>
            </button>
        );
    };

    // One option card: the part, photographed, named three ways — description, our number, theirs.
    // ONE OPTION, NAMED THE WAY THE TRADE NAMES IT (Stuart 2026-08-17): our pattern id first, the
    // customer's own alias immediately beside it, and OUR DESCRIPTION underneath. The app's internal
    // record id was there before and means nothing to anybody on a phone call.
    const optionCard = (o, on, onClick) => {
        const line = priced.lines.find(l => String(l.partId).toUpperCase() === String(o.partId).toUpperCase());
        const part = findPart(o.partId);
        const desc = part?.itemName || o.name;
        return (
            <button key={o.id} onClick={onClick} style={{
                display: 'flex', flexDirection: 'column', gap: '5px', alignItems: 'stretch', textAlign: 'left',
                padding: '7px', cursor: 'pointer', background: on ? 'var(--paper-2)' : '#fff',
                border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, boxShadow: on ? 'inset 0 0 0 1px var(--ink)' : 'none',
            }}>
                <span style={{ height: '46px', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {thumbs[o.id]
                        ? <img src={thumbs[o.id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        : <span style={{ ...mono, fontSize: '7px', color: 'var(--ink-faint)' }}>{thumbs[o.id] === null ? 'no geometry' : '···'}</span>}
                </span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ ...mono, fontSize: '9.5px', textTransform: 'none', letterSpacing: '.02em', color: 'var(--ink)' }}>{ourId(o.partId)}</span>
                    {(line?.sku || line?.aliasCode || aliasOf(o.partId)) && <span style={{ ...mono, fontSize: '9px', textTransform: 'none', letterSpacing: '.02em', color: 'var(--brass)' }}>{line?.sku || line?.aliasCode || aliasOf(o.partId)}</span>}
                </span>
                <span style={{ fontSize: '10.5px', lineHeight: 1.25, color: 'var(--ink-soft)' }}>{desc}</span>
                {o.noFinish && <span style={{ ...mono, fontSize: '7.5px', color: 'var(--ink-faint)' }}>clear · takes no finish</span>}
            </button>
        );
    };

    const boxHead = (a, b) => (
        <div style={{ padding: '10px 13px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' }}>
            <span style={mono}>{a}</span>{b ? <span style={{ ...mono, fontSize: '8.5px', color: 'var(--brass)' }}>{b}</span> : null}
        </div>
    );
    const boxStyle = { background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: '230px' };
    // A FINISH IS NAMED, NOT JUST COLOURED — our code and the customer's own word for it (hardwareSession.clientFinishNameOf).
    const clientFinishName = useCallback((f) => clientFinishNameOf(f, customerId, customer), [customerId, customer]);
    const swatchRow = (list, sel, pick) => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(66px,1fr))', gap: '7px' }}>
            {list.map(f => {
                const code = String(f.code || f.name || '').toUpperCase();
                const url = f.textureUrl || f.finalImageUrl;
                const on = String(sel).toUpperCase() === code;
                const theirs = clientFinishName(f);
                return (
                    <button key={code} title={`${code}${f.name && f.name !== code ? ` — ${f.name}` : ''}${theirs ? ` · ${theirs}` : ''}`}
                        onClick={() => pick(on ? '' : code)}
                        style={{ padding: 0, cursor: 'pointer', border: `1px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: '#fff', display: 'flex', flexDirection: 'column', textAlign: 'left', outline: on ? '2px solid var(--ink)' : 'none', outlineOffset: '1px' }}>
                        <span style={{ height: '46px', background: url ? `url(${url}) center/cover` : '#ddd' }} />
                        <span style={{ padding: '3px 4px 4px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
                            <span style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: '.02em', color: 'var(--ink)' }}>{code}</span>
                            {theirs && <span style={{ ...mono, fontSize: '8px', textTransform: 'none', letterSpacing: 0, color: 'var(--brass)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{theirs}</span>}
                        </span>
                    </button>
                );
            })}
        </div>
    );
    // WHAT THIS FLOW OFFERS, GROUPED BY WHAT THE FINISH IS — Wood · Painted · Plated · Solid brass. Narrowed to the flow's
    // own list everywhere, then to what a chosen part can wear (hardwareSession.offeredFinishesOf / finishGroupsOf / finishGroupLabel).
    const offeredFinishes = useMemo(() => offeredFinishesOf(finishes, flowFinishes), [finishes, flowFinishes]);
    const finishGroups = useMemo(() => finishGroupsOf({ offeredFinishes, chosenList, wearsFinish }), [offeredFinishes, chosenList, wearsFinish]);
    const groupLabel = finishGroupLabel;

    // ── WHAT A SWATCH CLICK APPLIES TO ON THIS STEP (Shared/finishScope) ────────────────────────
    const stepOption = (step?.kind === 'SLOT' && livePicks[step.slot?.key]) ? (step.slot.options.find(x => x.id === livePicks[step.slot.key]) || null) : null;
    const stepCollar = (stepOption && stepOption.requiresCollar) ? (companionsFor(model.choices, [stepOption.id])[0] || null) : null;
    const scopeTargets = scopeTargetsOf({ option: stepOption, collar: stepCollar, wears: (c) => offeredFinishes.some(f => wearsFinish(c, f)) });
    const scopeNow = scopeInForce({ targets: scopeTargets, picked: scopePick, stepKey: step?.key || '', configFinishOf: globalFinishFor });
    const scopeTarget = scopeTargets.find(t => t.scope === scopeNow) || scopeTargets[scopeTargets.length - 1];
    const wearsMaterial = (c, mat) => wearsFinish(c, { material: mat });
    const pickSwatch = (mat, code) => {
        const a = swatchActionOf({ target: scopeTarget, material: mat, code, wearsMaterial });
        if (a.kind === 'PART') setPartFinish(pf => { const n = { ...pf }; if (a.code) n[a.id] = a.code; else delete n[a.id]; return n; });
        else setGlobalFinishes(gf => { const n = { ...gf }; if (a.code) n[mat] = a.code; else delete n[mat]; return n; });
    };
    const swatchSel = (mat) => highlightOf({ target: scopeTarget, material: mat, partFinish, configFinishOf: globalFinishFor, globalFinishes, wearsMaterial });
    const finishPanel = (
        <div style={{ ...boxStyle, minHeight: '0', position: 'sticky', top: '12px' }}>
            {boxHead('Finish', Object.keys(partFinish).length ? `${Object.keys(partFinish).length} exception(s)` : 'Whole configuration')}
            {/* Said once, where the decision is made — the two-click rule is not obvious from a
                grid of swatches, and an operator who does not know it quotes the whole rod in one
                finish when the customer asked for brass rings on a black pole. */}
            <div style={{ padding: '9px 13px', borderBottom: '1px solid var(--line)', background: 'var(--paper)', fontSize: '11px', lineHeight: 1.45, color: 'var(--ink-soft)' }}>
                Select a finish once for the whole configuration. On a part&rsquo;s step, a click changes
                <b> that part only</b> &mdash; the switch below says what a click applies to.
            </div>
            {/* ── WHAT A CLICK APPLIES TO (Stuart 2026-10-02 · Shared/finishScope) ─────────────────
                "when i change left to EP1 then right changes … this needs to work for all steps." The grid always
                set the whole configuration and the per-part row was at the bottom of the rail, off the screen. One
                grid, and this switch: this step's part (the default once the configuration has a finish for it), the
                collar a two-part finial brings, or the whole configuration. */}
            <div style={{ padding: '8px 13px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ ...mono, fontSize: '8.5px', color: 'var(--ink-soft)' }}>A click applies to</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                    {scopeTargets.map(t => (
                        <button key={t.scope} onClick={() => setScopePick({ step: step?.key || '', scope: t.scope })}
                            title={t.scope === SCOPE.WHOLE ? 'Every part that wears this finish' : 'Only this part — the rest of the configuration keeps its finish'}
                            style={{ ...chip(t.scope === scopeNow), textTransform: 'none', letterSpacing: 0 }}>
                            {t.scope === SCOPE.WHOLE ? 'Whole configuration' : `${t.scope === SCOPE.COLLAR ? 'Collar only' : 'This part only'} · ${ourId(t.choice.partId)}`}
                        </button>
                    ))}
                </div>
                {scopeTarget.choice && partFinish[scopeTarget.choice.id] && (
                    <button onClick={() => setPartFinish(pf => { const n = { ...pf }; delete n[scopeTarget.choice.id]; return n; })}
                        style={{ ...mono, alignSelf: 'flex-start', fontSize: '7.5px', border: '1px solid var(--line)', background: '#fff', padding: '2px 5px', cursor: 'pointer', color: 'var(--ink-soft)' }}>
                        {ourId(scopeTarget.choice.partId)} is in {partFinish[scopeTarget.choice.id]} &mdash; back to the configuration finish
                    </button>
                )}
            </div>
            {/* ── WHAT THE FINISH ASKS (Stuart 2026-10-06 · Shared/finishQuestions) ─────────────────────────
                Solid brass is one finish and one item per part; brushed or polished, lacquered or not is asked here,
                once for the whole configuration, and Add waits for it. The answers print in each line's finish. */}
            {askingFinishes.map(a => {
                const mine = finishAnswers[a.code] || {};
                const open = unansweredOf(a.finish, mine);
                return (
                    <div key={a.code} style={{ padding: '8px 13px', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '6px', background: open.length ? '#fdf3ec' : 'transparent' }}>
                        <span style={{ ...mono, fontSize: '8.5px', color: open.length ? '#b0281a' : 'var(--ink-soft)' }}>
                            {a.code}{a.finish.name ? ` · ${String(a.finish.name).trim()}` : ''} — {open.length ? 'answer before adding' : 'whole configuration'}
                        </span>
                        {a.questions.map(q => (
                            <div key={q.label} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px' }}>
                                <span style={{ ...mono, fontSize: '8.5px', minWidth: '58px', color: 'var(--ink-soft)' }}>{q.label}</span>
                                {q.choices.map(ch => (
                                    <button key={ch} onClick={() => setFinishAnswers(all => ({ ...all, [a.code]: { ...(all[a.code] || {}), [q.label]: ch } }))}
                                        style={{ ...chip(String(mine[q.label] || '').toUpperCase() === ch.toUpperCase()), textTransform: 'none', letterSpacing: 0 }}>{ch}</button>
                                ))}
                            </div>
                        ))}
                    </div>
                );
            })}
            <div style={{ padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', maxHeight: 'calc(100vh - 160px)' }}>
                {!finishGroups.length && <span style={{ ...mono, fontSize: '9px', color: 'var(--ink-faint)' }}>Choose a part to see its finishes.</span>}
                {finishGroups.map(([mat, g]) => (
                    <div key={mat} style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                        <span style={{ ...mono, fontSize: '9px' }}>{mat} <span style={{ color: 'var(--ink-faint)' }}>· {g.inHouse.length + g.out.length}{(scopeTarget.choice && !wearsMaterial(scopeTarget.choice, mat)) ? ' · sets the whole configuration' : ''}</span></span>
                        {!!g.inHouse.length && (<div style={{ paddingLeft: '7px', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ ...mono, fontSize: '8px', color: 'var(--ink-faint)' }}>{groupLabel(mat, 'in')} · {g.inHouse.length}</span>
                            {swatchRow(g.inHouse, swatchSel(mat), (c) => pickSwatch(mat, c))}
                        </div>)}
                        {!!g.out.length && (<div style={{ paddingLeft: '7px', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ ...mono, fontSize: '8px', color: 'var(--ink-faint)' }}>{groupLabel(mat, 'out')} · {g.out.length}</span>
                            {swatchRow(g.out, swatchSel(mat), (c) => pickSwatch(mat, c))}
                        </div>)}
                    </div>
                ))}
            </div>
        </div>
    );

    // ⚠ minWidth 0 ON EVERY GRID AND FLEX CHILD (Stuart 2026-08-18: "something strange on how it
    // page scaled as well, i had to zoom way out to get all the windows to show complete"). A grid
    // or flex child's min-width defaults to AUTO — "never smaller than my content" — so a rail of
    // fifteen steps, or one long pricing line, pushes its column and with it the entire page, and
    // no amount of overflow on the inner element helps, because the column itself has already
    // grown. The steps went from eleven to fifteen on a double and the page went wide with them.
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(230px, 300px) minmax(0, 1fr)', gap: '14px', alignItems: 'start', maxWidth: '100%' }}>
          {finishPanel}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>

            {/* ── WHAT THE DRAWING BROUGHT, AND WHAT IT COULD NOT ─────────────────────────────
                A silent handoff is the dangerous kind: an operator who does not know a bracket
                failed to match will quote the one the engine defaulted to. So the drawing says
                what it filled in, and says louder what it could not — and it is dismissible,
                because it is a report on one moment, not a state of the configuration. */}
            {visionReport && (
                <div style={{ background: '#fff', border: `1px solid ${visionReport.missed.length ? '#b00020' : 'var(--brass)'}`, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...mono, fontSize: '8.5px', color: visionReport.missed.length ? '#b00020' : 'var(--brass)' }}>
                            From the Vision drawing · {visionReport.name}
                        </div>
                        {!!visionReport.carried.length && (
                            <div style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-soft)', marginTop: '3px' }}>
                                Carried over: {visionReport.carried.join(' · ')}
                            </div>
                        )}
                        {visionReport.missed.map((m, i) => (
                            <div key={i} style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: '#b00020', marginTop: '3px' }}>
                                ⚠ {m.what} — {m.why}
                            </div>
                        ))}
                    </div>
                    <button onClick={() => setVisionReport(null)}
                        style={{ ...mono, fontSize: '8px', border: '1px solid var(--line)', background: '#fff', padding: '3px 7px', cursor: 'pointer', color: 'var(--ink-soft)' }}>dismiss</button>
                </div>
            )}

            {/* START FROM A KIT — the same kits tab 7 sells, as an opening position. Renders only
                where kits exist, so every collection without them is exactly as it was. */}
            {/* Kits exist for this family but lost their alignment — say so instead of vanishing
                (2026-08-26). The 4.6 kit-sheet import is what writes the alignment back. */}
            {/* SUPER-ADMIN DIAGNOSTIC (2026-08-26): when the kit picker has nothing to show, say
                exactly what it matched against and what the library holds — a prefix or brand
                mismatch then reads straight off the screen. Staff never see this line. */}
            {isSuperAdmin && !kits.length && !kitsUnaligned && kitSeedDiag && kitSeedDiag.totalKitClass > 0 && (
                <div style={{ background: '#fff', border: '1px dashed var(--line)', padding: '7px 14px', ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-soft)' }}>
                    🧰 kit picker: no kit matched — flow kitFamily “{kitSeedDiag.famFlow || '(none)'}”, assembly code “{kitSeedDiag.base || '(none)'}”. {kitSeedDiag.totalKitClass} kit record(s) on this brand — e.g. {kitSeedDiag.sampleCodes.join(', ')}. Tag the flow (regenerate stamps it) or the kits (4.6) with the same kitFamily.
                </div>
            )}
            {isSuperAdmin && !kits.length && kitSeedDiag && kitSeedDiag.totalKitClass === 0 && (
                <div style={{ background: '#fff', border: '1px dashed var(--line)', padding: '7px 14px', ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-soft)' }}>
                    🧰 kit picker: ZERO Kit-class records reached this brand’s library — the kits are either missing this brand’s brandId or not partClass “Kit”. Check 4.6 → Kit Builder.
                </div>
            )}
            {!kits.length && kitsUnaligned > 0 && (
                <div style={{ background: '#fdf8ef', border: '1px solid var(--brass)', padding: '8px 14px', ...mono, fontSize: '9px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink)' }}>
                    ⚠ {kitsUnaligned} kit{kitsUnaligned === 1 ? '' : 's'} exist for this flow but {kitsUnaligned === 1 ? 'is' : 'are'} missing kit alignment — the "Start from a kit" picker needs it. Re-run the kit sheet import in 4.6 → Kit Builder to restore it.
                </div>
            )}
            {!!kits.length && (
                <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ ...mono, fontSize: '8.5px', color: 'var(--ink-soft)' }}>Start from a kit</span>
                    <select value={kitPick} onChange={e => applyKit(e.target.value)}
                        style={{ padding: '6px 8px', border: '1px solid var(--line)', background: '#fff', fontSize: '12px', minWidth: '260px' }}>
                        <option value="">— configure from scratch —</option>
                        {kits.map(k => {
                            // THEIR code for the kit beside ours (Stuart 2026-09-09: "it only displays
                            // our part# and description for the kits, please add the fabricut kit
                            // codes") — the active customer's 4.6 row, the one the kit prices from.
                            const theirs = String(findClientPriceRow(k.clientPricing, customerKeys(customerId, customer))?.clientSku || '').trim();
                            return (
                                <option key={k.id || k.legacyErpId} value={String(k.id || k.legacyErpId || '')}>
                                    {k.legacyErpId || k.itemName}{theirs && theirs !== k.legacyErpId ? ` · ${theirs}` : ''}{k.itemName && k.legacyErpId ? ` · ${k.itemName}` : ''}
                                </option>
                            );
                        })}
                    </select>
                    {/* ADDITIONAL FEET (Stuart 2026-08-22): "on rod qty it starts at the 4ft set
                        then each additional foot so add a field for additional qty." The kit's base
                        set is the floor, so this asks for what is ABOVE it rather than a total —
                        which is how the order was sold and how the bill reads back. */}
                    {kitSource && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ ...mono, fontSize: '8.5px', color: 'var(--ink-soft)' }}>{kitSource.baseFeet} ft set  +</span>
                            <input type="number" min="0" step="1"
                                value={Math.max(0, Math.round((lengthFeet || kitSource.baseFeet) - kitSource.baseFeet)) || ''}
                                onChange={e => {
                                    const extra = Math.max(0, parseInt(e.target.value, 10) || 0);
                                    setPoleIn(String((kitSource.baseFeet + extra) * 12));
                                    setPoleFrac('');
                                }}
                                placeholder="0"
                                style={{ width: '64px', padding: '6px 8px', border: '1px solid var(--line)', background: '#fff', fontSize: '12px' }} />
                            <span style={{ ...mono, fontSize: '8.5px', color: 'var(--ink-soft)' }}>additional ft</span>
                        </span>
                    )}
                    {/* THE MOTOR, IN THEIR WORDS (Stuart 2026-09-03: "match tab 7"). A motorized kit
                        has one customer code PER MOTOR; picking it here folds the motor into the kit
                        line at that code and net, so the CPQ quote reads the same as tab 7's. */}
                    {kitSource && trvDrive === 'MOTORIZED' && (kitSource.record?.manufacturingSpecs?.kitMotorCodes || []).length > 0 && (
                        <select value={kitMotor} onChange={e => setKitMotor(e.target.value)}
                            title="Their per-motor kit code — the kit line takes this code and its net price; the motor itself rides included at $0."
                            style={{ padding: '6px 8px', border: `1px solid ${kitMotor ? 'var(--brass)' : '#b00020'}`, background: '#fff', fontSize: '11px', fontFamily: 'var(--mono)' }}>
                            <option value="">motor: — choose their code —</option>
                            {(kitSource.record.manufacturingSpecs.kitMotorCodes || []).map(x => <option key={x.code} value={x.code}>{x.code}{x.motorItem ? ` · ${x.motorItem}` : ''}{Number.isFinite(parseFloat(x.net)) ? ` · $${parseFloat(x.net)}` : ''}</option>)}
                        </select>
                    )}
                    {kitBill && kitBill.mountFollow && (
                        <span style={{ ...mono, fontSize: '9px', textTransform: 'none', letterSpacing: 0, color: kitBill.mountFollow.mode === 'nokit' ? '#8a6508' : 'var(--brass)', fontWeight: 600 }}>
                            {kitBill.mountFollow.mode === 'switched'
                                ? `Mount is ${kitBill.mountFollow.mount === 'CEILING' ? 'Ceiling' : 'Wall'} — billing the ${kitBill.mountFollow.mount === 'CEILING' ? 'ceiling' : 'wall'} kit ${kitBill.mountFollow.to}${kitBill.mountFollow.theirs ? ` (${kitBill.mountFollow.theirs})` : ''}, not ${kitBill.mountFollow.from}.`
                                : kitBill.mountFollow.mode === 'followed'
                                    ? `Mount is ${kitBill.mountFollow.mount === 'CEILING' ? 'Ceiling' : 'Wall'} — this kit is the same on either mount: its ${kitBill.mountFollow.mount === 'CEILING' ? 'ceiling' : 'wall'} brackets are in the kit, at the kit price.`
                                    : `No kit is made for this set-up on a ${kitBill.mountFollow.mount === 'CEILING' ? 'ceiling' : 'wall'} mount — ${kitBill.mountFollow.from} bills as picked and the brackets bill on their own.`}
                        </span>
                    )}
                    <span style={{ ...mono, fontSize: '8px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}>
                        {kitSource
                            ? `The ${kitSource.baseFeet} ft kit bills as the first line; the feet above it bill under it at the engine's per-foot rate. Anything else added bills its own line.`
                            : 'Fills the opening answers. Everything stays editable — a kit that needed no changes would have gone out on tab 7.'}
                    </span>
                </div>
            )}

            {kitReport && (
                <div style={{ background: '#fff', border: `1px solid ${kitReport.blocked ? '#b00020' : (kitReport.missed.length ? '#8a6508' : 'var(--brass)')}`, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ ...mono, fontSize: '8.5px', color: kitReport.blocked ? '#b00020' : 'var(--brass)' }}>
                            {kitReport.restore ? 'Kit not restored' : (kitReport.blocked ? 'This assembly cannot build' : 'Started from kit')} · {kitReport.name}
                        </div>
                        {kitReport.blocked && (
                            <div style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: '#b00020', marginTop: '3px' }}>
                                ⚠ {kitReport.blocked.what} — {kitReport.blocked.why}{kitReport.restore ? '' : ' Nothing was filled in.'}
                            </div>
                        )}
                        {!!kitReport.carried.length && (
                            <div style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-soft)', marginTop: '3px' }}>
                                Filled in: {kitReport.carried.join(' · ')}
                            </div>
                        )}
                        {kitReport.missed.map((m, i) => (
                            <div key={i} style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: '#8a6508', marginTop: '3px' }}>
                                ○ {m.what} — {m.why}
                            </div>
                        ))}
                    </div>
                    <button onClick={() => setKitReport(null)}
                        style={{ ...mono, fontSize: '8px', border: '1px solid var(--line)', background: '#fff', padding: '3px 7px', cursor: 'pointer', color: 'var(--ink-soft)' }}>dismiss</button>
                </div>
            )}

            {/* CONFIGURATIONS — a job is several rooms. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: '#fff', border: '1px solid var(--line)', padding: '10px 14px' }}>
                <span style={mono}>Configurations</span>
                {saved.map((c, i) => (
                    <span key={i} style={{ ...mono, fontSize: '9px', padding: '6px 10px', border: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                        {c.memo} <b style={{ fontWeight: 400, color: 'var(--ink-soft)', marginLeft: '5px' }}>${c.total.toFixed(2)}</b>
                    </span>
                ))}
                <span style={{ ...mono, fontSize: '9px', padding: '6px 10px', border: '1px solid var(--ink)', background: 'var(--ink)', color: '#fff' }}>
                    {configMemo || 'This configuration'} <b style={{ fontWeight: 400, color: 'var(--brass)', marginLeft: '5px' }}>
                        {cfgQtyN > 1 ? `$${grandTotal.toFixed(2)} × ${cfgQtyN} = $${(grandTotal * cfgQtyN).toFixed(2)}` : `$${grandTotal.toFixed(2)}`}
                    </b>
                </span>
                {/* WHO IS BEING PRICED, stated plainly. Every alias and every negotiated price on
                    this screen hangs off this one name, and "no customer" and "this customer has no
                    rows" look identical on a quote line — so the name is on screen, not implied. */}
                <span style={{ ...mono, fontSize: '9px', padding: '6px 10px', border: '1px solid var(--line)', background: '#fff', color: customerId ? 'var(--ink)' : 'var(--ink-faint)' }}
                    title={customerId ? 'Aliases and prices on this screen are this customer\u2019s (their rows live per item in 4.6). Set the collection\u2019s own account in tab 11; a job\u2019s customer overrides it.' : 'No customer — every line shows our base price and our part numbers. Name one on the job, or give the collection its own account in tab 11.'}>
                    {customer?.companyName || customer?.name || (customerId ? customerId : 'No customer \u00b7 base pricing')}
                    {effectiveLevel !== 'STANDARD' && (
                        <b style={{ fontWeight: 400, color: 'var(--brass)', marginLeft: '6px' }}>
                            {priceLevelShort(effectiveLevel)}{levelIsDefault ? ' \u00b7 default' : ''}
                        </b>
                    )}
                </span>
                {/* THE MULTIPLIER, ASKED OUT LOUD. "2" here is two complete identical builds —
                    every part, every pole, every bracket × 2 — never a length. The tooltip says it
                    because the one confusion this field can cause on the floor is "2" being read
                    as 2 ft (Stuart 2026-08-26: "so that they do not make a 2ft pole but rather 2
                    of the same"). */}
                <label style={{ ...mono, marginLeft: 'auto', fontSize: '9px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    title="How many of THIS exact configuration. 2 = two complete identical sets — every part below × 2. Never a dimension.">
                    Qty of this config
                    <input type="number" min="1" step="1" value={cfgQty}
                        onChange={e => setCfgQty(e.target.value)}
                        onBlur={() => setCfgQty(String(cfgQtyN))}
                        style={{ width: '52px', padding: '6px 6px', border: `1px solid ${cfgQtyN > 1 ? 'var(--brass)' : 'var(--line)'}`, fontFamily: 'var(--mono)', fontSize: '11px', textAlign: 'center', background: '#fff', color: 'var(--ink)', fontWeight: cfgQtyN > 1 ? 700 : 400 }} />
                </label>
                <button onClick={addConfiguration} disabled={!priced.lines.length || !!pendingDrops.length}
                    title={dropRefusal || undefined}
                    style={{ ...mono, padding: '7px 12px', cursor: (priced.lines.length && !pendingDrops.length) ? 'pointer' : 'not-allowed', border: `1px solid ${pendingDrops.length ? '#b00020' : 'var(--line)'}`, background: '#fff', color: pendingDrops.length ? '#b00020' : 'var(--ink)', opacity: priced.lines.length ? 1 : .4 }}>
                    + Add configuration{cfgQtyN > 1 ? ` × ${cfgQtyN}` : ''}
                </button>
                {/* CHECKOUT IS A JOB-LEVEL ACT, so it sits with the configurations rather than at
                    the end of a walk: adding a configuration returns the operator to step 1 for the
                    next room, and the way out cannot be a button that only exists on step 10. It is
                    the SAME cart the header counts — one door, shown in two places. */}
                {typeof onCheckout === 'function' && (
                    <button onClick={onCheckout} disabled={!cartCount || !!pendingDrops.length}
                        title={pendingDrops.length ? dropRefusal : (cartCount ? 'Fees, add-ons and the quote documents' : 'Add a configuration first — the cart is empty')}
                        style={{ ...mono, padding: '7px 12px', cursor: cartCount ? 'pointer' : 'not-allowed', border: `1px solid ${cartCount ? 'var(--brass)' : 'var(--line)'}`, background: cartCount ? 'var(--brass)' : '#fff', color: cartCount ? '#fff' : 'var(--ink-soft)', opacity: cartCount ? 1 : .5 }}>
                        Checkout ({cartCount})
                    </button>
                )}
            </div>

            {/* THE RAIL — the whole product at a glance, every answer visible. */}
            <div style={{ display: 'flex', border: '1px solid var(--line)', background: '#fff', overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
                {steps.map(railCell)}
            </div>
            {/* ── REMOVED BY A LATER CHOICE (Stuart 2026-09-10) ──────────────────────────────
                Every pick a later answer took off the order, with the engine's own reason, until
                the operator says Understood. Add and Checkout wait for it. Acknowledged entries
                fade but stay readable until the pick comes back or the configuration is added. */}
            {drops.length > 0 && (
                <div style={{ border: `1px solid ${pendingDrops.length ? '#b00020' : 'var(--line)'}`, background: pendingDrops.length ? '#fff5f5' : 'var(--paper-2)', padding: '8px 12px' }}>
                    <div style={{ ...mono, fontSize: '9px', color: pendingDrops.length ? '#b00020' : 'var(--ink-soft)', marginBottom: '4px' }}>
                        {pendingDrops.length ? `⚠ Removed by a later choice — ${pendingDrops.length} to acknowledge before adding` : 'Removed by a later choice — acknowledged'}
                    </div>
                    {drops.map(d => (
                        <div key={d.key} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', padding: '3px 0', opacity: d.acked ? 0.55 : 1, fontSize: '0.85rem' }}>
                            <span style={{ ...mono, fontSize: '9px', color: 'var(--ink-soft)', flex: '0 0 auto' }}>{d.step}</span>
                            <span style={{ fontWeight: 500, flex: '0 0 auto' }}>{d.partName}{d.partCode && d.partCode !== d.partName ? <span style={{ ...mono, fontSize: '9px', color: 'var(--ink-soft)', marginLeft: '6px' }}>{d.partCode}</span> : null}</span>
                            <span style={{ color: 'var(--ink-soft)', flex: '1 1 auto', minWidth: 0 }}>— {d.reason}</span>
                            {!d.acked && (
                                <button onClick={() => ackDrop(d.key)} style={{ ...mono, fontSize: '9px', padding: '3px 8px', border: '1px solid #b00020', background: '#fff', color: '#b00020', cursor: 'pointer', flex: '0 0 auto' }}>Understood</button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px,390px) minmax(0, 1fr)', gap: '14px', alignItems: 'start', maxWidth: '100%' }}>

                {/* ── THE STEP ────────────────────────────────────────────────────────────── */}
                <div style={{ background: '#fff', border: '1px solid var(--line)' }}>
                    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                        <div style={{ ...mono, fontSize: '8.5px', color: 'var(--brass)', marginBottom: '3px' }}>Step {ix + 1} of {steps.length}</div>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.12rem' }}>{step?.label}</div>
                        {/* ── WHAT OMITTING A STEP MEANS (Stuart 2026-08-21) ───────────────────────
                            "we also need to mention that in the step: Choose front track for
                            traverse, omit it to use rings on the fascia."
                            Skipping a step is normally how you say "not this one", but here it is
                            the OTHER answer — leave the track out and the fascia takes rings
                            instead. Nothing on screen said so, and an operator who does not know it
                            reads an unanswered step rather than a choice. It is said on the step
                            that carries the consequence, not in a note beside it. */}
                        {stepHint && (
                            <div style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-soft)', marginTop: '5px', lineHeight: 1.5 }}>
                                {stepHint}
                            </div>
                        )}
                    </div>
                    <div style={{ padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: '15px' }}>

                        {!pins?.length && <div style={{ ...mono, color: 'var(--ink-soft)' }}>Loading this assembly’s pins…</div>}

                        {step?.kind === 'AXIS' && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {step.axis.values.map(v => (
                                    <button key={String(v)} onClick={() => setAnswer(step.axis.key, v)} style={chip(answers[step.axis.key] === v)}>
                                        {valueLabel(step.axis.key, v)}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* The framing questions, each in its own labelled box, stacked down the
                            step — the vertical room below the first one was going spare. */}
                        {step?.kind === 'AXES' && step.axes.map(a => (
                            <div key={a.key}>
                                <div style={{ ...mono, fontSize: '8.5px', color: 'var(--brass)', marginBottom: '7px' }}>
                                    {AXIS_LABEL[a.key] || a.key}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                    {a.values.map(v => (
                                        <button key={String(v)} onClick={() => setAnswer(a.key, v)} style={chip(answers[a.key] === v)}>
                                            {valueLabel(a.key, v)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {step?.kind === 'SLOT' && (<>
                            {step.slot.suppressedBy && (
                                <div style={{ ...mono, fontSize: '9px', textTransform: 'none', letterSpacing: 0, color: '#8a6508', borderLeft: '2px solid #8a6508', paddingLeft: '9px' }}>
                                    {/* ⚠ THROUGH ourId, LIKE EVERY OTHER NUMBER ON THIS SCREEN. slots() names the
                                        part that closed the step by its PIN id, because the model has no library
                                        to resolve against — so a pin tagged with the app's record id printed
                                        "(CE-ASM-64478)" at the operator, which is the very thing ourId exists to
                                        stop (Stuart 2026-09-06, H1-2TRV: it read CE-ASM-64478 instead of
                                        H1-2TRVDRA). Resolved here, where the library IS in hand. */}
                                    Not asked — {step.slot.suppressedReason} ({ourId(step.slot.suppressedBy)})
                                </div>
                            )}
                            {!!step.slot.options.length && (() => {
                                // ── A CHOSEN RETURN COLLAPSES THE REST (Stuart 2026-08-20) ──────────
                                // "whenever a french return is selected, hide the rest of the finial
                                //  thumbnail choices so that it is easier to see the backplates since
                                //  they are way down the page. if you click on return a second time it
                                //  would unselect and show them again."
                                //
                                // A return is the only end treatment that brings a plate picker with
                                // it, and on H1-138 that picker sits under sixteen finial thumbnails.
                                // Once the answer is a return, the other fifteen are just distance.
                                // Nothing is hidden that has not been decided, and the way back is the
                                // card itself — clicking it deselects, which is what it already did.
                                const picked = step.slot.options.find(o => o.id === livePicks[step.slot.key]);
                                const collapsed = !!(picked && picked.role === 'RETURN' && step.sub);
                                const shown = collapsed ? [picked] : step.slot.options;
                                return (<>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '7px' }}>
                                        {shown.map(o => optionCard(o, livePicks[step.slot.key] === o.id, () => setPick(step.slot.key, o.id)))}
                                    </div>
                                    {collapsed && (
                                        <div style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}>
                                            {step.slot.options.length - 1} other end treatment{step.slot.options.length - 1 === 1 ? '' : 's'} hidden — click the return again to show them
                                        </div>
                                    )}
                                </>);
                            })()}
                            {/* HOW MANY — only where the count is a real decision: the centre
                                bracket repeats along the pole, and rings and carriers are spaced
                                by the foot. An end has one treatment and each side has one arm, so
                                neither asks. The placeholder carries the recommendation, so an
                                empty field means "use it" rather than "none". */}
                            {takesQty(step.slot) && livePicks[step.slot.key] && (() => {
                                const picked = step.slot.options.find(o => o.id === livePicks[step.slot.key]);
                                const rec = recommendFor(step.slot, picked);
                                const isCentre = step.slot.kind === 'BRACKET';
                                const ends = isCentre ? bearingEnds(model.choices, Object.values(livePicks), model.slots) : 0;
                                return (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                                        <span style={{ ...mono, fontSize: '8.5px', color: 'var(--brass)' }}>How many</span>
                                        <input value={stepQty[step.slot.key] ?? ''} inputMode="numeric"
                                            onChange={e => setStepQty(q => ({ ...q, [step.slot.key]: e.target.value.replace(/[^0-9]/g, '') }))}
                                            placeholder={rec ? String(rec) : '1'}
                                            style={{ width: '62px', padding: '5px 7px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '11px', background: '#fff' }} />
                                        {rec != null && (
                                            <span style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}>
                                                {isCentre
                                                    ? `recommended ${rec} — ${advice ? advice.brackets : '?'} support${advice && advice.brackets === 1 ? '' : 's'} for this pole, less ${ends} carried by the ends`
                                                    : `recommended ${rec} — four a foot over ${lengthFeet} ft, plus the pair at the ends`}
                                            </span>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* PAIRED: the plate that goes with the arm above, nested under it. */}
                            {step.sub && (
                                <div style={{ marginLeft: '10px', paddingLeft: '11px', borderLeft: '2px solid var(--brass)' }}>
                                    <div style={{ ...mono, fontSize: '8.5px', marginBottom: '6px' }}>
                                        <span style={{ color: 'var(--brass)' }}>Matching backplate</span>
                                        {step.sub.suppressedBy
                                            ? <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}> · {step.sub.suppressedReason}</span>
                                            : <span style={{ color: 'var(--ink-faint)' }}> · {step.sub.options.length}</span>}
                                    </div>
                                    {!!step.sub.options.length && (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '7px' }}>
                                            {step.sub.options.map(o => optionCard(o, livePicks[step.sub.key] === o.id, () => setPick(step.sub.key, o.id)))}
                                        </div>
                                    )}
                                </div>
                            )}
                            {!!step.slot.rejected.length && (
                                <div>
                                    <span onClick={() => setWhySlot(whySlot === step.slot.key ? null : step.slot.key)}
                                        style={{ ...mono, fontSize: '9px', textTransform: 'none', letterSpacing: 0, color: 'var(--brass)', cursor: 'pointer' }}>
                                        {whySlot === step.slot.key ? 'hide' : `why not the other ${step.slot.rejected.length}?`}
                                    </span>
                                    {whySlot === step.slot.key && (
                                        <div style={{ marginTop: '6px', paddingLeft: '9px', borderLeft: '2px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', lineHeight: 1.6 }}>
                                            {step.slot.rejected.map((r, i) => (
                                                <div key={i} style={{ color: 'var(--ink-soft)' }}>
                                                    <span style={{ color: 'var(--ink)' }}>{r.choice.name}</span>{r.choice.partId ? ` · ${r.choice.partId}` : ''} — <span style={{ color: '#8a6508' }}>{r.rule}</span>: {r.detail}
                                                </div>
                                            ))}
                                            <div style={{ color: 'var(--ink-faint)', paddingTop: '3px' }}>Every one of these is a tag on the ITEM, in 1.6.</div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>)}

                        {step?.kind === 'CARRIERS' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                                <div style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}>
                                    A track carries its drapery on carriers rather than rings — there is nothing to choose here,
                                    and they are on the order already. The count follows the length.
                                </div>
                                {carriersFromStep && (
                                    <div style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--brass)' }}>
                                        The carrier style and count on this order come from the Traverse components step — that line is the carriers on the bill and the BOM; the one below only renders in the track.
                                    </div>
                                )}
                                {step.carriers.map(c => {
                                    const n = recommendedQty(c, lengthFeet) || c.qty || 1;
                                    return (
                                        <div key={c.id} style={{ display: 'flex', alignItems: 'baseline', gap: '8px', padding: '9px 11px', border: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px' }}>{ourId(c.partId)}</span>
                                            <span style={{ flex: 1, fontSize: '11.5px', color: 'var(--ink-soft)' }}>{findPart(c.partId)?.itemName || c.name}</span>
                                            <span style={{ ...mono, fontSize: '9px', color: 'var(--brass)' }}>×{n}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {step?.kind === 'SIZE' && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {/* The flow's own option list, unedited — the diameters and
                                    projections it was generated with, gated exactly as it gates
                                    them (a projection is offered only at the diameters that make
                                    it). Choosing here re-resolves every part in the assembly. */}
                                {(step.sizeStep.styleOptions || []).map(o => (
                                    <button key={o.optId} onClick={() => setSizePick(p => ({ ...p, [step.sizeStep.id]: o.optId }))}
                                        style={chip(sizePick[step.sizeStep.id] === o.optId)}>
                                        {o.partName || o.label || o.optId}
                                    </button>
                                ))}
                            </div>
                        )}

                        {step?.kind === 'TRV' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {/* WHAT DECIDES THE LIST, said out loud. The drive was answered
                                    several steps back, and "why am I being shown motor accessories"
                                    is the first question anyone asks of a list they did not expect. */}
                                <div style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}>
                                    <b style={{ fontWeight: 400, color: 'var(--brass)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{trvDrive}</b>
                                    {` · ${trvFeet} ft · ${trvTracks === 2 ? 'two tracks' : 'one track'} — the drive decides which components exist; the chart quantity for this length is included in the per-foot price, and raising a count bills the difference.`}
                                </div>
                                <TraverseConfiguratorPanel rules={trvRules} drive={trvDrive} feet={trvFeet} realFeet={lengthFeet || undefined} trackCount={trvTracks}
                                    itemInfo={trvItemInfo} priceOf={trvPriceOf} sel={trvLive} onSel={setTrvSel} />
                                {(() => {
                                    // Everything still outstanding on this track, in one line. The draw and the
                                    // motor side cost nothing and are therefore easy to walk past — and both are
                                    // scrap if wrong, so they are named here beside the carrier style rather than
                                    // left to be noticed.
                                    const missing = [...traverseAnswersMissing({ drive: trvDrive, sel: trvLive }),
                                        ...(trvLive?.carrierStyle ? [] : ['carrier style'])];
                                    if (!missing.length) return null;
                                    return (
                                        <div style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--brass)' }}>
                                            Still needed: {missing.join(' · ')} — the rest of the order is already priced, but a track missing any of these is not a finished configuration.
                                        </div>
                                    );
                                })()}
                            </div>
                        )}

                        {step?.kind === 'LENGTH' && (<>
                            <div>
                                <div style={{ ...mono, color: 'var(--ink-soft)', marginBottom: '6px' }}>Finished length</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto 1fr', gap: '7px', alignItems: 'end' }}>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                        <span style={{ ...mono, fontSize: '8px' }}>Inches</span>
                                        <input value={poleIn} onChange={e => setPoleIn(e.target.value)} placeholder="—" inputMode="decimal"
                                            style={{ padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '14px', width: '100%', background: '#fff', color: 'var(--ink)' }} />
                                    </label>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                        <span style={{ ...mono, fontSize: '8px' }}>Fraction</span>
                                        <input value={poleFrac} onChange={e => setPoleFrac(e.target.value)} placeholder="—"
                                            style={{ padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '14px', width: '100%', background: '#fff', color: 'var(--ink)' }} />
                                    </label>
                                    <span style={{ color: 'var(--brass)', fontFamily: 'var(--mono)', paddingBottom: '9px' }}>→</span>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                        <span style={{ ...mono, fontSize: '8px' }}>Feet · billed</span>
                                        <input value={lengthFeet ?? ''} readOnly placeholder="—"
                                            style={{ padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '14px', width: '100%', background: 'var(--paper-2)', color: 'var(--ink)' }} />
                                    </label>
                                </div>
                                {lengthInches && <div style={{ ...mono, fontSize: '9px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)', marginTop: '5px' }}>{lengthInches}" ÷ 12 = {lengthFeetExact} ft → billed at <b>{lengthFeet} full feet</b>, rounded up.</div>}
                            </div>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <span style={{ ...mono, color: 'var(--ink-soft)' }}>Fabric weight</span>
                                <select value={fabricId} onChange={e => setFabricId(e.target.value)}
                                    style={{ padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '13px', background: '#fff', color: 'var(--ink)' }}>
                                    {FABRIC_CLASSES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                                </select>
                            </label>
                        </>)}

                        {/* ADDED BY HAND — a splice, an extra ring, anything the flow does not
                            model. Which items are OFFERED here is set per flow in tab 11, so the
                            list grows without a release; the qty and the note are per order.
                            Stuart 2026-08-17: "the splice should say default is center (add in
                            exact location if different)". */}
                        {/* THE ITEMS THIS FLOW SELLS, LISTED (Stuart 2026-08-17: "the add an item
                            field on step 10 is literally showing add an item, rather than the item i
                            added to the flow on 11"). He is right — a button that hides the list
                            behind a click is a worse version of the list. Every item tab 11 offers is
                            on screen with its price; typing a quantity is what adds it. The note is
                            per line, and a splice's hint says what the shop assumes when it is blank. */}
                        {!!stepExtras.length && (
                            <div>
                                {/* THE SPLICE QUESTION, ASKED WHERE THE LENGTH IS (Stuart 2026-08-24) — over the
                                    one-piece limit the splice adds itself at the default, and the note is only
                                    for a location that differs. Vision draws the splice where the note says. */}
                                {step?.kind === 'LENGTH' && spliceNeeded && (
                                    <div style={{ border: `1px solid ${spliceSatisfied ? 'var(--line)' : 'var(--brass)'}`, background: spliceSatisfied ? 'var(--paper)' : '#faf6ee', padding: '9px 11px', marginBottom: '8px', fontSize: '11.5px', color: 'var(--ink)', lineHeight: 1.45 }}>
                                        <b>{spliceSatisfied ? 'Splice included' : '⚠ No splice on this pole'}</b> — {lengthInches}&Prime; exceeds the {spliceOverIn}&Prime; one-piece limit.{' '}
                                        {spliceSatisfied
                                            ? <>Default location is the <b>CENTER of the run</b>; note the exact location below only if
                                                different. Vision draws the splice where the note says. Set the quantity to 0 to ship it in one piece.</>
                                            : <>It will be quoted, built and shipped in <b>ONE PIECE</b>, and the line says so to the shop.
                                                {spliceCodes.length > 1 ? ' Add the splice/joiner for this rod below' : ' Enter a quantity below'} if it should be spliced.</>}
                                    </div>
                                )}
                                <div style={{ ...mono, color: 'var(--ink-soft)', marginBottom: '7px' }}>Add an item</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                                    {stepExtras.map(it => {
                                        // ONE TICK PER TRACK (Stuart 2026-08-31): the same fee item is offered on
                                        // BOTH track steps of a double, and each is its own decision — so on a slot
                                        // step the extra is keyed by the slot too. Length-step extras (splices)
                                        // keep the plain code key they have always had.
                                        const slotScope = step?.kind === 'SLOT' ? step.slot.key : '';
                                        const row = extras.find(x => x.code === it.code && (x.slot || '') === slotScope);
                                        const qty = row?.qty ?? '';
                                        const set = (patch) => {
                                          // The splice's own quantity is the override: 0 over the limit declines it, a number takes it back.
                                          if ('qty' in patch && spliceCodes.includes(it.code)) {
                                              if (Number(patch.qty) > 0) setSpliceWaived(false);
                                              else if (spliceNeeded) setSpliceWaived(true);
                                          }
                                          setExtras(a => {
                                            const i = a.findIndex(x => x.code === it.code && (x.slot || '') === slotScope);
                                            if (i < 0) return [...a, { code: it.code, qty: '1', note: '', ...(slotScope ? { slot: slotScope } : {}), ...patch }];
                                            const next = [...a]; next[i] = { ...next[i], ...patch };
                                            return next[i].qty === '' || Number(next[i].qty) <= 0 ? next.filter((_, j) => j !== i) : next;
                                          });
                                        };
                                        const part = findPart(it.code);
                                        const line = row ? extraLines.find(l => l.partId === it.code && (l.slot || '') === slotScope) : null;
                                        return (
                                            <div key={it.code} style={{ border: `1px solid ${row ? 'var(--ink)' : 'var(--line)'}`, background: '#fff', padding: '8px 9px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ ...mono, fontSize: '9.5px', textTransform: 'none', letterSpacing: '.02em', color: 'var(--ink)', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                                            {ourId(it.code)}
                                                            {aliasOf(it.code) && <span style={{ color: 'var(--brass)' }}>{aliasOf(it.code)}</span>}
                                                        </div>
                                                        <div style={{ fontSize: '11.5px', color: 'var(--ink-soft)', lineHeight: 1.25 }}>{it.label || part?.itemName || it.code}</div>
                                                    </div>
                                                    <input value={qty} onChange={e => set({ qty: e.target.value })} inputMode="numeric" placeholder="0"
                                                        title="Quantity — leave it empty and the item is not on the order"
                                                        style={{ width: '48px', padding: '6px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '12px', textAlign: 'center', background: '#fff', color: 'var(--ink)' }} />
                                                    <span style={{ ...mono, fontSize: '9px', color: line ? 'var(--brass)' : 'var(--ink-faint)', minWidth: '48px', textAlign: 'right', paddingTop: '6px' }}>
                                                        {line ? `$${line.total.toFixed(2)}` : '—'}
                                                    </span>
                                                </div>
                                                {!!row && (
                                                    <input value={row.note || ''} onChange={e => set({ note: e.target.value })}
                                                        placeholder={it.notePlaceholder || (spliceCodes.includes(it.code) ? 'Default is CENTER — give the exact location only if different' : 'Anything the shop needs to know about it')}
                                                        style={{ padding: '6px 7px', border: '1px solid var(--line)', fontSize: '11.5px', background: '#fff', color: 'var(--ink)' }} />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ── THE LAST STEP HAS TO GO SOMEWHERE (Stuart 2026-08-21) ────────────
                            "when last step is reach the next step button is greyed and no action
                            available to add another config or check out". Quite right: the walk ran
                            out of steps and left the operator holding a finished configuration with
                            nothing to press. A greyed NEXT is honest about there being no step 11,
                            but it is not an ending — so the last step's button becomes the ending it
                            already was, and adds the configuration to the quote. The strip above
                            keeps the same action for anyone who finished early and wants out. */}
                        {/* The configuration quantity lives in the header beside "Add configuration" only
                            (Stuart 2026-09-09). It used to repeat here on the last step — on H1-138 that is
                            the ring step, which asks its own "how many", and a 50 typed into the wrong box
                            quoted fifty complete builds. One box, one meaning. */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', paddingTop: '3px' }}>
                            <button onClick={() => setStepIx(Math.max(0, ix - 1))} disabled={ix === 0}
                                style={{ ...chip(false), opacity: ix === 0 ? .35 : 1, cursor: ix === 0 ? 'not-allowed' : 'pointer' }}>Back</button>
                            {ix >= steps.length - 1 ? (
                                <button onClick={addConfiguration} disabled={!priced.lines.length}
                                    title={priced.lines.length ? `Adds this configuration to the quote${cfgQtyN > 1 ? ` × ${cfgQtyN}` : ''} and starts the next one` : 'Nothing priced yet — this configuration has no lines'}
                                    style={{ ...chip(true), background: 'var(--brass)', border: '1px solid var(--brass)', color: '#fff', opacity: priced.lines.length ? 1 : .35, cursor: priced.lines.length ? 'pointer' : 'not-allowed' }}>
                                    {cfgQtyN > 1
                                        ? `Add to quote · $${grandTotal.toFixed(2)} × ${cfgQtyN} = $${(grandTotal * cfgQtyN).toFixed(2)}`
                                        : `Add to quote · $${grandTotal.toFixed(2)}`}
                                </button>
                            ) : (
                                <button onClick={() => setStepIx(Math.min(steps.length - 1, ix + 1))}
                                    style={{ ...chip(true) }}>Next step</button>
                            )}
                        </div>
                    </div>
                </div>

                {/* ── THE RENDER, THEN THREE BOXES OF EQUAL WEIGHT ─────────────────────────── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ height: '420px', background: 'var(--paper-2)', border: '1px solid var(--line)', position: 'relative' }}>
                        <div style={{ ...mono, position: 'absolute', left: '13px', top: '11px', zIndex: 2, color: 'var(--ink-soft)' }}>
                            {/* ⚠ PARTS AND NODES ARE DIFFERENT NUMBERS, and only one of them draws.
                                A part is a BOM line; a node is geometry. Under default-hidden an
                                empty node set hides the whole model, so "14 parts, nothing on
                                screen" and "14 parts, nothing TAGGED" look identical — until the
                                second number is on the label. Stuart 2026-08-18, an empty canvas
                                nobody could explain from the outside. */}
                            Live 3D · additive · {chosen.length} part(s) · {Object.keys(visibleOverrides).length} node(s)
                            {/* …and what each drawn mesh GOT. `raw` is the one that matters: no finish reached
                                it, so it draws in the model's own Carbon Steel whatever the customer picked. */}
                            {paintAudit && (paintAudit.wood + paintAudit.finish + paintAudit.clear + paintAudit.raw) > 0 && (
                                <span style={{ color: paintAudit.raw ? '#b00020' : 'var(--brass)' }}>
                                    {' · painted:'}
                                    {paintAudit.wood ? ` ${paintAudit.wood} wood` : ''}
                                    {paintAudit.finish ? ` ${paintAudit.finish} finish` : ''}
                                    {paintAudit.clear ? ` ${paintAudit.clear} clear` : ''}
                                    {paintAudit.raw ? ` ${paintAudit.raw} RAW (no finish reached it)` : ''}
                                </span>
                            )}
                            {chosen.length > 0 && Object.keys(visibleOverrides).length === 0 && (
                                <span style={{ color: '#b00020' }}> · nothing tagged to draw — the chosen parts own no geometry</span>
                            )}
                        </div>
                        {/* ── SEND TO GUIDE (Stuart 2026-08-25): "on the cpq i will select the parts
                            that i want to add to the guide, arrange them in the orientation that
                            makes sense, then capture" — a hi-res TRANSPARENT png of exactly this
                            view, filed in the Asset Gallery for the tab-1 Guide Builder. */}
                        {cadUrl && (
                            <div style={{ position: 'absolute', right: '150px', top: '9px', zIndex: 3, display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <button onClick={() => setDisplayModeAndKeep({ on: !displayMode.on })}
                                    title="Display mode: the board as a frame over the view — zoom, rotate and pan (right-drag) the item inside it; the label reads what the rod measures on the board, ⌖ True scale sets it to its ordered inches; Add configuration captures exactly the frame for 5. Marketing"
                                    style={{ ...mono, padding: '7px 12px', background: displayMode.on ? 'var(--ink)' : '#fff', color: displayMode.on ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer' }}>
                                    🖼 Display mode{displayMode.on ? ' · on' : ''}
                                </button>
                                {displayMode.on && (<>
                                    <input type="number" min="6" max="96" step="0.5" value={displayMode.widthIn} onChange={e => setDisplayModeAndKeep({ widthIn: Number(e.target.value) || 24 })} title="board width, inches" style={{ ...mono, width: '46px', padding: '6px 4px', border: '1px solid var(--line)' }} />
                                    <span style={mono}>×</span>
                                    <input type="number" min="6" max="96" step="0.5" value={displayMode.heightIn} onChange={e => setDisplayModeAndKeep({ heightIn: Number(e.target.value) || 24 })} title="board height, inches" style={{ ...mono, width: '46px', padding: '6px 4px', border: '1px solid var(--line)' }} />
                                    <span style={mono}>in</span>
                                    <button onClick={() => { if (!(trueScaleSnapRef.current && trueScaleSnapRef.current())) alert('Nothing to scale to yet — pick a rod length first.'); }}
                                        disabled={!(lengthInches > 0)}
                                        title={lengthInches > 0 ? `Move the camera so the rod reads its ordered ${lengthInches}" on this board (rotation and pan are kept)` : 'Pick a rod length first'}
                                        style={{ ...mono, padding: '7px 10px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--brass)', cursor: lengthInches > 0 ? 'pointer' : 'default', opacity: lengthInches > 0 ? 1 : .45 }}>
                                        ⌖ True scale
                                    </button>
                                </>)}
                            </div>
                        )}
                        {cadUrl && displayMode.on && (
                            <div ref={frameOverlayRef} style={{ display: 'none', position: 'absolute', border: '2px dashed var(--brass)', pointerEvents: 'none', zIndex: 2, boxSizing: 'border-box' }}>
                                <span style={{ ...mono, position: 'absolute', left: '6px', bottom: '4px', color: 'var(--brass)', background: 'rgba(255,255,255,.7)', padding: '1px 5px' }}>{displayMode.widthIn}" × {displayMode.heightIn}" board · <span ref={frameReadingRef} /> · right-drag pans</span>
                            </div>
                        )}
                        {cadUrl && (
                            <button onClick={handleSendToGuide} disabled={guideCapBusy || !Object.keys(visibleOverrides).length}
                                title={Object.keys(visibleOverrides).length ? 'Capture this exact view as a hi-res transparent PNG and file it in the Asset Gallery for the Guide Builder (tab 1 → Guide Books)' : 'Nothing on screen to capture — choose parts first'}
                                style={{ ...mono, position: 'absolute', right: '12px', top: '9px', zIndex: 3, padding: '7px 12px', background: guideCapBusy ? 'var(--paper-2)' : '#fff', color: 'var(--ink)', border: '1px solid var(--brass)', cursor: guideCapBusy ? 'wait' : 'pointer', opacity: Object.keys(visibleOverrides).length ? 1 : .45 }}>
                                {guideCapBusy ? 'Capturing…' : '📸 Send to Guide'}
                            </button>
                        )}
                        {cadUrl ? (
                            <Canvas camera={{ position: [5, 5, 5], fov: 50 }} dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} style={{ width: '100%', height: '100%' }}
                                onCreated={(st) => { glStateRef.current = st; }}>
                                <StudioRig />
                                <ViewCapturer onReady={(fn) => { captureRef.current = fn; }} />
                                <BoardFrame enabled={displayMode.on} widthIn={displayMode.widthIn} heightIn={displayMode.heightIn} lengthInches={lengthInches} onRect={onBoardFrameRect} snapRef={trueScaleSnapRef} />
                                <OrbitControls makeDefault />
                                <Bounds fit clip margin={1.2}>
                                    {/* ⚠ ONE GEOMETRY, SCALED. A combined flow's .glb is the master
                                        diameter's — H2's is the 1-3/8" — so a 3/4" order renders it
                                        at the ratio between the two rather than needing four models.
                                        renderScaleOf is 1 on any flow without a size matrix. */}
                                    <group scale={renderScaleOf(flow, sizePick, assembly)}>
                                        <DynamicModel url={cadUrl} textureOverrides={textureOverrides} visibilityOverrides={visibleOverrides}
                                            cloneSpecs={cloneSpecs} stretchSpec={stretchSpec} spliceMarks={spliceMarks} highlightOverrides={[]} defaultHidden clearNodes={clearList} onPaintAudit={handlePaintAudit} />
                                    </group>
                                </Bounds>
                            </Canvas>
                        ) : <div style={{ ...mono, color: 'var(--ink-soft)', display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>No .glb on this assembly</div>}
                        {!Object.keys(visibleOverrides).length && cadUrl && (
                            <div style={{ ...mono, position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)', color: 'var(--ink-faint)' }}>
                                Empty by design — choose a rod to begin
                            </div>
                        )}
                    </div>

                    {/* PRICING left at its own size, GUIDANCE given the room it needs — the finish
                        moved to its own column, so this space belongs to the two that were cramped. */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.5fr)', gap: '14px', maxWidth: '100%' }}>

                        <div style={boxStyle}>
                            {boxHead('Pricing', priceLevel !== 'STANDARD' ? priceLevel.replace('FAB_', 'Fabricut ').toLowerCase() : '')}
                            <div style={{ padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, overflowY: 'auto', maxHeight: '300px' }}>
                                {!priced.lines.length && <span style={{ ...mono, fontSize: '9px', color: 'var(--ink-faint)' }}>Nothing chosen yet.</span>}
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
                                    <tbody>
                                        {/* Hidden parts are BILLED but not SHOWN: they are in the
                                            total and on the shop's BOM, off the customer's quote. */}
                                        {[...priced.lines.filter(l => !l.hidden), ...extraLines, ...trvLines].map((l, i) => (
                                            <tr key={i} title={`${l.source || 'added by hand'}${l.detail ? ` — ${l.detail}` : ''}`}>
                                                <td style={{ padding: '3px 0', color: 'var(--ink)' }}>
                                                    {/* Our id, their alias beside it, our description under. */}
                                                    <span style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
                                                        {/* The BILLED sku — H1-138KF/P, not the mill base — and their number
                                                            for it, from whichever box carries one: the negotiated 4.6 row's
                                                            clientSku first, else the item's resolved pattern #. */}
                                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px' }}>{l.billedId || ourId(l.partId)}</span>
                                                        {(l.sku || l.aliasCode) && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)' }}>{l.sku || l.aliasCode}</span>}
                                                        {/* Rod stock bills by the foot, so say so — a $125 line beside a $12.50
                                                            item reads as a mistake unless the arithmetic is on screen. */}
                                                        {l.perFoot
                                                            // ⚠ UNDER A KIT THE FEET BILLED ARE THE FEET ABOVE IT (Stuart 2026-10-01, H1-138TRV-4V/P at
                                                            // 144": "it is 4ft kit with 12ft total length wanted so it should be 8 additional feet"). The
                                                            // money was right — 8 ft × the kit row's $30 — but the line read "12 ft × $0.00": the pole's
                                                            // whole length against the item's own rate. A kit line (billedFeet) says what it bills.
                                                            ? <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-faint)' }}>{l.billedFeet !== undefined
                                                                ? `one pole · ${l.cutLength ? `${l.cutLength}" · ` : ''}${l.feet} ft — ${l.detail || ''}${l.billedFeet > 0 && l.total > 0 ? ` × $${(l.total / l.billedFeet).toFixed(2)}` : ''}`
                                                                : `one pole · ${l.cutLength ? `${l.cutLength}"` : ''} ${l.feet} ft × $${l.unit.toFixed(2)}`}</span>
                                                            : (l.qty > 1 && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-faint)' }}>×{l.qty}</span>)}
                                                        {l.extra && <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--ink-faint)' }}>added</span>}
                                                    </span>
                                                    <span style={{ display: 'block', fontSize: '11px', color: 'var(--ink-soft)', lineHeight: 1.25 }}>
                                                        {findPart((l.twinOf && l.soldPartId) || l.partId)?.itemName || l.name}
                                                    </span>
                                                    {/* ⚠ THE FINISH, ON EVERY LINE (Stuart 2026-08-21: "ideally under each item id and
                                                        description list the finish, this way we are covered in case people do choose
                                                        different finishes for different parts"). Naming it once at the top of the quote
                                                        is only honest while there are no exceptions — and the whole point of the finish
                                                        rail is that there can be. A part that wears nothing says so rather than going
                                                        quiet, because a blank line and an unfinished part look identical otherwise. */}
                                                    {(() => {
                                                        // ⚠ A KIT LINE SAYS WHAT ITS PARTS WEAR (Stuart 2026-10-02, H1-2RCTAEC: "now it takes no
                                                        // finish, which is correct for the acrylic portion but the collar does take finish"). It
                                                        // did — the collar billed and routed in EP2 — but the kit's parts are hidden lines, so the
                                                        // one line on screen was the kit's own "clear · takes no finish". Each part, and its finish.
                                                        const kitParts = (l.isKit && l.itemKit) ? (kitPartsByLine.get(l) || []) : [];
                                                        if (kitParts.length) return (
                                                            <span style={{ ...mono, display: 'block', fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
                                                                {kitParts.map((kp, ki) => {
                                                                    const kf = kp.finishCode ? finishByCode.get(String(kp.finishCode).toUpperCase()) : null;
                                                                    const label = kf ? (clientFinishName(kf) || ((kf.name && kf.name !== kf.code) ? kf.name : '')) : '';
                                                                    return (
                                                                        <span key={ki} style={{ display: 'block' }}>
                                                                            {kp.billedId || ourId(kp.partId)}{kp.qty > l.qty ? ` ×${kp.qty / (l.qty || 1)}` : ''} — {kf
                                                                                ? <span style={{ color: 'var(--brass)' }}>{label ? `${label} · ${kf.code}` : kf.code}</span>
                                                                                : (kp.subFinishCode ? <span style={{ color: 'var(--brass)' }}>{kp.subFinishCode} · stock colour</span> : (kp.noFinish ? 'clear · takes no finish' : 'mill · no finish'))}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </span>
                                                        );
                                                        const f = l.finishCode ? finishByCode.get(String(l.finishCode).toUpperCase()) : null;
                                                        if (f) return (
                                                            <span style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--brass)' }}>
                                                                {/* THEIR word for it first (the same 4.5 client mapping the chips use), else
                                                                    our name — never the code twice (Stuart 2026-09-09: "S11 · S11"). */}
                                                                {(() => { const theirs = clientFinishName(f); const ours = (f.name && f.name !== f.code) ? f.name : ''; const label = theirs || ours; return label ? <>{label}<span style={{ color: 'var(--ink-faint)' }}>{` · ${f.code}`}</span></> : f.code; })()}
                                                            </span>
                                                        );
                                                        // A STOCK-COLOUR PART (Stuart 2026-09-09: the track "should show the finish
                                                        // associated in library with P14"): made in the bronze / champagne aligned
                                                        // to the order's finish in 4.5, never painted unless the upcharge is added.
                                                        const stockPart = !l.extra && !l.noFinish && (String(l.role || '').toUpperCase() === 'TRACK' || !!findPart(l.partId)?.manufacturingSpecs?.usesSubFinish);
                                                        if (stockPart) {
                                                            const sub = String(finishByCode.get(String(globalFinish || '').toUpperCase())?.subFinishCode || '').toUpperCase();
                                                            const subObj = sub ? finishByCode.get(sub) : null;
                                                            return sub
                                                                ? <span style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--brass)' }}>{subObj?.name && subObj.name !== sub ? `${subObj.name} · ${sub}` : sub}<span style={{ color: 'var(--ink-faint)' }}> · stock colour</span></span>
                                                                : <span style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--rust, #a4442c)' }}>{globalFinish ? `no aligned track colour for ${globalFinish} — set it in 4.5` : 'stock colour follows the finish — choose one'}</span>;
                                                        }
                                                        return (
                                                            <span style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}>
                                                                {l.extra ? '' : (l.noFinish ? 'clear · takes no finish' : 'mill · no finish')}
                                                            </span>
                                                        );
                                                    })()}
                                                </td>
                                                <td style={{ padding: '3px 0', textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top', color: l.unit ? 'var(--ink)' : 'var(--ink-faint)' }}>${l.total.toFixed(2)}</td>
                                            </tr>
                                        ))}
                                        {!!priced.lines.length && (
                                            <tr><td style={{ borderTop: '1px solid var(--line)', paddingTop: '6px', fontWeight: 600 }}>Estimated unit</td>
                                                <td style={{ borderTop: '1px solid var(--line)', paddingTop: '6px', textAlign: 'right', fontWeight: 600 }}>${grandTotal.toFixed(2)}</td></tr>
                                        )}
                                    </tbody>
                                </table>
                                {/* An amber warning is a placeholder that reached a customer, not an
                                    error — it must be visible without reading as a fault. */}
                                {priceWarnings.map((w, i) => <div key={i} style={{ color: w.sev === 'amber' ? '#8a6508' : '#b00020', fontSize: '9px' }}>{w.sev === 'amber' ? '○' : '●'} {w.msg}</div>)}
                                {/* Over the one-piece limit with no joiner — allowed, never silent (Stuart 2026-10-01). */}
                                {noSplice && <div style={{ color: '#8a6508', fontSize: '9px' }}>○ No splice — this {lengthInches}&Prime; pole is over the {spliceOverIn}&Prime; one-piece limit and ships in ONE PIECE. {isTraverse ? 'Tick the joiner on the Traverse components step' : 'Add the joiner on the Pole length step'} if it should be spliced.</div>}
                                {!!priced.lines.length && <div style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}>Hover a line for the rule that set it{customerId ? '' : ' · no customer, so no client pricing'}</div>}
                            </div>
                        </div>

                        <div style={boxStyle}>
                            {boxHead('Notes & guidance', 'This step')}
                            <div style={{ padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto', maxHeight: '300px' }}>
                                {advice && (
                                    <div style={{ borderLeft: '2px solid var(--brass)', paddingLeft: '9px' }}>
                                        <span style={{ ...mono, fontSize: '8.5px', color: 'var(--brass)' }}>Recommendation</span>
                                        <p style={{ margin: '2px 0 0', fontSize: '12.5px', lineHeight: 1.45 }}>
                                            A support every <b>{ftIn(advice.spanInches)}</b> — {advice.why}. Your {lengthInches}" pole wants <b>{advice.brackets}</b>
                                            {advice.bracketsNoStud && advice.bracketsNoStud !== advice.brackets ? <>, or <b>{advice.bracketsNoStud}</b> off-stud</> : ''}.
                                        </p>
                                    </div>
                                )}
                                {!advice && lengthInches && (
                                    <div style={{ ...mono, fontSize: '9px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)', borderLeft: '2px solid var(--line)', paddingLeft: '9px' }}>
                                        No span guidance — this rod is not listed against a family in 6.5.
                                    </div>
                                )}
                                {/* A NOTE BELONGS TO THE STEP IT WAS WRITTEN ON (Stuart 2026-08-17).
                                    The box names the step from the rail, so the shop reads "Right
                                    Bracket: use the longer screws" rather than an unattributed
                                    sentence at the bottom of a quote. */}
                                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <span style={{ ...mono, fontSize: '8.5px' }}>
                                        Note · <span style={{ color: 'var(--brass)' }}>{step?.label || 'this step'}</span>
                                    </span>
                                    <textarea value={stepNotes[step?.key] || ''} onChange={e => setStepNotes(n => ({ ...n, [step.key]: e.target.value }))}
                                        placeholder={`Anything the shop needs to know about ${step?.label || 'this step'}`}
                                        style={{ minHeight: '54px', border: '1px solid var(--line)', padding: '7px 8px', fontFamily: 'var(--sans)', fontSize: '12.5px', resize: 'vertical', background: '#fff', color: 'var(--ink)' }} />
                                    {Object.entries(stepNotes).filter(([k, v]) => v && k !== step?.key).length > 0 && (
                                        <div style={{ ...mono, fontSize: '8px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)', lineHeight: 1.5 }}>
                                            {Object.entries(stepNotes).filter(([k, v]) => v && k !== step?.key).map(([k, v]) => {
                                                const st = steps.find(x => x.key === k);
                                                return <div key={k}><b style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>{st?.label || k}:</b> {v}{stepNoteClient[k] ? <span style={{ color: 'var(--brass)' }}> · customer sees this</span> : null}</div>;
                                            })}
                                        </div>
                                    )}
                                </label>
                                {/* CLIENT VISIBLE? (Stuart 2026-10-01: "if checked then the notes appear on their paperwork, if
                                    not checked (default) only pass on internal documents"). The shop always gets the note. */}
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', marginTop: '-4px' }}
                                    title="Off: the note goes to the shop only (View Item, the shop card). On: it ALSO prints on the customer's quote, sales order and invoice, under this configuration.">
                                    <input type="checkbox" checked={!!stepNoteClient[step?.key]} disabled={!step?.key}
                                        onChange={e => { const on = e.target.checked; const key = step.key; setStepNoteClient(m => { const n = { ...m }; if (on) n[key] = true; else delete n[key]; return n; }); }} />
                                    <span style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: stepNoteClient[step?.key] ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                        {stepNoteClient[step?.key] ? 'Shown to the customer — prints on their quote, order and invoice' : 'Show this note to the customer (off: shop only)'}
                                    </span>
                                </label>
                                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <span style={{ ...mono, fontSize: '8.5px' }}>Config memo · this line</span>
                                    <input value={configMemo} onChange={e => setConfigMemo(e.target.value)} placeholder="Living Room 1"
                                        style={{ padding: '7px 8px', border: '1px solid var(--line)', fontSize: '13px', background: '#fff', color: 'var(--ink)' }} />
                                    <span style={{ ...mono, fontSize: '8px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}>
                                        Prints on the quote line, the router and the floor. The job memo covers every configuration.
                                    </span>
                                </label>
                                {isSuperAdmin && (
                                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: '8px' }}>
                                        <button onClick={() => setShowDiag(v => !v)}
                                            style={{ ...mono, fontSize: '9px', background: 'transparent', border: '1px solid var(--line)', padding: '5px 9px', cursor: 'pointer', color: tagNotes.some(d => d.sev === 'red') ? '#b00020' : 'var(--ink-soft)' }}>
                                            {tagNotes.length ? `${tagNotes.length} tag note(s)` : 'Tags clean'}
                                        </button>
                                        {showDiag && (
                                            <div style={{ marginTop: '6px', fontFamily: 'var(--mono)', fontSize: '9px', lineHeight: 1.55 }}>
                                                {!tagNotes.length && <div style={{ color: '#2a7' }}>Every slot has options, the chosen parts agree, every tagged node exists, and Vision engineers the same projection this engine offers.</div>}
                                                {tagNotes.map((d, i) => (
                                                    <div key={i} style={{ color: d.sev === 'red' ? '#b00020' : '#8a6508' }}>
                                                        {d.sev === 'red' ? '●' : '○'} {d.kind} — {d.msg}
                                                        {/* The nodes themselves, behind one click: the count is
                                                            what you need to know, the names are what you need to
                                                            fix them. */}
                                                        {d.collapsed && (
                                                            <>
                                                                <span onClick={() => setShowGeo(v => !v)} style={{ marginLeft: '6px', color: 'var(--brass)', cursor: 'pointer', textDecoration: 'underline' }}>{showGeo ? 'hide' : 'list them'}</span>
                                                                {showGeo && (
                                                                    <div style={{ marginTop: '4px', paddingLeft: '10px', borderLeft: '1px solid var(--line)', color: 'var(--ink-faint)', maxHeight: '220px', overflowY: 'auto' }}>
                                                                        {d.collapsed.map((g, j) => <div key={j}>{g.msg.split(':')[0]}</div>)}
                                                                    </div>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                </div>
            </div>
          </div>
        </div>
    );
}

// The exported component is the fenced one — there is no way to mount the engine unprotected.
export default function HardwareConfigurator(props) {
    return <EngineBoundary><HardwareConfiguratorInner {...props} /></EngineBoundary>;
}
