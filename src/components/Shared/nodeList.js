// NODE-LIST DELIMITING (Brimar 2026-08-10, found by the render-map audit on its first live run):
// geometry maps carry node lists as comma-joined strings, and Brimar's screw nodes are named
// after the McMaster label — `MMC92311A189_or_MMC91375A189_8-32,_316_L_v4004` — WITH A COMMA IN
// THE NAME. Splitting shredded them into 53 meaningless fragments: the screws' HIDE flag matched
// nothing (they rendered), and every list sharing the format was one comma away from the same.
//
// The fix is a delimiter migration with full backward compatibility, in one place:
//   joinNodes  — writers (the generators) now join with ' | '. '|' is rejected by nothing in the
//                GLB pipeline and appears in no node name (Fusion forbids it in component names).
//   splitNodes — readers accept BOTH formats: a list containing '|' splits on it (commas inside
//                names survive whole); a legacy list without '|' splits on ',' exactly as before,
//                so every stored flow keeps working unregenerated.
//
// ⚠ MIRROR: portal/src/shared/nodeList.js is a byte-identical copy (the portal render mirrors
// consume the same flow docs). Change both.

export const joinNodes = (arr) => {
    const parts = (arr || []).map(s => String(s || '').trim()).filter(Boolean);
    // A SINGLE comma-bearing name carries no pipe to mark the new format — emit it as an exact
    // key ('=' escape) so the reader can never mistake it for a legacy two-name CSV.
    if (parts.length === 1 && parts[0].includes(',')) return exactNode(parts[0]);
    return parts.join(' | ');
};

// EXACT-KEY escape: a list string starting '=' is ONE literal node name, never split — the
// runtime builders use it for single-node keys (flow.hiddenNodes entries) so a legacy comma-name
// like the McMaster screw hides correctly WITHOUT the flow being regenerated.
export const exactNode = (name) => `=${String(name || '').trim()}`;

export const splitNodes = (str) => {
    const s = String(str || '');
    if (!s.trim()) return [];
    if (s.startsWith('=')) return [s.slice(1).trim()].filter(Boolean);
    return s.split(s.includes('|') ? '|' : ',').map(t => t.trim()).filter(Boolean);
};

// Lowercased variant for the render matchers (they compare case-insensitively).
export const splitNodesLower = (str) => splitNodes(str).map(t => t.toLowerCase());
