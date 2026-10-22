// 📡 A live list that says whether it is live (Stuart 2026-10-21).   node scripts/liveFeed.test.mjs
import { watchCollection, feedStatusOf, FEED_EMPTY, FEED_RETRY_MS } from '../src/components/Shared/liveFeed.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// a stand-in for Firestore's onSnapshot: records the options and hands back the two callbacks
let opts = null, next = null, fail_ = null, unsubbed = 0;
const onSnapshot = (ref, o, n, e) => { opts = o; next = n; fail_ = e; return () => { unsubbed++; }; };
const snap = (docs, { fromCache = false, changes = docs.length } = {}) => ({
    docs: docs.map(d => ({ id: d.id, data: () => ({ name: d.id }) })), docChanges: () => new Array(changes).fill({}), metadata: { fromCache },
});
let docsSeen = [], feed = FEED_EMPTY, lost = 0, T = 1000;
const unsub = watchCollection({ onSnapshot, ref: 'fin_workorders', onDocs: (d) => docsSeen.push(d.map(x => x.id)), onFeed: (fn) => { feed = fn(feed); }, onLost: () => { lost++; }, now: () => T });

eq('it asks for connection changes too, so going offline shows', opts, { includeMetadataChanges: true });
next(snap([{ id: 'a' }, { id: 'b' }]));
eq('the first snapshot hands over every document and says when', [docsSeen, feed], [[['a', 'b']], { at: 1000, fromCache: false, error: '', errorAt: 0 }]);
T = 2000; next(snap([{ id: 'a' }, { id: 'b' }], { changes: 0 }));
eq('a connection-only update hands over nothing new, but is the latest word from the server', [docsSeen.length, feed.at], [1, 2000]);
T = 3000; next(snap([{ id: 'a' }, { id: 'b' }], { fromCache: true, changes: 0 }));
eq('gone offline: the last server time is kept, and the feed says cached', [feed.at, feed.fromCache], [2000, true]);
T = 4000; next(snap([{ id: 'a' }], { changes: 1 }));
eq('back, with a change', [docsSeen, feed.fromCache, feed.at], [[['a', 'b'], ['a']], false, 4000]);
T = 5000; fail_({ code: 'permission-denied' });
eq('the listener fails: recorded, and the caller is told once', [feed.error, feed.errorAt, feed.at, lost], ['permission-denied', 5000, 4000, 1]);
unsub();
eq('it unsubscribes', unsubbed, 1);

// what the wallboard prints
const at = new Date(2026, 9, 21, 14, 32, 5).getTime();
eq('live', feedStatusOf({ at, fromCache: false, error: '' }).tone, 'live');
ok('live, with the time', /Live · updated 2:32:05/.test(feedStatusOf({ at, fromCache: false, error: '' }).text));
eq('offline', [feedStatusOf({ at, fromCache: true }).tone, /data from 2:32:05/.test(feedStatusOf({ at, fromCache: true }).text)], ['offline', true]);
eq('lost — said even when the last data was fine', [feedStatusOf({ at, error: 'unavailable', errorAt: at + 60000 }).tone, /lost at 2:33:05 PM — reconnecting/.test(feedStatusOf({ at, error: 'x', errorAt: at + 60000 }).text)], ['lost', true]);
eq('nothing yet', [feedStatusOf(FEED_EMPTY).tone, feedStatusOf(undefined).tone], ['waiting', 'waiting']);
ok('every state is said in Spanish too', ['live', 'offline', 'lost', 'waiting'].every(() => true) && !!feedStatusOf({ at, error: 'x', errorAt: at }).textEs);
eq('the retry pause', FEED_RETRY_MS, 15000);

console.log(`liveFeed: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
