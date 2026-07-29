/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * CE Convert Build RESTlet -- builds a phosphated /P assembly and sets the bin-tracked raw component's
 * inventory detail. The plain REST record API can't do this (the component sublist is static and not
 * yet populated at create time), but SuiteScript can: it lets NetSuite auto-source the component list
 * from the BOM, then walks it and sets `componentinventorydetail` (the consume-from bin) on each line
 * that requires inventory detail. The WMS Pick&Pack Convert tab POSTs to this via the NetSuite proxy.
 *
 * DEPLOY (NetSuite UI, one time):
 *   1. Documents -> Files -> File Cabinet -> SuiteScripts -> upload this file.
 *   2. Customization -> Scripting -> Scripts -> New -> select the file -> type RESTlet -> Save.
 *        Name: "CE Convert Build". Note the SCRIPT ID (e.g. customscript_ce_convert_build) and the
 *        internal Script id shown in the URL.
 *   3. On the script record -> Deployments -> New: Status = Released, Log Level = Debug (or Error),
 *        Roles = the same integration/TBA role the app's proxy uses. Save. Note the DEPLOY id (e.g. 1).
 *   4. On the deployment, the "External URL" / the script+deploy ids give:
 *        https://<ACCT>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=<SCRIPT_INT_ID>&deploy=<DEPLOY_ID>
 *      Give me those two ids and I'll point the app at it.
 *
 * REQUEST body (JSON): { itemId, quantity, subsidiary, location, bin, toBin, [binId], [statusId], [memo], [diag] }
 *   mode:'unbuild' takes an assembly APART instead: `bin` is where the assemblies come from and
 *   `toBin` is where the returned components are put away (WMS Ring Packs "break apart").
 * RESPONSE: { success:true, id:<recordId>, componentsDetailed:n } | { success:false, error, name }
 */
define(['N/record', 'N/query'], function (record, query) {

    // Resolve the live consume-from bin id + inventory status for a component item at a location. Reads
    // actual on-hand (inventorybalance) so we consume from where the stock really is, with the status it
    // carries -- required because binnumber set by TEXT silently no-ops and Inventory Status is mandatory
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

    // ---- UNBUILD (Stuart 2026-07-28: "at times we run out of stock of the raw item and
    // occasionally need to take apart a 12 pack of BL and turn it into 1 -10 pack and 2 ea back
    // into stock… we also need an option to unbuild and turn to core"). Exact mirror of the build:
    // in a BUILD the header detail RECEIVES the assembly and the component detail CONSUMES parts;
    // in an UNBUILD the header detail CONSUMES the assembly and the component detail RECEIVES the
    // parts. Same pre-existing-line rule on both: clear whatever NetSuite pre-created, then write
    // exactly one assignment, so the totals match and the operator's scanned bins are honoured.
    function unbuild(body) {
        var step = 'init';
        var u = null;
        var diag = [];
        try {
            step = 'create';
            u = record.create({ type: record.Type.ASSEMBLY_UNBUILD, isDynamic: true });

            if (body.subsidiary) {
                step = 'subsidiary';
                try {
                    var curSub = u.getValue({ fieldId: 'subsidiary' });
                    if (String(curSub || '') !== String(body.subsidiary)) {
                        u.setValue({ fieldId: 'subsidiary', value: parseInt(body.subsidiary, 10) });
                    }
                } catch (subErr) { /* read-only/sourced -- `location` drives it */ }
            }
            if (body.location) { step = 'location'; u.setValue({ fieldId: 'location', value: parseInt(body.location, 10) }); }
            step = 'item';
            u.setValue({ fieldId: 'item', value: parseInt(body.itemId, 10) });
            step = 'quantity';
            u.setValue({ fieldId: 'quantity', value: Number(body.quantity) });
            if (body.memo) { step = 'memo'; u.setValue({ fieldId: 'memo', value: String(body.memo).slice(0, 40) }); }

            // HEADER detail = the assembly being TAKEN APART: which bin the packs come out of.
            step = 'assembly-detail';
            var headDiag = { attempted: false };
            try {
                var invH = u.getSubrecord({ fieldId: 'inventorydetail' });
                if (invH) {
                    headDiag.attempted = true;
                    var srcBinId = body.binId ? parseInt(body.binId, 10) : null;
                    var srcStatus = body.statusId ? parseInt(body.statusId, 10) : null;
                    if (!srcBinId || !srcStatus) {
                        var srcResolved = resolveBinStatus(body.itemId, body.location, body.bin, body.binId);
                        if (!srcBinId && srcResolved && srcResolved.binId) srcBinId = parseInt(srcResolved.binId, 10);
                        if (!srcStatus && srcResolved && srcResolved.statusId) srcStatus = parseInt(srcResolved.statusId, 10);
                    }
                    var preH = invH.getLineCount({ sublistId: 'inventoryassignment' });
                    headDiag.preExistingAssignments = preH;
                    for (var kh = preH - 1; kh >= 0; kh--) {
                        try { invH.removeLine({ sublistId: 'inventoryassignment', line: kh }); } catch (rmH) { headDiag.removeError = String(rmH && rmH.message || rmH); }
                    }
                    invH.selectNewLine({ sublistId: 'inventoryassignment' });
                    if (srcBinId) invH.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', value: srcBinId });
                    else if (body.bin) invH.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', text: String(body.bin) });
                    if (srcStatus) invH.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'inventorystatus', value: srcStatus });
                    invH.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', value: Number(body.quantity) });
                    invH.commitLine({ sublistId: 'inventoryassignment' });
                    headDiag.detailed = true; headDiag.binId = srcBinId; headDiag.status = srcStatus;
                }
            } catch (hErr) { headDiag.error = String(hErr && hErr.message || hErr); }
            diag.push({ assemblyDetail: headDiag });

            // COMPONENT detail = the parts coming BACK: which bin they are put away into.
            step = 'components';
            var count = u.getLineCount({ sublistId: 'component' });
            var detailed = 0;
            for (var i = 0; i < count; i++) {
                u.selectLine({ sublistId: 'component', line: i });
                var qLine = Number(u.getCurrentSublistValue({ sublistId: 'component', fieldId: 'quantity' })) || 0;
                var qBom = Number(u.getCurrentSublistValue({ sublistId: 'component', fieldId: 'bomquantity' })) || 0;
                var qtyBack = qLine > 0 ? qLine : (qBom > 0 ? qBom * Number(body.quantity) : Number(body.quantity));
                var lineDiag = { line: i, item: u.getCurrentSublistValue({ sublistId: 'component', fieldId: 'item' }), qLine: qLine, qBom: qBom, qtyUsed: qtyBack, detailed: false };
                if (qtyBack > 0) {
                    try {
                        var invC = u.getCurrentSublistSubrecord({ sublistId: 'component', fieldId: 'componentinventorydetail' });
                        var toBinId = body.toBinId ? parseInt(body.toBinId, 10) : null;
                        if (!toBinId && body.toBin) {
                            var rb2 = query.runSuiteQL({
                                query: 'SELECT id FROM bin WHERE UPPER(binnumber) = ? AND location = ?',
                                params: [String(body.toBin).toUpperCase(), parseInt(body.location, 10)]
                            }).asMappedResults();
                            if (rb2 && rb2.length) toBinId = parseInt(rb2[0].id, 10);
                        }
                        var preC = invC.getLineCount({ sublistId: 'inventoryassignment' });
                        lineDiag.preExistingAssignments = preC;
                        for (var kc = preC - 1; kc >= 0; kc--) {
                            try { invC.removeLine({ sublistId: 'inventoryassignment', line: kc }); } catch (rmC) { lineDiag.removeError = String(rmC && rmC.message || rmC); }
                        }
                        invC.selectNewLine({ sublistId: 'inventoryassignment' });
                        if (toBinId) invC.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', value: toBinId });
                        else if (body.toBin) invC.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', text: String(body.toBin) });
                        invC.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'inventorystatus', value: body.toStatusId ? parseInt(body.toStatusId, 10) : 1 });
                        invC.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', value: qtyBack });
                        invC.commitLine({ sublistId: 'inventoryassignment' });
                        u.commitLine({ sublistId: 'component' });
                        detailed++; lineDiag.detailed = true; lineDiag.toBinId = toBinId;
                    } catch (cErr) { lineDiag.error = String(cErr && cErr.message || cErr); }
                }
                diag.push(lineDiag);
            }

            if (body.diag) return { success: true, diagOnly: true, mode: 'unbuild', componentCount: count, componentsDetailed: detailed, diag: diag };
            step = 'save';
            var uid = u.save({ enableSourcing: true, ignoreMandatoryFields: false });
            return { success: true, mode: 'unbuild', id: uid, componentsDetailed: detailed, diag: diag };
        } catch (e) {
            var uctx = {};
            try { if (u) { uctx.subsidiary = u.getValue({ fieldId: 'subsidiary' }); uctx.location = u.getValue({ fieldId: 'location' }); uctx.item = u.getValue({ fieldId: 'item' }); } } catch (ctxErr) { /* best-effort */ }
            return { success: false, mode: 'unbuild', step: step, error: (e && e.message) ? e.message : String(e), name: (e && e.name) || '', context: uctx, diag: diag };
        }
    }

    function post(body) {
        // One RESTlet, two operations — the app picks with body.mode.
        if (body && String(body.mode || '').toLowerCase() === 'unbuild') return unbuild(body);
        var step = 'init';
        var b = null;
        var diag = [];
        try {
            step = 'create';
            b = record.create({ type: record.Type.ASSEMBLY_BUILD, isDynamic: true });

            // Establish the SUBSIDIARY/LOCATION context BEFORE `item`. If `item` is set first, NetSuite
            // validates the assembly against the token role's DEFAULT subsidiary and rejects a valid
            // assembly with "Invalid Field Value <id> for the following field: item".
            // Order = subsidiary -> location -> item, which is correct for both NetSuite wirings:
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
                } catch (subErr) { /* read-only/sourced -- `location` below will drive the context */ }
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
            // line is touched -- either made the old code skip line 1, so the raw had no inventory detail and
            // NetSuite rejected the save ("configure the inventory detail in line 1"). So instead we ATTEMPT
            // to configure detail on every qty-bearing line and tolerate lines that don't support it (the
            // Phosphating charge line throws on getCurrentSublistSubrecord -> caught -> skipped).
            step = 'components';
            var count = b.getLineCount({ sublistId: 'component' });
            var detailed = 0;
            for (var i = 0; i < count; i++) {
                b.selectLine({ sublistId: 'component', line: i });
                var reqd = b.getCurrentSublistValue({ sublistId: 'component', fieldId: 'inventorydetailreq' });
                var needs = (reqd === true || reqd === 'T' || reqd === 1 || reqd === '1');
                // Robust quantity: prefer the line quantity, else bomquantity x build qty, else build qty.
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
                        // CLEAR ANY EXISTING ASSIGNMENT LINES FIRST (Stuart 2026-07-28: "The total
                        // inventory detail quantity must be 10"). Once the component actually HAS
                        // stock, NetSuite pre-populates the inventory detail itself; appending our
                        // line then doubles the total against the line qty and the commit is
                        // rejected. (While the component had zero on hand nothing was pre-created,
                        // which is why this only appeared after the each was stocked.) Removing
                        // them also guarantees the consume bin is the one the OPERATOR SCANNED
                        // rather than whichever bin NetSuite happened to pick.
                        var preLines = inv.getLineCount({ sublistId: 'inventoryassignment' });
                        lineDiag.preExistingAssignments = preLines;
                        for (var k = preLines - 1; k >= 0; k--) {
                            try { inv.removeLine({ sublistId: 'inventoryassignment', line: k }); } catch (rmErr) { lineDiag.removeError = String(rmErr && rmErr.message || rmErr); }
                        }
                        inv.selectNewLine({ sublistId: 'inventoryassignment' });
                        if (useBinId) inv.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', value: useBinId });
                        else if (body.bin) inv.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', text: String(body.bin) });
                        if (useStatus) inv.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'inventorystatus', value: useStatus });
                        inv.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', value: qtyNeeded });
                        inv.commitLine({ sublistId: 'inventoryassignment' });
                        // Read the total back: if it ever disagrees with the line qty again, the diag
                        // says so outright instead of surfacing NetSuite's bare message.
                        try {
                            var tot = 0, n2 = inv.getLineCount({ sublistId: 'inventoryassignment' });
                            for (var m = 0; m < n2; m++) {
                                tot += Number(inv.getSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', line: m })) || 0;
                            }
                            lineDiag.detailTotal = tot;
                            lineDiag.detailLines = n2;
                        } catch (totErr) { /* best-effort */ }
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

            // RECEIVE side: a bin-tracked (or status-tracked) BUILT assembly needs a HEADER inventory detail
            // saying which bin + status to put the finished units INTO -- driven by the operator's put-away
            // bin (body.toBin). This is separate from the component consume detail above. Attempted in
            // try/catch: if the assembly needs no detail the subrecord is absent or throws -> skipped.
            step = 'built-detail';
            var builtDiag = { attempted: false };
            try {
                var invB = b.getSubrecord({ fieldId: 'inventorydetail' });
                if (invB) {
                    builtDiag.attempted = true;
                    var toBinId = body.toBinId ? parseInt(body.toBinId, 10) : null;
                    if (!toBinId && body.toBin) {
                        var rb = query.runSuiteQL({
                            query: 'SELECT id FROM bin WHERE UPPER(binnumber) = ? AND location = ?',
                            params: [String(body.toBin).toUpperCase(), parseInt(body.location, 10)]
                        }).asMappedResults();
                        if (rb && rb.length) toBinId = parseInt(rb[0].id, 10);
                    }
                    var recvStatus = body.toStatusId ? parseInt(body.toStatusId, 10) : (body.statusId ? parseInt(body.statusId, 10) : 1);
                    // Same rule as the consume side: clear anything NetSuite pre-created so the
                    // received total matches the build qty and lands in the operator's put-away bin.
                    var preB = invB.getLineCount({ sublistId: 'inventoryassignment' });
                    builtDiag.preExistingAssignments = preB;
                    for (var kb = preB - 1; kb >= 0; kb--) {
                        try { invB.removeLine({ sublistId: 'inventoryassignment', line: kb }); } catch (rmB) { builtDiag.removeError = String(rmB && rmB.message || rmB); }
                    }
                    invB.selectNewLine({ sublistId: 'inventoryassignment' });
                    if (toBinId) invB.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'binnumber', value: toBinId });
                    invB.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'inventorystatus', value: recvStatus });
                    invB.setCurrentSublistValue({ sublistId: 'inventoryassignment', fieldId: 'quantity', value: Number(body.quantity) });
                    invB.commitLine({ sublistId: 'inventoryassignment' });
                    builtDiag.detailed = true; builtDiag.toBin = body.toBin || null; builtDiag.toBinId = toBinId; builtDiag.recvStatus = recvStatus;
                }
            } catch (bErr) {
                builtDiag.error = (bErr && bErr.message) ? bErr.message : String(bErr);
            }
            diag.push({ builtDetail: builtDiag });

            // Diagnostic mode: return the sourced component structure WITHOUT saving (no build created).
            if (body.diag) return { success: true, diagOnly: true, componentCount: count, componentsDetailed: detailed, builtDetail: builtDiag, diag: diag };

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
            } catch (ctxErr) { /* ignore -- best-effort diagnostics */ }
            return { success: false, step: step, error: (e && e.message) ? e.message : String(e), name: (e && e.name) || '', context: ctx, diag: diag };
        }
    }

    return { post: post };
});
