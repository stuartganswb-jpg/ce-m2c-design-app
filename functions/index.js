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
                last = { status: response.status, ok: response.ok, text };
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

        const data = result.text ? JSON.parse(result.text) : {};
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
    if (after.orderType !== 'stock' || !after.nsWoId || after.nsCompletionQueued) return;
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
    const scannedBin = String(after.putawayBin || '').trim().toUpperCase();

    const fdb = admin.firestore();
    const woDocId = event.params.woId;
    // Idempotency stamp FIRST — this trigger re-fires on our own writes.
    await fdb.doc(`fin_workorders/${woDocId}`).set({ nsCompletionQueued: true }, { merge: true });

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

    const obRef = fdb.collection('ns_outbox').doc();
    await obRef.set({
        // NON-WIP work orders (CE's are) complete via a WO-LINKED ASSEMBLY BUILD — the record
        // the UI's "Create Build" button makes. workordercompletion is WIP-only and 400s with
        // "invalid work order" on these (learned 2026-07-21, WO11308-12).
        id: obRef.id, kind: 'workordercompletion',
        label: `Build NS WO ${after.nsWoTran || after.nsWoId} — ${after.stockErpId || woDocId} ×${qty}`,
        sourceApp: 'FINISHING', createdBy: `auto (put away${scannedBin ? ` · bin ${scannedBin}` : ''})`,
        targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/workorder/${after.nsWoId}/!transform/assemblyBuild`,
        method: 'POST',
        payload: {
            quantity: qty,
            memo: `Stock build ${woDocId} put away${scannedBin ? ` ${scannedBin}` : ''} [app push ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit' })} #${obRef.id.slice(0, 6)}]`,
            ...(bin ? { inventoryDetail: { quantity: qty, inventoryAssignment: { items: [{ binNumber: { refName: bin }, quantity: qty }] } } } : {})
        },
        writeBack: { collection: 'fin_workorders', docId: woDocId, patch: { nsWoCompletionPosted: true }, idField: 'nsWoCompletionId', tranField: 'nsWoCompletionTran' },
        status: 'PENDING', attempts: 0, lastError: null, nsId: null, nsTran: null,
        createdAt: Date.now(), nextAttemptAt: Date.now(), leasedAt: null, postedAt: null
    });
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
const requestLines = (job, flowDoc) => {
    const req = job.portalRequest || {};
    const params = (req.selections && req.selections.params) || {};
    const qtys = (req.selections && req.selections.quantities) || {};
    const steps = (flowDoc && flowDoc.steps) || [];
    const out = [];
    steps.forEach((st) => {
        const sel = params[st.id];
        if (!sel || typeof sel !== 'string') return;
        const opt = (st.styleOptions || []).find((o) => (o.optId || o.partId) === sel)
            || (st.allowedOptions || []).find((o) => (o.id || o.optId) === sel);
        const label = (opt && (opt.partName || opt.name || opt.label)) || sel;
        const q = qtys[st.id];
        out.push({ name: `${st.title || 'Option'}: ${label}`, qty: Number(q) || 0, price: null, total: null, sku: '' });
    });
    if (req.note) out.push({ name: `Note: ${String(req.note).slice(0, 300)}`, qty: 0, price: null, total: null, sku: '' });
    return out;
};

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

    // A quote the CUSTOMER deleted is gone from their list but kept in HQ, flagged, so the team
    // can see what happened rather than having a record vanish.
    const liveJobs = jobs.filter((j) => !j.portalDeleted);

    // THEIR part #s for every code on every line we are about to return — one batched lookup for
    // the whole page rather than a read per line.
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const allCodes = [
        ...liveJobs.flatMap((j) => ((j.cpqData && j.cpqData.breakdown) || []).map((l) => l && (l.legacyErpId || l.partId))),
        ...soDocs.flatMap((so) => (so.lines || []).map((l) => l && (l.erp || l.itemId))),
    ];
    const skuOf = await buildSkuLookup(db, customerId, crm, allCodes);

    // Flow docs behind any un-priced portal requests, so their selections read in words.
    const reqFlowIds = [...new Set(liveJobs
        .filter((j) => j.status === 'PORTAL_REQUEST' && j.portalRequest && j.portalRequest.flowId)
        .map((j) => String(j.portalRequest.flowId)))];
    const flowById = {};
    await Promise.all(reqFlowIds.map(async (fid) => {
        const fs = await db.collection('cpq_flows').doc(fid).get();
        if (fs.exists) flowById[fid] = fs.data();
    }));

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
                    sidemark: j.sidemark || '',
                    status: j.status || 'CONFIGURED',
                    date: j.dateSaved || null,
                    total: (j.cpqData && j.cpqData.totalPrice) ?? null,
                    shipping: j.shippingAmount ?? null,
                    // Deleting is for quotes still in the customer's own court. Once it is approved
                    // or has become an order it is a commitment, and withdrawing it is a
                    // conversation with their rep, not a button.
                    canDelete: ['PORTAL_REQUEST', 'CONFIGURED', 'SENT_TO_CLIENT', 'REVISION_REQUESTED'].includes(String(j.status || 'CONFIGURED')),
                    lines: priced.length ? priced : (isRequest ? requestLines(j, flowById[String(j.portalRequest.flowId)]) : []),
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
// Resolve Approved_Designs docs by ANY id spelling — doc id first, then itemId / legacyErpId 'in'
// fallbacks — returning a Map keyed by the REQUESTED id. Shared by the portal fee-name display
// and the Measure & Fit bracket/backplate dims.
const partsByAnyId = async (db, ids) => {
    const map = new Map();
    const want = [...new Set((ids || []).map(String).filter(Boolean))];
    if (!want.length) return map;
    const snaps = await db.getAll(...want.map((id) => db.collection('Approved_Designs').doc(id)));
    snaps.forEach((s2) => { if (s2.exists) map.set(s2.id, { id: s2.id, ...s2.data() }); });
    for (const fieldName of ['itemId', 'legacyErpId']) {
        const unresolved = want.filter((id) => !map.has(id));
        if (!unresolved.length) break;
        for (const ids30 of chunk(unresolved, 30)) {
            const qs = await db.collection('Approved_Designs').where(fieldName, 'in', ids30).get();
            qs.forEach((d) => { const it = d.data(); const key = String(it[fieldName] || ''); if (key && !map.has(key)) map.set(key, { id: d.id, ...it }); });
        }
    }
    return map;
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

// The customer's showroom, driven by their ASSIGNED CPQ FLOWS (crm_records.portalFlowIds — set in
// the CRM Portal Access panel). The flow is the entitlement unit: its linked assembly (and later,
// that assembly's BOM) defines everything the customer may see. Each assigned flow with a linked
// assembly + GLB becomes one showroom item, further narrowed to the customer's allowed collections.
// NEVER returns cost/vendor data — price shown is the customer's clientSalesPrice on the assembly
// (fallback: item base price, else no price).
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

    const inCollection = collectionGateOf(crm);
    const built = [];
    let blockedByCollection = 0;
    for (const flow of flows) {
        const asm = flow.linkedAssemblyId ? assemblies.get(flow.linkedAssemblyId) : null;
        const cadUrl = asm && asm.manufacturingSpecs && asm.manufacturingSpecs.cadUrl;
        if (!cadUrl) continue; // a flow without a renderable assembly has nothing to show (yet)
        if (inCollection && !inCollection(asm)) { blockedByCollection++; continue; }
        const cp = Array.isArray(asm.clientPricing) ? asm.clientPricing.find(matchesCustomer) : null;
        const base = asm.manufacturingSpecs && asm.manufacturingSpecs.basePrice;
        const priceRaw = cp ? (cp.clientSalesPrice ?? cp.price ?? base) : base;
        const price = (priceRaw === undefined || priceRaw === null || priceRaw === '') ? null : Number(priceRaw);
        built.push({
            groupLabel: flow.sizeGroupLabel || '', groupChoice: flow.sizeGroupChoice || '', groupSort: flow.sizeGroupSort ?? 99,
            item: {
                id: flow.linkedAssemblyId,
                flowId: flow.id,
                name: flow.name || asm.itemName || 'Product',
                sku: (cp && cp.clientSku) || asm.legacyErpId || asm.itemId || '',
                cadUrl,
                price: Number.isFinite(price) ? price : null,
            },
        });
    }
    // Size-group flows (the per-assembly H2 model: four per-diameter flows stamped
    // sizeGroupLabel/Choice/Sort) collapse into ONE top-level product — the showroom shows a
    // single card whose Configure opens a rod-diameter landing, mirroring the internal CPQ's
    // "pick rod diameter first". Flat flows are untouched.
    const items = built.filter((b) => !b.groupLabel).map((b) => b.item);
    const groupsMap = new Map();
    built.filter((b) => b.groupLabel).forEach((b) => { const l = groupsMap.get(b.groupLabel) || []; l.push(b); groupsMap.set(b.groupLabel, l); });
    groupsMap.forEach((list, label) => {
        list.sort((a, b) => (a.groupSort ?? 99) - (b.groupSort ?? 99));
        const prices = list.map((b) => b.item.price).filter((p) => p !== null);
        items.push({
            id: `GROUP-${label.replace(/[^A-Za-z0-9]+/g, '-')}`,
            flowId: list[0].item.flowId,
            isGroup: true,
            name: label,
            sku: `${list.length} sizes`,
            cadUrl: (list.find((b) => b.item.cadUrl) || list[0]).item.cadUrl,
            price: prices.length ? Math.min(...prices) : null,
            sizes: list.map((b) => ({ flowId: b.item.flowId, choice: b.groupChoice || b.item.name })),
        });
    });
    items.sort((a, b) => a.name.localeCompare(b.name));

    // An empty showroom because the collection filter ate everything is a SETUP mistake, not an
    // empty account — name it so the portal can say something useful instead of "nothing here".
    if (!items.length && blockedByCollection) return { items, finishes, reason: 'NO_COLLECTIONS' };
    return { items, finishes };
});


// ---- Client configurator (portal Vision/CPQ) ------------------------------------------------
// Returns ONE assigned flow, sanitized for the portal's render engine: the flow steps (geometry/
// node maps, finish targeting — no pricing), the linked assembly's GLB + node clusters, and the
// finish palette. Entitlement is enforced: the flow must be in the customer's crm_records
// .portalFlowIds. NEVER returns cost/vendor data or internal option prices.
// Customer-facing option name. Fee options carry the fee ENTITY's internal id as partName
// (CE-FEE-4594) or an authoring hint ("Mitered Return (fee — set price)") — customers must see
// a DESCRIPTION (Stuart 2026-07-25). feeNameOf resolves the fee item's library itemName; when
// unresolvable, the "(fee…)" suffix is stripped so at worst a readable phrase remains.
const customerOptName = (o, feeNameOf) => {
    const raw = String(o.partName || o.label || '');
    const feeish = !!o.isFee || /\(fee/i.test(raw);
    if (!feeish) return raw;
    const resolved = (feeNameOf && o.partId) ? feeNameOf(o.partId) : '';
    return resolved || raw.replace(/\s*\(fee[^)]*\)\s*$/i, '').trim() || raw;
};
const sanitizeStep = (s, feeNameOf) => ({
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
    // The dimensional-input calculator (calc_straight_pole / calc_french_return_1in / …) — without
    // it the portal's finished-size field computes qty as 1 (Stuart 2026-07-27: "the dimensional
    // input does not populate the rod qty").
    calculatorTemplate: s.calculatorTemplate || '',
    hideQty: !!s.hideQty,
    isCenterClone: !!s.isCenterClone,
    styleOptions: (s.styleOptions || []).map((o) => ({
        optId: o.optId || o.partId || '', partId: o.partId || '', partName: customerOptName(o, feeNameOf),
        label: customerOptName({ ...o, partName: o.label || o.partName }, feeNameOf), targetNode: o.targetNode || '', finalImageUrl: o.finalImageUrl || o.imageUrl || '',
        sizeValue: o.sizeValue ?? null, sizeScale: o.sizeScale ?? null, location: o.location || '', position: o.position || '',
        finishAllowedOptions: o.finishAllowedOptions || null,
        hidesBracket: !!o.hidesBracket,
        isReturn: !!o.isReturn,
        endTreatment: o.endTreatment || '',
        isReturnArm: !!o.isReturnArm,
        usesReturnPlates: !!o.usesReturnPlates,
        isBasic: !!o.isBasic,
        // Per-assembly flows (H2 pivot): the option's projection tag + fee flag drive the
        // portal's projTagOk gating — physical dims/flags only, never cost.
        projInches: o.projInches || '',
        isFee: !!o.isFee,
    })),
    subOptions: (s.subOptions || []).map((o) => ({
        optId: o.optId || o.partId || '', partId: o.partId || '', partName: customerOptName(o, feeNameOf),
        label: customerOptName({ ...o, partName: o.label || o.partName }, feeNameOf), targetNode: o.targetNode || '', location: o.location || '', position: o.position || '',
        returnOnly: !!o.returnOnly, inlineOnly: !!o.inlineOnly, projInches: o.projInches || '',
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
    await assertCollectionAllowed(db, crm, flow, flowId);

    // Customer-facing FEE names (see customerOptName) + safe DIMS for bracket/backplate options.
    // Option partIds may be the Approved_Designs doc id, the itemId, or the legacyErpId — the
    // partsByAnyId resolver tries all three. A handful of small reads per flow load.
    const feeIds = [...new Set((flow.steps || [])
        .flatMap((s) => [...(s.styleOptions || []), ...(s.subOptions || [])])
        .filter((o) => o && (o.isFee || /\(fee/i.test(String(o.partName || ''))) && o.partId)
        .map((o) => String(o.partId)))];
    const feeDocs = await partsByAnyId(db, feeIds);
    const feeNameOf = (pid) => String((feeDocs.get(String(pid)) || {}).itemName || '');

    // Bracket & backplate DIMS (physical measurements only — width/length/diameter, orientation,
    // arm thickness, return-bracket flag): the Measure & Fit page feeds these into the shared fit
    // math, so a chosen backplate drives Total System O2O exactly as on the internal board
    // (bpEndHalf/armThk read the same shapes). Never cost or vendor data.
    const isBrStep = (s) => !!s && (s.stepRole === 'BRACKET' || (/bracket/i.test(String(s.title || '')) && !/end treatment/i.test(String(s.title || ''))));
    const dimIds = [...new Set((flow.steps || []).filter(isBrStep)
        .flatMap((s) => [...(s.styleOptions || []), ...(s.subOptions || [])])
        .map((o) => o && o.partId).filter(Boolean).map(String))];
    const dimDocs = await partsByAnyId(db, dimIds);
    const numOrNull = (v) => { const f = parseFloat(v); return Number.isFinite(f) ? f : null; };
    const dimsOf = (pid) => {
        const d2 = dimDocs.get(String(pid || ''));
        if (!d2) return null;
        const ms = d2.manufacturingSpecs || {}; const par = ms.parametric || {}; const cd = ms.customData || {};
        return { width: numOrNull(par.width), length: numOrNull(par.length), fixedDiameter: numOrNull(par.fixedDiameter), bpOrientation: String(cd.bpOrientation || ''), armThickness: numOrNull(cd.armThickness), isReturnBracket: !!cd.isReturnBracket };
    };

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
    // PBR response as studioScene; textureUrl drives the map swap. clientName = this customer's own
    // finish name (from the finish's clientMapping, keyed by company name) so a Fabricut login sees
    // Fabricut's finish names. No cost/vendor fields.
    const custNames = new Set([crm.name, crm.companyName].filter(Boolean).map((s) => String(s).trim().toUpperCase()));
    const clientNameOf = (f) => {
        const m = Array.isArray(f.clientMapping) ? f.clientMapping.find((x) => custNames.has(String((x.customerId) || '').trim().toUpperCase())) : null;
        return (m && m.clientFinishName) || null;
    };
    const mf = await db.collection('system').doc('master_finishes').get();
    const inhouse = ((mf.exists && mf.data().finishes) || [])
        .filter((f) => f && f.textureUrl)
        .map((f) => ({ id: f.id, name: f.name || f.code || 'Finish', clientName: clientNameOf(f), code: f.code || '', textureUrl: f.textureUrl, bomSuffix: f.bomSuffix || '', pbr: f.pbr || null, outsourced: false }));
    const outSnap = await db.collection('hq_outsource_finishes').get();
    const outsourced = outSnap.docs.map((d) => d.data()).filter((f) => f && f.textureUrl)
        .map((f) => ({ id: f.id, name: f.name || f.code || 'Finish', clientName: clientNameOf(f), code: f.code || '', textureUrl: f.textureUrl, bomSuffix: f.bomSuffix || '', pbr: f.pbr || null, outsourced: true }));
    const finishes = [...inhouse, ...outsourced];

    return {
        flow: {
            id: flowId,
            name: flow.name || 'Product',
            steps: (flow.steps || []).map((s) => {
                const out = sanitizeStep(s, feeNameOf);
                if (isBrStep(s)) {
                    [...(out.styleOptions || []), ...(out.subOptions || [])].forEach((o) => { const dm = dimsOf(o.partId); if (dm) o.dims = dm; });
                }
                return out;
            }),
            hiddenClusters: flow.hiddenClusters || [],
            hiddenNodes: flow.hiddenNodes || [],
        },
        assembly,
        finishes,
        // Bay configuration (display-safe scalar) — the portal Measure & Fit page seeds its
        // shape from this, mirroring the internal Vision board's fabShape seeding.
        fabShape: flow.fabShape || '',
        // Per-assembly flows (H2 pivot): the flow-level implied projection (stamped when exactly
        // one proj tag exists) — the Configurator's projTagOk falls back to it, like the board.
        impliedProjInches: flow.impliedProjInches ?? null,
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

// A customer submits a configured product as a QUOTE REQUEST. It lands as a jobs doc flagged
// 'PORTAL_REQUEST' for the team to price and confirm in CPQ — nothing is priced or pushed here.
exports.portalQuoteRequest = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const { flowId, flowName, selections, note, viewedLevel } = request.data || {};
    const db = admin.firestore();
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const allowed = Array.isArray(crm.portalFlowIds) ? crm.portalFlowIds : [];
    if (!allowed.includes(String(flowId || ''))) throw new HttpsError('permission-denied', 'Not enabled on your account.');
    const flowSnap = await db.collection('cpq_flows').doc(String(flowId || '')).get();
    const flowDoc = flowSnap.exists ? flowSnap.data() : {};
    await assertCollectionAllowed(db, crm, flowSnap.exists ? flowDoc : null, flowId);

    const email = String((request.auth.token && request.auth.token.email) || '');
    const puSnap = await db.collection('portal_users').doc(request.auth.uid).get();
    const submitterName = (puSnap.exists && puSnap.data().name) || email;
    const quoteNo = await nextQuoteNo(db, `${initialsOf(submitterName, email)}${mmddyy()}`);

    // CPQ CART SNAPSHOT (Stuart 2026-07-28: "quote arrived in HQ at CRM but does not reopen in
    // CPQ"). Reopen-in-CPQ reads job.cpqData.cartItems and restores exactly five fields —
    // flowId, assemblyId, dynamicConfigParams, stepQuantities, dimensionInputs (see
    // Shared/reopenQuote.js -> CPQTab.handleEditCartItem). A portal request carried only raw
    // selections, so the guard rejected it. Build that same line here and staff reopen the
    // customer's configuration with zero re-entry — no CRM or CPQ changes needed.
    const rawParams = (selections && selections.params) || {};
    const dynamicConfigParams = {};
    const dimensionInputs = {};
    Object.entries(rawParams).forEach(([k, v]) => {
        const m = /^(.*)__dims$/.exec(k);          // the portal sends measurements as `${stepId}__dims`
        if (m && v && typeof v === 'object') dimensionInputs[m[1]] = v;
        else if (typeof v === 'string') dynamicConfigParams[k] = v;
    });
    const stepQuantities = {};
    Object.entries((selections && selections.quantities) || {}).forEach(([k, v]) => {
        if (typeof v === 'string' || typeof v === 'number') stepQuantities[k] = String(v);
    });
    let assemblyName = String(flowName || '');
    const asmId = String(flowDoc.linkedAssemblyId || '');
    if (asmId) {
        const asmSnap = await db.collection('Approved_Designs').doc(asmId).get();
        if (asmSnap.exists) assemblyName = asmSnap.data().itemName || assemblyName;
    }
    const cartItem = {
        id: `PORTAL-${quoteNo}`,
        masterQuoteId: quoteNo,
        assemblyId: asmId,
        assemblyName: assemblyName || 'Configured Item',
        sidemark: 'Portal request',
        flowId: String(flowId || ''),
        qty: 1,
        priceLevel: String(crm.portalPriceLevel || 'STANDARD'),
        pricing: {},
        pricingBreakdown: [],
        dynamicConfigParams,
        stepQuantities,
        dimensionInputs,
        fromPortal: true,
    };

    const ref = db.collection('jobs').doc(quoteNo);
    await ref.set({
        jobId: quoteNo,
        quoteNo,
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
            // Which of their price-ladder levels the customer was VIEWING when they sent this —
            // context for staff; the staff quote itself still prices at the assigned level.
            viewedLevel: ['FAB_COST', 'FAB_WHOLESALE', 'FAB_RETAIL'].includes(String(viewedLevel || '')) ? String(viewedLevel) : '',
        },
        cpqData: { cartItems: [cartItem] },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        dateSaved: new Date().toISOString(),
    });
    return { ok: true, id: quoteNo, quoteNo };
});

// A customer submits MEASUREMENTS for a product (portal "Measure & Fit" page). Two writes:
//  (1) a jobs doc (status PORTAL_REQUEST, portalRequest.kind 'VISION_MEASURE') so the request
//      shows on the CRM card pipeline exactly like a configurator quote request; its id is the
//      minted quote number, so the card's existing Reopen CPQ / Reopen Vision buttons adopt it.
//  (2) a cpq_drafts doc in the EXACT shape the internal Vision writes (masterQuoteId = that
//      quote number, spatialData = full engData + empty attachments/shopNotes), so CPQ lists it
//      under "Lines Awaiting Configuration" and Vision's "Load saved line" restores the whole
//      board with ZERO re-entry. The staff Vision pass (Load Line → Save Line) recomputes and
//      re-stamps engineeringNotes + the shop-drawing SVG from this data — its save flips status
//      to DRAFT_FROM_VISION, which is the "measurements verified by staff" marker.
// The customer's readout numbers ride only as a PREVIEW (computedBy PORTAL_CLIENT, empty svg):
// nothing prices or cuts from them — pricing is staff Configure, cut sheets come from the staff
// Vision save. engData is WHITELISTED field-by-field: enums checked, numbers coerced, part-id
// fields forced empty (bracket selection is engineering, not intake).
exports.portalVisionDraft = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const { flowId, flowName, sidemark, note, engData: rawEng, preview, params: rawParams } = request.data || {};
    const db = admin.firestore();
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const allowed = Array.isArray(crm.portalFlowIds) ? crm.portalFlowIds : [];
    if (!allowed.includes(String(flowId || ''))) throw new HttpsError('permission-denied', 'Not enabled on your account.');
    const flowSnap = await db.collection('cpq_flows').doc(String(flowId)).get();
    if (!flowSnap.exists) throw new HttpsError('permission-denied', 'Not enabled on your account.');
    const flow = flowSnap.data();
    await assertCollectionAllowed(db, crm, flow, flowId);

    const num = (v, d) => { const f = parseFloat(v); return Number.isFinite(f) ? f : d; };
    const oneOf = (v, list, d) => { const s = String(v || '').toUpperCase(); return list.includes(s) ? s : d; };
    const e = rawEng || {};
    const MOUNTS = ['OPEN', 'INSIDE', 'CEILING'];
    // FLUSH included: the internal endStyleOf maps Flush Cut AND Inside Mount options to 'FLUSH'.
    const ENDS = ['FINIAL', 'RETURN_BEND', 'RETURN_MITER', 'FLUSH'];
    const engData = {
        shape: oneOf(e.shape, ['STRAIGHT', 'MITERED', 'BOW'], 'STRAIGHT'),
        inputMode: oneOf(e.inputMode, ['WALL', 'ORDERING'], 'WALL'),
        w1: num(e.w1, 0), w2: num(e.w2, 0), w3: num(e.w3, 0),
        a1: num(e.a1, 135), a2: num(e.a2, 135), bowDepth: num(e.bowDepth, 0),
        mountLeft: oneOf(e.mountLeft, MOUNTS, 'OPEN'), mountRight: oneOf(e.mountRight, MOUNTS, 'OPEN'),
        mountCenter: oneOf(e.mountCenter, MOUNTS, 'OPEN'), mountOuter: oneOf(e.mountOuter, MOUNTS, 'OPEN'),
        endStyle: oneOf(e.endStyle, ENDS, 'FINIAL'), endStyleRight: oneOf(e.endStyleRight, ENDS, ''),
        proj: (e.proj === '' || e.proj === undefined || e.proj === null) ? '' : num(e.proj, ''),
        bracketId: '', bracketIdRight: '', bracketIdCenter: '',
        backplateIdLeft: '', backplateIdRight: '', backplateIdCenter: '',
        poleDiameter: num(e.poleDiameter, 1.0), bracketW: num(e.bracketW, 3.0), finialW: num(e.finialW, 3.5),
        bracketThickness: num(e.bracketThickness, 0.25), insideMountDeduct: num(e.insideMountDeduct, 0.25),
        returnRadius: num(e.returnRadius, 4.0), gripAllowance: num(e.gripAllowance, 8.5),
    };

    const email = String((request.auth.token && request.auth.token.email) || '');
    const puSnap = await db.collection('portal_users').doc(request.auth.uid).get();
    const submitterName = (puSnap.exists && puSnap.data().name) || email;
    const quoteNo = await nextQuoteNo(db, `${initialsOf(submitterName, email)}${mmddyy()}`);
    const draftId = `DRAFT-PORTAL-${Date.now()}`;
    const brandId = flow.brandId || crm.brandId || null;
    const cleanNote = String(note || '').slice(0, 2000);
    const cleanSidemark = String(sidemark || '').slice(0, 120);
    const jobName = `Measure — ${String(flowName || flow.name || 'Portal')} — ${crm.name || ''}`.trim();
    const p = preview || {};
    const pnum = (v) => { const f = parseFloat(v); return Number.isFinite(f) ? f : null; };

    // STEP PICKS (stepId → optId) — the flow-driven selections (rod diameter / projection / end
    // treatments / brackets), VALIDATED against the flow's own steps so only real selections ride.
    // They land in specs exactly like the internal Vision save's dynamicConfigParams spread, so
    // staff Load-Line and CPQ Configure open pre-picked on the same options the customer's
    // readouts used (this is what makes the portal numbers and the board numbers agree).
    const stepParams = {};
    const stepById = new Map((flow.steps || []).map((s) => [String(s.id), s]));
    for (const [k, v] of Object.entries(rawParams || {}).slice(0, 40)) {
        // `${stepId}__sub` = the step's backplate sub-chooser (same key convention as CPQ/Vision).
        const isSub = /__sub$/.test(String(k));
        const st = stepById.get(String(k).replace(/__sub$/, ''));
        if (!st) continue;
        const pool = isSub ? (st.subOptions || []) : (st.styleOptions || []);
        const opt = pool.find((o) => (o.optId || o.partId) === v);
        if (opt) stepParams[String(k)] = String(v);
    }

    await db.collection('jobs').doc(quoteNo).set({
        jobId: quoteNo, quoteNo, brandId,
        status: 'PORTAL_REQUEST', source: 'PORTAL',
        customer: { id: customerId, name: crm.name || '' },
        jobName,
        portalRequest: { kind: 'VISION_MEASURE', flowId: String(flowId || ''), flowName: String(flowName || flow.name || ''), note: cleanNote, byEmail: email, draftId },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        dateSaved: new Date().toISOString(),
    });

    await db.collection('cpq_drafts').doc(draftId).set({
        id: draftId, brandId, category: 'HARDWARE', status: 'DRAFT_FROM_PORTAL',
        jobName, sidemark: cleanSidemark,
        customerId,
        linkedAssemblyId: flow.linkedAssemblyId || null,
        linkedCpqFlowId: String(flowId), flowId: String(flowId), cpqFlowId: String(flowId),
        masterQuoteId: quoteNo,
        specs: {
            collection: '',
            bracketId: '',
            engineeringNotes: {
                computedBy: 'PORTAL_CLIENT', shape: engData.shape,
                poleO2O: pnum(p.poleO2O), totalSystemO2O: pnum(p.totalSystemO2O),
                pole1: pnum(p.pole1), pole2: pnum(p.pole2), pole3: pnum(p.pole3),
                svgString: '', customerNote: cleanNote,
            },
            ...stepParams,
        },
        spatialData: { ...engData, attachments: [], shopNotes: [] },
        author: { name: `${crm.name || 'Customer'} (portal)`, email },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true, quoteNo, draftId };
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


// ---- Configured pricing (server-side engine, matches HQ) -------------------------------------
// Loads the SAME data CPQTab prices from (flow + brand's Approved_Designs parts + the assembly's
// BOM + finishes + the customer's clientPricing) and runs the ported pricing engine at the
// customer's assigned portalPriceLevel. Returns only the resulting line breakdown + total — never
// cost tiers, vendor data, or the parts themselves. Called by the portal on each selection change.
const portalEngine = require('./portalEngine');

exports.portalResolve = onCall({ cors: true }, async (request) => {
    const customerId = assertPortalCustomer(request);
    const { flowId, selections } = request.data || {};
    const params = (selections && selections.params) || {};
    const quantities = (selections && selections.quantities) || {};

    const db = admin.firestore();
    const crmSnap = await db.collection('crm_records').doc(customerId).get();
    const crm = crmSnap.exists ? crmSnap.data() : {};
    const allowed = Array.isArray(crm.portalFlowIds) ? crm.portalFlowIds : [];
    if (!allowed.includes(String(flowId || ''))) throw new HttpsError('permission-denied', 'This product is not enabled on your account.');

    const flowSnap = await db.collection('cpq_flows').doc(String(flowId)).get();
    if (!flowSnap.exists) throw new HttpsError('not-found', 'Product configuration not found.');
    const flow = flowSnap.data();
    await assertCollectionAllowed(db, crm, flow, flowId);
    const brand = flow.brandId || crm.brandId || null;

    // The customer NEVER sees cost: force any non-safe level back to STANDARD server-side.
    let priceLevel = String(crm.portalPriceLevel || 'STANDARD');
    if (!['STANDARD', 'FAB_COST', 'FAB_WHOLESALE', 'FAB_RETAIL'].includes(priceLevel)) priceLevel = 'STANDARD';
    // Customer view toggle (Stuart 2026-07-27): a Fabricut-leveled customer may flip the quote
    // VIEW between the three levels of their own ladder — their cost (CE → them), their
    // wholesale (MSRP ÷ 2), their retail (MSRP). All three are THE CUSTOMER'S numbers; STANDARD
    // (our pricing) is never reachable from the portal, and customers not assigned a FAB_ level
    // get no toggle at all.
    const reqLevel = String((request.data && request.data.priceLevel) || '');
    if (['FAB_COST', 'FAB_WHOLESALE', 'FAB_RETAIL'].includes(reqLevel) && priceLevel.indexOf('FAB_') === 0) priceLevel = reqLevel;

    let assembly = null;
    if (flow.linkedAssemblyId) {
        const asmSnap = await db.collection('Approved_Designs').doc(flow.linkedAssemblyId).get();
        if (asmSnap.exists) assembly = { id: asmSnap.id, ...asmSnap.data() };
    }

    // Brand's parts library (matches CPQTab's libraryParts + liveAssemblies filter).
    const adSnap = await db.collection('Approved_Designs').get();
    const allParts = adSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((p) => !brand || p.brandId === brand || (Array.isArray(p.sharedBrands) && p.sharedBrands.includes(brand)));

    // The assembly's BOM (quantities).
    let bomPins = [];
    if (assembly && assembly.itemId) {
        const pinSnap = await db.collection('assembly_pins').where('assemblyId', '==', assembly.itemId).get();
        bomPins = pinSnap.docs.map((d) => d.data());
    }

    const mf = await db.collection('system').doc('master_finishes').get();
    const finishes = (mf.exists && mf.data().finishes) || [];
    const outSnap = await db.collection('hq_outsource_finishes').get();
    const outsourceFinishes = outSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const custKeys = new Set([customerId, crm.name, crm.companyName].filter(Boolean).map((s) => String(s).trim().toUpperCase()));

    const engineCtx = { flow, assembly, params, quantities, allParts, finishes, outsourceFinishes, bomPins, custKeys, priceLevel };
    const { lines, total } = portalEngine.computePricing(engineCtx);
    const stepOptions = portalEngine.resolveStepOptions(engineCtx);

    // Only customer-safe line fields leave the server.
    const safeLines = lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price, total: l.total, itemNo: l.itemNo || '', isFee: !!l.isFee }));
    return { price: { level: priceLevel, total, lines: safeLines }, stepOptions };
});
