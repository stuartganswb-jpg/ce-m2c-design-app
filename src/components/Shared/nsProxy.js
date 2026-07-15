// Shared authenticated client for the NetSuite proxy Cloud Function.
//
// The proxy (functions/index.js → netsuiteProxy) OAuth-signs requests with server-held NetSuite
// secrets, so it now REJECTS any call that doesn't carry both an App Check token and a signed-in
// user's Firebase ID token. This helper attaches both, so every call site is authenticated without
// each one re-implementing the header dance. It returns the raw fetch Response — callers keep their
// existing `await response.json()` / `response.ok` handling unchanged.
import { getToken } from "firebase/app-check";
import { appCheck, auth } from "../../firebase";

export const NS_PROXY_URL = "https://netsuiteproxy-f3h3jadzaq-uc.a.run.app";

// body = { targetUrl, method, payload }
export async function nsProxyFetch(body) {
    const headers = { "Content-Type": "application/json" };

    // App Check token — proves the request comes from our registered app. If this throws (e.g.
    // reCAPTCHA hiccup), we still send the request; the proxy returns a clear 401 the caller surfaces.
    try {
        const ac = await getToken(appCheck, /* forceRefresh */ false);
        if (ac && ac.token) headers["X-Firebase-AppCheck"] = ac.token;
    } catch (e) {
        // fall through — proxy will 401 on the missing header
    }

    // Firebase ID token — proves a signed-in user. Every proxy call path runs after PIN auth, so
    // currentUser is present; guard defensively anyway.
    const user = auth.currentUser;
    if (user) {
        try {
            headers["Authorization"] = `Bearer ${await user.getIdToken()}`;
        } catch (e) {
            // fall through — proxy will 401 on the missing token
        }
    }

    return fetch(NS_PROXY_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
}
