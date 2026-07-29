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
const { getPublicNotesForTour } = require('../server/lib/tour-notes');
const { publicPackagePriceList } = require('../server/lib/package-pricing');

const ALLOWED_KEYS = ['tour_id', 'guests'];
const MAX_GUESTS = 20;

module.exports = async function handler(req, res) {
  /* El precio canónico NUNCA se cachea: cada consulta refleja el precio vivo. */
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('pricing-preview', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to price'); }

  /* GET → lista PÚBLICA de precios de paquetes publicados (para las tarjetas).
     Solo campos visibles; nunca costos, márgenes, borradores ni historial. */
  if (req.method === 'GET') {
    try {
      const r = await publicPackagePriceList(tenant);
      if (!r || !r.ok) return sendError(res, 503, 'PRICES_UNAVAILABLE', 'Prices are temporarily unavailable');
      return sendJson(res, 200, { packages: r.packages, source: r.source });
    } catch (e) {
      logServer('pricing-preview:list', e && e.message);
      return sendError(res, 503, 'PRICES_UNAVAILABLE', 'Prices are temporarily unavailable');
    }
  }

  if (req.method !== 'POST') return methodNotAllowed(res);

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');

  const tour = catalog.getTour(body.tour_id);
  if (!tour) return sendError(res, 400, 'INVALID_TOUR', 'Unknown tour_id');
  if (tour.requiresQuote) {
    /* Experiencia de cotización: mantiene el 400 QUOTE_REQUIRED, pero incluye
       las notas activas para que el modal pueda mostrarlas y aplicar el gate. */
    let n = { notes: [], notes_version: null, requires_acknowledgement: false };
    try { n = await getPublicNotesForTour(tenant, tour.id); }
    catch (e) { logServer('pricing-preview:notes', e && e.message); }
    return sendJson(res, 400, {
      error: 'QUOTE_REQUIRED', message: 'This experience requires a quote request',
      notes: n.notes, notesVersion: n.notes_version, requiresAcknowledgement: n.requires_acknowledgement
    });
  }
  if (!isPositiveInt(body.guests)) return sendError(res, 400, 'INVALID_GUESTS', 'guests must be a positive integer');
  if (body.guests < tour.minGuests) return sendError(res, 400, 'GUESTS_BELOW_MIN', 'guests is below the minimum');
  if (body.guests > MAX_GUESTS) return sendError(res, 400, 'GUESTS_TOO_MANY', 'guests exceeds the maximum');

  try {
    const p = await computeWebPricing({ tenantId: tenant, tourId: tour.id, guests: body.guests });

    /* Notas importantes activas del tour (fail-soft: si fallan, no rompen el
       precio; el cliente vería sin notas y el gate se reaplica en el submit). */
    let notes = { notes: [], notes_version: null, requires_acknowledgement: false };
    try { notes = await getPublicNotesForTour(tenant, tour.id); }
    catch (e) { logServer('pricing-preview:notes', e && e.message); }

    /* Proyección pública: SOLO precios visibles; nada de costos ni config. */
    return sendJson(res, 200, {
      tourId: tour.id,
      guests: body.guests,
      grossAmountCents: p.grossAmountCents,
      discountCents: p.discountCents,
      amountCents: p.amountCents,
      currency: catalog.CURRENCY,
      discountLabel: p.appliedDiscount ? p.appliedDiscount.name : null,
      pricingVersion: p.packagePricing ? p.packagePricing.pricingVersion : null,
      publishedAt: p.packagePricing ? p.packagePricing.publishedAt : null,
      priceSource: p.packagePricing ? p.packagePricing.source : 'catalog',
      notes: notes.notes,
      notesVersion: notes.notes_version,
      requiresAcknowledgement: notes.requires_acknowledgement
    });
  } catch (err) {
    if (err && err.message === 'QUOTE_ONLY') return sendError(res, 400, 'QUOTE_REQUIRED', 'This experience requires a quote request');
    if (err && err.message === 'PACKAGE_PRICE_UNAVAILABLE') return sendError(res, 409, 'PACKAGE_PRICE_UNAVAILABLE', 'Package price is not available');
    logServer('pricing-preview', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to price');
  }
};
