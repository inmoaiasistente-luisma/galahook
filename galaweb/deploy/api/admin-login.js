'use strict';

/* =========================================================
   POST /api/admin-login  — body: { email, password }
   ---------------------------------------------------------
   Autentica contra Supabase Auth (las contraseñas viven allí) y
   autoriza contra public.admin_profiles (tenant + rol + active).
   Emite nuestra propia cookie de sesión firmada; NO guarda los
   tokens de Supabase.
   ========================================================= */

const { createClient } = require('@supabase/supabase-js');
const { getSupabase } = require('./_lib/supabase');
const { sendJson, sendError, logServer, readJsonBody, isEmail, normalizeEmail, getTenantId } = require('./_lib/http');
const { createSessionToken, buildSessionCookie, isSecureEnv, sameOrigin, loadProfile, isProfileUsable, DEFAULT_MAX_AGE } = require('./_lib/admin-auth');

/* Throttle básico en memoria (por instancia; sin infraestructura extra).
   Supabase Auth aplica además sus propios límites. */
const attempts = new Map(); // ip -> { count, ts }
const WINDOW_MS = 10 * 60 * 1000;
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function clientIp(req) { return String((req.headers['x-forwarded-for'] || '')).split(',')[0].trim() || 'unknown'; }
function currentDelay(ip) {
  const a = attempts.get(ip);
  if (!a || (Date.now() - a.ts) > WINDOW_MS) return 300;
  return Math.min(300 + a.count * 400, 3000);
}
function noteFailure(ip) {
  const a = attempts.get(ip);
  if (!a || (Date.now() - a.ts) > WINDOW_MS) attempts.set(ip, { count: 1, ts: Date.now() });
  else { a.count += 1; a.ts = Date.now(); }
}
function noteSuccess(ip) { attempts.delete(ip); }

/* Cliente Auth NUEVO por petición: un cliente compartido guardaría la sesión
   en memoria y podría filtrarse entre peticiones concurrentes. */
function newAuthClient() {
  const url = process.env.SUPABASE_URL;
  const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishable) throw new Error('SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY no están configuradas');
  return createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return sendError(res, 400, 'INVALID_BODY', 'Invalid body');

  // Exclusivamente email + password.
  const keys = Object.keys(body).sort();
  if (keys.length !== 2 || keys[0] !== 'email' || keys[1] !== 'password') return sendError(res, 400, 'INVALID_BODY', 'Invalid body');
  const password = body.password;
  if (!isEmail(body.email)) return sendError(res, 400, 'INVALID_BODY', 'Invalid body');
  if (typeof password !== 'string' || password.length < 1 || password.length > 200) return sendError(res, 400, 'INVALID_BODY', 'Invalid body');
  const email = normalizeEmail(body.email);

  const ip = clientIp(req);
  await sleep(currentDelay(ip)); // demora mínima anti fuerza bruta

  let tenant, secret;
  try {
    tenant = getTenantId();
    secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error('SESSION_SECRET no está configurada');
  } catch (e) { logServer('admin-login', e.message); return sendError(res, 500, 'SERVER_ERROR', 'Server error'); }

  let auth;
  try { auth = newAuthClient(); }
  catch (e) { logServer('admin-login', e.message); return sendError(res, 500, 'SERVER_ERROR', 'Server error'); }

  // 1) Autenticación (Supabase Auth)
  let signIn;
  try { signIn = await auth.auth.signInWithPassword({ email: email, password: password }); }
  catch (e) { logServer('admin-login', 'signIn threw'); return sendError(res, 500, 'SERVER_ERROR', 'Server error'); }

  if (signIn.error || !signIn.data || !signIn.data.user) {
    noteFailure(ip);
    // Mensaje idéntico para correo inexistente y contraseña incorrecta.
    return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const userId = signIn.data.user.id;

  // La sesión de Supabase no se usa: emitimos la nuestra. Revocamos el refresh token.
  try { await auth.auth.signOut(); } catch (e) { /* best-effort */ }

  // 2) Autorización (public.admin_profiles)
  let profile;
  try { profile = await loadProfile(userId); }
  catch (e) { logServer('admin-login', e.message); return sendError(res, 500, 'SERVER_ERROR', 'Server error'); }

  if (!isProfileUsable(profile, tenant)) {
    return sendError(res, 403, 'NO_ACCESS', 'You do not have access to this panel');
  }

  // 3) last_login_at (best-effort: no debe impedir el acceso)
  try { await getSupabase().from('admin_profiles').update({ last_login_at: new Date().toISOString() }).eq('user_id', userId); }
  catch (e) { logServer('admin-login', 'last_login_at update failed'); }

  noteSuccess(ip);

  // 4) Cookie de sesión propia (sin tokens de Supabase)
  const token = createSessionToken(secret, {
    user_id: userId, email: email, full_name: profile.full_name,
    role: profile.role, tenant_id: profile.tenant_id
  }, DEFAULT_MAX_AGE);
  res.setHeader('Set-Cookie', buildSessionCookie(token, { maxAge: DEFAULT_MAX_AGE, secure: isSecureEnv() }));

  return sendJson(res, 200, {
    authenticated: true,
    user: { full_name: profile.full_name, email: email, role: profile.role }
  });
};
