import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds } from '@react-three/drei';
import { DynamicModel } from '../HQ/CPQTab';
import { StudioRig } from './studioScene';
import { resolve as resolveHardware, diagnose as diagnoseHardware, projectionAudit, finishesFor, reseatPicks, recommendedQty, takesQty, bearingEnds, centreBracketsFor, TRAVERSE, ROD_ROLES } from './hardwareModel';
import { TraverseConfiguratorPanel } from './TraverseConfiguratorModal';
import { configuratorLines, configuratorTotal, defaultPicks} from './traverseConfigurator';
import { traverseAnswersMissing, drawLabel } from './traverseDraw';
import { seedFromVision } from './visionBridge';
import { seedFromKit, applyKitPricing } from './kitSeed';
import { SIZE_STEP_TYPE, sizeSelectionsOf, buildSizeIndex, sizeVariantOf, partAllowedAtSize, returnsAllowedFor, renderScaleOf, projInchesOfSel } from './sizeMatrix';
import { choicesFromAssembly, modelNodesOf } from './hardwareAdapter';
import { priceConfiguration, priceChoice, pricingWarnings, aliasFor } from './hardwarePricing';
import { priceLevelShort, customerPriceLevel } from './priceLevels';
import { handoffItem, customerLines } from './hardwareHandoff';
import { finishLabelOf } from './finishLabel';
import { bracketAdviceFor, ftIn, FABRIC_CLASSES, DEFAULT_DROP_FT } from './bracketSpan';
import { renderThumbnails, cachedThumb } from './hardwareThumbs';

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

const AXIS_LABEL = { rodKind: 'Rod Type', setup: 'Single or Double', drive: 'Drive', mount: 'Mount', proj: 'Bracket Projection' };
const valueLabel = (axis, v) => {
    if (axis === 'proj') {
        const n = Number(v);
        const known = { 0.75: '.75"', 3.625: '3-5/8"', 4.625: '4-5/8"', 6: '6"' };
        return known[n] || `${n}"`;
    }
    return String(v).charAt(0) + String(v).slice(1).toLowerCase();
};
const slotLabel = (s) => {
    const kind = s.kind === 'END' ? 'End Treatment' : s.kind.charAt(0) + s.kind.slice(1).toLowerCase().replace('_', ' ');
    const cap = (w) => `${w.charAt(0)}${w.slice(1).toLowerCase()}`;
    // On a double every rod asks its own questions, so the rail must say WHICH ROD — "Front Rod",
    // "Back Left End Treatment". Without it a double shows two identical headings and the operator
    // is answering one of them blind.
    const parts = [s.tier ? cap(s.tier) : '', s.position ? cap(s.position) : '', kind].filter(Boolean);
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
    outsourceCodes = [], onAdd = null, onCheckout = null, cartCount = 0, flow = null, spanMap = {}, spanCaps = {}, extraItems = [], flowFinishes = [], trvRules = null, visionDraft = null,
    // Quick Ship kits this assembly could be started from. Empty on every flow that has none, and
    // the picker does not render — so a collection with no kits is untouched by all of this.
    kits = [],
}) {
    const [answers, setAnswers] = useState({});
    const [picks, setPicks] = useState({});     // slot key -> choice id
    const [kitPick, setKitPick] = useState('');      // the kit chosen as a starting point
    const [kitSource, setKitSource] = useState(null);  // { code, name, baseFeet, record } — bills as line 1
    const [kitReport, setKitReport] = useState(null);  // what it carried, missed, or refused
    const [showDiag, setShowDiag] = useState(false);
    const [showGeo, setShowGeo] = useState(false);   // the untagged-node list, behind its count
    const [whySlot, setWhySlot] = useState(null);   // slot key whose exclusions are being read
    const [globalFinish, setGlobalFinish] = useState('');
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
    const [extras, setExtras] = useState([]);         // [{ code, qty, note }] — added by hand
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
    const lengthInches = useMemo(() => {
        const whole = parseFloat(poleIn);
        const m = String(poleFrac).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
        const frac = m ? Number(m[1]) / Number(m[2]) : (parseFloat(poleFrac) || 0);
        const total = (Number.isFinite(whole) ? whole : 0) + (Number.isFinite(frac) ? frac : 0);
        return total > 0 ? total : null;
    }, [poleIn, poleFrac]);
    // ⚠ WE BILL IN FULL FEET, ROUNDED UP (Stuart 2026-08-17: "even if .25\" over we bill next foot
    // size"). A pole is cut from stock in whole feet, so 90 1/2" is eight feet of material however
    // the arithmetic reads. Showing the exact figure beside it keeps the operator honest about what
    // was measured versus what is being charged.
    const lengthFeetExact = lengthInches ? Math.round((lengthInches / 12) * 100) / 100 : null;
    const lengthFeet = lengthInches ? Math.ceil(lengthInches / 12) : null;


    // ── OUR PART NUMBER, RESOLVED ─────────────────────────────────────────────────────────────
    // This sits ABOVE the bracket advice on purpose. `advice` names ourId in its dependency list,
    // and a dependency list is read the moment the line runs — so with ourId still declared down in
    // the pricing section the whole configurator died on render with "Cannot access ... before
    // initialization" (2026-08-21). A `const` is not hoisted the way a function is; anything a hook
    // depends on has to be declared before it, not merely somewhere in the same component.
    const partIndex = useMemo(() => {
        const m = new Map();
        parts.forEach(pt => [pt.id, pt.itemId, pt.legacyErpId].forEach(k => {
            const kk = String(k || '').trim().toUpperCase();
            if (kk && kk !== 'PENDING' && !m.has(kk)) m.set(kk, pt);
        }));
        return m;
    }, [parts]);
    const findPart = useCallback((id) => partIndex.get(String(id || '').trim().toUpperCase()) || null, [partIndex]);

    // ── IS A SPLICE NECESSARY? (Stuart 2026-08-24) ───────────────────────────────────────────
    // "add the splice ability [to] the rod length step on the cpq — is splice necessary and
    //  default is center, explain if otherwise. this should help align it with the vision tool
    //  which is where we actually draw the splice location."
    // The splice among this flow's add-by-hand items is found the way tab 7 finds its splice
    // slot — by what the ITEM says it is (splice/joiner in its name, product type or fee type).
    // ⚠ AVAILABLE AT ANY LENGTH, MANDATORY OVER THE LIMIT (Stuart 2026-08-24: "a lot of times
    // customers order one before it is needed to save on shipping or for convenience. so it
    // needs to be mandatory over 120\" but can be available at any length"). The extras list
    // offers the splice at every length; over the flow's `spliceOverInches` (tab 11, blank =
    // 120") it is REQUIRED — added automatically at the default, CENTER of the run, and re-added
    // if removed, because a pole that long does not ship in one piece. The note carries the
    // exact location only when it differs, which is precisely what Vision reads to draw it.
    // Joiners are DIAMETER-SPECIFIC, and a multi-size flow derives several candidates — the
    // step must never guess a diameter, so with ONE candidate it adds it itself and with more
    // it requires the operator to add the right one (the banner says so).
    const spliceCodes = useMemo(() => {
        const out = [];
        for (const it of (extraItems || [])) {
            const part = findPart(it.code);
            const hay = `${it.code || ''} ${it.label || ''} ${part?.itemName || ''} ${part?.manufacturingSpecs?.productType || ''} ${part?.customData?.feeType || ''}`.toUpperCase();
            if (/SPLICE|JOINER|JNR|SPLC/.test(hay)) out.push(it.code);
        }
        return out;
    }, [extraItems, findPart]);
    const spliceCode = spliceCodes.length === 1 ? spliceCodes[0] : null;
    const spliceOverIn = Number(flow?.spliceOverInches) > 0 ? Number(flow.spliceOverInches) : 120;
    const spliceNeeded = spliceCodes.length > 0 && !!lengthInches && lengthInches > spliceOverIn;
    const spliceSatisfied = spliceCodes.some(c => extras.some(x => x.code === c && Number(x.qty) > 0));
    useEffect(() => {
        if (!spliceNeeded || !spliceCode) return;   // several candidates → the operator picks
        setExtras(a => (a.some(x => x.code === spliceCode && Number(x.qty) > 0) ? a : [...a.filter(x => x.code !== spliceCode), { code: spliceCode, qty: '1', note: '' }]));
    }, [spliceNeeded, spliceCode, extras]);
    // OUR PART NUMBER IS `legacyErpId` (Stuart 2026-08-17: "should be the field labelled legacy erp
    // id"). H1-138BE is the number the shop, the catalogue and the customer all use; CE-INV-61954 is
    // the app's own record id and means nothing off this screen. A pin can be tagged with either, so
    // the pin's id is resolved to the library item and OUR number read off it — never printed raw.
    // 'PENDING' is the placeholder on an item that has not been numbered yet, so it never prints.
    const ourId = useCallback((id) => {
        const pt = findPart(id);
        const legacy = String(pt?.legacyErpId || '').trim();
        if (legacy && legacy.toUpperCase() !== 'PENDING') return legacy;
        return String(pt?.itemId || id || '').trim();
    }, [findPart]);

    // ── ONE FLOW, EVERY DIAMETER (Stuart 2026-08-21) ─────────────────────────────────────────
    // "can you integrate the H2 combined flow with the new engine."
    //
    // H2-05 / H2-75 / H2-1 / H2-138 are ONE flow whose first question is the rod diameter, and the
    // geometry is the H2-138 master — the fullest of the four. Everything else is the same product
    // in another size, resolved through the code grammar (Shared/sizeMatrix). H1 goes the same way
    // next, which is why none of this is written per-collection.
    //
    // ⚠ THE SWAP HAPPENS ON THE CHOICE, WHICH IS WHY IT IS THIS SMALL. Change the part a pin points
    // AT and the whole engine follows for free: the cards name the right item, pricing bills it,
    // the BOM carries it, the push maps it, the handoff hands it over. The pin's NODES are left
    // alone on purpose — the render is the 138 master scaled, not four sets of geometry.
    const sizeSteps = useMemo(() => (flow?.steps || []).filter(st => st?.type === SIZE_STEP_TYPE), [flow]);
    const [sizePick, setSizePick] = useState({});       // size step id -> optId
    // sizeSelectionsOf falls back to the family's base cell, so `sel` is complete from the first
    // render — an unanswered diameter quotes the base size rather than nothing at all.
    const sizeSel = useMemo(() => (sizeSteps.length ? sizeSelectionsOf(flow, sizePick) : null), [flow, sizePick, sizeSteps]);
    const sizeIndex = useMemo(() => (sizeSel ? buildSizeIndex(parts) : null), [sizeSel, parts]);
    const choices = useMemo(() => {
        const raw = choicesFromAssembly(assembly, pins);
        if (!sizeSel || !sizeIndex) return raw;
        const returnsOk = returnsAllowedFor(sizeSel);
        const out = [];
        raw.forEach(c => {
            // A RETURN NEEDS DEPTH. At the shallow projection this collection makes no return, so
            // it is not offered — the same rule the old engine applies (returnsMinProj).
            if (!returnsOk && c.role === 'RETURN') return;
            const part = findPart(c.partId);
            if (!part) { out.push(c); return; }          // unresolvable parts are the diagnostics' problem
            // Not made at this size — not a choice at this size. A stamped family knows; an
            // unstamped part is left alone and behaves exactly as it does today.
            if (!partAllowedAtSize(part, sizeSel, sizeIndex)) return;
            const swapped = sizeVariantOf(part, sizeSel, sizeIndex);
            out.push(swapped.swapped && swapped.part ? { ...c, partId: swapped.part.id } : c);
        });
        return out;
    }, [assembly, pins, sizeSel, sizeIndex, findPart]);
    // The size matrix answers the projection question for a combined flow, so the engine's own
    // proj context is taken from it rather than asked twice. Untouched where there is no matrix.
    const sizeProjInches = useMemo(() => (sizeSel ? projInchesOfSel(sizeSel) : null), [sizeSel]);
    const effAnswers = useMemo(() => (sizeProjInches != null ? { ...answers, proj: sizeProjInches } : answers), [answers, sizeProjInches]);
    const modelNodes = useMemo(() => modelNodesOf(assembly), [assembly]);

    // ⚠ A PICK IS ONLY JUSTIFIED BY THE MODEL IT APPEARS IN, AND DROPPING ONE CHANGES THAT MODEL
    // (Stuart 2026-08-20: "it deletes the bracket arms which is correct but it leaves the
    //  backplates"). Pick brackets, then a return, and the plate stayed on the quote — three
    // BP-S lines for two brackets.
    //
    // The filter below has always dropped a pick that is no longer offered, but it read a model
    // built from the RAW picks — so the suppressed bracket was still "chosen" as far as the model
    // was concerned, the plate pool was still the bracket's plain pool, and the stale plate was
    // still a valid option. One pass cannot see this: it is DROPPING THE BRACKET that makes the
    // plate invalid, and that only becomes true on the next pass.
    //
    // So it settles. Each pass keeps the picks the current model still offers and re-resolves;
    // when a pass drops nothing, the selection and the model agree and we stop. In the steady
    // state — nothing to drop — this is exactly one resolve, as before.
    // ⚠ REPLACE THE PIN, KEEP THE PART (Stuart 2026-08-20: "the incorrect finial disappears — you
    // just need to replace with the correct one"). A finial is pinned once per bracket family, so
    // choosing the OTHER double bracket invalidates the pin the customer picked — but not the part
    // they chose. Dropping it empties a step they already answered and blames them for the
    // bracket. The same part number, cut for the bracket now chosen, is sitting right there in the
    // slot; the pick moves to it.
    //
    // Used for BOTH the settling below and the live picks the UI reads, so what renders, what is
    // billed and what shows as chosen can never disagree about which pin won.
    const resolvePicks = useCallback((m, raw) => reseatPicks(m, raw), []);

    const model = useMemo(() => {
        let sel = Object.values(picks).filter(Boolean);
        let m = resolveHardware({ choices, answers: effAnswers, selectedIds: sel, modelNodes });
        for (let pass = 0; pass < 4; pass++) {
            const next = Object.values(resolvePicks(m, picks));
            if (next.length === sel.length && next.every(id => sel.includes(id))) break;
            sel = next;
            m = resolveHardware({ choices, answers: effAnswers, selectedIds: sel, modelNodes });
        }
        return m;
    }, [choices, effAnswers, picks, modelNodes, resolvePicks]);

    // An answer higher up can invalidate a pick below it — choose the traverse rod and the standard
    // arm you had chosen is not offered any more. Rather than police that with a sweep (the thing
    // that deadlocked twice), the picks are simply FILTERED THROUGH the live options at render
    // time: a pick that is no longer offered is not shown as chosen and contributes no geometry.
    // Nothing to clear, nothing to re-seed, no order of operations to get wrong.
    // ── A DECISION ALREADY MADE IS NOT A STEP (Stuart 2026-08-21) ────────────────────────────
    // "when selecting the h1-2trv … the drive on step 1 manual or motorized, that can be set to
    // ahead and make the decision for the traverse end which is being presented as steps 12 + 13 …
    // it just only presents one choice since there is only one end for manual and one end for
    // motorized so this just really needs to be put in the bom and not presented as another
    // decision that has already been made by selecting the drive choice."
    //
    // Exactly so. The traverse end is a REAL part that differs by drive — which is why it has its
    // own role rather than sitting in the track picker — and the drive answer at step 1 already
    // names it. Asking again is asking the same question twice and calling the second one step 12.
    //
    // ⚠ THE TAGS ALREADY DID THE WORK. This adds no rule about drives: the end that survives is the
    // one whose tag admits the answer given, which is the same filtering every other slot gets. All
    // that changes is that a slot left holding ONE end stops being a question and becomes a pick
    // the engine makes — so it prices, renders, reaches the BOM and pushes exactly as if it had
    // been clicked. Tag a second manual end tomorrow and the question comes back on its own.
    const settledKeys = useMemo(() => new Set(
        model.slots.filter(s => s.kind === 'TRV_END' && s.options.length === 1).map(s => s.key)
    ), [model]);
    const livePicks = useMemo(() => {
        const auto = {};
        model.slots.forEach(s => { if (settledKeys.has(s.key)) auto[s.key] = s.options[0].id; });
        // An operator's own pick still wins, so nothing here can overwrite an answer.
        return { ...auto, ...resolvePicks(model, picks) };
    }, [model, picks, resolvePicks, settledKeys]);


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
        });
        if (Object.keys(seed.answers).length) setAnswers(a => ({ ...a, ...seed.answers }));
        if (Object.keys(seed.picks).length) setPicks(p => ({ ...p, ...seed.picks }));
        // ── THE DRAWN SPLICES ARRIVE AS THE EXTRA THEY BILL AS (Eric 2026-08-25) ─────────────
        // Two splices drawn at 36" from each end must land on the order as the flow's joiner with
        // their locations in the note — that note is the same contract the length step banner
        // states ("Vision draws the splice where the note says"), read in the other direction.
        if ((seed.splices || []).length) {
            if (spliceCodes.length === 1) {
                const code = spliceCodes[0];
                const posTxt = seed.splices.map(sp => sp.note
                    || (sp.distInches != null ? `${sp.distInches}" from ${sp.ref === 'END' ? 'right edge' : 'left edge'}` : 'center')).join(' · ');
                setExtras(prev => (prev.some(x => x.code === code && Number(x.qty) > 0) ? prev
                    : [...prev.filter(x => x.code !== code), { code, qty: String(seed.splices.length), note: posTxt }]));
                seed.carried.push(`${seed.splices.length} splice${seed.splices.length > 1 ? 's' : ''} — ${posTxt}`);
            } else {
                seed.missed.push({
                    what: `${seed.splices.length} drawn splice${seed.splices.length > 1 ? 's' : ''}`,
                    why: spliceCodes.length
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
    }, [visionDraft, model, flow, findPart, choices, effAnswers, modelNodes, spliceCodes]);

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
        if (seed.lengthInches) { setPoleIn(String(Math.floor(seed.lengthInches))); setPoleFrac(''); }
        setKitReport({ name, blocked: null, carried: seed.carried, missed: seed.missed });
        // The kit now OWNS the first line of the bill, and the feet above its base set bill under
        // it. Held as the record, not a number: the price is resolved at pricing time through the
        // same rules every other line uses (customer row, level, alias) rather than re-derived.
        setKitSource({ code: name, name: chosen.itemName || name, baseFeet: Number(chosen.manufacturingSpecs.kitAlign.minFeet) || 4, record: chosen });
    };

    // The bracket recommendation, from the engineering in 6.5 rather than a number in this file.
    //
    // ⚠ 6.5 IS KEYED ON OUR ITEM CODE, AND A PIN CARRIES THE LIBRARY DOC ID (Stuart 2026-08-20:
    // "the fabric weight for bracket span states nothing is set up, but it is set up"). It IS set
    // up — `H1-1.375 → H1-138R` — but this asked for `CE-INV-61954`, which no family claims, so
    // every rod reported itself unlisted. ourId() is the same resolver the cards and the quote
    // lines use, so what we look up is now what he typed in 6.5.
    const advice = useMemo(() => {
        // ⚠ READS `model`, NOT `resolved` (2026-08-20). The centre-bracket recommendation feeds
        // the quantities, which feed resolve — so taking the rod from the RESOLVED model would
        // close the loop: advice → quantities → resolved → advice. The pre-quantity model already
        // knows which rod was chosen, and a count never changes that.
        const ids = new Set(Object.values(livePicks));
        const rod = model.choices.find(c => ids.has(c.id) && ['ROD', 'FASCIA', 'TRACK'].includes(c.role));
        if (!rod || !lengthInches) return null;
        return bracketAdviceFor({ itemCode: ourId(rod.partId) || rod.name || rod.partId, map: spanMap, caps: spanCaps, rodInches: lengthInches, fabricId, dropFt: DEFAULT_DROP_FT });
    }, [model, livePicks, lengthInches, spanMap, spanCaps, fabricId, ourId]);

    // ── HOW MANY OF EACH (Stuart 2026-08-20) ─────────────────────────────────────────────────
    // Rings and carriers are spaced along the pole, so their count follows its length: four a foot
    // plus the pair at the ends. That is a RECOMMENDATION — it seeds the field so the ordinary
    // order needs no typing, and anything typed wins and is never overwritten.
    //
    // Carriers are riders: never offered, always built. They still need the right count, so they
    // are seeded here rather than at a step that does not exist.
    // How many the ENGINEERING wants for a step, or null where nothing decides it. Rings and
    // carriers come from the length; the centre bracket comes from the span less whatever the ends
    // are already carrying. Read by both the seeding below and the field's placeholder, so what is
    // billed and what is shown can never drift apart.
    const recommendFor = useCallback((slot, choice) => {
        if (!slot) return null;
        if (slot.kind === 'BRACKET' && String(slot.position || '').toUpperCase() === 'CENTER') {
            return advice ? centreBracketsFor(advice.brackets, bearingEnds(model.choices, Object.values(livePicks))) : null;
        }
        return recommendedQty(choice, lengthFeet);
    }, [advice, model, livePicks, lengthFeet]);

    const quantities = useMemo(() => {
        const q = {};
        model.slots.forEach(sl => {
            const id = livePicks[sl.key];
            if (!id) return;
            const typed = Number(stepQty[sl.key]);
            if (typed > 0) { q[id] = typed; return; }
            const rec = recommendFor(sl, sl.options.find(o => o.id === id));
            if (rec != null && rec > 0) q[id] = rec;
        });
        (model.riders || []).forEach(r => {
            const rec = recommendedQty(r, lengthFeet);
            if (rec) q[r.id] = rec;
        });
        return q;
    }, [model, livePicks, stepQty, lengthFeet, recommendFor]);

    const resolved = useMemo(
        () => resolveHardware({ choices, answers: effAnswers, selectedIds: Object.values(livePicks), modelNodes, quantities }),
        [choices, effAnswers, livePicks, modelNodes, quantities]);
    const visibleOverrides = useMemo(() => {
        const o = {};
        resolved.visible.forEach(n => { o[String(n).toLowerCase()] = true; });
        return o;
    }, [resolved]);
    // 🧊 The clear parts, from the TAG — never from a mesh name. Passing this switches the renderer
    // off its hardcoded acrylic item-code list entirely for this configurator.
    const clearList = useMemo(() => [...resolved.clear].map(n => String(n).toLowerCase()), [resolved]);

    const finishByCode = useMemo(() => {
        const m = new Map();
        finishes.forEach(f => { const k = String(f.code || f.name || '').toUpperCase(); if (k) m.set(k, f); });
        return m;
    }, [finishes]);
    const chosenList = useMemo(
        () => [...resolved.choices.filter(c => Object.values(livePicks).includes(c.id)), ...resolved.riders, ...resolved.companions],
        [resolved, livePicks]);
    // What a given part is wearing: its own finish in per-part mode, the configuration's otherwise.
    // ONE FINISH, THEN ANY EXCEPTIONS (Stuart 2026-08-17: "select a finish once for the whole
    // config, select again at any part you would like in another finish"). The override is always
    // available — it is not a mode to turn on. A part wears its own finish if one was set for it,
    // and the configuration's otherwise, so the common order is one click and the mixed one is two.
    const finishFor = useCallback((c) => partFinish[c.id] || globalFinish, [partFinish, globalFinish]);

    // ── THE FINISH A LINE IS ACTUALLY BILLED AND SPRAYED IN (Stuart 2026-08-21) ───────────────
    // "once the finish is chosen to the left it needs to list the chosen color in the pricing
    // window as well of course in the bom to send along to finishing … in case people do choose
    // different finishes for different parts."
    //
    // Three things had to agree and only two did. The RENDER already painted per part; the PRICE
    // and the sheet that reaches finishing read one code for the whole configuration. So brass
    // rings on a black pole rendered brass, billed the black variant and told the floor black.
    //
    // ⚠ AN EXCEPTION IS KEYED ON THE CHOICE, AND A PART IS OFTEN SEVERAL PINS. A pole is three —
    // left, core, right — so a finish set on the one the customer clicked would leave its own other
    // two segments billing the configuration finish. The exception therefore travels by PART: same
    // part number, same finish, which is what "just this part" means to the person clicking it.
    const partFinishByPart = useMemo(() => {
        const m = {};
        Object.entries(partFinish).forEach(([id, code]) => {
            const c = model.choices.find(x => x.id === id);
            if (c?.partId) m[String(c.partId).toUpperCase()] = code;
        });
        return m;
    }, [partFinish, model]);
    // …and the MATERIAL GATE is applied here, exactly as the renderer applies it: a part wears only
    // a finish its material can take, so a wood stain chosen for the configuration does not bill a
    // stained bracket, and clear acrylic bills and sprays as nothing at all.
    const lineFinishFor = useCallback((choice) => {
        if (!choice || choice.noFinish) return '';
        const code = partFinish[choice.id] || partFinishByPart[String(choice.partId || '').toUpperCase()] || globalFinish;
        if (!code) return '';
        const f = finishByCode.get(String(code).toUpperCase());
        if (!f || !finishesFor(choice, [f]).length) return '';
        return code;
    }, [partFinish, partFinishByPart, globalFinish, finishByCode]);

    // NODE → TEXTURE. A no-finish part is skipped entirely, so the clear rule paints it instead —
    // the collar of a two-part finial takes the finish, the acrylic top never does.
    const textureOverrides = useMemo(() => {
        const out = {};
        // ⚠ PAINT WHAT RENDERS, NOT WHAT WAS CLICKED (Stuart 2026-08-17: "the right end treatment is
        // not rendering the finish properly on the rod, only the end treatment is, the left side
        // works"). A three-piece pole is three PINS but one decision: choosing the rod renders its
        // left, core and right segments, yet only the pin the customer's answer points AT was in the
        // chosen list — so the other segments rendered in mill finish beside a brass one. Painting
        // per-click can only ever be right for parts that are one pin, which the pole is not.
        //
        // So the finish walks the VISIBLE set instead, the same set the renderer draws: every node
        // that renders is painted by the finish of the part that OWNS it, and a segment inherits
        // from the rod it belongs to — same partId, same decision, same finish, by construction.
        const chosenIds = new Set(chosenList.map(c => c.id));
        const byPart = new Map();
        chosenList.forEach(c => { if (c.partId) byPart.set(String(c.partId).toUpperCase(), c); });
        (resolved.visible ? [...resolved.visible] : []).forEach(node => {
            const owner = resolved.ownership?.owner?.get(node);
            if (!owner) return;
            // The owner itself if it was chosen; otherwise the chosen part it is a piece of.
            const c = chosenIds.has(owner.id) ? owner
                : (owner.partId ? byPart.get(String(owner.partId).toUpperCase()) : null);
            if (!c || c.noFinish || owner.noFinish) return;
            const f = finishByCode.get(String(finishFor(c)).toUpperCase());
            // The material gate, applied at the last moment: a global pick of a wood stain simply
            // does not land on the steel brackets, and nothing lands on the acrylic.
            if (!f || !finishesFor(c, [f]).length) return;
            const url = f.textureUrl || f.finalImageUrl;
            if (url) out[String(node).toLowerCase()] = url;
        });
        return out;
    }, [resolved, chosenList, finishByCode, finishFor]);

    // ── PRICE ─────────────────────────────────────────────────────────────────────────────────
    // ── OUR COST TO THEM IS THE DEFAULT, ONCE THERE IS A "THEM" ──────────────────────────────
    // Stuart 2026-08-17: "it should default at our cost to them". The tier in the Customer Alias &
    // Pricing box only ever applied ABOVE Standard, so a connected customer still quoted off the
    // item's own base price — which a mill item does not have, hence a screen of $0.00 lines with
    // a perfectly good 12.50 sitting in the box beside them. Standard is "our pricing", and our
    // pricing to a NAMED account is the cost column; with nobody named there is no tier to read
    // and Standard is the only honest answer.
    //
    // This is a DEFAULT, not an override: choosing Wholesale or Retail still wins, an item with no
    // tier data still falls through to its customer row and then its base price, and the level in
    // force is named on screen beside the total so a quote can never be priced off a tier nobody
    // could see.
    // ⚠ THE LEVEL IS THE CUSTOMER'S, NOT "any customer gets Fabricut's" (Stuart 2026-08-22). One
    // shared answer, read by CPQ, Quick Ship and the portal alike — see Shared/priceLevels.
    const { level: effectiveLevel, isDefault: levelIsDefault } = customerPriceLevel(customer, priceLevel);

    const priceCtx = useMemo(() => ({
        customerId, customer, priceLevel: effectiveLevel, outsourceCodes,
        // Whether that level was CHOSEN or defaulted decides whether it outranks the customer's own
        // negotiated row — see the precedence in hardwarePricing.
        levelIsDefault,
        finishCode: globalFinish, finishFor: lineFinishFor, findPart, findByCode: findPart,
        // The flow's per-kind fallback, used only where a part has no price under any rule (tab 11).
        fallbackPrices: flow?.fallbackPrices || null,
        // What the rods are cut from — see the per-foot rule in priceConfiguration. The
        // inches travel too: they become the line's cutLength, which is what the bench reads.
        billedFeet: lengthFeet || 0,
        lengthInches: lengthInches || 0,
    }), [customerId, customer, effectiveLevel, levelIsDefault, outsourceCodes, globalFinish, lineFinishFor, findPart, lengthFeet, lengthInches, flow]);
    // ⚠ THE KIT TRANSFORM RUNS ONLY WHERE A KIT WAS CHOSEN. Every other configuration gets
    // priceConfiguration's answer verbatim, which is what keeps four tested collections still.
    // ⚠ ONE DESCRIPTION OF THE BILL, USED TWICE. The panel below and the cart item built at Add
    // must never disagree about money, and handoffItem prices the configuration AGAIN from
    // `resolved` — so the kit has to travel to it rather than being applied only on screen. It is
    // computed once here and passed to both.
    const kitBill = useMemo(() => {
        if (!kitSource) return null;
        const kp = priceChoice({ partId: kitSource.code }, kitSource.record, priceCtx);
        return {
            kitCode: kitSource.code, kitName: kitSource.name, kitPrice: kp?.price || 0,
            baseFeet: kitSource.baseFeet,
            // THEIR number, resolved by the same rule every other line's alias is.
            clientSku: kp?.sku || kp?.aliasCode || '',
        };
    }, [kitSource, priceCtx]);
    const priced = useMemo(() => {
        const p = priceConfiguration(resolved, priceCtx);
        return kitBill ? applyKitPricing(p, kitBill) : p;
    }, [resolved, priceCtx, kitBill]);
    // Their number for any part, chosen or not — the picker is where it is most useful.
    const aliasOf = useCallback((id) => aliasFor(findPart(id), priceCtx), [findPart, priceCtx]);
    // The finishes this configuration actually wears — the configuration's own, plus any per-part
    // exception. RTG reads the label off this, so it must be what is on the parts, not what is
    // selected in the panel.
    const chosenFinishObjects = useMemo(() => {
        const codes = new Set([globalFinish, ...Object.values(partFinish)].filter(Boolean).map(c => String(c).toUpperCase()));
        return [...codes].map(c => finishByCode.get(c)).filter(Boolean);
    }, [globalFinish, partFinish, finishByCode]);
    // A hidden part with no price is still a real problem — it just is not the operator's, so it
    // is reported quietly rather than in red on a quote they cannot act on.
    const priceWarnings = useMemo(() => pricingWarnings({ lines: priced.lines.filter(l => !l.hidden) }), [priced]);
    // Added by hand — priced by the SAME chain as everything else (override → price level → client
    // row → base). A splice a customer negotiated is still that customer's price; nothing about it
    // being typed in rather than resolved changes what they pay for it.
    const extraLines = useMemo(() => extras.filter(x => x.code).map(x => {
        const part = findPart(x.code);
        const qty = Number(x.qty) > 0 ? Number(x.qty) : 1;
        const p = priceChoice({ partId: x.code }, part, priceCtx);
        return { partId: x.code, name: part?.itemName || x.code, qty, unit: p.price, total: p.price * qty,
                 sku: p.sku || p.aliasCode, source: p.source, detail: p.detail, note: x.note, extra: true,
                 // Priced at the configuration's finish, so it says so — a row with no finish under
                 // it beside rows that have one reads as an oversight rather than a fact.
                 finishCode: globalFinish };
    }), [extras, findPart, priceCtx, globalFinish]);

    // ── TRAVERSE COMPONENTS ARE THE LAST QUESTION A TRACK ASKS (Stuart 2026-08-21) ────────────
    // "integrate that simple configurator at the last step of any traverse rod … it basically has
    // two options, the manual components and the motorized components, that is what decides what
    // is shown."
    //
    // The old engine interposed this as a MODAL on Add to Cart, and the new engine's onAdd went
    // straight to the cart — so a traverse configuration reached a quote with no track components
    // on it at all, silently. It is not a checkout interruption here: it is the last step of the
    // walk, because that is what it is. A track without its carriers is not a finished decision.
    //
    // DRIVE IS ALREADY AN ANSWER. The engine asks manual vs motorised as a world axis (AXES, order
    // 25) wherever a collection stocks both, so nothing new is asked — the answer already given is
    // what gates the list, exactly as the rules doc gates it.
    const isTraverse = useMemo(() => {
        const ids = new Set(Object.values(livePicks));
        return model.choices.some(c => ids.has(c.id) && ROD_ROLES.includes(c.role) && c.rodKind === TRAVERSE);
    }, [model, livePicks]);
    // MANUAL unless the answer says motorised — the rules doc speaks MANUAL / MOTORIZED / BOTH, and
    // a collection that never asks the question is manual by construction.
    const trvDrive = /MOTOR/.test(String(answers.drive || '').toUpperCase()) ? 'MOTORIZED' : 'MANUAL';
    const trvFeet = Math.max(lengthFeet || 4, 4);
    const trvTracks = String(answers.setup || '').toUpperCase() === 'DOUBLE' ? 2 : 1;
    const trvPriceOf = useCallback((code) => {
        const part = findPart(code);
        return part ? (priceChoice({ partId: code }, part, priceCtx).price || 0) : 0;
    }, [findPart, priceCtx]);
    const trvItemInfo = useCallback((code) => {
        const part = findPart(code);
        if (!part) return null;
        const p = priceChoice({ partId: code }, part, priceCtx);
        return { name: part.itemName || code, sku: p.sku || p.aliasCode || '' };
    }, [findPart, priceCtx]);
    // The selection SEEDS from the chart and stays seeded until it is touched: a length typed after
    // the panel was first drawn re-seeds it, because the chart quantity IS a function of length and
    // a stale count is a wrong count. Once the operator has answered, their answer stands.
    const [trvSel, setTrvSel] = useState(null);
    const trvSeed = useMemo(() => (trvRules && isTraverse
        ? { carrierStyle: '', carrierQty: '', draw: '', motorSide: '', picks: defaultPicks({ rules: trvRules, drive: trvDrive, feet: trvFeet, trackCount: trvTracks }), accessories: {} }
        : null), [trvRules, isTraverse, trvDrive, trvFeet, trvTracks]);
    const trvLive = trvSel || trvSeed;
    const trvComponents = useMemo(() => ((trvRules && isTraverse && trvLive)
        ? configuratorLines({ rules: trvRules, drive: trvDrive, feet: trvFeet, sel: trvLive, priceOf: trvPriceOf })
        : []), [trvRules, isTraverse, trvLive, trvDrive, trvFeet, trvPriceOf]);
    // On the quote the same way they land on the cart item: an included component rides at $0 so
    // the documents and the BOM still show every part the order carries.
    const trvLines = useMemo(() => trvComponents.map(c => ({
        partId: c.code, name: c.why || c.code, qty: c.qty,
        unit: c.billable ? c.rate : 0, total: c.billable ? c.rate * c.qty : 0,
        source: 'traverse components', detail: c.billable ? c.why : `included — ${c.why}`, extra: true,
    })), [trvComponents]);

    const grandTotal = priced.total + extraLines.reduce((s2, l) => s2 + l.total, 0) + configuratorTotal(trvComponents);



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
    useEffect(() => {
        if (!cadUrl || !onScreen.length) return;
        let live = true;
        // Anything already cached paints on the first pass; the rest arrive one frame at a time.
        const seed = {};
        onScreen.forEach(g => { const c = cachedThumb(cadUrl, g.nodes); if (c !== undefined) seed[g.key] = c; });
        if (Object.keys(seed).length) setThumbs(t => ({ ...seed, ...t }));
        renderThumbnails(cadUrl, onScreen, (k, data) => { if (live) setThumbs(t => (t[k] === data ? t : { ...t, [k]: data })); });
        return () => { live = false; };
    }, [cadUrl, onScreen]);

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
        // Placed by the ENDS rather than by a fixed index, so it lands correctly whatever the
        // collection offers: right after the last end treatment, or at the back if a collection has
        // no end steps at all.
        const lengthStep = { kind: 'LENGTH', key: 'length', label: 'Pole length' };
        let lastEnd = -1;
        out.forEach((st, i) => { if (st.kind === 'SLOT' && st.slot.kind === 'END') lastEnd = i; });
        if (lastEnd >= 0) out.splice(lastEnd + 1, 0, lengthStep); else out.push(lengthStep);
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

    // The one thing a rod step cannot say for itself: that leaving it empty is an ANSWER. A track
    // omitted is a fascia wearing rings, which is a different product rather than a blank.
    const hintFor = useCallback((st) => {
        if (!st || st.kind !== 'SLOT') return '';
        if (st.slot.kind === 'TRACK') return 'Choose the front track for traverse — omit it to use rings on the fascia.';
        return '';
    }, []);

    const [stepIx, setStepIx] = useState(0);
    const ix = Math.min(stepIx, Math.max(0, steps.length - 1));
    const step = steps[ix];
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
    // NOTES BELONG TO THE STEP THE OPERATOR IS ON (Stuart 2026-08-17). A note typed while deciding
    // the right bracket is about the right bracket; filing them all into one box loses which
    // decision they were about, which is the only thing that makes them useful downstream.
    // EXTRAS — basic items added by hand: a splice, an extra ring, whatever the flow does not model.
    const [saved, setSaved] = useState([]);
    const addConfiguration = () => {
        if (!priced.lines.length) return;
        // THE HANDOFF IS BUILT HERE, in the shape CPQ has always written — so the shop floor, the
        // finishing floor, RTG, the ERP push and the CRM documents all keep working without
        // knowing which engine produced the order. onAdd is what puts it in the cart; without one
        // the strip still works, so the configurator is usable before the cart is wired.
        const item = handoffItem(resolved, {
            ...priceCtx, assembly, flow, findPart, qty: 1,
            sidemark: configMemo, memo: configMemo,
            finishes: chosenFinishObjects, finishLabel: finishLabelOf(chosenFinishObjects),
            priceLevel: effectiveLevel, lengthInches, lengthFeet,
            extras, stepNotes, answers, picks: livePicks, partFinish,
            // The kit, so the cart bills exactly what the panel showed.
            kit: kitBill,
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
                cloneSpecs: [],
                defaultHidden: true,
                clearNodes: clearList,
            } : null,
        });
        if (typeof onAdd === 'function') onAdd(item);
        setSaved(s => [...s, { memo: configMemo || `Configuration ${s.length + 1}`, total: grandTotal, lines: customerLines(priced.lines).length }]);
        setConfigMemo(''); setPicks({}); setAnswers({}); setPoleIn(''); setPoleFrac('');
        setStepNotes({}); setExtras([]); setPartFinish({}); setTrvSel(null); setStepIx(0);
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
    // A FINISH IS NAMED, NOT JUST COLOURED (Stuart 2026-08-17: "make the finish chips bigger and
    // place the name under each one, our code along with customer name"). The customer's own word
    // for it comes from the finish's client mapping — it is what they will say on the phone.
    const clientFinishName = useCallback((f) => {
        if (!customerId && !customer) return '';
        const keys = new Set([customerId, customer?.name, customer?.companyName].filter(Boolean).map(v => String(v).trim().toUpperCase()));
        const hit = (Array.isArray(f.clientMapping) ? f.clientMapping : []).find(m => keys.has(String(m.customerId || '').trim().toUpperCase()));
        return hit?.clientFinishName || '';
    }, [customerId, customer]);
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
    // Material first, then where it is done — in-house and outsourced price and lead differently.
    // ── WHAT THIS FLOW OFFERS, IN ONE PLACE (Stuart 2026-08-21) ──────────────────────────────
    // "when selecting brimar flow at first its just there selected finishes, but as soon as i click
    // on one it opens the full library of finishes even the ones not selected in tab 11."
    //
    // The flow's list was applied where the swatches are GROUPED and nowhere else, so the moment a
    // part was picked the per-part row underneath — "just this part" — offered the whole library.
    // A collection that has been narrowed to its own finishes must stay narrowed everywhere, or the
    // narrowing is decoration: one wrong click and a Brimar quote wears a finish Brimar does not
    // sell. An empty list still means "never narrowed", which is every flow's behaviour before the
    // control existed.
    const offeredFinishes = useMemo(() => (flowFinishes.length
        ? finishes.filter(f => flowFinishes.includes(f.code || f.finishCode || f.name || f.id))
        : finishes), [finishes, flowFinishes]);

    const finishGroups = useMemo(() => {
        // …and then the parts have their say: a finish no chosen part can wear is not offered.
        const usable = offeredFinishes.filter(f => !chosenList.length || chosenList.some(c => finishesFor(c, [f]).length));
        const byMat = new Map();
        usable.forEach(f => {
            const m = String(f.material || f.type || 'METAL').toUpperCase();
            if (!byMat.has(m)) byMat.set(m, { inHouse: [], out: [] });
            // A METAL finish splits by how it is applied — painted here, plated by a vendor. WOOD
            // does not: a stain is a stain whichever side of the wall it is done on, so it stays one
            // list rather than being cut in two and labelled the same thing twice.
            const splits = !m.includes('WOOD');
            const out = splits && (f.multiplier !== undefined || f.vendor);
            (out ? byMat.get(m).out : byMat.get(m).inHouse).push(f);
        });
        return [...byMat.entries()];
    }, [offeredFinishes, chosenList]);

    // ── WHAT THE FINISH IS, NOT WHO APPLIES IT (Stuart 2026-08-21) ──────────────────────────
    // "we can rename the categories to Wood, Painted and Plated rather than in house and
    // outsourced, just changing the naming conventions."
    //
    // Right, and it is not only nicer language: in house / outsourced is OUR problem, and it was on
    // a screen where the question is what the customer is buying. The split underneath is unchanged
    // — a paint we apply here, a plating a vendor does — only what it is called. A wood group is
    // wood whichever side of the wall it is finished on, so it says so once instead of splitting.
    const groupLabel = (mat, kind) => {
        const m = String(mat || '').toUpperCase();
        if (m.includes('WOOD')) return 'Wood';
        if (m.includes('METAL')) return kind === 'out' ? 'Plated' : 'Painted';
        return kind === 'out' ? 'Outsourced' : 'In house';   // an unfamiliar material keeps the old words
    };

    const finishPanel = (
        <div style={{ ...boxStyle, minHeight: '0', position: 'sticky', top: '12px' }}>
            {boxHead('Finish', Object.keys(partFinish).length ? `${Object.keys(partFinish).length} exception(s)` : 'Whole configuration')}
            {/* Said once, where the decision is made — the two-click rule is not obvious from a
                grid of swatches, and an operator who does not know it quotes the whole rod in one
                finish when the customer asked for brass rings on a black pole. */}
            <div style={{ padding: '9px 13px', borderBottom: '1px solid var(--line)', background: 'var(--paper)', fontSize: '11px', lineHeight: 1.45, color: 'var(--ink-soft)' }}>
                Select a finish once for the whole configuration. Select again at any part you would
                like in another finish.
            </div>
            <div style={{ padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', maxHeight: 'calc(100vh - 160px)' }}>
                {!finishGroups.length && <span style={{ ...mono, fontSize: '9px', color: 'var(--ink-faint)' }}>Choose a part to see its finishes.</span>}
                {finishGroups.map(([mat, g]) => (
                    <div key={mat} style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                        <span style={{ ...mono, fontSize: '9px' }}>{mat} <span style={{ color: 'var(--ink-faint)' }}>· {g.inHouse.length + g.out.length}</span></span>
                        {!!g.inHouse.length && (<div style={{ paddingLeft: '7px', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ ...mono, fontSize: '8px', color: 'var(--ink-faint)' }}>{groupLabel(mat, 'in')} · {g.inHouse.length}</span>
                            {swatchRow(g.inHouse, globalFinish, setGlobalFinish)}
                        </div>)}
                        {!!g.out.length && (<div style={{ paddingLeft: '7px', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ ...mono, fontSize: '8px', color: 'var(--ink-faint)' }}>{groupLabel(mat, 'out')} · {g.out.length}</span>
                            {swatchRow(g.out, globalFinish, setGlobalFinish)}
                        </div>)}
                    </div>
                ))}
                {step?.kind === 'SLOT' && livePicks[step.slot?.key] && (() => {
                    const o = step.slot.options.find(x => x.id === livePicks[step.slot.key]);
                    if (!o || o.noFinish) return null;
                    return (
                        <div style={{ borderTop: '1px solid var(--line)', paddingTop: '9px' }}>
                            <span style={{ ...mono, fontSize: '8.5px', color: 'var(--brass)', display: 'flex', alignItems: 'baseline', gap: '7px' }}>
                                Just this part · {ourId(o.partId)}
                                {partFinish[o.id] && <button onClick={() => setPartFinish(pf => { const n = { ...pf }; delete n[o.id]; return n; })}
                                    style={{ ...mono, fontSize: '7.5px', border: '1px solid var(--line)', background: '#fff', padding: '2px 5px', cursor: 'pointer', color: 'var(--ink-soft)' }}>back to config finish</button>}
                            </span>
                            {/* THE SAME LIST THE GRID USES — see offeredFinishes. This row reading
                                the unfiltered library is what let a narrowed flow show everything. */}
                            {swatchRow(finishesFor(o, offeredFinishes), partFinish[o.id] || globalFinish, (c) => setPartFinish(pf => ({ ...pf, [o.id]: c })))}
                        </div>
                    );
                })()}
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
            {!!kits.length && (
                <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <span style={{ ...mono, fontSize: '8.5px', color: 'var(--ink-soft)' }}>Start from a kit</span>
                    <select value={kitPick} onChange={e => applyKit(e.target.value)}
                        style={{ padding: '6px 8px', border: '1px solid var(--line)', background: '#fff', fontSize: '12px', minWidth: '260px' }}>
                        <option value="">— configure from scratch —</option>
                        {kits.map(k => (
                            <option key={k.id || k.legacyErpId} value={String(k.id || k.legacyErpId || '')}>
                                {k.legacyErpId || k.itemName}{k.itemName && k.legacyErpId ? ` · ${k.itemName}` : ''}
                            </option>
                        ))}
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
                            {kitReport.blocked ? 'This assembly cannot build' : 'Started from kit'} · {kitReport.name}
                        </div>
                        {kitReport.blocked && (
                            <div style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: '#b00020', marginTop: '3px' }}>
                                ⚠ {kitReport.blocked.what} — {kitReport.blocked.why} Nothing was filled in.
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
                    {configMemo || 'This configuration'} <b style={{ fontWeight: 400, color: 'var(--brass)', marginLeft: '5px' }}>${grandTotal.toFixed(2)}</b>
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
                <button onClick={addConfiguration} disabled={!priced.lines.length}
                    style={{ ...mono, marginLeft: 'auto', padding: '7px 12px', cursor: priced.lines.length ? 'pointer' : 'not-allowed', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', opacity: priced.lines.length ? 1 : .4 }}>
                    + Add configuration
                </button>
                {/* CHECKOUT IS A JOB-LEVEL ACT, so it sits with the configurations rather than at
                    the end of a walk: adding a configuration returns the operator to step 1 for the
                    next room, and the way out cannot be a button that only exists on step 10. It is
                    the SAME cart the header counts — one door, shown in two places. */}
                {typeof onCheckout === 'function' && (
                    <button onClick={onCheckout} disabled={!cartCount}
                        title={cartCount ? 'Fees, add-ons and the quote documents' : 'Add a configuration first — the cart is empty'}
                        style={{ ...mono, padding: '7px 12px', cursor: cartCount ? 'pointer' : 'not-allowed', border: `1px solid ${cartCount ? 'var(--brass)' : 'var(--line)'}`, background: cartCount ? 'var(--brass)' : '#fff', color: cartCount ? '#fff' : 'var(--ink-soft)', opacity: cartCount ? 1 : .5 }}>
                        Checkout ({cartCount})
                    </button>
                )}
            </div>

            {/* THE RAIL — the whole product at a glance, every answer visible. */}
            <div style={{ display: 'flex', border: '1px solid var(--line)', background: '#fff', overflowX: 'auto', maxWidth: '100%', minWidth: 0 }}>
                {steps.map(railCell)}
            </div>

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
                                    Not asked — {step.slot.suppressedReason} ({step.slot.suppressedBy})
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
                                const ends = isCentre ? bearingEnds(model.choices, Object.values(livePicks)) : 0;
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
                                <TraverseConfiguratorPanel rules={trvRules} drive={trvDrive} feet={trvFeet} trackCount={trvTracks}
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
                                        <input value={poleIn} onChange={e => setPoleIn(e.target.value)} placeholder="96" inputMode="decimal"
                                            style={{ padding: '8px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '14px', width: '100%', background: '#fff', color: 'var(--ink)' }} />
                                    </label>
                                    <label style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                        <span style={{ ...mono, fontSize: '8px' }}>Fraction</span>
                                        <input value={poleFrac} onChange={e => setPoleFrac(e.target.value)} placeholder="1/2"
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
                        {step?.kind === 'LENGTH' && !!extraItems.length && (
                            <div>
                                {/* THE SPLICE QUESTION, ASKED WHERE THE LENGTH IS (Stuart 2026-08-24) — over the
                                    one-piece limit the splice adds itself at the default, and the note is only
                                    for a location that differs. Vision draws the splice where the note says. */}
                                {spliceNeeded && (
                                    <div style={{ border: `1px solid ${spliceSatisfied ? 'var(--line)' : 'var(--brass)'}`, background: spliceSatisfied ? 'var(--paper)' : '#faf6ee', padding: '9px 11px', marginBottom: '8px', fontSize: '11.5px', color: 'var(--ink)', lineHeight: 1.45 }}>
                                        <b>{spliceSatisfied ? 'Splice included' : '⚠ Splice required'}</b> — {lengthInches}&Prime; exceeds the {spliceOverIn}&Prime; one-piece limit.
                                        {!spliceSatisfied && spliceCodes.length > 1 && <> Add the splice/joiner for this rod size below.</>}{' '}
                                        Default location is the <b>CENTER of the run</b>; note the exact location below only if
                                        different. Vision draws the splice where the note says.
                                    </div>
                                )}
                                <div style={{ ...mono, color: 'var(--ink-soft)', marginBottom: '7px' }}>Add an item</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                                    {extraItems.map(it => {
                                        const row = extras.find(x => x.code === it.code);
                                        const qty = row?.qty ?? '';
                                        const set = (patch) => setExtras(a => {
                                            const i = a.findIndex(x => x.code === it.code);
                                            if (i < 0) return [...a, { code: it.code, qty: '1', note: '', ...patch }];
                                            const next = [...a]; next[i] = { ...next[i], ...patch };
                                            return next[i].qty === '' || Number(next[i].qty) <= 0 ? next.filter((_, j) => j !== i) : next;
                                        });
                                        const part = findPart(it.code);
                                        const line = row ? extraLines.find(l => l.partId === it.code) : null;
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', paddingTop: '3px' }}>
                            <button onClick={() => setStepIx(Math.max(0, ix - 1))} disabled={ix === 0}
                                style={{ ...chip(false), opacity: ix === 0 ? .35 : 1, cursor: ix === 0 ? 'not-allowed' : 'pointer' }}>Back</button>
                            {ix >= steps.length - 1 ? (
                                <button onClick={addConfiguration} disabled={!priced.lines.length}
                                    title={priced.lines.length ? 'Adds this configuration to the quote and starts the next one' : 'Nothing priced yet — this configuration has no lines'}
                                    style={{ ...chip(true), background: 'var(--brass)', border: '1px solid var(--brass)', color: '#fff', opacity: priced.lines.length ? 1 : .35, cursor: priced.lines.length ? 'pointer' : 'not-allowed' }}>
                                    Add to quote · ${grandTotal.toFixed(2)}
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
                            {chosen.length > 0 && Object.keys(visibleOverrides).length === 0 && (
                                <span style={{ color: '#b00020' }}> · nothing tagged to draw — the chosen parts own no geometry</span>
                            )}
                        </div>
                        {cadUrl ? (
                            <Canvas camera={{ position: [5, 5, 5], fov: 50 }} dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} style={{ width: '100%', height: '100%' }}>
                                <StudioRig />
                                <OrbitControls makeDefault />
                                <Bounds fit clip margin={1.2}>
                                    {/* ⚠ ONE GEOMETRY, SCALED. A combined flow's .glb is the master
                                        diameter's — H2's is the 1-3/8" — so a 3/4" order renders it
                                        at the ratio between the two rather than needing four models.
                                        renderScaleOf is 1 on any flow without a size matrix. */}
                                    <group scale={renderScaleOf(flow, sizePick, assembly)}>
                                        <DynamicModel url={cadUrl} textureOverrides={textureOverrides} visibilityOverrides={visibleOverrides}
                                            cloneSpecs={[]} highlightOverrides={[]} defaultHidden clearNodes={clearList} />
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
                                                            ? <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-faint)' }}>{`one pole · ${l.cutLength ? `${l.cutLength}"` : ''} ${l.feet} ft × $${l.unit.toFixed(2)}`}</span>
                                                            : (l.qty > 1 && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-faint)' }}>×{l.qty}</span>)}
                                                        {l.extra && <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--ink-faint)' }}>added</span>}
                                                    </span>
                                                    <span style={{ display: 'block', fontSize: '11px', color: 'var(--ink-soft)', lineHeight: 1.25 }}>
                                                        {findPart(l.partId)?.itemName || l.name}
                                                    </span>
                                                    {/* ⚠ THE FINISH, ON EVERY LINE (Stuart 2026-08-21: "ideally under each item id and
                                                        description list the finish, this way we are covered in case people do choose
                                                        different finishes for different parts"). Naming it once at the top of the quote
                                                        is only honest while there are no exceptions — and the whole point of the finish
                                                        rail is that there can be. A part that wears nothing says so rather than going
                                                        quiet, because a blank line and an unfinished part look identical otherwise. */}
                                                    {(() => {
                                                        const f = l.finishCode ? finishByCode.get(String(l.finishCode).toUpperCase()) : null;
                                                        if (f) return (
                                                            <span style={{ ...mono, fontSize: '8.5px', textTransform: 'none', letterSpacing: 0, color: 'var(--brass)' }}>
                                                                {`${f.name || f.code}`}<span style={{ color: 'var(--ink-faint)' }}>{` · ${f.code}`}</span>
                                                            </span>
                                                        );
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
                                                return <div key={k}><b style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>{st?.label || k}:</b> {v}</div>;
                                            })}
                                        </div>
                                    )}
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
