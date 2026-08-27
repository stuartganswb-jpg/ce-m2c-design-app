// ─────────────────────────────────────────────────────────────────────────────────────────────
// ROD PIECE INVENTORY — THE RULE, PURE (Stuart 2026-08-27, ROD_PIECE_INVENTORY_BRIEF.md)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Rods, poles and fascia are stocked in set lengths (12/20/22 ft), sold by the foot, and every
// sale leaves an offcut. NetSuite keeps FEET — the honest aggregate for money — but feet cannot
// answer the floor's question: "can we cut a 9 ft pole today?" (200 ft made of 3 ft stubs cannot.)
// So the app keeps a PIECE ledger (`rod_pieces`), born at the cut station: full shelf stock stays
// an unlabelled count, and a remainder gets a piece # and a label the moment a rod is cut.
//
// This module is every policy decision in one place, dependency-free so the offline suite
// (scripts/rodPieces.test.mjs) can pin Stuart's examples as acceptance tests:
//
//   THE WASTE RULE (his words: "always use the cuts when possible — it is better to use a 7 ft
//   rod for a 6 ft order than to cut a new rod, as long as the waste factor is under 18 in"):
//     rem = pieceLen − cutLen
//     rem ≥ 36"        use the piece; the remainder gets a NEW piece # and stays in the ledger
//     rem ≤ 18"        use the piece; the remainder is SCRAP (acceptable waste)
//     18" < rem < 36"  the DEAD ZONE — the remainder would be unusable AND the waste too big:
//                      do not use this piece, take another piece or a new rod
//   His two calibration examples, from a 96" piece: a 72" order leaves 24" → dead zone, cut a
//   new rod; an 80" order leaves 16" → use it, scrap the 16".
//
//   STANDING SWEEP: any piece under 36" is scrap, whenever it appears.
//   SCRAP → NETSUITE: feet, rounded UP (16" → 2 ft — conservative, never show feet we don't
//   have), posted as a negative acct-254 adjustment through the staged ns_outbox.
//   BRAND SCOPING: pieces belong to a brand; a recommendation only offers the order's brand.
//   MITER ORDERS: angled cuts must all come from ONE rod so the grain/section matches — the
//   planner treats a mitered multi-cut as one combined length against one source. Straight
//   (splice) cuts match independently.

export const MIN_USABLE_IN = 36;   // under this, a remainder is not a sellable piece
export const MAX_WASTE_IN = 18;    // over this, deliberately making scrap is not acceptable

export const PIECE_STATUS = { OFFCUT: 'OFFCUT', CONSUMED: 'CONSUMED', SCRAP: 'SCRAP' };

// Same normalization the bracket-span map uses (Shared/bracketSpan spanKey): case, punctuation
// and any finish suffix are ignored — a /P or /EP variant is the same physical tube.
export const rodCodeKey = (v) => String(v || '').trim().toUpperCase().split('/')[0].replace(/[^A-Z0-9]/g, '');

// Scope gate: "one set of rules/tools for anything marked rod, pole, etc." — driven off the
// item's classification, not a hand-picked list. Used to SUGGEST config rows; the operative
// gate for recommendations is a config row (a piece length must be declared to plan cuts).
export const isRodClassified = (part) => {
    const hay = [
        part?.manufacturingSpecs?.productType, part?.productType,
        ...(Array.isArray(part?.tags) ? part.tags : []),
    ].map(v => String(v || '').toUpperCase()).join(' ');
    return /(^|[^A-Z])(ROD|POLE|FASCIA)S?([^A-Z]|$)/.test(hay);
};

// ── CONFIG (system/rod_stock_config, edited on HQ 6.5) ───────────────────────────────────────
// { items: { [rodCodeKey]: { code, pieceLengthFt, homeBin? } } } — one row per stocked rod item.
export const configEntryFor = (code, config) => {
    const key = rodCodeKey(code);
    if (!key || !config || !config.items) return null;
    return config.items[key] || null;
};
export const pieceLengthInFor = (code, config) => {
    const e = configEntryFor(code, config);
    const ft = Number(e?.pieceLengthFt);
    return ft > 0 ? ft * 12 : null;
};

// ── THE WASTE RULE, PER CANDIDATE ────────────────────────────────────────────────────────────
// evaluateCut(96, 72) → DEAD; evaluateCut(96, 80) → SCRAP 16; evaluateCut(120, 72) → KEEP 48.
export function evaluateCut(pieceLenIn, cutIn) {
    const piece = Number(pieceLenIn) || 0, cut = Number(cutIn) || 0;
    if (!(cut > 0) || !(piece > 0) || cut > piece) return { action: 'NO_FIT', remainderIn: 0, scrapIn: 0 };
    const rem = round2(piece - cut);
    if (rem >= MIN_USABLE_IN) return { action: 'KEEP', remainderIn: rem, scrapIn: 0 };
    if (rem <= MAX_WASTE_IN) return { action: 'SCRAP', remainderIn: 0, scrapIn: rem };
    return { action: 'DEAD', remainderIn: rem, scrapIn: rem };
}
const round2 = (n) => Math.round(n * 100) / 100;

// Scrap feet for the NetSuite adjustment: rounded UP (Stuart 2026-08-27 — conservative, the
// count may only ever understate what's on the shelf). 16" → 2 ft; 12" → 1 ft; 0 stays 0.
export const scrapFeet = (inches) => {
    const n = Number(inches) || 0;
    return n > 0 ? Math.ceil(n / 12) : 0;
};

// ── RANKING ──────────────────────────────────────────────────────────────────────────────────
// "Prefer the piece that consumes best": least leftover ledger length first (a ≤18" full-consume
// leaves 0 and beats opening a big piece), least scrap as the tiebreak, oldest piece last so two
// equal candidates burn down FIFO. A NEW rod ranks after every usable piece ("always use the
// cuts when possible"); DEAD pieces are rejected, never offered.
export function rankCandidates({ cutIn, pieces = [], pieceLengthIn = null }) {
    const options = [];
    const rejected = [];
    for (const p of pieces) {
        if (p.status && p.status !== PIECE_STATUS.OFFCUT) continue;
        const ev = evaluateCut(p.lengthIn, cutIn);
        if (ev.action === 'KEEP' || ev.action === 'SCRAP') options.push({ source: 'PIECE', piece: p, ...ev });
        else rejected.push({ source: 'PIECE', piece: p, ...ev, reason: ev.action === 'DEAD' ? `would leave ${ev.remainderIn}" — unusable, and over the ${MAX_WASTE_IN}" waste cap` : 'too short' });
    }
    options.sort((a, b) =>
        (a.remainderIn - b.remainderIn) || (a.scrapIn - b.scrapIn) || ((a.piece.createdAt || 0) - (b.piece.createdAt || 0)));
    if (pieceLengthIn > 0) {
        const ev = evaluateCut(pieceLengthIn, cutIn);
        if (ev.action !== 'NO_FIT') {
            // A new rod's dead-zone remainder is unavoidable (there is no alternative source), and
            // the standing sweep makes anything under 36" scrap — so DEAD collapses to SCRAP here.
            const action = ev.action === 'DEAD' ? 'SCRAP' : ev.action;
            options.push({ source: 'NEW', ...ev, action, scrapIn: action === 'SCRAP' ? round2(pieceLengthIn - cutIn) : 0, remainderIn: action === 'KEEP' ? ev.remainderIn : 0 });
        }
    }
    return { options, rejected };
}

// ── THE PLAN, ACROSS A MULTI-CUT ORDER ───────────────────────────────────────────────────────
// cuts: [{ id, label, lengthIn }] — LEFT/CENTER/RIGHT segments, or N identical builds.
// miter: angled joints must match → ONE source for the combined length.
// Straight cuts match independently but SEQUENTIALLY: a remainder born of cut 1 is offered to
// cut 2 (two 40" cuts take one 96" piece: 96 → 56 → 16" scrap), longest cut planned first so
// the big cut never loses its only viable piece to a small one.
export function planCuts({ cuts = [], pieces = [], pieceLengthIn = null, miter = false }) {
    const valid = cuts.filter(c => Number(c.lengthIn) > 0);
    if (!valid.length) return { assignments: [], miterCombined: false, totalScrapIn: 0, newRods: 0 };

    if (miter && valid.length > 1) {
        const totalIn = round2(valid.reduce((s, c) => s + Number(c.lengthIn), 0));
        const one = planCuts({ cuts: [{ id: 'MITER', label: `mitered set (${valid.map(c => `${c.lengthIn}"`).join(' + ')})`, lengthIn: totalIn }], pieces, pieceLengthIn });
        return { ...one, miterCombined: true };
    }

    // Virtual pool: planning must see the ledger as it will be mid-order, without writing it.
    let pool = pieces.filter(p => !p.status || p.status === PIECE_STATUS.OFFCUT).map(p => ({ ...p }));
    const order = [...valid].sort((a, b) => Number(b.lengthIn) - Number(a.lengthIn));
    const byId = new Map();
    let totalScrapIn = 0, newRods = 0, virtualSeq = 0;

    for (const cut of order) {
        const { options, rejected } = rankCandidates({ cutIn: cut.lengthIn, pieces: pool, pieceLengthIn });
        const best = options[0] || null;
        byId.set(cut.id, { cut, choice: best, alternatives: options.slice(1), rejected });
        if (!best) continue;
        totalScrapIn += best.scrapIn || 0;
        if (best.source === 'NEW') {
            newRods += 1;
            if (best.action === 'KEEP') pool.push({ id: `~new-${++virtualSeq}`, virtual: true, lengthIn: best.remainderIn, createdAt: Number.MAX_SAFE_INTEGER });
        } else {
            pool = pool.filter(p => p.id !== best.piece.id);
            if (best.action === 'KEEP') pool.push({ id: `~rem-${best.piece.id}`, virtual: true, fromPieceId: best.piece.id, lengthIn: best.remainderIn, createdAt: Number.MAX_SAFE_INTEGER });
        }
    }
    return {
        assignments: valid.map(c => byId.get(c.id)),   // caller's order, not planning order
        miterCombined: false,
        totalScrapIn: round2(totalScrapIn),
        newRods,
    };
}

// ── STANDING SWEEP ───────────────────────────────────────────────────────────────────────────
export const sweepScrap = (pieces = []) =>
    pieces.filter(p => (!p.status || p.status === PIECE_STATUS.OFFCUT) && Number(p.lengthIn) < MIN_USABLE_IN);

// ── HONEST AVAILABILITY ──────────────────────────────────────────────────────────────────────
// "NS says 200 ft" → "≈9 full 20 ft rods + 12 offcuts, longest 84"". NS feet INCLUDE the offcut
// feet (offcuts are still sellable inventory; only scrap is adjusted out), so full-rod count =
// what's left after the ledger's offcuts are carved out of the aggregate.
export function honestAvailability({ nsFeet = null, pieces = [], pieceLengthIn = null }) {
    const offcuts = pieces.filter(p => !p.status || p.status === PIECE_STATUS.OFFCUT);
    const offcutIn = offcuts.reduce((s, p) => s + (Number(p.lengthIn) || 0), 0);
    const longestIn = offcuts.reduce((m, p) => Math.max(m, Number(p.lengthIn) || 0), 0);
    let fullPieces = null;
    if (nsFeet != null && pieceLengthIn > 0) {
        fullPieces = Math.max(0, Math.floor((Number(nsFeet) * 12 - offcutIn) / pieceLengthIn));
    }
    return { offcutCount: offcuts.length, offcutIn: round2(offcutIn), longestIn, fullPieces };
}

// ── PIECE IDENTITY ───────────────────────────────────────────────────────────────────────────
// Short, printable, Code-128-able. Time-ordered prefix so the ledger sorts by birth naturally.
export const newPieceId = () =>
    `P-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;

// ── THE SCRAP ADJUSTMENT (staged — Shared/nsOutbox enqueueNsWrite) ───────────────────────────
// Same proven REST shape + acct 254 as the WMS rod-cut flow; ONE negative line, so the mixed
// +/- bin rule can never bite. Bin detail only when the config declares a home bin — a rod item
// without bin tracking rejects inventoryDetail, one WITH it rejects its absence; the 11.1 sync
// queue surfaces either mistake with the full NetSuite error.
export function scrapAdjustmentPayload({ internalId, nsConfig, feet, memo, bin = null }) {
    const qty = -Math.abs(Number(feet) || 0);
    if (!internalId || !nsConfig || !qty) return null;
    return {
        targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/inventoryadjustment',
        method: 'POST',
        payload: {
            account: { id: '254' }, subsidiary: { id: nsConfig.subsidiary }, memo: memo || '',
            inventory: {
                items: [{
                    item: { id: String(internalId) }, location: { id: nsConfig.location }, adjustQtyBy: qty,
                    ...(bin ? { inventoryDetail: { quantity: qty, inventoryAssignment: { items: [{ binNumber: { refName: String(bin) }, quantity: qty }] } } } : {}),
                }],
            },
        },
    };
}
