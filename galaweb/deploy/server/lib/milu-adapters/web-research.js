'use strict';

/* =========================================================
   Milu Turismo — adapter WEB RESEARCH (8D, arquitectura híbrida)
   ---------------------------------------------------------
   SERVER-ONLY. Descubre y lee páginas públicas AUTORIZADAS con las
   herramientas oficiales de Anthropic (Haiku), extrae/normaliza/compara
   y devuelve OPCIONES:
     · provider = 'web_research'
     · research_review_status = 'unverified' (nace sin verificar)
     · research_source_url = página externa AUTORIZADA (la fuente del
       precio es la página, NO Anthropic)
     · availability_status = 'manual_confirmation_required' (NO se usa un
       estado web research en availability; disponibilidad ≠ revisión)
     · nunca api_quoted; precio solo si la página lo entregó de forma
       verificable; enlaces INTERNOS (allowlist), nunca al cliente.
   Fallback por dominio: si una página dinámica no entrega un precio
   verificable, se devuelve una opción con la URL del dominio autorizado y
   precio nulo, para que un humano confirme (revisión obligatoria).
   Todo hallazgo requiere aprobación humana; sin compra/reserva/pago.
   ========================================================= */

const webtools = require('../milu-web-tools');
const { isAllowedResearchDomain, researchHostOf } = require('../milu-allowlist');

/* Dominios oficiales de fallback por contexto (todos en la allowlist). */
const FLIGHT_FALLBACK_URL = 'https://www.avianca.com/';
const HOTEL_FALLBACK_BY_DEST = {
  san_cristobal: 'https://www.hotelmiconia.com/',
  santa_cruz:    'https://www.booking.com/',
  isabela:       'https://www.booking.com/',
  quito:         'https://www.ihg.com/',
  guayaquil:     'https://www.ihg.com/'
};

function nowIso() { return new Date().toISOString(); }
function nonNegInt(v) { return (typeof v === 'number' && isFinite(v) && v >= 0) ? Math.round(v) : null; }
function cur(v) { return (typeof v === 'string' && v.trim()) ? v.trim().toUpperCase().slice(0, 3) : 'USD'; }

/* ---------------- mapeo de hallazgos → opciones ---------------- */
function mapFlightFinding(snapshot, f) {
  if (!f || !isAllowedResearchDomain(f.source_url)) return null;   // fuente obligatoria + allowlist
  const origin = (f.origin || (snapshot && snapshot.preferred_connection_city_code)) || null;
  const destination = f.destination || 'SCY';
  return {
    provider: 'web_research',
    provider_result_key: 'webresearch:flight:' + (origin || '') + ':' + destination + ':' + researchHostOf(f.source_url),
    airline: f.airline || null,
    origin: origin, destination: destination,
    passenger_count: (snapshot && snapshot.passenger_count) || null,
    total_price_cents: nonNegInt(f.price_cents),          // solo si la página lo dio verificable
    currency: cur(f.currency),
    availability_status: 'manual_confirmation_required',
    research_source_url: f.source_url,
    research_review_status: 'unverified',
    checked_at: nowIso(),
    raw_snapshot_sanitized: { note: 'web research finding', source_host: researchHostOf(f.source_url) }
  };
}

function mapHotelFinding(lodging, f) {
  if (!f || !isAllowedResearchDomain(f.source_url)) return null;
  const dest = (lodging && lodging.destination) || f.destination || null;
  return {
    provider: 'web_research',
    provider_result_key: 'webresearch:hotel:' + (dest || '') + ':' + researchHostOf(f.source_url) + ':' + (f.hotel_name || ''),
    destination: dest,
    hotel_name: f.hotel_name || '(hotel investigado)',
    lodging_requirement_id: (lodging && lodging.id) || null,
    check_in_date: (lodging && lodging.check_in_date) || null,
    check_out_date: (lodging && lodging.check_out_date) || null,
    nights: (lodging && lodging.nights) || null,
    rooms: (lodging && lodging.rooms_required) || null,
    guest_count: (lodging && lodging.guest_count) || null,
    total_price_cents: nonNegInt(f.price_cents),
    currency: cur(f.currency),
    availability_status: 'manual_confirmation_required',
    research_source_url: f.source_url,
    research_review_status: 'unverified',
    checked_at: nowIso(),
    raw_snapshot_sanitized: { note: 'web research finding', source_host: researchHostOf(f.source_url) }
  };
}

function flightFallback(snapshot) {
  return {
    provider: 'web_research',
    provider_result_key: 'webresearch:flight:fallback:' + researchHostOf(FLIGHT_FALLBACK_URL),
    origin: (snapshot && snapshot.preferred_connection_city_code) || null,
    destination: 'SCY',
    passenger_count: (snapshot && snapshot.passenger_count) || null,
    total_price_cents: null, currency: 'USD',
    availability_status: 'manual_confirmation_required',
    research_source_url: FLIGHT_FALLBACK_URL,
    research_review_status: 'unverified',
    checked_at: nowIso(),
    raw_snapshot_sanitized: { note: 'domain_fallback: fare not extracted, human check required', source_host: researchHostOf(FLIGHT_FALLBACK_URL) }
  };
}

function hotelFallback(lodging) {
  const dest = (lodging && lodging.destination) || null;
  const url = HOTEL_FALLBACK_BY_DEST[dest] || 'https://www.booking.com/';
  return {
    provider: 'web_research',
    provider_result_key: 'webresearch:hotel:fallback:' + (dest || '') + ':' + researchHostOf(url),
    destination: dest, hotel_name: '(fuente por confirmar)',
    lodging_requirement_id: (lodging && lodging.id) || null,
    check_in_date: (lodging && lodging.check_in_date) || null,
    check_out_date: (lodging && lodging.check_out_date) || null,
    total_price_cents: null, currency: 'USD',
    availability_status: 'manual_confirmation_required',
    research_source_url: url,
    research_review_status: 'unverified',
    checked_at: nowIso(),
    raw_snapshot_sanitized: { note: 'domain_fallback: price not extracted, human check required', source_host: researchHostOf(url) }
  };
}

/* ---------------- entradas para el modelo (sin PII) ---------------- */
function flightInput(snapshot) {
  const it = (snapshot && snapshot.itinerary) || {};
  const city = it.connection_city || (snapshot && snapshot.preferred_connection_city);
  const origin = it.origin_airport || (city === 'quito' ? 'UIO' : (city === 'guayaquil' ? 'GYE' : 'UIO/GYE'));
  const fd = (snapshot && snapshot.flight_dates) || {};
  const dep = it.mainland_to_galapagos_flight_date || fd.default_departure_date || null;   // vuelo continental → Galápagos
  const ret = it.galapagos_return_flight_date || fd.default_return_date || null;
  return {
    kind: 'flights', origin: origin, destination: 'SCY (Baltra/San Cristóbal)',
    departure_date: dep, return_date: ret,
    passenger_count: (snapshot && snapshot.passenger_count) || null,
    passenger_type: it.passenger_type || null,
    requires_mainland_pre_night: !!it.requires_mainland_pre_night,
    instruction: 'Investiga en dominios autorizados tarifas del vuelo continental → Galápagos; extrae {source_url, price_cents, currency, airline} verificables.'
  };
}
function lodgingInput(lodging, prefs) {
  return {
    kind: 'lodging', destination: (lodging && lodging.destination) || null,
    check_in_date: (lodging && lodging.check_in_date) || null, check_out_date: (lodging && lodging.check_out_date) || null,
    guest_count: (lodging && lodging.guest_count) || null, rooms: (lodging && lodging.rooms_required) || null,
    preferred: (prefs || []).filter(function (h) { return h.destination === (lodging && lodging.destination); }).map(function (h) { return h.hotel_name; }),
    instruction: 'Investiga en dominios autorizados hoteles y precios publicados; extrae {source_url, price_cents, currency, hotel_name} verificables.'
  };
}

/* ---------------- investigación (async) ---------------- */
async function researchFlights(job, snapshot, deps) {
  deps = deps || {};
  const res = await webtools.runResearch({
    jobId: job.id, bookingId: job.booking_id, subtaskKind: 'web_research_flights', purpose: 'web_research_flights',
    system: 'Milu investiga solo en páginas públicas autorizadas; la fuente del precio es la página externa, no tú. Devuelve hallazgos estructurados.',
    input: flightInput(snapshot), settings: deps.settings, spentJobUsd: deps.spentJobUsd, env: deps.env, client: deps.client
  });
  const stats = { web_search_requests: res.web_search_requests || 0, web_fetch_requests: res.web_fetch_requests || 0, cost: res.cost || 0, error_code: res.error || null };
  if (!res.ok) return { status: res.status === 'configuration_error' ? 'failed' : 'partial', reason: res.reason, error_code: res.error || res.reason || null, options: [], stats: stats };

  const options = (res.findings || []).map(function (f) { return mapFlightFinding(snapshot, f); }).filter(Boolean);
  if (!options.length) return { status: 'partial', reason: res.error || 'no_verifiable_result', error_code: res.error || null, options: [flightFallback(snapshot)], stats: stats };
  return { status: 'completed', reason: null, error_code: null, options: options, stats: stats };
}

async function researchLodging(job, snapshot, deps) {
  deps = deps || {};
  const lodg = (snapshot && snapshot.lodging_requirements) || [];
  const prefs = (snapshot && snapshot.hotel_search_preferences) || [];
  const target = lodg.filter(function (l) { return !l.pending_resolution; });
  if (!target.length) return { status: 'completed', reason: 'no_lodging', options: [], stats: { web_search_requests: 0, web_fetch_requests: 0, cost: 0 } };

  // Una sola investigación por propuesta (respeta el tope por job); cubre el
  // primer requerimiento resuelto y usa fallback por dominio para el resto.
  const primary = target[0];
  const res = await webtools.runResearch({
    jobId: job.id, bookingId: job.booking_id, subtaskKind: 'web_research_lodging', purpose: 'web_research_lodging',
    system: 'Milu investiga solo en páginas públicas autorizadas; la fuente del precio es la página externa, no tú. Devuelve hallazgos estructurados.',
    input: lodgingInput(primary, prefs), settings: deps.settings, spentJobUsd: deps.spentJobUsd, env: deps.env, client: deps.client
  });
  const stats = { web_search_requests: res.web_search_requests || 0, web_fetch_requests: res.web_fetch_requests || 0, cost: res.cost || 0, error_code: res.error || null };
  if (!res.ok) return { status: res.status === 'configuration_error' ? 'failed' : 'partial', reason: res.reason, error_code: res.error || res.reason || null, options: [], stats: stats };

  var options = (res.findings || []).map(function (f) { return mapHotelFinding(primary, f); }).filter(Boolean);
  if (!options.length) options = [hotelFallback(primary)];
  return { status: options.length ? 'completed' : 'partial', reason: options.length ? null : (res.error || 'no_verifiable_result'), error_code: options.length ? null : (res.error || null), options: options, stats: stats };
}

module.exports = {
  FLIGHT_FALLBACK_URL, HOTEL_FALLBACK_BY_DEST,
  mapFlightFinding, mapHotelFinding, flightFallback, hotelFallback,
  flightInput, lodgingInput, researchFlights, researchLodging
};
