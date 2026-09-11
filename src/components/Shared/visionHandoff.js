// ── CPQ → VISION (Stuart 2026-09-10/11, Vision Phase 2: "can open and reopen with no problems") ──
//
// Until now the only road ran one way: a drawing saved in Vision became a CPQ line. A line
// configured in CPQ could never be opened on the board. This module is the other direction: a
// CPQ cart line becomes a draft in the Phase 1 shape (the engine's picks by slot, the framing
// answers, the ordered length) that Vision loads onto its board — and the line remembers the
// draft (`visionDraftId`) so a Vision re-save comes back to REPLACE it, never to add a second
// line (cartLineForDraft). Pure. Harnessed in scripts/visionHandoff.test.mjs.

const U = (v) => String(v ?? '').trim().toUpperCase();

/** A Vision draft built from a CPQ cart line (a TAGS-engine line with its engineConfig). */
export function draftFromCartLine(item, { quoteId, customerId = '', jobName = '', brandId = '', by = '', now = Date.now() } = {}) {
    if (!item || item.engine !== 'TAGS') return null;
    const cfg = item.engineConfig || {};
    const answers = cfg.answers || {};
    const picks = cfg.picks || {};
    const id = item.visionDraftId || `DRAFT-${String(item.id || now).replace(/[^A-Za-z0-9-]/g, '')}`;
    const lengthInches = Number(cfg.lengthInches ?? item.lengthInches) || 0;
    const framing = { rodKind: U(answers.rodKind), setup: U(answers.setup), frontLayer: U(answers.frontLayer), drive: U(answers.drive) };
    return {
        id, brandId, category: 'HARDWARE', status: 'DRAFT_FROM_CPQ',
        jobName: jobName || '', sidemark: item.sidemark && item.sidemark !== 'No Sidemark' ? item.sidemark : (item.memo || ''),
        customerId: customerId || '',
        linkedAssemblyId: item.assemblyId || null,
        linkedCpqFlowId: item.flowId || null, flowId: item.flowId || null, cpqFlowId: item.flowId || null,
        masterQuoteId: quoteId,
        cartItemId: item.id || null,
        specs: {
            collection: '',
            ...framing,
            // The engine's picks by slot — what Vision Phase 1 restores outright.
            enginePicks: Object.entries(picks).filter(([k, v]) => k && v).map(([slotKey, choiceId]) => ({ slotKey, choiceId, partId: '', kind: String(slotKey).split('|')[0] === 'END' ? '' : String(slotKey).split('|')[0], position: String(slotKey).split('|')[2] || '', tier: String(slotKey).split('|')[1] || '' })),
            engineeringNotes: {},
        },
        spatialData: {
            shape: 'STRAIGHT', inputMode: 'ORDERING',
            ...(lengthInches ? { w2: lengthInches } : {}),
            ...(answers.proj != null && answers.proj !== '' ? { proj: Number(answers.proj) || answers.proj } : {}),
            ...framing,
            attachments: [], shopNotes: [],
        },
        author: by || '', openedFromCpqAt: now,
    };
}

/** The cart line a Vision draft belongs to — by the line's own memory of the draft, or the draft's memory of the line. */
export const cartLineForDraft = (cart = [], draft = null) => {
    if (!draft) return null;
    return (cart || []).find(c => c && ((c.visionDraftId && c.visionDraftId === draft.id) || (draft.cartItemId && c.id === draft.cartItemId))) || null;
};
