'use strict';

/* =========================================================
   LOAN-IX Booking Engine — autenticación del panel admin
   ---------------------------------------------------------
   SERVER-ONLY. Multiusuario con Supabase Auth:
     · Las contraseñas viven en auth.users (Supabase Auth).
     · La AUTORIZACIÓN vive en public.admin_profiles
       (tenant_id + role + active) y se revalida en CADA petición.
     · La sesión es una cookie HttpOnly firmada con HMAC-SHA256
       (SESSION_SECRET). No contiene tokens de Supabase.

   El rol se lee SIEMPRE de la base de datos, nunca de la cookie:
   así una desactivación o un cambio de rol surten efecto en la
   siguiente petición sin esperar a que expire la sesión.
   ========================================================= */

const crypto = require('crypto');
const { getSupabase } = require('./supabase');
const { getTenantId, logServer } = require('./http');

const COOKIE_NAME = 'gha_admin_session';
const DEFAULT_MAX_AGE = 8 * 60 * 60; // 8 horas (segundos)
const ROLES = ['owner', 'admin', 'staff'];

/* ¿Entorno seguro (HTTPS)? En Vercel NODE_ENV='production' en prod y preview. */
function isSecureEnv() { return process.env.NODE_ENV === 'production'; }

/* ---------------- token de sesión (HMAC) ---------------- */
/**
 * @param {string} secret  SESSION_SECRET
 * @param {object} user    { user_id, email, full_name, role, tenant_id }
 */
function createSessionToken(secret, user, maxAgeSeconds) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (maxAgeSeconds || DEFAULT_MAX_AGE);
  const payload = {
    user_id: user.user_id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    tenant_id: user.tenant_id,
    iat: iat,
    exp: exp,
    sid: crypto.randomBytes(16).toString('hex')   // nonce
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
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

/* ---------------- perfil de autorización ---------------- */
/** Lee public.admin_profiles con la SECRET KEY. Lanza si la consulta falla. */
async function loadProfile(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('admin_profiles')
    .select('user_id,tenant_id,full_name,role,active')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error('profile lookup failed');
  return data || null;
}

/** true si el perfil es utilizable para el tenant indicado. */
function isProfileUsable(profile, tenant) {
  return !!profile && profile.active === true &&
    profile.tenant_id === tenant && ROLES.indexOf(profile.role) !== -1;
}

/* ---------------- respuestas ---------------- */
function sendUnauthorized(res) {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
}
function sendForbidden(res) {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'FORBIDDEN' }));
}

/* ---------------- guarda principal ---------------- */
/**
 * Verifica la cookie Y revalida el perfil contra la base de datos.
 * Devuelve { user_id, email, full_name, role, tenant_id } o null
 * (habiendo respondido ya 401/403). Fail-closed ante cualquier error.
 *
 * IMPORTANTE: es ASÍNCRONA — los llamadores deben usar `await`.
 */
async function requireAdmin(req, res, allowedRoles) {
  const allowed = allowedRoles && allowedRoles.length ? allowedRoles : ROLES;

  const secret = process.env.SESSION_SECRET;
  if (!secret) { sendUnauthorized(res); return null; }

  const token = readCookies(req)[COOKIE_NAME];
  if (!token) { sendUnauthorized(res); return null; }

  const payload = verifySessionToken(token, secret);
  if (!payload || !payload.user_id) { sendUnauthorized(res); return null; }

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('requireAdmin', e.message); sendUnauthorized(res); return null; }

  if (payload.tenant_id !== tenant) { sendUnauthorized(res); return null; }

  let profile;
  try { profile = await loadProfile(payload.user_id); }
  catch (e) { logServer('requireAdmin', e.message); sendUnauthorized(res); return null; }

  // active / tenant / rol válido → se toman de la BD, no de la cookie.
  if (!isProfileUsable(profile, tenant)) { sendUnauthorized(res); return null; }

  if (allowed.indexOf(profile.role) === -1) { sendForbidden(res); return null; }

  return {
    user_id: payload.user_id,
    email: payload.email,
    full_name: profile.full_name,
    role: profile.role,
    tenant_id: profile.tenant_id
  };
}

function requireOwner(req, res) { return requireAdmin(req, res, ['owner']); }
function requireOwnerOrAdmin(req, res) { return requireAdmin(req, res, ['owner', 'admin']); }

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
  COOKIE_NAME, DEFAULT_MAX_AGE, ROLES, isSecureEnv,
  createSessionToken, verifySessionToken,
  readCookies, buildSessionCookie, clearSessionCookie,
  loadProfile, isProfileUsable,
  requireAdmin, requireOwner, requireOwnerOrAdmin,
  sendUnauthorized, sendForbidden, sameOrigin
};
