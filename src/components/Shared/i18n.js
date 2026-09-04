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
    'PACKED': 'EMBALADO',
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
    'Item': 'Artículo',
    'Qty': 'Cant.',
    'Finish': 'Acabado',
    'Customer': 'Cliente',
    'Reason': 'Motivo',
    'Confirm': 'Confirmar',
    'Print': 'Imprimir',
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
