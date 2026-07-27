'use strict';

/* =========================================================
   GET /api/admin-session
   ---------------------------------------------------------
   { authenticated:true, user:{ full_name, email, role } }  |  { authenticated:false }
   Revalida el perfil contra public.admin_profiles: si el usuario fue
   desactivado o cambió de rol, se refleja aquí de inmediato.
   No devuelve user_id, tokens ni información interna.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { readCookies, verifySessionToken, loadProfile, isProfileUsable, COOKIE_NAME } = require('../lib/admin-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }

  try {
    const secret = process.env.SESSION_SECRET;
    if (!secret) return sendJson(res, 200, { authenticated: false });

    const token = readCookies(req)[COOKIE_NAME];
    const payload = token ? verifySessionToken(token, secret) : null;
    if (!payload || !payload.user_id) return sendJson(res, 200, { authenticated: false });

    const tenant = getTenantId();
    if (payload.tenant_id !== tenant) return sendJson(res, 200, { authenticated: false });

    const profile = await loadProfile(payload.user_id);
    if (!isProfileUsable(profile, tenant)) return sendJson(res, 200, { authenticated: false });

    return sendJson(res, 200, {
      authenticated: true,
      user: { full_name: profile.full_name, email: payload.email, role: profile.role }
    });
  } catch (err) {
    logServer('admin-session', err && err.message);
    return sendJson(res, 200, { authenticated: false }); // fail-closed
  }
};
