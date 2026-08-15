// NetSuite item field mapping — generated from Eric's field sheet.
//
// SOURCE: Items_NS/"Copy of New Inventory or Assembly Item Fields.xlsx" (Eric, 2026-08-15). That
// workbook documents the 31 fields NetSuite wants on a new Inventory or Assembly item, plus the
// internal-id lists behind every droplist. Inventory and Assembly take the SAME fields except two:
// the custom form, and the description field (`salesdescription` vs `description`).
//
// WHY THIS FILE EXISTS: the app stores droplist values as DISPLAY NAMES (the item sync reads them
// through BUILTIN.DF), but the REST record API writes them as INTERNAL IDS. Without the lists
// below, every one of these fields had to be left off anything the app created in NetSuite.
//
// TO REGENERATE after Eric updates the workbook, re-read its list tabs (NS ID | Name) and rewrite
// the maps below. An unresolved name is SKIPPED, never guessed — a wrong internal id would file the
// item under the wrong collection or class silently.

export const NS_CLASS = {
    "Accessory": "1", "Hardware": "2", "Lighting": "3", "Curtain": "4", "Sample Kit": "5",
    "Sample Books": "6", "Trim": "7", "Accessories": "8", "Bracelets": "9", "Earrings": "10",
    "Handbags": "11", "Necklaces": "12", "Cornices": "13", "Component": "14", "M2C SAMPLES": "15",
    "Sewing Service": "16", "Throw/Pillow": "17", "Paint / Stain": "21", "Fabric": "22",
};

export const NS_COST_CATEGORY = {
    "Default Cost Category": "1", "Machine": "2", "Default": "4", "Other Charge": "5", "Raw Material": "6",
    "Labor": "7", "Labor Run": "8", "Labor Run overhead": "9", "Labor Setup": "10",
    "Labor Setup Overhead": "11", "MR: Machine Time": "12", "Labor Advanced": "14", "Outsource Service": "15",
    "Customs/Duty/Tariff": "16", "Miscellaneous": "18", "Raw Material - Wood / MDF": "19",
    "Shipping/Freight Charges": "20", "Taxes": "21", "Import Fees": "22", "Raw Material - Steel": "23",
    "Tooling": "24",
};

export const NS_PRODUCT_TYPE = {
    "Bracket": "1", "Ring": "2", "Wood Rod": "3", "Finial": "4", "Holdback": "5", "Steel Rod": "6",
    "Chandelier": "7", "Sconce": "8", "Tieback": "9", "Tassel": "10", "Frame": "11", "Wood Disc": "12",
    "Metal Frame": "13", "Rod": "14", "Eclipse": "15", "Fringe": "16", "Wrapped Mold": "17",
    "Drapery Panel": "18", "Accessory": "19", "Applique": "20", "Book": "21", "Braid": "22",
    "Brush Fringe": "23", "Chairtie": "24", "End Cap": "25", "Hardware Display": "26", "Hardware": "27",
    "Key Tassel": "29", "Leyla Gans": "30", "Lipcord": "31", "Looped Fringe": "32", "Memo Card": "33",
    "Nail Head": "34", "Novelty": "35", "Onion Fringe": "36", "Paint": "37", "Pleated Tape": "38",
    "Rosette": "39", "Skirt Fringe": "40", "Tape": "41", "Tassel Fringe": "42", "Traverse": "43",
    "Traverse Component": "44", "Bracketket": "120", "Hardware Kit": "121", "Jewelry": "122",
    "End Return": "123", "Throw": "124", "Pillow": "125", "Fabric": "127", "Insert": "128", "Napkin": "129",
    "Zipper": "130", "Mould": "131", "Component": "132", "Beads": "133", "Brush": "134", "Table Cloth": "135",
    "Placemat": "136", "Caterpillar": "137", "Cornice": "138", "Woven Fabric Disc": "139",
    "Pendant Light": "140", "Pouf": "141", "Raw Material": "142", "Unfinished Part": "143",
    "CPQ Finish": "144", "Bullion Fringe": "145", "Picot Braid": "146", "Swatch": "147", "Sample Chip": "148",
    "Curtain": "149", "Backplate": "150", "French Return": "151", "Miter Return": "152", "Fastener": "153",
    "Semi-Sheen Lipcord": "154", "Basket Tape": "155", "Vergo Tape": "156", "Scalloped Braid": "157",
    "Looped Piping": "158", "Velvet Lipcord": "159", "Pole": "160", "Fee": "161", "Finial Top": "162",
    "Finial Collar": "163", "Bracket Base": "164", "Bracket Stem": "165", "Bracket Head": "166",
};

export const NS_WATCHLIST = {
    "Fabricut Hdw": "1", "Haverty": "2", "Kravet Hdw": "3", "JF Older": "4", "Core": "5", "Brimar": "6",
    "Read": "7", "JF Hdw": "8", "TSS": "9", "Trend Hardware": "10", "Color Coordinate": "11",
    "Carole EA": "12", "Huntington": "13", "Bernhardt": "14", "Calico Corners": "15", "Eastern Accents": "16",
    "Award": "17", "Carole": "18", "Award Carole Taylor King": "19", "Carole Vanguard": "20",
    "Award Carole": "21", "Calico Cutting Corners": "22", "Calico JCP EA": "23", "Vanguard": "24",
    "Cutting Corners Vanguard": "25", "Color Coordinates": "26", "Fabricut Calico": "27",
    "Fabricut Joanne": "28", "Calico EA JCP": "29", "Calico Joanne": "30", "Joanne Fabrics": "31",
    "Cutting Corners": "32", "Color Cordinate Carole EA": "33", "Lee": "34",
    "Bernhardt Cutting Corners": "35", "Calico Corners Huntington": "36", "Cutting Corners Huntington": "37",
    "Calico Cutting Corners Huntington": "38", "Outdura Corp": "39", "Fabricut Cutting Corners": "40",
    "Fabricut": "41", "Taylor King Exclusive": "42", "Romo Trim": "45", "Sunbrella": "46", "TQS": "47",
    "JayCo": "48", "Bloom & Lattice": "49", "Link Outdoor Exclusive": "51", "Schumacher Exclusive": "52",
    "Airtex Exclusive": "53", "Holly Hunt Exclusive": "54", "Fabricut Exclusive": "55",
    "Romo Exclusive": "56", "Raw Materials": "57", "Unfinished Parts": "58", "Gabriella White": "59",
    "Fabricut / Gabriella White": "60", "Finishing Touch II": "61", "Uniq Throws": "62", "Uniq Fabric": "63",
    "White Stock": "64", "3/4\" Round": "66", "3/4\" Square": "67", "1\" Round": "68", "1-3/8\" Round": "69",
    "2\" Rectangular": "70", "M2C Wood - Finished": "71", "2\" Traverse": "72", "1-3/8\" Traverse": "73",
    "M2C High Line": "74", "M2C Flat Iron": "75", "James HZ Parts": "76", "Ficalora Item/Service": "77",
    "M2C Flat Iron Traverse": "78", "M2C Wood - Raw": "79", "Grand Brass Parts": "80", "McMaster Parts": "81",
    "Bodker Glasswork": "82", "Tooling": "83", "TQS Traverse": "84", "Kravet Exclusive": "85",
    "Holland & Sherry": "86", "Fig & Dove Exclusive": "87", "Open Line Trim - Active": "88",
    "Open Line Trim - Phase Out / MOQ": "89", "1\" Brass": "90", "1/2\" Cafe": "91", "Wesley Hall": "92",
    "Revelation/Uttermost": "93", "Fasteners": "94",
};

export const NS_FINISH_DETAIL = {
    "1": "1", "BB": "3", "BL": "4", "BLT": "5", "BR": "6", "BS": "7", "BW": "8", "CP": "9", "CPG": "10",
    "CPM": "11", "CUS": "12", "CW16": "13", "CW17": "14", "CW18": "15", "CW19": "16", "CW26": "17",
    "CW27": "18", "CW28": "19", "CW29": "20", "CW30": "21", "CW31": "22", "CW32": "23", "CW33": "24",
    "G": "25", "GB": "26", "GL1": "27", "HC": "28", "HG": "29", "N11": "30", "N15": "31", "N19": "32",
    "N20": "33", "N24": "34", "N24T": "35", "N25": "36", "N33": "37", "N34": "38", "N34T": "39", "N39": "40",
    "N4": "41", "N47": "42", "N66": "43", "N66T": "44", "N67": "45", "N7": "46", "N80": "47", "N80T": "48",
    "N90": "49", "PG": "50", "RG": "51", "SL1": "52", "W1": "53", "W11": "54", "W12": "55", "W13": "56",
    "W14": "57", "W15": "58", "W16": "59", "W2": "60", "W25": "61", "W26": "62", "W27": "63", "W29": "64",
    "W3": "65", "W30": "66", "W31": "67", "W32": "68", "W4": "69", "W5": "70", "W6": "71", "W7": "72",
    "WA": "73", "AW": "74", "Brass Wash": "75", "Bronze Patina": "76", "Gunmetal": "77", "Ember": "78",
    "Aged Steel": "79", "SG": "80", "MC": "81", "PT": "82", "B5": "83", "RW02": "84", "RW06": "85",
    "RW08": "86", "A10": "87", "B3": "88", "B4": "89", "2": "90", "B1": "91", "GOP": "92", "GL5": "93",
    "RF1 - Satin Nickel": "94", "T2": "95", "3": "96", "4": "97", "5": "98", "M1": "99", "M2": "100",
    "M3": "101", "M4": "102", "M6": "103", "UNF": "104", "P - Phosphated": "105", "EP1 - Satin Nickel": "106",
    "EP2 - Polished Nickel": "107", "EP3 - Satin Brass": "108", "EP4 - Satin Gold": "109",
    "EP5 - Aged Brass": "110", "EP6 - Oil Rubbed Bronze": "111", "P25 - Satin Steel": "112",
    "Mill Finish": "113", "T1": "114", "DTM Champagne": "115", "DTM Bronze": "116", "S01 - White Oak": "117",
    "S11 - Pure Oak": "118", "S03 - Blonde Oak": "119", "S04 - Natural Oak": "120",
    "S05 - Weathered Oak": "121", "S02 - Ash Oak": "122", "S08 - Aged Oak": "123", "S12 - Pure Walnut": "124",
    "S07 - Natural Walnut": "125", "S06 - Slate Oak": "126", "S09 - Espresso Walnut": "127",
    "S10 - Black Oak": "128", "P01 - White": "129", "P02 - Oyster": "130", "P03 - Champagne Pearl": "131",
    "P04 - Luxe Gold": "132", "P05 - Bright Gold": "133", "P06 - Gild Gold": "134", "P07 - Gold Brass": "135",
    "P08 - Antique Gold": "136", "P09 - Antique Brass": "137", "P13 - Golden Bronze": "138",
    "P10 - Copper": "139", "P11 - Champagne": "140", "P14 - Aged Champagne": "141",
    "P16 - Warm Bronze": "142", "P17 - Dark Bronze": "143", "P15 - Brushed Bronze": "144",
    "P19 - Blackened Bronze": "145", "P20 - Black": "146", "P22 - Gunmetal Iron": "147",
    "P23 - Brushed Iron": "148", "P24 - Brushed Steel": "149", "P26 - Warm Pewter": "150",
    "P27 - Pewter": "151", "P29 - Warm Nickel": "152", "P30 - Silver": "153", "SM-01 Natural": "154",
    "SM-02 Blonde": "155", "SM-03 Almond Drift": "156", "SM-04 Shroom": "157", "SM-05 Grey Wash Oak": "158",
    "SM-06 White Wash": "159", "SM-07 Ebony": "160", "SM-08 Natural": "161", "SM-09 Coffee": "162",
    "SM-10 Black": "163", "EP4 - Aged Brass (M2C)": "164", "EP7 - Aged Steel (M2C)": "165",
    "EP9 - Graphite": "166", "EP9 - Graphite (M2C)": "167", "EP11 - Bronze Patina (M2C)": "168",
    "EP1 - Satin Nickel (M2C)": "169", "Acrylic": "170", "B2": "173", "OB": "174", "AN": "175",
    "Brushed - Lacquered": "176", "Brushed - Unlacquered": "177", "Polished - Lacquered": "178",
    "Polished - Unlacquered": "179", "SS - Satin Silver": "180", "WS - Warm Silver": "181",
    "CG - Champagne Gold": "182", "PG - Pure Gold": "183", "WB - Warm Brass": "184",
    "GB - Golden Bronze": "185", "OB - Oxidized Bronze": "186", "MB - Matte Black": "187",
    "EP - Plated": "188", "RF2 - Bronze": "189",
};

export const NS_COLLECTION = {
    "Flat Iron": "1", "Square": "2", "Boujee": "3", "Dawn Chandelier": "4", "Eclipse": "6", "Ella": "7",
    "Sol Mio": "8", "Pretty Square": "9", "Curtain": "10", "Accents": "11", "Art Deco": "12",
    "Basic Instincts": "13", "Bead Works": "14", "Brimar": "15", "Button Down": "16", "Cascades": "17",
    "Casual Knots": "18", "Celerie Kemble": "19", "Coastal Living": "20", "Color Coordinates": "21",
    "Color Revival": "22", "Color Story": "23", "Contemporary Classics": "24", "Contour": "25",
    "Curtains Up": "26", "Decadence": "27", "Delicate Touch": "28", "Design Basics": "29",
    "Distressed Wood": "30", "Elegant Knots": "31", "Endless Knots": "32", "Essentials": "33",
    "Fabricut": "34", "Fabricut Vern Yip": "35", "Finishing Touch I / II": "36", "Flamenco": "37",
    "Florence": "38", "Fret Tape": "39", "Grand Rouche": "40", "Gypsy": "41", "Handrail": "42",
    "Haverty's": "43", "Industrial Wood Metal": "44", "Jewelry": "45", "JF": "46", "JF Acrylic": "47",
    "JF Inlay": "48", "JF Weathered Oak": "49", "Key Tassels": "50", "Kravet": "51", "Leopard": "52",
    "Luxe Furnishings": "53", "Luxe Furnishings II": "54", "Mali": "55", "Minimal": "56",
    "Contemporary Artifacts (Museum of New Mexico)": "57", "Natural Selection": "58", "Odyssey": "59",
    "Ogee Tape": "60", "Outdoor": "61", "Peacock": "62", "Quadrifolio": "63", "Sahara": "64", "Shore": "65",
    "Simplicity Metal": "66", "Simplicity Wood": "67", "Surfaces": "68", "Tapes": "69", "Thom Filicia": "70",
    "TQS": "71", "Traverse": "72", "Weathered Wood": "73", "Zanzibar": "74", "Zen": "75",
    "Read Window": "113", "Color Coordinates Multi": "114", "Aurora": "115", "Joanna": "116",
    "Sunburst": "117", "Baller": "118", "Starflower": "119", "Charlotte": "120", "Siena": "121",
    "Amelie": "122", "Carolina": "123", "Mariana": "124", "Claudia": "125", "Queen Of Hearts": "126",
    "Corazon": "127", "Heart": "128", "Mother of Pearl": "129", "Somfy": "131", "Kate": "132", "JayCo": "134",
    "Coordinated Accents": "135", "Bloom & Lattice": "136", "Terrace": "137", "Edge": "138", "Ophelia": "139",
    "Akka": "141", "Allen": "142", "ALT for Living": "143", "Bahia": "144", "Becker": "145", "Bell": "146",
    "Blunt": "147", "Bridget's Pillow": "148", "Bubbles": "149", "Bubley": "150", "Buli": "151",
    "Bulloch": "152", "Calcite": "153", "Cameron": "154", "Caruso": "155", "Christo": "156", "Cobble": "157",
    "Coburn": "158", "Cocoa": "159", "Copal": "160", "Crazy": "161", "Curtis": "162", "Dakhla": "163",
    "Dali": "164", "Dalton": "165", "Davis": "166", "Dolomite": "167", "Federer": "168", "Fontana": "169",
    "Horizon": "170", "Ica": "171", "Johns": "172", "Judd": "173", "Justin": "174", "Kahlo": "175",
    "Kandi": "176", "Klimt": "177", "Koons": "178", "Kurlisuri": "179", "Kusama": "180", "Laguna": "181",
    "Leo": "182", "Lima": "183", "Malibu": "184", "Maya": "185", "Memory": "186", "Milo": "187",
    "Nagy": "188", "Naka": "189", "Nash": "190", "Nate": "191", "Neel": "192", "Newport": "193",
    "Nickey": "194", "Nolan": "195", "Noma": "196", "Oujda": "197", "Peale": "198", "Piet": "199",
    "Pipil": "200", "Pismo": "201", "Pollock": "202", "Powder": "203", "Rivers": "204", "Riverton": "205",
    "Savery": "206", "Serra": "207", "S'more": "208", "Snow": "209", "Stella": "210", "Sully": "211",
    "Sunset": "212", "Vasarely": "213", "Walton": "214", "Winters": "215", "Tacna": "216", "Tobey": "217",
    "Tribu": "218", "Wallis": "219", "Wang": "220", "Waterpaint": "221", "Waters": "222", "Zagora": "223",
    "Juno": "224", "Earrings": "225", "Bracelets": "226", "Necklaces": "227", "Link Sunbrella": "228",
    "Prism": "229", "Color Coordinates/Prism": "230", "Sisley": "232", "Kimmy": "233",
    "House of Lyria": "234", "Schumacher Exclusive": "235", "Airtex Exclusive": "236",
    "Holly Hunt Exclusive": "237", "Fabricut Exclusive": "238", "Romo Exclusive": "239",
    "Fabricut Cord Source": "240", "Rays of Sunshine": "241", "Flint": "242", "Iris": "243",
    "Isabella": "244", "Banquo": "245", "Luz": "246", "Cora Pendant": "247", "Pouf": "248", "Low": "249",
    "Bolero": "250", "Color III": "251", "Fabricut Decorative Notions": "252", "Emmy Sconce": "253",
    "Emmy": "254", "Flapper": "255", "Innlet": "256", "Montauk": "257", "Bespoke Leather Piping": "258",
    "Bespoke Leather Book": "259", "Fabricut H1": "260", "Sabine": "261", "Tasso": "262", "Aguadilla": "263",
    "Amalie": "264", "Curacao": "265", "Gustavia": "266", "Cohassett": "267", "Manzanita": "268",
    "Rialto": "269", "Leather Trim": "270", "High Line": "271", "Deluxe 1/1.5\"": "276", "Iron": "277",
    "Deluxe 1\"": "278", "Deluxe 1.5\"": "279", "Painted Wood": "281", "Joshua Tree": "282",
    "M2C Common Light Parts": "283", "M2C Fringe": "284", "Dawn Sconce": "285", "Dawn/Emmy Sconce": "286",
    "Simple Pendant": "288", "Marbella": "289", "Fabricut French General": "290", "Griffin": "291",
    "Dowell": "292", "Cassian": "293", "Globe Pendant": "294", "Specialty Pillows": "295",
    "Lux Collection": "296", "Customer Exclusive": "297", "Coastal Living / Fabricut Cord Source": "310",
    "Color Coordinates / Decadence": "311", "Color Coordinates / Tapes": "312",
    "Coordinated Accents / Color Coordinates": "313", "Coordinated Accents / Essentials": "314",
    "Coordinated Accents / Prism": "315", "Essentials Frogs": "316", "Fabricut Envision Trim": "317",
    "Fret Tape / Contemporary Classics": "318", "Natural Selection / Sahara": "319",
    "Specialty Furniture Fringe": "320", "Simple Elegance": "321",
};

// ---- SMALL FIXED LISTS (documented inline on Eric's sheet, not on their own tabs) ---------------
export const NS_UNITS_TYPE = { EACH: '1', FOOT: '2', PAIR: '17', OZ: '6' };
export const NS_TAX_SCHEDULE = { TAXABLE: '1', NONTAXABLE: '2' };
export const NS_PART_CATEGORY = { 'Custom': '1', 'Small Parts': '2', 'Fees': '3' };
export const NS_BRACKET_PROJECTION = {
    '3.625': '1', '4.625': '2', '4.5': '3', '6': '4', '3.25;6.5': '5',
    '3.5;6.75': '6', '3.25;8.25': '7', '3.25;8.5': '8', '4.25': '9', '3.625;6.5': '10',
};
// The custom FORM is the one field that genuinely differs between the two record types.
// Eric's sheet: Inventory → 42 "M2C - Inventory"; Assembly → 37 "CE - Assembly Item Form".
export const NS_CUSTOM_FORM = { inventoryitem: '42', assemblyitem: '37' };

// Name → internal id, tolerant of the spacing/case drift between the app's stored display names
// and NetSuite's list labels. Returns null when there's no match — the caller omits the field.
const lookup = (map, name) => {
    const raw = String(name == null ? '' : name).trim();
    if (!raw || raw.toUpperCase() === 'N/A' || raw.toUpperCase() === 'UNCATEGORIZED') return null;
    if (map[raw]) return map[raw];
    const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const want = norm(raw);
    const hit = Object.keys(map).find(k => norm(k) === want);
    return hit ? map[hit] : null;
};
export const nsListId = lookup;

// The app's UOM strings ("Each", "ft", "Pair"…) → NetSuite's units-type internal id.
const unitsTypeOf = (uom) => {
    const u = String(uom || '').trim().toUpperCase();
    if (!u) return null;
    if (/^(FT|FOOT|FEET|PER FOOT)$/.test(u)) return NS_UNITS_TYPE.FOOT;
    if (/^(PR|PAIR|PAIRS)$/.test(u)) return NS_UNITS_TYPE.PAIR;
    if (/^(OZ|OUNCE|OUNCES)$/.test(u)) return NS_UNITS_TYPE.OZ;
    if (/^(EA|EACH|UNIT|UNITS)$/.test(u)) return NS_UNITS_TYPE.EACH;
    return null;
};

// ---- BODY BUILDER ------------------------------------------------------------------------------
// Turns a Master Library part into the REST body for a NEW NetSuite item, per Eric's sheet.
//
// It returns the body already assembled PLUS the key groups that are safe to peel off, because a
// create is all-or-nothing: one field NetSuite doesn't like on this account rejects the entire
// record. Callers post the full body first and drop groups in order on failure, so a novel field
// costs the item its metadata — never its existence — and the log names exactly what was refused.
//
// opts: { recordType: 'inventoryitem' | 'assemblyitem', subsidiary, location, customForm }
export const buildNsItemBody = (part, opts = {}) => {
    const specs = (part && part.manufacturingSpecs) || {};
    const custom = specs.customData || {};
    const recordType = opts.recordType === 'assemblyitem' ? 'assemblyitem' : 'inventoryitem';
    const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
    const put = (o, k, v) => { if (v !== null && v !== undefined && v !== '') o[k] = v; };

    // CORE — the record cannot exist without these.
    const body = {
        itemid: part.legacyErpId || part.itemId,
        displayname: part.itemName || part.legacyErpId || part.itemId,
        subsidiary: { items: [{ id: String(opts.subsidiary || '2') }] },
        taxschedule: { id: NS_TAX_SCHEDULE.TAXABLE },
    };
    put(body, 'customform', { id: String(opts.customForm || NS_CUSTOM_FORM[recordType]) });

    // SYNC GATE — the item sync's own WHERE clause is `custitem_sync_to_cpq = 'T'`. An item created
    // without it is invisible to every later sync: it exists in NetSuite, never comes back to the
    // app, and the app keeps thinking it needs creating. This is the single most important flag here.
    body.custitem_sync_to_cpq = true;

    // COSTING — Eric: Average is the default under standard item creation.
    const costing = {
        costingmethod: 'AVERAGECOST',
        costestimatetype: 'AVERAGECOST',
    };
    put(costing, 'cost', num(specs.vendorPurchasePrice) || num(specs.purchasePrice) || num(specs.cost));
    const costCatId = lookup(NS_COST_CATEGORY, specs.costCategory);
    if (costCatId) costing.costcategory = { id: costCatId };
    const unitsId = unitsTypeOf(specs.uom);
    if (unitsId) costing.unitstype = { id: unitsId };
    put(costing, 'weight', num(specs.weight));
    costing.usebins = specs.useBins !== undefined ? !!specs.useBins : true;
    if (specs.trackLandedCost !== undefined) costing.tracklandedcost = !!specs.trackLandedCost;

    // PLACEMENT — location is deliberately omitted for a multi-subsidiary item (Eric's note:
    // "Location should not be selected if an item is multi-subsidiary").
    const placement = {};
    const shared = Array.isArray(part.sharedBrands) ? part.sharedBrands : [];
    if (opts.location && shared.length <= 1) {
        placement.location = { id: String(opts.location) };
        placement.preferredlocation = { id: String(opts.location) };
    }
    const classId = lookup(NS_CLASS, specs.nsClass);
    if (classId) placement.class = { id: classId };

    // CATALOG — the four big droplists plus the app's own flags. All optional metadata.
    const catalog = {};
    const collectionId = lookup(NS_COLLECTION, custom.collection);
    if (collectionId) catalog.custitem_bit_itemcollection = { id: collectionId };
    const watchlistId = lookup(NS_WATCHLIST, custom.watchlist || specs.watchList);
    if (watchlistId) catalog.custitem_bit_watchlist = { id: watchlistId };
    const productTypeId = lookup(NS_PRODUCT_TYPE, specs.productType);
    if (productTypeId) catalog.custitem_bit_product_type = { id: productTypeId };
    const finishId = lookup(NS_FINISH_DETAIL, specs.finishDetail);
    if (finishId) catalog.custitem2 = { id: finishId };
    const projId = lookup(NS_BRACKET_PROJECTION, custom.projection);
    if (projId) catalog.custitem_bracket_projection = { id: projId };
    const partCatId = lookup(NS_PART_CATEGORY, specs.partCategory || specs.partHandling);
    if (partCatId) catalog.custitem22 = { id: partCatId };
    catalog.custitem26 = !!specs.isInHouse;
    catalog.custitem27 = !!specs.isStocked;
    if (specs.sendToFicalora !== undefined) catalog.custitem20 = !!specs.sendToFicalora;

    // DESCRIPTIONS — the second of the two Inventory/Assembly differences.
    const descriptions = {};
    put(descriptions, 'purchasedescription', specs.purchaseDescription);
    const salesText = specs.salesDescription || part.itemName;
    if (recordType === 'assemblyitem') put(descriptions, 'description', salesText);
    else put(descriptions, 'salesdescription', salesText);
    put(descriptions, 'vendorname', specs.vendorNameText || [specs.vendorName, specs.vendorId].filter(Boolean).join(' '));

    // VENDOR SUBLIST — only when the item carries a real vendor internal id. A name can't be posted
    // here; NetSuite wants the entity. This is also what makes the item purchasable straight away.
    const vendorSublist = {};
    if (specs.vendorNsId) {
        const line = { vendor: { id: String(specs.vendorNsId) }, preferredVendor: true };
        put(line, 'vendorCode', specs.vendorId);
        const vp = num(specs.vendorPurchasePrice) || num(specs.purchasePrice);
        if (vp !== null) line.purchasePrice = vp;
        if (opts.subsidiary) line.subsidiary = { id: String(opts.subsidiary) };
        vendorSublist.itemVendor = { items: [line] };
    }

    // PRICING — the sales price. Eric's sheet puts it on the Pricing sublist (price level 1 =
    // "Base Price"), which is also where the item sync READS it from. The app's long-standing
    // write-back target is the custitem9 custom field instead; both are set so the two agree.
    const pricing = {};
    const basePrice = num(specs.basePrice);
    if (basePrice !== null && basePrice > 0) {
        pricing.custitem9 = basePrice;
        pricing.price = { items: [{ priceLevel: { id: '1' }, price: [{ price: basePrice, quantity: 0 }] }] };
    }

    Object.assign(body, costing, placement, catalog, descriptions, vendorSublist, pricing);

    // Peel order: the most exotic shapes first, the plainest last.
    return {
        body,
        recordType,
        blocks: [
            { name: 'pricing sublist', keys: ['price'] },
            { name: 'vendor sublist', keys: ['itemVendor'] },
            { name: 'catalog droplists', keys: Object.keys(catalog) },
            { name: 'placement (class/location)', keys: Object.keys(placement) },
            { name: 'costing', keys: Object.keys(costing) },
            { name: 'descriptions', keys: Object.keys(descriptions) },
            { name: 'custom form', keys: ['customform'] },
        ],
    };
};
