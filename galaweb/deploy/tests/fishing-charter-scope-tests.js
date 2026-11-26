'use strict';

/* =========================================================
   Pruebas — Qué pesca entra en cada charter (pedido del owner,
   2026-11-26): el de menor valor ($1,900, medio día) es solo
   pesca chica y pesca de profundidad; el de mayor valor ($2,900,
   día completo) es todo incluido con Marlín, porque el Marlín
   se encuentra más lejos. Sin red, sin DB.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.resolve(__dirname, '..');
const catalog = require(BASE + '/server/lib/tour-catalog');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

const box = { window: {} };
vm.runInNewContext(read('assets/js/content.js'), box);
const F = box.window.GHA_DEFAULT.fishing;
const trip = function (id) { return F.trips.find(function (x) { return x.id === id; }); };
const half = trip('half'), full = trip('full');
const both = function (o) { return !!(o && o.en && o.es); };

/* ---------------- precios y cobro sin cambios ---------------- */
ok('1 precios iguales: medio día $1,900 y día completo $2,900, por bote (página y Stripe)',
  half.price === 1900 && full.price === 2900 &&
  catalog.getTour('half').priceCents === 190000 && catalog.getTour('full').priceCents === 290000 &&
  catalog.getTour('half').unit === 'boat' && catalog.getTour('full').unit === 'boat');

/* ---------------- el texto de cada charter ---------------- */
ok('2 los dos charters dicen qué pesca incluyen, en inglés y español',
  !!half.scope && !!full.scope && both(half.scope.title) && both(half.scope.text) && both(full.scope.title) && both(full.scope.text));
ok('3 medio día ($1,900): solo pesca chica y pesca de profundidad',
  /^Solo pesca chica y pesca de profundidad$/.test(half.scope.title.es) && /small-game and bottom fishing only/i.test(half.scope.title.en));
ok('4 medio día ($1,900): no incluye Marlín, porque el Marlín está más lejos',
  /No incluye Marlín/.test(half.scope.text.es) && /más lejos/.test(half.scope.text.es) &&
  /Marlin is not included/.test(half.scope.text.en) && /farther offshore/.test(half.scope.text.en));
ok('5 día completo ($2,900): todo incluido, con Marlín',
  /Todo incluido, con Marlín/.test(full.scope.title.es) && /All-inclusive, Marlin included/.test(full.scope.title.en) &&
  /pesca chica/i.test(full.scope.text.es) && /pesca de profundidad/.test(full.scope.text.es) && /Marlín/.test(full.scope.text.es) &&
  /Small-game, bottom and Marlin/.test(full.scope.text.en));
ok('6 día completo ($2,900): explica que el Marlín se encuentra más lejos',
  /más lejos, donde se encuentra el Marlín/.test(full.scope.text.es) && /farther offshore, where Marlin are found/.test(full.scope.text.en));
ok('7 Marlín / Marlin siempre con mayúscula',
  [half.scope.text, full.scope.title, full.scope.text].every(function (o) { return !/marl[ií]n/.test(o.es) && !/marlin/.test(o.en); }));
ok('8 la expedición de 8 días no cambia (sin esta línea)', !trip('expedition').scope);

/* ---------------- renderFishing (app.js) ---------------- */
function renderFor(lang) {
  const app = read('assets/js/app.js').replace(/\r\n/g, '\n');
  const cut = function (from, to) { const a = app.indexOf(from); return app.slice(a, app.indexOf(to, a)); };
  const src = cut('function esc(', 'function bookBtn(') + cut('function bookBtn(', '/* =====') + cut('function renderFishing(', '\n}\n') + '\n}\n';
  const els = {};
  ['fishSpecies', 'fishReel', 'fishTrips', 'fishCalendar'].forEach(function (id) { els[id] = { innerHTML: '' }; });
  const ctx = {
    S: box.window.GHA_DEFAULT, L: lang,
    t: function (x) { return x == null ? '' : (typeof x === 'string' ? x : (x[lang] || x.en)); },
    svg: function (n) { return '<svg data-i="' + n + '"></svg>'; },
    initTripCarousels: function () {}, observeReveals: function () {},
    document: { getElementById: function (id) { return els[id] || null; }, querySelector: function () { return null; } }
  };
  vm.runInNewContext(src + ';renderFishing();', ctx);
  return els.fishTrips.innerHTML;
}
function card(html, id) { const a = html.indexOf('data-tour-id="' + id + '"'); return html.slice(html.lastIndexOf('<article', a), a); }
const es = renderFor('es'), en = renderFor('en');
const esHalf = card(es, 'half'), esFull = card(es, 'full'), enHalf = card(en, 'half'), enFull = card(en, 'full');
ok('9 la tarjeta de $1,900 muestra "Solo pesca chica y pesca de profundidad" (es) y la de $2,900 "Todo incluido, con Marlín"',
  /\$1,900/.test(esHalf) && esHalf.indexOf('<b>' + half.scope.title.es + '.</b> ' + half.scope.text.es) !== -1 &&
  /\$2,900/.test(esFull) && esFull.indexOf('<b>' + full.scope.title.es + '.</b> ' + full.scope.text.es) !== -1);
ok('10 lo mismo en inglés',
  enHalf.indexOf('<b>' + half.scope.title.en + '.</b> ' + half.scope.text.en) !== -1 &&
  enFull.indexOf('<b>' + full.scope.title.en + '.</b> ' + full.scope.text.en) !== -1);
ok('11 cada tarjeta lleva una sola línea de pesca, antes de "Incluye todo el equipo", y el botón Reservar sigue',
  [esHalf, esFull].every(function (c) {
    return (c.match(/class="pkg-scope"/g) || []).length === 1 && c.indexOf('pkg-scope') < c.indexOf(half.includes.es);
  }) && (es.match(/js-book/g) || []).length === 2);
ok('12 la tarjeta de medio día no promete Marlín como incluido',
  !/Todo incluido/.test(esHalf) && !/Marlin included/.test(enHalf));

/* ---------------- estilos legibles ---------------- */
const css = read('assets/css/site.css');
ok('13 la línea de pesca usa texto oscuro (--ink) sobre fondo claro',
  /\.pkg-includes li\.pkg-scope\{[^}]*background:#fbf5e8[^}]*color:var\(--ink\)/.test(css));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
