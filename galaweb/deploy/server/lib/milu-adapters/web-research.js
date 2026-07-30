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
function isYmdStr(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }

/* ---------------- normalización de aeropuertos / ruta ---------------- */
const GALAPAGOS_AIRPORTS = ['GPS', 'SCY'];   // Baltra (GPS) + San Cristóbal (SCY)
/** Normaliza texto de aeropuerto (IATA o nombre) a IATA continental/insular conocido. */
function normAirport(txt) {
  if (txt == null) return null;
  const t = String(txt).toUpperCase();
  if (/\bGYE\b/.test(t) || t.indexOf('GUAYAQUIL') !== -1 || t.indexOf('OLMEDO') !== -1) return 'GYE';
  if (/\bUIO\b/.test(t) || t.indexOf('QUITO') !== -1 || t.indexOf('SUCRE') !== -1) return 'UIO';
  if (/\bGPS\b/.test(t) || t.indexOf('BALTRA') !== -1 || t.indexOf('SEYMOUR') !== -1) return 'GPS';
  if (/\bSCY\b/.test(t) || t.indexOf('CRISTOBAL') !== -1 || t.indexOf('CRISTÓBAL') !== -1) return 'SCY';
  const m = t.match(/\b[A-Z]{3}\b/);
  return m ? m[0] : (t.trim() || null);
}
/** Aeropuerto insular solicitado según la isla del programa (del lodging del snapshot). */
function galapagosAirportFor(dest) {
  if (dest === 'san_cristobal') return 'SCY';
  if (dest === 'santa_cruz' || dest === 'isabela') return 'GPS';
  return null;
}
function requestedGalapagos(snapshot) {
  const lodg = (snapshot && snapshot.lodging_requirements) || [];
  for (var i = 0; i < lodg.length; i++) { const a = galapagosAirportFor(lodg[i].destination); if (a) return { airport: a, acceptable: [a] }; }
  return { airport: 'GPS', acceptable: GALAPAGOS_AIRPORTS.slice() };   // isla indeterminada → cualquier gateway insular
}

/* ---------------- verificación de tarifa contra la solicitud (Corrección 3/4) ----------------
   Un finding SOLO cuenta como tarifa válida (price_verified_for_request=true) si la página mostró
   evidencia observable de: mismo origen, mismo destino, MISMA fecha solicitada y un precio.
   Cualquier otra cosa (genérica, otra fecha, fecha no observable, página dinámica, sin precio) se
   clasifica y NO se trata como precio válido. */
function classifyFlight(f, reqOrigin, reqDestInfo, reqDate) {
  const obsOrigin = normAirport(f.observed_origin != null ? f.observed_origin : f.origin);
  const obsDest = normAirport(f.observed_destination != null ? f.observed_destination : f.destination);
  const obsDate = isYmdStr(f.observed_departure_date) ? f.observed_departure_date : null;
  const price = nonNegInt(f.price_cents);
  const dateObservable = (f.date_observable === false) ? false : (obsDate != null);
  const routeMatch = !!reqOrigin && obsOrigin === reqOrigin && obsDest != null && reqDestInfo.acceptable.indexOf(obsDest) !== -1;
  const dateMatch = dateObservable && obsDate != null && isYmdStr(reqDate) && obsDate === reqDate;
  const generic = (f.price_is_generic === true);
  const dynamicUnverified = (f.dynamic_page === true);
  let cls, priceVerified = false;
  if (price == null) cls = 'no_price';
  else if (!routeMatch) cls = 'route_mismatch';
  else if (!dateObservable) cls = 'date_not_observable';
  else if (!dateMatch) cls = 'date_mismatch';
  else if (generic) cls = 'generic_fare';
  else if (dynamicUnverified) cls = 'dynamic_page_unverified';
  else { cls = 'verified'; priceVerified = true; }
  return { obsOrigin: obsOrigin, obsDest: obsDest, obsDate: obsDate, price: price,
    route_match: routeMatch, date_match: dateMatch, date_observable: dateObservable,
    price_verified_for_request: priceVerified, classification: cls };
}

/* ---------------- mapeo de hallazgos → opciones ---------------- */
function mapFlightFinding(snapshot, f) {
  if (!f || !isAllowedResearchDomain(f.source_url)) return null;   // fuente obligatoria + allowlist
  const it = (snapshot && snapshot.itinerary) || {};
  const reqOrigin = normAirport(it.origin_airport || (snapshot && snapshot.preferred_connection_city_code) || null);
  const reqDestInfo = requestedGalapagos(snapshot);
  const reqDate = it.mainland_to_galapagos_flight_date || null;
  const reqPax = (snapshot && snapshot.passenger_count) || null;
  const v = classifyFlight(f, reqOrigin, reqDestInfo, reqDate);
  return {
    provider: 'web_research',
    provider_result_key: 'webresearch:flight:' + (reqOrigin || '') + ':' + reqDestInfo.airport + ':' + (v.obsDate || 'na') + ':' + researchHostOf(f.source_url),
    airline: f.airline || null,
    origin: reqOrigin, destination: reqDestInfo.airport,   // ruta SOLICITADA (lo que se pidió)
    passenger_count: reqPax,
    // Solo se guarda como tarifa válida si está verificada para la solicitud; si no, null (referencia).
    total_price_cents: v.price_verified_for_request ? v.price : null,
    currency: cur(f.currency),
    availability_status: 'manual_confirmation_required',
    research_source_url: f.source_url,
    research_review_status: 'unverified',
    checked_at: nowIso(),
    raw_snapshot_sanitized: {
      note: 'web research finding', source_host: researchHostOf(f.source_url),
      parse_status: (v.price != null ? 'parsed' : 'parsed_partial'),
      requested_origin: reqOrigin, requested_destination: reqDestInfo.airport,
      requested_departure_date: reqDate, requested_passenger_count: reqPax,
      observed_origin: v.obsOrigin, observed_destination: v.obsDest, observed_departure_date: v.obsDate,
      observed_price_cents: v.price,   // precio VISTO en la página (aunque no verificado para la solicitud)
      route_match: v.route_match, date_match: v.date_match, date_observable: v.date_observable,
      price_verified_for_request: v.price_verified_for_request, classification: v.classification
    }
  };
}

function mapHotelFinding(lodging, f) {
  if (!f || !isAllowedResearchDomain(f.source_url)) return null;
  const dest = (lodging && lodging.destination) || f.destination || null;
  const reqCheckIn = (lodging && lodging.check_in_date) || null;
  const obsDest = (f.observed_destination != null) ? String(f.observed_destination) : (f.destination != null ? String(f.destination) : null);
  const obsCheckIn = isYmdStr(f.observed_check_in_date) ? f.observed_check_in_date : null;
  const price = nonNegInt(f.price_cents);
  const dateObservable = (f.date_observable === false) ? false : (obsCheckIn != null);
  const routeMatch = !!dest && obsDest != null && String(obsDest).toLowerCase().indexOf(String(dest).toLowerCase()) !== -1;
  const dateMatch = dateObservable && obsCheckIn != null && isYmdStr(reqCheckIn) && obsCheckIn === reqCheckIn;
  const generic = (f.price_is_generic === true);
  const dynamicUnverified = (f.dynamic_page === true);
  let cls, priceVerified = false;
  if (price == null) cls = 'no_price';
  else if (!routeMatch) cls = 'route_mismatch';
  else if (!dateObservable) cls = 'date_not_observable';
  else if (!dateMatch) cls = 'date_mismatch';
  else if (generic) cls = 'generic_fare';
  else if (dynamicUnverified) cls = 'dynamic_page_unverified';
  else { cls = 'verified'; priceVerified = true; }
  return {
    provider: 'web_research',
    provider_result_key: 'webresearch:hotel:' + (dest || '') + ':' + researchHostOf(f.source_url) + ':' + (f.hotel_name || ''),
    destination: dest,
    hotel_name: f.hotel_name || '(hotel investigado)',
    lodging_requirement_id: (lodging && lodging.id) || null,
    check_in_date: reqCheckIn,
    check_out_date: (lodging && lodging.check_out_date) || null,
    nights: (lodging && lodging.nights) || null,
    rooms: (lodging && lodging.rooms_required) || null,
    guest_count: (lodging && lodging.guest_count) || null,
    total_price_cents: priceVerified ? price : null,
    currency: cur(f.currency),
    availability_status: 'manual_confirmation_required',
    research_source_url: f.source_url,
    research_review_status: 'unverified',
    checked_at: nowIso(),
    raw_snapshot_sanitized: {
      note: 'web research finding', source_host: researchHostOf(f.source_url),
      parse_status: (price != null ? 'parsed' : 'parsed_partial'),
      requested_destination: dest, requested_check_in_date: reqCheckIn,
      requested_check_out_date: (lodging && lodging.check_out_date) || null,
      observed_destination: obsDest, observed_check_in_date: obsCheckIn, observed_price_cents: price,
      route_match: routeMatch, date_match: dateMatch, date_observable: dateObservable,
      price_verified_for_request: priceVerified, classification: cls
    }
  };
}

function flightFallback(snapshot) {
  const it = (snapshot && snapshot.itinerary) || {};
  const reqOrigin = normAirport(it.origin_airport || (snapshot && snapshot.preferred_connection_city_code) || null);
  const reqDestInfo = requestedGalapagos(snapshot);
  const reqDate = it.mainland_to_galapagos_flight_date || null;
  const reqPax = (snapshot && snapshot.passenger_count) || null;
  return {
    provider: 'web_research',
    provider_result_key: 'webresearch:flight:fallback:' + (reqOrigin || '') + ':' + reqDestInfo.airport + ':' + researchHostOf(FLIGHT_FALLBACK_URL),
    origin: reqOrigin, destination: reqDestInfo.airport,
    passenger_count: reqPax,
    total_price_cents: null, currency: 'USD',
    availability_status: 'manual_confirmation_required',
    research_source_url: FLIGHT_FALLBACK_URL,
    research_review_status: 'unverified',
    checked_at: nowIso(),
    raw_snapshot_sanitized: { note: 'domain_fallback: fare not extracted, human check required', source_host: researchHostOf(FLIGHT_FALLBACK_URL),
      parse_status: 'parsed_partial',
      requested_origin: reqOrigin, requested_destination: reqDestInfo.airport, requested_departure_date: reqDate, requested_passenger_count: reqPax,
      observed_origin: null, observed_destination: null, observed_departure_date: null, observed_price_cents: null,
      route_match: false, date_match: false, date_observable: false,
      price_verified_for_request: false, classification: 'date_not_observable' }
  };
}

function hotelFallback(lodging) {
  const dest = (lodging && lodging.destination) || null;
  const url = HOTEL_FALLBACK_BY_DEST[dest] || 'https://www.booking.com/';
  const reqCheckIn = (lodging && lodging.check_in_date) || null;
  return {
    provider: 'web_research',
    provider_result_key: 'webresearch:hotel:fallback:' + (dest || '') + ':' + researchHostOf(url),
    destination: dest, hotel_name: '(fuente por confirmar)',
    lodging_requirement_id: (lodging && lodging.id) || null,
    check_in_date: reqCheckIn,
    check_out_date: (lodging && lodging.check_out_date) || null,
    total_price_cents: null, currency: 'USD',
    availability_status: 'manual_confirmation_required',
    research_source_url: url,
    research_review_status: 'unverified',
    checked_at: nowIso(),
    raw_snapshot_sanitized: { note: 'domain_fallback: price not extracted, human check required', source_host: researchHostOf(url),
      parse_status: 'parsed_partial',
      requested_destination: dest, requested_check_in_date: reqCheckIn, requested_check_out_date: (lodging && lodging.check_out_date) || null,
      observed_destination: null, observed_check_in_date: null, observed_price_cents: null,
      route_match: false, date_match: false, date_observable: false,
      price_verified_for_request: false, classification: 'date_not_observable' }
  };
}

/* ---------------- entradas para el modelo (sin PII) ---------------- */
function flightInput(snapshot) {
  const it = (snapshot && snapshot.itinerary) || {};
  // Origen = SOLO el aeropuerto de conexión resuelto (fuente de verdad); NUNCA se asume Quito.
  const origin = normAirport(it.origin_airport) || null;
  const reqDest = requestedGalapagos(snapshot).airport;
  const fd = (snapshot && snapshot.flight_dates) || {};
  const dep = it.mainland_to_galapagos_flight_date || fd.default_departure_date || null;   // vuelo continental → Galápagos
  const ret = it.galapagos_return_flight_date || fd.default_return_date || null;
  return {
    kind: 'flights',
    requested_origin: origin, requested_destination: reqDest, requested_departure_date: dep,
    return_date: ret,
    passenger_count: (snapshot && snapshot.passenger_count) || null,
    passenger_type: it.passenger_type || null,
    requires_mainland_pre_night: !!it.requires_mainland_pre_night,
    instruction: 'Busca EXACTAMENTE la ruta ' + (origin || '(origen)') + ' → ' + reqDest + ' para la fecha ' + (dep || '(fecha)') +
      '. NO uses otro origen (p. ej. UIO si el origen es GYE) ni otra fecha. Por cada hallazgo reporta observed_origin, observed_destination, observed_departure_date (la fecha CONCRETA que muestra la página), date_observable (¿la página mostró la tarifa para una fecha concreta?), price_is_generic (¿es "desde $X"/promo/landing SEO sin ruta+fecha concretas?) y dynamic_page (¿la página necesitó JS y no pudiste verificar la tarifa?).'
  };
}
function lodgingInput(lodging, prefs) {
  return {
    kind: 'lodging', requested_destination: (lodging && lodging.destination) || null,
    requested_check_in_date: (lodging && lodging.check_in_date) || null, check_out_date: (lodging && lodging.check_out_date) || null,
    guest_count: (lodging && lodging.guest_count) || null, rooms: (lodging && lodging.rooms_required) || null,
    preferred: (prefs || []).filter(function (h) { return h.destination === (lodging && lodging.destination); }).map(function (h) { return h.hotel_name; }),
    instruction: 'Investiga hoteles en el destino solicitado para las fechas exactas. Por cada hallazgo reporta observed_destination, observed_check_in_date, date_observable, price_is_generic y dynamic_page; extrae {source_url, price_cents, currency, hotel_name} verificables.'
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
