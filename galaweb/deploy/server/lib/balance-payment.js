'use strict';

/* =========================================================
   Pago del saldo (70 %) de una reserva con depósito.
   ---------------------------------------------------------
   Es un MODO de POST /api/create-payment-intent (no una función
   nueva de Vercel). El cliente solo envía { mode, token }; el token
   firmado (deposit-policy) identifica la reserva y TODOS los importes
   salen de la fila. Nunca se devuelve nombre, correo ni teléfono.
     mode 'balance_info' → resumen (estado due | paid | cancelled)
     mode 'balance'      → clientSecret del PaymentIntent del saldo
   ========================================================= */

const depositPolicy = require('./deposit-policy');
const { sendJson, sendError, logServer, rejectUnknownKeys } = require('./http');

const MODES = ['balance_info', 'balance'];
const REUSABLE_PI_STATUSES = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing'];

async function fetchById(supabase, tenant, id) {
  const { data, error } = await supabase
    .from('bookings').select('*')
    .eq('id', id).eq('tenant_id', tenant)
    .limit(1).maybeSingle();
  if (error) throw new Error('lookup failed: ' + (error.message || 'unknown'));
  return data || null;
}

/* Estado del saldo según la fila. Orden: plan → cancelada → pagada → depósito pagado. */
function balanceState(row) {
  if (row.payment_plan !== 'deposit') return null;
  if (row.booking_status === 'cancelled' || row.payment_status === 'refunded') return 'cancelled';
  if (row.payment_status === 'paid') return 'paid';
  if (row.payment_status === 'deposit_paid') return 'due';
  return null;
}

/* Responde con el PI ya guardado del saldo (reanudar). */
async function respondWithStoredPi(res, stripe, row, piId) {
  let pi;
  try { pi = await stripe.paymentIntents.retrieve(piId); }
  catch (e) { logServer('balance-pi-retrieve', e); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to load payment status'); }

  if (pi.status === 'succeeded') return sendJson(res, 200, { alreadyPaid: true, bookingCode: row.booking_code });
  if (pi.status === 'canceled') return sendError(res, 409, 'PAYMENT_ATTEMPT_CANCELED', 'This payment attempt was canceled');
  if (REUSABLE_PI_STATUSES.indexOf(pi.status) !== -1) {
    return sendJson(res, 200, {
      clientSecret: pi.client_secret, bookingCode: row.booking_code, chargeCents: row.balance_cents,
      currency: row.currency, tourName: row.tour_name
    });
  }
  logServer('balance-pi-status', new Error('unexpected PI status: ' + pi.status));
  return sendError(res, 409, 'PAYMENT_ATTEMPT_UNAVAILABLE', 'This payment attempt cannot be resumed');
}

async function createBalancePi(res, supabase, stripe, tenant, row) {
  let pi;
  try {
    pi = await stripe.paymentIntents.create({
      amount: row.balance_cents,
      currency: row.currency,
      payment_method_types: ['card'],
      receipt_email: row.customer_email || undefined,
      description: 'Galápagos Hook Adventure — saldo ' + row.tour_name + ' (' + row.booking_code + ')',
      metadata: { booking_id: row.id, booking_code: row.booking_code, tenant_id: tenant, kind: 'balance' }
    }, { idempotencyKey: 'create-balance-pi:' + row.id });
  } catch (e) {
    logServer('balance-pi-create', e);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to initialise payment');
  }

  /* Guardado condicional: si otra llamada concurrente ya guardó su PI, no se pisa. */
  const { data: saved, error: upErr } = await supabase.from('bookings')
    .update({ balance_payment_intent_id: pi.id })
    .eq('id', row.id).eq('tenant_id', tenant).is('balance_payment_intent_id', null)
    .select('id');
  if (upErr) {
    logServer('balance-pi-save', upErr);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to complete payment setup');
  }
  if (Array.isArray(saved) && saved.length > 0) {
    return sendJson(res, 200, {
      clientSecret: pi.client_secret, bookingCode: row.booking_code, chargeCents: row.balance_cents,
      currency: row.currency, tourName: row.tour_name
    });
  }

  // Nadie actualizó: otra llamada guardó antes → releer y reutilizar el guardado.
  const fresh = await fetchById(supabase, tenant, row.id);
  if (!fresh || !fresh.balance_payment_intent_id) {
    logServer('balance-pi-save', new Error('conditional update affected no row'));
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to complete payment setup');
  }
  return respondWithStoredPi(res, stripe, fresh, fresh.balance_payment_intent_id);
}

/** @returns {Promise<void>} escribe la respuesta en `res`. */
async function handleBalanceRequest(body, res, ctx) {
  const { supabase, stripe, tenant } = ctx;

  if (MODES.indexOf(body.mode) === -1) return sendError(res, 400, 'INVALID_MODE', 'Unknown mode');
  if (rejectUnknownKeys(body, ['mode', 'token'])) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');

  // Config primero: un despliegue sin secreto debe fallar fuerte, no como token inválido.
  if (!process.env.QR_SIGNING_SECRET) {
    logServer('balance', new Error('QR_SIGNING_SECRET no está configurada'));
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to process the request');
  }

  const bookingId = depositPolicy.verifyBalanceToken(body.token);
  const row = bookingId ? await fetchById(supabase, tenant, bookingId) : null;
  if (!row) return sendError(res, 400, 'INVALID_TOKEN', 'Invalid or expired link');

  const state = balanceState(row);
  if (state === null) return sendError(res, 409, 'BALANCE_NOT_DUE', 'No balance is due for this booking');

  if (body.mode === 'balance_info') {
    return sendJson(res, 200, {
      bookingCode: row.booking_code, tourName: row.tour_name, bookingDate: row.booking_date, guests: row.guests,
      totalCents: row.amount_cents, depositCents: row.deposit_cents, balanceCents: row.balance_cents,
      balanceDueDate: row.balance_due_date, currency: row.currency, state: state
    });
  }

  if (state === 'cancelled') return sendError(res, 409, 'BOOKING_CANCELLED', 'This booking was cancelled');
  if (state === 'paid') return sendJson(res, 200, { alreadyPaid: true, bookingCode: row.booking_code });

  if (row.balance_payment_intent_id) return respondWithStoredPi(res, stripe, row, row.balance_payment_intent_id);
  return createBalancePi(res, supabase, stripe, tenant, row);
}

module.exports = { handleBalanceRequest };
