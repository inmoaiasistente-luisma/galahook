'use strict';

/* =========================================================
   Pruebas — Código de descuento en la expedición de pesca de 8
   días (pedido del owner, 2026-11-26: HOOK20 también aplica).
   La expedición es por cotización (sin cobro): el código se
   valida en el servidor, queda registrado en la solicitud y el
   equipo lo aplica al cotizar. Sin red: Supabase en memoria.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');
const { createFakeSupabase } = require('./helpers/fake-supabase');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8').replace(/\r\n/g, '\n'); }

/* ---------------- dobles: Supabase, notas y correos ---------------- */
let FAKE = createFakeSupabase({});
let MAIL = [];
function mockModule(rel, exp) { const p = require.resolve(BASE + rel); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
mockModule('/server/lib/supabase.js', { getSupabase: function () { return FAKE; } });
mockModule('/server/lib/tour-notes.js', {
  getPublicNotesForTour: async function () { return { notes: [], notes_version: null, requires_acknowledgement: false }; },
  resolveNotesForBooking: async function () { return { snapshot: [], version: null, acknowledgedAt: null, acknowledgementVersion: null }; }
});
mockModule('/server/lib/booking-email-service.js', {
  notifyBooking: async function (b, c, o, ctx) { MAIL.push({ booking: b, customerType: c, ownerType: o, ctx: ctx }); return {}; },
  sendBookingEmail: async function () { return {}; }, QR_CID: 'qr'
});
process.env.TENANT_ID = 'hook-adventure';

const { pickQuoteRule } = require(BASE + '/server/lib/pricing-engine');
const quoteHandler = require(BASE + '/api/quote-request.js');
const previewHandler = require(BASE + '/api/pricing-preview.js');
const templates = require(BASE + '/server/lib/email-templates.js');

const NOW = '2026-11-27T15:00:00.000Z';
const END = '2026-12-01T05:59:59.000Z';     // lunes 30 nov 23:59:59 en Galápagos
function rule(extra) {
  return Object.assign({ id: 'r-' + Math.random().toString(36).slice(2), tenant_id: 'hook-adventure', active: true, tour_id: 'expedition',
    code: 'HOOK20', discount_type: 'percentage', percentage_bps: 2000, amount_cents: null, min_guests: 1, max_guests: null,
    starts_at: '2026-11-26T20:34:43.000Z', ends_at: END, priority: 0, created_at: '2026-11-26' }, extra || {});
}
const XP20 = rule({ id: 'r-xp20' });
const RULES = [XP20,
  rule({ id: 'r-p4', tour_id: 'p4' }),
  rule({ id: 'r-kicker10', tour_id: 'kicker', code: 'HOOK10', percentage_bps: 1000 }),
  rule({ id: 'r-auto', tour_id: null, code: null, percentage_bps: 5000 })];

/* ---------------- 1) lógica pura: pickQuoteRule ---------------- */
const g = pickQuoteRule(RULES, 'expedition', 4, NOW, 'HOOK20');
ok('1 HOOK20 vale en la expedición: 20 %', g && !g.codeInvalid && g.code === 'HOOK20' && g.percent === 20 && g.rule.id === 'r-xp20');
ok('2 no distingue mayúsculas ni espacios', (function () { const r = pickQuoteRule(RULES, 'expedition', 4, NOW, '  hook20 '); return r && !r.codeInvalid && r.percent === 20; })());
ok('3 HOOK10 (de los tours) NO vale en la expedición', pickQuoteRule(RULES, 'expedition', 4, NOW, 'HOOK10').codeInvalid === true);
ok('4 un código inventado no vale', pickQuoteRule(RULES, 'expedition', 4, NOW, 'GRATIS').codeInvalid === true);
ok('5 sin código no hay descuento ni error (null)', pickQuoteRule(RULES, 'expedition', 4, NOW, '') === null && pickQuoteRule(RULES, 'expedition', 4, NOW, null) === null);
ok('6 una regla automática (sin código) nunca aplica a una cotización',
  pickQuoteRule([rule({ code: null })], 'expedition', 4, NOW, 'HOOK20').codeInvalid === true);
ok('7 después del lunes 30 nov 23:59:59 (Galápagos) el código ya no vale',
  pickQuoteRule(RULES, 'expedition', 4, '2026-12-01T06:00:00.000Z', 'HOOK20').codeInvalid === true &&
  pickQuoteRule(RULES, 'expedition', 4, '2026-12-01T05:59:58.000Z', 'HOOK20').codeInvalid === false);
ok('8 regla desactivada o de monto fijo no aplica a cotización',
  pickQuoteRule([rule({ active: false })], 'expedition', 4, NOW, 'HOOK20').codeInvalid === true &&
  pickQuoteRule([rule({ discount_type: 'fixed_total', percentage_bps: null, amount_cents: 5000 })], 'expedition', 4, NOW, 'HOOK20').codeInvalid === true);

/* ---------------- handlers reales con Supabase en memoria ---------------- */
function mockRes() { return { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; }, end(s) { this.body = s; } }; }
async function call(handler, body) {
  const res = mockRes();
  await handler({ method: 'POST', headers: {}, body: body }, res);
  let data = {}; try { data = JSON.parse(res.body); } catch (e) {}
  return { status: res.statusCode, data: data };
}
function freshDb() {
  /* fechas relativas a hoy: la regla vale ahora (el handler usa la hora real) */
  const live = rule({ id: 'r-xp20', starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 86400000).toISOString() });
  FAKE = createFakeSupabase({ discount_rules: [live, rule({ id: 'r-k10', tour_id: 'kicker', code: 'HOOK10', percentage_bps: 1000,
    starts_at: live.starts_at, ends_at: live.ends_at })], bookings: [] });
  MAIL = [];
}
let reqN = 0;
function quoteBody(extra) {
  reqN++;
  return Object.assign({ request_id: '00000000-0000-4000-8000-' + String(100000000000 + reqN), tour_id: 'expedition', booking_date: '2027-02-10', guests: 4,
    customer_name: 'Ana Pérez', customer_email: 'ana@example.com' }, extra || {});
}

(async function main() {
  /* pricing-preview: el modal valida el código antes de enviar */
  freshDb();
  let r = await call(previewHandler, { tour_id: 'expedition', guests: 4, discount_code: 'hook20' });
  ok('9 vista previa: la expedición sigue "por cotización" y confirma HOOK20 al 20 %',
    r.status === 400 && r.data.error === 'QUOTE_REQUIRED' && r.data.codeInvalid === false && r.data.quoteDiscount && r.data.quoteDiscount.code === 'HOOK20' && r.data.quoteDiscount.percent === 20);
  r = await call(previewHandler, { tour_id: 'expedition', guests: 4, discount_code: 'HOOK10' });
  ok('10 vista previa: HOOK10 en la expedición se marca como no válido', r.data.codeInvalid === true && r.data.quoteDiscount === null);
  r = await call(previewHandler, { tour_id: 'expedition', guests: 4 });
  ok('11 vista previa sin código: ni error de código ni descuento', r.data.codeInvalid === false && r.data.quoteDiscount === null);

  /* quote-request: la solicitud guarda el código */
  freshDb();
  r = await call(quoteHandler, quoteBody({ discount_code: 'hook20', notes: 'Somos 4 pescadores' }));
  const saved = FAKE.db.tables.bookings[0] || {};
  ok('12 la solicitud con HOOK20 se guarda (sin cobro) con la regla enlazada',
    r.status === 200 && r.data.status === 'quote_received' && saved.request_type === 'quote' && saved.amount_cents === null && saved.discount_rule_id === 'r-xp20');
  ok('13 las notas empiezan con el código para que el equipo lo vea en el panel y el correo interno',
    saved.notes === 'Código de descuento HOOK20 (20%) — Somos 4 pescadores');
  ok('14 la respuesta y los correos llevan el descuento',
    r.data.quoteDiscount && r.data.quoteDiscount.code === 'HOOK20' && r.data.quoteDiscount.percent === 20 &&
    MAIL.length === 1 && MAIL[0].ctx && MAIL[0].ctx.quoteDiscount.code === 'HOOK20');

  freshDb();
  r = await call(quoteHandler, quoteBody({ discount_code: 'HOOK10' }));
  ok('15 un código que no vale para la expedición se rechaza y no se guarda nada',
    r.status === 400 && r.data.error === 'DISCOUNT_CODE_NOT_VALID' && FAKE.db.tables.bookings.length === 0 && MAIL.length === 0);

  freshDb();
  r = await call(quoteHandler, quoteBody({ notes: 'Sin código' }));
  const plain = FAKE.db.tables.bookings[0] || {};
  ok('16 sin código, la solicitud queda igual que antes',
    r.status === 200 && plain.notes === 'Sin código' && plain.discount_rule_id === null && r.data.quoteDiscount === null && MAIL[0].ctx === undefined);

  freshDb();
  r = await call(quoteHandler, quoteBody({ discount_code: 'HOOK20' }));
  ok('17 con código y sin notas, las notas solo dicen el código', r.status === 200 && FAKE.db.tables.bookings[0].notes === 'Código de descuento HOOK20 (20%)');
  r = await call(quoteHandler, quoteBody({ discount_code: 12 }));
  ok('18 un código que no es texto se rechaza', r.status === 400 && r.data.error === 'INVALID_DISCOUNT_CODE');

  /* correo al cliente */
  const b = { booking_code: 'HA-2026-ABC', customer_name: 'Ana', tour_name: '8-Day Galápagos Fishing Expedition', booking_date: '2027-02-10', guests: 4 };
  const src = read('server/lib/email-templates.js');
  const mod = require(BASE + '/server/lib/email-templates.js');
  const build = (mod.TEMPLATES && mod.TEMPLATES.customer_quote_acknowledgement && mod.TEMPLATES.customer_quote_acknowledgement.build) || null;
  if (build) {
    const m1 = build(b, { quoteDiscount: { code: 'HOOK20', percent: 20 } }), m0 = build(b, {});
    ok('19 correo al cliente: confirma que su cotización incluirá HOOK20 (20 %)',
      /HOOK20 \(20% de descuento\)/.test(m1.html) && /HOOK20 \(20% off\)/.test(m1.text) && !/HOOK20/.test(m0.html));
  } else {
    ok('19 correo al cliente: confirma que su cotización incluirá el código',
      /function customerQuoteAcknowledgement\(b, ctx\)/.test(src) && /% de descuento\) quedó registrado/.test(src));
  }

  /* modal del sitio (app.js) */
  const app = read('assets/js/app.js');
  ok('20 el campo de código también se muestra en solicitudes (no se oculta)', /promoWrap\.style\.display='';/.test(app) && !/promoWrap\.style\.display=request\?'none':''/.test(app));
  ok('21 el modal envía el código también en la solicitud y avisa si aplicó',
    /if\(code\) payload\.discount_code=code;\s+\/\/ pago y cotización/.test(app) && /de descuento en tu cotización/.test(app) && /bkPricing\.quoteDiscount=/.test(app));
  ok('22 error claro si el código no vale', /case 'DISCOUNT_CODE_NOT_VALID'/.test(app));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.log('FAIL  crash: ' + (e && e.stack)); process.exit(1); });
