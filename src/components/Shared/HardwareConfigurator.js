import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds } from '@react-three/drei';
import { DynamicModel } from '../HQ/CPQTab';
import { StudioRig } from './studioScene';
import { resolve as resolveHardware, diagnose as diagnoseHardware, finishesFor } from './hardwareModel';
import { choicesFromAssembly, modelNodesOf } from './hardwareAdapter';
import { priceConfiguration, priceChoice, pricingWarnings } from './hardwarePricing';
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
    return s.position ? `${s.position.charAt(0)}${s.position.slice(1).toLowerCase()} ${kind}` : kind;
};

export default function HardwareConfigurator({
    assembly, pins, isSuperAdmin = false,
    finishes = [], parts = [], customer = null, customerId = '', priceLevel = 'STANDARD',
    outsourceCodes = [], finishMode = 'GLOBAL', spanMap = {}, spanCaps = {}, extraItems = [], flowFinishes = [],
}) {
    const [answers, setAnswers] = useState({});
    const [picks, setPicks] = useState({});     // slot key -> choice id
    const [showDiag, setShowDiag] = useState(false);
    const [whySlot, setWhySlot] = useState(null);   // slot key whose exclusions are being read
    const [globalFinish, setGlobalFinish] = useState('');
    const [poleIn, setPoleIn] = useState('');            // finished length, whole inches
    const [poleFrac, setPoleFrac] = useState('');        // …and the fraction
    const [fabricId, setFabricId] = useState('PRINT');   // drives the span, so it is asked here
    const [thumbs, setThumbs] = useState({});            // choice id → data URL
    const [partFinish, setPartFinish] = useState({});   // choice id -> finish code (per-part mode)
    const perPart = finishMode === 'PER_PART';

    const choices = useMemo(() => choicesFromAssembly(assembly, pins), [assembly, pins]);
    const modelNodes = useMemo(() => modelNodesOf(assembly), [assembly]);

    const model = useMemo(
        () => resolveHardware({ choices, answers, selectedIds: Object.values(picks).filter(Boolean), modelNodes }),
        [choices, answers, picks, modelNodes]);

    // An answer higher up can invalidate a pick below it — choose the traverse rod and the standard
    // arm you had chosen is not offered any more. Rather than police that with a sweep (the thing
    // that deadlocked twice), the picks are simply FILTERED THROUGH the live options at render
    // time: a pick that is no longer offered is not shown as chosen and contributes no geometry.
    // Nothing to clear, nothing to re-seed, no order of operations to get wrong.
    const livePicks = useMemo(() => {
        const out = {};
        model.slots.forEach(s => {
            const want = picks[s.key];
            if (want && s.options.some(o => o.id === want)) out[s.key] = want;
        });
        return out;
    }, [model, picks]);

    const resolved = useMemo(
        () => resolveHardware({ choices, answers, selectedIds: Object.values(livePicks), modelNodes }),
        [choices, answers, livePicks, modelNodes]);
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
    const finishFor = useCallback((c) => (perPart ? (partFinish[c.id] || globalFinish) : globalFinish), [perPart, partFinish, globalFinish]);

    // NODE → TEXTURE. A no-finish part is skipped entirely, so the clear rule paints it instead —
    // the collar of a two-part finial takes the finish, the acrylic top never does.
    const textureOverrides = useMemo(() => {
        const out = {};
        chosenList.forEach(c => {
            if (c.noFinish) return;
            const f = finishByCode.get(String(finishFor(c)).toUpperCase());
            // The material gate, applied at the last moment: a global pick of a wood stain simply
            // does not land on the steel brackets, and nothing lands on the acrylic.
            if (!f || !finishesFor(c, [f]).length) return;
            const url = f.textureUrl || f.finalImageUrl;
            if (!url) return;
            c.nodes.forEach(n => { out[String(n).toLowerCase()] = url; });
        });
        return out;
    }, [chosenList, finishByCode, finishFor]);

    // ── PRICE ─────────────────────────────────────────────────────────────────────────────────
    const partIndex = useMemo(() => {
        const m = new Map();
        parts.forEach(pt => [pt.id, pt.itemId, pt.legacyErpId].forEach(k => {
            const kk = String(k || '').trim().toUpperCase();
            if (kk && kk !== 'PENDING' && !m.has(kk)) m.set(kk, pt);
        }));
        return m;
    }, [parts]);
    const findPart = useCallback((id) => partIndex.get(String(id || '').trim().toUpperCase()) || null, [partIndex]);
    const priceCtx = useMemo(() => ({
        customerId, customer, priceLevel, outsourceCodes,
        finishCode: globalFinish, findPart, findByCode: findPart,
    }), [customerId, customer, priceLevel, outsourceCodes, globalFinish, findPart]);
    const priced = useMemo(() => priceConfiguration(resolved, priceCtx), [resolved, priceCtx]);
    const priceWarnings = useMemo(() => pricingWarnings(priced), [priced]);
    // Added by hand — priced by the SAME chain as everything else (override → price level → client
    // row → base). A splice a customer negotiated is still that customer's price; nothing about it
    // being typed in rather than resolved changes what they pay for it.
    const extraLines = useMemo(() => extras.filter(x => x.code).map(x => {
        const part = findPart(x.code);
        const qty = Number(x.qty) > 0 ? Number(x.qty) : 1;
        const p = priceChoice({ partId: x.code }, part, priceCtx);
        return { partId: x.code, name: part?.itemName || x.code, qty, unit: p.price, total: p.price * qty,
                 sku: p.sku || p.aliasCode, source: p.source, detail: p.detail, note: x.note, extra: true };
    }), [extras, findPart, priceCtx]);
    const grandTotal = priced.total + extraLines.reduce((s2, l) => s2 + l.total, 0);

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

    // The bracket recommendation, from the engineering in 6.5 rather than a number in this file.
    const advice = useMemo(() => {
        const rod = chosenList.find(c => ['ROD', 'FASCIA', 'TRACK'].includes(c.role));
        if (!rod || !lengthInches) return null;
        return bracketAdviceFor({ itemCode: rod.partId, map: spanMap, caps: spanCaps, rodInches: lengthInches, fabricId, dropFt: DEFAULT_DROP_FT });
    }, [chosenList, lengthInches, spanMap, spanCaps, fabricId]);

    const chosen = useMemo(() => {
        const ids = new Set(Object.values(livePicks));
        return [...model.choices.filter(c => ids.has(c.id)), ...model.riders];
    }, [model, livePicks]);

    const setAnswer = useCallback((k, v) => setAnswers(a => ({ ...a, [k]: a[k] === v ? undefined : v })), []);
    const setPick = useCallback((k, v) => setPicks(p => ({ ...p, [k]: p[k] === v ? undefined : v })), []);

    const diagnosis = useMemo(() => diagnoseHardware(model), [model]);
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
        model.axes.filter(a => !a.implied && a.values.length > 1)
            .forEach(a => out.push({ kind: 'AXIS', key: `axis:${a.key}`, axis: a, label: AXIS_LABEL[a.key] || a.key }));
        const plates = model.slots.filter(s => s.kind === 'BACKPLATE');
        const nested = new Set();
        model.slots.filter(s => s.kind !== 'BACKPLATE').forEach(s => {
            if (!s.options.length && !s.suppressedBy) return;
            const sub = s.kind === 'BRACKET' ? plates.find(p => (p.position || '') === (s.position || '')) : null;
            if (sub) nested.add(sub.key);
            out.push({ kind: 'SLOT', key: s.key, slot: s, sub, label: slotLabel(s) });
        });
        plates.filter(p => !nested.has(p.key) && p.options.length)
            .forEach(p => out.push({ kind: 'SLOT', key: p.key, slot: p, label: slotLabel(p) }));
        out.push({ kind: 'LENGTH', key: 'length', label: 'Pole length' });
        return out;
    }, [model]);

    const [stepIx, setStepIx] = useState(0);
    const ix = Math.min(stepIx, Math.max(0, steps.length - 1));
    const step = steps[ix];

    // What the rail shows under each heading: the answer, once there is one.
    const answerOf = useCallback((st) => {
        if (st.kind === 'AXIS') { const v = answers[st.axis.key]; return v == null || v === '' ? '' : valueLabel(st.axis.key, v); }
        if (st.kind === 'LENGTH') return lengthFeet ? `${lengthFeet} ft` : '';
        if (st.slot.suppressedBy) return 'not asked';
        const pick = st.slot.options.find(o => o.id === livePicks[st.slot.key]);
        return pick ? (pick.partId || pick.name) : '';
    }, [answers, livePicks, lengthFeet]);

    // ── SEVERAL CONFIGURATIONS, ONE QUOTE ────────────────────────────────────────────────────
    // A room is a configuration; a job is several. Each is finished, memo'd and added, and the
    // strip is where you see what is already in and what it came to.
    const [configMemo, setConfigMemo] = useState('');
    // NOTES BELONG TO THE STEP THE OPERATOR IS ON (Stuart 2026-08-17). A note typed while deciding
    // the right bracket is about the right bracket; filing them all into one box loses which
    // decision they were about, which is the only thing that makes them useful downstream.
    const [stepNotes, setStepNotes] = useState({});   // step key → note
    // EXTRAS — basic items added by hand: a splice, an extra ring, whatever the flow does not model.
    const [extras, setExtras] = useState([]);         // [{ code, qty, note }]
    const [saved, setSaved] = useState([]);
    const addConfiguration = () => {
        if (!priced.lines.length) return;
        setSaved(s => [...s, { memo: configMemo || `Configuration ${s.length + 1}`, total: grandTotal, lines: priced.lines.length }]);
        setConfigMemo(''); setPicks({}); setAnswers({}); setPoleIn(''); setPoleFrac('');
        setStepNotes({}); setExtras([]); setStepIx(0);
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
                    <span style={{ ...mono, fontSize: '9.5px', textTransform: 'none', letterSpacing: '.02em', color: 'var(--ink)' }}>{o.partId}</span>
                    {line?.sku && <span style={{ ...mono, fontSize: '9px', textTransform: 'none', letterSpacing: '.02em', color: 'var(--brass)' }}>{line.sku}</span>}
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
        const hit = (f.clientMapping || []).find(m => keys.has(String(m.customerId || '').trim().toUpperCase()));
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
    const finishGroups = useMemo(() => {
        // WHAT THIS FLOW OFFERS comes first, set in tab 11. An empty list means the flow has never
        // been narrowed, so every finish stands — the behaviour every flow had before the control
        // existed. Then the parts have their say: a finish no chosen part can wear is not offered.
        const inFlow = flowFinishes.length
            ? finishes.filter(f => flowFinishes.includes(f.code || f.finishCode || f.name || f.id))
            : finishes;
        const usable = inFlow.filter(f => !chosenList.length || chosenList.some(c => finishesFor(c, [f]).length));
        const byMat = new Map();
        usable.forEach(f => {
            const m = String(f.material || f.type || 'METAL').toUpperCase();
            if (!byMat.has(m)) byMat.set(m, { inHouse: [], out: [] });
            (f.multiplier !== undefined || f.vendor ? byMat.get(m).out : byMat.get(m).inHouse).push(f);
        });
        return [...byMat.entries()];
    }, [finishes, flowFinishes, chosenList]);

    const finishPanel = (
        <div style={{ ...boxStyle, minHeight: '0', position: 'sticky', top: '12px' }}>
            {boxHead('Finish', perPart ? 'Per part' : 'Whole configuration')}
            <div style={{ padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', maxHeight: 'calc(100vh - 160px)' }}>
                {!finishGroups.length && <span style={{ ...mono, fontSize: '9px', color: 'var(--ink-faint)' }}>Choose a part to see its finishes.</span>}
                {finishGroups.map(([mat, g]) => (
                    <div key={mat} style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                        <span style={{ ...mono, fontSize: '9px' }}>{mat} <span style={{ color: 'var(--ink-faint)' }}>· {g.inHouse.length + g.out.length}</span></span>
                        {!!g.inHouse.length && (<div style={{ paddingLeft: '7px', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ ...mono, fontSize: '8px', color: 'var(--ink-faint)' }}>In house · {g.inHouse.length}</span>
                            {swatchRow(g.inHouse, globalFinish, setGlobalFinish)}
                        </div>)}
                        {!!g.out.length && (<div style={{ paddingLeft: '7px', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <span style={{ ...mono, fontSize: '8px', color: 'var(--ink-faint)' }}>Outsourced · {g.out.length}</span>
                            {swatchRow(g.out, globalFinish, setGlobalFinish)}
                        </div>)}
                    </div>
                ))}
                {perPart && step?.kind === 'SLOT' && livePicks[step.slot?.key] && (() => {
                    const o = step.slot.options.find(x => x.id === livePicks[step.slot.key]);
                    if (!o || o.noFinish) return null;
                    return (
                        <div style={{ borderTop: '1px solid var(--line)', paddingTop: '9px' }}>
                            <span style={{ ...mono, fontSize: '8.5px', color: 'var(--brass)' }}>Just this part · {o.partId}</span>
                            {swatchRow(finishesFor(o, finishes), partFinish[o.id] || globalFinish, (c) => setPartFinish(pf => ({ ...pf, [o.id]: c })))}
                        </div>
                    );
                })()}
            </div>
        </div>
    );

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(230px, 300px) 1fr', gap: '14px', alignItems: 'start' }}>
          {finishPanel}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

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
                    {priceLevel && priceLevel !== 'STANDARD' && <b style={{ fontWeight: 400, color: 'var(--brass)', marginLeft: '6px' }}>{priceLevel}</b>}
                </span>
                <button onClick={addConfiguration} disabled={!priced.lines.length}
                    style={{ ...mono, marginLeft: 'auto', padding: '7px 12px', cursor: priced.lines.length ? 'pointer' : 'not-allowed', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', opacity: priced.lines.length ? 1 : .4 }}>
                    + Add configuration
                </button>
            </div>

            {/* THE RAIL — the whole product at a glance, every answer visible. */}
            <div style={{ display: 'flex', border: '1px solid var(--line)', background: '#fff', overflowX: 'auto' }}>
                {steps.map(railCell)}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px,390px) 1fr', gap: '14px', alignItems: 'start' }}>

                {/* ── THE STEP ────────────────────────────────────────────────────────────── */}
                <div style={{ background: '#fff', border: '1px solid var(--line)' }}>
                    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                        <div style={{ ...mono, fontSize: '8.5px', color: 'var(--brass)', marginBottom: '3px' }}>Step {ix + 1} of {steps.length}</div>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.12rem' }}>{step?.label}</div>
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

                        {step?.kind === 'SLOT' && (<>
                            {step.slot.suppressedBy && (
                                <div style={{ ...mono, fontSize: '9px', textTransform: 'none', letterSpacing: 0, color: '#8a6508', borderLeft: '2px solid #8a6508', paddingLeft: '9px' }}>
                                    Not asked — {step.slot.suppressedReason} ({step.slot.suppressedBy})
                                </div>
                            )}
                            {!!step.slot.options.length && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: '7px' }}>
                                    {step.slot.options.map(o => optionCard(o, livePicks[step.slot.key] === o.id, () => setPick(step.slot.key, o.id)))}
                                </div>
                            )}
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
                        {step?.kind === 'LENGTH' && (
                            <div>
                                <div style={{ ...mono, color: 'var(--ink-soft)', marginBottom: '6px' }}>Add an item</div>
                                {!extraItems.length && <div style={{ ...mono, fontSize: '9px', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-faint)' }}>Nothing configured for this flow — add them in tab 11.</div>}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                                    {extras.map((x, i) => (
                                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 56px auto', gap: '5px', alignItems: 'start' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <select value={x.code} onChange={e => setExtras(a => a.map((y, j) => j === i ? { ...y, code: e.target.value } : y))}
                                                    style={{ padding: '6px', border: '1px solid var(--line)', fontSize: '12px', background: '#fff', color: 'var(--ink)' }}>
                                                    <option value="">— choose —</option>
                                                    {extraItems.map(it => <option key={it.code} value={it.code}>{it.label || it.code}</option>)}
                                                </select>
                                                <input value={x.note} onChange={e => setExtras(a => a.map((y, j) => j === i ? { ...y, note: e.target.value } : y))}
                                                    placeholder={(extraItems.find(it => it.code === x.code)?.notePlaceholder) || 'Default is centre — give the exact location if different'}
                                                    style={{ padding: '6px', border: '1px solid var(--line)', fontSize: '11.5px', background: '#fff', color: 'var(--ink)' }} />
                                            </div>
                                            <input value={x.qty} onChange={e => setExtras(a => a.map((y, j) => j === i ? { ...y, qty: e.target.value } : y))}
                                                inputMode="numeric" style={{ padding: '6px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '12px', textAlign: 'center', background: '#fff', color: 'var(--ink)' }} />
                                            <button onClick={() => setExtras(a => a.filter((_, j) => j !== i))} title="Remove"
                                                style={{ ...mono, padding: '6px 8px', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', color: 'var(--ink-soft)' }}>×</button>
                                        </div>
                                    ))}
                                    {!!extraItems.length && (
                                        <button onClick={() => setExtras(a => [...a, { code: '', qty: '1', note: '' }])}
                                            style={{ ...chip(false), fontSize: '9px' }}>+ Add item</button>
                                    )}
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', paddingTop: '3px' }}>
                            <button onClick={() => setStepIx(Math.max(0, ix - 1))} disabled={ix === 0}
                                style={{ ...chip(false), opacity: ix === 0 ? .35 : 1, cursor: ix === 0 ? 'not-allowed' : 'pointer' }}>Back</button>
                            <button onClick={() => setStepIx(Math.min(steps.length - 1, ix + 1))} disabled={ix >= steps.length - 1}
                                style={{ ...chip(true), opacity: ix >= steps.length - 1 ? .35 : 1, cursor: ix >= steps.length - 1 ? 'not-allowed' : 'pointer' }}>Next step</button>
                        </div>
                    </div>
                </div>

                {/* ── THE RENDER, THEN THREE BOXES OF EQUAL WEIGHT ─────────────────────────── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ height: '420px', background: 'var(--paper-2)', border: '1px solid var(--line)', position: 'relative' }}>
                        <div style={{ ...mono, position: 'absolute', left: '13px', top: '11px', zIndex: 2, color: 'var(--ink-soft)' }}>
                            Live 3D · additive · {chosen.length} part(s)
                        </div>
                        {cadUrl ? (
                            <Canvas camera={{ position: [5, 5, 5], fov: 50 }} dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} style={{ width: '100%', height: '100%' }}>
                                <StudioRig />
                                <OrbitControls makeDefault />
                                <Bounds fit clip margin={1.2}>
                                    <DynamicModel url={cadUrl} textureOverrides={textureOverrides} visibilityOverrides={visibleOverrides}
                                        cloneSpecs={[]} highlightOverrides={[]} defaultHidden clearNodes={clearList} />
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '14px' }}>

                        <div style={boxStyle}>
                            {boxHead('Pricing', priceLevel !== 'STANDARD' ? priceLevel.replace('FAB_', 'Fabricut ').toLowerCase() : '')}
                            <div style={{ padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, overflowY: 'auto', maxHeight: '300px' }}>
                                {!priced.lines.length && <span style={{ ...mono, fontSize: '9px', color: 'var(--ink-faint)' }}>Nothing chosen yet.</span>}
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
                                    <tbody>
                                        {[...priced.lines, ...extraLines].map((l, i) => (
                                            <tr key={i} title={`${l.source || 'added by hand'}${l.detail ? ` — ${l.detail}` : ''}`}>
                                                <td style={{ padding: '3px 0', color: 'var(--ink)' }}>
                                                    {/* Our id, their alias beside it, our description under. */}
                                                    <span style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
                                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px' }}>{l.partId}</span>
                                                        {l.sku && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)' }}>{l.sku}</span>}
                                                        {l.qty > 1 && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-faint)' }}>×{l.qty}</span>}
                                                        {l.extra && <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--ink-faint)' }}>added</span>}
                                                    </span>
                                                    <span style={{ display: 'block', fontSize: '11px', color: 'var(--ink-soft)', lineHeight: 1.25 }}>
                                                        {findPart(l.partId)?.itemName || l.name}
                                                    </span>
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
                                {priceWarnings.map((w, i) => <div key={i} style={{ color: '#b00020', fontSize: '9px' }}>● {w.msg}</div>)}
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
                                            style={{ ...mono, fontSize: '9px', background: 'transparent', border: '1px solid var(--line)', padding: '5px 9px', cursor: 'pointer', color: diagnosis.some(d => d.sev === 'red') ? '#b00020' : 'var(--ink-soft)' }}>
                                            {diagnosis.length ? `${diagnosis.length} tag note(s)` : 'Tags clean'}
                                        </button>
                                        {showDiag && (
                                            <div style={{ marginTop: '6px', fontFamily: 'var(--mono)', fontSize: '9px', lineHeight: 1.55 }}>
                                                {!diagnosis.length && <div style={{ color: '#2a7' }}>Every slot has options, the chosen parts agree, and every tagged node exists.</div>}
                                                {diagnosis.map((d, i) => <div key={i} style={{ color: d.sev === 'red' ? '#b00020' : '#8a6508' }}>{d.sev === 'red' ? '●' : '○'} {d.kind} — {d.msg}</div>)}
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
