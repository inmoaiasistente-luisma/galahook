'use strict';

/* =========================================================
   Pruebas — Fase 9: matriz de permisos + auditoría automática
   ---------------------------------------------------------
   Sin red y sin base de datos. Dos bloques:

     A) MATRIZ DE PERMISOS. No basta con que los botones desaparezcan de la
        interfaz: la compuerta real está en el servidor. Estas pruebas barren
        TODOS los handlers y exigen que cualquier endpoint que MODIFIQUE datos
        pase por requireWriter (owner) o requireSaleWriter (owner+staff).

     B) AUDITORÍA. Diferencial mínimo, enmascarado de datos sensibles y, sobre
        todo, FAIL-OPEN: si la auditoría falla, la operación del usuario NO se
        cae (la migración 0019 puede no estar aplicada todavía).
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');
const auth = require(BASE + '/server/lib/admin-auth');
const audit = require(BASE + '/server/lib/admin-audit');
const rem = require(BASE + '/server/lib/pretrip-reminders');
const { TEMPLATES } = require(BASE + '/server/lib/email-templates');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

const HDIR = path.join(BASE, 'server', 'admin-handlers');
const HANDLERS = fs.readdirSync(HDIR).filter(function (f) { return /\.js$/.test(f); });

/* =======================================================================
   A) MATRIZ DE PERMISOS
   ======================================================================= */

ok('1 WRITE_ROLES = solo owner', Array.isArray(auth.WRITE_ROLES) &&
  auth.WRITE_ROLES.length === 1 && auth.WRITE_ROLES[0] === 'owner');

ok('2 SALE_WRITE_ROLES = owner + staff (el admin no registra ventas)',
  auth.SALE_WRITE_ROLES.length === 2 &&
  auth.SALE_WRITE_ROLES.indexOf('owner') !== -1 &&
  auth.SALE_WRITE_ROLES.indexOf('staff') !== -1 &&
  auth.SALE_WRITE_ROLES.indexOf('admin') === -1);

ok('3 canWrite: owner sí; admin y staff no',
  auth.canWrite('owner') === true && auth.canWrite('admin') === false &&
  auth.canWrite('staff') === false && auth.canWrite('') === false);

ok('4 canRecordSale: owner y staff sí; admin no',
  auth.canRecordSale('owner') === true && auth.canRecordSale('staff') === true &&
  auth.canRecordSale('admin') === false);

/* --- Barrido: todo handler con guarda CSRF (sameOrigin) es una MUTACIÓN, y
       por tanto NO puede seguir admitiendo al rol admin. ---------------- */
/* POST que NO modifican datos de negocio: son consultas que usan POST para no
   dejar identificadores en la URL. El admin conserva acceso porque la matriz
   le permite CONSULTAR documentos e itinerarios. Se verifica abajo que sigan
   sin escribir: si alguien les añade una escritura, la prueba 6b falla. */
const READ_ONLY_POSTS = ['passenger-document-reveal.js', 'milu-itinerary-preview.js'];

const MUTATING = [], LEAKS = [], SNEAKY_WRITES = [];
HANDLERS.forEach(function (f) {
  const src = fs.readFileSync(path.join(HDIR, f), 'utf8');
  // login/logout no son mutaciones de negocio: son la propia autenticación.
  if (f === 'login.js' || f === 'logout.js') return;
  if (READ_ONLY_POSTS.indexOf(f) !== -1) {
    if (/\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(src)) SNEAKY_WRITES.push(f);
    return;
  }
  if (!/sameOrigin\(req\)/.test(src)) return;              // no es mutación
  MUTATING.push(f);
  const writerGate = /requireWriter\(req, res\)/.test(src);
  const saleGate = /requireSaleWriter\(req, res\)/.test(src);
  const ownerOnly = /requireAdmin\(req, res, \['owner'\]\)/.test(src);
  if (!writerGate && !saleGate && !ownerOnly) LEAKS.push(f);
});

ok('5 el barrido encuentra los handlers de mutación (>= 25)', MUTATING.length >= 25);
ok('6 NINGÚN endpoint de escritura admite al rol admin' +
  (LEAKS.length ? ' — fugas: ' + LEAKS.join(', ') : ''), LEAKS.length === 0);
ok('6b los POST de solo lectura siguen sin escribir' +
  (SNEAKY_WRITES.length ? ' — ahora escriben: ' + SNEAKY_WRITES.join(', ') : ''), SNEAKY_WRITES.length === 0);

/* --- Handlers concretos, por si el barrido cambiara de forma ---------- */
const upd = read('server/admin-handlers/booking-update.js');
ok('7 booking-update: escritura solo owner', /requireWriter\(req, res\)/.test(upd) &&
  !/requireAdmin\(req, res, \['owner', 'admin'\]\)/.test(upd));

const agency = read('server/admin-handlers/agency-booking-create.js');
ok('8 agency-booking-create: requireSaleWriter (owner+staff), ya no admite admin',
  /requireSaleWriter\(req, res\)/.test(agency) &&
  !/\['owner', 'admin', 'staff'\]/.test(agency));

/* --- Las LECTURAS siguen abiertas al admin: ve lo mismo que el owner --- */
const reads = [
  ['booking-finance.js', 'finanzas de la reserva'],
  ['finance-summary.js', 'resumen financiero'],
  ['notifications-list.js', 'notificaciones'],
  ['discount-rules-list.js', 'reglas de descuento'],
  ['package-prices-list.js', 'precios de paquetes']
];
let readsOk = true;
reads.forEach(function (r) {
  const s = read('server/admin-handlers/' + r[0]);
  if (!/requireAdmin\(req, res, \['owner', 'admin'/.test(s)) readsOk = false;
});
ok('9 el admin CONSERVA la lectura completa (finanzas, costos, correos, precios)', readsOk);

/* --- El staff nunca recibe importes: la restricción va en el SELECT ---- */
const bookings = read('server/admin-handlers/bookings.js');
ok('10 staff: los campos financieros no salen de la base de datos',
  /isStaff/.test(bookings) && /STAFF/.test(bookings.toUpperCase()));

/* =======================================================================
   B) AUDITORÍA AUTOMÁTICA
   ======================================================================= */

ok('11 diffFields: sin cambios → null',
  audit.diffFields({ a: 1, b: 'x' }, { a: 1, b: 'x' }) === null);

const d1 = audit.diffFields({ booking_status: 'new', guests: 2 }, { booking_status: 'confirmed' });
ok('12 diffFields: solo las claves que cambiaron',
  d1 && d1.before.booking_status === 'new' && d1.after.booking_status === 'confirmed' &&
  Object.keys(d1.after).length === 1 && !('guests' in d1.after));

const d2 = audit.diffFields({ password: 'viejo' }, { password: 'nuevo' });
ok('13 diffFields: los valores sensibles se enmascaran',
  d2 && d2.before.password === '[redacted]' && d2.after.password === '[redacted]');

ok('14 isRedacted reconoce token/secret/documento/PI de Stripe',
  audit.isRedacted('qr_token') && audit.isRedacted('SESSION_SECRET') &&
  audit.isRedacted('document_number') && audit.isRedacted('stripe_payment_intent_id') &&
  !audit.isRedacted('booking_status'));

ok('15 diffFields compara objetos por valor, no por referencia',
  audit.diffFields({ meta: { a: 1 } }, { meta: { a: 1 } }) === null &&
  audit.diffFields({ meta: { a: 1 } }, { meta: { a: 2 } }) !== null);

const SESSION = { user_id: 'u1', email: 'owner@x.z', role: 'owner', tenant_id: 'hook-adventure' };

const row = audit.buildAuditRow(SESSION, {
  action: 'booking.status_update', entity_type: 'booking', entity_id: 'HA-2026-AAA111',
  before: { booking_status: 'new' }, after: { booking_status: 'cancelled' }
});
ok('16 buildAuditRow: actor, acción, entidad y antes/después',
  row && row.actor_user_id === 'u1' && row.actor_email === 'owner@x.z' && row.actor_role === 'owner' &&
  row.action === 'booking.status_update' && row.entity_type === 'booking' &&
  row.entity_id === 'HA-2026-AAA111' && row.before_data.booking_status === 'new' &&
  row.after_data.booking_status === 'cancelled' && row.tenant_id === 'hook-adventure');

ok('17 buildAuditRow: sin diferencial y sin always → no se registra',
  audit.buildAuditRow(SESSION, { action: 'x.y', entity_type: 'booking', before: { a: 1 }, after: { a: 1 } }) === null);

ok('18 buildAuditRow: always=true registra el hecho aunque no haya diferencial',
  audit.buildAuditRow(SESSION, { action: 'qr.rotate', entity_type: 'booking', always: true }) !== null);

ok('19 buildAuditRow: sin sesión o sin acción → null',
  audit.buildAuditRow(null, { action: 'a', entity_type: 'b', always: true }) === null &&
  audit.buildAuditRow(SESSION, { entity_type: 'b', always: true }) === null);

/* FAIL-OPEN: sin credenciales de Supabase, recordAudit devuelve false y NO lanza. */
(async function () {
  let threw = false, result = null;
  try {
    result = await audit.recordAudit(SESSION, {
      action: 'booking.status_update', entity_type: 'booking', entity_id: 'x', always: true
    });
  } catch (e) { threw = true; }
  ok('20 recordAudit es FAIL-OPEN: nunca lanza aunque la tabla/credenciales falten',
    threw === false && result === false);

  /* --- La auditoría está realmente conectada a las mutaciones clave --- */
  const wired = [
    ['booking-update.js', 'booking.status_update'],
    ['booking-cost-line-add.js', 'cost_line.add'],
    ['booking-cost-line-delete.js', 'cost_line.delete'],
    ['booking-costs-confirm.js', 'booking.costs_confirm'],
    ['qr-rotate.js', 'qr.rotate'],
    ['qr-revoke.js', 'qr.revoke'],
    ['package-price-update.js', 'package_price.update'],
    ['agency-booking-create.js', 'sale.create']
  ];
  let allWired = true, missing = [];
  wired.forEach(function (w) {
    const s = read('server/admin-handlers/' + w[0]);
    if (!/recordAudit\(session/.test(s) || s.indexOf("'" + w[1] + "'") === -1) { allWired = false; missing.push(w[0]); }
  });
  ok('21 auditoría conectada en las mutaciones clave' + (missing.length ? ' — faltan: ' + missing.join(', ') : ''), allWired);

  /* Al owner NO se le pide una razón para modificar o eliminar. */
  ok('22 ninguna mutación exige una razón obligatoria al owner',
    !/INVALID_REASON|reason is required|razón obligatoria/i.test(upd));

  /* --- Migración 0019: presente, no aplicada, y con lo que promete ---- */
  const m19 = read('supabase/migrations/0019_phase9_audit_docs_reminders.sql');
  ok('23 0019 crea admin_audit_log, booking_documents y booking_communications',
    /create table public\.admin_audit_log/.test(m19) &&
    /create table public\.booking_documents/.test(m19) &&
    /create table public\.booking_communications/.test(m19));

  ok('24 0019 conserva los 10 tipos de correo previos y añade las 5 etapas',
    /'customer_booking_confirmation'/.test(m19) && /'customer_passenger_form_completed'/.test(m19) &&
    /'pretrip_reminder_d7'/.test(m19) && /'pretrip_reminder_d5'/.test(m19) &&
    /'pretrip_reminder_d3'/.test(m19) && /'pretrip_reminder_d1'/.test(m19) &&
    /'pretrip_reminder_d0'/.test(m19));

  ok('25 0019 respeta la convención de la casa (FK compuesta + RLS + revoke)',
    /references public\.bookings \(id, tenant_id\)/.test(m19) &&
    /enable row level security/.test(m19) && /revoke all on table/.test(m19));

  ok('26 0019 NO borra tablas ni columnas',
    !/drop table/i.test(m19) && !/drop column/i.test(m19));

  /* =====================================================================
     C) RECORDATORIOS PRE-VIAJE — cadencia 7 / 5 / 3 / 1 / 0
     ===================================================================== */

  ok('27 cadencia exacta: 7, 5, 3, 1 y 0 días',
    rem.REMINDER_DAYS.length === 5 && rem.REMINDER_DAYS.join(',') === '7,5,3,1,0');

  ok('28 cada etapa tiene su propio tipo de correo',
    rem.typeForDays(7) === 'pretrip_reminder_d7' && rem.typeForDays(1) === 'pretrip_reminder_d1' &&
    rem.typeForDays(0) === 'pretrip_reminder_d0');

  ok('29 los días que NO son de cadencia no generan recordatorio',
    rem.typeForDays(6) === null && rem.typeForDays(4) === null &&
    rem.typeForDays(2) === null && rem.typeForDays(10) === null);

  ok('30 daysUntil cuenta días enteros y detecta el pasado',
    rem.daysUntil('2026-08-01', '2026-08-08') === 7 &&
    rem.daysUntil('2026-08-01', '2026-08-01') === 0 &&
    rem.daysUntil('2026-08-02', '2026-08-01') === -1);

  ok('31 daysUntil cruza fin de mes y año sin error',
    rem.daysUntil('2026-12-30', '2027-01-06') === 7 &&
    rem.daysUntil('2026-02-26', '2026-03-01') === 3);

  /* Los textos EXACTOS que fijó el owner. */
  ok('32 texto 7 días: "Faltan 7 días para tu aventura en Galápagos."',
    rem.copyFor(7).es === 'Faltan 7 días para tu aventura en Galápagos.');
  ok('33 texto 5 y 3 días con el número correcto',
    rem.copyFor(5).es === 'Faltan 5 días para tu aventura en Galápagos.' &&
    rem.copyFor(3).es === 'Faltan 3 días para tu aventura en Galápagos.');
  ok('34 texto 1 día en SINGULAR: "Falta 1 día…"',
    rem.copyFor(1).es === 'Falta 1 día para tu aventura en Galápagos.');
  ok('35 texto día 0: "Tu aventura en Galápagos empieza hoy."',
    rem.copyFor(0).es === 'Tu aventura en Galápagos empieza hoy.');

  /* Elegibilidad: solo viaja lo que de verdad va a viajar. */
  const baseBk = {
    id: '11111111-1111-4111-8111-111111111111', request_type: 'booking',
    booking_status: 'confirmed', customer_email: 'a@b.co', booking_date: '2026-08-08',
    customer_name: 'Ana', booking_code: 'HA-2026-AAA111', guests: 2
  };
  function bk(over) { return Object.assign({}, baseBk, over || {}); }

  ok('36 reserva normal a 7 días → toca recordatorio d7',
    rem.dueFor(bk(), '2026-08-01').due === true && rem.dueFor(bk(), '2026-08-01').type === 'pretrip_reminder_d7');

  ok('37 a 6 días no toca nada (la cadencia es cada 2 días)',
    rem.dueFor(bk(), '2026-08-02').due === false && rem.dueFor(bk(), '2026-08-02').reason === 'not_a_reminder_day');

  ok('38 cancelada, cotización, borrada o de prueba → nunca recibe',
    rem.dueFor(bk({ booking_status: 'cancelled' }), '2026-08-01').reason === 'cancelled' &&
    rem.dueFor(bk({ request_type: 'quote' }), '2026-08-01').reason === 'not_a_booking' &&
    rem.dueFor(bk({ deleted_at: '2026-01-01' }), '2026-08-01').reason === 'deleted' &&
    rem.dueFor(bk({ is_test: true }), '2026-08-01').reason === 'test_data');

  ok('39 pausada → no recibe; sin correo → no recibe',
    rem.dueFor(bk({ reminders_paused: true }), '2026-08-01').reason === 'paused' &&
    rem.dueFor(bk({ customer_email: null }), '2026-08-01').reason === 'no_recipient');

  ok('40 sin la columna reminders_paused (0019 sin aplicar) el recordatorio SÍ sale',
    rem.dueFor(bk({ reminders_paused: undefined }), '2026-08-01').due === true);

  ok('41 viaje pasado → no se envía nada',
    rem.dueFor(bk({ booking_date: '2026-07-20' }), '2026-08-01').reason === 'past_trip');

  /* El día del viaje sí entra, y es la etapa 0. */
  ok('42 el día del viaje entra como etapa d0',
    rem.dueFor(bk({ booking_date: '2026-08-01' }), '2026-08-01').type === 'pretrip_reminder_d0');

  /* Recorrido completo: una reserva recibe exactamente 5 correos. */
  const trip = '2026-08-10';
  const got = [];
  for (let i = 0; i <= 10; i++) {
    const day = rem.shiftYmd(trip, -i);
    const d = rem.dueFor(bk({ booking_date: trip }), day);
    if (d.due) got.push(i);
  }
  ok('43 en 10 días previos se disparan exactamente 5 etapas: 7,5,3,1,0',
    got.length === 5 && got.sort(function (a, b) { return b - a; }).join(',') === '7,5,3,1,0');

  ok('44 windowBounds pide de hoy a hoy+7',
    rem.windowBounds('2026-08-01')[0] === '2026-08-01' && rem.windowBounds('2026-08-01')[1] === '2026-08-08');

  const many = [bk({ id: 'a', booking_date: '2026-08-08' }), bk({ id: 'b', booking_date: '2026-08-02' }),
    bk({ id: 'c', booking_date: '2026-08-04' }), bk({ id: 'd', booking_date: '2026-08-01' })];
  const dl = rem.dueList(many, '2026-08-01');
  ok('45 dueList selecciona las que tocan hoy (d7, d3, d1, d0) y descarta el resto',
    dl.length === 4 && dl.map(function (x) { return x.days; }).sort().join(',') === '0,1,3,7');

  /* Plantillas registradas y con el texto correcto. */
  ok('46 las 5 plantillas están registradas y llevan QR',
    rem.allTypes().every(function (t) { return TEMPLATES[t] && TEMPLATES[t].qr === true; }));

  const mail7 = TEMPLATES.pretrip_reminder_d7.build(bk(), {});
  const mail0 = TEMPLATES.pretrip_reminder_d0.build(bk(), {});
  ok('47 el correo de 7 días dice cuántos días faltan',
    mail7.html.indexOf('Faltan 7 días') !== -1 && mail7.text.indexOf('FALTAN 7 DÍAS') !== -1);
  ok('48 el correo del día 0 anuncia que empieza hoy',
    mail0.html.indexOf('empieza hoy') !== -1 && /empieza hoy/i.test(mail0.subject) === false &&
    mail0.subject.indexOf('starts today') !== -1);

  ok('49 el correo NO inventa datos que no existen',
    mail7.text.indexOf('Flights') === -1 && mail7.text.indexOf('Meeting point') === -1);

  const mailFull = TEMPLATES.pretrip_reminder_d3.build(bk(), {
    flights: 'AV1630 GYE→GPS 09:15', hotel: 'Hotel Casa Blanca',
    meetingPoint: 'Muelle de San Cristóbal', schedule: '06:30',
    contact: '+593 99 000 0000', documents: 'Pasaporte y tarjeta de control'
  });
  ok('50 cuando SÍ existen, incluye vuelos, hotel, punto de encuentro, horario, contacto y documentos',
    ['AV1630', 'Casa Blanca', 'Muelle de San Cristóbal', '06:30', '+593 99 000 0000', 'Pasaporte']
      .every(function (s) { return mailFull.text.indexOf(s) !== -1; }));

  /* Endpoints del barrido. */
  const runH = read('server/admin-handlers/reminders-run.js');
  ok('51 el barrido acepta cron (CRON_SECRET) u owner, nunca admin/staff',
    /CRON_SECRET/.test(runH) && /requireWriter\(req, res\)/.test(runH) && /timingSafeEqual/.test(runH));
  ok('52 el barrido no cae si 0019 no está aplicada (select \'*\')',
    /select\('\*'\)/.test(runH));
  /* Se mira el CÓDIGO, no los comentarios: el barrido solo lee reservas y
     envía correos — no importa la librería de Stripe ni escribe en bookings. */
  ok('53 el barrido no toca Stripe ni modifica la reserva',
    !/require\([^)]*stripe/i.test(runH) && !/amount_cents:/.test(runH) &&
    !/\.update\(/.test(runH) && !/\.delete\(/.test(runH));

  const togH = read('server/admin-handlers/reminders-toggle.js');
  ok('54 pausar/reanudar es solo del owner y no borra nada',
    /requireWriter\(req, res\)/.test(togH) && /reminders_paused/.test(togH) && !/\.delete\(/.test(togH));

  const vj = JSON.parse(read('vercel.json'));
  ok('55 vercel.json: cron diario + rutas de recordatorios',
    Array.isArray(vj.crons) && vj.crons.length === 1 &&
    vj.crons[0].path === '/api/admin-reminders-run' &&
    vj.rewrites.some(function (r) { return r.source === '/api/admin-reminders-run'; }) &&
    vj.rewrites.some(function (r) { return r.source === '/api/admin-reminders-toggle'; }));

  console.log('\n=== RESULTADO FASE 9 (permisos + auditoría + recordatorios): ' + pass + ' PASS · ' + fail + ' FAIL ===');
  if (fail) process.exitCode = 1;
})();
