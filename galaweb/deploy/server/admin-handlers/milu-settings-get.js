'use strict';

/* =========================================================
   GET /api/admin-milu-settings-get  (action=milu-settings-get)
   ---------------------------------------------------------
   owner/admin consultan la configuración de Milu: rango objetivo,
   límites de costo, proveedor hotelero, modelo (Haiku v1) y estado de
   proveedores. staff → 403.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { requireAdmin } = require('../lib/admin-auth');
const { getSupabase } = require('../lib/supabase');
const { DEFAULT_MILU_SETTINGS, resolveMiluModel } = require('../lib/milu-cost');
const { getMiluFlags, providerState } = require('../lib/milu-flags');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); } catch (e) { logServer('milu-settings-get', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  try {
    const supabase = getSupabase();
    const r = await supabase.from('milu_settings').select('*').eq('tenant_id', tenant).maybeSingle();
    const settings = r.data || Object.assign({ tenant_id: tenant }, DEFAULT_MILU_SETTINGS);
    const model = resolveMiluModel(process.env);
    const flags = getMiluFlags(process.env);
    return sendJson(res, 200, {
      role: session.role,
      canEditLimits: session.role === 'owner',   // límites globales: solo owner
      migrated: !!r.data,
      settings: settings,
      model: { label: model.ok ? model.label : 'Haiku', configured: model.ok },
      providers: { flights: providerState(process.env, 'flights'), hotels: providerState(process.env, 'hotels') },
      flags: flags
    });
  } catch (err) {
    logServer('milu-settings-get', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
