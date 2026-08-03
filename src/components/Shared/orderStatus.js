// WHERE IS IT? — the one answer, derived (Stuart 2026-08-03: "of utmost importance is the clarity
// on the status of an item, my team is confused and i want them to see clearly each stage exactly
// where something is at… from the time an order hits the custom or finishing floor till the time
// it is packed and shipped or packed and put on the shelf").
//
// WHY DERIVED RATHER THAN A STORED FIELD: there is no migration, it works on every order already in
// flight, and it cannot drift — a stored status is only as good as the last hand-off that
// remembered to write it, and this floor has five such fields already. What the screens were
// missing was never the data; it was one place that reads it the same way twice.
//
// THE FIVE FIELDS IT REPLACES AS A CONCEPT (all still written exactly as they are today):
//   currentPhase      Setup · Painting · Complete · Closed
//   pickStatus        Pending · Picked_Awaiting_Staging · Staged_Ready_For_Finishing
//   packStatus        Packed  (+ packMode PUTAWAY, putawayBin, packedAt/By)
//   customFabStatus   Pending · Complete   (only when hasCustomSibling)
//   sentToPickPack    boolean
// plus tasks{} for who is doing what right now, and currentStepIndex / poleStepIndex for the coat.
//
// SPLIT ORDERS ARE NEVER COLLAPSED (his call): an order whose poles are done while its small parts
// are on coat 1 reports BOTH, side by side, always. A single headline would have to lie about one
// of them. `slowest` exists only for sorting and colour, never as the thing to display alone.

export const STAGES = {
    RELEASED: { rank: 10, label: 'Released', hint: 'Dispatched — not started' },
    SHOP: { rank: 20, label: 'Shop', hint: 'Custom fabrication in progress' },
    SETUP: { rank: 30, label: 'Setup queue', hint: 'On the floor, not started' },
    PAINTING: { rank: 40, label: 'Painting', hint: 'Being sprayed or hand finished' },
    OVEN: { rank: 45, label: 'In oven', hint: 'Baking' },
    FINISHED: { rank: 50, label: 'Finished', hint: 'Off the floor — ready to pick' },
    PICKING: { rank: 60, label: 'Picking', hint: 'In the pick queue' },
    PICKED: { rank: 70, label: 'Picked', hint: 'Picked — awaiting staging' },
    STAGED: { rank: 80, label: 'Staged', hint: 'Matched and staged' },
    PACKED: { rank: 95, label: 'Packed', hint: 'Packed — awaiting shipment' },
    SHELVED: { rank: 100, label: 'Put away', hint: 'On the shelf' },
    SHIPPED: { rank: 100, label: 'Shipped', hint: 'Fulfilled in NetSuite' },
    CLOSED: { rank: 110, label: 'Closed', hint: 'Out of production' },
};
export const stageLabel = (code) => (STAGES[code] || {}).label || code || '—';
export const stageRank = (code) => (STAGES[code] || { rank: 0 }).rank;

// Colour by where it is, not by how it feels: nothing started = grey, in progress = brass,
// off the floor = blue, finished with = green, closed = faint.
export const stageTone = (code) => {
    if (code === 'CLOSED') return '#9b968c';
    if (code === 'SHELVED' || code === 'SHIPPED' || code === 'PACKED') return '#3a7d44';
    if (code === 'FINISHED' || code === 'PICKED' || code === 'STAGED') return '#3f7fc4';
    if (code === 'PAINTING' || code === 'OVEN' || code === 'SHOP') return '#b08d57';
    return '#524e46';
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const hasPoles = (wo) => num(wo?.totalPoles) > 0 || num(wo?.poles?.qty) > 0 || wo?.type === 'Poles';
const TASK_LABEL = { spinSetup: 'sled setup', spinSpray: 'spray', spinBake: 'bake', poleSpray: 'pole spray', poleBake: 'pole bake', hand: 'hand finish' };

// The running task in a set, if any — that is what "right now" means on a floor.
const runningOf = (tasks, keys) => {
    for (const k of keys) {
        const t = (tasks || {})[k];
        if (t && t.status === 'Running') return { key: k, task: t };
    }
    return null;
};

// One finishing stream (small parts, or poles). `len` = the recipe's coat count.
function finishingStream(wo, { key, label, idxField, taskKeys, ovenKey, len }) {
    const tasks = wo.tasks || {};
    const idx = num(idxField === 'poleStepIndex'
        ? (wo.poleStepIndex !== undefined && wo.poleStepIndex !== null ? wo.poleStepIndex : wo.currentStepIndex)
        : wo.currentStepIndex);
    const coat = `coat ${Math.min(idx + 1, len || 1)} of ${len || '?'}`;

    if (len && idx >= len) return { key, label, stage: 'FINISHED', detail: `done (${len}/${len})` };

    const oven = ovenKey && tasks[ovenKey] && tasks[ovenKey].status === 'Running' ? { key: ovenKey, task: tasks[ovenKey] } : null;
    if (oven) return { key, label, stage: 'OVEN', detail: `${coat} · baking`, since: oven.task.startTime || null, by: oven.task.assignedTo || '' };

    const run = runningOf(tasks, taskKeys);
    if (run) return { key, label, stage: 'PAINTING', detail: `${coat} · ${TASK_LABEL[run.key] || run.key}`, since: run.task.startTime || null, by: run.task.assignedTo || '' };

    // Nothing running. Staged to the floor = waiting mid-coat; otherwise still queued.
    const started = wo.currentPhase === 'Painting' || idx > 0 || taskKeys.concat(ovenKey || []).some(k => (tasks[k] || {}).status === 'Complete');
    return started
        ? { key, label, stage: 'PAINTING', detail: `${coat} · waiting`, since: wo.lastCoatTime || null }
        : { key, label, stage: 'SETUP', detail: 'not started' };
}

// Fulfilment is order-level and runs AFTER finishing: pick → stage → pack → shelf/ship.
// Returns null while the order has not reached the warehouse at all.
function fulfilmentOf(wo) {
    if (wo.packStatus === 'Packed') {
        const putAway = wo.packMode === 'PUTAWAY' || wo.orderType === 'stock';
        if (putAway) return { key: 'FULFIL', label: 'Warehouse', stage: 'SHELVED', detail: wo.putawayBin ? `bin ${wo.putawayBin}` : 'put away', since: wo.packedAt || null, by: wo.packedBy || '' };
        if (wo.nsIfTran) return { key: 'FULFIL', label: 'Warehouse', stage: 'SHIPPED', detail: `fulfilment ${wo.nsIfTran}`, since: wo.packedAt || null, by: wo.packedBy || '' };
        return { key: 'FULFIL', label: 'Warehouse', stage: 'PACKED', detail: wo.nsFulfillQueued ? 'fulfilment queued' : 'awaiting shipment', since: wo.packedAt || null, by: wo.packedBy || '' };
    }
    if (wo.pickStatus === 'Staged_Ready_For_Finishing') return { key: 'FULFIL', label: 'Warehouse', stage: 'STAGED', detail: 'matched & staged', since: wo.stagedAt || null };
    if (wo.pickStatus === 'Picked_Awaiting_Staging') return { key: 'FULFIL', label: 'Warehouse', stage: 'PICKED', detail: 'awaiting staging', since: wo.pickedAt || null };
    if (wo.sentToPickPack) return { key: 'FULFIL', label: 'Warehouse', stage: 'PICKING', detail: 'in the pick queue' };
    return null;
}

// THE ONE CALL. `recipeLen` is the coat count for this order's recipe — the caller resolves it
// (the recipes live in different places on different screens) and passes it in.
export function orderStatusOf(wo, { recipeLen = 0 } = {}) {
    if (!wo) return { streams: [], fulfilment: null, isSplit: false, slowest: null, done: false };

    if (wo.currentPhase === 'Closed') {
        const s = [{ key: 'ORDER', label: 'Order', stage: 'CLOSED', detail: 'closed', since: wo.closedAt || null, by: wo.closedBy || '' }];
        return { streams: s, fulfilment: null, isSplit: false, slowest: 'CLOSED', done: true };
    }

    const streams = [];
    // CUSTOM SHOP runs alongside finishing on orders that have a shop sibling — the half that most
    // often holds an order up while the small parts look finished.
    if (wo.hasCustomSibling) {
        streams.push(wo.customFabStatus === 'Complete'
            ? { key: 'CUSTOM', label: 'Custom shop', stage: 'FINISHED', detail: 'fabrication done' }
            : { key: 'CUSTOM', label: 'Custom shop', stage: 'SHOP', detail: 'fabricating' });
    }

    const finished = wo.currentPhase === 'Complete';
    if (finished) {
        streams.push({ key: 'PARTS', label: 'Finishing', stage: 'FINISHED', detail: 'off the floor', since: wo.completedAt || null });
    } else {
        streams.push(finishingStream(wo, { key: 'PARTS', label: hasPoles(wo) ? 'Small parts' : 'Finishing', idxField: 'currentStepIndex', taskKeys: ['spinSetup', 'spinSpray', 'hand'], ovenKey: 'spinBake', len: recipeLen }));
        if (hasPoles(wo)) streams.push(finishingStream(wo, { key: 'POLES', label: 'Poles', idxField: 'poleStepIndex', taskKeys: ['poleSpray'], ovenKey: 'poleBake', len: recipeLen }));
    }

    const fulfilment = fulfilmentOf(wo);
    const all = fulfilment ? [...streams, fulfilment] : streams;
    const slowest = all.reduce((lo, s) => (lo === null || stageRank(s.stage) < stageRank(lo) ? s.stage : lo), null);
    const distinct = new Set(streams.map(s => s.stage));
    return {
        streams, fulfilment,
        isSplit: distinct.size > 1,
        slowest,
        done: !!fulfilment && ['SHELVED', 'SHIPPED'].includes(fulfilment.stage),
    };
}

// One-line form for a dense list ("Small parts: painting coat 2 of 3 · Poles: done").
export const statusLine = (st) =>
    [...(st.streams || []), ...(st.fulfilment ? [st.fulfilment] : [])]
        .map(s => `${s.label}: ${stageLabel(s.stage).toLowerCase()}${s.detail ? ` (${s.detail})` : ''}`)
        .join(' · ');
