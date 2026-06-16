// Combined-product photography store: a single photo that shows TWO configured
// pieces together (e.g. a bracket + its wallplate/backplate, each at a finish).
//
// Lives in its OWN hidden collection `combo_images` (like program_prints — easily
// pulled, never clutters the Asset Gallery). Recorded by naming the file with the
// two pieces, e.g.  H1-138BP-H/EP1_H1-138DE/EP1  (token = PATTERN/FINISH, joined by "_").
//
// Keyed by a CANONICAL key: each piece normalized to PATTERN/FINISH, the two sorted
// so order doesn't matter, joined by "_". Finish de-pads EP codes (EP01 == EP1) to
// match the gallery's convention (BatchImageProcessor). At CPQ checkout we build the
// same key from the selected bracket + sub-option and pull the matching photo.
import { collection, onSnapshot, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export const COMBO_COLLECTION = "combo_images";

const normPattern = (s) => String(s || "").toUpperCase().trim();
// EP01 -> EP1 (gallery convention); P##/S## stay zero-padded.
const normFinish = (s) => String(s || "").toUpperCase().trim().replace(/^EP0+(\d+)$/, "EP$1");

// "H1-138BP-H/EP1" -> { pattern, finish }; null if it isn't a PATTERN/FINISH token.
export const parsePiece = (token) => {
    const t = String(token || "").trim();
    const i = t.indexOf("/");
    if (i < 0) return null;
    const pattern = normPattern(t.slice(0, i));
    const finish = normFinish(t.slice(i + 1));
    return (pattern && finish) ? { pattern, finish } : null;
};

export const pieceKey = (p) => (p ? `${normPattern(p.pattern)}/${normFinish(p.finish)}` : "");

// Canonical, order-independent key for a pair of pieces.
export const comboKey = (a, b) => [pieceKey(a), pieceKey(b)].sort().join("_");

export const comboDocId = (key) => `COMBO-${String(key || "").replace(/[^A-Z0-9]/gi, "_")}`;

// Parse a combo FILENAME (extension stripped) "A/F_B/F" -> { pieces:[a,b], key } or null.
// Assumes patterns don't contain "_" (they use "-"); the single "_" separates the two pieces.
export const parseComboName = (name) => {
    const base = String(name || "").replace(/\.[^.]+$/, "").trim();
    const parts = base.split("_");
    if (parts.length !== 2) return null;
    const a = parsePiece(parts[0]);
    const b = parsePiece(parts[1]);
    if (!a || !b) return null;
    return { pieces: [a, b], key: comboKey(a, b) };
};

// Subscribe to every combo image -> Map(canonicalKey -> doc). Returns unsub.
export const subscribeComboImages = (db, cb) => {
    try {
        return onSnapshot(collection(db, COMBO_COLLECTION), (snap) => {
            const map = new Map();
            (snap?.docs || []).forEach((d) => {
                const a = { id: d.id, ...(d.data() || {}) };
                if (a.key) map.set(a.key, a);
            });
            cb(map);
        }, () => cb(new Map()));
    } catch (e) {
        cb(new Map());
        return () => {};
    }
};

export const comboImageExists = async (db, key) => {
    try {
        const s = await getDoc(doc(db, COMBO_COLLECTION, comboDocId(key)));
        return s.exists();
    } catch (e) { return false; }
};

// Upload one combined photo (image Blob/File) + write its doc. Returns the doc id.
export const uploadComboImage = async (db, storage, { pieces, key, file, uploadedBy }) => {
    const id = comboDocId(key);
    const ext = (file?.name && file.name.includes(".")) ? file.name.split(".").pop().toLowerCase() : (file?.type?.split("/")?.[1] || "jpg");
    const fileRef = ref(storage, `${COMBO_COLLECTION}/${id}.${ext}`);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);
    await setDoc(doc(db, COMBO_COLLECTION, id), {
        id, key, pieces, originalUrl: url, fileType: "image",
        uploadedBy: uploadedBy || "Unknown", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }, { merge: true });
    return id;
};

// Given the configured pieces [{pattern,finish}...], return matched combo docs
// (a combo matches when BOTH of its pieces are present in the configuration).
export const matchCombosForPieces = (comboMap, pieces) => {
    if (!comboMap || typeof comboMap.forEach !== "function" || !Array.isArray(pieces) || !pieces.length) return [];
    const present = new Set(pieces.map(pieceKey).filter(Boolean));
    const out = [];
    comboMap.forEach((asset) => {
        const cps = asset.pieces || [];
        if (cps.length === 2 && present.has(pieceKey(cps[0])) && present.has(pieceKey(cps[1]))) out.push(asset);
    });
    return out;
};
