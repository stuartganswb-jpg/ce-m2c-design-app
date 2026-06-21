import React, { useMemo } from 'react';
import { db } from '../../firebase';
import { doc, writeBatch } from 'firebase/firestore';
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

    const { batches, customBatches, stockBatches, poleBatches, totalSleds, totalParts, setupCount,
        sledOvenMins, poleOvenMins, ovenTotalMins, poleCount, poleRacks, handOverlapMins, dailyMins, days } = plan;
    const overCapacity = ovenTotalMins > dailyMins;
    const unpriced = batches.filter(b => !b.resolved).length + poleBatches.filter(b => !b.resolved).length;

    // Commit the run order onto each ready WO (scheduleSeq), so the Setup Queue and Active Floor run
    // batches in the planned sequence. Idempotent — safe to re-run; it just refreshes the order.
    const readyBatches = [...customBatches.filter(b => b.ready), ...stockBatches, ...poleBatches];
    const commitWoCount = readyBatches.reduce((n, b) => n + (b.wos ? b.wos.length : 0), 0);
    const commitSchedule = async () => {
        if (commitWoCount === 0) return alert('Nothing ready to commit — custom orders must be scan-matched in Pick/Pack first.');
        if (!window.confirm(`Commit this run order?\n\n${readyBatches.length} batches · ${commitWoCount} work orders.\nThe Setup Queue and Active Floor will follow this sequence.`)) return;
        try {
            const wb = writeBatch(db);
            readyBatches.forEach(b => (b.wos || []).forEach(wo => {
                wb.update(doc(db, 'fin_workorders', wo.id), {
                    scheduleSeq: b.seq, scheduleBatch: b.recipe, scheduleKind: b.kind, scheduledAt: Date.now(),
                });
            }));
            await wb.commit();
            alert(`Committed ${commitWoCount} work order${commitWoCount === 1 ? '' : 's'} in planned order.`);
        } catch (e) {
            console.error('commitSchedule failed', e);
            alert('Commit failed — check permissions / console.');
        }
    };

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
        <div key={b.kind + b.recipe + idx} style={{ display: 'grid', gridTemplateColumns: '46px 1.5fr 1.2fr 1.1fr 1.1fr', gap: '16px', alignItems: 'center', padding: '14px 18px', background: !b.ready ? '#fbfaf7' : (b.resolved ? 'var(--paper)' : '#fdf2f2'), border: '1px solid var(--line)', borderLeft: `3px solid ${!b.ready ? 'var(--line)' : (b.kind === 'custom' ? 'var(--brass)' : 'var(--ink-soft)')}`, borderRadius: '2px', opacity: b.ready ? 1 : 0.72 }}>
            <div style={{ textAlign: 'center' }}>
                {b.ready
                    ? <span style={{ fontFamily: 'var(--serif)', fontSize: '1.3rem', color: 'var(--ink-soft)' }}>{b.seq}</span>
                    : <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', border: '1px solid var(--line)', borderRadius: '2px', padding: '3px 5px' }}>set up</span>}
            </div>
            <div>
                <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '1rem' }}>{titleOf(b)}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '4px' }}>
                    {b.recipe}{b.reqDate ? ` · due ${b.reqDate}` : ''}{b.kind === 'stock' && b.woCount > 1 ? ` · ${b.woCount} WOs pooled` : ''}{!b.ready ? ' · awaiting fab & scan-match' : ''}
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

    // Pole batches have a different shape (poles/racks, no sleds/size mix), so they render their own row.
    const poleRow = (b, idx) => (
        <div key={'pole' + b.recipe + idx} style={{ display: 'grid', gridTemplateColumns: '46px 1.5fr 1.2fr 1.1fr 1.1fr', gap: '16px', alignItems: 'center', padding: '14px 18px', background: b.resolved ? 'var(--paper)' : '#fdf2f2', border: '1px solid var(--line)', borderLeft: '3px solid #6b7a8f', borderRadius: '2px' }}>
            <div style={{ textAlign: 'center', fontFamily: 'var(--serif)', fontSize: '1.3rem', color: 'var(--ink-soft)' }}>{b.seq}</div>
            <div>
                <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '1rem' }}>{b.recipe}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '4px' }}>
                    STOCK POLES{b.woCount > 1 ? ` · ${b.woCount} WOs pooled` : ''}
                </div>
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--ink)' }}>{b.poles} poles · {b.racks} rack{b.racks === 1 ? '' : 's'}<div style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--ink-soft)', textTransform: 'uppercase', marginTop: '4px' }}>8 / rack</div></div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                {b.sprayedSteps} spray step{b.sprayedSteps === 1 ? '' : 's'}{b.hasHand ? ' + hand' : ''}
            </div>
            <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.95rem', color: 'var(--ink)' }}>{Math.round(b.sprayMins + b.ovenMins + b.handMins)} min</div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {unpriced > 0 && (
                        <span title="These jobs need a paint size + product type (capacity) and a matching recipe with steps — set on the Production Times tab / the item." style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', border: '1px solid #d9534f', padding: '6px 10px', borderRadius: '2px' }}>
                            {unpriced} unpriced — need size + recipe
                        </span>
                    )}
                    <button onClick={commitSchedule} disabled={commitWoCount === 0} title="Write this run order onto the work orders so the Setup Queue and Active Floor follow the sequence." style={{ padding: '10px 18px', background: commitWoCount === 0 ? 'var(--paper-2)' : 'var(--ink)', color: commitWoCount === 0 ? 'var(--ink-soft)' : '#fff', border: commitWoCount === 0 ? '1px solid var(--line)' : 'none', cursor: commitWoCount === 0 ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', borderRadius: '2px' }}>
                        Commit Schedule
                    </button>
                </div>
            </div>

            {/* totals */}
            <div style={{ display: 'flex', gap: '36px', flexWrap: 'wrap', marginBottom: '24px' }}>
                {stat('Custom Orders', customBatches.length, setupCount > 0 ? `${setupCount} in set up` : 'all scheduled')}
                {stat('Stock Batches', stockBatches.length)}
                {stat('Sleds', totalSleds, `${totalParts} small parts`)}
                {stat('Poles', poleCount, poleCount > 0 ? `${poleRacks} rack${poleRacks === 1 ? '' : 's'} · share oven` : 'none queued')}
                {stat('Oven Load', fmtH(ovenTotalMins), `sled ${Math.round(sledOvenMins)} + pole ${Math.round(poleOvenMins)} min`)}
                {stat('Hand Overlap', fmtH(handOverlapMins), 'hidden in pole bakes')}
                {stat('Est. Days', days.toFixed(1), `vs ${Math.round(dailyMins)} min/shift`)}
            </div>

            {/* oven-vs-capacity meter (sled bakes + pole bakes share the one oven) */}
            <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '6px' }}>
                    <span>Oven load vs one shift (sled + pole bakes)</span>
                    <span style={{ color: overCapacity ? '#d9534f' : 'var(--ink-soft)' }}>{Math.round(ovenTotalMins)} / {Math.round(dailyMins)} min{overCapacity ? ' • over one shift' : ''}</span>
                </div>
                <div style={{ display: 'flex', height: '8px', background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div title="sled bakes" style={{ width: `${Math.min(100, (sledOvenMins / dailyMins) * 100)}%`, height: '100%', background: overCapacity ? '#d9534f' : 'var(--brass)' }} />
                    <div title="pole bakes" style={{ width: `${Math.min(100 - Math.min(100, (sledOvenMins / dailyMins) * 100), (poleOvenMins / dailyMins) * 100)}%`, height: '100%', background: 'var(--ink-soft)' }} />
                </div>
            </div>

            {(batches.length === 0 && poleBatches.length === 0) ? (
                <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', border: '1px dashed var(--line)', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>Nothing queued to schedule.</div>
            ) : (
                <>
                    {customBatches.length > 0 && (
                        <div style={{ marginBottom: '24px' }}>
                            {sectionLabel(`◆ Custom orders — small parts, by due date (${customBatches.length})`)}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {customBatches.map((b, i) => batchRow(b, i))}
                            </div>
                        </div>
                    )}
                    {stockBatches.length > 0 && (
                        <div style={{ marginBottom: '24px' }}>
                            {sectionLabel(`▢ Stock fill — small parts, pooled per recipe (${stockBatches.length})`)}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {stockBatches.map((b, i) => batchRow(b, customBatches.length + i))}
                            </div>
                        </div>
                    )}
                    {poleBatches.length > 0 && (
                        <div>
                            {sectionLabel(`▮ Stock poles — racked 8 at a time (${poleBatches.length})`)}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {poleBatches.map((b, i) => poleRow(b, customBatches.length + stockBatches.length + i))}
                            </div>
                        </div>
                    )}
                </>
            )}

            <div style={{ marginTop: '20px', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', lineHeight: 1.6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Custom (gold) = a mix of sizes in one finish, run by due date · stock (grey) = bulk of one item, pooled per recipe to
                fill sleds. The one oven is shared by sled + pole bakes (the bottleneck); small-part hand-finishing is overlapped into the
                pole-oven window, so only hand beyond it adds to the estimate. Poles are read from each WO's pole qty.
            </div>
        </div>
    );
};

export default SchedulePlanner;
