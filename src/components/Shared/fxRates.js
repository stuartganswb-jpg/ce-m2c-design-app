// Shared/fxRates.js — what a vendor's price is worth in dollars.
//
// Stuart 2026-10-07 (tab 1.2, Control Sheets): "we add columns next to US$ to left for the origin currency and
// the US$ column will be filled out using an online current exchange rate" · the currencies: "euro's and chinese
// rmb (yuan)" · when the dollars move: "fix it at the day and add an update rates".
//
// THE RULE. A line carries the price as the vendor quoted it (priceOrigin, currency). Its USD is worked out
// ONCE, at the rate of the day the price was entered, and the rate and its date are kept on the line beside
// it (fxRate, fxDate, fxSource) — so a total does not move overnight by itself and anyone can see what the
// number was made from. "Update rates" on the sheet is the only thing that moves it afterwards.
//
// THE RATE is the European Central Bank's daily reference rate, read through frankfurter.dev (no key, no
// account; only the currency code is sent). A rate that cannot be had is never guessed: the USD is left
// blank and says so.

export const FX_SOURCE = 'ECB';
const ISO = { USD: 'USD', RMB: 'CNY', CNY: 'CNY', YUAN: 'CNY', EUR: 'EUR', EURO: 'EUR' };
// What the sheet calls a currency a vendor may have typed another way.
const SHEET_NAME = { CNY: 'RMB', YUAN: 'RMB', EURO: 'EUR' };
const str = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };

// The rate table's code for a currency as the sheet names it ("RMB" is CNY there); '' = not one we convert.
export const isoOf = (code) => ISO[str(code).trim().toUpperCase()] || '';
export const rateUrlFor = (code) => {
    const iso = isoOf(code);
    return iso && iso !== 'USD' ? `https://api.frankfurter.dev/v1/latest?base=${iso}&symbols=USD` : '';
};

// { rate, date } out of the service's answer — or null when it is not the answer to THIS question.
export function readRate(json, code) {
    const iso = isoOf(code);
    if (!json || typeof json !== 'object' || !iso || str(json.base).toUpperCase() !== iso) return null;
    const rate = num(json.rates && json.rates.USD);
    if (rate === null || rate <= 0) return null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(json.date)) ? json.date : '';
    return { rate, date };
}

const cache = new Map();   // one answer per currency per half hour — a sheet of RMB lines asks once
const FRESH_MS = 30 * 60 * 1000;

// { rate, date, source } for one unit of `code` in US dollars, or null: not a currency we convert, or the
// rate could not be had (offline, the service down, an answer that does not read).
export async function usdRateFor(code, { fetchImpl, now = Date.now, fresh = false } = {}) {
    const iso = isoOf(code);
    if (!iso) return null;
    if (iso === 'USD') return { rate: 1, date: new Date(now()).toISOString().slice(0, 10), source: 'USD' };
    const held = cache.get(iso);
    if (!fresh && held && now() - held.at < FRESH_MS) return held.value;
    try {
        const res = await (fetchImpl || fetch)(rateUrlFor(code));
        if (!res || !res.ok) return null;
        const read = readRate(await res.json(), code);
        if (!read) return null;
        const value = { ...read, source: FX_SOURCE };
        cache.set(iso, { at: now(), value });
        return value;
    } catch (_) { return null; }
}
export const forgetRates = () => cache.clear();

export const usdOf = (price, rate) => Math.round(price * rate * 1e4) / 1e4;
export const hasOriginPrice = (line) => num(line && line.priceOrigin) !== null && !!isoOf(line && line.currency);

// WHAT IS SAVED when a line's origin price or currency is set. `rate` is usdRateFor's answer, or null.
//   no price            → the origin price is cleared and the USD with it (it was worked out from it)
//   a price, no currency → the price is kept; the USD waits blank for the currency
//   a price, a currency  → USD = price × rate, with the rate and its date beside it
//   …and no rate         → the USD is blank and marked PENDING (never an old or a guessed number)
export function originPricePatch({ priceOrigin, currency }, rate) {
    const price = num(priceOrigin);
    const cur = SHEET_NAME[str(currency).trim().toUpperCase()] || str(currency).trim().toUpperCase();
    if (price === null) return { priceOrigin: null, currency: cur, priceUsd: null, fxRate: null, fxDate: '', fxSource: '' };
    if (!isoOf(cur)) return { priceOrigin: price, currency: cur, priceUsd: null, fxRate: null, fxDate: '', fxSource: '' };
    if (!rate || num(rate.rate) === null) return { priceOrigin: price, currency: cur, priceUsd: null, fxRate: null, fxDate: '', fxSource: 'PENDING' };
    return { priceOrigin: price, currency: cur, priceUsd: usdOf(price, rate.rate), fxRate: rate.rate, fxDate: str(rate.date), fxSource: str(rate.source) || FX_SOURCE };
}

// One line under the USD: what it was made from.
export function fxNoteOf(line) {
    if (!line || num(line.priceOrigin) === null) return '';
    const cur = str(line.currency).trim();
    if (!cur) return 'Choose the currency — the USD is worked out from the price';
    if (line.fxSource === 'PENDING' || num(line.fxRate) === null) return `${cur} ${num(line.priceOrigin)} — today's rate could not be had; press Update rates`;
    if (isoOf(cur) === 'USD') return `${cur} ${num(line.priceOrigin)} — quoted in dollars`;
    const from = line.fxSource === 'WORKBOOK' ? 'the rate the workbook used' : `${str(line.fxSource) || FX_SOURCE} rate of ${str(line.fxDate) || 'the day it was entered'}`;
    return `${cur} ${num(line.priceOrigin)} × ${Math.round(num(line.fxRate) * 1e6) / 1e6} — ${from}`;
}

// The currencies "Update rates" has to ask for: every line priced in something other than dollars.
export const currenciesToRefresh = (lines) => [...new Set((lines || []).filter(hasOriginPrice).map(l => str(l.currency).trim().toUpperCase()).filter(c => isoOf(c) !== 'USD'))];

// [{ line, patch, before, after }] — the lines whose USD moves at these rates. A line whose rate could not be
// had is left exactly as it is (it is not blanked by an update that failed), and a pushed line never moves.
export function refreshPlan(lines, rateByCurrency, isLocked = () => false) {
    const out = [];
    for (const line of (lines || [])) {
        if (!hasOriginPrice(line) || isLocked(line)) continue;
        const cur = str(line.currency).trim().toUpperCase();
        if (isoOf(cur) === 'USD') continue;
        const rate = rateByCurrency && rateByCurrency[cur];
        if (!rate) continue;
        const patch = originPricePatch({ priceOrigin: line.priceOrigin, currency: cur }, rate);
        const before = num(line.priceUsd);
        if (before !== null && Math.abs(before - patch.priceUsd) < 1e-9 && line.fxDate === patch.fxDate && line.fxSource === patch.fxSource) continue;
        out.push({ line, patch, before, after: patch.priceUsd });
    }
    return out;
}
