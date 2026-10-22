// The NetSuite status of a set of sales orders, read once per set (Stuart 2026-10-22 — RTG's "billed ✓ / NOT BILLED" on a
// shipped order). keys = [{ nsId, tran }] (Shared/shippedOutside.soKeyOf). One SuiteQL read; again only when the set changes.
import { useEffect, useState } from 'react';
import { nsProxyFetch } from './nsProxy';
import { soStatusSqlOf, indexSoStatus } from './shippedOutside';

const SUITEQL = 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';

/** → { idx: { byId, byTran } | null, err } */
export function useNsSoStatus(keys = []) {
    const askKey = JSON.stringify([...new Set((keys || []).filter(Boolean).map(k => `${k.nsId || ''}|${k.tran || ''}`))].sort());
    const [state, setState] = useState({ idx: null, err: '' });
    useEffect(() => {
        let gone = false;
        const asked = JSON.parse(askKey).map(s => { const [nsId, tran] = s.split('|'); return { nsId, tran }; });
        const q = soStatusSqlOf(asked);
        if (!q) { setState({ idx: { byId: {}, byTran: {} }, err: '' }); return undefined; }
        (async () => {
            try {
                const resp = await nsProxyFetch({ targetUrl: SUITEQL, method: 'POST', payload: { q } });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) throw new Error(String((data && (data.title || data.error)) || `HTTP ${resp.status}`).slice(0, 160));
                if (!gone) setState({ idx: indexSoStatus(data.items || []), err: '' });
            } catch (e) { if (!gone) setState(s => ({ idx: s.idx, err: e.message || String(e) })); }
        })();
        return () => { gone = true; };
    }, [askKey]);
    return state;
}
