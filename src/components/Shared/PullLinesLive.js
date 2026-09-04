// LIVE ON-HAND + BIN, ON THE JOB (Stuart 2026-08-29, Order Entry brief §5): each pull line on the
// finishing job window shows LIVE NetSuite on-hand and the bin(s) actually holding it, so the
// floor can visually confirm the stock exists before starting. The read is the live per-bin
// InventoryBalance/Bin join — NEVER the item's stored home bin, which goes stale (the same trap
// the WMS bin-transfer validation hit: a "home" bin the stock left long ago).
//
// One read per card open (the component mounts when the modal opens); NetSuite unreachable
// renders "unverified" — it informs, it never blocks.
import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { BRAND_NETSUITE_MAP } from './brandNetsuite';
import { takesNoFinish } from './finishLabel';

// THE PART RECORDS BEHIND THE PULL CODES (Stuart 2026-09-03, the "Unfinished" tag): a joiner,
// splice or connector NEVER takes a finish, and the engine had stamped the configuration finish
// (S04) on the joiner of the night's first live order. The tag lives on the ITEM
// (manufacturingSpecs.customData.unfinished) and the one reader is finishLabel.takesNoFinish —
// item wins, a line's own noFinish counts, a line's finishCode never outranks the record. This
// component had no part records (it only read NetSuite bins), so it reads them here, by code, in
// tens. Best-effort like the bin read: unreachable = the line prints what it carries.
export const fetchPartsByCode = async (codes) => {
    const out = {};
    const list = [...new Set((codes || []).map(c => String(c || '').toUpperCase()).filter(Boolean))];
    for (let i = 0; i < list.length; i += 10) {
        const slice = list.slice(i, i + 10);
        const snap = await getDocs(query(collection(db, 'Approved_Designs'), where('legacyErpId', 'in', slice)));
        snap.forEach(d => { const p = { id: d.id, ...d.data() }; out[String(p.legacyErpId || '').toUpperCase()] = p; });
    }
    return out;
};

const binQuery = (codes, locationId) => {
    const idList = codes.map(c => `'${String(c).toUpperCase().replace(/'/g, "''")}'`).join(',');
    return `SELECT Item.itemid AS legacy_id, Bin.binnumber AS bin_number, SUM(InventoryBalance.quantityonhand) AS onhand ` +
        `FROM Item LEFT JOIN InventoryBalance ON InventoryBalance.item = Item.id ` +
        `LEFT JOIN Bin ON InventoryBalance.binnumber = Bin.id ` +
        `WHERE UPPER(Item.itemid) IN (${idList}) AND InventoryBalance.location = ${parseInt(locationId, 10)} ` +
        `GROUP BY Item.itemid, Bin.binnumber`;
};

// { CODE: { onHand, bins: [{bin, qty}] } } for every code, at one brand location.
export const fetchLiveBins = async (codes, locationId) => {
    if (!codes || !codes.length) return {};
    const { nsProxyFetch } = await import('./nsProxy');
    const resp = await nsProxyFetch({
        targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql',
        method: 'POST',
        payload: { q: binQuery(codes, locationId) },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(JSON.stringify(data).slice(0, 300));
    const out = {};
    (data.items || []).forEach(r => {
        const code = String(r.legacy_id || '').toUpperCase();
        if (!code) return;
        const qty = Number(r.onhand) || 0;
        if (!out[code]) out[code] = { onHand: 0, bins: [] };
        out[code].onHand += qty;
        if (r.bin_number && qty) out[code].bins.push({ bin: String(r.bin_number).toUpperCase(), qty });
    });
    Object.values(out).forEach(x => x.bins.sort((a, b) => b.qty - a.qty));
    return out;
};

// The pull lines this job needs: the partsList photograph when it has one (exploded BOMs and the
// planner's /P substitutions), else the item itself — which is what the pick would pull.
const pullLinesOf = (wo) => {
    const fromList = (wo && wo.partsList) || [];
    // Two partsList dialects (2026-08-30, WO-SO59752 showed every pull ×0): the OE planner's
    // lines say `quantity`, the CPQ split's say `qty`. Read both; name fields differ the same way.
    if (fromList.length) return fromList
        .map(l => ({
            code: String(l.legacyErpId || l.partId || '').toUpperCase(),
            name: l.partName || l.name || '',
            qty: Number(l.quantity != null ? l.quantity : l.qty) || 0,
            finish: l.finishLabel || l.finishCode || '',
            noFinish: !!l.noFinish,          // the 1.6 pin fact (e.g. clear acrylic) — takesNoFinish reads it
        }))
        .filter(l => l.code);
    const own = String((wo && (wo.stockErpId || wo.type)) || '').toUpperCase();
    return own && own.includes('-') ? [{ code: own, name: wo.itemName || '', qty: Number(wo.totalParts || wo.qty) || 0 }] : [];
};

const PullLinesLive = ({ wo }) => {
    const [state, setState] = useState({ loading: true, stock: null, error: null });
    // One row per code, need summed across configurations (2026-08-30: a 3-room order rendered
    // HCUMB410 three times, each row comparing its slice against the SAME shelf — the honest
    // question is total need vs on hand). Finishes collect; rooms stay on the pick ticket.
    const rawLines = pullLinesOf(wo);
    const byCode = new Map();
    rawLines.forEach(l => {
        const cur = byCode.get(l.code);
        if (cur) { cur.qty += l.qty; if (l.finish && !cur.finishes.includes(l.finish)) cur.finishes.push(l.finish); cur.noFinish = cur.noFinish || l.noFinish; }
        else byCode.set(l.code, { ...l, finishes: l.finish ? [l.finish] : [] });
    });
    const lines = [...byCode.values()];
    const codes = [...new Set(lines.map(l => l.code))];
    const codesKey = codes.join('|');
    const locationId = (BRAND_NETSUITE_MAP[String((wo && (wo.brand || wo.brandId)) || 'ce').toLowerCase()] || {}).location || '17';

    const [parts, setParts] = useState({});
    useEffect(() => {
        let dead = false;
        if (!codesKey) { setParts({}); return undefined; }
        fetchPartsByCode(codesKey.split('|'))
            .then(map => { if (!dead) setParts(map); })
            .catch(() => { if (!dead) setParts({}); });
        return () => { dead = true; };
    }, [codesKey]);

    useEffect(() => {
        let dead = false;
        if (!codesKey) { setState({ loading: false, stock: {}, error: null }); return undefined; }
        setState({ loading: true, stock: null, error: null });
        fetchLiveBins(codesKey.split('|'), locationId)
            .then(stock => { if (!dead) setState({ loading: false, stock, error: null }); })
            .catch(e => { if (!dead) setState({ loading: false, stock: null, error: e.message || String(e) }); });
        return () => { dead = true; };
    }, [codesKey, locationId]);

    if (!lines.length) return null;
    const mono = { fontFamily: 'var(--mono)' };
    return (
        <div style={{ background: '#fff', padding: '24px', border: '1px solid var(--line)' }}>
            <div style={{ ...mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '16px', borderBottom: '1px solid var(--line)', paddingBottom: '8px', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <span>Pull lines · live stock &amp; bin</span>
                <span style={{ letterSpacing: 0, textTransform: 'none' }}>
                    {state.loading ? 'reading NetSuite…' : state.error ? '⚠ unverified — NetSuite unreachable' : 'live'}
                </span>
            </div>
            {lines.map((l, i) => {
                const s = state.stock ? state.stock[l.code] : null;
                const onHand = s ? s.onHand : null;
                const enough = onHand !== null && onHand >= l.qty;
                const stockColor = state.loading || state.error ? 'var(--ink-soft)' : (enough ? '#3a7d44' : '#d9534f');
                return (
                    <div key={l.code + i} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', borderBottom: '1px solid var(--line)', padding: '8px 0', fontSize: '0.9rem', flexWrap: 'wrap' }}>
                        <span style={{ minWidth: '180px' }}>
                            <span style={{ ...mono, fontWeight: 600, color: 'var(--ink)' }}>{l.code}</span>
                            <span style={{ color: 'var(--ink-soft)' }}> × {l.qty}</span>
                            {takesNoFinish(parts[l.code], l)
                                ? <span title="This part takes no finish (Unfinished tag on the item, or the pin says so) — it is pulled as is, never sprayed." style={{ ...mono, fontSize: '10px', color: 'var(--ink-soft)' }}> · no finish</span>
                                : (l.finishes || []).length > 0 && <span style={{ ...mono, fontSize: '10px', color: 'var(--brass)' }}> · {l.finishes.join(', ')}</span>}
                            {l.name && <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>{l.name}</div>}
                        </span>
                        <span style={{ ...mono, fontSize: '11px', textAlign: 'right', color: stockColor, alignSelf: 'center' }}>
                            {state.loading ? '…'
                                : state.error ? 'unverified'
                                : !s || onHand === 0 ? '0 on hand — verify before starting'
                                : <>
                                    {enough ? '✓' : '⚠'} {onHand} on hand
                                    {s.bins.length > 0 && <span style={{ color: 'var(--ink)' }}> · {s.bins.slice(0, 3).map(b => `${b.bin} (${b.qty})`).join(', ')}{s.bins.length > 3 ? ` +${s.bins.length - 3} more` : ''}</span>}
                                    {s.bins.length === 0 && ' · no bin — loose stock'}
                                </>}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

export default PullLinesLive;
