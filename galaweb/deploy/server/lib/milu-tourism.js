'use strict';

/* =========================================================
   Milu Turismo — orquestador (8C)
   ---------------------------------------------------------
   SERVER-ONLY. Responsabilidades de 8C:
     · cargar buildTravelRequirements (contrato saneado);
     · validar form submitted/reviewed/complete;
     · bloquear connection_tbd sin resolver;
     · bloquear destinos sin fechas;
     · derivar ida = inicio del paquete, regreso = fin del paquete;
     · crear job idempotente + subtareas (una sola vez);
     · preparar requirements_snapshot saneado (sin documentos/tokens);
     · calcular estado global; exponer parciales; cancelar jobs;
     · ajustar fechas con motivo.
   NO invoca Duffel LIVE ni proveedor hotelero LIVE. NO envía nada al
   cliente.
   ========================================================= */

const { getSupabase } = require('./supabase');
const { getTenantId } = require('./http');
const { buildTravelRequirements } = require('./passenger-intake');
const { webResearchEnabled } = require('./milu-flags');

/* Duración por paquete (días). Deriva la fecha de regreso sin tocar el catálogo. */
const PACKAGE_DURATION_DAYS = { p3: 4, p4: 5, p7: 7, p8sc: 8, p8is: 8 };
const READY_FORM_STATUSES = ['submitted', 'reviewed', 'complete'];
const SUBTASK_KINDS = ['flights_duffel', 'hotels_primary_provider', 'hotel_preferred_links', 'anthropic_ranking', 'final_summary'];
const WEB_RESEARCH_KINDS = ['web_research_flights', 'web_research_lodging'];
const MAX_RERUNS_PER_JOB = 20;

/* ---------------- fechas ---------------- */
function addDaysYmd(ymd, n) {
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7)), d = Number(ymd.slice(8, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Ida = inicio del paquete; regreso = inicio + (duración - 1). */
function computeFlightDates(travelDate, tourId) {
  const dur = PACKAGE_DURATION_DAYS[tourId] || null;
  const dep = travelDate || null;
  const ret = (travelDate && dur) ? addDaysYmd(travelDate, dur - 1) : null;
  return { default_departure_date: dep, default_return_date: ret, duration_days: dur };
}

/* ---------------- itinerario (programa insular vs viaje completo) ---------------- */
/* La fecha de la reserva es el INICIO DEL PROGRAMA en Galápagos, no el inicio del
   viaje total. Un pasajero internacional suma una noche de conexión continental
   (Quito/Guayaquil) que NO reduce las noches del programa insular. */
const CONNECTION_AIRPORTS = { quito: 'UIO', guayaquil: 'GYE' };
const PASSENGER_TYPES = ['international', 'domestic'];
const CONNECTION_CITIES = ['quito', 'guayaquil'];

function isYmd(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v); }

/** Infiere la ciudad de conexión desde el texto del aeropuerto de llegada del intake
 * (IATA o nombre): GYE/Guayaquil/Olmedo → guayaquil; UIO/Quito/Sucre → quito. */
function cityFromAirportText(txt) {
  if (typeof txt !== 'string') return null;
  const t = txt.toUpperCase();
  if (/\bGYE\b/.test(t) || t.indexOf('GUAYAQUIL') !== -1 || t.indexOf('OLMEDO') !== -1) return 'guayaquil';
  if (/\bUIO\b/.test(t) || t.indexOf('QUITO') !== -1 || t.indexOf('SUCRE') !== -1) return 'quito';
  return null;
}

/**
 * Deriva los insumos del itinerario desde el contrato + overrides del owner/admin.
 * Sin señal clara de tipo de pasajero → null (el gate lo exige; el owner elige).
 */
function deriveItineraryInputs(contract, overrides) {
  overrides = overrides || {};
  const arrival = (contract && contract.arrival) || {};
  let ptype = null;
  if (PASSENGER_TYPES.indexOf(overrides.passenger_type) !== -1) ptype = overrides.passenger_type;
  else if (arrival.international_flights_purchased === true || arrival.arrival_airport || arrival.ecuador_arrival_date) ptype = 'international';
  // false/null sin datos de llegada = ambiguo → null (el owner debe confirmar).

  // Fuente de verdad de la CIUDAD DE CONEXIÓN (Corrección 1), en orden:
  //   1) intake CONFIRMADO — preferred_connection_city concreto (quito/guayaquil),
  //      o inferido del arrival_airport del formulario;
  //   2) logística guardada — no existe columna dedicada de conexión en
  //      travel_logistics: el intake ES la logística persistida de conexión;
  //   3) override manual explícito del owner/admin ("Change connection city");
  //   4) fallback — sin dato → null (el owner debe elegir; NUNCA se asume Quito).
  // El override, cuando el owner lo fija explícitamente, SUPERSEDE al valor auto.
  const pc = contract && contract.preferred_connection_city;
  const intakeCity = (CONNECTION_CITIES.indexOf(pc) !== -1) ? pc : cityFromAirportText(arrival.arrival_airport);
  let conn = null, connSource = 'none';
  if (CONNECTION_CITIES.indexOf(overrides.connection_city) !== -1) { conn = overrides.connection_city; connSource = 'override'; }
  else if (CONNECTION_CITIES.indexOf(intakeCity) !== -1) { conn = intakeCity; connSource = (CONNECTION_CITIES.indexOf(pc) !== -1) ? 'intake' : 'intake_airport'; }
  else if (pc === 'either') { connSource = 'either'; }   // sin preferencia concreta → el owner debe elegir

  let pre;
  if (typeof overrides.include_mainland_pre_night === 'boolean') pre = overrides.include_mainland_pre_night;
  else pre = undefined;   // default por tipo (lo aplica computeItinerary)

  return {
    passenger_type: ptype,
    connection_city: conn,
    connection_source: connSource,
    include_mainland_pre_night: pre,
    mainland_post_nights: (typeof overrides.mainland_post_nights === 'number') ? overrides.mainland_post_nights : undefined,
    manual_galapagos_start_date: isYmd(overrides.galapagos_start_date) ? overrides.galapagos_start_date : null
  };
}

/**
 * Itinerario completo: separa el PROGRAMA INSULAR (galapagos_*) de la LOGÍSTICA
 * CONTINENTAL (full_itinerary_*, mainland_*). La noche continental es ADICIONAL.
 * Campos null cuando falta el dato; nunca lanza (el gate valida aparte).
 */
function computeItinerary(opts) {
  opts = opts || {};
  const start = isYmd(opts.galapagosStartDate) ? opts.galapagosStartDate : null;
  const dur = (typeof opts.durationDays === 'number' && opts.durationDays > 0)
    ? opts.durationDays : (PACKAGE_DURATION_DAYS[opts.tourId] || null);

  const gStart = start;
  const gDays = dur;
  const gNights = (dur != null) ? Math.max(0, dur - 1) : null;   // insular: días - 1 (NO se le resta la noche continental)
  const gEnd = (start && dur) ? addDaysYmd(start, dur - 1) : null;

  const ptype = (PASSENGER_TYPES.indexOf(opts.passengerType) !== -1) ? opts.passengerType : null;
  const connection = (CONNECTION_CITIES.indexOf(opts.connectionCity) !== -1) ? opts.connectionCity : null;

  // Noche continental previa: internacional → true por defecto; doméstico → false;
  // el owner/admin puede forzarla o quitarla (includeMainlandPreNight).
  const requiresPre = (typeof opts.includeMainlandPreNight === 'boolean')
    ? opts.includeMainlandPreNight : (ptype === 'international');

  const preNights = requiresPre ? 1 : 0;
  const postNights = (typeof opts.mainlandPostNights === 'number' && opts.mainlandPostNights >= 0) ? Math.round(opts.mainlandPostNights) : 0;

  const fullStart = start ? (preNights > 0 ? addDaysYmd(start, -preNights) : start) : null;
  const fullEnd = gEnd ? (postNights > 0 ? addDaysYmd(gEnd, postNights) : gEnd) : null;
  const originAirport = connection ? CONNECTION_AIRPORTS[connection] : null;
  const mainlandArrivalDate = start ? (preNights > 0 ? addDaysYmd(start, -preNights) : start) : null;

  return {
    passenger_type: ptype,
    connection_city: connection,
    connection_source: (typeof opts.connectionSource === 'string') ? opts.connectionSource : null,
    origin_airport: originAirport,
    // programa insular
    galapagos_start_date: gStart,
    galapagos_end_date: gEnd,
    galapagos_days: gDays,
    galapagos_nights: gNights,
    // viaje completo (con logística continental)
    full_itinerary_start_date: fullStart,
    full_itinerary_end_date: fullEnd,
    requires_mainland_pre_night: requiresPre,
    mainland_pre_nights: preNights,
    mainland_post_nights: postNights,
    mainland_arrival_date: mainlandArrivalDate,
    mainland_to_galapagos_flight_date: gStart,   // vuelo continental → Galápagos el día de inicio del programa
    galapagos_return_flight_date: gEnd,
    // componentes incluidos, SEPARADOS (nada se envía al cliente; todo es interno)
    included_components: {
      mainland_arrival: ptype === 'international',
      mainland_hotel: preNights > 0,
      mainland_to_galapagos_flight: true,
      galapagos_hotels: true,
      inter_island_boat: true,
      optional_inter_island_flight_upgrade: false
    }
  };
}

/** Gate del itinerario (#6/#7). Lanza el error específico que falta. */
function assertItineraryReady(it) {
  if (!it || !it.passenger_type) throw gateError('PASSENGER_TYPE_REQUIRED');
  if (!it.galapagos_start_date) throw gateError('GALAPAGOS_START_REQUIRED');
  if (!it.galapagos_days) throw gateError('PACKAGE_DURATION_REQUIRED');
  if (it.passenger_type === 'international' && !it.connection_city) throw gateError('CONNECTION_CITY_REQUIRED');
  if (!it.connection_city) throw gateError('ORIGIN_REQUIRED');   // ciudad/aeropuerto de origen (gateway continental)
  return true;
}

/** Lista (sin lanzar) de insumos faltantes, para la vista previa. */
function itineraryMissing(it) {
  const missing = [];
  if (!it || !it.passenger_type) missing.push('passenger_type');
  if (!it || !it.galapagos_start_date) missing.push('galapagos_start_date');
  if (!it || !it.galapagos_days) missing.push('package_duration');
  if (it && !it.connection_city) missing.push(it.passenger_type === 'international' ? 'connection_city' : 'origin');
  return missing;
}

/* ---------------- gate ---------------- */
function gateError(code) { const e = new Error(code); e.code = code; return e; }

function assertSearchEligible(form, lodging) {
  if (!form || READY_FORM_STATUSES.indexOf(form.status) === -1) throw gateError('FORM_NOT_READY');
  const tbd = (lodging || []).filter(function (l) { return l.destination === 'connection_tbd' && l.status !== 'not_required'; });
  if (tbd.length) throw gateError('CONNECTION_TBD_UNRESOLVED');
  const missingDates = (lodging || []).filter(function (l) {
    return l.lodging_required === true && l.status !== 'not_required' && (!l.check_in_date || !l.check_out_date);
  });
  if (missingDates.length) throw gateError('DESTINATION_DATES_MISSING');
  return true;
}

async function loadGateData(bookingId) {
  const supabase = getSupabase();
  const tenant = getTenantId();
  // Reserva scoped al tenant: una reserva de otro tenant → BOOKING_NOT_FOUND (rechazo limpio).
  const bq = await supabase.from('bookings').select('id,tenant_id,booking_code,booking_date,tour_id,guests').eq('id', bookingId).eq('tenant_id', tenant).maybeSingle();
  if (bq.error || !bq.data) throw gateError('BOOKING_NOT_FOUND');
  const booking = bq.data;
  const fq = await supabase.from('booking_passenger_forms').select('id,status,preferred_connection_city').eq('booking_id', bookingId).eq('tenant_id', tenant).maybeSingle();
  const form = fq.data || null;
  let lodging = [];
  if (form) {
    const lq = await supabase.from('booking_lodging_requirements').select('destination,lodging_required,check_in_date,check_out_date,status,active').eq('passenger_form_id', form.id).eq('active', true);
    lodging = lq.data || [];
  }
  return { tenant: tenant, booking: booking, form: form, lodging: lodging };
}

/* ---------------- snapshot saneado ---------------- */
function sanitizeRequirements(contract, flightDates, itinerary) {
  contract = contract || {};
  const passengers = (contract.passengers || []).map(function (p) {
    // Solo lo operativo: NUNCA número de documento, NUNCA tokens/secretos.
    return {
      passenger_number: p.passenger_number,
      legal_first_name: p.legal_first_name,
      legal_last_name: p.legal_last_name,
      age_category: p.age_category,
      nationality: p.nationality,
      baggage_notes: p.baggage_notes,
      special_assistance: p.special_assistance,
      accessibility_or_mobility_needs: p.accessibility_or_mobility_needs
    };
  });
  return {
    booking_code: contract.booking_code,
    tour: contract.tour,
    travel_date: contract.travel_date,
    passenger_count: contract.passenger_count,
    preferred_connection_city: contract.preferred_connection_city,
    flight_dates: flightDates,
    itinerary: itinerary || null,          // programa insular + logística continental (8D)
    passengers: passengers,
    lodging_requirements: contract.lodging_requirements || [],
    hotel_search_preferences: contract.hotel_search_preferences || []
  };
}

/**
 * ÚNICA función de cálculo del itinerario, compartida por Preview y Start (misma
 * ruta, mismos overrides, misma fórmula). Las fechas del programa salen de
 * booking_date + duración del paquete (NO de las fechas del lodging), por eso NO
 * se usa la validación vieja de destino (destination_start/end).
 * @returns { gate, contract, flightDates, itinerary, form_ready, missing }
 */
async function computeBookingItinerary(bookingId, overrides) {
  const gate = await loadGateData(bookingId);   // BOOKING_NOT_FOUND si no existe / otro tenant
  const contract = await buildTravelRequirements(bookingId);
  const flightDates = computeFlightDates(gate.booking.booking_date, gate.booking.tour_id);
  const inputs = deriveItineraryInputs(contract, overrides);
  const itinerary = computeItinerary({
    galapagosStartDate: inputs.manual_galapagos_start_date || gate.booking.booking_date,   // fechas manuales tienen prioridad; si no, la de la reserva
    tourId: gate.booking.tour_id, durationDays: flightDates.duration_days,
    passengerType: inputs.passenger_type, connectionCity: inputs.connection_city,
    connectionSource: inputs.connection_source,
    includeMainlandPreNight: inputs.include_mainland_pre_night, mainlandPostNights: inputs.mainland_post_nights
  });
  const formReady = !!(gate.form && READY_FORM_STATUSES.indexOf(gate.form.status) !== -1);
  const missing = itineraryMissing(itinerary);
  return { gate: gate, contract: contract, flightDates: flightDates, itinerary: itinerary, form_ready: formReady, missing: missing };
}

/**
 * Construye el snapshot saneado + valida el gate del itinerario. MISMO cálculo
 * que previewItinerary: si el preview da missing=[] (y el formulario está listo),
 * este build NO lanza y se crea el job. @returns { snapshot, booking, form, flightDates, itinerary }
 */
async function buildMiluRequirements(bookingId, overrides) {
  const c = await computeBookingItinerary(bookingId, overrides);
  if (!c.form_ready) throw gateError('FORM_NOT_READY');
  assertItineraryReady(c.itinerary);   // #6/#7 — MISMAS condiciones que itineraryMissing() del preview
  const snapshot = sanitizeRequirements(c.contract, c.flightDates, c.itinerary);
  return { snapshot: snapshot, booking: c.gate.booking, form: c.gate.form, flightDates: c.flightDates, itinerary: c.itinerary };
}

/**
 * Vista previa del itinerario para owner/admin ANTES de buscar (#8). No crea job,
 * no lanza por insumos faltantes: los reporta en `missing`.
 * @returns { booking_code, form_ready, ready, missing, itinerary }
 */
async function previewItinerary(bookingId, overrides) {
  const c = await computeBookingItinerary(bookingId, overrides);
  return {
    booking_code: c.gate.booking.booking_code || null,
    form_ready: c.form_ready,
    ready: c.form_ready && c.missing.length === 0,
    missing: c.missing,
    itinerary: c.itinerary
  };
}

/* ---------------- jobs / subtareas ---------------- */
async function startSearch(bookingId, userId, searchType, overrides) {
  searchType = searchType || 'complete_trip';
  const supabase = getSupabase();
  const built = await buildMiluRequirements(bookingId, overrides);
  const tenant = built.booking.tenant_id || getTenantId();
  const idem = tenant + ':' + bookingId + ':' + searchType;

  // Idempotencia: job activo con misma clave → NO duplicar, pero REFRESCAR su
  // snapshot con el itinerario recién calculado (evita reusar un snapshot viejo/stale, #7).
  const ex = await supabase.from('travel_search_jobs').select('*').eq('tenant_id', tenant).eq('idempotency_key', idem).eq('active', true).maybeSingle();
  if (ex.data) {
    await supabase.from('travel_search_jobs').update({ requirements_snapshot: built.snapshot }).eq('id', ex.data.id).eq('tenant_id', tenant);
    const refreshed = Object.assign({}, ex.data, { requirements_snapshot: built.snapshot });
    return { job: refreshed, created: false, refreshed: true, itinerary: built.itinerary };
  }

  const ins = await supabase.from('travel_search_jobs').insert({
    tenant_id: tenant, booking_id: bookingId, passenger_form_id: built.form.id, search_type: searchType,
    status: 'queued', requested_by_user_id: userId || null, requirements_snapshot: built.snapshot,
    idempotency_key: idem, active: true
  }).select().single();
  if (ins.error || !ins.data) {
    const again = await supabase.from('travel_search_jobs').select('*').eq('tenant_id', tenant).eq('idempotency_key', idem).eq('active', true).maybeSingle();
    if (again.data) return { job: again.data, created: false };
    throw new Error('JOB_CREATE_FAILED');
  }
  const job = ins.data;

  for (var i = 0; i < SUBTASK_KINDS.length; i++) {
    await supabase.from('travel_search_subtasks').insert({
      tenant_id: tenant, job_id: job.id, kind: SUBTASK_KINDS[i], status: 'queued',
      attempt_count: 0, max_attempts: 3, timeout_ms: 45000, created_at: new Date().toISOString()
    });
  }

  // Web research (8D): subtareas SOLO si la compuerta doble (env + DB) está activa.
  // Con flags off (por defecto) NO se crean → nunca hay investigación externa.
  try {
    const st = await supabase.from('milu_settings').select('web_research_enabled').eq('tenant_id', tenant).maybeSingle();
    if (webResearchEnabled(process.env, st.data || {})) {
      for (var w = 0; w < WEB_RESEARCH_KINDS.length; w++) {
        await supabase.from('travel_search_subtasks').insert({
          tenant_id: tenant, job_id: job.id, kind: WEB_RESEARCH_KINDS[w], status: 'queued',
          attempt_count: 0, max_attempts: 3, timeout_ms: 60000, created_at: new Date().toISOString()
        });
      }
    }
  } catch (e) { /* sin settings → no se crean subtareas de web research */ }

  const lg = await supabase.from('travel_logistics').select('id').eq('booking_id', bookingId).eq('tenant_id', tenant).maybeSingle();
  if (!lg.data) {
    await supabase.from('travel_logistics').insert({
      tenant_id: tenant, booking_id: bookingId, search_job_id: job.id, status: 'searching',
      default_departure_date: built.flightDates.default_departure_date,
      default_return_date: built.flightDates.default_return_date
    });
  }
  return { job: job, created: true, snapshot: built.snapshot, flightDates: built.flightDates, itinerary: built.itinerary };
}

async function cancelSearch(bookingId, jobId, actor) {
  const supabase = getSupabase();
  const tenant = getTenantId();
  // Job → cancelled + inactivo: la cola ya no lo reclama (ver milu_claim_next_subtask).
  await supabase.from('travel_search_jobs').update({ status: 'cancelled', active: false }).eq('id', jobId).eq('tenant_id', tenant);
  const subs = await supabase.from('travel_search_subtasks').select('id,status').eq('job_id', jobId);
  const rows = (subs.data || []);
  var cancelled = 0;
  for (var i = 0; i < rows.length; i++) {
    var s = rows[i];
    if (s.status === 'queued' || s.status === 'partial' || s.status === 'running') {
      await supabase.from('travel_search_subtasks').update({
        status: 'cancelled', locked_by: null, locked_at: null, lease_expires_at: null,
        heartbeat_at: null, finished_at: new Date().toISOString()
      }).eq('id', s.id);
      cancelled++;
    }
  }
  // Auditoría de cancelación (append-only). Los resultados ya guardados se conservan.
  const at = (actor && (actor.role === 'owner' || actor.role === 'admin')) ? actor.role : 'system';
  try {
    await supabase.from('travel_search_audit').insert({
      tenant_id: tenant, booking_id: bookingId, search_job_id: jobId,
      actor_type: at, actor_id: (actor && actor.userId) || null,
      action: 'cancel_search', source: 'admin', result: 'success',
      sanitized_details: { subtasks_cancelled: cancelled }
    });
  } catch (e) { /* la auditoría nunca rompe la cancelación */ }
  return { cancelled: true, subtasks_cancelled: cancelled };
}

/** Ajuste de fechas de vuelo por owner/admin — requiere motivo. */
async function adjustFlightDates(bookingId, opts) {
  opts = opts || {};
  if (!opts.reason || String(opts.reason).trim().length < 3) throw gateError('REASON_REQUIRED');
  const supabase = getSupabase();
  const tenant = getTenantId();
  const patch = {
    approved_departure_date: opts.departure_date || null,
    approved_return_date: opts.return_date || null,
    adjustment_reason: String(opts.reason).trim(),
    adjusted_by_user_id: opts.userId || null,
    adjusted_at: new Date().toISOString()
  };
  await supabase.from('travel_logistics').update(patch).eq('booking_id', bookingId).eq('tenant_id', tenant);
  return Object.assign({ ok: true }, patch);
}

/* ---------------- web research: "Buscar nuevamente" (contabilizado) ---------------- */
async function rerunResearch(bookingId, jobId, actor) {
  const supabase = getSupabase();
  const tenant = getTenantId();
  const jq = await supabase.from('travel_search_jobs').select('*').eq('id', jobId).eq('tenant_id', tenant).maybeSingle();
  const job = jq.data;
  if (!job || job.booking_id !== bookingId) throw gateError('JOB_NOT_FOUND');
  if (job.active !== true) throw gateError('JOB_INACTIVE');

  // Compuerta doble: sin ambas mitades → no se investiga.
  const st = await supabase.from('milu_settings').select('*').eq('tenant_id', tenant).maybeSingle();
  if (!webResearchEnabled(process.env, st.data || {})) throw gateError('WEB_RESEARCH_DISABLED');

  // Rate-limit / contabilización por propuesta.
  if ((job.rerun_count || 0) >= MAX_RERUNS_PER_JOB) throw gateError('RERUN_LIMIT_REACHED');

  const subs = await supabase.from('travel_search_subtasks').select('*').eq('job_id', jobId);
  const rows = subs.data || [];
  var requeued = 0;
  for (var k = 0; k < WEB_RESEARCH_KINDS.length; k++) {
    const found = rows.filter(function (s) { return s.kind === WEB_RESEARCH_KINDS[k]; })[0];
    if (found) {
      await supabase.from('travel_search_subtasks').update({
        status: 'queued', attempt_count: 0, locked_by: null, locked_at: null,
        lease_expires_at: null, heartbeat_at: null, next_attempt_at: null, finished_at: null, last_sanitized_error: null
      }).eq('id', found.id);
    } else {
      await supabase.from('travel_search_subtasks').insert({
        tenant_id: tenant, job_id: jobId, kind: WEB_RESEARCH_KINDS[k], status: 'queued',
        attempt_count: 0, max_attempts: 3, timeout_ms: 60000, created_at: new Date().toISOString()
      });
    }
    requeued++;
  }

  const newCount = (job.rerun_count || 0) + 1;
  // El job queda en 'queued' para que el runner tome la siguiente subtarea (#4).
  // Rerun LIMPIO (#6): resetea los contadores de investigación → presupuesto fresco
  // ($0.30, 6 búsquedas, 2 fetches) para la nueva pasada; el historial de costo
  // vive en llm_usage_log (append-only). Evita reusar contadores de una corrida previa.
  await supabase.from('travel_search_jobs').update({
    rerun_count: newCount, status: 'queued', active: true,
    web_search_count: 0, web_fetch_count: 0, research_cost_usd: 0
  }).eq('id', jobId);

  const at = (actor && (actor.role === 'owner' || actor.role === 'admin')) ? actor.role : 'system';
  try {
    await supabase.from('travel_search_audit').insert({
      tenant_id: tenant, booking_id: bookingId, search_job_id: jobId,
      actor_type: at, actor_id: (actor && actor.userId) || null,
      action: 'web_research_rerun', source: 'admin', result: 'success',
      sanitized_details: { rerun_count: newCount, requeued: requeued }
    });
  } catch (e) { /* la auditoría nunca rompe el rerun */ }

  // Devuelve el estado reseteado para que la UI lo muestre de inmediato (#5).
  return {
    rerun: true, rerun_count: newCount, requeued: requeued,
    remaining: Math.max(0, MAX_RERUNS_PER_JOB - newCount),
    status: 'queued', web_search_count: 0, web_fetch_count: 0, research_cost_usd: 0
  };
}

/* ---------------- web research: revisión humana (aprobar / rechazar) ---------------- */
async function reviewFinding(optionKind, optionId, decision, actor, opts) {
  opts = opts || {};
  if (decision !== 'verified' && decision !== 'rejected') throw gateError('INVALID_DECISION');
  if (optionKind !== 'flight' && optionKind !== 'hotel') throw gateError('INVALID_KIND');
  const supabase = getSupabase();
  const tenant = getTenantId();
  const table = optionKind === 'flight' ? 'travel_flight_options' : 'travel_hotel_options';
  const q = await supabase.from(table).select('id,booking_id,search_job_id,provider,research_review_status,raw_snapshot_sanitized').eq('id', optionId).eq('tenant_id', tenant).maybeSingle();
  const opt = q.data;
  if (!opt) throw gateError('OPTION_NOT_FOUND');
  if (opt.provider !== 'web_research' || !opt.research_review_status) throw gateError('NOT_RESEARCH_OPTION');

  // Corrección 3 (#9): un hallazgo NO verificado para la solicitud (ruta/fecha/precio) no puede
  // aprobarse como opción final sin una confirmación manual EXPLÍCITA (revisión/cotización).
  const rss = opt.raw_snapshot_sanitized || {};
  const verifiedForRequest = rss.price_verified_for_request === true;
  if (decision === 'verified' && !verifiedForRequest && opts.confirmManual !== true) {
    throw gateError('MANUAL_VERIFICATION_REQUIRED');
  }

  await supabase.from(table).update({
    research_review_status: decision,
    research_reviewed_by_user_id: (actor && actor.userId) || null,
    research_reviewed_at: new Date().toISOString()
  }).eq('id', optionId).eq('tenant_id', tenant);

  const at = (actor && (actor.role === 'owner' || actor.role === 'admin')) ? actor.role : 'system';
  try {
    await supabase.from('travel_search_audit').insert({
      tenant_id: tenant, booking_id: opt.booking_id || null, search_job_id: opt.search_job_id || null,
      actor_type: at, actor_id: (actor && actor.userId) || null,
      action: 'web_research_review_' + decision, source: 'admin', result: 'success',
      sanitized_details: { option_kind: optionKind, decision: decision }
    });
  } catch (e) { /* auditoría no rompe */ }

  return { reviewed: true, status: decision };
}

module.exports = {
  PACKAGE_DURATION_DAYS, READY_FORM_STATUSES, SUBTASK_KINDS, WEB_RESEARCH_KINDS, MAX_RERUNS_PER_JOB,
  CONNECTION_AIRPORTS, PASSENGER_TYPES, CONNECTION_CITIES,
  addDaysYmd, computeFlightDates, assertSearchEligible, loadGateData,
  deriveItineraryInputs, computeItinerary, assertItineraryReady, itineraryMissing, previewItinerary,
  sanitizeRequirements, buildMiluRequirements, startSearch, cancelSearch, adjustFlightDates,
  rerunResearch, reviewFinding
};
