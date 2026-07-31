'use strict';

/* =========================================================
   POST /api/admin-milu-research-approve  (action=milu-research-approve)
   ---------------------------------------------------------
   owner/admin: revisión humana de un hallazgo de web research
   (verified | rejected). staff → 403. Registra actor + fecha + auditoría.
   Un hallazgo verificado NUNCA entra a Stripe/checkout/cliente por sí solo.
   ========================================================= */

const { sendJson, sendError, logServer, methodNotAllowed, readJsonBody, rejectUnknownKeys, isUuid } = require('../lib/http');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const milu = require('../lib/milu-tourism');

const ALLOWED = ['option_kind', 'option_id', 'decision', 'confirm_manual'];
const KINDS = ['flight', 'hotel'];
const DECISIONS = ['verified', 'rejected'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res);
  const session = await requireWriter(req, res);   // Fase 9: escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (KINDS.indexOf(body.option_kind) === -1) return sendError(res, 400, 'INVALID_KIND', 'Invalid option_kind');
  if (!isUuid(body.option_id)) return sendError(res, 400, 'INVALID_BODY', 'Invalid option_id');
  if (DECISIONS.indexOf(body.decision) === -1) return sendError(res, 400, 'INVALID_DECISION', 'Invalid decision');

  try {
    const r = await milu.reviewFinding(body.option_kind, body.option_id, body.decision,
      { role: session.role, userId: session.user_id }, { confirmManual: body.confirm_manual === true });
    return sendJson(res, 200, r);
  } catch (err) {
    const code = err && err.code;
    if (code === 'OPTION_NOT_FOUND') return sendError(res, 404, 'OPTION_NOT_FOUND', 'Option not found');
    if (code === 'NOT_RESEARCH_OPTION') return sendError(res, 409, 'NOT_RESEARCH_OPTION', 'Not a web research option');
    // #9: aprobar un hallazgo no verificado para la solicitud exige confirmación manual explícita.
    if (code === 'MANUAL_VERIFICATION_REQUIRED') return sendError(res, 409, 'MANUAL_VERIFICATION_REQUIRED', 'Manual verification required to approve an unverified fare');
    if (code === 'INVALID_DECISION' || code === 'INVALID_KIND') return sendError(res, 400, code, 'Invalid input');
    logServer('milu-research-approve', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
