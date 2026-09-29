'use strict';

/* =========================================================
   Pruebas — Códigos de descuento por canje (ManyChat/redes)
   ---------------------------------------------------------
   Una discount_rule puede llevar un `code` opcional. Sin código,
   sigue siendo automática (comportamiento previo intacto). Con
   código, SOLO aplica si el cliente lo escribe igual (sin distinguir
   mayúsculas) — nunca se aplica sola. pickRule() es una función pura
   (sin red/BD), así que se prueba directo; el resto se verifica por
   estructura de código, como el resto de esta suite.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

const { pickRule } = require(path.join(BASE, 'server/lib/pricing-engine'));

const now = '2026-09-29T12:00:00.000Z';
const auto = { id: 'r-auto', active: true, tour_id: 'kicker', code: null, min_guests: 1, priority: 0, discount_type: 'percentage', percentage_bps: 1000, created_at: '2026-01-01' };
const coded = { id: 'r-code', active: true, tour_id: 'kicker', code: 'MANYCHAT10', min_guests: 1, priority: 0, discount_type: 'percentage', percentage_bps: 1000, created_at: '2026-01-01' };
const codedOtherTour = { id: 'r-code2', active: true, tour_id: 'espanola', code: 'MANYCHAT10', min_guests: 1, priority: 0, discount_type: 'percentage', percentage_bps: 1000, created_at: '2026-01-01' };

/* --- A) regla sin código: automática, como antes --- */
ok('1 regla sin código aplica sin que el cliente escriba nada', pickRule([auto], 'kicker', 2, now, '') && pickRule([auto], 'kicker', 2, now, '').id === 'r-auto');
ok('2 regla sin código sigue aplicando aunque el cliente escriba un código cualquiera', pickRule([auto], 'kicker', 2, now, 'LOQUESEA') && pickRule([auto], 'kicker', 2, now, 'LOQUESEA').id === 'r-auto');

/* --- B) regla con código: NUNCA se aplica sola --- */
ok('3 regla con código NO aplica sin código escrito', pickRule([coded], 'kicker', 2, now, '') === null);
ok('4 regla con código NO aplica con un código distinto', pickRule([coded], 'kicker', 2, now, 'OTRO') === null);

/* --- C) regla con código: aplica con el código correcto, sin distinguir mayúsculas --- */
ok('5 regla con código aplica con el código exacto', pickRule([coded], 'kicker', 2, now, 'MANYCHAT10') && pickRule([coded], 'kicker', 2, now, 'MANYCHAT10').id === 'r-code');
ok('6 el match de código no distingue mayúsculas/minúsculas', pickRule([coded], 'kicker', 2, now, 'manychat10') && pickRule([coded], 'kicker', 2, now, 'manychat10').id === 'r-code');
ok('7 el match de código ignora espacios alrededor', pickRule([coded], 'kicker', 2, now, '  MANYCHAT10  ') && pickRule([coded], 'kicker', 2, now, '  MANYCHAT10  ').id === 'r-code');

/* --- D) un código válido para OTRO tour no aplica al tour actual --- */
ok('8 código válido de otro tour no se cuela en este tour', pickRule([codedOtherTour], 'kicker', 2, now, 'MANYCHAT10') === null);

/* --- E) si compiten una regla automática y una con código que coincide, gana la del código --- */
ok('9 con código correcto escrito, la regla codificada gana sobre la automática', pickRule([auto, coded], 'kicker', 2, now, 'MANYCHAT10').id === 'r-code');
ok('10 sin código escrito, sigue ganando la automática (la codificada queda descartada)', pickRule([auto, coded], 'kicker', 2, now, '').id === 'r-auto');

/* --- F) estructura: los endpoints públicos aceptan y validan discount_code --- */
const pricingPreview = read('api/pricing-preview.js');
const createPI = read('api/create-payment-intent.js');
const pricingEngine = read('server/lib/pricing-engine.js');
ok('11 pricing-preview: ALLOWED_KEYS incluye discount_code', /ALLOWED_KEYS = \[[^\]]*'discount_code'/.test(pricingPreview));
ok('12 pricing-preview: valida longitud/tipo de discount_code', /INVALID_DISCOUNT_CODE/.test(pricingPreview));
ok('13 pricing-preview: pasa el código a computeWebPricing', /code:\s*body\.discount_code/.test(pricingPreview));
ok('14 pricing-preview: expone codeInvalid en la respuesta', /codeInvalid:\s*p\.codeInvalid/.test(pricingPreview));
ok('15 create-payment-intent: ALLOWED_KEYS incluye discount_code', /ALLOWED_KEYS = \[[^\]]*'discount_code'/.test(createPI));
ok('16 create-payment-intent: valida longitud/tipo de discount_code', /INVALID_DISCOUNT_CODE/.test(createPI));
ok('17 create-payment-intent: pasa el código a computeWebPricing (cobro real también lo respeta)', /code:\s*body\.discount_code/.test(createPI));
ok('18 pricing-engine: computeWebPricing normaliza y usa o.code', /normalizeDiscountCode\(o && o\.code\)/.test(pricingEngine));

/* --- G) estructura: admin puede crear reglas con código --- */
const ruleSave = read('server/admin-handlers/discount-rule-save.js');
ok('19 discount-rule-save: ALLOWED_KEYS incluye code', /ALLOWED_KEYS = \[[^\]]*'code'/.test(ruleSave));
ok('20 discount-rule-save: valida formato de código (2-30, letras/números/guion)', /CODE_RE/.test(ruleSave) && /INVALID_CODE/.test(ruleSave));
ok('21 discount-rule-save: guarda code en fields', /code:\s*code/.test(ruleSave));

const adminJs = read('assets/js/admin.js');
ok('22 admin.js: formulario "Nueva regla" tiene campo de código', /Código \(opcional\)|Code \(optional\)/.test(adminJs));
ok('23 admin.js: envía payload.code cuando el owner lo llena', /payload\.code\s*=\s*cd/.test(adminJs));
ok('24 admin.js: tabla de reglas muestra el código o "Automática"', /rule\.code/.test(adminJs));

/* --- H) estructura: el modal de reserva tiene el campo para el cliente --- */
const appJs = read('assets/js/app.js');
ok('25 app.js: el modal tiene el input bkPromoInput', /id="bkPromoInput"/.test(appJs));
ok('26 app.js: el campo se oculta en experiencias de solo-cotización', /promoWrap\.style\.display=request\?'none':''/.test(appJs));
ok('27 app.js: refreshPricing envía discount_code cuando hay algo escrito', /reqBody\.discount_code\s*=\s*code/.test(appJs));
ok('28 app.js: el cobro real (create-payment-intent) también envía discount_code', /payload\.discount_code\s*=\s*code/.test(appJs));
ok('29 app.js: muestra aviso de código no válido', /Código no válido|not valid for this experience/.test(appJs));

/* --- I) migración: columna + constraint de formato --- */
const migration = fs.existsSync(path.join(BASE, 'supabase/migrations/0024_discount_rule_codes.sql'))
  ? read('supabase/migrations/0024_discount_rule_codes.sql') : '';
ok('30 migración 0024 existe', migration.length > 0);
ok('31 migración agrega la columna code', /add column if not exists code text/.test(migration));
ok('32 migración valida el formato del código (mayúsculas/números/guion, 2-30)', /chk_discount_code_format/.test(migration));

console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
if (fail) process.exit(1);
