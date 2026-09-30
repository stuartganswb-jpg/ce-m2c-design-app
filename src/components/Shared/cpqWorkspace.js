// 🧷 THE CPQ WORKSPACE SURVIVES A TAB SWITCH AND A RELOAD (Eric 2026-09-29, App Imp: a configured line
// "opens with its selections missing"; Stuart 2026-09-30: "he had just opened the checkout and then did not
// follow thru but rather aborted checkout and all was gone on the screen when he returned").
//
// HQ keeps a tab mounted only while it is the tab on screen (HQ.js), and the "new version is live" banner
// reloads the page. The cart already lived above CPQ, in HQ and in localStorage (hq_global_cart), so it
// came back. Nothing else did: the customer and the job header, the price level, the open flow, the line
// being edited and the configuration being built all lived in CPQ's memory alone. Leave for tab 7 or the
// CRM to check something, come back, and the screen was empty — the line re-priced at base, the edit gone.
//
// The workspace is saved beside the cart, per division, and put back when CPQ opens:
//   • header    — jobData (customer, job, sidemark, need-by, notes, shipping, discount), price level, add-ons
//   • engine    — which engine, the open flow and assembly, the size group, the line being edited, the Vision draft
//   • oldEngine — the old configurator's step answers, exactly the fields its own Edit restores
//   • config    — the new engine's configuration IN PROGRESS, in the shape a cart line's engineConfig keeps,
//                 handed back through the SAME door Edit uses (the configurator's reopenSeed) — one restore
//                 path, never a second one. The operator's own picks, never the auto-settled ones (livePicks):
//                 an auto-pick restored as an operator pick always wins, so a drive changed after the restore
//                 would keep the old ends (Shared/hardwareAutoPicks).
// It is another quote's work, and never comes back, when the quote session differs (a quote reopened from the
// CRM, a Vision push). A configuration comes back only onto the assembly it was built on (the SO60551 rule:
// a seed from one flow never rides into another). An edited line that has left the cart is no longer "being
// edited". Save and Clear All empty it; Add configuration empties the configuration part. Pure, apart from
// the three storage helpers, which take the storage as an argument and never throw.

export const WORKSPACE_VERSION = 1;
export const WORKSPACE_PREFIX = 'hq_cpq_workspace_';
export const workspaceKey = (brand) => `${WORKSPACE_PREFIX}${String(brand || 'none')}`;

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const anySet = (o) => Object.values(obj(o)).some(v => v !== undefined && v !== null && v !== '' && v !== false);
const txt = (v) => String(v == null ? '' : v).trim();

/**
 * Does the new engine's work hold anything the operator would lose? The whole-configuration finish is NOT
 * counted: it stays selected after Add configuration on purpose, ready for the next line. Nor is the traverse
 * panel's selection — the panel fills it from the model; the operator's choices are the answers and picks.
 */
export function workHasProgress(w) {
    if (!w) return false;
    return anySet(w.answers) || anySet(w.picks) || Number(w.lengthInches) > 0
        || (Array.isArray(w.extras) && w.extras.some(x => x && txt(x.code)))
        || anySet(w.partFinish)
        || Object.values(obj(w.stepNotes)).some(t => txt(t))
        || !!txt(w.memo) || !!txt(w.kitPick);
}

/** Is the work exactly what a freshly opened configurator starts with? Nothing is saved for that. */
export function workIsPristine(w) {
    if (!w) return true;
    if (workHasProgress(w)) return false;
    if (anySet(w.globalFinishes) || txt(w.globalFinish)) return false;
    if (Number(w.stepIx) > 0) return false;
    if (txt(w.qty) && txt(w.qty) !== '1') return false;
    if (txt(w.fabricId) && txt(w.fabricId) !== 'PRINT') return false;
    if (anySet(w.sizePick) || anySet(w.stepQty)) return false;
    return true;
}

/** Is there anything in this workspace worth keeping? An empty one is removed rather than stored. */
export function workspaceIsEmpty(ws) {
    if (!ws) return true;
    const h = obj(ws.header), j = obj(h.jobData), e = obj(ws.engine);
    const ship = Object.entries(obj(j.customShippingAddress)).some(([k, v]) => k !== 'country' && txt(v));
    const header = !!(txt(j.customerId) || txt(j.jobName) || txt(j.sidemark) || txt(j.needBy) || txt(j.productionNotes)
        || txt(j.poNumber) || txt(j.internalMemo) || txt(j.shippingAddressId) || txt(j.shippingAmount) || txt(j.orderDiscountPercent)
        || (txt(j.shippingMethod) && txt(j.shippingMethod) !== 'SAVED') || ship
        || (txt(h.priceLevel) && txt(h.priceLevel) !== 'STANDARD') || anySet(h.addOnSel));
    const engine = !!(txt(e.activeFlowId) || txt(e.editingCartId) || txt(e.pendingGroup) || txt(e.activeDraftId));
    return !header && !engine && workIsPristine(ws.config);
}

/** The saved workspace for this division, or null (none, unreadable, or written by another version). */
export function readWorkspace(storage, brand) {
    try {
        const raw = storage && storage.getItem(workspaceKey(brand));
        if (!raw) return null;
        const ws = JSON.parse(raw);
        return ws && ws.v === WORKSPACE_VERSION ? ws : null;
    } catch { return null; }
}

/** Save it — or remove it when there is nothing in it. Storage full or blocked: the screen still works. */
export function writeWorkspace(storage, brand, ws) {
    try {
        if (!storage) return;
        if (workspaceIsEmpty(ws)) storage.removeItem(workspaceKey(brand));
        else storage.setItem(workspaceKey(brand), JSON.stringify({ ...ws, v: WORKSPACE_VERSION, brand: String(brand || '') }));
    } catch { /* not persisted — it simply won't survive a reload */ }
}

/** Every division's workspace goes — a quote reopened from the CRM owns the screen now. */
export function clearAllWorkspaces(storage) {
    try {
        if (!storage) return;
        const keys = [];
        for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(WORKSPACE_PREFIX)) keys.push(k); }
        keys.forEach(k => storage.removeItem(k));
    } catch { /* nothing to clear */ }
}

/**
 * What of a saved workspace may come back on this mount. → { header, engine, oldEngine, config } | null
 * @param sessionId the quote session CPQ is opening under (hq_active_quote_session), or null for a fresh quote
 * @param cart      the cart as it stands
 */
export function restorableWorkspace(ws, { sessionId = null, cart = [] } = {}) {
    if (!ws || ws.v !== WORKSPACE_VERSION) return null;
    if ((txt(ws.sessionId) || null) !== (txt(sessionId) || null)) return null;
    const engine = { ...obj(ws.engine) };
    if (engine.editingCartId && !(Array.isArray(cart) ? cart : []).some(c => c && c.id === engine.editingCartId)) engine.editingCartId = null;
    let config = ws.config && typeof ws.config === 'object' ? ws.config : null;
    if (config && (!txt(config.assemblyId) || config.assemblyId !== engine.activeAssemblyId)) config = null;
    if (config && workIsPristine(config)) config = null;
    return { header: obj(ws.header), engine, oldEngine: obj(ws.oldEngine), config };
}

/** The configurator's reopen seed for a restored configuration — the door Edit already uses. */
export function workspaceSeedOf(config, key) {
    if (!config) return null;
    const { assemblyId, ...rest } = config;
    return { ...rest, key, forAssemblyId: assemblyId, fromWorkspace: true };
}
