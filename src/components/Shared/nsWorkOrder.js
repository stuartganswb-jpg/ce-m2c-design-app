// ONE NetSuite work-order queuer (Stuart 2026-08-29: "nothing should go to the floor until the
// NetSuite work orders are obtained" — every produce decision opens the NS record FIRST and the
// floor paper carries its number). Extracted from RTG's proven queueNsStockWorkOrder payload
// shape: `assemblyItem` (never `item` — FIELD_PARAM_REQD, learned 2026-07-17), location +
// subsidiary from the brand map, staged through ns_outbox so it survives the concurrency limit.
//
// The caller owns the STOP mechanism (one NS WO per app doc, ever) and passes writeBacks naming
// where the id/tran stamp back. Memo carries the sales link and finish per Stuart's rule — the
// NetSuite record itself should read "SO … · RF2 (Bronze)".

import { enqueueNsWrite } from './nsOutbox';
import { BRAND_NETSUITE_MAP } from './brandNetsuite';

// Which item does a CONVERT demand's NetSuite work order go on? Decided 2026-08-31 (the "both"
// model): the /P (target) wins when NetSuite knows it as an assembly, because the convert build
// posts createdfrom it and NetSuite closes it — a complete loop. The ROOT is only the fallback
// vehicle here; the root's OWN work order is opened separately alongside the milling shop WO
// (see executeMakeupActions) and closed by posting the mill build from RTG. Neither an
// assembly → null, caller says so out loud.
export const isNsAssemblyRec = (r) => !!(r && r.netSuiteInternalId &&
    (r.partClass === 'Assembly' || r.partClass === 'Master Assembly' || String(r.netSuiteRecordType || '').toLowerCase() === 'assemblyitem'));
export const pickNsWoItem = ({ base, target, baseErp = '', targetErp = '' }) => {
    if (isNsAssemblyRec(target)) return { erp: targetErp || target.legacyErpId || '', internalId: String(target.netSuiteInternalId), side: 'target' };
    if (isNsAssemblyRec(base)) return { erp: baseErp || base.legacyErpId || '', internalId: String(base.netSuiteInternalId), side: 'base' };
    return null;
};

// Post an assembly build via the CE Convert RESTlet (script 2848 — same vehicle the WMS /P
// convert uses). With workOrderId it transforms the WO into the build (createdfrom → NetSuite
// closes the WO itself); the RESTlet verifies the WO's item matches and refuses a mismatch.
const NS_RESTLET_URL = 'https://3728153.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=2848&deploy=1';
export const postNsAssemblyBuild = async ({ nsProxyFetch, brandId, internalId, qty, bin = '', toBin = '', memo = '', workOrderId = '' }) => {
    const nsConfig = BRAND_NETSUITE_MAP[String(brandId || '').toLowerCase()] || {};
    if (!nsConfig.location) throw new Error(`brand "${brandId}" has no NetSuite location mapping.`);
    const r = await nsProxyFetch({ targetUrl: NS_RESTLET_URL, method: 'POST', payload: { itemId: String(internalId), quantity: Number(qty) || 1, subsidiary: nsConfig.subsidiary, location: nsConfig.location, bin, toBin, memo, ...(workOrderId ? { workOrderId: String(workOrderId) } : {}) } });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || b.success === false || b.error) throw new Error(b.error || b.message || `RESTlet HTTP ${r.status}`);
    return b;
};

export const queueNsAssemblyWorkOrder = async ({
    brandId, assemblyInternalId, erp = '', qty, reqDate = '', memo = '',
    writeBacks = [], sourceApp = 'APP', createdBy = '',
}) => {
    const nsConfig = BRAND_NETSUITE_MAP[String(brandId || '').toLowerCase()] || {};
    if (!assemblyInternalId) throw new Error(`${erp || 'item'}: no NetSuite internal id — sync it (11.1) before opening a work order.`);
    if (!nsConfig.location) throw new Error(`brand "${brandId}" has no NetSuite location mapping.`);
    return enqueueNsWrite({
        kind: 'workorder',
        label: `NS WO — build ${erp || assemblyInternalId} ×${qty}`,
        sourceApp, createdBy,
        targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/workorder',
        method: 'POST',
        payload: {
            assemblyItem: { id: String(assemblyInternalId) },
            quantity: Number(qty) || 1,
            location: { id: nsConfig.location },
            subsidiary: { id: nsConfig.subsidiary },
            ...(reqDate ? { endDate: reqDate } : {}),
            memo,
        },
        writeBack: writeBacks,
    });
};
