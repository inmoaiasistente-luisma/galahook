'use strict';

/* =========================================================
   POST /api/admin-milu-itinerary-preview  (action=milu-itinerary-preview)
   ---------------------------------------------------------
   owner/admin ven el itinerario ANTES de buscar (#8): rango total del viaje,
   rango del programa en Galápagos, noche previa continental, ciudad de conexión,
   vuelos y hoteles incluidos. NO crea job, NO busca, NO envía nada al cliente.
   staff → 403.
   ========================================================= */

const { sendJson, sendError, logServer, methodNotAllowed, readJsonBody, rejectUnknownKeys, isUuid } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const milu = require('../lib/milu-tourism');

const ALLOWED = ['booking_id', 'passenger_type', 'connection_city', 'include_mainland_pre_night', 'mainland_post_nights', 'galapagos_start_date'];
const PASSENGER_TYPES = ['international', 'domestic'];
const CONNECTION_CITIES = ['quito', 'guayaquil'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'Invalid booking_id');
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
    const preview = await milu.previewItinerary(body.booking_id, overrides);
    return sendJson(res, 200, preview);
  } catch (err) {
    const code = err && err.code;
    if (code === 'BOOKING_NOT_FOUND') return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');
    logServer('milu-itinerary-preview', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
