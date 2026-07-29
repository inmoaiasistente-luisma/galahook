'use strict';

/* =========================================================
   POST /api/admin-package-price-rollback
        (action=package-price-rollback)
   ---------------------------------------------------------
   REVIERTE al precio de la versión anterior (solo OWNER). NO
   borra ni sobrescribe: publica el valor histórico como una
   NUEVA versión (action='rollback'), incrementando la versión y
   registrando quién y por qué. Requiere motivo (≥5 caracteres).
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const pricing = require('../lib/package-pricing');

const ALLOWED_KEYS = ['package_id', 'change_reason'];

function mapError(res, error) {
  switch (error) {
    case 'INVALID_PACKAGE': return sendError(res, 400, 'INVALID_PACKAGE', 'Unknown package_id');
    case 'REASON_REQUIRED': return sendError(res, 400, 'REASON_REQUIRED', 'change_reason must be at least 5 characters');
    case 'NO_PREVIOUS': return sendError(res, 409, 'NO_PREVIOUS', 'There is no previous version to roll back to');
    case 'NOT_MIGRATED': return sendError(res, 409, 'NOT_MIGRATED', 'Apply migration 0012 before managing package prices');
    default: return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner']);   // rollback: SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('package-price-rollback', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let b;
  try { b = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(b, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (typeof b.change_reason !== 'string' || b.change_reason.trim().length < 5) return sendError(res, 400, 'REASON_REQUIRED', 'change_reason must be at least 5 characters');

  try {
    const r = await pricing.rollbackPackagePrice({ tenantId: tenant, packageId: b.package_id, userId: session.user_id, reason: b.change_reason });
    if (!r.ok) return mapError(res, r.error);
    return sendJson(res, 200, { rolledBack: true, price: r.published, pricing_version: r.version });
  } catch (err) {
    logServer('package-price-rollback', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
