// WHO MAY TOUCH MONEY ON AN ORDER — Stuart 2026-10-15: "CSR, Manager or admin roles".
//
// Taking a card payment, and (2026-10-16) overriding the shipping charge the app defaults in.
// Both are money decisions, so both answer to the same list rather than two that drift apart.
//
// ⚠ THIS LIST EXISTS TWICE, and it cannot be helped: Cloud Functions deploy only the functions/
// directory and cannot import from src/, while the browser cannot import from functions/. THIS
// file is the canonical one; functions/payRoles.js is its mirror. scripts/payRoles.test.mjs reads
// BOTH files and fails if they ever disagree, so the duplicate cannot rot quietly.
//
// `manager` only, NOT floor_manager / paint_manager: those run production, not the counter.
export const PAYMENT_ROLES = ['admin', 'superadmin', 'manager', 'csr'];

export const canTakePayment = (role) => PAYMENT_ROLES.includes(String(role || '').trim().toLowerCase());

// The same question, asked of the shipping charge. A separate name because the two could one day
// diverge on purpose — and if they do, it should be a decision someone wrote down, not a surprise.
export const canOverrideShipping = canTakePayment;
