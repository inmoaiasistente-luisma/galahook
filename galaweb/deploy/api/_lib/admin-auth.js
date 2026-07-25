'use strict';

/* =========================================================
   LOAN-IX Booking Engine — autenticación del panel admin
   ---------------------------------------------------------
   SERVER-ONLY. Verifica la contraseña contra ADMIN_PASSWORD_HASH
   (scrypt) y firma/verifica una cookie de sesión con HMAC-SHA256
   usando SESSION_SECRET. Nada de esto se expone al navegador.
   ========================================================= */

const crypto = require('crypto');

const COOKIE_NAME = 'gha_admin_session';
const DEFAULT_MAX_AGE = 8 * 60 * 60; // 8 horas (segundos)

/* ¿Entorno seguro (HTTPS)? En Vercel NODE_ENV='production' en prod y preview. */
function isSecureEnv() { return process.env.NODE_ENV === 'production'; }

/* ---------------- contraseña (scrypt) ----------------
   Formato del hash almacenado:  scrypt$N$r$p$saltHex$keyHex   */
function verifyPassword(password, storedHash) {
  try {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
    const salt = Buffer.from(parts[4], 'hex');
    const expected = Buffer.from(parts[5], 'hex');
    if (!N || !r || !p || salt.length === 0 || expected.length === 0) return false;
    const derived = crypto.scryptSync(password, salt, expected.length, { N: N, r: r, p: p, maxmem: 64 * 1024 * 1024 });
    if (derived.length !== expected.length) return false; // evita que timingSafeEqual lance con longitudes distintas
    return crypto.timingSafeEqual(derived, expected);
  } catch (e) { return false; }
}

/* ---------------- token de sesión (HMAC) ---------------- */
function createSessionToken(secret, maxAgeSeconds) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (maxAgeSeconds || DEFAULT_MAX_AGE);
  const sid = crypto.randomBytes(16).toString('hex');
  const body = Buffer.from(JSON.stringify({ iat: iat, exp: exp, sid: sid })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig; // la firma cubre TODO el cuerpo del token
}

function verifySessionToken(token, secret) {
  try {
    if (typeof token !== 'string' || !secret) return null;
    const dot = token.indexOf('.');
    if (dot < 1) return null;
    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac('sha256', secret).update(body).digest();
    const provided = Buffer.from(sig, 'base64url');
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null; // expirado
    return payload;
  } catch (e) { return null; }
}

/* ---------------- cookies ---------------- */
function readCookies(req) {
  const header = req.headers && req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(function (pair) {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const k = pair.slice(0, idx).trim();
    if (k) out[k] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function buildSessionCookie(token, opts) {
  opts = opts || {};
  const maxAge = opts.maxAge != null ? opts.maxAge : DEFAULT_MAX_AGE;
  const parts = [COOKIE_NAME + '=' + token, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=' + maxAge];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie(opts) {
  opts = opts || {};
  const parts = [COOKIE_NAME + '=', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0'];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/* ---------------- guardas ---------------- */
function sendUnauthorized(res) {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
}

/* Devuelve el payload de sesión o null (y responde 401) si no es válida. */
function requireAdmin(req, res) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) { sendUnauthorized(res); return null; } // sin secreto → no autorizado (sin revelar el motivo)
  const token = readCookies(req)[COOKIE_NAME];
  if (!token) { sendUnauthorized(res); return null; }
  const payload = verifySessionToken(token, secret);
  if (!payload) { sendUnauthorized(res); return null; }
  return payload;
}

/* Defensa CSRF adicional: exige mismo origen cuando hay Origin/Referer. */
function sameOrigin(req) {
  const origin = (req.headers && req.headers.origin) || '';
  const referer = (req.headers && req.headers.referer) || '';
  const host = (req.headers && req.headers.host) || '';
  if (!origin && !referer) return true; // sin cabecera → SameSite=Strict ya protege
  try { return new URL(origin || referer).host === host; }
  catch (e) { return false; }
}

module.exports = {
  COOKIE_NAME, DEFAULT_MAX_AGE, isSecureEnv,
  verifyPassword, createSessionToken, verifySessionToken,
  readCookies, buildSessionCookie, clearSessionCookie,
  requireAdmin, sameOrigin
};
