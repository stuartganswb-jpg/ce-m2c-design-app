import React, { useMemo, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds } from '@react-three/drei';
import { DynamicModel } from '../HQ/CPQTab';
import { StudioRig } from './studioScene';
import { resolve as resolveHardware, diagnose as diagnoseHardware } from './hardwareModel';
import { choicesFromAssembly, modelNodesOf } from './hardwareAdapter';

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
// WHAT IS DELIBERATELY NOT HERE YET: finishes/textures and pricing. This proves the two things that
// have been wrong for a week — which parts are offered, and which geometry renders. Saying it is
// finished when it is not is how the last version got trusted too early.

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

export default function HardwareConfigurator({ assembly, pins, isSuperAdmin = false }) {
    const [answers, setAnswers] = useState({});
    const [picks, setPicks] = useState({});     // slot key -> choice id
    const [showDiag, setShowDiag] = useState(false);

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

    const visibleOverrides = useMemo(() => {
        const m = resolveHardware({ choices, answers, selectedIds: Object.values(livePicks), modelNodes });
        const o = {};
        m.visible.forEach(n => { o[String(n).toLowerCase()] = true; });
        return o;
    }, [choices, answers, livePicks, modelNodes]);

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

                {/* ONE DECISION PER PLACE. A slot with no options in this configuration is simply
                    not shown — on a solid rod there is no fascia question, and that is not an error
                    to report, it is a product that does not have one. */}
                {model.slots.filter(s => s.options.length).map(s => (
                    <div key={s.key}>
                        <div style={{ ...mono, color: 'var(--ink-soft)', marginBottom: '6px' }}>
                            {slotLabel(s)} <span style={{ opacity: 0.6 }}>({s.options.length})</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {s.options.map(o => (
                                <button key={o.id} onClick={() => setPick(s.key, o.id)} style={{ ...chip(livePicks[s.key] === o.id), fontSize: '9px', textTransform: 'none', letterSpacing: 0 }}>
                                    {o.name}{o.partId ? ` · ${o.partId}` : ''}
                                </button>
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
                                    textureOverrides={{}}
                                    visibilityOverrides={visibleOverrides}
                                    cloneSpecs={[]}
                                    highlightOverrides={[]}
                                    defaultHidden
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
                    <div style={{ ...mono, color: 'var(--ink-soft)', marginBottom: '4px' }}>Selected · {chosen.length} part(s) · {Object.keys(visibleOverrides).length} node(s) rendering</div>
                    {chosen.map(c => (
                        <div key={c.id} style={{ color: 'var(--ink)' }}>
                            {c.name}{c.partId ? ` · ${c.partId}` : ''}{c.always ? ' · (rides along)' : ''}
                        </div>
                    ))}
                    {!chosen.length && <div style={{ color: 'var(--ink-soft)' }}>Nothing chosen yet.</div>}
                </div>
            </div>
        </div>
    );
}
