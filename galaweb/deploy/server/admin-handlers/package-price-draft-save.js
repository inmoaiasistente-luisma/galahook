'use strict';

/* =========================================================
   POST /api/admin-package-price-draft-save
        (action=package-price-draft-save)
   ---------------------------------------------------------
   Crea o actualiza el BORRADOR (draft) de precio de un paquete.
   Un draft NO afecta Production hasta que se publica. owner y
   admin pueden guardar borradores. staff → 403. El precio se
   recibe en CENTAVOS (entero); el navegador nunca decide el cobro.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId } = require('../lib/http');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const pricing = require('../lib/package-pricing');

const ALLOWED_KEYS = ['package_id', 'base_price_cents'];

function mapError(res, error) {
  switch (error) {
    case 'INVALID_PACKAGE': return sendError(res, 400, 'INVALID_PACKAGE', 'Unknown package_id');
    case 'INVALID_PRICE': return sendError(res, 400, 'INVALID_PRICE', 'base_price_cents must be a positive integer (cents)');
    case 'NOT_MIGRATED': return sendError(res, 409, 'NOT_MIGRATED', 'Apply migration 0012 before managing package prices');
    default: return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);   // owner y admin pueden editar draft
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('package-price-draft-save', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let b;
  try { b = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(b, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!Number.isInteger(b.base_price_cents)) return sendError(res, 400, 'INVALID_PRICE', 'base_price_cents must be an integer number of cents');

  try {
    const r = await pricing.saveDraftPrice({ tenantId: tenant, packageId: b.package_id, basePriceCents: b.base_price_cents, userId: session.user_id });
    if (!r.ok) return mapError(res, r.error);
    // Se relee lo persistido: el cliente ve el valor realmente guardado.
    return sendJson(res, 200, { saved: true, draft: r.draft });
  } catch (err) {
    logServer('package-price-draft-save', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
