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
 * @param everyChoice  (optional) EVERY choice the assembly pins, at any size — handing it in switches on the two
 *                     cases below for a pick that is not among the choices offered now. Without it such a pick is
 *                     passed over, as it always was (Vision's screen calls this reader too, and is unchanged).
 * @param savedParts   (optional) { slotKey: { partId, code, name } } — which part each pick was, as the line recorded
 *                     it when it was saved (Shared/hardwareSession.pickPartsOf); lines saved before 2026-10-13 have none
 * @returns [{ key, slotKey, choiceId, step, partName, partCode, reason }]
 */
export function droppedPicks(model, rawPicks = {}, livePicks = {}, { labelOf = (s) => s.key, everyChoice = null, savedParts = null } = {}) {
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
        if (!had) {
            if (!everyChoice) return;                            // a pick from another assembly / a stale key
            // ── A SAVED PICK THAT IS NOT AMONG THE CHOICES ANY MORE IS NAMED TOO (Stuart 2026-10-13: "fix both") ──
            // Until today a pick the model does not hold was passed over as "not ours" — and that is exactly what a
            // SAVED line's pick is once its tag has been changed in 1.6 (a new item number re-makes the pin), or,
            // on a flow that asks the size, once the size chosen is one the part is not made in. Edit reopened the
            // line without that part, the strip named nothing and Add was allowed: of the 139 lines of the last 80
            // quotes, 12 came back short that way (H1-2TRV's miter returns; wood gem finials and in-line brackets on
            // H1-138) — two of them short of their wall brackets as well, which had followed the return out. And it
            // is the road the Approve warning sends people down: "the assembly's tags changed — reopen, re-save".
            // So the caller hands in every choice the assembly pins, and the pick is named:
            //   · pinned, but not offered now      → by its part: "not made in the size now chosen";
            //   · pinned nowhere on the assembly   → by the part the line recorded beside the pick (lines saved from
            //     today on), else by its step alone: "no longer on this assembly".
            // NOT named: a step the same part sits in again, and — where the line cannot say which part it was — a
            // step the engine has filled itself (a track with one option, a track end the drive settled): the
            // operator is never asked those, and the only part the assembly offers there is on the order.
            const slot0 = slots.find(s => s.key === slotKey);
            const seated0 = choices.find(c => c.id === livePicks[slotKey]) || null;
            const pinned = everyChoice.find(c => c.id === choiceId) || null;
            const was = pinned ? { partId: pinned.partId, code: pinned.partId || '', name: pinned.name || pinned.partId || '' } : ((savedParts && savedParts[slotKey]) || null);
            if (seated0 && was && U(was.partId) && U(seated0.partId) === U(was.partId)) return;     // the same part is in the step again
            if (seated0 && !was) return;                                                           // filled by the engine itself; the line cannot say what it held
            out.push({
                key: dropKey(slotKey, choiceId), slotKey, choiceId,
                step: labelOf(slot0 || slotFromKey(slotKey)),
                partName: was ? (was.name || was.code || 'the part saved on this line') : 'the part saved on this line',
                partCode: was ? (was.code || '') : '',
                // (a tag taken off and put back is a new pin of the SAME part: the line can say so where it recorded
                //  the part — the operator picks it again; nothing here re-seats a pick the engine's own rule let go)
                reason: pinned ? 'not made in the size now chosen'
                    : (was && slot0 && (slot0.options || []).some(o => U(o.partId) && U(o.partId) === U(was.partId)))
                        ? 'its tag in 1.6 was re-made since this line was saved — the part is still offered on this step: pick it again'
                        : `no longer on this assembly — its tag in 1.6 was changed or removed since this line was saved${seated0 ? ` (the step now holds ${seated0.name || seated0.partId})` : ''}`,
            });
            return;
        }
        // ⚠ THE SAME PART IN THE SAME STEP IS KEPT, WHATEVER ITS PINS ARE TAGGED (Stuart 2026-10-13,
        // with the return-plate change in hardwareModel). The step IS the place on the order — its
        // key is KIND|TIER|POSITION — so a pick the engine moved onto another pin of the same part
        // inside it has not gone anywhere. The test below compares the two PINS' own tier tags, and
        // a backplate step has no tier: H1-75 and H1-1 pin their 3-5/8" return plates rod: front
        // and the 4-5/8" and 6" ones blank, so a plate re-seated between them was named as removed
        // ("not offered under the current Rod Setup answers") while it sat on the bill, and Add
        // waited for an acknowledgement of nothing.
        const seated = choices.find(c => c.id === livePicks[slotKey]);
        if (seated && U(seated.partId) && U(seated.partId) === U(had.partId)) return;
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
