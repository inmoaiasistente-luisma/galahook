'use strict';

/* =========================================================
   POST /api/admin-finance-settings-save (action=finance-settings-save)
   ---------------------------------------------------------
   Crea o actualiza el costo de un tour. SOLO owner (admin → 403).
   Upsert por (tenant_id, tour_id). Cambiar el costo NO modifica
   reservas históricas: solo afecta a las nuevas.
   Body estricto: { tour_id, fixed_cost_cents, cost_per_pax_cents, active }
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const catalog = require('../lib/tour-catalog');

const ALLOWED_KEYS = ['tour_id', 'fixed_cost_cents', 'cost_per_pax_cents', 'active'];
const MAX_COST_CENTS = 100000000;    // $1,000,000 por componente

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  // SOLO owner puede modificar costos. admin (y staff) → 403.
  const session = await requireAdmin(req, res, ['owner']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('finance-settings-save', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');

  const tour = catalog.getTour(body.tour_id);
  if (!tour || tour.requiresQuote || tour.priceCents == null) return sendError(res, 400, 'INVALID_TOUR', 'Unknown or non-payable tour_id');
  if (!Number.isInteger(body.fixed_cost_cents) || body.fixed_cost_cents < 0 || body.fixed_cost_cents > MAX_COST_CENTS) {
    return sendError(res, 400, 'INVALID_FIXED_COST', 'fixed_cost_cents out of range');
  }
  if (!Number.isInteger(body.cost_per_pax_cents) || body.cost_per_pax_cents < 0 || body.cost_per_pax_cents > MAX_COST_CENTS) {
    return sendError(res, 400, 'INVALID_PER_PAX_COST', 'cost_per_pax_cents out of range');
  }
  if (typeof body.active !== 'boolean') return sendError(res, 400, 'INVALID_ACTIVE', 'active must be boolean');

  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();
    const found = await supabase.from('tour_financial_settings').select('id')
      .eq('tenant_id', tenant).eq('tour_id', tour.id).maybeSingle();
    if (found.error) { logServer('finance-settings-save', found.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    if (found.data) {
      const up = await supabase.from('tour_financial_settings').update({
        fixed_cost_cents: body.fixed_cost_cents, cost_per_pax_cents: body.cost_per_pax_cents,
        active: body.active, updated_by_user_id: session.user_id, updated_at: now
      }).eq('id', found.data.id).eq('tenant_id', tenant).select();
      if (up.error || !up.data || up.data.length !== 1) { logServer('finance-settings-save', (up.error && up.error.message) || 'update rows'); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
      return sendJson(res, 200, { saved: true, setting: up.data[0] });
    }

    const ins = await supabase.from('tour_financial_settings').insert({
      tenant_id: tenant, tour_id: tour.id,
      fixed_cost_cents: body.fixed_cost_cents, cost_per_pax_cents: body.cost_per_pax_cents,
      active: body.active, created_by_user_id: session.user_id, updated_by_user_id: session.user_id
    }).select().single();
    if (ins.error) { logServer('finance-settings-save', ins.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    return sendJson(res, 200, { saved: true, setting: ins.data });
  } catch (err) {
    logServer('finance-settings-save', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
