'use strict';

/* =========================================================
   POST /api/quote-request
   ---------------------------------------------------------
   Solo para experiencias de cotización (requiresQuote === true):
   toda la pesca deportiva (half, full, expedition), el Private Boat
   Charter y cualquier otra experiencia sin precio de catálogo.
   No crea PaymentIntent. Guarda la solicitud como request_type='quote'.
   Idempotente por (tenant_id, client_request_id).
   ========================================================= */

const crypto = require('crypto');
const { getSupabase } = require('../server/lib/supabase');
const { notifyBooking } = require('../server/lib/booking-email-service');
const catalog = require('../server/lib/tour-catalog');
const {
  sendJson, sendError, logServer, methodNotAllowed, readJsonBody, rejectUnknownKeys,
  isUuid, isEmail, normalizeEmail, isNonEmptyString, isPositiveInt,
  isRealYmd, isNotPastGalapagos, todayInGalapagos, getTenantId
} = require('../server/lib/http');

const ALLOWED_KEYS = ['request_id', 'tour_id', 'booking_date', 'guests',
  'customer_name', 'customer_email', 'customer_phone', 'notes'];
const MAX_GUESTS = 20;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CODE_TRIES = 6;

function genBookingCode(year) {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return 'HA-' + year + '-' + s;
}

async function fetchByRequestId(supabase, tenant, requestId) {
  const { data, error } = await supabase
    .from('bookings').select('*')
    .eq('tenant_id', tenant).eq('client_request_id', requestId)
    .limit(1).maybeSingle();
  if (error) throw new Error('lookup failed: ' + (error.message || 'unknown'));
  return data || null;
}

function quoteDataMismatch(row, exp) {
  return row.request_type !== 'quote'
    || row.tour_id !== exp.tour_id
    || String(row.booking_date) !== exp.booking_date
    || row.guests !== exp.guests
    || row.customer_email !== exp.emailNorm;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return methodNotAllowed(res);

    const tenant = getTenantId();

    let body;
    try { body = await readJsonBody(req); }
    catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON'); }

    if (rejectUnknownKeys(body, ALLOWED_KEYS)) {
      return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
    }

    const { request_id, tour_id, booking_date, guests,
      customer_name, customer_email, customer_phone, notes } = body;

    if (!isUuid(request_id)) return sendError(res, 400, 'INVALID_REQUEST_ID', 'request_id must be a valid UUID');

    const tour = catalog.getTour(tour_id);
    if (!tour) return sendError(res, 400, 'INVALID_TOUR', 'Unknown tour_id');
    // Solo experiencias de cotización. Un tour pagable NO puede enviarse aquí.
    if (!tour.requiresQuote) return sendError(res, 400, 'PAYMENT_REQUIRED', 'This experience must be paid; use create-payment-intent');

    if (!isRealYmd(booking_date)) return sendError(res, 400, 'INVALID_DATE', 'booking_date must be a real YYYY-MM-DD date');
    if (!isNotPastGalapagos(booking_date)) return sendError(res, 400, 'DATE_IN_PAST', 'booking_date cannot be in the past');

    if (!isPositiveInt(guests)) return sendError(res, 400, 'INVALID_GUESTS', 'guests must be a positive integer');
    if (guests > MAX_GUESTS) return sendError(res, 400, 'GUESTS_TOO_MANY', 'guests exceeds the maximum allowed');

    if (!isNonEmptyString(customer_name, 2, 120)) return sendError(res, 400, 'INVALID_NAME', 'customer_name is required');
    if (!isEmail(customer_email)) return sendError(res, 400, 'INVALID_EMAIL', 'customer_email must be valid');
    if (customer_phone != null && (typeof customer_phone !== 'string' || customer_phone.length > 40)) {
      return sendError(res, 400, 'INVALID_PHONE', 'customer_phone is invalid');
    }
    if (notes != null && (typeof notes !== 'string' || notes.length > 1000)) {
      return sendError(res, 400, 'INVALID_NOTES', 'notes is too long');
    }

    const emailNorm = normalizeEmail(customer_email);
    const expected = { tour_id, booking_date, guests, emailNorm };

    const supabase = getSupabase();

    /* ---- idempotencia ---- */
    let row = await fetchByRequestId(supabase, tenant, request_id);
    if (row) {
      if (quoteDataMismatch(row, expected)) {
        return sendError(res, 409, 'REQUEST_ID_CONFLICT', 'This request_id was already used with different data');
      }
      return sendJson(res, 200, { bookingCode: row.booking_code, status: 'quote_received' });
    }

    const year = todayInGalapagos().slice(0, 4);
    let insertConflict = false;
    for (let attempt = 0; attempt < MAX_CODE_TRIES; attempt++) {
      const candidate = {
        booking_code: genBookingCode(year),
        tenant_id: tenant,
        client_request_id: request_id,
        request_type: 'quote',
        tour_id: tour.id,
        tour_name: tour.name,
        unit: tour.unit,
        booking_date: booking_date,
        guests: guests,
        customer_name: customer_name.trim(),
        customer_email: emailNorm,
        customer_phone: customer_phone || null,
        notes: notes || null,
        amount_cents: null,
        currency: catalog.CURRENCY,
        payment_status: 'not_required',
        booking_status: 'new'
      };
      const { data: inserted, error } = await supabase.from('bookings').insert(candidate).select().single();
      if (!error) {
        /* Correos (sin QR). Un fallo NO invalida la cotización ya creada:
           queda registrado como failed y se puede reintentar desde el panel. */
        try { await notifyBooking(inserted, 'customer_quote_acknowledgement', 'owner_quote_notification'); }
        catch (e) { logServer('quote-request', 'notify failed'); }
        return sendJson(res, 200, { bookingCode: inserted.booking_code, status: 'quote_received' });
      }
      if (error.code === '23505') {
        const blob = (error.message || '') + ' ' + (error.details || '');
        if (blob.includes('client_request')) { insertConflict = true; break; }
        if (blob.includes('booking_code')) { continue; }
        throw new Error('insert unique violation: ' + (error.message || ''));
      }
      throw new Error('insert failed: ' + (error.message || 'unknown'));
    }

    if (insertConflict) {
      row = await fetchByRequestId(supabase, tenant, request_id);
      if (row) {
        if (quoteDataMismatch(row, expected)) {
          return sendError(res, 409, 'REQUEST_ID_CONFLICT', 'This request_id was already used with different data');
        }
        return sendJson(res, 200, { bookingCode: row.booking_code, status: 'quote_received' });
      }
    }
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to save the quote request');
  } catch (err) {
    logServer('quote-request', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to process the request');
  }
};
