'use strict';

/* GET /api/admin-session — { authenticated: true|false } */

const { sendJson, sendError } = require('./_lib/http');
const { readCookies, verifySessionToken, COOKIE_NAME } = require('./_lib/admin-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const secret = process.env.SESSION_SECRET;
  if (!secret) return sendJson(res, 200, { authenticated: false });
  const token = readCookies(req)[COOKIE_NAME];
  const payload = token ? verifySessionToken(token, secret) : null;
  return sendJson(res, 200, { authenticated: !!payload });
};
