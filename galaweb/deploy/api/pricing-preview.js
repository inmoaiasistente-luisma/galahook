'use strict';

/* =========================================================
   POST /api/pricing-preview   body: { tour_id, guests }
   ---------------------------------------------------------
   Previsualización PÚBLICA del precio de una reserva web. La usa el
   checkout para mostrar el total, y NO crea reserva ni PaymentIntent.

   Devuelve solo lo que el cliente puede ver: bruto, descuento, total,
   moneda y una etiqueta de descuento. NUNCA costos, utilidad ni la
   configuración interna. El navegador no envía ni decide importes.
   ========================================================= */

const { sendJson, sendError, logServer, methodNotAllowed, readJsonBody, rejectUnknownKeys, isPositiveInt, getTenantId } = require('../server/lib/http');
const catalog = require('../server/lib/tour-catalog');
const { computeWebPricing } = require('../server/lib/pricing-engine');

const ALLOWED_KEYS = ['tour_id', 'guests'];
const MAX_GUESTS = 20;

module.exports = async function handler(req, res) {
  /* El precio canónico NUNCA se cachea: cada consulta refleja el catálogo vivo. */
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  if (req.method !== 'POST') return methodNotAllowed(res);

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('pricing-preview', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to price'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');

  const tour = catalog.getTour(body.tour_id);
  if (!tour) return sendError(res, 400, 'INVALID_TOUR', 'Unknown tour_id');
  if (tour.requiresQuote) return sendError(res, 400, 'QUOTE_REQUIRED', 'This experience requires a quote request');
  if (!isPositiveInt(body.guests)) return sendError(res, 400, 'INVALID_GUESTS', 'guests must be a positive integer');
  if (body.guests < tour.minGuests) return sendError(res, 400, 'GUESTS_BELOW_MIN', 'guests is below the minimum');
  if (body.guests > MAX_GUESTS) return sendError(res, 400, 'GUESTS_TOO_MANY', 'guests exceeds the maximum');

  try {
    const p = await computeWebPricing({ tenantId: tenant, tourId: tour.id, guests: body.guests });
    /* Proyección pública: SOLO precios visibles; nada de costos ni config. */
    return sendJson(res, 200, {
      tourId: tour.id,
      guests: body.guests,
      grossAmountCents: p.grossAmountCents,
      discountCents: p.discountCents,
      amountCents: p.amountCents,
      currency: catalog.CURRENCY,
      discountLabel: p.appliedDiscount ? p.appliedDiscount.name : null
    });
  } catch (err) {
    if (err && err.message === 'QUOTE_ONLY') return sendError(res, 400, 'QUOTE_REQUIRED', 'This experience requires a quote request');
    logServer('pricing-preview', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to price');
  }
};
