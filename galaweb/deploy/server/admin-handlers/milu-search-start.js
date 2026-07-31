'use strict';

/* =========================================================
   POST /api/admin-milu-search-start  (action=milu-search-start)
   ---------------------------------------------------------
   owner/admin inician una búsqueda de Milu Turismo. staff → 403.
   Crea un job idempotente + subtareas. Aplica el gate (form listo,
   connection_tbd resuelto, fechas presentes). No envía nada al cliente.
   ========================================================= */

const { sendJson, sendError, logServer, methodNotAllowed, readJsonBody, rejectUnknownKeys, isUuid } = require('../lib/http');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const milu = require('../lib/milu-tourism');

const ALLOWED = ['booking_id', 'search_type', 'passenger_type', 'connection_city', 'include_mainland_pre_night', 'mainland_post_nights', 'galapagos_start_date'];
const TYPES = ['flights', 'hotels', 'complete_trip'];
const PASSENGER_TYPES = ['international', 'domestic'];
const CONNECTION_CITIES = ['quito', 'guayaquil'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  const session = await requireWriter(req, res);   // Fase 9: escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'Invalid booking_id');
  const searchType = body.search_type || 'complete_trip';
  if (TYPES.indexOf(searchType) === -1) return sendError(res, 400, 'INVALID_SEARCH_TYPE', 'Invalid search_type');

  // Overrides del itinerario (owner/admin). Validación de forma; el gate valida la lógica.
  if (body.passenger_type != null && PASSENGER_TYPES.indexOf(body.passenger_type) === -1) return sendError(res, 400, 'INVALID_PASSENGER_TYPE', 'Invalid passenger_type');
  if (body.connection_city != null && CONNECTION_CITIES.indexOf(body.connection_city) === -1) return sendError(res, 400, 'INVALID_CONNECTION_CITY', 'Invalid connection_city');
  if (body.include_mainland_pre_night != null && typeof body.include_mainland_pre_night !== 'boolean') return sendError(res, 400, 'INVALID_PRE_NIGHT', 'Invalid include_mainland_pre_night');
  if (body.mainland_post_nights != null && (typeof body.mainland_post_nights !== 'number' || body.mainland_post_nights < 0 || body.mainland_post_nights > 7)) return sendError(res, 400, 'INVALID_POST_NIGHTS', 'Invalid mainland_post_nights');
  if (body.galapagos_start_date != null && !YMD.test(String(body.galapagos_start_date))) return sendError(res, 400, 'INVALID_START_DATE', 'Invalid galapagos_start_date');

  const overrides = {
    passenger_type: body.passenger_type, connection_city: body.connection_city,
    include_mainland_pre_night: body.include_mainland_pre_night,
    mainland_post_nights: body.mainland_post_nights, galapagos_start_date: body.galapagos_start_date
  };

  try {
    const r = await milu.startSearch(body.booking_id, session.user_id, searchType, overrides);
    return sendJson(res, 200, {
      started: true, created: r.created,
      job: { id: r.job.id, status: r.job.status, search_type: r.job.search_type },
      itinerary: r.itinerary || (r.job.requirements_snapshot && r.job.requirements_snapshot.itinerary) || null
    });
  } catch (err) {
    const code = err && err.code;
    if (code === 'FORM_NOT_READY') return sendError(res, 409, 'FORM_NOT_READY', 'Passenger form is not ready');
    if (code === 'CONNECTION_TBD_UNRESOLVED') return sendError(res, 409, 'CONNECTION_TBD_UNRESOLVED', 'Resolve connection city first');
    if (code === 'DESTINATION_DATES_MISSING') return sendError(res, 409, 'DESTINATION_DATES_MISSING', 'Destination dates are missing');
    if (code === 'PASSENGER_TYPE_REQUIRED') return sendError(res, 409, 'PASSENGER_TYPE_REQUIRED', 'Passenger type is required');
    if (code === 'CONNECTION_CITY_REQUIRED') return sendError(res, 409, 'CONNECTION_CITY_REQUIRED', 'Connection city is required for international passengers');
    if (code === 'ORIGIN_REQUIRED') return sendError(res, 409, 'ORIGIN_REQUIRED', 'Origin city/airport is required');
    if (code === 'GALAPAGOS_START_REQUIRED') return sendError(res, 409, 'GALAPAGOS_START_REQUIRED', 'Galapagos program start date is required');
    if (code === 'PACKAGE_DURATION_REQUIRED') return sendError(res, 409, 'PACKAGE_DURATION_REQUIRED', 'Package duration is required');
    if (code === 'BOOKING_NOT_FOUND') return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');
    logServer('milu-search-start', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
