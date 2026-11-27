'use strict';

/* =========================================================
   Barrido diario del saldo del depósito (30 %).
   ---------------------------------------------------------
   Lo llama reminders-run después de los recordatorios pre-viaje.
   Para cada reserva con depósito pagado y saldo pendiente:
     · día 7  → correo balance_reminder_d7 (con el enlace de pago)
     · día 6  → correo balance_reminder_d6 (último aviso)
     · día <=5 → cancelación automática (el depósito se pierde)

   Reglas de seguridad:
     · NUNCA se cancela si el pago del saldo está processing o
       succeeded en Stripe: el dinero puede estar en camino.
     · La cancelación es un UPDATE condicional (sigue confirmada,
       deposit_paid y sin balance_paid_at). Si otro escritor llegó
       antes (la webhook marcó el saldo pagado, o una corrida previa
       ya canceló) afecta 0 filas y no sale ningún correo.
     · Un error en una reserva se registra y se cuenta en `failed`;
       nunca detiene a las demás.

   Las dependencias (correo, auditoría, Stripe, DB) llegan por
   parámetro para poder probar el barrido con dobles.
   ========================================================= */

const { sweepAction, balanceUrl } = require('./deposit-policy');
const { logServer, normalizeEmail } = require('./http');
const { getStripe } = require('./stripe');

/* Estados del PaymentIntent del saldo que todavía se pueden anular. */
const CANCELABLE_PI = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture'];
const IN_FLIGHT_PI = ['processing', 'succeeded'];

async function remind(b, action, deps, out) {
  const email = normalizeEmail(b.customer_email || '');
  if (!email) return;                                   // sin destinatario no hay recordatorio
  let url;
  try { url = balanceUrl(b.id); }                       // sin enlace de pago el aviso no sirve
  catch (e) { logServer('deposit-sweep', 'balanceUrl: ' + (e && e.message)); out.failed++; return; }
  const r = await deps.sendBookingEmail({
    booking: b,
    type: action === 'remind_d7' ? 'balance_reminder_d7' : 'balance_reminder_d6',
    recipient: email,
    ctx: { balanceUrl: url }
  });
  if (r && r.sent) out.reminded++;                      // duplicados y omitidos no cuentan
  else if (r && r.failed) out.failed++;
}

/* Resultado de un envío: sent | duplicate | failed | skipped | unknown. */
function outcome(r) {
  if (!r) return 'unknown';
  if (r.sent) return 'sent';
  if (r.duplicate) return 'duplicate';
  if (r.failed) return 'failed';
  if (r.skipped) return 'skipped';
  return 'unknown';
}

async function cancelUnpaid(b, deps, out) {
  /* 1) Si hay un pago de saldo en Stripe, mirarlo ANTES de tocar la reserva. */
  if (b.balance_payment_intent_id) {
    if (!deps.stripe) { logServer('deposit-sweep', 'sin cliente Stripe; reserva ' + b.id + ' queda para la próxima corrida'); out.failed++; return; }
    let pi;
    try { pi = await deps.stripe.paymentIntents.retrieve(b.balance_payment_intent_id); }
    catch (e) { logServer('deposit-sweep', 'retrieve PI: ' + (e && e.message)); out.failed++; return; }
    const st = pi && pi.status;
    if (IN_FLIGHT_PI.indexOf(st) !== -1) { out.skippedProcessing++; return; }
    if (CANCELABLE_PI.indexOf(st) !== -1) {
      try { await deps.stripe.paymentIntents.cancel(b.balance_payment_intent_id); }
      catch (e) { logServer('deposit-sweep', 'cancel PI: ' + (e && e.message)); out.failed++; return; }
    } else if (st !== 'canceled') {
      logServer('deposit-sweep', 'estado de PI inesperado: ' + st);
      out.failed++; return;
    }
  }

  /* 2) Cancelación condicional: solo si nadie más la movió. */
  /* Guarda del PI: si apareció uno (o cambió) después de leer la fila, el
     cliente puede estar pagando; 0 filas y se revisa en Stripe la próxima vez. */
  let upd = deps.supabase.from('bookings')
    .update({ booking_status: 'cancelled', cancel_reason: 'balance_unpaid', auto_cancelled_at: new Date().toISOString() })
    .eq('id', b.id)
    .eq('tenant_id', b.tenant_id)
    .eq('payment_status', 'deposit_paid')
    .eq('booking_status', 'confirmed')
    .is('balance_paid_at', null);
  upd = b.balance_payment_intent_id
    ? upd.eq('balance_payment_intent_id', b.balance_payment_intent_id)
    : upd.is('balance_payment_intent_id', null);
  const { data, error } = await upd.select();
  if (error) { logServer('deposit-sweep', 'cancel booking: ' + error.message); out.failed++; return; }
  if (!data || data.length !== 1) return;               // otro escritor ganó: sin correo, sin contar

  const n = await deps.notifyBooking(data[0], 'customer_deposit_cancelled', 'owner_deposit_cancelled');
  const notify = { customer: outcome(n && n.customer), owner: outcome(n && n.owner) };
  if (notify.customer !== 'sent' && notify.customer !== 'duplicate' || notify.owner !== 'sent' && notify.owner !== 'duplicate') {
    logServer('deposit-sweep', 'aviso de cancelación incompleto en reserva ' + b.id + ' (cliente: ' + notify.customer + ', dueño: ' + notify.owner + ')');
    out.notifyFailed++;                                 // sin reenvío automático: el owner reenvía desde el panel
  }
  await deps.audit({
    action: 'booking.auto_cancel', entity_type: 'booking', entity_id: b.id,
    before: { booking_status: 'confirmed', payment_status: 'deposit_paid' },
    after: { booking_status: 'cancelled', cancel_reason: 'balance_unpaid', notify: notify }
  });
  out.cancelled++;
}

/**
 * @returns {Promise<{reminded:number, cancelled:number, skippedProcessing:number, failed:number, notifyFailed:number}>}
 */
async function runDepositSweep(deps) {
  const out = { reminded: 0, cancelled: 0, skippedProcessing: 0, failed: 0, notifyFailed: 0 };
  const rows = (deps && deps.rows) || [];
  for (let i = 0; i < rows.length; i++) {
    const b = rows[i];
    try {
      const a = sweepAction(b, deps.today, { includeTest: !!deps.includeTest }).action;
      if (a === 'remind_d7' || a === 'remind_d6') await remind(b, a, deps, out);
      else if (a === 'cancel') await cancelUnpaid(b, deps, out);
    } catch (e) {
      logServer('deposit-sweep', 'reserva ' + (b && b.id) + ': ' + (e && e.message));
      out.failed++;
    }
  }
  return out;
}

/** Cliente de Stripe o null (getStripe lanza si no está configurado). */
function tryGetStripe() {
  try { return getStripe(); } catch (e) { return null; }
}

module.exports = { runDepositSweep, tryGetStripe };
