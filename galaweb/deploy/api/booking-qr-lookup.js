'use strict';

/* =========================================================
   POST /api/booking-qr-lookup     body: { token }
   ---------------------------------------------------------
   Consulta operativa de una reserva a partir del QR.
   NO es público: exige sesión de owner, admin o staff + mismo origen.

   El token viaja en el CUERPO, nunca en la query string: así no queda
   en logs de acceso, historiales ni cabeceras Referer. Cualquier otro
   método responde 405. No se habilita CORS: sin cabeceras
   Access-Control-*, solo el propio sitio puede llamarlo.

   Acepta booking_status 'confirmed' y 'completed' (permite verificar
   una reserva después de marcar el tour como realizado).
   Rechaza pending_payment, new, cancelled, failed, refunded,
   processing y cualquier cotización.

   El token nunca se registra en logs ni se devuelve en la respuesta.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId } = require('../server/lib/http');
const { getSupabase } = require('../server/lib/supabase');
const { requireAdmin, sameOrigin } = require('../server/lib/admin-auth');
const { verifyQrToken, QR_BOOKING_STATUSES } = require('../server/lib/booking-qr');

const TOKEN_MIN = 8;
const TOKEN_MAX = 512;

/* Campos operativos que ve cualquier rol. */
const COMMON = ['booking_code', 'customer_name', 'customer_phone', 'customer_email',
  'tour_name', 'booking_date', 'guests', 'notes'];
/* Añadidos solo para owner/admin. */
const ADMIN_EXTRA = ['sales_channel', 'amount_cents', 'currency', 'payment_method',
  'payment_status', 'booking_status'];

function pick(row, keys) {
  const out = {};
  keys.forEach(function (k) { if (row && Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k]; });
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }

  const session = await requireAdmin(req, res, ['owner', 'admin', 'staff']);
  if (!session) return;                                   // 401/403 ya enviado
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('qr-lookup', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to read the code'); }

  /* 0) Cuerpo estricto: solo `token`. Nada de esto se registra en logs. */
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ['token'])) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  const token = body.token;
  if (typeof token !== 'string' || token.length < TOKEN_MIN || token.length > TOKEN_MAX) {
    return sendError(res, 400, 'QR_INVALID', 'Invalid code');
  }

  /* 1) Firma. Un token manipulado no llega a tocar la base de datos. */
  let parsed = null;
  try { parsed = verifyQrToken(token); }
  catch (e) { logServer('qr-lookup', 'verify: ' + (e && e.message)); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to read the code'); }
  if (!parsed) return sendError(res, 400, 'QR_INVALID', 'Invalid code');

  try {
    const supabase = getSupabase();

    /* 2) Acceso QR por public_id + tenant. */
    const acc = await supabase.from('booking_qr_access').select('*')
      .eq('public_id', parsed.publicId).eq('tenant_id', tenant).maybeSingle();
    if (acc.error) { logServer('qr-lookup', acc.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to read the code'); }
    const access = acc.data;
    // Mismo error genérico que una firma inválida: no revelamos si existe.
    if (!access) return sendError(res, 400, 'QR_INVALID', 'Invalid code');
    if (access.active !== true) return sendError(res, 403, 'QR_REVOKED', 'This code was revoked');
    if (Number(access.token_version) !== Number(parsed.tokenVersion)) return sendError(res, 400, 'QR_INVALID', 'Invalid code');
    if (access.expires_at && new Date(access.expires_at).getTime() <= Date.now()) {
      return sendError(res, 403, 'QR_EXPIRED', 'This code has expired');
    }

    /* 3) Reserva y estado operativo. */
    const bk = await supabase.from('bookings').select('*')
      .eq('id', access.booking_id).eq('tenant_id', tenant).maybeSingle();
    if (bk.error) { logServer('qr-lookup', bk.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to read the code'); }
    const booking = bk.data;
    if (!booking) return sendError(res, 400, 'QR_INVALID', 'Invalid code');
    // Reserva archivada (borrado lógico): mismo error genérico, no se puede hacer check-in.
    if (booking.deleted_at) return sendError(res, 400, 'QR_INVALID', 'Invalid code');

    const okState = booking.request_type === 'booking'
      && booking.payment_status === 'paid'
      && QR_BOOKING_STATUSES.indexOf(booking.booking_status) !== -1;
    if (!okState) return sendError(res, 409, 'BOOKING_NOT_CONFIRMED', 'This booking is not valid for check-in');

    /* 4) Traza de escaneo (best-effort: nunca impide mostrar la reserva). */
    try {
      await supabase.from('booking_qr_access').update({
        last_scanned_at: new Date().toISOString(),
        scan_count: (Number(access.scan_count) || 0) + 1
      }).eq('id', access.id);
    } catch (e) { logServer('qr-lookup', 'scan trace failed'); }

    /* 5) Proyección por rol (server-side). */
    const isStaff = session.role === 'staff';
    const data = pick(booking, isStaff ? COMMON : COMMON.concat(ADMIN_EXTRA));
    data.paid = true;
    data.confirmed = booking.booking_status === 'confirmed';
    data.completed = booking.booking_status === 'completed';

    return sendJson(res, 200, { booking: data, role: session.role });
  } catch (err) {
    logServer('qr-lookup', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to read the code');
  }
};
