'use strict';

/* =========================================================
   LOAN-IX Booking Engine — catálogo autorizado de experiencias
   ---------------------------------------------------------
   FUENTE DE VERDAD de precios. El servidor NUNCA acepta el
   precio enviado por el navegador; lo calcula desde aquí.

   Precios en CENTAVOS de USD. Nombres canónicos en inglés
   (se guardan tal cual en Supabase como tour_name).

   Cálculo del BRUTO (calculateGrossCents):
     - unit 'person': gross = price * guests
     - unit 'boat'  : gross = price (plano; guests no multiplica)
   Los DESCUENTOS ya no viven aquí: los aplica pricing-engine.js con
   reglas configurables (public.discount_rules). El antiguo −20 % fijo
   por grupo se retiró; sin regla activa, el bruto es el total.
   ========================================================= */

const CURRENCY = 'usd';

const TOURS = {
  // ---- Paquetes (person, mínimo 2) ----
  p3:   { name: 'Island Escape (4 Days)',                              priceCents: 349900, unit: 'person', minGuests: 2, requiresQuote: false, type: 'package' },
  p4:   { name: 'Hook Signature (5 Days)',                             priceCents: 399900, unit: 'person', minGuests: 2, requiresQuote: false, type: 'package' },
  p7:   { name: 'Wild Galápagos (7 Days)',                            priceCents: 479900, unit: 'person', minGuests: 2, requiresQuote: false, type: 'package' },
  p8sc: { name: 'Island Hopper — Santa Cruz & San Cristóbal (8 Days)', priceCents: 531900, unit: 'person', minGuests: 2, requiresQuote: false, type: 'package' },
  p8is: { name: 'Island Hopper — Santa Cruz & Isabela (8 Days)',       priceCents: 531900, unit: 'person', minGuests: 2, requiresQuote: false, type: 'package' },

  // ---- Tours de día (person, mínimo 1) ----
  kicker:       { name: 'Kicker Rock — León Dormido', priceCents: 19500, unit: 'person', minGuests: 1, requiresQuote: false, type: 'tour' },
  t360:         { name: 'San Cristóbal 360°',         priceCents: 24000, unit: 'person', minGuests: 1, requiresQuote: false, type: 'tour' },
  diving:       { name: 'Diving Kicker Rock',         priceCents: 29500, unit: 'person', minGuests: 1, requiresQuote: false, type: 'tour' },
  lobos:        { name: 'Isla Lobos & Playa Ochoa',   priceCents: 18000, unit: 'person', minGuests: 1, requiresQuote: false, type: 'tour' },
  highlands:    { name: 'Highlands & El Junco',       priceCents: 9000,  unit: 'person', minGuests: 1, requiresQuote: false, type: 'tour' },
  'punta-pitt': { name: 'Punta Pitt',                 priceCents: 26000, unit: 'person', minGuests: 1, requiresQuote: false, type: 'tour' },
  espanola:     { name: 'Española Day Trip',          priceCents: 31500, unit: 'person', minGuests: 1, requiresQuote: false, type: 'tour' },
  private:      { name: 'Private Boat Charter',       priceCents: null,  unit: 'boat',   minGuests: 1, requiresQuote: true,  type: 'tour' },

  // ---- Pesca deportiva (boat) — DECISIÓN COMERCIAL: todo por cotización ----
  // Sin precio público ni cobro por Stripe. El servidor NO puede cobrar
  // estos ids: priceCents=null + requiresQuote=true fuerzan el flujo de
  // /api/quote-request. (Las reservas históricas conservan su importe;
  // esto solo cambia el catálogo vigente.)
  half:       { name: 'Half-Day Charter',     priceCents: null, unit: 'boat', minGuests: 1, requiresQuote: true, type: 'fishing' },
  full:       { name: 'Full-Day Charter',     priceCents: null, unit: 'boat', minGuests: 1, requiresQuote: true, type: 'fishing' },
  expedition: { name: 'Multi-Day Expedition', priceCents: null, unit: 'boat', minGuests: 1, requiresQuote: true, type: 'fishing' }
};

/** Devuelve una copia inmutable del tour (con su id) o null si no existe. */
function getTour(tourId) {
  if (typeof tourId !== 'string' || !Object.prototype.hasOwnProperty.call(TOURS, tourId)) return null;
  return Object.assign({ id: tourId }, TOURS[tourId]);
}

/**
 * Precio BRUTO en centavos (sin descuentos). Solo para tours pagables.
 * Los descuentos ya NO viven aquí: los aplica server/lib/pricing-engine.js
 * con las reglas configurables (public.discount_rules). El antiguo −20 %
 * fijo por grupo se retiró: sin regla activa, el bruto es el total.
 * @param {object} tour   objeto devuelto por getTour()
 * @param {number} guests entero positivo
 * @returns {number} bruto en centavos (entero exacto)
 */
function calculateGrossCents(tour, guests) {
  if (tour.requiresQuote || tour.priceCents == null) {
    throw new Error('calculateGrossCents called on a quote-only tour');
  }
  const priceUsd = tour.priceCents / 100;                 // los precios son dólares enteros
  const grossUsd = tour.unit === 'person' ? priceUsd * guests : priceUsd;
  return Math.round(grossUsd * 100);                      // a centavos (entero exacto)
}

module.exports = { TOURS, CURRENCY, getTour, calculateGrossCents };
