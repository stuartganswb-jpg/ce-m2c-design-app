/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * CE Convert Build RESTlet — builds a phosphated /P assembly and sets the bin-tracked raw component's
 * inventory detail. The plain REST record API can't do this (the component sublist is static and not
 * yet populated at create time), but SuiteScript can: it lets NetSuite auto-source the component list
 * from the BOM, then walks it and sets `componentinventorydetail` (the consume-from bin) on each line
 * that requires inventory detail. The WMS Pick&Pack Convert tab POSTs to this via the NetSuite proxy.
 *
 * DEPLOY (NetSuite UI, one time):
 *   1. Documents → Files → File Cabinet → SuiteScripts → upload this file.
 *   2. Customization → Scripting → Scripts → New → select the file → type RESTlet → Save.
 *        Name: "CE Convert Build". Note the SCRIPT ID (e.g. customscript_ce_convert_build) and the
 *        internal Script id shown in the URL.
 *   3. On the script record → Deployments → New: Status = Released, Log Level = Debug (or Error),
 *        Roles = the same integration/TBA role the app's proxy uses. Save. Note the DEPLOY id (e.g. 1).
 *   4. On the deployment, the "External URL" / the script+deploy ids give:
 *        https://<ACCT>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=<SCRIPT_INT_ID>&deploy=<DEPLOY_ID>
 *      Give me those two ids and I'll point the app at it.
 *
 * REQUEST body (JSON): { itemId, quantity, subsidiary, location, bin, [binId], [statusId], [memo] }
 * RESPONSE: { success:true, id:<buildId>, componentsDetailed:n } | { success:false, error, name }
 */
define(['N/record'], function (record) {

    function post(body) {
        try {
            var b = record.create({ type: record.Type.ASSEMBLY_BUILD, isDynamic: true });
            b.setValue({ fieldId: 'item', value: parseInt(body.itemId, 10) });
            if (body.subsidiary) b.setValue({ fieldId: 'subsidiary', value: parseInt(body.subsidiary, 10) });
            if (body.location) b.setValue({ fieldId: 'location', value: parseInt(body.location, 10) });
            b.setValue({ fieldId: 'quantity', value: Number(body.quantity) });
            if (body.memo) b.setValue({ fieldId: 'memo', value: String(body.memo).slice(0, 40) });

            // Component list auto-sources from the BOM once item + quantity are set. Set the bin on every
            // line that requires inventory detail (the bin-tracked raw); charge/service lines are skipped.
            var count = b.getLineCount({ sublistId: 'component' });
            var detailed = 0;
            for (var i = 0; i < count; i++) {
                b.selectLine({ sublistId: 'component', line: i });
                var reqd = b.getCurrentSublistValue({ sublistId: 'component', fieldId: 'inventorydetailreq' });
                var needs = (reqd === true || reqd === 'T' || reqd === 1 || reqd === '1');
                if (!needs) continue;
                var qtyNeeded = Number(b.getCurrentSublistValue({ sublistId: 'component', fieldId: 'quantity' })) || 0;
                if (qtyNeeded <= 0) continue;

                var inv = b.getCurrentSublistSubrecord({ sublistId: 'component', fieldId: 'componentinventorydetail' });
                inv.selectNewLine({ sublistId: 'inventoryassignment' });
                if (body.binId) inv.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', value: parseInt(body.binId, 10) });
                else if (body.bin) inv.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', text: String(body.bin) });
                if (body.statusId) inv.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'inventorystatus', value: parseInt(body.statusId, 10) });
                inv.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', value: qtyNeeded });
                inv.commitLine({ sublistId: 'inventoryassignment' });
                b.commitLine({ sublistId: 'component' });
                detailed++;
            }

            var id = b.save({ enableSourcing: true, ignoreMandatoryFields: false });
            return { success: true, id: id, componentsDetailed: detailed };
        } catch (e) {
            return { success: false, error: (e && e.message) ? e.message : String(e), name: (e && e.name) || '' };
        }
    }

    return { post: post };
});
