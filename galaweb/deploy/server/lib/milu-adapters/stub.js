'use strict';

/* =========================================================
   Milu Turismo — adapter STUB (solo infraestructura de desarrollo)
   ---------------------------------------------------------
   El stub existe únicamente para ejercitar el pipeline sin un
   proveedor vivo. NUNCA inventa precios, disponibilidad ni horarios,
   y NUNCA marca resultados como `api_quoted` ni como búsquedas
   completadas. Su único estado es `provider_not_configured`.

   La búsqueda automática real de vuelos se habilita en 8D (Duffel,
   tras pasar la matriz de cobertura sandbox) y la de hoteles en 8E.
   ========================================================= */

const PROVIDER = 'stub';

function searchFlights(req) {
  req = req || {};
  return [{
    provider: PROVIDER,
    provider_result_key: 'stub:flight:' + (req.origin || '') + ':' + (req.destination || ''),
    airline: null,
    source_reference: null,
    origin: req.origin || null,
    destination: req.destination || null,
    departure_at: null,
    arrival_at: null,
    return_departure_at: null,
    return_arrival_at: null,
    passenger_count: req.passenger_count || null,
    cabin: null,
    baggage_summary: null,
    fare_conditions: null,
    taxes_included: null,
    total_price_cents: null,          // jamás inventa precio
    currency: null,
    purchase_url: null,
    deeplink_expires_at: null,
    connection_risk: null,
    availability_status: 'provider_not_configured',
    recommendation_score: null,
    recommendation_reason: null,
    raw_snapshot_sanitized: { note: 'stub adapter: automatic flight provider not connected' },
    checked_at: null
  }];
}

function searchHotels(lodging, prefs, settings) {
  lodging = lodging || {};
  return [{
    provider: PROVIDER,
    provider_result_key: 'stub:hotel:' + (lodging.destination || ''),
    destination: lodging.destination || null,
    hotel_name: '(proveedor automático no conectado)',
    is_preferred: false,
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
    price_per_night_cents: null,
    price_per_person_cents: null,
    total_price_cents: null,          // jamás inventa precio
    currency: null,
    in_target_range: null,
    booking_url: null,
    location_notes: null,
    availability_status: 'provider_not_configured',
    preferred_hotel_rejection_reason: null,
    recommendation_score: null,
    recommendation_reason: null,
    raw_snapshot_sanitized: { note: 'stub adapter: automatic hotel provider not connected' },
    checked_at: null
  }];
}

module.exports = { PROVIDER, searchFlights, searchHotels };
