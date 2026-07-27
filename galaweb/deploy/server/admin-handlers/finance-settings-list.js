'use strict';

/* =========================================================
   GET /api/admin-finance-settings   (action=finance-settings-list)
   ---------------------------------------------------------
   Lista los costos por tour. owner y admin pueden CONSULTAR
   (admin no puede guardar — eso lo bloquea finance-settings-save).
   staff → 403. La lista incluye TODOS los tours pagables del
   catálogo, con su configuración si existe.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');
const catalog = require('../lib/tour-catalog');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('finance-settings-list', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  try {
    const supabase = getSupabase();
    const rs = await supabase.from('tour_financial_settings').select('*').eq('tenant_id', tenant);
    if (rs.error) { logServer('finance-settings-list', rs.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const byTour = {};
    (rs.data || []).forEach(function (r) { byTour[r.tour_id] = r; });

    /* Todos los tours pagables del catálogo + su config (o valores por defecto). */
    const tours = Object.keys(catalog.TOURS)
      .map(function (id) { return catalog.getTour(id); })
      .filter(function (t) { return !t.requiresQuote && t.priceCents != null; })
      .map(function (t) {
        const cfg = byTour[t.id];
        return {
          tour_id: t.id, tour_name: t.name, unit: t.unit, base_price_cents: t.priceCents,
          fixed_cost_cents: cfg ? cfg.fixed_cost_cents : 0,
          cost_per_pax_cents: cfg ? cfg.cost_per_pax_cents : 0,
          active: cfg ? cfg.active : false,
          configured: !!cfg
        };
      });

    return sendJson(res, 200, { role: session.role, canEdit: session.role === 'owner', settings: tours });
  } catch (err) {
    logServer('finance-settings-list', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
