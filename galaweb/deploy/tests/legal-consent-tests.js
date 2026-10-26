'use strict';

/* =========================================================
   Pruebas: páginas legales + autorización expresa del formulario de pasajeros
   ---------------------------------------------------------
   - needsDataConsent / isMinorOn (LOPDP arts. 21 y 26).
   - /api/passenger-form REAL con Supabase simulado: CONSENT_REQUIRED al
     enviar siempre, y al guardar si hay datos sensibles o menores; guarda
     data_consent_at + data_consent_version; load devuelve data_consent.
   - Regla de reembolso de 15 días coherente en términos, políticas y badge.
   - Hechos del dueño en las páginas legales (empresa en EE. UU., sin correos
     promocionales, diseño de Loan-IX) y sin marcadores [PENDING].
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

/* ---------------- Supabase simulado (cadena mínima) ---------------- */
function makeClient(db) {
  function from(table) {
    const st = { filters: [], op: 'select', patch: null, single: false };
    function match(r) { return st.filters.every(function (f) { return r[f[0]] === f[1]; }); }
    function exec() {
      const rows = db[table] = db[table] || [];
      if (st.op === 'insert') {
        rows.push(Object.assign({ id: table + '-' + rows.length }, st.patch));
        return Promise.resolve({ data: st.patch, error: null });
      }
      const hit = rows.filter(match);
      if (st.op === 'update') hit.forEach(function (r) { Object.assign(r, st.patch); });
      return Promise.resolve({ data: st.single ? (hit[0] || null) : hit, error: null });
    }
    const q = {
      select: function () { return q; },
      eq: function (k, v) { st.filters.push([k, v]); return q; },
      order: function () { return q; },
      update: function (p) { st.op = 'update'; st.patch = p; return q; },
      insert: function (p) { st.op = 'insert'; st.patch = p; return q; },
      maybeSingle: function () { st.single = true; return exec(); },
      single: function () { st.single = true; return exec(); },
      then: function (res, rej) { return exec().then(res, rej); }
    };
    return q;
  }
  return { from: from };
}
let CLIENT = makeClient({});
function mockModule(rel, exp) { const p = require.resolve(BASE + rel); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
mockModule('/server/lib/supabase.js', { getSupabase: function () { return CLIENT; } });
mockModule('/server/lib/passenger-crypto.js', {
  encryptDocumentNumber: function (v) { return { ciphertext: 'c', iv: 'i', authTag: 'a', last4: String(v).slice(-4), keyId: 'k' }; },
  decryptDocumentNumber: function () { return 'X'; },
  maskDocument: function (l4) { return l4 ? '****' + l4 : null; }
});
mockModule('/server/lib/passenger-intake-emails.js', { sendOwnerSubmitted: async function () {} });
mockModule('/server/lib/rate-limit.js', { checkRateLimit: async function () { return { allowed: true }; } });
mockModule('/server/lib/passenger-audit.js', { clientIpMasked: function () { return '0.0.0.x'; } });

const intake = require(BASE + '/server/lib/passenger-intake.js');
// Solo se reemplazan la firma del token y la sincronización con bookings.
intake.verifyFormToken = function (t) { return t === 'tok' ? { publicId: 'pub-1', tokenVersion: 1 } : null; };
intake.syncBookingIntakeStatus = async function () {};
process.env.TENANT_ID = 'hook-adventure';
const handler = require(BASE + '/api/passenger-form.js');

function freshDb() {
  return {
    booking_passenger_forms: [{
      id: 'f1', public_id: 'pub-1', tenant_id: 'hook-adventure', token_version: 1, active: true,
      status: 'pending', booking_id: 'b1', submission_version: 0, preferred_connection_city: 'quito',
      expires_at: new Date(Date.now() + 86400000).toISOString(), data_consent_at: null, data_consent_version: null
    }],
    bookings: [{ id: 'b1', tenant_id: 'hook-adventure', booking_code: 'HA-1', tour_name: 'Tour', booking_date: '2026-12-01', guests: 1, customer_name: 'Ana', customer_email: 'a@b.c' }],
    booking_passengers: [],
    booking_lodging_requirements: []
  };
}
function adult(extra) {
  return Object.assign({
    passenger_number: 1, legal_first_name: 'Ana', legal_last_name: 'Perez', date_of_birth: '1990-05-05',
    nationality: 'EC', document_type: 'passport', document_number: 'AB12345',
    document_expiration_date: '2035-01-01', issuing_country: 'EC'
  }, extra || {});
}
function mockRes() { return { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, end(s) { this.body = s; } }; }
async function call(db, action, extra) {
  CLIENT = makeClient(db);
  const body = Object.assign({ action: action, token: 'tok', form: { preferred_connection_city: 'quito' }, passengers: [adult()], lodging: { needs_hotel: false } }, extra || {});
  const res = mockRes();
  await handler({ method: 'POST', headers: {}, body: body }, res);
  let data = {}; try { data = JSON.parse(res.body); } catch (e) {}
  return { status: res.statusCode, data: data };
}
function ymdYearsAgo(n) {
  const d = new Date(Date.now() - 6 * 3600000);   // Galápagos UTC-6
  return (d.getUTCFullYear() - n) + '-01-01';
}

(async function main() {
  /* ---- lógica pura ---- */
  ok('1 isMinorOn: 17 años → menor', intake.isMinorOn('2009-03-01', '2026-10-26') === true);
  ok('2 isMinorOn: cumple 18 hoy → no menor', intake.isMinorOn('2008-10-26', '2026-10-26') === false);
  ok('3 isMinorOn: un día antes de los 18 → menor', intake.isMinorOn('2008-10-27', '2026-10-26') === true);
  ok('4 isMinorOn: sin fecha → false', intake.isMinorOn(null, '2026-10-26') === false);
  ok('5 needsDataConsent: adultos sin datos opcionales → false', intake.needsDataConsent([adult()], { needs_hotel: false }, '2026-10-26') === false);
  ok('6 needsDataConsent: requisito alimentario → true', intake.needsDataConsent([adult({ dietary_requirements: 'Vegano' })], null, '2026-10-26') === true);
  ok('7 needsDataConsent: solo espacios → false', intake.needsDataConsent([adult({ special_assistance: '   ' })], null, '2026-10-26') === false);
  ok('8 needsDataConsent: pasajero menor → true', intake.needsDataConsent([adult({ date_of_birth: '2015-06-01' })], null, '2026-10-26') === true);
  ok('9 needsDataConsent: notas de accesibilidad del hotel con hotel pedido → true', intake.needsDataConsent([adult()], { needs_hotel: true, accessibility_notes: 'Silla de ruedas' }, '2026-10-26') === true);
  ok('10 needsDataConsent: notas de hotel sin pedir hotel (no se guardan) → false', intake.needsDataConsent([adult()], { needs_hotel: false, accessibility_notes: 'Silla de ruedas' }, '2026-10-26') === false);
  ok('11 needsDataConsent: entrada no válida → false', intake.needsDataConsent('x', 'y', '2026-10-26') === false);
  ok('12 DATA_CONSENT_VERSION definida', typeof intake.DATA_CONSENT_VERSION === 'string' && intake.DATA_CONSENT_VERSION.length > 0);

  /* ---- handler real ---- */
  let db = freshDb();
  let r = await call(db, 'submit', {});
  ok('13 enviar SIN autorización → 400 CONSENT_REQUIRED', r.status === 400 && r.data.error === 'CONSENT_REQUIRED');
  ok('14 enviar sin autorización no cambia el estado ni guarda pasajeros', db.booking_passenger_forms[0].status === 'pending' && db.booking_passengers.length === 0);

  db = freshDb();
  r = await call(db, 'submit', { consent: true });
  const f = db.booking_passenger_forms[0];
  ok('15 enviar CON autorización → 200 submitted', r.status === 200 && r.data.submitted === true && f.status === 'submitted');
  ok('16 guarda la evidencia: data_consent_at + versión', !!f.data_consent_at && f.data_consent_version === intake.DATA_CONSENT_VERSION);
  r = await call(db, 'load');
  ok('17 load devuelve data_consent: true', r.status === 200 && r.data.form && r.data.form.data_consent === true);

  db = freshDb();
  r = await call(db, 'save-draft', {});
  ok('18 borrador sin datos sensibles ni menores → se guarda sin autorización', r.status === 200 && r.data.saved === true && db.booking_passenger_forms[0].data_consent_at === null);

  db = freshDb();
  r = await call(db, 'save-draft', { passengers: [adult({ accessibility_or_mobility_needs: 'Ayuda para subir al bote' })] });
  ok('19 borrador con dato de accesibilidad sin autorización → 400 y no guarda nada', r.status === 400 && r.data.error === 'CONSENT_REQUIRED' && db.booking_passengers.length === 0);

  db = freshDb();
  r = await call(db, 'save-draft', { passengers: [adult({ date_of_birth: ymdYearsAgo(10) })] });
  ok('20 borrador con un menor sin autorización → 400 CONSENT_REQUIRED', r.status === 400 && r.data.error === 'CONSENT_REQUIRED');

  db = freshDb();
  r = await call(db, 'save-draft', { passengers: [adult({ date_of_birth: ymdYearsAgo(10) })], consent: true });
  ok('21 borrador con un menor CON autorización → 200 y evidencia guardada', r.status === 200 && !!db.booking_passenger_forms[0].data_consent_at);

  db = freshDb();
  r = await call(db, 'save-draft', { lodging: { needs_hotel: true, nights: 1, rooms_required: 1, guest_count: 1, accessibility_notes: 'Habitación en planta baja' } });
  ok('22 borrador con notas de accesibilidad del hotel sin autorización → 400', r.status === 400 && r.data.error === 'CONSENT_REQUIRED');

  db = freshDb();
  r = await call(db, 'save-draft', { consent: 'yes' });
  ok('23 consent no booleano → 400 INVALID_CONSENT', r.status === 400 && r.data.error === 'INVALID_CONSENT');

  /* ---- formulario del cliente + migración ---- */
  const pjs = read('assets/js/passengers.js');
  ok('24 passengers.js: casilla pf_consent y envío del valor', /id="pf_consent"/.test(pjs) && /consent:\s*checked\('pf_consent'\)/.test(pjs));
  ok('25 passengers.js: enlace a la política en pestaña nueva (no pierde el token en memoria)', /href="security-policy\.html" target="_blank" rel="noopener"/.test(pjs));
  ok('26 passengers.js: mensaje para CONSENT_REQUIRED en ES/EN', /CONSENT_REQUIRED:\s*T\(/.test(pjs));
  const mig = read('supabase/migrations/0025_passenger_data_consent.sql');
  ok('27 migración 0025: agrega data_consent_at y data_consent_version (solo columnas)',
    /add column if not exists data_consent_at\s+timestamptz/.test(mig) && /add column if not exists data_consent_version text/.test(mig) && !/drop |delete |update /i.test(mig));

  /* ---- reembolso: 15 días en todos lados ---- */
  const terms = read('terms.html'), content = read('assets/js/content.js'), app = read('assets/js/app.js');
  ok('28 terms.html: 15 días o menos sin reembolso', /15 días o menos de anticipación: sin reembolso/.test(terms) && /more than 15 days before the activity: 100% refund/.test(terms));
  ok('29 content.js: políticas con 15 días y cancelDays: 15', /15 días o menos de anticipación: sin reembolso/.test(content) && /cancelDays:\s*15\b/.test(content));
  ok('30 sin restos de la regla de 30 días en términos/políticas/badge', !/30 d(ías|ays)/.test(terms) && !/30 d(ías|ays)/.test(content) && !/up to 30 days/.test(app) && !/cancelDays\|\|60/.test(app));
  ok('31 badge del checkout: "más de N días" (coherente con 15 o menos sin reembolso)', /Cancelación gratis con más de '\+\(S\.meta\.cancelDays\|\|15\)/.test(app));

  /* ---- páginas legales: hechos del dueño ---- */
  const priv = read('security-policy.html'), legal = read('legal.html');
  ok('32 privacidad: empresa constituida en EE. UU. con domicilio en Orlando', /empresa constituida en Estados Unidos, con domicilio principal en 12515 Lake Square Cir, Orlando, Florida 32821/.test(priv));
  ok('33 privacidad: no enviamos correos promocionales (sin "novedades ocasionales")', /No enviamos correos promocionales/.test(priv) && !/novedades ocasionales/.test(priv) && !/occasional news/.test(priv));
  ok('34 privacidad: autorización expresa por la casilla del formulario', /casilla del formulario de pasajeros/.test(priv) && /box in the passenger form/.test(priv));
  ok('35 legal.html: empresa en EE. UU., diseño de Loan-IX, sin "de propiedad local"', /constituida en Estados Unidos/.test(legal) && /titular del diseño del sitio/.test(legal) && !/de propiedad local/.test(legal));
  ok('36 terms.html: el diseño pertenece a Loan-IX Softworks', /el diseño del sitio pertenece a Loan-IX Softworks/.test(terms));
  ok('37 sin marcadores [PENDING] ni RUC inventado en las páginas legales', [priv, legal, terms].every(function (s) { return !/\[PENDING/i.test(s) && !/\bRUC\b/.test(s); }));
  ok('38 pie de página: "Privacidad y Seguridad"', /data-es="Privacidad y Seguridad"/.test(app));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
