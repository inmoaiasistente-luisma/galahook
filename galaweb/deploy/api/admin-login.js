'use strict';

/* POST /api/admin-login  — body: { password } */

const { sendJson, sendError, logServer, readJsonBody } = require('./_lib/http');
const { verifyPassword, createSessionToken, buildSessionCookie, isSecureEnv, sameOrigin, DEFAULT_MAX_AGE } = require('./_lib/admin-auth');

/* Throttle básico en memoria (por instancia; sin infraestructura extra). */
const attempts = new Map(); // ip -> { count, ts }
const WINDOW_MS = 10 * 60 * 1000;
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function clientIp(req) { return String((req.headers['x-forwarded-for'] || '')).split(',')[0].trim() || 'unknown'; }
function currentDelay(ip) {
  const a = attempts.get(ip);
  if (!a || (Date.now() - a.ts) > WINDOW_MS) return 300;          // base
  return Math.min(300 + a.count * 400, 3000);                     // sube con los fallos, tope 3s
}
function noteFailure(ip) {
  const a = attempts.get(ip);
  if (!a || (Date.now() - a.ts) > WINDOW_MS) attempts.set(ip, { count: 1, ts: Date.now() });
  else { a.count += 1; a.ts = Date.now(); }
}
function noteSuccess(ip) { attempts.delete(ip); }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 400, 'INVALID_BODY', 'Invalid body');
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'password') return sendError(res, 400, 'INVALID_BODY', 'Invalid body');
  const password = body.password;
  if (typeof password !== 'string' || password.length < 1 || password.length > 200) return sendError(res, 400, 'INVALID_BODY', 'Invalid body');

  const ip = clientIp(req);
  await sleep(currentDelay(ip)); // demora mínima anti fuerza bruta

  const hash = process.env.ADMIN_PASSWORD_HASH;
  const secret = process.env.SESSION_SECRET;
  if (!hash || !secret) { logServer('admin-login', 'missing ADMIN_PASSWORD_HASH or SESSION_SECRET'); return sendError(res, 500, 'SERVER_ERROR', 'Server error'); }

  if (!verifyPassword(password, hash)) {
    noteFailure(ip);
    return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid password'); // respuesta genérica
  }

  noteSuccess(ip);
  const token = createSessionToken(secret, DEFAULT_MAX_AGE);
  res.setHeader('Set-Cookie', buildSessionCookie(token, { maxAge: DEFAULT_MAX_AGE, secure: isSecureEnv() }));
  return sendJson(res, 200, { authenticated: true });
};
