'use strict';

/* =========================================================
   Pruebas — Página de pesca: charters $1,900 / $2,900 y la
   "8-Day Galápagos Fishing Expedition" (aprobada por el owner
   el 2026-11-09). Sin red, sin DB.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.resolve(__dirname, '..');
const catalog = require(BASE + '/server/lib/tour-catalog');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

const XP_EN = '8-Day Galápagos Fishing Expedition';
const XP_ES = 'Expedición de Pesca en Galápagos de 8 Días';
const INC_EN = 'All gear, bait, crew and refreshments included.';
const INC_ES = 'Incluye todo el equipo, carnada, tripulación y refrigerios.';

/* ---------------- catálogo del servidor (lo que cobra Stripe) ---------------- */
const half = catalog.getTour('half'), full = catalog.getTour('full'), xp = catalog.getTour('expedition');
ok('1 catálogo: medio día $1,900 y día completo $2,900, por bote',
  half.priceCents === 190000 && full.priceCents === 290000 &&
  half.unit === 'boat' && full.unit === 'boat' && !half.requiresQuote && !full.requiresQuote &&
  catalog.calculateGrossCents(half, 4) === 190000 && catalog.calculateGrossCents(full, 4) === 290000);
ok('2 catálogo: la expedición sigue por solicitud, con su nombre nuevo',
  xp.requiresQuote === true && xp.priceCents === null && xp.name === XP_EN);

/* ---------------- content.js ---------------- */
const box = { window: {} };
vm.runInNewContext(read('assets/js/content.js'), box);
const F = box.window.GHA_DEFAULT.fishing;
const trip = function (id) { return F.trips.find(function (t) { return t.id === id; }); };
ok('3 content.js: el precio de cada tarjeta = el que cobra Stripe',
  F.trips.filter(function (t) { return t.price; }).every(function (t) { return t.price * 100 === catalog.getTour(t.id).priceCents; }) &&
  trip('half').price === 1900 && trip('full').price === 2900);
ok('4 content.js: medio día y día completo dicen qué incluyen',
  ['half', 'full'].every(function (id) { const i = trip(id).includes; return i && i.en === INC_EN && i.es === INC_ES; }));
ok('5 content.js: la expedición va en su propia sección, no como tarjeta',
  trip('expedition').ownSection === true && trip('expedition').name.en === XP_EN && trip('expedition').name.es === XP_ES);

/* ---------------- renderFishing (app.js) ---------------- */
function renderFor(lang) {
  const app = read('assets/js/app.js').replace(/\r\n/g, '\n');
  const cut = function (from, to) { const a = app.indexOf(from); return app.slice(a, app.indexOf(to, a)); };
  const src = cut('function esc(', 'function bookBtn(') + cut('function bookBtn(', '/* =====') + cut('function renderFishing(', '\n}\n') + '\n}\n';
  const els = {};
  ['fishSpecies', 'fishReel', 'fishTrips', 'fishCalendar'].forEach(function (id) { els[id] = { innerHTML: '' }; });
  const xpBtn = { dataset: { name: 'x' } };
  const ctx = {
    S: box.window.GHA_DEFAULT, L: lang,
    t: function (x) { return x == null ? '' : (typeof x === 'string' ? x : (x[lang] || x.en)); },
    svg: function (n) { return '<svg data-i="' + n + '"></svg>'; },
    initTripCarousels: function () {}, observeReveals: function () {},
    document: {
      getElementById: function (id) { return els[id] || null; },
      querySelector: function (q) { return q === '#expedition .js-book' ? xpBtn : null; }
    }
  };
  vm.runInNewContext(src + ';renderFishing();', ctx);
  return { trips: els.fishTrips.innerHTML, xpName: xpBtn.dataset.name };
}
const es = renderFor('es'), en = renderFor('en');
ok('6 la página pinta 2 tarjetas (sin la expedición), con precio nuevo y la línea de incluye',
  (es.trips.match(/<article/g) || []).length === 2 &&
  /data-tour-id="half"/.test(es.trips) && /data-tour-id="full"/.test(es.trips) && !/data-tour-id="expedition"/.test(es.trips) &&
  /\$1,900/.test(es.trips) && /\$2,900/.test(es.trips) &&
  (es.trips.match(/class="pkg-includes"/g) || []).length === 2 && es.trips.indexOf(INC_ES) > 0 && en.trips.indexOf(INC_EN) > 0);
ok('7 el botón de la expedición lleva el nombre en el idioma elegido', es.xpName === XP_ES && en.xpName === XP_EN);

/* ---------------- sport-fishing.html ---------------- */
const html = read('sport-fishing.html');
const a = html.indexOf('id="expedition"');
const sec = a < 0 ? '' : html.slice(a, html.indexOf('</article>', a));
ok('8 sección de la expedición: $24,999 + impuestos, por grupo de 3–4 en un bote',
  /\$24,999/.test(sec) && /data-en="\+ taxes" data-es="\+ impuestos"/.test(sec) &&
  /data-en="per group of 3–4 anglers · one boat"/.test(sec) && /data-en="8 days · 7 nights · 4 fishing days"/.test(sec));
const btn = (sec.match(/<button[^>]*js-book[^>]*>/) || [''])[0];
ok('9 el botón abre la solicitud (cotización), no el pago con tarjeta',
  /data-tour-id="expedition"/.test(btn) && /data-price="0"/.test(btn) && /data-unit="boat"/.test(btn) &&
  /data-en="Request this expedition" data-es="Solicitar esta expedición"/.test(btn));
ok('10 no incluye: vuelos, parque, Ingala e impuestos',
  /International airfare to Ecuador/.test(sec) && /Flights to and from Galápagos/.test(sec) &&
  /National Park entry fee \(\$200\)/.test(sec) && /Ingala transit card \(\$20\)/.test(sec) && /data-en="Taxes" data-es="Impuestos"/.test(sec));
ok('11 todo texto de la sección está en inglés y español',
  sec.length > 0 && (sec.match(/data-en="/g) || []).length === (sec.match(/data-es="/g) || []).length &&
  (sec.match(/data-en="/g) || []).length >= 40);
ok('12 las dos tarjetas van en 2 columnas', /class="pkg-grid pkg-grid--two" id="fishTrips"/.test(html));
ok('13 estilos de la expedición enlazados en la página',
  /<link rel="stylesheet" href="assets\/css\/fishing-expedition\.css">/.test(html) &&
  fs.existsSync(path.join(BASE, 'assets/css/fishing-expedition.css')) &&
  /\.xp\{/.test(read('assets/css/fishing-expedition.css')) && /\.pkg-grid\.pkg-grid--two\{/.test(read('assets/css/fishing-expedition.css')));

console.log('\n=== RESULTADO FISHING-EXPEDITION: ' + pass + ' PASS · ' + fail + ' FAIL ===');
if (fail > 0) process.exit(1);
