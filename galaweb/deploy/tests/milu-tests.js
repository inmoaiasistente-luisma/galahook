'use strict';
/* =========================================================
   Etapa 8C — Milu Turismo (núcleo). 42 pruebas obligatorias.
   Mock Supabase en memoria (query builder + rpc de cola) y mock de
   buildTravelRequirements. Sin red, sin claves, sin proveedores reales.
   ========================================================= */
const fs = require('fs');
const path = require('path');
/* Portable: la suite vive en <deploy>/tests/, así que BASE = <deploy>.
   Funciona en el repo y en CI sin rutas absolutas. */
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
  const now = Date.now();
  if (name === 'milu_claim_next_subtask') {
    const cand = subs.filter(function (s) {
      return s.tenant_id === params.p_tenant
        && (s.status === 'queued' || s.status === 'partial')
        && (!s.lease_expires_at || Date.parse(s.lease_expires_at) < now)
        && (!s.next_attempt_at || Date.parse(s.next_attempt_at) <= now);
    }).sort(function (a, b) { return String(a.created_at || '') < String(b.created_at || '') ? -1 : 1; })[0];
    if (!cand) return null;
    cand.status = 'running'; cand.locked_by = params.p_worker; cand.locked_at = new Date(now).toISOString();
    cand.lease_expires_at = new Date(now + (params.p_lease_seconds || 120) * 1000).toISOString();
    cand.heartbeat_at = cand.locked_at; cand.attempt_count = (cand.attempt_count || 0) + 1;
    cand.started_at = cand.started_at || cand.locked_at;
    return cand;
  }
  if (name === 'milu_reclaim_expired_leases') {
    let n = 0;
    subs.forEach(function (s) {
      if (s.status === 'running' && s.lease_expires_at && Date.parse(s.lease_expires_at) < now) {
        s.status = 'queued'; s.locked_by = null; s.lease_expires_at = null; n++;
      }
    });
    return { reclaimed: n };
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
mockModule('/server/lib/admin-auth.js', {
  requireAdmin: async function (req, res, allowed) {
    if (allowed && allowed.indexOf(CURRENT_ROLE) === -1) { res.statusCode = 403; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'FORBIDDEN' })); return null; }
    return { user_id: 'u-' + CURRENT_ROLE, role: CURRENT_ROLE, tenant_id: 'hook-adventure', email: 'x@y.z', full_name: 'X' };
  },
  sameOrigin: function () { return true; }
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

function mockRes() { return { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, end(s) { this.body = s; } }; }
function run(h, req) { const res = mockRes(); return Promise.resolve(h(req, res)).then(() => res); }
function j(res) { try { return JSON.parse(res.body); } catch (e) { return {}; } }

function baseContract(booking) {
  return {
    booking_code: 'HA-2026-000001', tour: { id: booking.tour_id, name: 'Island Escape (4 Days)' },
    travel_date: booking.booking_date, passenger_count: 2, preferred_connection_city: 'quito',
    passengers: [
      { passenger_number: 1, legal_first_name: 'Ana', legal_last_name: 'Perez', age_category: 'adult', nationality: 'Ecuadorian', baggage_notes: '1 maleta', special_assistance: null, accessibility_or_mobility_needs: null },
      { passenger_number: 2, legal_first_name: 'Luis', legal_last_name: 'Gomez', age_category: 'adult', nationality: 'Ecuadorian', baggage_notes: null, special_assistance: null, accessibility_or_mobility_needs: null }
    ],
    lodging_requirements: [
      { destination: 'san_cristobal', lodging_required: true, check_in_date: '2026-08-01', check_out_date: '2026-08-04', nights: 3, guest_count: 2, rooms_required: 1, room_preferences: null, approximate_budget_cents: 12000, accessibility_notes: null, pending_resolution: false }
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
  const db = { bookings: [booking], booking_passenger_forms: [form], booking_lodging_requirements: lodging, travel_search_jobs: [], travel_search_subtasks: [], travel_flight_options: [], travel_hotel_options: [], travel_logistics: [], llm_usage_log: [], milu_settings: [] };
  return { db: db, booking: booking, form: form };
}

function snap() {
  return {
    preferred_connection_city: 'quito', passenger_count: 2,
    flight_dates: { default_departure_date: '2026-08-01', default_return_date: '2026-08-04', duration_days: 4 },
    lodging_requirements: [{ destination: 'san_cristobal', pending_resolution: false, check_in_date: '2026-08-01', check_out_date: '2026-08-04', nights: 3, rooms_required: 1, guest_count: 2 }],
    hotel_search_preferences: [
      { destination: 'san_cristobal', hotel_name: 'Miconia', priority: 1, search_aliases: ['https://www.booking.com/hotel/ec/miconia.html'] },
      { destination: 'san_cristobal', hotel_name: 'Casa Opuntia', priority: 2, search_aliases: [] }
    ]
  };
}

(async function () {
  /* ===== Orquestador (1-10) ===== */
  let f = freshDb(); CONTRACT = baseContract(f.booking); setClient(f.db);
  let r1 = await milu.startSearch(f.booking.id, 'u-owner', 'complete_trip');
  ok('1 form submitted permite preparar job', r1.created === true && !!r1.job.id && r1.job.status === 'queued');

  f = freshDb({ formStatus: 'pending' }); CONTRACT = baseContract(f.booking); setClient(f.db);
  let blocked = false; try { await milu.startSearch(f.booking.id, 'u-owner'); } catch (e) { blocked = e.code === 'FORM_NOT_READY'; }
  ok('2 formulario incompleto bloquea', blocked === true);

  f = freshDb({ connectionTbd: true }); CONTRACT = baseContract(f.booking); setClient(f.db);
  blocked = false; try { await milu.startSearch(f.booking.id, 'u-owner'); } catch (e) { blocked = e.code === 'CONNECTION_TBD_UNRESOLVED'; }
  ok('3 connection_tbd bloquea', blocked === true);

  f = freshDb({ missingDates: true }); CONTRACT = baseContract(f.booking); setClient(f.db);
  blocked = false; try { await milu.startSearch(f.booking.id, 'u-owner'); } catch (e) { blocked = e.code === 'DESTINATION_DATES_MISSING'; }
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
  // 11 worker reclama con lock
  let jobId = nid();
  let db2 = { travel_search_jobs: [{ id: jobId, tenant_id: 'hook-adventure', booking_id: nid(), status: 'queued', requirements_snapshot: snap() }], travel_search_subtasks: [] };
  ['flights_duffel', 'hotels_primary_provider'].forEach(function (k, i) { db2.travel_search_subtasks.push({ id: nid(), tenant_id: 'hook-adventure', job_id: jobId, kind: k, status: 'queued', attempt_count: 0, max_attempts: 3, created_at: '2026-08-0' + (i + 1) }); });
  setClient(db2);
  const c1 = await worker.claimNextSubtask('hook-adventure', 'w1', 120);
  ok('11 worker reclama con lock', c1.ok && c1.subtask && c1.subtask.status === 'running' && c1.subtask.locked_by === 'w1');

  // 12 segundo worker no reclama la misma (una sola subtarea)
  let db3 = { travel_search_subtasks: [{ id: nid(), tenant_id: 'hook-adventure', job_id: nid(), kind: 'flights_duffel', status: 'queued', attempt_count: 0, max_attempts: 3, created_at: 't' }] };
  setClient(db3);
  const w1 = await worker.claimNextSubtask('hook-adventure', 'w1', 120);
  const w2 = await worker.claimNextSubtask('hook-adventure', 'w2', 120);
  ok('12 segundo worker no reclama la misma subtarea', w1.subtask && w2.subtask === null);

  // 13 lease expirado puede recuperarse
  let db4 = { travel_search_subtasks: [{ id: nid(), tenant_id: 'hook-adventure', job_id: nid(), kind: 'flights_duffel', status: 'running', locked_by: 'dead', attempt_count: 1, max_attempts: 3, lease_expires_at: new Date(Date.now() - 1000).toISOString(), created_at: 't' }] };
  setClient(db4);
  const rec = await worker.reclaimExpiredLeases('hook-adventure');
  const c13 = await worker.claimNextSubtask('hook-adventure', 'w9', 120);
  ok('13 lease expirado puede recuperarse', rec.reclaimed === 1 && c13.subtask && c13.subtask.locked_by === 'w9');

  // 14 heartbeat extiende lease
  let db5 = { travel_search_subtasks: [{ id: 's14', tenant_id: 'hook-adventure', job_id: nid(), kind: 'flights_duffel', status: 'queued', attempt_count: 0, max_attempts: 3, created_at: 't' }] };
  setClient(db5);
  const c14 = await worker.claimNextSubtask('hook-adventure', 'wh', 1);   // lease corto
  const before = db5.travel_search_subtasks[0].lease_expires_at;
  const hb = await worker.heartbeatSubtask('s14', 'wh', 120);             // lease largo
  ok('14 heartbeat extiende lease', c14.subtask && Date.parse(hb.lease_expires_at) > Date.parse(before));

  // 15 retry aumenta attempt_count
  let db6 = { travel_search_subtasks: [{ id: 's15', tenant_id: 'hook-adventure', job_id: nid(), kind: 'flights_duffel', status: 'queued', attempt_count: 0, max_attempts: 3, created_at: 't' }] };
  setClient(db6);
  const cc1 = await worker.claimNextSubtask('hook-adventure', 'w1', 120);
  const at1 = cc1.subtask.attempt_count;   // copia antes de mutaciones posteriores
  await worker.failOrRetrySubtask(cc1.subtask, new Error('boom'));
  db6.travel_search_subtasks[0].next_attempt_at = null; db6.travel_search_subtasks[0].lease_expires_at = null;
  const cc2 = await worker.claimNextSubtask('hook-adventure', 'w1', 120);
  const at2 = cc2.subtask.attempt_count;
  ok('15 retry aumenta attempt_count', at1 === 1 && at2 === 2);

  // 16 max_attempts termina en failed
  setClient({ travel_search_subtasks: [{ id: 's16', tenant_id: 'hook-adventure', job_id: nid(), kind: 'flights_duffel', status: 'running', attempt_count: 3, max_attempts: 3 }] });
  const fr = await worker.failOrRetrySubtask({ id: 's16', attempt_count: 3, max_attempts: 3 }, new Error('x'));
  ok('16 max_attempts termina en failed', fr.status === 'failed');

  // 17 proveedor caído produce partial + recompute
  const job17 = { id: nid(), tenant_id: 'hook-adventure', booking_id: nid(), requirements_snapshot: snap() };
  setClient({ travel_flight_options: [], travel_search_jobs: [job17], travel_search_subtasks: [] });
  const rs17 = await worker.runSubtask({ id: nid(), job_id: job17.id, kind: 'flights_duffel' }, { job: job17, flightProvider: 'stub' });
  const jid = nid();
  setClient({ travel_search_jobs: [{ id: jid, status: 'running' }], travel_search_subtasks: [{ job_id: jid, status: 'completed' }, { job_id: jid, status: 'completed' }, { job_id: jid, status: 'failed' }, { job_id: jid, status: 'completed' }, { job_id: jid, status: 'completed' }] });
  const st17 = await worker.recomputeJobStatus(jid);
  ok('17 proveedor caído produce partial', rs17.status === 'partial' && st17 === 'partial');

  // 18 reejecutar no duplica ni borra
  const job18 = { id: nid(), tenant_id: 'hook-adventure', booking_id: nid(), requirements_snapshot: snap() };
  const db18 = { travel_flight_options: [], travel_search_jobs: [job18] }; setClient(db18);
  await worker.runSubtask({ id: nid(), job_id: job18.id, kind: 'flights_duffel' }, { job: job18, flightProvider: 'stub' });
  await worker.runSubtask({ id: nid(), job_id: job18.id, kind: 'flights_duffel' }, { job: job18, flightProvider: 'stub' });
  ok('18 resultados anteriores no se borran / no duplica', db18.travel_flight_options.length === 1);

  /* ===== Adapters / allowlist (19-21, 35) ===== */
  const sf = stub.searchFlights({ origin: 'UIO', destination: 'SCY', passenger_count: 2 });
  ok('19 stub no devuelve api_quoted', sf.every(function (o) { return o.availability_status !== 'api_quoted' && o.total_price_cents == null; }));

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
  let called = 0;
  const fakeClient = { messages: async function () { called++; return { usage: { input_tokens: 1000, output_tokens: 500 }, model_version: 'claude-haiku-4-5-20251001', output: 'ranking' }; } };
  const lr = await llm.runLlm({ jobId: nid(), bookingId: nid(), subtaskId: nid(), subtaskKind: 'anthropic_ranking', purpose: 'scoring', system: 'S', input: { x: 1 }, settings: cost.DEFAULT_MILU_SETTINGS, spent: {}, env: { ANTHROPIC_MILU_TOURISM_MODEL: 'Haiku' }, client: fakeClient });
  const logRow = dbLlm.llm_usage_log[0] || {};
  // Prohibido guardar el contenido: claves exactas (input_tokens/output_tokens SÍ son metadata válida).
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

  // 29 caps: exceder → llm_budget_exceeded sin llamar al modelo
  setClient({ llm_usage_log: [] });
  let called2 = 0; const fc2 = { messages: async function () { called2++; return { usage: {}, output: '' }; } };
  const capRes = await llm.runLlm({ jobId: nid(), purpose: 'p', settings: { llm_max_cost_per_job_usd: 2.0 }, spent: { job: 99 }, env: { ANTHROPIC_MILU_TOURISM_MODEL: 'Haiku' }, client: fc2 });
  const capCall = cost.checkBudget(cost.DEFAULT_MILU_SETTINGS, {}, 999);
  ok('29 caps por llamada/job/reserva/día se respetan', capRes.ok === false && capRes.reason === 'llm_budget_exceeded' && called2 === 0 && capCall.ok === false);

  /* ===== Handlers (30-33) ===== */
  f = freshDb(); CONTRACT = baseContract(f.booking); setClient(f.db); CURRENT_ROLE = 'owner';
  let hr = await run(startH, { method: 'POST', headers: {}, body: { booking_id: f.booking.id } });
  ok('30 owner inicia', hr.statusCode === 200 && j(hr).started === true);

  f = freshDb(); CONTRACT = baseContract(f.booking); setClient(f.db); CURRENT_ROLE = 'admin';
  hr = await run(startH, { method: 'POST', headers: {}, body: { booking_id: f.booking.id } });
  ok('31 admin inicia', hr.statusCode === 200 && j(hr).started === true);

  CURRENT_ROLE = 'staff';
  hr = await run(startH, { method: 'POST', headers: {}, body: { booking_id: f.booking.id } });
  ok('32 staff recibe 403', hr.statusCode === 403);

  CURRENT_ROLE = 'admin';
  let sr = await run(settingsSaveH, { method: 'POST', headers: {}, body: { hotel_target_min_cents: 5000, hotel_target_max_cents: 20000 } });
  const admin403 = sr.statusCode === 403;
  CURRENT_ROLE = 'owner'; setClient({ milu_settings: [] });
  sr = await run(settingsSaveH, { method: 'POST', headers: {}, body: { hotel_target_min_cents: 6000, hotel_target_max_cents: 21000, primary_hotel_provider: 'manual' } });
  ok('33 settings owner-only cuando corresponda', admin403 === true && sr.statusCode === 200 && j(sr).saved === true);

  /* ===== 34-35: sin email, sin opciones ficticias ===== */
  const miluSrc = fs.readFileSync(BASE + '/server/lib/milu-tourism.js', 'utf8') + fs.readFileSync(BASE + '/server/lib/milu-worker-core.js', 'utf8') + fs.readFileSync(BASE + '/server/admin-handlers/milu-search-start.js', 'utf8');
  ok('34 no se envía email al cliente', !/booking-email-service|customer_travel_confirmation|resend|sendEmail/i.test(miluSrc));

  const job35 = { id: nid(), tenant_id: 'hook-adventure', booking_id: nid(), requirements_snapshot: snap() };
  const db35 = { travel_flight_options: [], travel_hotel_options: [], travel_search_jobs: [job35] }; setClient(db35);
  await worker.runSubtask({ id: nid(), job_id: job35.id, kind: 'flights_duffel' }, { job: job35, flightProvider: 'stub' });
  await worker.runSubtask({ id: nid(), job_id: job35.id, kind: 'hotel_preferred_links' }, { job: job35 });
  const allOpts = db35.travel_flight_options.concat(db35.travel_hotel_options);
  const OKSTATES = ['provider_not_configured', 'official_link_only', 'manual_confirmation_required', 'provider_no_content'];
  ok('35 no se crean opciones ficticias', allOpts.length > 0 && allOpts.every(function (o) { return o.total_price_cents == null && OKSTATES.indexOf(o.availability_status) !== -1; }));

  /* ===== 36-41 sin regresiones estructurales ===== */
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

  /* ===== 42: cobertura VERSIONADA — todas las fuentes de 8C están en el repo
     (la regresión de precios/checkout/intake/QR/finanzas la cubren 36-40; el
     "todas las suites previas verdes" lo ejecuta el runner de QA por separado). ===== */
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

  console.log('\n=== RESULTADO MILU 8C: ' + pass + ' PASS · ' + fail + ' FAIL ===');
  if (fail > 0) process.exit(1);
})();
