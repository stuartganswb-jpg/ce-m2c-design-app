// ── A LIVE LIST THAT SAYS WHETHER IT IS LIVE (Stuart 2026-10-21) ─────────────────────────────────────────────────
// The wallboards sit on a monitor for hours. A Firestore listener that fails with an error (a token it could not
// refresh, a permission refused) does not come back on its own — and the screen keeps its last numbers while its clock
// keeps ticking, so a frozen board looks exactly like a live one. (10-21 it was not that — WO11718's bake had been punched
// out — but nothing on the screen could have told the floor which.) So the floor's and the WMS's order lists are watched
// through here: every snapshot says whether it came from the server or the local cache, a failure is recorded, and the
// caller re-subscribes after FEED_RETRY_MS. The wallboard prints the state under its clock (feedStatusOf).
//
// Pure apart from the onSnapshot the caller hands in. Harness: scripts/liveFeed.test.mjs.

export const FEED_RETRY_MS = 15000;
export const FEED_EMPTY = Object.freeze({ at: 0, fromCache: false, error: '', errorAt: 0 });

/**
 * Watch a collection. → the unsubscribe.
 * @param onSnapshot  Firestore's onSnapshot (passed in — no Firebase import here)
 * @param onDocs      the documents as [{ id, ...data }] — only when they changed (not on a connection-only update)
 * @param onFeed      the feed's state, as a state-setter takes it (a function of the previous state)
 * @param onLost      called once when the listener fails — the caller re-subscribes after FEED_RETRY_MS
 * @param now         the clock (tests)
 */
export function watchCollection({ onSnapshot, ref, onDocs, onFeed, onLost = () => {}, now = () => Date.now() }) {
    let first = true;
    return onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
        if (first || snap.docChanges().length) { first = false; onDocs(snap.docs.map(d => ({ id: d.id, ...d.data() }))); }
        const cached = !!(snap.metadata && snap.metadata.fromCache);
        onFeed(f => ({ at: cached ? (f && f.at) || 0 : now(), fromCache: cached, error: '', errorAt: 0 }));
    }, (err) => {
        onFeed(f => ({ ...(f || FEED_EMPTY), error: String((err && (err.code || err.message)) || 'error'), errorAt: now() }));
        onLost(err);
    });
}

const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
/** What the wallboard prints under its clock: { tone: 'live' | 'offline' | 'lost' | 'waiting', text, textEs }. */
export function feedStatusOf(feed) {
    const f = feed || FEED_EMPTY;
    if (f.error) return { tone: 'lost', text: `⚠ Live data lost at ${clock(f.errorAt)} — reconnecting`, textEs: 'Datos en vivo perdidos — reconectando' };
    if (!f.at && !f.fromCache) return { tone: 'waiting', text: 'Connecting…', textEs: 'Conectando…' };
    if (f.fromCache) return { tone: 'offline', text: `◐ Offline — showing data from ${f.at ? clock(f.at) : 'earlier'}`, textEs: 'Sin conexión — datos anteriores' };
    return { tone: 'live', text: `● Live · updated ${clock(f.at)}`, textEs: 'En vivo' };
}
