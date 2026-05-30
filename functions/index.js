const { onRequest } = require("firebase-functions/v2/https");
const CryptoJS = require("crypto-js");

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
        // Extract the instructions sent from your React App
        const { targetUrl, method, payload } = req.body;

        if (!targetUrl || !method) {
            return res.status(400).send({ error: "Missing targetUrl or method in request." });
        }

        // Generate the secure OAuth header
        const authHeader = generateNetSuiteHeader(method, targetUrl);

        // Configure the fetch request to NetSuite
        const fetchOptions = {
            method: method,
            headers: {
                "Authorization": authHeader,
                "Content-Type": "application/json",
                // Tells NS to return the object on POST, or run transiently on SuiteQL queries
                "Prefer": method === 'POST' && targetUrl.includes('/record/') ? 'return=representation' : 'transient'
            }
        };

        // Attach body if we are sending data (like a Quote payload or SuiteQL query string)
        if (payload && method !== 'GET') {
            fetchOptions.body = JSON.stringify(payload);
        }

        // Fire the request directly from Google's Servers to NetSuite's Servers
        const response = await fetch(targetUrl, fetchOptions);
        
        // If NetSuite throws a 204 No Content or empty string, handle it gracefully
        const textData = await response.text();
        const data = textData ? JSON.parse(textData) : {};

        // Pass the exact NetSuite response back to your React App
        if (!response.ok) {
            return res.status(response.status).send(data);
        }

        return res.status(200).send(data);

    } catch (error) {
        console.error("Cloud Proxy Error:", error);
        return res.status(500).send({ error: error.message });
    }
});