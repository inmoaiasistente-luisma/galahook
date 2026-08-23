'use strict';

/* =========================================================
   POST /api/contact-message
     body: { name, email?, phone?, interest?, message?, source?,
             source_page?, lang?, company? (honeypot) }
   ---------------------------------------------------------
   Endpoint PÚBLICO de "pedido interno". Reemplaza el enlace directo a
   WhatsApp: cada mensaje del sitio (formulario de contacto y aviso de
   visitante recurrente) se GUARDA en contact_messages, avisa al buzón del
   owner (reply-to = cliente) y envía una confirmación automática al cliente
   si dejó email. El panel "Mensajes" (owner y admin) los gestiona.

   PRIVACIDAD: solo lo que el visitante escribe (nombre, email/WhatsApp,
   interés, mensaje) + país aproximado (cabecera geo). No guarda IP.

   Defensa: sameOrigin (CSRF) + honeypot 'company' + rate-limit por IP
   hasheada (fail-open). Debe haber al menos email O teléfono (chk_cm_contact).
   ========================================================= */

const crypto = require('crypto');
const {
  sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys,
  getTenantId, isEmail, normalizeEmail, isNonEmptyString
} = require('../server/lib/http');
const { getSupabase } = require('../server/lib/supabase');
const { sameOrigin } = require('../server/lib/admin-auth');
const { checkRateLimit } = require('../server/lib/rate-limit');
const { countryFromHeaders, clientIp, sanitizePath } = require('../server/lib/visit-tracking');
const { sendContactEmails } = require('../server/lib/contact-notify');

const ALLOWED_KEYS = ['name', 'email', 'phone', 'interest', 'message', 'source', 'source_page', 'lang', 'company'];
const SOURCES = ['contact_form', 'visit_nudge'];
const LANGS = ['en', 'es'];

const NAME_MAX = 120;
const INTEREST_MAX = 160;
const MESSAGE_MAX = 4000;

/* Teléfono/WhatsApp: normaliza a "+? dígitos". Devuelve texto saneado o null.
   Acepta espacios, guiones y paréntesis de entrada; exige 7–18 dígitos. */
function normalizePhone(v) {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.length > 32) return null;
  const hasPlus = trimmed.charAt(0) === '+';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 18) return null;
  return (hasPlus ? '+' : '') + digits;
}

/* Clave de limitador: hash de la IP (nunca en claro), espacio propio. */
function rateBucket(ip) {
  const h = crypto.createHash('sha256').update('contact:' + String(ip || '')).digest('hex');
  return 'contact:' + h.slice(0, 40);
}

function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');  // control chars (deja \n\t)
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let body;
  try { body = await readJsonBody(req); }
  catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON body'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected field');

  // Honeypot: los bots rellenan 'company' (invisible para humanos). Fingimos éxito.
  if (typeof body.company === 'string' && body.company.trim() !== '') {
    return sendJson(res, 200, { ok: true });
  }

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('contact-message', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const headers = req.headers || {};

  // Rate-limit por IP hasheada. Fail-open (no bloquea si el limitador falla).
  try {
    const rl = await checkRateLimit({ tenant: tenant, bucketKey: rateBucket(clientIp(headers)), limit: 8, windowSeconds: 600 });
    if (rl && rl.allowed === false) {
      if (rl.retryAfter) res.setHeader('Retry-After', String(rl.retryAfter));
      return sendError(res, 429, 'RATE_LIMITED', 'Too many messages, please try again later');
    }
  } catch (e) { /* fail-open */ }

  // ---- validación ----
  if (!isNonEmptyString(body.name, 1, NAME_MAX)) {
    return sendError(res, 400, 'INVALID_NAME', 'Name is required');
  }
  const name = body.name.trim();

  const email = isEmail(normalizeEmail(body.email || '')) ? normalizeEmail(body.email) : null;
  const phone = normalizePhone(body.phone || '');
  if (!email && !phone) {
    return sendError(res, 400, 'CONTACT_REQUIRED', 'Provide an email or a phone/WhatsApp number');
  }

  const source = SOURCES.indexOf(body.source) !== -1 ? body.source : 'contact_form';
  const lang = LANGS.indexOf(body.lang) !== -1 ? body.lang : null;

  const row = {
    tenant_id: tenant,
    name: name,
    email: email,
    phone: phone,
    interest: cleanText(body.interest, INTEREST_MAX),
    message: cleanText(body.message, MESSAGE_MAX),
    source: source,
    source_page: sanitizePath(body.source_page),
    lang: lang,
    country: countryFromHeaders(headers),
    status: 'new'
  };

  // ---- guardar ----
  let saved;
  try {
    const supabase = getSupabase();
    const ins = await supabase.from('contact_messages').insert(row).select('id').single();
    if (ins.error) { logServer('contact-message', ins.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    saved = ins.data;
  } catch (err) {
    logServer('contact-message', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }

  // ---- avisos por correo (best-effort: no bloquean la respuesta) ----
  try { await sendContactEmails(row); }
  catch (e) { logServer('contact-message', 'emails: ' + (e && e.message)); }

  return sendJson(res, 201, { ok: true, id: saved && saved.id });
};
