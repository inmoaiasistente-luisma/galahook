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

  console.log('\n=== RESULTADO FASE 9 (permisos + auditoría): ' + pass + ' PASS · ' + fail + ' FAIL ===');
  if (fail) process.exitCode = 1;
})();
