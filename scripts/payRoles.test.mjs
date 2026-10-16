// node scripts/payRoles.test.mjs — who may take a payment.
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { canTakePayment, PAYMENT_ROLES } = require('../functions/payRoles.js');

let n = 0;
const ok = (cond, what) => { assert.ok(cond, what); n += 1; };

// ── the four Stuart named ────────────────────────────────────────────────────
for (const role of ['csr', 'manager', 'admin', 'superadmin']) {
    ok(canTakePayment(role), `${role} may take a payment`);
}

// ── and nobody else ──────────────────────────────────────────────────────────
for (const role of ['operator', 'programmer', 'purchasing', 'design_team', 'executive', 'sales_rep']) {
    ok(!canTakePayment(role), `${role} may not`);
}

// PRODUCTION managers run the floor, not the counter — a near-miss on the word "manager" must not
// let them charge a card.
for (const role of ['floor_manager', 'floormanager', 'paint_manager', 'paintmanager']) {
    ok(!canTakePayment(role), `${role} is not "manager"`);
}

// ── how the claim actually arrives ───────────────────────────────────────────
ok(canTakePayment('CSR'), 'the role is matched whatever its case');
ok(canTakePayment('  Manager  '), 'and with the whitespace people leave in a user record');
ok(!canTakePayment(''), 'no role is not a role');
ok(!canTakePayment(undefined), 'a missing claim refuses');
ok(!canTakePayment(null), 'so does a null one');
ok(!canTakePayment('admin,csr'), 'a list is not a role — no sneaking two in one string');
ok(!canTakePayment('csr '.repeat(3)), 'nor a repeated one');

// ── the list itself ──────────────────────────────────────────────────────────
ok(PAYMENT_ROLES.includes('superadmin'), 'super admin is included — it has been forgotten before');
ok(PAYMENT_ROLES.length === 4, 'exactly the four named; adding a fifth is a decision, not a tweak');

// ── THE DUPLICATE CANNOT DRIFT ───────────────────────────────────────────────
// The list exists twice and cannot be helped: functions deploy only functions/ and cannot import
// from src/, while the browser cannot import from functions/. src/components/Shared/payRoles.js is
// the canonical one. This reads BOTH files and fails the moment they disagree — so the copy rots
// loudly instead of quietly letting a rep charge a card in one half of the app and not the other.
const { readFileSync } = await import('node:fs');
const listIn = (p) => {
    const m = /PAYMENT_ROLES\s*=\s*\[([^\]]*)\]/.exec(readFileSync(new URL(p, import.meta.url), 'utf8'));
    assert.ok(m, `no PAYMENT_ROLES found in ${p}`);
    return m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
};
assert.deepStrictEqual(
    listIn('../src/components/Shared/payRoles.js'),
    listIn('../functions/payRoles.js'),
    'src/components/Shared/payRoles.js and functions/payRoles.js disagree — change BOTH',
);
n += 1;

console.log(`payRoles: ${n} assertions passed`);
