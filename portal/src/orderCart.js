// THE PORTAL ORDER CART (Stuart 2026-08-10: "once the config is done there is no way to add
// another line"). Several configurations accumulate into ONE quote request — held in
// localStorage so a tab refresh mid-order loses nothing. Each line is exactly what
// Configurator.addLine hands up: { flowId, flowName, lineTag, selections, viewedTotal,
// viewedLevel, priceLines, presMeta }. The cart never prices anything — totals shown are the
// per-line snapshots the customer already saw.

const KEY = 'portal_order_cart_v1';

export const readCart = () => {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c && Array.isArray(c.lines) ? c : { lines: [] };
  } catch { return { lines: [] }; }
};

const write = (cart) => {
  try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* private mode — cart lives in memory only */ }
  return cart;
};

export const addLine = (line) => {
  const cart = readCart();
  return write({ ...cart, lines: [...cart.lines, line] });
};

export const removeLine = (idx) => {
  const cart = readCart();
  return write({ ...cart, lines: cart.lines.filter((_, i) => i !== idx) });
};

export const clearCart = () => write({ lines: [] });
