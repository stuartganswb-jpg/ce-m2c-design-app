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
    
    // Rate Limiting / Lockout Reference
    const attemptsRef = db.collection('security_logs').doc(`ip_${clientIp}`);
    const lockoutWindow = 10 * 60 * 1000; // 10 minutes in milliseconds
    const now = Date.now();

    const attemptDoc = await attemptsRef.get();

    // 1. Check for an active lockout on this IP
    if (attemptDoc.exists) {
        const data = attemptDoc.data();
        if (data.count >= 5 && (now - data.lastAttempt < lockoutWindow)) {
            const timeLeft = Math.ceil((lockoutWindow - (now - data.lastAttempt)) / 60000);
            throw new HttpsError('resource-exhausted', `Too many attempts. Locked out for ${timeLeft} minutes.`);
        }
        // Reset count if the 10-minute window has expired
        if (now - data.lastAttempt >= lockoutWindow) {
            await attemptsRef.set({ count: 0, lastAttempt: now });
        }
    }

    // 2. Query the hq_users collection securely on the server
    const usersRef = db.collection('hq_users');
    const snapshot = await usersRef.where('pin', '==', pin).limit(1).get();

    // 3. Handle Invalid PIN & Increment Failure Count
    if (snapshot.empty) {
        const newCount = attemptDoc.exists && (now - attemptDoc.data().lastAttempt < lockoutWindow) 
            ? attemptDoc.data().count + 1 
            : 1;
        
        await attemptsRef.set({ count: newCount, lastAttempt: now });
        throw new HttpsError('unauthenticated', 'Invalid PIN.');
    }

    // 4. Success: Clear the attempt logs for this IP
    await attemptsRef.delete();

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

const generateNetSuiteHeader = (method, url, creds) => {
    const oauth_nonce = Math.random().toString(36).substring(2, 15);
    const oauth_timestamp = Math.floor(Date.now() / 1000).toString();

    const baseString = `${method}&${encodeURIComponent(url)}&` + encodeURIComponent(
        `oauth_consumer_key=${creds.consumerKey}&` +
        `oauth_nonce=${oauth_nonce}&` +
        `oauth_signature_method=HMAC-SHA256&` +
        `oauth_timestamp=${oauth_timestamp}&` +
        `oauth_token=${creds.tokenId}&` +
        `oauth_version=1.0`
    );

    const signingKey = `${encodeURIComponent(creds.consumerSecret)}&${encodeURIComponent(creds.tokenSecret)}`;
    const hash = CryptoJS.HmacSHA256(baseString, signingKey);
    const oauth_signature = CryptoJS.enc.Base64.stringify(hash);

    return `OAuth realm="${creds.account}", oauth_consumer_key="${creds.consumerKey}", oauth_token="${creds.tokenId}", oauth_nonce="${oauth_nonce}", oauth_timestamp="${oauth_timestamp}", oauth_signature_method="HMAC-SHA256", oauth_signature="${encodeURIComponent(oauth_signature)}", oauth_version="1.0"`;
};

exports.netsuiteProxy = onRequest({
    cors: true,
    secrets: [NS_ACCOUNT, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET]
}, async (req, res) => {
    try {
        const { targetUrl, method, payload } = req.body;

        if (!targetUrl || !method) {
            return res.status(400).send({ error: "Missing targetUrl or method in request." });
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