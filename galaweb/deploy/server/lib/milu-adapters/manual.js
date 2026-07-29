'use strict';

/* =========================================================
   Milu Turismo — adapter MANUAL (respaldo explícito autorizado)
   ---------------------------------------------------------
   El adapter manual NO consulta proveedores automáticos ni inventa
   precios/disponibilidad. Prepara ENLACES OFICIALES INTERNOS
   (validados contra la allowlist) para que owner/admin confirmen y
   registren manualmente. Estados permitidos:
     · provider_not_configured
     · official_link_only
     · manual_confirmation_required
     · provider_no_content
   Jamás `api_quoted`. Los enlaces son internos (equipo compra/reserva);
   nunca se envían al cliente.
   ========================================================= */

const { isAllowedPurchaseUrl } = require('../milu-allowlist');

const PROVIDER = 'manual';

/* Boutique de Galápagos que casi nunca están en inventario mayorista:
   se marcan explícitamente y se ofrece confirmación manual. */
const GALAPAGOS_BOUTIQUE = ['san_cristobal', 'isabela'];

function searchFlights(req) {
  // Sin proveedor automático conectado: no hay contenido que devolver.
  return [{
    provider: PROVIDER,
    airline: null,
    source_reference: null,
    origin: (req && req.origin) || null,
    destination: (req && req.destination) || null,
    departure_at: null,
    arrival_at: null,
    return_departure_at: null,
    return_arrival_at: null,
    passenger_count: (req && req.passenger_count) || null,
    cabin: null,
    baggage_summary: null,
    fare_conditions: null,
    taxes_included: null,
    total_price_cents: null,
    currency: null,
    purchase_url: null,
    deeplink_expires_at: null,
    connection_risk: null,
    availability_status: 'provider_no_content',
    recommendation_score: null,
    recommendation_reason: null,
    raw_snapshot_sanitized: { note: 'manual fallback: no automatic flight provider connected' },
    checked_at: null
  }];
}

/**
 * Prepara opciones de hotel a partir de los hoteles preferidos configurados,
 * usando SOLO enlaces oficiales permitidos por la allowlist. No inventa precios.
 * @param lodging  requerimiento de alojamiento ({destination, ...})
 * @param prefs    filas de hotel_search_preferences para el destino
 */
function searchHotels(lodging, prefs, settings) {
  lodging = lodging || {};
  prefs = prefs || [];
  const dest = lodging.destination || null;
  const forDest = prefs.filter(function (h) { return h.destination === dest; })
    .sort(function (a, b) { return (a.priority || 99) - (b.priority || 99); });

  if (!forDest.length) {
    return [{
      provider: PROVIDER, destination: dest, hotel_name: '(sin hotel preferido configurado)',
      is_preferred: false, is_airbnb: false,
      check_in_date: lodging.check_in_date || null, check_out_date: lodging.check_out_date || null,
      nights: lodging.nights || null, rooms: lodging.rooms_required || null, guest_count: lodging.guest_count || null,
      room_type: null, breakfast_included: null, cancellation_summary: null, taxes_included: null,
      price_per_night_cents: null, price_per_person_cents: null, total_price_cents: null, currency: null,
      in_target_range: null, booking_url: null, location_notes: null,
      availability_status: 'provider_no_content',
      preferred_hotel_rejection_reason: null, recommendation_score: null, recommendation_reason: null,
      raw_snapshot_sanitized: { note: 'manual: no preferred hotels configured for destination' }, checked_at: null
    }];
  }

  return forDest.map(function (h) {
    // Candidato de enlace oficial: el primer alias que pase la allowlist.
    var link = null;
    var aliases = Array.isArray(h.search_aliases) ? h.search_aliases : [];
    for (var i = 0; i < aliases.length; i++) {
      if (typeof aliases[i] === 'string' && isAllowedPurchaseUrl(aliases[i])) { link = aliases[i]; break; }
    }
    var boutique = GALAPAGOS_BOUTIQUE.indexOf(dest) !== -1;
    return {
      provider: PROVIDER,
      destination: dest,
      hotel_name: h.hotel_name,
      is_preferred: true,
      is_airbnb: false,
      check_in_date: lodging.check_in_date || null,
      check_out_date: lodging.check_out_date || null,
      nights: lodging.nights || null,
      rooms: lodging.rooms_required || null,
      guest_count: lodging.guest_count || null,
      room_type: null,
      breakfast_included: null,
      cancellation_summary: null,
      taxes_included: null,
      price_per_night_cents: null,      // jamás inventa precio
      price_per_person_cents: null,
      total_price_cents: null,
      currency: null,
      in_target_range: null,
      booking_url: link,                // solo si pasó la allowlist; si no, null
      location_notes: h.preference_notes || null,
      // boutique Galápagos → not_in_provider_inventory (probablemente fuera de mayorista)
      availability_status: link ? 'official_link_only' : 'manual_confirmation_required',
      preferred_hotel_rejection_reason: boutique ? 'not_in_provider_inventory' : null,
      recommendation_score: null,
      recommendation_reason: null,
      raw_snapshot_sanitized: { note: 'manual: preferred hotel, official link only', priority: h.priority || null },
      checked_at: null
    };
  });
}

module.exports = { PROVIDER, GALAPAGOS_BOUTIQUE, searchFlights, searchHotels };
