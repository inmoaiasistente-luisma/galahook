'use strict';

/* =========================================================
   Pruebas — Reseñas por QR (API pública y moderación)
   ---------------------------------------------------------
   Ejecutan los handlers REALES con la autenticación y el limitador
   reales. Solo se sustituye Supabase (en memoria), sin red ni gasto.
   Los casos de abuso del tier HIGH viven aquí para
   que se repitan en cada corrida.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BASE = path.resolve(__dirname, '..');
const { createFakeSupabase } = require('./helpers/fake-supabase');

process.env.SESSION_SECRET = 'test-secret-for-reviews';
process.env.TENANT_ID = 'hook-adventure';

let fake = createFakeSupabase();
require.cache[require.resolve(BASE + '/server/lib/supabase')] = {
  id: 'fake', filename: 'fake', loaded: true, exports: { getSupabase: function () { return fake; } }
};

const auth = require(BASE + '/server/lib/admin-auth');
const reviewsApi = require(BASE + '/api/reviews');
const listHandler = require(BASE + '/server/admin-handlers/reviews-list');
const updateHandler = require(BASE + '/server/admin-handlers/review-update');
const settingsHandler = require(BASE + '/server/admin-handlers/review-settings-save');
const router = require(BASE + '/api/admin-router');
const lib = require(BASE + '/server/lib/reviews');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

const HOST = 'www.galapagoshookadventure.com';
const OWNER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const STAFF = '33333333-3333-4333-8333-333333333333';

function cookieFor(userId, role) {
  const t = auth.createSessionToken(process.env.SESSION_SECRET, {
    user_id: userId, email: role + '@example.com', full_name: role, role: role, tenant_id: 'hook-adventure'
  });
  return auth.COOKIE_NAME + '=' + t;
}

async function call(handler, o) {
  o = o || {};
  const headers = Object.assign({ host: HOST, origin: 'https://' + HOST, 'x-forwarded-for': o.ip || '203.0.113.7' }, o.headers || {});
  if (o.noOrigin) delete headers.origin;
  if (o.as) headers.cookie = cookieFor(o.as === 'owner' ? OWNER : o.as === 'admin' ? ADMIN : STAFF, o.as);
  const req = { method: o.method || 'POST', headers: headers, body: o.body === undefined ? {} : o.body, url: o.url || '/', query: o.query || {} };
  const res = {
    statusCode: 200, headers: {}, payload: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(s) { this.payload = s ? JSON.parse(s) : null; }
  };
  await handler(req, res);
  return res;
}

function freshDb(extra) {
  fake = createFakeSupabase(Object.assign({
    admin_profiles: [
      { user_id: OWNER, tenant_id: 'hook-adventure', full_name: 'Owner', role: 'owner', active: true },
      { user_id: ADMIN, tenant_id: 'hook-adventure', full_name: 'Admin', role: 'admin', active: true },
      { user_id: STAFF, tenant_id: 'hook-adventure', full_name: 'Staff', role: 'staff', active: true }
    ],
    reviews: [], review_settings: [], rate_limit_hits: [], admin_audit_log: []
  }, extra || {}));
  fake.db.unique.reviews = 'client_key';
  return fake;
}

function good(over) {
  return Object.assign({
    client_key: crypto.randomUUID(), rating: 5, name: 'Camila R.', text: 'Vimos tiburones martillo.',
    lang: 'es', opened_google: true, company: ''
  }, over || {});
}

function seedRow(over) {
  const r = Object.assign({
    id: crypto.randomUUID(), tenant_id: 'hook-adventure', created_at: '2026-10-20T15:00:00.000Z',
    rating: 5, body: 'Vimos tiburones martillo.', author_name: 'Camila R.', lang: 'es', opened_google: true,
    status: 'pending', trip: null, reject_reason: null, consent_version: 'v1',
    client_key: crypto.randomUUID(), handled_by: null, handled_at: null, published_at: null
  }, over || {});
  fake.db.tables.reviews.push(r);
  return r;
}

(async function main() {
  /* ---------------- A) POST público: validación y abuso ---------------- */
  freshDb();
  let r = await call(reviewsApi, { method: 'PUT' });
  ok('1 método no permitido → 405', r.statusCode === 405);

  r = await call(reviewsApi, { body: good(), headers: { origin: 'https://evil.example' } });
  ok('2 ABUSO otro origen → 403 y nada guardado', r.statusCode === 403 && fake.db.tables.reviews.length === 0);

  r = await call(reviewsApi, { body: good({ status: 'published' }) });
  ok('3 ABUSO intenta publicarse sola (clave desconocida) → 400', r.statusCode === 400 && fake.db.tables.reviews.length === 0);

  r = await call(reviewsApi, { body: good({ company: 'Bot SA' }) });
  ok('4 ABUSO honeypot → finge éxito y no guarda', r.statusCode === 200 && r.payload.ok === true && fake.db.tables.reviews.length === 0);

  for (const bad of [0, 6, 3.5, '5', null]) {
    r = await call(reviewsApi, { body: good({ rating: bad }) });
    ok('5 estrellas inválidas ' + JSON.stringify(bad) + ' → 400', r.statusCode === 400 && r.payload.error === 'INVALID_RATING');
  }
  r = await call(reviewsApi, { body: good({ name: ' a ' }) });
  ok('6 nombre de 1 letra → 400', r.statusCode === 400 && r.payload.error === 'INVALID_NAME');
  r = await call(reviewsApi, { body: good({ name: 'x'.repeat(81) }) });
  ok('7 nombre de 81 → 400', r.statusCode === 400 && r.payload.error === 'INVALID_NAME');
  r = await call(reviewsApi, { body: good({ text: 'x'.repeat(1001) }) });
  ok('8 texto de 1001 → 400', r.statusCode === 400 && r.payload.error === 'TEXT_TOO_LONG');
  r = await call(reviewsApi, { body: good({ lang: 'fr' }) });
  ok('9 idioma fuera de en/es → 400', r.statusCode === 400 && r.payload.error === 'INVALID_LANG');
  r = await call(reviewsApi, { body: good({ client_key: 'nope' }) });
  ok('10 client_key que no es UUID → 400', r.statusCode === 400 && r.payload.error === 'INVALID_KEY');
  r = await call(reviewsApi, { body: good({ text: ['x'] }) });
  ok('11 texto que no es cadena → 400', r.statusCode === 400 && r.payload.error === 'INVALID_TEXT');

  r = await call(reviewsApi, { body: good({ text: 'hola\x00\x07 mundo', name: ' Camila  ' }) });
  const saved = fake.db.tables.reviews[0];
  ok('12 válida → 201', r.statusCode === 201 && r.payload.ok === true);
  ok('13 siempre entra pendiente', saved.status === 'pending');
  ok('14 quita caracteres de control y espacios', saved.body === 'hola mundo' && saved.author_name === 'Camila');
  ok('15 guarda versión del consentimiento', saved.consent_version === lib.CONSENT_VERSION);
  ok('16 no guarda IP', !Object.keys(saved).some(function (k) { return /ip/i.test(k); }) && JSON.stringify(saved).indexOf('203.0.113') === -1);

  r = await call(reviewsApi, { body: good({ text: '   ' }), ip: '203.0.113.8' });
  ok('17 sin texto se acepta (solo estrellas)', r.statusCode === 201 && fake.db.tables.reviews[1].body === null);

  freshDb();
  const key = crypto.randomUUID();
  await call(reviewsApi, { body: good({ client_key: key, opened_google: false, text: 'original' }) });
  r = await call(reviewsApi, { body: good({ client_key: key, opened_google: true, text: 'cambiado', rating: 1 }) });
  const same = fake.db.tables.reviews;
  ok('18 reintento con la misma clave no duplica', r.statusCode === 200 && same.length === 1);
  ok('19 reintento marca que abrió Google', same[0].opened_google === true);
  ok('20 ABUSO reintento no cambia texto ni estrellas', same[0].body === 'original' && same[0].rating === 5);
  await call(reviewsApi, { body: good({ client_key: key, opened_google: false }) });
  ok('21 un reintento no apaga el dato de Google', same[0].opened_google === true);

  freshDb();
  let last = null;
  for (let i = 0; i < 13; i++) { last = await call(reviewsApi, { body: good({ text: 'n' + i }), ip: '198.51.100.9' }); }
  ok('22 ABUSO límite por IP → 429 con Retry-After', last.statusCode === 429 && !!last.headers['retry-after']);
  ok('23 el límite corta en 12 guardadas', fake.db.tables.reviews.length === 12);
  ok('24 el limitador no guarda la IP en claro', JSON.stringify(fake.db.tables.rate_limit_hits).indexOf('198.51.100.9') === -1);
  r = await call(reviewsApi, { body: good(), ip: '198.51.100.10' });
  ok('25 otra IP sigue pudiendo', r.statusCode === 201);

  /* ---------------- B) GET público ---------------- */
  freshDb();
  seedRow({ status: 'pending', body: 'PENDIENTE' });
  seedRow({ status: 'rejected', body: 'RECHAZADA', reject_reason: 'spam' });
  for (let i = 1; i <= 5; i++) {
    seedRow({ status: 'published', body: 'pub' + i, published_at: '2026-10-0' + i + 'T10:00:00.000Z', handled_by: 'owner@example.com', trip: 'day_tour' });
  }
  fake.db.tables.review_settings.push({ tenant_id: 'hook-adventure', google_rating: 5, google_count: 2 });
  r = await call(reviewsApi, { method: 'GET' });
  const text = JSON.stringify(r.payload);
  ok('26 ABUSO GET no filtra pendientes ni rechazadas', text.indexOf('PENDIENTE') === -1 && text.indexOf('RECHAZADA') === -1);
  ok('27 GET devuelve las 4 más nuevas en orden', r.payload.reviews.length === 4 && r.payload.reviews[0].body === 'pub5' && r.payload.reviews[3].body === 'pub2');
  ok('28 ABUSO GET solo campos públicos', Object.keys(r.payload.reviews[0]).sort().join() === 'author_name,body,lang,month,rating,trip');
  ok('29 GET da el mes, no el día', r.payload.reviews[0].month === '2026-10');
  ok('30 GET se puede cachear', /s-maxage=60/.test(r.headers['cache-control'] || ''));
  ok('31 GET trae la nota de Google', r.payload.google.rating === 5 && r.payload.google.count === 2);
  ok('32 GET listo', r.payload.ready === true);

  freshDb();
  r = await call(reviewsApi, { method: 'GET' });
  ok('33 sin ajustes no inventa nota', r.payload.google === null && r.payload.reviews.length === 0);
  fake.db.fail.reviews = { code: '42P01', message: 'relation "public.reviews" does not exist' };
  r = await call(reviewsApi, { method: 'GET' });
  ok('34 sin migración responde ready:false', r.statusCode === 200 && r.payload.ready === false && r.payload.reviews.length === 0);

  /* ---------------- C) Lista del panel ---------------- */
  freshDb();
  seedRow({ status: 'pending', opened_google: true });
  seedRow({ status: 'pending', opened_google: false });
  seedRow({ status: 'published', published_at: '2026-10-05T10:00:00.000Z' });
  seedRow({ status: 'pending', body: null, opened_google: false });
  r = await call(listHandler, { method: 'GET' });
  ok('35 ABUSO lista sin sesión → 401', r.statusCode === 401);
  r = await call(listHandler, { method: 'GET', as: 'staff' });
  ok('36 ABUSO lista con staff → 403', r.statusCode === 403);
  r = await call(listHandler, { method: 'GET', as: 'admin' });
  ok('37 admin puede leer', r.statusCode === 200 && r.payload.rows.length === 4);
  r = await call(listHandler, { method: 'GET', as: 'owner', query: { status: 'pending' } });
  ok('38 pendientes solo con texto', r.payload.rows.length === 2 && r.payload.rows.every(function (x) { return x.status === 'pending' && x.body; }));
  ok('39 conteos para pestañas e insignia', r.payload.counts.pending === 2 && r.payload.counts.published === 1 && r.payload.counts.rejected === 0 && r.payload.counts.rating_only === 1);
  ok('40 cuenta quién abrió Google', r.payload.counts.total === 4 && r.payload.counts.opened_google === 2);
  ok('41 ABUSO el panel no recibe client_key', JSON.stringify(r.payload).indexOf('client_key') === -1);
  r = await call(listHandler, { method: 'GET', as: 'owner', query: { status: 'rating_only' } });
  ok('41b pestaña de solo estrellas', r.payload.rows.length === 1 && r.payload.rows[0].body === null);
  r = await call(listHandler, { method: 'GET', as: 'owner', query: { status: 'hackeado' } });
  ok('42 estado inválido → 400', r.statusCode === 400);
  fake.db.fail.reviews = { code: '42P01', message: 'relation "public.reviews" does not exist' };
  r = await call(listHandler, { method: 'GET', as: 'owner' });
  ok('43 sin migración el panel recibe ready:false', r.statusCode === 200 && r.payload.ready === false);

  /* ---------------- D) Moderación ---------------- */
  freshDb();
  let row = seedRow();
  const pub = { id: row.id, action: 'publish', trip: 'diving' };
  r = await call(updateHandler, { body: pub });
  ok('44 ABUSO publicar sin sesión → 401', r.statusCode === 401 && row.status === 'pending');
  r = await call(updateHandler, { body: pub, as: 'admin' });
  ok('45 ABUSO publicar como admin → 403', r.statusCode === 403 && row.status === 'pending');
  r = await call(updateHandler, { body: pub, as: 'staff' });
  ok('46 ABUSO publicar como staff → 403', r.statusCode === 403 && row.status === 'pending');
  r = await call(updateHandler, { body: pub, as: 'owner', headers: { origin: 'https://evil.example' } });
  ok('47 ABUSO owner desde otro origen → 403', r.statusCode === 403 && row.status === 'pending');
  r = await call(updateHandler, { body: Object.assign({ body: 'reescrita' }, pub), as: 'owner' });
  ok('48 ABUSO no se puede reescribir la reseña', r.statusCode === 400 && row.body === 'Vimos tiburones martillo.');
  r = await call(updateHandler, { body: { id: 'x', action: 'publish' }, as: 'owner' });
  ok('49 id inválido → 400', r.statusCode === 400);
  r = await call(updateHandler, { body: { id: crypto.randomUUID(), action: 'publish' }, as: 'owner' });
  ok('50 id inexistente → 404', r.statusCode === 404);
  r = await call(updateHandler, { body: { id: row.id, action: 'borrar' }, as: 'owner' });
  ok('51 acción inválida → 400', r.statusCode === 400);
  r = await call(updateHandler, { body: { id: row.id, action: 'publish', trip: 'otro' }, as: 'owner' });
  ok('52 viaje inválido → 400', r.statusCode === 400 && r.payload.error === 'INVALID_TRIP');
  r = await call(updateHandler, { body: { id: row.id, action: 'publish', translation: 'x' }, as: 'owner' });
  ok('53 ABUSO ya no acepta traducción', r.statusCode === 400 && row.status === 'pending');
  r = await call(updateHandler, { body: pub, as: 'owner' });
  ok('54 owner publica', r.statusCode === 200 && row.status === 'published');
  ok('55 guarda el viaje', row.trip === 'diving');
  ok('56 registra quién y cuándo', row.handled_by === 'owner@example.com' && !!row.published_at && !!row.handled_at);
  ok('57 el texto del pasajero queda igual', row.body === 'Vimos tiburones martillo.');
  ok('58 deja auditoría', fake.db.tables.admin_audit_log.length === 1);
  r = await call(updateHandler, { body: pub, as: 'owner' });
  ok('59 no se publica dos veces', r.statusCode === 409);

  row = seedRow({ body: null });
  r = await call(updateHandler, { body: { id: row.id, action: 'publish' }, as: 'owner' });
  ok('60 solo estrellas no se publica en el muro', r.statusCode === 409 && r.payload.error === 'RATING_ONLY' && row.status === 'pending');

  row = seedRow();
  r = await call(updateHandler, { body: { id: row.id, action: 'reject' }, as: 'owner' });
  ok('61 rechazar exige motivo', r.statusCode === 400 && r.payload.error === 'INVALID_REASON');
  r = await call(updateHandler, { body: { id: row.id, action: 'reject', reason: 'nota_baja' }, as: 'owner' });
  ok('62 una nota baja no es motivo', r.statusCode === 400 && row.status === 'pending');
  r = await call(updateHandler, { body: { id: row.id, action: 'reject', reason: 'spam' }, as: 'owner' });
  ok('63 rechazo con motivo válido', r.statusCode === 200 && row.status === 'rejected' && row.reject_reason === 'spam');
  r = await call(updateHandler, { body: { id: row.id, action: 'pending' }, as: 'owner' });
  ok('64 volver a pendiente limpia el rechazo', r.statusCode === 200 && row.status === 'pending' && row.reject_reason === null && row.handled_by === null);

  row = seedRow({ status: 'published', published_at: '2026-10-05T10:00:00.000Z' });
  await call(updateHandler, { body: { id: row.id, action: 'pending' }, as: 'owner' });
  ok('65 despublicar la saca del muro', row.status === 'pending' && row.published_at === null);

  /* ---------------- E) Nota de Google ---------------- */
  freshDb();
  r = await call(settingsHandler, { body: { google_rating: 4.8, google_count: 12 }, as: 'admin' });
  ok('84 ABUSO cambiar nota como admin → 403', r.statusCode === 403);
  for (const bad of [{ google_rating: 5.5, google_count: 2 }, { google_rating: 0.5, google_count: 2 }, { google_rating: 4.8, google_count: -1 }, { google_rating: 4.8, google_count: 1.5 }, { google_rating: 4.83, google_count: 2 }]) {
    r = await call(settingsHandler, { body: bad, as: 'owner' });
    ok('85 nota inválida ' + JSON.stringify(bad) + ' → 400', r.statusCode === 400);
  }
  r = await call(settingsHandler, { body: { google_rating: 4.8, google_count: 12 }, as: 'owner' });
  const st = fake.db.tables.review_settings[0];
  ok('86 owner guarda la nota', r.statusCode === 200 && st.google_rating === 4.8 && st.google_count === 12 && st.updated_by === 'owner@example.com');
  r = await call(settingsHandler, { body: { google_rating: 4.9, google_count: 13 }, as: 'owner' });
  ok('87 actualiza la misma fila', fake.db.tables.review_settings.length === 1 && fake.db.tables.review_settings[0].google_count === 13);

  /* ---------------- F) Montaje ---------------- */
  const vercel = JSON.parse(fs.readFileSync(BASE + '/vercel.json', 'utf8'));
  const rewrites = {};
  vercel.rewrites.forEach(function (x) { rewrites[x.source] = x.destination; });
  ['reviews-list', 'review-update', 'review-settings-save'].forEach(function (a) {
    ok('88 router conoce ' + a, router.ROUTE_NAMES.indexOf(a) !== -1);
  });
  ok('89 rewrites del panel', rewrites['/api/admin-reviews'] === '/api/admin-router?action=reviews-list'
    && rewrites['/api/admin-review-update'] === '/api/admin-router?action=review-update'
    && rewrites['/api/admin-review-settings-save'] === '/api/admin-router?action=review-settings-save');
  ok('89b sin traducción: ni ruta ni rewrite', router.ROUTE_NAMES.indexOf('review-translate') === -1 && !rewrites['/api/admin-review-translate']);
  ok('89c sin traducción: ni handler ni cliente de IA', !fs.existsSync(BASE + '/server/admin-handlers/review-translate.js') && !fs.existsSync(BASE + '/server/lib/review-translate.js'));
  ok('90 ruta corta del QR', rewrites['/resena'] === '/resena.html');
  const fns = fs.readdirSync(BASE + '/api').filter(function (f) { return /\.js$/.test(f); });
  ok('91 no supera 12 funciones de Vercel', fns.length <= 12);

  const mig = fs.readFileSync(BASE + '/supabase/migrations/0026_reviews.sql', 'utf8');
  ok('92 migración crea las dos tablas', /create table public\.reviews/.test(mig) && /create table public\.review_settings/.test(mig));
  ok('93 migración protege con RLS y revoke', /alter table public\.reviews enable row level security/.test(mig)
    && /revoke all on table public\.reviews from anon, authenticated/.test(mig)
    && /revoke all on table public\.review_settings from anon, authenticated/.test(mig));
  ok('94 migración sin columna de IP', !/\bip\b\s+(inet|text)/i.test(mig));
  ok('95 publicada exige texto', /status <> 'published' or body is not null/.test(mig));
  ok('96 clave única por tenant', /unique \(tenant_id, client_key\)/.test(mig));
  ok('97 migración marcada como aplicada', /APLICADA en Producción el 2026-11-06/.test(mig) && !/NO APLICADA/.test(mig));

  console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
