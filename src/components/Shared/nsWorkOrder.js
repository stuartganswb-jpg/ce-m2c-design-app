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
