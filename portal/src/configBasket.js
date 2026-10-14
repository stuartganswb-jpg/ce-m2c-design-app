// THE REQUEST BEING BUILT — several configurations, one request (step 4, 2026-10-14). Kept in this browser, per login, so a
// refresh mid-order loses nothing. A line holds the customer's ANSWERS and what they were shown when they added it; it is
// never a price: the server works every line out again when the request is sent, and HQ quotes it at the account's level.

const KEY = (uid) => `portal_config_request_v1:${uid || 'anon'}`;

export function readBasket(uid) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(uid)) || 'null');
    return raw && Array.isArray(raw.lines) ? { lines: raw.lines.filter((l) => l && l.flowId && l.state), sidemark: String(raw.sidemark || ''), note: String(raw.note || '') } : { lines: [], sidemark: '', note: '' };
  } catch (_) { return { lines: [], sidemark: '', note: '' }; }
}

export function writeBasket(uid, basket) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(basket)); } catch (_) { /* private mode — kept in memory only */ }
  return basket;
}

export const lineId = () => `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// What the line looked like when it was added — for the list, never for the quote.
export const shownOf = (view) => ({
  total: view && view.price && view.price.total !== undefined ? view.price.total : null,
  totalForAll: view && view.price && view.price.totalForAll !== undefined ? view.price.totalForAll : null,
  level: (view && view.price && view.price.level) || '',
  onReview: !!(view && view.price && view.price.hasReview),
  parts: view && view.price ? view.price.lines.length : 0,
});
