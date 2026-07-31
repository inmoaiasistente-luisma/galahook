'use strict';

/* =========================================================
   POST /api/admin-milu-research-rerun  (action=milu-research-rerun)
   ---------------------------------------------------------
   owner/admin: "Buscar nuevamente" — re-encola las subtareas de web
   research de una propuesta. Contabilizado (rerun_count) y auditado.
   staff → 403. Requiere la compuerta doble activa.
   ========================================================= */

const { sendJson, sendError, logServer, methodNotAllowed, readJsonBody, rejectUnknownKeys, isUuid } = require('../lib/http');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const milu = require('../lib/milu-tourism');

const ALLOWED = ['booking_id', 'job_id'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  const session = await requireWriter(req, res);   // Fase 9: escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id) || !isUuid(body.job_id)) return sendError(res, 400, 'INVALID_BODY', 'Invalid ids');

  try {
    const r = await milu.rerunResearch(body.booking_id, body.job_id, { role: session.role, userId: session.user_id });
    return sendJson(res, 200, r);
  } catch (err) {
    const code = err && err.code;
    if (code === 'JOB_NOT_FOUND') return sendError(res, 404, 'JOB_NOT_FOUND', 'Job not found');
    if (code === 'JOB_INACTIVE') return sendError(res, 409, 'JOB_INACTIVE', 'Job is not active');
    if (code === 'WEB_RESEARCH_DISABLED') return sendError(res, 409, 'WEB_RESEARCH_DISABLED', 'Web research is disabled');
    if (code === 'RERUN_LIMIT_REACHED') return sendError(res, 429, 'RERUN_LIMIT_REACHED', 'Rerun limit reached for this proposal');
    logServer('milu-research-rerun', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
