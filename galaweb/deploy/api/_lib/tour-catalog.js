'use strict';

/* =========================================================
   LOAN-IX Booking Engine — catálogo autorizado de experiencias
   ---------------------------------------------------------
   FUENTE DE VERDAD de precios. El servidor NUNCA acepta el
   precio enviado por el navegador; lo calcula desde aquí.

   Precios en CENTAVOS de USD. Nombres canónicos en inglés
   (se guardan tal cual en Supabase como tour_name).

   Reglas replicadas de assets/js/app.js (bkTotal):
     - unit 'person': gross = price * guests
     - unit 'boat'  : gross = price (plano; guests no multiplica)
     - descuento de grupo: paquetes (person, minGuests>=2) con 3+
       viajeros → 20% off, redondeado a DÓLAR ENTERO antes de
       convertir a centavos.
   ========================================================= */

const CURRENCY = 'usd';

const TOURS = {
  // ---- Paquetes (person, mínimo 2) ----
  p3:   { name: 'Island Escape (4 Days)',                              priceCents: 279900, unit: 'person', minGuests: 2, requiresQuote: false, type: 'package' },
  p4:   { name: 'Hook Signature (5 Days)',                             priceCents: 349900, unit: 'person', minGuests: 2, requiresQuote: false, type: 'package' },
  p7:   { name: 'Wild Galápagos (7 Days)',                            priceCents: 489900, unit: 'person', minGuests: 2, requiresQuote: false, type: 'package' },
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

  // ---- Pesca deportiva (boat, mínimo 1) ----
  half:       { name: 'Half-Day Charter',     priceCents: 219900, unit: 'boat', minGuests: 1, requiresQuote: false, type: 'fishing' },
  full:       { name: 'Full-Day Charter',     priceCents: 289900, unit: 'boat', minGuests: 1, requiresQuote: false, type: 'fishing' },
  expedition: { name: 'Multi-Day Expedition', priceCents: null,   unit: 'boat', minGuests: 1, requiresQuote: true,  type: 'fishing' }
};

/** Devuelve una copia inmutable del tour (con su id) o null si no existe. */
function getTour(tourId) {
  if (typeof tourId !== 'string' || !Object.prototype.hasOwnProperty.call(TOURS, tourId)) return null;
  return Object.assign({ id: tourId }, TOURS[tourId]);
}

/** Descuento de grupo: paquetes (person, min>=2) con 3 o más viajeros. */
function isGroupDiscountEligible(tour, guests) {
  return tour.unit === 'person' && tour.minGuests >= 2 && guests >= 3;
}

/**
 * Calcula amount_cents en el servidor. Solo para tours pagables.
 * Replica EXACTAMENTE assets/js/app.js:bkTotal (redondeo a dólar entero).
 * @param {object} tour   objeto devuelto por getTour()
 * @param {number} guests entero positivo
 * @returns {number} total en centavos
 */
function calculateAmountCents(tour, guests) {
  if (tour.requiresQuote || tour.priceCents == null) {
    throw new Error('calculateAmountCents called on a quote-only tour');
  }
  const priceUsd = tour.priceCents / 100;                 // los precios son dólares enteros
  const grossUsd = tour.unit === 'person' ? priceUsd * guests : priceUsd;
  const totalUsd = isGroupDiscountEligible(tour, guests) ? Math.round(grossUsd * 0.8) : grossUsd;
  return Math.round(totalUsd * 100);                      // a centavos (entero exacto)
}

module.exports = { TOURS, CURRENCY, getTour, isGroupDiscountEligible, calculateAmountCents };
