// ── NETSUITE TO FIX TODAY — the queue's side (Stuart 2026-10-20: "keep the floor moving … detail these so they can be fixed
// before days end" · "eric will own list") ──────────────────────────────────────────────────────────────────────────────
// Three things the worker does with this, beside posting:
//   1. A REFUSAL IS TOLD TO THE RECORDS IT WAS FOR. Until now a refused write changed only its own queue entry, so an order
//      NetSuite would not take sat "awaiting NetSuite" for good and nothing on the floor could tell it from one in the queue.
//      Every record the write would have stamped (its writeBack targets) gets `nsRefused.<kind>` — when, which entry, what
//      NetSuite said — and loses it the moment that kind posts for it. The floor reads it to keep moving (a refused sales
//      order is picked and packed, and held at shipping).
//   2. A REFUSAL NETSUITE LATER TAKES LEAVES THE LIST BY ITSELF: when an entry posts, an earlier FAILED entry of the same
//      kind for the same thing (its dedupe key, or a record both would stamp) is marked fix POSTED_LATER.
//   3. THE 3 PM NOTE — what is still owed, on OS Comms, to the list's owner.
// The "what is still owed" rule is the app's Shared/nsFixList (queueStateOf · directOpenOf · the fourteen-day window),
// kept as its twin here; scripts/nsFixServer.test.mjs holds the two to the same answers on the same records.

const DAY = 86400000;
const STUCK_MINUTES = 30;
const WINDOW_DAYS = 14;
const OWNER = 'Eric';
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v) => String(v == null ? '' : v);

/** The records a write would stamp. */
const writeBackTargetsOf = (e) => (Array.isArray(e && e.writeBack) ? e.writeBack : (e && e.writeBack ? [e.writeBack] : []))
    .filter(w => w && w.collection && w.docId).map(w => ({ collection: String(w.collection), docId: String(w.docId) }));

/** The field a refusal is kept in on a record: nsRefused.<kind> (a field-path-safe kind). */
const refusedKeyOf = (kind) => str(kind || 'write').replace(/[^A-Za-z0-9_]/g, '_');

/** NetSuite's own words out of a stored error. */
const nsDetailOf = (raw) => {
    const s = str(raw);
    const m = [...s.matchAll(/"detail"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(x => x[1].replace(/\\"/g, '"').replace(/^Error while accessing a resource\.\s*/i, ''));
    return (m.length ? m.join(' · ') : s.replace(/^HTTP \d+:\s*/, '').replace(/^Error while accessing a resource\.\s*/i, '')).trim();
};

/** What a record is told when NetSuite refuses a write for it. */
const refusalMarkOf = (e, errText, now = Date.now()) => ({
    at: now, outboxId: str(e && e.id), kind: str(e && e.kind), label: str(e && e.label).slice(0, 200), error: nsDetailOf(errText).slice(0, 300),
});

/** Does this POSTED entry settle that earlier FAILED one? Same kind, and the same dedupe key or a record both would stamp. */
const settles = (posted, failed) => {
    if (!posted || !failed || posted.id === failed.id || failed.status !== 'FAILED' || failed.fix) return false;
    if (str(posted.kind) !== str(failed.kind)) return false;
    if (N(failed.createdAt) > N(posted.createdAt)) return false;
    if (posted.dedupeKey && failed.dedupeKey && posted.dedupeKey === failed.dedupeKey) return true;
    const a = writeBackTargetsOf(posted).map(t => `${t.collection}/${t.docId}`);
    return writeBackTargetsOf(failed).some(t => a.includes(`${t.collection}/${t.docId}`));
};

// ── what is still owed (the twin of Shared/nsFixList) ─────────────────────────────────────────────────────────────────────
const LIVE = ['PENDING', 'PROCESSING', 'WAITING'];
const queueStateOf = (e, { now = Date.now() } = {}) => {
    if (!e) return '';
    const st = str(e.status);
    if (st === 'FAILED') return e.fix ? '' : 'REFUSED';
    if (!LIVE.includes(st)) return '';
    const age = now - (N(e.createdAt) || now);
    if (st === 'PROCESSING') return now - (N(e.leasedAt) || now) > 10 * 60000 ? 'STUCK' : '';
    if (st === 'WAITING') return age > STUCK_MINUTES * 60000 ? 'STUCK' : '';
    return N(e.attempts) > 0 && age > STUCK_MINUTES * 60000 ? 'STUCK' : '';
};
const directOpenOf = (l) => !!l && !!l.audit && l.audit.kind === 'NS_DIRECT' && l.audit.ok === false && !l.nsFix;
const msOf = (t) => {
    if (t == null) return 0;
    if (typeof t === 'number') return t;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000;
    if (typeof t._seconds === 'number') return t._seconds * 1000;
    const n = Date.parse(t);
    return Number.isFinite(n) ? n : 0;
};
const shopDayStartOf = (now = Date.now()) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(now));
    const get = (t) => N((parts.find(p => p.type === t) || {}).value);
    return now - (((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000) - (now % 1000);
};
const actionOf = (msg) => { const s = str(msg); const i = s.indexOf(' — '); return (i >= 0 ? s.slice(i + 3) : s).trim(); };

/** → { rows: [{ key, at, who, label, words, carried }], counts: { open, carried } } — the same open set the app lists. */
const openOf = ({ entries = [], logs = [], now = Date.now() } = {}) => {
    const since = now - WINDOW_DAYS * DAY;
    const dayStart = shopDayStartOf(now);
    const rows = [];
    (entries || []).forEach(e => {
        const st = queueStateOf(e, { now });
        if (!st) return;
        const at = N(e.failedAt) || N(e.createdAt);
        if ((N(e.createdAt) || at) < since) return;
        rows.push({ key: `ob:${e.id}`, at, who: str(e.createdBy), label: str(e.label || e.kind), words: st === 'STUCK' ? 'not through yet — still trying' : (nsDetailOf(e.lastError).slice(0, 160) || 'NetSuite refused it'), carried: at < dayStart });
    });
    (logs || []).filter(directOpenOf).forEach(l => {
        const at = msOf(l.t);
        if (at < since) return;
        rows.push({ key: `hl:${l.id}`, at, who: str(l.u), label: actionOf(l.msg) || str(l.audit && l.audit.recordKind), words: nsDetailOf(l.audit && l.audit.error).slice(0, 160) || 'NetSuite refused it', carried: at < dayStart });
    });
    rows.sort((a, b) => (a.carried === b.carried ? a.at - b.at : (a.carried ? -1 : 1)));
    return { rows, counts: { open: rows.length, carried: rows.filter(r => r.carried).length } };
};

/** The 3 pm OS Comms note. '' when nothing is owed. */
const digestOf = ({ entries = [], logs = [], now = Date.now() } = {}, { owner = OWNER, max = 8 } = {}) => {
    const { rows, counts } = openOf({ entries, logs, now });
    if (!counts.open) return '';
    const head = `🧾 ${owner} — NetSuite: ${counts.open} still to fix today${counts.carried ? ` (${counts.carried} from before today)` : ''}. The floor kept moving; put these right in NetSuite before the day ends (11.1 → NetSuite to fix, or the red chip on RTG / the WMS):`;
    const lines = rows.slice(0, max).map(r => `• ${r.label}${r.who ? ` (${r.who})` : ''} — ${r.words}`);
    return [head, ...lines, ...(rows.length > max ? [`…and ${rows.length - max} more`] : [])].join('\n');
};

module.exports = { writeBackTargetsOf, refusedKeyOf, nsDetailOf, refusalMarkOf, settles, queueStateOf, directOpenOf, openOf, digestOf, shopDayStartOf, OWNER, WINDOW_DAYS };
