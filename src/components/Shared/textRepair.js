// 🔤 Mojibake repair — UTF-8 text that was mis-decoded as Windows-1252 and saved
// (e.g. '1″' stored as '1â€³'; first seen in the 2026-07 H2 CSV import via Mass Update,
// where Excel had already baked the damage into the file itself).
//
// Reversal: re-encode the string as cp1252 bytes, then STRICT-decode as UTF-8. Only genuine
// mojibake survives that round-trip changed — clean text (including a real ″) either isn't
// cp1252-encodable or fails the strict decode, and comes back untouched. Up to 3 passes
// unwinds double-encoded text. Pure-ASCII strings round-trip to themselves (no-op).
//
// Used by: Master Library "🔤 Fix garbled text" (repairs stored docs + CPQ flow labels)
// and the Mass Update CSV import (repairs incoming rows so bad files self-clean).
const CP1252_REV = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F };

export const fixMojibake = (s) => {
    if (typeof s !== 'string' || !s) return s;
    let out = s;
    for (let pass = 0; pass < 3; pass++) {
        const bytes = [];
        let encodable = true;
        for (const ch of out) {
            const c = ch.codePointAt(0);
            if (c <= 0xFF && !(c >= 0x80 && c <= 0x9F)) bytes.push(c);
            else if (CP1252_REV[ch] !== undefined) bytes.push(CP1252_REV[ch]);
            else { encodable = false; break; }
        }
        if (!encodable) break;
        try {
            const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
            if (decoded === out) break;
            out = decoded;
        } catch { break; }
    }
    return out;
};
