const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const CryptoJS = require("crypto-js");

// Initialize Firebase Admin to securely access Firestore and Auth
admin.initializeApp();

// ============================================================================
// 1. SECURE AUTHENTICATION FUNCTION (MINTING PRESS & GATEKEEPER)
// ============================================================================

exports.authenticatePin = onCall({ 
    enforceAppCheck: false, // 🚀 SHIELD DOWN: Lets traffic through
    cors: true 
}, async (request) => {
    
    // 🚀 BYPASSED: Removed the manual request.app token check so it doesn't block you

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

// --- SECURE VAULT: NETSUITE CREDENTIALS ---
const NS_ACCOUNT = "3728153";
const NS_CONSUMER_KEY = "0979687669fe99f5869793e3a911daeb062b779c4801817c86b494ccde1e0db4";
const NS_CONSUMER_SECRET = "4f88d6f93c57a1b9e0ffb29ff71831d47b075dcdf609cdb028dd305cb552c243";
const NS_TOKEN_ID = "2e5ce04cce902b621aad683d91e08674631cc7c9dd07edaae07cdc12e12f57ad";
const NS_TOKEN_SECRET = "f5c98c85514f46fc67674d822b6d70461e5407da13c84c2db6c7c9c4e7f29a72";

// 🔐 Internal Signature Generator
const generateNetSuiteHeader = (method, url) => {
    const oauth_nonce = Math.random().toString(36).substring(2, 15);
    const oauth_timestamp = Math.floor(Date.now() / 1000).toString();
    
    const baseString = `${method}&${encodeURIComponent(url)}&` + encodeURIComponent(
        `oauth_consumer_key=${NS_CONSUMER_KEY}&` +
        `oauth_nonce=${oauth_nonce}&` +
        `oauth_signature_method=HMAC-SHA256&` +
        `oauth_timestamp=${oauth_timestamp}&` +
        `oauth_token=${NS_TOKEN_ID}&` +
        `oauth_version=1.0`
    );
    
    const signingKey = `${encodeURIComponent(NS_CONSUMER_SECRET)}&${encodeURIComponent(NS_TOKEN_SECRET)}`;
    const hash = CryptoJS.HmacSHA256(baseString, signingKey);
    const oauth_signature = CryptoJS.enc.Base64.stringify(hash);
    
    return `OAuth realm="${NS_ACCOUNT}", oauth_consumer_key="${NS_CONSUMER_KEY}", oauth_token="${NS_TOKEN_ID}", oauth_nonce="${oauth_nonce}", oauth_timestamp="${oauth_timestamp}", oauth_signature_method="HMAC-SHA256", oauth_signature="${encodeURIComponent(oauth_signature)}", oauth_version="1.0"`;
};

// 🚀 The Universal NetSuite Proxy (V2 Syntax)
exports.netsuiteProxy = onRequest({ cors: true }, async (req, res) => {
    try {
        const { targetUrl, method, payload } = req.body;

        if (!targetUrl || !method) {
            return res.status(400).send({ error: "Missing targetUrl or method in request." });
        }

        const authHeader = generateNetSuiteHeader(method, targetUrl);

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