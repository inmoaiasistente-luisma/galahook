'use strict';

/* =========================================================
   POST /api/admin-booking-costs-confirm  (action=booking-costs-confirm)
   ---------------------------------------------------------
   owner/admin: CONFIRMA los costos reales de una reserva. El servidor fija
   bookings.cost_cents = SUMA(líneas activas) y cost_status='confirmed'
   (+ actor + fecha). Recién confirmado cuenta como utilidad OFICIAL. No toca
   Stripe ni el importe cobrado; no recalcula otras reservas. staff → 403.
   Body: { booking_id }
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId, isUuid } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const { getSupabase } = require('../lib/supabase');
const bf = require('../lib/booking-finance');

const ALLOWED_KEYS = ['booking_id'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); } catch (e) { logServer('booking-costs-confirm', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id must be a UUID');

  try {
    const supabase = getSupabase();
    const bq = await supabase.from('bookings').select('id,amount_cents').eq('id', body.booking_id).eq('tenant_id', tenant).maybeSingle();
    if (bq.error) { logServer('booking-costs-confirm', bq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!bq.data) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');

    const lq = await supabase.from('booking_cost_lines').select('total_cents,active').eq('booking_id', body.booking_id).eq('tenant_id', tenant).eq('active', true);
    if (lq.error) { logServer('booking-costs-confirm', lq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const lines = lq.data || [];
    const fin = bf.computeFinance(bq.data.amount_cents, lines);

    const up = await supabase.from('bookings').update({
      cost_cents: fin.cost_total_cents,        // snapshot confirmado = suma de líneas
      cost_status: 'confirmed',
      cost_confirmed_at: new Date().toISOString(),
      cost_confirmed_by_user_id: session.user_id
    }).eq('id', body.booking_id).eq('tenant_id', tenant);
    if (up.error) { logServer('booking-costs-confirm', up.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    return sendJson(res, 200, {
      confirmed: true, cost_status: 'confirmed',
      cost_total_cents: fin.cost_total_cents, line_count: fin.line_count,
      profit_cents: fin.profit_cents, margin_percent: fin.margin_percent
    });
  } catch (err) { logServer('booking-costs-confirm', err && err.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
};
