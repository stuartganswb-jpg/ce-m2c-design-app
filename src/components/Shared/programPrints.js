// Central, HIDDEN store for CNC program prints (drawings/PDFs).
//
// Stored in its OWN collection `program_prints` — deliberately NOT in
// `global_assets`, so prints never clutter the Asset Gallery. One doc per
// program NAME under a deterministic id `PRINT-{SAFENAME}`, so re-uploading
// the same program name overwrites instead of duplicating.
//
// A "Print" button anywhere resolves by program name: Shop Floor (verification,
// scheduler, machine cards), the Programs tab, routing op rows, and master
// library items. Upload happens on the 14.5 Batch Processor.
//
// Matching is by `name` (uppercased + trimmed via printKey) — keep printKey
// identical on write and lookup or matches silently fail.
import { collection, onSnapshot, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export const PRINTS_COLLECTION = "program_prints";

// Canonical name key. MUST be identical on write and lookup.
export const printKey = (name) => String(name || "").toUpperCase().trim();

// Filesystem/id-safe form of the key (non-alphanumeric -> "_"), mirroring
// ShopEngineering `cleanId`.
export const printSafe = (name) => printKey(name).replace(/[^A-Z0-9]/g, "_");

// Deterministic doc id so the same program name always lands on one doc.
export const printDocId = (name) => `PRINT-${printSafe(name)}`;

// Subscribe to every program print -> Map(printKey(name) -> doc). Returns unsub.
export const subscribeProgramPrints = (db, cb) => {
    try {
        return onSnapshot(
            collection(db, PRINTS_COLLECTION),
            (snap) => {
                const map = new Map();
                (snap?.docs || []).forEach((d) => {
                    const a = { id: d.id, ...(d.data() || {}) };
                    const k = printKey(a.name);
                    if (k) map.set(k, a);
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
        const snap = await getDoc(doc(db, PRINTS_COLLECTION, printDocId(name)));
        return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch (e) {
        return null;
    }
};

// Does a print already exist for this program name? (overwrite-warn before upload)
export const programPrintExists = async (db, name) => {
    try {
        const snap = await getDoc(doc(db, PRINTS_COLLECTION, printDocId(name)));
        return snap.exists();
    } catch (e) {
        return false;
    }
};

// Upload a file (PDF/image Blob) to Storage and write the print doc. Returns the doc id.
export const uploadProgramPrint = async (db, storage, { name, file, fileType, uploadedBy, brandId, source }) => {
    const key = printKey(name);
    const safe = printSafe(name);
    const ext = fileType === "pdf" ? "pdf" : (file?.type === "application/pdf" ? "pdf" : (file?.type?.split("/")?.[1] || "bin"));
    const fileRef = ref(storage, `${PRINTS_COLLECTION}/${safe}.${ext}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    return saveProgramPrint(db, { name: key, url, fileType: ext === "pdf" ? "pdf" : "image", uploadedBy, brandId, source });
};

// Write/overwrite the print doc for an already-hosted url (used by the program
// editor's dual-write, where the drawing is already in Storage). Returns doc id.
export const saveProgramPrint = async (db, { name, url, fileType, uploadedBy, brandId, source }) => {
    const id = printDocId(name);
    await setDoc(
        doc(db, PRINTS_COLLECTION, id),
        {
            id,
            name: printKey(name),
            originalUrl: url,
            fileType: fileType || "pdf",
            ...(brandId ? { brandId } : {}),
            ...(source ? { source } : {}),
            uploadedBy: uploadedBy || "Unknown",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        },
        { merge: true }
    );
    return id;
};

// Resolve an openable url from a prefetched map, falling back to a legacy
// `shop_programs.drawingUrl` during/after migration. Returns a url or null.
export const resolvePrintUrl = (printMap, name, legacyUrl) => {
    const hit = printMap && typeof printMap.get === "function" ? printMap.get(printKey(name)) : null;
    return (hit && (hit.originalUrl || hit.url)) || legacyUrl || null;
};

// Try several candidate names (e.g. a library item's part number, item name,
// program number) against the map; first match wins. For master-library items
// where the exact print key isn't known up front.
export const resolvePrintUrlAny = (printMap, names, legacyUrl) => {
    for (const n of (names || [])) {
        if (!n) continue;
        const url = resolvePrintUrl(printMap, n, null);
        if (url) return url;
    }
    return legacyUrl || null;
};
