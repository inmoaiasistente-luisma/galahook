'use strict';

/* =========================================================
   POST /api/admin-agency-booking-create
   ---------------------------------------------------------
   Registra una venta directa (agencia / teléfono / presencial).
   No pasa por Stripe: no crea PaymentIntent ni acepta uno.

   Autorizado para owner, admin y staff. La identidad del vendedor,
   la fecha contable y todos los estados los fija el SERVIDOR desde
   la sesión validada — el navegador no puede falsificarlos.

   Idempotente por (tenant_id, client_request_id) — reutiliza el
   índice único parcial de la migración 0003.
   ========================================================= */

const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { requireAdmin, sameOrigin } = require('./_lib/admin-auth');
const { notifyBooking } = require('./_lib/booking-email-service');
const catalog = require('./_lib/tour-catalog');
const {
  sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys,
  isUuid, isEmail, normalizeEmail, isNonEmptyString, isPositiveInt,
  isRealYmd, todayInGalapagos, getTenantId
} = require('./_lib/http');

const ALLOWED_KEYS = ['request_id', 'customer_name', 'customer_phone', 'customer_email',
  'tour_id', 'tour_name', 'booking_date', 'guests', 'amount_cents', 'payment_method', 'notes'];
const PAYMENT_METHODS = ['cash', 'card', 'bank_transfer', 'zelle', 'other'];
const MAX_GUESTS = 50;
const MAX_AMOUNT_CENTS = 100000000;      // $1,000,000
const PAST_DAYS = 365, FUTURE_DAYS = 730;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CODE_TRIES = 6;

/* Campos que el navegador NUNCA puede enviar (los decide el servidor). */
const STAFF_VIEW = ['booking_code', 'tour_name', 'booking_date', 'guests',
  'customer_name', 'customer_phone', 'customer_email', 'notes'];

function genBookingCode(year) {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return 'HA-' + year + '-' + s;
}
/* Desplaza una fecha YYYY-MM-DD un número de días (aritmética en UTC puro). */
function shiftYmd(ymd, days) {
  const p = String(ymd).split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function pick(row, keys) {
  const out = {};
  keys.forEach(function (k) { if (row && Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k]; });
  return out;
}
async function findByRequestId(supabase, tenant, requestId) {
  const { data, error } = await supabase
    .from('bookings').select('*')
    .eq('tenant_id', tenant).eq('client_request_id', requestId)
    .limit(1).maybeSingle();
  if (error) throw new Error('lookup failed');
  return data || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }

  // Los tres roles pueden registrar una venta directa.
  const session = await requireAdmin(req, res, ['owner', 'admin', 'staff']);
  if (!session) return;                                   // 401/403 ya enviado
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('agency-create', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }

  /* Cualquier clave no autorizada → 400. Esto bloquea payment_status,
     booking_status, sales_channel, sold_at, created_by_*, tenant_id,
     stripe_payment_intent_id, currency, booking_code, created_at, paid_at… */
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');

  const b = body;
  if (!isUuid(b.request_id)) return sendError(res, 400, 'INVALID_REQUEST_ID', 'request_id must be a valid UUID');
  if (!isNonEmptyString(b.customer_name, 2, 120)) return sendError(res, 400, 'INVALID_NAME', 'customer_name is required');
  if (!isNonEmptyString(b.customer_phone, 5, 40)) return sendError(res, 400, 'INVALID_PHONE', 'customer_phone is required');
  if (b.customer_email != null && b.customer_email !== '' && !isEmail(b.customer_email)) {
    return sendError(res, 400, 'INVALID_EMAIL', 'customer_email is invalid');
  }
  if (b.notes != null && (typeof b.notes !== 'string' || b.notes.length > 1000)) {
    return sendError(res, 400, 'INVALID_NOTES', 'notes is too long');
  }
  if (PAYMENT_METHODS.indexOf(b.payment_method) === -1) return sendError(res, 400, 'INVALID_PAYMENT_METHOD', 'Invalid payment_method');

  if (!isPositiveInt(b.guests) || b.guests > MAX_GUESTS) return sendError(res, 400, 'INVALID_GUESTS', 'guests must be between 1 and ' + MAX_GUESTS);
  if (!Number.isInteger(b.amount_cents) || b.amount_cents < 1 || b.amount_cents > MAX_AMOUNT_CENTS) {
    return sendError(res, 400, 'INVALID_AMOUNT', 'amount_cents is out of range');
  }

  // Fecha del tour: hasta 365 días atrás y 730 adelante (hora de Galápagos).
  if (!isRealYmd(b.booking_date)) return sendError(res, 400, 'INVALID_DATE', 'booking_date must be a real YYYY-MM-DD date');
  const today = todayInGalapagos();
  if (b.booking_date < shiftYmd(today, -PAST_DAYS)) return sendError(res, 400, 'DATE_TOO_OLD', 'booking_date is too far in the past');
  if (b.booking_date > shiftYmd(today, FUTURE_DAYS)) return sendError(res, 400, 'DATE_TOO_FAR', 'booking_date is too far in the future');

  /* Tour: si el id pertenece al catálogo autorizado, el nombre lo impone el
     servidor. Si no, es una venta personalizada con destino de texto libre. */
  let tourId = 'custom', tourName, unit = null;
  const fromCatalog = (b.tour_id && b.tour_id !== 'custom') ? catalog.getTour(b.tour_id) : null;
  if (b.tour_id && b.tour_id !== 'custom' && !fromCatalog) return sendError(res, 400, 'INVALID_TOUR', 'Unknown tour_id');
  if (fromCatalog) { tourId = fromCatalog.id; tourName = fromCatalog.name; unit = fromCatalog.unit; }
  else {
    if (!isNonEmptyString(b.tour_name, 2, 160)) return sendError(res, 400, 'INVALID_TOUR_NAME', 'tour_name is required');
    tourName = b.tour_name.trim();
  }

  try {
    const supabase = getSupabase();

    /* ---- idempotencia: mismo request_id no crea dos ventas ---- */
    const existing = await findByRequestId(supabase, tenant, b.request_id);
    if (existing) {
      const same = existing.sales_channel === 'agency'
        && existing.tour_id === tourId
        && String(existing.booking_date) === b.booking_date
        && existing.guests === b.guests
        && Number(existing.amount_cents) === Number(b.amount_cents)
        && existing.payment_method === b.payment_method;
      if (!same) return sendError(res, 409, 'REQUEST_ID_CONFLICT', 'This request_id was already used with different data');
      const view = session.role === 'staff' ? pick(existing, STAFF_VIEW) : existing;
      return sendJson(res, 200, { booking: view, duplicate: true });
    }

    /* ---- alta: TODO lo sensible lo fija el servidor ---- */
    const soldAt = new Date().toISOString();          // reloj del servidor, nunca del cliente
    const year = today.slice(0, 4);

    for (let attempt = 0; attempt < MAX_CODE_TRIES; attempt++) {
      const row = {
        booking_code: genBookingCode(year),
        tenant_id: tenant,
        client_request_id: b.request_id,
        request_type: 'booking',
        sales_channel: 'agency',
        tour_id: tourId,
        tour_name: tourName,
        unit: unit,
        booking_date: b.booking_date,
        guests: b.guests,
        customer_name: String(b.customer_name).trim(),
        customer_email: (b.customer_email && b.customer_email !== '') ? normalizeEmail(b.customer_email) : null,
        customer_phone: String(b.customer_phone).trim(),
        notes: (b.notes && b.notes.trim()) ? b.notes.trim() : null,
        amount_cents: b.amount_cents,
        currency: 'usd',
        payment_method: b.payment_method,
        payment_status: 'paid',
        booking_status: 'confirmed',
        stripe_payment_intent_id: null,
        paid_at: soldAt,
        sold_at: soldAt,
        created_by_user_id: session.user_id,
        created_by_name: session.full_name
      };

      const { data, error } = await supabase.from('bookings').insert(row).select().single();
      if (!error) {
        /* QR + correos. Un fallo NO invalida la venta ya registrada: se
           devuelve éxito y la notificación queda como failed para reintentar. */
        try { await notifyBooking(data, 'customer_agency_confirmation', 'owner_agency_notification'); }
        catch (e) { logServer('agency-create', 'notify failed'); }
        const view = session.role === 'staff' ? pick(data, STAFF_VIEW) : data;
        return sendJson(res, 200, { booking: view });
      }
      if (error.code === '23505') {
        const blob = (error.message || '') + ' ' + (error.details || '');
        if (blob.includes('client_request')) {                 // carrera con otra petición
          const again = await findByRequestId(supabase, tenant, b.request_id);
          if (again) {
            const view = session.role === 'staff' ? pick(again, STAFF_VIEW) : again;
            return sendJson(res, 200, { booking: view, duplicate: true });
          }
        }
        if (blob.includes('booking_code')) continue;           // colisión de código → reintentar
      }
      logServer('agency-create', error.message);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to save the booking');
    }
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to generate a booking code');
  } catch (err) {
    logServer('agency-create', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to save the booking');
  }
};
