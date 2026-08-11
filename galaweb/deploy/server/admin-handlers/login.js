'use strict';

/* =========================================================
   POST /api/admin-login  — body: { email, password }
   ---------------------------------------------------------
   Autentica contra Supabase Auth (las contraseñas viven allí) y
   autoriza contra public.admin_profiles (tenant + rol + active).
   Emite nuestra propia cookie de sesión firmada; NO guarda los
   tokens de Supabase.

   Anti fuerza bruta: throttle DURABLE respaldado por rate_limit_hits
   (compartido entre instancias serverless), por (IP real + email).
   La IP se toma de una fuente CONFIABLE (no el primer hop de XFF,
   que es falsificable). Mensaje idéntico para credenciales inválidas y
   para credenciales válidas sin acceso (no se revela si la cuenta existe).
   ========================================================= */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { getSupabase } = require('../lib/supabase');
const { sendJson, sendError, logServer, readJsonBody, isEmail, normalizeEmail, getTenantId, clientIp } = require('../lib/http');
const { createSessionToken, buildSessionCookie, isSecureEnv, sameOrigin, loadProfile, isProfileUsable, DEFAULT_MAX_AGE } = require('../lib/admin-auth');

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* Throttle durable de login (BD, cross-instancia). Cuenta FALLOS por
   (IP real + email) en una ventana; al superar el máximo → 429. Fail-open:
   si la BD falla, no bloquea al usuario legítimo (la seguridad real la dan
   la contraseña y los límites de Supabase Auth). */
const LOGIN_WINDOW_SEC = 15 * 60;
const LOGIN_MAX_FAILS = 10;
function loginBucket(ip, email) {
  return 'login:' + crypto.createHash('sha256').update(String(ip) + '|' + String(email)).digest('hex').slice(0, 40);
}
async function tooManyFailures(bucket) {
  try {
    const sinceIso = new Date(Date.now() - LOGIN_WINDOW_SEC * 1000).toISOString();
    const cnt = await getSupabase().from('rate_limit_hits')
      .select('id', { count: 'exact', head: true })
      .eq('bucket_key', bucket).gte('created_at', sinceIso);
    if (cnt.error) return false;                       // fail-open
    return (cnt.count || 0) >= LOGIN_MAX_FAILS;
  } catch (e) { return false; }                         // fail-open
}
async function noteLoginFailure(tenant, bucket) {
  try { await getSupabase().from('rate_limit_hits').insert({ tenant_id: tenant, bucket_key: bucket }); } catch (e) { /* best-effort */ }
}
async function clearLoginFailures(bucket) {
  try { await getSupabase().from('rate_limit_hits').delete().eq('bucket_key', bucket); } catch (e) { /* best-effort */ }
}

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

  let tenant, secret;
  try {
    tenant = getTenantId();
    secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error('SESSION_SECRET no está configurada');
  } catch (e) { logServer('admin-login', e.message); return sendError(res, 500, 'SERVER_ERROR', 'Server error'); }

  // Anti fuerza bruta (IP CONFIABLE + email), durable.
  const ip = clientIp(req.headers);
  const bucket = loginBucket(ip, email);
  if (await tooManyFailures(bucket)) return sendError(res, 429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Please try again later.');
  await sleep(300); // demora constante mínima

  let auth;
  try { auth = newAuthClient(); }
  catch (e) { logServer('admin-login', e.message); return sendError(res, 500, 'SERVER_ERROR', 'Server error'); }

  // 1) Autenticación (Supabase Auth)
  let signIn;
  try { signIn = await auth.auth.signInWithPassword({ email: email, password: password }); }
  catch (e) { logServer('admin-login', 'signIn threw'); return sendError(res, 500, 'SERVER_ERROR', 'Server error'); }

  if (signIn.error || !signIn.data || !signIn.data.user) {
    await noteLoginFailure(tenant, bucket);
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
    // MISMO error que credenciales inválidas: no revelamos que la cuenta existe
    // ni que carece de acceso. El motivo real queda solo en el log del servidor.
    logServer('admin-login', 'auth ok but no usable profile for user ' + userId);
    return sendError(res, 401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  // 3) last_login_at (best-effort: no debe impedir el acceso)
  try { await getSupabase().from('admin_profiles').update({ last_login_at: new Date().toISOString() }).eq('user_id', userId); }
  catch (e) { logServer('admin-login', 'last_login_at update failed'); }

  await clearLoginFailures(bucket); // login correcto → limpia el contador

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
