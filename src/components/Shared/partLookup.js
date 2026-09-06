// PART LOOKUP — read a part number, ours or theirs, and say what it is and where it lives.
//
// Stuart 2026-09-03: "enter in customer's part #'s and it returns with ours and the description and
// the flow … then when we get to the bracket step we could enter up the bracket there and it would
// return the projection (in description and tag) … it does not actually enter any data, on display
// it to help the cpq decisions."
//
// ⚠ THIS MODULE DECIDES NOTHING. It is a VIEW over answers that already have owners:
//   • what a part is admissible for  → admits() in hardwareModel — "ONE function decides whether a
//     choice is admissible. Everything that filters anywhere in the app must come through here, so
//     there can never again be two answers to the same question."
//   • what the customer calls a part → aliasFor() in hardwarePricing (their negotiated clientSku,
//     falling back to the resolved pattern #).
// A lookup that re-derived either would be a second source of truth about what a part IS, which is
// precisely the failure this codebase keeps paying for. Everything below reads; nothing rules.
//
// ⚠ THE TAGS ARE ON THE PIN, NOT THE PART. A projection, a setup, a tier are properties of the pin
// that places a part in an assembly — the same item number can be pinned into two assemblies at two
// depths. So the index is over CHOICES (assembly + pin), not over library docs, and one part can
// legitimately return several rows. That is not duplication; it is the truth being reported.

import { admits, contextOf, normalizeChoice, applyFitsDefaults, ROD_ROLES } from './hardwareModel.js';
import { choicesFromAssembly } from './hardwareAdapter.js';
import { aliasFor } from './hardwarePricing.js';

const U = (v) => String(v ?? '').trim().toUpperCase();
const clean = (v) => String(v ?? '').trim();

// ⚠ NORMALISE EXACTLY AS resolve() DOES, OR THE PANEL IS READING DIFFERENT TAGS FROM THE ENGINE.
// choicesFromAssembly returns RAW pins — `proj: '3-5/8'`, no `projs`, no fits defaults — and
// resolve() is what turns those into the shape admits() reads. The first run of the harness caught
// this: every part reported "no projection tag" and contextOf() threw, because the lookup was
// judging un-normalised choices. One expression, copied from resolve(), keeps the two identical.
// Callers differ: the configurator holds RAW pins (it normalises inside resolve()), while rows out
// of this module already carry normalised choices. Normalising a normalised choice would DESTROY it
// — normalizeChoice reads `proj`, which no longer exists once it has become `projs` — so the guard
// is idempotent by construction. The harness caught this too: every verdict silently flipped to
// "selectable" because the projection had been normalised away.
const isNormalized = (c) => Array.isArray(c?.projs) && typeof c?.fitsExplicit === 'boolean';
const normalized = (choices = []) => applyFitsDefaults(
    (choices || []).map(c => (isNormalized(c) ? c : normalizeChoice(c))).filter(c => c && c.role));

/** The code we know a part by. Mirrors what the pickers and the pricing chain print. */
export const ourCodeOf = (part) => clean(part?.legacyErpId || part?.itemId || part?.id || '');

/**
 * One searchable row: a part as it is pinned into one assembly, behind one flow.
 *
 * `theirs` is resolved through aliasFor so it can never disagree with the code the option cards
 * show — the picker and this panel read the identical function.
 */
function rowOf({ choice, part, flow, aliasCtx }) {
    const ours = ourCodeOf(part) || clean(choice.partId);
    return {
        key: `${flow?.id || ''}::${choice.id}`,
        flowId: flow?.id || '',
        flowName: clean(flow?.name),
        flowGroup: clean(flow?.sizeGroupLabel),
        flowChoice: clean(flow?.sizeGroupChoice),
        choice,
        part: part || null,
        ours,
        theirs: part ? clean(aliasFor(part, aliasCtx)) : '',
        name: clean(choice.name || part?.itemName || ours),
        role: clean(choice.role),
        // The decision tags, exactly as the gate will read them. Blank means "untagged", which is a
        // real and different answer from "tagged and mismatched" — the panel prints it as such.
        tags: {
            projs: Array.isArray(choice.projs) ? choice.projs : [],
            projTiers: choice.projTiers || null,
            setup: clean(choice.setup),
            mount: clean(choice.mount),
            position: clean(choice.position),
            tier: clean(choice.tier),
            passing: clean(choice.passing),
            drive: clean(choice.drive),
            rodKind: clean(choice.rodKind),
            fits: Array.isArray(choice.fits) ? choice.fits : [],
            fitsExplicit: !!choice.fitsExplicit,
        },
        hidden: !!choice.hidden,
        // The BOOLEAN tags, which decide as much as the measured ones and were invisible here until
        // Stuart asked for them (2026-09-06) — auditing them meant opening 1.6 one pin at a time.
        flags: {
            noBackplate: !!choice.noBackplate,
            isReturnArm: !!choice.isReturnArm,
            isBasic: !!choice.isBasic,
            inlineOnly: !!choice.inlineOnly,
            returnOnly: !!choice.returnOnly,
        },
    };
}

/**
 * The boolean tags a row carries, as short labels — only the ones that are SET.
 *
 * An unset boolean is the normal case and says nothing; printing "no plate: no" on every row would
 * bury the handful that matter. The measured tags in tagLinesOf() are the opposite — there, absence
 * IS the news, which is why an untagged projection is spelled out and these are not.
 */
export function flagLinesOf(row) {
    const f = row?.flags || {};
    const out = [];
    if (f.isReturnArm) out.push({ key: 'endArm', label: 'END-ARM' });
    if (f.noBackplate) out.push({ key: 'noPlate', label: 'NO PLATE' });
    if (f.isBasic) out.push({ key: 'basic', label: 'BASIC' });
    if (f.inlineOnly) out.push({ key: 'inl', label: 'INL-BKT' });
    if (f.returnOnly) out.push({ key: 'rtn', label: 'RTN-ONLY' });
    // The pair that changes what the engine DOES, called out rather than left to be spotted.
    if (f.isReturnArm && f.noBackplate) out.push({ key: 'decorative', label: 'DECORATIVE · KEEPS ITS BRACKET', hot: true });
    return out;
}

/**
 * Build the searchable index from assemblies whose pins have already been fetched.
 *
 * Pure on purpose: the caller owns the Firestore reads (and their caching), so this stays testable
 * offline and cannot fire a query from inside a render.
 *
 * @param flows        cpq_flows docs
 * @param assemblyFor  (flow) => the assembly doc its linkedAssemblyId resolves to, or null
 * @param pinsFor      (assembly) => that assembly's assembly_pins, or []
 * @param findPart     (partId) => library doc
 * @param aliasCtx     { customerId, customer, outsourceCodes, findByCode } — aliasFor's context
 */
export function buildLookupIndex({ flows = [], assemblyFor, pinsFor, findPart, aliasCtx = {} } = {}) {
    const rows = [];
    (flows || []).forEach(flow => {
        const assembly = typeof assemblyFor === 'function' ? assemblyFor(flow) : null;
        if (!assembly) return;
        const pins = (typeof pinsFor === 'function' ? pinsFor(assembly) : []) || [];
        if (!pins.length) return;
        let choices = [];
        try {
            choices = normalized(choicesFromAssembly(assembly, pins));
        } catch {
            return;                                  // a malformed assembly is the diagnostics' problem
        }
        choices.forEach(choice => {
            const part = typeof findPart === 'function' ? findPart(choice.partId) : null;
            rows.push(rowOf({ choice, part, flow, aliasCtx }));
        });
    });
    return rows;
}

/** Index rows for a single already-loaded assembly — the step-level panel, where a flow is open. */
export function indexForAssembly({ assembly, pins = [], flow = null, findPart, aliasCtx = {} } = {}) {
    if (!assembly || !pins.length) return [];
    let choices = [];
    try {
        choices = normalized(choicesFromAssembly(assembly, pins));
    } catch {
        return [];
    }
    return choices.map(choice => rowOf({
        choice,
        part: typeof findPart === 'function' ? findPart(choice.partId) : null,
        flow,
        aliasCtx,
    }));
}

/**
 * Match a typed term against every identity a row answers to.
 *
 * Exact code matches rank above substring, and a customer-code hit above one of ours — someone
 * typing H3553F is reading it off THEIR paperwork and wants that row first. Punctuation is ignored
 * on codes only (H1-75ILE / H175ILE / h1 75 ile all reach the same part); descriptions match as
 * plain text so "bracket" still behaves like a word search.
 */
const codeKey = (v) => U(v).replace(/[^A-Z0-9]/g, '');

export function searchLookup(term, index = [], { limit = 24 } = {}) {
    const raw = clean(term);
    if (raw.length < 2) return [];
    const q = codeKey(raw);
    const qText = U(raw);
    const scored = [];
    (index || []).forEach(row => {
        const ours = codeKey(row.ours);
        const theirs = codeKey(row.theirs);
        let score = 0;
        if (theirs && theirs === q) score = 100;
        else if (ours && ours === q) score = 90;
        else if (theirs && q && theirs.startsWith(q)) score = 70;
        else if (ours && q && ours.startsWith(q)) score = 60;
        else if (theirs && q && theirs.includes(q)) score = 45;
        else if (ours && q && ours.includes(q)) score = 40;
        else if (U(row.name).includes(qText)) score = 20;
        if (!score) return;
        scored.push({ ...row, score });
    });
    // Same part, same tags, offered by several flows → one row per flow is the useful answer when
    // the question is "which flow", so they are kept and ordered, not merged.
    scored.sort((a, b) => b.score - a.score
        || a.ours.localeCompare(b.ours)
        || a.flowName.localeCompare(b.flowName));
    return scored.slice(0, limit);
}

/**
 * Would this row be offered right now? Only meaningful once a flow is open and answered.
 *
 * Delegates to admits() with the live context so the sentence the panel prints is the SAME sentence
 * "why not the other N?" prints — one rule, one wording, one place to fix it.
 *
 * Returns null when there is nothing to judge against, which the panel renders as "no flow open"
 * rather than as a pass. A silent pass would be the worst possible answer here.
 */
export function verdictFor(row, { choices = [], answers = {} } = {}) {
    if (!row?.choice || !choices.length) return null;
    // The caller hands us whatever it has — the configurator's own `choices` are raw pins, since it
    // normalises inside resolve(). Normalising here means the context is built from the same shape
    // the engine builds it from, whoever calls.
    const ctx = contextOf(normalized(choices), answers);
    // A slot's own position is part of the question; the row carries the pin's, so it is honoured
    // where the pin has one and left to the context otherwise.
    const withPos = row.choice.position ? { ...ctx, position: row.choice.position } : ctx;
    try {
        return admits(row.choice, withPos);
    } catch {
        return null;
    }
}

/**
 * The tags a reader needs, as short "label: value" pairs, in the order they decide things.
 *
 * Projection leads because it is the tag that silently removes parts — and the one most often
 * wrong. An untagged axis is reported as "any" rather than omitted: "this part is tagged 3.625"" and
 * "this part carries no projection tag" are different facts, and only one of them is a defect.
 */
export function tagLinesOf(row) {
    if (!row?.tags) return [];
    const t = row.tags;
    const out = [];
    if (t.projTiers) {
        out.push({ label: 'projection', value: Object.entries(t.projTiers).map(([k, v]) => `${k} ${v}"`).join(' · '), key: 'proj' });
    } else if (t.projs.length) {
        out.push({ label: 'projection', value: t.projs.map(p => `${p}"`).join(', '), key: 'proj' });
    } else if (!ROD_ROLES.includes(row.role)) {
        // A rod genuinely has no projection — the arm holding it does — so its absence is not news.
        out.push({ label: 'projection', value: 'any (untagged)', key: 'proj', untagged: true });
    }
    if (t.setup) out.push({ label: 'setup', value: t.setup, key: 'setup' });
    if (t.drive) out.push({ label: 'drive', value: t.drive, key: 'drive' });
    if (t.mount) out.push({ label: 'mount', value: t.mount, key: 'mount' });
    if (t.position) out.push({ label: 'position', value: t.position, key: 'position' });
    if (t.tier) out.push({ label: 'tier', value: t.tier, key: 'tier' });
    if (t.passing) out.push({ label: 'passing', value: t.passing, key: 'passing' });
    if (t.rodKind) out.push({ label: 'rod type', value: t.rodKind, key: 'rodKind' });
    if (t.fitsExplicit && t.fits.length) out.push({ label: 'fits', value: t.fits.join('/'), key: 'fits' });
    return out;
}
