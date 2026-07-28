'use strict';

/* =========================================================
   POST /api/create-payment-intent
   ---------------------------------------------------------
   Crea (o reutiliza de forma idempotente) una reserva pending
   y su Stripe PaymentIntent. El precio se calcula SIEMPRE en el
   servidor desde el catálogo autorizado. La confirmación de la
   tarjeta ocurre en el navegador con Stripe Elements (sin redirect).
   ========================================================= */

const crypto = require('crypto');
const { getStripe } = require('../server/lib/stripe');
const { getSupabase } = require('../server/lib/supabase');
const catalog = require('../server/lib/tour-catalog');
const { computeWebPricing } = require('../server/lib/pricing-engine');
const { resolveNotesForBooking } = require('../server/lib/tour-notes');
const { isStripeTestMode } = require('../server/lib/runtime-mode');
const {
  sendJson, sendError, logServer, methodNotAllowed, readJsonBody, rejectUnknownKeys,
  isUuid, isEmail, normalizeEmail, isNonEmptyString, isPositiveInt,
  isRealYmd, isNotPastGalapagos, todayInGalapagos, getTenantId
} = require('../server/lib/http');

const ALLOWED_KEYS = ['request_id', 'tour_id', 'booking_date', 'guests',
  'customer_name', 'customer_email', 'customer_phone', 'notes', 'notes_ack'];
const MAX_GUESTS = 20;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I ambiguos
const MAX_CODE_TRIES = 6;
const REUSABLE_PI_STATUSES = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing'];

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

/* Detecta si el MISMO request_id se reutiliza con datos DISTINTOS. No
   compara amount_cents a propósito: el importe se deriva de tour+guests,
   y si una regla de descuento cambió entre intentos NO es "otro dato" —
   es la misma solicitud. La reserva conserva su snapshot e importe
   originales (no se recalcula con la regla nueva). */
function bookingDataMismatch(row, exp) {
  return row.request_type !== 'booking'
    || row.tour_id !== exp.tour_id
    || String(row.booking_date) !== exp.booking_date
    || row.guests !== exp.guests
    || row.customer_email !== exp.emailNorm;
}

async function markFailed(supabase, id) {
  try {
    await supabase.from('bookings')
      .update({ payment_status: 'failed', booking_status: 'failed' })
      .eq('id', id);
  } catch (e) { logServer('markFailed', e); }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return methodNotAllowed(res);

    const tenant = getTenantId(); // lanza si falta TENANT_ID → catch → 500 seguro

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
    if (tour.requiresQuote) return sendError(res, 400, 'QUOTE_REQUIRED', 'This experience requires a quote request');

    if (!isRealYmd(booking_date)) return sendError(res, 400, 'INVALID_DATE', 'booking_date must be a real YYYY-MM-DD date');
    if (!isNotPastGalapagos(booking_date)) return sendError(res, 400, 'DATE_IN_PAST', 'booking_date cannot be in the past');

    if (!isPositiveInt(guests)) return sendError(res, 400, 'INVALID_GUESTS', 'guests must be a positive integer');
    if (guests < tour.minGuests) return sendError(res, 400, 'GUESTS_BELOW_MIN', 'guests is below the minimum for this experience');
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
    const stripe = getStripe();

    /* Precio SIEMPRE del motor único (bruto, descuento, total, costo,
       snapshot). El navegador nunca envía importes. */
    let pricing;
    try { pricing = await computeWebPricing({ tenantId: tenant, tourId: tour.id, guests: guests }); }
    catch (e) {
      if (e && e.message === 'QUOTE_ONLY') return sendError(res, 400, 'QUOTE_REQUIRED', 'This experience requires a quote request');
      logServer('pricing', e && e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to price the booking');
    }

    /* ---- idempotencia por (tenant_id, client_request_id) ---- */
    let row = await fetchByRequestId(supabase, tenant, request_id);
    let freshlyInserted = false;

    if (!row) {
      /* Gate + snapshot de notas (server-authoritative): si alguna nota activa
         exige aceptación y no se aceptó (o la versión no coincide), se rechaza.
         El snapshot se congela en la reserva; cambiar notas después no la altera. */
      const ackIn = (body.notes_ack && typeof body.notes_ack === 'object') ? body.notes_ack : {};
      let notesResolved;
      try {
        notesResolved = await resolveNotesForBooking({
          tenant: tenant, tourId: tour.id,
          acknowledged: ackIn.acknowledged === true, ackVersion: ackIn.version
        });
      } catch (e) { logServer('notes', e && e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to load booking notes'); }
      if (notesResolved.error) return sendError(res, 400, notesResolved.error, 'Please review and accept the important notes');

      const year = todayInGalapagos().slice(0, 4);
      let insertConflict = false;
      for (let attempt = 0; attempt < MAX_CODE_TRIES; attempt++) {
        const candidate = {
          booking_code: genBookingCode(year),
          tenant_id: tenant,
          client_request_id: request_id,
          request_type: 'booking',
          tour_id: tour.id,
          tour_name: tour.name,
          unit: tour.unit,
          booking_date: booking_date,
          guests: guests,
          customer_name: customer_name.trim(),
          customer_email: emailNorm,
          customer_phone: customer_phone || null,
          notes: notes || null,
          amount_cents: pricing.amountCents,
          gross_amount_cents: pricing.grossAmountCents,
          discount_cents: pricing.discountCents,
          discount_rule_id: pricing.appliedDiscount ? pricing.appliedDiscount.id : null,
          cost_cents: pricing.costCents,
          pricing_snapshot: pricing.pricingSnapshot,
          currency: catalog.CURRENCY,
          payment_status: 'pending',
          booking_status: 'pending_payment',
          is_test: isStripeTestMode(),   // TRUE mientras el sistema use Stripe TEST; false en LIVE
          important_notes_snapshot: notesResolved.snapshot,
          notes_acknowledged_at: notesResolved.acknowledgedAt,
          notes_acknowledgement_version: notesResolved.acknowledgementVersion
        };
        const { data: inserted, error } = await supabase.from('bookings').insert(candidate).select().single();
        if (!error) { row = inserted; freshlyInserted = true; break; }
        if (error.code === '23505') {
          const blob = (error.message || '') + ' ' + (error.details || '');
          if (blob.includes('client_request')) { insertConflict = true; break; } // otra llamada concurrente
          if (blob.includes('booking_code')) { continue; }                        // colisión de código → reintentar
          throw new Error('insert unique violation: ' + (error.message || ''));
        }
        throw new Error('insert failed: ' + (error.message || 'unknown'));
      }
      if (insertConflict) row = await fetchByRequestId(supabase, tenant, request_id);
      if (!row) return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to create the booking');
    }

    if (!freshlyInserted) {
      // Fila existente (previa o insertada por una llamada concurrente).
      if (bookingDataMismatch(row, expected)) {
        return sendError(res, 409, 'REQUEST_ID_CONFLICT', 'This request_id was already used with different data');
      }
      if (row.stripe_payment_intent_id) {
        let pi;
        try { pi = await stripe.paymentIntents.retrieve(row.stripe_payment_intent_id); }
        catch (e) { logServer('pi-retrieve', e); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to load payment status'); }

        if (pi.status === 'succeeded') {
          return sendJson(res, 200, { alreadyPaid: true, bookingCode: row.booking_code, amountCents: row.amount_cents, currency: row.currency, tourName: tour.name });
        }
        if (pi.status === 'canceled') {
          return sendError(res, 409, 'PAYMENT_ATTEMPT_CANCELED', 'This payment attempt was canceled');
        }
        if (REUSABLE_PI_STATUSES.indexOf(pi.status) !== -1) {
          return sendJson(res, 200, { clientSecret: pi.client_secret, bookingCode: row.booking_code, amountCents: row.amount_cents, currency: row.currency, tourName: tour.name });
        }
        logServer('pi-status', new Error('unexpected PI status: ' + pi.status));
        return sendError(res, 409, 'PAYMENT_ATTEMPT_UNAVAILABLE', 'This payment attempt cannot be resumed');
      }
      if (row.payment_status === 'failed' || row.booking_status === 'failed') {
        return sendError(res, 409, 'PAYMENT_ATTEMPT_FAILED', 'This payment attempt failed; start a new request');
      }
      // pending sin PaymentIntent → reutilizar esta misma fila.
    }

    /* ---- crear el PaymentIntent sobre `row` ---- */
    let pi;
    try {
      pi = await stripe.paymentIntents.create({
        amount: row.amount_cents,
        currency: row.currency,
        payment_method_types: ['card'],
        receipt_email: emailNorm,
        description: 'Galápagos Hook Adventure — ' + tour.name + ' (' + row.booking_code + ')',
        metadata: { booking_id: row.id, booking_code: row.booking_code, tenant_id: tenant }
      }, { idempotencyKey: 'create-pi:' + row.id });
    } catch (e) {
      logServer('pi-create', e);
      await markFailed(supabase, row.id);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to initialise payment');
    }

    const { error: upErr } = await supabase.from('bookings')
      .update({ stripe_payment_intent_id: pi.id }).eq('id', row.id);
    if (upErr) {
      // El PaymentIntent se creó pero no pudimos guardarlo: cancelar + marcar failed.
      try { await stripe.paymentIntents.cancel(pi.id); } catch (e) { logServer('pi-cancel', e); }
      await markFailed(supabase, row.id);
      logServer('pi-save', upErr);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to complete payment setup');
    }

    return sendJson(res, 200, {
      clientSecret: pi.client_secret,
      bookingCode: row.booking_code,
      amountCents: row.amount_cents,
      currency: row.currency,
      tourName: tour.name
    });
  } catch (err) {
    logServer('create-payment-intent', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to process the request');
  }
};
