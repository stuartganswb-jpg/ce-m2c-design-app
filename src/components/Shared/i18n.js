// THE APP IN SPANISH, WHERE IT MATTERS FIRST (Stuart 2026-08-20).
//
// Sandra reports in Spanish and works the warehouse app all day, so that is where this starts —
// not with a framework covering every screen badly, but with the strings she actually reads.
//
// Design rules, so partial coverage is SAFE rather than a half-finished feature:
//   • `t(x)` returns x unchanged when there is no translation. An untranslated string shows in
//     English rather than a key, a blank, or a crash — the screen always works.
//   • Matching is case-insensitive on the exact phrase. No interpolation, no pluralisation
//     machinery: item codes, quantities and names are DATA and must never be translated.
//   • The choice is per-device (localStorage), because the tablet on the packing bench and the
//     office desktop are used by different people.
//
// To extend: add the English phrase as the key. Anything not here simply stays English, so adding
// translations is always additive and never breaks a screen.

export const LANGS = { en: 'English', es: 'Español' };
const STORAGE_KEY = 'app_lang';

const ES = {
    // ── Tabs / navigation ────────────────────────────────────────────────────────────────────
    'PICK QUEUE': 'COLA DE PICKING',
    'STOCK': 'INVENTARIO',
    'PACKAGING PREP': 'PREP. EMBALAJE',
    'BIN COUNT': 'CONTEO DE BINS',
    'CONVERT': 'CONVERTIR',
    'ROD CUTS & RING PACKS': 'CORTES Y PAQUETES',
    'TRANSFER': 'TRASLADO',
    'PLATING': 'GALVANIZADO',
    'CHIPS': 'MUESTRAS',
    'ASSET GALLERY': 'GALERÍA',
    'MESSAGING': 'MENSAJES',
    'HUB / LOGOUT': 'INICIO / SALIR',
    'OPERATOR': 'OPERADOR',

    // ── Pick queue ───────────────────────────────────────────────────────────────────────────
    'Awaiting Pick (Small Parts)': 'Pendiente de Picking (Piezas Pequeñas)',
    'Pending': 'Por Llegar',
    'coming — not released to pick yet': 'en camino — aún no liberado para picking',
    'Nothing upstream — everything raised has reached you.': 'Nada por llegar — todo lo emitido ya está aquí.',
    'Pick now': 'Recoger ahora',
    'need by': 'para el',
    'poles being cut': 'tubos en corte',
    'not released by finishing yet': 'acabado aún no lo ha liberado',
    'START PICKING': 'EMPEZAR PICKING',
    // ── One order, one pair of hands (the pick / pack claim) ─────────────────────────────────
    'is picking this': 'está recogiendo esta orden',
    'is packing this': 'está embalando esta orden',
    'You are picking this': 'Usted está recogiendo esta orden',
    'You are packing this': 'Usted está embalando esta orden',
    'since': 'desde',
    'no activity for 4+ hours': 'sin actividad por más de 4 horas',
    'Release (admin)': 'Liberar (admin)',

    // ── Plating receiving station (scan → cart → bin) ────────────────────────────────────────
    'Scan or type the item — raw or plated code': 'Escanee o escriba el artículo — código crudo o plateado',
    'Find': 'Buscar',
    'Clear': 'Limpiar',
    'To receive': 'Por recibir',
    'sent': 'enviado',
    'Add to cart': 'Agregar al carro',
    'No finish': 'Sin acabado',
    'open': 'abierto',
    'saved': 'guardado',
    'line(s)': 'línea(s)',
    'short': 'faltante',
    'short — will be scrapped': 'faltante — se dará de baja',
    'Remove': 'Quitar',
    'Save cart': 'Guardar carro',
    'put away': 'guardar en ubicación',
    'selected': 'seleccionado',
    'tap to put away': 'toque para ubicar',
    'Where did they go?': '¿Dónde se colocaron?',
    'Scan the bin': 'Escanee la ubicación',
    'Multiple bins': 'Varias ubicaciones',
    'another bin': 'otra ubicación',
    'placed': 'colocadas',
    'Put away & build': 'Ubicar y construir',

    // ── SO Pack / Packaging Prep (open to look, start to take) ───────────────────────────────
    'Labels': 'Etiquetas',
    'Close order': 'Cerrar orden',
    'Close': 'Cerrar',
    'Start packing': 'Empezar embalaje',
    'READY TO PACK': 'LISTO PARA EMBALAR',
    'waiting on parts': 'esperando piezas',
    'GATHERED': 'REUNIDO',
    'READY': 'LISTO',
    'IN PRODUCTION': 'EN PRODUCCIÓN',
    'SHORT': 'FALTANTE',
    'UNKNOWN': 'SIN DATO',
    'from the floor': 'llega del taller',
    'BIN': 'UBIC',
    'Release': 'Liberar',
    'Configured orders in production': 'Órdenes configuradas en producción',
    'packed on Packaging Prep; this is where their pieces are': 'se embalan en Preparación; aquí se ve dónde están sus piezas',
    'work order': 'orden de trabajo',
    'work orders': 'órdenes de trabajo',
    'NEED BY': 'PARA EL',
    'ALL PARTS DONE': 'TODAS LAS PIEZAS LISTAS',
    'in production': 'en producción',
    'PACKED': 'EMBALADO',
    'Looking only — nothing is changed until you start packing': 'Solo mirando — nada cambia hasta que empiece el embalaje',
    'Pick a different order, or ask them (or an admin) to release it.': 'Tome otra orden, o pida a esa persona (o a un admin) que la libere.',
    'Line Item': 'Línea',
    'Line Items': 'Líneas',
    'tap for parts': 'toque para ver piezas',
    'Nothing to pick right now.': 'No hay nada que recoger ahora.',

    // ── Staging / handshake ──────────────────────────────────────────────────────────────────
    'Staging Handshake': 'Enlace de Preparación',
    'PICKED — AWAITING STAGING:': 'RECOGIDO — ESPERANDO PREPARACIÓN:',
    'VERIFY & STAGE': 'VERIFICAR Y PREPARAR',
    'Back to Pick Queue': 'Regresar a la cola',
    'Nothing picked and awaiting staging.': 'Nada recogido esperando preparación.',
    'Setup Label': 'Etiqueta de Preparación',

    // ── Packing ──────────────────────────────────────────────────────────────────────────────
    'Packing Station': 'Estación de Embalaje',
    'TO PACK': 'POR EMBALAR',
    'FINISH AS AVAILABLE': 'ACABAR SEGÚN LLEGUEN',
    'Finish as available': 'Acabar según lleguen',
    'Waiting off': 'Volver a esperar completo',
    'Parts for this order are in bin': 'Las piezas de esta orden están en la ubicación',

    // ── Labels tab ───────────────────────────────────────────────────────────────────────────
    'Any label the floors, the shop or the warehouse need — printed from one place.': 'Cualquier etiqueta que necesiten los talleres o el almacén — se imprime desde aquí.',
    'Item label': 'Etiqueta de artículo',
    'Bin label': 'Etiqueta de ubicación',
    'Work order': 'Orden de trabajo',
    'Sales order': 'Orden de venta',
    'UOM / pack': 'Unidad / paquete',
    'the part, its name and its barcode': 'la pieza, su nombre y su código de barras',
    'a shelf location': 'una ubicación del estante',
    'the setup label the floor carries': 'la etiqueta de preparación que lleva el taller',
    'whose order this box belongs to': 'a qué orden pertenece esta caja',
    'a pack, with its piece count in the barcode': 'un paquete, con su cantidad de piezas en el código de barras',
    'Item': 'Artículo',
    'Scan or type an item code or name': 'Escanee o escriba el código o el nombre',
    'Unit of measure': 'Unidad de medida',
    '— pick a unit —': '— elija una unidad —',
    'How many labels': 'Cuántas etiquetas',
    'label': 'etiqueta',
    'labels': 'etiquetas',
    'each one is': 'cada una es',
    'piece': 'pieza',
    'pieces': 'piezas',
    'pieces in total': 'piezas en total',
    'barcode': 'código de barras',
    'Print': 'Imprimir',
    'Bin': 'Ubicación',
    'Scan or type the bin': 'Escanee o escriba la ubicación',
    'Scan or type the work order': 'Escanee o escriba la orden de trabajo',
    'Scan or type the sales order': 'Escanee o escriba la orden de venta',
    'no cut length recorded for this order': 'sin largo de corte registrado para esta orden',
    'A work order label prints one at a time — it belongs to one fixture.': 'La etiqueta de orden de trabajo se imprime de una en una — pertenece a un solo montaje.',
    'Complete Packing': 'Completar Embalaje',
    'Put Away to Bin': 'Guardar en Bin',
    'Put-away bin': 'Bin de destino',
    'scan / enter bin': 'escanee / escriba el bin',
    'Item Labels': 'Etiquetas de Artículo',
    'Recently Packed': 'Embalado Recientemente',
    'This order has no poles — say why & continue': 'Esta orden no lleva tubos — indique por qué y continúe',
    'Match the poles to these small parts': 'Empareje los tubos con estas piezas',
    'Both halves match': 'Ambas partes coinciden',

    // ── Rod cuts ─────────────────────────────────────────────────────────────────────────────
    'Cuts for Finishing': 'Cortes para Acabado',
    'Cuts for Sales Orders': 'Cortes para Órdenes de Venta',
    'Cut & release to finishing': 'Cortar y liberar a acabado',
    'Cancel': 'Cancelar',
    'Pull Live Stock': 'Actualizar Inventario',

    // ── Common actions / words ───────────────────────────────────────────────────────────────
    'Qty': 'Cant.',
    'Finish': 'Acabado',
    'Customer': 'Cliente',
    'Reason': 'Motivo',
    'Confirm': 'Confirmar',
    'Search': 'Buscar',
    'shop fab not started': 'fabricación no iniciada',
    'shop fab in process': 'fabricación en proceso',
    'shop fab pending': 'fabricación pendiente',
};

const DICTS = { es: ES };

export const readLang = () => {
    try { return localStorage.getItem(STORAGE_KEY) || 'en'; } catch (e) { return 'en'; }
};
export const writeLang = (l) => {
    try { localStorage.setItem(STORAGE_KEY, l); } catch (e) { /* storage unavailable — session only */ }
};

/**
 * Translator for a language. Unknown phrase → returned unchanged, deliberately: a screen with
 * half its strings translated still reads, which is what makes shipping this incrementally honest.
 */
export function translator(lang) {
    const d = DICTS[lang];
    if (!d) return (s) => s;
    // Case-insensitive lookup, built once per language.
    const lower = Object.keys(d).reduce((m, k) => { m[k.toLowerCase()] = d[k]; return m; }, {});
    return (s) => {
        if (s == null) return s;
        const str = String(s);
        return d[str] || lower[str.toLowerCase()] || str;
    };
}

// How many of the phrases we know about are actually translated — used by the toggle's tooltip so
// nobody is told the app "is in Spanish" when only part of it is.
export const coverageOf = (lang) => (DICTS[lang] ? Object.keys(DICTS[lang]).length : 0);
