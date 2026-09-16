// ── IS THIS SAVED LINE STILL WHAT THE ENGINE BUILDS? (S1, Stuart 2026-09-15) ──────────────────
//
// Four quotes saved on 2026-09-10 between 14:39 and 16:34 were approved on 09-14. The engine had
// changed twice that evening (a hidden part rides only with a return, 17:29; parked geometry never
// rides, 18:17) and the standoff pins were re-tagged afterwards — but Approve does not run the
// engine; it transforms the estimate and splits the SAVED breakdown. So SO60429 and SO60430 reached
// the pick and NetSuite with standoffs a wood-pole order never needed, and SO60431 carried eighteen
// placeholder codes on its work order. Saving in CPQ is sending; a line is what it was when saved.
//
// This module lets Approve SAY SO before the sales order exists. A line is stamped at handoff with
// two facts about what built it — the engine's version (Shared/engineVersion, the hash of the engine
// source, regenerated on every build) and a fingerprint of the assembly's pins (the tags the engine
// read). Approve recomputes both and compares. No re-resolution, no second opinion about the BOM:
// the answer is "the engine or the tags changed since this was saved — reopen and re-save", and
// the re-save (a new estimate) is the correction, exactly as it always was.
//
// Pure: no Firestore, no React. The CRM passes what it fetched.

/** Deterministic JSON — keys sorted at every level, so the same pin hashes the same twice. */
export function stableJson(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
}

/** FNV-1a, two seeds, 16 hex chars — browser-safe, no crypto import. */
export function hashText(s) {
    const str = String(s || '');
    let a = 0x811c9dc5, b = 0x9747b28c;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        a ^= c; a = Math.imul(a, 0x01000193) >>> 0;
        b ^= c; b = Math.imul(b, 0x01000193) >>> 0;
    }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/**
 * The fingerprint of an assembly's pins as the engine reads them: every pin, every field, sorted by
 * id. A tag fixed in 1.6 after a save changes it — which is the point.
 * '' when there are no pins (nothing to compare against; the caller treats it as unverifiable).
 */
export function pinsFingerprint(pins = []) {
    const list = (Array.isArray(pins) ? pins : []).filter(p => p && typeof p === 'object');
    if (!list.length) return '';
    const sorted = list.slice().sort((x, y) => String(x.id || '').localeCompare(String(y.id || '')));
    return hashText(sorted.map(stableJson).join('\n'));
}

export const STALE = 'STALE';            // stamped, and the engine or the tags have changed since
export const CURRENT = 'CURRENT';        // stamped, nothing changed
export const UNSTAMPED = 'UNSTAMPED';    // saved before the stamp existed — cannot be verified
export const NOT_ENGINE = 'NOT_ENGINE';  // an old-engine line; not this check's business

/**
 * One saved cart line against what runs now.
 * @param {object} item             a saved cart item (engine 'TAGS' carries engineVersion + pinsFingerprint)
 * @param {object} now              { engineVersion, pinsFingerprint } — the current engine, the current pins of
 *                                  item.assemblyId ('' / undefined = the pins could not be read → not judged)
 */
export function lineStaleness(item, now = {}) {
    if (!item || item.engine !== 'TAGS') return { status: NOT_ENGINE, reasons: [] };
    const savedEngine = String(item.engineVersion || '');
    const savedPins = String(item.pinsFingerprint || '');
    if (!savedEngine) return { status: UNSTAMPED, reasons: ['saved before the engine stamp existed'] };
    const reasons = [];
    if (now.engineVersion && savedEngine !== String(now.engineVersion)) reasons.push(`engine changed (${savedEngine} → ${now.engineVersion})`);
    if (savedPins && now.pinsFingerprint && savedPins !== String(now.pinsFingerprint)) reasons.push('the assembly\'s tags changed in 1.6');
    return { status: reasons.length ? STALE : CURRENT, reasons };
}

/**
 * The lines of a job that Approve must warn about: STALE and UNSTAMPED, with their index and name.
 * @param {object[]} cartItems
 * @param {object} ctx  { engineVersion, pinsByAssembly: { [assemblyId]: pins[] } }
 */
export function staleLinesOf(cartItems = [], { engineVersion = '', pinsByAssembly = {} } = {}) {
    const out = [];
    (Array.isArray(cartItems) ? cartItems : []).forEach((item, index) => {
        const pins = pinsByAssembly && item && item.assemblyId ? pinsByAssembly[item.assemblyId] : null;
        const r = lineStaleness(item, { engineVersion, pinsFingerprint: pins ? pinsFingerprint(pins) : '' });
        if (r.status === STALE || r.status === UNSTAMPED) out.push({ index, name: (item && (item.assemblyName || item.assemblyId)) || `line ${index + 1}`, ...r });
    });
    return out;
}

/** The confirm text Approve shows. Plain words: what is wrong, what to do, and that going on is a choice. */
export function staleApprovalText(stale = [], { quoteNo = '' } = {}) {
    if (!stale.length) return '';
    const rows = stale.map(s => `  · line ${s.index + 1} ${s.name}: ${s.status === UNSTAMPED ? s.reasons[0] : s.reasons.join('; ')}`).join('\n');
    return `⚠ ${quoteNo ? quoteNo + ': ' : ''}${stale.length} line${stale.length === 1 ? '' : 's'} may no longer match what the engine builds today.\n\n${rows}\n\n`
        + `The sales order, the work order, the pick and NetSuite all take the breakdown AS SAVED. `
        + `Cancel, reopen this quote in CPQ and re-save it (a new estimate), then approve.\n\n`
        + `Approve anyway with the saved lines?`;
}
