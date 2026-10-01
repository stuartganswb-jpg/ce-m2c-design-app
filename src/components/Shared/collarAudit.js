// ── 🩺 EVERY FINIAL THAT NAMES A COLLAR MUST BE ABLE TO FIND IT (Stuart 2026-10-01) ─────────────
//
// A two-part finial names the collar it needs (1.6 → "requires collar" = the collar's code), and the
// engine brings the choice tagged COLLAR with that code along with it (hardwareModel.companionsFor):
// it renders with the finial, takes its own finish, and — when the finial is a kit — is the collar the
// kit bills (hardwarePricing, the finial-kit rule). All of that hangs on ONE tick. On 2026-10-01 the
// twelve H1-138 collar choices were ticked ✓FEE; a FEE choice saves without its collar tag, and from
// that moment every collar stopped rendering with its finial, stood in the finial step as a choice of
// its own, and every acrylic kit's collar went out with no finish — with nothing on any screen to say
// so. This is the screen that says so.
//
// Read-only and pins-only: it reports, it never repairs. Pure. Harness: scripts/collarAudit.test.mjs.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** Every spelling a choice can be known by — the same fields the engine matches a collar on, plus the fee's code. */
const codesOf = (p) => [p && p.legacyErpId, p && p.partName, p && p.partId, p && p.feeItemNo, p && p.id].map(U).filter(Boolean);

/** "S59 · NEW-SLOT · LEFT" — the slot as 1.6 names it (the S-number leads the choice's node name). */
function slotLabelOf(pin, cluster) {
    const m = /^S(\d+)/i.exec(String((pin && (pin.choiceNode || pin.targetNode)) || ''));
    return [m ? `S${m[1]}` : '', (cluster && cluster.name) || '', U(cluster && cluster.position)].filter(Boolean).join(' · ') || 'unknown slot';
}
const uniq = (list) => [...new Set(list)];

/**
 * @param pins      the assembly's pins, as stored
 * @param clusters  assembly.nodeClusters — for the slot's name and position
 * @returns [{ sev: 'red' | 'amber', kind, msg }]
 */
export function collarAudit(pins = [], clusters = []) {
    const out = [];
    const live = (pins || []).filter(p => p && !p.parked);
    const clusterOf = new Map((clusters || []).filter(Boolean).map(c => [c.id, c]));
    const label = (p) => slotLabelOf(p, clusterOf.get(p.clusterId));
    const posOf = (p) => U((clusterOf.get(p.clusterId) || {}).position);

    const askers = live.filter(p => U(p.requiresCollar));
    if (!askers.length) return out;
    const collars = live.filter(p => p.isCollar === true);
    const wanted = uniq(askers.map(p => U(p.requiresCollar)));

    wanted.forEach(code => {
        const asking = askers.filter(p => U(p.requiresCollar) === code);
        const tagged = collars.filter(p => codesOf(p).includes(code));
        // The choices that ARE that collar by code, but do not carry the tag.
        const untagged = live.filter(p => p.isCollar !== true && !U(p.requiresCollar) && codesOf(p).includes(code));
        const where = (list) => uniq(list.map(label)).join('; ');

        if (untagged.length) {
            const fee = untagged.filter(p => p.isFee === true);
            out.push({ sev: 'red', kind: 'COLLAR NOT TAGGED',
                msg: `${code}: ${untagged.length} choice(s) carry this code but are NOT ticked Collar${fee.length ? ` (${fee.length} ticked ✓FEE — a FEE choice saves without its collar tag)` : ''} — ${where(untagged)}. Each stands in the finial step as a choice of its own and does not come with the finial that needs it. In 1.6: untick ✓FEE, tick Collar.` });
        }
        if (!tagged.length) {
            out.push({ sev: 'red', kind: 'NO COLLAR',
                msg: `${asking.length} finial choice(s) require collar ${code} and NO choice is tagged Collar with that code — ${where(asking)}. The collar will not render with its finial, and a finial kit's collar loses its own finish (it takes the kit line's, which on an acrylic finial is none).` });
            return;
        }
        // A collar is pinned once per end: a finial whose end has none borrows another end's.
        const ends = new Set(tagged.map(posOf));
        const stranded = asking.filter(p => posOf(p) && !ends.has(posOf(p)) && !ends.has(''));
        if (stranded.length) {
            out.push({ sev: 'amber', kind: 'COLLAR AT ANOTHER END',
                msg: `${code}: ${stranded.length} finial choice(s) have no Collar-tagged ${code} at their own end — ${where(stranded)}. The engine borrows the collar pinned at ${[...ends].filter(Boolean).join(' / ') || 'another slot'}, so the wrong end's collar is the one drawn.` });
        }
    });
    return out;
}
