// ── WHAT THE OPERATOR TOLD THE SHOP, ON THE LINE THE SHOP READS (Stuart 2026-10-01) ─────────────
//
// Every CPQ step has a note box — "Anything the shop needs to know about Pole length" — and what
// was typed there was saved with the line (engineConfig.stepNotes, so Edit restores it) and read by
// nothing else: no floor screen and no document ever printed it. The shop reads a line's
// `generalNotes` — View Item prints them, and RTG stamps them on the shop order where the Shop Floor
// card shows them (Shared/cpqJobFacts.visionNotes) — which until now only a Vision drawing filled.
//
// So the notes of a configuration, in the order the steps are walked, each under the step it was
// typed on ("Pole length: cut 1/8 short"), go onto the line there. Engine facts that the floor must
// not miss (a declined splice — Shared/flowExtras.noSpliceNote) lead the list. Vision's own notes
// are added after these by CPQ, never replaced. Pure. Harness: scripts/lineShopNotes.test.mjs.

const txt = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/**
 * @param steps      the walk, in order: [{ key, label }]
 * @param stepNotes  { stepKey: 'what was typed' }
 * @param lead       notes that go first (already worded), e.g. the no-splice line
 * @returns string[] the line's shop notes — [] when there is nothing to say
 */
export function shopNotesOf({ steps = [], stepNotes = {}, lead = [] } = {}) {
    const notes = (stepNotes && typeof stepNotes === 'object') ? stepNotes : {};
    const out = (lead || []).map(txt).filter(Boolean);
    const seen = new Set();
    (steps || []).forEach(st => {
        if (!st || seen.has(st.key)) return;
        seen.add(st.key);
        const t = txt(notes[st.key]);
        if (t) out.push(`${txt(st.label) || st.key}: ${t}`);
    });
    // A note whose step is no longer in the walk (an answer above removed the step) was still typed:
    // it prints under its key rather than being dropped.
    Object.keys(notes).forEach(k => {
        if (seen.has(k)) return;
        const t = txt(notes[k]);
        if (t) out.push(`${k}: ${t}`);
    });
    return out;
}

// ── …AND WHAT THE CUSTOMER IS TOLD (Stuart 2026-10-01) ──────────────────────────────────────────
// "the line notes entered in the memo area lower right of cpq screen — these should have a check box for client
//  visible? if checked then the notes appear on their paperwork, if not checked (default) only pass on internal
//  documents." Every step note is the shop's (shopNotesOf, above). A note whose box is ticked is ALSO the
// customer's: it prints on their quote, sales order and invoice under its configuration. Off by default — a note
// is internal until somebody says otherwise — and a tick on an empty note prints nothing.
//   visible  { stepKey: true }
export function clientNotesOf({ steps = [], stepNotes = {}, visible = {} } = {}) {
    const on = (visible && typeof visible === 'object') ? visible : {};
    const shown = {};
    Object.keys((stepNotes && typeof stepNotes === 'object') ? stepNotes : {}).forEach(k => { if (on[k] === true) shown[k] = stepNotes[k]; });
    return shopNotesOf({ steps, stepNotes: shown });
}

/** The row a client-visible note is on the saved order: display-only everywhere, printed on money documents. */
export const clientNoteRow = (text) => ({ name: `  Note — ${txt(text)}`, qty: 1, price: 0, total: 0, isNote: true, partHandling: '', partId: null });
