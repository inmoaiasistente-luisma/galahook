'use strict';

/* =========================================================
   POST /api/admin-booking-update
   ---------------------------------------------------------
   Actualiza SOLO booking_status de una reserva del tenant.
   Autorizado exclusivamente para owner y admin — staff recibe 403.
   NUNCA cambia payment_status (eso solo lo mueve Stripe/webhook),
   ni importe, moneda, PI id, paid_at, email o tour_id.
   Cancelar NO reembolsa en Stripe.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId } = require('./_lib/http');
const { getSupabase } = require('./_lib/supabase');
const { requireAdmin, sameOrigin } = require('./_lib/admin-auth');

const BOOKING_STATUSES = ['new', 'pending_payment', 'confirmed', 'cancelled', 'completed', 'failed'];
const FIELDS = 'id,booking_code,request_type,tour_id,tour_name,unit,booking_date,guests,' +
  'customer_name,customer_email,customer_phone,notes,amount_cents,currency,' +
  'payment_status,booking_status,paid_at,created_at,updated_at';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  // Solo owner y admin. staff → 403 FORBIDDEN (aunque llame al endpoint directamente).
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;                               // 401/403 ya enviado
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); } catch (e) { logServer('admin-booking-update', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }

  // SOLO booking_id + booking_status. Cualquier otra clave (incl. payment_status) → 400.
  if (rejectUnknownKeys(body, ['booking_id', 'booking_status'])) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');

  const booking_id = body.booking_id;
  const booking_status = body.booking_status;
  if (typeof booking_id !== 'string' || !booking_id) return sendError(res, 400, 'INVALID_BOOKING_ID', 'booking_id is required');
  if (BOOKING_STATUSES.indexOf(booking_status) === -1) return sendError(res, 400, 'INVALID_BOOKING_STATUS', 'Invalid booking_status');

  try {
    const supabase = getSupabase();
    const upd = await supabase.from('bookings')
      .update({ booking_status: booking_status })       // solo este campo
      .eq('id', booking_id).eq('tenant_id', tenant)
      .select(FIELDS);

    if (upd.error) { logServer('admin-booking-update', upd.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Update failed'); }
    const rows = upd.data || [];
    if (rows.length === 0) return sendError(res, 404, 'NOT_FOUND', 'Booking not found');
    if (rows.length !== 1) { logServer('admin-booking-update', 'unexpected multi-row update'); return sendError(res, 500, 'INTERNAL_ERROR', 'Update error'); }

    // Nota: cancelar una reserva pagada NO reembolsa en Stripe (no se llama a Stripe aquí).
    return sendJson(res, 200, { booking: rows[0], refundIssued: false });
  } catch (err) {
    logServer('admin-booking-update', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Update failed');
  }
};
