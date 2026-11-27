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

const { getStripe } = require('../server/lib/stripe');
const { getSupabase } = require('../server/lib/supabase');
const { readRawBody } = require('../server/lib/raw-body');
const { notifyBooking, sendBookingEmail } = require('../server/lib/booking-email-service');
const { getMailConfig } = require('../server/lib/resend');
const { normalizeEmail } = require('../server/lib/http');
const { balanceUrl } = require('../server/lib/deposit-policy');
const { ensurePassengerForm } = require('../server/lib/passenger-intake');
const { sendInvitation } = require('../server/lib/passenger-intake-emails');

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
    const result = await processEvent(supabase, event);
    await markProcessed(supabase, event.id);
    // Evento de otro proyecto de la cuenta Stripe compartida: se acusa recibo sin tocar nada.
    if (result && result.ignored) return json(res, 200, { received: true, ignored: true });
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

/* Columna que guarda el PI de cada tipo de cobro. */
const PI_COLUMN = { full: 'stripe_payment_intent_id', deposit: 'stripe_payment_intent_id', balance: 'balance_payment_intent_id' };

/* Actualización segura: apunta a la fila exacta (id + PI id + tenant) y exige 1 fila.
   piColumn indica contra qué columna de PI se filtra (depósito/completo vs saldo). */
async function updateBooking(supabase, booking, fields, piColumn, notEq) {
  const col = piColumn || 'stripe_payment_intent_id';
  let q = supabase.from('bookings').update(fields)
    .eq('id', booking.id)
    .eq(col, booking[col])
    .eq('tenant_id', booking.tenant_id);
  // Precondición opcional ([[columna, valor]...] que NO debe tener la fila): cierra
  // carreras con el barrido (si 0 filas → lanza → Stripe reintenta con el estado nuevo).
  (notEq || []).forEach(function (c) { q = q.not(c[0], 'eq', c[1]); });
  const u = await q.select();
  if (u.error) throw new Error('booking update failed');
  if (!u.data || u.data.length !== 1) throw new Error('expected exactly one row updated, got ' + ((u.data || []).length));
}

/* Busca filas por PI id en ambas columnas (cobro inicial/completo y saldo).
   Devuelve [{ booking, kind }]; más de una fila es un error de integridad. */
async function lookupRowsByPi(supabase, piId) {
  const found = [];
  const seen = {};
  for (const kindCol of [['stripe_payment_intent_id', null], ['balance_payment_intent_id', 'balance']]) {
    const q = await supabase.from('bookings').select('*').eq(kindCol[0], piId);
    if (q.error) throw new Error('booking lookup failed');
    (q.data || []).forEach(function (b) {
      if (seen[b.id]) return;
      seen[b.id] = true;
      found.push({ booking: b, kind: kindCol[1] || (b.payment_plan === 'deposit' ? 'deposit' : 'full') });
    });
  }
  if (found.length > 1) throw new Error('expected exactly one booking, got ' + found.length);
  return found;
}

/* Localiza la reserva por PI id y valida coincidencias (no confía solo en metadata).
   Devuelve { booking, kind } o null si el evento es de OTRO proyecto de la cuenta
   Stripe compartida (sin fila y sin nuestro tenant en metadata). */
async function findBookingByPaymentIntent(supabase, pi) {
  const piId = pi && pi.id;
  if (!piId) throw new Error('missing payment_intent id');
  const meta = pi.metadata || {};
  const found = await lookupRowsByPi(supabase, piId);
  if (found.length === 0) {
    if (!meta.tenant_id || meta.tenant_id !== process.env.TENANT_ID) return null;   // evento ajeno
    throw new Error('expected exactly one booking, got 0');
  }
  const booking = found[0].booking;
  const kind = found[0].kind;

  // La fila debe apuntar realmente a este PaymentIntent.
  if (booking[PI_COLUMN[kind]] !== piId) throw new Error('payment_intent id mismatch');

  // Verificar tenant y, si existen, booking_id / booking_code / kind de la metadata.
  if (!meta.tenant_id || meta.tenant_id !== booking.tenant_id) throw new Error('tenant mismatch');
  if (meta.booking_id && meta.booking_id !== booking.id) throw new Error('booking_id mismatch');
  if (meta.booking_code && meta.booking_code !== booking.booking_code) throw new Error('booking_code mismatch');
  if (meta.kind && meta.kind !== kind) throw new Error('kind mismatch');

  return { booking: booking, kind: kind };
}

/* Fila fresca de la base (o la local con los campos recién escritos). */
async function freshRow(supabase, booking, fields) {
  const fresh = await supabase.from('bookings').select('*').eq('id', booking.id).maybeSingle();
  return (fresh && fresh.data) || Object.assign({}, booking, fields);
}

function eventIso(event, pi) { return new Date((event.created || pi.created || 0) * 1000).toISOString(); }

/* Aviso solo al dueño (revisión de pago). Nunca lanza. */
async function notifyOwnerReview(supabase, booking, reason) {
  try {
    const row = await freshRow(supabase, booking, { needs_review_reason: reason });
    const notify = normalizeEmail(getMailConfig().notifyTo || '');
    if (!notify) return;
    await sendBookingEmail({ booking: row, type: 'owner_payment_review', recipient: notify, ctx: { reason: reason } });
  } catch (e) {
    logSafe('owner review (no afecta al pago)', sanitize(e && e.message));
  }
}

/* Intake de pasajeros: crear el formulario seguro y enviar la invitación.
   Igual que el correo/QR, un fallo aquí NUNCA devuelve 500 a Stripe. */
async function inviteAfterPayment(supabase, booking, fields) {
  try {
    const row = await freshRow(supabase, booking, fields);
    const form = await ensurePassengerForm(row);
    if (form) await sendInvitation(row, form);
  } catch (e) {
    logSafe('intake (no afecta al pago)', sanitize(e && e.message));
  }
}

async function processPaymentIntent(supabase, event, pi) {
  const hit = await findBookingByPaymentIntent(supabase, pi);
  if (!hit) {
    logSafe('evento ajeno ignorado', event.type + ' ' + event.id);
    return { ignored: true };
  }
  const booking = hit.booking;
  const kind = hit.kind;

  switch (event.type) {
    case 'payment_intent.processing':
      if (kind === 'deposit' && depositAlreadyAdvanced(booking)) { logSafe('processing del depósito ignorado (estado avanzado)', booking.id); return; }
      if (kind === 'balance') { logSafe('saldo en proceso (sin cambios en la reserva)', booking.id); return; }
      await updateBooking(supabase, booking, { payment_status: 'processing', booking_status: 'pending_payment' });
      return;

    case 'payment_intent.succeeded':
      if (kind === 'balance') return balanceSucceeded(supabase, event, pi, booking);
      if (kind === 'deposit') return depositSucceeded(supabase, event, pi, booking);
      return fullSucceeded(supabase, event, pi, booking);

    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled':
      // Un saldo fallido/cancelado NO marca la reserva (el depósito ya está pagado).
      if (kind === 'deposit' && depositAlreadyAdvanced(booking)) { logSafe(event.type + ' del depósito ignorado (estado avanzado)', booking.id); return; }
      if (kind === 'balance') { logSafe(event.type + ' del saldo (sin cambios en la reserva)', booking.id); return; }
      await updateBooking(supabase, booking, { payment_status: 'failed', booking_status: 'failed', paid_at: null });
      return;

    default:
      throw new Error('unhandled PI event: ' + event.type);
  }
}

/* Solo hacia delante: un evento reordenado/reentregado del depósito no debe degradar la reserva. */
function depositAlreadyAdvanced(b) {
  return b.payment_status === 'deposit_paid' || b.payment_status === 'paid' || b.payment_status === 'refunded' || b.booking_status === 'cancelled';
}

/* Valida moneda e importe contra la reserva (fuente segura). */
function checkAmounts(pi, booking, expectedCents) {
  if (String(pi.currency).toLowerCase() !== String(booking.currency).toLowerCase()) throw new Error('currency mismatch');
  if (Number(pi.amount) !== Number(expectedCents)) throw new Error('amount mismatch');
  if (pi.amount_received != null && Number(pi.amount_received) !== Number(expectedCents)) throw new Error('amount_received mismatch');
}

async function fullSucceeded(supabase, event, pi, booking) {
  checkAmounts(pi, booking, booking.amount_cents);
  // Guarda de estado TERMINAL: Stripe no garantiza el orden ni la unicidad de
  // entrega. Un 'succeeded' reordenado/reentregado NO debe re-confirmar una
  // reserva ya reembolsada o cancelada. Se registra y se omite (no es 500).
  if (booking.payment_status === 'refunded' || booking.booking_status === 'cancelled') {
    logSafe('succeeded ignorado (estado terminal)', String(booking.payment_status) + '/' + String(booking.booking_status));
    return;
  }
  // paid_at desde la hora del evento de Stripe (no del navegador).
  const paidAt = eventIso(event, pi);
  const fields = { payment_status: 'paid', booking_status: 'confirmed', paid_at: paidAt };
  await updateBooking(supabase, booking, fields);

  /* Notificaciones: QR + correo al cliente y al equipo.
     REGLA CRÍTICA: la confirmación del pago NO depende del correo ni del QR.
     Un fallo aquí queda registrado en email_notifications y se puede
     reintentar desde el panel, pero jamás devuelve 500 a Stripe. */
  try {
    const row = await freshRow(supabase, booking, fields);
    await notifyBooking(row, 'customer_booking_confirmation', 'owner_booking_notification');
  } catch (e) {
    logSafe('notify (no afecta al pago)', sanitize(e && e.message));
  }
  await inviteAfterPayment(supabase, booking, fields);
}

async function depositSucceeded(supabase, event, pi, booking) {
  checkAmounts(pi, booking, booking.deposit_cents);
  if (booking.payment_status === 'refunded' || booking.booking_status === 'cancelled') {
    logSafe('depósito ignorado (estado terminal)', String(booking.payment_status) + '/' + String(booking.booking_status));
    return;
  }
  // Nunca bajar 'paid' a 'deposit_paid' (evento reordenado o reentregado tras el saldo).
  if (booking.payment_status === 'paid') { logSafe('depósito tras saldo pagado: sin cambios', booking.id); return; }
  if (booking.payment_status === 'deposit_paid') { logSafe('depósito duplicado: sin cambios', booking.id); return; }

  const paidAt = eventIso(event, pi);
  const fields = { payment_status: 'deposit_paid', booking_status: 'confirmed', paid_at: paidAt, deposit_paid_at: paidAt };
  await updateBooking(supabase, booking, fields);

  try {
    const row = await freshRow(supabase, booking, fields);
    let ctx;
    try { ctx = { balanceUrl: balanceUrl(row.id) }; }
    catch (e) { logSafe('balanceUrl no disponible (se envía sin enlace)', sanitize(e && e.message)); }
    await notifyBooking(row, 'customer_deposit_confirmation', 'owner_deposit_notification', ctx);
  } catch (e) {
    logSafe('notify (no afecta al pago)', sanitize(e && e.message));
  }
  await inviteAfterPayment(supabase, booking, fields);
}

async function balanceSucceeded(supabase, event, pi, booking) {
  checkAmounts(pi, booking, booking.balance_cents);
  const col = PI_COLUMN.balance;

  // Reserva cancelada/reembolsada: el cliente pagó el saldo igualmente → revisión manual.
  if (booking.payment_status === 'refunded' || booking.booking_status === 'cancelled') {
    await updateBooking(supabase, booking, { needs_review_reason: 'balance_paid_after_cancel' }, col);
    await notifyOwnerReview(supabase, booking, 'balance_paid_after_cancel');
    return;
  }
  if (booking.payment_status === 'paid') {
    // Pago offline ya registrado por el dueño → cobro doble; si ya fue por Stripe, duplicado.
    if (booking.balance_payment_method === 'cash' || booking.balance_payment_method === 'transfer') {
      await updateBooking(supabase, booking, { needs_review_reason: 'balance_paid_twice' }, col);
      await notifyOwnerReview(supabase, booking, 'balance_paid_twice');
    } else {
      logSafe('saldo duplicado: sin cambios', booking.id);
    }
    return;
  }

  const fields = { payment_status: 'paid', balance_paid_at: eventIso(event, pi), balance_payment_method: 'stripe' };
  // Precondición: la reserva no debe haberse cancelado/pagado entre la lectura y la escritura.
  await updateBooking(supabase, booking, fields, col,
    [['booking_status', 'cancelled'], ['payment_status', 'paid'], ['payment_status', 'refunded']]);
  try {
    const row = await freshRow(supabase, booking, fields);
    await notifyBooking(row, 'customer_balance_receipt', 'owner_balance_received');
  } catch (e) {
    logSafe('notify (no afecta al pago)', sanitize(e && e.message));
  }
}

async function noteLedger(supabase, event, note) {
  await supabase.from('stripe_webhook_events')
    .update({ payload: { id: event.id, type: event.type, livemode: event.livemode, created: event.created, note: note } })
    .eq('stripe_event_id', event.id);
}

async function processRefund(supabase, event) {
  const charge = event.data.object || {};
  const piId = charge.payment_intent;
  const isFull = charge.refunded === true && charge.amount_refunded != null && Number(charge.amount_refunded) === Number(charge.amount);

  // Reembolso PARCIAL o sin PaymentIntent: no cambiar la reserva; queda registrado en
  // stripe_webhook_events + nota segura para revisión manual. (Evento válido → 200.)
  if (!isFull || !piId) {
    logSafe('refund noted (partial or no payment_intent)', 'event ' + event.id);
    await noteLedger(supabase, event, 'partial_or_no_pi_manual_review');
    return;
  }

  // Reembolso TOTAL: localizar la reserva por PI id (depósito/completo o saldo).
  const found = await lookupRowsByPi(supabase, piId);
  if (found.length === 0) {
    // La cuenta Stripe es compartida: reembolsos de otros proyectos llegan aquí.
    logSafe('refund sin reserva (ajeno)', 'event ' + event.id);
    await noteLedger(supabase, event, 'no_booking_ignored');
    return;
  }
  const booking = found[0].booking;
  const kind = found[0].kind;

  if (kind === 'full' || (kind === 'deposit' && booking.payment_status !== 'paid')) {
    await updateBooking(supabase, booking, { payment_status: 'refunded', booking_status: 'cancelled' }, PI_COLUMN[kind]);
    return;
  }
  // Depósito con saldo pagado, o cargo del saldo: reembolso de UN cargo → decide el dueño.
  logSafe('refund requiere revisión manual', kind + ' ' + booking.id);
  await updateBooking(supabase, booking, { needs_review_reason: 'refund_review' }, PI_COLUMN[kind]);
  await noteLedger(supabase, event, 'refund_review_manual');
}

/* Solo para pruebas: el export principal (handler de Vercel) no cambia. */
module.exports._test = { processEvent };
