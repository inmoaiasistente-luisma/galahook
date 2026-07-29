'use strict';

/* =========================================================
   POST /api/admin-package-price-toggle
        (action=package-price-toggle)  body:{package_id,action,change_reason}
   ---------------------------------------------------------
   DESACTIVA o REACTIVA el precio publicado de un paquete (solo
   OWNER). Requiere motivo (≥5 caracteres).
     · deactivate → archiva el published (queda 0 published:
       el checkout de ese paquete se BLOQUEA).
     · reactivate → vuelve a publicar el último precio conocido
       como una nueva versión.
   Registra la acción en el historial (append-only).
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, getTenantId } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const pricing = require('../lib/package-pricing');

/* reactivate exige source_price_id: se reactiva una VERSIÓN identificada; el RPC
   lee el precio de esa fila archivada (nunca un importe libre del navegador). */
const ALLOWED_KEYS = ['package_id', 'action', 'change_reason', 'source_price_id'];

function mapError(res, error) {
  switch (error) {
    case 'INVALID_PACKAGE': return sendError(res, 400, 'INVALID_PACKAGE', 'Unknown package_id');
    case 'INVALID_ACTION': return sendError(res, 400, 'INVALID_ACTION', "action must be 'deactivate' or 'reactivate'");
    case 'REASON_REQUIRED': return sendError(res, 400, 'REASON_REQUIRED', 'change_reason must be at least 5 characters');
    case 'NOT_PUBLISHED': return sendError(res, 409, 'NOT_PUBLISHED', 'This package has no published price to deactivate');
    case 'ALREADY_PUBLISHED': return sendError(res, 409, 'ALREADY_PUBLISHED', 'This package already has a published price');
    case 'SOURCE_NOT_FOUND': return sendError(res, 409, 'SOURCE_NOT_FOUND', 'The price version to reactivate was not found');
    case 'NO_PRICE_TO_REACTIVATE': return sendError(res, 409, 'NO_PRICE_TO_REACTIVATE', 'There is no previous price to reactivate');
    case 'NOT_MIGRATED': return sendError(res, 409, 'NOT_MIGRATED', 'Apply migration 0012 before managing package prices');
    default: return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner']);   // toggle: SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('package-price-toggle', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let b;
  try { b = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(b, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (b.action !== 'deactivate' && b.action !== 'reactivate') return sendError(res, 400, 'INVALID_ACTION', "action must be 'deactivate' or 'reactivate'");
  if (typeof b.change_reason !== 'string' || b.change_reason.trim().length < 5) return sendError(res, 400, 'REASON_REQUIRED', 'change_reason must be at least 5 characters');
  if (b.action === 'reactivate' && !isUuid(b.source_price_id)) return sendError(res, 400, 'SOURCE_NOT_FOUND', 'source_price_id must be a valid UUID');

  try {
    const r = await pricing.togglePackagePrice({ tenantId: tenant, packageId: b.package_id, action: b.action, userId: session.user_id, reason: b.change_reason, sourceId: b.source_price_id });
    if (!r.ok) return mapError(res, r.error);
    return sendJson(res, 200, { ok: true, action: b.action, price: r.published || null });
  } catch (err) {
    logServer('package-price-toggle', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
