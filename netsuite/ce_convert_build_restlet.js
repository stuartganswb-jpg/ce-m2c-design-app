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
define(['N/record', 'N/query'], function (record, query) {

    // Resolve the live consume-from bin id + inventory status for a component item at a location. Reads
    // actual on-hand (inventorybalance) so we consume from where the stock really is, with the status it
    // carries — required because binnumber set by TEXT silently no-ops and Inventory Status is mandatory
    // here. Prefers the requested cart bin (by id hint or by binnumber text), else the bin with the most.
    function resolveBinStatus(itemId, locationId, binText, binIdHint) {
        try {
            var rows = query.runSuiteQL({
                query: 'SELECT binnumber, inventorystatus, quantityonhand FROM inventorybalance WHERE item = ? AND location = ? AND quantityonhand > 0',
                params: [parseInt(itemId, 10), parseInt(locationId, 10)]
            }).asMappedResults();
            if (!rows || !rows.length) return null;
            var chosen = null, i;
            if (binIdHint) { for (i = 0; i < rows.length; i++) { if (String(rows[i].binnumber) === String(binIdHint)) { chosen = rows[i]; break; } } }
            if (!chosen && binText) {
                var brows = query.runSuiteQL({
                    query: 'SELECT id FROM bin WHERE UPPER(binnumber) = ? AND location = ?',
                    params: [String(binText).toUpperCase(), parseInt(locationId, 10)]
                }).asMappedResults();
                if (brows && brows.length) { var bid = String(brows[0].id); for (i = 0; i < rows.length; i++) { if (String(rows[i].binnumber) === bid) { chosen = rows[i]; break; } } }
            }
            if (!chosen) { chosen = rows[0]; for (i = 1; i < rows.length; i++) { if (Number(rows[i].quantityonhand) > Number(chosen.quantityonhand)) chosen = rows[i]; } }
            return { binId: chosen.binnumber, statusId: chosen.inventorystatus, onhand: Number(chosen.quantityonhand) };
        } catch (qErr) { return null; }
    }

    function post(body) {
        var step = 'init';
        var b = null;
        var diag = [];
        try {
            step = 'create';
            b = record.create({ type: record.Type.ASSEMBLY_BUILD, isDynamic: true });

            // Establish the SUBSIDIARY/LOCATION context BEFORE `item`. If `item` is set first, NetSuite
            // validates the assembly against the token role's DEFAULT subsidiary and rejects a valid
            // assembly with "Invalid Field Value <id> for the following field: item".
            // Order = subsidiary → location → item, which is correct for both NetSuite wirings:
            //  - subsidiary editable & filters location: setting it first makes location + item valid.
            //  - subsidiary sourced from location (read-only): the set is caught/skipped and `location`
            //    then drives the subsidiary to the target. Either way the context is right before `item`.
            if (body.subsidiary) {
                step = 'subsidiary';
                try {
                    var curSub = b.getValue({ fieldId: 'subsidiary' });
                    if (String(curSub || '') !== String(body.subsidiary)) {
                        b.setValue({ fieldId: 'subsidiary', value: parseInt(body.subsidiary, 10) });
                    }
                } catch (subErr) { /* read-only/sourced — `location` below will drive the context */ }
            }
            if (body.location) { step = 'location'; b.setValue({ fieldId: 'location', value: parseInt(body.location, 10) }); }

            step = 'item';
            b.setValue({ fieldId: 'item', value: parseInt(body.itemId, 10) });
            step = 'quantity';
            b.setValue({ fieldId: 'quantity', value: Number(body.quantity) });
            if (body.memo) { step = 'memo'; b.setValue({ fieldId: 'memo', value: String(body.memo).slice(0, 40) }); }

            // Component list auto-sources from the BOM once item + quantity are set. Set the consume-from
            // bin on every bin/lot-tracked component (the raw). The `inventorydetailreq` flag is UNRELIABLE
            // in dynamic mode right after sourcing, and the per-line `quantity` field can read 0 before the
            // line is touched — either made the old code skip line 1, so the raw had no inventory detail and
            // NetSuite rejected the save ("configure the inventory detail in line 1"). So instead we ATTEMPT
            // to configure detail on every qty-bearing line and tolerate lines that don't support it (the
            // Phosphating charge line throws on getCurrentSublistSubrecord → caught → skipped).
            step = 'components';
            var count = b.getLineCount({ sublistId: 'component' });
            var detailed = 0;
            for (var i = 0; i < count; i++) {
                b.selectLine({ sublistId: 'component', line: i });
                var reqd = b.getCurrentSublistValue({ sublistId: 'component', fieldId: 'inventorydetailreq' });
                var needs = (reqd === true || reqd === 'T' || reqd === 1 || reqd === '1');
                // Robust quantity: prefer the line quantity, else bomquantity × build qty, else build qty.
                var qLine = Number(b.getCurrentSublistValue({ sublistId: 'component', fieldId: 'quantity' })) || 0;
                var qBom = Number(b.getCurrentSublistValue({ sublistId: 'component', fieldId: 'bomquantity' })) || 0;
                var qtyNeeded = qLine > 0 ? qLine : (qBom > 0 ? qBom * Number(body.quantity) : Number(body.quantity));
                var lineDiag = { line: i, item: b.getCurrentSublistValue({ sublistId: 'component', fieldId: 'item' }), reqd: reqd, qLine: qLine, qBom: qBom, qtyUsed: qtyNeeded, detailed: false };

                if (qtyNeeded > 0) {
                    // Resolve the real bin id + status from live on-hand for THIS component item (prefer the
                    // requested cart bin). binId/statusId from the request win if supplied.
                    var lineItem = b.getCurrentSublistValue({ sublistId: 'component', fieldId: 'item' });
                    var src = resolveBinStatus(lineItem, body.location, body.bin, body.binId);
                    var useBinId = body.binId ? parseInt(body.binId, 10) : (src && src.binId ? parseInt(src.binId, 10) : null);
                    var useStatus = body.statusId ? parseInt(body.statusId, 10) : (src && src.statusId ? parseInt(src.statusId, 10) : null);
                    lineDiag.useBinId = useBinId; lineDiag.useStatus = useStatus; lineDiag.srcOnhand = src ? src.onhand : null;
                    try {
                        var inv = b.getCurrentSublistSubrecord({ sublistId: 'component', fieldId: 'componentinventorydetail' });
                        inv.selectNewLine({ sublistId: 'inventoryassignment' });
                        if (useBinId) inv.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', value: useBinId });
                        else if (body.bin) inv.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', text: String(body.bin) });
                        if (useStatus) inv.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'inventorystatus', value: useStatus });
                        inv.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', value: qtyNeeded });
                        inv.commitLine({ sublistId: 'inventoryassignment' });
                        b.commitLine({ sublistId: 'component' });
                        detailed++;
                        lineDiag.detailed = true;
                    } catch (lineErr) {
                        // A line that genuinely requires detail must not be silently swallowed.
                        lineDiag.error = (lineErr && lineErr.message) ? lineErr.message : String(lineErr);
                        if (needs) { diag.push(lineDiag); throw lineErr; }
                    }
                }
                diag.push(lineDiag);
            }

            // Diagnostic mode: return the sourced component structure WITHOUT saving (no build created).
            if (body.diag) return { success: true, diagOnly: true, componentCount: count, componentsDetailed: detailed, diag: diag };

            step = 'save';
            var id = b.save({ enableSourcing: true, ignoreMandatoryFields: false });
            return { success: true, id: id, componentsDetailed: detailed, diag: diag };
        } catch (e) {
            // Capture the record's context at the point of failure so a bad subsidiary/location/item is
            // obvious from the app's error alert without needing the NetSuite Execution Log.
            var ctx = {};
            try {
                if (b) {
                    ctx.subsidiary = b.getValue({ fieldId: 'subsidiary' });
                    ctx.location = b.getValue({ fieldId: 'location' });
                    ctx.item = b.getValue({ fieldId: 'item' });
                }
            } catch (ctxErr) { /* ignore — best-effort diagnostics */ }
            return { success: false, step: step, error: (e && e.message) ? e.message : String(e), name: (e && e.name) || '', context: ctx, diag: diag };
        }
    }

    return { post: post };
});
