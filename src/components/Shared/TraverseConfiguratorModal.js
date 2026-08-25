// TRAVERSE COMPONENTS CONFIGURATOR — the popup (Stuart 2026-08-12: "a simple clean graphical
// checkbox style configurator to pick and choose these options after the main config line is
// completed"; 2026-08-13: "required at checkout for both the quickship method and the cpq
// method"). ONE component, mounted behind a guard by each surface — the logic lives in
// Shared/traverseConfigurator (pure, node-tested); this renders it and nothing else.
import React, { useMemo, useState } from 'react';
import { configuratorOffer, configuratorLines, configuratorTotal, defaultPicks} from './traverseConfigurator';
import { DRAWS, MOTOR_SIDES } from './traverseDraw';

// ── THE QUESTIONS THEMSELVES, WITHOUT THE POPUP AROUND THEM ──────────────────────────────────
// Stuart 2026-08-21: "integrate that simple configurator at the last step of any traverse rod".
// The new engine asks it as a STEP rather than interposing a modal on Add to Cart, so the body
// splits from its chrome and becomes a controlled panel: the caller owns `sel`, because in a step
// the answers have to survive walking back to step 3 and forward again — a modal could keep them
// in its own head only because it lived and died in one breath.
//
// ONE IMPLEMENTATION, TWO SURFACES. Quick Ship and the old CPQ path still mount the modal below;
// it now owns the state and renders this. Neither surface re-derives what is offered or what it
// bills — that has always been Shared/traverseConfigurator, and still is.
export function TraverseConfiguratorPanel({ rules, drive, feet, trackCount = 1, itemInfo, priceOf, sel, onSel }) {
    const setSel = (fn) => onSel(typeof fn === 'function' ? fn(sel) : fn);
    const offer = useMemo(() => configuratorOffer({ rules, drive, feet }), [rules, drive, feet]);
    const info = (id) => (typeof itemInfo === 'function' && itemInfo(id)) || { name: id, sku: '' };
    const mono = { fontFamily: 'var(--mono)', fontSize: '11px' };
    const lbl = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' };
    const qtyBox = { width: '64px', padding: '7px', border: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--sans)' };
    const row = (checked) => ({ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', border: `1px solid ${checked ? 'var(--brass)' : 'var(--line)'}`, background: checked ? 'var(--paper-2)' : '#fff', cursor: 'pointer' });
    const selStyle = offer.carrierStyles.find(s => s.itemId === sel.carrierStyle);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {/* ── HOW IT OPENS, BEFORE WHAT IT OPENS ON (Stuart 2026-08-22) ──────────────
                        The draw is drawn as an arrow on every window of a take-off, and it decides
                        how the carriers are assembled and which side the master goes on — so it is
                        asked with the carriers, immediately before them, rather than buried in a
                        note. There is no default: a track built to the wrong draw opens away from
                        the room, and guessing CENTER because it is commonest is how that happens. */}
                    <div>
                        <div style={{ ...lbl, marginBottom: '8px' }}>Draw direction — how the curtain opens</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '10px' }}>
                            {DRAWS.map(d => {
                                const on = String(sel.draw || '') === d.value;
                                return (
                                    <label key={d.value} style={row(on)}>
                                        <input type="radio" name="trv-draw" checked={on} onChange={() => setSel(p => ({ ...p, draw: d.value }))} style={{ cursor: 'pointer' }} />
                                        <span style={{ flex: 1 }}>
                                            <span style={{ display: 'block', fontSize: '0.9rem', color: 'var(--ink)' }}>{d.label}</span>
                                            <span style={{ ...mono, color: 'var(--ink-soft)' }}>{d.hint}</span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                        {!sel.draw && (
                            <div style={{ ...mono, fontSize: '10px', color: 'var(--brass)', marginTop: '8px' }}>
                                Required — it is the arrow on the take-off, and the track is assembled to it.
                            </div>
                        )}
                    </div>

                    {/* Only a motorised track has a side to put the motor on. */}
                    {String(drive || '').toUpperCase() === 'MOTORIZED' && (
                        <div>
                            <div style={{ ...lbl, marginBottom: '8px' }}>Motor side</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '10px' }}>
                                {MOTOR_SIDES.map(mset => {
                                    const on = String(sel.motorSide || '') === mset.value;
                                    return (
                                        <label key={mset.value} style={row(on)}>
                                            <input type="radio" name="trv-motor-side" checked={on} onChange={() => setSel(p => ({ ...p, motorSide: mset.value }))} style={{ cursor: 'pointer' }} />
                                            <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--ink)' }}>{mset.label}</span>
                                        </label>
                                    );
                                })}
                            </div>
                            {!sel.motorSide && (
                                <div style={{ ...mono, fontSize: '10px', color: 'var(--brass)', marginTop: '8px' }}>
                                    Required on a motorised track — the head end is built to it.
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <div style={{ ...lbl, marginBottom: '8px' }}>Carrier style — pick one; {feet}ft includes the chart count</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '10px' }}>
                            {offer.carrierStyles.map(s => {
                                const on = sel.carrierStyle === s.itemId;
                                return (
                                    <label key={s.itemId} style={row(on)}>
                                        <input type="radio" name="trv-carrier" checked={on} onChange={() => setSel(p => ({ ...p, carrierStyle: s.itemId, carrierQty: '' }))} style={{ cursor: 'pointer' }} />
                                        <span style={{ flex: 1 }}>
                                            <span style={{ display: 'block', fontSize: '0.9rem', color: 'var(--ink)' }}>{s.label}</span>
                                            <span style={{ ...mono, color: 'var(--ink-soft)' }}>{s.itemId}{s.fabSku ? ` · ${s.fabSku}` : ''} — {s.includedQty} included</span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                        {selStyle && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
                                <span style={lbl}>Quantity (blank = chart {selStyle.includedQty})</span>
                                <input type="number" min="0" value={sel.carrierQty} placeholder={String(selStyle.includedQty)}
                                    onChange={e => setSel(p => ({ ...p, carrierQty: e.target.value }))} style={qtyBox} />
                                {(parseInt(sel.carrierQty) || selStyle.includedQty) > selStyle.includedQty && (
                                    <span style={{ ...mono, color: 'var(--brass)' }}>+{(parseInt(sel.carrierQty) || 0) - selStyle.includedQty} over chart × ${(parseFloat(priceOf(selStyle.itemId)) || 0).toFixed(2)}</span>
                                )}
                            </div>
                        )}
                    </div>
                    <div>
                        <div style={{ ...lbl, marginBottom: '8px' }}>Components — end stops default 2 per track; chart items say when they are included vs charged</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
                            {offer.picks.map(pk => {
                                const q = sel.picks[pk.itemId] || 0; const on = q > 0; const inf = info(pk.itemId);
                                // chart-governed pick (the splice): included where the chart says so at this
                                // length, CHARGED where it does not — say which, in place.
                                const chart = pk.includedQty;
                                const each = parseFloat(priceOf(pk.itemId)) || 0;
                                const note = chart === null ? ''
                                    : chart > 0 ? `included at ${feet}ft (chart ${chart}${q > chart ? `; +${q - chart} × $${each.toFixed(2)}` : ''})`
                                    : `not included at ${feet}ft — $${each.toFixed(2)} each`;
                                const seed = chart !== null && chart > 0 ? chart : 1;
                                return (
                                    <label key={pk.itemId} style={row(on)}>
                                        <input type="checkbox" checked={on} onChange={e => setSel(p => ({ ...p, picks: { ...p.picks, [pk.itemId]: e.target.checked ? (/ENDSTOP/i.test(pk.itemId) ? 2 * Math.max(1, trackCount) : seed) : 0 } }))} style={{ cursor: 'pointer' }} />
                                        <span style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{ display: 'block', fontSize: '0.88rem', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inf.name}</span>
                                            <span style={{ ...mono, color: 'var(--ink-soft)' }}>{pk.itemId}{inf.sku ? ` · ${inf.sku}` : ''}</span>
                                            {note && <span style={{ ...mono, display: 'block', color: chart > 0 ? 'var(--ink-soft)' : 'var(--brass)' }}>{note}</span>}
                                        </span>
                                        {on && <input type="number" min="1" value={q} onClick={e => e.preventDefault()} onChange={e => setSel(p => ({ ...p, picks: { ...p.picks, [pk.itemId]: Math.max(1, parseInt(e.target.value) || 1) } }))} style={qtyBox} />}
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                    <div>
                        <div style={{ ...lbl, marginBottom: '8px' }}>Accessories — billed at the customer's price</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
                            {offer.accessories.map(ac => {
                                const q = sel.accessories[ac.itemId] || 0; const on = q > 0; const inf = info(ac.itemId);
                                const each = parseFloat(priceOf(ac.itemId)) || 0;
                                return (
                                    <label key={ac.itemId} style={row(on)}>
                                        <input type="checkbox" checked={on} onChange={e => setSel(p => ({ ...p, accessories: { ...p.accessories, [ac.itemId]: e.target.checked ? 1 : 0 } }))} style={{ cursor: 'pointer' }} />
                                        <span style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{ display: 'block', fontSize: '0.88rem', color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inf.name}</span>
                                            <span style={{ ...mono, color: 'var(--ink-soft)' }}>{ac.itemId}{inf.sku ? ` · ${inf.sku}` : ''} — ${each.toFixed(2)}</span>
                                        </span>
                                        {on && <input type="number" min="1" value={q} onClick={e => e.preventDefault()} onChange={e => setSel(p => ({ ...p, accessories: { ...p.accessories, [ac.itemId]: Math.max(1, parseInt(e.target.value) || 1) } }))} style={qtyBox} />}
                                    </label>
                                );
                            })}
                        </div>
                    </div>
        </div>
    );
}

// ── THE POPUP, WHICH IS NOW THE PANEL PLUS ITS CHROME ────────────────────────────────────────
// Unchanged from the outside: same props, same defaults, same Skip / Add components. Quick Ship
// and the old CPQ path mount this exactly as they did — the split is invisible to them.
export default function TraverseConfiguratorModal({ rules, drive, feet, trackCount = 1, kitLabel, itemInfo, priceOf, onCancel, onApply }) {
    // Opens with his defaults, not an empty form: end stops 2 per track, chart-included splice.
    const [sel, setSel] = useState(() => ({ carrierStyle: '', carrierQty: '', picks: defaultPicks({ rules, drive, feet, trackCount }), accessories: {} }));
    const lines = useMemo(() => configuratorLines({ rules, drive, feet, sel, priceOf }), [rules, drive, feet, sel, priceOf]);
    const addTotal = configuratorTotal(lines);
    const lbl = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' };

    return (
        <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,.72)', zIndex: 12000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '860px', maxWidth: '96vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--line)' }}>
                <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.35rem', color: 'var(--ink)' }}>Traverse components — {kitLabel}</div>
                    <div style={{ ...lbl, marginTop: '4px' }}>{drive} · {feet}ft · chart quantities included in the per-foot price — raising a count bills the difference</div>
                </div>
                <div style={{ padding: '18px 24px', overflowY: 'auto' }}>
                    <TraverseConfiguratorPanel rules={rules} drive={drive} feet={feet} trackCount={trackCount}
                        itemInfo={itemInfo} priceOf={priceOf} sel={sel} onSel={setSel} />
                </div>
                <div style={{ padding: '14px 24px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: '14px', background: 'var(--paper)' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.1rem', color: 'var(--ink)', flex: 1 }}>Adds ${addTotal.toFixed(2)}{sel.carrierStyle ? '' : ' — pick a carrier style'}</span>
                    <button onClick={onCancel} style={{ padding: '12px 20px', background: 'transparent', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Skip</button>
                    <button onClick={() => onApply(lines, sel)} disabled={!sel.carrierStyle}
                        style={{ padding: '12px 24px', background: sel.carrierStyle ? 'var(--ink)' : 'var(--paper-2)', color: sel.carrierStyle ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: sel.carrierStyle ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Add components →</button>
                </div>
            </div>
        </div>
    );
}
