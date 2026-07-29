'use strict';

/* =========================================================
   Milu Turismo — motor de subtareas (core testeable)
   ---------------------------------------------------------
   SERVER-ONLY. La lógica del worker vive aquí para poder probarse en
   node; la Supabase Edge Function (Deno) que la invoca y su despliegue
   son de 8D. En 8C los adapters son stub/manual controlados (sin
   proveedores reales) y el LLM se inyecta (sin ANTHROPIC_API_KEY).

   Reclamo/lease/heartbeat/retry/recuperación con FOR UPDATE SKIP LOCKED
   vía RPC (milu_claim_next_subtask / milu_reclaim_expired_leases). Los
   upserts son idempotentes: reejecutar una subtarea no duplica ni borra
   resultados anteriores. Un proveedor caído deja la subtarea en partial
   sin afectar a las demás.
   ========================================================= */

const { getSupabase } = require('./supabase');
const { getFlightAdapter, getHotelAdapter } = require('./milu-adapters');
const { sanitizeErrorText } = require('./http');

const DEFAULT_LEASE_SECONDS = 120;
/* Estados que cuentan como contenido utilizable (no "provider not connected"). */
const USABLE_STATUSES = ['api_quoted', 'official_link_only', 'manual_confirmed'];

/* ---------------- lease / reclamo ---------------- */
async function claimNextSubtask(tenant, workerId, leaseSeconds) {
  const supabase = getSupabase();
  const r = await supabase.rpc('milu_claim_next_subtask', {
    p_tenant: tenant, p_worker: workerId, p_lease_seconds: leaseSeconds || DEFAULT_LEASE_SECONDS
  });
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, subtask: r.data || null };
}

async function heartbeatSubtask(id, workerId, leaseSeconds) {
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();
  const leaseIso = new Date(Date.now() + (leaseSeconds || DEFAULT_LEASE_SECONDS) * 1000).toISOString();
  await supabase.from('travel_search_subtasks').update({ heartbeat_at: nowIso, lease_expires_at: leaseIso })
    .eq('id', id).eq('locked_by', workerId);
  return { ok: true, lease_expires_at: leaseIso };
}

async function completeSubtask(id, status) {
  const supabase = getSupabase();
  await supabase.from('travel_search_subtasks').update({
    status: status || 'completed', finished_at: new Date().toISOString(), locked_by: null, lease_expires_at: null
  }).eq('id', id);
  return { ok: true, status: status || 'completed' };
}

async function failOrRetrySubtask(subtask, err) {
  const supabase = getSupabase();
  const sanitized = sanitizeErrorText(err && err.message ? err.message : err);
  const attempts = subtask.attempt_count || 0;
  if (attempts >= (subtask.max_attempts || 3)) {
    await supabase.from('travel_search_subtasks').update({
      status: 'failed', last_sanitized_error: sanitized, finished_at: new Date().toISOString(), locked_by: null, lease_expires_at: null
    }).eq('id', subtask.id);
    return { ok: true, status: 'failed' };
  }
  await supabase.from('travel_search_subtasks').update({
    status: 'queued', last_sanitized_error: sanitized,
    next_attempt_at: new Date(Date.now() + 30000).toISOString(), locked_by: null, lease_expires_at: null
  }).eq('id', subtask.id);
  return { ok: true, status: 'queued' };
}

async function reclaimExpiredLeases(tenant) {
  const supabase = getSupabase();
  const r = await supabase.rpc('milu_reclaim_expired_leases', { p_tenant: tenant });
  if (r.error) return { ok: false, error: r.error };
  return { ok: true, requeued: (r.data && r.data.requeued) || 0, failed: (r.data && r.data.failed) || 0 };
}

/* ---------------- job helpers ---------------- */
async function loadJob(jobId) {
  const supabase = getSupabase();
  const r = await supabase.from('travel_search_jobs').select('*').eq('id', jobId).maybeSingle();
  return r.data || null;
}

async function recomputeJobStatus(jobId) {
  const supabase = getSupabase();
  const r = await supabase.from('travel_search_subtasks').select('status').eq('job_id', jobId);
  const subs = r.data || [];
  const total = subs.length;
  const completed = subs.filter(function (s) { return s.status === 'completed'; }).length;
  const failed = subs.filter(function (s) { return s.status === 'failed'; }).length;
  const partial = subs.filter(function (s) { return s.status === 'partial'; }).length;
  const pending = subs.filter(function (s) { return s.status === 'queued' || s.status === 'running'; }).length;

  let status;
  if (total === 0) status = 'queued';
  else if (completed === total) status = 'completed';
  else if (failed === total) status = 'failed';
  else if (pending > 0) status = 'running';
  else status = 'partial';                 // sin pendientes pero mezcla → parcial

  await supabase.from('travel_search_jobs').update({ status: status }).eq('id', jobId);
  return status;
}

/* ---------------- upserts idempotentes ---------------- */
function flightRow(job, o) {
  return {
    provider: o.provider, airline: o.airline || null, source_reference: o.source_reference || null,
    origin: o.origin || null, destination: o.destination || null,
    departure_at: o.departure_at || null, arrival_at: o.arrival_at || null,
    return_departure_at: o.return_departure_at || null, return_arrival_at: o.return_arrival_at || null,
    passenger_count: o.passenger_count || null, cabin: o.cabin || null, baggage_summary: o.baggage_summary || null,
    fare_conditions: o.fare_conditions || null, taxes_included: o.taxes_included == null ? null : o.taxes_included,
    total_price_cents: o.total_price_cents == null ? null : o.total_price_cents, currency: o.currency || null,
    purchase_url: o.purchase_url || null, deeplink_expires_at: o.deeplink_expires_at || null,
    connection_risk: o.connection_risk || null, availability_status: o.availability_status,
    recommendation_score: o.recommendation_score == null ? null : o.recommendation_score,
    recommendation_reason: o.recommendation_reason || null, raw_snapshot_sanitized: o.raw_snapshot_sanitized || null,
    checked_at: o.checked_at || null
  };
}
function hotelRow(job, o) {
  return {
    provider: o.provider, destination: o.destination, hotel_name: o.hotel_name,
    is_preferred: !!o.is_preferred, is_airbnb: !!o.is_airbnb,
    check_in_date: o.check_in_date || null, check_out_date: o.check_out_date || null, nights: o.nights || null,
    rooms: o.rooms || null, guest_count: o.guest_count || null, room_type: o.room_type || null,
    breakfast_included: o.breakfast_included == null ? null : o.breakfast_included,
    cancellation_summary: o.cancellation_summary || null, taxes_included: o.taxes_included == null ? null : o.taxes_included,
    price_per_night_cents: o.price_per_night_cents == null ? null : o.price_per_night_cents,
    price_per_person_cents: o.price_per_person_cents == null ? null : o.price_per_person_cents,
    total_price_cents: o.total_price_cents == null ? null : o.total_price_cents, currency: o.currency || null,
    in_target_range: o.in_target_range == null ? null : o.in_target_range, booking_url: o.booking_url || null,
    location_notes: o.location_notes || null, availability_status: o.availability_status,
    preferred_hotel_rejection_reason: o.preferred_hotel_rejection_reason || null,
    recommendation_score: o.recommendation_score == null ? null : o.recommendation_score,
    recommendation_reason: o.recommendation_reason || null, raw_snapshot_sanitized: o.raw_snapshot_sanitized || null,
    checked_at: o.checked_at || null
  };
}

/* Clave estable por opción (dedup). El adapter la provee; si no, se deriva. */
function flightKey(o) { return o.provider_result_key || (o.provider + ':flight:' + (o.origin || '') + ':' + (o.destination || '') + ':' + (o.source_reference || '')); }
function hotelKey(o) { return o.provider_result_key || (o.provider + ':hotel:' + (o.destination || '') + ':' + (o.hotel_name || '')); }

/* Upsert idempotente: una fila ACTIVA por clave lógica. Retry → actualiza la
   activa (no duplica). Refresh → expira la activa y crea result_version+1
   (conserva historia). */
async function upsertFlightOptions(job, opts, opts2) {
  const supabase = getSupabase();
  const refresh = !!(opts2 && opts2.refresh);
  for (var i = 0; i < opts.length; i++) {
    const o = opts[i];
    const key = flightKey(o);
    const rows = (await supabase.from('travel_flight_options').select('*').eq('search_job_id', job.id).eq('provider', o.provider).eq('active', true)).data || [];
    const actives = rows.filter(function (r) { return (r.provider_result_key || '') === key; });
    const payload = flightRow(job, o); payload.provider_result_key = key;
    if (refresh && actives.length) {
      var maxV = 0;
      for (var a = 0; a < actives.length; a++) { maxV = Math.max(maxV, actives[a].result_version || 1); await supabase.from('travel_flight_options').update({ active: false, availability_status: 'expired' }).eq('id', actives[a].id); }
      await supabase.from('travel_flight_options').insert(Object.assign({ tenant_id: job.tenant_id, search_job_id: job.id, booking_id: job.booking_id, active: true, result_version: maxV + 1 }, payload));
    } else if (actives.length) {
      await supabase.from('travel_flight_options').update(payload).eq('id', actives[0].id);
    } else {
      await supabase.from('travel_flight_options').insert(Object.assign({ tenant_id: job.tenant_id, search_job_id: job.id, booking_id: job.booking_id, active: true, result_version: 1 }, payload));
    }
  }
}

async function upsertHotelOptions(job, opts, opts2) {
  const supabase = getSupabase();
  const refresh = !!(opts2 && opts2.refresh);
  for (var i = 0; i < opts.length; i++) {
    const o = opts[i];
    const key = hotelKey(o);
    const lrid = o.lodging_requirement_id || null;
    const rows = (await supabase.from('travel_hotel_options').select('*').eq('search_job_id', job.id).eq('provider', o.provider).eq('active', true)).data || [];
    const actives = rows.filter(function (r) { return (r.provider_result_key || '') === key && (r.lodging_requirement_id || null) === lrid; });
    const payload = hotelRow(job, o); payload.provider_result_key = key; payload.lodging_requirement_id = lrid;
    if (refresh && actives.length) {
      var maxV2 = 0;
      for (var b = 0; b < actives.length; b++) { maxV2 = Math.max(maxV2, actives[b].result_version || 1); await supabase.from('travel_hotel_options').update({ active: false, availability_status: 'expired' }).eq('id', actives[b].id); }
      await supabase.from('travel_hotel_options').insert(Object.assign({ tenant_id: job.tenant_id, search_job_id: job.id, booking_id: job.booking_id, active: true, result_version: maxV2 + 1 }, payload));
    } else if (actives.length) {
      await supabase.from('travel_hotel_options').update(payload).eq('id', actives[0].id);
    } else {
      await supabase.from('travel_hotel_options').insert(Object.assign({ tenant_id: job.tenant_id, search_job_id: job.id, booking_id: job.booking_id, active: true, result_version: 1 }, payload));
    }
  }
}

function buildFlightReq(snapshot) {
  const city = snapshot && snapshot.preferred_connection_city;
  const origin = city === 'quito' ? 'UIO' : (city === 'guayaquil' ? 'GYE' : 'UIO/GYE');
  const fd = (snapshot && snapshot.flight_dates) || {};
  return {
    origin: origin, destination: 'SCY',
    departure_date: fd.default_departure_date || null, return_date: fd.default_return_date || null,
    passenger_count: (snapshot && snapshot.passenger_count) || null
  };
}

function usable(opts) { return (opts || []).some(function (o) { return USABLE_STATUSES.indexOf(o.availability_status) !== -1; }); }

/**
 * Ejecuta UNA subtarea (operación corta). Devuelve {status, ...}. No lanza:
 * captura errores y los reporta como 'failed' para que el llamador decida
 * retry. Nunca borra resultados de otras subtareas.
 */
async function runSubtask(subtask, deps) {
  deps = deps || {};
  try {
    const job = deps.job || (await loadJob(subtask.job_id));
    if (!job) return { status: 'failed', reason: 'job_not_found' };
    const snapshot = job.requirements_snapshot || {};

    if (subtask.kind === 'flights_duffel') {
      const adapter = getFlightAdapter(deps.flightProvider || 'stub');
      const opts = adapter.searchFlights(buildFlightReq(snapshot));
      await upsertFlightOptions(job, opts, { refresh: deps.refresh });
      return { status: usable(opts) ? 'completed' : 'partial', count: opts.length, reason: usable(opts) ? null : 'provider_not_connected' };
    }

    if (subtask.kind === 'hotels_primary_provider' || subtask.kind === 'hotel_preferred_links') {
      const name = subtask.kind === 'hotel_preferred_links' ? 'manual' : (deps.hotelProvider || 'stub');
      const adapter = getHotelAdapter(name);
      const all = [];
      const lodg = (snapshot.lodging_requirements || []);
      for (var i = 0; i < lodg.length; i++) {
        if (lodg[i].pending_resolution) continue;   // connection_tbd → no se busca
        const part = adapter.searchHotels(lodg[i], snapshot.hotel_search_preferences || [], deps.settings);
        for (var k = 0; k < part.length; k++) all.push(part[k]);
      }
      await upsertHotelOptions(job, all, { refresh: deps.refresh });
      return { status: usable(all) ? 'completed' : 'partial', count: all.length, reason: usable(all) ? null : 'provider_not_connected' };
    }

    if (subtask.kind === 'anthropic_ranking' || subtask.kind === 'final_summary') {
      if (!deps.llm || typeof deps.llm.runLlm !== 'function') return { status: 'partial', reason: 'llm_not_available' };
      const res = await deps.llm.runLlm({
        jobId: job.id, bookingId: job.booking_id, subtaskId: subtask.id, subtaskKind: subtask.kind,
        purpose: subtask.kind, system: 'Milu reasons only over structured provider data; never invent prices/availability.',
        input: { options_summary: true }, settings: deps.settings, spent: deps.spent || {}, env: deps.env, client: deps.llmClient
      });
      if (res.status === 'configuration_error') return { status: 'failed', reason: 'configuration_error' };
      if (!res.ok) return { status: 'partial', reason: res.reason };
      return { status: 'completed' };
    }

    return { status: 'partial', reason: 'unknown_kind' };
  } catch (e) {
    return { status: 'failed', reason: 'exception', error: e };
  }
}

module.exports = {
  DEFAULT_LEASE_SECONDS, USABLE_STATUSES,
  claimNextSubtask, heartbeatSubtask, completeSubtask, failOrRetrySubtask, reclaimExpiredLeases,
  loadJob, recomputeJobStatus, runSubtask,
  upsertFlightOptions, upsertHotelOptions, buildFlightReq
};
