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
    // 'Sent to Plating' (Brief B5, Stuart 2026-09-02): the custom half is OUT at the plater. It is
    // past the shop and nowhere near packable — the pack gate waits on it (customPartsReady).
    PLATING: { rank: 25, label: 'At the plater', hint: 'Custom parts out at the plater — not ready to pack' },
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
    if (code === 'PAINTING' || code === 'OVEN' || code === 'SHOP' || code === 'PLATING') return '#b08d57';
    return '#524e46';
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── THE CUSTOM HALF (customFabStatus) ────────────────────────────────────────────────────────
// Four states, set by the shop and the WMS, mirrored onto the fin doc by workOrderContract's
// mirrorCustomStatusToSibling (which also stamps customFabAt):
//   'Pending'          nothing started
//   'In Process'       the shop operator pressed START (this releases the small-parts pick)
//   'Sent to Plating'  shop complete, parts OUT at the plater (C stamps it at Complete & Label)
//   'Complete'         parts here and finished — the WMS receipt stamps it for plated orders
// The PACK GATE is the reason the third state exists: a plated custom order used to read
// 'Complete' the moment the shop finished, so the small parts could be packed while the poles
// were at the plater (audit P0 #3). Every reader of "may this be packed?" asks customPartsReady.
const shortDate = (ms) => {
    const t = typeof ms === 'object' && ms && ms.toMillis ? ms.toMillis() : Number(ms);
    return Number.isFinite(t) && t > 0 ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
};
export const customPartsReady = (wo) => !wo || !wo.hasCustomSibling || wo.customFabStatus === 'Complete';
// The words, once — the Setup Queue chip, the shop card and RTG all say the same thing.
export const customFabLabel = (wo) => {
    const cf = (wo && wo.customFabStatus) || 'Pending';
    if (cf !== 'Sent to Plating') return cf;
    const d = shortDate(wo.customFabAt);
    return d ? `At the plater since ${d}` : 'At the plater';
};
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

// PRODUCTION GATE (Stuart 2026-08-10: "gate the finishing floor — all steps work only in
// unison"). No finishing step may START while the order's parts pull is still open: released to
// the WMS pick queue but not yet picked, or carrying pick lines that were never released at all.
// Orders with nothing to pick (JFP paint-only runs, legacy docs with no partsList) pass — the
// gate blocks open pulls, not history. A pick deliberately cleared in WMS (Cleared_Overtaken)
// also passes: that button exists precisely to resolve the gate by hand, logged.
// spinSetup is the caller's exemption: Start Setup is the step that RELEASES the pick, so gating
// it would deadlock the flow.
export function pickGateOf(wo) {
    if (!wo) return { blocked: false };
    const ps = String(wo.pickStatus || '');
    if (['Picked_Awaiting_Staging', 'Staged_Ready_For_Finishing'].includes(ps) || ps.startsWith('Cleared')) return { blocked: false };
    if (wo.sentToPickPack && ps === 'Pending') {
        return { blocked: true, reason: 'the parts pick is still OPEN in the WMS pick queue — pick it there (or clear it) before this step starts' };
    }
    const pickable = Array.isArray(wo.partsList) && wo.partsList.some(l => l && !l.isFee && !l.lineIsFee && String(l.legacyErpId || l.partId || ''));
    if (pickable && !wo.sentToPickPack) {
        return { blocked: true, reason: 'the parts pull has not been released to the WMS pick queue yet — Start Setup releases it' };
    }
    return { blocked: false };
}

// THE ONE CALL. `recipeLen` is the coat count for this order's recipe — the caller resolves it
// (the recipes live in different places on different screens) and passes it in.
// `poleRecipeLen` — the pole stream's own coat count when the -P recipe variant differs
// (Grace's CP case); defaults to recipeLen so existing callers are untouched.
export function orderStatusOf(wo, { recipeLen = 0, poleRecipeLen } = {}) {
    if (!wo) return { streams: [], fulfilment: null, isSplit: false, slowest: null, done: false };

    if (wo.currentPhase === 'Closed') {
        const s = [{ key: 'ORDER', label: 'Order', stage: 'CLOSED', detail: 'closed', since: wo.closedAt || null, by: wo.closedBy || '' }];
        return { streams: s, fulfilment: null, isSplit: false, slowest: 'CLOSED', done: true };
    }

    const streams = [];
    // CUSTOM SHOP runs alongside finishing on orders that have a shop sibling — the half that most
    // often holds an order up while the small parts look finished.
    if (wo.hasCustomSibling) {
        const cf = wo.customFabStatus;
        streams.push(cf === 'Complete'
            ? { key: 'CUSTOM', label: 'Custom shop', stage: 'FINISHED', detail: 'fabrication done' }
            : cf === 'Sent to Plating'
            ? { key: 'CUSTOM', label: 'Custom shop', stage: 'PLATING', detail: shortDate(wo.customFabAt) ? `since ${shortDate(wo.customFabAt)}` : '', since: wo.customFabAt || null }
            : { key: 'CUSTOM', label: 'Custom shop', stage: 'SHOP', detail: 'fabricating' });
    }

    const finished = wo.currentPhase === 'Complete';
    if (finished) {
        streams.push({ key: 'PARTS', label: 'Finishing', stage: 'FINISHED', detail: 'off the floor', since: wo.completedAt || null });
    } else {
        streams.push(finishingStream(wo, { key: 'PARTS', label: hasPoles(wo) ? 'Small parts' : 'Finishing', idxField: 'currentStepIndex', taskKeys: ['spinSetup', 'spinSpray', 'hand'], ovenKey: 'spinBake', len: recipeLen }));
        if (hasPoles(wo)) streams.push(finishingStream(wo, { key: 'POLES', label: 'Poles', idxField: 'poleStepIndex', taskKeys: ['poleSpray'], ovenKey: 'poleBake', len: poleRecipeLen !== undefined ? poleRecipeLen : recipeLen }));
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

// ── THE GATES (Brief B2, Stuart 2026-09-02) ──────────────────────────────────────────────────
// What parks an hq_work_orders record in RTG, and the ONE list of it. Until this, the same six
// conditions were hand-written in three places (RTG's auto-release effect, pushToFinishing's auto
// branch and A's clearConvertGate) and worded a fourth way on the board — they agreed by luck. Now
// every reader — the two auto effects, the release's confirms, the board's gate lines and its
// AUTO-FLOW chip, Where-Is-It, and clearConvertGate — asks here, so a gate added to this table is
// seen and worded identically everywhere at once.
//
// Order = the order the flow opens them in: the sales order has to exist, then its NetSuite
// anchor, then the components have to be milled, phosphated and cut, then it goes ONCE.
// `kind: 'wait'` gates are things the order is waiting on; 'done' is the already-released stop.
// `label` is the fixed wording, `detail` the order's own note; `note` = label · detail.
// The gates are EVALUATED here and nowhere else — they are SET by the writers (A) and CLEARED by
// the WMS / the outbox writeBack / RTG's component effect (see SYSTEM_FLOW_AUDIT §5).
const itemOf = (wo) => String(wo.itemCode || wo.stockErpId || '').trim();
export const GATES = [
    { key: 'soAccept', kind: 'wait', icon: '⏳',
      open: (wo) => !!wo.awaitingSoAccept,
      label: 'awaiting SO accept', detail: (wo) => wo.soAppId || '',
      clearedBy: 'NetSuite accepting the sales order (outbox writeBack clears awaitingSoAccept)',
      help: (wo) => `${wo.id} belongs to sales order ${wo.soAppId || ''}, which NetSuite has not accepted yet.\n\nThe gate clears itself when the SO posts (watch the Transmit Log). If NetSuite REJECTED the order, fix and re-send it rather than releasing this work.` },
    { key: 'nsWo', kind: 'wait', icon: '⏳',
      open: (wo) => !!wo.awaitingNsWo && !wo.nsWoId,
      label: 'awaiting NetSuite WO #', detail: () => '',
      clearedBy: 'the outbox writeBack stamping nsWoId',
      help: (wo) => `${wo.id} is waiting for its NETSUITE WORK ORDER number.\n\nThe WO is queued (11.1 → NetSuite Sync Queue) and its number stamps back automatically — the release then happens on its own. Releasing NOW puts unanchored paper on the floor.` },
    { key: 'components', kind: 'wait', icon: '🧩',
      open: (wo) => !!wo.awaitingComponents && !wo.componentsDone,
      label: 'awaiting component milling', detail: (wo) => (wo.componentShopWoIds || []).length ? `${wo.componentShopWoIds.length} shop WO(s)` : '',
      clearedBy: 'every component shop WO completing (RTG\'s live effect stamps componentsDone)',
      help: (wo) => `${wo.id} is waiting on ${(wo.componentShopWoIds || []).length} component shop WO(s) still in milling.\n\nThe pulls do not exist yet — the gate clears itself the moment the shop completes them. Releasing NOW sends the floor a job it cannot pick.` },
    { key: 'convert', kind: 'wait', icon: '⇄',
      open: (wo) => !!wo.awaitingConvert,
      label: 'awaiting phosphate convert', detail: (wo) => wo.convertGateNote || '',
      clearedBy: 'the WMS Convert tab posting the convert (clearConvertGate)',
      help: (wo) => `${wo.id} is waiting on a phosphate CONVERT.\n\n${wo.convertGateNote || 'Component /P cores are short — a convert to-do is open on the WMS Convert tab.'}\n\nUntil the convert posts, the ${itemOf(wo)} components do not exist to pick. The gate clears itself when the WMS completes the convert.` },
    { key: 'rodCut', kind: 'wait', icon: '✂',
      open: (wo) => !!wo.awaitingRodCut,
      label: 'awaiting rod cut', detail: (wo) => wo.rodCutNote || '',
      clearedBy: 'WMS → ROD CUTS → Cuts for Finishing completing it (prints this order\'s label)',
      help: (wo) => `${wo.id} is waiting on a rod cut.\n\n${wo.rodCutNote || 'The 8 ft rods have not been cut yet.'}\n\nUntil WMS → ROD CUTS → "Cuts for Finishing" completes it, the ${itemOf(wo) || 'cut'} poles do not exist to pick or finish — and that cut prints this order's label when it's done.` },
    { key: 'dispatched', kind: 'done', icon: '✓',
      open: (wo) => !!wo.pushedToFinishing,
      label: 'already dispatched to finishing', detail: () => '',
      clearedBy: 'nothing — an order is released once',
      help: (wo) => `${wo.woDisplayId || wo.nsWoTran || wo.id} was ALREADY dispatched to finishing.\n\nRelease it AGAIN anyway? Normally NO — this re-copies the floor card.` },
];
// Every gate, open or not, with its words resolved for this order.
export const gatesOf = (wo) => !wo ? [] : GATES.map(g => {
    const detail = g.detail(wo);
    return { key: g.key, kind: g.kind, icon: g.icon, open: !!g.open(wo), label: g.label, detail, note: detail ? `${g.label} · ${detail}` : g.label, help: g.help(wo), clearedBy: g.clearedBy };
});
export const openGatesOf = (wo) => gatesOf(wo).filter(g => g.open);
// The one question the auto paths ask. False for a missing record — nothing releases nothing.
export const isReleasable = (wo) => !!wo && openGatesOf(wo).length === 0;
// "awaiting SO accept · awaiting rod cut" — '' when nothing is open.
export const gateSummary = (wo, sep = ' · ') => openGatesOf(wo).map(g => g.note).join(sep);
