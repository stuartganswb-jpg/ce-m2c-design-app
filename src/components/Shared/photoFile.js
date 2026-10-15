// ── A DROPPED PHOTO THE BROWSER CAN SHOW (S7, 2026-10-15) ─────────────────────────────────────────
//
// Stuart: "can you make the drop the photo add for the pillows and one of kinds work with .heic … they
// currently do not display". An iPhone shoots HEIC; Chrome cannot decode it (only Safari can), so a
// HEIC handed to <img> fails silently and the stored file never displays anywhere. The fix: a HEIC /
// HEIF is converted to JPEG IN THE BROWSER before anything reads or uploads it (libheif as WebAssembly,
// the `heic2any` package, loaded lazily as its own chunk the first time one is dropped — ~2.7 MB that
// nobody pays for until then). Anything else passes through untouched.
//
//   photoFileOf(file)        → the file to resize / upload (a JPEG Blob named *.jpg when it was HEIC)
//   readPhotoAsDataUrl(file) → a data URL an <img> can show
//   isHeicFile(file)         → by type or extension (iOS often reports an empty type)

const HEIC_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
export const isHeicFile = (file) => {
    if (!file) return false;
    const type = String(file.type || '').toLowerCase();
    if (HEIC_TYPES.includes(type)) return true;
    return /\.(heic|heif)$/i.test(String(file.name || ''));
};

/** The JPEG (quality 0.92) for a HEIC / HEIF; any other file as it is. Throws when the decoder refuses it. */
export async function photoFileOf(file, { quality = 0.92 } = {}) {
    if (!isHeicFile(file)) return file;
    const mod = await import(/* webpackChunkName: "heic" */ 'heic2any');
    const heic2any = mod.default || mod;
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality });
    const blob = Array.isArray(out) ? out[0] : out;
    const name = String(file.name || 'photo').replace(/\.(heic|heif)$/i, '') + '.jpg';
    try { return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified || Date.now() }); }
    catch (e) { blob.name = name; return blob; }   // an environment without File: the blob, named
}

export const readFileAsDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = rej; r.readAsDataURL(file); });

/** A data URL an <img> can show — a HEIC is converted first. */
export async function readPhotoAsDataUrl(file) {
    const f = await photoFileOf(file);
    return readFileAsDataUrl(f);
}

/** The accept list for a photo input: the browser's images plus the HEIC names iOS uses. */
export const PHOTO_ACCEPT = 'image/*,.heic,.heif';
