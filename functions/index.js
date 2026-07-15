const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const CryptoJS = require("crypto-js");

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

exports.authenticatePin = onCall({
    enforceAppCheck: true, // 🛡️ Requires a valid App Check (reCAPTCHA) token
    cors: true
}, async (request) => {

    const { pin } = request.data;
    const clientIp = request.rawRequest.ip;
    
    if (!pin) {
        throw new HttpsError('invalid-argument', 'PIN is required.');
    }

    const db = admin.firestore();
    
    // Rate Limiting / Lockout — keyed primarily on the PIN (account), so one operator's typos can't
    // lock out the whole warehouse (every device shares one public IP). A much higher IP-level counter
    // still backstops a brute-force enumeration flood. Only FAILED attempts count; any success clears
    // the counters. The PIN is hashed so raw PINs never land in security_logs doc ids.
    const crypto = require('crypto');
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