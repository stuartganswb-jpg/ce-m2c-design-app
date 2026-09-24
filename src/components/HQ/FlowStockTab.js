// HQ 4.7 FLOW STOCK (Stuart 2026-09-24) — "a view that shows our item#, fabricut id#, our sales price,
// their sales price, then our stock situation to the right of this, qty available, qty on order, qty
// bo so that we can see at this point what items have still not been ordered or put into production.
// organize it via tabs/views by the cpq flows so H1-75, H1-1, H1-138, so forth."
//
// READ-ONLY. It writes nothing — no Firestore, no NetSuite write, no work order. Every number on it
// has an owner elsewhere and is read from that owner:
//   • rows (what a flow sells, as family blocks)  → Shared/flowItems (the CPQ pin index + the quote's
//                                                   own priceChoice at the Fabricut levels)
//   • Avail / On Ord / BO                         → Shared/stockPosition, the SAME reader the Sales
//                                                   Snapshot calls (brand-location Avail, open PO +
//                                                   open WO, our open backorder lines)
// Fixes happen in the tools that own each fact (4.6 pricing, 1.6 pins, 11.1 sync, 12.5 ordering).
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { db } from '../../firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { nsProxyFetch } from '../Shared/nsProxy';
import { BRAND_NETSUITE_MAP } from '../Shared/brandNetsuite';
import { fetchAvailableById, fetchInboundById, backorderTallyOf } from '../Shared/stockPosition';
import { flowTabsOf, flowFamilies, notCovered, enginePartsOf, partFinderOf, finishCodeOf } from '../Shared/flowItems';

const theme = {
    paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46',
    brass: '#b08d57', brassDark: '#7d6031', line: '#d9d4ca', green: '#3a7d44', red: '#d9534f', redDark: '#a8322e',
    blue: '#3f7fc4', blueDark: '#2a5f9e',
    mono: "'Courier New', monospace", sans: 'var(--sans)', serif: 'var(--serif)',
};
const money = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))) ? '' : `$${Number(v).toFixed(2)}`;
const qty = (v) => (v === null || v === undefined) ? '' : String(Math.round(Number(v) || 0));
// The short "why" beside our price when it did not come from the Fabricut tier.
const SOURCE_TAG = {
    'customer price (4.6)': 'their row',
    'item base price': 'base',
    'authored override': 'pin',
    'flow default (no price on the item)': 'flow default',
};

const runSql = async (q) => {
    const r = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql', method: 'POST', payload: { q } });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof b === 'object' ? JSON.stringify(b) : String(b));
    return b.items || [];
};

const FlowStockTab = ({ activeBrand }) => {
    const [brandDocs, setBrandDocs] = useState(null);         // Approved_Designs for this brand (null = loading)
    const [flows, setFlows] = useState([]);
    const [finishes, setFinishes] = useState([]);             // [...master_finishes, ...hq_outsource_finishes]
    const [outsource, setOutsource] = useState([]);
    const [fabCustomers, setFabCustomers] = useState([]);     // crm_records CUSTOMER named ~Fabricut
    const [fabCustomerId, setFabCustomerId] = useState('');
    const [loadError, setLoadError] = useState('');
    const [activeFlowId, setActiveFlowId] = useState('');
    const [pinsByFlow, setPinsByFlow] = useState({});         // flowId → pins | 'loading' | { error }
    const [stockByFlow, setStockByFlow] = useState({});       // flowId → { loading, avail, inbound, error, at }
    const [boByCode, setBoByCode] = useState(null);           // our backorder tally, read once
    const [search, setSearch] = useState('');
    const [onlyGaps, setOnlyGaps] = useState(false);
    const asked = useRef({ pins: new Set(), stock: new Set() });

    // ── REFERENCE DATA — one read each, on open. This is a board to read, not a live monitor; ↻ reloads.
    const loadAll = useCallback(async () => {
        if (!activeBrand) return;
        setLoadError('');
        setBrandDocs(null);
        asked.current = { pins: new Set(), stock: new Set() };
        setPinsByFlow({}); setStockByFlow({}); setBoByCode(null);
        try {
            const [lib, fl, mf, out, crm] = await Promise.all([
                getDocs(collection(db, 'Approved_Designs')),
                getDocs(query(collection(db, 'cpq_flows'), where('brandId', '==', activeBrand))),
                getDoc(doc(db, 'system', 'master_finishes')),
                getDocs(collection(db, 'hq_outsource_finishes')),
                getDocs(collection(db, 'crm_records')),
            ]);
            setBrandDocs(lib.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(d => d.brandId === activeBrand || (d.sharedBrands || []).includes(activeBrand)));
            setFlows(fl.docs.map(d => ({ id: d.id, ...d.data() })));
            const outs = out.docs.map(d => ({ id: d.id, ...d.data() }));
            setOutsource(outs);
            setFinishes([...((mf.exists() && mf.data().finishes) || []), ...outs]);
            // Fabricut = the CRM customer the price levels already recognise by name (priceLevels.
            // customerPriceLevel); brand-isolated the way CPQ reads customers.
            const fab = crm.docs.map(d => ({ id: d.id, ...d.data() })).filter(r =>
                r.type === 'CUSTOMER'
                && (r.brandId === activeBrand || (r.sharedBrands || []).includes(activeBrand))
                && /fabricut/i.test(String(r.name || r.companyName || '')));
            setFabCustomers(fab);
            setFabCustomerId(prev => (fab.some(c => c.id === prev) ? prev : (fab[0]?.id || '')));
        } catch (e) {
            console.error('Flow Stock load failed', e);
            setLoadError(e.message || String(e));
            setBrandDocs([]);
        }
    }, [activeBrand]);
    useEffect(() => { loadAll(); }, [loadAll]);

    const parts = useMemo(() => enginePartsOf(brandDocs || []), [brandDocs]);
    const findPart = useMemo(() => partFinderOf(parts), [parts]);
    const assemblies = useMemo(() => (brandDocs || []).filter(d => d.partClass === 'Assembly' || d.partClass === 'Master Assembly'), [brandDocs]);
    // A flow's linkedAssemblyId may hold the doc id OR the itemId — the CPQ lookup's tolerance.
    const assemblyFor = useCallback((flow) => {
        const key = flow?.linkedAssemblyId;
        if (!key) return null;
        return assemblies.find(a => a.id === key || a.itemId === key) || null;
    }, [assemblies]);
    const tabs = useMemo(() => flowTabsOf(flows, assemblyFor), [flows, assemblyFor]);
    useEffect(() => {
        if (tabs.length && !tabs.some(t => t.flowId === activeFlowId)) setActiveFlowId(tabs[0].flowId);
    }, [tabs, activeFlowId]);
    const activeTab = tabs.find(t => t.flowId === activeFlowId) || null;
    const activeAssembly = activeTab ? assemblyFor(activeTab.flow) : null;

    // ── PINS — the engine's read: assembly_pins where assemblyId == the assembly's DOC id
    // (CPQTab's engine subscription; the adapter keeps only pins carrying that id).
    useEffect(() => {
        if (!activeTab || !activeAssembly || asked.current.pins.has(activeTab.flowId)) return;
        asked.current.pins.add(activeTab.flowId);
        const flowId = activeTab.flowId;
        setPinsByFlow(p => ({ ...p, [flowId]: 'loading' }));
        getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', activeAssembly.id)))
            .then(snap => setPinsByFlow(p => ({ ...p, [flowId]: snap.docs.map(d => ({ id: d.id, ...d.data() })) })))
            .catch(e => setPinsByFlow(p => ({ ...p, [flowId]: { error: e.message || String(e) } })));
    }, [activeTab, activeAssembly]);

    const fabCustomer = fabCustomers.find(c => c.id === fabCustomerId) || null;
    const priceCtx = useMemo(() => {
        const byCode = new Map(finishes.map(f => [finishCodeOf(f).toUpperCase(), f]));
        return {
            customerId: fabCustomer?.id || '', customer: fabCustomer, outsourceCodes: outsource, findByCode: findPart,
            finishObjOf: (code) => byCode.get(String(code || '').toUpperCase()) || null,
        };
    }, [fabCustomer, outsource, findPart, finishes]);

    const pinsState = activeTab ? pinsByFlow[activeTab.flowId] : undefined;
    const board = useMemo(() => {
        if (!activeTab || !activeAssembly || !Array.isArray(pinsState)) return null;
        return flowFamilies({ flow: activeTab.flow, assembly: activeAssembly, pins: pinsState, findPart, finishes, priceCtx });
    }, [activeTab, activeAssembly, pinsState, findPart, finishes, priceCtx]);

    // ── STOCK — read when a tab is opened, kept for the session; ↻ reads it again ──────────────
    const loadStock = useCallback(async (flowId, skus) => {
        const ids = [...new Set(skus.filter(r => r.stockable && r.internalId).map(r => r.internalId))];
        setStockByFlow(s => ({ ...s, [flowId]: { loading: true } }));
        try {
            const loc = (BRAND_NETSUITE_MAP[activeBrand] || {}).location || '17';
            // One after the other, as the Snapshot does: each read keeps at most 4 NetSuite calls in
            // flight, and running both at once would take 8 of an account-wide limit of about five.
            const bo = boByCode || await getDocs(query(collection(db, 'hq_sales_orders'), where('brand', '==', activeBrand)))
                .then(snap => backorderTallyOf(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
                .catch(() => null);
            const avail = ids.length ? await fetchAvailableById(ids, loc, runSql) : {};
            const inbound = ids.length ? await fetchInboundById(ids, runSql) : { byId: {}, error: null };
            if (!boByCode && bo) setBoByCode(bo);
            setStockByFlow(s => ({ ...s, [flowId]: { loading: false, avail, inbound: inbound.byId, inboundError: inbound.error ? (inbound.error.message || String(inbound.error)) : '', boFailed: !bo, at: new Date() } }));
        } catch (e) {
            setStockByFlow(s => ({ ...s, [flowId]: { loading: false, error: e.message || String(e) } }));
        }
    }, [activeBrand, boByCode]);
    useEffect(() => {
        if (!activeTab || !board || asked.current.stock.has(activeTab.flowId)) return;
        asked.current.stock.add(activeTab.flowId);
        loadStock(activeTab.flowId, board.skus);
    }, [activeTab, board, loadStock]);

    const stock = activeTab ? stockByFlow[activeTab.flowId] : null;
    const stockOf = useCallback((row) => {
        if (!stock || stock.loading || stock.error || !row.stockable || !row.internalId) return undefined;
        const inb = (stock.inbound || {})[row.internalId];
        return { avail: (stock.avail || {})[row.internalId] || 0, onOrd: inb ? inb.qty : 0, onOrdLines: inb ? inb.lines : [] };
    }, [stock]);
    const boOf = (row) => (boByCode ? boByCode[String(row.code || '').toUpperCase()] : null);

    // ── FILTERS — they apply to the FAMILY: a family shows whole when any of its rows match (the 3-Tier
    // view's rule: half a family defeats a view whose point is reading the tiers against each other).
    const counts = useMemo(() => {
        if (!board) return null;
        const inv = board.skus.filter(r => r.stockable);
        return {
            skus: board.skus.length,
            gaps: inv.filter(r => notCovered(r, stockOf(r))).length,
            notInNs: inv.filter(r => !r.internalId).length,
        };
    }, [board, stockOf]);
    const shown = useMemo(() => {
        if (!board) return [];
        const term = search.trim().toUpperCase();
        const rowHit = (r) => !term || [r.code, r.fabCode, r.name].some(v => String(v || '').toUpperCase().includes(term));
        return board.sections.map(sec => ({
            ...sec,
            families: sec.families.filter(f => f.rows.some(rowHit) && (!onlyGaps || f.rows.some(r => notCovered(r, stockOf(r))))),
        })).filter(sec => sec.families.length);
    }, [board, search, onlyGaps, stockOf]);

    // ── styles (4.6's table idiom) ───────────────────────────────────────────────────────────
    const th = { padding: '8px 10px', textAlign: 'left', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, borderBottom: `2px solid ${theme.ink}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: theme.paper, zIndex: 1 };
    const td = { padding: '6px 10px', textAlign: 'left', fontFamily: theme.mono, fontSize: '12px', color: theme.ink, borderBottom: `1px solid ${theme.paper2}`, verticalAlign: 'top' };
    const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
    const chip = (bg, fg) => ({ display: 'inline-block', padding: '1px 6px', marginLeft: '6px', fontSize: '9px', letterSpacing: '.06em', textTransform: 'uppercase', background: bg, color: fg, fontFamily: theme.mono, whiteSpace: 'nowrap' });
    const btn = (on) => ({ padding: '7px 12px', border: `1px solid ${on ? theme.ink : theme.line}`, background: on ? theme.ink : '#fff', color: on ? '#fff' : theme.ink, fontFamily: theme.mono, fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' });

    const stockCells = (row) => {
        if (!row.stockable) return <td colSpan={3} style={{ ...td, color: theme.inkSoft, textAlign: 'right', fontSize: '10px' }}>{row.kind === 'MISSING' ? 'no library item' : 'no stock (fee / kit)'}</td>;
        if (!row.internalId) return <td colSpan={3} style={{ ...td, color: theme.brassDark, textAlign: 'right', fontSize: '10px' }}>not in NetSuite</td>;
        const st = stockOf(row);
        const bo = boOf(row);
        const gap = notCovered(row, st);
        const gapBg = gap ? '#fbeaea' : undefined;
        if (!st) {
            const msg = stock?.loading ? '…' : (stock?.error ? '!' : '');
            return <><td style={num}>{msg}</td><td style={num}>{msg}</td><td style={num}>{bo ? qty(bo.qty) : ''}</td></>;
        }
        const lines = (st.onOrdLines || []).map(l => `${l.kind} ${l.tranid}: ${qty(l.open)} open${l.source ? ` · ${l.source}` : ''}${l.expected ? ` · due ${l.expected}` : ''}`).join('\n');
        return (
            <>
                <td style={{ ...num, background: gapBg, color: st.avail > 0 ? theme.ink : theme.redDark, fontWeight: 600 }}>{qty(st.avail)}</td>
                <td style={{ ...num, background: gapBg, color: st.onOrd > 0 ? theme.blueDark : theme.inkSoft }} title={lines || 'nothing open on a PO or WO'}>{qty(st.onOrd)}</td>
                <td style={{ ...num, color: bo && bo.qty > 0 ? theme.redDark : theme.inkSoft, fontWeight: bo && bo.qty > 0 ? 700 : 400 }} title={bo ? bo.orders.join('\n') : 'nobody waiting'}>{bo ? qty(bo.qty) : '0'}</td>
            </>
        );
    };

    const priceCell = (row) => {
        if (!row.ourPrice) return <td style={{ ...num, color: theme.inkSoft }}>{row.kind === 'MILL' ? '' : '—'}</td>;
        const tag = SOURCE_TAG[row.ourPrice.source];
        return <td style={num} title={row.ourPrice.source}>{money(row.ourPrice.value)}{tag && <span style={chip(theme.paper2, theme.inkSoft)}>{tag}</span>}</td>;
    };

    const renderRow = (fam, row, i) => {
        const lead = i === 0;
        const variant = row.kind === 'VARIANT';
        return (
            <tr key={row.key} style={{ background: lead ? '#fff' : undefined }}>
                <td style={{ ...td, paddingLeft: variant ? '28px' : '10px', fontWeight: lead ? 700 : 500 }}>
                    {row.code}
                    {lead && fam.hidden && <span style={chip('#eee', theme.inkSoft)} title="Built and billed, never shown to the customer">BOM only</span>}
                    {row.kind === 'MILL' && <span style={chip(theme.paper2, theme.inkSoft)}>mill</span>}
                    {row.finishes.length > 0 && <div style={{ fontSize: '10px', color: theme.inkSoft, marginTop: '2px' }}>{row.kind === 'MILL' ? 'billed as the mill code for ' : ''}{row.finishes.join(' · ')}</div>}
                    {lead && (fam.name || row.name) && <div style={{ fontFamily: theme.sans, fontSize: '11px', color: theme.inkSoft, fontWeight: 400, marginTop: '2px' }}>{row.name || fam.name}</div>}
                </td>
                <td style={td}>{row.fabCode || <span style={{ color: theme.inkSoft }}>{row.kind === 'MILL' && !row.finishes.length ? '' : '—'}</span>}</td>
                {priceCell(row)}
                <td style={num}>{row.theirPrice !== null && row.theirPrice !== undefined ? money(row.theirPrice) : <span style={{ color: theme.inkSoft }}>{row.kind === 'MILL' && !row.finishes.length ? '' : '—'}</span>}</td>
                {stockCells(row)}
            </tr>
        );
    };

    if (!activeBrand) return null;
    return (
        <div style={{ fontFamily: theme.sans, color: theme.ink }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '6px' }}>
                <h2 style={{ fontFamily: theme.serif, fontWeight: 400, fontSize: '1.8rem', margin: 0 }}>Flow Stock</h2>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: theme.inkSoft }}>Fabricut customer</span>
                    {fabCustomers.length > 1 ? (
                        <select value={fabCustomerId} onChange={e => setFabCustomerId(e.target.value)} style={{ padding: '6px 8px', fontFamily: theme.mono, fontSize: '12px', border: `1px solid ${theme.line}` }}>
                            {fabCustomers.map(c => <option key={c.id} value={c.id}>{c.name || c.companyName || c.id}</option>)}
                        </select>
                    ) : (
                        <span style={{ fontFamily: theme.mono, fontSize: '12px', color: fabCustomer ? theme.ink : theme.redDark }}>
                            {fabCustomer ? (fabCustomer.name || fabCustomer.companyName) : 'none found in the CRM — Fabricut # falls back to the item tiers'}
                        </span>
                    )}
                    <button style={btn(false)} onClick={loadAll} title="Read the library, flows and prices again">↻ Reload</button>
                </div>
            </div>
            <div style={{ fontSize: '12px', color: theme.inkSoft, marginBottom: '16px', maxWidth: '980px' }}>
                Every item each CPQ flow sells, with what a Fabricut quote prices it at and where its stock stands. Read-only: prices are edited in 4.6, stock is ordered from 12.5.
                Avail is at the brand's location, On Ord is open purchase orders + open work orders, BO is customers waiting on our open orders — the same numbers as the Sales Snapshot.
            </div>

            {loadError && <div style={{ padding: '10px 12px', background: '#fbeaea', color: theme.redDark, fontFamily: theme.mono, fontSize: '12px', marginBottom: '12px' }}>Could not load: {loadError}</div>}
            {brandDocs === null && <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.inkSoft }}>Loading the library and flows…</div>}
            {brandDocs !== null && !tabs.length && !loadError && <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.inkSoft }}>No CPQ flow on this brand has a linked assembly.</div>}

            {tabs.length > 0 && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px', borderBottom: `1px solid ${theme.line}`, paddingBottom: '10px' }}>
                    {tabs.map(t => (
                        <button key={t.flowId} onClick={() => setActiveFlowId(t.flowId)} style={btn(t.flowId === activeFlowId)} title={t.group ? `${t.group} · ${t.flow.sizeGroupChoice || ''}` : t.flow.name}>
                            {t.label}
                        </button>
                    ))}
                </div>
            )}

            {activeTab && (
                <>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item #, Fabricut #, description" style={{ padding: '8px 10px', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '12px', width: '300px', background: '#fff' }} />
                        <button style={btn(onlyGaps)} onClick={() => setOnlyGaps(v => !v)} title="Nothing available and nothing on a PO or WO">Not ordered only</button>
                        <button style={btn(false)} disabled={!board || stock?.loading} onClick={() => board && loadStock(activeTab.flowId, board.skus)}>↻ Stock</button>
                        {counts && (
                            <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>
                                {counts.skus} SKUs · <b style={{ color: counts.gaps ? theme.redDark : theme.green }}>{stock && !stock.loading && !stock.error ? `${counts.gaps} not ordered` : 'stock …'}</b>
                                {counts.notInNs > 0 && <> · <span style={{ color: theme.brassDark }}>{counts.notInNs} not in NetSuite</span></>}
                                {stock?.at && <> · stock read {stock.at.toLocaleTimeString()}</>}
                            </span>
                        )}
                    </div>
                    {stock?.error && <div style={{ padding: '8px 12px', background: '#fbeaea', color: theme.redDark, fontFamily: theme.mono, fontSize: '11px', marginBottom: '10px' }}>Stock read failed: {stock.error}</div>}
                    {stock?.inboundError && <div style={{ padding: '8px 12px', background: '#fdf6e3', color: theme.brassDark, fontFamily: theme.mono, fontSize: '11px', marginBottom: '10px' }}>On Ord may be incomplete — the PO/WO read failed part-way: {stock.inboundError}</div>}
                    {stock?.boFailed && <div style={{ padding: '8px 12px', background: '#fdf6e3', color: theme.brassDark, fontFamily: theme.mono, fontSize: '11px', marginBottom: '10px' }}>BO could not be read from the sales orders — the column shows nothing rather than a guess.</div>}
                    {!activeAssembly && <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.inkSoft }}>This flow's assembly was not found.</div>}
                    {pinsState === 'loading' && <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.inkSoft }}>Reading the flow's pins…</div>}
                    {pinsState?.error && <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.redDark }}>Could not read the pins: {pinsState.error}</div>}
                    {board && !board.skus.length && <div style={{ fontFamily: theme.mono, fontSize: '12px', color: theme.inkSoft }}>This flow's assembly has no pinned items.</div>}

                    {board && board.skus.length > 0 && (
                        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 300px)', border: `1px solid ${theme.line}`, background: theme.paper }}>
                            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '900px' }}>
                                <thead>
                                    <tr>
                                        <th style={th}>Our item #</th>
                                        <th style={th}>Fabricut #</th>
                                        <th style={{ ...th, textAlign: 'right' }} title="What a Fabricut quote charges them — the Fabricut Cost level">Our price to Fabricut</th>
                                        <th style={{ ...th, textAlign: 'right' }} title="Fabricut's own sell price — the Fabricut Wholesale level (MSRP ÷ 2)">Fabricut sells at</th>
                                        <th style={{ ...th, textAlign: 'right' }}>Avail</th>
                                        <th style={{ ...th, textAlign: 'right' }}>On Ord</th>
                                        <th style={{ ...th, textAlign: 'right' }}>BO</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {shown.map(sec => (
                                        <React.Fragment key={sec.role}>
                                            <tr><td colSpan={7} style={{ ...td, background: theme.paper2, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, fontWeight: 700 }}>{sec.label} · {sec.families.length}</td></tr>
                                            {sec.families.map(fam => fam.rows.map((row, i) => renderRow(fam, row, i)))}
                                        </React.Fragment>
                                    ))}
                                    {!shown.length && <tr><td colSpan={7} style={{ ...td, color: theme.inkSoft }}>{onlyGaps ? 'Everything here is in stock or on order.' : 'Nothing matches the search.'}</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default FlowStockTab;
