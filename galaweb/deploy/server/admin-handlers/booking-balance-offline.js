'use strict';

/* =========================================================
   POST /api/admin-booking-balance-offline  (action=booking-balance-offline)
   ---------------------------------------------------------
   owner: marca el saldo de una reserva con depósito 30 % como pagado por
   otro medio (efectivo o transferencia). Escritura = SOLO owner + sameOrigin.
   Body: { booking_id, method: 'cash'|'transfer', note (3–500) }
   Única vía de escritura: UPDATE condicional (solo si el saldo está pendiente).
   0 filas → 409 BALANCE_NOT_DUE (reserva completa, ya pagada, cancelada,
   de otro tenant o inexistente: respuesta uniforme).
   Después, best-effort: cancela el PaymentIntent del saldo si sigue abierto.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId, isUuid } = require('../lib/http');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { recordAudit } = require('../lib/admin-audit');
const { getSupabase } = require('../lib/supabase');
const { tryGetStripe } = require('../lib/deposit-sweep');

const ALLOWED_KEYS = ['booking_id', 'method', 'note'];
const METHODS = ['cash', 'transfer'];

/* Cancela el PI del saldo solo si aún no se cobra ni se está procesando.
   Cualquier error se registra y se ignora: el saldo ya quedó marcado. */
async function cancelOpenBalanceIntent(piId) {
  if (!piId) return;
  try {
    const stripe = tryGetStripe();
    if (!stripe) { logServer('booking-balance-offline', 'Stripe no configurado: PI no cancelado'); return; }
    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi && typeof pi.status === 'string' && pi.status.indexOf('requires_') === 0) {
      await stripe.paymentIntents.cancel(piId);
    }
  } catch (e) { logServer('booking-balance-offline', 'cancel PI: ' + (e && e.message)); }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);   // escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); } catch (e) { logServer('booking-balance-offline', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id must be a UUID');
  if (METHODS.indexOf(body.method) === -1) return sendError(res, 400, 'INVALID_METHOD', 'method must be cash or transfer');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length < 3 || note.length > 500) return sendError(res, 400, 'INVALID_NOTE', 'note must be 3-500 characters');

  try {
    const supabase = getSupabase();
    const upd = await supabase.from('bookings')
      .update({ payment_status: 'paid', balance_paid_at: new Date().toISOString(), balance_payment_method: body.method, balance_offline_note: note })
      .eq('id', body.booking_id).eq('tenant_id', tenant)
      .eq('payment_plan', 'deposit').eq('payment_status', 'deposit_paid')
      .not('booking_status', 'eq', 'cancelled')
      .is('balance_paid_at', null)
      .select();
    if (upd.error) { logServer('booking-balance-offline', upd.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const row = upd.data && upd.data[0];
    if (!row) return sendError(res, 409, 'BALANCE_NOT_DUE', 'Balance is not pending');

    await cancelOpenBalanceIntent(row.balance_payment_intent_id);

    await recordAudit(session, {
      action: 'booking.balance_offline', entity_type: 'booking', entity_id: body.booking_id, always: true,
      before: { payment_status: 'deposit_paid' },
      after: { payment_status: 'paid', balance_payment_method: body.method }
    });
    return sendJson(res, 200, { ok: true });
  } catch (err) { logServer('booking-balance-offline', err && err.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
};
