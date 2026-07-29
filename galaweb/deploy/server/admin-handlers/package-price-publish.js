'use strict';

/* =========================================================
   POST /api/admin-package-price-publish
        (action=package-price-publish)
   ---------------------------------------------------------
   PUBLICA un nuevo precio de paquete (solo OWNER). Archiva el
   precio anterior, inserta la nueva versión publicada, consume
   el draft y registra el cambio en el historial. Requiere motivo
   (≥5 caracteres). El precio se recibe en CENTAVOS. Tras publicar
   se RELEE Supabase y se devuelve el valor persistido (no se
   reporta éxito antes de confirmar la escritura real).
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const pricing = require('../lib/package-pricing');

const ALLOWED_KEYS = ['package_id', 'base_price_cents', 'change_reason'];

function mapError(res, error) {
  switch (error) {
    case 'INVALID_PACKAGE': return sendError(res, 400, 'INVALID_PACKAGE', 'Unknown package_id');
    case 'INVALID_PRICE': return sendError(res, 400, 'INVALID_PRICE', 'base_price_cents must be a positive integer (cents)');
    case 'REASON_REQUIRED': return sendError(res, 400, 'REASON_REQUIRED', 'change_reason must be at least 5 characters');
    case 'NOT_MIGRATED': return sendError(res, 409, 'NOT_MIGRATED', 'Apply migration 0012 before managing package prices');
    default: return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner']);   // publicar: SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('package-price-publish', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let b;
  try { b = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(b, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!Number.isInteger(b.base_price_cents)) return sendError(res, 400, 'INVALID_PRICE', 'base_price_cents must be an integer number of cents');
  if (typeof b.change_reason !== 'string' || b.change_reason.trim().length < 5) return sendError(res, 400, 'REASON_REQUIRED', 'change_reason must be at least 5 characters');

  try {
    const r = await pricing.publishPackagePrice({
      tenantId: tenant, packageId: b.package_id, basePriceCents: b.base_price_cents,
      userId: session.user_id, reason: b.change_reason
    });
    if (!r.ok) return mapError(res, r.error);
    return sendJson(res, 200, { published: true, price: r.published, pricing_version: r.version });
  } catch (err) {
    logServer('package-price-publish', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
