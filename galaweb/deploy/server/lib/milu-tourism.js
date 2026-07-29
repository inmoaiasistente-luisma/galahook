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

/* Duración por paquete (días). Deriva la fecha de regreso sin tocar el catálogo. */
const PACKAGE_DURATION_DAYS = { p3: 4, p4: 5, p7: 7, p8sc: 8, p8is: 8 };
const READY_FORM_STATUSES = ['submitted', 'reviewed', 'complete'];
const SUBTASK_KINDS = ['flights_duffel', 'hotels_primary_provider', 'hotel_preferred_links', 'anthropic_ranking', 'final_summary'];

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
  const bq = await supabase.from('bookings').select('id,tenant_id,booking_code,booking_date,tour_id,guests').eq('id', bookingId).maybeSingle();
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
function sanitizeRequirements(contract, flightDates) {
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
    passengers: passengers,
    lodging_requirements: contract.lodging_requirements || [],
    hotel_search_preferences: contract.hotel_search_preferences || []
  };
}

/**
 * Construye el snapshot saneado + valida el gate. Lanza si no es elegible.
 * @returns { snapshot, booking, form, flightDates }
 */
async function buildMiluRequirements(bookingId) {
  const gate = await loadGateData(bookingId);
  assertSearchEligible(gate.form, gate.lodging);
  const contract = await buildTravelRequirements(bookingId);
  const flightDates = computeFlightDates(gate.booking.booking_date, gate.booking.tour_id);
  const snapshot = sanitizeRequirements(contract, flightDates);
  return { snapshot: snapshot, booking: gate.booking, form: gate.form, flightDates: flightDates };
}

/* ---------------- jobs / subtareas ---------------- */
async function startSearch(bookingId, userId, searchType) {
  searchType = searchType || 'complete_trip';
  const supabase = getSupabase();
  const built = await buildMiluRequirements(bookingId);
  const tenant = built.booking.tenant_id || getTenantId();
  const idem = tenant + ':' + bookingId + ':' + searchType;

  // Idempotencia: job activo con misma clave → devolverlo (no duplicar).
  const ex = await supabase.from('travel_search_jobs').select('*').eq('tenant_id', tenant).eq('idempotency_key', idem).eq('active', true).maybeSingle();
  if (ex.data) return { job: ex.data, created: false };

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

  const lg = await supabase.from('travel_logistics').select('id').eq('booking_id', bookingId).eq('tenant_id', tenant).maybeSingle();
  if (!lg.data) {
    await supabase.from('travel_logistics').insert({
      tenant_id: tenant, booking_id: bookingId, search_job_id: job.id, status: 'searching',
      default_departure_date: built.flightDates.default_departure_date,
      default_return_date: built.flightDates.default_return_date
    });
  }
  return { job: job, created: true, snapshot: built.snapshot, flightDates: built.flightDates };
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

module.exports = {
  PACKAGE_DURATION_DAYS, READY_FORM_STATUSES, SUBTASK_KINDS,
  addDaysYmd, computeFlightDates, assertSearchEligible, loadGateData,
  sanitizeRequirements, buildMiluRequirements, startSearch, cancelSearch, adjustFlightDates
};
