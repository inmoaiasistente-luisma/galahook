'use strict';

/* POST /api/admin-logout — borra la cookie de sesión. */

const { sendJson, sendError } = require('./_lib/http');
const { clearSessionCookie, isSecureEnv, sameOrigin } = require('./_lib/admin-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');
  res.setHeader('Set-Cookie', clearSessionCookie({ secure: isSecureEnv() }));
  return sendJson(res, 200, { ok: true });
};
