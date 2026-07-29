'use strict';

/* =========================================================
   POST /api/admin-milu-search-cancel  (action=milu-search-cancel)
   ---------------------------------------------------------
   owner/admin cancelan un job y sus subtareas pendientes. staff → 403.
   ========================================================= */

const { sendJson, sendError, logServer, methodNotAllowed, readJsonBody, rejectUnknownKeys, isUuid } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const milu = require('../lib/milu-tourism');

const ALLOWED = ['booking_id', 'job_id'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id) || !isUuid(body.job_id)) return sendError(res, 400, 'INVALID_BODY', 'Invalid ids');

  try {
    await milu.cancelSearch(body.booking_id, body.job_id);
    return sendJson(res, 200, { cancelled: true });
  } catch (err) {
    logServer('milu-search-cancel', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
