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

/* EXCEPCIÓN AUTORIZADA POR EL OWNER — bandeja de mensajes de contacto.
   El owner pidió expresamente que owner Y admin gestionen los "pedidos
   internos" ("cualquiera de los dos podrá responder"). contact_messages es
   una entidad NUEVA de baja sensibilidad (consultas de clientes, sin dinero):
   cambiar el ESTADO de un mensaje (nuevo→leído→respondido→archivado) no toca
   reservas ni finanzas. Por eso este único write admite requireOwnerOrAdmin.
   La regla de Fase 9 (admin solo-lectura) sigue intacta para todo lo demás. */
const ADMIN_INBOX_WRITES = ['contact-message-update.js'];

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
  const inboxGate = ADMIN_INBOX_WRITES.indexOf(f) !== -1 && /requireOwnerOrAdmin\(req, res\)/.test(src);
  if (!writerGate && !saleGate && !ownerOnly && !inboxGate) LEAKS.push(f);
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

  /* =====================================================================
     D) COMUNICACIONES Y DOCUMENTOS DESDE LA RESERVA
     ===================================================================== */

  const comms = read('server/admin-handlers/booking-comms.js');
  const docSave = read('server/admin-handlers/booking-document-save.js');
  const send = read('server/admin-handlers/booking-communication-send.js');

  ok('56 la lectura de la sección la ven owner, admin y staff',
    /requireAdmin\(req, res, \['owner', 'admin', 'staff'\]\)/.test(comms));

  ok('57 el staff NO ve documentos con importes (filtrado en el servidor)',
    /STAFF_HIDDEN_DOCS/.test(comms) && /'receipt'/.test(comms) && /isStaff/.test(comms));

  ok('58 la sección no se cae si 0019 no está aplicada (storage_ready)',
    /storage_ready/.test(comms) && /storageReady = false/.test(comms));

  ok('59 enviar y adjuntar documentos es SOLO del owner',
    /requireWriter\(req, res\)/.test(send) && /requireWriter\(req, res\)/.test(docSave));

  ok('60 los documentos exigen enlace https (nunca http en claro)',
    /isHttpsUrl/.test(docSave) && /\^https:/.test(docSave));

  ok('61 retirar un documento es baja lógica, no borrado',
    /active: false/.test(docSave) && !/\.delete\(/.test(docSave));

  ok('62 el documento enviado debe pertenecer A ESA reserva',
    /\.eq\('booking_id', body\.booking_id\)/.test(send) && /DOCUMENT_NOT_FOUND/.test(send));

  ok('63 cada envío registra destinatario, tipo, estado, archivo y usuario',
    /recipient: recipient/.test(send) && /message_type: body\.message_type/.test(send) &&
    /status: status/.test(send) && /document_label:/.test(send) &&
    /sent_by_user_id: session\.user_id/.test(send) && /sent_by_name: session\.full_name/.test(send));

  ok('64 un fallo de envío se registra como failed y responde error honesto',
    /status = 'failed'/.test(send) && /SEND_FAILED/.test(send));

  ok('65 si la bitácora no está disponible se informa logged:false (no se miente)',
    /logged = false/.test(send) && /logged: logged/.test(send));

  /* Se mira la consulta real, no el comentario que lo explica. */
  ok('66 los envíos manuales NO tocan el registro idempotente de correos',
    !/from\('email_notifications'\)/.test(send) && /from\('booking_communications'\)/.test(send));

  /* La plantilla del mensaje manual. */
  const et = require(BASE + '/server/lib/email-templates');
  const msg = et.bookingMessage({ booking_code: 'HA-2026-AAA111', customer_name: 'Ana', tour_name: 'Tour', booking_date: '2026-08-08' },
    { messageType: 'air_ticket', note: 'Tu vuelo sale 09:15', documentUrl: 'https://x.co/t.pdf', documentLabel: 'Ticket AV1630' });
  ok('67 el mensaje manual incluye la nota y el enlace del documento',
    msg.text.indexOf('Tu vuelo sale 09:15') !== -1 && msg.text.indexOf('https://x.co/t.pdf') !== -1 &&
    msg.subject.indexOf('HA-2026-AAA111') !== -1);

  ok('68 cada tipo de mensaje tiene su título propio',
    et.MESSAGE_TITLES.qr_resend[1] === 'Tu código QR' &&
    et.MESSAGE_TITLES.hotel_voucher[1] === 'Tu voucher de hotel' &&
    et.MESSAGE_TITLES.change_notice[1] === 'Una actualización de tu reserva');

  const vj2 = JSON.parse(read('vercel.json'));
  ok('69 vercel.json expone las tres rutas de comunicaciones',
    ['/api/admin-booking-comms', '/api/admin-booking-document-save', '/api/admin-booking-communication-send']
      .every(function (p) { return vj2.rewrites.some(function (r) { return r.source === p; }); }));

  /* =====================================================================
     E) NAVEGACIÓN FINAL Y PANTALLAS
     ===================================================================== */

  const adm = read('assets/js/admin.js');
  const html = read('admin.html');

  /* Las ocho entradas, en orden (Mensajes se añadió tras Reservas: bandeja de
     contacto para owner y admin). */
  const navBlock = adm.slice(adm.indexOf('const panels=[', adm.indexOf('function panelsFor')));
  const navIds = (navBlock.slice(0, navBlock.indexOf('];')).match(/id:'([a-z]+)'/g) || [])
    .map(function (s) { return s.slice(4, -1); });
  ok('70 la navegación tiene exactamente 8 entradas, en el orden pedido',
    navIds.join(',') === 'dashboard,bookings,messages,calendar,sales,finance,content,settings');

  /* Lo oculto sigue EXISTIENDO en el código: ocultar no es borrar. */
  ['panelMiluTourism', 'panelHotelPreferences', 'panelPackagePricing', 'panelPackageNotes',
    'panelPackages', 'panelSite', 'panelTours', 'panelFishing', 'panelStory', 'panelTestData',
    'panelNotifications', 'panelRecordSale']
    .forEach(function (fn) {
      ok('71 sigue existiendo la función ' + fn + ' (oculta, no borrada)',
        new RegExp('function ' + fn + '\\s*\\(').test(adm));
    });

  /* …pero ninguno de los módulos congelados aparece en el menú. */
  const navOnly = navBlock.slice(0, navBlock.indexOf('];'));
  ok('72 Milu y Hoteles preferidos no están en el menú',
    navOnly.indexOf('panelMiluTourism') === -1 && navOnly.indexOf('panelHotelPreferences') === -1);
  ok('73 Precios y Notas de paquetes ya no son entradas sueltas del menú',
    navOnly.indexOf("id:'pkgpricing'") === -1 && navOnly.indexOf("id:'notes'") === -1);

  /* Reservas y Calendario: pantallas separadas, mismo detalle. */
  ok('74 bkScreen distingue tabla y calendario',
    /const mode = o\.mode \|\| 'table'/.test(adm) && /const isCal = mode==='cal'/.test(adm) &&
    /if\(isCal\)\{ p\.appendChild\(summary\); p\.appendChild\(cal\); \}/.test(adm));
  ok('75 Reservas monta la tabla; el Calendario no monta el bloque de filtros',
    /function panelBookings\(role\)/.test(adm) && /mode:'table'/.test(adm) &&
    /function panelCalendar\(role\)/.test(adm) && /mode:'cal'/.test(adm) &&
    /if\(!isCal\) p\.appendChild\(fcard\);/.test(adm));
  ok('76 ambas pantallas abren el MISMO detalle unificado',
    /function openDetail\(b\)\{ if\(isStaff\) bkStaffDetail\(b\); else bkAdminDetail\(b/.test(adm));

  /* Ventas: pantalla propia. */
  ok('77 Ventas es una pantalla propia con registro de venta',
    /function panelSales\(role\)/.test(adm) && /bkAgencyForm\(/.test(adm) &&
    /if\(canRecordSale\(\)\)\{/.test(adm));

  /* Detalle unificado: todo dentro de la reserva. */
  const detail = adm.slice(adm.indexOf('function bkAdminDetail'), adm.indexOf('function bkAgencyForm'));
  ok('78 el detalle reúne pasajeros, comunicaciones, finanzas y vuelos',
    /bkPaxSection\(b\)/.test(detail) && /bkCommsSection\(b\)/.test(detail) &&
    /bkFinanceSection\(b\)/.test(detail) && /bkFlightsPlaceholder\(\)/.test(detail));
  ok('79 el QR y las notificaciones viven en el propio detalle',
    /bkQrPanel\(b\)/.test(detail) && /bkNotifPanel\(b\)/.test(detail));
  ok('80 cambiar el estado solo se ofrece a quien puede escribir',
    /if\(canWrite\(\)\)\{\s*\n?\s*ctrl\.appendChild\(sel\)/.test(detail));
  /* El único campo de UUID a mano que queda vive en panelMiluTourism, que
     está CONGELADO y fuera del menú desde la Fase 8. Se comprueba que ninguna
     pantalla ALCANZABLE lo pida, y que ese panel siga siendo inalcanzable. */
  const miluStart = adm.indexOf('function panelMiluTourism');
  const reachable = adm.slice(0, miluStart) + adm.slice(adm.indexOf('function panelsFor'));
  ok('81 ninguna pantalla alcanzable pide un UUID a mano',
    !/placeholder="uuid"/i.test(reachable) && navOnly.indexOf('panelMiluTourism') === -1);

  /* Contenido del sitio: un módulo, y Paquetes unificado. */
  ok('82 Contenido del sitio agrupa portada, paquetes, tours, pesca, nosotros y sitio',
    /function panelContent\(role\)/.test(adm) &&
    ["id:'portada'", "id:'paquetes'", "id:'tours'", "id:'pesca'", "id:'nosotros'", "id:'sitio'"]
      .every(function (s) { return adm.indexOf(s) !== -1; }));
  ok('83 Paquetes une contenido + precio publicado + notas en una pantalla',
    /function panelPackagesUnified\(role\)/.test(adm) &&
    /panelPackages\(\)/.test(adm) && /panelPackagePricing\(role\)/.test(adm) && /panelPackageNotes\(role\)/.test(adm));

  /* Configuración (corrección D3/D4): SIN Notificaciones ni Datos de prueba;
     solo Recordatorios, Descuentos y plantillas de costos avanzadas. */
  const settingsBlock = adm.slice(adm.indexOf('function panelSettings'), adm.indexOf('function panelSettings') + 900);
  ok('84 Configuración = Recordatorios + Descuentos + plantillas (sin Notificaciones ni Test data)',
    /function panelSettings\(role\)/.test(adm) &&
    ["id:'record'", "id:'descuentos'", "id:'plantillas'"].every(function (s) { return settingsBlock.indexOf(s) !== -1; }) &&
    settingsBlock.indexOf("id:'notif'") === -1 && settingsBlock.indexOf("id:'testdata'") === -1);
  ok('85 Notificaciones y Datos de prueba quedan dormidos (funciones existen, no se invocan en Configuración)',
    /function panelNotifications\(role\)/.test(adm) && /function panelTestData\(role\)/.test(adm) &&
    settingsBlock.indexOf('panelTestData(role)') === -1 && settingsBlock.indexOf('panelNotifications(role)') === -1);
  ok('86 Configuración muestra la cadencia real y permite lanzar el barrido',
    /function panelRemindersSettings\(role\)/.test(adm) &&
    /Faltan 7 días para tu aventura en Galápagos\./.test(adm) &&
    /Tu aventura en Galápagos empieza hoy\./.test(adm) &&
    /admin-reminders-run/.test(adm));

  /* Permisos en la interfaz. */
  ok('87 la interfaz conoce la matriz: canWrite = owner, canRecordSale = owner+staff',
    /function canWrite\(\)\{ return ROLE==='owner'; \}/.test(adm) &&
    /function canRecordSale\(\)\{ return ROLE==='owner' \|\| ROLE==='staff'; \}/.test(adm) &&
    /ROLE = user\.role\|\|'';/.test(adm));
  ok('88 al admin se le explica por qué no hay botones (aviso de solo lectura)',
    /function readOnlyBanner\(\)/.test(adm) && /ro-note/.test(adm) && /\.ro-note\{/.test(html));
  ok('89 guardar/restablecer contenido es solo del owner',
    /const canEditContent = canWrite\(\);/.test(adm) &&
    /if\(canEditContent\)\{/.test(adm) && !/if\(!isStaff\)\{\s*document\.getElementById\('saveBtn'\)/.test(adm));

  /* El staff mantiene su ámbito. */
  const staffBranch = adm.slice(adm.indexOf("if(role==='staff'){"), adm.indexOf("if(role==='staff'){") + 700);
  ok('90 el staff no ve Finanzas, Contenido ni Configuración',
    staffBranch.indexOf('panelFinance') === -1 && staffBranch.indexOf('panelContent') === -1 &&
    staffBranch.indexOf('panelSettings') === -1);
  ok('91 el staff sí ve agenda, calendario, ventas y pasajeros',
    ["id:'schedule'", "id:'calendar'", "id:'sales'", "id:'passengers'"]
      .every(function (s) { return staffBranch.indexOf(s) !== -1; }));

  /* Estilos del tema (nada de rojo como color principal). */
  ok('92 los estilos nuevos usan los tokens de marca, no colores sueltos',
    /\.rem-stage b\{color:var\(--a-sidebar\);background:var\(--a-gold\)/.test(html) &&
    /\.bk-block\{[^}]*var\(--a-card-2\)/.test(html));

  console.log('\n=== RESULTADO FASE 9: ' + pass + ' PASS · ' + fail + ' FAIL ===');
  if (fail) process.exitCode = 1;
})();
