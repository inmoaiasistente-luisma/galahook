'use strict';

/* =========================================================
   POST /api/stripe-webhook
   ---------------------------------------------------------
   Webhook seguro de Stripe. Verifica la firma con el cuerpo RAW,
   procesa eventos de PaymentIntent/refund con idempotencia
   (tabla stripe_webhook_events) y actualiza la reserva EXISTENTE
   en Supabase. Nunca crea una segunda reserva. Nunca expone
   secretos, firmas, clientSecret ni datos de tarjeta.
   ========================================================= */

const { getStripe } = require('./_lib/stripe');
const { getSupabase } = require('./_lib/supabase');
const { readRawBody } = require('./_lib/raw-body');

const HANDLED = [
  'payment_intent.processing',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'charge.refunded'
];

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}
/* Log SOLO server-side. Nunca claves, firma, clientSecret ni datos de tarjeta. */
function logSafe(context, msg) {
  // eslint-disable-next-line no-console
  console.error('[stripe-webhook] ' + context + (msg ? (': ' + msg) : ''));
}
function sanitize(msg) { return String(msg == null ? '' : msg).replace(/\s+/g, ' ').slice(0, 300); }

module.exports = async function handler(req, res) {
  // 1) Solo POST
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers['stripe-signature'];
  if (!secret || !signature) { logSafe('missing webhook secret or signature'); return json(res, 400, { error: 'INVALID_SIGNATURE' }); }

  let stripe;
  try { stripe = getStripe(); } catch (e) { logSafe('stripe init', e.message); return json(res, 500, { error: 'WEBHOOK_PROCESSING_ERROR' }); }

  // 2) Cuerpo RAW (sin JSON.parse antes de verificar la firma)
  let rawBody;
  try { rawBody = await readRawBody(req); } catch (e) { logSafe('read raw body', e.message); return json(res, 400, { error: 'INVALID_SIGNATURE' }); }

  // 3) Verificación de firma
  let event;
  try { event = stripe.webhooks.constructEvent(rawBody, signature, secret); }
  catch (e) { logSafe('constructEvent (invalid signature)'); return json(res, 400, { error: 'INVALID_SIGNATURE' }); }

  // 4) Coherencia TEST/LIVE
  const secretKey = process.env.STRIPE_SECRET_KEY || '';
  const isTestKey = secretKey.indexOf('sk_test_') === 0;
  const isLiveKey = secretKey.indexOf('sk_live_') === 0;
  if ((isTestKey && event.livemode === true) || (isLiveKey && event.livemode === false)) {
    logSafe('livemode mismatch', 'event ' + event.id);
    return json(res, 500, { error: 'WEBHOOK_PROCESSING_ERROR' });
  }

  const supabase = getSupabase();
  const isHandled = HANDLED.indexOf(event.type) !== -1;
  const safePayload = { id: event.id, type: event.type, livemode: event.livemode, created: event.created };

  // 5) Idempotencia: insertar el evento como 'processing'
  const ins = await supabase.from('stripe_webhook_events')
    .insert({ stripe_event_id: event.id, event_type: event.type, processing_status: 'processing', payload: safePayload })
    .select().single();

  if (ins.error) {
    if (ins.error.code === '23505') {                 // ya existe
      const ex = await supabase.from('stripe_webhook_events').select('processing_status').eq('stripe_event_id', event.id).maybeSingle();
      const st = ex.data && ex.data.processing_status;
      if (st === 'processed') return json(res, 200, { received: true, duplicate: true });
      if (st === 'processing') return json(res, 200, { received: true, duplicate: true }); // evita procesamiento concurrente
      // 'failed' o 'received' → reintentar: volver a 'processing'
      await supabase.from('stripe_webhook_events').update({ processing_status: 'processing', last_error: null }).eq('stripe_event_id', event.id);
    } else {
      logSafe('event ledger insert', ins.error.message);
      return json(res, 500, { error: 'WEBHOOK_PROCESSING_ERROR' });
    }
  }

  // 6) Eventos no relevantes → registrar procesado y responder ignored
  if (!isHandled) {
    await markProcessed(supabase, event.id);
    return json(res, 200, { received: true, ignored: true });
  }

  // 7) Procesar
  try {
    await processEvent(supabase, event);
    await markProcessed(supabase, event.id);
    return json(res, 200, { received: true });
  } catch (err) {
    const msg = sanitize(err && err.message);
    logSafe('process ' + event.type, msg);
    await supabase.from('stripe_webhook_events')
      .update({ processing_status: 'failed', last_error: msg, processed_at: null })
      .eq('stripe_event_id', event.id);
    return json(res, 500, { error: 'WEBHOOK_PROCESSING_ERROR' });
  }
};

/* Desactiva el body parser de Vercel: la firma requiere el cuerpo RAW. */
module.exports.config = { api: { bodyParser: false } };

/* ---------------- helpers ---------------- */

async function markProcessed(supabase, eventId) {
  await supabase.from('stripe_webhook_events')
    .update({ processing_status: 'processed', processed_at: new Date().toISOString(), last_error: null })
    .eq('stripe_event_id', eventId);
}

async function processEvent(supabase, event) {
  if (event.type === 'charge.refunded') return processRefund(supabase, event);
  return processPaymentIntent(supabase, event, event.data.object);
}

/* Actualización segura: apunta a la fila exacta (id + PI id + tenant) y exige 1 fila. */
async function updateBooking(supabase, booking, fields) {
  const u = await supabase.from('bookings').update(fields)
    .eq('id', booking.id)
    .eq('stripe_payment_intent_id', booking.stripe_payment_intent_id)
    .eq('tenant_id', booking.tenant_id)
    .select();
  if (u.error) throw new Error('booking update failed');
  if (!u.data || u.data.length !== 1) throw new Error('expected exactly one row updated, got ' + ((u.data || []).length));
}

/* Localiza la reserva por PI id y valida coincidencias (no confía solo en metadata). */
async function findBookingByPaymentIntent(supabase, pi) {
  const piId = pi && pi.id;
  if (!piId) throw new Error('missing payment_intent id');
  const q = await supabase.from('bookings').select('*').eq('stripe_payment_intent_id', piId);
  if (q.error) throw new Error('booking lookup failed');
  const rows = q.data || [];
  if (rows.length !== 1) throw new Error('expected exactly one booking, got ' + rows.length);
  const booking = rows[0];

  // La fila debe apuntar realmente a este PaymentIntent.
  if (booking.stripe_payment_intent_id !== piId) throw new Error('stripe_payment_intent_id mismatch');

  // Verificar tenant y, si existen, booking_id / booking_code de la metadata.
  const meta = pi.metadata || {};
  if (!meta.tenant_id || meta.tenant_id !== booking.tenant_id) throw new Error('tenant mismatch');
  if (meta.booking_id && meta.booking_id !== booking.id) throw new Error('booking_id mismatch');
  if (meta.booking_code && meta.booking_code !== booking.booking_code) throw new Error('booking_code mismatch');

  return booking;
}

async function processPaymentIntent(supabase, event, pi) {
  const booking = await findBookingByPaymentIntent(supabase, pi);

  switch (event.type) {
    case 'payment_intent.processing':
      await updateBooking(supabase, booking, { payment_status: 'processing', booking_status: 'pending_payment' });
      return;

    case 'payment_intent.succeeded': {
      // Validar moneda e importe contra la reserva (fuente segura).
      if (String(pi.currency).toLowerCase() !== String(booking.currency).toLowerCase()) throw new Error('currency mismatch');
      if (Number(pi.amount) !== Number(booking.amount_cents)) throw new Error('amount mismatch');
      if (pi.amount_received != null && Number(pi.amount_received) !== Number(booking.amount_cents)) throw new Error('amount_received mismatch');
      // paid_at desde la hora del evento de Stripe (no del navegador).
      const ts = (event.created || pi.created || 0) * 1000;
      const paidAt = new Date(ts).toISOString();
      await updateBooking(supabase, booking, { payment_status: 'paid', booking_status: 'confirmed', paid_at: paidAt });
      return;
    }

    case 'payment_intent.payment_failed':
      await updateBooking(supabase, booking, { payment_status: 'failed', booking_status: 'failed', paid_at: null });
      return;

    case 'payment_intent.canceled':
      await updateBooking(supabase, booking, { payment_status: 'failed', booking_status: 'failed', paid_at: null });
      return;

    default:
      throw new Error('unhandled PI event: ' + event.type);
  }
}

async function processRefund(supabase, event) {
  const charge = event.data.object || {};
  const piId = charge.payment_intent;
  const isFull = charge.refunded === true && charge.amount_refunded != null && Number(charge.amount_refunded) === Number(charge.amount);

  // Reembolso PARCIAL o sin PaymentIntent: no cambiar la reserva; queda registrado en
  // stripe_webhook_events + nota segura para revisión manual. (Evento válido → 200.)
  if (!isFull || !piId) {
    logSafe('refund noted (partial or no payment_intent)', 'event ' + event.id);
    await supabase.from('stripe_webhook_events')
      .update({ payload: { id: event.id, type: event.type, livemode: event.livemode, created: event.created, note: 'partial_or_no_pi_manual_review' } })
      .eq('stripe_event_id', event.id);
    return;
  }

  // Reembolso TOTAL: localizar la reserva por PI id y marcar refunded/cancelled.
  const q = await supabase.from('bookings').select('*').eq('stripe_payment_intent_id', piId);
  if (q.error) throw new Error('booking lookup failed');
  const rows = q.data || [];
  if (rows.length !== 1) throw new Error('expected exactly one booking for refund, got ' + rows.length);
  const booking = rows[0];
  await updateBooking(supabase, booking, { payment_status: 'refunded', booking_status: 'cancelled' });
}
