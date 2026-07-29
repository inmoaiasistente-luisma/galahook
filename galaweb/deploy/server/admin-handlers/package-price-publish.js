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

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, getTenantId } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const pricing = require('../lib/package-pricing');

/* El precio NO viaja en el cuerpo: se publica un DRAFT identificado por id y el
   RPC lee el importe desde ese draft. El navegador solo aporta draft_id + motivo. */
const ALLOWED_KEYS = ['package_id', 'draft_id', 'change_reason'];

function mapError(res, error) {
  switch (error) {
    case 'INVALID_PACKAGE': return sendError(res, 400, 'INVALID_PACKAGE', 'Unknown package_id');
    case 'INVALID_PRICE': return sendError(res, 409, 'INVALID_PRICE', 'The draft price is invalid');
    case 'REASON_REQUIRED': return sendError(res, 400, 'REASON_REQUIRED', 'change_reason must be at least 5 characters');
    case 'DRAFT_NOT_FOUND': return sendError(res, 409, 'DRAFT_NOT_FOUND', 'Draft not found or already published');
    case 'DRAFT_TENANT_MISMATCH':
    case 'DRAFT_PACKAGE_MISMATCH': return sendError(res, 409, 'INVALID_DRAFT', 'Draft does not match this package');
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
  if (!isUuid(b.draft_id)) return sendError(res, 400, 'INVALID_DRAFT', 'draft_id must be a valid UUID');
  if (typeof b.change_reason !== 'string' || b.change_reason.trim().length < 5) return sendError(res, 400, 'REASON_REQUIRED', 'change_reason must be at least 5 characters');

  try {
    const r = await pricing.publishPackagePrice({
      tenantId: tenant, packageId: b.package_id, draftId: b.draft_id,
      userId: session.user_id, reason: b.change_reason
    });
    if (!r.ok) return mapError(res, r.error);
    return sendJson(res, 200, { published: true, price: r.published, pricing_version: r.version });
  } catch (err) {
    logServer('package-price-publish', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
