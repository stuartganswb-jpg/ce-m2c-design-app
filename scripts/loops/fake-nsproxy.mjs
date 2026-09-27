// Shared/nsProxy for the loop tests: every NetSuite call the route makes is answered by the test's
// handler (globalThis.__NS). Anything the handler does not answer FAILS the call loudly — a loop must
// never pass because a read silently returned nothing.
export const NS_PROXY_URL = 'fake://netsuite';
export async function nsProxyFetch(body) {
    const h = globalThis.__NS;
    const res = h ? await h(body) : undefined;
    if (res === undefined) {
        globalThis.__NS_UNANSWERED = [...(globalThis.__NS_UNANSWERED || []), body];
        return { ok: false, status: 599, json: async () => ({ error: 'loop test: no answer for this NetSuite call' }) };
    }
    return { ok: true, status: 200, json: async () => res };
}
