import React, { useMemo, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds } from '@react-three/drei';
import { DynamicModel } from '../HQ/CPQTab';
import { StudioRig } from './studioScene';
import { resolve as resolveHardware, diagnose as diagnoseHardware, finishesFor } from './hardwareModel';
import { choicesFromAssembly, modelNodesOf } from './hardwareAdapter';
import { priceConfiguration, pricingWarnings } from './hardwarePricing';

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
    outsourceCodes = [], finishMode = 'GLOBAL',
}) {
    const [answers, setAnswers] = useState({});
    const [picks, setPicks] = useState({});     // slot key -> choice id
    const [showDiag, setShowDiag] = useState(false);
    const [whySlot, setWhySlot] = useState(null);   // slot key whose exclusions are being read
    const [globalFinish, setGlobalFinish] = useState('');
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
    const priced = useMemo(() => priceConfiguration(resolved, {
        customerId, customer, priceLevel, outsourceCodes,
        finishCode: globalFinish, findPart, findByCode: findPart,
    }), [resolved, customerId, customer, priceLevel, outsourceCodes, globalFinish, findPart]);
    const priceWarnings = useMemo(() => pricingWarnings(priced), [priced]);

    const chosen = useMemo(() => {
        const ids = new Set(Object.values(livePicks));
        return [...model.choices.filter(c => ids.has(c.id)), ...model.riders];
    }, [model, livePicks]);

    const setAnswer = useCallback((k, v) => setAnswers(a => ({ ...a, [k]: a[k] === v ? undefined : v })), []);
    const setPick = useCallback((k, v) => setPicks(p => ({ ...p, [k]: p[k] === v ? undefined : v })), []);

    const diagnosis = useMemo(() => diagnoseHardware(model), [model]);
    const cadUrl = assembly?.manufacturingSpecs?.cadUrl;

    const chip = (active, disabled) => ({
        ...mono, padding: '8px 12px', cursor: disabled ? 'not-allowed' : 'pointer',
        background: active ? 'var(--ink)' : '#fff', color: active ? '#fff' : (disabled ? 'var(--ink-soft)' : 'var(--ink)'),
        border: `1px solid ${active ? 'var(--ink)' : 'var(--line)'}`, opacity: disabled ? 0.4 : 1, textAlign: 'left',
    });

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 360px) 1fr', gap: '16px', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ ...mono, color: 'var(--brass)', borderBottom: '1px solid var(--line)', paddingBottom: '6px' }}>
                    {pins?.length
                        ? `Tag-driven · ${model.choices.length} choices · nothing pre-answered`
                        : 'Loading this assembly\u2019s pins\u2026'}
                </div>

                {/* THE QUESTIONS THE ASSEMBLY ACTUALLY ASKS — discovered, never enumerated. An axis
                    with one possible value is not a question; it constrains silently. */}
                {model.axes.filter(a => !a.implied && a.values.length > 1).map(axis => (
                    <div key={axis.key}>
                        <div style={{ ...mono, color: 'var(--ink-soft)', marginBottom: '6px' }}>{AXIS_LABEL[axis.key] || axis.key}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {axis.values.map(v => (
                                <button key={String(v)} onClick={() => setAnswer(axis.key, v)} style={chip(answers[axis.key] === v)}>
                                    {valueLabel(axis.key, v)}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}

                {/* FINISH — one for the whole configuration, or a default that each part may
                    override. The FLOW decides which in tab 11; this obeys it. */}
                {!!finishes.length && (
                    <div>
                        <div style={{ ...mono, color: 'var(--ink-soft)', marginBottom: '6px' }}>
                            Finish <span style={{ opacity: 0.6 }}>· {perPart ? 'per part' : 'whole configuration'}</span>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {/* Only finishes SOMETHING here can wear. A collection with no wood
                                parts never shows a stain, and it needs no rule to know that. */}
                            {finishes.filter(f => !chosenList.length || chosenList.some(c => finishesFor(c, [f]).length)).map(f => {
                                const code = String(f.code || f.name || '').toUpperCase();
                                const on = String(globalFinish).toUpperCase() === code;
                                const url = f.textureUrl || f.finalImageUrl;
                                return (
                                    <button key={code} onClick={() => setGlobalFinish(on ? '' : code)} title={f.name || code}
                                        style={{ width: '28px', height: '28px', padding: 0, cursor: 'pointer', border: `2px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: url ? `url(${url}) center/cover` : '#ddd' }} />
                                );
                            })}
                        </div>
                        {perPart && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '4px' }}>Sets every part; override individually below.</div>}
                    </div>
                )}

                {/* ONE DECISION PER PLACE. A slot with no options in this configuration is simply
                    not shown — on a solid rod there is no fascia question, and that is not an error
                    to report, it is a product that does not have one. */}
                {model.slots.filter(s => s.options.length || s.suppressedBy).map(s => (
                    <div key={s.key}>
                        <div style={{ ...mono, color: 'var(--ink-soft)', marginBottom: '6px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                            <span>{slotLabel(s)} <span style={{ opacity: 0.6 }}>({s.options.length})</span></span>
                            {/* ALL FIXES ON THE ITEMS, NOT ON THE FLOW (Stuart 2026-08-17: "if a
                                backplate misbehaves we know exactly what to fix — its tag"). Every
                                exclusion already carries the rule that made it and the part it was
                                made about; this simply shows them, so the answer to "why is that
                                one missing" is one click rather than a hunt. */}
                            {!!s.rejected.length && (
                                <span onClick={() => setWhySlot(whySlot === s.key ? null : s.key)}
                                    style={{ cursor: 'pointer', color: 'var(--brass)', fontSize: '9px', textTransform: 'none', letterSpacing: 0 }}>
                                    {whySlot === s.key ? 'hide' : `why not the other ${s.rejected.length}?`}
                                </span>
                            )}
                        </div>
                        {s.suppressedBy && (
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#8a6508', padding: '2px 0 6px' }}>
                                not asked — {s.suppressedReason} ({s.suppressedBy})
                            </div>
                        )}
                        {whySlot === s.key && (
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', lineHeight: 1.6, marginBottom: '6px', paddingLeft: '6px', borderLeft: '2px solid var(--line)' }}>
                                {s.rejected.map((r, i) => (
                                    <div key={i} style={{ color: 'var(--ink-soft)', padding: '1px 0' }}>
                                        <span style={{ color: 'var(--ink)' }}>{r.choice.name}</span>
                                        {r.choice.partId ? ` · ${r.choice.partId}` : ''} — <span style={{ color: '#8a6508' }}>{r.rule}</span>: {r.detail}
                                    </div>
                                ))}
                                <div style={{ color: 'var(--ink-soft)', paddingTop: '3px' }}>Every one of these is a tag on the ITEM, in 1.6.</div>
                            </div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {s.options.map(o => (
                                <React.Fragment key={o.id}>
                                    <button onClick={() => setPick(s.key, o.id)} style={{ ...chip(livePicks[s.key] === o.id), fontSize: '9px', textTransform: 'none', letterSpacing: 0 }}>
                                        {o.name}{o.partId ? ` · ${o.partId}` : ''}{o.noFinish ? ' · clear' : ''}
                                    </button>
                                    {/* PER-PART FINISH — only where the flow asks for it, only on the
                                        chosen part, and never on one that takes no finish. */}
                                    {perPart && livePicks[s.key] === o.id && !o.noFinish && !!finishes.length && (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', padding: '2px 0 4px 8px' }}>
                                            {finishesFor(o, finishes).map(f => {
                                                const code = String(f.code || f.name || '').toUpperCase();
                                                const on = String(partFinish[o.id] || globalFinish).toUpperCase() === code;
                                                const url = f.textureUrl || f.finalImageUrl;
                                                return (
                                                    <button key={code} title={f.name || code}
                                                        onClick={() => setPartFinish(pf => ({ ...pf, [o.id]: on ? '' : code }))}
                                                        style={{ width: '18px', height: '18px', padding: 0, cursor: 'pointer', border: `2px solid ${on ? 'var(--ink)' : 'var(--line)'}`, background: url ? `url(${url}) center/cover` : '#ddd' }} />
                                                );
                                            })}
                                        </div>
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                ))}

                {isSuperAdmin && (
                    <div style={{ borderTop: '1px solid var(--line)', paddingTop: '8px' }}>
                        <button onClick={() => setShowDiag(v => !v)} style={{ ...mono, background: 'transparent', border: '1px solid var(--line)', padding: '6px 10px', cursor: 'pointer', color: diagnosis.some(d => d.sev === 'red') ? '#b00020' : 'var(--ink-soft)' }}>
                            {diagnosis.length ? `${diagnosis.length} tag note(s)` : 'Tags clean'}
                        </button>
                        {showDiag && (
                            <div style={{ marginTop: '6px', fontFamily: 'var(--mono)', fontSize: '9px', lineHeight: 1.6 }}>
                                {!diagnosis.length && <div style={{ color: '#2a7' }}>Every slot has options, the chosen parts agree, and every tagged node exists.</div>}
                                {diagnosis.map((d, i) => (
                                    <div key={i} style={{ color: d.sev === 'red' ? '#b00020' : '#8a6508', padding: '2px 0' }}>
                                        {d.sev === 'red' ? '●' : '○'} {d.kind} — {d.msg}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div>
                <div style={{ height: '440px', background: 'var(--paper-2)', position: 'relative' }}>
                    {cadUrl ? (
                        <Canvas camera={{ position: [5, 5, 5], fov: 50 }} dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} style={{ width: '100%', height: '100%' }}>
                            <StudioRig />
                            <OrbitControls makeDefault />
                            <Bounds fit clip margin={1.2}>
                                {/* defaultHidden — the model opens empty and every mesh you see is
                                    one you chose. */}
                                <DynamicModel
                                    url={cadUrl}
                                    visibilityOverrides={visibleOverrides}
                                    cloneSpecs={[]}
                                    highlightOverrides={[]}
                                    textureOverrides={textureOverrides}
                                    defaultHidden
                                    clearNodes={clearList}
                                />
                            </Bounds>
                        </Canvas>
                    ) : (
                        <div style={{ ...mono, color: 'var(--ink-soft)', display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>No .glb on this assembly</div>
                    )}
                    {!Object.keys(visibleOverrides).length && cadUrl && (
                        <div style={{ position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)', ...mono, color: 'var(--ink-soft)' }}>
                            Empty by design — choose a rod to begin
                        </div>
                    )}
                </div>
                <div style={{ marginTop: '10px', fontFamily: 'var(--mono)', fontSize: '10px', lineHeight: 1.7 }}>
                    <div style={{ ...mono, color: 'var(--ink-soft)', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{chosen.length} part(s) · {Object.keys(visibleOverrides).length} node(s) rendering</span>
                        <span style={{ color: 'var(--ink)' }}>${priced.total.toFixed(2)}</span>
                    </div>
                    {priced.lines.map((l, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', color: 'var(--ink)' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {l.name}{l.partId ? ` · ${l.partId}` : ''}
                                {/* THEIR part number, from the same 4.6 box as their price. */}
                                {l.sku ? <span style={{ color: 'var(--brass)' }}> · {l.sku}</span> : null}
                                {l.qty > 1 ? ` ×${l.qty}` : ''}
                            </span>
                            <span title={`${l.source}${l.detail ? ` — ${l.detail}` : ''}`} style={{ flexShrink: 0, color: l.unit ? 'var(--ink)' : 'var(--ink-soft)' }}>
                                ${l.total.toFixed(2)}
                            </span>
                        </div>
                    ))}
                    {!priced.lines.length && <div style={{ color: 'var(--ink-soft)' }}>Nothing chosen yet.</div>}
                    {priceWarnings.map((w, i) => (
                        <div key={i} style={{ color: '#b00020', fontSize: '9px', paddingTop: '3px' }}>● {w.msg}</div>
                    ))}
                    {!!priced.lines.length && (
                        <div style={{ color: 'var(--ink-soft)', fontSize: '9px', paddingTop: '4px' }}>
                            Hover a price for the rule that set it{priceLevel !== 'STANDARD' ? ` · ${priceLevel}` : ''}{customerId ? '' : ' · no customer selected, so no client pricing'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
