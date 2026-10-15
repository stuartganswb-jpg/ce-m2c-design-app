// WHO MAY TAKE A PAYMENT — Stuart 2026-10-15: "CSR, Manager or admin roles".
//
// The show counter is PINned in as a rep (Laetitia), and creating a pay link was admin-only, so
// the whole pay card failed there — not only the button: LISTING a document's links is gated the
// same way, so the panel broke as it loaded.
//
// This is deliberately NOT a widening of assertStaffAdmin, which guards twenty-one functions
// including NetSuite posting and user administration. Letting a rep take a card payment must not
// hand them any of that. Only the three pay-LINK functions use this rule: make a link, see a
// document's links, cancel one.
//
// It reads the `role` claim that authenticatePin already mints, so nobody has to sign out and
// back in for it to take effect.
const PAYMENT_ROLES = ['admin', 'superadmin', 'manager', 'csr'];

// `manager` only, NOT floor_manager / paint_manager: those run production, not the counter. If a
// production manager ever needs to take money, add the role here deliberately rather than by
// loosening the match.
const canTakePayment = (role) => PAYMENT_ROLES.includes(String(role || '').trim().toLowerCase());

module.exports = { PAYMENT_ROLES, canTakePayment };
