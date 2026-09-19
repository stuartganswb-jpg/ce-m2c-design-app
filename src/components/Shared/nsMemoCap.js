// ── A BIN TRANSFER'S MEMO HOLDS 40 CHARACTERS (Eric, App Imp 2026-09-19 — PO2128's bin move) ─────────
// "The field memo contained more than the maximum number ( 40 ) of characters allowed." Receipts and
// adjustments take 120+, a binTransfer takes 40 — and the marker below is 37 on its own, so EVERY bin
// transfer sent through this queue was refused (the daily ones post direct, untagged, which is why
// nobody had met it). The part of the marker the worker's crash recovery looks up is `#<6-char id>]`
// (functions/index.js recoverByMarker — keep in sync), so a capped record carries just `[#id]` and the
// caller's words are cut to fit in front of it.
export const memoCapFor = (targetUrl) => (/\/record\/v1\/bintransfer(\/|$|\?)/i.test(String(targetUrl || '')) ? 40 : 0);
export const cappedMemo = (memo, refId, cap) => {
    const tag = `[#${String(refId || '').slice(0, 6)}]`;
    const text = String(memo == null ? '' : memo).replace(/\s+/g, ' ').trim();
    const room = cap - tag.length - 1;
    if (!text || room < 2) return tag;
    return `${text.length <= room ? text : `${text.slice(0, room - 1).trimEnd()}…`} ${tag}`;
};
