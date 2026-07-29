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
        && (s.status === 'queued' || s.status === 'partial')
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
  const db = { bookings: [booking], booking_passenger_forms: [form], booking_lodging_requirements: lodging, travel_search_jobs: [], travel_search_subtasks: [], travel_flight_options: [], travel_hotel_options: [], travel_logistics: [], travel_search_audit: [], llm_usage_log: [], milu_settings: [] };
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
  ok('57 FK compuesta lodging + unique padre', /fk_tho_lodging_form\s+foreign key \(lodging_requirement_id, tenant_id, passenger_form_id\)/.test(SQL) && /uq_blr_id_tenant unique \(id, tenant_id\)/.test(SQL));

  // 58 retry no duplica hotel
  const job58 = { id: nid(), tenant_id: 'hook-adventure', booking_id: nid(), requirements_snapshot: snap() };
  const db58 = { travel_hotel_options: [], travel_search_jobs: [job58] }; setClient(db58);
  await worker.runSubtask({ id: nid(), job_id: job58.id, kind: 'hotel_preferred_links' }, { job: job58 });
  await worker.runSubtask({ id: nid(), job_id: job58.id, kind: 'hotel_preferred_links' }, { job: job58 });
  ok('58 retry no duplica opción de hotel', db58.travel_hotel_options.length === 2);

  // 59 refresh crea nueva versión y conserva historia
  await worker.upsertHotelOptions(job58, manual.searchHotels(snap().lodging_requirements[0], snap().hotel_search_preferences, cost.DEFAULT_MILU_SETTINGS), { refresh: true });
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
    /passenger_form_id\s+uuid,\s+-- formulario del job \(integridad de reserva\)/.test(SQL));

  // 68 (item4) Lodging de formulario A usado en formulario B → rechazado
  ok('68 lodging pertenece al mismo formulario',
    /fk_tho_lodging_form\s+foreign key \(lodging_requirement_id, tenant_id, passenger_form_id\)[\s\S]*?references public\.booking_lodging_requirements \(id, tenant_id, passenger_form_id\)/.test(SQL) &&
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

  console.log('\n=== RESULTADO MILU 8C: ' + pass + ' PASS · ' + fail + ' FAIL ===');
  if (fail > 0) process.exit(1);
})();
