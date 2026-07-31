'use strict';

/* =========================================================
   POST /api/admin-package-price-update
        (action=package-price-update)  body:{package_id, base_price_cents}
   ---------------------------------------------------------
   Flujo DIRECTO del owner: escribe un precio nuevo y se publica en vivo en
   un solo paso (sin draft ni motivo visibles). El backend rellena el motivo
   automáticamente ('owner_direct_update'). SOLO owner (admin/staff → 403).
   Atómico vía RPC update_package_price_atomic. Devuelve el precio persistido.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const { recordAudit } = require('../lib/admin-audit');
const pricing = require('../lib/package-pricing');

const ALLOWED_KEYS = ['package_id', 'base_price_cents'];

function mapError(res, error) {
  switch (error) {
    case 'INVALID_PACKAGE': return sendError(res, 400, 'INVALID_PACKAGE', 'Unknown package_id');
    case 'INVALID_PRICE': return sendError(res, 400, 'INVALID_PRICE', 'Price must be a positive number of cents');
    case 'NO_CHANGE': return sendError(res, 409, 'NO_CHANGE', 'That price is already live');
    case 'NOT_MIGRATED': return sendError(res, 409, 'NOT_MIGRATED', 'Apply migration 0013 to enable live price updates');
    default: return sendError(res, 500, 'INTERNAL_ERROR', 'The price could not be updated');
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner']);   // cambiar el precio live: SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('package-price-update', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let b;
  try { b = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(b, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!Number.isInteger(b.base_price_cents) || b.base_price_cents <= 0) return sendError(res, 400, 'INVALID_PRICE', 'base_price_cents must be a positive integer number of cents');

  try {
    const r = await pricing.updateLivePrice({ tenantId: tenant, packageId: b.package_id, basePriceCents: b.base_price_cents, userId: session.user_id });
    if (!r.ok) return mapError(res, r.error);
    await recordAudit(session, {
      action: 'package_price.update', entity_type: 'package_price', entity_id: b.package_id, always: true,
      before: null, after: { base_price_cents: b.base_price_cents, pricing_version: r.version }
    });
    return sendJson(res, 200, { updated: true, price: r.published, pricing_version: r.version });
  } catch (err) {
    logServer('package-price-update', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
