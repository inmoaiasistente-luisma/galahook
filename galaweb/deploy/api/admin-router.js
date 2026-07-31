'use strict';

/* =========================================================
   LOAN-IX Booking Engine — router del panel administrativo
   ---------------------------------------------------------
   UNA sola Vercel Function para los 11 endpoints admin. Existe por el
   límite de 12 funciones del plan Hobby: la lógica NO cambió, solo se
   movió a ../server/admin-handlers/, fuera de /api, para que Vercel no
   la cuente como funciones independientes.

   Las URLs públicas NO cambian: vercel.json reescribe internamente
   /api/admin-login → /api/admin-router?action=login, etc. El navegador
   sigue llamando exactamente a las mismas rutas de siempre.

   SEGURIDAD DEL DESPACHO
   ----------------------
   · La tabla ROUTES es ESTÁTICA: los require() son literales resueltos
     al cargar el módulo. NUNCA se construye una ruta de fichero con
     texto del navegador, así que no hay forma de cargar un módulo
     arbitrario ni de escapar del directorio.
   · Solo se acepta `action` de la query (la que pone el rewrite), y
     únicamente si es una clave propia de la tabla. Cualquier otra cosa
     → 404 genérico, sin pistas sobre qué acciones existen.
   · El router NO autentica ni autoriza: delega req y res intactos al
     handler, que conserva su propio requireAdmin, sameOrigin, control
     de método HTTP, cookies y proyecciones por rol. El rol jamás sale
     de la query: se relee de la base de datos en cada petición.
   · Sin cabeceras CORS y sin stack traces hacia el cliente.
   ========================================================= */

const { sendError, logServer } = require('../server/lib/http');

/* Tabla ESTÁTICA acción → handler. Object.create(null) evita que
   `constructor`, `__proto__` o `toString` resuelvan por herencia. */
const ROUTES = Object.create(null);
ROUTES['login'] = require('../server/admin-handlers/login');
ROUTES['logout'] = require('../server/admin-handlers/logout');
ROUTES['session'] = require('../server/admin-handlers/session');
ROUTES['bookings'] = require('../server/admin-handlers/bookings');
ROUTES['booking-update'] = require('../server/admin-handlers/booking-update');
ROUTES['agency-booking-create'] = require('../server/admin-handlers/agency-booking-create');
ROUTES['finance-summary'] = require('../server/admin-handlers/finance-summary');
ROUTES['qr-rotate'] = require('../server/admin-handlers/qr-rotate');
ROUTES['qr-revoke'] = require('../server/admin-handlers/qr-revoke');
ROUTES['booking-notifications'] = require('../server/admin-handlers/booking-notifications');
ROUTES['email-retry'] = require('../server/admin-handlers/email-retry');
ROUTES['finance-settings-list'] = require('../server/admin-handlers/finance-settings-list');
ROUTES['finance-settings-save'] = require('../server/admin-handlers/finance-settings-save');
// Finanzas reales por reserva (Fase 9, Etapa 3)
ROUTES['booking-finance'] = require('../server/admin-handlers/booking-finance');
ROUTES['booking-cost-line-add'] = require('../server/admin-handlers/booking-cost-line-add');
ROUTES['booking-cost-line-delete'] = require('../server/admin-handlers/booking-cost-line-delete');
ROUTES['booking-costs-confirm'] = require('../server/admin-handlers/booking-costs-confirm');
ROUTES['discount-rules-list'] = require('../server/admin-handlers/discount-rules-list');
ROUTES['discount-rule-save'] = require('../server/admin-handlers/discount-rule-save');
ROUTES['discount-rule-toggle'] = require('../server/admin-handlers/discount-rule-toggle');
ROUTES['test-data-list'] = require('../server/admin-handlers/test-data-list');
ROUTES['test-data-mark'] = require('../server/admin-handlers/test-data-mark');
ROUTES['test-data-archive'] = require('../server/admin-handlers/test-data-archive');
ROUTES['notifications-list'] = require('../server/admin-handlers/notifications-list');
ROUTES['notifications-retry-batch'] = require('../server/admin-handlers/notifications-retry-batch');
/* Etapa 8 — notas de paquetes, intake de pasajeros, alojamiento y hoteles. */
ROUTES['tour-notes-list'] = require('../server/admin-handlers/tour-notes-list');
ROUTES['tour-notes-save'] = require('../server/admin-handlers/tour-notes-save');
ROUTES['passenger-intakes-list'] = require('../server/admin-handlers/passenger-intakes-list');
ROUTES['passenger-intake-detail'] = require('../server/admin-handlers/passenger-intake-detail');
ROUTES['passenger-intake-review'] = require('../server/admin-handlers/passenger-intake-review');
ROUTES['passenger-intake-request-changes'] = require('../server/admin-handlers/passenger-intake-request-changes');
ROUTES['passenger-intake-renew'] = require('../server/admin-handlers/passenger-intake-renew');
ROUTES['passenger-document-reveal'] = require('../server/admin-handlers/passenger-document-reveal');
ROUTES['lodging-requirements-save'] = require('../server/admin-handlers/lodging-requirements-save');
ROUTES['hotel-preferences-list'] = require('../server/admin-handlers/hotel-preferences-list');
ROUTES['hotel-preferences-save'] = require('../server/admin-handlers/hotel-preferences-save');
/* Precios de paquetes en vivo (main / migraciones 0012–0013). */
ROUTES['package-prices-list'] = require('../server/admin-handlers/package-prices-list');
ROUTES['package-price-draft-save'] = require('../server/admin-handlers/package-price-draft-save');
ROUTES['package-price-publish'] = require('../server/admin-handlers/package-price-publish');
ROUTES['package-price-history'] = require('../server/admin-handlers/package-price-history');
ROUTES['package-price-rollback'] = require('../server/admin-handlers/package-price-rollback');
ROUTES['package-price-toggle'] = require('../server/admin-handlers/package-price-toggle');
ROUTES['package-price-update'] = require('../server/admin-handlers/package-price-update');
/* Etapa 8C — Milu Turismo (jobs de búsqueda; worker vía Edge Function en 8D+). */
ROUTES['milu-search-start'] = require('../server/admin-handlers/milu-search-start');
ROUTES['milu-search-status'] = require('../server/admin-handlers/milu-search-status');
ROUTES['milu-search-cancel'] = require('../server/admin-handlers/milu-search-cancel');
ROUTES['milu-options-list'] = require('../server/admin-handlers/milu-options-list');
ROUTES['milu-settings-get'] = require('../server/admin-handlers/milu-settings-get');
ROUTES['milu-settings-save'] = require('../server/admin-handlers/milu-settings-save');
ROUTES['milu-research-rerun'] = require('../server/admin-handlers/milu-research-rerun');
ROUTES['milu-research-approve'] = require('../server/admin-handlers/milu-research-approve');
ROUTES['milu-itinerary-preview'] = require('../server/admin-handlers/milu-itinerary-preview');

/* Solo de la query. El cuerpo no decide el destino: así un POST no
   puede apuntar a una acción distinta de la que autorizó el rewrite. */
function readAction(req) {
  if (req.query && typeof req.query === 'object' && typeof req.query.action === 'string') {
    return req.query.action;
  }
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('action') || '';
  } catch (e) { return ''; }
}

module.exports = async function handler(req, res) {
  const action = readAction(req);

  const known = typeof action === 'string' && action !== ''
    && Object.prototype.hasOwnProperty.call(ROUTES, action);
  if (!known) return sendError(res, 404, 'NOT_FOUND', 'Not found');

  const target = ROUTES[action];
  if (typeof target !== 'function') return sendError(res, 404, 'NOT_FOUND', 'Not found');

  try {
    /* req y res se pasan intactos: cookies, cabeceras, método y cuerpo
       llegan al handler exactamente como llegaron al router. */
    return await target(req, res);
  } catch (err) {
    logServer('admin-router:' + action, err && err.message);   // nunca el cuerpo
    if (res.headersSent) return;
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};

module.exports.ROUTE_NAMES = Object.keys(ROUTES);   // solo para pruebas
