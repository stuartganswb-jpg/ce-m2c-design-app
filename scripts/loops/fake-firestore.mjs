// An in-memory Firestore for the loop tests (scripts/loops). The app's Shared route modules import
// 'firebase/firestore' and '../../firebase'; the loop hook points both here, so the REAL route code —
// runOeAuto, executeOeJobs, parkRowPair, releaseFinWoToFloor — runs end to end against a store the test
// seeds and reads back. Only what those modules call is implemented, with Firestore's semantics where
// they matter (updateDoc on a missing doc throws, dotted paths, merge, sentinels).
const store = new Map();   // path of a collection → Map(id → data)
let autoId = 0;

const SENT = Symbol('sentinel');
export const serverTimestamp = () => ({ [SENT]: 'ts' });
export const deleteField = () => ({ [SENT]: 'delete' });
export const arrayUnion = (...vals) => ({ [SENT]: 'union', vals });
export const arrayRemove = (...vals) => ({ [SENT]: 'remove', vals });
export const increment = (n) => ({ [SENT]: 'inc', n });

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const collOf = (path) => { if (!store.has(path)) store.set(path, new Map()); return store.get(path); };

export const collection = (_db, ...segs) => ({ type: 'coll', path: segs.join('/') });
export const doc = (base, ...segs) => {
    if (base && base.type === 'coll') {
        const id = segs.length ? segs.join('/') : `auto${++autoId}`;
        return { type: 'doc', coll: base.path, id, path: `${base.path}/${id}` };
    }
    const id = segs[segs.length - 1];
    const coll = segs.slice(0, -1).join('/');
    return { type: 'doc', coll, id, path: `${coll}/${id}` };
};
export const where = (field, op, value) => ({ kind: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ kind: 'orderBy', field, dir });
export const limit = (n) => ({ kind: 'limit', n });
export const query = (coll, ...cons) => ({ type: 'query', path: coll.path, cons });

const getPath = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const resolveValue = (cur, v) => {
    if (v && typeof v === 'object' && v[SENT]) {
        if (v[SENT] === 'ts') return Date.now();
        if (v[SENT] === 'union') { const arr = Array.isArray(cur) ? [...cur] : []; v.vals.forEach(x => { if (!arr.some(y => JSON.stringify(y) === JSON.stringify(x))) arr.push(clone(x)); }); return arr; }
        if (v[SENT] === 'remove') { const arr = Array.isArray(cur) ? cur : []; return arr.filter(y => !v.vals.some(x => JSON.stringify(x) === JSON.stringify(y))); }
        if (v[SENT] === 'inc') return (Number(cur) || 0) + v.n;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        const out = {};
        Object.entries(v).forEach(([k, x]) => { if (!(x && x[SENT] === 'delete')) out[k] = resolveValue(undefined, x); });
        return out;
    }
    return clone(v);
};
const deepMerge = (target, src) => {
    const out = { ...(target || {}) };
    Object.entries(src || {}).forEach(([k, v]) => {
        if (v && typeof v === 'object' && v[SENT] === 'delete') { delete out[k]; return; }
        if (v && typeof v === 'object' && !Array.isArray(v) && !v[SENT] && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
        else out[k] = resolveValue(out[k], v);
    });
    return out;
};
const setPath = (obj, path, v) => {
    const keys = String(path).split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) { if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
    const last = keys[keys.length - 1];
    if (v && typeof v === 'object' && v[SENT] === 'delete') delete o[last];
    else o[last] = resolveValue(o[last], v);
};

const snap = (ref) => {
    const data = collOf(ref.coll).get(ref.id);
    return { id: ref.id, ref, exists: () => data !== undefined, data: () => clone(data) };
};
export const getDoc = async (ref) => snap(ref);
export const setDoc = async (ref, data, opts = {}) => {
    const c = collOf(ref.coll);
    c.set(ref.id, opts && opts.merge ? deepMerge(c.get(ref.id), data) : deepMerge({}, data));
};
export const updateDoc = async (ref, patch) => {
    const c = collOf(ref.coll);
    if (!c.has(ref.id)) throw new Error(`No document to update: ${ref.path}`);
    const cur = clone(c.get(ref.id));
    Object.entries(patch || {}).forEach(([k, v]) => setPath(cur, k, v));
    c.set(ref.id, cur);
};
export const addDoc = async (coll, data) => { const ref = doc(coll); await setDoc(ref, data); return ref; };
export const deleteDoc = async (ref) => { collOf(ref.coll).delete(ref.id); };

const matches = (d, c) => {
    const v = getPath(d, c.field);
    switch (c.op) {
        case '==': return v === c.value;
        case '!=': return v !== c.value;
        case 'in': return (c.value || []).includes(v);
        case 'not-in': return !(c.value || []).includes(v);
        case 'array-contains': return Array.isArray(v) && v.includes(c.value);
        case 'array-contains-any': return Array.isArray(v) && v.some(x => (c.value || []).includes(x));
        case '>': return v > c.value; case '>=': return v >= c.value;
        case '<': return v < c.value; case '<=': return v <= c.value;
        default: throw new Error(`fake firestore: op ${c.op}`);
    }
};
export const getDocs = async (q) => {
    const path = q.path;
    const cons = q.type === 'query' ? q.cons : [];
    let rows = [...collOf(path).entries()].map(([id, data]) => ({ id, data }));
    cons.filter(c => c.kind === 'where').forEach(c => { rows = rows.filter(r => matches(r.data, c)); });
    const lim = cons.find(c => c.kind === 'limit');
    if (lim) rows = rows.slice(0, lim.n);
    const docs = rows.map(r => ({ id: r.id, ref: { type: 'doc', coll: path, id: r.id, path: `${path}/${r.id}` }, exists: () => true, data: () => clone(r.data) }));
    return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
};
export const onSnapshot = () => () => {};
export const runTransaction = async (_db, fn) => {
    const tx = {
        get: async (ref) => snap(ref),
        set: (ref, data, opts) => { setDoc(ref, data, opts); return tx; },
        update: (ref, patch) => { updateDoc(ref, patch); return tx; },
        delete: (ref) => { deleteDoc(ref); return tx; },
    };
    return fn(tx);
};
export const writeBatch = () => {
    const ops = [];
    const b = {
        set: (ref, data, opts) => { ops.push(() => setDoc(ref, data, opts)); return b; },
        update: (ref, patch) => { ops.push(() => updateDoc(ref, patch)); return b; },
        delete: (ref) => { ops.push(() => deleteDoc(ref)); return b; },
        commit: async () => { for (const op of ops) await op(); },
    };
    return b;
};
export const getFirestore = () => ({ __fake: true });
export const Timestamp = { now: () => ({ toMillis: () => Date.now() }) };

// ── the test's handle on the store ──
export const __fs = {
    reset: () => { store.clear(); autoId = 0; },
    seed: (coll, id, data) => { collOf(coll).set(id, clone(data)); },
    get: (coll, id) => clone(collOf(coll).get(id)),
    all: (coll) => [...collOf(coll).entries()].map(([id, data]) => ({ id, ...clone(data) })),
    colls: () => [...store.keys()],
};
