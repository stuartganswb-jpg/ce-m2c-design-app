// ONE RUN AT A TIME — a handler that cannot be entered again while it is still running.
//
// Eric, App Imp 2026-09-19 (PO2128 line 7): a vendor receipt reached the NetSuite queue TWICE in the
// same second. A scanner ends its read with Enter — often two — and each Enter submits the put-away
// form; the handler only marked itself busy AFTER its bin check and its confirm, so the second submit
// walked in behind the first. Both passed the "is this still the cart?" read, both wrote the same
// received figure (so the app's record hid it), and both queued a receipt under the same dedupeKey
// before either row existed. NetSuite refused the twin only because that line was already fully
// received; on a PARTIAL receipt the twin would have posted and the pieces been received twice.
//
// React state cannot be the latch — it is not set until the next render, and both calls read the old
// value. `latch` is a ref ({ current }) set synchronously, before the first await, released however
// the run ends. A second call while one is in flight does nothing and returns undefined.
export const onceAtATime = (latch, fn) => async (...args) => {
    if (!latch || latch.current) return undefined;
    latch.current = true;
    try { return await fn(...args); }
    finally { latch.current = false; }
};
