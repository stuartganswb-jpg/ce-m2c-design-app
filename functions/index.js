const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const CryptoJS = require("crypto-js");
const crypto = require("crypto");

// 🔐 NetSuite credentials — stored as Firebase secrets, never in source.
// Set each once:  firebase functions:secrets:set NS_CONSUMER_KEY   (and the rest)
const NS_ACCOUNT = defineSecret("NS_ACCOUNT");
const NS_CONSUMER_KEY = defineSecret("NS_CONSUMER_KEY");
const NS_CONSUMER_SECRET = defineSecret("NS_CONSUMER_SECRET");
const NS_TOKEN_ID = defineSecret("NS_TOKEN_ID");
const NS_TOKEN_SECRET = defineSecret("NS_TOKEN_SECRET");

// Initialize Firebase Admin to securely access Firestore and Auth
admin.initializeApp();

// ============================================================================
// 1. SECURE AUTHENTICATION FUNCTION (MINTING PRESS & GATEKEEPER)
// ============================================================================

// OUTER GATE — the 4-digit PIN alone is too weak as an internet-facing credential (10k space;
// per-PIN lockout doesn't slow a sweep of DIFFERENT pins). Staff sign in once per day with a
// company email (the client's OuterGate screen); this function refuses to mint a PIN token
// without a fresh, domain-allowed outer session, making the PIN a user-switcher BEHIND a real
// credential rather than a standalone one. Floor tablets share a station email account.
const ALLOWED_EMAIL_DOMAINS = [
    'classicalelements.com',
    'm2cstudio.com',
    'uniquitystyle.com',
    'leylagans.com',
    'thelab-hp.com',
];
// Server-side daily window, slightly longer than the client's 14h so a tablet signed in at 6am
// never hits the server wall mid-shift; the client re-prompts first.
const OUTER_MAX_AGE_HOURS = 16;

exports.authenticatePin = onCall({
    enforceAppCheck: true, // 🛡️ Requires a valid App Check (reCAPTCHA) token
    cors: true
}, async (request) => {

    const { pin, outerToken } = request.data;
    const clientIp = request.rawRequest.ip;

    if (!pin) {
        throw new HttpsError('invalid-argument', 'PIN is required.');
    }

    // 1. Verify the daily email session before touching the PIN at all.
    let outer;
    try {
        outer = await admin.auth().verifyIdToken(String(outerToken || ''));
    } catch (e) {
        throw new HttpsError('unauthenticated', 'Daily sign-in required. Return to the portal home and sign in with your company email.');
    }
    const outerEmail = String(outer.email || '').toLowerCase();
    const outerDomain = outerEmail.split('@')[1] || '';
    if (!ALLOWED_EMAIL_DOMAINS.includes(outerDomain)) {
        // Also rejects PIN-minted custom tokens replayed as outerToken (they carry no email).
        throw new HttpsError('permission-denied', 'This account is not authorized for the portal.');
    }
    if ((Date.now() / 1000) - (outer.auth_time || 0) > OUTER_MAX_AGE_HOURS * 3600) {
        throw new HttpsError('unauthenticated', 'Daily sign-in expired. Return to the portal home and sign in again.');
    }

    const db = admin.firestore();
    
    // Rate Limiting / Lockout — keyed primarily on the PIN (account), so one operator's typos can't
    // lock out the whole warehouse (every device shares one public IP). A much higher IP-level counter
    // still backstops a brute-force enumeration flood. Only FAILED attempts count; any success clears
    // the counters. The PIN is hashed so raw PINs never land in security_logs doc ids.
    const lockoutWindow = 10 * 60 * 1000; // 10 minutes
    const PIN_MAX = 5;   // lock a specific PIN after 5 wrong tries (targeted-guess protection)
    const IP_MAX = 40;   // lock an IP after 40 wrong tries (flood backstop — high so a shared warehouse IP isn't tripped by normal typos)
    const now = Date.now();
    const pinHash = crypto.createHash('sha256').update(String(pin)).digest('hex').slice(0, 24);
    const ipRef = db.collection('security_logs').doc(`ip_${clientIp}`);
    const pinRef = db.collection('security_logs').doc(`pin_${pinHash}`);

    const [ipDoc, pinDoc] = await Promise.all([ipRef.get(), pinRef.get()]);

    const lockMinsLeft = (doc, max) => {
        if (!doc.exists) return 0;
        const d = doc.data();
        return (d.count >= max && (now - d.lastAttempt < lockoutWindow)) ? Math.ceil((lockoutWindow - (now - d.lastAttempt)) / 60000) : 0;
    };
    const pinLock = lockMinsLeft(pinDoc, PIN_MAX);
    if (pinLock) throw new HttpsError('resource-exhausted', `Too many attempts for this PIN. Try again in ${pinLock} minute(s).`);
    const ipLock = lockMinsLeft(ipDoc, IP_MAX);
    if (ipLock) throw new HttpsError('resource-exhausted', `Too many attempts. Locked out for ${ipLock} minutes.`);

    // Query the hq_users collection securely on the server
    const usersRef = db.collection('hq_users');
    const snapshot = await usersRef.where('pin', '==', pin).limit(1).get();

    // Invalid PIN → increment BOTH the per-PIN and per-IP failure counters
    if (snapshot.empty) {
        const bump = (doc, ref) => ref.set({ count: (doc.exists && (now - doc.data().lastAttempt < lockoutWindow)) ? doc.data().count + 1 : 1, lastAttempt: now });
        await Promise.all([bump(pinDoc, pinRef), bump(ipDoc, ipRef)]);
        throw new HttpsError('unauthenticated', 'Invalid PIN.');
    }

    // Success → clear the failure counters (a valid login proves this is legit activity)
    await Promise.all([pinRef.delete(), ipRef.delete()]);

    // 5. Mint Custom Token utilizing database user profile
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    
    const safeRole = userData.role ? userData.role.toLowerCase() : 'operator';
    const userName = userData.name || 'Unknown Operator';

    const token = await admin.auth().createCustomToken(userDoc.id, {
        role: safeRole,
        name: userName
    });

    return { 
        token, 
        user: { 
            name: userName, 
            role: safeRole,
            uid: userDoc.id 
        } 
    };
});


// ============================================================================
// 2. NETSUITE API PROXY
// ============================================================================

// RFC 3986 / OAuth 1.0 percent-encoding. encodeURIComponent leaves ! ' ( ) * unescaped, but OAuth
// requires them encoded. URLs like .../purchaseorder/{id}/!transform/itemreceipt contain "!", so without
// this the signature base string diverges from NetSuite's and auth fails with 401 INVALID_LOGIN.
const oauthEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

const generateNetSuiteHeader = (method, url, creds) => {
    const oauth_nonce = Math.random().toString(36).substring(2, 15);
    const oauth_timestamp = Math.floor(Date.now() / 1000).toString();

    // OAuth 1.0a signature base string: METHOD & encode(base URL WITHOUT query) & encode(sorted params).
    // The base URL must exclude the query string, and ALL query params must be folded into the sorted
    // parameter list alongside the oauth_* params — otherwise a URL with query params (e.g. a RESTlet's
    // ?script=&deploy=) signs wrong and NetSuite returns INVALID_LOGIN_ATTEMPT. SuiteTalk REST/SuiteQL
    // URLs have no query, so this is backward-compatible with every existing call.
    const qIdx = url.indexOf('?');
    const baseUrl = qIdx === -1 ? url : url.slice(0, qIdx);
    const params = {
        oauth_consumer_key: creds.consumerKey,
        oauth_nonce,
        oauth_signature_method: 'HMAC-SHA256',
        oauth_timestamp,
        oauth_token: creds.tokenId,
        oauth_version: '1.0',
    };
    if (qIdx !== -1) {
        url.slice(qIdx + 1).split('&').filter(Boolean).forEach((pair) => {
            const eq = pair.indexOf('=');
            const k = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
            const v = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1));
            params[k] = v;
        });
    }
    const paramString = Object.keys(params).sort()
        .map((k) => `${oauthEncode(k)}=${oauthEncode(params[k])}`)
        .join('&');

    const baseString = `${method}&${oauthEncode(baseUrl)}&${oauthEncode(paramString)}`;

    const signingKey = `${oauthEncode(creds.consumerSecret)}&${oauthEncode(creds.tokenSecret)}`;
    const hash = CryptoJS.HmacSHA256(baseString, signingKey);
    const oauth_signature = CryptoJS.enc.Base64.stringify(hash);

    return `OAuth realm="${creds.account}", oauth_consumer_key="${oauthEncode(creds.consumerKey)}", oauth_token="${oauthEncode(creds.tokenId)}", oauth_nonce="${oauthEncode(oauth_nonce)}", oauth_timestamp="${oauth_timestamp}", oauth_signature_method="HMAC-SHA256", oauth_signature="${oauthEncode(oauth_signature)}", oauth_version="1.0"`;
};

// Only our own NetSuite account host may ever be proxied. Without this, an authenticated
// caller could point the OAuth-signed relay at an arbitrary URL. SuiteTalk REST + RESTlet
// traffic all lives under this one host.
const NS_ALLOWED_HOSTS = ['3728153.suitetalk.api.netsuite.com'];

exports.netsuiteProxy = onRequest({
    cors: true,
    secrets: [NS_ACCOUNT, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET]
}, async (req, res) => {
    try {
        // 🛡️ AuthN/AuthZ — this proxy OAuth-signs with server-held NetSuite secrets, so it must
        // never be an open relay. Require BOTH:
        //   1. A valid App Check token (proves the call originates from our registered app, not curl).
        //   2. A valid Firebase ID token (proves a signed-in user — any PIN-minted token qualifies).
        // Both are attached by the shared client helper (src/components/Shared/nsProxy.js).
        const appCheckToken = req.header('X-Firebase-AppCheck');
        if (!appCheckToken) {
            return res.status(401).send({ error: 'Missing App Check token.' });
        }
        try {
            await admin.appCheck().verifyToken(appCheckToken);
        } catch (e) {
            return res.status(401).send({ error: 'Invalid App Check token.' });
        }

        const clientAuthHeader = req.header('Authorization') || '';
        const idToken = clientAuthHeader.startsWith('Bearer ') ? clientAuthHeader.slice(7) : '';
        if (!idToken) {
            return res.status(401).send({ error: 'Missing authentication token.' });
        }
        try {
            await admin.auth().verifyIdToken(idToken);
        } catch (e) {
            return res.status(401).send({ error: 'Invalid authentication token.' });
        }

        const { targetUrl, method, payload } = req.body;

        if (!targetUrl || !method) {
            return res.status(400).send({ error: "Missing targetUrl or method in request." });
        }

        // 🔒 Allow-list the target host — reject anything not on our NetSuite account.
        let targetHost;
        try {
            targetHost = new URL(targetUrl).host;
        } catch (e) {
            return res.status(400).send({ error: "Invalid targetUrl." });
        }
        if (!NS_ALLOWED_HOSTS.includes(targetHost)) {
            return res.status(403).send({ error: "targetUrl host is not allowed." });
        }

        const creds = {
            account: NS_ACCOUNT.value(),
            consumerKey: NS_CONSUMER_KEY.value(),
            consumerSecret: NS_CONSUMER_SECRET.value(),
            tokenId: NS_TOKEN_ID.value(),
            tokenSecret: NS_TOKEN_SECRET.value()
        };

        const authHeader = generateNetSuiteHeader(method, targetUrl, creds);

        const fetchOptions = {
            method: method,
            headers: {
                "Authorization": authHeader,
                "Content-Type": "application/json",
                "Prefer": method === 'POST' && targetUrl.includes('/record/') ? 'return=representation' : 'transient'
            }
        };

        if (payload && method !== 'GET') {
            fetchOptions.body = JSON.stringify(payload);
        }

        const response = await fetch(targetUrl, fetchOptions);
        const textData = await response.text();
        const data = textData ? JSON.parse(textData) : {};

        if (!response.ok) {
            return res.status(response.status).send(data);
        }

        return res.status(200).send(data);

    } catch (error) {
        console.error("Cloud Proxy Error:", error);
        return res.status(500).send({ error: error.message });
    }
});


// ============================================================================
// 3. USER DIRECTORY PROJECTION (SANITIZED, NON-PIN)
// ============================================================================
//
// hq_users doc id IS the PIN and each doc stores the PIN field, so exposing it to every authed
// operator lets anyone enumerate every PIN (incl. super admin) and impersonate them. Client apps
// only need name/role (+ the superAdmin flag) for display joins and the finishing floor roster —
// never the PIN. So we mirror hq_users into a sanitized `directory` collection that carries ONLY
// { name, role, superAdmin }, keyed by a hash of the PIN (never the PIN itself). Clients read
// `directory`; `hq_users` can then be locked to admins. Both functions use the Admin SDK, which
// bypasses Firestore rules — so `directory` is server-write-only (rules: allow write: if false).

// Deterministic opaque id — hash of the hq_users doc id (the PIN). Never reversible to the PIN,
// but stable so updates/deletes map 1:1.
const directoryId = (hqUserId) => crypto.createHash('sha256').update(String(hqUserId)).digest('hex').slice(0, 24);

const projectUser = (data) => ({
    name: (data && data.name) || 'Unknown',
    role: (data && data.role) || 'operator',
    superAdmin: !!(data && data.superAdmin === true),
});

// Keep `directory` in lock-step with every hq_users create/update/delete.
exports.mirrorUserToDirectory = onDocumentWritten('hq_users/{userId}', async (event) => {
    const db = admin.firestore();
    const id = directoryId(event.params.userId);
    const after = event.data && event.data.after;
    if (!after || !after.exists) {
        await db.collection('directory').doc(id).delete().catch(() => {});
        return;
    }
    await db.collection('directory').doc(id).set(projectUser(after.data()));
});

// One-time / idempotent backfill of the projection for all EXISTING users. Admin-gated; invoked
// from the HQ Admin tab ("Sync Directory" button). Safe to re-run.
exports.backfillUserDirectory = onCall({ enforceAppCheck: true }, async (request) => {
    const role = String((request.auth && request.auth.token && request.auth.token.role) || '').toLowerCase();
    if (!['admin', 'superadmin'].includes(role)) {
        throw new HttpsError('permission-denied', 'Admins only.');
    }
    const db = admin.firestore();
    const snap = await db.collection('hq_users').get();
    const writes = [];
    snap.forEach((doc) => {
        writes.push(db.collection('directory').doc(directoryId(doc.id)).set(projectUser(doc.data())));
    });
    await Promise.all(writes);
    return { synced: writes.length };
});


// ============================================================================
// 4. CUSTOMER PORTAL (BFF)
// ============================================================================
//
// portal.classicalelements.com is a separate slim frontend; customers authenticate with Firebase
// email/password and carry { customer: true, customerId: 'CUST-…' } custom claims. They NEVER read
// Firestore directly — firestore.rules deny any token carrying the 'customer' claim, and every
// portal read goes through these functions, which shape sanitized payloads server-side (no costs,
// no vendor data, no other customers, no internal notes). Staff manage portal users from the CRM
// (External Co-Op tab → Portal Access panel).

const assertStaffAdmin = (request) => {
    const role = String((request.auth && request.auth.token && request.auth.token.role) || '').toLowerCase();
    if (!['admin', 'superadmin'].includes(role)) {
        throw new HttpsError('permission-denied', 'Admins only.');
    }
};

const assertPortalCustomer = (request) => {
    const t = (request.auth && request.auth.token) || {};
    if (t.customer !== true || !t.customerId) {
        throw new HttpsError('permission-denied', 'Portal customers only.');
    }
    return String(t.customerId);
};

// Create a portal login for a person at a customer account. Returns a one-time password-setup
// link the admin hands to the client (Firebase's password-reset flow doubles as set-first-password).
exports.createPortalUser = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const { customerId, email, name } = request.data || {};
    const custId = String(customerId || '').trim();
    const mail = String(email || '').trim().toLowerCase();
    if (!custId.startsWith('CUST-')) throw new HttpsError('invalid-argument', 'customerId must be a CUST- record id.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new HttpsError('invalid-argument', 'A valid email is required.');

    const db = admin.firestore();
    const crm = await db.collection('crm_records').doc(custId).get();
    if (!crm.exists) throw new HttpsError('not-found', `CRM record ${custId} not found.`);

    let userRec;
    try {
        userRec = await admin.auth().createUser({
            email: mail,
            displayName: String(name || '').trim() || mail,
            // Unguessable placeholder; the client sets their real password via the setup link.
            password: crypto.randomBytes(24).toString('base64url'),
        });
    } catch (e) {
        if (e.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'That email already has a login. Remove it first or use "Copy setup link" to re-invite.');
        }
        throw new HttpsError('internal', e.message || 'Could not create user.');
    }

    await admin.auth().setCustomUserClaims(userRec.uid, { customer: true, customerId: custId });
    await db.collection('portal_users').doc(userRec.uid).set({
        email: mail,
        name: String(name || '').trim() || mail,
        customerId: custId,
        active: true,
        createdAt: Date.now(),
        createdBy: String((request.auth.token && request.auth.token.name) || 'admin'),
    });

    const setupLink = await admin.auth().generatePasswordResetLink(mail);
    return { uid: userRec.uid, setupLink };
});

// Fresh password-setup / reset link for an existing portal user (re-invites, forgotten passwords).
exports.getPortalUserSetupLink = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const uid = String((request.data || {}).uid || '');
    const doc = await admin.firestore().collection('portal_users').doc(uid).get();
    if (!doc.exists) throw new HttpsError('not-found', 'Portal user not found.');
    const setupLink = await admin.auth().generatePasswordResetLink(doc.data().email);
    return { setupLink };
});

// Enable/disable a portal login without deleting it (disabled users cannot sign in).
exports.setPortalUserStatus = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const { uid, active } = request.data || {};
    const id = String(uid || '');
    const doc = await admin.firestore().collection('portal_users').doc(id).get();
    if (!doc.exists) throw new HttpsError('not-found', 'Portal user not found.');
    await admin.auth().updateUser(id, { disabled: active !== true });
    await admin.firestore().collection('portal_users').doc(id).set({ active: active === true }, { merge: true });
    return { ok: true };
});

// Permanently remove a portal login.
exports.deletePortalUser = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const uid = String((request.data || {}).uid || '');
    const doc = await admin.firestore().collection('portal_users').doc(uid).get();
    if (!doc.exists) throw new HttpsError('not-found', 'Portal user not found.');
    await admin.auth().deleteUser(uid).catch((e) => {
        if (e.code !== 'auth/user-not-found') throw new HttpsError('internal', e.message);
    });
    await admin.firestore().collection('portal_users').doc(uid).delete();
    return { ok: true };
});

// ---- Customer-facing reads ----

// Firestore 'in' queries cap at 30 values.
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// Quote lines safe to show the customer: their own quoted names/qty/prices, minus internal
// bookkeeping rows. NEVER include costs, partHandling, or internal ids.
const sanitizeBreakdown = (cpqData) => ((cpqData && cpqData.breakdown) || [])
    .filter((l) => l && !l.isHeader && !l.isDiscount && !l.isNetLine)
    .map((l) => ({ name: l.name || '', qty: l.qty || 0, price: l.price ?? null, total: l.total ?? null }));

// Customer-friendly stage from the floor-doc join (mirrors RTG Dispatch's rollup precedence:
// finishing/shop presence wins, else the SO's own status).
const rollupStage = (so, shopDocs, finDocs) => {
    const keys = new Set([so.soId, so.id, so.hqJobId].filter(Boolean).map(String));
    const mine = (d) => [d.orderKey, d.salesOrderId, d.quoteId].filter(Boolean).map(String).some((k) => keys.has(k));
    const shop = shopDocs.find(mine);
    const fin = finDocs.find(mine);
    const shopStatus = shop ? String(shop.status || 'Pending') : null;
    const finStatus = fin ? String(fin.currentPhase || fin.stepStatus || 'Setup') : null;
    const done = (s) => /complete|done|shipped/i.test(String(s || ''));
    if (done(finStatus) || (fin && fin.sentToPickPack)) return 'Preparing to ship';
    if (finStatus) return 'Finishing';
    if (shopStatus && !done(shopStatus)) return 'In production';
    if (done(shopStatus)) return 'Finishing';
    if (String(so.status) === 'Dispatched' || so.autoSplit) return 'In production';
    return 'Order received';
};

// Everything the signed-in customer may see about their quotes and orders — shaped here, filtered
// by the customerId CLAIM (never by anything the browser sends).
exports.portalMyOrders = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const db = admin.firestore();

    // Their quotes.
    const jobsSnap = await db.collection('jobs').where('customer.id', '==', customerId).get();
    const jobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const jobIds = jobs.map((j) => j.jobId || j.id).filter(Boolean);

    // Their sales orders: ERP-pulled SOs carry no customerId but link via hqJobId → their quote;
    // QuickShip SOs carry customerId directly.
    const soDocs = [];
    for (const ids of chunk(jobIds, 30)) {
        const s = await db.collection('hq_sales_orders').where('hqJobId', 'in', ids).get();
        s.forEach((d) => soDocs.push({ id: d.id, ...d.data() }));
    }
    const qsSnap = await db.collection('hq_sales_orders').where('customerId', '==', customerId).get();
    qsSnap.forEach((d) => { if (!soDocs.some((x) => x.id === d.id)) soDocs.push({ id: d.id, ...d.data() }); });

    // Floor docs for the stage rollup, joined by the same keys RTG Dispatch uses.
    const joinKeys = [...new Set(soDocs.flatMap((so) => [so.soId, so.id, so.hqJobId]).filter(Boolean).map(String))];
    const shopDocs = []; const finDocs = [];
    for (const keys of chunk(joinKeys, 30)) {
        const [sh, fi] = await Promise.all([
            db.collection('shop_custom_orders').where('orderKey', 'in', keys).get(),
            db.collection('fin_workorders').where('orderKey', 'in', keys).get(),
        ]);
        sh.forEach((d) => shopDocs.push(d.data()));
        fi.forEach((d) => finDocs.push(d.data()));
    }

    const orderedJobIds = new Set(soDocs.map((so) => String(so.hqJobId || '')).filter(Boolean));

    return {
        quotes: jobs
            .filter((j) => !orderedJobIds.has(String(j.jobId || j.id)))
            .map((j) => ({
                id: j.jobId || j.id,
                name: j.jobName || 'Quote',
                sidemark: j.sidemark || '',
                status: j.status || 'CONFIGURED',
                date: j.dateSaved || null,
                total: (j.cpqData && j.cpqData.totalPrice) ?? null,
                shipping: j.shippingAmount ?? null,
                lines: sanitizeBreakdown(j.cpqData),
            })),
        orders: soDocs.map((so) => {
            const job = jobs.find((j) => String(j.jobId || j.id) === String(so.hqJobId || ''));
            return {
                id: so.soId || so.id,
                name: (job && job.jobName) || so.jobName || 'Order',
                sidemark: (job && job.sidemark) || '',
                date: so.reqDate || so.createdDate || null,
                total: (job && job.cpqData && job.cpqData.totalPrice) ?? null,
                stage: rollupStage(so, shopDocs, finDocs),
                lines: job ? sanitizeBreakdown(job.cpqData)
                    : ((so.lines || []).map((l) => ({ name: l.name || l.erp || '', qty: l.qty || 0, price: null, total: null }))),
            };
        }),
    };
});

// The customer's showroom, driven by their ASSIGNED CPQ FLOWS (crm_records.portalFlowIds — set in
// the CRM Portal Access panel). The flow is the entitlement unit: its linked assembly (and later,
// that assembly's BOM) defines everything the customer may see. Each assigned flow with a linked
// assembly + GLB becomes one showroom item. NEVER returns cost/vendor data — price shown is the
// customer's clientSalesPrice on the assembly (fallback: item base price, else no price).
exports.portalCatalog = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const db = admin.firestore();

    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const crmName = String(crm.name || '').toLowerCase();
    const flowIds = Array.isArray(crm.portalFlowIds) ? crm.portalFlowIds.filter(Boolean) : [];
    const matchesCustomer = (row) => {
        const rid = String((row && row.customerId) || '');
        return rid === customerId || (!!crmName && rid.toLowerCase() === crmName);
    };

    // Sanitized finish palette — name/code/texture only; no vendor, multiplier, or cost.
    const mf = await db.collection('system').doc('master_finishes').get();
    const finishes = ((mf.exists && mf.data().finishes) || [])
        .filter((f) => f && f.textureUrl)
        .map((f) => ({ id: f.id, name: f.name || f.code || 'Finish', code: f.code || '', textureUrl: f.textureUrl }));

    if (flowIds.length === 0) return { items: [], finishes, reason: 'NO_FLOWS' };

    const flowSnaps = await db.getAll(...flowIds.map((id) => db.collection('cpq_flows').doc(id)));
    const flows = flowSnaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }));

    const assemblyIds = [...new Set(flows.map((f) => f.linkedAssemblyId).filter(Boolean))];
    const asmSnaps = assemblyIds.length ? await db.getAll(...assemblyIds.map((id) => db.collection('Approved_Designs').doc(id))) : [];
    const assemblies = new Map(asmSnaps.filter((s) => s.exists).map((s) => [s.id, s.data()]));

    const items = [];
    for (const flow of flows) {
        const asm = flow.linkedAssemblyId ? assemblies.get(flow.linkedAssemblyId) : null;
        const cadUrl = asm && asm.manufacturingSpecs && asm.manufacturingSpecs.cadUrl;
        if (!cadUrl) continue; // a flow without a renderable assembly has nothing to show (yet)
        const cp = Array.isArray(asm.clientPricing) ? asm.clientPricing.find(matchesCustomer) : null;
        const base = asm.manufacturingSpecs && asm.manufacturingSpecs.basePrice;
        const priceRaw = cp ? (cp.clientSalesPrice ?? cp.price ?? base) : base;
        const price = (priceRaw === undefined || priceRaw === null || priceRaw === '') ? null : Number(priceRaw);
        items.push({
            id: flow.linkedAssemblyId,
            flowId: flow.id,
            name: flow.name || asm.itemName || 'Product',
            sku: (cp && cp.clientSku) || asm.legacyErpId || asm.itemId || '',
            cadUrl,
            price: Number.isFinite(price) ? price : null,
        });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));

    return { items, finishes };
});


// ---- Client configurator (portal Vision/CPQ) ------------------------------------------------
// Returns ONE assigned flow, sanitized for the portal's render engine: the flow steps (geometry/
// node maps, finish targeting — no pricing), the linked assembly's GLB + node clusters, and the
// finish palette. Entitlement is enforced: the flow must be in the customer's crm_records
// .portalFlowIds. NEVER returns cost/vendor data or internal option prices.
const sanitizeStep = (s) => ({
    id: s.id,
    title: s.title || '',
    type: s.type || '',
    stepRole: s.stepRole || '',
    position: s.position || '',
    sizeAxis: s.sizeAxis || '',
    sizeFamily: s.sizeFamily || '',
    targetNodes: s.targetNodes || '',
    finishTargetNodes: s.finishTargetNodes || '',
    finishDataSource: s.finishDataSource || '',
    finishAllowedOptions: s.finishAllowedOptions || null,
    dataSource: s.dataSource || '',
    allowedOptions: s.allowedOptions || null, // finish/option ids this step is scoped to
    geometryMap: s.geometryMap || null,
    subGeometryMap: s.subGeometryMap || null,
    mountSelector: s.mountSelector || null,
    mountPosition: s.mountPosition || '',
    hideQty: !!s.hideQty,
    isCenterClone: !!s.isCenterClone,
    styleOptions: (s.styleOptions || []).map((o) => ({
        optId: o.optId || o.partId || '', partId: o.partId || '', partName: o.partName || o.label || '',
        label: o.label || o.partName || '', targetNode: o.targetNode || '', finalImageUrl: o.finalImageUrl || o.imageUrl || '',
        sizeValue: o.sizeValue ?? null, sizeScale: o.sizeScale ?? null, location: o.location || '', position: o.position || '',
        finishAllowedOptions: o.finishAllowedOptions || null,
        hidesBracket: !!o.hidesBracket,
        isReturn: !!o.isReturn,
    })),
    subOptions: (s.subOptions || []).map((o) => ({
        optId: o.optId || o.partId || '', partId: o.partId || '', partName: o.partName || o.label || '',
        label: o.label || o.partName || '', targetNode: o.targetNode || '', location: o.location || '', position: o.position || '',
    })),
});

exports.portalFlow = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const flowId = String((request.data || {}).flowId || '');
    if (!flowId) throw new HttpsError('invalid-argument', 'flowId is required.');

    const db = admin.firestore();
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const allowed = Array.isArray(crm.portalFlowIds) ? crm.portalFlowIds : [];
    if (!allowed.includes(flowId)) throw new HttpsError('permission-denied', 'This product is not enabled on your account.');

    const flowSnap = await db.collection('cpq_flows').doc(flowId).get();
    if (!flowSnap.exists) throw new HttpsError('not-found', 'Product configuration not found.');
    const flow = flowSnap.data();

    let assembly = null;
    if (flow.linkedAssemblyId) {
        const asmSnap = await db.collection('Approved_Designs').doc(flow.linkedAssemblyId).get();
        if (asmSnap.exists) {
            const a = asmSnap.data();
            const ms = a.manufacturingSpecs || {};
            const crmName = String(crm.name || '').toLowerCase();
            const cp = Array.isArray(a.clientPricing) ? a.clientPricing.find((r) => {
                const rid = String((r && r.customerId) || '');
                return rid === customerId || (!!crmName && rid.toLowerCase() === crmName);
            }) : null;
            const startRaw = cp ? (cp.clientSalesPrice ?? cp.price ?? ms.basePrice) : ms.basePrice;
            const startingPrice = (startRaw === undefined || startRaw === null || startRaw === '') ? null : Number(startRaw);
            assembly = {
                cadUrl: ms.cadUrl || null,
                nodeClusters: (a.nodeClusters || []).map((c) => ({ id: c.id, location: c.location || '', position: c.position || '', category: c.category || '', nodes: c.nodes || c.meshes || [] })),
                startingPrice: Number.isFinite(startingPrice) ? startingPrice : null,
            };
        }
    }

    // Finish palette (in-house + outsourced), sanitized. code/name let the portal compute the same
    // PBR response as studioScene; textureUrl drives the map swap. No cost/vendor fields.
    const mf = await db.collection('system').doc('master_finishes').get();
    const inhouse = ((mf.exists && mf.data().finishes) || [])
        .filter((f) => f && f.textureUrl)
        .map((f) => ({ id: f.id, name: f.name || f.code || 'Finish', code: f.code || '', textureUrl: f.textureUrl, bomSuffix: f.bomSuffix || '', pbr: f.pbr || null, outsourced: false }));
    const outSnap = await db.collection('hq_outsource_finishes').get();
    const outsourced = outSnap.docs.map((d) => d.data()).filter((f) => f && f.textureUrl)
        .map((f) => ({ id: f.id, name: f.name || f.code || 'Finish', code: f.code || '', textureUrl: f.textureUrl, bomSuffix: f.bomSuffix || '', pbr: f.pbr || null, outsourced: true }));
    const finishes = [...inhouse, ...outsourced];

    return {
        flow: {
            id: flowId,
            name: flow.name || 'Product',
            steps: (flow.steps || []).map(sanitizeStep),
            hiddenClusters: flow.hiddenClusters || [],
            hiddenNodes: flow.hiddenNodes || [],
        },
        assembly,
        finishes,
    };
});

// A customer submits a configured product as a QUOTE REQUEST. It lands as a jobs doc flagged
// 'PORTAL_REQUEST' for the team to price and confirm in CPQ — nothing is priced or pushed here.
exports.portalQuoteRequest = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const { flowId, flowName, selections, note } = request.data || {};
    const db = admin.firestore();
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const allowed = Array.isArray(crm.portalFlowIds) ? crm.portalFlowIds : [];
    if (!allowed.includes(String(flowId || ''))) throw new HttpsError('permission-denied', 'Not enabled on your account.');

    const email = String((request.auth.token && request.auth.token.email) || '');
    const ref = db.collection('jobs').doc();
    await ref.set({
        jobId: ref.id,
        brandId: crm.brandId || null,
        status: 'PORTAL_REQUEST',
        source: 'PORTAL',
        customer: { id: customerId, name: crm.name || '' },
        jobName: `${flowName || 'Portal request'} — ${crm.name || ''}`.trim(),
        portalRequest: {
            flowId: String(flowId || ''),
            flowName: flowName || '',
            selections: selections || {},
            note: String(note || '').slice(0, 2000),
            byEmail: email,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        dateSaved: new Date().toISOString(),
    });
    return { ok: true, id: ref.id };
});
