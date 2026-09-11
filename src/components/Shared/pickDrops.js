// ── A SELECTION REMOVED BY A LATER CHOICE IS NAMED, NEVER SILENT (Stuart 2026-09-10) ─────────
//
// The configurator has no sweep: the operator's raw picks are FILTERED through the live options
// at render time, so a pick a later answer invalidates simply stops being shown (the sweep that
// tried to police this deadlocked twice in August). That is the right mechanism and the wrong
// silence — Fabricut order 3 (2026-09-03) had both returns accepted and priced, then a later
// choice removed them and nothing on the screen said so; an order entered that way ships short.
//
// This module is the one reader that says what was removed and why. It compares the raw picks
// with the settled live picks after every model pass and returns one entry per removal, with the
// engine's own reason: the slot's rejection for that part, else the step's suppression text, else
// the plain fact. A pick re-seated onto its twin (same part, another pin) is NOT a removal — that
// is the 2026-08-20 "replace the pin, keep the part" rule doing its job.
//
// The configurator shows the entries in a strip and refuses "+ Add configuration" until each is
// acknowledged (Stuart: "refuse add until acknowledged"). Pure; harnessed in scripts/pickDrops.test.mjs.

const U = (v) => String(v ?? '').trim().toUpperCase();

/** A stable identity for one removal — the slot and the choice that left it. */
export const dropKey = (slotKey, choiceId) => `${slotKey}|${choiceId}`;

/**
 * @param model      the settled resolve() result (slots with options/rejected/suppressedReason, choices)
 * @param rawPicks   { slotKey: choiceId } as the operator set them
 * @param livePicks  { slotKey: choiceId } after reseatPicks — what the rail shows as chosen
 * @param labelOf    (slot) => the step's on-screen label
 * @returns [{ key, slotKey, choiceId, step, partName, partCode, reason }]
 */
export function droppedPicks(model, rawPicks = {}, livePicks = {}, { labelOf = (s) => s.key } = {}) {
    const out = [];
    const slots = (model && model.slots) || [];
    const choices = (model && model.choices) || [];
    const liveChoices = Object.values(livePicks || {}).filter(Boolean).map(id => choices.find(c => c.id === id)).filter(Boolean);
    // A slot that is no longer asked (the back rod on a single) has no slot object to label — the
    // key still says what it was: KIND|TIER|POSITION, the same three words slotLabel reads.
    const slotFromKey = (key) => { const [kind = '', tier = '', position = ''] = String(key).split('|'); return { key, kind, tier, position, tierSolo: false }; };
    Object.entries(rawPicks || {}).forEach(([slotKey, choiceId]) => {
        if (!choiceId) return;                                   // the operator's own un-pick is not a removal
        if (livePicks[slotKey] === choiceId) return;             // still chosen where it was chosen
        const had = choices.find(c => c.id === choiceId);
        if (!had) return;                                        // a pick from another assembly / a stale key
        // Re-seated on its TWIN — the same part, another pin, for the same place on the order
        // (same role, tier and position): kept, not removed. The back finial that leaves when the
        // order becomes a single is NOT a twin of the front one still chosen.
        const twin = liveChoices.some(c => c.id !== choiceId && U(c.partId) === U(had.partId)
            && c.role === had.role && (c.tier || '') === (had.tier || '') && (c.position || '') === (had.position || ''));
        if (twin) return;
        // A plate that left because its arm was un-picked followed the operator's own choice out
        // (the 2026-09-10 "a plate follows its arm" rule) — an expected consequence, not a removal
        // to acknowledge. A plate that left while an arm is still there IS one.
        if (had.role === 'BACKPLATE' && !liveChoices.some(c => ['BRACKET', 'RETURN', 'INSIDE_MOUNT'].includes(c.role) && (c.position || '') === (had.position || ''))) return;
        const slot = slots.find(s => s.key === slotKey);
        const rj = slot && (slot.rejected || []).find(r => r.choice && r.choice.id === choiceId);
        const reason = rj ? [rj.rule, rj.detail].filter(Boolean).join(' — ')
            : (slot && slot.suppressedReason) ? slot.suppressedReason
            : !slot ? 'this step is not asked under the current Rod Setup answers'
            : 'not offered under the current Rod Setup answers';
        out.push({
            key: dropKey(slotKey, choiceId), slotKey, choiceId,
            step: labelOf(slot || slotFromKey(slotKey)),
            partName: had.name || had.partId || choiceId,
            partCode: had.partId || '',
            reason,
        });
    });
    return out;
}

/**
 * Carry acknowledgements forward across model passes: an entry keeps `acked` if it was acked
 * before; an entry whose pick has come back disappears; new removals arrive un-acked.
 */
export function mergeDrops(previous = [], current = []) {
    const acked = new Set(previous.filter(d => d.acked).map(d => d.key));
    return current.map(d => ({ ...d, acked: acked.has(d.key) }));
}

/** The removals still blocking an add. */
export const unacknowledged = (drops = []) => drops.filter(d => !d.acked);
