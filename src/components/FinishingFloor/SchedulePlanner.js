import React, { useMemo } from 'react';
import { buildFinishingPlan } from '../Shared/finishingTime';

// SCHEDULE PLANNER — the "what runs next" analysis below the Setup Queue.
// Custom (sales orders: a mix of sizes in one finish) are sequenced by due date; stock (bulk qty of
// one item in one finish) is pooled per recipe as filler. Time is priced from the Production Times
// timers × each recipe's steps; the oven is the shared resource. Read-only for now.
const fmtH = (mins) => `${(mins / 60).toFixed(1)} h`;

const SchedulePlanner = ({ workOrders = [], recipes = {}, capacityMatrix = {}, sysConfig = {} }) => {
    const plan = useMemo(
        () => buildFinishingPlan(workOrders, recipes, capacityMatrix, sysConfig, {}),
        [workOrders, recipes, capacityMatrix, sysConfig]
    );

    const { batches, customBatches, stockBatches, totalSleds, totalParts, totalMachineMins, totalOvenMins, dailyMins, days } = plan;
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

    // A custom batch is one order; show its customer + WO. A stock batch is a recipe pool.
    const titleOf = (b) => {
        if (b.kind === 'custom') {
            const wo = b.wos[0] || {};
            return wo.customerName || wo.customer || wo.clientName || wo.displayId || wo.id || b.recipe;
        }
        return b.recipe;
    };

    const batchRow = (b, idx) => (
        <div key={b.kind + b.recipe + idx} style={{ display: 'grid', gridTemplateColumns: '34px 1.5fr 1.2fr 1.1fr 1.1fr', gap: '16px', alignItems: 'center', padding: '14px 18px', background: b.resolved ? 'var(--paper)' : '#fdf2f2', border: '1px solid var(--line)', borderLeft: `3px solid ${b.kind === 'custom' ? 'var(--brass)' : 'var(--ink-soft)'}`, borderRadius: '2px' }}>
            <div style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', color: 'var(--ink-soft)' }}>{idx + 1}</div>
            <div>
                <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '1rem' }}>{titleOf(b)}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '4px' }}>
                    {b.recipe}{b.reqDate ? ` · due ${b.reqDate}` : ''}{b.kind === 'stock' && b.woCount > 1 ? ` · ${b.woCount} WOs pooled` : ''}
                </div>
            </div>
            <div>
                <div style={{ fontSize: '0.9rem', color: 'var(--ink)' }}>{b.parts} parts · {b.sleds} sled{b.sleds === 1 ? '' : 's'}</div>
                <div style={{ marginTop: '6px' }}>
                    {sizeChips(b.sizeMix)}
                    {b.kind === 'custom' && b.distinctSizes > 1 && <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--brass)', textTransform: 'uppercase', letterSpacing: '.05em' }}>mixed</span>}
                </div>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {b.sprayedSteps} spray step{b.sprayedSteps === 1 ? '' : 's'}{b.hasHand ? ' + hand' : ''}
            </div>
            <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.95rem', color: 'var(--ink)' }}>{Math.round(b.machineMins)} min</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>oven {Math.round(b.ovenMins)} · hand {Math.round(b.handMins)}</div>
            </div>
        </div>
    );

    const sectionLabel = (text) => (
        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.12em', color: 'var(--ink-soft)', margin: '4px 0 10px' }}>{text}</div>
    );

    return (
        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', marginTop: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', borderRadius: '2px', fontFamily: 'var(--sans)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '24px' }}>
                <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Analyzed from the queue above — by recipe, due date & resources</span>
                    <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Finishing Schedule</h3>
                </div>
                {unpriced > 0 && (
                    <span title="These jobs need a paint size + product type (capacity) and a matching recipe with steps — set on the Production Times tab / the item." style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', border: '1px solid #d9534f', padding: '6px 10px', borderRadius: '2px' }}>
                        {unpriced} unpriced — need size + recipe
                    </span>
                )}
            </div>

            {/* totals */}
            <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap', marginBottom: '24px' }}>
                {stat('Custom Orders', customBatches.length)}
                {stat('Stock Batches', stockBatches.length)}
                {stat('Sleds', totalSleds)}
                {stat('Parts', totalParts)}
                {stat('Machine Time', fmtH(totalMachineMins), `${Math.round(totalMachineMins)} min, 2 sleds`)}
                {stat('Oven Load', fmtH(totalOvenMins), 'shared bottleneck')}
                {stat('Est. Days', days.toFixed(1), `vs ${Math.round(dailyMins)} min/shift`)}
            </div>

            {/* oven-vs-capacity meter */}
            <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '6px' }}>
                    <span>Oven load vs one shift</span>
                    <span style={{ color: overCapacity ? '#d9534f' : 'var(--ink-soft)' }}>{Math.round(totalOvenMins)} / {Math.round(dailyMins)} min{overCapacity ? ' • over one shift' : ''}</span>
                </div>
                <div style={{ height: '8px', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, (totalOvenMins / dailyMins) * 100)}%`, height: '100%', background: overCapacity ? '#d9534f' : 'var(--brass)' }} />
                </div>
            </div>

            {batches.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', border: '1px dashed var(--line)', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>Nothing queued to schedule.</div>
            ) : (
                <>
                    {customBatches.length > 0 && (
                        <div style={{ marginBottom: '24px' }}>
                            {sectionLabel(`◆ Custom orders — by due date (${customBatches.length})`)}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {customBatches.map((b, i) => batchRow(b, i))}
                            </div>
                        </div>
                    )}
                    {stockBatches.length > 0 && (
                        <div>
                            {sectionLabel(`▢ Stock fill — pooled per recipe (${stockBatches.length})`)}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {stockBatches.map((b, i) => batchRow(b, customBatches.length + i))}
                            </div>
                        </div>
                    )}
                </>
            )}

            <div style={{ marginTop: '20px', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', lineHeight: 1.6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Custom (gold) = a mix of sizes in one finish, run by due date · stock (grey) = bulk of one item, pooled per recipe to
                fill sleds. Oven is the shared bottleneck. Next: pole-oven contention + hand-finish scheduled into that window, and a RED/BLUE sled timeline.
            </div>
        </div>
    );
};

export default SchedulePlanner;
