const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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

// OUTSIDE COLLABORATORS (Stuart 2026-07-25: "an outside engineer I want to join in"). Adding a
// contractor's domain to the list above would admit EVERY address at that provider — gmail.com
// would be catastrophic. So exceptions are granted per EXACT EMAIL: an admin flags one
// staff_logins record `external`, and only that address passes. The record must still be active,
// and an optional expiresAt makes the access self-revoking when the engagement ends.
// Company users never reach this lookup — it runs only after the domain check fails.
const externalAccessAllowed = async (email) => {
    if (!email) return false; // never let an email-less token (e.g. a replayed PIN token) match
    const snap = await admin.firestore().collection('staff_logins').where('email', '==', email).limit(1).get();
    if (snap.empty) return false;
    const d = snap.docs[0].data() || {};
    if (d.external !== true || d.active === false) return false;
    if (d.expiresAt && Date.now() > Number(d.expiresAt)) return false;
    return true;
};

exports.authenticatePin = onCall({
    enforceAppCheck: true, // 🛡️ Requires a valid App Check (reCAPTCHA) token
    cors: true,
    minInstances: 1 // always warm — the 7am login rush never eats a cold start
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
    if (!ALLOWED_EMAIL_DOMAINS.includes(outerDomain) && !(await externalAccessAllowed(outerEmail))) {
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

// Only our own NetSuite account's hosts may ever be proxied. Without this, an authenticated
// caller could point the OAuth-signed relay at an arbitrary URL.
// TWO hosts, both account 3728153 — the note that once claimed RESTlets share the SuiteTalk
// host was wrong, and that mistake silently blocked every RESTlet call from the 2026-07
// hardening onward: the WMS assembly builds (Convert /P and Ring Packs) both post through
// ce_convert_build_restlet and were failing with "targetUrl host is not allowed"
// (Stuart 2026-07-28: "no go on the build").
//   • *.suitetalk.api.netsuite.com — SuiteTalk REST records + SuiteQL
//   • *.restlets.api.netsuite.com  — SuiteScript RESTlets
const NS_ALLOWED_HOSTS = [
    '3728153.suitetalk.api.netsuite.com',
    '3728153.restlets.api.netsuite.com',
];

// ============================================================================
// LAYER 1 — NETSUITE CONCURRENCY SHAPING (Stuart 2026-07-16)
// ============================================================================
// NetSuite's concurrency governance is ACCOUNT-WIDE (~5 concurrent requests on a
// standard tier, shared by every user and integration). Every app call already
// funnels through this one proxy, so the proxy is the traffic cop:
//   • maxInstances: 1 + high per-instance concurrency → ONE process sees all
//     traffic, so the in-process gate below is a true global limit.
//   • Semaphore: at most NS_MAX_CONCURRENT calls out to NetSuite; the rest wait
//     FIFO (users see a slightly slower response instead of a 429 error).
//   • Retry with backoff on 429/503 that still slip through (other integrations
//     share the same account pool).
//   • 30s cache + in-flight coalescing for READS (GET + SuiteQL): four people
//     pulling the same stock ask NetSuite once. Any successful WRITE flushes
//     the cache so a post-push re-pull is never stale.
const NS_MAX_CONCURRENT = 4;      // outbound calls to NetSuite at once
const NS_QUEUE_MAX = 300;         // waiting requests beyond this are rejected fast
const NS_QUEUE_WAIT_MS = 45000;   // max time a request may wait for a slot
const NS_READ_TTL_MS = 30000;     // read-cache lifetime
const NS_CACHE_MAX = 120;         // read-cache entries (oldest evicted)

let nsActive = 0;
const nsWaiters = [];
const nsGateAcquire = () => new Promise((resolve, reject) => {
    if (nsActive < NS_MAX_CONCURRENT) { nsActive++; return resolve(); }
    if (nsWaiters.length >= NS_QUEUE_MAX) {
        return reject(Object.assign(new Error('NetSuite queue is full'), { nsQueue: true }));
    }
    const w = { resolve, reject, timer: null };
    w.timer = setTimeout(() => {
        const i = nsWaiters.indexOf(w);
        if (i >= 0) nsWaiters.splice(i, 1);
        reject(Object.assign(new Error('Timed out waiting for a NetSuite slot'), { nsQueue: true }));
    }, NS_QUEUE_WAIT_MS);
    nsWaiters.push(w);
});
const nsGateRelease = () => {
    const w = nsWaiters.shift();
    if (w) { clearTimeout(w.timer); w.resolve(); } // slot hands off directly to the next waiter
    else nsActive = Math.max(0, nsActive - 1);
};

const nsReadCache = new Map();  // key -> { status, text, expires }
const nsInflight = new Map();   // key -> Promise<{status, text}> (coalesce identical concurrent reads)
const nsIsRead = (method, targetUrl) =>
    method === 'GET' || (method === 'POST' && targetUrl.includes('/services/rest/query/v1/suiteql'));
const nsCacheKey = (method, targetUrl, payload) =>
    crypto.createHash('sha256').update(method + '|' + targetUrl + '|' + JSON.stringify(payload || null)).digest('hex');
const nsCacheGet = (key) => {
    const e = nsReadCache.get(key);
    if (!e) return null;
    if (Date.now() > e.expires) { nsReadCache.delete(key); return null; }
    return e;
};
const nsCacheSet = (key, status, text) => {
    if (text && text.length > 1500000) return; // don't hold giant result sets in memory
    if (nsReadCache.size >= NS_CACHE_MAX) nsReadCache.delete(nsReadCache.keys().next().value);
    nsReadCache.set(key, { status, text, expires: Date.now() + NS_READ_TTL_MS });
};

exports.netsuiteProxy = onRequest({
    cors: true,
    secrets: [NS_ACCOUNT, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET],
    // ONE instance handles all traffic (calls are I/O-bound, so 80 concurrent requests in a
    // single Node process is light work) — this is what makes the gate above account-global.
    // 120s ceiling gives a queued request room: up to 45s in line + the NetSuite call + retries.
    maxInstances: 1,
    minInstances: 1, // always warm — first NetSuite call of the day skips the cold start (~$/mo)
    concurrency: 80,
    timeoutSeconds: 120,
    memory: '512MiB'
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

        const isRead = nsIsRead(method, targetUrl);
        const cacheKey = isRead ? nsCacheKey(method, targetUrl, payload) : null;

        // Read cache: an identical GET/SuiteQL inside 30s answers from memory — no NetSuite slot.
        if (isRead) {
            const hit = nsCacheGet(cacheKey);
            if (hit) return res.status(hit.status).send(hit.text ? JSON.parse(hit.text) : {});
            const inflight = nsInflight.get(cacheKey);
            if (inflight) {
                const r = await inflight; // identical read already on the wire — share its answer
                return res.status(r.ok ? 200 : r.status).send(r.text ? JSON.parse(r.text) : {});
            }
        }

        // One NetSuite call, retried on 429/503 (the account pool is shared with any other
        // integrations). OAuth nonce/timestamp must be fresh PER ATTEMPT, so the auth header
        // is generated inside the loop.
        const doNsCall = async () => {
            let last = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                if (attempt) await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt - 1) + Math.random() * 400));
                const fetchOptions = {
                    method: method,
                    headers: {
                        "Authorization": generateNetSuiteHeader(method, targetUrl, creds),
                        "Content-Type": "application/json",
                        "Prefer": method === 'POST' && targetUrl.includes('/record/') ? 'return=representation' : 'transient'
                    }
                };
                if (payload && method !== 'GET') {
                    fetchOptions.body = JSON.stringify(payload);
                }
                const response = await fetch(targetUrl, fetchOptions);
                const text = await response.text();
                last = { status: response.status, ok: response.ok, text, location: response.headers.get('location') || '' };
                if (response.status !== 429 && response.status !== 503) break;
            }
            return last;
        };

        const run = (async () => {
            await nsGateAcquire();
            try { return await doNsCall(); }
            finally { nsGateRelease(); }
        })();
        run.catch(() => {}); // mark handled so a coalesced follower's rejection never goes unobserved

        if (isRead) nsInflight.set(cacheKey, run);
        let result;
        try {
            result = await run;
        } finally {
            if (isRead) nsInflight.delete(cacheKey);
        }

        if (result.ok) {
            if (isRead) nsCacheSet(cacheKey, result.status, result.text);
            else nsReadCache.clear(); // a write changed NetSuite state — never serve a pre-write read
        }

        // NetSuite answers a record it has just MADE with no body and the new record's address in its Location
        // header (it does not honour return=representation on a create). That header is the only place the new id
        // is said, and it stopped here — so a body-less write answer carries it on as `location` (Stuart 2026-10-17:
        // the counter made Baker Stone Studio twice after the first answer said nothing). The outbox worker below
        // reads the same header for its own writes.
        const data = result.text ? JSON.parse(result.text) : (!isRead && result.location ? { location: result.location } : {});
        return res.status(result.ok ? 200 : result.status).send(data);

    } catch (error) {
        if (error && error.nsQueue) {
            // The gate rejected (queue full / waited too long) — nothing was sent to NetSuite.
            return res.status(503).send({ error: "NetSuite is very busy right now — this request waited in line too long and was NOT posted. Wait a few seconds and try again." });
        }
        console.error("Cloud Proxy Error:", error);
        return res.status(500).send({ error: error.message });
    }
});


// ============================================================================
// 2b. NS OUTBOX WORKER — LAYER 2 STAGED WRITES (Stuart 2026-07-16)
// ============================================================================
// Clients enqueue NetSuite WRITES into Firestore `ns_outbox` (see
// src/components/Shared/nsOutbox.js) instead of posting live. This worker
// drains the queue once a minute, STRICTLY SERIAL with pacing — the proxy's
// gate above allows 4 concurrent, so 4 + this 1 fits a 5-slot account.
//   • 429/5xx/network → retry with exponential backoff (30s → 15min cap),
//     up to NS_OB_MAX_ATTEMPTS, then FAILED.
//   • Validation 4xx → FAILED immediately (it won't fix itself; a human
//     retries from the 11.1 "NetSuite Sync Queue" panel after fixing data).
//   • Idempotency: the enqueue helper stamps `[ob:<docId>]` into the payload
//     memo; a retry after a mid-flight crash FIRST looks that marker up in
//     NetSuite and recovers the posted transaction instead of double-posting.
//   • writeBack: once posted, merge a patch onto an app doc and stamp the
//     NetSuite id/tran into named fields (e.g. hq_purchase_orders.nsPoId).
const NS_OB_MAX_ATTEMPTS = 6;
const nsObBackoffMs = (attempts) => Math.min(30000 * Math.pow(2, attempts), 15 * 60 * 1000);

exports.nsOutboxWorker = onSchedule({
    schedule: 'every 1 minutes',
    timeoutSeconds: 240,
    maxInstances: 1,
    secrets: [NS_ACCOUNT, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET]
}, async () => {
    const fdb = admin.firestore();
    const now = Date.now();
    const creds = {
        account: NS_ACCOUNT.value(),
        consumerKey: NS_CONSUMER_KEY.value(),
        consumerSecret: NS_CONSUMER_SECRET.value(),
        tokenId: NS_TOKEN_ID.value(),
        tokenSecret: NS_TOKEN_SECRET.value()
    };

    const nsCall = async (method, targetUrl, payload) => {
        const r = await fetch(targetUrl, {
            method,
            headers: {
                "Authorization": generateNetSuiteHeader(method, targetUrl, creds),
                "Content-Type": "application/json",
                "Prefer": method === 'POST' && targetUrl.includes('/record/') ? 'return=representation' : 'transient'
            },
            ...(payload && method !== 'GET' ? { body: JSON.stringify(payload) } : {})
        });
        const text = await r.text();
        let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch (e) { body = { raw: String(text).slice(0, 500) }; }
        return { status: r.status, ok: r.ok, body, location: r.headers.get('location') || '' };
    };
    const recoverByMarker = async (docId) => {
        try {
            // Matches BOTH marker generations: legacy `[ob:<full id>]` and the humanized
            // `[app push 07/20/26, 2:32 PM #<6-char id>]` (Shared/nsOutbox.js — keep in sync).
            const r = await nsCall('POST', 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql',
                { q: `SELECT id, tranid FROM transaction WHERE memo LIKE '%[ob:${docId}]%' OR memo LIKE '%#${String(docId).substring(0, 6)}]%'` });
            const row = r.ok && r.body.items && r.body.items[0];
            return row ? { nsId: String(row.id), nsTran: row.tranid || null } : null;
        } catch (e) { return null; }
    };
    const finishPosted = async (e, nsId, nsTran, note) => {
        // writeBack accepts one spec or an array (e.g. a WO stamps ids onto BOTH the
        // floor doc and the RTG record).
        const wbs = Array.isArray(e.writeBack) ? e.writeBack : (e.writeBack ? [e.writeBack] : []);
        for (const wb of wbs) {
            if (!(wb && wb.collection && wb.docId)) continue;
            const patch = { ...(wb.patch || {}) };
            if (wb.idField && nsId) patch[wb.idField] = String(nsId);
            if (wb.tranField && nsTran) patch[wb.tranField] = nsTran;
            await fdb.doc(`${wb.collection}/${wb.docId}`).set(patch, { merge: true }).catch(() => {});
        }
        await e.ref.update({ status: 'POSTED', postedAt: Date.now(), nsId: nsId || null, nsTran: nsTran || null, ...(note ? { note } : {}) });
    };
    const bumpRetry = async (e, errText) => {
        const attempts = (e.attempts || 0) + 1;
        if (attempts >= NS_OB_MAX_ATTEMPTS) {
            await e.ref.update({ status: 'FAILED', attempts, lastError: errText, failedAt: Date.now() });
        } else {
            await e.ref.update({ status: 'PENDING', attempts, lastError: errText, nextAttemptAt: Date.now() + nsObBackoffMs(attempts) });
        }
    };

    // Reclaim entries stuck PROCESSING >5 min (a crashed run). The marker check below
    // prevents a double-post when the crash happened AFTER NetSuite accepted the write.
    const stuck = await fdb.collection('ns_outbox').where('status', '==', 'PROCESSING').get();
    for (const d of stuck.docs) {
        if ((d.data().leasedAt || 0) < now - 5 * 60 * 1000) await d.ref.update({ status: 'PENDING' });
    }

    // ── ENTRIES THAT WAIT ON ANOTHER (2026-09-18, the bin move that follows a vendor receipt) ──────────
    // Written WAITING with `afterId` (Shared/nsOutbox). Released to PENDING only once that entry is
    // POSTED; failed — with the reason, so 11.1 shows it — if that entry FAILED, was CANCELLED or is gone.
    // FIFO alone is not enough: a receipt that fails does not stop the queue, and a bin move run behind a
    // failed receipt would move stock that was already on the shelf. ↻ RETRY on such a failed move sets it
    // PENDING as for any entry, so once the receipt is put right the move can be sent.
    try {
        const waiting = await fdb.collection('ns_outbox').where('status', '==', 'WAITING').limit(60).get();
        for (const d of waiting.docs) {
            const w = d.data();
            const dep = w.afterId ? await fdb.doc(`ns_outbox/${w.afterId}`).get() : null;
            const st = dep && dep.exists ? String(dep.data().status || '') : 'MISSING';
            if (st === 'POSTED') await d.ref.update({ status: 'PENDING', nextAttemptAt: Date.now(), releasedAt: Date.now() });
            else if (['FAILED', 'CANCELLED', 'MISSING'].includes(st)) {
                await d.ref.update({ status: 'FAILED', failedAt: Date.now(), lastError: `Not sent: the entry it follows (${w.afterId || 'none'}) is ${st}${dep && dep.exists && dep.data().label ? ` — ${dep.data().label}` : ''}. Fix that first, then retry this one.` });
            }
        }
    } catch (e) { console.warn('nsOutboxWorker: WAITING sweep failed', e && e.message); }

    // Due PENDING entries — equality-only query (no composite index needed); order in memory.
    const snap = await fdb.collection('ns_outbox').where('status', '==', 'PENDING').limit(60).get();
    const due = snap.docs
        .map(d => ({ ref: d.ref, id: d.id, ...d.data() }))
        .filter(e => (e.nextAttemptAt || 0) <= now)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .slice(0, 20);

    for (const e of due) {
        // Claim in a transaction so an overlapping run can never double-process.
        const claimed = await fdb.runTransaction(async (tx) => {
            const cur = await tx.get(e.ref);
            if (!cur.exists || cur.data().status !== 'PENDING') return false;
            tx.update(e.ref, { status: 'PROCESSING', leasedAt: Date.now() });
            return true;
        }).catch(() => false);
        if (!claimed) continue;

        try {
            const payloadStr = JSON.stringify(e.payload || {});
            const hasMarker = payloadStr.includes(`[ob:${e.id}]`) || payloadStr.includes(`#${String(e.id).substring(0, 6)}]`);
            // Recovery runs on ANY retried entry — attempts > 0 (worker retries) OR requeuedAt
            // (manual ↻ Retry / Re-queue) — so hammering the button can never double-post.
            if (((e.attempts || 0) > 0 || e.requeuedAt) && hasMarker && e.method === 'POST' && String(e.targetUrl).includes('/record/v1/')) {
                const rec = await recoverByMarker(e.id);
                if (rec) { await finishPosted(e, rec.nsId, rec.nsTran, 'recovered after retry — not double-posted'); continue; }
            }
            const r = await nsCall(e.method, e.targetUrl, e.payload);
            if (r.ok) {
                let nsId = r.body && r.body.id ? String(r.body.id) : '';
                let nsTran = (r.body && (r.body.tranId || r.body.tranid)) || null;
                if (!nsId && r.location) { const m = String(r.location).match(/\/(\d+)\s*$/); if (m) nsId = m[1]; }
                if ((!nsId || !nsTran) && hasMarker) {
                    const rec = await recoverByMarker(e.id);
                    if (rec) { nsId = nsId || rec.nsId; nsTran = nsTran || rec.nsTran; }
                }
                await finishPosted(e, nsId || null, nsTran, null);
            } else if (r.status === 429 || r.status >= 500) {
                await bumpRetry(e, `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`);
            } else {
                await e.ref.update({ status: 'FAILED', lastError: `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 900)}`, failedAt: Date.now() });
            }
        } catch (err) {
            await bumpRetry(e, String(err && err.message ? err.message : err).slice(0, 400)).catch(() => {});
        }
        await new Promise(r => setTimeout(r, 350)); // pacing — stay a polite single-file consumer
    }
});


// ============================================================================
// 2c. STOCK BUILD → NETSUITE WO COMPLETION (Route A close, Stuart 2026-07-16)
// ============================================================================
// RTG creates a REAL NetSuite work order when it releases a Sales-Snapshot stock
// WO to the finishing floor (the outbox worker stamps nsWoId/nsWoTran back onto
// the floor doc). This trigger watches the floor doc and, the moment the build's
// bake task completes (poleBake for pole WOs, spinBake for small parts), enqueues
// the WO COMPLETION through the same outbox: transform workorder →
// workordercompletion, qty = the QC good count (falls back to ordered qty), the
// built assembly received into the item's home bin when one is known. Components
// backflush from the NetSuite BOM. Partial/scrap: the remainder stays open on the
// NetSuite WO (visible in the snapshot's On-Ord) until finished or closed there.
// Server-side on purpose: tasks complete from several floor screens — this is the
// one choke point, and it can't be forgotten. Fires on every fin_workorders write,
// so the guards exit cheaply; nsCompletionQueued makes it once-only.
exports.onStockBuildDone = onDocumentWritten('fin_workorders/{woId}', async (event) => {
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    if (!after) return;
    // ── THE APP BUILDS EVERY NETSUITE WORK ORDER IT OPENS (Brief D · D2, audit §13 c) ─────────
    // The guard here used to read `orderType !== 'stock'`, which meant an Order Entry line's
    // anchor work order was opened by the app and closed by NOBODY. Stuart, asked who closes them:
    // "Closed by hand today. The app must build them." Prevention is the goal — every WO the app
    // opens, the app posts the build against.
    //
    // A sales-typed doc with NO nsWoId is untouched, exactly as before: a CPQ custom order's
    // NetSuite record is its SALES ORDER, and there is no work order to close.
    if (!after.nsWoId || after.nsCompletionQueued) return;
    if (after.orderType !== 'stock' && after.orderType !== 'sales') return;
    // ⚖ THE BUILD POSTS AT THE BIN SCAN, NOT AT THE BAKE (Stuart 2026-08-03: "the bin count is
    // already off as the assembly build populated the bin — this build should happen after
    // completion of painting AND the packing screen has scanned them to their bin").
    //
    // It used to fire the moment the bake task went Complete, which put finished goods on the
    // NetSuite books while the parts were still physically on a cart: the bin held stock nobody
    // could find, and the receive bin was a GUESS — the first entry of the item's comma-joined
    // bin list from the library, not where the parts actually went. Now the trigger waits for
    // packing to put them away, and receives into the bin that was actually scanned.
    //
    // Painting completion is unaffected and still happens where it did: the floor stamps
    // currentPhase 'Complete' when both streams finish, so the order reads COMPLETE on the
    // finishing screen and appears in the WMS packing queue immediately. Only the NetSuite
    // INVENTORY posting moved.
    if (after.packStatus !== 'Packed') return;
    // A STOCK build is PUT AWAY and always scans a bin; a SALES order is PACKED into a box and
    // ships, so it has no put-away bin and must not wait for one. The inventoryDetail below is
    // therefore omitted on a sales build, which is correct: the pieces are received and shipped in
    // the same breath, and the fulfilment that follows relieves them.
    const scannedBin = String(after.putawayBin || '').trim().toUpperCase();

    const fdb = admin.firestore();
    const woDocId = event.params.woId;
    // Idempotency by DETERMINISTIC ENTRY ID (2026-08-31, the WO11453 lesson): the old order —
    // stamp nsCompletionQueued, THEN create the entry — left a crash window where the doc was
    // stamped forever but no build ever queued. Now the outbox entry id derives from the doc id
    // (create() refuses a second), the entry is written FIRST, and the stamp follows. A re-fire
    // between the two steps just fails create() and stamps again — never a duplicate, never a
    // silent skip.

    const qty = Number(after.completedParts) > 0 ? Number(after.completedParts) : (Number(after.totalParts) || 1);
    // The bin the packer actually scanned is the truth. The library lookup below survives only as
    // a fallback for an order put away without one recorded.
    let bin = scannedBin;
    try {
        if (!bin && after.stockErpId) {
            const q = await fdb.collection('Approved_Designs').where('legacyErpId', '==', after.stockErpId).limit(1).get();
            // binLocation is the item sync's mergedBins — a COMMA-JOINED list of every bin the
            // item has balance rows in ("U S19-E2L-R4, M E5R-N16-R1"). A refName must be ONE
            // bin: take the first (2026-07-20 — the raw string 400'd every completion).
            if (!q.empty) bin = String((q.docs[0].data().manufacturingSpecs || {}).binLocation || '').split(',')[0].trim().toUpperCase();
            if (bin === 'UNASSIGNED') bin = '';
        }
    } catch (e) { /* bin optional — the queue entry fails visibly if NetSuite insists */ }

    // FLOW1 vs FLOW2 (Order Entry, StockViewTab :2465-2490). FLOW2 anchors on the finished
    // variant, so the build is the ordinary one. FLOW1 anchors on the BASE assembly — its memo
    // says so in words: "closes on the final assembly build (after mill + phosphate convert)" —
    // and `nsWoOnErp` / `nsWoOnInternalId` are stamped on the doc at creation to say which item
    // that is. The transform is against the WORK ORDER either way, so NetSuite resolves the item
    // itself; these fields are carried for the label and for the log, not to pick a different URL.
    const flow1 = after.orderType === 'sales' && !!after.nsWoOnErp;
    const buildOf = flow1 ? `${after.nsWoOnErp} (base assembly)` : (after.stockErpId || woDocId);
    const obRef = fdb.collection('ns_outbox').doc(`wocmpl-${woDocId.replace(/[^A-Za-z0-9_-]/g, '_')}`);
    try {
        await obRef.create({
        // NON-WIP work orders (CE's are) complete via a WO-LINKED ASSEMBLY BUILD — the record
        // the UI's "Create Build" button makes. workordercompletion is WIP-only and 400s with
        // "invalid work order" on these (learned 2026-07-21, WO11308-12).
        id: obRef.id, kind: 'workordercompletion',
        label: `Build NS WO ${after.nsWoTran || after.nsWoId} — ${buildOf} ×${qty}${after.orderType === 'sales' ? ' · SALES' : ''}`,
        sourceApp: after.orderType === 'sales' ? 'ORDER_ENTRY' : 'FINISHING',
        createdBy: `auto (${after.orderType === 'sales' ? 'packed' : 'put away'}${scannedBin ? ` · bin ${scannedBin}` : ''})`,
        targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/workorder/${after.nsWoId}/!transform/assemblyBuild`,
        method: 'POST',
        payload: {
            quantity: qty,
            memo: `${after.orderType === 'sales' ? `SO build ${woDocId}${flow1 ? ' (base)' : ''} packed` : `Stock build ${woDocId} put away`}${scannedBin ? ` ${scannedBin}` : ''} [app push ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit' })} #${obRef.id.slice(0, 6)}]`,
            ...(bin ? { inventoryDetail: { quantity: qty, inventoryAssignment: { items: [{ binNumber: { refName: bin }, quantity: qty }] } } } : {})
        },
        writeBack: { collection: 'fin_workorders', docId: woDocId, patch: { nsWoCompletionPosted: true }, idField: 'nsWoCompletionId', tranField: 'nsWoCompletionTran' },
        status: 'PENDING', attempts: 0, lastError: null, nsId: null, nsTran: null,
        createdAt: Date.now(), nextAttemptAt: Date.now(), leasedAt: null, postedAt: null
        });
    } catch (dupErr) { /* entry already exists — another fire won the race; nothing to do */ }
    await fdb.doc(`fin_workorders/${woDocId}`).set({ nsCompletionQueued: true }, { merge: true });
});


// ============================================================================
// 2d. MILL COMPLETE → THE ROOT'S NETSUITE BUILD (Brief D · D3, Stuart 2026-09-03)
// ============================================================================
// RTG has a manual ⛏ Mill Build button that posts a milled root's assembly build against the
// NetSuite work order the app opened for it. Manual means it gets forgotten, and a forgotten
// build leaves an open WO with committed components — the same hole D2 closes on the sales side.
//
// Brief C's C2 (334c9c3, live) made this possible by stamping the hq work order when the last
// milling op passes QC: floorPhase 'Complete', millGoodQty, millScrapQty, millCompletedAt/By. A
// FAILED op stamps floorPhase 'Failed' instead and never reaches this trigger.
//
// GATED BY BRAND, ON PURPOSE (Stuart: "default 3 for classical, other brands as needed when we get
// there"). system/wms_config.rootBuildAuto is a map of brand → true. Nothing fires for a brand
// that is not listed, so the manual button stays the path until someone deliberately turns a brand
// on — after watching three clean manual posts on CE, which is the threshold he set.
//
// Only spines RTG dispatched are stamped by C2 (the hq id derives from the shop doc's SHOP-<hqId>),
// so a hand-keyed shop order never triggers a build. That is correct and worth knowing: this
// automates RTG's button, not every milling job that ever happens.
const MILL_BUILD_BIN = 'RAW';   // where a mill build receives (Stuart 2026-09-29) — see the payload below
exports.onMillComplete = onDocumentWritten('hq_work_orders/{woId}', async (event) => {
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    if (!after) return;
    // Every condition is required, and each one is doing work:
    //   floorPhase Complete + millGoodQty>0  the mill finished and made something good (C2)
    //   nsWoId                                the app opened a NetSuite WO to close
    //   !nsRootBuildPosted / !nsRootBuildQueued  once only
    if (after.floorPhase !== 'Complete') return;
    const qty = Number(after.millGoodQty) || 0;
    if (qty <= 0 || !after.nsWoId) return;
    if (after.nsRootBuildPosted || after.nsRootBuildQueued) return;

    const fdb = admin.firestore();
    const woDocId = event.params.woId;
    const brand = String(after.brand || 'ce').toLowerCase();

    // THE FLAG IS READ AT FIRE TIME, not cached: turning a brand off must stop the next build, not
    // the one after the next deploy.
    let on = false;
    try {
        const cfg = await fdb.doc('system/wms_config').get();
        on = !!((cfg.exists && cfg.data().rootBuildAuto) || {})[brand];
    } catch (e) { on = false; }
    if (!on) {
        // Say so once, so "why did it not fire" is answerable without reading this file.
        if (!after.nsRootBuildSkipped) {
            await fdb.doc(`hq_work_orders/${woDocId}`).set({
                nsRootBuildSkipped: `auto-build off for brand ${brand} — post it from RTG's ⛏ Mill Build`,
                nsRootBuildSkippedAt: Date.now(),
            }, { merge: true }).catch(() => {});
        }
        return;
    }

    const internalId = after.nsWoOnInternalId || after.stockInternalId || after.nsItemId || null;
    if (!internalId) {
        await fdb.doc(`hq_work_orders/${woDocId}`).set({
            nsRootBuildSkipped: 'no NetSuite item id on the work order — sync it (11.1), then post from RTG',
            nsRootBuildSkippedAt: Date.now(),
        }, { merge: true }).catch(() => {});
        return;
    }

    // Deterministic id, the WO11453 lesson: create() refuses a second, the entry is written FIRST
    // and the stamp follows, so a re-fire between the two can never double-build.
    const obRef = fdb.collection('ns_outbox').doc(`rootbuild-${woDocId.replace(/[^A-Za-z0-9_-]/g, '_')}`);
    try {
        await obRef.create({
            id: obRef.id, kind: 'workordercompletion',
            label: `Root build — ${after.rootItem || after.itemCode || woDocId} ×${qty} (mill complete)`,
            sourceApp: 'SHOP', createdBy: `auto (mill complete${after.millCompletedBy ? ` · ${after.millCompletedBy}` : ''})`,
            targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/workorder/${after.nsWoId}/!transform/assemblyBuild`,
            method: 'POST',
            // THE MILL BUILD LANDS IN RAW (Stuart 2026-09-29: "when we complete the order it should build in
            // netsuite, have it default and build to the RAW bin and from there it gets either converted
            // for phosphate, sent to plater, or put in a storage bin depending on the demand"). A bin-tracked
            // root was refused without it — H2-138-TB3/TB4 (WO11575/WO11577): "Please configure the inventory
            // detail for the assembly item". The shape is the stock put-away build's, 164 of them posted
            // through this queue. RAW must exist at the brand's location; the frontend's copy of the name is
            // Shared/nsWorkOrder.MILL_BUILD_BIN (RTG's ⛏ Mill Build, the retry).
            payload: {
                quantity: qty,
                inventoryDetail: { inventoryAssignment: { items: [{ binNumber: { refName: MILL_BUILD_BIN }, quantity: qty }] }, quantity: qty },
                memo: `Mill build ${woDocId} ×${qty}${(Number(after.millScrapQty) || 0) > 0 ? ` (${after.millScrapQty} scrap)` : ''} → ${MILL_BUILD_BIN} [app push ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit' })} #${obRef.id.slice(0, 6)}]`,
            },
            writeBack: { collection: 'hq_work_orders', docId: woDocId, patch: { nsRootBuildPosted: true }, idField: 'nsRootBuildId', tranField: 'nsRootBuildTran' },
            status: 'PENDING', attempts: 0, lastError: null, nsId: null, nsTran: null,
            createdAt: Date.now(), nextAttemptAt: Date.now(), leasedAt: null, postedAt: null,
        });
    } catch (dupErr) { /* already queued by an earlier fire — nothing to do */ }
    await fdb.doc(`hq_work_orders/${woDocId}`).set({ nsRootBuildQueued: true, nsRootBuildQueuedAt: Date.now() }, { merge: true }).catch(() => {});
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

// TAKING A PAYMENT is for CSR, manager and admin (Stuart 2026-10-15) — a narrower door than
// assertStaffAdmin, which guards twenty-one functions including NetSuite posting and user
// administration. A rep at the show counter needs to charge a card, not to run the company.
const { canTakePayment } = require('./payRoles');
const assertCanTakePayment = (request) => {
    const role = String((request.auth && request.auth.token && request.auth.token.role) || '').toLowerCase();
    if (!canTakePayment(role)) {
        // Name the roles, so the next person reads the answer instead of guessing at it.
        throw new HttpsError('permission-denied', `Taking a payment is for CSR, manager and admin users — this login is "${role || 'none'}".`);
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

// ============================================================================
// 2b. STAFF DAILY SIGN-IN ACCOUNTS (OUTER GATE) — created from HQ Admin → User Matrix
// ============================================================================
//
// Every staff member needs TWO identities: the OuterGate email/password account (the daily
// sign-in, a real Firebase Auth user) and their hq_users PIN doc (role + permissions). The PIN
// side has always been managed in the Admin tab; the email side was hand-made in the Firebase
// console because creating an Auth user needs the Admin SDK, which a browser never has. These
// callables close that gap — same shape as the portal-user set above, minus the customer claims.
//
// STAFF ACCOUNTS GET NO CUSTOM CLAIMS: the outer session only proves "a real person from an
// allowed domain is here"; role/permissions still come from the PIN token authenticatePin mints.
// The domain check is enforced HERE because an account outside ALLOWED_EMAIL_DOMAINS would be
// created successfully and then be refused by authenticatePin forever — a silent dead end.
const STAFF_LOGINS = 'staff_logins';

const staffMirror = (uid, rec, extra) => Object.assign({
    uid,
    email: rec.email,
    name: rec.displayName || rec.email,
    active: rec.disabled !== true,
}, extra || {});

exports.createStaffLogin = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const { email, name, pin, external, expiresAt } = request.data || {};
    const mail = String(email || '').trim().toLowerCase();
    const who = String(name || '').trim();
    const linkPin = String(pin || '').trim();
    const isExternal = external === true;
    const expires = Number(expiresAt) > 0 ? Number(expiresAt) : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new HttpsError('invalid-argument', 'A valid email is required.');
    const domain = mail.split('@')[1] || '';
    // An off-domain address is allowed ONLY as an explicit outside-collaborator grant (per email,
    // never per domain — see externalAccessAllowed).
    if (!ALLOWED_EMAIL_DOMAINS.includes(domain) && !isExternal) {
        throw new HttpsError('invalid-argument',
            `${domain} is not a company domain. Tick "outside collaborator" to grant this ONE address access, or use a company email. Company domains: ${ALLOWED_EMAIL_DOMAINS.join(', ')}.`);
    }

    const db = admin.firestore();
    let userRec;
    let adopted = false;
    try {
        userRec = await admin.auth().createUser({
            email: mail,
            displayName: who || mail,
            password: crypto.randomBytes(24).toString('base64url'), // placeholder; they set their own via the link
        });
    } catch (e) {
        if (e.code !== 'auth/email-already-exists') throw new HttpsError('internal', e.message || 'Could not create the login.');
        // ADOPT: the original staff accounts were made by hand in the Firebase console, so they
        // exist in Auth with no mirror doc. Linking one here grants nothing new — it just makes an
        // account that already works manageable from the Admin tab.
        userRec = await admin.auth().getUserByEmail(mail);
        const claims = userRec.customClaims || {};
        if (claims.customer === true) throw new HttpsError('already-exists', 'That email is a CUSTOMER portal login — manage it on the customer\'s CRM card, not here.');
        adopted = true;
        if (who && who !== userRec.displayName) await admin.auth().updateUser(userRec.uid, { displayName: who });
    }

    await db.collection(STAFF_LOGINS).doc(userRec.uid).set(staffMirror(userRec.uid, { email: mail, displayName: who || userRec.displayName, disabled: userRec.disabled }, {
        pin: linkPin || null,
        createdAt: Date.now(),
        createdBy: String((request.auth.token && request.auth.token.name) || 'admin'),
        adopted,
        external: isExternal,
        expiresAt: expires,
    }), { merge: true });

    // Stamp the email onto the person's PIN doc so the directory shows who still needs a login.
    if (linkPin) await db.collection('hq_users').doc(linkPin).set({ outerEmail: mail, outerLoginUid: userRec.uid }, { merge: true });

    const setupLink = await admin.auth().generatePasswordResetLink(mail);
    return { uid: userRec.uid, setupLink, adopted };
});

// Fresh password-setup / reset link (new hires, forgotten passwords, re-invites).
exports.getStaffLoginSetupLink = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const uid = String((request.data || {}).uid || '');
    const snap = await admin.firestore().collection(STAFF_LOGINS).doc(uid).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Staff login not found.');
    return { setupLink: await admin.auth().generatePasswordResetLink(snap.data().email) };
});

// Disable/enable a daily sign-in without deleting it (a disabled account cannot pass the gate,
// which also kills PIN access — authenticatePin requires a fresh outer session).
exports.setStaffLoginStatus = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const { uid, active } = request.data || {};
    const id = String(uid || '');
    const snap = await admin.firestore().collection(STAFF_LOGINS).doc(id).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Staff login not found.');
    await admin.auth().updateUser(id, { disabled: active !== true });
    await admin.firestore().collection(STAFF_LOGINS).doc(id).set({ active: active === true }, { merge: true });
    return { ok: true };
});

// Extend, shorten or revoke an outside collaborator's access without deleting the account.
// Revoking (external:false) is instant and total for an off-domain address — the next PIN
// attempt fails the domain check with no exception to fall back on.
exports.setStaffLoginAccess = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const { uid, external, expiresAt } = request.data || {};
    const id = String(uid || '');
    const ref = admin.firestore().collection(STAFF_LOGINS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Staff login not found.');
    const patch = {};
    if (external !== undefined) patch.external = external === true;
    if (expiresAt !== undefined) patch.expiresAt = Number(expiresAt) > 0 ? Number(expiresAt) : null;
    await ref.set(patch, { merge: true });
    return { ok: true };
});

exports.deleteStaffLogin = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const uid = String((request.data || {}).uid || '');
    const db = admin.firestore();
    const snap = await db.collection(STAFF_LOGINS).doc(uid).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Staff login not found.');
    await admin.auth().deleteUser(uid).catch((e) => { if (e.code !== 'auth/user-not-found') throw new HttpsError('internal', e.message); });
    const pin = snap.data().pin;
    if (pin) await db.collection('hq_users').doc(String(pin)).set({ outerEmail: admin.firestore.FieldValue.delete(), outerLoginUid: admin.firestore.FieldValue.delete() }, { merge: true }).catch(() => {});
    await db.collection(STAFF_LOGINS).doc(uid).delete();
    return { ok: true };
});

// One-time reconciliation: list the Auth accounts on allowed company domains that have no mirror
// doc yet (every user Stuart made in the console) so the Admin tab can adopt them in one click.
exports.listUnlinkedStaffLogins = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const db = admin.firestore();
    const known = new Set((await db.collection(STAFF_LOGINS).get()).docs.map((d) => d.id));
    const found = [];
    let pageToken;
    do {
        const page = await admin.auth().listUsers(1000, pageToken);
        page.users.forEach((u) => {
            const mail = String(u.email || '').toLowerCase();
            const claims = u.customClaims || {};
            if (!mail || claims.customer === true || known.has(u.uid)) return;
            if (!ALLOWED_EMAIL_DOMAINS.includes(mail.split('@')[1] || '')) return;
            found.push({ uid: u.uid, email: mail, name: u.displayName || mail, active: u.disabled !== true });
        });
        pageToken = page.pageToken;
    } while (pageToken);
    return { users: found };
});

// Adopt the accounts listUnlinkedStaffLogins found — writes mirror docs only, changes nothing
// about the accounts themselves.
exports.adoptStaffLogins = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const uids = Array.isArray((request.data || {}).uids) ? request.data.uids.map(String) : [];
    const db = admin.firestore();
    let linked = 0;
    for (const uid of uids) {
        const u = await admin.auth().getUser(uid).catch(() => null);
        if (!u || (u.customClaims || {}).customer === true) continue;
        const mail = String(u.email || '').toLowerCase();
        if (!ALLOWED_EMAIL_DOMAINS.includes(mail.split('@')[1] || '')) continue;
        await db.collection(STAFF_LOGINS).doc(uid).set(staffMirror(uid, { email: mail, displayName: u.displayName, disabled: u.disabled }, {
            pin: null, adopted: true, createdAt: Date.now(),
            createdBy: String((request.auth.token && request.auth.token.name) || 'admin'),
        }), { merge: true });
        linked++;
    }
    return { linked };
});

// ---- Customer-facing reads ----

// Firestore 'in' queries cap at 30 values.
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

// Quote lines safe to show the customer: their own quoted names/qty/prices, minus internal
// bookkeeping rows. NEVER include costs, partHandling, or internal ids.
// `skuOf` maps our item code -> the CUSTOMER'S own part # (Stuart 2026-08-02: "customers will need
// to see their part# when loaded (ie. fabricut) on the sales orders"). Their number is the one they
// can act on — ours means nothing to their warehouse — so it rides every line we hand back.
const sanitizeBreakdown = (cpqData, skuOf) => ((cpqData && cpqData.breakdown) || [])
    .filter((l) => l && !l.isHeader && !l.isDiscount && !l.isNetLine)
    .map((l) => ({
        name: l.name || '',
        qty: l.qty || 0,
        price: l.price ?? null,
        total: l.total ?? null,
        sku: (typeof skuOf === 'function' ? skuOf(l.legacyErpId || l.partId) : '') || '',
    }));

// Their part #s for a set of our item codes, read from each item's clientPricing row. Matched the
// way CPQ and Quick Ship match — by CRM id OR by customer NAME — because rows have been entered
// both ways over the years. Chunked at 30 to respect Firestore's `in` limit.
const buildSkuLookup = async (db, customerId, crm, codes) => {
    const wanted = [...new Set((codes || []).map((c) => String(c || '').toUpperCase()).filter(Boolean))];
    if (!wanted.length) return () => '';
    const keys = new Set([customerId, crm && crm.name, crm && crm.companyName]
        .filter(Boolean).map((x) => String(x).trim().toUpperCase()));
    const map = {};
    for (const group of chunk(wanted, 30)) {
        const snap = await db.collection('Approved_Designs').where('legacyErpId', 'in', group).get();
        snap.forEach((d) => {
            const p = d.data();
            const code = String(p.legacyErpId || p.itemId || '').toUpperCase();
            const row = (p.clientPricing || []).find((r) => r && keys.has(String(r.customerId || '').trim().toUpperCase()));
            const sku = row && String(row.clientSku || '').trim();
            if (code && sku) map[code] = sku;
        });
    }
    return (code) => map[String(code || '').toUpperCase()] || '';
};

// A PORTAL_REQUEST quote has no priced breakdown yet — staff price it in CPQ. Without this the
// customer saw their own submitted quote as an empty card (Stuart 2026-08-02: "they need to be able
// to see the quotes after submittal"). Rebuild what they CHOSE from the flow: each step's title and
// the option they picked, resolved through the flow doc so the words match the configurator.
// 2026-08-07: extracted to portalRequestLines.js — finish ids printed raw (FIN-1779248570692-e6246)
// and compound `__finish` / backplate `__sub` picks were skipped entirely. The CRM DOCS view renders
// through the src/ mirror of the same module, so the customer's card and the team's document say
// the same words. price/total/sku stay null-shaped here for the card renderer.
const { portalRequestLines } = require('./portalRequestLines');
// flowById covers multi-line requests (portalRequest.lines[]); the single-doc second argument
// keeps legacy single-flow requests resolving exactly as before.
const requestLines = (job, flowById, finishes, custNames) =>
    portalRequestLines(job, flowById[String((job.portalRequest && job.portalRequest.flowId) || '')] || null, finishes, { custNames, flowById })
        .map((l) => ({ ...l, price: null, total: null, sku: '' }));

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
    // HQ soft-delete tombstones stay in the collection by design (2026-08-25 ledger model) —
    // they must never resurface in the customer's own list.
    for (let i = soDocs.length - 1; i >= 0; i--) { if (soDocs[i].deleted) soDocs.splice(i, 1); }

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

    // A quote the CUSTOMER deleted is gone from their list but kept in HQ, flagged, so the team
    // can see what happened rather than having a record vanish. An HQ soft-delete tombstone
    // (deleted:true, 2026-08-25 ledger model) is equally dead — it must not resurface here.
    const liveJobs = jobs.filter((j) => !j.portalDeleted && !j.deleted);

    // THEIR part #s for every code on every line we are about to return — one batched lookup for
    // the whole page rather than a read per line.
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const allCodes = [
        ...liveJobs.flatMap((j) => ((j.cpqData && j.cpqData.breakdown) || []).map((l) => l && (l.legacyErpId || l.partId))),
        ...soDocs.flatMap((so) => (so.lines || []).map((l) => l && (l.erp || l.itemId))),
    ];
    const skuOf = await buildSkuLookup(db, customerId, crm, allCodes);

    // Flow docs behind any un-priced portal requests, so their selections read in words — and the
    // finish lists, because a finish pick is a FIN-… id that lives in NEITHER the flow's
    // styleOptions nor its allowedOptions (it printed raw on the card until 2026-08-07). Loaded
    // once per page, only when a request is actually on it. custNames drives clientMapping so a
    // Fabricut login reads Fabricut's own finish names, same as the configurator.
    const reqFlowIds = [...new Set(liveJobs
        .filter((j) => j.status === 'PORTAL_REQUEST' && j.portalRequest)
        .flatMap((j) => [
            ...(j.portalRequest.flowId ? [String(j.portalRequest.flowId)] : []),
            // Multi-line requests: every line's flow, so each renders through ITS OWN steps.
            ...(Array.isArray(j.portalRequest.lines) ? j.portalRequest.lines.map((ln) => String((ln && ln.flowId) || '')).filter(Boolean) : []),
        ]))];
    const flowById = {};
    let reqFinishes = [];
    await Promise.all([
        ...reqFlowIds.map(async (fid) => {
            const fs = await db.collection('cpq_flows').doc(fid).get();
            if (fs.exists) flowById[fid] = fs.data();
        }),
        (async () => {
            if (!reqFlowIds.length) return;
            const [mf, outS] = await Promise.all([
                db.collection('system').doc('master_finishes').get(),
                db.collection('hq_outsource_finishes').get(),
            ]);
            reqFinishes = [
                ...((mf.exists && mf.data().finishes) || []),
                ...outS.docs.map((d) => ({ id: d.id, ...d.data() })),
            ];
        })(),
    ]);
    const reqCustNames = new Set([crm.name, crm.companyName].filter(Boolean).map((s) => String(s).trim().toUpperCase()));

    return {
        quotes: liveJobs
            .filter((j) => !orderedJobIds.has(String(j.jobId || j.id)))
            .map((j) => {
                const priced = sanitizeBreakdown(j.cpqData, skuOf);
                const isRequest = j.status === 'PORTAL_REQUEST';
                return {
                    id: j.quoteNo || j.jobId || j.id,
                    docId: j.id,
                    name: j.jobName || 'Quote',
                    // Which of THEIR portal logins generated the request. Portal-originated identity
                    // only — staff names stay internal (whitelist rule).
                    by: (j.createdBy && j.createdBy.via === 'PORTAL' && j.createdBy.name) || (j.portalRequest && j.portalRequest.byEmail) || null,
                    sidemark: j.sidemark || '',
                    status: j.status || 'CONFIGURED',
                    date: j.dateSaved || null,
                    total: (j.cpqData && j.cpqData.totalPrice) ?? null,
                    shipping: j.shippingAmount ?? null,
                    // Deleting is for quotes still in the customer's own court. Once it is approved
                    // or has become an order it is a commitment, and withdrawing it is a
                    // conversation with their rep, not a button.
                    canDelete: ['PORTAL_REQUEST', 'CONFIGURED', 'SENT_TO_CLIENT', 'REVISION_REQUESTED'].includes(String(j.status || 'CONFIGURED')),
                    lines: priced.length ? priced : (isRequest ? requestLines(j, flowById, reqFinishes, reqCustNames) : []),
                    awaitingPricing: isRequest && !priced.length,
                };
            }),
        orders: soDocs.map((so) => {
            const job = jobs.find((j) => String(j.jobId || j.id) === String(so.hqJobId || ''));
            return {
                id: so.soId || so.id,
                name: (job && job.jobName) || so.jobName || 'Order',
                sidemark: (job && job.sidemark) || '',
                date: so.reqDate || so.createdDate || null,
                total: (job && job.cpqData && job.cpqData.totalPrice) ?? null,
                stage: rollupStage(so, shopDocs, finDocs),
                lines: job ? sanitizeBreakdown(job.cpqData, skuOf)
                    : ((so.lines || []).map((l) => ({ name: l.name || l.erp || '', qty: l.qty || 0, price: null, total: null, sku: skuOf(l.erp || l.itemId) }))),
            };
        }),
    };
});

// The customer withdraws a quote. It is NEVER hard-deleted: the jobs doc is flagged so it leaves
// their portal while HQ keeps the record and is told what happened (Stuart 2026-08-02: "a way to
// delete a quote and when they delete it will alert the HQ crm and mark the quote there deleted").
exports.portalDeleteQuote = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const db = admin.firestore();
    const quoteId = String((request.data && request.data.quoteId) || '').trim();
    const reason = String((request.data && request.data.reason) || '').slice(0, 500);
    if (!quoteId) throw new HttpsError('invalid-argument', 'Which quote?');

    const ref = db.collection('jobs').doc(quoteId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'That quote no longer exists.');
    const job = snap.data();
    // OWNERSHIP is checked against the CLAIM, never against anything the browser sent.
    if (String((job.customer && job.customer.id) || '') !== String(customerId)) {
        throw new HttpsError('permission-denied', 'That quote is not on your account.');
    }
    const status = String(job.status || 'CONFIGURED');
    if (!['PORTAL_REQUEST', 'CONFIGURED', 'SENT_TO_CLIENT', 'REVISION_REQUESTED'].includes(status)) {
        throw new HttpsError('failed-precondition', 'This quote has already been approved or ordered — please contact your representative.');
    }

    const email = String((request.auth.token && request.auth.token.email) || '');
    await ref.update({
        portalDeleted: true,
        status: 'DELETED_BY_CLIENT',
        statusBeforeDelete: status,
        portalDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
        portalDeletedBy: email,
        portalDeletedReason: reason,
    });
    // Tell the team. Same channel every other cross-app alert uses, so it surfaces where staff
    // already look instead of needing a new inbox.
    await db.collection('global_messages').add({
        // 'ALL' on purpose: the comms hub filters by app/user and has no 'HQ' target, so a message
        // addressed to one would be visible to nobody. The CRM card is the primary alert; this is
        // the secondary one that reaches whoever is looking at the hub.
        sender: 'Client Portal', sourceApp: 'PORTAL', target: 'ALL', isSystem: true,
        msg: `🗑 ${(job.customer && job.customer.name) || customerId} deleted quote ${job.quoteNo || quoteId}${reason ? ` — "${reason}"` : ''} (was ${status}, by ${email}).`,
        t: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true };
});

// Portal branding for the signed-in customer — their logo above the portal (Stuart 2026-08-02:
// "load a client logo and then have it shown at the top of the portal when they log in").
exports.portalBranding = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const snap = await admin.firestore().collection('crm_records').doc(customerId).get();
    const crm = snap.exists ? snap.data() : {};
    return { logoUrl: String(crm.portalLogoUrl || ''), customerName: String(crm.name || '') };
});

// ---- Collection entitlement (crm_records.portalCollections) ----------------------------------
// The SECOND entitlement axis, alongside portalFlowIds: flows entitle the configurator, collections
// entitle the catalog. Set in CRM → Portal Access → Available Collections.
//
// EMPTY / absent = no restriction. That default is load-bearing: it is why shipping this field
// could not darken any existing customer's portal, and it also means an unrestricted customer costs
// ZERO extra Firestore reads below.
//
// With a restriction set the gate is STRICT — an assembly carrying no collection tag is NOT
// visible. An untagged assembly is precisely the case where we cannot prove the customer is
// allowed to see it, and this is a leak-safe gate (same posture as custVisible).
const collectionsOfAsm = (asm) => {
    const ms = (asm && asm.manufacturingSpecs) || {};
    const raw = Array.isArray(ms.collections)
        ? ms.collections
        : ((ms.customData && ms.customData.collection) ? [ms.customData.collection] : []);
    return raw.map((c) => String(c || '').trim().toUpperCase()).filter(Boolean);
};
// Returns a predicate, or null when this customer has no restriction at all.
const collectionGateOf = (crm) => {
    const allowed = (Array.isArray(crm && crm.portalCollections) ? crm.portalCollections : [])
        .map((c) => String(c || '').trim().toUpperCase()).filter(Boolean);
    if (!allowed.length) return null;
    const set = new Set(allowed);
    return (asm) => collectionsOfAsm(asm).some((c) => set.has(c));
};
// Per-flow collection check for the single-flow endpoints. Denies with the SAME message as the
// flow-id check so a customer can never probe which flows exist by reading the error.
const assertCollectionAllowed = async (db, crm, flow, flowId) => {
    const gate = collectionGateOf(crm);
    if (!gate) return; // unrestricted → no reads, no check
    let f = flow;
    if (!f) {
        const s = await db.collection('cpq_flows').doc(String(flowId || '')).get();
        f = s.exists ? s.data() : null;
    }
    const asmId = f && f.linkedAssemblyId;
    const asmSnap = asmId ? await db.collection('Approved_Designs').doc(asmId).get() : null;
    const asm = (asmSnap && asmSnap.exists) ? asmSnap.data() : null;
    if (!gate(asm)) throw new HttpsError('permission-denied', 'This product is not enabled on your account.');
};

// The signed-in customer's own profile, for pages that need to know WHO they are without loading a
// catalog — today the Tools/Specs reference page, which scopes its rod guides to the collections
// this customer buys. Deliberately tiny and leak-safe: the allowed collection NAMES and nothing
// else. No pricing, no flows, no cost, no other customer's data.
exports.portalProfile = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const db = admin.firestore();
    const snap = await db.collection('crm_records').doc(customerId).get();
    const crm = snap.exists ? snap.data() : {};
    return {
        name: crm.name || '',
        // Brand scopes hardware before collections do — a customer never buys another brand's rods.
        brandId: String(crm.brandId || '').trim().toLowerCase(),
        // Empty array = no restriction WITHIN the brand, matching the catalog gate.
        collections: (Array.isArray(crm.portalCollections) ? crm.portalCollections : [])
            .map((c) => String(c || '').trim().toUpperCase()).filter(Boolean),
    };
});

// ---- The portal configurator, on HQ's engine (the rebuild, step 3 — Stuart 2026-10-12 / 10-13) ----
// The old configurator's server — portalFlow, portalResolve, portalQuoteRequest, portalVisionDraft and
// functions/portalEngine.js, a port of CPQ's pricing that fell two months behind it — is gone ("the older
// can be totally scraped"). These run HQ's OWN engine: functions/portalSession.js loads the copy the deploy
// makes (functions/engine) and calls hardwareSession.sessionOf. The rulings each line answers to are in
// that file: the portal shows the level Portal Access set and never a cost level; the request lands at the
// customer's own level; solid brass is CPQ-only; a customer adds no items by hand.
const portalSession = require('./portalSession');

// The brand's library is thousands of Approved_Designs records and a walk asks for a view on every click, so what
// was read is kept per instance for a short while: a price or a tag changed in HQ reaches the portal within
// LIBRARY_TTL_MS. Only THIS BRAND's records are read (2026-10-14): CPQ listens to the whole collection and keeps
// those whose brandId is the brand or whose sharedBrands name it — the two queries below return exactly that set,
// and worldFor applies the same filter again. Should either query be refused, the whole collection is read, as before.
const LIBRARY_TTL_MS = 90 * 1000;
const libraryKept = new Map();   // brand → { at, records, loading }
const loadLibrary = async (db, brand) => {
    const key = String(brand || '');
    const hit = libraryKept.get(key) || { at: 0, records: null, loading: null };
    if (hit.records && Date.now() - hit.at < LIBRARY_TTL_MS) return hit.records;
    if (!hit.loading) {
        const read = async () => {
            const col = db.collection('Approved_Designs');
            try {
                const [own, shared] = await Promise.all([col.where('brandId', '==', key).get(), col.where('sharedBrands', 'array-contains', key).get()]);
                const byId = new Map();
                [...own.docs, ...shared.docs].forEach((d) => { if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...d.data() }); });
                return [...byId.values()];
            } catch (e) {
                console.warn('portal library: the brand query was refused, reading every record', e && e.message);
                return (await col.get()).docs.map((d) => ({ id: d.id, ...d.data() }));
            }
        };
        hit.loading = read()
            .then((records) => { libraryKept.set(key, { at: Date.now(), records, loading: null }); return records; })
            .catch((e) => { libraryKept.set(key, { ...hit, loading: null }); throw e; });
        libraryKept.set(key, hit);
    }
    return hit.loading;
};
// What CPQ reads for ONE flow: the flow, the pins of its assembly, the master and outsourced finishes,
// 6.5's span map and the flow family's traverse chart — from the same documents, by the same keys.
const flowKept = new Map();
const loadFlowRecords = async (db, flowId) => {
    const hit = flowKept.get(flowId);
    if (hit && Date.now() - hit.at < LIBRARY_TTL_MS) return hit;
    const flowSnap = await db.collection('cpq_flows').doc(flowId).get();
    if (!flowSnap.exists) throw new HttpsError('not-found', 'Product configuration not found.');
    const flow = { id: flowSnap.id, ...flowSnap.data() };
    const asmId = String(flow.linkedAssemblyId || '');
    const [pinSnap, mf, outSnap, spanSnap, trvSnap] = await Promise.all([
        asmId ? db.collection('assembly_pins').where('assemblyId', '==', asmId).get() : Promise.resolve({ docs: [] }),
        db.collection('system').doc('master_finishes').get(),
        db.collection('hq_outsource_finishes').get(),
        db.collection('system').doc('bracket_span_map').get(),
        db.collection('system').doc(`traverse_rules_${portalSession.trvFamilyOf(flow)}`).get(),
    ]);
    const kept = {
        at: Date.now(), flow, pins: pinSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        finishes: (mf.exists && mf.data().finishes) || [], outsourceFinishes: outSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
        spanDoc: spanSnap.exists ? spanSnap.data() : null, trvRules: trvSnap.exists ? trvSnap.data() : null,
    };
    flowKept.set(flowId, kept);
    return kept;
};
// One customer, one flow: entitled (the SAME answer whether or not the flow exists, so nobody can probe for
// flows), then the world CPQ hands the engine for it. The customer is the CLAIM's, never the browser's; a flow on
// PREVIEW opens only for the logins Portal Access ticked for previews (portalSession.flowIdsFor).
const portalWorldFor = async (db, engine, customerId, flowId, uid) => {
    const fid = String(flowId || '');
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const allowed = portalSession.flowIdsFor(crm, uid).all;
    if (!fid || !allowed.includes(fid)) throw new HttpsError('permission-denied', 'This product is not enabled on your account.');
    const kept = await loadFlowRecords(db, fid);
    await assertCollectionAllowed(db, crm, kept.flow, fid);
    const records = await loadLibrary(db, (kept.flow && kept.flow.brandId) || crm.brandId || '');
    const customer = { id: customerId, ...crm };
    const data = portalSession.worldFor(engine, { flow: kept.flow, records, pins: kept.pins, finishes: kept.finishes, outsourceFinishes: kept.outsourceFinishes, spanDoc: kept.spanDoc, trvRules: kept.trvRules, customer, customerId });
    if (!data.assembly || !data.pins.length) throw new HttpsError('failed-precondition', 'This product is not ready on the portal yet.');
    return { data, customer, crm };
};
// The customer's answers, field by field — a finish the portal does not offer is refused by name.
const portalStateOf = (engine, data, raw) => {
    const finishCodes = new Set(portalSession.portalFinishesOf(engine, data).map((f) => String(f.code || f.name || '').trim().toUpperCase()).filter(Boolean));
    try { return portalSession.stateFromClient(raw, { finishCodes, lengthOf: engine.lengthInchesOf }); } catch (e) {
        if (e instanceof portalSession.Refused) throw new HttpsError('invalid-argument', e.message);
        throw e;
    }
};
// Functions are deployed by hand, the portal site on every push. Until this server is deployed after an
// engine change the two halves are different engines — and then neither a view nor a request is given.
const assertInLine = (engine, site) => {
    if (!portalSession.inLine(engine.stamp, site)) {
        throw new HttpsError('failed-precondition', 'The configurator is being updated — please try again in a few minutes.', { reason: 'ENGINE_BEHIND', server: engine.stamp });
    }
};

// THE PRODUCTS THIS LOGIN MAY CONFIGURE — the portal's Configure tab (step 4, 2026-10-14). Every flow Portal Access set
// LIVE for the customer and, for a login ticked "sees previews", the flows set to PREVIEW (marked, so the screen can say
// only they see it). Each must be ready on the portal: its assembly has a model and pins, inside the customer's
// collections. Names and a picture only — nothing is priced here.
exports.portalConfigFlows = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const db = admin.firestore();
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const ids = portalSession.flowIdsFor(crm, request.auth.uid);
    if (!ids.all.length) return { flows: [] };
    const flowSnaps = await db.getAll(...ids.all.map((id) => db.collection('cpq_flows').doc(id)));
    const flows = flowSnaps.filter((x) => x.exists).map((x) => ({ id: x.id, ...x.data() }));
    const asmIds = [...new Set(flows.map((f) => String(f.linkedAssemblyId || '')).filter(Boolean))];
    const asmSnaps = asmIds.length ? await db.getAll(...asmIds.map((id) => db.collection('Approved_Designs').doc(id))) : [];
    const assemblies = new Map(asmSnaps.filter((x) => x.exists).map((x) => [x.id, x.data()]));
    const inCollection = collectionGateOf(crm);
    const out = [];
    for (const f of flows) {
        const asm = assemblies.get(String(f.linkedAssemblyId || ''));
        const ms = (asm && asm.manufacturingSpecs) || {};
        if (!asm || !ms.cadUrl) continue;                       // nothing to draw — not ready on the portal
        if (inCollection && !inCollection(asm)) continue;
        const pin = await db.collection('assembly_pins').where('assemblyId', '==', String(f.linkedAssemblyId)).limit(1).get();
        if (pin.empty) continue;                                // no pins — the engine has nothing to offer
        out.push({ id: f.id, name: String(f.name || asm.itemName || 'Product').slice(0, 120), picture: String(asm.finalImageUrl || ''), preview: ids.preview.includes(f.id) });   // the assembly's own picture (on the record, as HQ keeps it)
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return { flows: out };
});

// EVERYTHING THE PORTAL DRAWS for one set of answers: the steps and what each offers, what is drawn, the
// money at the level this customer's portal shows, why it cannot be requested yet. Called on every click.
exports.portalConfigView = onCall({ cors: true, memory: '512MiB' }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const { flowId, state, site, ui } = request.data || {};
    const engine = await portalSession.loadEngine();
    assertInLine(engine, site);
    const { data, customer } = await portalWorldFor(admin.firestore(), engine, customerId, flowId, request.auth.uid);
    const levels = portalSession.levelsFor(engine, customer);
    return portalSession.viewOf(engine, data, portalStateOf(engine, data, state), { level: levels.chosenForShown, money: levels.money, ui: portalSession.uiFromClient(ui) });
});

// A REQUEST. Every line is worked out again here at the customer's OWN level — the cart line CPQ itself
// would write for them (engine 'TAGS') — and lands as ONE jobs doc flagged PORTAL_REQUEST, exactly where
// portal requests have always landed: CRM shows it, staff reopen it in CPQ, and nothing reaches RTG, the
// floors, WMS or NetSuite until they save and approve it there. What the customer was SHOWN rides beside
// it for the portal's own card and is never a price of the quote.
exports.portalConfigRequest = onCall({ cors: true, memory: '512MiB' }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const { lines, note, sidemark, site } = request.data || {};
    const engine = await portalSession.loadEngine();
    assertInLine(engine, site);
    const rawLines = (Array.isArray(lines) ? lines : []).filter((ln) => ln && ln.flowId).slice(0, 25);
    if (!rawLines.length) throw new HttpsError('invalid-argument', 'No configuration to request.');
    const db = admin.firestore();
    const email = String((request.auth.token && request.auth.token.email) || '');
    const puSnap = await db.collection('portal_users').doc(request.auth.uid).get();
    const submitterName = (puSnap.exists && puSnap.data().name) || email;

    // EVERY line before anything is written: entitled, answered only with what the portal offers, and not
    // refused by the engine. One line that cannot be sent stops the request and says which.
    const built = [];
    let crm = {};
    for (let i = 0; i < rawLines.length; i++) {
        const world = await portalWorldFor(db, engine, customerId, rawLines[i].flowId, request.auth.uid);
        crm = world.crm;
        const state = portalStateOf(engine, world.data, rawLines[i].state);
        const req = portalSession.requestLineOf(engine, world.data, state, { level: 'STANDARD' });
        if (req.refusal) throw new HttpsError('failed-precondition', `Line ${i + 1}: ${req.refusal.message}`, { reason: req.refusal.kind, line: i + 1 });
        const levels = portalSession.levelsFor(engine, world.customer);
        const shown = portalSession.viewOf(engine, world.data, state, { level: levels.chosenForShown, money: levels.money }).price;
        built.push({ item: req.item, flow: world.data.flow, shown });
    }

    const quoteNo = await nextQuoteNo(db, `${initialsOf(submitterName, email)}${mmddyy()}`);
    const cleanSidemark = String(sidemark || '').slice(0, 120).trim();
    // The cart lines, as CPQ places its own in the cart: the quote they belong to, their notes as a list.
    const cartItems = built.map((b, i) => ({
        ...b.item, id: `PORTAL-${quoteNo}-${i + 1}`, masterQuoteId: quoteNo,
        generalNotes: Array.isArray(b.item.generalNotes) ? b.item.generalNotes : [], capturedViews: null, fromPortal: true,
    }));
    const first = built[0];
    const jobName = built.length === 1
        ? `${first.flow.name || 'Portal request'} — ${crm.name || ''}`.trim()
        : `Portal order (${built.length} configurations) — ${crm.name || ''}`.trim();
    await db.collection('jobs').doc(quoteNo).set({
        jobId: quoteNo,
        quoteNo,
        brandId: crm.brandId || null,
        status: 'PORTAL_REQUEST',
        source: 'PORTAL',
        customer: { id: customerId, name: crm.name || '' },
        author: submitterName,
        createdBy: { name: submitterName, email, via: 'PORTAL' },
        jobName,
        orderSidemark: cleanSidemark || null,
        ...(cleanSidemark ? { sidemark: cleanSidemark } : {}),
        portalRequest: {
            // 'CONFIG' = built on HQ's engine: the lines are real cart lines (cpqData.cartItems) at the customer's level.
            kind: 'CONFIG',
            flowId: String(first.flow.id || ''),
            flowName: String(first.flow.name || ''),
            lineTag: String(first.item.sidemark || ''),
            lines: built.map((b) => ({ flowId: String(b.flow.id || ''), flowName: String(b.flow.name || ''), lineTag: String(b.item.sidemark || '') })),
            shown: built.map((b) => b.shown),
            note: String(note || '').slice(0, 2000),
            sidemark: cleanSidemark,
            byEmail: email,
            engine: engine.stamp,
        },
        // (through JSON: a cart line may carry an undefined field, which Firestore refuses)
        cpqData: { cartItems: JSON.parse(JSON.stringify(cartItems)) },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        dateSaved: new Date().toISOString(),
    });
    return { ok: true, id: quoteNo, quoteNo, lineCount: built.length };
});

// IS THE PORTAL'S SERVER RUNNING THE ENGINE ITS SITE WAS BUILT WITH? (HQ → CRM → Portal Access.) The site
// publishes its stamp at build (portal/engine.json); this server reads it and says which of the two it is.
const PORTAL_SITE = 'https://portal.classicalelements.com';
exports.portalEngineStatus = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const engine = await portalSession.loadEngine();
    let site = null;
    let siteError = '';
    try {
        const r = await fetch(`${PORTAL_SITE}/engine.json?t=${Date.now()}`);
        if (r.ok) site = await r.json(); else siteError = `the portal site answered ${r.status}`;
    } catch (e) { siteError = String((e && e.message) || e).slice(0, 160); }
    const clean = (site && typeof site === 'object') ? { engineVersion: String(site.engineVersion || ''), closureHash: String(site.closureHash || ''), builtAt: String(site.builtAt || '') } : null;
    return { server: engine.stamp, site: clean, siteError, inLine: portalSession.inLine(engine.stamp, clean) };
});

// HQ ASKS THE PORTAL'S SERVER TO WORK CONFIGURATIONS IT HAS WORKED ITSELF, AND COMPARES (CPQ → 🛰). No script
// can read production, so this is the proof that the server reads what CPQ reads: the same answers in, the
// same cart line out. Staff only — the rows come back at the customer's own level, as HQ holds them; and a
// flow may be checked BEFORE it is assigned to anyone.
exports.portalConfigCheck = onCall({ enforceAppCheck: true, memory: '512MiB', timeoutSeconds: 120 }, async (request) => {
    assertStaffAdmin(request);
    const { customerId, flowId, states } = request.data || {};
    const engine = await portalSession.loadEngine();
    const db = admin.firestore();
    const kept = await loadFlowRecords(db, String(flowId || ''));
    const crmSnap = customerId ? await db.collection('crm_records').doc(String(customerId)).get() : null;
    const customer = (crmSnap && crmSnap.exists) ? { id: crmSnap.id, ...crmSnap.data() } : null;
    const records = await loadLibrary(db, (kept.flow && kept.flow.brandId) || (customer && customer.brandId) || '');
    const data = portalSession.worldFor(engine, { flow: kept.flow, records, pins: kept.pins, finishes: kept.finishes, outsourceFinishes: kept.outsourceFinishes, spanDoc: kept.spanDoc, trvRules: kept.trvRules, customer, customerId: customer ? customer.id : '' });
    const results = (Array.isArray(states) ? states : []).slice(0, 60).map((raw) => {
        try {
            const req = portalSession.requestLineOf(engine, data, portalStateOf(engine, data, raw), { level: 'STANDARD' });
            if (!req.item) return { refusal: req.refusal.kind };
            return { level: String(req.item.priceLevel || ''), total: req.total, picks: Object.keys(req.item.engineConfig.picks || {}).length,
                rows: req.item.pricingBreakdown.map((l) => [String(l.legacyErpId || ''), Number(l.qty) || 0, Number(l.price) || 0, Number(l.total) || 0]) };
        } catch (e) { return { error: String((e && e.message) || e).slice(0, 200) }; }
    });
    return {
        server: engine.stamp,
        world: { assembly: String((data.assembly && data.assembly.id) || ''), pins: data.pins.length, parts: data.parts.length, finishes: data.finishes.length, chart: !!data.trvRules, customer: customer ? String(customer.name || customer.id) : '' },
        results,
    };
});

// Short, human quote number: <initials><MMDDYY>-<NN>, e.g. SG071626-01. Initials from the given
// name, date in US Eastern, and a per-(initials+date) atomic counter for the sequence.
const initialsOf = (name, email) => {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    if (words.length === 1 && words[0].length >= 2) return words[0].slice(0, 2).toUpperCase();
    const e = String(email || '').split('@')[0] || 'XX';
    return e.slice(0, 2).toUpperCase();
};
const mmddyy = () => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: '2-digit' }).formatToParts(new Date());
    const g = (t) => (p.find((x) => x.type === t) || {}).value || '';
    return `${g('month')}${g('day')}${g('year')}`;
};
// Reserve the next sequence for a quote-number prefix; returns the full quote number.
const nextQuoteNo = async (db, prefix) => {
    const ref = db.collection('quote_counters').doc(prefix);
    const seq = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const n = (snap.exists ? (snap.data().seq || 0) : 0) + 1;
        tx.set(ref, { seq: n }, { merge: true });
        return n;
    });
    return `${prefix}-${String(seq).padStart(2, '0')}`;
};

// Mint a short quote number for a STAFF-created quote (the internal CPQ). Same format/counter as
// the portal, so quote numbers are consistent across both. Returns the number; the caller stores it
// as a display field (the jobs doc id is unchanged).
exports.reserveQuoteNo = onCall({ enforceAppCheck: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const db = admin.firestore();
    const name = String((request.data && request.data.name) || (request.auth.token && request.auth.token.name) || '');
    const quoteNo = await nextQuoteNo(db, `${initialsOf(name, '')}${mmddyy()}`);
    return { quoteNo };
});

// THE PORTAL CHECKOUT CATALOGUE (Stuart 2026-08-10): the items ticked in HQ 4.6 → Checkout
// Items (manufacturingSpecs.checkoutSelectable) offered to the customer at checkout, priced for
// THEM (their clientPricing row when present, else base price) — the same curation and the same
// pricing chain the CPQ checkout screen uses. WHITELISTED payload: no partHandling, no routing,
// no other customers' pricing. Deliberately NO fall-back-to-all-fees here (CPQ falls back until
// something is ticked; a customer-facing screen shows nothing until curation happens).
const { feeRuleOf, feeRuleSummary, isFeeItemRecord } = require('./feeRulesPort');
exports.portalCheckoutCatalog = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const db = admin.firestore();
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const keys = new Set([customerId, crm.name, crm.companyName]
        .filter(Boolean).map((x) => String(x).trim().toUpperCase()));

    const snap = await db.collection('Approved_Designs')
        .where('manufacturingSpecs.checkoutSelectable', '==', true).get();
    const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => p.manufacturingSpecs?.isRetired !== true)
        .filter((p) => !crm.brandId || p.brandId === crm.brandId || (Array.isArray(p.sharedBrands) && p.sharedBrands.includes(crm.brandId)))
        .map((p) => {
            const rule = feeRuleOf(p.manufacturingSpecs);
            const row = (p.clientPricing || []).find((r) => r && keys.has(String(r.customerId || '').trim().toUpperCase()));
            const rowPrice = row ? parseFloat(row.price) : NaN;
            const unitPrice = Number.isFinite(rowPrice) && rowPrice > 0 ? rowPrice : (parseFloat(p.manufacturingSpecs?.basePrice) || 0);
            return {
                id: p.id,
                code: String((row && row.clientSku) || p.legacyErpId || p.itemId || '').toUpperCase(),
                name: p.itemName || '',
                isFee: isFeeItemRecord(p),
                rule: { mode: rule.mode, unit: rule.unit, percent: rule.percent, minAmount: rule.minAmount, maxAmount: rule.maxAmount },
                unitPrice,
                summary: feeRuleSummary(rule, unitPrice),
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
    return { items };
});

// ---- Quick Ship stock counter (portal) --------------------------------------------------------
// The customer-facing half of HQ tab 7, browse + QUOTE REQUEST only (settled 2026-07-25): the
// customer builds a stock quote from their entitled collections; staff open the request in Quick
// Ship, review, and push the real NetSuite SO. The picker mirrors tab 7's predicate chain
// EXACTLY (QuickShipTab.js): brand → isStocked → alias-aware collection scope → the client-side
// cascade (category / finished-goods / diameter / finish / bracket position) runs the SAME
// verbatim modules the counter uses. Pricing = Shared/clientPricing semantics with the alias
// price rule (the collection's alias doc fronts the item; its rate wins when > 0).
const qsAlias = require('./aliasIdentity');

// Mirror of Shared/quickShipUom.js (packs) — qty means PACKS, rate is per EACH, and every
// request line carries the each count. Keep in sync with the app module.
const qsPackSizeOf = (uom) => {
    const raw = String(uom || '').trim().toUpperCase();
    if (!raw) return 1;
    const explicit = raw.match(/-\s*(\d+(?:\.\d+)?)\s*$/);
    if (explicit) { const n = parseFloat(explicit[1]); if (n > 0) return Math.round(n); }
    const lead = raw.match(/^(\d+)/);
    if (lead) { const n = parseInt(lead[1], 10); if (n > 0) return n; }
    if (/\bPAIR\b|\bPR\b/.test(raw)) return 2;
    if (/\bDOZEN\b|\bDOZ\b/.test(raw)) return 12;
    return 1;
};
const qsPackLabelOf = (uom) => String(uom || '').trim().replace(/\s*-\s*\d+(?:\.\d+)?\s*$/, '').toUpperCase();
const qsIsRealPack = (uom) => !!uom && qsPackSizeOf(uom) > 1;
const QS_PACK_PREFS = { ring: 'qsRingPack', finial: 'qsFinialPack', insideMount: 'qsInsideMountPack' };
// Mirror of QuickShipTab's classifyCat / isInsideMount / slotOfCat / packForItem chain.
const qsClassifyCat = (pt) => {
    const t = String(pt || '').toUpperCase();
    if (t.includes('BACKPLATE') || t.includes('BACK PLATE')) return 'BACKPLATE';
    if (t.includes('BRACKET')) return 'BRACKET';
    if (t.includes('FINIAL')) return 'FINIAL';
    if (t.includes('RING')) return 'RING';
    if (t.includes('POLE') || t.includes('ROD')) return 'POLE';
    return '';
};
const qsCatOf = (it) => qsClassifyCat((it.manufacturingSpecs && it.manufacturingSpecs.productType) || it.productType || (it.customData && it.customData.category));
const qsIsInsideMount = (it) => /INSIDE/.test(String((it.manufacturingSpecs && it.manufacturingSpecs.customData && (it.manufacturingSpecs.customData.bracketType || it.manufacturingSpecs.customData.bracketMount)) || '').toUpperCase());
const qsPackForItem = (it, crm) => {
    const c = qsCatOf(it);
    const slot = c === 'RING' ? 'ring' : c === 'FINIAL' ? 'finial' : (c === 'BRACKET' && qsIsInsideMount(it)) ? 'insideMount' : '';
    if (!slot) return { uom: '', size: 1 };
    const fromCust = crm && crm[QS_PACK_PREFS[slot]];
    const uom = fromCust ? String(fromCust).toUpperCase()
        : String((it.manufacturingSpecs && it.manufacturingSpecs.quickShipUom) || '').toUpperCase();
    return qsIsRealPack(uom) ? { uom: qsPackLabelOf(uom), size: qsPackSizeOf(uom) } : { uom: '', size: 1 };
};

// Everything both stock endpoints agree on — built the same way per call, so browse and submit
// can never diverge on what a customer may buy or at what price.
const buildPortalStockCtx = async (db, customerId, crm) => {
    const brand = crm.brandId || null;
    const adSnap = await db.collection('Approved_Designs').get();
    const allItems = adSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => !brand || p.brandId === brand || (Array.isArray(p.sharedBrands) && p.sharedBrands.includes(brand)));
    const index = qsAlias.buildAliasIndex(allItems);
    const stocked = allItems.filter((it) => it.manufacturingSpecs && it.manufacturingSpecs.isStocked === true);
    // Entitlement (crm_records.portalCollections) — STRICT for restricted customers, and
    // alias-reachable tags count (the Simple Elegance tag rides the H2-side alias).
    const allowed = (Array.isArray(crm.portalCollections) ? crm.portalCollections : [])
        .map((c) => String(c || '').trim().toUpperCase()).filter(Boolean);
    const effCols = (it) => qsAlias.effectiveCollectionsOf(index, it);
    const sellable = allowed.length ? stocked.filter((it) => [...effCols(it)].some((c) => allowed.includes(c))) : stocked;
    const collections = [...new Set(sellable.flatMap((it) => [...effCols(it)]))]
        .filter((c) => !allowed.length || allowed.includes(c)).sort();
    // Per-customer rate — Shared/clientPricing semantics (row price > 0 wins, else base price).
    const custKeys = new Set([customerId, crm.name, crm.companyName].filter(Boolean).map((s) => String(s).trim().toUpperCase()));
    const rateFor = (it) => {
        const rows = Array.isArray(it.clientPricing) ? it.clientPricing : [];
        const row = rows.find((r) => custKeys.has(String((r && r.customerId) || '').trim().toUpperCase()));
        const v = row ? parseFloat(row.price) : NaN;
        if (Number.isFinite(v) && v > 0) return v;
        return parseFloat((it.manufacturingSpecs && it.manufacturingSpecs.basePrice) || 0) || 0;
    };
    // Alias display+price rule (§4b): the collection's alias doc fronts the item; its rate wins when > 0.
    const faceOf = (it, scope) => qsAlias.customerFaceOf(index, it, scope);
    const priceOf = (it, scope) => {
        const face = faceOf(it, scope);
        if (face) { const r = rateFor(face); if (r > 0) return r; }
        return rateFor(it);
    };
    // Outer/center bracket split — from the generated flows' stepRole/position, brand-wide,
    // exactly like tab 7 (position is a property of the PART, read through the flows).
    const outer = new Set(); const center = new Set();
    if (brand) {
        const flowSnap = await db.collection('cpq_flows').where('brandId', '==', brand).get();
        flowSnap.forEach((d) => (((d.data() || {}).steps) || []).forEach((s) => {
            if (String(s.stepRole || '').toUpperCase() !== 'BRACKET') return;
            const pos = String(s.position || '').toUpperCase();
            const target = pos === 'CENTER' ? center : (pos === 'LEFT' || pos === 'RIGHT') ? outer : null;
            if (!target) return;
            (s.styleOptions || []).forEach((o) => [o.partName, o.partId].forEach((v) => { const c = qsAlias.bareCode(v); if (c) target.add(c); }));
        }));
    }
    // Cut fee items — tab 7's feeItems(['CUT']) predicate verbatim: keyword across ALL brand
    // parts (fees aren't usually "stocked"), never narrowed by collection or diameter.
    const cutFees = allItems.filter((it) => {
        const ms = it.manufacturingSpecs || {};
        const cd = it.customData || {};
        const hay = `${ms.productType || ''} ${it.productType || ''} ${it.itemName || ''} ${cd.feeType || ''}`.toUpperCase();
        return hay.includes('CUT');
    });
    return { allItems, index, sellable, collections, rateFor, faceOf, priceOf, outer, center, brand, cutFees };
};

exports.portalStock = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const db = admin.firestore();
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const ctx = await buildPortalStockCtx(db, customerId, crm);

    // Alias-neighborhood docs ride along (slim, unpriced) so the client-side cascade — the SAME
    // verbatim aliasIdentity/sizeMatrix modules tab 7 uses — resolves diameters, collections and
    // bracket positions through the alias links. Sellable items carry the customer's rate + the
    // per-collection alias face (code + rate); nothing else leaves the server.
    const sellIds = new Set(ctx.sellable.map((it) => it.id));
    const neighborhood = new Map();
    ctx.sellable.forEach((it) => qsAlias.aliasCodesOf(ctx.index, it).forEach((c) =>
        (ctx.index.docsByCode.get(c) || []).forEach((d) => { if (!sellIds.has(d.id) && !neighborhood.has(d.id)) neighborhood.set(d.id, d); })));
    const slim = (it, sellable) => {
        const out = {
            id: it.id, itemId: it.itemId || '', legacyErpId: it.legacyErpId || '',
            itemName: it.itemName || '',
            aliasOf: qsAlias.aliasTargetIdOf(it) || null,
            sellable: !!sellable,
            manufacturingSpecs: {
                isStocked: !!(it.manufacturingSpecs && it.manufacturingSpecs.isStocked),
                productType: (it.manufacturingSpecs && it.manufacturingSpecs.productType) || it.productType || '',
                collections: [...qsAlias.collectionsOf(it)],
                quickShipUom: String((it.manufacturingSpecs && it.manufacturingSpecs.quickShipUom) || ''),
                customData: { bracketType: String((it.manufacturingSpecs && it.manufacturingSpecs.customData && (it.manufacturingSpecs.customData.bracketType || it.manufacturingSpecs.customData.bracketMount)) || '') },
            },
        };
        if (sellable) {
            out.rate = ctx.rateFor(it);
            out.faces = {};
            ctx.collections.forEach((c) => {
                const f = ctx.faceOf(it, c);
                if (f) out.faces[c] = { code: qsAlias.faceCodeFor(f, it), rate: ctx.rateFor(f) };
            });
        }
        return out;
    };
    // Finish NAMES for the counter's finish selector ("WS — Warm Silver"): master + outsourced
    // finishes, code → display name. Names only — no vendor or multiplier data leaves.
    const finishNames = {};
    const mfSnap = await db.collection('system').doc('master_finishes').get();
    ((mfSnap.exists && mfSnap.data().finishes) || []).forEach((f) => { if (f && f.code) finishNames[String(f.code).toUpperCase()] = String(f.name || f.code); });
    const outSnap = await db.collection('hq_outsource_finishes').get();
    outSnap.forEach((d) => { const f = d.data(); if (f && f.code && !finishNames[String(f.code).toUpperCase()]) finishNames[String(f.code).toUpperCase()] = String(f.name || f.code); });

    return {
        items: [...ctx.sellable.map((it) => slim(it, true)), ...[...neighborhood.values()].map((it) => slim(it, false))],
        bracketPos: { outer: [...ctx.outer], center: [...ctx.center] },
        collections: ctx.collections,
        packPrefs: { qsRingPack: crm.qsRingPack || '', qsFinialPack: crm.qsFinialPack || '', qsInsideMountPack: crm.qsInsideMountPack || '' },
        finishNames,
        customerName: crm.name || '',
        // Pole-cut fee choices (Stuart 2026-07-27: "under the pole line add a field for Pole Cut
        // Required") — DESCRIPTION + rate only, never the fee item code (the Measure & Fit rule).
        cutFees: ctx.cutFees.slice(0, 12).map((it) => ({ id: it.id, name: it.itemName || String(it.legacyErpId || it.itemId || ''), rate: ctx.rateFor(it) })),
    };
});

// The customer submits their stock quote. Lines are RE-VALIDATED and RE-PRICED server-side
// against the same ctx the browse endpoint serves — the browser's numbers are never trusted.
// Lands as a jobs doc (PORTAL_REQUEST, kind QUICKSHIP) on the CRM pipeline; Quick Ship's
// "portal requests" panel loads it straight into the cart for review + the real SO push.
exports.portalStockQuoteRequest = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const { lines: rawLines, jobName, note, collection } = request.data || {};
    const db = admin.firestore();
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const ctx = await buildPortalStockCtx(db, customerId, crm);
    const scope = String(collection || '').trim().toUpperCase();
    if (scope && !ctx.collections.includes(scope)) throw new HttpsError('permission-denied', 'This collection is not enabled on your account.');

    const byId = new Map(ctx.sellable.map((it) => [it.id, it]));
    const cutById = new Map(ctx.cutFees.map((it) => [it.id, it]));
    const lines = [];
    for (const l of (Array.isArray(rawLines) ? rawLines : []).slice(0, 60)) {
        const id = String((l && l.id) || '');
        const qty = Math.floor(parseFloat(l && l.qty));
        // Pole-cut fee line: never packed, note carries the exact length in tab 7's own
        // "cut @ <len>" spelling so Load-into-cart round-trips it verbatim. The note is BUILT
        // here from the sanitized length — the client can't inject arbitrary note text.
        const cutIt = cutById.get(id);
        if (cutIt && qty > 0 && qty <= 999) {
            const cutLen = String((l && l.cutLen) || '').replace(/[^\w .,/"'-]/g, '').trim().slice(0, 60);
            const cutErp = String(cutIt.legacyErpId || cutIt.itemId || '').toUpperCase();
            lines.push({
                itemId: cutIt.id, erp: cutErp, name: cutIt.itemName || cutErp,
                aliasErp: '', faceItemId: null,
                qty, packUom: '', packSize: 1, eachQty: qty,
                rate: ctx.rateFor(cutIt), note: cutLen ? `cut @ ${cutLen}` : 'cut',
            });
            continue;
        }
        const it = byId.get(id);
        if (!it || !(qty > 0) || qty > 999) continue;
        const pack = qsPackForItem(it, crm);
        const face = ctx.faceOf(it, scope);
        const rate = ctx.priceOf(it, scope);
        const erp = String(it.legacyErpId || it.itemId || '').toUpperCase();
        lines.push({
            itemId: it.id, erp, name: it.itemName || erp,
            aliasErp: face ? qsAlias.faceCodeFor(face, it) : '', faceItemId: face ? face.id : null,
            qty, packUom: pack.uom, packSize: pack.size, eachQty: qty * pack.size,
            rate, note: '',
        });
    }
    if (!lines.length) throw new HttpsError('invalid-argument', 'No valid lines to quote.');
    const total = Math.round(lines.reduce((s, l) => s + l.rate * l.eachQty, 0) * 100) / 100;

    const email = String((request.auth.token && request.auth.token.email) || '');
    const puSnap = await db.collection('portal_users').doc(request.auth.uid).get();
    const submitterName = (puSnap.exists && puSnap.data().name) || email;
    const quoteNo = await nextQuoteNo(db, `${initialsOf(submitterName, email)}${mmddyy()}`);
    const cleanJobName = String(jobName || '').slice(0, 120) || `Quick Ship — ${scope || 'stock'} — ${crm.name || ''}`.trim();

    await db.collection('jobs').doc(quoteNo).set({
        jobId: quoteNo, quoteNo, brandId: ctx.brand,
        status: 'PORTAL_REQUEST', source: 'PORTAL',
        customer: { id: customerId, name: crm.name || '' },
        author: submitterName,
        createdBy: { name: submitterName, email, via: 'PORTAL' },
        jobName: cleanJobName,
        portalRequest: {
            kind: 'QUICKSHIP', collection: scope, lines, total,
            note: String(note || '').slice(0, 2000), byEmail: email,
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        dateSaved: new Date().toISOString(),
    });
    return { ok: true, quoteNo, total };
});

// ---- Asset gallery (portal) -------------------------------------------------------------------
// A LIMITED, opt-in slice of the internal Asset Gallery (Stuart 2026-07-27, Fabricut H1 = the
// test set): an image appears ONLY when staff flagged it (global_assets.portalVisible +
// portalCollections, set via the gallery's bulk 🌐 FLAG FOR PORTAL), AND the signed-in customer
// is entitled to one of its collections (crm_records.portalCollections; empty = unrestricted).
// Each asset ships with a server-built lowercase search BLOB of its Fabricut identity (fab{} +
// tags + names) — the portal search AND-matches tokens against it, the same matching rule as
// the internal gallery. Identity fields only — never costs, vendors, or internal notes.
exports.portalAssets = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const db = admin.firestore();
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const allowed = (Array.isArray(crm.portalCollections) ? crm.portalCollections : [])
        .map((c) => String(c || '').trim().toUpperCase()).filter(Boolean);

    // Finish names resolve LIVE from the finish lists (Shared/fabricutAssetTags semantics, CJS):
    // FABRICUT'S color name = the finish's clientMapping row for customer Fabricut (4.5 Master
    // Finishes); ours = the finish's own name. Live fallback means entering the name in 4.5 once
    // fixes every already-imported asset on the portal — no re-tag pass required.
    const UP = (v) => String(v || '').trim().toUpperCase();
    const finishLists = [];
    const mfSnap2 = await db.collection('system').doc('master_finishes').get();
    finishLists.push((mfSnap2.exists && mfSnap2.data().finishes) || []);
    for (const colName of ['hq_global_finishes', 'hq_outsource_finishes', 'hq_inhouse_finishes']) {
        const s = await db.collection(colName).get();
        finishLists.push(s.docs.map((x) => x.data()));
    }
    // Key candidates mirror Shared/fabricutAssetTags.finishKeysOf: the code, the FIN--stripped
    // doc id (outsource docs are keyed FIN-<CODE>), and the leading token of the name (older
    // outsource rows were created name-first with an empty code) — every key EP-zero-normalized
    // (EP03 ≡ EP3), which is what silently missed the outsourced EP finishes.
    const normFinKey = (v) => UP(v).replace(/^EP0+(\d+)$/, 'EP$1');
    const finNames = new Map(); // KEY -> { fab, ours } (first list wins, like the internal scan order)
    finishLists.forEach((list) => (Array.isArray(list) ? list : []).forEach((f) => {
        const cands = [
            normFinKey(f && f.code),
            normFinKey(String((f && f.id) || '').replace(/^FIN-/i, '')),
            normFinKey(String((f && f.name) || '').split(/[^A-Za-z0-9]+/)[0]),
        ].filter(Boolean);
        [...new Set(cands)].forEach((key) => {
            const cur = finNames.get(key) || { fab: '', ours: '' };
            if (!cur.ours && f && f.name) cur.ours = UP(f.name);
            if (!cur.fab) {
                const rows = Array.isArray(f && f.clientMapping) ? f.clientMapping : [];
                const hit = rows.find((m) => UP(m && m.customerId).includes('FABRICUT'));
                if (hit && hit.clientFinishName) cur.fab = UP(hit.clientFinishName);
            }
            finNames.set(key, cur);
        });
    }));
    const namesFor = (finishId) => finNames.get(normFinKey(finishId)) || { fab: '', ours: '' };

    const snap = await db.collection('global_assets').where('portalVisible', '==', true).get();
    const assets = [];
    snap.forEach((d) => {
        const a = d.data() || {};
        const cols = (Array.isArray(a.portalCollections) ? a.portalCollections : []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean);
        if (!cols.length) return; // flag without a collection = not addressable, never shown
        if (allowed.length && !cols.some((c) => allowed.includes(c))) return;
        const fab = a.fab || {};
        const liveNames = namesFor(a.finishId || fab.finishId);
        const fabSafe = {
            role: fab.role || '', pairedRole: fab.pairedRole || '', endTreatment: fab.endTreatment || '',
            pairedCode: fab.pairedCode || '', pairedName: fab.pairedName || '',
            plateCode: fab.plateCode || '', plateIsCover: !!fab.plateIsCover, plateOrientation: fab.plateOrientation || '',
            diaLabel: fab.diaLabel || '', projLabel: fab.projLabel || '',
            fabCode: fab.fabCode || '', fabColorName: fab.fabColorName || liveNames.fab, ourFinishName: fab.ourFinishName || liveNames.ours,
        };
        const blob = [a.name, a.patternId, a.finishId, a.fabCode, ...Object.values(fabSafe).filter((v) => typeof v === 'string'), ...(Array.isArray(a.tags) ? a.tags : []), ...cols]
            .filter(Boolean).join(' ').toLowerCase();
        assets.push({
            id: d.id,
            url: a.thumbnailUrl || a.url || '',
            fullUrl: a.originalUrl || a.url || '',
            name: a.name || a.patternId || '',
            fabCode: String(a.fabCode || fab.fabCode || ''),
            tags: (Array.isArray(a.tags) ? a.tags : []).slice(0, 24),
            fab: fabSafe,
            collections: cols,
            blob,
        });
    });
    assets.sort((x, y) => String(x.name).localeCompare(String(y.name), undefined, { numeric: true }));
    return { assets, collections: allowed };
});


// ============================================================================
// 🚚 UPS — connection probe (test environment only)
// ============================================================================
// Proves the UPS pipe before any shipping screen depends on it: OAuth client-credentials token →
// one Rating "Shop" call on the CIE test host (no shipments, no charges). Returns every service's
// PUBLISHED and NEGOTIATED price side by side, which also shows whether negotiated rates are active
// on the account for API use. Read-only: writes nothing, returns neither the secrets nor the token.
// Secrets (Secret Manager): UPS_CLIENT_ID, UPS_CLIENT_SECRET, UPS_ACCOUNT_CE.
const UPS_CLIENT_ID = defineSecret("UPS_CLIENT_ID");
const UPS_CLIENT_SECRET = defineSecret("UPS_CLIENT_SECRET");
const UPS_ACCOUNT_CE = defineSecret("UPS_ACCOUNT_CE");
const UPS_CIE_HOST = 'https://wwwcie.ups.com';

const UPS_SERVICE_NAMES = {
    '01': 'Next Day Air', '02': '2nd Day Air', '03': 'Ground', '12': '3 Day Select',
    '13': 'Next Day Air Saver', '14': 'Next Day Air Early', '59': '2nd Day Air A.M.',
    '07': 'Worldwide Express', '08': 'Worldwide Expedited', '11': 'Standard', '65': 'Worldwide Saver',
};

const upsErrorText = (body) => {
    const errs = (body && body.response && body.response.errors) || [];
    return errs.length ? errs.map((e) => `${e.code || ''} ${e.message || ''}`.trim()).join('; ') : '';
};

exports.upsProbe = onCall({
    enforceAppCheck: true,
    secrets: [UPS_CLIENT_ID, UPS_CLIENT_SECRET, UPS_ACCOUNT_CE],
}, async (request) => {
    assertStaffAdmin(request);
    const account = UPS_ACCOUNT_CE.value().trim();
    const startedAt = Date.now();

    // 1) OAuth token
    let token;
    try {
        const basic = Buffer.from(`${UPS_CLIENT_ID.value().trim()}:${UPS_CLIENT_SECRET.value().trim()}`).toString('base64');
        const r = await fetch(`${UPS_CIE_HOST}/security/v1/oauth/token`, {
            method: 'POST',
            headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'x-merchant-id': account },
            body: 'grant_type=client_credentials',
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok || !body.access_token) {
            return { ok: false, stage: 'token', httpStatus: r.status, error: upsErrorText(body) || 'No access token returned.' };
        }
        token = body.access_token;
    } catch (e) {
        return { ok: false, stage: 'token', error: String(e.message || e) };
    }

    // 2) Rating "Shop" — sample 12×12×12 in, 5 lb box, High Point NC → Atlanta GA
    const origin = { AddressLine: ['1200 Redding Dr'], City: 'High Point', StateProvinceCode: 'NC', PostalCode: '27260', CountryCode: 'US' };
    const payload = {
        RateRequest: {
            Request: { TransactionReference: { CustomerContext: 'upsProbe' } },
            Shipment: {
                Shipper: { Name: 'Classical Elements', ShipperNumber: account, Address: origin },
                ShipFrom: { Name: 'Classical Elements', Address: origin },
                ShipTo: { Name: 'UPS Probe', Address: { AddressLine: ['55 Trinity Ave SW'], City: 'Atlanta', StateProvinceCode: 'GA', PostalCode: '30303', CountryCode: 'US' } },
                PaymentDetails: { ShipmentCharge: [{ Type: '01', BillShipper: { AccountNumber: account } }] },
                ShipmentRatingOptions: { NegotiatedRatesIndicator: '' },
                Package: [{
                    PackagingType: { Code: '02' },
                    Dimensions: { UnitOfMeasurement: { Code: 'IN' }, Length: '12', Width: '12', Height: '12' },
                    PackageWeight: { UnitOfMeasurement: { Code: 'LBS' }, Weight: '5' },
                }],
            },
        },
    };
    try {
        const r = await fetch(`${UPS_CIE_HOST}/api/rating/v2409/Shop`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json',
                'transId': `probe-${startedAt}`, 'transactionSrc': 'ce-workcenter',
            },
            body: JSON.stringify(payload),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
            return { ok: false, stage: 'rating', tokenOk: true, httpStatus: r.status, error: upsErrorText(body) || `HTTP ${r.status}` };
        }
        const rated = [].concat((body.RateResponse && body.RateResponse.RatedShipment) || []);
        const services = rated.map((s) => {
            const code = (s.Service && s.Service.Code) || '';
            const neg = s.NegotiatedRateCharges && s.NegotiatedRateCharges.TotalCharge;
            return {
                code,
                name: UPS_SERVICE_NAMES[code] || `Service ${code}`,
                published: s.TotalCharges ? Number(s.TotalCharges.MonetaryValue) : null,
                negotiated: neg ? Number(neg.MonetaryValue) : null,
                currency: (s.TotalCharges && s.TotalCharges.CurrencyCode) || 'USD',
                businessDays: (s.GuaranteedDelivery && s.GuaranteedDelivery.BusinessDaysInTransit) || null,
            };
        });
        const alerts = [].concat((body.RateResponse && body.RateResponse.Response && body.RateResponse.Response.Alert) || [])
            .map((a) => `${a.Code || ''} ${a.Description || ''}`.trim());
        return {
            ok: true,
            environment: 'CIE (test)',
            tokenOk: true,
            negotiatedRatesReturned: services.some((s) => s.negotiated !== null),
            services,
            alerts,
            sample: '12x12x12 in, 5 lb · High Point NC 27260 -> Atlanta GA 30303',
            ms: Date.now() - startedAt,
        };
    } catch (e) {
        return { ok: false, stage: 'rating', tokenOk: true, error: String(e.message || e) };
    }
});

// ============================================================================
// 💳 NMI — connection probe (SANDBOX ONLY)
// ============================================================================
// Proves the payments pipe before any checkout exists, WITHOUT sending card data anywhere:
//   1) a query call authenticated with the private key — proves key + account + connection;
//   2) optionally (Stuart ticks a box) one $1 test invoice, to learn whether NMI hands back a
//      payment-page URL we can put on our own quote/SO PDFs, or only emails it itself.
// Sandbox merchant 1347136 ("Classical Elements Test Merchant"). Nothing is charged; the key never
// leaves the server; card data never touches our systems (that is the whole point of the design).
const NMI_SANDBOX_KEY_CE = defineSecret("NMI_SANDBOX_KEY_CE");
// LIVE KEYS, ONE PER BRAND. Each brand is its own merchant account and its own NetSuite
// subsidiary, so the key decides whose bank account the money lands in — it is never a detail to
// default. Uniq'uity (MC America LLC) goes live first (Stuart 2026-10-08); CE and M2C get theirs
// when their keys exist, as one more line each plus a deploy.
const NMI_LIVE_KEY_UNIQUITY = defineSecret("NMI_LIVE_KEY_UNIQUITY");
// ✉️ Postmark, one sending server per brand — a brand with no token sends nothing rather than
// borrowing another company's name (Stuart 2026-10-16).
const POSTMARK_TOKEN_UNIQUITY = defineSecret("POSTMARK_TOKEN_UNIQUITY");
// A SANDBOX key is refused by the production host ("Sandbox accounts must use a sandbox domain",
// seen 2026-09-23) — the environment decides the host, exactly as UPS_HOSTS does for shipping.
const NMI_HOSTS = { SANDBOX: 'https://sandbox.nmi.com', PRODUCTION: 'https://secure.nmi.com' };
const nmiHostOf = (environment) => (environment === 'PRODUCTION' ? NMI_HOSTS.PRODUCTION : NMI_HOSTS.SANDBOX);

// The Payment API answers in querystring form (response=1&responsetext=...), not JSON.
const nmiParse = (text) => Object.fromEntries(new URLSearchParams(String(text || '')));
const nmiPost = async (path, fields, environment) => {
    const r = await fetch(`${nmiHostOf(environment)}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
};
// A payment link may come back as a field or inside the XML query response — find a URL either way.
const nmiFindPayUrl = (text) => {
    const m = String(text || '').match(/https?:\/\/[^\s"'<>&]+/g) || [];
    return m.find((u) => /invoice|checkout|pay/i.test(u)) || '';
};

exports.nmiProbe = onCall({
    enforceAppCheck: true,
    secrets: [NMI_SANDBOX_KEY_CE, NMI_LIVE_KEY_UNIQUITY],
}, async (request) => {
    assertStaffAdmin(request);
    const { testInvoice, email, amount, brand } = request.data || {};
    // THE PROBE FOLLOWS THE SWITCH. It was pinned to the sandbox, which meant a live key could not
    // be tested at all — the first proof it worked would have been a customer's card in front of
    // them (Stuart 2026-10-08). Now it asks the same question of whichever account is configured.
    const cfg = await nmiConfig();
    const b = String(brand || 'ce').toLowerCase();
    const key = nmiKeyFor(b, cfg.environment);
    const out = { environment: `NMI ${cfg.environment} · ${b.toUpperCase()}`, steps: [] };

    // 1) Credentials — the query API returns this merchant's transaction list. ANY error document
    //    counts as a failure: matching only "authentication failed" once let the wrong-host
    //    refusal read as a pass (2026-09-23).
    try {
        const r = await nmiPost('/api/query.php', { security_key: key, report_type: 'transaction' }, cfg.environment);
        const body = String(r.text || '');
        const errText = (body.match(/<error_response>([\s\S]*?)<\/error_response>/i) || [])[1]
            || (/Authentication Failed|Invalid Security Key|must use a sandbox domain/i.test(body) ? body.slice(0, 200) : '');
        out.steps.push({
            step: 'credentials',
            ok: r.ok && !errText,
            detail: errText ? `NMI refused: ${errText.trim().slice(0, 200)}` : `HTTP ${r.status}, ${body.length} bytes back`,
        });
        if (!r.ok || errText) return out;
    } catch (e) {
        out.steps.push({ step: 'credentials', ok: false, detail: String(e.message || e) });
        return out;
    }

    // 2) One test invoice — ONLY when asked. This is how we learn whether a per-invoice pay URL
    //    comes back to us (the link we want on the quote/SO PDF) or whether NMI only emails it.
    if (testInvoice === true) {
        // NOT against a live account: there, "test invoice" means a real invoice, emailed to a real
        // person, on the real merchant's letterhead.
        if (cfg.environment === 'PRODUCTION') {
            out.steps.push({ step: 'invoice', ok: false, detail: 'Payments are LIVE — a test invoice here would be a real invoice sent to a real customer. Switch to Test first.' });
            return out;
        }
        const to = cleanStr(email, 120);
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
            out.steps.push({ step: 'invoice', ok: false, detail: 'Enter a valid email address to send the test invoice to.' });
            return out;
        }
        const amt = Number(amount) > 0 ? Number(amount).toFixed(2) : '1.00';
        try {
            const r = await nmiPost('/api/transact.php', {
                security_key: key, invoicing: 'add_invoice', amount: amt, email: to,
                order_description: 'CE integration probe (sandbox test invoice)',
                payment_terms: 'upon_receipt',
            }, cfg.environment);
            const res = nmiParse(r.text);
            const okay = res.response === '1';
            out.steps.push({
                step: 'invoice',
                ok: okay,
                detail: okay
                    ? `Invoice ${res.invoice_id || '(no id returned)'} created for $${amt} to ${to}.`
                    : `NMI refused: ${res.responsetext || r.text || 'no detail'}`,
                invoiceId: res.invoice_id || '',
                payUrl: nmiFindPayUrl(r.text),
                payUrlReturned: !!nmiFindPayUrl(r.text),
            });
        } catch (e) {
            out.steps.push({ step: 'invoice', ok: false, detail: String(e.message || e) });
        }
    }
    return out;
});

// ── NMI WEBHOOK RECEIVER ─────────────────────────────────────────────────────────────────────
// NMI posts every transaction event here (Merchant Portal → Settings → Webhooks). Phase 1 RECORDS
// events only — nothing acts on them yet — so a wrong signature can never move money or stamp an
// order. Each event lands in `nmi_events` with whether its signature verified.
//
// Signature: header `Webhook-Signature: t=<nonce>, s=<sig>`, sig = HMAC-SHA256 of the nonce and the
// RAW body with the signing key NMI shows when the webhook is created. The exact string NMI signs
// is not stated identically everywhere, so both documented forms are tried and the one that matched
// is recorded — the first real event tells us which it is, and then this tightens to that one.
const NMI_WEBHOOK_SIGNING_KEY = defineSecret("NMI_WEBHOOK_SIGNING_KEY");

exports.nmiWebhook = onRequest({ secrets: [NMI_WEBHOOK_SIGNING_KEY] }, async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('POST only');
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const header = String(req.get('Webhook-Signature') || '');
    const nonce = (header.match(/t=([^,\s]+)/) || [])[1] || '';
    const given = (header.match(/s=([^,\s]+)/) || [])[1] || '';
    const signingKey = NMI_WEBHOOK_SIGNING_KEY.value().trim();

    let verified = false, matchedForm = '';
    if (nonce && given && signingKey) {
        for (const [form, message] of [['nonce.body', `${nonce}.${raw}`], ['nonce+body', `${nonce}${raw}`]]) {
            const mine = crypto.createHmac('sha256', signingKey).update(message).digest('hex');
            if (mine.length === given.length && crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(given))) {
                verified = true; matchedForm = form; break;
            }
        }
    }

    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch (e) { body = { unparsed: raw.slice(0, 2000) }; }
    const t = (body && body.event_body) || {};
    try {
        await admin.firestore().collection('nmi_events').add({
            receivedAt: Date.now(),
            verified, matchedForm,
            eventType: String((body && body.event_type) || ''),
            transactionId: String(t.transaction_id || ''),
            amount: t.action && t.action.amount ? String(t.action.amount) : '',
            responseText: String((t.action && t.action.response_text) || ''),
            orderId: String(t.order_id || ''),
            raw: raw.slice(0, 20000),
        });
    } catch (e) {
        console.error('nmi_events write failed', e);
    }
    // 200 either way: NMI retries on non-2xx, and an unverified event is already recorded for us
    // to look at. Nothing downstream reads these yet.
    return res.status(200).send('ok');
});

// ── THE PAY LINK ─────────────────────────────────────────────────────────────────────────────
// A quote / sales order / invoice carries a link the customer can pay from without logging in:
//   portal.classicalelements.com/#/pay/<token>
// The token is 32 random bytes, single use, 30 days, revocable. What may be paid is decided HERE,
// never by the browser: a sales order defaults to a 50% deposit and the customer may choose to pay
// MORE (never less, never more than the balance); an invoice is paid in full (Stuart 2026-09-23).
// Card data never touches us — the page uses NMI's hosted fields and sends us only their one-time
// token. Sandbox until an admin switches system/nmi_config.environment.
const PAY_LINK_DAYS = 30;
const nmiConfig = async () => {
    try {
        const snap = await admin.firestore().doc('system/nmi_config').get();
        const c = (snap.exists && snap.data()) || {};
        return {
            environment: c.environment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
            tokenizationKeys: c.tokenizationKeys || {},
            payBaseUrls: c.payBaseUrls || {},
        };
    } catch (e) { return { environment: 'SANDBOX', tokenizationKeys: {}, payBaseUrls: {} }; }
};

// WHICH ADDRESS THE CUSTOMER LANDS ON. A payer should see the name of the company taking their
// money, so each brand may have its own pay domain — all pointing at the same portal, the brand
// only deciding the name on the address bar (Stuart 2026-10-15). It is a SETTING, not code:
// adding a brand's domain is a field in HQ 11, never a deploy.
//
// The fallback is the original portal domain, which must stay attached in Vercel regardless —
// pay links already issued carry it for thirty days and have to keep working.
const PAY_BASE_FALLBACK = 'https://portal.classicalelements.com';
const payBaseUrlOf = (brand, cfg) => {
    const m = (cfg && cfg.payBaseUrls) || {};
    const pick = String(m[String(brand || '').toLowerCase()] || m.default || PAY_BASE_FALLBACK).trim();
    // Only ever https, and never a trailing slash — the token is appended to it.
    return (/^https:\/\/[^\s/]+$/.test(pick.replace(/\/+$/, '')) ? pick.replace(/\/+$/, '') : PAY_BASE_FALLBACK);
};
const payUrlOf = (token, brand, cfg) => `${payBaseUrlOf(brand, cfg)}/#/pay/${token}`;
// One gateway key per brand — a brand with no key REFUSES rather than charging the wrong entity
// (the UPS NO_UPS_ACCOUNT_FOR_BRAND rule; money must land in the right NetSuite subsidiary).
const nmiKeyFor = (brand, environment) => {
    const b = String(brand || '').toLowerCase();
    if (environment === 'SANDBOX' && b === 'ce') return NMI_SANDBOX_KEY_CE.value().trim();
    if (environment === 'PRODUCTION' && b === 'uniquity') return NMI_LIVE_KEY_UNIQUITY.value().trim();
    throw new HttpsError('failed-precondition', `NO_NMI_ACCOUNT_FOR_BRAND: no ${environment} gateway key is on file for "${brand}".`);
};
// WHICH BRAND OWNS THIS DOCUMENT. The two collections spell it differently — a CPQ job carries
// `brandId`, an Order Entry sales order carries `brand` — and reading only one of them is how a
// Uniq'uity order would quietly be charged to Classical Elements' merchant account. An unmarked
// document REFUSES: a default here is money in the wrong company's bank, which no error message
// afterwards can undo.
const brandOfDoc = (d, what = 'this order') => {
    const b = String((d && (d.brandId || d.brand)) || '').toLowerCase();
    if (!b) throw new HttpsError('failed-precondition', `NO_BRAND_ON_DOCUMENT: ${what} does not say which brand it belongs to, so there is no way to know which merchant account to charge.`);
    return b;
};
const money = (v) => Math.round(Number(v) * 100) / 100;

// Staff mint a link for a document. The amount rules are stored ON the link, so the payer cannot
// alter them later.
// THE MERCHANT OF RECORD, per brand — the company whose merchant account takes the money, and so
// the name that appears on the cardholder's statement. The pay page must say the SAME name: a page
// headed "Classical Elements" against a statement line reading MC America is how a customer decides
// they do not recognise a charge, and a chargeback follows (Stuart 2026-10-08, MC America dba
// Uniq'uity going live). This is deliberately the LEGAL entity, not the trading name the packing
// lists use.
const PAY_MERCHANT_NAME = {
    ce: 'Classical Elements',
    uniquity: "MC America dba Uniq'uity",
    m2c: 'M2C Studio',
    leyla: 'Leyla Gans LLC',
};

exports.payLinkCreate = onCall({ enforceAppCheck: true }, async (request) => {
    assertCanTakePayment(request);
    const { docType, collection, docId, brand, reference, customerName, totalAmount, depositPct } = request.data || {};
    const type = String(docType || '').toUpperCase();
    if (!['QUOTE', 'SALES_ORDER', 'INVOICE'].includes(type)) throw new HttpsError('invalid-argument', 'docType must be QUOTE, SALES_ORDER or INVOICE.');
    const cfg = await nmiConfig();   // for the brand's own pay domain
    const total = money(totalAmount);
    if (!(total > 0)) throw new HttpsError('invalid-argument', 'A total greater than zero is required.');
    // An invoice is paid in full. A quote / sales order asks for a deposit: 50% unless staff say
    // otherwise, either as a percentage or as a flat figure ("$2,500 down" — Stuart 2026-09-23).
    const flat = money((request.data || {}).flatAmount);
    let pct = type === 'INVOICE' ? 100 : (Number(depositPct) > 0 && Number(depositPct) <= 100 ? Number(depositPct) : 50);
    let due = type === 'INVOICE' ? total : money(total * pct / 100);
    if (type !== 'INVOICE' && flat > 0) {
        if (flat > total) throw new HttpsError('invalid-argument', 'The deposit cannot be more than the total.');
        due = flat;
        pct = Math.round(flat / total * 100);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    // Existing NetSuite invoices: the link pays exactly those, in full, and cannot be part-paid.
    const invoices = Array.isArray((request.data || {}).invoices) ? (request.data || {}).invoices : [];
    await admin.firestore().collection('pay_links').doc(token).set({
        ...(invoices.length ? { invoices: invoices.map((i) => ({ id: String(i.id), tranid: String(i.tranid || ''), amount: money(i.amount) })) } : {}),
        token, docType: type, collection: String(collection || ''), docId: String(docId || ''),
        brand: String(brand || 'ce').toLowerCase(), reference: cleanStr(reference, 60), customerName: cleanStr(customerName, 120),
        customerId: String((request.data || {}).customerId || ''),
        totalAmount: total, depositPct: pct, amountDue: due, minAmount: due, maxAmount: total,
        status: 'OPEN', createdAt: now, createdBy: (request.auth && request.auth.token && request.auth.token.name) || '',
        expiresAt: now + PAY_LINK_DAYS * 86400000,
    });
    // merchantName travels with the link so the staff screen signs an email with the company that
    // is actually taking the money — ONE definition of the merchant of record, here on the server,
    // rather than another brand-name map in the browser that drifts from this one.
    return {
        token, url: payUrlOf(token, brand, cfg),
        amountDue: due, totalAmount: total, expiresAt: now + PAY_LINK_DAYS * 86400000,
        merchantName: PAY_MERCHANT_NAME[String(brand || '').toLowerCase()] || '',
    };
});

// Every link a document has ever had, newest first — what the staff panel on the CRM card, the
// invoice and Order Entry all read. Amounts and status only; no card data exists to leak.
exports.payLinksFor = onCall({ enforceAppCheck: true }, async (request) => {
    assertCanTakePayment(request);
    const { collection, docId, reference } = request.data || {};
    const cfg = await nmiConfig();   // a link is shown at its brand's own pay domain
    const col = admin.firestore().collection('pay_links');
    const q = (String(collection || '') && String(docId || ''))
        ? col.where('collection', '==', String(collection)).where('docId', '==', String(docId))
        : col.where('reference', '==', cleanStr(reference, 60));
    const snap = await q.limit(25).get();
    const links = snap.docs.map((d) => {
        const l = d.data() || {};
        return {
            token: l.token, url: payUrlOf(l.token, l.brand, cfg),
            docType: l.docType, reference: l.reference || '', status: l.status || '',
            totalAmount: l.totalAmount || 0, amountDue: l.amountDue || 0, depositPct: l.depositPct || 0,
            createdAt: l.createdAt || 0, createdBy: l.createdBy || '', expiresAt: l.expiresAt || 0,
            paidAt: l.paidAt || 0, paidAmount: l.paidAmount || 0, transactionId: l.transactionId || '',
            lastError: l.lastError || '',
            // So a link reopened later signs its email with the same company that minted it.
            merchantName: PAY_MERCHANT_NAME[String(l.brand || '').toLowerCase()] || '',
        };
    }).sort((a, b) => b.createdAt - a.createdAt);
    return { links, paidTotal: links.filter((l) => l.status === 'PAID').reduce((s, l) => s + Number(l.paidAmount || 0), 0) };
});

// Cancel a link that should no longer be payable (wrong amount, resent, order changed). A PAID link
// is never voided — the money happened, and the record says so.
exports.payLinkVoid = onCall({ enforceAppCheck: true }, async (request) => {
    assertCanTakePayment(request);
    const token = String((request.data || {}).token || '');
    const ref = admin.firestore().collection('pay_links').doc(token);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'No such payment link.');
    if ((snap.data() || {}).status === 'PAID') throw new HttpsError('failed-precondition', 'That link has been paid — it cannot be cancelled.');
    await ref.update({ status: 'VOID', voidedAt: Date.now(), voidedBy: (request.auth && request.auth.token && request.auth.token.name) || '' });
    return { ok: true };
});

const payLinkOf = async (token) => {
    const t = String(token || '');
    if (!/^[A-Za-z0-9_-]{20,90}$/.test(t)) throw new HttpsError('not-found', 'This payment link is not valid.');
    const snap = await admin.firestore().collection('pay_links').doc(t).get();
    if (!snap.exists) throw new HttpsError('not-found', 'This payment link is not valid.');
    const link = snap.data();
    if (link.status === 'PAID') throw new HttpsError('failed-precondition', 'This link has already been paid. Contact us if you need another.');
    if (link.status === 'VOID') throw new HttpsError('failed-precondition', 'This link has been cancelled. Contact us for a new one.');
    if (Number(link.expiresAt) < Date.now()) throw new HttpsError('failed-precondition', 'This payment link has expired. Contact us for a new one.');
    return link;
};

// What the pay page shows. Public by design (the token IS the credential) — it returns only what a
// payer must see: who it is for, which document, and what is owed.
// WHERE A RECEIPT GOES — asked once, by the pay page and by the sender alike (Stuart 2026-10-17:
// "i made sure the email address is loaded in crm and the payment link does not see it"). The
// order first, then the CUSTOMER'S OWN RECORD and its contacts. Two separate lookups would be two
// answers to the same question, and the payer would be promised one address and sent another.
const receiptAddressFor = async ({ collection, docId }) => {
    if (!collection || !docId) return { to: '', customerName: '' };
    const db = admin.firestore();
    const d = await db.collection(String(collection)).doc(String(docId)).get().catch(() => null);
    const doc0 = d && d.exists ? (d.data() || {}) : {};
    let to = String(doc0.email || doc0.customerEmail || '').trim();
    const custField = doc0.customer;
    let customerName = custField && typeof custField === 'object' ? String(custField.name || '') : String(custField || '');
    if (!to) {
        const custId = String(doc0.customerId || (custField && custField.id) || '');
        if (custId) {
            const crm = await db.collection('crm_records').doc(custId).get().catch(() => null);
            const c = crm && crm.exists ? (crm.data() || {}) : {};
            to = String(c.email || '').trim();
            if (!mail.looksLikeEmail(to)) {
                const contact = (Array.isArray(c.contacts) ? c.contacts : []).find((x) => mail.looksLikeEmail(x && x.email));
                to = contact ? String(contact.email).trim() : '';
            }
            if (!customerName) customerName = String(c.name || '');
        }
    }
    return { to: mail.looksLikeEmail(to) ? to : '', customerName };
};

// Shown to a payer as reassurance, never in full: a pay link can be forwarded, and the address on
// file is the customer's, not the link-holder's. "st••••@classicalelements.com".
const maskEmail = (v) => {
    const m = /^([^@]+)@(.+)$/.exec(String(v || ''));
    if (!m) return '';
    const name = m[1];
    return `${name.slice(0, 2)}${'•'.repeat(Math.max(name.length - 2, 1))}@${m[2]}`;
};

exports.payIntent = onCall({ cors: true }, async (request) => {
    const link = await payLinkOf((request.data || {}).token);
    const cfg = await nmiConfig();
    const tokenizationKey = cfg.tokenizationKeys[link.brand] || '';
    if (!tokenizationKey) throw new HttpsError('failed-precondition', 'Card payments are not configured for this brand yet.');
    // Where a receipt would go if the payer types nothing — masked, so the page can reassure
    // without handing a forwarded link the customer's address.
    const onFile = await receiptAddressFor({ collection: link.collection, docId: link.docId });
    return {
        environment: cfg.environment,
        tokenizationKey,
        receiptOnFile: maskEmail(onFile.to),
        merchantName: PAY_MERCHANT_NAME[link.brand] || String(link.brand || '').toUpperCase(),
        collectJsUrl: cfg.environment === 'PRODUCTION' ? 'https://secure.nmi.com/token/Collect.js' : 'https://sandbox.nmi.com/token/Collect.js',
        docType: link.docType, reference: link.reference, customerName: link.customerName,
        totalAmount: link.totalAmount, amountDue: link.amountDue, minAmount: link.minAmount, maxAmount: link.maxAmount,
        depositPct: link.depositPct, expiresAt: link.expiresAt,
        invoices: Array.isArray(link.invoices) ? link.invoices : [],
    };
});

// The charge. The amount is re-checked against the link's own bounds; the browser's number is never
// trusted on its own. The link is claimed in a transaction so a double-click cannot pay twice.
exports.payCharge = onCall({ cors: true, secrets: [NMI_SANDBOX_KEY_CE, NMI_LIVE_KEY_UNIQUITY, POSTMARK_TOKEN_UNIQUITY, NS_ACCOUNT, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET] }, async (request) => {
    const { token, paymentToken, amount, payerName, email } = request.data || {};
    const link = await payLinkOf(token);
    const cfg = await nmiConfig();
    const pt = String(paymentToken || '').trim();
    if (!pt) throw new HttpsError('invalid-argument', 'Card details were not completed.');
    const amt = money(amount);
    if (!(amt >= money(link.minAmount) && amt <= money(link.maxAmount))) {
        throw new HttpsError('invalid-argument', `The amount must be between $${money(link.minAmount).toFixed(2)} and $${money(link.maxAmount).toFixed(2)}.`);
    }
    const key = nmiKeyFor(link.brand, cfg.environment);
    const db = admin.firestore();
    const ref = db.collection('pay_links').doc(link.token);

    // Claim the link first: a second attempt while one is in flight is refused rather than charged.
    await db.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        const s = (cur.data() || {}).status;
        if (s !== 'OPEN') throw new HttpsError('failed-precondition', 'This link is already being paid or has been paid.');
        tx.update(ref, { status: 'CHARGING', chargingAt: Date.now() });
    });

    let res = {};
    try {
        const host = cfg.environment === 'PRODUCTION' ? NMI_HOSTS.PRODUCTION : NMI_HOSTS.SANDBOX;
        const r = await fetch(`${host}/api/transact.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                security_key: key, type: 'sale', amount: amt.toFixed(2), payment_token: pt,
                orderid: cleanStr(link.reference, 50), order_description: `${link.docType} ${link.reference}`.trim(),
                first_name: cleanStr(payerName, 60), email: cleanStr(email, 120),
            }).toString(),
        });
        res = nmiParse(await r.text());
    } catch (e) {
        await ref.update({ status: 'OPEN', lastError: String(e.message || e) });
        throw new HttpsError('unavailable', 'The card could not be processed just now. Please try again.');
    }

    if (res.response !== '1') {
        await ref.update({ status: 'OPEN', lastError: res.responsetext || 'declined', lastDeclineAt: Date.now() });
        throw new HttpsError('failed-precondition', res.responsetext || 'The card was declined.');
    }

    // Paid. Record it on the link, in a payments ledger, and on the document itself.
    const paidAt = Date.now();
    const payment = {
        paidAt, amount: amt, transactionId: res.transactionid || '', authCode: res.authcode || '',
        ...(Array.isArray(link.invoices) && link.invoices.length ? { invoices: link.invoices, customerId: link.customerId || '' } : {}),
        brand: link.brand, docType: link.docType, collection: link.collection, docId: link.docId,
        reference: link.reference, payerName: cleanStr(payerName, 60), email: cleanStr(email, 120),
        environment: cfg.environment, method: 'CARD', gateway: 'NMI',
        // What a deposit vs a payment means in NetSuite is Stuart's rule: deposits on quotes and
        // sales orders, payments on invoices. The posting itself waits on Eric's field ids.
        netsuiteKind: (link.docType === 'INVOICE' || (Array.isArray(link.invoices) && link.invoices.length)) ? 'customerpayment' : 'customerdeposit',
        netsuitePosted: false,
    };
    await ref.update({ status: 'PAID', paidAt, paidAmount: amt, transactionId: res.transactionid || '' });
    const payRec = await db.collection('payments').add(payment);
    postPaymentSoon(payRec.id);   // deposit / payment into NetSuite, automatically (Stuart 2026-09-24)
    emailPaymentReceived(payRec.id);   // ✉️ and tell the customer what we received (2026-10-16)
    if (link.collection && link.docId) {
        await db.doc(`${link.collection}/${link.docId}`).set({
            paymentsTotal: admin.firestore.FieldValue.increment(amt),
            lastPaymentAt: paidAt, lastPaymentAmount: amt, lastPaymentTxn: res.transactionid || '',
            paymentEnvironment: cfg.environment,
        }, { merge: true }).catch((e) => console.error('pay stamp failed', e));
    }
    return { ok: true, amount: amt, transactionId: res.transactionid || '', reference: link.reference, environment: cfg.environment };
});

// ── A PAYMENT REACHES NETSUITE ───────────────────────────────────────────────────────────────
// Eric's spec (2026-09-23), Stuart's answers (2026-09-24: NMI transaction id as the check #,
// automatic posting, memo "Card payment · <ref> · NMI <txn>"):
//   quote / sales order → CUSTOMER DEPOSIT, which MUST name its sales order;
//   invoice             → CUSTOMER PAYMENT, applying to that invoice on the apply sublist.
// Writes go through the SAME ns_outbox every other NetSuite write uses — serial, retried, visible
// in HQ 11.1, and refused twice by a dedupe key. A SANDBOX payment never posts.
const nsPay = require('./nsPayment');
const mail = require('./emailOutbox');

// The brand's location, the same map the rest of the app pushes against.
const NS_BRAND_LOCATION = { m2c: '19', ce: '17', uniquity: '20', leyla: '18' };

// Enqueue exactly as Shared/nsOutbox does from the browser (keep the two in step): the worker
// drains ns_outbox and knows nothing about who wrote the entry.
const enqueueNsWriteServer = async ({ kind, label, targetUrl, method, payload, sourceApp, createdBy, writeBack, dedupeKey }) => {
    const db = admin.firestore();
    if (dedupeKey) {
        const inflight = await db.collection('ns_outbox').where('dedupeKey', '==', dedupeKey).get();
        const live = inflight.docs.map((d) => d.data()).filter((e) => ['PENDING', 'POSTING', 'PROCESSING', 'WAITING'].includes(e.status));
        if (live.length) throw new HttpsError('failed-precondition', `already queued (${live[0].label || dedupeKey} is ${live[0].status})`);
    }
    const ref = db.collection('ns_outbox').doc();
    const p = payload ? JSON.parse(JSON.stringify(payload)) : {};
    const stamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit' });
    if (typeof p.memo === 'string') p.memo = `${p.memo} [app push ${stamp} #${ref.id.slice(0, 6)}]`.slice(0, 299);
    await ref.set({
        id: ref.id, kind: kind || 'write', label: label || '', sourceApp: sourceApp || 'PAYMENTS', createdBy: createdBy || '',
        targetUrl, method: method || 'POST', payload: p, writeBack: writeBack || null, dedupeKey: dedupeKey || null,
        status: 'PENDING', attempts: 0, lastError: null, nsId: null, nsTran: null,
        createdAt: Date.now(), nextAttemptAt: Date.now(), leasedAt: null, postedAt: null,
    });
    return ref.id;
};

// One SuiteQL read with the server's own NetSuite credentials — used to turn an invoice NUMBER
// (all we store) into the internal id the apply sublist needs.
const nsQuery = async (sql, { limit = 1000, offset = 0 } = {}) => {
    const url = `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=${Number(limit)}&offset=${Number(offset)}`;
    const creds = {
        account: NS_ACCOUNT.value(), consumerKey: NS_CONSUMER_KEY.value(), consumerSecret: NS_CONSUMER_SECRET.value(),
        tokenId: NS_TOKEN_ID.value(), tokenSecret: NS_TOKEN_SECRET.value(),
    };
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': generateNetSuiteHeader('POST', url, creds), 'Content-Type': 'application/json', 'Prefer': 'transient' },
        body: JSON.stringify({ q: sql }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
        // NEVER return an empty list for a failed query: "nothing open" and "the query broke" must
        // not look the same on screen (2026-09-24 — they did, and it cost a debugging round).
        const detail = (body && body['o:errorDetails'] && body['o:errorDetails'][0] && body['o:errorDetails'][0].detail)
            || (body && body.title) || `HTTP ${r.status}`;
        throw new HttpsError('failed-precondition', `NetSuite refused the query: ${String(detail).slice(0, 300)}`);
    }
    const items = body.items || [];
    items.hasMore = body.hasMore === true;   // the caller must be able to say "there are more"
    return items;
};

// Everything a payment needs to become a NetSuite record, gathered from the documents we hold.
const resolvePaymentTargets = async (pay) => {
    const db = admin.firestore();
    const brand = String(pay.brand || 'ce').toLowerCase();
    const locationId = NS_BRAND_LOCATION[brand] || '';
    let customerId = String(pay.customerId || '');
    let salesOrderNsId = '';
    let invoiceNsId = '';
    let reference = pay.reference || '';

    if (Array.isArray(pay.invoices) && pay.invoices.length) {
        return { brand, locationId, customerId, salesOrderNsId: '', invoiceNsId: String(pay.invoices[0].id || ''), reference };
    }
    const docSnap = pay.collection && pay.docId ? await db.collection(pay.collection).doc(pay.docId).get() : null;
    const d = docSnap && docSnap.exists ? { id: docSnap.id, ...docSnap.data() } : null;
    if (d) {
        customerId = customerId || String((d.customer && d.customer.id) || d.customerId || '');
        reference = reference || (pay.collection === 'jobs' ? String(d.quoteNo || d.jobId || d.id) : `SO ${d.soId || d.id}`);
        if (pay.collection === 'hq_sales_orders') {
            salesOrderNsId = String(d.nsInternalId || '');
            if (d.nsInvoiceNo) {
                const rows = await nsQuery(`SELECT id FROM transaction WHERE type = 'CustInvc' AND tranid = '${String(d.nsInvoiceNo).replace(/'/g, "''")}'`);
                invoiceNsId = rows.length ? String(rows[0].id) : '';
            }
        } else {
            // A quote's deposit belongs to the SALES ORDER raised from it — which may not exist yet.
            const so = await db.collection('hq_sales_orders').where('hqJobId', '==', String(d.jobId || d.id)).limit(1).get();
            if (!so.empty) salesOrderNsId = String((so.docs[0].data() || {}).nsInternalId || '');
        }
    }
    return { brand, locationId, customerId, salesOrderNsId, invoiceNsId, reference };
};

// Post one recorded payment. Safe to call twice: a posted or queued payment is left alone, and a
// payment that is not ready records WHY and waits (a deposit whose sales order has not landed).
const postPaymentToNetSuite = async (paymentId) => {
    const db = admin.firestore();
    const ref = db.collection('payments').doc(paymentId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, reason: 'no such payment' };
    const pay = { id: snap.id, ...snap.data() };
    if (pay.netsuitePosted === true || pay.netsuiteQueued === true) return { ok: true, already: true };

    const t = await resolvePaymentTargets(pay);
    const kind = pay.netsuiteKind === 'customerpayment' ? 'customerpayment' : 'customerdeposit';
    // A payment against EXISTING NetSuite invoices already names them — no document to resolve.
    const chosenInvoices = Array.isArray(pay.invoices) ? pay.invoices : [];
    if (chosenInvoices.length) t.invoiceNsId = String(chosenInvoices[0].id || '');
    const state = nsPay.postabilityOf({
        kind, customerId: t.customerId, salesOrderNsId: t.salesOrderNsId, invoiceNsId: t.invoiceNsId,
        locationId: t.locationId, amount: pay.amount, environment: pay.environment,
    });
    if (!state.ready) {
        await ref.set({ netsuiteWaiting: state.reason, netsuiteCheckedAt: Date.now() }, { merge: true });
        return { ok: false, waiting: state.waiting, reason: state.reason };
    }

    const payload = kind === 'customerpayment'
        ? nsPay.customerPaymentPayload({ customerId: t.customerId, invoiceNsId: t.invoiceNsId, invoices: chosenInvoices, locationId: t.locationId, amount: pay.amount, reference: t.reference, transactionId: pay.transactionId })
        : nsPay.customerDepositPayload({ customerId: t.customerId, salesOrderNsId: t.salesOrderNsId, locationId: t.locationId, amount: pay.amount, reference: t.reference, transactionId: pay.transactionId });

    const outboxId = await enqueueNsWriteServer({
        kind, label: `${kind === 'customerpayment' ? 'Customer payment' : 'Customer deposit'} — ${t.reference} $${Number(pay.amount).toFixed(2)} (NMI ${pay.transactionId || ''})`,
        targetUrl: nsPay.nsPaymentUrl(kind), method: 'POST', payload,
        sourceApp: 'PAYMENTS', createdBy: pay.source === 'PORTAL' ? 'portal' : 'staff',
        dedupeKey: `nspay:${paymentId}`,
        writeBack: { collection: 'payments', docId: paymentId, patch: { netsuitePosted: true, netsuiteWaiting: '' }, idField: 'nsPaymentId', tranField: 'nsPaymentTran' },
    });
    await ref.set({ netsuiteQueued: true, netsuiteQueuedAt: Date.now(), netsuiteOutboxId: outboxId, netsuiteWaiting: '' }, { merge: true });
    return { ok: true, outboxId };
};

// Fire-and-forget after a successful charge: a payment must never fail because NetSuite is busy.
const postPaymentSoon = (paymentId) => postPaymentToNetSuite(paymentId)
    .catch((e) => console.error('payment → NetSuite failed', paymentId, e && e.message));

// ── THE INVOICES THAT WERE NEVER IN THE APP ──────────────────────────────────────────────────
// NetSuite is full of invoices this app did not raise, and will be for a long time. When the old
// processor is switched off, this is how they get paid: read the open ones, let staff or the
// customer tick which to pay, charge once, and post ONE customer payment applying to each.
// Stuart 2026-09-24: no part payments on an invoice — tick it and it is paid in full; due dates
// must show; each brand sees only its own subsidiary's invoices.
const NS_BRAND_SUBSIDIARY = { m2c: '3', ce: '2', uniquity: '6', leyla: '5' };

// Filters exist because an unfiltered pull is thousands of rows and SuiteQL pages at 1,000
// (Stuart 2026-09-24). A date is only ever a date, a name is escaped, and the caller is TOLD when
// more rows exist rather than being handed a quiet half-list.
const sqlDate = (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
    return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};
const nsOpenInvoiceRows = async ({ brand, entityId, customerLike = '', dueFrom = '', dueTo = '', limit = 200, offset = 0 }) => {
    const subsidiary = NS_BRAND_SUBSIDIARY[String(brand || 'ce').toLowerCase()];
    if (!subsidiary) throw new HttpsError('failed-precondition', `No NetSuite subsidiary on file for "${brand}".`);
    const name = cleanStr(customerLike, 60).replace(/'/g, "''").toUpperCase();
    const from = sqlDate(dueFrom);
    const to = sqlDate(dueTo);
    // Eric's field list (2026-09-24): subsidiary / location live on the MAIN LINE, not the
    // transaction header — which is why filtering the header found nothing. Amount due is the
    // remaining balance (deposits applied and credit memos already netted off), with
    // total-minus-paid as the fallback if the account leaves that column empty.
    const where = [
        "t.type = 'CustInvc'",
        // STATUS IS THE BARE CODE IN SuiteQL. 'A' = Open; 'B' = Paid In Full. Eric's "Invoice:Open"
        // is the saved-search form, and in SQL it is a valid string matching NOTHING — the silent
        // reason both lists read as "nothing open" (2026-09-24). Keep this in step with
        // Shared/nsInvoiceQuery.js, which is the same query for the staff side.
        "t.status = 'A'",
        // Belt and braces on top of the status: a balance must actually remain, so anything paid,
        // closed or voided out to zero can never be offered to a customer to pay again.
        'NVL(t.foreignamountunpaid, NVL(t.foreigntotal, 0) - NVL(t.foreignamountpaid, 0)) <> 0',
        `tl.subsidiary = ${Number(subsidiary)}`,
        ...(entityId ? [`t.entity = ${Number(entityId)}`] : []),
        ...(name ? [`(UPPER(c.companyname) LIKE '%${name}%' OR UPPER(c.entityid) LIKE '%${name}%')`] : []),
        ...(from ? [`t.duedate >= TO_DATE('${from}', 'YYYY-MM-DD')`] : []),
        ...(to ? [`t.duedate <= TO_DATE('${to}', 'YYYY-MM-DD')`] : []),
    ].join(' AND ');
    const rows = await nsQuery(
        `SELECT t.id, t.tranid, t.trandate, t.duedate, t.entity, c.companyname AS customername, `
        + `t.otherrefnum AS ponumber, BUILTIN.DF(t.terms) AS terms, t.memo, tl.location AS locationid, `
        + `ABS(NVL(t.foreigntotal, 0)) AS total, ABS(NVL(t.foreignamountpaid, 0)) AS paid, `
        + `ABS(NVL(t.foreignamountunpaid, NVL(t.foreigntotal, 0) - NVL(t.foreignamountpaid, 0))) AS due `
        + `FROM transaction t `
        + `JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T' `
        + `JOIN customer c ON c.id = t.entity `
        + `WHERE ${where} ORDER BY t.duedate, t.id`,
        { limit: Math.min(Number(limit) || 200, 1000), offset: Number(offset) || 0 },
    );
    const invoices = rows.map((r) => ({
        id: String(r.id), tranid: r.tranid || '', date: r.trandate || '', dueDate: r.duedate || '',
        customerNsId: String(r.entity || ''), customerName: r.customername || '',
        poNumber: r.ponumber || '', terms: r.terms || '', memo: r.memo || '', locationId: String(r.locationid || ''),
        total: Number(r.total || 0), paid: Number(r.paid || 0), due: money(r.due),
    })).filter((i) => i.due > 0.005);
    invoices.hasMore = rows.hasMore === true;
    return invoices;
};

// (The STAFF list is not here: HQ reads NetSuite through the netsuiteProxy like every other staff
// screen — Shared/nsInvoiceQuery. A second server-side path with its own secret bindings failed to
// deploy and bought nothing, 2026-09-24. Only the PORTAL needs a function, because a customer has
// no proxy access.)

// A portal customer sees THEIR OWN open invoices — the entity id is taken from their claim, never
// from the browser, so no login can read another customer's ledger.
exports.portalOpenInvoices = onCall({
    cors: true,
    secrets: [NS_ACCOUNT, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET],
}, async (request) => {
    const customerId = assertPortalCustomer(request);
    const entityId = nsPay.nsCustomerIdOf(customerId);
    if (!entityId) return { invoices: [], totalDue: 0 };
    const crm = await admin.firestore().collection('crm_records').doc(customerId).get();
    const brand = String(((crm.exists && crm.data()) || {}).brandId || 'ce').toLowerCase();
    const invoices = await nsOpenInvoiceRows({ brand, entityId });
    return { invoices, totalDue: money(invoices.reduce((s, i) => s + i.due, 0)) };
});

// Charge a set of existing invoices and post ONE customer payment against them. Balances are
// re-read from NetSuite at this moment: an invoice paid by cheque yesterday can no longer be paid
// here, and the amount charged is what NetSuite says is owed — never a figure from the browser.
const payNsInvoices = async ({ brand, customerId, invoiceIds, paymentToken, vaultId, environment, payerName, email, source }) => {
    const ids = [...new Set((invoiceIds || []).map((x) => String(x)))].filter((x) => /^\d+$/.test(x));
    if (!ids.length) throw new HttpsError('invalid-argument', 'Choose at least one invoice.');
    const entityId = nsPay.nsCustomerIdOf(customerId);
    const open = await nsOpenInvoiceRows({ brand, entityId });
    const chosen = open.filter((i) => ids.includes(i.id));
    if (chosen.length !== ids.length) {
        throw new HttpsError('failed-precondition', 'One of those invoices is no longer open — refresh the list and try again.');
    }
    const amount = money(chosen.reduce((s, i) => s + i.due, 0));
    if (!(amount > 0)) throw new HttpsError('failed-precondition', 'Nothing is owed on those invoices.');

    const res = await nmiSale({
        environment, brand, amount, paymentToken, vaultId,
        orderRef: chosen.map((i) => i.tranid).join(', ').slice(0, 50), payerName, email,
    });

    const paidAt = Date.now();
    const reference = chosen.length === 1 ? chosen[0].tranid : `${chosen.length} invoices`;
    const payRec = await admin.firestore().collection('payments').add({
        paidAt, amount, transactionId: res.transactionid || '', authCode: res.authcode || '',
        brand, docType: 'NS_INVOICES', collection: '', docId: '', reference,
        invoices: chosen.map((i) => ({ id: i.id, tranid: i.tranid, amount: i.due })),
        customerId, payerName: cleanStr(payerName, 60), email: cleanStr(email, 120),
        environment, method: 'CARD', gateway: 'NMI', source: source || 'STAFF',
        netsuiteKind: 'customerpayment', netsuitePosted: false,
    });
    postPaymentSoon(payRec.id);
    emailPaymentReceived(payRec.id);   // ✉️
    return { ok: true, amount, transactionId: res.transactionid || '', invoices: chosen.map((i) => i.tranid), environment };
};

exports.portalPayInvoices = onCall({
    cors: true,
    secrets: [NMI_SANDBOX_KEY_CE, NMI_LIVE_KEY_UNIQUITY, POSTMARK_TOKEN_UNIQUITY, NS_ACCOUNT, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET],
}, async (request) => {
    const customerId = assertPortalCustomer(request);
    const { invoiceIds, vaultId, paymentToken, saveCard } = request.data || {};
    const cfg = await nmiConfig();
    const crm = await admin.firestore().collection('crm_records').doc(customerId).get();
    const brand = String(((crm.exists && crm.data()) || {}).brandId || 'ce').toLowerCase();

    let useVault = String(vaultId || '');
    if (useVault) {
        const ok = (((crm.exists && crm.data()) || {}).vaultCards || []).some((c) => String(c.vaultId) === useVault);
        if (!ok) throw new HttpsError('permission-denied', 'That card is not on your account.');
    } else if (saveCard === true) {
        useVault = (await vaultAddCard({ customerId, paymentToken, cfg, brand })).vaultId;
    }
    return payNsInvoices({
        brand, customerId, invoiceIds, environment: cfg.environment,
        vaultId: useVault, paymentToken: useVault ? '' : paymentToken,
        email: (request.auth.token && request.auth.token.email) || '', source: 'PORTAL',
    });
});

// ── THE PORTAL'S OWN CHECKOUT ────────────────────────────────────────────────────────────────
// A signed-in trade customer pays their own quote / sales order / invoice, and may keep a card for
// next time. The card itself lives in NMI's Customer Vault — we hold a vault id, the brand and the
// last four, which are not card data. Stuart 2026-09-23: customers save their own cards.
//
// Everything here re-derives what is owed from the DOCUMENT; the browser's numbers are checked
// against it, never trusted. The charge and the recording are the same helpers the pay link uses.
const nmiSale = async ({ environment, brand, amount, paymentToken, vaultId, orderRef, payerName, email }) => {
    const key = nmiKeyFor(brand, environment);
    const host = environment === 'PRODUCTION' ? NMI_HOSTS.PRODUCTION : NMI_HOSTS.SANDBOX;
    const fields = {
        security_key: key, type: 'sale', amount: Number(amount).toFixed(2),
        orderid: cleanStr(orderRef, 50), order_description: cleanStr(orderRef, 60),
        ...(vaultId ? { customer_vault_id: String(vaultId) } : { payment_token: String(paymentToken || '') }),
        ...(payerName ? { first_name: cleanStr(payerName, 60) } : {}),
        ...(email ? { email: cleanStr(email, 120) } : {}),
    };
    const r = await fetch(`${host}/api/transact.php`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
    });
    const res = nmiParse(await r.text());
    if (res.response !== '1') throw new HttpsError('failed-precondition', res.responsetext || 'The card was declined.');
    return res;
};

// What this customer can pay, and what is owed on each — balance = what the document says minus
// what has already been paid against it. A quote / sales order offers a 50% deposit as the starting
// figure and allows anything up to the balance; an invoice is paid in full.
exports.portalPayables = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const db = admin.firestore();
    const cfg = await nmiConfig();
    const out = [];
    // PACKING DOES NOT DECIDE WHAT A CUSTOMER PAYS (Stuart 2026-10-17). It used to: `packStatus ===
    // 'Packed'` quietly meant "pay in full", which was MY inference, not his rule. What governs
    // whether an order may ship is the customer's TERMS in NetSuite, and that gate lives on the
    // packing side, not here. Pay-in-full-on-the-spot is a SHOW FLOOR rule — a CSR at the Uniq'uity
    // counter setting the deposit on the pay card — not something the portal should impose on a
    // trade customer who has terms.
    //
    // So only an INVOICE is paid in full here, which is Stuart's own rule, and a quote or sales
    // order offers the 50% deposit whatever the warehouse has done with it.
    const push = (d, collection, docType, reference, total) => {
        const paid = Number(d.paymentsTotal || 0);
        const balance = money(Number(total || 0) - paid);
        if (!(balance > 0)) return;
        const min = docType === 'INVOICE' ? balance : money(Math.min(balance, Number(total) * 0.5));
        out.push({
            collection, docId: d.id, docType, reference, total: money(total), paid: money(paid),
            balance, suggested: min, minAmount: min, maxAmount: balance,
        });
    };

    const jobsSnap = await db.collection('jobs').where('customer.id', '==', customerId).get();
    const jobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((j) => !j.deleted && !j.portalDeleted);
    jobs.forEach((j) => {
        // Only a priced, accepted piece of work is payable — never an unpriced request.
        if (!['CONFIGURED', 'APPROVED', 'ORDERED'].includes(String(j.status || ''))) return;
        const total = Number((j.cpqData && j.cpqData.totalPrice) || 0) + Number(j.shippingAmount || 0);
        push(j, 'jobs', String(j.status) === 'ORDERED' ? 'SALES_ORDER' : 'QUOTE', j.quoteNo || j.jobId || j.id, total);
    });

    const qsSnap = await db.collection('hq_sales_orders').where('customerId', '==', customerId).get();
    qsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((o) => !o.deleted).forEach((o) => {
        // It is an INVOICE when NetSuite has actually billed it — and nothing else makes it one. A
        // packed-but-unbilled order is still a sales order, and is named as one rather than shown
        // to a customer as an invoice that does not exist.
        push(o, 'hq_sales_orders', o.nsInvoiceNo ? 'INVOICE' : 'SALES_ORDER', `SO ${o.soId || o.id}`, Number(o.invoiceTotal || 0));
    });

    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const cards = (((crmSnap.exists && crmSnap.data()) || {}).vaultCards || [])
        .map((c) => ({ vaultId: c.vaultId, brand: c.brand || 'Card', last4: c.last4 || '', exp: c.exp || '', addedAt: c.addedAt || 0 }));

    // The card fields belong to the customer's OWN brand's gateway — a CE tokenization key would
    // hand Uniq'uity's cards to the wrong merchant account.
    const custBrand = brandOfDoc((crmSnap.exists && crmSnap.data()) || {}, 'your account');
    return {
        environment: cfg.environment,
        tokenizationKey: cfg.tokenizationKeys[custBrand] || '',
        collectJsUrl: cfg.environment === 'PRODUCTION' ? 'https://secure.nmi.com/token/Collect.js' : 'https://sandbox.nmi.com/token/Collect.js',
        payables: out.sort((a, b) => String(a.reference).localeCompare(String(b.reference))),
        cards,
    };
});

// Keep a card for next time. The PAN never reaches us: the browser tokenises with NMI, and NMI
// stores the card in its vault. We keep the vault id and the last four — not card data.
// The vault belongs to a MERCHANT ACCOUNT, so a card is stored against the customer's own brand —
// a card vaulted under the wrong key cannot be charged by the right one later.
const vaultAddCard = async ({ customerId, paymentToken, cfg, brand }) => {
    if (!String(paymentToken || '').trim()) throw new HttpsError('invalid-argument', 'Card details were not completed.');
    const host = cfg.environment === 'PRODUCTION' ? NMI_HOSTS.PRODUCTION : NMI_HOSTS.SANDBOX;
    const r = await fetch(`${host}/api/transact.php`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ security_key: nmiKeyFor(brand, cfg.environment), customer_vault: 'add_customer', payment_token: String(paymentToken) }).toString(),
    });
    const res = nmiParse(await r.text());
    if (res.response !== '1' || !res.customer_vault_id) throw new HttpsError('failed-precondition', res.responsetext || 'The card could not be saved.');
    const card = {
        vaultId: String(res.customer_vault_id),
        brand: res.cc_type || 'Card',
        last4: String(res.cc_number || '').slice(-4),
        exp: res.cc_exp || '',
        addedAt: Date.now(),
    };
    await admin.firestore().collection('crm_records').doc(customerId)
        .set({ vaultCards: admin.firestore.FieldValue.arrayUnion(card) }, { merge: true });
    return card;
};

// A customer belongs to a brand (crm_records.brandId, stamped at creation) — that is the merchant
// account their saved cards live in.
const customerBrandOf = async (customerId) => {
    const snap = await admin.firestore().collection('crm_records').doc(String(customerId)).get();
    return brandOfDoc((snap.exists && snap.data()) || {}, 'your account');
};

exports.portalSaveCard = onCall({ cors: true, secrets: [NMI_SANDBOX_KEY_CE, NMI_LIVE_KEY_UNIQUITY] }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const cfg = await nmiConfig();
    const brand = await customerBrandOf(customerId);
    const card = await vaultAddCard({ customerId, paymentToken: (request.data || {}).paymentToken, cfg, brand });
    return { card };
});

exports.portalDeleteCard = onCall({ cors: true, secrets: [NMI_SANDBOX_KEY_CE, NMI_LIVE_KEY_UNIQUITY] }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const vaultId = String((request.data || {}).vaultId || '');
    const db = admin.firestore();
    const ref = db.collection('crm_records').doc(customerId);
    const snap = await ref.get();
    const cards = (((snap.exists && snap.data()) || {}).vaultCards || []);
    const card = cards.find((c) => String(c.vaultId) === vaultId);
    if (!card) throw new HttpsError('not-found', 'That card is not on your account.');
    const cfg = await nmiConfig();
    const host = cfg.environment === 'PRODUCTION' ? NMI_HOSTS.PRODUCTION : NMI_HOSTS.SANDBOX;
    await fetch(`${host}/api/transact.php`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ security_key: nmiKeyFor(await customerBrandOf(customerId), cfg.environment), customer_vault: 'delete_customer', customer_vault_id: vaultId }).toString(),
    }).catch(() => {});   // the card leaves OUR list either way; a vault orphan is harmless
    await ref.set({ vaultCards: cards.filter((c) => String(c.vaultId) !== vaultId) }, { merge: true });
    return { ok: true };
});

// Pay one of your own documents, with a saved card or a new one.
exports.portalPayDoc = onCall({ cors: true, secrets: [NMI_SANDBOX_KEY_CE, NMI_LIVE_KEY_UNIQUITY, POSTMARK_TOKEN_UNIQUITY, NS_ACCOUNT, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET] }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const { collection, docId, amount, vaultId, paymentToken, saveCard } = request.data || {};
    const db = admin.firestore();
    if (!['jobs', 'hq_sales_orders'].includes(String(collection || ''))) throw new HttpsError('invalid-argument', 'Unknown document.');
    const snap = await db.collection(String(collection)).doc(String(docId || '')).get();
    if (!snap.exists) throw new HttpsError('not-found', 'That order could not be found.');
    const d = { id: snap.id, ...snap.data() };

    // It must be THEIR document — a portal login may never pay (or read) another customer's order.
    const owner = String((d.customer && d.customer.id) || d.customerId || '');
    if (owner !== customerId) throw new HttpsError('permission-denied', 'That order is not on your account.');

    const total = collection === 'jobs'
        ? Number((d.cpqData && d.cpqData.totalPrice) || 0) + Number(d.shippingAmount || 0)
        : Number(d.invoiceTotal || 0);
    const balance = money(total - Number(d.paymentsTotal || 0));
    const amt = money(amount);
    if (!(balance > 0)) throw new HttpsError('failed-precondition', 'That order has already been paid.');
    if (!(amt > 0 && amt <= balance)) throw new HttpsError('invalid-argument', `The amount must be between $0.01 and $${balance.toFixed(2)}.`);

    const cfg = await nmiConfig();
    // The DOCUMENT's brand, read under both spellings — `d.brand` alone missed every CPQ job,
    // which carries `brandId`, and sent them to whichever account was the default.
    const brand = brandOfDoc(d, collection === 'jobs' ? 'that quote' : 'that sales order');
    const reference = collection === 'jobs' ? String(d.quoteNo || d.jobId || d.id) : `SO ${d.soId || d.id}`;

    let useVault = String(vaultId || '');
    if (useVault) {
        const crm = await db.collection('crm_records').doc(customerId).get();
        const ok = (((crm.exists && crm.data()) || {}).vaultCards || []).some((c) => String(c.vaultId) === useVault);
        if (!ok) throw new HttpsError('permission-denied', 'That card is not on your account.');
    } else if (saveCard === true) {
        // Save first, then charge the saved card, so one card entry does both.
        const saved = await vaultAddCard({ customerId, paymentToken, cfg, brand });
        useVault = saved.vaultId;
    }

    const res = await nmiSale({
        environment: cfg.environment, brand, amount: amt,
        vaultId: useVault || '', paymentToken: useVault ? '' : paymentToken,
        orderRef: reference, email: (request.auth.token && request.auth.token.email) || '',
    });

    const paidAt = Date.now();
    const portalPayRec = await db.collection('payments').add({
        paidAt, amount: amt, transactionId: res.transactionid || '', authCode: res.authcode || '',
        brand, docType: collection === 'jobs' ? 'QUOTE_OR_SO' : 'SALES_ORDER', collection, docId: d.id, reference,
        payerName: '', email: (request.auth.token && request.auth.token.email) || '', customerId,
        environment: cfg.environment, method: 'CARD', gateway: 'NMI', source: 'PORTAL',
        // A CUSTOMER PAYMENT NEEDS AN INVOICE TO APPLY TO. Packing is not billing: inferring one
        // from the other meant a payment taken between packing and billing posted as a payment with
        // nothing to apply to, and parked as WAITING with the money already captured (2026-10-17).
        // A deposit attaches to the sales order and posts straight away; the invoice, when it comes,
        // is settled against it.
        netsuiteKind: nsPay.paymentKindOf({ collection, nsInvoiceNo: d.nsInvoiceNo }),
        netsuitePosted: false,
    });
    await db.collection(String(collection)).doc(d.id).set({
        paymentsTotal: admin.firestore.FieldValue.increment(amt),
        lastPaymentAt: paidAt, lastPaymentAmount: amt, lastPaymentTxn: res.transactionid || '',
        paymentEnvironment: cfg.environment,
    }, { merge: true });
    postPaymentSoon(portalPayRec.id);
    emailPaymentReceived(portalPayRec.id);   // ✉️

    return { ok: true, amount: amt, transactionId: res.transactionid || '', balance: money(balance - amt), environment: cfg.environment };
});

// What has been taken and where each payment stands with NetSuite — the HQ 11 queue. A deposit
// whose sales order has not reached NetSuite yet reads as WAITING, not as a failure.
// ⏳ MONEY TAKEN THAT NETSUITE HAS NOT HEARD ABOUT. The queue above shows the last 25 of
// everything; this answers one question only — what is still out — so a dashboard can say it
// without reading the whole ledger. Unposted payments are rare, so a hundred is more than enough
// and the caller says so if it is not (Stuart 2026-10-17, after learning an app-only customer's
// deposit waits for ever unless a person matches the customer).
exports.paymentsWaiting = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const snap = await admin.firestore().collection('payments')
        .where('netsuitePosted', '==', false)
        .orderBy('paidAt', 'desc')
        .limit(100)
        .get();
    const rows = snap.docs.map((d) => {
        const p = d.data() || {};
        return {
            id: d.id, amount: Number(p.amount || 0), reference: p.reference || '',
            paidAt: Number(p.paidAt || 0), environment: p.environment || '',
            netsuitePosted: p.netsuitePosted === true, netsuiteQueued: p.netsuiteQueued === true,
            netsuiteWaiting: p.netsuiteWaiting || '', brand: p.brand || '',
        };
    });
    return { payments: rows, truncated: snap.size >= 100 };
});

exports.paymentsQueue = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const snap = await admin.firestore().collection('payments').orderBy('paidAt', 'desc').limit(25).get();
    return {
        payments: snap.docs.map((d) => {
            const p = d.data() || {};
            return {
                id: d.id, paidAt: p.paidAt || 0, amount: p.amount || 0, reference: p.reference || '',
                environment: p.environment || '', source: p.source || 'LINK', transactionId: p.transactionId || '',
                netsuiteKind: p.netsuiteKind || '', netsuitePosted: p.netsuitePosted === true,
                netsuiteQueued: p.netsuiteQueued === true, netsuiteWaiting: p.netsuiteWaiting || '',
                nsPaymentTran: p.nsPaymentTran || '',
            };
        }),
    };
});

// Try a waiting payment again — after the sales order lands in NetSuite, or the invoice is billed.
exports.paymentPostNow = onCall({
    enforceAppCheck: true,
    secrets: [NS_ACCOUNT, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET],
}, async (request) => {
    assertStaffAdmin(request);
    const res = await postPaymentToNetSuite(String((request.data || {}).paymentId || ''));
    return res;
});

// The last webhook events, for the HQ 11 → Integrations read-out: is the gateway reaching us, and
// does the signature verify? Admin-only; the raw body is truncated and never shown in full.
exports.nmiRecentEvents = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const snap = await admin.firestore().collection('nmi_events').orderBy('receivedAt', 'desc').limit(10).get();
    return {
        events: snap.docs.map((d) => {
            const e = d.data() || {};
            return {
                id: d.id,
                receivedAt: e.receivedAt || 0,
                verified: e.verified === true,
                matchedForm: e.matchedForm || '',
                eventType: e.eventType || '',
                transactionId: e.transactionId || '',
                amount: e.amount || '',
                responseText: e.responseText || '',
                orderId: e.orderId || '',
            };
        }),
    };
});

// ============================================================================
// 🚚 UPS — rate · ship · void (the WMS Fulfilment tab)
// ============================================================================
// Staff callables (App Check + a staff role; portal customers refused). The ENVIRONMENT is decided
// on the server from system/ups_config.environment ('CIE' test | 'PRODUCTION'), never by the
// browser — a test click can never buy a real label. Default is CIE. One shipper account per
// brand; a brand with no account on file refuses (NO_UPS_ACCOUNT_FOR_BRAND) — never a default.
const UPS_HOSTS = { CIE: 'https://wwwcie.ups.com', PRODUCTION: 'https://onlinetools.ups.com' };
const UPS_SHIPPERS = {
    ce: { secret: UPS_ACCOUNT_CE, name: 'Classical Elements', phone: '3369673313', address: { AddressLine: ['1200 Redding Dr'], City: 'High Point', StateProvinceCode: 'NC', PostalCode: '27260', CountryCode: 'US' } },
};
const upsTokenCache = {};

const assertStaffUser = (request) => {
    const t = (request.auth && request.auth.token) || {};
    if (!request.auth || t.customer === true || !String(t.role || '').trim()) {
        throw new HttpsError('permission-denied', 'Staff only.');
    }
    return String(t.role).toLowerCase();
};

const upsEnvironment = async () => {
    try {
        const snap = await admin.firestore().doc('system/ups_config').get();
        return snap.exists && snap.data().environment === 'PRODUCTION' ? 'PRODUCTION' : 'CIE';
    } catch (e) { return 'CIE'; }
};

const upsShipperFor = (brand) => {
    const s = UPS_SHIPPERS[String(brand || '').toLowerCase()];
    if (!s) throw new HttpsError('failed-precondition', `NO_UPS_ACCOUNT_FOR_BRAND: no UPS shipper account is on file for "${brand}".`);
    return { ...s, account: s.secret.value().trim() };
};

const upsToken = async (env, account) => {
    const hit = upsTokenCache[env];
    if (hit && hit.exp > Date.now() + 60000) return hit.token;
    const basic = Buffer.from(`${UPS_CLIENT_ID.value().trim()}:${UPS_CLIENT_SECRET.value().trim()}`).toString('base64');
    const r = await fetch(`${UPS_HOSTS[env]}/security/v1/oauth/token`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'x-merchant-id': account },
        body: 'grant_type=client_credentials',
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.access_token) throw new HttpsError('unavailable', `UPS login failed (HTTP ${r.status}): ${upsErrorText(body) || 'no token'}`);
    upsTokenCache[env] = { token: body.access_token, exp: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
    return body.access_token;
};

const upsCall = async (env, account, method, path, payload) => {
    const token = await upsToken(env, account);
    const r = await fetch(`${UPS_HOSTS[env]}${path}`, {
        method,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'transId': `ce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 'transactionSrc': 'ce-workcenter' },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new HttpsError('failed-precondition', `UPS refused (HTTP ${r.status}): ${upsErrorText(body) || 'no detail'}`);
    return body;
};

// Printable text only, trimmed and capped to UPS's field length.
const cleanStr = (v, max) => String(v === undefined || v === null ? '' : v)
    .split('').map((ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('')
    .trim().slice(0, max);

// The browser's ship-to + packages, checked and shaped for UPS. Refuses with the field named.
const upsShipToOf = (a) => {
    const s = a || {};
    const addr1 = cleanStr(s.addr1, 35), city = cleanStr(s.city, 30), state = cleanStr(s.state, 5).toUpperCase(), zip = cleanStr(s.zip, 10);
    const country = (cleanStr(s.country, 2) || 'US').toUpperCase();
    const missing = [['street', addr1], ['city', city], ['state', state], ['zip', zip]].filter(([, v]) => !v).map(([k]) => k);
    const name = cleanStr(s.addressee || s.attention, 35);
    if (!name) missing.unshift('name / company');
    if (missing.length) throw new HttpsError('invalid-argument', `Ship-to is missing: ${missing.join(', ')}.`);
    const phone = cleanStr(s.phone, 20).replace(/[^0-9]/g, '');
    return {
        Name: name,
        ...(cleanStr(s.attention, 35) ? { AttentionName: cleanStr(s.attention, 35) } : {}),
        ...(phone ? { Phone: { Number: phone } } : {}),
        Address: {
            AddressLine: [addr1, cleanStr(s.addr2, 35)].filter(Boolean),
            City: city, StateProvinceCode: state, PostalCode: zip, CountryCode: country,
            ...(s.residential === true ? { ResidentialAddressIndicator: '' } : {}),
        },
    };
};

const upsPackagesOf = (packages, packagingKey, reference) => {
    const list = Array.isArray(packages) ? packages : [];
    if (!list.length) throw new HttpsError('invalid-argument', 'Add at least one package.');
    if (list.length > 20) throw new HttpsError('invalid-argument', 'At most 20 packages per shipment.');
    return list.map((p, i) => {
        const [l, w, h, wt] = [Number(p.length), Number(p.width), Number(p.height), Number(p.weight)];
        const bad = [['length', l], ['width', w], ['height', h]].filter(([, v]) => !(v > 0 && v <= 108)).map(([k]) => k);
        if (bad.length) throw new HttpsError('invalid-argument', `Package ${i + 1}: ${bad.join(', ')} must be between 0 and 108 inches.`);
        if (!(wt > 0 && wt <= 150)) throw new HttpsError('invalid-argument', `Package ${i + 1}: weight must be between 0 and 150 lb.`);
        return {
            [packagingKey]: { Code: '02' },
            Dimensions: { UnitOfMeasurement: { Code: 'IN' }, Length: String(Math.ceil(l)), Width: String(Math.ceil(w)), Height: String(Math.ceil(h)) },
            PackageWeight: { UnitOfMeasurement: { Code: 'LBS' }, Weight: String(Math.max(1, Math.ceil(wt))) },
            ...(reference ? { ReferenceNumber: [{ Value: cleanStr(reference, 35) }] } : {}),
        };
    });
};

exports.upsRate = onCall({
    enforceAppCheck: true,
    secrets: [UPS_CLIENT_ID, UPS_CLIENT_SECRET, UPS_ACCOUNT_CE],
}, async (request) => {
    assertStaffUser(request);
    const { brand, shipTo, packages } = request.data || {};
    const env = await upsEnvironment();
    const shipper = upsShipperFor(brand);
    const origin = { Name: shipper.name, Address: shipper.address };
    const body = await upsCall(env, shipper.account, 'POST', '/api/rating/v2409/Shop', {
        RateRequest: {
            Request: { TransactionReference: { CustomerContext: 'wms-rate' } },
            Shipment: {
                Shipper: { ...origin, ShipperNumber: shipper.account },
                ShipFrom: origin,
                ShipTo: upsShipToOf(shipTo),
                PaymentDetails: { ShipmentCharge: [{ Type: '01', BillShipper: { AccountNumber: shipper.account } }] },
                ShipmentRatingOptions: { NegotiatedRatesIndicator: '' },
                Package: upsPackagesOf(packages, 'PackagingType'),
            },
        },
    });
    const services = [].concat((body.RateResponse && body.RateResponse.RatedShipment) || []).map((s) => {
        const code = (s.Service && s.Service.Code) || '';
        const neg = s.NegotiatedRateCharges && s.NegotiatedRateCharges.TotalCharge;
        return {
            code, name: UPS_SERVICE_NAMES[code] || `Service ${code}`,
            published: s.TotalCharges ? Number(s.TotalCharges.MonetaryValue) : null,
            negotiated: neg ? Number(neg.MonetaryValue) : null,
            businessDays: (s.GuaranteedDelivery && s.GuaranteedDelivery.BusinessDaysInTransit) || null,
        };
    });
    const alerts = [].concat((body.RateResponse && body.RateResponse.Response && body.RateResponse.Response.Alert) || []).map((a) => `${a.Code || ''} ${a.Description || ''}`.trim());
    return { environment: env, services, alerts };
});

exports.upsShip = onCall({
    enforceAppCheck: true,
    secrets: [UPS_CLIENT_ID, UPS_CLIENT_SECRET, UPS_ACCOUNT_CE],
}, async (request) => {
    assertStaffUser(request);
    const { brand, shipTo, packages, serviceCode, reference } = request.data || {};
    const code = cleanStr(serviceCode, 3);
    if (!UPS_SERVICE_NAMES[code]) throw new HttpsError('invalid-argument', 'Choose a UPS service first.');
    const env = await upsEnvironment();
    const shipper = upsShipperFor(brand);
    const shipperBlock = { Name: shipper.name, AttentionName: 'Shipping', Phone: { Number: shipper.phone }, Address: shipper.address };
    const body = await upsCall(env, shipper.account, 'POST', '/api/shipments/v2409/ship', {
        ShipmentRequest: {
            Request: { RequestOption: 'nonvalidate', TransactionReference: { CustomerContext: cleanStr(reference, 50) || 'wms-ship' } },
            Shipment: {
                Description: cleanStr(reference, 50) || 'Order',
                Shipper: { ...shipperBlock, ShipperNumber: shipper.account },
                ShipFrom: shipperBlock,
                ShipTo: upsShipToOf(shipTo),
                PaymentInformation: { ShipmentCharge: [{ Type: '01', BillShipper: { AccountNumber: shipper.account } }] },
                Service: { Code: code },
                ShipmentRatingOptions: { NegotiatedRatesIndicator: '' },
                Package: upsPackagesOf(packages, 'Packaging', reference),
            },
            LabelSpecification: { LabelImageFormat: { Code: 'GIF' }, LabelStockSize: { Height: '6', Width: '4' } },
        },
    });
    const res = (body.ShipmentResponse && body.ShipmentResponse.ShipmentResults) || {};
    const pkgs = [].concat(res.PackageResults || []);
    const neg = res.NegotiatedRateCharges && res.NegotiatedRateCharges.TotalCharge;
    return {
        environment: env,
        shipmentId: res.ShipmentIdentificationNumber || '',
        serviceCode: code,
        serviceName: UPS_SERVICE_NAMES[code],
        published: res.ShipmentCharges && res.ShipmentCharges.TotalCharges ? Number(res.ShipmentCharges.TotalCharges.MonetaryValue) : null,
        negotiated: neg ? Number(neg.MonetaryValue) : null,
        packages: pkgs.map((p) => ({
            trackingNumber: p.TrackingNumber || '',
            labelGif: (p.ShippingLabel && p.ShippingLabel.GraphicImage) || '',
        })),
    };
});

exports.upsVoid = onCall({
    enforceAppCheck: true,
    secrets: [UPS_CLIENT_ID, UPS_CLIENT_SECRET, UPS_ACCOUNT_CE],
}, async (request) => {
    assertStaffUser(request);
    const { brand, shipmentId, environment } = request.data || {};
    const id = cleanStr(shipmentId, 30).replace(/[^A-Za-z0-9]/g, '');
    if (!id) throw new HttpsError('invalid-argument', 'No shipment id to void.');
    const env = await upsEnvironment();
    // A label is voided on the host that made it — a test label never crosses to production.
    if (environment && environment !== env) throw new HttpsError('failed-precondition', `This label was made in ${environment}; UPS is now set to ${env}. Switch back to void it.`);
    const shipper = upsShipperFor(brand);
    const body = await upsCall(env, shipper.account, 'DELETE', `/api/shipments/v2409/void/cancel/${encodeURIComponent(id)}`);
    const status = body.VoidShipmentResponse && body.VoidShipmentResponse.SummaryResult && body.VoidShipmentResponse.SummaryResult.Status;
    return { environment: env, voided: true, status: (status && status.Description) || 'Voided' };
});


// ============================================================================
// ⏱ THE TIME CLOCK — punches taken only on the shop's tablets, on the shop's network (Stuart 2026-10-16: "how can we
// make sure it will only work onsite tablets and not offsite" · "both locks, so personal phones are refused. one wifi
// network"). A browser cannot prove where it is, so the punch is written HERE: the kiosk (/time-clock, its own Firebase
// instance, the person signed in by their PIN) asks; this checks the request came from a trusted network
// (time_config/clock.networks) and carries the id of an enrolled tablet (time_devices/<id>, active), then writes the
// punch with the server's time, the tablet and the network on it. Firestore rules no longer let a tablet write a punch
// itself. An admin sets a tablet up AT the tablet (clockDevice), which also trusts the network it is on.
// The rules: functions/timeClockGuard.js (harness scripts/timeClockGuard.test.mjs).
// ============================================================================
const timeClockGuard = require('./timeClockGuard');

const clockConfigOf = async (db) => {
    const s = await db.collection('time_config').doc('clock').get();
    return s.exists ? s.data() : {};
};
const clockDeviceOf = async (db, deviceId) => {
    if (!timeClockGuard.deviceIdValid(deviceId)) return null;
    const s = await db.collection('time_devices').doc(String(deviceId)).get();
    return s.exists ? s.data() : null;
};

// Before anyone types a PIN: is this a shop tablet, and is it on the shop network? No sign-in needed — it says only
// what the tablet itself is, and the address the server sees (the setup screen shows it).
exports.clockCheck = onCall({ enforceAppCheck: true, cors: true }, async (request) => {
    const db = admin.firestore();
    const ip = timeClockGuard.clientIpOf(request.rawRequest);
    const [cfg, device] = await Promise.all([clockConfigOf(db), clockDeviceOf(db, (request.data || {}).deviceId)]);
    return { ...timeClockGuard.deviceCheckOf({ ip, device, networks: cfg.networks }), chain: timeClockGuard.forwardedChainOf(request.rawRequest), networksSet: !!(cfg.networks && cfg.networks.length) };
});

// A punch — the person's own (the name on their PIN token), at the server's time, from an enrolled tablet on the shop network.
exports.clockPunch = onCall({ enforceAppCheck: true, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', timeClockGuard.REFUSAL.NOT_SIGNED_IN);
    const db = admin.firestore();
    const name = String(request.auth.token.name || '').trim();
    const { kind, deviceId } = request.data || {};
    const ip = timeClockGuard.clientIpOf(request.rawRequest);
    const [cfg, device] = await Promise.all([clockConfigOf(db), clockDeviceOf(db, deviceId)]);
    const refusal = timeClockGuard.punchRefusalOf({ name, kind, ip, device, networks: cfg.networks });
    if (refusal) throw new HttpsError(refusal.code, refusal.message);
    const nowMs = Date.now();
    const punch = timeClockGuard.punchDocOf({ name, kind, nowMs, deviceId, device, ip });
    const status = timeClockGuard.statusDocOf({ name, kind, nowMs });
    const batch = db.batch();
    batch.set(db.collection('time_punches').doc(), { ...punch, t: admin.firestore.FieldValue.serverTimestamp() });
    batch.set(db.collection('time_status').doc(timeClockGuard.clockKeyOf(name)), status);
    batch.update(db.collection('time_devices').doc(String(deviceId)), { lastPunchAt: nowMs, lastIp: ip });
    await batch.commit();
    return { ok: true, at: nowMs, status };
});

// Admins only, AT the tablet: set this tablet up as a time clock (and trust the network it is on), or trust this network.
exports.clockDevice = onCall({ enforceAppCheck: true, cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', timeClockGuard.REFUSAL.NOT_SIGNED_IN);
    if (!timeClockGuard.isAdminRole(request.auth.token.role)) throw new HttpsError('permission-denied', timeClockGuard.REFUSAL.NOT_ADMIN);
    const db = admin.firestore();
    const by = String(request.auth.token.name || '').trim();
    const { action, name, label } = request.data || {};
    const ip = timeClockGuard.clientIpOf(request.rawRequest);
    const nowMs = Date.now();
    const cfgRef = db.collection('time_config').doc('clock');
    const trust = async () => {
        const cfg = await clockConfigOf(db);
        await cfgRef.set({ networks: timeClockGuard.withNetwork(cfg.networks, { ip, label, by, nowMs }), updatedBy: by, updatedAt: nowMs }, { merge: true });
    };
    if (action === 'trustNetwork') { await trust(); return { ok: true, ip }; }
    if (action === 'enroll') {
        const deviceName = String(name || '').trim();
        if (!deviceName) throw new HttpsError('invalid-argument', 'Name the tablet. · Nombre la tableta.');
        const deviceId = timeClockGuard.newDeviceId(crypto.randomBytes);
        await db.collection('time_devices').doc(deviceId).set({ name: deviceName, active: true, enrolledBy: by, enrolledAt: nowMs, enrolledIp: ip });
        await trust();
        return { ok: true, deviceId, name: deviceName, ip };
    }
    throw new HttpsError('invalid-argument', 'Unknown action.');
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ✉️  THE EMAIL OUTBOX  (Stuart 2026-10-16)
// ══════════════════════════════════════════════════════════════════════════════════════════════
// The app had no transactional email: every document was printed through a browser and every
// "email" was a mailto: draft a person had to finish. This is the engine — Postmark sends, and the
// outbox is the same shape as ns_outbox, which has earned its keep: ONE ROW PER LETTER, a dedupe
// key as the row's own id, a status, attempts, and a worker that drains it.
//
// Why an outbox rather than sending inline: a send that fails inline is a letter nobody knows was
// lost, and a trigger that fires twice is a customer told twice. A row can be retried, read, and
// resent by a person who can see what happened.
//
// `sendAfter` is honoured from the start even though nothing uses it yet — it is where the daily
// invoice digest will hang when the invoice rules are built, and a scheduler with nowhere to land
// is a second outbox later.

const postmarkTokenFor = (brand) => {
    const s = mail.senderFor(brand);                       // throws for a brand with no sender
    if (s.tokenSecret === 'POSTMARK_TOKEN_UNIQUITY') return POSTMARK_TOKEN_UNIQUITY.value().trim();
    throw new Error(`NO_POSTMARK_TOKEN: "${brand}" has a sender on file but no token bound in index.js.`);
};
const EMAIL_MAX_ATTEMPTS = 5;

// Queue one. The dedupe key IS the document id, so the same event queued twice is the same row —
// a replayed trigger cannot post a second letter.
const enqueueEmail = async ({ brand, kind, dedupeKey, to, subject, html, text, from, replyTo, sendAfter = 0, meta = {} }) => {
    const db = admin.firestore();
    const id = String(dedupeKey || mail.dedupeKeyOf(kind, Date.now()));
    const ref = db.collection('email_outbox').doc(id);
    const existing = await ref.get();
    if (existing.exists) return { id, already: true };      // already queued, sent, or being sent
    await ref.set({
        brand: String(brand || '').toLowerCase(), kind: String(kind || ''),
        to: String(to || ''), subject: String(subject || ''), html: String(html || ''), text: String(text || ''),
        from: String(from || ''), replyTo: String(replyTo || ''),
        status: 'PENDING', attempts: 0, lastError: '', messageId: '',
        sendAfter: Number(sendAfter) || 0, meta: meta || {},
        createdAt: Date.now(), sentAt: 0,
    });
    return { id, already: false };
};

// Send one row. Returns nothing useful — the row records what happened, which is the point.
const sendOneEmail = async (id) => {
    const db = admin.firestore();
    const ref = db.collection('email_outbox').doc(String(id));
    const snap = await ref.get();
    if (!snap.exists) return;
    const e = snap.data() || {};
    if (e.status === 'SENT' || e.status === 'SENDING') return;
    if (Number(e.attempts || 0) >= EMAIL_MAX_ATTEMPTS) return;
    if (!mail.looksLikeEmail(e.to)) {
        await ref.set({ status: 'FAILED', lastError: `Not an email address: "${e.to}"`, attempts: EMAIL_MAX_ATTEMPTS }, { merge: true });
        return;
    }
    await ref.set({ status: 'SENDING', attempts: Number(e.attempts || 0) + 1, lastTriedAt: Date.now() }, { merge: true });
    try {
        const token = postmarkTokenFor(e.brand);
        const r = await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Postmark-Server-Token': token },
            body: JSON.stringify({
                From: e.from, To: e.to, ReplyTo: e.replyTo || undefined,
                Subject: e.subject, HtmlBody: e.html, TextBody: e.text,
                MessageStream: 'outbound',       // the TRANSACTIONAL stream; marketing is a different one
            }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok || Number(body.ErrorCode || 0) !== 0) {
            throw new Error(`Postmark refused (${body.ErrorCode ?? r.status}): ${body.Message || 'no detail'}`);
        }
        await ref.set({ status: 'SENT', sentAt: Date.now(), messageId: String(body.MessageID || ''), lastError: '' }, { merge: true });
    } catch (err) {
        const msg = String((err && err.message) || err).slice(0, 400);
        const attempts = Number(e.attempts || 0) + 1;
        // A letter that has run out of attempts stops and SAYS so, rather than retrying for ever
        // in silence. HQ 11 shows it with the reason and a Resend.
        await ref.set({ status: attempts >= EMAIL_MAX_ATTEMPTS ? 'FAILED' : 'PENDING', lastError: msg }, { merge: true });
    }
};

// Try it now, without making the caller wait or fail: a charge must never be undone because an
// email did not go. Fire-and-forget with a catch, exactly as postPaymentSoon does — NOT a
// setTimeout, which can be frozen with the instance before it ever fires. The five-minute worker
// is the guarantee; this is only so a customer's receipt arrives in seconds rather than minutes.
const sendEmailSoon = (id) => sendOneEmail(id)
    .catch((e) => console.error('email send failed', id, e && e.message));

exports.emailOutboxWorker = onSchedule({
    schedule: 'every 5 minutes',
    timeoutSeconds: 240,
    maxInstances: 1,
    secrets: [POSTMARK_TOKEN_UNIQUITY],
}, async () => {
    const db = admin.firestore();
    const now = Date.now();
    const due = await db.collection('email_outbox')
        .where('status', '==', 'PENDING')
        .orderBy('createdAt')
        .limit(40)
        .get();
    for (const d of due.docs) {
        const e = d.data() || {};
        if (Number(e.sendAfter || 0) > now) continue;      // a digest waiting for its hour
        await sendOneEmail(d.id);                          // serial: Postmark is not a race
    }
});

// What has been sent, and what has not — HQ 11.
exports.emailLog = onCall({ enforceAppCheck: true }, async (request) => {
    assertStaffAdmin(request);
    const snap = await admin.firestore().collection('email_outbox').orderBy('createdAt', 'desc').limit(30).get();
    return {
        emails: snap.docs.map((d) => {
            const e = d.data() || {};
            return {
                id: d.id, brand: e.brand || '', kind: e.kind || '', to: e.to || '', subject: e.subject || '',
                status: e.status || '', attempts: e.attempts || 0, lastError: e.lastError || '',
                messageId: e.messageId || '', createdAt: e.createdAt || 0, sentAt: e.sentAt || 0,
            };
        }),
    };
});

// Send it again — for the one that failed, and for the customer who says it never arrived.
exports.emailResend = onCall({ enforceAppCheck: true, secrets: [POSTMARK_TOKEN_UNIQUITY] }, async (request) => {
    assertStaffAdmin(request);
    const id = String((request.data || {}).id || '');
    const ref = admin.firestore().collection('email_outbox').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'No such email.');
    await ref.set({ status: 'PENDING', attempts: 0, lastError: '' }, { merge: true });
    await sendOneEmail(id);
    const after = await ref.get();
    const a = after.data() || {};
    return { status: a.status || '', lastError: a.lastError || '', messageId: a.messageId || '' };
});

// ── THE FIRST LETTER: a payment landed ───────────────────────────────────────────────────────
// Queued from every door that takes money. It reads the figures off the ORDER — the same ones the
// CRM chip and the printed document show — so the three cannot tell a customer different stories.
const emailPaymentReceived = async (paymentId) => {
    try {
        const db = admin.firestore();
        const snap = await db.collection('payments').doc(String(paymentId)).get();
        if (!snap.exists) return;
        const p = snap.data() || {};
        // A SKIP SAYS WHY. The first live test sent nothing and left nothing behind to explain it
        // (Stuart 2026-10-17), which is the very thing the outbox exists to prevent. These three
        // are legitimate reasons not to write, and each now leaves a row saying so.
        const skip = async (why) => {
            await admin.firestore().collection('email_outbox').doc(mail.dedupeKeyOf('PAYMENT_RECEIVED', paymentId)).set({
                brand: String(p.brand || ''), kind: 'PAYMENT_RECEIVED', to: String(p.email || ''),
                subject: `(not sent) payment ${p.reference || ''}`, status: 'SKIPPED', attempts: 0,
                lastError: why, createdAt: Date.now(), sentAt: 0,
                meta: { paymentId: String(paymentId), reference: p.reference || '' },
            }, { merge: true }).catch(() => {});
        };
        if (!mail.SENDERS[String(p.brand || '').toLowerCase()]) {
            await skip(`No email sender is on file for "${p.brand}" — only Uniq'uity sends so far.`); return;
        }
        if (p.environment !== 'PRODUCTION') {
            await skip('A test payment writes no letters.'); return;
        }
        let to = String(p.email || '').trim();
        let orderTotal = 0; let paidTotal = Number(p.amount || 0); let customerName = String(p.payerName || '');
        if (p.collection && p.docId) {
            const d = await db.collection(String(p.collection)).doc(String(p.docId)).get();
            const doc0 = d.exists ? (d.data() || {}) : {};
            paidTotal = Number(doc0.paymentsTotal || p.amount || 0);
            orderTotal = p.collection === 'jobs'
                ? Number((doc0.cpqData && doc0.cpqData.totalPrice) || 0) + Number(doc0.shippingAmount || 0)
                : Number(doc0.invoiceTotal || 0);
            // The SAME lookup the pay page used to promise the payer where their receipt would go.
            const onFile = await receiptAddressFor({ collection: p.collection, docId: p.docId });
            if (!to) to = onFile.to;
            customerName = customerName || onFile.customerName;
        }
        if (!mail.looksLikeEmail(to)) {
            // The commonest reason nothing arrives: nobody typed an address on the pay page and the
            // order carries none. The payment stands; the receipt has nowhere to go, and now says so.
            await skip(`No email address to send to — the payer typed none, the order carries none, and the customer record has none${to ? ` (found "${to}", which is not an address)` : ''}. Add one to the customer in the CRM and press Resend.`);
            return;
        }
        const letter = mail.paymentReceivedEmail({
            brand: p.brand, customerName, reference: p.reference,
            amount: Number(p.amount || 0), paidTotal, orderTotal, transactionId: p.transactionId,
        });
        const { id, already } = await enqueueEmail({
            brand: p.brand, kind: 'PAYMENT_RECEIVED',
            dedupeKey: mail.dedupeKeyOf('PAYMENT_RECEIVED', paymentId),
            to, ...letter, meta: { paymentId: String(paymentId), reference: p.reference || '' },
        });
        if (!already) sendEmailSoon(id);
    } catch (e) {
        // A letter never undoes a payment. It is logged and the row, if written, retries.
        console.warn('emailPaymentReceived:', (e && e.message) || e);
    }
};

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 💳  CARD MONEY NETSUITE HAS NOT HEARD ABOUT, FOR ONE SALES ORDER
// ══════════════════════════════════════════════════════════════════════════════════════════════
// The WMS holds a shipment until the customer's TERMS are satisfied, and it reads what NetSuite
// says has been paid. But a card payment is CAPTURED the moment it is taken — the money is in the
// merchant account, irreversibly — while the deposit may take a minute to post, or may wait for
// ever behind a customer who has never reached NetSuite.
//
// So an order the customer has ACTUALLY PAID FOR could sit unshippable because the books had not
// caught up, which is a worse failure than the one the terms check exists to prevent, and it would
// have happened first at a trade show. Stuart 2026-10-17: "go on 1 and the card money".
//
// This answers one question for one order: how much card money has been taken that NetSuite does
// not yet know about. The WMS adds it to NetSuite's own figure. It falls to zero by itself as each
// posting lands, so nothing is double counted for longer than the moment between the two.
//
// GATED BY THE WMS'S OWN RULE, not a copy of it: the caller's role must carry STOCK or PACKING in
// pick_config/permissions, the same document the pick/pack app reads to decide who may pack and
// ship. A list of roles here would be a second copy that rots the first time someone adds one.
const assertWmsPacker = async (request) => {
    const role = String((request.auth && request.auth.token && request.auth.token.role) || '').toLowerCase();
    if (['admin', 'superadmin'].includes(role)) return role;
    const snap = await admin.firestore().doc('pick_config/permissions').get();
    const tabs = ((snap.exists && snap.data()) || {})[role] || [];
    if (!Array.isArray(tabs) || !(tabs.includes('STOCK') || tabs.includes('PACKING'))) {
        throw new HttpsError('permission-denied', `Reading an order's payments is for the people who pack and ship it — this login is "${role || 'none'}".`);
    }
    return role;
};

exports.paymentsUnpostedForOrder = onCall({ enforceAppCheck: true }, async (request) => {
    await assertWmsPacker(request);
    const db = admin.firestore();
    const { collection, docId, nsSoId } = request.data || {};
    let col = String(collection || '');
    let id = String(docId || '');

    // ⚠ A SALES ORDER AND THE THING THAT WAS PAID ARE NOT ALWAYS THE SAME DOCUMENT. An Order Entry
    // payment sits on the hq_sales_orders record; a CPQ one sits on the JOB the order was raised
    // from, because that is the document staff take a deposit against. Resolving the NetSuite id to
    // the sales-order record alone would find no card money for any CPQ order — exactly the trap
    // this function exists to prevent, just at the other door. So we follow hqJobId too.
    const ids = [];
    if (id) ids.push(id);
    if (String(nsSoId || '')) {
        const q = await db.collection('hq_sales_orders').where('nsInternalId', '==', String(nsSoId)).limit(1).get();
        if (!q.empty) {
            const so = { id: q.docs[0].id, ...(q.docs[0].data() || {}) };
            col = '';                                        // either collection may answer now
            if (!ids.includes(so.id)) ids.push(so.id);
            const jobId = String(so.hqJobId || '');           // the CPQ job this order came from
            if (jobId && !ids.includes(jobId)) ids.push(jobId);
        }
    }
    if (!ids.length) return { unpostedTotal: 0, count: 0, found: false };

    // ONE equality filter on a single field, on purpose: a docId is specific enough that the result
    // is tiny, and `in` on one field needs no composite index deployed alongside the function.
    const snap = await db.collection('payments').where('docId', 'in', ids.slice(0, 10)).limit(100).get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) })).filter((p) =>
        (!col || String(p.collection || '') === col)
        && p.environment === 'PRODUCTION'          // a test payment can never clear a real shipment
        && p.netsuitePosted !== true
        && Number(p.amount || 0) > 0
        && p.voided !== true && p.refunded !== true);

    return {
        found: true,
        collection: col, docId: ids[0], docIds: ids,
        unpostedTotal: Math.round(rows.reduce((s, p) => s + Number(p.amount || 0), 0) * 100) / 100,
        count: rows.length,
        // So a held order can say WHY it was cleared, and a person can find the payment.
        payments: rows.map((p) => ({
            id: p.id, amount: Number(p.amount || 0), paidAt: Number(p.paidAt || 0),
            reference: p.reference || '', waiting: p.netsuiteWaiting || '',
        })),
    };
});
