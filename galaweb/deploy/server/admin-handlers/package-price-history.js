'use strict';

/* =========================================================
   GET /api/admin-package-price-history?package_id=p4
        (action=package-price-history)
   ---------------------------------------------------------
   Historial (append-only) de cambios de precio de un paquete.
   owner y admin pueden CONSULTAR. staff → 403.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { requireAdmin } = require('../lib/admin-auth');
const pricing = require('../lib/package-pricing');

function readQuery(req) {
  if (req.query && typeof req.query === 'object' && typeof req.query.package_id === 'string') return req.query.package_id;
  try { return new URL(req.url, 'http://localhost').searchParams.get('package_id') || ''; }
  catch (e) { return ''; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('package-price-history', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const packageId = readQuery(req);
  if (!pricing.isPackageId(packageId)) return sendError(res, 400, 'INVALID_PACKAGE', 'Unknown package_id');

  try {
    const r = await pricing.getPackagePriceHistory(tenant, packageId);
    if (r.status === 'table_missing') return sendJson(res, 200, { migrated: false, history: [] });
    if (r.status !== 'ok') { logServer('package-price-history', 'db error'); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    return sendJson(res, 200, { migrated: true, package_id: packageId, history: r.history });
  } catch (err) {
    logServer('package-price-history', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
