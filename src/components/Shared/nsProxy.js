// Shared authenticated client for the NetSuite proxy Cloud Function.
//
// The proxy (functions/index.js → netsuiteProxy) OAuth-signs requests with server-held NetSuite
// secrets, so it now REJECTS any call that doesn't carry both an App Check token and a signed-in
// user's Firebase ID token. This helper attaches both, so every call site is authenticated without
// each one re-implementing the header dance. It returns the raw fetch Response — callers keep their
// existing `await response.json()` / `response.ok` handling unchanged.
import { getToken } from "firebase/app-check";
import { appCheck, auth, db } from "../../firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auditPageOf, auditUserOf } from "./auditContext";

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

    const res = await fetch(NS_PROXY_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    if (isDirectWrite(body)) logDirectWrite(body, res);
    return res;
}

// ── A NETSUITE WRITE THAT SKIPS THE QUEUE LEAVES A RECORD (RTG Audit Log, Stuart 2026-10-03) ──────────────────
// Almost every NetSuite transaction goes through ns_outbox, which keeps its own history. The few that do not —
// the WMS /P convert build (the RESTlet), item / customer / vendor record updates from the Library, 11.1 and
// Admin — left nothing behind. Each now writes one activity-log line (hq_logs, audit.kind 'NS_DIRECT'): who, the
// page, what was called, whether NetSuite took it and the id it returned. SuiteQL reads are not logged. Fire and
// forget — it reads a CLONE of the response and never delays, changes or fails the caller's NetSuite call.
const isDirectWrite = (body) => {
    const m = String((body && body.method) || "GET").toUpperCase();
    return m !== "GET" && !/\/query\/v1\/suiteql/i.test(String((body && body.targetUrl) || ""));
};
const logDirectWrite = (body, res) => {
    let copy = null;
    try { copy = res.clone(); } catch (e) { copy = null; }
    (async () => {
        let nsId = null, error = "";
        try {
            const loc = copy && copy.headers ? (copy.headers.get("location") || "") : "";
            const txt = copy ? await copy.text() : "";
            let j = null;
            try { j = JSON.parse(txt); } catch (e) { j = null; }
            nsId = (j && (j.id || j.internalId || (j.result && j.result.id))) || (loc.match(/\/(\d+)\s*$/) || [])[1] || null;
            if (!res.ok) error = (j && ((j["o:errorDetails"] && j["o:errorDetails"][0] && j["o:errorDetails"][0].detail) || j.title || j.error)) || txt.slice(0, 300);
            else if (j && j.success === false) error = String(j.error || j.message || "the RESTlet answered success:false");
        } catch (e) { /* the record still says what was called and the HTTP status */ }
        const url = String(body.targetUrl || "");
        const restlet = /restlet/i.test(url);
        const path = restlet ? "RESTlet (convert build)" : ((url.split("/services/rest/")[1] || url).split("?")[0]);
        const method = String(body.method || "").toUpperCase();
        const ok = !!res.ok && !error;
        const memo = body.payload && typeof body.payload.memo === "string" ? body.payload.memo : "";
        await addDoc(collection(db, "hq_logs"), {
            t: serverTimestamp(), u: auditUserOf() || "unknown", page: auditPageOf() || null, cat: "ns-direct",
            msg: `NetSuite ${method} ${path} → ${ok ? `OK${nsId ? ` (id ${nsId})` : ""}` : `FAILED (HTTP ${res.status})`}${memo ? ` — ${memo.slice(0, 160)}` : ""}`,
            audit: {
                kind: "NS_DIRECT", method, targetUrl: url.slice(0, 300),
                recordKind: restlet ? "restlet" : ((url.match(/\/record\/v1\/([a-zA-Z]+)/) || [])[1] || ""),
                ok, httpStatus: res.status || null, nsId: nsId ? String(nsId) : null, error: String(error || "").slice(0, 500),
                payloadQty: Number(body.payload && body.payload.quantity) || null,
            },
        });
    })().catch(() => { /* an audit line must never break a NetSuite call */ });
};
