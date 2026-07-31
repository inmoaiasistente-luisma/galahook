'use strict';

/* =========================================================
   POST /api/admin-booking-cost-line-add  (action=booking-cost-line-add)
   ---------------------------------------------------------
   owner/admin: agrega una línea de costo a una reserva. El total se calcula
   en la BD (columna GENERATED); aquí se validan las entradas. Agregar una
   línea deja la reserva en 'estimated' (aún NO confirmada). staff → 403.
   Body: { booking_id, category, description?, quantity?, unit_cost_cents, vendor?, notes? }
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId, isUuid } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const { getSupabase } = require('../lib/supabase');
const bf = require('../lib/booking-finance');

const ALLOWED_KEYS = ['booking_id', 'category', 'description', 'quantity', 'unit_cost_cents', 'vendor', 'notes'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); } catch (e) { logServer('booking-cost-line-add', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id must be a UUID');

  const v = bf.validateCostLine(body);
  if (!v.ok) return sendError(res, 400, v.code, 'Invalid cost line');

  try {
    const supabase = getSupabase();
    const bq = await supabase.from('bookings').select('id,cost_status').eq('id', body.booking_id).eq('tenant_id', tenant).maybeSingle();
    if (bq.error) { logServer('booking-cost-line-add', bq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!bq.data) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');

    // total_cents es GENERATED en la BD → NO se envía.
    const ins = await supabase.from('booking_cost_lines').insert({
      tenant_id: tenant, booking_id: body.booking_id,
      category: v.line.category, description: v.line.description,
      quantity: v.line.quantity, unit_cost_cents: v.line.unit_cost_cents,
      vendor: v.line.vendor, notes: v.line.notes, currency: 'usd',
      created_by_user_id: session.user_id
    }).select().single();
    if (ins.error || !ins.data) { logServer('booking-cost-line-add', (ins.error && ins.error.message) || 'insert'); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    // Cambiar las líneas invalida un 'confirmed' previo → vuelve a 'estimated'
    // (requiere reconfirmación). El snapshot bookings.cost_cents no se toca aquí.
    if (bq.data.cost_status !== 'estimated') {
      await supabase.from('bookings').update({ cost_status: 'estimated' }).eq('id', body.booking_id).eq('tenant_id', tenant);
    }

    const line = ins.data;
    return sendJson(res, 200, {
      added: true, cost_status: 'estimated',
      line: { id: line.id, category: line.category, description: line.description, quantity: Number(line.quantity),
        unit_cost_cents: line.unit_cost_cents, total_cents: line.total_cents, vendor: line.vendor, notes: line.notes }
    });
  } catch (err) { logServer('booking-cost-line-add', err && err.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
};
