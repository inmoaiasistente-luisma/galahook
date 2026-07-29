'use strict';

/* =========================================================
   POST /api/admin-milu-search-start  (action=milu-search-start)
   ---------------------------------------------------------
   owner/admin inician una búsqueda de Milu Turismo. staff → 403.
   Crea un job idempotente + subtareas. Aplica el gate (form listo,
   connection_tbd resuelto, fechas presentes). No envía nada al cliente.
   ========================================================= */

const { sendJson, sendError, logServer, methodNotAllowed, readJsonBody, rejectUnknownKeys, isUuid } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const milu = require('../lib/milu-tourism');

const ALLOWED = ['booking_id', 'search_type'];
const TYPES = ['flights', 'hotels', 'complete_trip'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'Invalid booking_id');
  const searchType = body.search_type || 'complete_trip';
  if (TYPES.indexOf(searchType) === -1) return sendError(res, 400, 'INVALID_SEARCH_TYPE', 'Invalid search_type');

  try {
    const r = await milu.startSearch(body.booking_id, session.user_id, searchType);
    return sendJson(res, 200, {
      started: true, created: r.created,
      job: { id: r.job.id, status: r.job.status, search_type: r.job.search_type }
    });
  } catch (err) {
    const code = err && err.code;
    if (code === 'FORM_NOT_READY') return sendError(res, 409, 'FORM_NOT_READY', 'Passenger form is not ready');
    if (code === 'CONNECTION_TBD_UNRESOLVED') return sendError(res, 409, 'CONNECTION_TBD_UNRESOLVED', 'Resolve connection city first');
    if (code === 'DESTINATION_DATES_MISSING') return sendError(res, 409, 'DESTINATION_DATES_MISSING', 'Destination dates are missing');
    if (code === 'BOOKING_NOT_FOUND') return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');
    logServer('milu-search-start', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
