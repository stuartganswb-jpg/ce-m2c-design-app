// ─────────────────────────────────────────────────────────────────────────────────────────────
// A KIT AND A CONFIGURATION ARE THE SAME ORDER IN TWO SPELLINGS
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Stuart, 2026-08-22: "if a customer orders a standard kit in a standard finish we will use tab 7
// quickship traverse kits to enter the order. but if they want any customization then they come to
// cpq… if the client provided kit code HTS7504 PREMIUM, how could we give these initial starting
// entries to our operators to start aligned with 2" wall mount manual traverse selections?"
//
// So this is a SEEDER, not a rule. It writes the same two things an operator's clicks write —
// `answers` and `picks` — and nothing else. It cannot change what the engine offers, prices,
// draws or pushes, because it never touches resolve/admits/slots/visibleNodes. A kit that seeds
// badly is a configuration an operator can correct in one click; it is not a flow that behaves
// differently. That is the whole reason this was safe to try on a day when four tested collections
// were off limits.
//
// It is deliberately the same shape as seedFromVision — one source in, {answers, picks, carried,
// missed} out — because the honest part of that bridge is the reporting: a decision that could not
// be carried is SURFACED, never quietly approximated.
//
// ── WHY THIS ONE ALSO REFUSES ────────────────────────────────────────────────────────────────
// Vision seeds a drawing that was engineered against this very assembly, so a value it cannot
// place is a detail. A KIT IS A PRODUCT THE CUSTOMER HAS ALREADY BEEN SOLD. If the assembly cannot
// honour one of its defining choices, the configuration that comes out is not "mostly the kit" —
// it is a different product wearing the kit's code, and every other seeded answer makes it look
// MORE convincing, not less.
//
// H1-2TRV today is exactly that trap: `setup` and `drive` are both live axes, so a ceiling kit
// (H1-2TRV-4C/P and its five siblings) would seed single/double and manual/motorised perfectly
// while the mount silently stayed WALL — the assembly has no ceiling parts tagged, and none
// sitting untagged in the .glb either. Four confident lines and one quiet one is the same shape as
// every fault this engine has produced: what was wrong was the thing not shown.
//
// So `blocked` is a hard stop for the caller, not advice.
//
// ── AND WHY THAT IS ALSO THE CEILING FOUNDATION ──────────────────────────────────────────────
// Stuart, same conversation: "put in foundation for ceiling brackets, they are coming and will be
// added to the assembly."
//
// There is nothing to build. The axis test below asks the MODEL what it offers, and the model
// discovers its values from the tags. The day ceiling brackets are pinned and tagged mount:CEILING,
// `mount` grows a second value, the ceiling kits stop being blocked, and the Mount question appears
// in the walk — with no release, no flag and no edit to this file. The foundation for ceiling is
// that this code never learned the word WALL.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** The alignment fields a kit record carries, and the engine axis each one answers. */
const AXIS_OF = { setup: 'setup', drive: 'drive', mount: 'mount' };

/** Human words for the refusal, so it names the product rather than the field. */
const SAYS = { setup: 'setup', drive: 'drive', mount: 'mount' };

/**
 * What an assembly can actually be built as, on one axis.
 *
 * An IMPLIED axis still counts, and must: on a wall-only collection `mount` holds exactly one
 * value and is never asked, and a WALL kit is perfectly buildable there — it is already the
 * answer. Reading `model.axes` rather than "is there a question" is what makes that fall out.
 */
const axisOffers = (model, key, value) => {
    const axis = (model?.axes || []).find(a => a.key === key);
    if (!axis) return false;
    return (axis.values || []).some(v => U(v) === U(value));
};

/**
 * Seed a configuration from a Quick Ship kit record.
 *
 * @param model   the resolved hardware model (needs `axes` and `slots`)
 * @param kit     the Kit-class library record — reads manufacturingSpecs.kitAlign
 * @returns {{answers, picks, lengthInches, carried, missed, blocked}}
 *          `blocked` non-null means DO NOT SEED: the assembly cannot build this kit.
 */
export function seedFromKit({ model, kit }) {
    const answers = {};
    const picks = {};
    const carried = [];
    const missed = [];
    const out = (blocked = null) => ({ answers, picks, lengthInches: null, carried, missed, blocked });

    const align = kit?.manufacturingSpecs?.kitAlign;
    if (!model) return out({ what: 'assembly', why: 'no configuration model to seed into' });
    if (!align) return out({ what: 'kit', why: 'this record carries no kitAlign — it is not a kit built in 4.6' });

    const code = String(kit.legacyErpId || kit.itemId || kit.itemName || 'the kit').trim();

    // ── THE THREE AXES ───────────────────────────────────────────────────────────────────────
    // Checked BEFORE anything is written, so a refusal leaves nothing half-applied. The first one
    // the assembly cannot build stops the whole seed.
    for (const field of Object.keys(AXIS_OF)) {
        const want = U(align[field]);
        if (!want) continue;                       // the kit does not specify it — not our business
        const key = AXIS_OF[field];
        if (!axisOffers(model, key, want)) {
            const axis = (model.axes || []).find(a => a.key === key);
            const has = axis ? (axis.values || []).map(v => String(v).toLowerCase()).join(', ') : 'nothing';
            return out({
                what: SAYS[field],
                why: `${code} is a ${want.toLowerCase()} ${SAYS[field]} kit, and this assembly offers ${has}. `
                    + `Seeding it would build a ${has.split(',')[0] || 'different'} system under the kit's code. `
                    + `Tag the ${want.toLowerCase()} parts in 1.6 and this kit seeds itself.`,
            });
        }
    }
    // Nothing can refuse from here down, so the writes are safe to make.
    for (const field of Object.keys(AXIS_OF)) {
        const want = U(align[field]);
        if (!want) continue;
        answers[AXIS_OF[field]] = want;
        carried.push(`${want.toLowerCase()} ${SAYS[field]}`);
    }

    // ── THE LENGTH ───────────────────────────────────────────────────────────────────────────
    // The kit's base set — 4 feet of fascia on the H1-2TRV kits — is a STARTING length, not the
    // order's. It goes in the length box because that is where the operator would type it, and the
    // customer's real measurement replaces it.
    const feet = Number(align.minFeet);
    const lengthInches = feet > 0 ? feet * 12 : null;
    if (lengthInches) carried.push(`${feet} ft base length — replace with the measured length`);

    // ── THE FRONT RAIL ───────────────────────────────────────────────────────────────────────
    // Only a DOUBLE has one: Quick Ship reads it as `trackCount: DOUBLE && frontRail !== 'RING' ?
    // 2 : 1`, so on a single there is nothing to say and saying it would be noise. It is not an
    // axis — RING vs TRACK is a PICK on the front tier — so it is placed the way seedFromVision
    // places a part: find the slot that offers it, and report when none does.
    if (U(align.setup) === 'DOUBLE' && U(align.frontRail) === 'RING') {
        const slot = (model.slots || []).find(s =>
            U(s.tier || '') !== 'BACK'
            && Array.isArray(s.options)
            && s.options.some(o => U(o.role) === 'RING'));
        const opt = slot && slot.options.find(o => U(o.role) === 'RING');
        if (slot && opt) { picks[slot.key] = opt.id; carried.push('ring front rail'); }
        else missed.push({ what: 'front rail', why: 'the kit puts rings on the front rod, and no front slot here offers a ring — choose the front rail by hand' });
    }

    // ── THE FINISH ───────────────────────────────────────────────────────────────────────────
    // Reported, never chosen. `material` is a FAMILY (P paint / EP plated / W wood), and the order
    // needs one exact code out of a hundred. Picking one for the operator would put a finish on a
    // customer's quote that nobody chose — the one kind of wrong this seeder must not be.
    const mat = U(align.material);
    if (mat) {
        const say = mat === 'W' ? 'a wood stain' : mat === 'EP' ? 'a plated finish' : 'a painted finish';
        missed.push({ what: 'finish', why: `${code} is sold in ${say} — pick the exact code` });
    }

    return { answers, picks, lengthInches, carried, missed, blocked: null };
}

/** Kits a given assembly could be seeded from: Kit-class records carrying an alignment. */
export function kitsForSeeding(parts = []) {
    return parts.filter(p => String(p?.partClass || '') === 'Kit' && p?.manufacturingSpecs?.kitAlign);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE KIT IS THE FIRST LINE, AND THE FEET ABOVE IT ARE THE SECOND
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Stuart, 2026-08-22: "the 4ft kit bills as top line item, then additional feet bill below it at
// same price as in cpq engine. so a 10 ft kit will bill at 4ft kit + 6ft additional feet. and
// anything else added in bills additional lines… all forms quotes, sales orders, packing slips,
// invoices will be app created and match the kit # and additional part#'s so the paperwork will be
// honest for the client."
//
// So the customer's paperwork reads the way they ordered: their kit code, then what they added.
//
// ── WHY THIS IS SO SMALL ─────────────────────────────────────────────────────────────────────
// Only the PER-FOOT lines need touching. Everything else already behaves:
//   • the component chart bills nothing at its own quantity — configuratorTotal sums only lines
//     flagged `billable`, so the brackets and carriers that come with a length are already inside
//     the per-foot price, and only a count raised above the chart bills the difference;
//   • a finial, a ring, an added item is a customisation and bills as its own line, which is
//     exactly what "anything else added in bills additional lines" asks for.
//
// So the kit line goes on top, the first `baseFeet` of every per-foot line are inside it, and the
// remainder bills at the engine's own per-foot rate — which Stuart confirms is (or will be)
// aligned with the kit's, so there is no second rate to reconcile and nothing bills twice.
//
// ⚠ THE CUT LENGTH IS NOT THE BILLED LENGTH. A 10 ft order still cuts a 10 ft fascia; what changes
// is that 4 of those feet were already paid for in the kit. `cutLength` is what the bench reads and
// is deliberately left alone — reducing it would ship a short pole.

/** Rod-ish roles are the ones priceConfiguration bills by the foot. */
const isPerFootLine = (l) => !!l.perFoot;

/**
 * Re-shape a priced configuration as: the kit, then what was added to it.
 *
 * ⚠ NOTHING IS EVER REMOVED FROM THE LIST. The first cut of this dropped the per-foot lines that
 * the kit already paid for, which is right for the BILL and catastrophic for everything else:
 * `pricingBreakdown` is the same list the NetSuite push, the pick list and the packing slip read,
 * so a 4 ft order would have billed correctly and shipped nothing. A covered line stays, at zero,
 * and says why. Stuart 2026-08-22, on the packing slip: "a kit header with components beneath."
 *
 * Pure. Applied ONLY where a kit was chosen — every other configuration is returned untouched, so
 * no existing flow's pricing can move.
 *
 * @returns {{lines, total}} in the same shape priceConfiguration returns.
 */
export function applyKitPricing(priced, { kitCode, kitName, kitPrice, baseFeet, clientSku } = {}) {
    if (!priced || !kitCode) return priced;
    const base = Number(baseFeet) > 0 ? Number(baseFeet) : 4;
    const price = Number(kitPrice) > 0 ? Number(kitPrice) : 0;

    const rest = (priced.lines || []).map(l => {
        if (!isPerFootLine(l)) return l;
        const feet = Number(l.feet) || 0;
        const billed = Math.max(0, feet - base);
        return {
            ...l,
            // `feet` stays the REAL length — it is what the shop cuts and what the packing slip
            // says arrived. Only the money moves.
            billedFeet: billed,
            total: (Number(l.unit) || 0) * billed,
            inKit: billed <= 0,
            detail: billed > 0 ? `${billed} ft above the ${base} ft kit` : `included in the ${base} ft kit`,
        };
    });

    const kitLine = {
        partId: kitCode,
        name: kitName || kitCode,
        sku: clientSku || kitCode,
        aliasCode: clientSku || '',
        billedId: kitCode,
        qty: 1,
        perFoot: false,
        finishCode: '',
        noFinish: false,
        unit: price,
        total: price,
        source: 'kit',
        detail: `${base} ft kit`,
        hidden: false,
        role: 'KIT',
        position: '',
        // ⚠ A KIT IS NOT A NETSUITE ITEM. Quick Ship says so in as many words — "NO NetSuite
        // identity by design (noNs) — the SO push consumes exploded components plus a generic
        // traverse $-holder, never the kit itself." Its money rides the rollup exactly as a fee's
        // does; the components beneath it are what push and what get picked. Without this the push
        // would send a code NetSuite has no item for.
        isKit: true,
        noNs: true,
    };

    const lines = [kitLine, ...rest];
    return { ...priced, lines, total: lines.reduce((s, l) => s + (Number(l.total) || 0), 0) };
}
