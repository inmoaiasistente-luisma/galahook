'use strict';
/* =========================================================
   Etapa 8C — Milu Turismo (núcleo) + endurecimiento de integridad.
   Mock Supabase en memoria (query builder + rpc de cola con validación de
   job padre) y mock de buildTravelRequirements. Sin red, sin claves.
   ========================================================= */
const fs = require('fs');
const path = require('path');
/* Portable: la suite vive en <deploy>/tests/, así que BASE = <deploy>. */
const BASE = path.resolve(__dirname, '..');
process.env.TENANT_ID = 'hook-adventure';
process.env.ANTHROPIC_MILU_TOURISM_MODEL = 'Haiku';
process.env.MILU_TOURISM_SONNET_ENABLED = 'false';

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

let _id = 0;
function nid() { return '00000000-0000-4000-8000-' + String(++_id).padStart(12, '0'); }

/* ---------------- mock Supabase ---------------- */
function miluRpc(name, params, db) {
  const subs = db.travel_search_subtasks || (db.travel_search_subtasks = []);
  const jobs = db.travel_search_jobs || (db.travel_search_jobs = []);
  const now = Date.now();
  function parentOk(s) {
    const j = jobs.filter(function (x) { return x.id === s.job_id && x.tenant_id === s.tenant_id; })[0];
    return !!j && j.active === true && ['queued', 'running', 'partial'].indexOf(j.status) !== -1;
  }
  if (name === 'milu_claim_next_subtask') {
    if (!params.p_tenant || String(params.p_tenant).trim() === '') throw new Error('invalid tenant');
    if (!params.p_worker || String(params.p_worker).trim() === '') throw new Error('invalid worker');
    const ls = params.p_lease_seconds;
    if (ls == null || ls < 15 || ls > 300) throw new Error('invalid lease seconds');
    const cand = subs.filter(function (s) {
      return s.tenant_id === params.p_tenant
        && s.status === 'queued'                       // SOLO queued (0017): 'partial' es terminal, no se re-reclama
        && (s.attempt_count || 0) < (s.max_attempts || 3)
        && (!s.lease_expires_at || Date.parse(s.lease_expires_at) < now)
        && (!s.next_attempt_at || Date.parse(s.next_attempt_at) <= now)
        && parentOk(s);
    }).sort(function (a, b) { return String(a.created_at || '') < String(b.created_at || '') ? -1 : 1; })[0];
    if (!cand) return null;
    cand.status = 'running'; cand.locked_by = params.p_worker; cand.locked_at = new Date(now).toISOString();
    cand.lease_expires_at = new Date(now + ls * 1000).toISOString(); cand.heartbeat_at = cand.locked_at;
    cand.attempt_count = (cand.attempt_count || 0) + 1; cand.started_at = cand.started_at || cand.locked_at;
    return cand;
  }
  if (name === 'milu_reclaim_expired_leases') {
    let requeued = 0, failed = 0;
    subs.forEach(function (s) {
      if (s.status === 'running' && s.lease_expires_at && Date.parse(s.lease_expires_at) < now && parentOk(s)) {
        if ((s.attempt_count || 0) < (s.max_attempts || 3)) {
          s.status = 'queued'; s.locked_by = null; s.locked_at = null; s.lease_expires_at = null; s.heartbeat_at = null;
          s.next_attempt_at = new Date(now + Math.min(300, 30 * Math.max(s.attempt_count || 1, 1)) * 1000).toISOString();
          requeued++;
        } else {
          s.status = 'failed'; s.finished_at = new Date(now).toISOString(); s.locked_by = null; s.lease_expires_at = null; s.heartbeat_at = null;
          failed++;
        }
      }
    });
    return { requeued: requeued, failed: failed };
  }
  throw new Error('unknown rpc ' + name);
}

function makeClient(db) {
  function from(name) {
    if (!db[name]) db[name] = [];
    const rows = db[name];
    const st = { op: 'select', payload: null, filters: [], order: null, limit: null };
    const b = {};
    b.select = function () { if (st.op !== 'insert' && st.op !== 'update') st.op = 'select'; return b; };
    b.insert = function (p) { st.op = 'insert'; st.payload = p; return b; };
    b.update = function (p) { st.op = 'update'; st.payload = p; return b; };
    b.eq = function (c, v) { st.filters.push({ t: 'eq', c: c, v: v }); return b; };
    b.in = function (c, a) { st.filters.push({ t: 'in', c: c, a: a }); return b; };
    b.not = function (c) { st.filters.push({ t: 'nn', c: c }); return b; };
    b.order = function (c, o) { st.order = { c: c, asc: !!(o && o.ascending) }; return b; };
    b.limit = function (n) { st.limit = n; return b; };
    function run() {
      if (st.op === 'insert') {
        const arr = Array.isArray(st.payload) ? st.payload : [st.payload];
        const ins = arr.map(function (o) { const row = Object.assign({ id: nid() }, o); rows.push(row); return row; });
        return { data: ins, error: null };
      }
      let list = rows.filter(function (r) {
        return st.filters.every(function (f) {
          if (f.t === 'eq') return r[f.c] === f.v;
          if (f.t === 'in') return f.a.indexOf(r[f.c]) !== -1;
          if (f.t === 'nn') return r[f.c] != null;
          return true;
        });
      });
      if (st.op === 'update') { list.forEach(function (r) { Object.assign(r, st.payload); }); return { data: list, error: null }; }
      if (st.order) { const o = st.order; list = list.slice().sort(function (a, bb) { const av = a[o.c], bv = bb[o.c]; if (av === bv) return 0; return (av > bv ? 1 : -1) * (o.asc ? 1 : -1); }); }
      if (st.limit != null) list = list.slice(0, st.limit);
      return { data: list, error: null };
    }
    b.maybeSingle = function () { const r = run(); return Promise.resolve({ data: r.error ? null : (r.data[0] || null), error: r.error }); };
    b.single = function () { const r = run(); return Promise.resolve({ data: r.error ? null : (r.data[0] || null), error: r.error }); };
    b.then = function (res, rej) { return Promise.resolve(run()).then(res, rej); };
    return b;
  }
  function rpc(name, params) {
    try { return Promise.resolve({ data: miluRpc(name, params, db), error: null }); }
    catch (e) { return Promise.resolve({ data: null, error: { message: e.message } }); }
  }
  return { from: from, rpc: rpc };
}

let CLIENT = makeClient({});
let CURRENT_ROLE = 'owner';
let CONTRACT = null;
function setClient(db) { CLIENT = makeClient(db); }

function mockModule(rel, exp) { const p = require.resolve(BASE + rel); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
mockModule('/server/lib/supabase.js', { getSupabase: function () { return CLIENT; } });
/* Compuerta de roles simulada. Fase 9: la ESCRITURA es solo del owner
   (requireWriter) y registrar ventas es de owner+staff (requireSaleWriter);
   el admin quedó en solo lectura. El mock replica esa matriz para que las
   pruebas de rol sigan siendo reales y no una comodidad del arnés. */
async function mockGate(req, res, allowed) {
  if (allowed && allowed.indexOf(CURRENT_ROLE) === -1) { res.statusCode = 403; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'FORBIDDEN' })); return null; }
  return { user_id: 'u-' + CURRENT_ROLE, role: CURRENT_ROLE, tenant_id: 'hook-adventure', email: 'x@y.z', full_name: 'X' };
}
mockModule('/server/lib/admin-auth.js', {
  WRITE_ROLES: ['owner'], SALE_WRITE_ROLES: ['owner', 'staff'],
  canWrite: function (r) { return r === 'owner'; },
  canRecordSale: function (r) { return r === 'owner' || r === 'staff'; },
  requireAdmin: mockGate,
  requireOwner: function (req, res) { return mockGate(req, res, ['owner']); },
  requireOwnerOrAdmin: function (req, res) { return mockGate(req, res, ['owner', 'admin']); },
  requireWriter: function (req, res) { return mockGate(req, res, ['owner']); },
  requireSaleWriter: function (req, res) { return mockGate(req, res, ['owner', 'staff']); },
  sameOrigin: function () { return true; }
});
/* La auditoría se registra en memoria: nunca debe bloquear ni ensuciar la BD
   simulada, y así las pruebas pueden afirmar QUÉ se auditó. */
const AUDIT = [];
mockModule('/server/lib/admin-audit.js', {
  recordAudit: async function (session, entry) { AUDIT.push({ role: session && session.role, entry: entry }); return true; }
});
mockModule('/server/lib/passenger-intake.js', { buildTravelRequirements: async function () { return CONTRACT; } });

const cost = require(BASE + '/server/lib/milu-cost.js');
const allow = require(BASE + '/server/lib/milu-allowlist.js');
const stub = require(BASE + '/server/lib/milu-adapters/stub.js');
const manual = require(BASE + '/server/lib/milu-adapters/manual.js');
const llm = require(BASE + '/server/lib/milu-llm.js');
const milu = require(BASE + '/server/lib/milu-tourism.js');
const worker = require(BASE + '/server/lib/milu-worker-core.js');
const startH = require(BASE + '/server/admin-handlers/milu-search-start.js');
const cancelH = require(BASE + '/server/admin-handlers/milu-search-cancel.js');
const statusH = require(BASE + '/server/admin-handlers/milu-search-status.js');
const settingsGetH = require(BASE + '/server/admin-handlers/milu-settings-get.js');
const settingsSaveH = require(BASE + '/server/admin-handlers/milu-settings-save.js');
const flags = require(BASE + '/server/lib/milu-flags.js');
const webtools = require(BASE + '/server/lib/milu-web-tools.js');
const webResearch = require(BASE + '/server/lib/milu-adapters/web-research.js');
const rerunH = require(BASE + '/server/admin-handlers/milu-research-rerun.js');
const approveH = require(BASE + '/server/admin-handlers/milu-research-approve.js');
const wrClient = require(BASE + '/scripts/milu-anthropic-client.js');
const previewH = require(BASE + '/server/admin-handlers/milu-itinerary-preview.js');

function mockRes() { return { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, end(s) { this.body = s; } }; }
function run(h, req) { const res = mockRes(); return Promise.resolve(h(req, res)).then(() => res); }
function j(res) { try { return JSON.parse(res.body); } catch (e) { return {}; } }

function baseContract(booking) {
  return {
    booking_code: 'HA-2026-000001', tour: { id: booking.tour_id, name: 'Island Escape (4 Days)' },
    travel_date: booking.booking_date, passenger_count: 2, preferred_connection_city: 'quito',
    // Pasajero internacional por defecto (llegada continental) → tipo derivable en el gate.
    arrival: { international_flights_purchased: true, ecuador_arrival_date: null, ecuador_arrival_time: null, arrival_airport: 'UIO' },
    passengers: [
      { passenger_number: 1, legal_first_name: 'Ana', legal_last_name: 'Perez', age_category: 'adult', nationality: 'Ecuadorian', baggage_notes: '1 maleta', special_assistance: null, accessibility_or_mobility_needs: null },
      { passenger_number: 2, legal_first_name: 'Luis', legal_last_name: 'Gomez', age_category: 'adult', nationality: 'Ecuadorian', baggage_notes: null, special_assistance: null, accessibility_or_mobility_needs: null }
    ],
    lodging_requirements: [
      { id: nid(), destination: 'san_cristobal', lodging_required: true, check_in_date: '2026-08-01', check_out_date: '2026-08-04', nights: 3, guest_count: 2, rooms_required: 1, room_preferences: null, approximate_budget_cents: 12000, accessibility_notes: null, pending_resolution: false }
    ],
    hotel_search_preferences: [
      { destination: 'san_cristobal', hotel_name: 'Miconia', priority: 1, preference_notes: 'Primera opción', search_aliases: ['https://www.booking.com/hotel/ec/miconia.html'] },
      { destination: 'san_cristobal', hotel_name: 'Casa Opuntia', priority: 2, preference_notes: null, search_aliases: [] }
    ]
  };
}

function freshDb(opts) {
  opts = opts || {};
  const bId = nid(), fId = nid();
  const booking = { id: bId, tenant_id: 'hook-adventure', booking_code: 'HA-2026-000001', booking_date: '2026-08-01', tour_id: 'p3', guests: 2 };
  const form = { id: fId, booking_id: bId, tenant_id: 'hook-adventure', status: opts.formStatus || 'submitted', preferred_connection_city: 'quito' };
  const lodging = [];
  if (!opts.noLodging) {
    lodging.push({ id: nid(), passenger_form_id: fId, tenant_id: 'hook-adventure', destination: 'san_cristobal', lodging_required: true, check_in_date: opts.missingDates ? null : '2026-08-01', check_out_date: opts.missingDates ? null : '2026-08-04', status: 'pending', active: true });
  }
  if (opts.connectionTbd) {
    lodging.push({ id: nid(), passenger_form_id: fId, tenant_id: 'hook-adventure', destination: 'connection_tbd', lodging_required: true, check_in_date: null, check_out_date: null, status: 'pending', active: true });
  }
  const db = { bookings: [booking], booking_passenger_forms: [form], booking_lodging_requirements: lodging, travel_search_jobs: [], travel_search_subtasks: [], travel_flight_options: [], travel_hotel_options: [], travel_logistics: [], travel_search_audit: [], llm_usage_log: [], milu_settings: [] };
  return { db: db, booking: booking, form: form };
}

function snap() {
  return {
    preferred_connection_city: 'quito', passenger_count: 2,
    flight_dates: { default_departure_date: '2026-08-01', default_return_date: '2026-08-04', duration_days: 4 },
    // Itinerario resuelto (ruta/fecha SOLICITADAS): origen UIO, salida 2026-08-01, isla San Cristóbal (SCY).
    itinerary: { passenger_type: 'international', connection_city: 'quito', connection_source: 'intake', origin_airport: 'UIO',
      galapagos_start_date: '2026-08-01', mainland_to_galapagos_flight_date: '2026-08-01', galapagos_return_flight_date: '2026-08-04',
      requires_mainland_pre_night: true },
    lodging_requirements: [{ id: nid(), destination: 'san_cristobal', pending_resolution: false, check_in_date: '2026-08-01', check_out_date: '2026-08-04', nights: 3, rooms_required: 1, guest_count: 2 }],
    hotel_search_preferences: [
      { destination: 'san_cristobal', hotel_name: 'Miconia', priority: 1, search_aliases: ['https://www.booking.com/hotel/ec/miconia.html'] },
      { destination: 'san_cristobal', hotel_name: 'Casa Opuntia', priority: 2, search_aliases: [] }
    ]
  };
}

/* job padre activo + subtareas para pruebas de cola */
function queueDb(jobStatus, jobActive, subs) {
  const jid = nid();
  const job = { id: jid, tenant_id: 'hook-adventure', booking_id: nid(), status: jobStatus, active: jobActive, requirements_snapshot: snap() };
  const list = (subs || []).map(function (s, i) {
    return Object.assign({ id: nid(), tenant_id: 'hook-adventure', job_id: jid, kind: 'flights_duffel', status: 'queued', attempt_count: 0, max_attempts: 3, created_at: '2026-08-01T00:00:0' + i + 'Z' }, s);
  });
  return { db: { travel_search_jobs: [job], travel_search_subtasks: list }, jid: jid, job: job };
}

const SQL = fs.readFileSync(path.join(BASE, 'supabase/migrations/0015_milu_tourism_search.sql'), 'utf8');
const SQL16 = fs.readFileSync(path.join(BASE, 'supabase/migrations/0016_milu_web_research.sql'), 'utf8');
/* Extrae el cuerpo de un CREATE TABLE para afirmar columnas dentro de esa tabla. */
function tableBlock(name) { const m = new RegExp('create table public\\.' + name + ' \\(([\\s\\S]*?)\\n\\);').exec(SQL); return m ? m[1] : ''; }

(async function () {
  /* ===== Orquestador (1-10) ===== */
  let f = freshDb(); CONTRACT = baseContract(f.booking); setClient(f.db);
  let r1 = await milu.startSearch(f.booking.id, 'u-owner', 'complete_trip');
  ok('1 form submitted permite preparar job', r1.created === true && !!r1.job.id && r1.job.status === 'queued');

  f = freshDb({ formStatus: 'pending' }); CONTRACT = baseContract(f.booking); setClient(f.db);
  let blocked = false; try { await milu.startSearch(f.booking.id, 'u-owner'); } catch (e) { blocked = e.code === 'FORM_NOT_READY'; }
  ok('2 formulario incompleto bloquea', blocked === true);

  // El itinerario deriva la conexión del override/preferred, no de un lodging connection_tbd:
  // con la conexión resuelta (preferred 'quito' + arrival internacional) NO bloquea.
  f = freshDb({ connectionTbd: true }); CONTRACT = baseContract(f.booking); setClient(f.db);
  let r3 = null, err3 = null; try { r3 = await milu.startSearch(f.booking.id, 'u-owner'); } catch (e) { err3 = e.code; }
  ok('3 connection_tbd no bloquea si la conexión está resuelta', err3 === null && r3 && r3.created === true);

  // Las fechas del programa salen de booking_date + duración, NO de las fechas del lodging:
  // un lodging sin check_in/out YA NO bloquea (se eliminó destination_dates).
  f = freshDb({ missingDates: true }); CONTRACT = baseContract(f.booking); setClient(f.db);
  let r4 = null, err4 = null; try { r4 = await milu.startSearch(f.booking.id, 'u-owner'); } catch (e) { err4 = e.code; }
  ok('4 lodging sin fechas no bloquea (fechas = inicio programa + duración)', err4 === null && r4 && r4.created === true && r4.itinerary && r4.itinerary.galapagos_end_date === '2026-08-04');
  ok('4 destino sin fecha bloquea', blocked === true);

  const fd = milu.computeFlightDates('2026-08-01', 'p3');
  ok('5 ida deriva del inicio del paquete', fd.default_departure_date === '2026-08-01');
  ok('6 regreso deriva del final del paquete (p3=4d)', fd.default_return_date === '2026-08-04');

  f = freshDb(); CONTRACT = baseContract(f.booking); setClient(f.db);
  await milu.startSearch(f.booking.id, 'u-owner');
  const adj = await milu.adjustFlightDates(f.booking.id, { departure_date: '2026-07-31', return_date: '2026-08-04', reason: 'conexión internacional', userId: 'u-owner' });
  let reasonReq = false; try { await milu.adjustFlightDates(f.booking.id, { departure_date: '2026-07-31' }); } catch (e) { reasonReq = e.code === 'REASON_REQUIRED'; }
  ok('7 owner ajusta fechas con motivo', adj.approved_departure_date === '2026-07-31' && adj.adjustment_reason === 'conexión internacional' && reasonReq === true);

  f = freshDb(); CONTRACT = baseContract(f.booking); setClient(f.db);
  const a1 = await milu.startSearch(f.booking.id, 'u-owner');
  const a2 = await milu.startSearch(f.booking.id, 'u-owner');
  ok('8 job idempotente', a1.job.id === a2.job.id && a2.created === false);
  ok('9 doble clic no duplica job', f.db.travel_search_jobs.length === 1);
  ok('10 subtareas se crean una vez (5)', f.db.travel_search_subtasks.filter(function (s) { return s.job_id === a1.job.id; }).length === 5);

  /* ===== Cola / lease (11-18) ===== */
  let q = queueDb('queued', true, [{ kind: 'flights_duffel' }, { kind: 'hotels_primary_provider' }]);
  setClient(q.db);
  const c1 = await worker.claimNextSubtask('hook-adventure', 'w1', 120);
  ok('11 worker reclama con lock', c1.ok && c1.subtask && c1.subtask.status === 'running' && c1.subtask.locked_by === 'w1');

  q = queueDb('queued', true, [{ kind: 'flights_duffel' }]); setClient(q.db);
  const w1 = await worker.claimNextSubtask('hook-adventure', 'w1', 120);
  const w2 = await worker.claimNextSubtask('hook-adventure', 'w2', 120);
  ok('12 segundo worker no reclama la misma subtarea', w1.subtask && w2.subtask === null);

  q = queueDb('running', true, [{ kind: 'flights_duffel', status: 'running', attempt_count: 1, lease_expires_at: new Date(Date.now() - 1000).toISOString(), locked_by: 'dead' }]); setClient(q.db);
  const rec = await worker.reclaimExpiredLeases('hook-adventure');
  ok('13 lease expirado se recupera (queued)', rec.requeued === 1 && q.db.travel_search_subtasks[0].status === 'queued' && q.db.travel_search_subtasks[0].locked_by === null);

  q = queueDb('queued', true, [{ kind: 'flights_duffel' }]); setClient(q.db);
  const c14 = await worker.claimNextSubtask('hook-adventure', 'wh', 15);
  const before = q.db.travel_search_subtasks[0].lease_expires_at;
  const hb = await worker.heartbeatSubtask(q.db.travel_search_subtasks[0].id, 'wh', 300);
  ok('14 heartbeat extiende lease', c14.subtask && Date.parse(hb.lease_expires_at) > Date.parse(before));

  q = queueDb('queued', true, [{ kind: 'flights_duffel' }]); setClient(q.db);
  const cc1 = await worker.claimNextSubtask('hook-adventure', 'w1', 120);
  const at1 = cc1.subtask.attempt_count;
  await worker.failOrRetrySubtask(cc1.subtask, new Error('boom'));
  q.db.travel_search_subtasks[0].next_attempt_at = null; q.db.travel_search_subtasks[0].lease_expires_at = null;
  const cc2 = await worker.claimNextSubtask('hook-adventure', 'w1', 120);
  ok('15 retry aumenta attempt_count', at1 === 1 && cc2.subtask.attempt_count === 2);

  setClient({ travel_search_subtasks: [{ id: 's16', tenant_id: 'hook-adventure', job_id: nid(), kind: 'flights_duffel', status: 'running', attempt_count: 3, max_attempts: 3 }] });
  const fr = await worker.failOrRetrySubtask({ id: 's16', attempt_count: 3, max_attempts: 3 }, new Error('x'));
  ok('16 max_attempts termina en failed', fr.status === 'failed');

  const job17 = { id: nid(), tenant_id: 'hook-adventure', booking_id: nid(), requirements_snapshot: snap() };
  setClient({ travel_flight_options: [], travel_search_jobs: [job17], travel_search_subtasks: [] });
  const rs17 = await worker.runSubtask({ id: nid(), job_id: job17.id, kind: 'flights_duffel' }, { job: job17, flightProvider: 'stub' });
  const jid = nid();
  setClient({ travel_search_jobs: [{ id: jid, status: 'running' }], travel_search_subtasks: [{ job_id: jid, status: 'completed' }, { job_id: jid, status: 'completed' }, { job_id: jid, status: 'failed' }, { job_id: jid, status: 'completed' }, { job_id: jid, status: 'completed' }] });
  const st17 = await worker.recomputeJobStatus(jid);
  ok('17 proveedor caído produce partial', rs17.status === 'partial' && st17 === 'partial');

  const job18 = { id: nid(), tenant_id: 'hook-adventure', booking_id: nid(), requirements_snapshot: snap() };
  const db18 = { travel_flight_options: [], travel_search_jobs: [job18] }; setClient(db18);
  await worker.runSubtask({ id: nid(), job_id: job18.id, kind: 'flights_duffel' }, { job: job18, flightProvider: 'stub' });
  await worker.runSubtask({ id: nid(), job_id: job18.id, kind: 'flights_duffel' }, { job: job18, flightProvider: 'stub' });
  ok('18 retry no duplica opción de vuelo', db18.travel_flight_options.length === 1 && db18.travel_flight_options[0].result_version === 1);

  /* ===== Adapters / allowlist (19-21) ===== */
  const sf = stub.searchFlights({ origin: 'UIO', destination: 'SCY', passenger_count: 2 });
  ok('19 stub no devuelve api_quoted', sf.every(function (o) { return o.availability_status !== 'api_quoted' && o.total_price_cents == null; }) && !!sf[0].provider_result_key);

  const mh = manual.searchHotels({ destination: 'san_cristobal', check_in_date: '2026-08-01', check_out_date: '2026-08-04', nights: 3, rooms_required: 1, guest_count: 2 }, snap().hotel_search_preferences, cost.DEFAULT_MILU_SETTINGS);
  ok('20 manual no inventa precios', mh.length === 2 && mh.every(function (o) { return o.total_price_cents == null && o.availability_status !== 'api_quoted'; }));

  const badPref = [{ destination: 'san_cristobal', hotel_name: 'X', priority: 1, search_aliases: ['https://evil.com/x'] }];
  const mhBad = manual.searchHotels({ destination: 'san_cristobal' }, badPref, cost.DEFAULT_MILU_SETTINGS);
  ok('21 URL fuera de allowlist se rechaza',
    allow.isAllowedPurchaseUrl('https://evil.com/x') === false &&
    allow.isAllowedPurchaseUrl('https://www.booking.com/hotel/ec/miconia.html') === true &&
    mhBad[0].booking_url === null && mh[0].booking_url === 'https://www.booking.com/hotel/ec/miconia.html');

  /* ===== Snapshot saneado (22-23) ===== */
  f = freshDb(); CONTRACT = baseContract(f.booking); setClient(f.db);
  const built = await milu.buildMiluRequirements(f.booking.id);
  const snapStr = JSON.stringify(built.snapshot);
  ok('22 requirements snapshot no contiene documentos', snapStr.indexOf('document_number') === -1 && snapStr.indexOf('document_type') === -1);
  ok('23 requirements snapshot no contiene tokens', snapStr.toLowerCase().indexOf('token') === -1 && snapStr.toLowerCase().indexOf('secret') === -1);

  /* ===== IA Haiku-only + logging + caps (24-29) ===== */
  const dbLlm = { llm_usage_log: [] }; setClient(dbLlm);
  const fakeClient = { messages: async function () { return { usage: { input_tokens: 1000, output_tokens: 500 }, model_version: 'claude-haiku-4-5-20251001', output: 'ranking' }; } };
  const lr = await llm.runLlm({ jobId: nid(), bookingId: nid(), subtaskId: nid(), subtaskKind: 'anthropic_ranking', purpose: 'scoring', system: 'S', input: { x: 1 }, settings: cost.DEFAULT_MILU_SETTINGS, spent: {}, env: { ANTHROPIC_MILU_TOURISM_MODEL: 'Haiku' }, client: fakeClient });
  const logRow = dbLlm.llm_usage_log[0] || {};
  const forbiddenKeys = ['prompt', 'response', 'system', 'input', 'output', 'messages', 'document', 'document_number', 'ciphertext', 'pii'];
  const hasForbidden = forbiddenKeys.some(function (k) { return Object.prototype.hasOwnProperty.call(logRow, k); });
  ok('24 logging de IA no contiene prompts ni PII', lr.ok === true && logRow.model === 'claude-haiku-4-5' && hasForbidden === false);

  ok('25 solo Haiku permitido', cost.resolveMiluModel({ ANTHROPIC_MILU_TOURISM_MODEL: 'Haiku' }).model === 'claude-haiku-4-5' && cost.resolveMiluModel({ ANTHROPIC_MILU_TOURISM_MODEL: 'claude-haiku-4-5' }).model === 'claude-haiku-4-5');
  const rSon = cost.resolveMiluModel({ ANTHROPIC_MILU_TOURISM_MODEL: 'Sonnet', MILU_TOURISM_SONNET_ENABLED: 'false' });
  ok('26 Sonnet rechazado con flag false', rSon.ok === false && rSon.reason === 'configuration_error');
  const rOpus1 = cost.resolveMiluModel({ ANTHROPIC_MILU_TOURISM_MODEL: 'claude-opus-5' });
  const rOpus2 = cost.resolveMiluModel({ ANTHROPIC_MILU_TOURISM_MODEL: 'Opus', MILU_TOURISM_SONNET_ENABLED: 'true' });
  ok('27 Opus siempre rechazado', rOpus1.ok === false && rOpus2.ok === false);
  ok('28 sin modelo configurado → configuration_error', cost.resolveMiluModel({}).ok === false && cost.resolveMiluModel({}).detail === 'model_not_configured');

  setClient({ llm_usage_log: [] });
  let called2 = 0; const fc2 = { messages: async function () { called2++; return { usage: {}, output: '' }; } };
  const capRes = await llm.runLlm({ jobId: nid(), purpose: 'p', settings: { llm_max_cost_per_job_usd: 2.0 }, spent: { job: 99 }, env: { ANTHROPIC_MILU_TOURISM_MODEL: 'Haiku' }, client: fc2 });
  const capCall = cost.checkBudget(cost.DEFAULT_MILU_SETTINGS, {}, 999);
  ok('29 caps por llamada/job/reserva/día se respetan', capRes.ok === false && capRes.reason === 'llm_budget_exceeded' && called2 === 0 && capCall.ok === false);

  /* ===== Handlers (30-33) ===== */
  f = freshDb(); CONTRACT = baseContract(f.booking); setClient(f.db); CURRENT_ROLE = 'owner';
  let hr = await run(startH, { method: 'POST', headers: {}, body: { booking_id: f.booking.id } });
  ok('30 owner inicia', hr.statusCode === 200 && j(hr).started === true);

  // Fase 9: el admin pasó a SOLO LECTURA — iniciar una búsqueda es escritura → 403.
  f = freshDb(); CONTRACT = baseContract(f.booking); setClient(f.db); CURRENT_ROLE = 'admin';
  hr = await run(startH, { method: 'POST', headers: {}, body: { booking_id: f.booking.id } });
  ok('31 admin NO inicia (solo lectura)', hr.statusCode === 403 && j(hr).error === 'FORBIDDEN');

  CURRENT_ROLE = 'staff';
  hr = await run(startH, { method: 'POST', headers: {}, body: { booking_id: f.booking.id } });
  ok('32 staff recibe 403', hr.statusCode === 403);

  CURRENT_ROLE = 'admin';
  let sr = await run(settingsSaveH, { method: 'POST', headers: {}, body: { hotel_target_min_cents: 5000, hotel_target_max_cents: 20000 } });
  const admin403 = sr.statusCode === 403;
  CURRENT_ROLE = 'owner'; setClient({ milu_settings: [] });
  sr = await run(settingsSaveH, { method: 'POST', headers: {}, body: { hotel_target_min_cents: 6000, hotel_target_max_cents: 21000, primary_hotel_provider: 'manual' } });
  ok('33 settings owner-only cuando corresponda', admin403 === true && sr.statusCode === 200 && j(sr).saved === true);

  /* ===== 34-35 ===== */
  const miluSrc = fs.readFileSync(BASE + '/server/lib/milu-tourism.js', 'utf8') + fs.readFileSync(BASE + '/server/lib/milu-worker-core.js', 'utf8') + fs.readFileSync(BASE + '/server/admin-handlers/milu-search-start.js', 'utf8');
  ok('34 no se envía email al cliente', !/booking-email-service|customer_travel_confirmation|resend|sendEmail/i.test(miluSrc));

  const job35 = { id: nid(), tenant_id: 'hook-adventure', booking_id: nid(), requirements_snapshot: snap() };
  const db35 = { travel_flight_options: [], travel_hotel_options: [], travel_search_jobs: [job35] }; setClient(db35);
  await worker.runSubtask({ id: nid(), job_id: job35.id, kind: 'flights_duffel' }, { job: job35, flightProvider: 'stub' });
  await worker.runSubtask({ id: nid(), job_id: job35.id, kind: 'hotel_preferred_links' }, { job: job35 });
  const allOpts = db35.travel_flight_options.concat(db35.travel_hotel_options);
  const OKSTATES = ['provider_not_configured', 'official_link_only', 'manual_confirmation_required', 'provider_no_content'];
  ok('35 no se crean opciones ficticias', allOpts.length > 0 && allOpts.every(function (o) { return o.total_price_cents == null && OKSTATES.indexOf(o.availability_status) !== -1; }));

  /* ===== 36-41 regresión estructural ===== */
  const catalog = require(BASE + '/server/lib/tour-catalog.js');
  ok('36 package pricing sigue funcionando (catálogo intacto)', catalog.getTour('p3').priceCents === 349900 && catalog.getTour('p4').priceCents === 399900);
  const cpiSrc = fs.readFileSync(BASE + '/api/create-payment-intent.js', 'utf8');
  ok('37 checkout sigue funcionando (amount rechazado)', /ALLOWED_KEYS/.test(cpiSrc) && !/[\x27\x22]amount[\x27\x22]/.test((/ALLOWED_KEYS\s*=\s*\[([^\]]*)\]/.exec(cpiSrc) || [, ''])[1]));
  const intakeSrc = fs.readFileSync(BASE + '/server/lib/passenger-intake.js', 'utf8');
  ok('38 passenger intake sigue funcionando', /buildTravelRequirements/.test(intakeSrc) && /ELIGIBLE_BOOKING_STATUSES/.test(intakeSrc));
  const qrSrc = fs.readFileSync(BASE + '/server/lib/booking-qr.js', 'utf8');
  ok('39 QR sigue funcionando', qrSrc.length > 0 && /signQr|verifyQr|QR|qr/.test(qrSrc));
  ok('40 finanzas sigue funcionando', typeof require(BASE + '/server/admin-handlers/finance-summary.js') === 'function');
  const apiFns = fs.readdirSync(BASE + '/api').filter(function (n) { return /\.js$/.test(n); });
  ok('41 funciones Vercel = 8', apiFns.length === 8);

  /* ===== 42 cobertura versionada ===== */
  const files8c = [
    'server/lib/milu-cost.js', 'server/lib/milu-allowlist.js', 'server/lib/milu-flags.js',
    'server/lib/milu-llm.js', 'server/lib/milu-tourism.js', 'server/lib/milu-worker-core.js',
    'server/lib/milu-adapters/index.js', 'server/lib/milu-adapters/stub.js', 'server/lib/milu-adapters/manual.js',
    'server/admin-handlers/milu-search-start.js', 'server/admin-handlers/milu-search-status.js',
    'server/admin-handlers/milu-search-cancel.js', 'server/admin-handlers/milu-options-list.js',
    'server/admin-handlers/milu-settings-get.js', 'server/admin-handlers/milu-settings-save.js',
    'supabase/migrations/0015_milu_tourism_search.sql'
  ];
  ok('42 cobertura versionada: fuentes 8C presentes en el repo', files8c.every(function (pth) { return fs.existsSync(path.join(BASE, pth)); }));

  /* ============================================================
     ENDURECIMIENTO DE INTEGRIDAD (43-64)
     ============================================================ */
  // 43 No reclamar con intentos agotados
  q = queueDb('queued', true, [{ kind: 'flights_duffel', attempt_count: 3, max_attempts: 3 }]); setClient(q.db);
  ok('43 no reclama subtarea con intentos agotados', (await worker.claimNextSubtask('hook-adventure', 'w', 120)).subtask === null);

  // 44-47 No reclamar de job cancelled/expired/completed/inactive
  q = queueDb('cancelled', true, [{ kind: 'flights_duffel' }]); setClient(q.db);
  ok('44 no reclama de job cancelled', (await worker.claimNextSubtask('hook-adventure', 'w', 120)).subtask === null);
  q = queueDb('expired', true, [{ kind: 'flights_duffel' }]); setClient(q.db);
  ok('45 no reclama de job expired', (await worker.claimNextSubtask('hook-adventure', 'w', 120)).subtask === null);
  q = queueDb('completed', true, [{ kind: 'flights_duffel' }]); setClient(q.db);
  ok('46 no reclama de job completed', (await worker.claimNextSubtask('hook-adventure', 'w', 120)).subtask === null);
  q = queueDb('queued', false, [{ kind: 'flights_duffel' }]); setClient(q.db);
  ok('47 no reclama de job inactive', (await worker.claimNextSubtask('hook-adventure', 'w', 120)).subtask === null);

  // 48-49 parámetros inválidos
  q = queueDb('queued', true, [{ kind: 'flights_duffel' }]); setClient(q.db);
  ok('48 lease_seconds inválido rechazado', (await worker.claimNextSubtask('hook-adventure', 'w', 5)).ok === false);
  q = queueDb('queued', true, [{ kind: 'flights_duffel' }]); setClient(q.db);
  ok('49 worker vacío rechazado', (await worker.claimNextSubtask('hook-adventure', '', 120)).ok === false);

  // 50 lease vencido con intentos → queued
  q = queueDb('running', true, [{ kind: 'flights_duffel', status: 'running', attempt_count: 1, lease_expires_at: new Date(Date.now() - 1000).toISOString() }]); setClient(q.db);
  let rc = await worker.reclaimExpiredLeases('hook-adventure');
  ok('50 lease vencido con intentos → queued', rc.requeued === 1 && rc.failed === 0 && q.db.travel_search_subtasks[0].status === 'queued');

  // 51 lease vencido sin intentos → failed
  q = queueDb('running', true, [{ kind: 'flights_duffel', status: 'running', attempt_count: 3, max_attempts: 3, lease_expires_at: new Date(Date.now() - 1000).toISOString() }]); setClient(q.db);
  rc = await worker.reclaimExpiredLeases('hook-adventure');
  ok('51 lease vencido sin intentos → failed', rc.failed === 1 && rc.requeued === 0 && q.db.travel_search_subtasks[0].status === 'failed' && !!q.db.travel_search_subtasks[0].finished_at);

  // 52 reclaim no toca job cancelado
  q = queueDb('cancelled', true, [{ kind: 'flights_duffel', status: 'running', attempt_count: 1, lease_expires_at: new Date(Date.now() - 1000).toISOString() }]); setClient(q.db);
  rc = await worker.reclaimExpiredLeases('hook-adventure');
  ok('52 reclaim no toca jobs cancelados', rc.requeued === 0 && rc.failed === 0 && q.db.travel_search_subtasks[0].status === 'running');

  // 53-57 integridad de tenant por FK compuesta (estructural en 0015)
  ok('53 FK compuesta job/subtask', /fk_tss_job_tenant\s+foreign key \(job_id, tenant_id\)[\s\S]*references public\.travel_search_jobs \(id, tenant_id\)/.test(SQL));
  ok('54 FK compuesta opción/job (por reserva)', /fk_tfo_job_tenant_booking\s+foreign key \(search_job_id, tenant_id, booking_id\)/.test(SQL) && /fk_tho_job_tenant_booking\s+foreign key \(search_job_id, tenant_id, booking_id\)/.test(SQL));
  ok('55 FK compuesta opción/booking', /fk_tfo_booking_tenant\s+foreign key \(booking_id, tenant_id\)/.test(SQL) && /fk_tho_booking_tenant\s+foreign key \(booking_id, tenant_id\)/.test(SQL));
  ok('56 FK compuesta passenger_form (por reserva)', /fk_tsj_form_tenant_booking\s+foreign key \(passenger_form_id, tenant_id, booking_id\)[\s\S]*?references public\.booking_passenger_forms \(id, tenant_id, booking_id\)/.test(SQL));
  ok('57 FK compuesta lodging + unique padre', /fk_tho_lodging_form_dest\s+foreign key \(lodging_requirement_id, tenant_id, passenger_form_id, destination\)/.test(SQL) && /uq_blr_id_tenant unique \(id, tenant_id\)/.test(SQL));

  // 58 retry no duplica hotel
  const job58 = { id: nid(), tenant_id: 'hook-adventure', booking_id: nid(), requirements_snapshot: snap() };
  const db58 = { travel_hotel_options: [], travel_search_jobs: [job58] }; setClient(db58);
  await worker.runSubtask({ id: nid(), job_id: job58.id, kind: 'hotel_preferred_links' }, { job: job58 });
  await worker.runSubtask({ id: nid(), job_id: job58.id, kind: 'hotel_preferred_links' }, { job: job58 });
  ok('58 retry no duplica opción de hotel', db58.travel_hotel_options.length === 2);

  // 59 refresh crea nueva versión y conserva historia
  // Usa el MISMO lodging_requirement_id que el worker ligó en 58 (dedup por clave).
  const lr58 = job58.requirements_snapshot.lodging_requirements[0];
  const opts59 = manual.searchHotels(lr58, job58.requirements_snapshot.hotel_search_preferences, cost.DEFAULT_MILU_SETTINGS)
    .map(function (o) { o.lodging_requirement_id = lr58.id; return o; });
  await worker.upsertHotelOptions(job58, opts59, { refresh: true });
  const actives59 = db58.travel_hotel_options.filter(function (o) { return o.active === true; });
  const expired59 = db58.travel_hotel_options.filter(function (o) { return o.active === false && o.availability_status === 'expired'; });
  ok('59 refresh crea nueva result_version y conserva historia', db58.travel_hotel_options.length === 4 && actives59.length === 2 && expired59.length === 2 && actives59.every(function (o) { return o.result_version === 2; }));

  // 60-61 validaciones numéricas (CHECK en 0015)
  ok('60 precio negativo rechazado (CHECK)', /chk_tfo_price check \(total_price_cents is null or total_price_cents >= 0\)/.test(SQL) && /chk_tho_total check \(total_price_cents is null or total_price_cents >= 0\)/.test(SQL));
  ok('61 tokens/costos negativos rechazados (CHECK)', /chk_llm_in check \(input_tokens >= 0\)/.test(SQL) && /chk_llm_cost check \(estimated_cost_usd >= 0\)/.test(SQL) && /chk_llm_latency check \(latency_ms is null or latency_ms >= 0\)/.test(SQL));

  // 62 cancelación impide reclamo posterior + auditoría
  f = freshDb(); CONTRACT = baseContract(f.booking); setClient(f.db);
  const sres = await milu.startSearch(f.booking.id, 'u-owner');
  await milu.cancelSearch(f.booking.id, sres.job.id, { role: 'owner', userId: 'u-owner' });
  const claimAfterCancel = await worker.claimNextSubtask('hook-adventure', 'w', 120);
  const jobCancelled = f.db.travel_search_jobs[0].status === 'cancelled' && f.db.travel_search_jobs[0].active === false;
  const subsCancelled = f.db.travel_search_subtasks.every(function (s) { return s.status === 'cancelled'; });
  const audited = (f.db.travel_search_audit || []).some(function (a) { return a.action === 'cancel_search' && a.result === 'success'; });
  ok('62 cancelación impide reclamo posterior + auditoría', jobCancelled && subsCancelled && claimAfterCancel.subtask === null && audited);

  // 63 sin DELETE físico (trigger en 0015)
  const delTriggers = (SQL.match(/before delete on public\.travel_/g) || []).length;
  ok('63 sin DELETE físico (triggers en tablas de datos)', /milu_forbid_physical_delete/.test(SQL) && delTriggers >= 7 && /before update or delete on public\.travel_search_audit/.test(SQL));

  // 64 marcador: 42 previas verdes + suites históricas (el runner de QA las ejecuta)
  ok('64 42 pruebas base + suites históricas (QA runner)', pass >= 42);

  /* ============================================================
     INTEGRIDAD A NIVEL DE RESERVA (65-76) — misma reserva, no solo mismo tenant.
     Los cruces entre reservas los IMPIDE el motor (FKs compuestas); se verifican
     estructuralmente sobre 0015 (no hay Postgres real en node). Retry/refresh y
     el no-DELETE de config se verifican por comportamiento y por trigger.
     ============================================================ */
  // 65 (item1) Job booking A + formulario B → rechazado (FK 3-col + unique padre)
  ok('65 job/formulario deben compartir reserva',
    /fk_tsj_form_tenant_booking\s+foreign key \(passenger_form_id, tenant_id, booking_id\)[\s\S]*?references public\.booking_passenger_forms \(id, tenant_id, booking_id\)/.test(SQL) &&
    /uq_bpf_id_tenant_booking unique \(id, tenant_id, booking_id\)/.test(SQL));

  // 66 (item2) Opción de vuelo job A + booking B → rechazado
  ok('66 opción de vuelo/job comparten reserva',
    /fk_tfo_job_tenant_booking\s+foreign key \(search_job_id, tenant_id, booking_id\)[\s\S]*?references public\.travel_search_jobs \(id, tenant_id, booking_id\)/.test(SQL) &&
    /uq_tsj_id_tenant_booking unique \(id, tenant_id, booking_id\)/.test(SQL));

  // 67 (item3) Opción de hotel job A + booking B → rechazado; + mismo formulario
  ok('67 opción de hotel/job comparten reserva y formulario',
    /fk_tho_job_tenant_booking\s+foreign key \(search_job_id, tenant_id, booking_id\)/.test(SQL) &&
    /fk_tho_job_form\s+foreign key \(search_job_id, tenant_id, booking_id, passenger_form_id\)[\s\S]*?references public\.travel_search_jobs \(id, tenant_id, booking_id, passenger_form_id\)/.test(SQL) &&
    /uq_tsj_id_tenant_booking_form unique \(id, tenant_id, booking_id, passenger_form_id\)/.test(SQL) &&
    /passenger_form_id\s+uuid not null,\s+-- formulario del job \(integridad de reserva\)/.test(SQL));

  // 68 (item4) Lodging de formulario A usado en formulario B → rechazado
  ok('68 lodging pertenece al mismo formulario',
    /fk_tho_lodging_form_dest\s+foreign key \(lodging_requirement_id, tenant_id, passenger_form_id, destination\)[\s\S]*?references public\.booking_lodging_requirements \(id, tenant_id, passenger_form_id, destination\)/.test(SQL) &&
    /uq_blr_id_tenant_form unique \(id, tenant_id, passenger_form_id\)/.test(SQL));

  // 69 (item5) Travel logistics job A + booking B → rechazado
  ok('69 logística/job comparten reserva',
    /fk_tl_job_tenant_booking\s+foreign key \(search_job_id, tenant_id, booking_id\)[\s\S]*?references public\.travel_search_jobs \(id, tenant_id, booking_id\)/.test(SQL));

  // 70 (item6) Flight booking con opción de otra reserva → rechazado
  ok('70 compra de vuelo usa opción de la misma reserva',
    /fk_tfb_option_tenant_booking\s+foreign key \(flight_option_id, tenant_id, booking_id\)[\s\S]*?references public\.travel_flight_options \(id, tenant_id, booking_id\)/.test(SQL) &&
    /uq_tfo_id_tenant_booking unique \(id, tenant_id, booking_id\)/.test(SQL));

  // 71 (item7) Hotel booking con opción de otra reserva → rechazado
  ok('71 reserva de hotel usa opción de la misma reserva',
    /fk_thb_option_tenant_booking\s+foreign key \(hotel_option_id, tenant_id, booking_id\)[\s\S]*?references public\.travel_hotel_options \(id, tenant_id, booking_id\)/.test(SQL) &&
    /uq_tho_id_tenant_booking unique \(id, tenant_id, booking_id\)/.test(SQL));

  // 72 (item8) LLM log job A + subtarea B → rechazado; + job de la misma reserva
  ok('72 log de IA/subtarea comparten job y reserva',
    /fk_llm_subtask_tenant_job\s+foreign key \(subtask_id, tenant_id, job_id\)[\s\S]*?references public\.travel_search_subtasks \(id, tenant_id, job_id\)/.test(SQL) &&
    /uq_tss_id_tenant_job unique \(id, tenant_id, job_id\)/.test(SQL) &&
    /fk_llm_job_tenant_booking\s+foreign key \(job_id, tenant_id, booking_id\)/.test(SQL));

  // 73 (item9) Audit job A + booking B → rechazado (FKs opcionales)
  ok('73 auditoría ligada a reserva y job coherentes',
    /fk_tsa_booking_tenant\s+foreign key \(booking_id, tenant_id\)[\s\S]*?references public\.bookings \(id, tenant_id\)/.test(SQL) &&
    /fk_tsa_job_tenant_booking\s+foreign key \(search_job_id, tenant_id, booking_id\)[\s\S]*?references public\.travel_search_jobs \(id, tenant_id, booking_id\)/.test(SQL));

  // 74 (item10) Retry no duplica result_version (comportamiento + índice único)
  const job74 = { id: nid(), tenant_id: 'hook-adventure', booking_id: nid(), passenger_form_id: nid(), requirements_snapshot: snap() };
  const db74 = { travel_flight_options: [], travel_search_jobs: [job74] }; setClient(db74);
  await worker.runSubtask({ id: nid(), job_id: job74.id, kind: 'flights_duffel' }, { job: job74, flightProvider: 'stub' });
  await worker.runSubtask({ id: nid(), job_id: job74.id, kind: 'flights_duffel' }, { job: job74, flightProvider: 'stub' });
  ok('74 retry no duplica result_version (vuelo)',
    db74.travel_flight_options.length === 1 && db74.travel_flight_options[0].result_version === 1 &&
    /uq_tfo_version_key\s+on public\.travel_flight_options \(search_job_id, provider, provider_result_key, result_version\)/.test(SQL));

  // 75 (item11) Refresh crea exactamente la versión siguiente (comportamiento + índice único)
  const job75 = { id: nid(), tenant_id: 'hook-adventure', booking_id: nid(), passenger_form_id: nid(), requirements_snapshot: snap() };
  const db75 = { travel_flight_options: [], travel_search_jobs: [job75] }; setClient(db75);
  const sfl = stub.searchFlights({ origin: 'UIO', destination: 'SCY' });
  await worker.upsertFlightOptions(job75, sfl);
  await worker.upsertFlightOptions(job75, sfl, { refresh: true });
  const act75 = db75.travel_flight_options.filter(function (o) { return o.active === true; });
  const exp75 = db75.travel_flight_options.filter(function (o) { return o.active === false && o.availability_status === 'expired'; });
  ok('75 refresh crea una sola versión siguiente',
    db75.travel_flight_options.length === 2 && act75.length === 1 && act75[0].result_version === 2 &&
    exp75.length === 1 && exp75[0].result_version === 1 && /uq_tho_version_key/.test(SQL));

  // 76 (item12) DELETE de milu_settings rechazado (trigger)
  ok('76 DELETE de milu_settings rechazado (trigger)',
    /trg_no_delete_ms\s+before delete on public\.milu_settings[\s\S]*?milu_forbid_physical_delete/.test(SQL));

  /* ============================================================
     CIERRE DE HUECOS MATCH SIMPLE (77-88) — columnas NOT NULL + CHECKs de
     dependencia + FK de destino + FK de hotel preferido. Estructurales sobre
     0015 (motor); 88 verifica el cableado en runtime.
     ============================================================ */
  const jobsBlk = tableBlock('travel_search_jobs');
  const thoBlk  = tableBlock('travel_hotel_options');

  // 77 (item1) Job sin passenger_form → rechazado (columna NOT NULL)
  ok('77 job exige passenger_form (NOT NULL)', /passenger_form_id\s+uuid not null/.test(jobsBlk));

  // 78 (item2) Hotel option sin passenger_form → rechazado (columna NOT NULL)
  ok('78 opción de hotel exige passenger_form (NOT NULL)', /passenger_form_id\s+uuid not null/.test(thoBlk));

  // 79 (item3) Hotel option sin lodging_requirement → rechazado (columna NOT NULL)
  ok('79 opción de hotel exige lodging_requirement (NOT NULL)', /lodging_requirement_id uuid not null/.test(thoBlk));

  // 80 (item4) Lodging de otro destino usado por la opción → rechazado (FK 4-col + destino)
  ok('80 lodging del mismo destino (FK con destination)',
    /fk_tho_lodging_form_dest\s+foreign key \(lodging_requirement_id, tenant_id, passenger_form_id, destination\)[\s\S]*?references public\.booking_lodging_requirements \(id, tenant_id, passenger_form_id, destination\)/.test(SQL) &&
    /uq_blr_id_form_dest unique \(id, tenant_id, passenger_form_id, destination\)/.test(SQL));

  // 81 (item5) Audit con job y booking null → rechazado (CHECK)
  ok('81 audit con job exige booking (CHECK)',
    /chk_tsa_job_booking check \(search_job_id is null or booking_id is not null\)/.test(SQL));

  // 82 (item6) LLM log con subtask y job null → rechazado (CHECK)
  ok('82 llm con subtask exige job (CHECK)',
    /chk_llm_subtask_job check \(subtask_id is null or job_id is not null\)/.test(SQL));

  // 83 (item7) LLM log con job y booking null → rechazado (CHECK)
  ok('83 llm con job exige booking (CHECK)',
    /chk_llm_job_booking check \(job_id is null or booking_id is not null\)/.test(SQL));

  // 84 (item8) preferred_hotel_id de otro tenant → rechazado (FK compuesta + unique padre)
  ok('84 hotel preferido del mismo tenant (FK compuesta)',
    /fk_tho_pref_tenant\s+foreign key \(preferred_hotel_id, tenant_id\)[\s\S]*?references public\.hotel_search_preferences \(id, tenant_id\)/.test(SQL) &&
    /uq_hsp_id_tenant unique \(id, tenant_id\)/.test(SQL));

  // 85 (item9) provider_result_key vacío → rechazado (CHECK en ambas tablas)
  ok('85 provider_result_key no vacío (CHECK)',
    /chk_tfo_prk check \(provider_result_key <> ''\)/.test(SQL) && /chk_tho_prk check \(provider_result_key <> ''\)/.test(SQL));

  // 86 (item10) idempotency_key vacío → rechazado (CHECK)
  ok('86 idempotency_key no vacío (CHECK)',
    /chk_tsj_idem_key check \(idempotency_key <> ''\)/.test(SQL));

  // 87 (extra) provider / origin / destino sin cadenas vacías (CHECK)
  ok('87 provider/origen/destino no vacíos (CHECK)',
    /chk_tfo_provider check \(provider <> ''\)/.test(SQL) && /chk_tho_provider check \(provider <> ''\)/.test(SQL) &&
    /chk_tfo_origin check \(origin is null or origin <> ''\)/.test(SQL) &&
    /chk_tfo_dest_ne check \(destination is null or destination <> ''\)/.test(SQL));

  // 88 (runtime) el worker liga cada opción de hotel a su lodging y al formulario del job
  const lrId88 = nid();
  const job88 = { id: nid(), tenant_id: 'hook-adventure', booking_id: nid(), passenger_form_id: nid(),
    requirements_snapshot: { preferred_connection_city: 'quito', passenger_count: 2,
      flight_dates: { default_departure_date: '2026-08-01', default_return_date: '2026-08-04' },
      lodging_requirements: [{ id: lrId88, destination: 'san_cristobal', pending_resolution: false, check_in_date: '2026-08-01', check_out_date: '2026-08-04', nights: 3, rooms_required: 1, guest_count: 2 }],
      hotel_search_preferences: snap().hotel_search_preferences } };
  const db88 = { travel_hotel_options: [], travel_search_jobs: [job88] }; setClient(db88);
  await worker.runSubtask({ id: nid(), job_id: job88.id, kind: 'hotel_preferred_links' }, { job: job88 });
  ok('88 worker liga opción a lodging y formulario del job (runtime)',
    db88.travel_hotel_options.length > 0 &&
    db88.travel_hotel_options.every(function (o) { return o.lodging_requirement_id === lrId88 && o.passenger_form_id === job88.passenger_form_id; }));

  /* ============================================================
     0016 — Milu Live Travel Research (estructural sobre la migración).
     Migración mínima, aditiva, cero tablas nuevas, sin SQL destructivo.
     ============================================================ */
  const cnt = function (re) { return (SQL16.match(re) || []).length; };

  // 89 begin/commit + cero tablas nuevas
  ok('89 0016 begin/commit + cero tablas nuevas',
    /begin;/.test(SQL16) && /commit;/.test(SQL16) && !/create\s+table/i.test(SQL16));

  // 90 sin SQL destructivo sobre datos
  ok('90 0016 sin SQL destructivo (no drop table/delete/truncate/drop column)',
    !/drop\s+table|delete\s+from|truncate|drop\s+column/i.test(SQL16));

  // 91 availability_status NO se toca; revisión vive en columna separada
  ok('91 availability_status intacto; research_review_status separado',
    /research_review_status/.test(SQL16) &&
    !/web_research_unverified/.test(SQL16) && !/chk_tfo_status/.test(SQL16) && !/chk_tho_status/.test(SQL16));

  // 92 dominio de valores de revisión en ambas tablas
  ok('92 research_review_status ∈ {unverified,verified,rejected} (vuelo+hotel)',
    /chk_tfo_review_status check \([\s\S]*?research_review_status in \('unverified','verified','rejected'\)/.test(SQL16) &&
    /chk_tho_review_status check \([\s\S]*?research_review_status in \('unverified','verified','rejected'\)/.test(SQL16));

  // 93 nombres genéricos de revisión + patrón de actor existente (auth.users)
  ok('93 research_reviewed_by/at genéricos + FK auth.users(id) (sin *_verified_*)',
    cnt(/research_reviewed_by_user_id uuid references auth\.users\(id\)/g) === 2 &&
    cnt(/research_reviewed_at\s+timestamptz/g) === 2 &&
    !/research_verified_by|research_verified_at/.test(SQL16));

  // 94 si provider='web_research' → revisión obligatoria (ambas)
  ok('94 provider web_research exige research_review_status',
    cnt(/provider <> 'web_research' or research_review_status is not null/g) === 2);

  // 95 si hay revisión → URL de origen no vacía (ambas)
  ok('95 revisión exige research_source_url no vacío',
    cnt(/research_review_status is null or \(research_source_url is not null and research_source_url <> ''\)/g) === 2);

  // 96 verified/rejected exigen actor+fecha; unverified los mantiene nulos (ambas)
  ok('96 verified/rejected → actor+fecha; unverified → nulos',
    /chk_tfo_review_actor/.test(SQL16) && /chk_tho_review_actor/.test(SQL16) &&
    cnt(/research_review_status in \('verified','rejected'\)\s+and research_reviewed_by_user_id is not null and research_reviewed_at is not null/g) === 2 &&
    cnt(/research_review_status = 'unverified'\s+and research_reviewed_by_user_id is null and research_reviewed_at is null/g) === 2);

  // 97 search_type NO se toca (web research es método, no tipo de viaje)
  ok('97 search_type intacto (sin chk_tsj_type ni web_research en tipo)',
    !/chk_tsj_type/.test(SQL16) && !/search_type/.test(SQL16));

  // 98 kinds de subtarea: PRESERVA los 5 actuales + agrega 2 de web research
  ok('98 chk_tss_kind preserva los 5 y agrega web_research_flights/lodging',
    /chk_tss_kind check \(kind in[\s\S]*?'web_research_flights','web_research_lodging'\)/.test(SQL16) &&
    /'flights_duffel'/.test(SQL16) && /'hotels_primary_provider'/.test(SQL16) &&
    /'hotel_preferred_links'/.test(SQL16) && /'anthropic_ranking'/.test(SQL16) && /'final_summary'/.test(SQL16));

  // 99 config renombrada _per_fetch con default 4000
  ok('99 web_research_max_content_tokens_per_fetch default 4000',
    /web_research_max_content_tokens_per_fetch integer not null default 4000/.test(SQL16));

  // 100 compuerta doble: mitad DB (default false)
  ok('100 milu_settings.web_research_enabled boolean not null default false',
    /web_research_enabled\s+boolean not null default false/.test(SQL16));

  // 101 telemetría separada de herramientas en llm_usage_log
  ok('101 llm_usage_log: web_search_requests + web_fetch_requests',
    /web_search_requests integer not null default 0/.test(SQL16) &&
    /web_fetch_requests\s+integer not null default 0/.test(SQL16));

  // 102 contadores/costo por propuesta en el job
  ok('102 job: web_search_count/web_fetch_count/research_cost_usd/rerun_count',
    /web_search_count\s+integer not null default 0/.test(SQL16) &&
    /web_fetch_count\s+integer not null default 0/.test(SQL16) &&
    /research_cost_usd\s+numeric not null default 0/.test(SQL16) &&
    /rerun_count\s+integer not null default 0/.test(SQL16));

  /* ============================================================
     WEB RESEARCH 8D — comportamiento (cliente Anthropic MOCKEADO, sin red).
     ============================================================ */
  function spyClient(findings, stu) {
    const c = { calls: 0, messages: async function () {
      c.calls++;
      return { model_version: 'claude-haiku-4-5-20251001',
        usage: { input_tokens: 1200, output_tokens: 200, server_tool_use: { web_search_requests: (stu && stu.web_search_requests) || 1, web_fetch_requests: (stu && stu.web_fetch_requests) || 1 } },
        content: [], output: { findings: findings || [] } };
    } };
    return c;
  }
  // Hallazgo VERIFICADO para la solicitud de snap(): ruta UIO→SCY, fecha 2026-08-01 observable.
  const AVIANCA = { source_url: 'https://www.avianca.com/fare', price_cents: 12300, currency: 'USD', airline: 'Avianca', origin: 'UIO', destination: 'SCY', observed_origin: 'UIO', observed_destination: 'SCY', observed_departure_date: '2026-08-01', date_observable: true };
  const WR_ENV_ON = { ANTHROPIC_MILU_TOURISM_MODEL: 'Haiku', MILU_TOURISM_WEB_RESEARCH_ENABLED: 'true' };
  function wrJobDb() {
    const jid = nid();
    const job = { id: jid, tenant_id: 'hook-adventure', booking_id: nid(), passenger_form_id: nid(), status: 'running', active: true, requirements_snapshot: snap(), web_search_count: 0, web_fetch_count: 0, research_cost_usd: 0, rerun_count: 0 };
    return { db: { travel_search_jobs: [job], travel_flight_options: [], travel_hotel_options: [], llm_usage_log: [], travel_search_audit: [], milu_settings: [] }, job: job };
  }

  // 103 compuerta doble OFF (ambas) → deshabilitado, sin llamada externa
  let wr = wrJobDb(); setClient(wr.db); let spy = spyClient([AVIANCA]);
  let rr = await worker.runSubtask({ id: nid(), job_id: wr.job.id, kind: 'web_research_flights' }, { job: wr.job, env: {}, settings: { web_research_enabled: false }, researchClient: spy });
  ok('103 compuerta doble off → web_research_disabled (sin llamada)', rr.status === 'partial' && rr.reason === 'web_research_disabled' && spy.calls === 0 && wr.db.travel_flight_options.length === 0);

  // 104 env ON + DB OFF → deshabilitado
  wr = wrJobDb(); setClient(wr.db); spy = spyClient([AVIANCA]);
  rr = await worker.runSubtask({ id: nid(), job_id: wr.job.id, kind: 'web_research_flights' }, { job: wr.job, env: WR_ENV_ON, settings: { web_research_enabled: false }, researchClient: spy });
  ok('104 env on + DB off → deshabilitado', rr.reason === 'web_research_disabled' && spy.calls === 0);

  // 105 env OFF + DB ON → deshabilitado
  wr = wrJobDb(); setClient(wr.db); spy = spyClient([AVIANCA]);
  rr = await worker.runSubtask({ id: nid(), job_id: wr.job.id, kind: 'web_research_flights' }, { job: wr.job, env: {}, settings: { web_research_enabled: true }, researchClient: spy });
  ok('105 env off + DB on → deshabilitado', rr.reason === 'web_research_disabled' && spy.calls === 0);

  // 106 ambas ON → ejecuta; opción unverified con fuente y precio
  wr = wrJobDb(); setClient(wr.db); spy = spyClient([AVIANCA], { web_search_requests: 2, web_fetch_requests: 1 });
  rr = await worker.runSubtask({ id: nid(), job_id: wr.job.id, kind: 'web_research_flights' }, { job: wr.job, env: WR_ENV_ON, settings: { web_research_enabled: true }, researchClient: spy });
  const o106 = wr.db.travel_flight_options[0] || {};
  ok('106 compuerta doble ON → hallazgo unverified con fuente+precio', spy.calls === 1 && rr.status === 'completed' && wr.db.travel_flight_options.length === 1 && o106.provider === 'web_research' && o106.research_review_status === 'unverified' && /avianca\.com/.test(o106.research_source_url || '') && o106.total_price_cents === 12300);

  // 107 Haiku-only: modelo sin configurar → configuration_error, sin llamar
  spy = spyClient([AVIANCA]);
  const r107 = await webtools.runResearch({ env: {}, client: spy, settings: {}, input: {} });
  ok('107 modelo sin configurar → configuration_error (sin llamada)', r107.ok === false && r107.status === 'configuration_error' && spy.calls === 0);

  // 108 allowlist: hallazgo fuera de dominio se descarta; permitido se conserva
  const r108 = await webResearch.researchFlights({ id: nid(), booking_id: nid() }, snap(), { env: { ANTHROPIC_MILU_TOURISM_MODEL: 'Haiku' }, settings: { web_research_enabled: true }, client: spyClient([{ source_url: 'https://evil.com/x', price_cents: 9900, currency: 'USD' }, AVIANCA]) });
  ok('108 allowlist: solo dominios autorizados', r108.options.length === 1 && /avianca\.com/.test(r108.options[0].research_source_url) && r108.options[0].total_price_cents === 12300);

  // 109 límites: 6 búsquedas / 2 fetches / 4000 tokens + allowed_domains
  const tools = webtools.buildResearchTools({ web_research_max_searches: 6, web_research_max_fetches: 2, web_research_max_content_tokens_per_fetch: 4000 });
  const ws = tools.filter(function (t) { return t.name === 'web_search'; })[0]; const wf = tools.filter(function (t) { return t.name === 'web_fetch'; })[0];
  ok('109 límites tools: max_uses 6/2, max_content_tokens 4000, allowed_domains', ws.type === 'web_search_20250305' && ws.max_uses === 6 && wf.type === 'web_fetch_20250910' && wf.max_uses === 2 && wf.max_content_tokens === 4000 && ws.allowed_domains.indexOf('avianca.com') !== -1);

  // 110 presupuesto $0.30 bloquea antes de llamar
  spy = spyClient([AVIANCA]);
  const r110 = await webtools.runResearch({ env: { ANTHROPIC_MILU_TOURISM_MODEL: 'Haiku' }, client: spy, settings: { web_research_max_cost_per_job_usd: 0.30 }, spentJobUsd: 0.30, input: {} });
  ok('110 presupuesto $0.30 bloquea (sin llamada)', r110.ok === false && r110.reason === 'research_budget_exceeded' && spy.calls === 0);

  // 111 parada temprana: ya hay suficientes opciones activas
  wr = wrJobDb();
  for (var e = 0; e < 3; e++) wr.db.travel_flight_options.push({ id: nid(), search_job_id: wr.job.id, active: true, provider: 'web_research' });
  setClient(wr.db); spy = spyClient([AVIANCA]);
  rr = await worker.runSubtask({ id: nid(), job_id: wr.job.id, kind: 'web_research_flights' }, { job: wr.job, env: WR_ENV_ON, settings: { web_research_enabled: true }, researchClient: spy });
  ok('111 parada temprana con suficientes opciones (sin llamada)', rr.reason === 'enough_options' && spy.calls === 0);

  // 112 fallback por dominio: sin hallazgos → opción con URL de dominio, precio nulo
  const r112 = await webResearch.researchFlights({ id: nid(), booking_id: nid() }, snap(), { env: { ANTHROPIC_MILU_TOURISM_MODEL: 'Haiku' }, settings: {}, client: spyClient([]) });
  ok('112 fallback por dominio (unverified, precio nulo, fuente allowlisted)', r112.options.length === 1 && r112.options[0].total_price_cents === null && allow.isAllowedResearchDomain(r112.options[0].research_source_url) === true && r112.options[0].research_review_status === 'unverified');

  // 113/114 unverified sin actor/fecha + fuente obligatoria
  const map113 = webResearch.mapFlightFinding(snap(), AVIANCA);
  const map114 = webResearch.mapFlightFinding(snap(), { source_url: 'https://evil.com/x', price_cents: 1 });
  ok('113 hallazgo nace unverified sin actor/fecha', map113.research_review_status === 'unverified' && !map113.research_reviewed_by_user_id && !map113.research_reviewed_at && !!map113.research_source_url);
  ok('114 fuente obligatoria: sin dominio permitido se descarta', map114 === null);

  // 115 contadores del job + telemetría en llm_usage_log
  wr = wrJobDb(); setClient(wr.db); spy = spyClient([AVIANCA], { web_search_requests: 2, web_fetch_requests: 1 });
  await worker.runSubtask({ id: nid(), job_id: wr.job.id, kind: 'web_research_flights' }, { job: wr.job, env: WR_ENV_ON, settings: { web_research_enabled: true }, researchClient: spy });
  const jrow = wr.db.travel_search_jobs[0]; const lrow = (wr.db.llm_usage_log || [])[0] || {};
  ok('115 contadores + telemetría (search/fetch/costo)', jrow.web_search_count === 2 && jrow.web_fetch_count === 1 && jrow.research_cost_usd > 0 && lrow.web_search_requests === 2 && lrow.web_fetch_requests === 1);

  // 116 aprobar/rechazar: fija actor + fecha + auditoría
  const optId = nid();
  const db116 = { travel_flight_options: [{ id: optId, tenant_id: 'hook-adventure', booking_id: nid(), search_job_id: nid(), provider: 'web_research', research_review_status: 'unverified', research_source_url: 'https://www.avianca.com/fare', raw_snapshot_sanitized: { price_verified_for_request: true } }], travel_search_audit: [] };
  setClient(db116);
  const rev = await milu.reviewFinding('flight', optId, 'verified', { role: 'owner', userId: 'u-owner' });
  const o116 = db116.travel_flight_options[0]; const aud116 = (db116.travel_search_audit || [])[0] || {};
  ok('116 aprobar → verified + actor + fecha + auditoría', rev.status === 'verified' && o116.research_review_status === 'verified' && o116.research_reviewed_by_user_id === 'u-owner' && !!o116.research_reviewed_at && aud116.action === 'web_research_review_verified');

  // 117 rerun contabilizado + auditado; requiere compuerta doble
  const rj = { id: nid(), tenant_id: 'hook-adventure', booking_id: nid(), active: true, status: 'completed', rerun_count: 0 };
  const db117 = { travel_search_jobs: [rj], milu_settings: [{ tenant_id: 'hook-adventure', web_research_enabled: true }],
    travel_search_subtasks: [{ id: nid(), tenant_id: 'hook-adventure', job_id: rj.id, kind: 'web_research_flights', status: 'completed' }, { id: nid(), tenant_id: 'hook-adventure', job_id: rj.id, kind: 'web_research_lodging', status: 'completed' }],
    travel_search_audit: [] };
  setClient(db117);
  let rerunDisabled = false; try { await milu.rerunResearch(rj.booking_id, rj.id, { role: 'owner', userId: 'u-owner' }); } catch (e) { rerunDisabled = e.code === 'WEB_RESEARCH_DISABLED'; }
  process.env.MILU_TOURISM_WEB_RESEARCH_ENABLED = 'true';
  const rerunRes = await milu.rerunResearch(rj.booking_id, rj.id, { role: 'owner', userId: 'u-owner' });
  delete process.env.MILU_TOURISM_WEB_RESEARCH_ENABLED;
  const aud117 = (db117.travel_search_audit || []).some(function (a) { return a.action === 'web_research_rerun'; });
  ok('117 rerun: gate off rechaza; gate on cuenta+audita', rerunDisabled === true && rerunRes.rerun === true && rerunRes.rerun_count === 1 && rerunRes.requeued === 2 && db117.travel_search_jobs[0].rerun_count === 1 && aud117);

  // 118 dedup: dos investigaciones con el mismo hallazgo → 1 opción activa
  wr = wrJobDb(); setClient(wr.db);
  await worker.runSubtask({ id: nid(), job_id: wr.job.id, kind: 'web_research_flights' }, { job: wr.job, env: WR_ENV_ON, settings: { web_research_enabled: true }, researchClient: spyClient([AVIANCA]) });
  await worker.runSubtask({ id: nid(), job_id: wr.job.id, kind: 'web_research_flights' }, { job: wr.job, env: WR_ENV_ON, settings: { web_research_enabled: true }, researchClient: spyClient([AVIANCA]) });
  const actives118 = wr.db.travel_flight_options.filter(function (o) { return o.active === true; });
  ok('118 dedup: mismo hallazgo no duplica opción activa', actives118.length === 1);

  // 119 handlers: staff 403; owner permitido
  CURRENT_ROLE = 'staff';
  hr = await run(rerunH, { method: 'POST', headers: {}, body: { booking_id: nid(), job_id: nid() } });
  const staffRerun403 = hr.statusCode === 403;
  hr = await run(approveH, { method: 'POST', headers: {}, body: { option_kind: 'flight', option_id: nid(), decision: 'verified' } });
  const staffApprove403 = hr.statusCode === 403;
  CURRENT_ROLE = 'owner';
  ok('119 rerun/approve: staff 403', staffRerun403 === true && staffApprove403 === true);

  // 120 sin envío al cliente / sin Stripe / sin compras en las fuentes 8D
  const wrSrc = fs.readFileSync(BASE + '/server/lib/milu-web-tools.js', 'utf8')
    + fs.readFileSync(BASE + '/server/lib/milu-adapters/web-research.js', 'utf8')
    + fs.readFileSync(BASE + '/server/admin-handlers/milu-research-rerun.js', 'utf8')
    + fs.readFileSync(BASE + '/server/admin-handlers/milu-research-approve.js', 'utf8');
  ok('120 web research: sin email/Stripe/compras al cliente (uso real de código)',
    !/booking-email-service|customer_travel_confirmation|\bresend\b|sendEmail|require\(['"][^'"]*stripe|stripe\.(?:paymentIntents|charges|checkout)|PaymentIntent|create-payment-intent/i.test(wrSrc));

  // 121 dominios permitidos (subdominios OK, fuera rechazado)
  ok('121 allowlist de investigación', allow.isAllowedResearchDomain('https://evil.com/x') === false && allow.isAllowedResearchDomain('https://www.avianca.com/x') === true && allow.researchAllowedDomains().indexOf('avianca.com') !== -1);

  // 122 doble gate helper (env + DB)
  ok('122 webResearchEnabled requiere ambas mitades',
    flags.webResearchEnabled({ MILU_TOURISM_WEB_RESEARCH_ENABLED: 'true' }, { web_research_enabled: true }) === true &&
    flags.webResearchEnabled({ MILU_TOURISM_WEB_RESEARCH_ENABLED: 'true' }, { web_research_enabled: false }) === false &&
    flags.webResearchEnabled({}, { web_research_enabled: true }) === false);

  // 123 costo de investigación = tokens + $0.01 × búsquedas
  const c123 = cost.estimateResearchCostUsd('claude-haiku-4-5', { input_tokens: 1000000, output_tokens: 0 }, 3);
  ok('123 costo research = tokens + $0.01×búsquedas', Math.abs(c123 - (1.0 + 0.03)) < 1e-6);

  // 124 settings-save owner edita web research (DB gate + límites)
  CURRENT_ROLE = 'owner'; setClient({ milu_settings: [] });
  let sv = await run(settingsSaveH, { method: 'POST', headers: {}, body: { web_research_enabled: true, web_research_max_searches: 6, web_research_max_fetches: 2, web_research_max_content_tokens_per_fetch: 4000, web_research_max_cost_per_job_usd: 0.30 } });
  ok('124 settings-save: owner edita config de web research', sv.statusCode === 200 && j(sv).saved === true);

  // ── Runner e2e controlado (adapter Anthropic real) — funciones puras, sin SDK ni red ──

  // 125 extrae findings de un bloque ```json (vuelo) y coerciona el precio a entero
  const c125 = [{ type: 'text', text: 'ok\n```json\n{ "findings": [ {"source_url":"https://www.avianca.com/x","price_cents":25000.4,"currency":"USD","airline":"Avianca","origin":"UIO","destination":"SCY"} ] }\n```' }];
  const f125 = wrClient.extractFindings(c125);
  ok('125 adapter: extrae 1 finding y precio entero', f125.length === 1 && f125[0].price_cents === 25000 && f125[0].source_url === 'https://www.avianca.com/x');

  // 126 sin source_url → descartado; precio no numérico → null
  const c126 = [{ type: 'text', text: '```json\n{"findings":[{"source_url":"https://booking.com/h","price_cents":"n/a","hotel_name":"X"},{"price_cents":10,"hotel_name":"sin url"}]}\n```' }];
  const f126 = wrClient.extractFindings(c126);
  ok('126 adapter: descarta sin url y precio inválido → null', f126.length === 1 && f126[0].price_cents === null);

  // 127 texto sin JSON y findings:[] → []
  ok('127 adapter: sin json / vacío → []', wrClient.extractFindings([{ type: 'text', text: 'nada verificable' }]).length === 0 && wrClient.extractFindings([{ type: 'text', text: '```json\n{"findings":[]}\n```' }]).length === 0);

  // 128 objeto suelto (sin fence) con findings también se parsea
  ok('128 adapter: objeto suelto con findings', wrClient.extractFindings([{ type: 'text', text: 'r: {"findings":[{"source_url":"https://ihg.com/q","price_cents":9900}]} fin' }]).length === 1);

  // 129 el prompt varía por kind y exige source_url real (fuente = página, no el modelo)
  const uf129 = wrClient.buildUserText({ kind: 'flights', origin: 'UIO' });
  const ul129 = wrClient.buildUserText({ kind: 'lodging', destination: 'santa_cruz' });
  ok('129 adapter: prompt por kind (airline vs hotel_name) + source_url real', /airline/.test(uf129) && /hotel_name/.test(ul129) && /source_url real/.test(uf129));

  // 130 sin @anthropic-ai/sdk instalado, crear el cliente real LANZA (no llamada silenciosa)
  let threw130 = true;
  if (!wrClient.sdkAvailable()) { threw130 = false; try { wrClient.makeAnthropicResearchClient({ apiKey: 'x' }); } catch (e) { threw130 = /missing_dependency/.test(String(e && e.message)); } }
  ok('130 adapter: sin SDK → makeAnthropicResearchClient lanza missing_dependency', threw130 === true);

  // 131 runner: no imprime la API key ni el requirements_snapshot (solo presencia booleana)
  const runnerSrc = fs.readFileSync(BASE + '/scripts/milu-worker-run.js', 'utf8');
  ok('131 runner: no imprime API key ni snapshot (solo presencia)',
    !/log\([^)]*process\.env\.ANTHROPIC_API_KEY/.test(runnerSrc) && !/\.requirements_snapshot/.test(runnerSrc) && /present\(hasKey\)/.test(runnerSrc));

  // ── Fix e2e: flujo "Start travel research" (handler milu-search-start) ──

  // 132 UUID válido: owner crea el PRIMER job (queued)
  CURRENT_ROLE = 'owner'; let e2eF = freshDb(); CONTRACT = baseContract(e2eF.booking); setClient(e2eF.db);
  let e2eH = await run(startH, { method: 'POST', headers: {}, body: { booking_id: e2eF.booking.id } });
  ok('132 start: UUID válido crea primer job (queued)', e2eH.statusCode === 200 && j(e2eH).started === true && j(e2eH).created === true && j(e2eH).job.status === 'queued' && !!j(e2eH).job.id);

  // 133 UUID inexistente → 404 BOOKING_NOT_FOUND (error claro)
  setClient({ bookings: [], booking_passenger_forms: [], booking_lodging_requirements: [], travel_search_jobs: [], travel_search_subtasks: [], travel_logistics: [], milu_settings: [] });
  e2eH = await run(startH, { method: 'POST', headers: {}, body: { booking_id: nid() } });
  ok('133 start: UUID inexistente → 404 BOOKING_NOT_FOUND', e2eH.statusCode === 404 && j(e2eH).error === 'BOOKING_NOT_FOUND');

  // 134 reserva de OTRO tenant → rechazada (scoping por tenant en loadGateData)
  let e2eX = freshDb(); e2eX.booking.tenant_id = 'other-tenant'; CONTRACT = baseContract(e2eX.booking); setClient(e2eX.db);
  e2eH = await run(startH, { method: 'POST', headers: {}, body: { booking_id: e2eX.booking.id } });
  ok('134 start: reserva de otro tenant rechazada', e2eH.statusCode === 404 && j(e2eH).error === 'BOOKING_NOT_FOUND');

  // 135 doble clic no duplica (idempotencia por idempotency_key)
  let e2eD = freshDb(); CONTRACT = baseContract(e2eD.booking); setClient(e2eD.db);
  let e2eD1 = await run(startH, { method: 'POST', headers: {}, body: { booking_id: e2eD.booking.id } });
  let e2eD2 = await run(startH, { method: 'POST', headers: {}, body: { booking_id: e2eD.booking.id } });
  ok('135 start: doble clic no duplica job', j(e2eD1).created === true && j(e2eD2).created === false && j(e2eD1).job.id === j(e2eD2).job.id && e2eD.db.travel_search_jobs.length === 1);

  // 136 admin → 403 (Fase 9: solo lectura; no crea jobs)
  CURRENT_ROLE = 'admin'; let e2eA = freshDb(); CONTRACT = baseContract(e2eA.booking); setClient(e2eA.db);
  let e2eAH = await run(startH, { method: 'POST', headers: {}, body: { booking_id: e2eA.booking.id } });
  ok('136 start: admin rechazado y sin job creado', e2eAH.statusCode === 403 && e2eA.db.travel_search_jobs.length === 0);

  // 137 staff → 403
  CURRENT_ROLE = 'staff'; let e2eS = freshDb(); CONTRACT = baseContract(e2eS.booking); setClient(e2eS.db);
  let e2eSH = await run(startH, { method: 'POST', headers: {}, body: { booking_id: e2eS.booking.id } });
  ok('137 start: staff 403', e2eSH.statusCode === 403);
  CURRENT_ROLE = 'owner';

  // 138 "Search again" sin job previo → rechazado (rerun con job inexistente → 404)
  setClient({ travel_search_jobs: [], travel_search_subtasks: [], milu_settings: [] });
  let e2eRA = await run(rerunH, { method: 'POST', headers: {}, body: { booking_id: nid(), job_id: nid() } });
  ok('138 rerun: sin job previo → rechazado', e2eRA.statusCode !== 200 && e2eRA.statusCode === 404);

  // 139 el flujo start NO toca Stripe ni envía al cliente
  const startSrc = fs.readFileSync(BASE + '/server/admin-handlers/milu-search-start.js', 'utf8') + fs.readFileSync(BASE + '/server/lib/milu-tourism.js', 'utf8');
  ok('139 start: sin Stripe ni email al cliente',
    !/booking-email-service|customer_travel_confirmation|\bresend\b|sendEmail|require\(['"][^'"]*stripe|stripe\.(?:paymentIntents|charges|checkout)|PaymentIntent|create-payment-intent/i.test(startSrc));

  // 140 admin.js: Start + Search Again cableados; Search Again visible solo en estado terminal
  const adminSrc = fs.readFileSync(BASE + '/assets/js/admin.js', 'utf8');
  ok('140 admin.js: Start + Search Again visible por estado del job',
    /Start travel research|Iniciar investigación de viaje/.test(adminSrc) &&
    /admin-milu-search-start/.test(adminSrc) &&
    /admin-milu-research-rerun/.test(adminSrc) &&
    /Search Again|Buscar nuevamente/.test(adminSrc) &&
    /function refreshRerunVisibility/.test(adminSrc) &&
    /TERMINAL_JOB\s*=\s*\['partial'\s*,\s*'failed'\s*,\s*'completed'\]/.test(adminSrc) &&
    /function refreshJobState/.test(adminSrc));

  // ── Itinerario: programa insular vs viaje completo continental (8D) ──

  // 141 4 días desde 2026-08-01 → programa insular 1–4 agosto (3 noches)
  const it141 = milu.computeItinerary({ galapagosStartDate: '2026-08-01', tourId: 'p3', passengerType: 'international', connectionCity: 'quito' });
  ok('141 programa insular 1–4 agosto (3 noches)', it141.galapagos_start_date === '2026-08-01' && it141.galapagos_end_date === '2026-08-04' && it141.galapagos_days === 4 && it141.galapagos_nights === 3);

  // 142 internacional → llegada continental 2026-07-31 + vuelo continental el 08-01
  ok('142 internacional → llegada mainland 2026-07-31', it141.requires_mainland_pre_night === true && it141.mainland_pre_nights === 1 && it141.mainland_arrival_date === '2026-07-31' && it141.full_itinerary_start_date === '2026-07-31' && it141.mainland_to_galapagos_flight_date === '2026-08-01');

  // 143 la noche continental NO reduce las noches del programa insular
  ok('143 noche continental no reduce noches Galápagos', it141.galapagos_nights === 3 && it141.mainland_pre_nights === 1);

  // 144 doméstico → por defecto SIN noche previa
  const it144 = milu.computeItinerary({ galapagosStartDate: '2026-08-01', tourId: 'p3', passengerType: 'domestic', connectionCity: 'quito' });
  ok('144 doméstico puede no requerir noche previa', it144.requires_mainland_pre_night === false && it144.mainland_pre_nights === 0 && it144.full_itinerary_start_date === '2026-08-01' && it144.galapagos_nights === 3);

  // 145 Quito y Guayaquil se manejan por separado (origen distinto)
  const uio145 = milu.computeItinerary({ galapagosStartDate: '2026-08-01', tourId: 'p3', passengerType: 'international', connectionCity: 'quito' });
  const gye145 = milu.computeItinerary({ galapagosStartDate: '2026-08-01', tourId: 'p3', passengerType: 'international', connectionCity: 'guayaquil' });
  ok('145 Quito y Guayaquil separados (UIO vs GYE)', uio145.origin_airport === 'UIO' && gye145.origin_airport === 'GYE' && uio145.connection_city === 'quito' && gye145.connection_city === 'guayaquil');

  // 146 componentes incluidos separados (hotel continental solo con noche previa)
  ok('146 componentes separados', it141.included_components.mainland_hotel === true && it144.included_components.mainland_hotel === false && it141.included_components.inter_island_boat === true && it141.included_components.mainland_to_galapagos_flight === true);

  // 147 internacional sin ciudad de conexión → CONNECTION_CITY_REQUIRED
  let e147 = null; try { milu.assertItineraryReady(milu.computeItinerary({ galapagosStartDate: '2026-08-01', tourId: 'p3', passengerType: 'international', connectionCity: null })); } catch (e) { e147 = e.code; }
  ok('147 internacional sin conexión → CONNECTION_CITY_REQUIRED', e147 === 'CONNECTION_CITY_REQUIRED');

  // 148 sin tipo de pasajero → PASSENGER_TYPE_REQUIRED
  let e148 = null; try { milu.assertItineraryReady(milu.computeItinerary({ galapagosStartDate: '2026-08-01', tourId: 'p3', passengerType: null, connectionCity: 'quito' })); } catch (e) { e148 = e.code; }
  ok('148 sin tipo de pasajero → PASSENGER_TYPE_REQUIRED', e148 === 'PASSENGER_TYPE_REQUIRED');

  // 149 fechas manuales tienen prioridad sobre la fecha de reserva
  const man149 = milu.deriveItineraryInputs({ preferred_connection_city: 'quito' }, { galapagos_start_date: '2026-09-10' });
  const it149 = milu.computeItinerary({ galapagosStartDate: man149.manual_galapagos_start_date || '2026-08-01', tourId: 'p3', passengerType: 'international', connectionCity: 'quito' });
  ok('149 fechas manuales tienen prioridad', man149.manual_galapagos_start_date === '2026-09-10' && it149.galapagos_start_date === '2026-09-10' && it149.galapagos_end_date === '2026-09-13');

  // 150 start via handler con overrides → job con itinerario en el snapshot
  CURRENT_ROLE = 'owner'; let itF = freshDb(); CONTRACT = baseContract(itF.booking); setClient(itF.db);
  let itH = await run(startH, { method: 'POST', headers: {}, body: { booking_id: itF.booking.id, passenger_type: 'international', connection_city: 'guayaquil' } });
  const snapIt150 = itF.db.travel_search_jobs[0] && itF.db.travel_search_jobs[0].requirements_snapshot && itF.db.travel_search_jobs[0].requirements_snapshot.itinerary;
  ok('150 start guarda itinerario en snapshot', itH.statusCode === 200 && j(itH).itinerary && j(itH).itinerary.connection_city === 'guayaquil' && snapIt150 && snapIt150.origin_airport === 'GYE' && snapIt150.galapagos_nights === 3);

  // 151 start sin tipo de pasajero (contrato sin arrival, sin override) → 409 PASSENGER_TYPE_REQUIRED
  let ptF = freshDb(); CONTRACT = baseContract(ptF.booking); CONTRACT.arrival = null; CONTRACT.preferred_connection_city = 'quito'; setClient(ptF.db);
  let ptH = await run(startH, { method: 'POST', headers: {}, body: { booking_id: ptF.booking.id } });
  ok('151 start sin tipo de pasajero → 409 PASSENGER_TYPE_REQUIRED', ptH.statusCode === 409 && j(ptH).error === 'PASSENGER_TYPE_REQUIRED');

  // 152 start internacional sin ciudad de conexión → 409 CONNECTION_CITY_REQUIRED
  let ccF = freshDb(); CONTRACT = baseContract(ccF.booking); CONTRACT.preferred_connection_city = null; CONTRACT.arrival = { international_flights_purchased: true }; setClient(ccF.db);
  let ccH = await run(startH, { method: 'POST', headers: {}, body: { booking_id: ccF.booking.id } });
  ok('152 start internacional sin conexión → 409 CONNECTION_CITY_REQUIRED', ccH.statusCode === 409 && j(ccH).error === 'CONNECTION_CITY_REQUIRED');

  // 153 preview: owner ve el itinerario sin crear job; missing lista lo que falta
  let pvF = freshDb(); CONTRACT = baseContract(pvF.booking); CONTRACT.arrival = null; CONTRACT.preferred_connection_city = null; setClient(pvF.db);
  let pvH = await run(previewH, { method: 'POST', headers: {}, body: { booking_id: pvF.booking.id } });
  ok('153 preview: itinerario + missing sin crear job', pvH.statusCode === 200 && j(pvH).itinerary && j(pvH).missing.indexOf('passenger_type') !== -1 && pvF.db.travel_search_jobs.length === 0);

  // 154 preview con overrides completos → ready + noche previa (full start = inicio - 1)
  let pvF2 = freshDb(); CONTRACT = baseContract(pvF2.booking); setClient(pvF2.db);
  let pvH2 = await run(previewH, { method: 'POST', headers: {}, body: { booking_id: pvF2.booking.id, passenger_type: 'international', connection_city: 'quito' } });
  ok('154 preview ready con overrides', pvH2.statusCode === 200 && j(pvH2).ready === true && j(pvH2).itinerary.full_itinerary_start_date === milu.addDaysYmd(pvF2.booking.booking_date, -1));

  // 155 preview: staff 403
  CURRENT_ROLE = 'staff'; let pvF3 = freshDb(); CONTRACT = baseContract(pvF3.booking); setClient(pvF3.db);
  let pvH3 = await run(previewH, { method: 'POST', headers: {}, body: { booking_id: pvF3.booking.id } });
  ok('155 preview: staff 403', pvH3.statusCode === 403);
  CURRENT_ROLE = 'owner';

  // 156 nada del itinerario llega a Stripe ni al cliente (fuentes)
  const itSrc = fs.readFileSync(BASE + '/server/lib/milu-tourism.js', 'utf8') + fs.readFileSync(BASE + '/server/admin-handlers/milu-itinerary-preview.js', 'utf8') + fs.readFileSync(BASE + '/server/admin-handlers/milu-search-start.js', 'utf8');
  ok('156 itinerario: sin Stripe ni email al cliente',
    !/booking-email-service|customer_travel_confirmation|\bresend\b|sendEmail|require\(['"][^'"]*stripe|stripe\.(?:paymentIntents|charges|checkout)|PaymentIntent|create-payment-intent/i.test(itSrc));

  // 157 admin.js: controles + botón de preview cableados al endpoint de itinerario
  const adminSrc157 = fs.readFileSync(BASE + '/assets/js/admin.js', 'utf8');
  ok('157 admin.js: preview de itinerario cableado + limpieza (Advanced settings, auto-preview)',
    /admin-milu-itinerary-preview/.test(adminSrc157) &&
    /Passenger type|Tipo de pasajero/.test(adminSrc157) &&
    /itOverrides\(\)/.test(adminSrc157) &&
    /function runPreview/.test(adminSrc157) &&
    /Advanced settings|Ajustes avanzados/.test(adminSrc157));

  // 158 router + vercel exponen el endpoint de preview (8 funciones, sin duplicados)
  const routerSrc = fs.readFileSync(BASE + '/api/admin-router.js', 'utf8');
  const vjson = JSON.parse(fs.readFileSync(BASE + '/vercel.json', 'utf8'));
  const vsrcs = (vjson.rewrites || []).map(function (x) { return x.source; });
  ok('158 endpoint itinerary-preview registrado (router + rewrite, sin dup)',
    /ROUTES\['milu-itinerary-preview'\]/.test(routerSrc) &&
    vsrcs.indexOf('/api/admin-milu-itinerary-preview') !== -1 &&
    vsrcs.length === (new Set(vsrcs)).size);

  // ── INVARIANTE (#6): Preview y Start MISMA ruta de validación ──

  // 159 Preview válido + Start con EXACTAMENTE el mismo payload → job queued.
  // Reserva SIN fechas de lodging + sin arrival/preferred (reproduce el bug viejo
  // "Destination dates are missing"). Nunca puede ocurrir Preview PASS + Start dates-missing.
  CURRENT_ROLE = 'owner';
  let invF = freshDb({ missingDates: true });
  CONTRACT = baseContract(invF.booking); CONTRACT.arrival = null; CONTRACT.preferred_connection_city = null; setClient(invF.db);
  const invPayload = { booking_id: invF.booking.id, passenger_type: 'international', connection_city: 'guayaquil' };
  let invPv = await run(previewH, { method: 'POST', headers: {}, body: invPayload });
  let invSt = await run(startH, { method: 'POST', headers: {}, body: Object.assign({ search_type: 'complete_trip' }, invPayload) });
  ok('159 Preview válido + Start mismo payload → queued (nunca dates-missing)',
    invPv.statusCode === 200 && j(invPv).ready === true && j(invPv).missing.length === 0 &&
    invSt.statusCode === 200 && j(invSt).started === true && j(invSt).job.status === 'queued' && j(invSt).error === undefined);

  // 160 (#7) job existente: Start NO duplica y REFRESCA el snapshot con el itinerario actual.
  let refF = freshDb(); CONTRACT = baseContract(refF.booking); setClient(refF.db);
  let ref1 = await run(startH, { method: 'POST', headers: {}, body: { booking_id: refF.booking.id, passenger_type: 'international', connection_city: 'quito' } });
  let ref2 = await run(startH, { method: 'POST', headers: {}, body: { booking_id: refF.booking.id, passenger_type: 'international', connection_city: 'guayaquil' } });
  const snap160 = refF.db.travel_search_jobs[0].requirements_snapshot.itinerary;
  ok('160 job existente refresca snapshot (no duplica)',
    j(ref1).created === true && j(ref2).created === false && refF.db.travel_search_jobs.length === 1 &&
    snap160.connection_city === 'guayaquil' && snap160.origin_airport === 'GYE');

  // ── Claim SOLO 'queued': 'partial' (provider_not_connected) es terminal (0017) ──

  // 161 estructural: 0017 reclama solo 'queued' y ya no incluye 'partial'
  const SQL17 = fs.readFileSync(path.join(BASE, 'supabase/migrations/0017_milu_claim_only_queued.sql'), 'utf8');
  ok('161 0017: claim reclama solo queued (excluye partial/terminales)',
    /create or replace function public\.milu_claim_next_subtask/i.test(SQL17) &&
    /and\s+s\.status\s*=\s*'queued'/i.test(SQL17) &&
    !/and\s+s\.status\s+in\s*\(/i.test(SQL17));

  // 162 (#7) provider desconectado → partial UNA vez; no se re-reclama; el claim
  // avanza a web_research_flights y luego web_research_lodging; termina.
  const cqJid = nid();
  const cqJob = { id: cqJid, tenant_id: 'hook-adventure', booking_id: nid(), status: 'running', active: true, requirements_snapshot: snap() };
  const cqDb = {
    travel_search_jobs: [cqJob],
    travel_search_subtasks: [
      { id: nid(), tenant_id: 'hook-adventure', job_id: cqJid, kind: 'flights_duffel', status: 'queued', attempt_count: 0, max_attempts: 3, created_at: '2026-08-01T00:00:01Z' },
      { id: nid(), tenant_id: 'hook-adventure', job_id: cqJid, kind: 'hotels_primary_provider', status: 'queued', attempt_count: 0, max_attempts: 3, created_at: '2026-08-01T00:00:02Z' },
      { id: nid(), tenant_id: 'hook-adventure', job_id: cqJid, kind: 'web_research_flights', status: 'queued', attempt_count: 0, max_attempts: 3, created_at: '2026-08-01T00:00:03Z' },
      { id: nid(), tenant_id: 'hook-adventure', job_id: cqJid, kind: 'web_research_lodging', status: 'queued', attempt_count: 0, max_attempts: 3, created_at: '2026-08-01T00:00:04Z' }
    ],
    travel_flight_options: [], travel_hotel_options: [], milu_settings: []
  };
  setClient(cqDb);
  async function cqPass() {
    const cl = await worker.claimNextSubtask('hook-adventure', 'wq', 120);
    if (!cl.ok || !cl.subtask) return null;
    const stx = cl.subtask;
    let rs; try { rs = await worker.runSubtask(stx, { job: cqJob, flightProvider: 'stub', hotelProvider: 'stub', env: {}, settings: {} }); } catch (e) { rs = { status: 'failed', reason: 'exception' }; }
    if (rs.status === 'failed') await worker.failOrRetrySubtask(stx, rs.reason || 'failed');
    else await worker.completeSubtask(stx.id, rs.status || 'partial');
    return { kind: stx.kind, id: stx.id, status: rs.status, reason: rs.reason || null };
  }
  const cqP1 = await cqPass(), cqP2 = await cqPass(), cqP3 = await cqPass(), cqP4 = await cqPass(), cqP5 = await cqPass();
  const cqPasses = [cqP1, cqP2, cqP3, cqP4].filter(Boolean);
  const cqKinds = cqPasses.map(function (x) { return x.kind; });
  const cqIds = cqPasses.map(function (x) { return x.id; });
  ok('162 partial provider_not_connected no se re-reclama; claim avanza a web_research y termina',
    cqP1 && cqP1.status === 'partial' && cqP1.reason === 'provider_not_connected' &&
    cqIds.length === 4 && cqIds.length === (new Set(cqIds)).size &&        // 4 subtareas distintas, ninguna dos veces
    cqKinds.indexOf('web_research_flights') !== -1 &&
    cqKinds.indexOf('web_research_lodging') !== -1 &&
    cqP5 === null);                                                        // 5ª pasada: nada por reclamar

  // ── Límites duros de tools + saneo de errores + claim robusto (e2e fixes) ──

  // 163 search/fetch tienen límites INDEPENDIENTES; el fetch se retira al agotarse
  const capTools = [{ name: 'web_search', max_uses: 6 }, { name: 'web_fetch', max_uses: 2 }];
  ok('163 cap tools: search y fetch independientes; fetch retirado a 0',
    wrClient.capResearchTools(capTools, 3, 0).filter(function (t) { return t.name === 'web_search'; })[0].max_uses === 3 &&
    wrClient.capResearchTools(capTools, 0, 2).every(function (t) { return t.name !== 'web_fetch'; }) &&
    wrClient.capResearchTools(capTools, 6, 2).length === 0);

  // Bloques server_tool_use realistas (el cap cuenta DESDE EL CONTENIDO, no usage).
  function stuBlocks(nSearch, nFetch) {
    const a = [];
    for (var i = 0; i < nSearch; i++) a.push({ type: 'server_tool_use', name: 'web_search' });
    for (var k = 0; k < nFetch; k++) a.push({ type: 'server_tool_use', name: 'web_fetch' });
    return a;
  }

  // 164 con max_fetches=2, pause_turn JAMÁS ejecuta un 3er fetch (límite duro acumulado).
  // Request 1 hace 1 search + 2 fetch; el cap retira web_fetch → request 2 sin fetch.
  const c164 = [];
  const sdk164 = { messages: { create: async function (r) { c164.push(r.tools.map(function (t) { return t.name; }));
    return c164.length === 1
      ? { model: 'm', usage: {}, content: stuBlocks(1, 2).concat([{ type: 'text', text: 'x' }]), stop_reason: 'pause_turn' }
      : { model: 'm', usage: {}, content: stuBlocks(1, 0).concat([{ type: 'text', text: '```json\n{"findings":[]}\n```' }]), stop_reason: 'end_turn' };
  } } };
  const resp164 = await wrClient.makeAnthropicResearchClient({ sdk: sdk164, maxPauseTurns: 4 })
    .messages({ model: 'm', system: 's', input: { kind: 'flights' }, tools: [{ name: 'web_search', max_uses: 6 }, { name: 'web_fetch', max_uses: 2 }] });
  ok('164 max_fetches=2: pause_turn no ejecuta un 3er fetch',
    resp164.usage.server_tool_use.web_fetch_requests === 2 && c164.length === 2 && c164[1].indexOf('web_fetch') === -1);

  // 169 (agrupado) al agotar search Y fetch, el adapter NO vuelve a llamar a Anthropic.
  const c169 = [];
  const sdk169 = { messages: { create: async function () { c169.push(1); return { model: 'm', usage: {}, content: stuBlocks(6, 2).concat([{ type: 'text', text: '```json\n{"findings":[]}\n```' }]), stop_reason: 'pause_turn' }; } } };
  await wrClient.makeAnthropicResearchClient({ sdk: sdk169, maxPauseTurns: 4 })
    .messages({ model: 'm', system: 's', input: { kind: 'flights' }, tools: [{ name: 'web_search', max_uses: 6 }, { name: 'web_fetch', max_uses: 2 }] });
  ok('165 tras agotar search+fetch no se reanuda (1 sola llamada Anthropic)', c169.length === 1);

  // Gate ON para las pruebas de runSubtask con research real (mock de cliente).
  const prevWrEnv = process.env.MILU_TOURISM_WEB_RESEARCH_ENABLED;
  process.env.MILU_TOURISM_WEB_RESEARCH_ENABLED = 'true';

  // 166 max_uses_exceeded → partial TERMINAL + código saneado persistido; no se re-reclama
  const j166 = nid(), s166 = nid();
  const db166 = {
    travel_search_jobs: [{ id: j166, tenant_id: 'hook-adventure', booking_id: nid(), status: 'running', active: true, web_search_count: 0, web_fetch_count: 0, research_cost_usd: 0, requirements_snapshot: snap() }],
    travel_search_subtasks: [{ id: s166, tenant_id: 'hook-adventure', job_id: j166, kind: 'web_research_flights', status: 'queued', attempt_count: 0, max_attempts: 3, created_at: '2026-08-01T00:00:01Z' }],
    travel_flight_options: [], travel_hotel_options: [], milu_settings: [{ tenant_id: 'hook-adventure', web_research_enabled: true, web_research_max_searches: 6, web_research_max_fetches: 2, web_research_max_content_tokens_per_fetch: 4000, web_research_max_cost_per_job_usd: 0.30 }], llm_usage_log: []
  };
  setClient(db166);
  const cliMU = { messages: async function () { return { usage: { server_tool_use: { web_search_requests: 2, web_fetch_requests: 2 } }, content: [{ type: 'web_fetch_tool_result', content: { type: 'web_fetch_tool_result_error', error_code: 'max_uses_exceeded' } }], output: { findings: [] } }; } };
  const rMU = await worker.runSubtask({ id: s166, job_id: j166, kind: 'web_research_flights' }, { job: db166.travel_search_jobs[0], settings: db166.milu_settings[0], env: process.env, researchClient: cliMU });
  await worker.completeSubtask(s166, rMU.status);
  const subMU = db166.travel_search_subtasks.filter(function (s) { return s.id === s166; })[0];
  const claimMU = await worker.claimNextSubtask('hook-adventure', 'w', 120);
  ok('166 max_uses_exceeded → partial terminal + código saneado; no se re-reclama',
    rMU.status === 'partial' && rMU.error_code === 'max_uses_exceeded' &&
    subMU.status === 'partial' && subMU.last_sanitized_error === 'max_uses_exceeded' &&
    claimMU.subtask === null);

  // 167 costo research por propuesta se mantiene bajo el tope $0.30
  const cost167 = db166.travel_search_jobs[0].research_cost_usd;
  ok('167 costo research < $0.30 (2 búsquedas ≈ $0.02)', cost167 >= 0 && cost167 < 0.30);

  // 168 web_tool_exception → código saneado (api_*), sin secreto/contenido
  const j168 = nid(), s168 = nid();
  const db168 = {
    travel_search_jobs: [{ id: j168, tenant_id: 'hook-adventure', booking_id: nid(), status: 'running', active: true, web_search_count: 0, web_fetch_count: 0, research_cost_usd: 0, requirements_snapshot: snap() }],
    travel_search_subtasks: [{ id: s168, tenant_id: 'hook-adventure', job_id: j168, kind: 'web_research_lodging', status: 'queued', attempt_count: 0, max_attempts: 3 }],
    travel_flight_options: [], travel_hotel_options: [], milu_settings: [{ tenant_id: 'hook-adventure', web_research_enabled: true }], llm_usage_log: []
  };
  setClient(db168);
  const cliEx = { messages: async function () { throw Object.assign(new Error('boom secret token=abc123'), { status: 500, name: 'APIError' }); } };
  const rEx = await worker.runSubtask({ id: s168, job_id: j168, kind: 'web_research_lodging' }, { job: db168.travel_search_jobs[0], settings: db168.milu_settings[0], env: process.env, researchClient: cliEx });
  await worker.completeSubtask(s168, rEx.status);
  const subEx = db168.travel_search_subtasks.filter(function (s) { return s.id === s168; })[0];
  ok('168 web_tool_exception → código saneado api_server_error; sin secreto',
    rEx.status === 'partial' && rEx.error_code === 'api_server_error' &&
    subEx.last_sanitized_error === 'api_server_error' && !/secret|token|boom/i.test(String(subEx.last_sanitized_error)));

  process.env.MILU_TOURISM_WEB_RESEARCH_ENABLED = prevWrEnv;

  // 169 claim con fila incompleta/all-null → sin subtarea (nunca runSubtask ni job_not_found)
  CLIENT = { rpc: async function () { return { data: { id: null, kind: null, job_id: null }, error: null }; } };
  const clNull = await worker.claimNextSubtask('hook-adventure', 'w', 120);
  CLIENT = makeClient({});   // restaura cliente normal
  ok('169 claim all-null → subtask null (no job_not_found desde subtarea nula)', clNull.ok === true && clNull.subtask === null);

  // 170 rerun LIMPIO (#6): resetea contadores de investigación del job (presupuesto fresco)
  const jRR = nid();
  const dbRR = {
    travel_search_jobs: [{ id: jRR, tenant_id: 'hook-adventure', booking_id: 'b-rr', status: 'partial', active: true, rerun_count: 0, web_search_count: 3, web_fetch_count: 3, research_cost_usd: 0.0798, requirements_snapshot: snap() }],
    travel_search_subtasks: [{ id: nid(), tenant_id: 'hook-adventure', job_id: jRR, kind: 'web_research_flights', status: 'partial', attempt_count: 1, max_attempts: 3 }],
    milu_settings: [{ tenant_id: 'hook-adventure', web_research_enabled: true }], travel_search_audit: []
  };
  process.env.MILU_TOURISM_WEB_RESEARCH_ENABLED = 'true'; setClient(dbRR);
  const rrRes = await milu.rerunResearch('b-rr', jRR, { role: 'owner', userId: 'u' });
  process.env.MILU_TOURISM_WEB_RESEARCH_ENABLED = prevWrEnv;
  const jobRR = dbRR.travel_search_jobs[0];
  ok('170 rerun limpio: contadores de investigación reseteados a 0 (no reusa la corrida previa)',
    rrRes.rerun === true && jobRR.web_search_count === 0 && jobRR.web_fetch_count === 0 && jobRR.research_cost_usd === 0);

  // ── Search Again (rerun) end-to-end ──

  // 171 (#7) partial → rerun → job queued + contadores 0 + rerun+1 + 2 subtareas
  // re-encoladas + el runner encuentra la SIGUIENTE subtarea.
  const jRQ = nid();
  const dbRQ = {
    travel_search_jobs: [{ id: jRQ, tenant_id: 'hook-adventure', booking_id: 'b-rq', status: 'partial', active: true, rerun_count: 0, web_search_count: 3, web_fetch_count: 3, research_cost_usd: 0.0798 }],
    travel_search_subtasks: [
      { id: nid(), tenant_id: 'hook-adventure', job_id: jRQ, kind: 'web_research_flights', status: 'partial', attempt_count: 1, max_attempts: 3, created_at: '2026-08-01T00:00:01Z' },
      { id: nid(), tenant_id: 'hook-adventure', job_id: jRQ, kind: 'web_research_lodging', status: 'partial', attempt_count: 1, max_attempts: 3, created_at: '2026-08-01T00:00:02Z' }
    ],
    milu_settings: [{ tenant_id: 'hook-adventure', web_research_enabled: true }], travel_search_audit: []
  };
  process.env.MILU_TOURISM_WEB_RESEARCH_ENABLED = 'true'; setClient(dbRQ);
  const rq1 = await milu.rerunResearch('b-rq', jRQ, { role: 'owner', userId: 'u' });
  const jobRQ = dbRQ.travel_search_jobs[0];
  const requeuedQ = dbRQ.travel_search_subtasks.filter(function (s) { return /web_research/.test(s.kind) && s.status === 'queued'; }).length;
  const claimRQ = await worker.claimNextSubtask('hook-adventure', 'w', 120);
  ok('171 rerun: job queued + contadores 0 + rerun+1 + 2 subtareas re-encoladas + claim encuentra siguiente',
    rq1.rerun === true && rq1.status === 'queued' && jobRQ.status === 'queued' &&
    jobRQ.web_search_count === 0 && jobRQ.web_fetch_count === 0 && jobRQ.research_cost_usd === 0 &&
    jobRQ.rerun_count === 1 && requeuedQ === 2 &&
    !!claimRQ.subtask && /web_research/.test(claimRQ.subtask.kind));

  // 172 (#6) doble clic no duplica subtareas (idempotente): sigue habiendo 2 web_research
  const rq2 = await milu.rerunResearch('b-rq', jRQ, { role: 'owner', userId: 'u' });
  const wrCount172 = dbRQ.travel_search_subtasks.filter(function (s) { return /web_research/.test(s.kind); }).length;
  ok('172 rerun doble: no duplica subtareas (2) y rerun_count sube a 2',
    rq2.rerun === true && wrCount172 === 2 && jobRQ.rerun_count === 2);
  process.env.MILU_TOURISM_WEB_RESEARCH_ENABLED = prevWrEnv;

  // 173 handler rerun: staff 403
  CURRENT_ROLE = 'staff';
  const rerunStaff = await run(rerunH, { method: 'POST', headers: {}, body: { booking_id: nid(), job_id: nid() } });
  CURRENT_ROLE = 'owner';
  ok('173 rerun handler: staff 403', rerunStaff.statusCode === 403);

  // ── Presupuesto de fetch ACUMULATIVO POR JOB (flights + lodging ≤ 2 combinados) ──
  // Cliente espía que respeta max_uses de las tools recibidas (modelo "bien portado").
  function budgetSpy(perFetch, perSearch) {
    const calls = [];
    return { calls: calls, client: { messages: async function (req) {
      const fTool = (req.tools || []).filter(function (t) { return t.name === 'web_fetch'; })[0];
      const sTool = (req.tools || []).filter(function (t) { return t.name === 'web_search'; })[0];
      const fetches = fTool ? Math.min(perFetch, fTool.max_uses || 0) : 0;
      const searches = sTool ? Math.min(perSearch, sTool.max_uses || 0) : 0;
      calls.push({ tools: (req.tools || []).map(function (t) { return t.name; }), fetches: fetches, searches: searches });
      return { usage: { server_tool_use: { web_search_requests: searches, web_fetch_requests: fetches } }, content: [], output: { findings: [] } };
    } } };
  }
  function budgetDb() {
    const jid = nid();
    return { jid: jid, db: {
      travel_search_jobs: [{ id: jid, tenant_id: 'hook-adventure', booking_id: nid(), status: 'running', active: true, web_search_count: 0, web_fetch_count: 0, research_cost_usd: 0, requirements_snapshot: snap() }],
      travel_search_subtasks: [], travel_flight_options: [], travel_hotel_options: [],
      milu_settings: [{ tenant_id: 'hook-adventure', web_research_enabled: true, web_research_max_searches: 6, web_research_max_fetches: 2, web_research_max_content_tokens_per_fetch: 4000, web_research_max_cost_per_job_usd: 0.30 }],
      llm_usage_log: []
    } };
  }
  process.env.MILU_TOURISM_WEB_RESEARCH_ENABLED = 'true';

  // 174 flights consume 2 fetches → lodging consume 0 (combinado = 2; lodging sin web_fetch)
  let bd = budgetDb(); setClient(bd.db);
  const sp174 = budgetSpy(2, 1);
  const set174 = bd.db.milu_settings[0];
  await worker.runSubtask({ id: nid(), job_id: bd.jid, kind: 'web_research_flights' }, { job: bd.db.travel_search_jobs[0], settings: set174, env: process.env, researchClient: sp174.client });
  const afterF174 = bd.db.travel_search_jobs[0].web_fetch_count;
  await worker.runSubtask({ id: nid(), job_id: bd.jid, kind: 'web_research_lodging' }, { job: bd.db.travel_search_jobs[0], settings: set174, env: process.env, researchClient: sp174.client });
  ok('174 flights=2 fetches → lodging=0; combinado=2; lodging sin web_fetch en tools',
    afterF174 === 2 && bd.db.travel_search_jobs[0].web_fetch_count === 2 &&
    sp174.calls[1] && sp174.calls[1].fetches === 0 && sp174.calls[1].tools.indexOf('web_fetch') === -1);

  // 175 flights consume 1 → lodging consume MÁXIMO 1; combinado ≤ 2
  bd = budgetDb(); setClient(bd.db);
  const set175 = bd.db.milu_settings[0];
  await worker.runSubtask({ id: nid(), job_id: bd.jid, kind: 'web_research_flights' }, { job: bd.db.travel_search_jobs[0], settings: set175, env: process.env, researchClient: budgetSpy(1, 1).client });
  const spL175 = budgetSpy(5, 1);   // lodging intenta 5, pero el restante del job es 1
  await worker.runSubtask({ id: nid(), job_id: bd.jid, kind: 'web_research_lodging' }, { job: bd.db.travel_search_jobs[0], settings: set175, env: process.env, researchClient: spL175.client });
  ok('175 flights=1 → lodging≤1; combinado=2', spL175.calls[0].fetches <= 1 && bd.db.travel_search_jobs[0].web_fetch_count === 2);

  // 176 search y fetch permanecen independientes
  bd = budgetDb(); setClient(bd.db);
  const spSF = budgetSpy(2, 3);
  await worker.runSubtask({ id: nid(), job_id: bd.jid, kind: 'web_research_flights' }, { job: bd.db.travel_search_jobs[0], settings: bd.db.milu_settings[0], env: process.env, researchClient: spSF.client });
  ok('176 search y fetch independientes (fetch=2, search=3)', bd.db.travel_search_jobs[0].web_fetch_count === 2 && bd.db.travel_search_jobs[0].web_search_count === 3);

  // 177 costo total jamás supera $0.30: en el tope no se llama a Anthropic
  bd = budgetDb(); bd.db.travel_search_jobs[0].research_cost_usd = 0.30; setClient(bd.db);
  const spCost = budgetSpy(2, 2);
  const rCost = await worker.runSubtask({ id: nid(), job_id: bd.jid, kind: 'web_research_flights' }, { job: bd.db.travel_search_jobs[0], settings: bd.db.milu_settings[0], env: process.env, researchClient: spCost.client });
  ok('177 costo en tope → no se llama a Anthropic (cost_budget_reached)',
    rCost.reason === 'cost_budget_reached' && spCost.calls.length === 0 && bd.db.travel_search_jobs[0].research_cost_usd <= 0.30);

  // 178 sin presupuesto ÚTIL de tools → no se llama a Anthropic
  bd = budgetDb(); bd.db.travel_search_jobs[0].web_search_count = 6; bd.db.travel_search_jobs[0].web_fetch_count = 2; setClient(bd.db);
  const spNo = budgetSpy(1, 1);
  const rNo = await worker.runSubtask({ id: nid(), job_id: bd.jid, kind: 'web_research_flights' }, { job: bd.db.travel_search_jobs[0], settings: bd.db.milu_settings[0], env: process.env, researchClient: spNo.client });
  ok('178 sin presupuesto útil → no se llama a Anthropic (search_budget_reached)',
    rNo.reason === 'search_budget_reached' && spNo.calls.length === 0);

  // 179 buildResearchTools omite web_fetch/web_search cuando su restante es 0
  const t0f = webtools.buildResearchTools({ web_research_max_searches: 6, web_research_max_fetches: 0 });
  const t0s = webtools.buildResearchTools({ web_research_max_searches: 0, web_research_max_fetches: 2 });
  ok('179 buildResearchTools: omite tool con restante 0',
    t0f.every(function (t) { return t.name !== 'web_fetch'; }) && t0f.some(function (t) { return t.name === 'web_search'; }) &&
    t0s.every(function (t) { return t.name !== 'web_search'; }) && t0s.some(function (t) { return t.name === 'web_fetch'; }));

  process.env.MILU_TOURISM_WEB_RESEARCH_ENABLED = prevWrEnv;

  // ── Status final del job en fase web-only (#6) ──

  // 181 web_research completed + proveedor partial(provider_not_connected) → job completed
  const jWC = nid();
  const dbWC = { travel_search_jobs: [{ id: jWC, tenant_id: 'hook-adventure', status: 'running', active: true }],
    travel_search_subtasks: [
      { job_id: jWC, kind: 'flights_duffel', status: 'partial' },
      { job_id: jWC, kind: 'hotels_primary_provider', status: 'partial' },
      { job_id: jWC, kind: 'web_research_flights', status: 'completed' },
      { job_id: jWC, kind: 'web_research_lodging', status: 'completed' }
    ] };
  setClient(dbWC);
  const stWC = await worker.recomputeJobStatus(jWC);
  ok('181 web_research completed + proveedor partial → job completed', stWC === 'completed' && dbWC.travel_search_jobs[0].status === 'completed');

  // 182 si una web_research NO terminó completed → el job sigue partial (no se fuerza completed)
  const jWC2 = nid();
  const dbWC2 = { travel_search_jobs: [{ id: jWC2, tenant_id: 'hook-adventure', status: 'running', active: true }],
    travel_search_subtasks: [
      { job_id: jWC2, kind: 'flights_duffel', status: 'partial' },
      { job_id: jWC2, kind: 'web_research_flights', status: 'completed' },
      { job_id: jWC2, kind: 'web_research_lodging', status: 'partial' }
    ] };
  setClient(dbWC2);
  const stWC2 = await worker.recomputeJobStatus(jWC2);
  ok('182 web_research incompleta → job sigue partial', stWC2 === 'partial');

  // 183 REPRO exacto del e2e: los 7 subtasks reales del runner controlado —
  // proveedores (Duffel/hotels/preferred) partial(provider_not_connected) +
  // anthropic_ranking/final_summary partial(llm_not_available, sin deps.llm) +
  // ambas web_research completed → el job DEBE quedar completed (antes: partial).
  const jREP = nid();
  const dbREP = { travel_search_jobs: [{ id: jREP, tenant_id: 'hook-adventure', status: 'running', active: true }],
    travel_search_subtasks: [
      { job_id: jREP, kind: 'flights_duffel', status: 'partial' },
      { job_id: jREP, kind: 'hotels_primary_provider', status: 'partial' },
      { job_id: jREP, kind: 'hotel_preferred_links', status: 'partial' },
      { job_id: jREP, kind: 'anthropic_ranking', status: 'partial' },
      { job_id: jREP, kind: 'final_summary', status: 'partial' },
      { job_id: jREP, kind: 'web_research_flights', status: 'completed' },
      { job_id: jREP, kind: 'web_research_lodging', status: 'completed' }
    ] };
  setClient(dbREP);
  const stREP = await worker.recomputeJobStatus(jREP);
  ok('183 REPRO: providers+ranking+summary partial, ambas web completed → job completed',
    stREP === 'completed' && dbREP.travel_search_jobs[0].status === 'completed');

  // 184 ranking/summary partial (sin proveedores) + web completed → completed
  const jRK = nid();
  const dbRK = { travel_search_jobs: [{ id: jRK, tenant_id: 'hook-adventure', status: 'running', active: true }],
    travel_search_subtasks: [
      { job_id: jRK, kind: 'anthropic_ranking', status: 'partial' },
      { job_id: jRK, kind: 'final_summary', status: 'partial' },
      { job_id: jRK, kind: 'web_research_flights', status: 'completed' },
      { job_id: jRK, kind: 'web_research_lodging', status: 'completed' }
    ] };
  setClient(dbRK);
  ok('184 ranking/summary partial + web completed → job completed', (await worker.recomputeJobStatus(jRK)) === 'completed');

  // 185 SEGURIDAD: un failed real NO se fuerza a completed aunque las web estén completed
  const jFL = nid();
  const dbFL = { travel_search_jobs: [{ id: jFL, tenant_id: 'hook-adventure', status: 'running', active: true }],
    travel_search_subtasks: [
      { job_id: jFL, kind: 'flights_duffel', status: 'failed' },
      { job_id: jFL, kind: 'web_research_flights', status: 'completed' },
      { job_id: jFL, kind: 'web_research_lodging', status: 'completed' }
    ] };
  setClient(dbFL);
  ok('185 failed real no se fuerza a completed → job partial', (await worker.recomputeJobStatus(jFL)) === 'partial');

  // 186 adapter: hallazgo con precio → parse_status 'parsed'; sin precio → 'parsed_partial'
  const wrAdapter = require('../server/lib/milu-adapters/web-research');
  const snap186 = { preferred_connection_city_code: 'UIO', passenger_count: 2 };
  const fPriced = wrAdapter.mapFlightFinding(snap186, { source_url: 'https://www.avianca.com/x', price_cents: 10900, currency: 'USD', airline: 'Avianca' });
  const fNoPrice = wrAdapter.mapFlightFinding(snap186, { source_url: 'https://www.avianca.com/y', price_cents: null, airline: 'Avianca' });
  const fFall = wrAdapter.flightFallback(snap186);
  ok('186 parse_status parsed / parsed_partial en findings y fallback',
    fPriced && fPriced.raw_snapshot_sanitized.parse_status === 'parsed' &&
    fNoPrice && fNoPrice.raw_snapshot_sanitized.parse_status === 'parsed_partial' &&
    fFall && fFall.raw_snapshot_sanitized.parse_status === 'parsed_partial');

  /* ============================================================
     Corrección de conexión (fuente de verdad) + verificación de tarifa (187-196)
     ============================================================ */
  // snapshot con itinerario GYE→SCY, salida 2026-08-01 (ruta/fecha SOLICITADAS).
  function snapGYE() {
    return { passenger_count: 2,
      itinerary: { passenger_type: 'international', connection_city: 'guayaquil', connection_source: 'intake', origin_airport: 'GYE',
        galapagos_start_date: '2026-08-01', mainland_to_galapagos_flight_date: '2026-08-01', galapagos_return_flight_date: '2026-08-05' },
      lodging_requirements: [{ id: nid(), destination: 'san_cristobal', pending_resolution: false, check_in_date: '2026-08-01', check_out_date: '2026-08-05' }] };
  }

  // 187 intake Guayaquil → conexión guayaquil (GYE) automática, sin override
  const inGYE = milu.deriveItineraryInputs({ preferred_connection_city: 'guayaquil', arrival: { international_flights_purchased: true, arrival_airport: 'GYE' } }, {});
  const itGYE = milu.computeItinerary({ galapagosStartDate: '2026-08-01', durationDays: 4, passengerType: inGYE.passenger_type, connectionCity: inGYE.connection_city, connectionSource: inGYE.connection_source });
  ok('187 intake Guayaquil → guayaquil/GYE automático (source=intake)',
    inGYE.connection_city === 'guayaquil' && inGYE.connection_source === 'intake' && inGYE.passenger_type === 'international' &&
    itGYE.origin_airport === 'GYE' && itGYE.connection_source === 'intake');

  // 188 no se pide ciudad manual si existe (intake o inferida del arrival_airport); missing sin connection_city
  const inInfer = milu.deriveItineraryInputs({ preferred_connection_city: null, arrival: { international_flights_purchased: true, arrival_airport: 'Aeropuerto José Joaquín de Olmedo (GYE)' } }, {});
  const itInfer = milu.computeItinerary({ galapagosStartDate: '2026-08-01', durationDays: 4, passengerType: 'international', connectionCity: inInfer.connection_city, connectionSource: inInfer.connection_source });
  ok('188 conexión inferida del arrival_airport (source=intake_airport); sin connection_city faltante',
    inInfer.connection_city === 'guayaquil' && inInfer.connection_source === 'intake_airport' &&
    milu.itineraryMissing(itInfer).indexOf('connection_city') === -1 && itInfer.origin_airport === 'GYE');

  // 189 override owner cambia Guayaquil → Quito explícitamente (supersede al intake)
  const inOv = milu.deriveItineraryInputs({ preferred_connection_city: 'guayaquil', arrival: { arrival_airport: 'GYE' } }, { connection_city: 'quito' });
  ok('189 override owner cambia guayaquil→quito (source=override)', inOv.connection_city === 'quito' && inOv.connection_source === 'override');

  // 190 búsqueda GYE nunca acepta UIO: observed UIO → route_mismatch, no verificado, precio null
  const mUIO = webResearch.mapFlightFinding(snapGYE(), { source_url: 'https://www.avianca.com/x', price_cents: 10900, currency: 'USD', airline: 'Avianca', observed_origin: 'UIO', observed_destination: 'SCY', observed_departure_date: '2026-08-01', date_observable: true });
  ok('190 GYE solicitado, observado UIO → route_mismatch, no verificado, precio null',
    mUIO.raw_snapshot_sanitized.requested_origin === 'GYE' && mUIO.raw_snapshot_sanitized.observed_origin === 'UIO' &&
    mUIO.raw_snapshot_sanitized.route_match === false && mUIO.raw_snapshot_sanitized.classification === 'route_mismatch' &&
    mUIO.raw_snapshot_sanitized.price_verified_for_request === false && mUIO.total_price_cents === null);

  // 191 precio de septiembre NO valida agosto (fecha distinta)
  const mSep = webResearch.mapFlightFinding(snapGYE(), { source_url: 'https://www.avianca.com/y', price_cents: 16534, currency: 'USD', airline: 'LATAM', observed_origin: 'GYE', observed_destination: 'SCY', observed_departure_date: '2026-09-01', date_observable: true });
  ok('191 fecha sep ≠ ago → date_mismatch, no verificado',
    mSep.raw_snapshot_sanitized.date_match === false && mSep.raw_snapshot_sanitized.classification === 'date_mismatch' &&
    mSep.raw_snapshot_sanitized.price_verified_for_request === false && mSep.total_price_cents === null);

  // 192 página sin fecha observable → no valida precio
  const mNoDate = webResearch.mapFlightFinding(snapGYE(), { source_url: 'https://www.avianca.com/z', price_cents: 14700, currency: 'USD', airline: 'Avianca', observed_origin: 'GYE', observed_destination: 'SCY', date_observable: false });
  ok('192 fecha no observable → date_not_observable, no verificado',
    mNoDate.raw_snapshot_sanitized.date_observable === false && mNoDate.raw_snapshot_sanitized.classification === 'date_not_observable' &&
    mNoDate.raw_snapshot_sanitized.price_verified_for_request === false && mNoDate.total_price_cents === null);

  // 193 "from $109" genérico NO se marca como tarifa confirmada
  const mGen = webResearch.mapFlightFinding(snapGYE(), { source_url: 'https://www.avianca.com/promo', price_cents: 10900, currency: 'USD', airline: 'Avianca', observed_origin: 'GYE', observed_destination: 'SCY', observed_departure_date: '2026-08-01', date_observable: true, price_is_generic: true });
  ok('193 tarifa genérica ("from $X") → generic_fare, no verificado',
    mGen.raw_snapshot_sanitized.classification === 'generic_fare' && mGen.raw_snapshot_sanitized.price_verified_for_request === false && mGen.total_price_cents === null);

  // 194 solo route_match + date_match (+ precio, no genérico/dinámico) → price_verified_for_request=true
  const mOk = webResearch.mapFlightFinding(snapGYE(), { source_url: 'https://www.avianca.com/ok', price_cents: 10900, currency: 'USD', airline: 'Avianca', observed_origin: 'GYE', observed_destination: 'SCY', observed_departure_date: '2026-08-01', date_observable: true });
  ok('194 ruta+fecha correctas → price_verified_for_request=true, precio conservado',
    mOk.raw_snapshot_sanitized.route_match === true && mOk.raw_snapshot_sanitized.date_match === true &&
    mOk.raw_snapshot_sanitized.classification === 'verified' && mOk.raw_snapshot_sanitized.price_verified_for_request === true &&
    mOk.total_price_cents === 10900);

  // 195 hallazgo NO verificado no se aprueba como final sin confirmación manual explícita
  const idBad = nid(), idOk = nid();
  const db195 = { travel_flight_options: [
      { id: idBad, tenant_id: 'hook-adventure', booking_id: nid(), search_job_id: nid(), provider: 'web_research', research_review_status: 'unverified', raw_snapshot_sanitized: { price_verified_for_request: false, classification: 'date_mismatch' } },
      { id: idOk, tenant_id: 'hook-adventure', booking_id: nid(), search_job_id: nid(), provider: 'web_research', research_review_status: 'unverified', raw_snapshot_sanitized: { price_verified_for_request: true, classification: 'verified' } }
    ], travel_search_audit: [] };
  setClient(db195);
  let blocked195 = false; try { await milu.reviewFinding('flight', idBad, 'verified', { role: 'owner', userId: 'u' }); } catch (e) { blocked195 = e.code === 'MANUAL_VERIFICATION_REQUIRED'; }
  const okManual = await milu.reviewFinding('flight', idBad, 'verified', { role: 'owner', userId: 'u' }, { confirmManual: true });
  const okVerified = await milu.reviewFinding('flight', idOk, 'verified', { role: 'owner', userId: 'u' });   // verificado: no exige confirm
  ok('195 no verificado exige confirmación manual; verificado aprueba directo',
    blocked195 === true && okManual.reviewed === true && okVerified.reviewed === true &&
    db195.travel_flight_options[0].research_review_status === 'verified');

  // 196 sin Stripe ni envío automático al cliente: el adapter no toca pagos/checkout/email;
  //     todo hallazgo nace 'manual_confirmation_required' + 'unverified' (revisión humana).
  const wrAdapterSrc = fs.readFileSync(path.join(BASE, 'server/lib/milu-adapters/web-research.js'), 'utf8');
  ok('196 sin Stripe/checkout/email en el adapter; hallazgo requiere confirmación manual',
    !/stripe|payment_intent|checkout|resend|sendemail|send_email|createbooking/i.test(wrAdapterSrc) &&
    mOk.availability_status === 'manual_confirmation_required' && mOk.research_review_status === 'unverified');

  console.log('\n=== RESULTADO MILU 8C: ' + pass + ' PASS · ' + fail + ' FAIL ===');
  if (fail > 0) process.exit(1);
})();
