'use strict';

/* =========================================================
   Pruebas — Barra Black Friday 2026 (pedido del owner,
   2026-11-26). Anuncia HOOK20 / HOOK10; se apaga sola el lunes
   30 nov 23:59:59 hora de Galápagos y lo comprado sirve para
   viajar hasta el 31 dic 2027. Sin red, sin DB.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8').replace(/\r\n/g, '\n'); }

const box = { window: {} };
vm.runInNewContext(read('assets/js/content.js'), box);
const C = box.window.GHA_DEFAULT, P = C.promo;
const promoBox = { window: {}, document: {}, navigator: {}, setTimeout: setTimeout, clearInterval: clearInterval, setInterval: setInterval };
vm.runInNewContext(read('assets/js/promo-bf.js'), promoBox);
const G = promoBox.window.GHAPromo;
const catalog = require(BASE + '/server/lib/tour-catalog');

const BEFORE = Date.parse('2026-11-27T15:00:00Z');
const LAST_SEC = Date.parse('2026-12-01T05:59:58Z');
const AFTER = Date.parse('2026-12-01T06:00:00Z');   // martes 1 dic 00:00 en Galápagos

/* ---------------- fechas ---------------- */
ok('1 la promo termina el lunes 30 nov 23:59:59 hora de Galápagos (UTC-6)', P.endsAt === '2026-12-01T05:59:59Z');
ok('2 vigente el viernes y hasta el último segundo del lunes', G.active(P, BEFORE) === true && G.active(P, LAST_SEC) === true);
ok('3 desde el martes 1 dic 00:00 (Galápagos) se apaga sola', G.active(P, AFTER) === false && G.codeFor(P, 'p4', AFTER) === null);

/* ---------------- códigos ---------------- */
const tourIds = Object.keys(catalog.TOURS).filter(function (id) { return catalog.TOURS[id].type === 'tour' && !catalog.TOURS[id].requiresQuote; });
const pkgIds = Object.keys(catalog.TOURS).filter(function (id) { return catalog.TOURS[id].type === 'package'; });
ok('4 HOOK20 (20 %) para todos los paquetes y la expedición de pesca',
  pkgIds.concat(['expedition']).every(function (id) { const c = G.codeFor(P, id, BEFORE); return c && c.code === 'HOOK20' && c.pct === 20; }));
ok('5 HOOK10 (10 %) para todos los tours de día y los charters de pesca',
  tourIds.concat(['half', 'full']).every(function (id) { const c = G.codeFor(P, id, BEFORE); return c && c.code === 'HOOK10' && c.pct === 10; }));
ok('6 sin código para el charter privado (por cotización)', G.codeFor(P, 'private', BEFORE) === null);
ok('7 cada experiencia del catálogo tiene a lo sumo un código', Object.keys(catalog.TOURS).every(function (id) {
  return P.codes.filter(function (c) { return c.ids.indexOf(id) !== -1; }).length <= 1;
}));
ok('8 todos los ids de la promo existen en el catálogo', P.codes.every(function (c) { return c.ids.every(function (id) { return !!catalog.getTour(id); }); }));

/* ---------------- textos ---------------- */
const es = G.barHtml(P, 'es', BEFORE), en = G.barHtml(P, 'en', BEFORE);
ok('9 la barra (es) muestra los dos códigos, sus % y qué cubren',
  /HOOK20/.test(es) && /HOOK10/.test(es) && /−20%/.test(es) && /−10%/.test(es) && /paquetes y expedición de pesca/.test(es) && /tours y charters de pesca/.test(es));
ok('10 la barra (es) dice cuándo termina y que se viaja hasta el 31 dic 2027',
  /Termina en 3d 14h 59m/.test(es) && /compra hasta el lun 30 nov · 11:59 pm/.test(es) && /Viaja hasta el 31 dic 2027/.test(es));
ok('11 la barra (en) en inglés', /Ends in 3d 14h 59m/.test(en) && /Travel through Dec 31, 2027/.test(en) && /packages &amp; fishing expedition/.test(en));
ok('12 cuenta regresiva: días/horas/minutos y vacía al terminar',
  G.timeLeft(P, 'es', Date.parse('2026-11-30T05:59:59Z')) === 'Termina en 1d 0h 0m' &&
  G.timeLeft(P, 'en', Date.parse('2026-12-01T05:29:59Z')) === 'Ends in 30m' && G.timeLeft(P, 'es', AFTER) === '');
ok('13 los códigos se pueden copiar (botón) y la barra se puede cerrar', /class="bf-code" data-code="HOOK20"/.test(es) && /id="bfClose"/.test(es));

/* ---------------- integración en app.js ---------------- */
const app = read('assets/js/app.js');
ok('14 app.js carga la barra solo mientras la promo está vigente', /function loadPromo\(\)/.test(app) && /Date\.parse\(S\.promo\.endsAt\)>Date\.now\(\)/.test(app) && /loadPromo\(\);/.test(app));
ok('15 la barra se repinta al cambiar de idioma', /if\(window\.GHAPromo\) GHAPromo\.render\(S\.promo, L\)/.test(app));
ok('16 el checkout sugiere el código de la experiencia con botón Aplicar',
  /id="bkPromoSuggest"/.test(app) && /GHAPromo\.codeFor\(S\.promo, bkState\.tourId\)/.test(app) && /bf-sg-apply/.test(app) && /viaja hasta el 31 dic 2027/.test(app));

/* ---------------- estilos ---------------- */
const css = read('assets/css/promo-bf.css');
ok('17 alto contraste: fondo negro con texto claro y códigos oscuros sobre crema',
  /\.bf-bar\{[^}]*background:#0b0b0b;color:#f7f3eb/.test(css) && /\.bf-code\{[^}]*color:#0b0b0b;background:#f7f3eb/.test(css));
ok('18 el header fijo baja lo que mide la barra (no se encima)', /html\.bf-on \.site-header\{top:var\(--bf-top,0px\);\}/.test(css) && /html\.bf-on body\{padding-top:var\(--bf-h,0px\);\}/.test(css));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
