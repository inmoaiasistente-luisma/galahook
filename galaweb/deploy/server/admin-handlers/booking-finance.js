'use strict';

/* =========================================================
   GET /api/admin-booking-finance  (action=booking-finance)
   ---------------------------------------------------------
   owner/admin: finanzas reales de UNA reserva — importe cobrado, líneas de
   costo activas, costo total, utilidad, margen y estado financiero. Todos los
   cálculos se hacen en el servidor (booking-finance lib). staff → 403.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId, isUuid } = require('../lib/http');
const { requireAdmin } = require('../lib/admin-auth');
const { getSupabase } = require('../lib/supabase');
const bf = require('../lib/booking-finance');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); } catch (e) { logServer('booking-finance', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = req.query || {};
  if (!isUuid(q.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id must be a UUID');

  try {
    const supabase = getSupabase();
    const bq = await supabase.from('bookings')
      .select('id,booking_code,amount_cents,currency,cost_cents,cost_status,cost_confirmed_at,request_type')
      .eq('id', q.booking_id).eq('tenant_id', tenant).maybeSingle();
    if (bq.error) { logServer('booking-finance', bq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!bq.data) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');
    const booking = bq.data;

    const lq = await supabase.from('booking_cost_lines').select('*')
      .eq('booking_id', q.booking_id).eq('tenant_id', tenant).eq('active', true)
      .order('created_at', { ascending: true });
    if (lq.error) { logServer('booking-finance', lq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const lines = lq.data || [];
    const fin = bf.computeFinance(booking.amount_cents, lines);

    return sendJson(res, 200, {
      booking_code: booking.booking_code || null,
      currency: booking.currency || 'usd',
      cost_status: booking.cost_status || 'unset',
      cost_confirmed_at: booking.cost_confirmed_at || null,
      amount_cents: booking.amount_cents,
      cost_total_cents: fin.cost_total_cents,
      profit_cents: fin.profit_cents,
      margin_percent: fin.margin_percent,
      line_count: fin.line_count,
      categories: bf.COST_CATEGORIES,
      lines: lines.map(function (l) {
        return { id: l.id, category: l.category, description: l.description, quantity: Number(l.quantity),
          unit_cost_cents: l.unit_cost_cents, total_cents: l.total_cents, vendor: l.vendor, notes: l.notes };
      })
    });
  } catch (err) { logServer('booking-finance', err && err.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
};
