'use strict';

/* =========================================================
   LOAN-IX Booking Engine — utilidades HTTP y validación
   ---------------------------------------------------------
   Framework-free. Respuestas seguras: nunca stack traces ni
   secretos hacia el navegador. Los detalles se registran solo
   del lado del servidor con logServer().
   ========================================================= */

/* ---------------- respuestas ---------------- */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

/** Error seguro: { error: <CODE>, message }. Sin stack ni secretos. */
function sendError(res, status, code, message) {
  sendJson(res, status, { error: code, message: message || code });
}

/** Log SOLO del lado del servidor (nunca llega al cliente). */
function logServer(context, err) {
  const msg = err && err.message ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error('[' + context + '] ' + msg);
}

function methodNotAllowed(res) {
  res.setHeader('Allow', 'POST');
  sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed');
}

/* ---------------- body ---------------- */
async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/** Rechaza claves no esperadas. Devuelve string de error o null. */
function rejectUnknownKeys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Invalid JSON body';
  const allow = new Set(allowed);
  for (const k of Object.keys(body)) {
    if (!allow.has(k)) return 'Unexpected field: ' + k;
  }
  return null;
}

/* ---------------- validadores ---------------- */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function isEmail(v) { return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v); }
function normalizeEmail(v) { return String(v).trim().toLowerCase(); }

/* Enmascara un email para mostrarlo en el panel sin exponerlo completo:
   "maria@example.com" -> "m•••a@example.com". Conserva el dominio (ayuda a
   identificar) y oculta la parte local. */
function maskEmail(v) {
  const s = String(v == null ? '' : v).trim();
  const at = s.indexOf('@');
  if (at < 1) return s ? '•••' : '';
  const name = s.slice(0, at), dom = s.slice(at + 1);
  const head = name.slice(0, 1);
  const tail = name.length > 2 ? name.slice(-1) : '';
  return head + '•••' + tail + '@' + dom;
}

/* Sanea un mensaje de error del proveedor para mostrarlo sin filtrar
   secretos: elimina posibles claves/tokens y trunca. Nunca payloads. */
function sanitizeErrorText(v) {
  let s = String(v == null ? '' : v);
  s = s.replace(/\b(sk|pk|rk|re|whsec)_[A-Za-z0-9]+/g, '[redacted]')   // claves Stripe/Resend
       .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
       .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]')                     // blobs largos (tokens)
       .replace(/\s+/g, ' ').trim();
  return s.slice(0, 200);
}

function isNonEmptyString(v, min, max) {
  if (typeof v !== 'string') return false;
  const n = v.trim().length;
  return n >= min && n <= max;
}

function isPositiveInt(v) { return Number.isInteger(v) && v > 0; }

/* fecha estricta YYYY-MM-DD y real (valida días por mes / bisiestos) */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isRealYmd(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const y = Number(v.slice(0, 4)), m = Number(v.slice(5, 7)), d = Number(v.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === (m - 1) && dt.getUTCDate() === d;
}

/* Galápagos (Ecuador) es permanentemente UTC-6 y NO observa horario de verano.
   Usamos ese offset fijo en lugar de la base de zonas horarias (ICU) para que el
   cálculo sea determinista y portable, aplicando explícitamente el horario local
   de Galápagos (no una comparación en UTC puro). */
const GALAPAGOS_UTC_OFFSET_MINUTES = -6 * 60;

/** Fecha calendario "hoy" en Galápagos (UTC-6) como 'YYYY-MM-DD'. */
function todayInGalapagos() {
  const shifted = new Date(Date.now() + GALAPAGOS_UTC_OFFSET_MINUTES * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

/** true si ymd NO es anterior a hoy en Galápagos (comparación por fecha calendario). */
function isNotPastGalapagos(ymd) {
  return String(ymd) >= todayInGalapagos();  // strings YYYY-MM-DD → orden correcto
}

/* ---------------- tenant ---------------- */
/** TENANT_ID obligatorio (sin fallback). Lanza si falta. */
function getTenantId() {
  const t = process.env.TENANT_ID;
  if (!t) throw new Error('TENANT_ID no está configurada');
  return t;
}

module.exports = {
  sendJson, sendError, logServer, methodNotAllowed, readJsonBody, rejectUnknownKeys,
  isUuid, isEmail, normalizeEmail, maskEmail, sanitizeErrorText, isNonEmptyString, isPositiveInt,
  isRealYmd, todayInGalapagos, isNotPastGalapagos, getTenantId
};
