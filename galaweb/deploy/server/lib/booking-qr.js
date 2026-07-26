'use strict';

/* =========================================================
   LOAN-IX Booking Engine — QR operativo de reserva
   ---------------------------------------------------------
   El token NO se almacena. Se compone de un identificador público
   opaco (public_id) + versión, firmado con HMAC-SHA256 usando
   QR_SIGNING_SECRET:

     payloadB64 = base64url("<public_id>.<token_version>")
     signature  = base64url( HMAC_SHA256(payloadB64, QR_SIGNING_SECRET) )
     token      = payloadB64 + "." + signature
     url        = PUBLIC_SITE_URL + "/checkin.html#t=" + token

   El token viaja en el FRAGMENTO (#), nunca en la query (?): el
   navegador no envía el fragmento al servidor en la carga inicial,
   así que no aparece en logs de acceso ni en cabeceras Referer.

   El token no contiene nombre, correo, teléfono, importe,
   booking_code, booking_id ni identificadores de Stripe.
   Rotar = token_version + 1 (invalida el anterior al instante).
   Revocar = active=false.

   NUNCA se registra el token completo en logs.
   ========================================================= */

const crypto = require('crypto');
const QRCode = require('qrcode');
const { getSupabase } = require('./supabase');

/* Estados de reserva que pueden tener y usar un QR. */
const QR_BOOKING_STATUSES = ['confirmed', 'completed'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GAL_OFFSET_HOURS = 6;      // Galápagos = UTC-6 fijo, sin horario de verano
const EXTRA_DAYS = 7;

function getQrSecret() {
  const s = process.env.QR_SIGNING_SECRET;
  if (!s) throw new Error('QR_SIGNING_SECRET no está configurada');
  return s;
}
function getPublicSiteUrl() {
  const u = process.env.PUBLIC_SITE_URL;
  if (!u) throw new Error('PUBLIC_SITE_URL no está configurada');
  return String(u).replace(/\/+$/, '');
}

/* ---------------- token ---------------- */
function signQrToken(publicId, tokenVersion) {
  const payload = Buffer.from(String(publicId) + '.' + String(tokenVersion)).toString('base64url');
  const sig = crypto.createHmac('sha256', getQrSecret()).update(payload).digest('base64url');
  return payload + '.' + sig;
}

/**
 * Verifica firma y formato. NO consulta la base de datos.
 * @returns {{publicId:string, tokenVersion:number}|null}
 */
function verifyQrToken(token) {
  try {
    if (typeof token !== 'string' || token.length < 8 || token.length > 512) return null;
    const dot = token.indexOf('.');
    if (dot < 1 || dot !== token.lastIndexOf('.')) return null;   // exactamente un separador
    const payload = token.slice(0, dot);
    const provided = Buffer.from(token.slice(dot + 1), 'base64url');
    const expected = crypto.createHmac('sha256', getQrSecret()).update(payload).digest();
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;

    const raw = Buffer.from(payload, 'base64url').toString('utf8');
    const sep = raw.lastIndexOf('.');
    if (sep < 1) return null;
    const publicId = raw.slice(0, sep);
    const tokenVersion = parseInt(raw.slice(sep + 1), 10);
    if (!UUID_RE.test(publicId)) return null;
    if (!Number.isInteger(tokenVersion) || tokenVersion < 1) return null;
    return { publicId: publicId, tokenVersion: tokenVersion };
  } catch (e) { return null; }
}

/* El token va SIEMPRE en el fragmento: nunca se genera una URL con "?t=". */
function buildQrUrl(token) { return getPublicSiteUrl() + '/checkin.html#t=' + token; }

/* ---------------- caducidad ----------------
   Fin del día de booking_date en Galápagos (UTC-6) + 7 días.
   23:59:59.999 local == 05:59:59.999 UTC del día siguiente. */
function computeExpiresAt(bookingDate) {
  if (!bookingDate) return null;
  const p = String(bookingDate).split('-');
  const y = +p[0], m = +p[1], d = +p[2];
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d + 1 + EXTRA_DAYS, GAL_OFFSET_HOURS - 1, 59, 59, 999)).toISOString();
}

/* ---------------- elegibilidad ---------------- */
function isQrEligible(booking) {
  return !!booking
    && booking.request_type === 'booking'
    && booking.payment_status === 'paid'
    && QR_BOOKING_STATUSES.indexOf(booking.booking_status) !== -1;
}

/* ---------------- acceso QR ----------------
   Crea la fila si no existe; nunca duplica (booking_id es UNIQUE). */
async function ensureBookingQrAccess(booking) {
  if (!isQrEligible(booking)) return null;
  const supabase = getSupabase();

  const found = await supabase.from('booking_qr_access').select('*')
    .eq('booking_id', booking.id).maybeSingle();
  if (found.error) throw new Error('qr lookup failed');
  if (found.data) return found.data;

  const row = {
    booking_id: booking.id,
    tenant_id: booking.tenant_id,
    expires_at: computeExpiresAt(booking.booking_date)
  };
  const ins = await supabase.from('booking_qr_access').insert(row).select().single();
  if (!ins.error) return ins.data;
  if (ins.error.code === '23505') {                       // carrera: ya la creó otra petición
    const again = await supabase.from('booking_qr_access').select('*')
      .eq('booking_id', booking.id).maybeSingle();
    if (again.data) return again.data;
  }
  throw new Error('qr create failed');
}

/**
 * Construye la URL firmada y el PNG del QR. No persiste el PNG.
 * @returns {Promise<{qrUrl:string, pngBuffer:Buffer, filename:string}>}
 */
async function generateBookingQrPng(access, bookingCode) {
  const token = signQrToken(access.public_id, access.token_version);
  const qrUrl = buildQrUrl(token);
  const pngBuffer = await QRCode.toBuffer(qrUrl, {
    type: 'png', width: 512, margin: 2, errorCorrectionLevel: 'M',
    color: { dark: '#11302f', light: '#ffffff' }
  });
  const safeCode = String(bookingCode || 'booking').replace(/[^A-Za-z0-9._-]/g, '');
  return { qrUrl: qrUrl, pngBuffer: pngBuffer, filename: 'hook-adventure-' + safeCode + '.png' };
}

module.exports = {
  QR_BOOKING_STATUSES, isQrEligible,
  signQrToken, verifyQrToken, buildQrUrl, computeExpiresAt,
  ensureBookingQrAccess, generateBookingQrPng
};
