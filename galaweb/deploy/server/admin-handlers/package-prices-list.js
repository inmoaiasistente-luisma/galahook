'use strict';

/* =========================================================
   GET /api/admin-package-prices-list  (action=package-prices-list)
   ---------------------------------------------------------
   Lista los precios de PAQUETES: fila publicada + borrador por
   paquete, más el precio de catálogo (referencia de respaldo).
   owner y admin pueden CONSULTAR. staff → 403. El rol se relee
   de la BD en cada petición (nunca del navegador).
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { requireAdmin } = require('../lib/admin-auth');
const pricing = require('../lib/package-pricing');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('package-prices-list', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  try {
    const r = await pricing.listAllForAdmin(tenant);
    if (r.status === 'table_missing') {
      // Migración 0012 aún no aplicada: se informa para que la UI lo indique.
      return sendJson(res, 200, {
        role: session.role, canEdit: true, canPublish: session.role === 'owner',
        migrated: false, packages: []
      });
    }
    if (r.status !== 'ok') { logServer('package-prices-list', r.message || 'db error'); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    return sendJson(res, 200, {
      role: session.role,
      canEdit: true,                              // owner y admin pueden editar draft
      canPublish: session.role === 'owner',       // publicar/rollback/toggle: solo owner
      migrated: true,
      packages: r.packages
    });
  } catch (err) {
    logServer('package-prices-list', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
