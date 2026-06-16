// Central store for CNC program prints (drawings/PDFs), living inside `global_assets`.
//
// One asset per program NAME, written under a DETERMINISTIC doc id so a re-upload
// of the same program name overwrites instead of duplicating. A "Print" button
// anywhere resolves by that name — Shop Floor verification, scheduler, machine
// cards, the Programs tab, and routing op rows.
//
// Matching is by `name` (uppercased + trimmed) — the id sanitizer only governs
// the overwrite-dedupe id. Keep `printKey` identical on write and lookup or
// matches silently fail.
import { collection, query, where, onSnapshot, doc, getDoc } from "firebase/firestore";

export const PRINT_CATEGORY = "PROGRAM_PRINT";

// Canonical name key. MUST be identical on write and lookup.
export const printKey = (name) => String(name || "").toUpperCase().trim();

// Deterministic doc id. Mirrors ShopEngineering `cleanId` (non-alphanumeric -> "_"),
// applied to the uppercased key, so the same program name always lands on one doc.
export const printDocId = (name) => `PRINT-${printKey(name).replace(/[^A-Z0-9]/g, "_")}`;

// Subscribe to every program print -> Map(printKey(name) -> asset). Returns the
// unsubscribe fn. Single-field equality query, so no composite index is needed,
// and legacy assets without a `category` field are naturally excluded.
export const subscribeProgramPrints = (db, cb) => {
    try {
        const q = query(collection(db, "global_assets"), where("category", "==", PRINT_CATEGORY));
        return onSnapshot(
            q,
            (snap) => {
                const map = new Map();
                (snap?.docs || []).forEach((d) => {
                    const a = { id: d.id, ...(d.data() || {}) };
                    const k = printKey(a.name);
                    if (!k) return;
                    const prev = map.get(k);
                    // Deterministic id should prevent dups; keep newest if any slip through.
                    if (!prev || (a.createdAt?.toMillis?.() || 0) >= (prev.createdAt?.toMillis?.() || 0)) map.set(k, a);
                });
                cb(map);
            },
            () => cb(new Map())
        );
    } catch (e) {
        cb(new Map());
        return () => {};
    }
};

// One-shot resolve by deterministic id, for call sites that don't hold the map.
export const fetchProgramPrint = async (db, name) => {
    try {
        const snap = await getDoc(doc(db, "global_assets", printDocId(name)));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch (e) {
        return null;
    }
};

// Resolve an openable url from a prefetched map, falling back to a legacy
// `shop_programs.drawingUrl` during/after migration. Returns a url or null.
export const resolvePrintUrl = (printMap, name, legacyUrl) => {
    const hit = printMap && typeof printMap.get === "function" ? printMap.get(printKey(name)) : null;
    return (hit && (hit.originalUrl || hit.url)) || legacyUrl || null;
};
