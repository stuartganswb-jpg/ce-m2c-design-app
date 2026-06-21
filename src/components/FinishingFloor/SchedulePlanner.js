import React, { useMemo } from 'react';
import { buildFinishingPlan } from '../Shared/finishingTime';

// SCHEDULE PLANNER — the "what runs next" view at the top of the Setup Queue.
// Groups queued + on-floor work by recipe (sleds never mix recipes), packs each recipe's parts into
// sleds by capacity, prices the batch from the timers, and sequences custom (date-driven) ahead of
// stock filler. Read-only for now; committing a sequence to the floor is the next step.
const fmtH = (mins) => `${(mins / 60).toFixed(1)} h`;

const SchedulePlanner = ({ workOrders = [], recipes = {}, capacityMatrix = {}, sysConfig = {} }) => {
    const plan = useMemo(
        () => buildFinishingPlan(workOrders, recipes, capacityMatrix, sysConfig, {}),
        [workOrders, recipes, capacityMatrix, sysConfig]
    );

    const { batches, totalSleds, totalParts, totalMachineMins, totalOvenMins, dailyMins, days } = plan;
    const overCapacity = totalOvenMins > dailyMins;
    const unpriced = batches.filter(b => !b.resolved).length;

    const stat = (label, value, sub) => (
        <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>{label}</div>
            <div style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem', color: 'var(--ink)', lineHeight: 1.2 }}>{value}</div>
            {sub && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>{sub}</div>}
        </div>
    );

    const sizeChips = (mix) => ['S', 'M', 'L'].filter(s => mix[s] > 0).map(s => (
        <span key={s} style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', border: '1px solid var(--line)', padding: '2px 6px', borderRadius: '2px', marginRight: '6px' }}>{s} {mix[s]}</span>
    ));

    return (
        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', marginBottom: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', borderRadius: '2px', fontFamily: 'var(--sans)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '24px' }}>
                <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>What runs next — both streams, packed by recipe</span>
                    <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Finishing Schedule</h3>
                </div>
                {unpriced > 0 && (
                    <span title="Set a paint size + product type capacity, and a recipe, for these jobs (Production Times tab)." style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', border: '1px solid #d9534f', padding: '6px 10px', borderRadius: '2px' }}>
                        {unpriced} batch{unpriced === 1 ? '' : 'es'} unpriced
                    </span>
                )}
            </div>

            {/* totals */}
            <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap', marginBottom: '24px' }}>
                {stat('Batches', batches.length)}
                {stat('Sleds', totalSleds)}
                {stat('Parts', totalParts)}
                {stat('Machine Time', fmtH(totalMachineMins), `${Math.round(totalMachineMins)} min across 2 sleds`)}
                {stat('Oven Load', fmtH(totalOvenMins), 'shared bottleneck')}
                {stat('Est. Days', days.toFixed(1), `vs ${Math.round(dailyMins)} min/shift`)}
            </div>

            {/* oven-vs-capacity meter (oven is the binding constraint) */}
            <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '6px' }}>
                    <span>Oven load vs one shift</span>
                    <span style={{ color: overCapacity ? '#d9534f' : 'var(--ink-soft)' }}>{Math.round(totalOvenMins)} / {Math.round(dailyMins)} min{overCapacity ? ' • over one shift' : ''}</span>
                </div>
                <div style={{ height: '8px', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, (totalOvenMins / dailyMins) * 100)}%`, height: '100%', background: overCapacity ? '#d9534f' : 'var(--brass)' }} />
                </div>
            </div>

            {/* sequenced batches */}
            {batches.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', border: '1px dashed var(--line)', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>Nothing queued to schedule.</div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {batches.map((b, i) => (
                        <div key={b.recipe + i} style={{ display: 'grid', gridTemplateColumns: '40px 1.4fr 1.2fr 1fr 1.2fr', gap: '16px', alignItems: 'center', padding: '16px 20px', background: b.resolved ? 'var(--paper)' : '#fdf2f2', border: '1px solid var(--line)', borderLeft: `3px solid ${b.hasCustom ? 'var(--brass)' : 'var(--ink-soft)'}`, borderRadius: '2px' }}>
                            <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink-soft)' }}>{i + 1}</div>
                            <div>
                                <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '1.05rem' }}>{b.recipe}</div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '4px' }}>
                                    {b.hasCustom ? 'CUSTOM' : ''}{b.hasCustom && b.hasStock ? ' + ' : ''}{b.hasStock ? 'STOCK' : ''} · {b.woCount} WO{b.woCount === 1 ? '' : 's'}{b.reqDate ? ` · due ${b.reqDate}` : ''}
                                </div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.9rem', color: 'var(--ink)' }}>{b.parts} parts · {b.sleds} sled{b.sleds === 1 ? '' : 's'}</div>
                                <div style={{ marginTop: '6px' }}>{sizeChips(b.sizeMix)}</div>
                            </div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                {b.sprayedSteps} spray step{b.sprayedSteps === 1 ? '' : 's'}{b.hasHand ? ' + hand' : ''}
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '0.95rem', color: 'var(--ink)' }}>{Math.round(b.machineMins)} min</div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>oven {Math.round(b.ovenMins)} · hand {Math.round(b.handMins)}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ marginTop: '20px', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', lineHeight: 1.6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Custom (gold) sequenced by due date · stock (grey) fills the gaps. Time priced from the Production Times timers ×
                each recipe's steps. Oven is the shared bottleneck — pole bakes (added next) will block sled bakes, and hand-finish
                is scheduled into that window.
            </div>
        </div>
    );
};

export default SchedulePlanner;
